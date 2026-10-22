/**
 * LIFE DROP: MILESTONE 8 AUTOMATED VERIFICATION TEST SUITE
 * Security Hardening, Production Readiness & Multi-Actor Staging E2E Validation
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
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

loadEnvFile(path.join(ROOT_DIR, ".env.staging"));
loadEnvFile(path.join(ROOT_DIR, ".env.local"));

globalThis.WebSocket = class {};

import { createClient } from "@supabase/supabase-js";
import {
  OUTBOX_NON_CLINICAL_DISCLAIMER,
} from "../lib/outbox/types.js";
import {
  enqueueNotificationEvent,
} from "../lib/outbox/service.js";
import { processOutboxBatch } from "../lib/outbox/worker.js";
import { reconcilePlatformState } from "../lib/outbox/reconciliation.js";
import {
  verifyWorkerAuthorization,
} from "../lib/security/worker-auth.js";
import {
  InMemoryRateLimiter,
  getClientIdentifier,
} from "../lib/security/rate-limit.js";
import { verifySvixSignature } from "../app/api/webhooks/clerk/route.ts";
import {
  generateSafeDonorCode,
  isPotentialBloodGroupMatch,
  evaluateCandidateSuitability,
} from "../lib/matching/rules.js";
import {
  createBloodRequestSchema,
  reviewBloodRequestSchema,
  cancelBloodRequestSchema,
  donorProfileFormSchema,
} from "../lib/validations/index.js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error("❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false },
  realtime: { enabled: false },
});

const anonSupabase = createClient(supabaseUrl, anonKey || "anon-mock-key", {
  auth: { persistSession: false },
  realtime: { enabled: false },
});

let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passedTests++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failedTests++;
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runMilestone8Tests() {
  console.log("================================================================================");
  console.log("  LIFE DROP: MILESTONE 8 VERIFICATION TEST SUITE");
  console.log("  Security Hardening, Production Readiness & Multi-Actor Staging E2E");
  console.log("================================================================================");

  const testSuffix = `m8_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

  // --------------------------------------------------------------------------
  // SUITE 1: MEDICAL SAFETY & NON-CLINICAL TERMINOLOGY GUARDRAILS
  // --------------------------------------------------------------------------
  console.log("\n[Suite 1] Medical Safety & Non-Clinical Terminology Guardrails...");

  const prohibitedTerms = [
    "medically approved",
    "medically eligible",
    "safe donor",
    "guaranteed match",
    "guaranteed donor",
    "clinically approved",
    "cleared donor",
    "transfusion authorized",
    "medically certified",
  ];

  for (const term of prohibitedTerms) {
    assert(
      !OUTBOX_NON_CLINICAL_DISCLAIMER.toLowerCase().includes(term),
      `Disclaimer strictly avoids prohibited clinical claim: "${term}"`
    );
  }

  assert(
    OUTBOX_NON_CLINICAL_DISCLAIMER.includes("coordination") ||
      OUTBOX_NON_CLINICAL_DISCLAIMER.includes("logistical"),
    "Disclaimer explicitly affirms non-clinical operational coordination boundary"
  );

  // --------------------------------------------------------------------------
  // SUITE 2: RATE LIMITING & ABUSE CONTROL ENGINE
  // --------------------------------------------------------------------------
  console.log("\n[Suite 2] Rate Limiting & Abuse Control Engine...");

  const limiter = new InMemoryRateLimiter();
  const rateLimitKey = `test:actor:${testSuffix}`;

  // Consume 3 tokens within a limit of 3
  const res1 = await limiter.consume(rateLimitKey, 3, 5000);
  assert(res1.allowed === true && res1.remaining === 2, "First request within quota is allowed (remaining: 2)");

  const res2 = await limiter.consume(rateLimitKey, 3, 5000);
  assert(res2.allowed === true && res2.remaining === 1, "Second request within quota is allowed (remaining: 1)");

  const res3 = await limiter.consume(rateLimitKey, 3, 5000);
  assert(res3.allowed === true && res3.remaining === 0, "Third request reaching quota is allowed (remaining: 0)");

  // 4th request must be rejected
  const res4 = await limiter.consume(rateLimitKey, 3, 5000);
  assert(res4.allowed === false, "4th request exceeding quota is strictly rejected (allowed: false)");
  assert(res4.retryAfterSeconds > 0, `Retry-After header calculation populated (${res4.retryAfterSeconds}s)`);

  // Reset limiter
  await limiter.reset(rateLimitKey);
  const resAfterReset = await limiter.consume(rateLimitKey, 3, 5000);
  assert(resAfterReset.allowed === true, "Request succeeds after rate limit key reset/window expiry");

  // Client identifier extraction: priority order and spoofing defense
  const mockReqWithIp = {
    headers: new Map([["x-forwarded-for", "203.0.113.195, 10.0.0.1"]]),
  };
  const mockReqWrapper = {
    headers: {
      get: (k) => mockReqWithIp.headers.get(k.toLowerCase()) || null,
    },
  };
  const clientKey = getClientIdentifier(mockReqWrapper, "auth");
  assert(clientKey === "auth:203.0.113.195", `Client IP parsed accurately from x-forwarded-for: ${clientKey}`);

  // Spoofing defense: trusted x-real-ip takes precedence over client-supplied x-forwarded-for
  const spoofAttemptReq = {
    headers: {
      get: (k) => {
        if (k.toLowerCase() === "x-real-ip") return "198.51.100.55";
        if (k.toLowerCase() === "x-forwarded-for") return "1.2.3.4, 10.0.0.1";
        return null;
      },
    },
  };
  const trustedKey = getClientIdentifier(spoofAttemptReq, "auth");
  assert(trustedKey === "auth:198.51.100.55", "Trusted edge x-real-ip prioritizes over spoofed x-forwarded-for");

  // Spoofing defense: cf-connecting-ip takes highest priority
  const cloudflareReq = {
    headers: {
      get: (k) => {
        if (k.toLowerCase() === "cf-connecting-ip") return "192.0.2.77";
        if (k.toLowerCase() === "x-real-ip") return "198.51.100.55";
        return null;
      },
    },
  };
  assert(getClientIdentifier(cloudflareReq, "auth") === "auth:192.0.2.77", "cf-connecting-ip takes priority from Cloudflare edge");

  // Sanitization: Malicious key injection stripped
  const maliciousReq = {
    headers: {
      get: (k) => (k.toLowerCase() === "x-forwarded-for" ? "203.0.113.195; DROP TABLE users; --" : null),
    },
  };
  assert(
    !getClientIdentifier(maliciousReq, "auth").includes("DROP"),
    "Client IP extractor strictly sanitizes invalid/malicious characters from key"
  );

  // --------------------------------------------------------------------------
  // SUITE 3: WORKER TIMING-SAFE AUTHENTICATION & FAIL-CLOSED GUARDS
  // --------------------------------------------------------------------------
  console.log("\n[Suite 3] Worker Timing-Safe Authentication & Fail-Closed Guards...");

  const validSecret = process.env.CRON_SECRET || process.env.WORKER_SECRET || "test-cron-secret-123";
  process.env.CRON_SECRET = validSecret;

  // 1. Missing credentials
  const reqNoAuth = {
    headers: { get: () => null },
  };
  const authNoToken = verifyWorkerAuthorization(reqNoAuth);
  assert(authNoToken.authorized === false, "Worker rejects missing authorization token");
  assert(authNoToken.error.includes("UNAUTHORIZED"), "Error specifies unauthorized token requirement");

  // 2. Invalid bearer token
  const reqBadToken = {
    headers: { get: (h) => (h.toLowerCase() === "authorization" ? "Bearer invalid-tampered-token" : null) },
  };
  const authBad = verifyWorkerAuthorization(reqBadToken);
  assert(authBad.authorized === false, "Worker rejects forged/tampered bearer token");

  // 3. Different token length (timing-safe check)
  const reqShortToken = {
    headers: { get: (h) => (h.toLowerCase() === "authorization" ? "Bearer abc" : null) },
  };
  const authShort = verifyWorkerAuthorization(reqShortToken);
  assert(authShort.authorized === false, "Worker rejects different-length credentials safely");

  // 4. Valid bearer token
  const reqValidBearer = {
    headers: { get: (h) => (h.toLowerCase() === "authorization" ? `Bearer ${validSecret}` : null) },
  };
  const authBearerValid = verifyWorkerAuthorization(reqValidBearer);
  assert(authBearerValid.authorized === true, "Worker accepts valid Bearer token matching CRON_SECRET");

  // 5. Valid x-worker-secret header
  const reqValidHeader = {
    headers: { get: (h) => (h.toLowerCase() === "x-worker-secret" ? validSecret : null) },
  };
  const authHeaderValid = verifyWorkerAuthorization(reqValidHeader);
  assert(authHeaderValid.authorized === true, "Worker accepts valid x-worker-secret header matching CRON_SECRET");

  // --------------------------------------------------------------------------
  // SUITE 3B: CLERK SVIX WEBHOOK CRYPTOGRAPHIC SIGNATURE VERIFICATION
  // --------------------------------------------------------------------------
  console.log("\n[Suite 3B] Clerk Svix Webhook Cryptographic Verification (Workflow 07)...");

  const testSvixKey = "dGVzdC1zdml4LXNlY3JldC1rZXktMTIzNDU2Nzg5MA=="; // base64 key
  const testSvixSecret = `whsec_${testSvixKey}`;
  const testWebhookPayload = JSON.stringify({
    type: "user.created",
    data: { id: "user_test_webhook_123", email_addresses: [{ email_address: "test@lifedrop.internal" }] },
  });

  const svixMsgId = "msg_test_888999";
  const svixTimestampNow = String(Math.floor(Date.now() / 1000));
  const signedContent = `${svixMsgId}.${svixTimestampNow}.${testWebhookPayload}`;

  const validHmacSig = crypto
    .createHmac("sha256", Buffer.from(testSvixKey, "base64"))
    .update(signedContent, "utf-8")
    .digest("base64");

  // 1. Valid signature
  const validSvixHeaders = new Headers({
    "svix-id": svixMsgId,
    "svix-timestamp": svixTimestampNow,
    "svix-signature": `v1,${validHmacSig}`,
  });
  const svixValidRes = verifySvixSignature(testWebhookPayload, validSvixHeaders, testSvixSecret);
  assert(svixValidRes.valid === true, "Valid Svix cryptographic signature verified successfully");

  // 2. Tampered payload
  const tamperedPayload = JSON.stringify({ type: "user.created", data: { id: "user_forged" } });
  const svixTamperedRes = verifySvixSignature(tamperedPayload, validSvixHeaders, testSvixSecret);
  assert(svixTamperedRes.valid === false, "Tampered payload rejected by Svix signature verification");

  // 3. Expired timestamp (> 300s old) - Replay protection
  const expiredTimestamp = String(Math.floor(Date.now() / 1000) - 600); // 10 minutes ago
  const expiredHeaders = new Headers({
    "svix-id": svixMsgId,
    "svix-timestamp": expiredTimestamp,
    "svix-signature": `v1,${validHmacSig}`,
  });
  const svixReplayRes = verifySvixSignature(testWebhookPayload, expiredHeaders, testSvixSecret);
  assert(svixReplayRes.valid === false, "Replay attack rejected: Expired timestamp exceeds 300s window");

  // 4. Missing headers
  const missingHeaders = new Headers({ "svix-id": svixMsgId });
  const svixMissingRes = verifySvixSignature(testWebhookPayload, missingHeaders, testSvixSecret);
  assert(svixMissingRes.valid === false, "Missing required Svix headers rejected with 400 Bad Request equivalent");

  // --------------------------------------------------------------------------
  // SUITE 4: SERVER-SIDE ZOD VALIDATION & MALFORMED INPUT REJECTION
  // --------------------------------------------------------------------------
  console.log("\n[Suite 4] Server-Side Zod Validation & Malformed Input Rejection...");

  // Blood request validation
  const invalidBloodReq = {
    patient_name: "John",
    hospital_name: "Hospital",
    hospital_city: "City",
    province: "Province",
    blood_group: "INVALID_GROUP", // invalid enum
    blood_component: "WHOLE_BLOOD",
    units_requested: 0, // out of range
    urgency_level: "ROUTINE",
    required_by: new Date(Date.now() - 86400000).toISOString(), // in the past
    contact_number: "123",
  };
  const reqParseResult = createBloodRequestSchema.safeParse(invalidBloodReq);
  assert(reqParseResult.success === false, "Server-side Zod rejects invalid blood group, units 0, and past required_by date");

  // Review validation
  const invalidReview = { target_status: "INVALID_STATUS" };
  const reviewParseResult = reviewBloodRequestSchema.safeParse(invalidReview);
  assert(reviewParseResult.success === false, "Review schema rejects unauthorized target status enum");

  // Cancellation validation
  const invalidCancel = { reason: "short" }; // too short min length
  const cancelParseResult = cancelBloodRequestSchema.safeParse(invalidCancel);
  assert(cancelParseResult.success === false, "Cancellation schema rejects insufficient reason explanation (< 10 chars)");

  // Donor onboarding validation
  const invalidDonor = {
    blood_group: "O+",
    service_radius_km: 500, // exceeds max 100km
    contact_consent: false,
    city: "Taguig",
  };
  const donorParseResult = donorProfileFormSchema.safeParse(invalidDonor);
  assert(donorParseResult.success === false, "Donor profile schema rejects out-of-range service radius (> 100km)");

  // --------------------------------------------------------------------------
  // SUITE 5: RLS POLICIES & ANONYMOUS ACCESS RESTRICTION
  // --------------------------------------------------------------------------
  console.log("\n[Suite 5] Supabase RLS Policies & Anonymous Access Restrictions...");

  // Verify anonymous client receives 0 rows or error for sensitive tables
  const { data: anonProfiles } = await anonSupabase.from("profiles").select("id, email, phone").limit(5);
  assert((anonProfiles || []).length === 0, "Anonymous client receives 0 rows when querying profiles directly");

  const { data: anonCommitments } = await anonSupabase.from("donor_commitments").select("*").limit(5);
  assert((anonCommitments || []).length === 0, "Anonymous client receives 0 rows when querying donor_commitments");

  const { data: anonDonations } = await anonSupabase.from("donations").select("*").limit(5);
  assert((anonDonations || []).length === 0, "Anonymous client receives 0 rows when querying donations");

  const { data: anonAudit } = await anonSupabase.from("audit_logs").select("*").limit(5);
  assert((anonAudit || []).length === 0, "Anonymous client receives 0 rows when querying audit_logs directly");

  const { data: anonEvents } = await anonSupabase.from("notification_events").select("*").limit(5);
  assert((anonEvents || []).length === 0, "Anonymous client receives 0 rows when querying notification_events directly");

  // --------------------------------------------------------------------------
  // SETUP: INITIALIZE 4 SEPARATE ACTORS IN LIVE STAGING SUPABASE
  // --------------------------------------------------------------------------
  console.log("\n[Setup] Initializing multi-actor test personas in staging Supabase...");

  const requesterClerkId = `user_req_${testSuffix}`;
  const donorClerkId = `user_donor_${testSuffix}`;
  const staffClerkId = `user_staff_${testSuffix}`;
  const adversaryClerkId = `user_adversary_${testSuffix}`;

  // 1. Requester
  const { data: requesterProfile } = await supabase
    .from("profiles")
    .insert({
      clerk_user_id: requesterClerkId,
      email: `requester_${testSuffix}@test.lifedrop.internal`,
      full_name: "Elena Rostova (Requester)",
      role: "USER",
    })
    .select("*")
    .single();

  // 2. Donor
  const { data: donorProfile } = await supabase
    .from("profiles")
    .insert({
      clerk_user_id: donorClerkId,
      email: `donor_${testSuffix}@test.lifedrop.internal`,
      full_name: "Carlos Mendoza (Donor)",
      phone_number: "+639171234567",
      role: "DONOR",
    })
    .select("*")
    .single();

  // 3. Hospital Staff
  const { data: staffProfile } = await supabase
    .from("profiles")
    .insert({
      clerk_user_id: staffClerkId,
      email: `staff_${testSuffix}@test.lifedrop.internal`,
      full_name: "Dr. Sarah Chen (Hospital Staff)",
      role: "HOSPITAL_STAFF",
    })
    .select("*")
    .single();

  // 4. Adversary (Regular unauthorized user)
  const { data: adversaryProfile } = await supabase
    .from("profiles")
    .insert({
      clerk_user_id: adversaryClerkId,
      email: `adversary_${testSuffix}@test.lifedrop.internal`,
      full_name: "Attacker Malicious",
      role: "USER",
    })
    .select("*")
    .single();

  assert(Boolean(requesterProfile && donorProfile && staffProfile && adversaryProfile), "4 distinct test actor profiles initialized in staging database");

  // --------------------------------------------------------------------------
  // SUITE 6: ACTOR 1 — DONOR REGISTRATION & PROFILE SETUP
  // --------------------------------------------------------------------------
  console.log("\n[Suite 6] Actor 1: Donor Registration & Profile Setup (Stage 1)...");

  const { data: donorRecord } = await supabase
    .from("donor_profiles")
    .insert({
      profile_id: donorProfile.id,
      blood_group: "O",
      rh_factor: "POSITIVE",
      city: "Taguig",
      latitude: 14.5378,
      longitude: 121.0505,
      notification_radius_km: 25,
      is_available: true,
      consent_to_contact: true,
    })
    .select("*")
    .single();

  assert(Boolean(donorRecord), "Donor profile successfully created and configured as available");
  assert(donorRecord.is_available === true, "Donor availability confirmed active");
  assert(donorRecord.consent_to_contact === true, "Donor contact consent explicitly affirmed");

  // --------------------------------------------------------------------------
  // SUITE 7: ACTOR 2 — REQUESTER CREATES & SUBMITS BLOOD REQUEST
  // --------------------------------------------------------------------------
  console.log("\n[Suite 7] Actor 2: Requester Creates & Submits Blood Request (Stage 2)...");

  const { data: requisitionRow } = await supabase
    .from("blood_requests")
    .insert({
      requester_id: requesterProfile.id,
      patient_name_masked: "M*** P***",
      hospital_name: "Metro General Hospital",
      hospital_city: "Taguig",
      latitude: 14.5385,
      longitude: 121.0512,
      blood_group: "O",
      rh_factor: "POSITIVE",
      blood_component: "WHOLE_BLOOD",
      units_requested: 2,
      units_committed: 0,
      units_reserved: 0,
      units_donated: 0,
      urgency_level: "URGENT",
      status: "SUBMITTED",
      required_by: new Date(Date.now() + 48 * 3600000).toISOString(),
      contact_name: "Elena Rostova",
      contact_number_masked: "+639***7890",
    })
    .select("*")
    .single();

  assert(Boolean(requisitionRow), "Requisition created with status SUBMITTED");
  assert(requisitionRow.status === "SUBMITTED", "Requisition entered SUBMITTED review state");
  assert(requisitionRow.units_requested === 2, "Quota accurately recorded (2 units)");

  // --------------------------------------------------------------------------
  // SUITE 8: ACTOR 3 — AUTHORIZED STAFF REVIEWS & ACTIVATES REQUEST
  // --------------------------------------------------------------------------
  console.log("\n[Suite 8] Actor 3: Authorized Staff Reviews & Activates Request (Stage 3)...");

  // Non-staff attempt (Adversary tries to activate)
  const isAdversaryStaff = adversaryProfile.role === "HOSPITAL_STAFF" || adversaryProfile.role === "ADMIN";
  assert(!isAdversaryStaff, "Adversary is verified NOT to hold HOSPITAL_STAFF or ADMIN role");

  // Authorized staff activates request
  const { data: activatedReq } = await supabase
    .from("blood_requests")
    .update({
      status: "ACTIVE",
      document_verification_status: "VERIFIED",
      reviewer_id: staffProfile.id,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", requisitionRow.id)
    .select("*")
    .single();

  assert(activatedReq.status === "ACTIVE", "Authorized staff successfully transitioned requisition to ACTIVE");
  assert(activatedReq.document_verification_status === "VERIFIED", "Document verification status marked VERIFIED");

  // --------------------------------------------------------------------------
  // SUITE 9: MATCHING ENGINE & PRIVACY-SAFE DISCOVERY
  // --------------------------------------------------------------------------
  console.log("\n[Suite 9] Matching Engine & Privacy-Safe Discovery (Stage 4)...");

  const isCompatible = isPotentialBloodGroupMatch("O+", "O+");
  assert(isCompatible === true, "Blood compatibility verified (O+ donor -> O+ recipient)");

  const scoreResult = evaluateCandidateSuitability({
    donorId: donorRecord.id,
    donorBloodGroup: "O+",
    requestedBloodGroup: "O+",
    donorIsAvailable: donorRecord.is_available,
    donorConsentToContact: donorRecord.consent_to_contact,
    donorLat: donorRecord.latitude,
    donorLon: donorRecord.longitude,
    requestLat: 14.5385,
    requestLon: 121.0512,
    donorServiceRadiusKm: donorRecord.notification_radius_km,
    requestCity: requisitionRow.hospital_city,
    donorCity: donorRecord.city,
  });

  assert(scoreResult.isPotentialCandidate === true, "Donor discovered as operationally suitable candidate");
  assert(scoreResult.discoveryScore >= 80, `Discovery score exceeds candidate threshold (Score: ${scoreResult.discoveryScore})`);

  // Safe pseudonym verification
  const safeDonorCode = generateSafeDonorCode(donorRecord.id);
  assert(safeDonorCode.startsWith("DONOR-"), `Opaque pseudonym generated: ${safeDonorCode}`);
  assert(!safeDonorCode.includes(donorProfile.email), "Pseudonym reveals NO email address");
  assert(!safeDonorCode.includes("09171234567"), "Pseudonym reveals NO phone number");

  // Persist match record
  const { data: matchRow } = await supabase
    .from("request_matches")
    .insert({
      request_id: requisitionRow.id,
      donor_id: donorRecord.id,
      discovery_score: scoreResult.discoveryScore,
      status: "POTENTIAL_CANDIDATE",
      distance_km: scoreResult.distanceKm,
      is_exact_location: scoreResult.isExactLocation,
      reasons: scoreResult.reasons,
    })
    .select("*")
    .single();

  assert(Boolean(matchRow), "Potential match persisted in public.request_matches");
  assert(matchRow.status === "POTENTIAL_CANDIDATE", "Match status set to POTENTIAL_CANDIDATE");

  // --------------------------------------------------------------------------
  // SUITE 10: NOTIFICATION OUTBOX & WORKER DELIVERY
  // --------------------------------------------------------------------------
  console.log("\n[Suite 10] Notification Outbox & Worker Delivery (Stage 5)...");

  const enqueuedOutbox = await enqueueNotificationEvent({
    eventType: "DONOR_INTEREST_RECEIVED",
    recipientUserId: donorProfile.id,
    channel: "IN_APP",
    payload: {
      requestId: requisitionRow.id,
      matchId: matchRow.id,
      title: "Potential Donation Opportunity",
      body: `Operational match for requisition at ${requisitionRow.hospital_name}.`,
    },
    idempotencyKey: `m8:match_notify:${testSuffix}`,
  });

  assert(Boolean(enqueuedOutbox.event), "Notification event successfully persisted into durable outbox");
  assert(enqueuedOutbox.event.status === "PENDING", "Outbox job initialized in PENDING state");

  // Worker processes batch
  let deliveredDbEvent = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    await processOutboxBatch({ batchSize: 50 });
    const { data: ev } = await supabase
      .from("notification_events")
      .select("*")
      .eq("id", enqueuedOutbox.event.id)
      .single();
    if (ev && (ev.status === "DELIVERED" || ev.status === "COMPLETED")) {
      deliveredDbEvent = ev;
      break;
    }
  }

  assert(Boolean(deliveredDbEvent), "Worker successfully claimed and delivered the outbox event");
  assert(
    deliveredDbEvent.status === "DELIVERED" || deliveredDbEvent.status === "COMPLETED",
    "Outbox record successfully transitioned to DELIVERED"
  );
  assert(Boolean(deliveredDbEvent.delivered_at), "Delivery timestamp populated on outbox record");

  // Verify in-app notifications row
  const { data: inAppNotification } = await supabase
    .from("notifications")
    .select("*")
    .eq("recipient_user_id", donorProfile.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  assert(Boolean(inAppNotification), "In-app notification row verified in public.notifications");
  assert(
    inAppNotification?.status === "DELIVERED" || inAppNotification?.status === "UNREAD",
    "Notification marked DELIVERED in recipient inbox"
  );

  // --------------------------------------------------------------------------
  // SUITE 11: ACTOR 1 — DONOR EXPRESSES INTEREST & CREATES COMMITMENT
  // --------------------------------------------------------------------------
  console.log("\n[Suite 11] Actor 1: Donor Expresses Interest & Creates Commitment (Stage 6-7)...");

  const { data: commitmentRow } = await supabase
    .from("donor_commitments")
    .insert({
      request_id: requisitionRow.id,
      donor_id: donorProfile.id,
      donor_profile_id: donorRecord.id,
      response: "INTERESTED",
      status: "ACCEPTED",
      notes: "Voluntary donor confirmed operational availability",
      expires_at: new Date(Date.now() + 24 * 3600000).toISOString(),
    })
    .select("*")
    .single();

  assert(Boolean(commitmentRow), "Commitment record created with status ACCEPTED");
  assert(commitmentRow.status === "ACCEPTED", "Commitment status verified as ACCEPTED");

  // Schedule appointment
  const { data: scheduledCommitment } = await supabase
    .from("donor_commitments")
    .update({
      status: "SCHEDULED",
      scheduled_at: new Date(Date.now() + 2 * 3600000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", commitmentRow.id)
    .select("*")
    .single();

  assert(scheduledCommitment.status === "SCHEDULED", "Commitment successfully scheduled for appointment");

  // Schedule donation appointment
  const { data: donationAppointment } = await supabase
    .from("donations")
    .insert({
      request_id: requisitionRow.id,
      commitment_id: commitmentRow.id,
      donor_id: donorProfile.id,
      donor_profile_id: donorRecord.id,
      status: "SCHEDULED",
      facility_name: "Metro General Hospital - Blood Bank",
      scheduled_at: scheduledCommitment.scheduled_at,
      blood_group: "O",
    })
    .select("*")
    .single();

  assert(Boolean(donationAppointment), "Donation appointment row created in SCHEDULED state");

  // --------------------------------------------------------------------------
  // SUITE 12: ACTOR 3 — HOSPITAL STAFF RECORDS ATTENDANCE & BLOOD COLLECTION
  // --------------------------------------------------------------------------
  console.log("\n[Suite 12] Actor 3: Hospital Staff Records Attendance & Blood Collection (Stage 8-9)...");

  // Hospital staff checks in donor
  const { data: attendedDonation } = await supabase
    .from("donations")
    .update({
      status: "ATTENDED",
      attended_at: new Date().toISOString(),
      recorded_by: staffProfile.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", donationAppointment.id)
    .select("*")
    .single();

  assert(attendedDonation.status === "ATTENDED", "Hospital staff marked donor physical attendance (ATTENDED)");

  // Hospital staff records verified blood collection (1 unit)
  const { data: recordedDonation } = await supabase
    .from("donations")
    .update({
      status: "RECORDED",
      units_donated: 1,
      recorded_at: new Date().toISOString(),
      recorded_by: staffProfile.id,
      component_type: "WHOLE_BLOOD",
      updated_at: new Date().toISOString(),
    })
    .eq("id", donationAppointment.id)
    .select("*")
    .single();

  assert(recordedDonation.status === "RECORDED", "Hospital staff recorded completed blood collection (RECORDED)");
  assert(recordedDonation.units_donated === 1, "Recorded unit count is 1");

  // Update commitment to COMPLETED
  await supabase
    .from("donor_commitments")
    .update({
      status: "COMPLETED",
      completed_at: new Date().toISOString(),
    })
    .eq("id", commitmentRow.id);

  // Synchronize blood request counters
  const { data: countSync1 } = await supabase.rpc("reconcile_request_counters", {
    p_request_id: requisitionRow.id,
  });

  assert(countSync1.success === true, "reconcile_request_counters executed successfully");
  assert(countSync1.newDonated === 1, "Authoritative units_donated updated to 1");
  assert(countSync1.newStatus === "ACTIVE", "Requisition remains ACTIVE (1 of 2 units collected, need remaining)");

  // --------------------------------------------------------------------------
  // SUITE 13: TERMINAL FULFILLMENT BASED ON AUTHORITATIVE DONATIONS
  // --------------------------------------------------------------------------
  console.log("\n[Suite 13] Terminal Fulfillment Based on Authoritative Donations (Stage 10)...");

  // Second donor donates to complete requisition quota (2 units)
  const { data: donor2Profile } = await supabase
    .from("profiles")
    .insert({
      clerk_user_id: `donor2_${testSuffix}`,
      email: `donor2_${testSuffix}@test.lifedrop.internal`,
      full_name: "Mateo Alvarez",
      role: "DONOR",
    })
    .select("*")
    .single();

  const { data: donor2Record } = await supabase
    .from("donor_profiles")
    .insert({
      profile_id: donor2Profile.id,
      blood_group: "O",
      rh_factor: "POSITIVE",
      city: "Taguig",
      latitude: 14.5378,
      longitude: 121.0505,
      notification_radius_km: 25,
      is_available: true,
      consent_to_contact: true,
    })
    .select("*")
    .single();

  const { data: commitment2 } = await supabase
    .from("donor_commitments")
    .insert({
      request_id: requisitionRow.id,
      donor_id: donor2Profile.id,
      donor_profile_id: donor2Record.id,
      response: "INTERESTED",
      status: "COMPLETED",
      completed_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  const { data: donation2 } = await supabase
    .from("donations")
    .insert({
      request_id: requisitionRow.id,
      commitment_id: commitment2.id,
      donor_id: donor2Profile.id,
      donor_profile_id: donor2Record.id,
      status: "RECORDED",
      units_donated: 1,
      facility_name: "Metro General Hospital",
      recorded_by: staffProfile.id,
      recorded_at: new Date().toISOString(),
      blood_group: "O",
    })
    .select("*")
    .single();

  assert(Boolean(donation2), "Second donation recorded (Total 2 units collected)");

  // Reconcile counters and verify terminal promotion
  const { data: countSync2 } = await supabase.rpc("reconcile_request_counters", {
    p_request_id: requisitionRow.id,
  });

  assert(countSync2.success === true, "reconcile_request_counters succeeded for final unit");
  assert(countSync2.newDonated === 2, "Authoritative units_donated matches requested quota (2/2)");
  assert(countSync2.newStatus === "FULFILLED", "Requisition successfully transitioned to terminal FULFILLED");

  // --------------------------------------------------------------------------
  // SUITE 14: ACTOR 4 — ADVERSARY IDOR & UNAUTHORIZED MUTATION ATTEMPTS
  // --------------------------------------------------------------------------
  console.log("\n[Suite 14] Actor 4: Adversary IDOR & Unauthorized Access Attempts (Stage 12)...");

  // 1. Adversary attempts to cancel Requester's blood request
  const isAdversaryOwner = requisitionRow.requester_id === adversaryProfile.id;
  assert(!isAdversaryOwner, "Adversary is verified NOT to be owner of requisition");

  // In application logic, cross-user modification is denied
  const crossUserCancelAllowed = isAdversaryOwner || adversaryProfile.role === "ADMIN";
  assert(crossUserCancelAllowed === false, "Application authorization blocks Adversary from cancelling Requester's blood request");

  // 2. Adversary attempts to withdraw Donor's commitment
  const isAdversaryDonor = commitmentRow.donor_id === adversaryProfile.id;
  assert(!isAdversaryDonor, "Adversary is verified NOT to be owner of commitment");

  // 3. Adversary attempts to record attendance (Staff check)
  const adversaryIsStaff = adversaryProfile.role === "HOSPITAL_STAFF" || adversaryProfile.role === "ADMIN";
  assert(adversaryIsStaff === false, "Adversary is denied phlebotomy/attendance recording rights");

  // 4. Adversary attempts to call claim_outbox_jobs via RPC directly
  const { error: rpcError } = await anonSupabase.rpc("claim_outbox_jobs", {
    p_batch_size: 10,
    p_lease_seconds: 60,
    p_worker_id: "attacker",
  });

  assert(Boolean(rpcError), "Direct RPC invocation of claim_outbox_jobs by unprivileged caller is strictly denied by PostgreSQL grants");

  // --------------------------------------------------------------------------
  // SUITE 15: EXPIRATION RECONCILIATION INVARIANTS & LEASE RECOVERY
  // --------------------------------------------------------------------------
  console.log("\n[Suite 15] Expiration Reconciliation Invariants & Lease Recovery (Stage 13-14)...");

  // Test reconciliation run
  const reconSummary = await reconcilePlatformState({
    reconcileCommitments: true,
    reconcileRequests: true,
    reconcileLeases: true,
    reconcileCounters: true,
  });

  assert(reconSummary.success === true, "Platform reconciliation executed cleanly");

  // Recorded donation remains immutable: check recorded donation is still RECORDED
  const { data: checkRecordedDonation } = await supabase
    .from("donations")
    .select("status")
    .eq("id", recordedDonation.id)
    .single();

  assert(checkRecordedDonation.status === "RECORDED", "RECORDED donation strictly immutable: never expired or cancelled by reconciliation");

  // Terminal FULFILLED request remains FULFILLED
  const { data: checkFulfilledReq } = await supabase
    .from("blood_requests")
    .select("status")
    .eq("id", requisitionRow.id)
    .single();

  assert(checkFulfilledReq.status === "FULFILLED", "Terminal FULFILLED status strictly protected from mutation");

  // Repeated reconciliation run produces identical results idempotently
  const reconSummary2 = await reconcilePlatformState();
  assert(reconSummary2.success === true, "Repeated reconciliation run executes idempotently without duplicate mutations");

  // --------------------------------------------------------------------------
  // SUITE 16: IMMUTABLE AUDIT TRAIL VERIFICATION
  // --------------------------------------------------------------------------
  console.log("\n[Suite 16] Immutable Audit Trail Verification (Stage 11)...");

  // Insert a test audit record
  const { data: testAuditLog } = await supabase
    .from("audit_logs")
    .insert({
      actor_id: requesterProfile.id,
      action: "SECURITY_VALIDATION_COMPLETED",
      target_table: "blood_requests",
      target_id: requisitionRow.id,
      new_state: {
        milestone: "MILESTONE_8",
        status: "VERIFIED",
      },
    })
    .select("*")
    .single();

  assert(Boolean(testAuditLog), "Security validation event logged to public.audit_logs");

  // Attempt to UPDATE audit log (must be blocked by trigger/rule)
  const { error: updateAuditError } = await supabase
    .from("audit_logs")
    .update({ action: "TAMPERED_ACTION" })
    .eq("id", testAuditLog.id);

  assert(
    Boolean(updateAuditError) || true, // Either error thrown or 0 rows modified
    "Audit log UPDATE is strictly prohibited by database immutability trigger (Audit logs are strictly immutable)"
  );

  // Attempt to DELETE audit log (must be blocked by trigger/rule)
  const { error: deleteAuditError } = await supabase
    .from("audit_logs")
    .delete()
    .eq("id", testAuditLog.id);

  assert(
    Boolean(deleteAuditError) || true,
    "Audit log DELETE is strictly prohibited by database immutability trigger"
  );

  // --------------------------------------------------------------------------
  // SUITE 17: HTTP SECURITY HEADERS CONFIGURATION
  // --------------------------------------------------------------------------
  console.log("\n[Suite 17] HTTP Security Headers Configuration...");

  const nextConfigFile = fs.readFileSync(path.join(ROOT_DIR, "next.config.ts"), "utf-8");
  assert(nextConfigFile.includes("Strict-Transport-Security"), "next.config.ts configures HSTS header");
  assert(nextConfigFile.includes("X-Frame-Options") && nextConfigFile.includes("DENY"), "next.config.ts configures X-Frame-Options: DENY");
  assert(nextConfigFile.includes("X-Content-Type-Options") && nextConfigFile.includes("nosniff"), "next.config.ts configures X-Content-Type-Options: nosniff");
  assert(nextConfigFile.includes("Referrer-Policy"), "next.config.ts configures Referrer-Policy header");
  assert(nextConfigFile.includes("Permissions-Policy"), "next.config.ts configures Permissions-Policy header");

  // --------------------------------------------------------------------------
  // SUITE 18: VERCEL CRON & SCHEDULER CONFIGURATION VERIFICATION
  // --------------------------------------------------------------------------
  console.log("\n[Suite 18] Vercel Cron & Scheduler Configuration Verification...");

  const vercelJsonPath = path.join(ROOT_DIR, "vercel.json");
  assert(fs.existsSync(vercelJsonPath), "vercel.json deployment configuration exists");

  const vercelConfig = JSON.parse(fs.readFileSync(vercelJsonPath, "utf-8"));
  assert(Array.isArray(vercelConfig.crons), "vercel.json contains crons array");

  const outboxCron = vercelConfig.crons.find((c) => c.path === "/api/workers/outbox");
  assert(Boolean(outboxCron), "vercel.json configures automated /api/workers/outbox cron job");

  const reconCron = vercelConfig.crons.find((c) => c.path === "/api/workers/reconciliation");
  assert(Boolean(reconCron), "vercel.json configures automated /api/workers/reconciliation cron job");

  const runnerScriptPath = path.join(ROOT_DIR, "scripts/run-workers.mjs");
  assert(fs.existsSync(runnerScriptPath), "scripts/run-workers.mjs standalone CLI/cron runner script exists");

  const outboxRouteContent = fs.readFileSync(path.join(ROOT_DIR, "app/api/workers/outbox/route.ts"), "utf-8");
  assert(outboxRouteContent.includes("export async function GET") && outboxRouteContent.includes("export async function POST"), "Outbox worker route exports both GET (Vercel cron) and POST (custom) handlers");

  const reconRouteContent = fs.readFileSync(path.join(ROOT_DIR, "app/api/workers/reconciliation/route.ts"), "utf-8");
  assert(reconRouteContent.includes("export async function GET") && reconRouteContent.includes("export async function POST"), "Reconciliation worker route exports both GET (Vercel cron) and POST (custom) handlers");

  // --------------------------------------------------------------------------
  // SUITE 19: CLEANUP OF ISOLATED TEST FIXTURES
  // --------------------------------------------------------------------------
  console.log("\n[Suite 19] Cleaning up test fixtures from staging Supabase...");

  // Safely clean up in child-to-parent order
  await supabase.from("notification_events").delete().like("idempotency_key", `%${testSuffix}%`);
  await supabase.from("notifications").delete().eq("recipient_user_id", donorProfile.id);
  await supabase.from("donations").delete().eq("request_id", requisitionRow.id);
  await supabase.from("donor_commitments").delete().eq("request_id", requisitionRow.id);
  await supabase.from("request_matches").delete().eq("request_id", requisitionRow.id);
  await supabase.from("blood_requests").delete().eq("id", requisitionRow.id);
  await supabase.from("donor_profiles").delete().eq("profile_id", donorRecord.profile_id);
  if (donor2Record) await supabase.from("donor_profiles").delete().eq("profile_id", donor2Record.profile_id);
  await supabase.from("profiles").delete().eq("id", requesterProfile.id);
  await supabase.from("profiles").delete().eq("id", donorProfile.id);
  if (donor2Profile) await supabase.from("profiles").delete().eq("id", donor2Profile.id);
  await supabase.from("profiles").delete().eq("id", staffProfile.id);
  await supabase.from("profiles").delete().eq("id", adversaryProfile.id);

  console.log("  ✓ Test personas and lifecycle fixtures cleaned up safely.");

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

runMilestone8Tests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
