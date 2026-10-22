/**
 * LIFE DROP: MILESTONE 6 AUTOMATED VERIFICATION TEST SUITE
 *
 * Validates:
 * Suite 1: Operational Donation State Machine (SCHEDULED, ATTENDED, RECORDED, CANCELLED, NO_SHOW)
 * Suite 2: Non-Clinical Medical Safety Boundary & Language Enforcement
 * Suite 3: Request Lifecycle Gating (ACTIVE accepted; DRAFT, CANCELLED, FULFILLED rejected)
 * Suite 4: Commitment Status Gating (ACCEPTED/PENDING accepted; WITHDRAWN/CANCELLED rejected)
 * Suite 5: Server-Side Authorization Boundaries (Donor self-actions vs. Clinical staff actions)
 * Suite 6: Valid Donation Appointment Scheduling (Correct request, commitment, donor relations)
 * Suite 7: Duplicate Prevention & Concurrency Simulation (Unique index, deterministic conflict resolution)
 * Suite 8: Operational Attendance Recording (SCHEDULED -> ATTENDED, checked_in sync)
 * Suite 9: Blood Donation Recording & Units Accounting (ATTENDED -> RECORDED, units incremented)
 * Suite 10: Requisition Fulfillment Threshold (Req status -> FULFILLED when quota met)
 * Suite 11: Appointment Cancellation Workflow (CANCELLED, reason preserved, rescheduling enabled)
 * Suite 12: No-Show Recording Workflow (NO_SHOW, units_committed decremented)
 * Suite 13: Donor Privacy Protection & Pseudonym Scoping (Zero phone, zero email, zero GPS in summaries)
 * Suite 14: Immutable Audit Logging Trail (All lifecycle events recorded in append-only ledger)
 * Suite 15: Live Staging Database Persistence & Teardown
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
  isValidDonationTransition,
  DONATION_SAFETY_DISCLAIMER,
} from "../lib/donations/types.js";
import {
  scheduleDonation,
  markDonationAttended,
  recordDonation,
  cancelDonationAppointment,
  markDonationNoShow,
  getRequestFulfillmentSummary,
  getDonorDonations,
} from "../lib/donations/service.js";

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

async function runMilestone6Tests() {
  console.log("================================================================================");
  console.log("  LIFE DROP: MILESTONE 6 VERIFICATION TEST SUITE");
  console.log("================================================================================");

  // --------------------------------------------------------------------------
  // SUITE 1: DONATION STATE MACHINE TRANSITIONS
  // --------------------------------------------------------------------------
  console.log("\n[Suite 1] Operational Donation State Machine Transitions...");

  assert(
    isValidDonationTransition("SCHEDULED", "ATTENDED"),
    "Donation: SCHEDULED -> ATTENDED is valid"
  );
  assert(
    isValidDonationTransition("SCHEDULED", "CANCELLED"),
    "Donation: SCHEDULED -> CANCELLED is valid"
  );
  assert(
    isValidDonationTransition("SCHEDULED", "NO_SHOW"),
    "Donation: SCHEDULED -> NO_SHOW is valid"
  );
  assert(
    isValidDonationTransition("ATTENDED", "RECORDED"),
    "Donation: ATTENDED -> RECORDED is valid"
  );
  assert(
    isValidDonationTransition("ATTENDED", "CANCELLED"),
    "Donation: ATTENDED -> CANCELLED is valid"
  );
  assert(
    !isValidDonationTransition("RECORDED", "ATTENDED"),
    "Donation: RECORDED -> ATTENDED is rejected (RECORDED is terminal)"
  );
  assert(
    !isValidDonationTransition("RECORDED", "CANCELLED"),
    "Donation: RECORDED -> CANCELLED is rejected (RECORDED is terminal)"
  );
  assert(
    !isValidDonationTransition("CANCELLED", "SCHEDULED"),
    "Donation: CANCELLED -> SCHEDULED is rejected (CANCELLED is terminal)"
  );
  assert(
    !isValidDonationTransition("NO_SHOW", "ATTENDED"),
    "Donation: NO_SHOW -> ATTENDED is rejected (NO_SHOW is terminal)"
  );
  assert(
    isValidDonationTransition("SCHEDULED", "SCHEDULED"),
    "Donation: SCHEDULED -> SCHEDULED is idempotent"
  );
  assert(
    isValidDonationTransition("RECORDED", "RECORDED"),
    "Donation: RECORDED -> RECORDED is idempotent"
  );

  // --------------------------------------------------------------------------
  // SUITE 2: NON-CLINICAL MEDICAL SAFETY BOUNDARY
  // --------------------------------------------------------------------------
  console.log("\n[Suite 2] Medical Safety Non-Clinical Guardrails...");

  const prohibitedPhrases = [
    "medically approved",
    "medically eligible",
    "safe donor",
    "guaranteed donor",
    "guaranteed match",
    "clinically approved",
    "cleared donor",
    "transfusion authorized",
  ];

  for (const phrase of prohibitedPhrases) {
    const found = DONATION_SAFETY_DISCLAIMER.toLowerCase().includes(phrase);
    assert(!found, `Safety disclaimer strictly avoids prohibited phrase: "${phrase}"`);
  }

  assert(
    DONATION_SAFETY_DISCLAIMER.includes("operational attendance") &&
      (DONATION_SAFETY_DISCLAIMER.includes("exclusively responsible") ||
        DONATION_SAFETY_DISCLAIMER.includes("exclusive responsibility")),
    "Safety disclaimer reinforces operational coordination and hospital screening"
  );

  // --------------------------------------------------------------------------
  // LIVE FIXTURE INITIALIZATION AGAINST STAGING SUPABASE
  // --------------------------------------------------------------------------
  const testSuffix = Math.random().toString(36).substring(2, 8);
  const requesterClerkId = `test_req_m6_${testSuffix}`;
  const donor1ClerkId = `test_d1_m6_${testSuffix}`;
  const donor2ClerkId = `test_d2_m6_${testSuffix}`;
  const strangerClerkId = `test_stranger_m6_${testSuffix}`;
  const staffClerkId = `test_staff_m6_${testSuffix}`;

  let requesterProfileId = "";
  let donor1ProfileId = "";
  let donor1RecordId = "";
  let donor2ProfileId = "";
  let donor2RecordId = "";
  let strangerProfileId = "";
  let staffProfileId = "";

  let activeRequestId = "";
  let draftRequestId = "";
  let cancelRequestId = "";

  let commitment1Id = "";
  let commitment2Id = "";
  let createdDonation1Id = "";
  let createdDonation2Id = "";

  console.log("\n[Setup] Initializing test fixtures in staging Supabase...");
  try {
    // 1. Create User Profiles
    const { data: pReq } = await supabase
      .from("profiles")
      .insert({
        clerk_user_id: requesterClerkId,
        full_name: `Requester M6 ${testSuffix}`,
        email: `req_${testSuffix}@example.com`,
        role: "USER",
      })
      .select("id")
      .single();
    requesterProfileId = pReq.id;

    const { data: pD1 } = await supabase
      .from("profiles")
      .insert({
        clerk_user_id: donor1ClerkId,
        full_name: `Donor 1 M6 ${testSuffix}`,
        email: `d1_${testSuffix}@example.com`,
        phone_number: "+639170000021",
        role: "DONOR",
      })
      .select("id")
      .single();
    donor1ProfileId = pD1.id;

    const { data: pD2 } = await supabase
      .from("profiles")
      .insert({
        clerk_user_id: donor2ClerkId,
        full_name: `Donor 2 M6 ${testSuffix}`,
        email: `d2_${testSuffix}@example.com`,
        phone_number: "+639170000022",
        role: "DONOR",
      })
      .select("id")
      .single();
    donor2ProfileId = pD2.id;

    const { data: pStranger } = await supabase
      .from("profiles")
      .insert({
        clerk_user_id: strangerClerkId,
        full_name: `Stranger M6 ${testSuffix}`,
        email: `stranger_${testSuffix}@example.com`,
        role: "DONOR",
      })
      .select("id")
      .single();
    strangerProfileId = pStranger.id;

    const { data: pStaff } = await supabase
      .from("profiles")
      .insert({
        clerk_user_id: staffClerkId,
        full_name: `Staff M6 ${testSuffix}`,
        email: `staff_${testSuffix}@example.com`,
        role: "HOSPITAL_STAFF",
        hospital_affiliation: "Philippine General Hospital",
      })
      .select("id")
      .single();
    staffProfileId = pStaff.id;

    // 2. Create Donor Profiles
    const { data: dp1 } = await supabase
      .from("donor_profiles")
      .insert({
        profile_id: donor1ProfileId,
        blood_group: "O",
        rh_factor: "NEGATIVE",
        is_available: true,
        consent_to_contact: true,
        notification_radius_km: 50,
        city: "Manila",
        latitude: 14.5995,
        longitude: 120.9842,
      })
      .select("id")
      .single();
    donor1RecordId = dp1.id;

    const { data: dp2 } = await supabase
      .from("donor_profiles")
      .insert({
        profile_id: donor2ProfileId,
        blood_group: "O",
        rh_factor: "NEGATIVE",
        is_available: true,
        consent_to_contact: true,
        notification_radius_km: 50,
        city: "Manila",
        latitude: 14.6,
        longitude: 120.98,
      })
      .select("id")
      .single();
    donor2RecordId = dp2.id;

    // 3. Create Blood Requests
    const { data: reqActive } = await supabase
      .from("blood_requests")
      .insert({
        requester_id: requesterProfileId,
        patient_name_masked: "J*** D***",
        hospital_name: "Philippine General Hospital",
        hospital_city: "Manila",
        province: "Metro Manila",
        latitude: 14.5772,
        longitude: 120.9858,
        blood_group: "O",
        rh_factor: "NEGATIVE",
        blood_component: "WHOLE_BLOOD",
        units_requested: 2,
        units_committed: 2,
        units_donated: 0,
        urgency_level: "URGENT",
        status: "ACTIVE",
        contact_number_masked: "+63 917 000 0000",
        required_by: new Date(Date.now() + 86400000).toISOString(),
      })
      .select("id")
      .single();
    activeRequestId = reqActive.id;

    const { data: reqDraft } = await supabase
      .from("blood_requests")
      .insert({
        requester_id: requesterProfileId,
        patient_name_masked: "T*** K***",
        hospital_name: "Philippine General Hospital",
        hospital_city: "Manila",
        province: "Metro Manila",
        latitude: 14.5772,
        longitude: 120.9858,
        blood_group: "O",
        rh_factor: "NEGATIVE",
        blood_component: "WHOLE_BLOOD",
        units_requested: 1,
        units_committed: 0,
        units_donated: 0,
        urgency_level: "ROUTINE",
        status: "DRAFT",
        contact_number_masked: "+63 917 000 0001",
        required_by: new Date(Date.now() + 86400000).toISOString(),
      })
      .select("id")
      .single();
    draftRequestId = reqDraft.id;

    // Create a secondary active request for testing cancellation & no-show independently
    const { data: reqCancel } = await supabase
      .from("blood_requests")
      .insert({
        requester_id: requesterProfileId,
        patient_name_masked: "C*** D***",
        hospital_name: "Philippine General Hospital",
        hospital_city: "Manila",
        province: "Metro Manila",
        latitude: 14.5772,
        longitude: 120.9858,
        blood_group: "O",
        rh_factor: "NEGATIVE",
        blood_component: "WHOLE_BLOOD",
        units_requested: 3,
        units_committed: 1,
        units_donated: 0,
        urgency_level: "ROUTINE",
        status: "ACTIVE",
        contact_number_masked: "+63 917 000 0002",
        required_by: new Date(Date.now() + 86400000).toISOString(),
      })
      .select("id")
      .single();
    cancelRequestId = reqCancel.id;

    // 4. Create Active Commitments for Donor 1 and Donor 2
    const { data: c1 } = await supabase
      .from("donor_commitments")
      .insert({
        request_id: activeRequestId,
        donor_id: donor1ProfileId,
        donor_profile_id: donor1RecordId,
        response: "INTERESTED",
        status: "ACCEPTED",
        committed_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    commitment1Id = c1.id;

    const { data: c2 } = await supabase
      .from("donor_commitments")
      .insert({
        request_id: activeRequestId,
        donor_id: donor2ProfileId,
        donor_profile_id: donor2RecordId,
        response: "INTERESTED",
        status: "ACCEPTED",
        committed_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    commitment2Id = c2.id;

    assert(
      Boolean(activeRequestId && commitment1Id && commitment2Id),
      "Initialized staging blood request and accepted donor commitments"
    );

    // ------------------------------------------------------------------------
    // SUITE 3: REQUEST LIFECYCLE GATING
    // ------------------------------------------------------------------------
    console.log("\n[Suite 3] Request Lifecycle Gating...");

    // Commitment on DRAFT request
    const { data: cDraft } = await supabase
      .from("donor_commitments")
      .insert({
        request_id: draftRequestId,
        donor_id: donor1ProfileId,
        donor_profile_id: donor1RecordId,
        response: "INTERESTED",
        status: "ACCEPTED",
      })
      .select("id")
      .single();

    const draftScheduleRes = await scheduleDonation({
      commitmentId: cDraft.id,
      clerkUserId: donor1ClerkId,
    });

    assert(
      draftScheduleRes.success === false &&
        draftScheduleRes.error.includes("Only active requests can schedule donations"),
      "Scheduling rejected for DRAFT requisition (status gate enforced)",
      draftScheduleRes.error
    );

    // Test rejection on CANCELLED request
    await supabase.from("blood_requests").update({ status: "CANCELLED" }).eq("id", draftRequestId);
    const cancelledScheduleRes = await scheduleDonation({
      commitmentId: cDraft.id,
      clerkUserId: donor1ClerkId,
    });
    assert(
      cancelledScheduleRes.success === false &&
        cancelledScheduleRes.error.includes("Only active requests can schedule donations"),
      "Scheduling rejected for CANCELLED requisition"
    );

    // ------------------------------------------------------------------------
    // SUITE 4: COMMITMENT STATUS GATING
    // ------------------------------------------------------------------------
    console.log("\n[Suite 4] Commitment Status Gating...");

    const { data: cWithdrawn } = await supabase
      .from("donor_commitments")
      .insert({
        request_id: activeRequestId,
        donor_id: strangerProfileId,
        response: "INTERESTED",
        status: "WITHDRAWN",
        withdrawn_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    const withdrawnScheduleRes = await scheduleDonation({
      commitmentId: cWithdrawn.id,
      clerkUserId: strangerClerkId,
    });

    assert(
      withdrawnScheduleRes.success === false &&
        withdrawnScheduleRes.error.includes("WITHDRAWN"),
      "Scheduling rejected for WITHDRAWN commitment (active commitment required)"
    );

    // ------------------------------------------------------------------------
    // SUITE 5: SERVER-SIDE AUTHORIZATION BOUNDARIES
    // ------------------------------------------------------------------------
    console.log("\n[Suite 5] Server-Side Authorization Boundaries...");

    // Stranger cannot schedule Donor 1's commitment
    const unauthSchedule = await scheduleDonation({
      commitmentId: commitment1Id,
      clerkUserId: strangerClerkId,
    });
    assert(
      unauthSchedule.success === false && unauthSchedule.error.includes("UNAUTHORIZED"),
      "Unauthorized donor cannot schedule another donor's commitment (cross-donor breach blocked)"
    );

    // Non-staff donor cannot mark attendance
    const unauthAttend = await markDonationAttended({
      donationId: commitment1Id, // dummy UUID
      clerkUserId: donor1ClerkId,
    });
    assert(
      unauthAttend.success === false && unauthAttend.error.includes("UNAUTHORIZED"),
      "Non-staff donor strictly prohibited from marking attendance"
    );

    // Non-staff donor cannot record donation
    const unauthRecord = await recordDonation({
      donationId: commitment1Id, // dummy UUID
      unitsDonated: 1,
      componentType: "WHOLE_BLOOD",
      clerkUserId: donor1ClerkId,
    });
    assert(
      unauthRecord.success === false && unauthRecord.error.includes("UNAUTHORIZED"),
      "Non-staff donor strictly prohibited from recording blood donation"
    );

    // ------------------------------------------------------------------------
    // SUITE 6: VALID DONATION APPOINTMENT SCHEDULING
    // ------------------------------------------------------------------------
    console.log("\n[Suite 6] Valid Donation Appointment Scheduling...");

    const scheduleRes = await scheduleDonation({
      commitmentId: commitment1Id,
      scheduledAt: new Date(Date.now() + 3600000).toISOString(),
      facilityName: "Philippine General Hospital",
      notes: "First time voluntary blood donation",
      clerkUserId: donor1ClerkId,
    });

    assert(
      scheduleRes.success === true && Boolean(scheduleRes.donation),
      "Donor 1 successfully scheduled donation appointment"
    );

    const don1 = scheduleRes.donation;
    createdDonation1Id = don1?.id;

    assert(don1?.status === "SCHEDULED", "Donation initialized in SCHEDULED status");
    assert(don1?.requestId === activeRequestId, "Donation accurately references request_id");
    assert(don1?.commitmentId === commitment1Id, "Donation accurately references commitment_id");
    assert(don1?.donorId === donor1ProfileId, "Donation accurately references donor_id");
    assert(
      don1?.facilityName === "Philippine General Hospital",
      "Donation facility name accurately stored"
    );
    assert(Boolean(don1?.scheduledAt), "Donation scheduled_at timestamp populated");

    // Database check: Commitment status transitioned to SCHEDULED
    const { data: dbC1 } = await supabase
      .from("donor_commitments")
      .select("status, scheduled_at")
      .eq("id", commitment1Id)
      .single();
    assert(
      dbC1?.status === "SCHEDULED" && Boolean(dbC1?.scheduled_at),
      "Database verified: donor_commitments.status transitioned to SCHEDULED"
    );

    // ------------------------------------------------------------------------
    // SUITE 7: DUPLICATE PREVENTION & CONCURRENCY
    // ------------------------------------------------------------------------
    console.log("\n[Suite 7] Duplicate Prevention & Concurrency...");

    // Repeated call is idempotent
    const repeatSchedule = await scheduleDonation({
      commitmentId: commitment1Id,
      clerkUserId: donor1ClerkId,
    });

    assert(
      repeatSchedule.success === true && repeatSchedule.alreadyProcessed === true,
      "Repeated schedule call succeeds idempotently without error"
    );
    assert(
      repeatSchedule.donation?.id === createdDonation1Id,
      "Repeated call deterministically returns existing donation record"
    );

    // Check DB count for commitment 1
    const { count: don1Count } = await supabase
      .from("donations")
      .select("*", { count: "exact", head: true })
      .eq("commitment_id", commitment1Id);

    assert(
      don1Count === 1,
      "Database verified: Exactly 1 active donation row exists for commitment (no duplicates created)",
      `Count: ${don1Count}`
    );

    // Concurrency simulation for Donor 2 commitment
    const [raceRes1, raceRes2] = await Promise.all([
      scheduleDonation({
        commitmentId: commitment2Id,
        facilityName: "Philippine General Hospital",
        clerkUserId: donor2ClerkId,
      }),
      scheduleDonation({
        commitmentId: commitment2Id,
        facilityName: "Philippine General Hospital",
        clerkUserId: donor2ClerkId,
      }),
    ]);

    assert(
      raceRes1.success === true && raceRes2.success === true,
      "Concurrent scheduling calls handled safely without crash"
    );
    assert(
      raceRes1.donation?.id === raceRes2.donation?.id,
      "Concurrent submissions deterministically resolve to the same donation ID"
    );
    createdDonation2Id = raceRes1.donation?.id;

    // ------------------------------------------------------------------------
    // SUITE 8: OPERATIONAL ATTENDANCE RECORDING
    // ------------------------------------------------------------------------
    console.log("\n[Suite 8] Operational Attendance Recording...");

    const attendRes = await markDonationAttended({
      donationId: createdDonation1Id,
      notes: "Donor arrived on time at Blood Bank Receiving Station",
      clerkUserId: staffClerkId,
    });

    assert(
      attendRes.success === true && attendRes.donation?.status === "ATTENDED",
      "Hospital staff successfully marked donor attendance"
    );
    assert(Boolean(attendRes.donation?.attendedAt), "attended_at timestamp recorded");

    // Database check: Commitment status CHECKED_IN
    const { data: dbC1CheckedIn } = await supabase
      .from("donor_commitments")
      .select("status, checked_in_at")
      .eq("id", commitment1Id)
      .single();
    assert(
      dbC1CheckedIn?.status === "CHECKED_IN" && Boolean(dbC1CheckedIn?.checked_in_at),
      "Database verified: donor_commitments.status updated to CHECKED_IN"
    );

    // Repeated call is idempotent
    const repeatAttend = await markDonationAttended({
      donationId: createdDonation1Id,
      clerkUserId: staffClerkId,
    });
    assert(
      repeatAttend.success === true && repeatAttend.alreadyProcessed === true,
      "Repeated mark attendance call is idempotent"
    );

    // ------------------------------------------------------------------------
    // SUITE 9: BLOOD DONATION RECORDING & UNITS INCREMENT
    // ------------------------------------------------------------------------
    console.log("\n[Suite 9] Blood Donation Recording & Units Increment...");

    const recordRes1 = await recordDonation({
      donationId: createdDonation1Id,
      unitsDonated: 1,
      componentType: "WHOLE_BLOOD",
      notes: "450 mL whole blood collected successfully without adverse event",
      clerkUserId: staffClerkId,
    });

    assert(
      recordRes1.success === true && recordRes1.donation?.status === "RECORDED",
      "Hospital staff successfully recorded blood donation"
    );
    assert(
      recordRes1.donation?.unitsDonated === 1,
      "unitsDonated recorded accurately as 1 unit"
    );
    assert(Boolean(recordRes1.donation?.recordedAt), "recorded_at timestamp populated");

    // Database check: Requisition units_donated incremented
    const { data: reqAfter1 } = await supabase
      .from("blood_requests")
      .select("units_donated, units_requested, status")
      .eq("id", activeRequestId)
      .single();

    assert(
      reqAfter1?.units_donated === 1,
      "Database verified: blood_requests.units_donated incremented to 1",
      `Donated: ${reqAfter1?.units_donated} of ${reqAfter1?.units_requested}`
    );
    assert(
      reqAfter1?.status === "ACTIVE",
      "Database verified: Requisition remains ACTIVE (1 of 2 units collected, need remaining)"
    );

    // Database check: Commitment updated to COMPLETED
    const { data: c1Completed } = await supabase
      .from("donor_commitments")
      .select("status, units_donated, completed_at")
      .eq("id", commitment1Id)
      .single();
    assert(
      c1Completed?.status === "COMPLETED" && c1Completed?.units_donated === 1,
      "Database verified: donor_commitments.status transitioned to COMPLETED"
    );

    // ------------------------------------------------------------------------
    // SUITE 10: FULL REQUISITION FULFILLMENT THRESHOLD
    // ------------------------------------------------------------------------
    console.log("\n[Suite 10] Requisition Fulfillment Threshold...");

    // Record second donor collection (units = 1) -> brings total to 2 of 2
    await markDonationAttended({
      donationId: createdDonation2Id,
      clerkUserId: staffClerkId,
    });

    const recordRes2 = await recordDonation({
      donationId: createdDonation2Id,
      unitsDonated: 1,
      componentType: "WHOLE_BLOOD",
      clerkUserId: staffClerkId,
    });

    assert(
      recordRes2.success === true && recordRes2.donation?.status === "RECORDED",
      "Second donor donation recorded successfully"
    );

    // Check requisition status is now FULFILLED!
    const { data: reqFulfilled } = await supabase
      .from("blood_requests")
      .select("units_donated, units_requested, status")
      .eq("id", activeRequestId)
      .single();

    assert(
      reqFulfilled?.units_donated === 2,
      "Database verified: Total units_donated reached requested quota (2/2)",
      `Units: ${reqFulfilled?.units_donated}`
    );
    assert(
      reqFulfilled?.status === "FULFILLED",
      "Database verified: blood_requests.status transitioned to FULFILLED",
      `Status: ${reqFulfilled?.status}`
    );

    // ------------------------------------------------------------------------
    // SUITE 11: APPOINTMENT CANCELLATION WORKFLOW
    // ------------------------------------------------------------------------
    console.log("\n[Suite 11] Appointment Cancellation Workflow...");

    // Create a third commitment & donation on cancelRequestId for testing cancellation
    const { data: c3 } = await supabase
      .from("donor_commitments")
      .insert({
        request_id: cancelRequestId,
        donor_id: strangerProfileId,
        response: "INTERESTED",
        status: "ACCEPTED",
      })
      .select("id")
      .single();

    const schedule3 = await scheduleDonation({
      commitmentId: c3.id,
      clerkUserId: strangerClerkId,
    });
    const donation3Id = schedule3.donation?.id;

    // Donor cancels appointment
    const cancelRes = await cancelDonationAppointment({
      donationId: donation3Id,
      reason: "Unexpected urgent travel commitment",
      clerkUserId: strangerClerkId,
    });

    assert(
      cancelRes.success === true && cancelRes.donation?.status === "CANCELLED",
      "Donor successfully cancelled donation appointment"
    );
    assert(
      cancelRes.donation?.cancellationReason === "Unexpected urgent travel commitment",
      "Cancellation reason accurately preserved in record"
    );
    assert(Boolean(cancelRes.donation?.cancelledAt), "cancelled_at timestamp populated");

    // Database check: Commitment reverted to ACCEPTED for potential rescheduling
    const { data: dbC3Reverted } = await supabase
      .from("donor_commitments")
      .select("status")
      .eq("id", c3.id)
      .single();
    assert(
      dbC3Reverted?.status === "ACCEPTED",
      "Database verified: Commitment reverted to ACCEPTED (rescheduling enabled)"
    );

    // ------------------------------------------------------------------------
    // SUITE 12: NO-SHOW RECORDING WORKFLOW
    // ------------------------------------------------------------------------
    console.log("\n[Suite 12] No-Show Recording Workflow...");

    // Schedule again for c3
    const scheduleAgain = await scheduleDonation({
      commitmentId: c3.id,
      clerkUserId: strangerClerkId,
    });
    const donation4Id = scheduleAgain.donation?.id;

    // Hospital staff records no-show
    const noShowRes = await markDonationNoShow({
      donationId: donation4Id,
      reason: "Donor failed to arrive within scheduled window",
      clerkUserId: staffClerkId,
    });

    assert(
      noShowRes.success === true && noShowRes.donation?.status === "NO_SHOW",
      "Hospital staff successfully recorded donor no-show"
    );
    assert(Boolean(noShowRes.donation?.noShowAt), "no_show_at timestamp populated");

    // Database check: Commitment marked NO_SHOW
    const { data: dbC3NoShow } = await supabase
      .from("donor_commitments")
      .select("status")
      .eq("id", c3.id)
      .single();
    assert(
      dbC3NoShow?.status === "NO_SHOW",
      "Database verified: Commitment status transitioned to NO_SHOW"
    );

    // ------------------------------------------------------------------------
    // SUITE 13: DONOR PRIVACY PROTECTION & PSEUDONYM SCOPING
    // ------------------------------------------------------------------------
    console.log("\n[Suite 13] Donor Privacy Protection...");

    const fulfillmentSummary = await getRequestFulfillmentSummary(
      activeRequestId,
      requesterClerkId
    );

    assert(Boolean(fulfillmentSummary), "Requisition owner can retrieve fulfillment summary");
    assert(
      fulfillmentSummary?.unitsRequested === 2 && fulfillmentSummary?.unitsDonated === 2,
      "Fulfillment summary accurately computes units requested and donated"
    );
    assert(
      fulfillmentSummary?.isFulfilled === true,
      "Fulfillment summary accurately flags isFulfilled: true"
    );
    assert(
      fulfillmentSummary?.remainingUnits === 0,
      "Fulfillment summary accurately computes remainingUnits: 0"
    );

    // Privacy checks on returned donations
    for (const d of fulfillmentSummary?.donations || []) {
      assert(
        d.donorPseudonym.startsWith("DONOR-"),
        "Donation exposes safe donor pseudonym",
        d.donorPseudonym
      );
      assert(!("phoneNumber" in d), "Donation strictly DOES NOT expose phone number");
      assert(!("email" in d), "Donation strictly DOES NOT expose email address");
      assert(!("latitude" in d), "Donation strictly DOES NOT expose GPS coordinates");
      assert(!("streetAddress" in d), "Donation strictly DOES NOT expose street address");
    }

    // Donor can retrieve their own donations history
    const donorHistory = await getDonorDonations(donor1ClerkId);
    assert(
      donorHistory.success === true && donorHistory.donations.length > 0,
      "Donor can view their own donation record history"
    );

    // ------------------------------------------------------------------------
    // SUITE 14: IMMUTABLE AUDIT LOGGING TRAIL
    // ------------------------------------------------------------------------
    console.log("\n[Suite 14] Immutable Audit Trail Verification...");

    const { data: auditEvents } = await supabase
      .from("audit_logs")
      .select("action")
      .in("action", [
        "DONATION_SCHEDULED",
        "DONATION_ATTENDED",
        "DONATION_RECORDED",
        "DONATION_CANCELLED",
        "DONATION_NO_SHOW",
        "FULFILLMENT_PROGRESS_UPDATED",
        "REQUEST_FULFILLED",
      ]);

    const loggedActions = new Set(auditEvents?.map((a) => a.action));

    assert(loggedActions.has("DONATION_SCHEDULED"), "Audit trail recorded DONATION_SCHEDULED");
    assert(loggedActions.has("DONATION_ATTENDED"), "Audit trail recorded DONATION_ATTENDED");
    assert(loggedActions.has("DONATION_RECORDED"), "Audit trail recorded DONATION_RECORDED");
    assert(loggedActions.has("DONATION_CANCELLED"), "Audit trail recorded DONATION_CANCELLED");
    assert(loggedActions.has("DONATION_NO_SHOW"), "Audit trail recorded DONATION_NO_SHOW");
    assert(
      loggedActions.has("FULFILLMENT_PROGRESS_UPDATED"),
      "Audit trail recorded FULFILLMENT_PROGRESS_UPDATED"
    );
    assert(loggedActions.has("REQUEST_FULFILLED"), "Audit trail recorded REQUEST_FULFILLED");

  } finally {
    // ------------------------------------------------------------------------
    // SUITE 15: CLEAN STAGING DATABASE TEARDOWN
    // ------------------------------------------------------------------------
    console.log("\n[Suite 15] Cleaning up test fixtures from staging Supabase...");
    try {
      if (activeRequestId) {
        await supabase.from("donations").delete().eq("request_id", activeRequestId);
        await supabase.from("donor_commitments").delete().eq("request_id", activeRequestId);
        await supabase.from("request_matches").delete().eq("request_id", activeRequestId);
        await supabase.from("blood_requests").delete().eq("id", activeRequestId);
      }
      if (draftRequestId) {
        await supabase.from("donations").delete().eq("request_id", draftRequestId);
        await supabase.from("donor_commitments").delete().eq("request_id", draftRequestId);
        await supabase.from("blood_requests").delete().eq("id", draftRequestId);
      }
      if (cancelRequestId) {
        await supabase.from("donations").delete().eq("request_id", cancelRequestId);
        await supabase.from("donor_commitments").delete().eq("request_id", cancelRequestId);
        await supabase.from("blood_requests").delete().eq("id", cancelRequestId);
      }
      if (donor1RecordId) {
        await supabase.from("donor_profiles").delete().eq("id", donor1RecordId);
      }
      if (donor2RecordId) {
        await supabase.from("donor_profiles").delete().eq("id", donor2RecordId);
      }
      const testProfiles = [
        requesterProfileId,
        donor1ProfileId,
        donor2ProfileId,
        strangerProfileId,
        staffProfileId,
      ].filter(Boolean);
      if (testProfiles.length > 0) {
        await supabase.from("profiles").delete().in("id", testProfiles);
      }
      console.log("  ✓ Test fixtures successfully cleaned up.");
    } catch (cleanupErr) {
      console.warn("  ⚠️ Warning during cleanup:", cleanupErr.message);
    }
  }

  console.log("================================================================================");
  console.log(`  VERIFICATION RESULTS: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log("================================================================================");

  if (failedTests > 0) {
    process.exit(1);
  }
}

runMilestone6Tests().catch((err) => {
  console.error("Fatal test runner error:", err);
  process.exit(1);
});
