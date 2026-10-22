import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

console.log("================================================================================");
console.log("  LIFE DROP: ADMIN ROLE, AUTHORIZATION & DASHBOARD VERIFICATION SUITE");
console.log("================================================================================\n");

const TARGET_ADMIN_EMAIL = "christian.paradiang@urios.edu.ph";
const TARGET_ADMIN_CLERK_ID = "user_3KTw3DOq4dsbAKiqeQ50fiwOZZU";

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

loadEnvFile(path.resolve(".env.staging"));
loadEnvFile(path.resolve(".env.local"));

console.log("[Suite 1] Static Code Architecture & Invariant Guards...");
{
  const authModulePath = path.resolve("lib/auth/index.ts");
  const authContent = fs.readFileSync(authModulePath, "utf-8");

  assert.ok(authContent.includes(TARGET_ADMIN_EMAIL), "Must define TARGET_ADMIN_EMAIL");
  assert.ok(authContent.includes(TARGET_ADMIN_CLERK_ID), "Must define TARGET_ADMIN_CLERK_ID");
  assert.ok(authContent.includes("extractUserEmail"), "Must provide extractUserEmail helper");
  assert.ok(authContent.includes("ilike"), "Must provide self-healing profile lookup");

  // Check role clamp
  assert.ok(
    authContent.includes('if (dbRole === "ADMIN" || dbRole === "SUPER_ADMIN")') &&
    authContent.includes('return "USER"'),
    "Must clamp any unauthorized account attempting ADMIN or SUPER_ADMIN"
  );
  console.log("  ✓ PASS: Authorized admin identity and strict role-clamp statically verified");
}

console.log("\n[Suite 2] Environment Configuration & After Sign-In Routing...");
{
  const envLocal = fs.readFileSync(path.resolve(".env.local"), "utf-8");
  const envProd = fs.readFileSync(path.resolve(".env.production"), "utf-8");

  assert.ok(
    envLocal.includes("NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/dashboard"),
    ".env.local MUST redirect after sign in to /dashboard, NOT /requests"
  );
  assert.ok(
    !envLocal.includes("NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/requests"),
    ".env.local MUST NOT redirect to /requests"
  );
  assert.ok(
    envProd.includes("NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/dashboard"),
    ".env.production MUST redirect after sign in to /dashboard"
  );
  console.log("  ✓ PASS: Post-sign-in redirect configured to /dashboard across environments");
}

console.log("\n[Suite 3] Navigation Bar (components/auth-nav.tsx)...");
{
  const navContent = fs.readFileSync(path.resolve("components/auth-nav.tsx"), "utf-8");

  assert.ok(
    navContent.includes(TARGET_ADMIN_EMAIL),
    "auth-nav.tsx must check for target admin email"
  );
  assert.ok(
    navContent.includes('href="/admin"'),
    "auth-nav.tsx must include link to /admin for authorized administrator"
  );
  assert.ok(
    navContent.includes("isAuthorizedAdmin &&"),
    "auth-nav.tsx must guard /admin button with isAuthorizedAdmin"
  );
  console.log("  ✓ PASS: Admin button is displayed for target admin and strictly hidden from ordinary users");
}

console.log("\n[Suite 4] Dashboard Routing & Boundaries (app/dashboard/page.tsx)...");
{
  const dashContent = fs.readFileSync(path.resolve("app/dashboard/page.tsx"), "utf-8");

  assert.ok(
    dashContent.includes('redirect("/admin")'),
    "Dashboard page must redirect administrator to /admin"
  );
  assert.ok(
    dashContent.includes("isAdmin && !isPersonalView"),
    "Dashboard page must conditionally redirect admin unless personal view is requested"
  );
  console.log("  ✓ PASS: Authorized administrator is automatically routed to /admin instead of user requisition view");
}

console.log("\n[Suite 5] Blood Requests View (app/requests/page.tsx)...");
{
  const reqContent = fs.readFileSync(path.resolve("app/requests/page.tsx"), "utf-8");

  assert.ok(
    reqContent.includes("isPrivileged"),
    "Requests page must detect privileged/admin roles"
  );
  assert.ok(
    reqContent.includes('href="/admin"'),
    "Requests page must link directly to the Admin Verification Queue"
  );
  assert.ok(
    reqContent.includes('defaultValue={user && userRequests.length > 0 ? "my-requests" : "active-directory"}'),
    "Requests page must default to active-directory when user has zero requisitions"
  );
  console.log("  ✓ PASS: Requisitions page provides Admin review notices and avoids empty state trapping");
}

console.log("\n[Suite 6] Admin Dashboard Operations & Guardrails (app/admin/page.tsx)...");
{
  const adminPageContent = fs.readFileSync(path.resolve("app/admin/page.tsx"), "utf-8");

  assert.ok(
    adminPageContent.includes("reviewQueue"),
    "Admin page must display the Requisition Review Queue"
  );
  assert.ok(
    adminPageContent.includes("activeRequestsCount") &&
    adminPageContent.includes("totalDonorsCount") &&
    adminPageContent.includes("pointsPerDonation"),
    "Admin page must display live platform overview metrics"
  );
  assert.ok(
    adminPageContent.includes('href="/admin/reports"'),
    "Admin page must link to Reports & Analytics"
  );
  assert.ok(
    adminPageContent.includes('href="/admin/donors"'),
    "Admin page must link to Donor Oversight"
  );
  assert.ok(
    adminPageContent.includes("OutboxOperationsCard"),
    "Admin page must include Outbox Operations for platform administrator"
  );
  assert.ok(
    adminPageContent.includes("Operational Boundary & Non-Clinical Disclaimer"),
    "Admin page must include non-clinical medical disclaimer"
  );
  assert.ok(
    adminPageContent.includes("isPrivileged") &&
    adminPageContent.includes("Access Restricted"),
    "Admin page must deny access to unauthorized users"
  );
  console.log("  ✓ PASS: Admin dashboard contains complete management tools, non-clinical notice, and authorization guard");
}

console.log("\n[Suite 7] Live Staging Database & Profile Synchronization Audit...");
{
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  assert.ok(supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL must be configured");
  assert.ok(serviceKey, "SUPABASE_SERVICE_ROLE_KEY must be configured");

  if (typeof globalThis.WebSocket === "undefined") {
    globalThis.WebSocket = class {};
  }
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Verify exact single admin profile
  const { data: adminProfiles, error: profileErr } = await supabase
    .from("profiles")
    .select("*")
    .eq("email", TARGET_ADMIN_EMAIL);

  assert.ok(!profileErr, `Profile query error: ${profileErr?.message}`);
  assert.equal(adminProfiles?.length, 1, `Expected exactly 1 profile for ${TARGET_ADMIN_EMAIL}`);
  assert.equal(adminProfiles[0].role, "ADMIN", "Profile role in Supabase MUST be ADMIN");
  assert.equal(adminProfiles[0].clerk_user_id, TARGET_ADMIN_CLERK_ID, "Profile clerk_user_id MUST match target Clerk ID");
  console.log(`  ✓ PASS: Supabase profile verified: id=${adminProfiles[0].id}, role=ADMIN, clerk_user_id=${TARGET_ADMIN_CLERK_ID}`);

  // 2. Verify all live admin queries work without error
  const [bReqRes, donorRes, donRes, ptsRes, outboxRes] = await Promise.all([
    supabase.from("blood_requests").select("id,status").limit(5),
    supabase.from("donor_profiles").select("id").limit(5),
    supabase.from("donations").select("id").limit(5),
    supabase.from("points_config").select("*"),
    supabase.from("notification_events").select("id,status").limit(5),
  ]);

  assert.ok(!bReqRes.error, `blood_requests query failed: ${bReqRes.error?.message}`);
  assert.ok(!donorRes.error, `donor_profiles query failed: ${donorRes.error?.message}`);
  assert.ok(!donRes.error, `donations query failed: ${donRes.error?.message}`);
  assert.ok(!ptsRes.error, `points_config query failed: ${ptsRes.error?.message}`);
  assert.ok(!outboxRes.error, `notification_events query failed: ${outboxRes.error?.message}`);

  assert.ok(ptsRes.data.length >= 4, "points_config must have tier rows");
  console.log(`  ✓ PASS: All live administrative table queries return HTTP 200 OK (${ptsRes.data.length} points config rules)`);
}

console.log("\n[Suite 8] Runtime Role Resolution Function Testing...");
{
  const { resolveUserRole, extractUserEmail } = await import("../lib/auth/index.ts");

  // 1. Authorized administrator tests
  const adminRole1 = await resolveUserRole(TARGET_ADMIN_CLERK_ID, TARGET_ADMIN_EMAIL);
  assert.equal(adminRole1, "ADMIN", "Target admin clerk ID + email must resolve to ADMIN");

  const adminRole2 = await resolveUserRole(TARGET_ADMIN_CLERK_ID, null);
  assert.equal(adminRole2, "ADMIN", "Target admin clerk ID alone must resolve to ADMIN");

  // 2. Ordinary user tests
  const userRole1 = await resolveUserRole("user_ordinary_123", "ordinary@example.com");
  assert.equal(userRole1, "USER", "Ordinary user must resolve to USER");

  const userRole2 = await resolveUserRole("user_ordinary_123", null);
  assert.equal(userRole2, "USER", "Unknown clerk user without profile must resolve to USER");

  // 3. Email extraction tests
  const testUser1 = {
    id: TARGET_ADMIN_CLERK_ID,
    primaryEmailAddressId: "email_1",
    emailAddresses: [
      { id: "email_2", emailAddress: "secondary@example.com" },
      { id: "email_1", emailAddress: TARGET_ADMIN_EMAIL },
    ],
  };
  assert.equal(extractUserEmail(testUser1), TARGET_ADMIN_EMAIL, "extractUserEmail must resolve target admin email");

  const testUser2 = {
    id: "user_other",
    primaryEmailAddressId: "email_b",
    emailAddresses: [
      { id: "email_a", emailAddress: "first@example.com" },
      { id: "email_b", emailAddress: "primary@example.com" },
    ],
  };
  assert.equal(extractUserEmail(testUser2), "primary@example.com", "extractUserEmail must resolve primary email");

  // 4. Non-matching and adversarial email tests
  const spoofedEmails = [
    "christian.paradiang@gmail.com",
    "christian.paradiang@urios.edu",
    "not.christian.paradiang@urios.edu.ph",
    "christian.paradiang@urios.edu.ph.attacker.com",
    "christian.paradiang+admin@urios.edu.ph",
  ];
  for (const spoofed of spoofedEmails) {
    const spoofedRole = await resolveUserRole("user_spoofed_attempt", spoofed);
    assert.equal(spoofedRole, "USER", `Spoofed email '${spoofed}' MUST resolve to USER`);
  }

  console.log("  ✓ PASS: resolveUserRole & extractUserEmail verified across admin, ordinary users, and spoofed emails");
}

console.log("\n[Suite 9] Adversarial Security & Unauthorized Operations Shielding...");
{
  const { isAuthorizedAdminIdentity } = await import("../lib/auth/index.ts");

  // 1. Identity predicate defenses
  assert.equal(isAuthorizedAdminIdentity("attacker@evil.com", "user_attacker"), false);
  assert.equal(isAuthorizedAdminIdentity("christian.paradiang@urios.edu.ph", "user_3KTw3DOq4dsbAKiqeQ50fiwOZZU"), true);
  assert.equal(isAuthorizedAdminIdentity("christian.paradiang@urios.edu.ph", null), true);
  assert.equal(isAuthorizedAdminIdentity(null, "user_3KTw3DOq4dsbAKiqeQ50fiwOZZU"), true);
  assert.equal(isAuthorizedAdminIdentity("attacker@urios.edu.ph", null), false);

  // 2. Static verification of PointsConfigCard integration
  const adminPageContent = fs.readFileSync(path.resolve("app/admin/page.tsx"), "utf-8");
  assert.ok(adminPageContent.includes("PointsConfigCard"), "Admin page must render PointsConfigCard");

  // 3. Static verification of requireAdminUser in updatePointsConfigAction
  const reportsActionsContent = fs.readFileSync(path.resolve("lib/reports/actions.ts"), "utf-8");
  assert.ok(reportsActionsContent.includes("requireAdminUser"), "updatePointsConfigAction must guard with requireAdminUser");

  // 4. Static verification of resolveUserRole in reports service
  const reportsServiceContent = fs.readFileSync(path.resolve("lib/reports/service.ts"), "utf-8");
  assert.ok(reportsServiceContent.includes("resolveUserRole"), "reports service must verify access with resolveUserRole");

  console.log("  ✓ PASS: Adversarial identity spoofing, untrusted elevation, and server action guards verified");
}

console.log("\n================================================================================");
console.log("  🎉 ALL 9 SUITES PASSED SUCCESSFULLY!");
console.log("================================================================================\n");
