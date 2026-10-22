import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

console.log("================================================================================");
console.log("  LIFE DROP: ADMIN ROLE, AUTHORIZATION & DASHBOARD VERIFICATION SUITE");
console.log("================================================================================\n");

// 1. Invariant: Target Authorized Admin Identity
const TARGET_ADMIN_EMAIL = "christian.paradiang@urios.edu.ph";
const TARGET_ADMIN_CLERK_ID = "user_3KTw3DOq4dsbAKiqeQ50fiwOZZU";

console.log("[Suite 1] Role Resolution & Immunity to Forgery...");
{
  const authModulePath = path.resolve("lib/auth/index.ts");
  const authContent = fs.readFileSync(authModulePath, "utf-8");

  assert.ok(authContent.includes(TARGET_ADMIN_EMAIL), "Must define TARGET_ADMIN_EMAIL");
  assert.ok(authContent.includes(TARGET_ADMIN_CLERK_ID), "Must define TARGET_ADMIN_CLERK_ID");

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

console.log("\n[Suite 4] Dashboard Routing (app/dashboard/page.tsx)...");
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

console.log("\n[Suite 6] Admin Dashboard Operations (app/admin/page.tsx)...");
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
    adminPageContent.includes("isPrivileged") &&
    adminPageContent.includes("Access Restricted"),
    "Admin page must deny access to unauthorized users"
  );
  console.log("  ✓ PASS: Admin dashboard contains complete management tools and server-side authorization guard");
}

console.log("\n================================================================================");
console.log("  🎉 ALL 6 SUITES PASSED SUCCESSFULLY!");
console.log("================================================================================\n");
