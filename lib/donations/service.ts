import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type {
  BloodRequest,
  UserRole,
} from "@/lib/supabase/types";
import { logAuditEvent } from "@/lib/audit";
import { enqueueNotificationEvent } from "@/lib/outbox/service";
import { generateSafeDonorCode } from "@/lib/matching/rules";
import {
  DonationRecord,
  FormattedDonation,
  RequestFulfillmentSummary,
  ScheduleDonationInput,
  MarkAttendedInput,
  RecordDonationInput,
  CancelDonationInput,
  MarkNoShowInput,
  DonationActionResult,
  isValidDonationTransition,
} from "./types";
import { awardPointsForCompletedDonation } from "./points";

const PRIVILEGED_ROLES: UserRole[] = [
  "HOSPITAL_STAFF",
  "MODERATOR",
  "ADMIN",
  "SUPER_ADMIN",
];

export function formatDonationRecord(record: DonationRecord): FormattedDonation {
  const safeDonorCode = generateSafeDonorCode(
    record.donor_profile_id || record.donor_id
  );

  return {
    id: record.id,
    requestId: record.request_id,
    commitmentId: record.commitment_id,
    donorId: record.donor_id,
    donorProfileId: record.donor_profile_id,
    donorPseudonym: safeDonorCode,
    status: record.status,
    scheduledAt: record.scheduled_at,
    attendedAt: record.attended_at,
    recordedAt: record.recorded_at,
    cancelledAt: record.cancelled_at,
    noShowAt: record.no_show_at,
    unitsDonated: record.units_donated,
    bloodGroup: record.blood_group,
    componentType: record.component_type,
    facilityName: record.facility_name,
    recordedBy: record.recorded_by,
    notes: record.notes,
    cancellationReason: record.cancellation_reason,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

// ============================================================================
// 1. SCHEDULE DONATION APPOINTMENT
// ============================================================================
export async function scheduleDonation(
  input: ScheduleDonationInput
): Promise<DonationActionResult> {
  const admin = createSupabaseAdminClient();
  if (!admin) {
    return { success: false, error: "Database configuration error." };
  }

  // 1. Authenticate caller profile
  const { data: callerProfile, error: profileErr } = await admin
    .from("profiles")
    .select("*")
    .eq("clerk_user_id", input.clerkUserId)
    .single();

  if (profileErr || !callerProfile) {
    return { success: false, error: "Authenticated profile not found." };
  }

  // 2. Fetch commitment record
  const { data: commitment, error: commitErr } = await admin
    .from("donor_commitments")
    .select("*")
    .eq("id", input.commitmentId)
    .single();

  if (commitErr || !commitment) {
    return { success: false, error: "Donor commitment record not found." };
  }

  // 3. Authorization check
  const isDonorOwner = commitment.donor_id === callerProfile.id;
  const isPrivileged = PRIVILEGED_ROLES.includes(callerProfile.role as UserRole);

  if (!isDonorOwner && !isPrivileged) {
    return {
      success: false,
      error: "UNAUTHORIZED: You do not have permission to schedule this donation.",
    };
  }

  // 4. Verify commitment status
  if (
    commitment.status === "WITHDRAWN" ||
    commitment.status === "CANCELLED" ||
    commitment.status === "EXPIRED" ||
    commitment.status === "DECLINED"
  ) {
    return {
      success: false,
      error: `Cannot schedule donation for commitment in '${commitment.status}' status. Commitment must be active.`,
    };
  }

  // 5. Fetch and verify blood request
  const { data: reqRecord, error: reqErr } = await admin
    .from("blood_requests")
    .select("*")
    .eq("id", commitment.request_id)
    .single();

  if (reqErr || !reqRecord) {
    return { success: false, error: "Blood requisition not found." };
  }

  const req = reqRecord as BloodRequest;
  const validRequestStatuses = ["ACTIVE", "PARTIALLY_COMMITTED", "PARTIALLY_FULFILLED"];
  if (!validRequestStatuses.includes(req.status)) {
    return {
      success: false,
      error: `Requisition is in status '${req.status}' and not accepting donation appointments. Only active requests can schedule donations.`,
    };
  }

  // 6. Check for existing active donation to prevent duplicates
  const { data: existingDonation } = await admin
    .from("donations")
    .select("*")
    .eq("commitment_id", commitment.id)
    .not("status", "in", '("CANCELLED","NO_SHOW")')
    .maybeSingle();

  if (existingDonation) {
    return {
      success: true,
      alreadyProcessed: true,
      donation: formatDonationRecord(existingDonation as DonationRecord),
    };
  }

  const now = new Date().toISOString();
  const scheduledTime = input.scheduledAt || now;
  const facility = input.facilityName || req.hospital_name;

  // 7. Insert donation record into public.donations
  const { data: newDonation, error: insertErr } = await admin
    .from("donations")
    .insert({
      request_id: req.id,
      commitment_id: commitment.id,
      donor_id: commitment.donor_id,
      donor_profile_id: commitment.donor_profile_id,
      status: "SCHEDULED",
      scheduled_at: scheduledTime,
      facility_name: facility,
      blood_group: req.blood_group,
      component_type: req.blood_component || "WHOLE_BLOOD",
      notes: input.notes || null,
      created_at: now,
      updated_at: now,
    })
    .select("*")
    .single();

  // Concurrency conflict handling (unique index on commitment_id)
  if (insertErr) {
    if (insertErr.code === "23505") {
      const { data: winningDonation } = await admin
        .from("donations")
        .select("*")
        .eq("commitment_id", commitment.id)
        .not("status", "in", '("CANCELLED","NO_SHOW")')
        .single();

      if (winningDonation) {
        return {
          success: true,
          alreadyProcessed: true,
          donation: formatDonationRecord(winningDonation as DonationRecord),
        };
      }
    }
    return {
      success: false,
      error: insertErr.message || "Failed to schedule donation appointment.",
    };
  }

  // 8. Update commitment status to SCHEDULED
  await admin
    .from("donor_commitments")
    .update({
      status: "SCHEDULED",
      scheduled_at: scheduledTime,
      updated_at: now,
    })
    .eq("id", commitment.id);

  // 9. Audit Log
  await logAuditEvent({
    actorProfileId: callerProfile.id,
    action: "DONATION_SCHEDULED",
    targetTable: "donations",
    targetId: newDonation.id,
    newState: {
      status: "SCHEDULED",
      request_id: req.id,
      commitment_id: commitment.id,
      scheduled_at: scheduledTime,
      facility_name: facility,
    },
  });

  // Enqueue outbox notification for blood requisition owner
  if (req.requester_id) {
    await enqueueNotificationEvent({
      eventType: "DONATION_SCHEDULED",
      recipientUserId: req.requester_id,
      channel: "IN_APP",
      payload: {
        requestId: req.id,
        commitmentId: commitment.id,
        donationId: newDonation.id,
        title: "Donation Appointment Scheduled",
        body: `A donation appointment was scheduled at ${facility}.`,
      },
      idempotencyKey: `outbox:donation:${newDonation.id}:scheduled`,
    });
  }

  return {
    success: true,
    alreadyProcessed: false,
    donation: formatDonationRecord(newDonation as DonationRecord),
  };
}

// ============================================================================
// 2. MARK DONATION ATTENDED
// ============================================================================
export async function markDonationAttended(
  input: MarkAttendedInput
): Promise<DonationActionResult> {
  const admin = createSupabaseAdminClient();
  if (!admin) {
    return { success: false, error: "Database configuration error." };
  }

  // 1. Authenticate caller profile
  const { data: callerProfile, error: profileErr } = await admin
    .from("profiles")
    .select("*")
    .eq("clerk_user_id", input.clerkUserId)
    .single();

  if (profileErr || !callerProfile) {
    return { success: false, error: "Authenticated profile not found." };
  }

  // 2. RBAC check: Only authorized staff or admins can mark attendance
  const isPrivileged = PRIVILEGED_ROLES.includes(callerProfile.role as UserRole);
  if (!isPrivileged) {
    return {
      success: false,
      error: "UNAUTHORIZED: Only authorized clinical hospital staff can record donor attendance.",
    };
  }

  // 3. Fetch donation record
  const { data: donation, error: donErr } = await admin
    .from("donations")
    .select("*")
    .eq("id", input.donationId)
    .single();

  if (donErr || !donation) {
    return { success: false, error: "Donation record not found." };
  }

  // Idempotency: If already attended
  if (donation.status === "ATTENDED") {
    return {
      success: true,
      alreadyProcessed: true,
      donation: formatDonationRecord(donation as DonationRecord),
    };
  }

  // 4. Validate state machine transition
  if (!isValidDonationTransition(donation.status, "ATTENDED")) {
    return {
      success: false,
      error: `Cannot mark attendance: Transition from '${donation.status}' to 'ATTENDED' is not allowed.`,
    };
  }

  const now = new Date().toISOString();
  const attendedTime = input.attendedAt || now;

  // 5. Update donation record
  const { data: updatedDonation, error: updateErr } = await admin
    .from("donations")
    .update({
      status: "ATTENDED",
      attended_at: attendedTime,
      notes: input.notes ? `${donation.notes || ""}\n${input.notes}`.trim() : donation.notes,
      updated_at: now,
    })
    .eq("id", donation.id)
    .select("*")
    .single();

  if (updateErr) {
    return { success: false, error: updateErr.message || "Failed to update attendance." };
  }

  // 6. Update commitment record
  await admin
    .from("donor_commitments")
    .update({
      status: "CHECKED_IN",
      checked_in_at: attendedTime,
      checked_in_by: callerProfile.id,
      updated_at: now,
    })
    .eq("id", donation.commitment_id);

  // 7. Audit log
  await logAuditEvent({
    actorProfileId: callerProfile.id,
    action: "DONATION_ATTENDED",
    targetTable: "donations",
    targetId: donation.id,
    previousState: { status: donation.status },
    newState: { status: "ATTENDED", attended_at: attendedTime },
  });

  return {
    success: true,
    alreadyProcessed: false,
    donation: formatDonationRecord(updatedDonation as DonationRecord),
  };
}

// ============================================================================
// 3. RECORD BLOOD DONATION & UPDATE FULFILLMENT
// ============================================================================
export async function recordDonation(
  input: RecordDonationInput
): Promise<DonationActionResult> {
  const admin = createSupabaseAdminClient();
  if (!admin) {
    return { success: false, error: "Database configuration error." };
  }

  // 1. Authenticate caller profile
  const { data: callerProfile, error: profileErr } = await admin
    .from("profiles")
    .select("*")
    .eq("clerk_user_id", input.clerkUserId)
    .single();

  if (profileErr || !callerProfile) {
    return { success: false, error: "Authenticated profile not found." };
  }

  // 2. RBAC check: Only authorized clinical staff or admins can record donation
  const isPrivileged = PRIVILEGED_ROLES.includes(callerProfile.role as UserRole);
  if (!isPrivileged) {
    return {
      success: false,
      error: "UNAUTHORIZED: Only authorized clinical hospital staff can record completed donations.",
    };
  }

  // 3. Fetch donation record
  const { data: donation, error: donErr } = await admin
    .from("donations")
    .select("*")
    .eq("id", input.donationId)
    .single();

  if (donErr || !donation) {
    return { success: false, error: "Donation record not found." };
  }

  // Idempotency check: If already recorded
  if (donation.status === "RECORDED") {
    const summary = await getFulfillmentSummaryInternal(admin, donation.request_id);
    return {
      success: true,
      alreadyProcessed: true,
      donation: formatDonationRecord(donation as DonationRecord),
      fulfillmentSummary: summary,
    };
  }

  // 4. Validate state transition
  // Can transition from ATTENDED (or SCHEDULED if recording walk-in attendance directly)
  if (donation.status !== "ATTENDED" && donation.status !== "SCHEDULED") {
    return {
      success: false,
      error: `Cannot record donation: Donation is currently in '${donation.status}'. Must be ATTENDED or SCHEDULED.`,
    };
  }

  // 5. Fetch blood request to ensure request is actionable
  const { data: reqRecord, error: reqErr } = await admin
    .from("blood_requests")
    .select("*")
    .eq("id", donation.request_id)
    .single();

  if (reqErr || !reqRecord) {
    return { success: false, error: "Blood requisition not found." };
  }

  const req = reqRecord as BloodRequest;
  if (req.status === "CANCELLED" || req.status === "EXPIRED" || req.status === "REJECTED") {
    return {
      success: false,
      error: `Cannot record donation: Blood requisition is in terminal status '${req.status}'.`,
    };
  }

  const now = new Date().toISOString();
  const units = input.unitsDonated;

  // 6. Update donation record to RECORDED
  const { data: updatedDonation, error: updateDonErr } = await admin
    .from("donations")
    .update({
      status: "RECORDED",
      units_donated: units,
      recorded_at: now,
      recorded_by: callerProfile.id,
      component_type: input.componentType,
      facility_name: input.facilityName || donation.facility_name,
      notes: input.notes ? `${donation.notes || ""}\n${input.notes}`.trim() : donation.notes,
      updated_at: now,
    })
    .eq("id", donation.id)
    .select("*")
    .single();

  if (updateDonErr) {
    return { success: false, error: updateDonErr.message || "Failed to record donation." };
  }

  // 7. Update commitment record to COMPLETED / DONATION_RECORDED
  await admin
    .from("donor_commitments")
    .update({
      status: "COMPLETED",
      units_donated: units,
      completed_at: now,
      donation_recorded_at: now,
      recorded_by: callerProfile.id,
      updated_at: now,
    })
    .eq("id", donation.commitment_id);

  // 8. Re-calculate total units donated across all RECORDED donations for this requisition
  const { data: recordedDonations } = await admin
    .from("donations")
    .select("units_donated")
    .eq("request_id", req.id)
    .eq("status", "RECORDED");

  const totalDonatedUnits = (recordedDonations || []).reduce(
    (sum, d) => sum + (d.units_donated || 0),
    0
  );

  // 9. Evaluate request fulfillment status
  const isFulfilled = totalDonatedUnits >= req.units_requested;
  const newReqStatus = isFulfilled ? "FULFILLED" : req.status;

  await admin
    .from("blood_requests")
    .update({
      units_donated: totalDonatedUnits,
      status: newReqStatus,
      updated_at: now,
    })
    .eq("id", req.id);

  // 10. Audit Logs
  await logAuditEvent({
    actorProfileId: callerProfile.id,
    action: "DONATION_RECORDED",
    targetTable: "donations",
    targetId: donation.id,
    newState: {
      status: "RECORDED",
      units_donated: units,
      component_type: input.componentType,
      facility: input.facilityName || donation.facility_name,
    },
  });

  await logAuditEvent({
    actorProfileId: callerProfile.id,
    action: "FULFILLMENT_PROGRESS_UPDATED",
    targetTable: "blood_requests",
    targetId: req.id,
    previousState: {
      units_donated: req.units_donated,
      status: req.status,
    },
    newState: {
      units_donated: totalDonatedUnits,
      units_requested: req.units_requested,
      status: newReqStatus,
    },
  });

  if (isFulfilled && req.status !== "FULFILLED") {
    await logAuditEvent({
      actorProfileId: callerProfile.id,
      action: "REQUEST_FULFILLED",
      targetTable: "blood_requests",
      targetId: req.id,
      newState: {
        status: "FULFILLED",
        total_donated: totalDonatedUnits,
        units_requested: req.units_requested,
      },
    });
  }

  const fulfillmentSummary = await getFulfillmentSummaryInternal(admin, req.id);

  // Enqueue outbox notifications for requester
  if (req.requester_id) {
    await enqueueNotificationEvent({
      eventType: "DONATION_RECORDED",
      recipientUserId: req.requester_id,
      channel: "IN_APP",
      payload: {
        requestId: req.id,
        commitmentId: donation.commitment_id,
        donationId: updatedDonation.id,
        title: "Donation Recorded",
        body: `A donation of ${units} unit(s) was recorded for your requisition.`,
      },
      idempotencyKey: `outbox:donation:${updatedDonation.id}:recorded`,
    });

    if (isFulfilled) {
      await enqueueNotificationEvent({
        eventType: "REQUEST_FULFILLED",
        recipientUserId: req.requester_id,
        channel: "IN_APP",
        payload: {
          requestId: req.id,
          title: "Requisition Fulfilled",
          body: `All requested units (${req.units_requested}) for your requisition have been recorded.`,
        },
        idempotencyKey: `outbox:request:${req.id}:fulfilled`,
      });
    }
  }

  // 11. Award non-monetary donor recognition points (idempotent, verified completion only)
  await awardPointsForCompletedDonation({
    donationId: updatedDonation.id,
    donorId: donation.donor_id,
    donorProfileId: donation.donor_profile_id,
    verifiedByProfileId: callerProfile.id,
    unitsDonated: units,
    componentType: input.componentType,
  });

  return {
    success: true,
    alreadyProcessed: false,
    donation: formatDonationRecord(updatedDonation as DonationRecord),
    fulfillmentSummary,
  };
}

// ============================================================================
// 4. CANCEL DONATION APPOINTMENT
// ============================================================================
export async function cancelDonationAppointment(
  input: CancelDonationInput
): Promise<DonationActionResult> {
  const admin = createSupabaseAdminClient();
  if (!admin) {
    return { success: false, error: "Database configuration error." };
  }

  // 1. Authenticate caller profile
  const { data: callerProfile, error: profileErr } = await admin
    .from("profiles")
    .select("*")
    .eq("clerk_user_id", input.clerkUserId)
    .single();

  if (profileErr || !callerProfile) {
    return { success: false, error: "Authenticated profile not found." };
  }

  // 2. Fetch donation record
  const { data: donation, error: donErr } = await admin
    .from("donations")
    .select("*")
    .eq("id", input.donationId)
    .single();

  if (donErr || !donation) {
    return { success: false, error: "Donation record not found." };
  }

  // Idempotency: If already cancelled
  if (donation.status === "CANCELLED") {
    return {
      success: true,
      alreadyProcessed: true,
      donation: formatDonationRecord(donation as DonationRecord),
    };
  }

  // 3. Authorization check
  const isDonorOwner = donation.donor_id === callerProfile.id;
  const isPrivileged = PRIVILEGED_ROLES.includes(callerProfile.role as UserRole);

  if (!isDonorOwner && !isPrivileged) {
    return {
      success: false,
      error: "UNAUTHORIZED: You do not have permission to cancel this donation appointment.",
    };
  }

  // 4. Validate state transition
  if (!isValidDonationTransition(donation.status, "CANCELLED")) {
    return {
      success: false,
      error: `Cannot cancel donation in status '${donation.status}'. Terminal or completed donations cannot be cancelled.`,
    };
  }

  const now = new Date().toISOString();

  // 5. Update donation
  const { data: updatedDonation, error: updateErr } = await admin
    .from("donations")
    .update({
      status: "CANCELLED",
      cancelled_at: now,
      cancellation_reason: input.reason,
      updated_at: now,
    })
    .eq("id", donation.id)
    .select("*")
    .single();

  if (updateErr) {
    return { success: false, error: updateErr.message || "Failed to cancel donation." };
  }

  // 6. Update commitment: Revert to ACCEPTED so donor/staff can reschedule
  await admin
    .from("donor_commitments")
    .update({
      status: "ACCEPTED",
      scheduled_at: null,
      updated_at: now,
    })
    .eq("id", donation.commitment_id);

  // 7. Audit log
  await logAuditEvent({
    actorProfileId: callerProfile.id,
    action: "DONATION_CANCELLED",
    targetTable: "donations",
    targetId: donation.id,
    previousState: { status: donation.status },
    newState: {
      status: "CANCELLED",
      cancelled_at: now,
      reason: input.reason,
    },
  });

  // Enqueue outbox notification if requester exists
  const { data: cancelReq } = await admin
    .from("blood_requests")
    .select("requester_id")
    .eq("id", donation.request_id)
    .single();

  if (cancelReq?.requester_id) {
    await enqueueNotificationEvent({
      eventType: "COMMITMENT_CANCELLED",
      recipientUserId: cancelReq.requester_id,
      channel: "IN_APP",
      payload: {
        requestId: donation.request_id,
        commitmentId: donation.commitment_id,
        donationId: donation.id,
        title: "Appointment Cancelled",
        body: `A donation appointment was cancelled. Reason: ${input.reason}`,
      },
      idempotencyKey: `outbox:donation:${donation.id}:cancelled`,
    });
  }

  return {
    success: true,
    alreadyProcessed: false,
    donation: formatDonationRecord(updatedDonation as DonationRecord),
  };
}

// ============================================================================
// 5. MARK DONATION NO-SHOW
// ============================================================================
export async function markDonationNoShow(
  input: MarkNoShowInput
): Promise<DonationActionResult> {
  const admin = createSupabaseAdminClient();
  if (!admin) {
    return { success: false, error: "Database configuration error." };
  }

  // 1. Authenticate caller profile
  const { data: callerProfile, error: profileErr } = await admin
    .from("profiles")
    .select("*")
    .eq("clerk_user_id", input.clerkUserId)
    .single();

  if (profileErr || !callerProfile) {
    return { success: false, error: "Authenticated profile not found." };
  }

  // 2. RBAC check: Only authorized staff or admins can record no-show
  const isPrivileged = PRIVILEGED_ROLES.includes(callerProfile.role as UserRole);
  if (!isPrivileged) {
    return {
      success: false,
      error: "UNAUTHORIZED: Only authorized clinical hospital staff can record donor no-show.",
    };
  }

  // 3. Fetch donation record
  const { data: donation, error: donErr } = await admin
    .from("donations")
    .select("*")
    .eq("id", input.donationId)
    .single();

  if (donErr || !donation) {
    return { success: false, error: "Donation record not found." };
  }

  // Idempotency: If already NO_SHOW
  if (donation.status === "NO_SHOW") {
    return {
      success: true,
      alreadyProcessed: true,
      donation: formatDonationRecord(donation as DonationRecord),
    };
  }

  // 4. Validate state transition
  if (!isValidDonationTransition(donation.status, "NO_SHOW")) {
    return {
      success: false,
      error: `Cannot mark no-show: Transition from '${donation.status}' to 'NO_SHOW' is not permitted.`,
    };
  }

  const now = new Date().toISOString();
  const reason = input.reason || "Donor did not appear for scheduled appointment.";

  // 5. Update donation
  const { data: updatedDonation, error: updateErr } = await admin
    .from("donations")
    .update({
      status: "NO_SHOW",
      no_show_at: now,
      notes: reason,
      updated_at: now,
    })
    .eq("id", donation.id)
    .select("*")
    .single();

  if (updateErr) {
    return { success: false, error: updateErr.message || "Failed to record no-show." };
  }

  // 6. Update commitment to NO_SHOW
  await admin
    .from("donor_commitments")
    .update({
      status: "NO_SHOW",
      no_show_recorded_at: now,
      no_show_recorded_by: callerProfile.id,
      cancellation_reason: reason,
      updated_at: now,
    })
    .eq("id", donation.commitment_id);

  // 7. Decrement blood_requests.units_committed
  const { data: req } = await admin
    .from("blood_requests")
    .select("units_committed")
    .eq("id", donation.request_id)
    .single();

  if (req && req.units_committed > 0) {
    await admin
      .from("blood_requests")
      .update({
        units_committed: req.units_committed - 1,
        updated_at: now,
      })
      .eq("id", donation.request_id);
  }

  // 8. Audit log
  await logAuditEvent({
    actorProfileId: callerProfile.id,
    action: "DONATION_NO_SHOW",
    targetTable: "donations",
    targetId: donation.id,
    previousState: { status: donation.status },
    newState: { status: "NO_SHOW", no_show_at: now, reason },
  });

  // Enqueue outbox notification to donor regarding no-show
  await enqueueNotificationEvent({
    eventType: "DONATION_REMINDER",
    recipientUserId: donation.donor_id,
    channel: "IN_APP",
    payload: {
      requestId: donation.request_id,
      commitmentId: donation.commitment_id,
      donationId: donation.id,
      title: "Appointment Marked No-Show",
      body: "Your scheduled donation appointment was marked as unattended.",
    },
    idempotencyKey: `outbox:donation:${donation.id}:no_show`,
  });

  return {
    success: true,
    alreadyProcessed: false,
    donation: formatDonationRecord(updatedDonation as DonationRecord),
  };
}

// ============================================================================
// 6. QUERIES & FULFILLMENT SUMMARIES
// ============================================================================
async function getFulfillmentSummaryInternal(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  requestId: string
): Promise<RequestFulfillmentSummary> {
  const { data: req } = await admin
    .from("blood_requests")
    .select("id, units_requested, units_committed, units_donated, status")
    .eq("id", requestId)
    .single();

  const { data: donList } = await admin
    .from("donations")
    .select("*")
    .eq("request_id", requestId)
    .order("created_at", { ascending: false });

  const donations = (donList || []).map((d: DonationRecord) => formatDonationRecord(d));
  const unitsRequested = req?.units_requested || 0;
  const unitsCommitted = req?.units_committed || 0;
  const unitsDonated = (donList || [])
    .filter((d: DonationRecord) => d.status === "RECORDED")
    .reduce((sum: number, d: DonationRecord) => sum + (d.units_donated || 0), 0);

  const remainingUnits = Math.max(0, unitsRequested - unitsDonated);
  const isFulfilled = unitsDonated >= unitsRequested && unitsRequested > 0;

  return {
    requestId,
    unitsRequested,
    unitsCommitted,
    unitsDonated,
    remainingUnits,
    isFulfilled,
    requestStatus: req?.status || "ACTIVE",
    donations,
  };
}

export async function getRequestFulfillmentSummary(
  requestId: string,
  clerkUserId?: string | null
): Promise<RequestFulfillmentSummary | null> {
  const admin = createSupabaseAdminClient();
  if (!admin) return null;

  // Authorization check if caller provided
  if (clerkUserId) {
    const { data: callerProfile } = await admin
      .from("profiles")
      .select("id, role")
      .eq("clerk_user_id", clerkUserId)
      .single();

    if (callerProfile) {
      const isPrivileged = PRIVILEGED_ROLES.includes(callerProfile.role as UserRole);
      const { data: req } = await admin
        .from("blood_requests")
        .select("requester_id")
        .eq("id", requestId)
        .single();

      const isOwner = req && req.requester_id === callerProfile.id;

      // If not owner and not staff, check if caller is a donor with a commitment to this request
      if (!isOwner && !isPrivileged) {
        const { data: userCommitment } = await admin
          .from("donor_commitments")
          .select("id")
          .eq("request_id", requestId)
          .eq("donor_id", callerProfile.id)
          .maybeSingle();

        if (!userCommitment) {
          return null; // Unauthorized to view
        }
      }
    }
  }

  return await getFulfillmentSummaryInternal(admin, requestId);
}

export async function getDonorDonations(
  clerkUserId: string
): Promise<{ success: boolean; donations: FormattedDonation[]; error?: string }> {
  const admin = createSupabaseAdminClient();
  if (!admin) {
    return { success: false, donations: [], error: "Database configuration error." };
  }

  const { data: callerProfile } = await admin
    .from("profiles")
    .select("id")
    .eq("clerk_user_id", clerkUserId)
    .single();

  if (!callerProfile) {
    return { success: false, donations: [], error: "Profile not found." };
  }

  const { data: donList, error: donErr } = await admin
    .from("donations")
    .select("*")
    .eq("donor_id", callerProfile.id)
    .order("created_at", { ascending: false });

  if (donErr) {
    return { success: false, donations: [], error: donErr.message };
  }

  return {
    success: true,
    donations: (donList || []).map((d: DonationRecord) => formatDonationRecord(d)),
  };
}
