import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type AuditActionType =
  | "DONOR_PROFILE_CREATED"
  | "DONOR_PROFILE_UPDATED"
  | "DONOR_AVAILABILITY_CHANGED"
  | "DONOR_CONTACT_CONSENT_CHANGED"
  | "BLOOD_REQUEST_CREATED"
  | "BLOOD_REQUEST_UPDATED"
  | "BLOOD_REQUEST_SUBMITTED"
  | "BLOOD_REQUEST_STATUS_CHANGED"
  | "BLOOD_REQUEST_CANCELLED"
  | "BLOOD_REQUEST_REVIEWED"
  | "POTENTIAL_MATCH_DISCOVERY_STARTED"
  | "POTENTIAL_MATCHES_DISCOVERED"
  | "NOTIFICATION_DISPATCH_REQUESTED"
  | "NOTIFICATION_CREATED"
  | "NOTIFICATION_SENT"
  | "NOTIFICATION_FAILED"
  | "NOTIFICATION_READ"
  | "MATCH_STATUS_CHANGED"
  | "DONOR_RESPONSE_SUBMITTED"
  | "DONOR_COMMITMENT_CREATED"
  | "DONOR_COMMITMENT_WITHDRAWN"
  | "DONOR_COMMITMENT_STATUS_CHANGED"
  | "DONATION_SCHEDULED"
  | "DONATION_ATTENDED"
  | "DONATION_RECORDED"
  | "DONATION_CANCELLED"
  | "DONATION_NO_SHOW"
  | "FULFILLMENT_PROGRESS_UPDATED"
  | "REQUEST_FULFILLED"
  | "NOTIFICATION_OUTBOX_ENQUEUED"
  | "NOTIFICATION_DELIVERED"
  | "NOTIFICATION_DELIVERY_FAILED"
  | "NOTIFICATION_RETRIES_EXHAUSTED"
  | "EXPIRATION_RECONCILIATION_EXECUTED"
  | "COMMITMENT_EXPIRED"
  | "REQUEST_EXPIRED"
  | "STALE_LEASE_RECOVERED"
  | "COUNTER_DISCREPANCY_CORRECTED"
  | "RECONCILIATION_SKIPPED"
  | string;

export interface LogAuditParams {
  actorProfileId: string | null;
  action: AuditActionType;
  targetTable: string;
  targetId: string;
  previousState?: Record<string, unknown> | null;
  newState?: Record<string, unknown> | null;
}

/**
 * Appends an immutable audit log entry into public.audit_logs.
 * Runs with admin privilege to guarantee append-only integrity.
 */
export async function logAuditEvent({
  actorProfileId,
  action,
  targetTable,
  targetId,
  previousState = null,
  newState = null,
}: LogAuditParams): Promise<boolean> {
  try {
    const admin = createSupabaseAdminClient();
    if (!admin) {
      console.warn("Audit log skipped: Supabase admin client not configured.");
      return false;
    }

    const { error } = await admin.from("audit_logs").insert({
      actor_id: actorProfileId,
      action,
      target_table: targetTable,
      target_id: targetId,
      previous_state: previousState,
      new_state: newState,
    });

    if (error) {
      console.error("Failed to insert audit log entry:", error.message);
      return false;
    }

    return true;
  } catch (err: unknown) {
    console.error("Exception during audit logging:", err instanceof Error ? err.message : String(err));
    return false;
  }
}
