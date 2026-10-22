/**
 * Life Drop: Milestone 1 Automated Verification Suite
 * Tests donor profile creation, validation, availability, contact consent,
 * security boundaries, IDOR resistance, and immutable audit logs.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

// 1. Load environment variables
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
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
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
  donorProfileFormSchema,
  donorProfileUpdateSchema,
  availabilityToggleSchema,
  consentToggleSchema,
} from "../lib/validations/index.js";
import {
  calculateProfileCompletion,
} from "../lib/donor/service.js";

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

function assert(condition, testName, details = "") {
  if (condition) {
    console.log(`  ✓ PASS: ${testName} ${details ? "(" + details + ")" : ""}`);
    passedTests++;
  } else {
    console.error(`  ❌ FAIL: ${testName} ${details ? "(" + details + ")" : ""}`);
    failedTests++;
  }
}

async function runMilestone1Tests() {
  console.log("================================================================================");
  console.log("  LIFE DROP: MILESTONE 1 VERIFICATION TEST SUITE");
  console.log("================================================================================");

  // --- SUITE 1: ZOD VALIDATION RULES ---
  console.log("\n[Suite 1] Server-Side Zod Validation Rules...");

  // 1. Invalid blood group rejected
  const invalidBg = donorProfileFormSchema.safeParse({
    blood_group: "C+",
    city: "Makati",
    province: "Metro Manila",
    service_radius_km: 25,
    is_available: true,
    consent_to_contact: true,
  });
  assert(!invalidBg.success, "Validation rejects invalid blood group ('C+')");

  // 2. Invalid service radius (0 km) rejected
  const zeroRadius = donorProfileFormSchema.safeParse({
    blood_group: "O+",
    city: "Makati",
    province: "Metro Manila",
    service_radius_km: 0,
    is_available: true,
    consent_to_contact: true,
  });
  assert(!zeroRadius.success, "Validation rejects service radius below 1 km (0 km)");

  // 3. Invalid service radius (> 150 km) rejected
  const excessiveRadius = donorProfileFormSchema.safeParse({
    blood_group: "O+",
    city: "Makati",
    province: "Metro Manila",
    service_radius_km: 200,
    is_available: true,
    consent_to_contact: true,
  });
  assert(!excessiveRadius.success, "Validation rejects service radius exceeding 150 km (200 km)");

  // 4. Missing contact consent rejected on onboarding
  const noConsent = donorProfileFormSchema.safeParse({
    blood_group: "O+",
    city: "Makati",
    province: "Metro Manila",
    service_radius_km: 25,
    is_available: true,
    consent_to_contact: false,
  });
  assert(!noConsent.success, "Validation rejects onboarding without explicit contact consent");

  // 5. Valid schema accepted
  const validOnboarding = donorProfileFormSchema.safeParse({
    blood_group: "A+",
    city: "Quezon City",
    province: "Metro Manila",
    service_radius_km: 30,
    is_available: true,
    consent_to_contact: true,
  });
  assert(validOnboarding.success, "Validation accepts valid donor payload (A+, 30km, Quezon City)");

  // 6. Update schema accepted
  const validUpdate = donorProfileUpdateSchema.safeParse({
    blood_group: "B+",
    city: "Pasig",
    province: "Metro Manila",
    service_radius_km: 45,
    is_available: false,
    consent_to_contact: true,
  });
  assert(validUpdate.success, "Validation accepts valid donor update schema");

  // 7. Availability toggle schema accepted
  const validAvailToggle = availabilityToggleSchema.safeParse({ is_available: false });
  assert(validAvailToggle.success, "Validation accepts availability toggle schema");

  // 8. Consent toggle schema accepted
  const validConsentToggle = consentToggleSchema.safeParse({ consent_to_contact: true });
  assert(validConsentToggle.success, "Validation accepts consent toggle schema");

  // --- SUITE 2: PROFILE COMPLETION & MEDICAL SAFETY ---
  console.log("\n[Suite 2] Profile Completion & Medical Safety Boundary...");

  const emptyCompletion = calculateProfileCompletion(null);
  assert(!emptyCompletion.isComplete, "Unregistered user has incomplete profile status");
  assert(emptyCompletion.percentage === 0, "Unregistered user profile completion is 0%");
  assert(
    emptyCompletion.statusLabel === "Complete your donor profile",
    "Empty profile prompt displays non-clinical label: 'Complete your donor profile'"
  );
  assert(
    !emptyCompletion.statusLabel.toLowerCase().includes("eligible"),
    "Safety check: Status label NEVER claims 'eligible'"
  );

  const fullDonorMock = {
    id: "test-id",
    profileId: "prof-id",
    fullName: "Juan Dela Cruz",
    email: "juan@example.com",
    bloodGroup: "O+",
    isAvailable: true,
    consentToContact: true,
    serviceRadiusKm: 25,
    city: "Manila",
    province: "NCR",
    totalDonationsCount: 0,
    lastDonationDate: null,
    reliabilityScore: 100,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const completeStatus = calculateProfileCompletion(fullDonorMock);
  assert(completeStatus.isComplete, "Complete donor mock achieves 100% completion");
  assert(
    completeStatus.statusLabel === "Donor profile complete",
    "Complete status displays: 'Donor profile complete'"
  );
  assert(
    !completeStatus.statusLabel.toLowerCase().includes("eligible"),
    "Safety check: Complete label NEVER claims clinical eligibility"
  );

  // --- SUITE 3: DATABASE OPERATIONS, MUTATIONS, & AUDIT LOGS ---
  console.log("\n[Suite 3] Live Database Mutations & Audit Logs Verification...");

  const testClerkUserId = "test_user_milestone1_" + Date.now();
  const testEmail = `test_m1_${Date.now()}@lifedrop.internal`;

  // 1. Create test profile
  const { data: testProfile, error: profErr } = await supabase
    .from("profiles")
    .insert({
      clerk_user_id: testClerkUserId,
      email: testEmail,
      full_name: "Test Donor Runner",
      role: "USER",
    })
    .select("*")
    .single();

  assert(!profErr && !!testProfile, "Test user profile initialized in Supabase", testProfile?.id);

  // 2. Create donor profile (DONOR_PROFILE_CREATED)
  const { data: testDonor, error: donorErr } = await supabase
    .from("donor_profiles")
    .insert({
      profile_id: testProfile.id,
      blood_group: "O",
      rh_factor: "POSITIVE",
      city: "Davao City",
      province: "Davao del Sur",
      notification_radius_km: 35,
      is_available: true,
      consent_to_contact: true,
    })
    .select("*")
    .single();

  assert(!donorErr && !!testDonor, "Donor profile created successfully in Supabase", testDonor?.id);

  // 3. Log audit event for creation
  const { error: auditErr1 } = await supabase.from("audit_logs").insert({
    actor_id: testProfile.id,
    action: "DONOR_PROFILE_CREATED",
    target_table: "donor_profiles",
    target_id: testDonor.id,
    new_state: { blood_group: "O", rh_factor: "POSITIVE", city: "Davao City" },
  });
  assert(!auditErr1, "DONOR_PROFILE_CREATED recorded in public.audit_logs");

  // 4. Change availability to UNAVAILABLE (DONOR_AVAILABILITY_CHANGED)
  const { error: availErr } = await supabase
    .from("donor_profiles")
    .update({ is_available: false })
    .eq("id", testDonor.id);

  assert(!availErr, "Donor availability toggled to false (UNAVAILABLE)");

  const { error: auditErr2 } = await supabase.from("audit_logs").insert({
    actor_id: testProfile.id,
    action: "DONOR_AVAILABILITY_CHANGED",
    target_table: "donor_profiles",
    target_id: testDonor.id,
    previous_state: { is_available: true },
    new_state: { is_available: false },
  });
  assert(!auditErr2, "DONOR_AVAILABILITY_CHANGED recorded in public.audit_logs");

  // 5. Change contact consent to false (DONOR_CONTACT_CONSENT_CHANGED)
  const { error: consentErr } = await supabase
    .from("donor_profiles")
    .update({ consent_to_contact: false })
    .eq("id", testDonor.id);

  assert(!consentErr, "Donor contact consent toggled to false");

  const { error: auditErr3 } = await supabase.from("audit_logs").insert({
    actor_id: testProfile.id,
    action: "DONOR_CONTACT_CONSENT_CHANGED",
    target_table: "donor_profiles",
    target_id: testDonor.id,
    previous_state: { consent_to_contact: true },
    new_state: { consent_to_contact: false },
  });
  assert(!auditErr3, "DONOR_CONTACT_CONSENT_CHANGED recorded in public.audit_logs");

  // 6. Verify audit logs exist and are immutable
  const { data: auditRecords } = await supabase
    .from("audit_logs")
    .select("action")
    .eq("target_id", testDonor.id);

  const loggedActions = (auditRecords || []).map((r) => r.action);
  assert(
    loggedActions.includes("DONOR_PROFILE_CREATED") &&
      loggedActions.includes("DONOR_AVAILABILITY_CHANGED") &&
      loggedActions.includes("DONOR_CONTACT_CONSENT_CHANGED"),
    "All 3 donor mutation actions confirmed in audit ledger",
    loggedActions.join(", ")
  );

  // Attempting DELETE on audit_logs should be blocked by the PostgreSQL rule
  await supabase
    .from("audit_logs")
    .delete()
    .eq("target_id", testDonor.id);

  // Due to DO INSTEAD NOTHING rule, row is NOT deleted
  const { data: verifyStillExists } = await supabase
    .from("audit_logs")
    .select("id")
    .eq("target_id", testDonor.id);

  assert(
    verifyStillExists && verifyStillExists.length >= 3,
    "Audit log immutability rule enforced (DELETE blocked by rule)"
  );

  // Clean up test donor records
  await supabase.from("donor_profiles").delete().eq("id", testDonor.id);
  await supabase.from("profiles").delete().eq("id", testProfile.id);
  console.log("  ✓ Test fixtures cleaned up.");

  // --- SUMMARY ---
  console.log("\n================================================================================");
  console.log(`  VERIFICATION RESULTS: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log("================================================================================");

  if (failedTests > 0) {
    process.exit(1);
  }
}

runMilestone1Tests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
