import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  BloodRequest,
  DonorProfile,
  Profile,
  RequestMatch,
  UserRole,
  formatBloodGroup,
} from "@/lib/supabase/types";
import { logAuditEvent } from "@/lib/audit";
import { generateSafeDonorCode } from "@/lib/matching/rules";
import {
  DispatchNotificationInput,
  DispatchNotificationResult,
  FormattedNotification,
  NotificationRecord,
  NOTIFICATION_SAFETY_DISCLAIMER,
} from "./types";
import { getNotificationDispatcher } from "./dispatcher";

const PRIVILEGED_ROLES: UserRole[] = [
  "MODERATOR",
  "ADMIN",
  "SUPER_ADMIN",
  "HOSPITAL_STAFF",
];

export function formatNotificationRecord(
  record: NotificationRecord
): FormattedNotification {
  return {
    id: record.id,
    recipientUserId: record.recipient_user_id,
    type: record.type,
    title: record.title,
    body: record.body,
    requestId: record.request_id || null,
    matchId: record.match_id || null,
    status: record.status,
    isRead: record.status === "READ" || Boolean(record.read_at),
    readAt: record.read_at || null,
    sentAt: record.sent_at || null,
    deliveredAt: record.delivered_at || null,
    metadata: record.metadata || null,
    createdAt: record.created_at,
  };
}

/**
 * Dispatches an in-app operational alert to a discovered potential donor match.
 * Enforces strict authorization, ACTIVE request gating, consent, availability, and idempotency.
 */
export async function dispatchDonorNotification(
  input: DispatchNotificationInput
): Promise<DispatchNotificationResult> {
  const admin = createSupabaseAdminClient();
  if (!admin) {
    return {
      success: false,
      error: "Database configuration unavailable.",
    };
  }

  const { requestId, matchId, clerkUserId, channel = "IN_APP" } = input;

  // 1. Authenticate caller and load caller profile
  if (!clerkUserId) {
    return {
      success: false,
      error: "UNAUTHORIZED: Authentication required to dispatch notifications.",
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
      error: "UNAUTHORIZED: Caller user profile not found.",
    };
  }

  // 2. Fetch Requisition
  const { data: requestRecord, error: reqErr } = await admin
    .from("blood_requests")
    .select("*")
    .eq("id", requestId)
    .single();

  if (reqErr || !requestRecord) {
    return {
      success: false,
      error: "Blood requisition not found.",
    };
  }

  const req = requestRecord as BloodRequest;

  // 3. Verify Authorization
  const isOwner = req.requester_id === callerProfile.id;
  const isPrivileged = PRIVILEGED_ROLES.includes(callerProfile.role);

  if (!isOwner && !isPrivileged) {
    return {
      success: false,
      error: "UNAUTHORIZED: You do not have permission to dispatch notifications for this requisition.",
    };
  }

  // 4. Strict Lifecycle Gate: ONLY ACTIVE requests may dispatch notifications
  if (req.status !== "ACTIVE") {
    return {
      success: false,
      error: `Requisition is in status '${req.status}' and not eligible for donor dispatch. Only ACTIVE requests can dispatch notifications.`,
    };
  }

  // 5. Fetch Potential Match Record
  const { data: matchRecord, error: matchErr } = await admin
    .from("request_matches")
    .select("*")
    .eq("id", matchId)
    .eq("request_id", requestId)
    .single();

  if (matchErr || !matchRecord) {
    return {
      success: false,
      error: "Potential donor match record not found for this requisition.",
    };
  }

  const match = matchRecord as RequestMatch;

  // 6. Idempotency Check & Duplicate Dispatch Protection
  const idempotencyKey = `dispatch:${requestId}:${matchId}:POTENTIAL_DONOR_ALERT`;

  const { data: existingNotification } = await admin
    .from("notifications")
    .select("*")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (existingNotification) {
    return {
      success: true,
      alreadyDispatched: true,
      matchStatus: match.status,
      notification: formatNotificationRecord(existingNotification as NotificationRecord),
    };
  }

  // If match is in a terminal or invalid status
  if (match.status !== "POTENTIAL_CANDIDATE" && match.status !== "NOTIFIED") {
    return {
      success: false,
      error: `Match is in ineligible status '${match.status}' and cannot be dispatched.`,
    };
  }

  // 7. Fetch and verify Donor Profile
  const { data: donorRecord, error: donorErr } = await admin
    .from("donor_profiles")
    .select("*, profiles(*)")
    .eq("id", match.donor_id)
    .single();

  if (donorErr || !donorRecord) {
    return {
      success: false,
      error: "Donor profile not found.",
    };
  }

  const donor = donorRecord as DonorProfile & { profiles?: Profile | null };

  // Operational Availability Check
  if (!donor.is_available) {
    return {
      success: false,
      error: "Donor is currently marked as unavailable for donations.",
    };
  }

  // Explicit Contact Consent Check
  if (!donor.consent_to_contact) {
    return {
      success: false,
      error: "Donor has not provided consent to be contacted for blood donation requests.",
    };
  }

  // Cooldown Check
  if (donor.cooldown_until && new Date(donor.cooldown_until) > new Date()) {
    return {
      success: false,
      error: `Donor is currently on donation cooldown until ${donor.cooldown_until}.`,
    };
  }

  // 8. Determine Recipient User Identifier
  const recipientUserId = donor.profiles?.clerk_user_id || donor.profile_id;

  // 9. Audit Event: NOTIFICATION_DISPATCH_REQUESTED
  await logAuditEvent({
    actorProfileId: callerProfile.id,
    action: "NOTIFICATION_DISPATCH_REQUESTED",
    targetTable: "blood_requests",
    targetId: req.id,
    newState: {
      match_id: match.id,
      donor_id: donor.id,
      channel,
      safe_donor_code: generateSafeDonorCode(donor.id),
    },
  });

  // 10. Construct Privacy-Safe Operational Content
  const reqBloodGroup = formatBloodGroup(req.blood_group, req.rh_factor);
  const bloodComponent = req.blood_component.replace(/_/g, " ");
  const safeDonorCode = generateSafeDonorCode(donor.id);

  const title = `Potential Blood Donor Match: ${reqBloodGroup}`;
  const body = `A potential blood match has been found for an active requisition requiring ${reqBloodGroup} (${bloodComponent}) at ${req.hospital_name}, ${req.hospital_city}. Review requisition details to respond if you are available.`;

  const metadata = {
    request_id: req.id,
    match_id: match.id,
    blood_group: reqBloodGroup,
    blood_component: req.blood_component,
    urgency_level: req.urgency_level,
    hospital_name: req.hospital_name,
    hospital_city: req.hospital_city,
    safe_donor_code: safeDonorCode,
    medical_safety_disclaimer: NOTIFICATION_SAFETY_DISCLAIMER,
    channel,
  };

  // 11. Dispatch through provider abstraction
  const dispatcher = getNotificationDispatcher(channel);
  const deliveryResult = await dispatcher.dispatch({
    notificationId: "",
    recipientUserId,
    title,
    body,
    metadata,
  });

  if (!deliveryResult.delivered) {
    await logAuditEvent({
      actorProfileId: callerProfile.id,
      action: "NOTIFICATION_FAILED",
      targetTable: "request_matches",
      targetId: match.id,
      newState: {
        channel,
        error: deliveryResult.error,
      },
    });

    return {
      success: false,
      error: deliveryResult.error || "Notification delivery failed.",
    };
  }

  // 12. Persist Notification in public.notifications
  const { data: newNotification, error: insertErr } = await admin
    .from("notifications")
    .insert({
      recipient_user_id: recipientUserId,
      type: "POTENTIAL_DONOR_ALERT",
      title,
      body,
      request_id: req.id,
      match_id: match.id,
      status: deliveryResult.status,
      sent_at: deliveryResult.sentAt,
      delivered_at: deliveryResult.deliveredAt,
      metadata,
      idempotency_key: idempotencyKey,
    })
    .select("*")
    .single();

  if (insertErr || !newNotification) {
    await logAuditEvent({
      actorProfileId: callerProfile.id,
      action: "NOTIFICATION_FAILED",
      targetTable: "notifications",
      targetId: match.id,
      newState: {
        error: insertErr?.message || "Failed to persist notification record.",
      },
    });

    return {
      success: false,
      error: insertErr?.message || "Failed to persist notification record.",
    };
  }

  // 13. Update Match Status from POTENTIAL_CANDIDATE to NOTIFIED
  const { error: updateMatchErr } = await admin
    .from("request_matches")
    .update({
      status: "NOTIFIED",
      updated_at: new Date().toISOString(),
    })
    .eq("id", match.id);

  if (updateMatchErr) {
    console.error("Warning: failed to update match status to NOTIFIED:", updateMatchErr.message);
  }

  // 14. Log Immutable Audit Events
  await logAuditEvent({
    actorProfileId: callerProfile.id,
    action: "NOTIFICATION_CREATED",
    targetTable: "notifications",
    targetId: newNotification.id,
    newState: {
      recipient_user_id: recipientUserId,
      type: newNotification.type,
      status: newNotification.status,
      request_id: req.id,
      match_id: match.id,
    },
  });

  await logAuditEvent({
    actorProfileId: callerProfile.id,
    action: "NOTIFICATION_SENT",
    targetTable: "notifications",
    targetId: newNotification.id,
    newState: {
      channel,
      delivered_at: deliveryResult.deliveredAt,
    },
  });

  await logAuditEvent({
    actorProfileId: callerProfile.id,
    action: "MATCH_STATUS_CHANGED",
    targetTable: "request_matches",
    targetId: match.id,
    previousState: { status: match.status },
    newState: { status: "NOTIFIED" },
  });

  return {
    success: true,
    alreadyDispatched: false,
    matchStatus: "NOTIFIED",
    notification: formatNotificationRecord(newNotification as NotificationRecord),
  };
}

/**
 * Marks a notification as READ. Enforces recipient authorization and valid state transitions.
 */
export async function markNotificationAsRead(
  notificationId: string,
  clerkUserId: string
): Promise<{ success: boolean; notification?: FormattedNotification; error?: string }> {
  const admin = createSupabaseAdminClient();
  if (!admin) {
    return { success: false, error: "Database configuration unavailable." };
  }

  // 1. Get caller profile
  const { data: callerProfile, error: profileErr } = await admin
    .from("profiles")
    .select("*")
    .eq("clerk_user_id", clerkUserId)
    .single();

  if (profileErr || !callerProfile) {
    return { success: false, error: "UNAUTHORIZED: Caller user profile not found." };
  }

  // 2. Fetch notification
  const { data: notifRecord, error: notifErr } = await admin
    .from("notifications")
    .select("*")
    .eq("id", notificationId)
    .single();

  if (notifErr || !notifRecord) {
    return { success: false, error: "Notification not found." };
  }

  // 3. Verify recipient matches caller
  const isRecipient =
    notifRecord.recipient_user_id === clerkUserId ||
    notifRecord.recipient_user_id === callerProfile.id;

  if (!isRecipient && !PRIVILEGED_ROLES.includes(callerProfile.role)) {
    return {
      success: false,
      error: "UNAUTHORIZED: You cannot mark another user's notification as read.",
    };
  }

  // 4. If already READ, return idempotently
  if (notifRecord.status === "READ") {
    return {
      success: true,
      notification: formatNotificationRecord(notifRecord as NotificationRecord),
    };
  }

  // 5. Update status to READ
  const now = new Date().toISOString();
  const { data: updatedRecord, error: updateErr } = await admin
    .from("notifications")
    .update({
      status: "READ",
      read_at: now,
      updated_at: now,
    })
    .eq("id", notificationId)
    .select("*")
    .single();

  if (updateErr || !updatedRecord) {
    return {
      success: false,
      error: updateErr?.message || "Failed to update notification read status.",
    };
  }

  // 6. Log Audit Event
  await logAuditEvent({
    actorProfileId: callerProfile.id,
    action: "NOTIFICATION_READ",
    targetTable: "notifications",
    targetId: notificationId,
    previousState: { status: notifRecord.status },
    newState: { status: "READ", read_at: now },
  });

  return {
    success: true,
    notification: formatNotificationRecord(updatedRecord as NotificationRecord),
  };
}

/**
 * Retrieves notifications for the authenticated donor.
 */
export async function getDonorNotifications(
  clerkUserId: string,
  options?: { unreadOnly?: boolean; limit?: number }
): Promise<FormattedNotification[]> {
  const admin = createSupabaseAdminClient();
  if (!admin || !clerkUserId) return [];

  const { data: callerProfile } = await admin
    .from("profiles")
    .select("id")
    .eq("clerk_user_id", clerkUserId)
    .single();

  const recipientIds = [clerkUserId];
  if (callerProfile?.id) {
    recipientIds.push(callerProfile.id);
  }

  let query = admin
    .from("notifications")
    .select("*")
    .in("recipient_user_id", recipientIds)
    .order("created_at", { ascending: false })
    .limit(options?.limit || 50);

  if (options?.unreadOnly) {
    query = query.neq("status", "READ");
  }

  const { data, error } = await query;
  if (error || !data) return [];

  return data.map((n) => formatNotificationRecord(n as NotificationRecord));
}

/**
 * Fast query for donor unread notification count.
 */
export async function getUnreadNotificationCount(
  clerkUserId: string
): Promise<number> {
  const admin = createSupabaseAdminClient();
  if (!admin || !clerkUserId) return 0;

  const { data: callerProfile } = await admin
    .from("profiles")
    .select("id")
    .eq("clerk_user_id", clerkUserId)
    .single();

  const recipientIds = [clerkUserId];
  if (callerProfile?.id) {
    recipientIds.push(callerProfile.id);
  }

  const { count, error } = await admin
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .in("recipient_user_id", recipientIds)
    .neq("status", "READ");

  if (error || typeof count !== "number") return 0;
  return count;
}
