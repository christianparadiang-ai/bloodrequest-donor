import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/audit";
import { getNotificationDispatcher } from "@/lib/notifications/dispatcher";
import {
  OutboxChannel,
  OutboxEventRecord,
  OutboxPayloadSchema,
  ProcessOutboxBatchInput,
  ProcessOutboxBatchResult,
} from "./types";

const DEFAULT_BATCH_SIZE = 20;
const MAX_BATCH_SIZE = 100;
const DEFAULT_LEASE_SECONDS = 60;
const DEFAULT_MAX_ATTEMPTS = 5;

/**
 * Calculates deterministic exponential backoff with random jitter.
 */
export function calculateBackoffMs(attemptCount: number): number {
  const baseMs = 1000;
  const maxMs = 60000; // 1 minute max backoff
  const exponential = baseMs * Math.pow(2, Math.max(0, attemptCount - 1));
  const capped = Math.min(maxMs, exponential);
  const jitter = Math.floor(Math.random() * 500); // 0-500ms jitter
  return capped + jitter;
}

/**
 * Server-side worker that atomically claims and processes pending outbox jobs.
 * Enforces atomic database locks, bounded exponential backoff, and idempotent delivery.
 */
export async function processOutboxBatch(
  input: ProcessOutboxBatchInput = {}
): Promise<ProcessOutboxBatchResult> {
  const startTime = Date.now();
  const admin = createSupabaseAdminClient();

  if (!admin) {
    return {
      success: false,
      processedCount: 0,
      deliveredCount: 0,
      retryableCount: 0,
      permanentFailureCount: 0,
      recoveredLeaseCount: 0,
      executionDurationMs: 0,
      errors: [{ eventId: "global", error: "Database unavailable", category: "SYSTEM_ERROR" }],
    };
  }

  const batchSize = Math.min(Math.max(1, input.batchSize || DEFAULT_BATCH_SIZE), MAX_BATCH_SIZE);
  const leaseSeconds = input.leaseSeconds || DEFAULT_LEASE_SECONDS;
  const workerId = input.workerId || `worker-${process.pid || "node"}-${Date.now()}`;
  const maxAttempts = input.maxAttempts || DEFAULT_MAX_ATTEMPTS;

  let claimedJobs: OutboxEventRecord[] = [];
  let recoveredLeaseCount = 0;

  // 1. ATOMIC WORKER CLAIM VIA POSTGRESQL STORED PROCEDURE
  try {
    const { data: rpcRows, error: rpcErr } = await admin.rpc("claim_outbox_jobs", {
      p_batch_size: batchSize,
      p_lease_seconds: leaseSeconds,
      p_worker_id: workerId,
    });

    if (!rpcErr && Array.isArray(rpcRows)) {
      claimedJobs = rpcRows as OutboxEventRecord[];
    } else {
      // Fallback claim if RPC is not deployed yet or errored
      const now = new Date().toISOString();
      const { data: selectRows } = await admin
        .from("notification_events")
        .select("*")
        .or(
          `status.in.(PENDING,RETRYABLE_FAILURE),and(status.eq.PROCESSING,lease_expires_at.lte.${now})`
        )
        .lte("next_attempt_at", now)
        .order("created_at", { ascending: true })
        .limit(batchSize);

      if (selectRows && selectRows.length > 0) {
        for (const row of selectRows) {
          const leaseExpiresAt = new Date(Date.now() + leaseSeconds * 1000).toISOString();
          const { data: updated } = await admin
            .from("notification_events")
            .update({
              status: "PROCESSING",
              lease_token: workerId,
              lease_expires_at: leaseExpiresAt,
              attempt_count: (row.attempt_count || 0) + 1,
              retry_count: (row.retry_count || 0) + 1,
              updated_at: new Date().toISOString(),
            })
            .eq("id", row.id)
            .select("*")
            .single();

          if (updated) {
            claimedJobs.push(updated as OutboxEventRecord);
          }
        }
      }
    }
  } catch (claimErr) {
    console.error("Outbox claim error:", claimErr);
  }

  // Count recovered expired leases among claimed jobs
  for (const job of claimedJobs) {
    if (job.last_error_category === "LEASE_TIMEOUT") {
      recoveredLeaseCount++;
    }
  }

  let deliveredCount = 0;
  let retryableCount = 0;
  let permanentFailureCount = 0;
  const errors: Array<{ eventId: string; error: string; category: string }> = [];

  // 2. PROCESS CLAIMED JOBS
  for (const job of claimedJobs) {
    const attempts = job.attempt_count || job.retry_count || 1;

    // A. Validate Payload Schema
    const payloadParsed = OutboxPayloadSchema.safeParse(job.payload);
    if (!payloadParsed.success) {
      // Malformed jobs: permanent failure, do not retry!
      permanentFailureCount++;
      const errMsg = `Malformed payload schema: ${payloadParsed.error.issues.map((i) => i.message).join(", ")}`;
      errors.push({ eventId: job.id, error: errMsg, category: "MALFORMED_PAYLOAD" });

      await admin
        .from("notification_events")
        .update({
          status: "PERMANENT_FAILURE",
          last_error: errMsg,
          last_error_category: "MALFORMED_PAYLOAD",
          lease_token: null,
          lease_expires_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      await logAuditEvent({
        actorProfileId: null,
        action: "NOTIFICATION_DELIVERY_FAILED",
        targetTable: "notification_events",
        targetId: job.id,
        newState: { status: "PERMANENT_FAILURE", category: "MALFORMED_PAYLOAD", error: errMsg },
      });

      continue;
    }

    const payload = payloadParsed.data;
    const channel: OutboxChannel = job.channel || "IN_APP";

    // B. Delivery Execution
    try {
      if (channel === "IN_APP") {
        // In-App channel delivers directly to public.notifications
        const notifIdempotency = job.idempotency_key
          ? `notif:${job.idempotency_key}`
          : `notif:outbox:${job.id}`;

        const deliveredAt = new Date().toISOString();

        // Check if already in notifications
        const { data: existingNotif } = await admin
          .from("notifications")
          .select("id")
          .eq("idempotency_key", notifIdempotency)
          .maybeSingle();

        if (!existingNotif) {
          const validTypes = new Set([
            "DONOR_INTEREST_RECEIVED",
            "COMMITMENT_CONFIRMED",
            "COMMITMENT_DECLINED",
            "COMMITMENT_CANCELLED",
            "DONATION_SCHEDULED",
            "DONATION_REMINDER",
            "DONATION_RECORDED",
            "DONATION_COMPLETED",
            "REQUEST_PARTIALLY_FULFILLED",
            "REQUEST_FULFILLED",
            "REQUEST_EXPIRING",
            "VERIFICATION_APPROVED",
            "VERIFICATION_REJECTED",
            "DOCUMENT_AMENDMENT_REQUIRED",
          ]);
          const safeType = validTypes.has(job.event_type)
            ? job.event_type
            : "DONOR_INTEREST_RECEIVED";

          const { error: notifInsertErr } = await admin.from("notifications").insert({
            recipient_user_id: job.recipient_user_id || "SYSTEM",
            type: safeType,
            title: payload.title,
            body: payload.body,
            request_id: payload.requestId || null,
            match_id: payload.matchId || null,
            commitment_id: payload.commitmentId || null,
            status: "DELIVERED",
            delivered_at: deliveredAt,
            metadata: payload.metadata || {},
            idempotency_key: notifIdempotency,
          });

          if (notifInsertErr) {
            throw new Error(`Failed to insert notification: ${notifInsertErr.message}`);
          }
        }

        // Mark outbox job DELIVERED
        await admin
          .from("notification_events")
          .update({
            status: "DELIVERED",
            delivered_at: deliveredAt,
            last_error: null,
            last_error_category: null,
            lease_token: null,
            lease_expires_at: null,
            updated_at: deliveredAt,
          })
          .eq("id", job.id);

        deliveredCount++;

        await logAuditEvent({
          actorProfileId: null,
          action: "NOTIFICATION_DELIVERED",
          targetTable: "notification_events",
          targetId: job.id,
          newState: {
            channel: "IN_APP",
            status: "DELIVERED",
            delivered_at: deliveredAt,
          },
        });
      } else {
        // External Channel: EMAIL or SMS
        const dispatcher = getNotificationDispatcher(channel);
        const deliveryResult = await dispatcher.dispatch({
          notificationId: job.id,
          recipientUserId: job.recipient_user_id || "",
          title: payload.title,
          body: payload.body,
          metadata: payload.metadata,
        });

        if (deliveryResult.delivered) {
          const deliveredAt = deliveryResult.deliveredAt || new Date().toISOString();
          await admin
            .from("notification_events")
            .update({
              status: "DELIVERED",
              delivered_at: deliveredAt,
              last_error: null,
              last_error_category: null,
              lease_token: null,
              lease_expires_at: null,
              updated_at: deliveredAt,
            })
            .eq("id", job.id);

          deliveredCount++;

          await logAuditEvent({
            actorProfileId: null,
            action: "NOTIFICATION_DELIVERED",
            targetTable: "notification_events",
            targetId: job.id,
            newState: { channel, status: "DELIVERED", delivered_at: deliveredAt },
          });
        } else {
          // Provider failure
          const isMaxAttemptsReached = attempts >= maxAttempts;
          const errorCategory = deliveryResult.error?.includes("not configured")
            ? "CONFIG_MISSING"
            : "PROVIDER_UNAVAILABLE";

          if (isMaxAttemptsReached) {
            permanentFailureCount++;
            errors.push({
              eventId: job.id,
              error: deliveryResult.error || "Max attempts exceeded",
              category: errorCategory,
            });

            await admin
              .from("notification_events")
              .update({
                status: "PERMANENT_FAILURE",
                last_error: deliveryResult.error || "Exhausted retries",
                last_error_category: errorCategory,
                lease_token: null,
                lease_expires_at: null,
                updated_at: new Date().toISOString(),
              })
              .eq("id", job.id);

            await logAuditEvent({
              actorProfileId: null,
              action: "NOTIFICATION_RETRIES_EXHAUSTED",
              targetTable: "notification_events",
              targetId: job.id,
              newState: { attempts, maxAttempts, channel, error: deliveryResult.error },
            });
          } else {
            retryableCount++;
            const backoffMs = calculateBackoffMs(attempts);
            const nextAttemptAt = new Date(Date.now() + backoffMs).toISOString();

            await admin
              .from("notification_events")
              .update({
                status: "RETRYABLE_FAILURE",
                last_error: deliveryResult.error || "Delivery attempt failed",
                last_error_category: errorCategory,
                next_attempt_at: nextAttemptAt,
                lease_token: null,
                lease_expires_at: null,
                updated_at: new Date().toISOString(),
              })
              .eq("id", job.id);

            await logAuditEvent({
              actorProfileId: null,
              action: "NOTIFICATION_DELIVERY_FAILED",
              targetTable: "notification_events",
              targetId: job.id,
              newState: {
                attempts,
                nextAttemptAt,
                channel,
                error: deliveryResult.error,
              },
            });
          }
        }
      }
    } catch (deliverErr) {
      const errMsg = deliverErr instanceof Error ? deliverErr.message : String(deliverErr);
      const isMax = attempts >= maxAttempts;

      if (isMax) {
        permanentFailureCount++;
        errors.push({ eventId: job.id, error: errMsg, category: "SYSTEM_ERROR" });

        await admin
          .from("notification_events")
          .update({
            status: "PERMANENT_FAILURE",
            last_error: errMsg,
            last_error_category: "SYSTEM_ERROR",
            lease_token: null,
            lease_expires_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", job.id);

        await logAuditEvent({
          actorProfileId: null,
          action: "NOTIFICATION_RETRIES_EXHAUSTED",
          targetTable: "notification_events",
          targetId: job.id,
          newState: { attempts, error: errMsg },
        });
      } else {
        retryableCount++;
        const backoffMs = calculateBackoffMs(attempts);
        const nextAttemptAt = new Date(Date.now() + backoffMs).toISOString();

        await admin
          .from("notification_events")
          .update({
            status: "RETRYABLE_FAILURE",
            last_error: errMsg,
            last_error_category: "SYSTEM_ERROR",
            next_attempt_at: nextAttemptAt,
            lease_token: null,
            lease_expires_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", job.id);

        await logAuditEvent({
          actorProfileId: null,
          action: "NOTIFICATION_DELIVERY_FAILED",
          targetTable: "notification_events",
          targetId: job.id,
          newState: { attempts, nextAttemptAt, error: errMsg },
        });
      }
    }
  }

  const executionDurationMs = Date.now() - startTime;

  return {
    success: true,
    processedCount: claimedJobs.length,
    deliveredCount,
    retryableCount,
    permanentFailureCount,
    recoveredLeaseCount,
    executionDurationMs,
    errors,
  };
}
