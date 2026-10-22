import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/audit";
import { ReconciliationInput, ReconciliationResult } from "./types";

const SYSTEM_RECONCILIATION_UUID = "00000000-0000-0000-0000-000000000007";

/**
 * Idempotent reconciliation process for records that expire or drift over time.
 * Reconciles:
 * 1. Expired donor commitments and matching states.
 * 2. Expired blood requisitions past deadline.
 * 3. Stale worker leases in outbox.
 * 4. Authoritative counter synchronization (units_committed and units_donated).
 *
 * Safety rules:
 * - Never expires or modifies recorded donations (RECORDED status is strictly immutable).
 * - Never silently marks records as clinically valid or safe.
 * - Repeated runs produce identical states idempotently without duplicate audit events.
 */
export async function reconcilePlatformState(
  input: ReconciliationInput = {}
): Promise<ReconciliationResult> {
  const startTime = Date.now();
  const admin = createSupabaseAdminClient();

  if (!admin) {
    return {
      success: false,
      expiredCommitmentsCount: 0,
      expiredRequestsCount: 0,
      staleLeasesRecoveredCount: 0,
      counterDiscrepanciesCorrected: 0,
      skippedCount: 0,
      executionDurationMs: 0,
      details: [{ category: "REQUEST", id: "global", action: "ERROR", reason: "Database unavailable" }],
    };
  }

  const now = new Date().toISOString();
  const details: ReconciliationResult["details"] = [];
  let expiredCommitmentsCount = 0;
  let expiredRequestsCount = 0;
  let staleLeasesRecoveredCount = 0;
  let counterDiscrepanciesCorrected = 0;
  let skippedCount = 0;

  const hasSpecificFlag =
    input.reconcileCommitments !== undefined ||
    input.reconcileRequests !== undefined ||
    input.reconcileLeases !== undefined ||
    input.reconcileCounters !== undefined;

  const doCommitments = hasSpecificFlag ? Boolean(input.reconcileCommitments) : true;
  const doRequests = hasSpecificFlag ? Boolean(input.reconcileRequests) : true;
  const doLeases = hasSpecificFlag ? Boolean(input.reconcileLeases) : true;
  const doCounters = hasSpecificFlag ? Boolean(input.reconcileCounters) : true;

  // ==========================================================================
  // 1. RECONCILE EXPIRED DONOR COMMITMENTS
  // ==========================================================================
  if (doCommitments) {
    const { data: expiredCommitments } = await admin
      .from("donor_commitments")
      .select("id, request_id, match_id, status, expires_at")
      .in("status", ["PENDING", "ACCEPTED"])
      .not("expires_at", "is", null)
      .lte("expires_at", now);

    if (expiredCommitments && expiredCommitments.length > 0) {
      for (const commit of expiredCommitments) {
        // Double check there is no active RECORDED donation for this commitment
        const { data: activeDonation } = await admin
          .from("donations")
          .select("id, status")
          .eq("commitment_id", commit.id)
          .eq("status", "RECORDED")
          .maybeSingle();

        if (activeDonation) {
          // Safety invariant: NEVER expire a commitment with a RECORDED donation
          skippedCount++;
          details.push({
            category: "COMMITMENT",
            id: commit.id,
            action: "SKIPPED",
            reason: "Commitment has verified RECORDED donation; expiration prohibited.",
          });
          continue;
        }

        // Expire commitment
        const { error: commitErr } = await admin
          .from("donor_commitments")
          .update({
            status: "EXPIRED",
            cancellation_reason: "Operational commitment deadline expired without attendance.",
            updated_at: now,
          })
          .eq("id", commit.id)
          .in("status", ["PENDING", "ACCEPTED"]); // Idempotency check

        if (!commitErr) {
          expiredCommitmentsCount++;
          details.push({
            category: "COMMITMENT",
            id: commit.id,
            action: "EXPIRED",
            reason: `Commitment expired past deadline ${commit.expires_at}`,
          });

          // Also expire associated match if it was ACCEPTED or NOTIFIED
          if (commit.match_id) {
            await admin
              .from("request_matches")
              .update({
                status: "EXPIRED",
                updated_at: now,
              })
              .eq("id", commit.match_id)
              .in("status", ["ACCEPTED", "NOTIFIED"]);
          }

          // Reconcile parent request counters
          if (commit.request_id) {
            await admin.rpc("reconcile_request_counters", { p_request_id: commit.request_id });
          }

          await logAuditEvent({
            actorProfileId: null,
            action: "COMMITMENT_EXPIRED",
            targetTable: "donor_commitments",
            targetId: commit.id,
            previousState: { status: commit.status },
            newState: { status: "EXPIRED" },
          });
        }
      }
    }
  }

  // ==========================================================================
  // 2. RECONCILE EXPIRED BLOOD REQUISITIONS
  // ==========================================================================
  if (doRequests) {
    const activeStatuses = [
      "ACTIVE",
      "PARTIALLY_COMMITTED",
      "FULLY_COMMITTED",
      "PARTIALLY_FULFILLED",
    ];

    const { data: overdueRequests } = await admin
      .from("blood_requests")
      .select("id, status, required_by, units_requested, units_donated")
      .in("status", activeStatuses)
      .not("required_by", "is", null)
      .lte("required_by", now);

    if (overdueRequests && overdueRequests.length > 0) {
      for (const req of overdueRequests) {
        // If units_donated >= units_requested, it is FULFILLED, not EXPIRED
        if ((req.units_donated || 0) >= req.units_requested) {
          await admin
            .from("blood_requests")
            .update({ status: "FULFILLED", updated_at: now })
            .eq("id", req.id);

          details.push({
            category: "REQUEST",
            id: req.id,
            action: "FULFILLED",
            reason: "Required deadline passed but requested quota was fully donated.",
          });
          continue;
        }

        // Transition to EXPIRED
        const { error: reqErr } = await admin
          .from("blood_requests")
          .update({
            status: "EXPIRED",
            cancellation_reason: "Operational required-by date elapsed.",
            updated_at: now,
          })
          .eq("id", req.id)
          .in("status", activeStatuses); // Terminal state protection

        if (!reqErr) {
          expiredRequestsCount++;
          details.push({
            category: "REQUEST",
            id: req.id,
            action: "EXPIRED",
            reason: `Requisition deadline elapsed (${req.required_by})`,
          });

          await logAuditEvent({
            actorProfileId: null,
            action: "REQUEST_EXPIRED",
            targetTable: "blood_requests",
            targetId: req.id,
            previousState: { status: req.status },
            newState: { status: "EXPIRED" },
          });
        }
      }
    }
  }

  // ==========================================================================
  // 3. RECONCILE STALE OUTBOX WORKER LEASES
  // ==========================================================================
  if (doLeases) {
    const { data: staleJobs } = await admin
      .from("notification_events")
      .select("id, status, lease_token, lease_expires_at, attempt_count, retry_count")
      .eq("status", "PROCESSING")
      .not("lease_expires_at", "is", null)
      .lte("lease_expires_at", now);

    if (staleJobs && staleJobs.length > 0) {
      for (const job of staleJobs) {
        const { error: leaseErr } = await admin
          .from("notification_events")
          .update({
            status: "RETRYABLE_FAILURE",
            lease_token: null,
            lease_expires_at: null,
            last_error: "Worker lease expired without delivery confirmation. Recovered for retry.",
            last_error_category: "LEASE_TIMEOUT",
            next_attempt_at: now,
            updated_at: now,
          })
          .eq("id", job.id)
          .eq("status", "PROCESSING");

        if (!leaseErr) {
          staleLeasesRecoveredCount++;
          details.push({
            category: "LEASE",
            id: job.id,
            action: "RECOVERED",
            reason: `Lease expired at ${job.lease_expires_at}`,
          });

          await logAuditEvent({
            actorProfileId: null,
            action: "STALE_LEASE_RECOVERED",
            targetTable: "notification_events",
            targetId: job.id,
            newState: { status: "RETRYABLE_FAILURE", category: "LEASE_TIMEOUT" },
          });
        }
      }
    }
  }

  // ==========================================================================
  // 4. RECONCILE AUTHORITATIVE COUNTERS (units_committed and units_donated)
  // ==========================================================================
  if (doCounters) {
    const { data: candidateRequests } = await admin
      .from("blood_requests")
      .select("id, status, units_requested, units_committed, units_donated")
      .neq("status", "CANCELLED")
      .neq("status", "REJECTED");

    if (candidateRequests && candidateRequests.length > 0) {
      for (const req of candidateRequests) {
        let discrepancyFound = false;
        let prevCommitted = req.units_committed;
        let newCommitted = req.units_committed;
        let prevDonated = req.units_donated;
        let newDonated = req.units_donated;
        let prevStatus = req.status;
        let newStatus = req.status;

        // Attempt atomic RPC discrepancy correction
        const { data: rpcRes, error: rpcErr } = await admin.rpc("reconcile_request_counters", {
          p_request_id: req.id,
        });

        if (!rpcErr && rpcRes && typeof rpcRes === "object") {
          const resObj = rpcRes as Record<string, unknown>;
          discrepancyFound = Boolean(resObj.discrepancyFound || resObj.previousStatus !== resObj.newStatus);
          prevCommitted = Number(resObj.previousCommitted);
          newCommitted = Number(resObj.newCommitted);
          prevDonated = Number(resObj.previousDonated);
          newDonated = Number(resObj.newDonated);
          prevStatus = String(resObj.previousStatus);
          newStatus = String(resObj.newStatus);
        } else {
          // Fallback manual count calculation
          const { count: realCommitted } = await admin
            .from("donor_commitments")
            .select("*", { count: "exact", head: true })
            .eq("request_id", req.id)
            .in("status", ["ACCEPTED", "SCHEDULED", "CHECKED_IN"]);

          const { data: realDonations } = await admin
            .from("donations")
            .select("units_donated")
            .eq("request_id", req.id)
            .eq("status", "RECORDED");

          const realDonated = (realDonations || []).reduce((acc, d) => acc + (d.units_donated || 0), 0);
          newCommitted = realCommitted || 0;
          newDonated = realDonated;

          if (req.units_committed !== newCommitted || req.units_donated !== newDonated) {
            discrepancyFound = true;
          }

          if (newDonated >= req.units_requested && !["CANCELLED", "EXPIRED", "REJECTED"].includes(req.status)) {
            newStatus = "FULFILLED";
          }

          if (discrepancyFound || newStatus !== prevStatus) {
            await admin
              .from("blood_requests")
              .update({
                units_committed: newCommitted,
                units_donated: newDonated,
                status: newStatus,
                updated_at: now,
              })
              .eq("id", req.id);
          }
        }

        if (discrepancyFound || newStatus !== prevStatus) {
          counterDiscrepanciesCorrected++;
          details.push({
            category: "COUNTER",
            id: req.id,
            action: "CORRECTED",
            reason: `Discrepancy reconciled: Committed ${prevCommitted} -> ${newCommitted}, Donated ${prevDonated} -> ${newDonated}, Status ${prevStatus} -> ${newStatus}`,
          });

          await logAuditEvent({
            actorProfileId: null,
            action: "COUNTER_DISCREPANCY_CORRECTED",
            targetTable: "blood_requests",
            targetId: req.id,
            previousState: {
              units_committed: prevCommitted,
              units_donated: prevDonated,
              status: prevStatus,
            },
            newState: {
              units_committed: newCommitted,
              units_donated: newDonated,
              status: newStatus,
            },
          });
        }
      }
    }
  }

  const executionDurationMs = Date.now() - startTime;

  // Log overall reconciliation audit event
  await logAuditEvent({
    actorProfileId: null,
    action: "EXPIRATION_RECONCILIATION_EXECUTED",
    targetTable: "blood_requests",
    targetId: SYSTEM_RECONCILIATION_UUID,
    newState: {
      expiredCommitmentsCount,
      expiredRequestsCount,
      staleLeasesRecoveredCount,
      counterDiscrepanciesCorrected,
      skippedCount,
      executionDurationMs,
    },
  });

  return {
    success: true,
    expiredCommitmentsCount,
    expiredRequestsCount,
    staleLeasesRecoveredCount,
    counterDiscrepanciesCorrected,
    skippedCount,
    executionDurationMs,
    details,
  };
}
