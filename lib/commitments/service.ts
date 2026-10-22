import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type {
  BloodRequest,
  RequestMatch,
  UserRole,
} from "@/lib/supabase/types";
import { logAuditEvent } from "@/lib/audit";
import { enqueueNotificationEvent } from "@/lib/outbox/service";
import { generateSafeDonorCode } from "@/lib/matching/rules";
import {
  SubmitDonorResponseInput,
  SubmitDonorResponseResult,
  WithdrawCommitmentInput,
  WithdrawCommitmentResult,
  DonorCommitmentRecord,
  FormattedDonorCommitment,
  isValidResponseTransition,
  isValidCommitmentTransition,
} from "./types";

const PRIVILEGED_ROLES: UserRole[] = [
  "MODERATOR",
  "ADMIN",
  "SUPER_ADMIN",
  "HOSPITAL_STAFF",
];

export function formatCommitmentRecord(
  record: DonorCommitmentRecord
): FormattedDonorCommitment {
  const safeCode = record.donor_profile_id
    ? generateSafeDonorCode(record.donor_profile_id)
    : generateSafeDonorCode(record.donor_id);

  return {
    id: record.id,
    requestId: record.request_id,
    matchId: record.match_id || null,
    donorId: record.donor_id,
    donorProfileId: record.donor_profile_id || null,
    safeDonorCode: safeCode,
    response: record.response || "INTERESTED",
    status: record.status,
    respondedAt: record.responded_at || null,
    committedAt: record.committed_at,
    withdrawnAt: record.withdrawn_at || null,
    expiresAt: record.expires_at || null,
    cancellationReason: record.cancellation_reason || null,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

/**
 * Submits an operational donor response (INTERESTED or DECLINED) to a blood request notification.
 * If INTERESTED, creates a controlled commitment.
 * If DECLINED, updates match state without creating a commitment.
 */
export async function submitDonorResponse(
  input: SubmitDonorResponseInput
): Promise<SubmitDonorResponseResult> {
  const admin = createSupabaseAdminClient();
  if (!admin) {
    return {
      success: false,
      response: "NOT_RESPONDED",
      matchStatus: "UNKNOWN",
      error: "Database configuration unavailable.",
    };
  }

  const { notificationId, matchId, requestId, response, clerkUserId, reason } = input;

  // 1. Authenticate caller and load caller profile
  if (!clerkUserId) {
    return {
      success: false,
      response: "NOT_RESPONDED",
      matchStatus: "UNKNOWN",
      error: "UNAUTHORIZED: Authentication required to respond to blood requests.",
    };
  }

  const { data: callerProfile, error: profileErr } = await admin
    .from("profiles")
    .select("*")
    .eq("clerk_user_id", clerkUserId)
    .single();

  if (profileErr || !callerProfile) {
    return {
      success: false,
      response: "NOT_RESPONDED",
      matchStatus: "UNKNOWN",
      error: "UNAUTHORIZED: Caller user profile not found.",
    };
  }

  // 2. Load donor profile
  const { data: donorProfile, error: donorErr } = await admin
    .from("donor_profiles")
    .select("*")
    .eq("profile_id", callerProfile.id)
    .single();

  if (donorErr || !donorProfile) {
    return {
      success: false,
      response: "NOT_RESPONDED",
      matchStatus: "UNKNOWN",
      error: "UNAUTHORIZED: Registered donor profile required to respond to blood requests.",
    };
  }

  // 3. Resolve notification and match context
  let resolvedRequestId = requestId;
  let resolvedMatchId = matchId;

  if (notificationId) {
    const { data: notif, error: notifErr } = await admin
      .from("notifications")
      .select("*")
      .eq("id", notificationId)
      .single();

    if (notifErr || !notif) {
      return {
        success: false,
        response: "NOT_RESPONDED",
        matchStatus: "UNKNOWN",
        error: "Notification record not found.",
      };
    }

    // Verify notification belongs to caller
    const isRecipient =
      notif.recipient_user_id === clerkUserId ||
      notif.recipient_user_id === callerProfile.id;

    if (!isRecipient) {
      return {
        success: false,
        response: "NOT_RESPONDED",
        matchStatus: "UNKNOWN",
        error: "UNAUTHORIZED: You cannot respond to another donor's notification.",
      };
    }

    resolvedRequestId = resolvedRequestId || notif.request_id;
    resolvedMatchId = resolvedMatchId || notif.match_id;
  }

  if (!resolvedRequestId && resolvedMatchId) {
    const { data: m } = await admin
      .from("request_matches")
      .select("request_id")
      .eq("id", resolvedMatchId)
      .single();
    if (m) resolvedRequestId = m.request_id;
  }

  if (!resolvedRequestId) {
    return {
      success: false,
      response: "NOT_RESPONDED",
      matchStatus: "UNKNOWN",
      error: "Requisition identifier could not be determined.",
    };
  }

  // 4. Fetch and verify Blood Request
  const { data: reqRecord, error: reqErr } = await admin
    .from("blood_requests")
    .select("*")
    .eq("id", resolvedRequestId)
    .single();

  if (reqErr || !reqRecord) {
    return {
      success: false,
      response: "NOT_RESPONDED",
      matchStatus: "UNKNOWN",
      error: "Blood requisition not found.",
    };
  }

  const req = reqRecord as BloodRequest;

  // Strict Request Lifecycle Gate: ONLY ACTIVE requests can receive responses/commitments
  if (req.status !== "ACTIVE") {
    return {
      success: false,
      response: "NOT_RESPONDED",
      matchStatus: "UNKNOWN",
      error: `Requisition is in status '${req.status}' and not eligible for donor response. Only ACTIVE requests can receive donor commitments.`,
    };
  }

  // 5. Fetch and verify Match Record
  let match: RequestMatch | null = null;
  if (resolvedMatchId) {
    const { data: mRecord } = await admin
      .from("request_matches")
      .select("*")
      .eq("id", resolvedMatchId)
      .single();
    if (mRecord) match = mRecord as RequestMatch;
  } else {
    const { data: mRecord } = await admin
      .from("request_matches")
      .select("*")
      .eq("request_id", req.id)
      .eq("donor_id", donorProfile.id)
      .single();
    if (mRecord) match = mRecord as RequestMatch;
  }

  if (!match) {
    return {
      success: false,
      response: "NOT_RESPONDED",
      matchStatus: "UNKNOWN",
      error: "Potential donor match record not found for this requisition.",
    };
  }

  // Verify match belongs to this donor and this request
  if (match.donor_id !== donorProfile.id) {
    return {
      success: false,
      response: "NOT_RESPONDED",
      matchStatus: match.status,
      error: "UNAUTHORIZED: Match record does not belong to your donor profile.",
    };
  }

  if (match.request_id !== req.id) {
    return {
      success: false,
      response: "NOT_RESPONDED",
      matchStatus: match.status,
      error: "Match record does not belong to the specified blood requisition.",
    };
  }

  // 6. Check existing commitment for duplicate prevention & idempotency
  const { data: existingCommitments } = await admin
    .from("donor_commitments")
    .select("*")
    .eq("request_id", req.id)
    .eq("donor_id", callerProfile.id);

  const activeCommitment = (existingCommitments || []).find(
    (c) => c.status === "PENDING" || c.status === "ACCEPTED"
  );

  const withdrawnCommitment = (existingCommitments || []).find(
    (c) => c.status === "WITHDRAWN"
  );

  // If already committed actively
  if (activeCommitment) {
    if (response === "INTERESTED") {
      return {
        success: true,
        response: "INTERESTED",
        alreadyResponded: true,
        matchStatus: match.status,
        commitment: formatCommitmentRecord(activeCommitment as DonorCommitmentRecord),
      };
    } else {
      return {
        success: false,
        response: "INTERESTED",
        matchStatus: match.status,
        error: "An active commitment already exists for this requisition. Please withdraw your commitment if you can no longer participate.",
      };
    }
  }

  // If donor previously withdrew, prevent immediate re-commitment to protect coordination consistency
  if (withdrawnCommitment && response === "INTERESTED") {
    return {
      success: false,
      response: "DECLINED",
      matchStatus: match.status,
      error: "You have previously withdrawn your commitment for this requisition. Immediate re-commitment is restricted to preserve hospital coordination integrity.",
    };
  }

  // If match is already DECLINED
  if (match.status === "DECLINED") {
    if (response === "DECLINED") {
      return {
        success: true,
        response: "DECLINED",
        alreadyResponded: true,
        matchStatus: "DECLINED",
      };
    } else {
      return {
        success: false,
        response: "DECLINED",
        matchStatus: "DECLINED",
        error: "This potential match was already declined and cannot be newly accepted.",
      };
    }
  }

  const now = new Date().toISOString();

  // --------------------------------------------------------------------------
  // PATH A: DONOR DECLINES (NO COMMITMENT RECORD CREATED)
  // --------------------------------------------------------------------------
  if (response === "DECLINED") {
    // Validate transition
    if (!isValidResponseTransition("NOT_RESPONDED", "DECLINED")) {
      return {
        success: false,
        response: "NOT_RESPONDED",
        matchStatus: match.status,
        error: "Invalid response state transition to DECLINED.",
      };
    }

    // Update match status to DECLINED
    await admin
      .from("request_matches")
      .update({
        status: "DECLINED",
        updated_at: now,
      })
      .eq("id", match.id);

    // If notification exists, record read state
    if (notificationId) {
      await admin
        .from("notifications")
        .update({
          status: "READ",
          read_at: now,
          updated_at: now,
        })
        .eq("id", notificationId)
        .eq("status", "DELIVERED");
    }

    // Audit logs
    await logAuditEvent({
      actorProfileId: callerProfile.id,
      action: "DONOR_RESPONSE_SUBMITTED",
      targetTable: "request_matches",
      targetId: match.id,
      newState: {
        response: "DECLINED",
        request_id: req.id,
        match_id: match.id,
        reason: reason || null,
      },
    });

    await logAuditEvent({
      actorProfileId: callerProfile.id,
      action: "MATCH_STATUS_CHANGED",
      targetTable: "request_matches",
      targetId: match.id,
      previousState: { status: match.status },
      newState: { status: "DECLINED" },
    });

    return {
      success: true,
      response: "DECLINED",
      alreadyResponded: false,
      matchStatus: "DECLINED",
    };
  }

  // --------------------------------------------------------------------------
  // PATH B: DONOR IS INTERESTED (CREATE CONTROLLED COMMITMENT)
  // --------------------------------------------------------------------------
  if (response === "INTERESTED") {
    // Validate donor availability and consent
    if (!donorProfile.is_available) {
      return {
        success: false,
        response: "NOT_RESPONDED",
        matchStatus: match.status,
        error: "Donor is currently marked as unavailable for donations.",
      };
    }

    if (!donorProfile.consent_to_contact) {
      return {
        success: false,
        response: "NOT_RESPONDED",
        matchStatus: match.status,
        error: "Donor has not provided consent to participate in blood donation requests.",
      };
    }

    if (donorProfile.cooldown_until && new Date(donorProfile.cooldown_until) > new Date()) {
      return {
        success: false,
        response: "NOT_RESPONDED",
        matchStatus: match.status,
        error: `Donor is currently within clinical recovery cooldown until ${donorProfile.cooldown_until}.`,
      };
    }

    // Insert commitment record into public.donor_commitments
    const expiresAt = new Date(Date.now() + 4 * 3600 * 1000).toISOString();

    const { data: newCommitment, error: commitErr } = await admin
      .from("donor_commitments")
      .insert({
        request_id: req.id,
        match_id: match.id,
        donor_id: callerProfile.id,
        donor_profile_id: donorProfile.id,
        response: "INTERESTED",
        status: "ACCEPTED",
        committed_at: now,
        responded_at: now,
        expires_at: expiresAt,
        notes: reason || null,
        created_at: now,
        updated_at: now,
      })
      .select("*")
      .single();

    // Concurrency race condition handling: if unique violation occurred
    if (commitErr) {
      if (commitErr.code === "23505") {
        // Fetch winning commitment
        const { data: winningCommitment } = await admin
          .from("donor_commitments")
          .select("*")
          .eq("request_id", req.id)
          .eq("donor_id", callerProfile.id)
          .single();

        if (winningCommitment) {
          return {
            success: true,
            response: "INTERESTED",
            alreadyResponded: true,
            matchStatus: "ACCEPTED",
            commitment: formatCommitmentRecord(winningCommitment as DonorCommitmentRecord),
          };
        }
      }

      return {
        success: false,
        response: "NOT_RESPONDED",
        matchStatus: match.status,
        error: commitErr.message || "Failed to create donor commitment record.",
      };
    }

    // Update match status to ACCEPTED
    await admin
      .from("request_matches")
      .update({
        status: "ACCEPTED",
        updated_at: now,
      })
      .eq("id", match.id);

    // Update blood_requests units_committed
    if (req.units_committed < req.units_requested) {
      await admin
        .from("blood_requests")
        .update({
          units_committed: req.units_committed + 1,
          updated_at: now,
        })
        .eq("id", req.id);
    }

    // If notification exists, link commitment and mark read
    if (notificationId) {
      await admin
        .from("notifications")
        .update({
          commitment_id: newCommitment.id,
          status: "READ",
          read_at: now,
          updated_at: now,
        })
        .eq("id", notificationId);
    }

    // Audit logs
    await logAuditEvent({
      actorProfileId: callerProfile.id,
      action: "DONOR_RESPONSE_SUBMITTED",
      targetTable: "request_matches",
      targetId: match.id,
      newState: {
        response: "INTERESTED",
        request_id: req.id,
        match_id: match.id,
        commitment_id: newCommitment.id,
      },
    });

    await logAuditEvent({
      actorProfileId: callerProfile.id,
      action: "DONOR_COMMITMENT_CREATED",
      targetTable: "donor_commitments",
      targetId: newCommitment.id,
      newState: {
        request_id: req.id,
        donor_id: callerProfile.id,
        status: newCommitment.status,
      },
    });

    await logAuditEvent({
      actorProfileId: callerProfile.id,
      action: "MATCH_STATUS_CHANGED",
      targetTable: "request_matches",
      targetId: match.id,
      previousState: { status: match.status },
      newState: { status: "ACCEPTED" },
    });

    // Enqueue outbox notification for blood requisition owner
    if (req.requester_id) {
      await enqueueNotificationEvent({
        eventType: "DONOR_INTEREST_RECEIVED",
        recipientUserId: req.requester_id,
        channel: "IN_APP",
        payload: {
          requestId: req.id,
          matchId: match.id,
          commitmentId: newCommitment.id,
          title: "Donor Response Received",
          body: `A potential donor expressed willingness to donate for requisition at ${req.hospital_name}.`,
        },
        idempotencyKey: `outbox:commit:${newCommitment.id}:interested`,
      });
    }

    return {
      success: true,
      response: "INTERESTED",
      alreadyResponded: false,
      matchStatus: "ACCEPTED",
      commitment: formatCommitmentRecord(newCommitment as DonorCommitmentRecord),
    };
  }

  return {
    success: false,
    response: "NOT_RESPONDED",
    matchStatus: match.status,
    error: `Unsupported response type: ${response}`,
  };
}

/**
 * Withdraws an active donor commitment.
 * Enforces ownership, withdrawable status, and updates request/match synchronization.
 */
export async function withdrawDonorCommitment(
  input: WithdrawCommitmentInput
): Promise<WithdrawCommitmentResult> {
  const admin = createSupabaseAdminClient();
  if (!admin) {
    return { success: false, error: "Database configuration unavailable." };
  }

  const { commitmentId, clerkUserId, reason } = input;

  if (!clerkUserId) {
    return { success: false, error: "UNAUTHORIZED: Authentication required to withdraw commitment." };
  }

  // 1. Authenticate caller
  const { data: callerProfile, error: profileErr } = await admin
    .from("profiles")
    .select("*")
    .eq("clerk_user_id", clerkUserId)
    .single();

  if (profileErr || !callerProfile) {
    return { success: false, error: "UNAUTHORIZED: Caller user profile not found." };
  }

  // 2. Fetch commitment record
  const { data: commitmentRecord, error: commitErr } = await admin
    .from("donor_commitments")
    .select("*")
    .eq("id", commitmentId)
    .single();

  if (commitErr || !commitmentRecord) {
    return { success: false, error: "Commitment record not found." };
  }

  const commitment = commitmentRecord as DonorCommitmentRecord;

  // 3. Verify ownership: only the committing donor or authorized staff can withdraw
  const isOwner = commitment.donor_id === callerProfile.id;
  const isStaff = PRIVILEGED_ROLES.includes(callerProfile.role);

  if (!isOwner && !isStaff) {
    return {
      success: false,
      error: "UNAUTHORIZED: You cannot withdraw another donor's commitment.",
    };
  }

  // 4. Verify withdrawable status
  if (commitment.status === "WITHDRAWN") {
    return {
      success: true,
      commitment: formatCommitmentRecord(commitment),
    };
  }

  if (!isValidCommitmentTransition(commitment.status, "WITHDRAWN")) {
    return {
      success: false,
      error: `Commitment is in status '${commitment.status}' and cannot be withdrawn.`,
    };
  }

  const now = new Date().toISOString();

  // 5. Update commitment to WITHDRAWN
  const { data: updatedCommitment, error: updateErr } = await admin
    .from("donor_commitments")
    .update({
      status: "WITHDRAWN",
      withdrawn_at: now,
      cancellation_reason: reason || "Donor voluntary withdrawal",
      updated_at: now,
    })
    .eq("id", commitment.id)
    .select("*")
    .single();

  if (updateErr || !updatedCommitment) {
    return {
      success: false,
      error: updateErr?.message || "Failed to update commitment to WITHDRAWN.",
    };
  }

  // 6. Update match status if linked
  if (commitment.match_id) {
    await admin
      .from("request_matches")
      .update({
        status: "WITHDRAWN",
        updated_at: now,
      })
      .eq("id", commitment.match_id);
  }

  // 7. Decrement units_committed on blood_requests if appropriate
  const { data: req } = await admin
    .from("blood_requests")
    .select("requester_id, hospital_name, units_committed")
    .eq("id", commitment.request_id)
    .single();

  if (req && req.units_committed > 0) {
    await admin
      .from("blood_requests")
      .update({
        units_committed: req.units_committed - 1,
        updated_at: now,
      })
      .eq("id", commitment.request_id);
  }

  // 8. Audit log events
  await logAuditEvent({
    actorProfileId: callerProfile.id,
    action: "DONOR_COMMITMENT_WITHDRAWN",
    targetTable: "donor_commitments",
    targetId: commitment.id,
    newState: {
      request_id: commitment.request_id,
      reason: reason || "Donor voluntary withdrawal",
    },
  });

  await logAuditEvent({
    actorProfileId: callerProfile.id,
    action: "DONOR_COMMITMENT_STATUS_CHANGED",
    targetTable: "donor_commitments",
    targetId: commitment.id,
    previousState: { status: commitment.status },
    newState: { status: "WITHDRAWN" },
  });

  // Enqueue outbox notification for blood requisition owner
  if (req?.requester_id) {
    await enqueueNotificationEvent({
      eventType: "COMMITMENT_CANCELLED",
      recipientUserId: req.requester_id,
      channel: "IN_APP",
      payload: {
        requestId: commitment.request_id,
        commitmentId: commitment.id,
        title: "Donor Withdrew Commitment",
        body: `A donor has withdrawn their commitment for requisition at ${req.hospital_name || "the hospital"}.`,
      },
      idempotencyKey: `outbox:commit:${commitment.id}:withdrawn`,
    });
  }

  return {
    success: true,
    commitment: formatCommitmentRecord(updatedCommitment as DonorCommitmentRecord),
  };
}

/**
 * Retrieves donor commitments for an authorized requester or hospital staff.
 * Preserves strict donor privacy (safe pseudonym only, zero PII).
 */
export async function getRequestCommitments(
  requestId: string,
  clerkUserId: string
): Promise<{ success: boolean; commitments: FormattedDonorCommitment[]; error?: string }> {
  const admin = createSupabaseAdminClient();
  if (!admin || !clerkUserId) {
    return { success: false, commitments: [], error: "UNAUTHORIZED: Authentication required." };
  }

  const { data: callerProfile } = await admin
    .from("profiles")
    .select("*")
    .eq("clerk_user_id", clerkUserId)
    .single();

  if (!callerProfile) {
    return { success: false, commitments: [], error: "UNAUTHORIZED: Caller profile not found." };
  }

  const { data: req } = await admin
    .from("blood_requests")
    .select("requester_id")
    .eq("id", requestId)
    .single();

  if (!req) {
    return { success: false, commitments: [], error: "Blood requisition not found." };
  }

  const isOwner = req.requester_id === callerProfile.id;
  const isPrivileged = PRIVILEGED_ROLES.includes(callerProfile.role);

  if (!isOwner && !isPrivileged) {
    return {
      success: false,
      commitments: [],
      error: "UNAUTHORIZED: You do not have permission to view commitments for this requisition.",
    };
  }

  const { data, error } = await admin
    .from("donor_commitments")
    .select("*")
    .eq("request_id", requestId)
    .order("committed_at", { ascending: false });

  if (error || !data) {
    return { success: false, commitments: [], error: error?.message || "Failed to load commitments." };
  }

  return {
    success: true,
    commitments: data.map((c) => formatCommitmentRecord(c as DonorCommitmentRecord)),
  };
}

/**
 * Retrieves all active commitments for the current donor.
 */
export async function getDonorCommitments(
  clerkUserId: string
): Promise<FormattedDonorCommitment[]> {
  const admin = createSupabaseAdminClient();
  if (!admin || !clerkUserId) return [];

  const { data: callerProfile } = await admin
    .from("profiles")
    .select("id")
    .eq("clerk_user_id", clerkUserId)
    .single();

  if (!callerProfile) return [];

  const { data, error } = await admin
    .from("donor_commitments")
    .select("*")
    .eq("donor_id", callerProfile.id)
    .order("committed_at", { ascending: false });

  if (error || !data) return [];

  return data.map((c) => formatCommitmentRecord(c as DonorCommitmentRecord));
}
