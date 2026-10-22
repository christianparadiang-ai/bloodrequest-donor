import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/audit";
import {
  EnqueueOutboxInput,
  EnqueueOutboxInputSchema,
  FormattedOutboxEvent,
  OutboxEventRecord,
  OutboxMetrics,
} from "./types";

export function formatOutboxEvent(record: OutboxEventRecord): FormattedOutboxEvent {
  return {
    id: record.id,
    eventType: record.event_type,
    recipientUserId: record.recipient_user_id || "UNKNOWN",
    channel: record.channel || "IN_APP",
    status: record.status,
    attemptCount: record.attempt_count ?? record.retry_count ?? 0,
    nextAttemptAt: record.next_attempt_at || null,
    lastError: record.last_error || null,
    lastErrorCategory: record.last_error_category || null,
    deliveredAt: record.delivered_at || record.processed_at || null,
    idempotencyKey: record.idempotency_key || null,
    createdAt: record.created_at,
    updatedAt: record.updated_at || record.created_at,
  };
}

/**
 * Persists a durable, non-sensitive notification event into public.notification_events.
 * Ensures strict idempotency and decoupling from synchronous client responses.
 */
export async function enqueueNotificationEvent(
  input: EnqueueOutboxInput
): Promise<{
  success: boolean;
  event?: FormattedOutboxEvent;
  alreadyEnqueued?: boolean;
  error?: string;
}> {
  const admin = createSupabaseAdminClient();
  if (!admin) {
    return { success: false, error: "Database configuration unavailable." };
  }

  // Validate input schema
  const parsed = EnqueueOutboxInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: `Validation error: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
    };
  }

  const { eventType, recipientUserId, channel, payload, idempotencyKey } = parsed.data;

  // 1. Idempotency Check
  if (idempotencyKey) {
    const { data: existing } = await admin
      .from("notification_events")
      .select("*")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (existing) {
      return {
        success: true,
        alreadyEnqueued: true,
        event: formatOutboxEvent(existing as OutboxEventRecord),
      };
    }
  }

  // 2. Insert into public.notification_events
  const now = new Date().toISOString();
  const insertPayload = {
    event_type: eventType,
    recipient_user_id: recipientUserId,
    channel,
    payload,
    status: "PENDING",
    attempt_count: 0,
    retry_count: 0,
    next_attempt_at: now,
    idempotency_key: idempotencyKey || null,
    created_at: now,
    updated_at: now,
  };

  const { data: inserted, error: insertErr } = await admin
    .from("notification_events")
    .insert(insertPayload)
    .select("*")
    .single();

  if (insertErr || !inserted) {
    // If concurrent insert occurred with identical idempotency key
    if (insertErr?.code === "23505" && idempotencyKey) {
      const { data: conflictRecord } = await admin
        .from("notification_events")
        .select("*")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();

      if (conflictRecord) {
        return {
          success: true,
          alreadyEnqueued: true,
          event: formatOutboxEvent(conflictRecord as OutboxEventRecord),
        };
      }
    }

    return {
      success: false,
      error: insertErr?.message || "Failed to persist outbox event.",
    };
  }

  const record = inserted as OutboxEventRecord;

  // 3. Log Immutable Audit Log
  await logAuditEvent({
    actorProfileId: null,
    action: "NOTIFICATION_OUTBOX_ENQUEUED",
    targetTable: "notification_events",
    targetId: record.id,
    newState: {
      event_type: record.event_type,
      channel: record.channel,
      status: record.status,
      idempotency_key: record.idempotency_key,
    },
  });

  return {
    success: true,
    alreadyEnqueued: false,
    event: formatOutboxEvent(record),
  };
}

/**
 * Returns safe aggregated operational metrics for the notification outbox.
 * Message bodies, secrets, and donor PII are strictly excluded.
 */
export async function getOutboxMetrics(): Promise<OutboxMetrics> {
  const admin = createSupabaseAdminClient();
  if (!admin) {
    return {
      pendingCount: 0,
      processingCount: 0,
      deliveredCount: 0,
      retryableCount: 0,
      permanentFailureCount: 0,
      totalEventsCount: 0,
      lastWorkerRunAt: null,
      lastReconciliationRunAt: null,
    };
  }

  // Aggregate counts by status
  const { data: rows, error } = await admin
    .from("notification_events")
    .select("status");

  if (error || !rows) {
    return {
      pendingCount: 0,
      processingCount: 0,
      deliveredCount: 0,
      retryableCount: 0,
      permanentFailureCount: 0,
      totalEventsCount: 0,
      lastWorkerRunAt: null,
      lastReconciliationRunAt: null,
    };
  }

  let pendingCount = 0;
  let processingCount = 0;
  let deliveredCount = 0;
  let retryableCount = 0;
  let permanentFailureCount = 0;

  for (const row of rows) {
    switch (row.status) {
      case "PENDING":
        pendingCount++;
        break;
      case "PROCESSING":
        processingCount++;
        break;
      case "DELIVERED":
      case "COMPLETED":
        deliveredCount++;
        break;
      case "RETRYABLE_FAILURE":
        retryableCount++;
        break;
      case "PERMANENT_FAILURE":
      case "FAILED":
        permanentFailureCount++;
        break;
    }
  }

  // Fetch last worker run and last reconciliation run from audit logs
  const { data: workerAudit } = await admin
    .from("audit_logs")
    .select("created_at")
    .eq("action", "NOTIFICATION_DELIVERED")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: reconciliationAudit } = await admin
    .from("audit_logs")
    .select("created_at")
    .eq("action", "EXPIRATION_RECONCILIATION_EXECUTED")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    pendingCount,
    processingCount,
    deliveredCount,
    retryableCount,
    permanentFailureCount,
    totalEventsCount: rows.length,
    lastWorkerRunAt: workerAudit?.created_at || null,
    lastReconciliationRunAt: reconciliationAudit?.created_at || null,
  };
}

/**
 * Returns safe recent outbox jobs for administrative inspection.
 */
export async function getRecentOutboxEvents(
  limit: number = 20
): Promise<FormattedOutboxEvent[]> {
  const admin = createSupabaseAdminClient();
  if (!admin) return [];

  const { data, error } = await admin
    .from("notification_events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return data.map((r) => formatOutboxEvent(r as OutboxEventRecord));
}
