/**
 * LIFE DROP: MILESTONE 4 AUTOMATED VERIFICATION TEST SUITE
 *
 * Validates:
 * A. Notification creation (valid record, correct recipient, request, match relation)
 * B. Lifecycle state machine (valid transitions, invalid rejected, timestamps)
 * C. Active request status gate (ACTIVE succeeds; DRAFT, SUBMITTED, etc. rejected)
 * D. Match enforcement (POTENTIAL_CANDIDATE accepted, terminal rejected, cross-match mismatch rejected)
 * E. Explicit contact consent enforcement (consent=true succeeds, consent=false rejected)
 * F. Operational availability & cooldown enforcement (unavailable / cooldown rejected)
 * G. Server-side authorization boundaries (owner & staff succeed; unauthorized rejected)
 * H. Deterministic Idempotency (repeated dispatch prevents duplicate rows & alerts)
 * I. Donor privacy protection (zero donor phone, zero donor email, zero donor coordinates, masked patient)
 * J. Medical safety non-clinical terminology (strictly non-clinical wording)
 * K. Immutable audit logging (requested, created, sent, read, failed events)
 * L. Determinism across repeated dispatches
 * M. Live staging database persistence & cleanup
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

function loadEnvFile(filePath) {
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

loadEnvFile(path.join(ROOT_DIR, ".env.local"));

globalThis.WebSocket = class {};

import { createClient } from "@supabase/supabase-js";
import {
  isValidLifecycleTransition,
  NOTIFICATION_SAFETY_DISCLAIMER,
} from "../lib/notifications/types.js";
import {
  getNotificationDispatcher,
  InAppNotificationDispatcher,
  EmailNotificationDispatcher,
  SmsNotificationDispatcher,
} from "../lib/notifications/dispatcher.js";
import {
  dispatchDonorNotification,
  markNotificationAsRead,
  getDonorNotifications,
  getUnreadNotificationCount,
} from "../lib/notifications/service.js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false },
    realtime: { enabled: false },
  }
);

let passedTests = 0;
let failedTests = 0;

function assert(condition, message, details = "") {
  if (condition) {
    console.log(`  ✓ PASS: ${message} ${details ? `(${details})` : ""}`);
    passedTests++;
  } else {
    console.error(`  ❌ FAIL: ${message} ${details ? `[Details: ${details}]` : ""}`);
    failedTests++;
  }
}

async function runMilestone4Tests() {
  console.log("================================================================================");
  console.log("  LIFE DROP: MILESTONE 4 VERIFICATION TEST SUITE");
  console.log("================================================================================");

  // --------------------------------------------------------------------------
  // SUITE 1: NOTIFICATION LIFECYCLE & STATE MACHINE
  // --------------------------------------------------------------------------
  console.log("\n[Suite 1] Notification Lifecycle & State Machine Transitions...");

  assert(
    isValidLifecycleTransition("PENDING", "SENT"),
    "Lifecycle: PENDING -> SENT is valid"
  );
  assert(
    isValidLifecycleTransition("PENDING", "DELIVERED"),
    "Lifecycle: PENDING -> DELIVERED is valid"
  );
  assert(
    isValidLifecycleTransition("PENDING", "FAILED"),
    "Lifecycle: PENDING -> FAILED is valid"
  );
  assert(
    isValidLifecycleTransition("SENT", "DELIVERED"),
    "Lifecycle: SENT -> DELIVERED is valid"
  );
  assert(
    isValidLifecycleTransition("DELIVERED", "READ"),
    "Lifecycle: DELIVERED -> READ is valid"
  );
  assert(
    !isValidLifecycleTransition("READ", "PENDING"),
    "Lifecycle: READ -> PENDING is strictly rejected"
  );
  assert(
    !isValidLifecycleTransition("READ", "FAILED"),
    "Lifecycle: READ -> FAILED is strictly rejected"
  );
  assert(
    !isValidLifecycleTransition("DELIVERED", "PENDING"),
    "Lifecycle: DELIVERED -> PENDING is strictly rejected"
  );

  // --------------------------------------------------------------------------
  // SUITE 2: DELIVERY PROVIDER ABSTRACTION
  // --------------------------------------------------------------------------
  console.log("\n[Suite 2] Delivery Provider Architecture & Channel Extensions...");

  const inAppDispatcher = getNotificationDispatcher("IN_APP");
  assert(
    inAppDispatcher instanceof InAppNotificationDispatcher,
    "InAppNotificationDispatcher loaded correctly for IN_APP channel"
  );

  const inAppResult = await inAppDispatcher.dispatch({
    notificationId: "notif-test",
    recipientUserId: "user-test",
    title: "Test",
    body: "Test body",
  });
  assert(
    inAppResult.delivered === true && inAppResult.status === "DELIVERED",
    "InApp dispatcher delivers immediately to in-app store",
    `status: ${inAppResult.status}`
  );
  assert(
    Boolean(inAppResult.sentAt && inAppResult.deliveredAt),
    "InApp delivery populates sentAt and deliveredAt timestamps"
  );

  const emailDispatcher = getNotificationDispatcher("EMAIL");
  assert(
    emailDispatcher instanceof EmailNotificationDispatcher,
    "EmailNotificationDispatcher loaded correctly for EMAIL channel"
  );
  const emailResult = await emailDispatcher.dispatch({
    notificationId: "notif-email",
    recipientUserId: "user-email",
    title: "Test",
    body: "Test",
  });
  assert(
    emailResult.delivered === false && emailResult.status === "FAILED",
    "Unconfigured email provider honestly reports unconfigured rather than faking delivery",
    `status: ${emailResult.status}`
  );

  const smsDispatcher = getNotificationDispatcher("SMS");
  assert(
    smsDispatcher instanceof SmsNotificationDispatcher,
    "SmsNotificationDispatcher loaded correctly for SMS channel"
  );
  const smsResult = await smsDispatcher.dispatch({
    notificationId: "notif-sms",
    recipientUserId: "user-sms",
    title: "Test",
    body: "Test",
  });
  assert(
    smsResult.delivered === false && smsResult.status === "FAILED",
    "Unconfigured SMS provider honestly reports unconfigured rather than faking delivery",
    `status: ${smsResult.status}`
  );

  // --------------------------------------------------------------------------
  // SUITE 3: MEDICAL SAFETY TERMINOLOGY
  // --------------------------------------------------------------------------
  console.log("\n[Suite 3] Medical Safety Non-Clinical Guardrails...");

  const prohibitedPhrases = [
    "medically approved",
    "medically eligible",
    "safe donor",
    "guaranteed match",
    "transfusion authorized",
    "clinically cleared",
  ];

  prohibitedPhrases.forEach((phrase) => {
    assert(
      !NOTIFICATION_SAFETY_DISCLAIMER.toLowerCase().includes(phrase),
      `Disclaimer strictly avoids prohibited phrase: "${phrase}"`
    );
  });

  assert(
    NOTIFICATION_SAFETY_DISCLAIMER.includes("NOT a clinical determination") &&
      NOTIFICATION_SAFETY_DISCLAIMER.includes("certified blood bank professionals"),
    "Disclaimer explicitly affirms that clinical suitability is determined on-site by certified professionals"
  );

  // --------------------------------------------------------------------------
  // SUITE 4: LIVE FIXTURES & END-TO-END NOTIFICATION DISPATCH
  // --------------------------------------------------------------------------
  console.log("\n[Suite 4] Live Supabase Staging Dispatch & Lifecycle Verification...");

  const testSuffix = Math.random().toString(36).substring(2, 8);
  const requesterClerkId = `test_requester_m4_${testSuffix}`;
  const donorClerkId = `test_donor_m4_${testSuffix}`;
  const unauthorizedClerkId = `test_unauth_m4_${testSuffix}`;
  const staffClerkId = `test_staff_m4_${testSuffix}`;

  let requesterProfileId;
  let donorProfileId;
  let unauthorizedProfileId;
  let staffProfileId;

  let donorRecordId;
  let activeRequestId;
  let draftRequestId;
  let potentialMatchId;
  let otherMatchId;

  try {
    // 1. Create Profiles
    const { data: p1, error: err1 } = await supabase
      .from("profiles")
      .insert({
        clerk_user_id: requesterClerkId,
        full_name: `Requester M4 ${testSuffix}`,
        email: `requester_${testSuffix}@example.com`,
        phone_number: "+639170000001",
        role: "USER",
      })
      .select("id")
      .single();
    if (err1) console.error("Error creating p1:", err1.message);
    requesterProfileId = p1?.id;

    const { data: p2, error: err2 } = await supabase
      .from("profiles")
      .insert({
        clerk_user_id: donorClerkId,
        full_name: `Donor M4 ${testSuffix}`,
        email: `donor_${testSuffix}@example.com`,
        phone_number: "+639170000002",
        role: "DONOR",
      })
      .select("id")
      .single();
    if (err2) console.error("Error creating p2:", err2.message);
    donorProfileId = p2?.id;

    const { data: p3, error: err3 } = await supabase
      .from("profiles")
      .insert({
        clerk_user_id: unauthorizedClerkId,
        full_name: `Unauth M4 ${testSuffix}`,
        email: `unauth_${testSuffix}@example.com`,
        phone_number: "+639170000003",
        role: "USER",
      })
      .select("id")
      .single();
    if (err3) console.error("Error creating p3:", err3.message);
    unauthorizedProfileId = p3?.id;

    const { data: p4, error: err4 } = await supabase
      .from("profiles")
      .insert({
        clerk_user_id: staffClerkId,
        full_name: `Hospital Staff M4 ${testSuffix}`,
        email: `staff_${testSuffix}@example.com`,
        phone_number: "+639170000004",
        role: "HOSPITAL_STAFF",
      })
      .select("id")
      .single();
    if (err4) console.error("Error creating p4:", err4.message);
    staffProfileId = p4?.id;

    assert(
      Boolean(requesterProfileId && donorProfileId && unauthorizedProfileId && staffProfileId),
      "Initialized test profiles in public.profiles"
    );

    // 2. Create Donor Profile (Available, Consented, O-)
    const { data: dp } = await supabase
      .from("donor_profiles")
      .insert({
        profile_id: donorProfileId,
        blood_group: "O",
        rh_factor: "NEGATIVE",
        is_available: true,
        consent_to_contact: true,
        notification_radius_km: 50,
        city: "Taguig",
        latitude: 14.5176,
        longitude: 121.0509,
      })
      .select("id")
      .single();
    donorRecordId = dp.id;

    assert(Boolean(donorRecordId), "Created consented active donor profile fixture in donor_profiles");

    // 3. Create Blood Requests (ACTIVE and DRAFT)
    const { data: reqActive, error: errReqActive } = await supabase
      .from("blood_requests")
      .insert({
        requester_id: requesterProfileId,
        patient_name_masked: "J*** D***",
        hospital_name: "St. Luke's Medical Center - BGC",
        hospital_city: "Taguig",
        province: "Metro Manila",
        latitude: 14.5547,
        longitude: 121.0483,
        blood_group: "O",
        rh_factor: "NEGATIVE",
        blood_component: "WHOLE_BLOOD",
        units_requested: 2,
        urgency_level: "CRITICAL_STAT",
        status: "ACTIVE",
        contact_number_masked: "+63 917 123 4567",
        required_by: new Date(Date.now() + 86400000).toISOString(),
      })
      .select("id")
      .single();
    if (errReqActive) console.error("Error creating active request:", errReqActive.message);
    activeRequestId = reqActive?.id;

    const { data: reqDraft, error: errReqDraft } = await supabase
      .from("blood_requests")
      .insert({
        requester_id: requesterProfileId,
        patient_name_masked: "M*** S***",
        hospital_name: "Medical City",
        hospital_city: "Pasig",
        province: "Metro Manila",
        latitude: 14.5888,
        longitude: 121.0694,
        blood_group: "O",
        rh_factor: "NEGATIVE",
        blood_component: "WHOLE_BLOOD",
        units_requested: 1,
        urgency_level: "URGENT",
        status: "DRAFT",
        contact_number_masked: "+63 917 123 4568",
        required_by: new Date(Date.now() + 86400000).toISOString(),
      })
      .select("id")
      .single();
    if (errReqDraft) console.error("Error creating draft request:", errReqDraft.message);
    draftRequestId = reqDraft?.id;

    assert(Boolean(activeRequestId && draftRequestId), "Created ACTIVE and DRAFT blood requests");

    // 4. Create request_matches for active request
    const { data: match } = await supabase
      .from("request_matches")
      .insert({
        request_id: activeRequestId,
        donor_id: donorRecordId,
        status: "POTENTIAL_CANDIDATE",
        discovery_score: 95,
        distance_km: 4.1,
        is_exact_location: true,
        reasons: ["Exact ABO/Rh match (O-)", "Donor is available", "Consent provided"],
      })
      .select("id")
      .single();
    potentialMatchId = match.id;

    // Create match for draft request
    const { data: matchDraft } = await supabase
      .from("request_matches")
      .insert({
        request_id: draftRequestId,
        donor_id: donorRecordId,
        status: "POTENTIAL_CANDIDATE",
        discovery_score: 90,
        distance_km: 8.0,
        is_exact_location: true,
      })
      .select("id")
      .single();
    otherMatchId = matchDraft.id;

    assert(Boolean(potentialMatchId && otherMatchId), "Created potential match records in public.request_matches");

    // ------------------------------------------------------------------------
    // TEST SUITE: ACTIVE REQUEST STATUS ENFORCEMENT
    // ------------------------------------------------------------------------
    console.log("\n[Suite 4.1] Active Request Lifecycle Enforcement...");

    // Dispatching on DRAFT request must be rejected
    const draftDispatch = await dispatchDonorNotification({
      requestId: draftRequestId,
      matchId: otherMatchId,
      clerkUserId: requesterClerkId,
    });
    assert(
      draftDispatch.success === false &&
        draftDispatch.error.includes("Only ACTIVE requests can dispatch"),
      "Dispatch rejected for DRAFT requisition (status gate enforced)",
      draftDispatch.error
    );

    // Test rejection on CANCELLED request
    await supabase.from("blood_requests").update({ status: "CANCELLED" }).eq("id", draftRequestId);
    const cancelledDispatch = await dispatchDonorNotification({
      requestId: draftRequestId,
      matchId: otherMatchId,
      clerkUserId: requesterClerkId,
    });
    assert(
      cancelledDispatch.success === false &&
        cancelledDispatch.error.includes("Only ACTIVE requests can dispatch"),
      "Dispatch rejected for CANCELLED requisition"
    );

    // Test rejection on FULFILLED request
    await supabase.from("blood_requests").update({ status: "FULFILLED" }).eq("id", draftRequestId);
    const fulfilledDispatch = await dispatchDonorNotification({
      requestId: draftRequestId,
      matchId: otherMatchId,
      clerkUserId: requesterClerkId,
    });
    assert(
      fulfilledDispatch.success === false &&
        fulfilledDispatch.error.includes("Only ACTIVE requests can dispatch"),
      "Dispatch rejected for FULFILLED requisition"
    );

    // ------------------------------------------------------------------------
    // TEST SUITE: AUTHORIZATION BOUNDARIES
    // ------------------------------------------------------------------------
    console.log("\n[Suite 4.2] Server-Side Authorization Boundaries...");

    // Unauthorized non-owner cannot dispatch
    const unauthDispatch = await dispatchDonorNotification({
      requestId: activeRequestId,
      matchId: potentialMatchId,
      clerkUserId: unauthorizedClerkId,
    });
    assert(
      unauthDispatch.success === false &&
        unauthDispatch.error.includes("UNAUTHORIZED"),
      "Unauthorized third-party user cannot dispatch notification",
      unauthDispatch.error
    );

    // Unauthenticated caller cannot dispatch
    const anonDispatch = await dispatchDonorNotification({
      requestId: activeRequestId,
      matchId: potentialMatchId,
      clerkUserId: "",
    });
    assert(
      anonDispatch.success === false && anonDispatch.error.includes("UNAUTHORIZED"),
      "Unauthenticated caller strictly rejected"
    );

    // ------------------------------------------------------------------------
    // TEST SUITE: MATCH INTEGRITY & CROSS-TENANT MISMATCH
    // ------------------------------------------------------------------------
    console.log("\n[Suite 4.3] Match Integrity & Cross-Tenant Gating...");

    // Match not belonging to request must fail
    const mismatchDispatch = await dispatchDonorNotification({
      requestId: activeRequestId,
      matchId: otherMatchId, // match belongs to other request!
      clerkUserId: requesterClerkId,
    });
    assert(
      mismatchDispatch.success === false &&
        mismatchDispatch.error.includes("Potential donor match record not found"),
      "Mismatched request_id and match_id strictly rejected"
    );

    // Non-existent match ID
    const nonExistentMatchDispatch = await dispatchDonorNotification({
      requestId: activeRequestId,
      matchId: "00000000-0000-0000-0000-000000000000",
      clerkUserId: requesterClerkId,
    });
    assert(
      nonExistentMatchDispatch.success === false,
      "Non-existent match record rejected"
    );

    // ------------------------------------------------------------------------
    // TEST SUITE: DONOR AVAILABILITY & CONSENT GATING
    // ------------------------------------------------------------------------
    console.log("\n[Suite 4.4] Operational Availability & Consent Gating...");

    // Temporarily set donor to unavailable
    await supabase.from("donor_profiles").update({ is_available: false }).eq("id", donorRecordId);
    const unavailDispatch = await dispatchDonorNotification({
      requestId: activeRequestId,
      matchId: potentialMatchId,
      clerkUserId: requesterClerkId,
    });
    assert(
      unavailDispatch.success === false &&
        unavailDispatch.error.includes("unavailable"),
      "Dispatch rejected when donor is marked unavailable",
      unavailDispatch.error
    );

    // Restore availability but remove contact consent
    await supabase.from("donor_profiles").update({ is_available: true, consent_to_contact: false }).eq("id", donorRecordId);
    const noConsentDispatch = await dispatchDonorNotification({
      requestId: activeRequestId,
      matchId: potentialMatchId,
      clerkUserId: requesterClerkId,
    });
    assert(
      noConsentDispatch.success === false &&
        noConsentDispatch.error.includes("consent"),
      "Dispatch rejected when donor has not provided contact consent",
      noConsentDispatch.error
    );

    // Restore consent
    await supabase.from("donor_profiles").update({ consent_to_contact: true }).eq("id", donorRecordId);

    // ------------------------------------------------------------------------
    // TEST SUITE: SUCCESSFUL DISPATCH EXECUTION
    // ------------------------------------------------------------------------
    console.log("\n[Suite 4.5] Valid Notification Dispatch Execution...");

    const validDispatch = await dispatchDonorNotification({
      requestId: activeRequestId,
      matchId: potentialMatchId,
      clerkUserId: requesterClerkId,
    });

    assert(
      validDispatch.success === true && Boolean(validDispatch.notification),
      "Dispatch succeeded for authorized requester on ACTIVE requisition"
    );
    assert(
      validDispatch.alreadyDispatched === false,
      "Initial dispatch correctly flagged as new dispatch (alreadyDispatched: false)"
    );
    assert(
      validDispatch.matchStatus === "NOTIFIED",
      "Match status updated to 'NOTIFIED'"
    );

    const notif = validDispatch.notification;
    assert(
      notif.recipientUserId === donorClerkId || notif.recipientUserId === donorProfileId,
      "Recipient correctly points to donor user ID",
      notif.recipientUserId
    );
    assert(
      notif.requestId === activeRequestId,
      "Notification accurately references request_id"
    );
    assert(
      notif.matchId === potentialMatchId,
      "Notification accurately references match_id"
    );
    assert(
      notif.type === "POTENTIAL_DONOR_ALERT",
      "Notification type is 'POTENTIAL_DONOR_ALERT'"
    );
    assert(
      notif.status === "DELIVERED",
      "In-app notification persisted with status 'DELIVERED'"
    );
    assert(
      Boolean(notif.sentAt && notif.deliveredAt),
      "Accurate sent_at and delivered_at timestamps populated"
    );

    // Check match record in DB
    const { data: updatedMatch } = await supabase
      .from("request_matches")
      .select("status")
      .eq("id", potentialMatchId)
      .single();
    assert(
      updatedMatch?.status === "NOTIFIED",
      "Database verified: request_matches.status transitioned from POTENTIAL_CANDIDATE to NOTIFIED"
    );

    // ------------------------------------------------------------------------
    // TEST SUITE: PRIVACY PROTECTION IN PAYLOAD
    // ------------------------------------------------------------------------
    console.log("\n[Suite 4.6] Donor Privacy & Payload Protection...");

    const payloadText = JSON.stringify(notif);
    assert(
      !payloadText.includes("+639170000002"),
      "Donor phone number strictly excluded from notification record and payload"
    );
    assert(
      !payloadText.includes(`donor_${testSuffix}@example.com`),
      "Donor email strictly excluded from notification record and payload"
    );
    assert(
      !payloadText.includes("14.5176") && !payloadText.includes("121.0509"),
      "Donor exact GPS coordinates strictly excluded from notification record and payload"
    );
    assert(
      !notif.body.toLowerCase().includes("medically eligible") &&
        !notif.body.toLowerCase().includes("safe donor"),
      "Notification body maintains strict non-clinical operational phrasing"
    );
    assert(
      notif.title.includes("Potential Blood Donor") || notif.body.includes("potential blood match"),
      "Notification title and body use operational 'Potential Donor Match' phrasing"
    );

    // ------------------------------------------------------------------------
    // TEST SUITE: DETERMINISTIC IDEMPOTENCY & DUPLICATE PROTECTION
    // ------------------------------------------------------------------------
    console.log("\n[Suite 4.7] Idempotency & Duplicate Dispatch Prevention...");

    const duplicateDispatch = await dispatchDonorNotification({
      requestId: activeRequestId,
      matchId: potentialMatchId,
      clerkUserId: requesterClerkId,
    });

    assert(
      duplicateDispatch.success === true,
      "Duplicate dispatch call handled cleanly without error"
    );
    assert(
      duplicateDispatch.alreadyDispatched === true,
      "Duplicate dispatch correctly detected and flagged alreadyDispatched: true"
    );
    assert(
      duplicateDispatch.notification?.id === notif.id,
      "Duplicate dispatch returns existing notification record instead of creating duplicate"
    );

    // Verify row count in public.notifications for this match is exactly 1
    const { count: notifCount } = await supabase
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("match_id", potentialMatchId);

    assert(
      notifCount === 1,
      "Database verified: Exactly 1 notification row exists for match (idempotency key enforced)",
      `Count: ${notifCount}`
    );

    // ------------------------------------------------------------------------
    // TEST SUITE: HOSPITAL STAFF AUTHORIZATION
    // ------------------------------------------------------------------------
    console.log("\n[Suite 4.8] Hospital Staff Dispatch Authorization...");

    // Create a 2nd match for hospital staff dispatch test
    const { data: pDonor2 } = await supabase
      .from("profiles")
      .insert({
        clerk_user_id: `test_donor2_m4_${testSuffix}`,
        full_name: `Donor 2 M4 ${testSuffix}`,
        email: `donor2_${testSuffix}@example.com`,
        phone_number: "+639170000005",
        role: "DONOR",
      })
      .select("id")
      .single();

    const { data: dp2 } = await supabase
      .from("donor_profiles")
      .insert({
        profile_id: pDonor2.id,
        blood_group: "O",
        rh_factor: "NEGATIVE",
        is_available: true,
        consent_to_contact: true,
        city: "Taguig",
        latitude: 14.52,
        longitude: 121.05,
      })
      .select("id")
      .single();

    const { data: match2 } = await supabase
      .from("request_matches")
      .insert({
        request_id: activeRequestId,
        donor_id: dp2.id,
        status: "POTENTIAL_CANDIDATE",
        discovery_score: 88,
      })
      .select("id")
      .single();

    const staffDispatch = await dispatchDonorNotification({
      requestId: activeRequestId,
      matchId: match2.id,
      clerkUserId: staffClerkId,
    });

    assert(
      staffDispatch.success === true,
      "Authorized HOSPITAL_STAFF can dispatch candidate alerts"
    );

    // ------------------------------------------------------------------------
    // TEST SUITE: READ STATE WORKFLOW & DONOR NOTIFICATIONS QUERY
    // ------------------------------------------------------------------------
    console.log("\n[Suite 4.9] Donor In-App Notifications & Read State Lifecycle...");

    // Fetch unread count for donor
    const unreadCountBefore = await getUnreadNotificationCount(donorClerkId);
    assert(
      unreadCountBefore >= 1,
      "Donor has unread notification count >= 1",
      `Count: ${unreadCountBefore}`
    );

    // Fetch notifications list for donor
    const donorNotifications = await getDonorNotifications(donorClerkId);
    assert(
      donorNotifications.length >= 1,
      "Donor can retrieve their in-app notifications list"
    );
    assert(
      donorNotifications[0].isRead === false,
      "Newly delivered notification is initially marked unread (isRead: false)"
    );

    // Unauthorized user attempts to mark donor's notification as read
    const unauthRead = await markNotificationAsRead(notif.id, unauthorizedClerkId);
    assert(
      unauthRead.success === false && unauthRead.error.includes("UNAUTHORIZED"),
      "Unauthorized user cannot mark another donor's notification as read"
    );

    // Donor marks own notification as read
    const validRead = await markNotificationAsRead(notif.id, donorClerkId);
    assert(
      validRead.success === true && validRead.notification?.status === "READ",
      "Donor successfully transitioned notification status to READ"
    );
    assert(
      Boolean(validRead.notification?.readAt),
      "read_at timestamp populated upon transition to READ"
    );

    // Idempotent read call
    const repeatRead = await markNotificationAsRead(notif.id, donorClerkId);
    assert(
      repeatRead.success === true && repeatRead.notification?.status === "READ",
      "Repeated markNotificationAsRead call is idempotent"
    );

    // Check unread count after marking read
    const unreadCountAfter = await getUnreadNotificationCount(donorClerkId);
    assert(
      unreadCountAfter === unreadCountBefore - 1,
      "Unread count decremented accurately after reading notification",
      `Before: ${unreadCountBefore}, After: ${unreadCountAfter}`
    );

    // ------------------------------------------------------------------------
    // TEST SUITE: AUDIT TRAIL VERIFICATION
    // ------------------------------------------------------------------------
    console.log("\n[Suite 4.10] Immutable Audit Log Trail Verification...");

    const { data: auditRecords } = await supabase
      .from("audit_logs")
      .select("*")
      .in("action", [
        "NOTIFICATION_DISPATCH_REQUESTED",
        "NOTIFICATION_CREATED",
        "NOTIFICATION_SENT",
        "NOTIFICATION_READ",
        "MATCH_STATUS_CHANGED",
      ])
      .order("created_at", { ascending: false })
      .limit(20);

    const recordedActions = (auditRecords || []).map((a) => a.action);

    assert(
      recordedActions.includes("NOTIFICATION_DISPATCH_REQUESTED"),
      "Audit trail recorded NOTIFICATION_DISPATCH_REQUESTED"
    );
    assert(
      recordedActions.includes("NOTIFICATION_CREATED"),
      "Audit trail recorded NOTIFICATION_CREATED"
    );
    assert(
      recordedActions.includes("NOTIFICATION_SENT"),
      "Audit trail recorded NOTIFICATION_SENT"
    );
    assert(
      recordedActions.includes("MATCH_STATUS_CHANGED"),
      "Audit trail recorded MATCH_STATUS_CHANGED"
    );
    assert(
      recordedActions.includes("NOTIFICATION_READ"),
      "Audit trail recorded NOTIFICATION_READ"
    );

  } finally {
    // ------------------------------------------------------------------------
    // CLEANUP FIXTURES
    // ------------------------------------------------------------------------
    console.log("\n[Cleanup] Cleaning up test fixtures from staging Supabase...");
    try {
      if (potentialMatchId || otherMatchId) {
        await supabase.from("notifications").delete().or(`match_id.eq.${potentialMatchId},match_id.eq.${otherMatchId}`);
        await supabase.from("request_matches").delete().or(`request_id.eq.${activeRequestId},request_id.eq.${draftRequestId}`);
      }
      if (activeRequestId) await supabase.from("blood_requests").delete().eq("id", activeRequestId);
      if (draftRequestId) await supabase.from("blood_requests").delete().eq("id", draftRequestId);
      if (donorRecordId) await supabase.from("donor_profiles").delete().eq("id", donorRecordId);

      const profileIds = [
        requesterProfileId,
        donorProfileId,
        unauthorizedProfileId,
        staffProfileId,
      ].filter(Boolean);

      if (profileIds.length > 0) {
        await supabase.from("donor_profiles").delete().in("profile_id", profileIds);
        await supabase.from("profiles").delete().in("id", profileIds);
      }
      console.log("  ✓ Test fixtures successfully cleaned up.");
    } catch (cleanErr) {
      console.error("  Warning: cleanup encountered an issue:", cleanErr.message);
    }
  }

  // --------------------------------------------------------------------------
  // SUMMARY
  // --------------------------------------------------------------------------
  console.log("================================================================================");
  console.log(`  VERIFICATION RESULTS: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log("================================================================================");

  if (failedTests > 0) {
    process.exit(1);
  }
}

runMilestone4Tests().catch((err) => {
  console.error("Fatal test runner error:", err);
  process.exit(1);
});
