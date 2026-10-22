#!/usr/bin/env node

/**
 * LIFE DROP: COMPREHENSIVE TEST SUITE
 * PROFESSOR'S REQUIRED REVISIONS:
 * 1. Donor Points System & Recognition Ledger
 * 2. Idempotency & Duplicate Prevention
 * 3. Request Search & Multi-Parameter Filters
 * 4. Donor Privacy & Masking Guardrails
 * 5. Date Period Calculations (Monday-Sunday ISO Week)
 * 6. RFC 4180 CSV Serializer & Formula Injection Shielding
 */

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  calculateDateRange,
} from "../lib/reports/dates.js";
import {
  serializeToCsv,
  sanitizeCsvCell,
} from "../lib/reports/csv.js";
import {
  DEFAULT_POINTS_PER_DONATION,
  calculateTier,
  getNextTier,
  formatPrivacyConsciousName,
  POINTS_SAFETY_DISCLAIMER,
} from "../lib/donations/points.js";
import {
  adjustDonorPointsSchema,
} from "../lib/donations/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

let passedCount = 0;
let failedCount = 0;

function test(description, fn) {
  try {
    fn();
    console.log(`  ✓ PASS: ${description}`);
    passedCount++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${description}`);
    console.error(`    ${err.message}`);
    failedCount++;
  }
}

async function runTests() {
  console.log("================================================================================");
  console.log("  LIFE DROP: POINTS LEDGER, REPORTS & CSV SECURITY TEST SUITE");
  console.log("================================================================================");

  // --------------------------------------------------------------------------
  // SUITE 1: Donor Points & Recognition Tiers
  // --------------------------------------------------------------------------
  console.log("\n[Suite 1] Donor Points & Recognition Invariants...");

  test("Default points rule is 100 points per verified donation", () => {
    assert.strictEqual(DEFAULT_POINTS_PER_DONATION, 100);
  });

  test("Points safety disclaimer is present, explicit, and non-monetary", () => {
    assert.ok(POINTS_SAFETY_DISCLAIMER.includes("NON-MONETARY RECOGNITION NOTICE"));
    assert.ok(POINTS_SAFETY_DISCLAIMER.includes("voluntary, unpaid blood donation"));
    assert.ok(POINTS_SAFETY_DISCLAIMER.includes("no cash value"));
  });

  test("Calculates correct recognition tiers based on point thresholds", () => {
    // 0 points: Member
    const member = calculateTier(0);
    assert.strictEqual(member.tier, "Member");

    // 99 points: Member
    assert.strictEqual(calculateTier(99).tier, "Member");

    // 100 points: Bronze
    const bronze = calculateTier(100);
    assert.strictEqual(bronze.tier, "Bronze");
    assert.strictEqual(bronze.name, "Bronze Life Donor");

    // 300 points: Silver
    const silver = calculateTier(300);
    assert.strictEqual(silver.tier, "Silver");

    // 600 points: Gold
    const gold = calculateTier(600);
    assert.strictEqual(gold.tier, "Gold");

    // 1000 points: Platinum
    const platinum = calculateTier(1000);
    assert.strictEqual(platinum.tier, "Platinum");

    // 2500 points: Platinum
    assert.strictEqual(calculateTier(2500).tier, "Platinum");
  });

  test("Calculates next tier milestone and remaining points required", () => {
    const nextFor0 = getNextTier(0);
    assert.strictEqual(nextFor0?.tier, "Bronze");
    assert.strictEqual(nextFor0?.pointsNeeded, 100);

    const nextFor100 = getNextTier(100);
    assert.strictEqual(nextFor100?.tier, "Silver");
    assert.strictEqual(nextFor100?.pointsNeeded, 200);

    const nextFor500 = getNextTier(500);
    assert.strictEqual(nextFor500?.tier, "Gold");
    assert.strictEqual(nextFor500?.pointsNeeded, 100);

    const nextForPlatinum = getNextTier(1000);
    assert.strictEqual(nextForPlatinum, null, "Should return null when highest tier reached");
  });

  test("Privacy-conscious donor name formatter never exposes full surname", () => {
    assert.strictEqual(formatPrivacyConsciousName("Sarah Jenkins"), "Sarah J.");
    assert.strictEqual(formatPrivacyConsciousName("Maria Clara Santos"), "Maria S.");
    assert.strictEqual(formatPrivacyConsciousName("John"), "Joh***");
    assert.strictEqual(formatPrivacyConsciousName(null, 5), "Anonymous Donor #105");
  });

  test("adjustDonorPointsSchema rejects invalid points amounts, empty reasons, or out-of-range points", () => {
    assert.strictEqual(adjustDonorPointsSchema.safeParse({ donorProfileIdOrUserId: "usr-1", points: 0, reason: "Adjustment" }).success, false);
    assert.strictEqual(adjustDonorPointsSchema.safeParse({ donorProfileIdOrUserId: "usr-1", points: -50, reason: "Adjustment" }).success, false);
    assert.strictEqual(adjustDonorPointsSchema.safeParse({ donorProfileIdOrUserId: "usr-1", points: 10000, reason: "Adjustment" }).success, false);
    assert.strictEqual(adjustDonorPointsSchema.safeParse({ donorProfileIdOrUserId: "usr-1", points: 50, reason: "Fix" }).success, false);
    assert.strictEqual(adjustDonorPointsSchema.safeParse({ donorProfileIdOrUserId: "usr-1", points: 100, reason: "Operational correction approved by director" }).success, true);
  });

  // --------------------------------------------------------------------------
  // SUITE 2: Migration 16 Idempotency & Database Constraints
  // --------------------------------------------------------------------------
  console.log("\n[Suite 2] Migration 16 Schema & Idempotency Constraints...");

  const migration16Path = path.join(
    ROOT_DIR,
    "supabase",
    "migrations",
    "20261020_milestone9_donor_points_and_reporting.sql"
  );

  test("Migration 16 file exists and contains unique constraint for completed donations", () => {
    assert.ok(fs.existsSync(migration16Path), "Migration 16 file must exist");
    const sql = fs.readFileSync(migration16Path, "utf-8");

    // Must define points_config and donor_points_transactions
    assert.ok(sql.includes("CREATE TABLE IF NOT EXISTS public.points_config"));
    assert.ok(sql.includes("CREATE TABLE IF NOT EXISTS public.donor_points_transactions"));

    // Crucial unique index to prevent duplicate awards for the same donation
    assert.ok(
      sql.includes("idx_points_unique_completed_donation"),
      "Must create unique index on completed donations"
    );
    assert.ok(
      sql.includes("WHERE transaction_type = 'DONATION_COMPLETED'"),
      "Unique index must restrict duplicate DONATION_COMPLETED transactions"
    );
  });

  test("Migration 16 guards all policies with DROP POLICY IF EXISTS", () => {
    const sql = fs.readFileSync(migration16Path, "utf-8");
    const policyRegex = /CREATE\s+POLICY\s+"([^"]+)"/g;

    let match;
    while ((match = policyRegex.exec(sql)) !== null) {
      const policyName = match[1];
      const dropRegex = new RegExp(`DROP\\s+POLICY\\s+IF\\s+EXISTS\\s+"${policyName}"`, "i");
      assert.ok(
        dropRegex.test(sql),
        `Policy ${policyName} must be preceded by DROP POLICY IF EXISTS`
      );
    }
  });

  test("Migration 16 includes reporting performance indexes", () => {
    const sql = fs.readFileSync(migration16Path, "utf-8");
    assert.ok(sql.includes("idx_blood_requests_created_at"));
    assert.ok(sql.includes("idx_donations_recorded_at"));
    assert.ok(sql.includes("idx_donor_profiles_created_at"));
  });

  // --------------------------------------------------------------------------
  // SUITE 3: Date Range Calculations (Monday-Sunday ISO Week)
  // --------------------------------------------------------------------------
  console.log("\n[Suite 3] Reporting Date Period Calculations...");

  test("Day calculation spans exact 00:00:00 to 23:59:59.999 UTC", () => {
    const res = calculateDateRange({ periodType: "day", date: "2026-10-15" });
    assert.strictEqual(res.startDate, "2026-10-15T00:00:00.000Z");
    assert.strictEqual(res.endDate, "2026-10-15T23:59:59.999Z");
    assert.strictEqual(res.formattedStart, "2026-10-15");
    assert.strictEqual(res.formattedEnd, "2026-10-15");
  });

  test("Week calculation adheres strictly to Monday-to-Sunday convention", () => {
    // 2026-10-21 is a Wednesday.
    // The Monday of this week is 2026-10-19.
    // The Sunday of this week is 2026-10-25.
    const res = calculateDateRange({ periodType: "week", date: "2026-10-21" });
    assert.strictEqual(res.formattedStart, "2026-10-19", "Week start must be Monday");
    assert.strictEqual(res.formattedEnd, "2026-10-25", "Week end must be Sunday");
    assert.strictEqual(res.startDate, "2026-10-19T00:00:00.000Z");
    assert.strictEqual(res.endDate, "2026-10-25T23:59:59.999Z");

    // Test a Sunday date: 2026-10-25
    const sundayRes = calculateDateRange({ periodType: "week", date: "2026-10-25" });
    assert.strictEqual(sundayRes.formattedStart, "2026-10-19");
    assert.strictEqual(sundayRes.formattedEnd, "2026-10-25");

    // Test a Monday date: 2026-10-19
    const mondayRes = calculateDateRange({ periodType: "week", date: "2026-10-19" });
    assert.strictEqual(mondayRes.formattedStart, "2026-10-19");
    assert.strictEqual(mondayRes.formattedEnd, "2026-10-25");
  });

  test("Month calculation starts on 1st and ends on last day of month", () => {
    // February 2026 (non-leap year -> 28 days)
    const febRes = calculateDateRange({ periodType: "month", year: 2026, month: 2 });
    assert.strictEqual(febRes.formattedStart, "2026-02-01");
    assert.strictEqual(febRes.formattedEnd, "2026-02-28");

    // October 2026 (31 days)
    const octRes = calculateDateRange({ periodType: "month", year: 2026, month: 10 });
    assert.strictEqual(octRes.formattedStart, "2026-10-01");
    assert.strictEqual(octRes.formattedEnd, "2026-10-31");
  });

  test("Year calculation covers full calendar year Jan 1 to Dec 31", () => {
    const res = calculateDateRange({ periodType: "year", year: 2026 });
    assert.strictEqual(res.formattedStart, "2026-01-01");
    assert.strictEqual(res.formattedEnd, "2026-12-31");
  });

  test("Custom date range validates and normalizes inverted dates", () => {
    // Inverted inputs: start is after end
    const res = calculateDateRange({
      periodType: "custom",
      customStart: "2026-10-30",
      customEnd: "2026-10-10",
    });
    // Should swap and enforce start <= end
    assert.strictEqual(res.formattedStart, "2026-10-10");
    assert.strictEqual(res.formattedEnd, "2026-10-30");
  });

  // --------------------------------------------------------------------------
  // SUITE 4: Secure CSV Serializer & Formula Injection Protection
  // --------------------------------------------------------------------------
  console.log("\n[Suite 4] Secure CSV Serializer & Formula Injection Shielding...");

  test("Sanitizes cells beginning with formula trigger characters (=, +, -, @, \\t, \\r)", () => {
    assert.strictEqual(sanitizeCsvCell("=SUM(A1:A10)"), "'=SUM(A1:A10)");
    assert.strictEqual(sanitizeCsvCell("+1234567890"), "'+1234567890");
    assert.strictEqual(sanitizeCsvCell("-50"), "'-50");
    assert.strictEqual(sanitizeCsvCell("@malicious_cmd"), "'@malicious_cmd");
    assert.strictEqual(sanitizeCsvCell("\tcmd"), "'\tcmd");
    assert.strictEqual(sanitizeCsvCell("   =SUM(A1:A10)"), "'   =SUM(A1:A10)");
    assert.strictEqual(sanitizeCsvCell("  +1234567890"), "'  +1234567890");
    assert.strictEqual(sanitizeCsvCell(" @alert"), "' @alert");
  });

  test("Escapes commas, double-quotes, and newlines in accordance with RFC 4180", () => {
    // Contains comma -> wrapped in quotes
    assert.strictEqual(sanitizeCsvCell("Manila, Philippines"), '"Manila, Philippines"');

    // Contains quotes -> doubled and wrapped
    assert.strictEqual(sanitizeCsvCell('Dr. John "Jack" Doe'), '"Dr. John ""Jack"" Doe"');

    // Contains newline -> wrapped in quotes
    assert.strictEqual(sanitizeCsvCell("Line 1\nLine 2"), '"Line 1\nLine 2"');
  });

  test("Produces UTF-8 BOM prefix for Microsoft Excel Unicode compatibility", () => {
    const data = [{ name: "José Rizal", units: 2 }];
    const cols = [
      { header: "Name", accessor: (d) => d.name },
      { header: "Units", accessor: (d) => d.units },
    ];
    const csv = serializeToCsv(data, cols);

    assert.ok(csv.startsWith("\uFEFF"), "CSV must begin with UTF-8 BOM (\\uFEFF)");
    assert.ok(csv.includes("José Rizal"), "CSV must retain Unicode characters");
  });

  test("Serializes empty dataset cleanly with headers", () => {
    const cols = [
      { header: "ID", accessor: (d) => d.id },
      { header: "Status", accessor: (d) => d.status },
    ];
    const csv = serializeToCsv([], cols);
    assert.strictEqual(csv, "\uFEFFID,Status\r\n");
  });

  // --------------------------------------------------------------------------
  // SUITE 5: Request Management & Filtering
  // --------------------------------------------------------------------------
  console.log("\n[Suite 5] Request Management & State Machines...");

  const { validateStatusTransition } = await import("../lib/requests/service.js");

  test("Terminal states (FULFILLED, CANCELLED, EXPIRED, REJECTED) reject transitions", () => {
    const res = validateStatusTransition("FULFILLED", "ACTIVE", "ADMIN", false);
    assert.strictEqual(res.allowed, false);

    const res2 = validateStatusTransition("CANCELLED", "ACTIVE", "SUPER_ADMIN", false);
    assert.strictEqual(res2.allowed, false);
  });

  test("Requesters cannot self-promote requests to ACTIVE without review", () => {
    const res = validateStatusTransition("SUBMITTED", "ACTIVE", "USER", true);
    assert.strictEqual(res.allowed, false);
    assert.ok(res.reason?.includes("Verification review is required"));
  });

  test("Authorized hospital staff and admins can transition review queue to ACTIVE", () => {
    const res = validateStatusTransition("UNDER_REVIEW", "ACTIVE", "HOSPITAL_STAFF", false);
    assert.strictEqual(res.allowed, true);

    const resAdmin = validateStatusTransition("SUBMITTED", "ACTIVE", "ADMIN", false);
    assert.strictEqual(resAdmin.allowed, true);
  });

  console.log("\n================================================================================");
  console.log(`  RESULTS: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log("================================================================================");

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Fatal test runner error:", err);
  process.exit(1);
});
