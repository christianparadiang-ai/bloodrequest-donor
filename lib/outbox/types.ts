import { z } from "zod";

export type OutboxEventStatus =
  | "PENDING"
  | "PROCESSING"
  | "DELIVERED"
  | "COMPLETED"
  | "RETRYABLE_FAILURE"
  | "PERMANENT_FAILURE"
  | "FAILED";

export type OutboxChannel = "IN_APP" | "EMAIL" | "SMS";

export type OutboxErrorCategory =
  | "PROVIDER_UNAVAILABLE"
  | "RATE_LIMITED"
  | "MALFORMED_PAYLOAD"
  | "INVALID_RECIPIENT"
  | "LEASE_TIMEOUT"
  | "NETWORK_ERROR"
  | "CONFIG_MISSING"
  | "SYSTEM_ERROR";

export const OUTBOX_NON_CLINICAL_DISCLAIMER =
  "Outbox notification and operational delivery coordination only. Life Drop does NOT determine medical eligibility, clinical suitability, donor safety, or blood product clearance. All transfusion and donation suitability is strictly determined on-site by certified healthcare professionals.";

export const OutboxPayloadSchema = z.object({
  requestId: z.string().uuid().optional(),
  matchId: z.string().uuid().optional(),
  commitmentId: z.string().uuid().optional(),
  donationId: z.string().uuid().optional(),
  title: z.string().min(1).max(255),
  body: z.string().min(1).max(2000),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type OutboxPayload = z.infer<typeof OutboxPayloadSchema>;

export const EnqueueOutboxInputSchema = z.object({
  eventType: z.string().min(1),
  recipientUserId: z.string().min(1),
  channel: z.enum(["IN_APP", "EMAIL", "SMS"]).default("IN_APP"),
  payload: OutboxPayloadSchema,
  idempotencyKey: z.string().optional(),
});

export type EnqueueOutboxInput = z.infer<typeof EnqueueOutboxInputSchema>;

export interface OutboxEventRecord {
  id: string;
  event_type: string;
  payload: OutboxPayload;
  status: OutboxEventStatus;
  retry_count: number;
  attempt_count: number;
  last_error?: string | null;
  last_error_category?: OutboxErrorCategory | null;
  next_attempt_at?: string | null;
  lease_token?: string | null;
  lease_expires_at?: string | null;
  delivered_at?: string | null;
  idempotency_key?: string | null;
  recipient_user_id?: string | null;
  channel: OutboxChannel;
  created_at: string;
  processed_at?: string | null;
  updated_at: string;
}

export interface FormattedOutboxEvent {
  id: string;
  eventType: string;
  recipientUserId: string;
  channel: OutboxChannel;
  status: OutboxEventStatus;
  attemptCount: number;
  nextAttemptAt?: string | null;
  lastError?: string | null;
  lastErrorCategory?: string | null;
  deliveredAt?: string | null;
  idempotencyKey?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProcessOutboxBatchInput {
  batchSize?: number;
  leaseSeconds?: number;
  workerId?: string;
  maxAttempts?: number;
}

export interface ProcessOutboxBatchResult {
  success: boolean;
  processedCount: number;
  deliveredCount: number;
  retryableCount: number;
  permanentFailureCount: number;
  recoveredLeaseCount: number;
  executionDurationMs: number;
  errors: Array<{ eventId: string; error: string; category: string }>;
}

export interface ReconciliationInput {
  dryRun?: boolean;
  reconcileCommitments?: boolean;
  reconcileRequests?: boolean;
  reconcileLeases?: boolean;
  reconcileCounters?: boolean;
}

export interface ReconciliationResult {
  success: boolean;
  expiredCommitmentsCount: number;
  expiredRequestsCount: number;
  staleLeasesRecoveredCount: number;
  counterDiscrepanciesCorrected: number;
  skippedCount: number;
  executionDurationMs: number;
  details: Array<{
    category: "COMMITMENT" | "REQUEST" | "LEASE" | "COUNTER";
    id: string;
    action: string;
    reason: string;
  }>;
}

export interface OutboxMetrics {
  pendingCount: number;
  processingCount: number;
  deliveredCount: number;
  retryableCount: number;
  permanentFailureCount: number;
  totalEventsCount: number;
  lastWorkerRunAt?: string | null;
  lastReconciliationRunAt?: string | null;
}
