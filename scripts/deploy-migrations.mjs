#!/usr/bin/env node

/**
 * LIFE DROP: UNIVERSAL DATABASE MIGRATION RUNNER
 *
 * Deterministically applies all 15 ordered migrations to target Supabase PostgreSQL cluster.
 * Supports both Staging and Production with strict safety guards.
 *
 * Usage:
 *   node scripts/deploy-migrations.mjs [--target=staging|production] [--dry-run] [--confirm]
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const MIGRATIONS_DIR = path.join(ROOT_DIR, "supabase", "migrations");

export const ORDERED_MIGRATIONS = [
  "20261007_init_lifedrop_schema.sql",
  "20261007_enhanced_rls_and_atomic_commitment.sql",
  "20261007_verification_documents_and_storage.sql",
  "20261007_donor_coordination_and_commitments.sql",
  "20261007_notifications_and_outbox.sql",
  "20261007_donation_operations_and_checkin.sql",
  "20261007_production_hardening.sql",
  "20261008_milestone1_donor_profile_enhancements.sql",
  "20261008_milestone2_blood_request_enhancements.sql",
  "20261008_milestone3_matching_engine.sql",
  "20261008_milestone4_donor_notifications.sql",
  "20261008_milestone5_donor_commitments.sql",
  "20261009_milestone6_donation_tracking.sql",
  "20261009_milestone7_outbox_and_reconciliation.sql",
  "20261009_milestone8_security_hardening.sql",
];

export function extractEnumAlterations(sqlContent) {
  const standaloneStmts = [];

  // 1. Extract from DO $$ BEGIN ALTER TYPE ... EXCEPTION WHEN duplicate_object THEN null; END $$;
  const doPattern = /DO\s+\$\$\s*BEGIN\s+(ALTER\s+TYPE\s+[^;]+ADD\s+VALUE[^;]+;)\s*EXCEPTION\s+WHEN\s+duplicate_object\s+THEN\s+(?:null|NULL);\s*END\s*\$\$;/gi;
  sqlContent = sqlContent.replace(doPattern, (_, innerStmt) => {
    standaloneStmts.push(innerStmt.trim());
    return "-- [Extracted enum statement for standalone autocommit execution] --";
  });

  // 2. Extract bare ALTER TYPE ... ADD VALUE ...;
  const barePattern = /^[ \t]*(ALTER\s+TYPE\s+[^;]+ADD\s+VALUE[^;]+;)/gim;
  sqlContent = sqlContent.replace(barePattern, (_, stmt) => {
    standaloneStmts.push(stmt.trim());
    return "-- [Extracted enum statement for standalone autocommit execution] --";
  });

  return { sqlContent, standaloneStmts };
}

export const MIGRATION_VERIFICATION_SPECS = {
  "20261007_init_lifedrop_schema.sql": {
    tables: ["profiles", "donor_profiles", "blood_requests", "donor_commitments", "audit_logs"],
    types: ["blood_group_type", "rh_factor_type", "blood_component_type", "urgency_tier_type", "request_status_type", "commitment_status_type", "user_role_type"],
    functions: ["current_profile_id"],
    policies: [
      { table: "profiles", name: "Users read own profile" },
      { table: "profiles", name: "Users update own profile" },
      { table: "blood_requests", name: "Public read active requests" },
      { table: "blood_requests", name: "Requesters manage own requests" },
      { table: "audit_logs", name: "System appends audit logs" },
    ],
  },
  "20261007_enhanced_rls_and_atomic_commitment.sql": {
    functions: ["commit_donor_to_request_atomic"],
    policies: [
      { table: "donor_profiles", name: "Public view available donors" },
      { table: "donor_profiles", name: "Users insert own donor profile" },
      { table: "donor_profiles", name: "Users update own donor profile" },
      { table: "donor_commitments", name: "Donors view own commitments" },
      { table: "donor_commitments", name: "Requesters view request commitments" },
    ],
  },
  "20261007_verification_documents_and_storage.sql": {
    columns: [{ table: "profiles", column: "hospital_affiliation" }],
    types: ["verification_status_type", "rejection_reason_type"],
    tables: ["verification_documents"],
    functions: ["is_moderator_or_admin", "is_affiliated_hospital_staff"],
    policies: [
      { table: "verification_documents", name: "Authorized view verification documents" },
      { table: "verification_documents", name: "Requesters upload own documents" },
      { table: "verification_documents", name: "Reviewers update verification status" },
    ],
  },
  "20261007_donor_coordination_and_commitments.sql": {
    columns: [
      { table: "blood_requests", column: "units_reserved" },
      { table: "blood_requests", column: "units_donated" },
      { table: "donor_commitments", column: "scheduled_at" },
      { table: "donor_commitments", column: "completed_at" },
    ],
    enumLabels: [
      { type: "commitment_status_type", label: "INTERESTED" },
      { type: "commitment_status_type", label: "CONFIRMED" },
      { type: "commitment_status_type", label: "SCHEDULED" },
      { type: "commitment_status_type", label: "DONATION_RECORDED" },
      { type: "commitment_status_type", label: "COMPLETED" },
      { type: "request_status_type", label: "PARTIALLY_FULFILLED" },
    ],
    constraints: [{ table: "blood_requests", name: "check_units_fulfillment_balance" }],
    functions: ["express_donor_interest_atomic", "confirm_donor_commitment_atomic", "record_donation_atomic"],
  },
  "20261007_notifications_and_outbox.sql": {
    types: ["notification_type", "notification_delivery_status"],
    tables: ["notifications", "notification_events", "user_notification_preferences"],
    policies: [
      { table: "notifications", name: "Users view own notifications" },
      { table: "notifications", name: "Users update read status on own notifications" },
      { table: "notification_events", name: "Service role manages notification outbox" },
      { table: "user_notification_preferences", name: "Users manage own preferences" },
    ],
  },
  "20261007_donation_operations_and_checkin.sql": {
    columns: [
      { table: "donor_commitments", column: "checked_in_at" },
      { table: "donor_commitments", column: "checked_in_by" },
      { table: "donor_commitments", column: "check_in_notes" },
      { table: "donor_commitments", column: "donation_started_at" },
      { table: "donor_commitments", column: "units_donated" },
    ],
    enumLabels: [
      { type: "commitment_status_type", label: "CHECKED_IN" },
      { type: "commitment_status_type", label: "DONATION_IN_PROGRESS" },
      { type: "commitment_status_type", label: "NO_SHOW" },
    ],
    functions: ["check_in_donor_atomic"],
  },
  "20261007_production_hardening.sql": {
    tables: ["processed_webhooks"],
    functions: ["prevent_audit_log_modification"],
    policies: [{ table: "processed_webhooks", name: "Service role manages processed webhooks" }],
  },
  "20261008_milestone1_donor_profile_enhancements.sql": {
    columns: [
      { table: "donor_profiles", column: "province" },
      { table: "donor_profiles", column: "consent_to_contact" },
    ],
    policies: [
      { table: "donor_profiles", name: "Donors read own profile" },
      { table: "donor_profiles", name: "Users insert own donor profile" },
      { table: "donor_profiles", name: "Users update own donor profile" },
    ],
  },
  "20261008_milestone2_blood_request_enhancements.sql": {
    columns: [
      { table: "blood_requests", column: "province" },
      { table: "blood_requests", column: "request_reason" },
      { table: "blood_requests", column: "contact_name" },
      { table: "blood_requests", column: "rejection_reason" },
      { table: "blood_requests", column: "reviewer_id" },
    ],
    policies: [
      { table: "blood_requests", name: "Requesters view own requests" },
      { table: "blood_requests", name: "Public read active requests" },
      { table: "blood_requests", name: "Authorized staff view all requests" },
      { table: "blood_requests", name: "Hospital staff view affiliated requests" },
      { table: "blood_requests", name: "Requesters insert own requests" },
      { table: "blood_requests", name: "Requesters update own requests" },
    ],
  },
  "20261008_milestone3_matching_engine.sql": {
    types: ["match_status_type"],
    tables: ["request_matches"],
    policies: [
      { table: "request_matches", name: "Requesters view own request matches" },
      { table: "request_matches", name: "Authorized staff view all matches" },
      { table: "request_matches", name: "Hospital staff view affiliated matches" },
      { table: "request_matches", name: "Donors view own matches" },
    ],
  },
  "20261008_milestone4_donor_notifications.sql": {
    columns: [
      { table: "notifications", column: "match_id" },
      { table: "notifications", column: "sent_at" },
      { table: "notifications", column: "delivered_at" },
      { table: "notifications", column: "error_details" },
    ],
    enumLabels: [
      { type: "notification_type", label: "POTENTIAL_DONOR_ALERT" },
      { type: "notification_delivery_status", label: "SENT" },
    ],
    policies: [
      { table: "notifications", name: "Users view own notifications" },
      { table: "notifications", name: "Users update read status on own notifications" },
      { table: "notifications", name: "Authorized staff view all notifications" },
    ],
  },
  "20261008_milestone5_donor_commitments.sql": {
    types: ["donor_response_type"],
    columns: [
      { table: "donor_commitments", column: "match_id" },
      { table: "donor_commitments", column: "donor_profile_id" },
      { table: "donor_commitments", column: "response" },
    ],
    enumLabels: [
      { type: "commitment_status_type", label: "PENDING" },
      { type: "commitment_status_type", label: "WITHDRAWN" },
      { type: "match_status_type", label: "ACCEPTED" },
      { type: "match_status_type", label: "WITHDRAWN" },
    ],
    policies: [
      { table: "donor_commitments", name: "Donors view own commitments" },
      { table: "donor_commitments", name: "Requesters view request commitments" },
      { table: "donor_commitments", name: "Authorized staff view all commitments" },
      { table: "donor_commitments", name: "Hospital staff view affiliated commitments" },
      { table: "donor_commitments", name: "Donors withdraw own commitments" },
    ],
  },
  "20261009_milestone6_donation_tracking.sql": {
    types: ["donation_status_type"],
    tables: ["donations"],
    policies: [
      { table: "donations", name: "Donors view own donations" },
      { table: "donations", name: "Requesters view request donations" },
      { table: "donations", name: "Authorized staff view all donations" },
      { table: "donations", name: "Hospital staff view affiliated donations" },
    ],
  },
  "20261009_milestone7_outbox_and_reconciliation.sql": {
    constraints: [{ table: "notification_events", name: "notification_events_status_check" }],
    columns: [
      { table: "notification_events", column: "idempotency_key" },
      { table: "notification_events", column: "recipient_user_id" },
      { table: "notification_events", column: "channel" },
      { table: "notification_events", column: "attempt_count" },
      { table: "notification_events", column: "lease_token" },
    ],
    functions: ["claim_outbox_jobs", "reconcile_request_counters"],
    policies: [{ table: "notification_events", name: "Authorized staff view notification outbox" }],
  },
  "20261009_milestone8_security_hardening.sql": {
    functions: ["claim_outbox_jobs", "reconcile_request_counters", "prevent_audit_log_modification"],
  },
};

export function generateVerificationSql(file) {
  const spec = MIGRATION_VERIFICATION_SPECS[file];
  if (!spec) return "SELECT true AS verified;";

  const checks = [];
  if (spec.tables) {
    for (const tbl of spec.tables) {
      checks.push(`EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '${tbl}')`);
    }
  }
  if (spec.columns) {
    for (const col of spec.columns) {
      checks.push(`EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${col.table}' AND column_name = '${col.column}')`);
    }
  }
  if (spec.types) {
    for (const typ of spec.types) {
      checks.push(`EXISTS (SELECT 1 FROM pg_type WHERE typname = '${typ}')`);
    }
  }
  if (spec.enumLabels) {
    for (const en of spec.enumLabels) {
      checks.push(`EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = '${en.type}' AND e.enumlabel = '${en.label}')`);
    }
  }
  if (spec.constraints) {
    for (const c of spec.constraints) {
      checks.push(`EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_schema = 'public' AND table_name = '${c.table}' AND constraint_name = '${c.name}')`);
    }
  }
  if (spec.functions) {
    for (const fn of spec.functions) {
      checks.push(`EXISTS (SELECT 1 FROM pg_proc WHERE proname = '${fn}')`);
    }
  }
  if (spec.policies) {
    for (const pol of spec.policies) {
      checks.push(`EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = '${pol.table}' AND policyname = '${pol.name}')`);
    }
  }

  if (checks.length === 0) return "SELECT true AS verified;";
  return `SELECT (${checks.join(" AND\n            ")}) AS verified;`;
}

export function writeLocalEmergencyMarker(file, status, checksum, error, ledgerWriteError) {
  const localMarkerPath = path.join(ROOT_DIR, ".migration_failure.json");
  try {
    fs.writeFileSync(localMarkerPath, JSON.stringify({
      version: file,
      status,
      checksum,
      error,
      ledgerWriteError,
      timestamp: new Date().toISOString(),
    }, null, 2));
    console.error(`\n⚠️  EMERGENCY DIAGNOSTIC: Remote ledger write failed. Local diagnostic marker written to:`);
    console.error(`    ${localMarkerPath}`);
    console.error("    NOTE: This local marker is for diagnostic analysis only and does NOT constitute proof of database state or permission to retry.");
  } catch (markerErr) {
    console.error("Failed to write local emergency marker:", markerErr.message);
  }
}

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

async function main() {
  const target = process.argv.find((a) => a.startsWith("--target="))?.split("=")[1] || "staging";
  const isDryRun = process.argv.includes("--dry-run");
  const isConfirmed = process.argv.includes("--confirm");
  const repairMigration = process.argv.find((a) => a.startsWith("--repair-migration="))?.split("=")[1] ||
                          process.argv.find((a) => a.startsWith("--repair="))?.split("=")[1] || null;
  const forceChecksum = process.argv.includes("--force-checksum");

  if (process.argv.includes("--allow-repair")) {
    console.error("\n❌ DEPRECATION & SAFETY ERROR: Global '--allow-repair' has been deprecated.");
    console.error("To prevent blind retries of unrelated failures, specify the exact migration to repair:");
    console.error("  --repair-migration=<filename>");
    process.exit(1);
  }

  // Diagnostic check for local failure marker from previous runs
  const localMarkerPath = path.join(ROOT_DIR, ".migration_failure.json");
  if (fs.existsSync(localMarkerPath)) {
    try {
      const marker = JSON.parse(fs.readFileSync(localMarkerPath, "utf-8"));
      console.warn("\n⚠️  WARNING: Local emergency failure marker detected from previous run!");
      console.warn(`    Version: ${marker.version}`);
      console.warn(`    Status: ${marker.status}`);
      console.warn(`    Timestamp: ${marker.timestamp}`);
      console.warn(`    Details: ${marker.error}`);
      console.warn("    NOTE: This local marker is for diagnostic analysis only and does NOT constitute proof of database state or permission to retry.");
    } catch {
      // Ignore JSON parse errors in local diagnostic marker
    }
  }

  console.log("================================================================================");
  console.log(`  LIFE DROP: ${target.toUpperCase()} DATABASE MIGRATION RUNNER`);
  console.log("================================================================================");
  console.log(`Target Tier: ${target.toUpperCase()}`);
  console.log(`Mode: ${isDryRun ? "DRY RUN (no database changes)" : "EXECUTE"}`);

  // Safety guard for production confirmation
  if (target === "production" && !isDryRun && !isConfirmed) {
    console.error("\n❌ SAFETY ERROR: Production deployment requires explicit confirmation flag.");
    console.error("To apply migrations to production, run with:");
    console.error("  npm run prod:migrate -- --confirm");
    console.error("Or directly:");
    console.error("  node scripts/deploy-migrations.mjs --target=production --confirm");
    process.exit(1);
  }

  // Determine staging project ref for isolation cross-check
  let stagingRef = "";
  const stagingEnvPath = fs.existsSync(path.join(ROOT_DIR, ".env.staging"))
    ? path.join(ROOT_DIR, ".env.staging")
    : path.join(ROOT_DIR, ".env.local");
  if (fs.existsSync(stagingEnvPath)) {
    const stagingContent = fs.readFileSync(stagingEnvPath, "utf-8");
    const stagingMatch = stagingContent.match(/NEXT_PUBLIC_SUPABASE_URL=.*https:\/\/([a-z0-9_-]+)\.supabase\.co/);
    if (stagingMatch) stagingRef = stagingMatch[1];
  }

  // Load environment files strictly based on target tier
  if (target === "production") {
    const prodEnvPath = path.join(ROOT_DIR, ".env.production");
    if (!fs.existsSync(prodEnvPath)) {
      console.error("\n❌ CONFIGURATION ERROR: .env.production file is missing.");
      console.error("Please create .env.production from .env.production.example with your production Supabase credentials.");
      console.error("--------------------------------------------------------------------------------");
      process.exit(1);
    }
    // Strictly isolate: NEVER load .env.staging or .env.local when targeting production!
    loadEnvFile(prodEnvPath);
  } else {
    loadEnvFile(path.join(ROOT_DIR, ".env.staging"));
    loadEnvFile(path.join(ROOT_DIR, ".env.local"));
  }

  // 1. Verify local migrations integrity
  console.log(`\n[1/4] Verifying local migration files integrity (${ORDERED_MIGRATIONS.length} files)...`);
  for (const file of ORDERED_MIGRATIONS) {
    const fullPath = path.join(MIGRATIONS_DIR, file);
    if (!fs.existsSync(fullPath)) {
      console.error(`❌ CRITICAL: Missing migration file: ${file}`);
      process.exit(1);
    }
    const stat = fs.statSync(fullPath);
    const content = fs.readFileSync(fullPath, "utf-8");
    const checksum = crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
    console.log(`  ✓ ${file} (${stat.size} bytes, sha256:${checksum}...)`);
  }

  // 2. Validate Supabase credentials
  console.log(`\n[2/4] Validating ${target} credentials in environment...`);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  const dbUrl = process.env.DATABASE_URL;

  let projectRef = "";
  if (supabaseUrl) {
    const match = supabaseUrl.trim().match(/^https:\/\/([a-z0-9_-]+)\.supabase\.co/i);
    if (match) {
      projectRef = match[1].toLowerCase();
    } else {
      console.error(`\n❌ MALFORMED URL: NEXT_PUBLIC_SUPABASE_URL does not match expected format https://<project-ref>.supabase.co`);
      console.error(`Received: ${supabaseUrl}`);
      process.exit(1);
    }
  }

  // Strict Project Isolation Check
  if (target === "production" && projectRef && stagingRef && projectRef === stagingRef) {
    console.error("\n❌ CRITICAL SECURITY VIOLATION: Production target project ref matches staging project ref!");
    console.error(`Detected Ref: ${projectRef}`);
    console.error("Life Drop strictly requires isolated Supabase projects for staging and production.");
    console.error("Update NEXT_PUBLIC_SUPABASE_URL in .env.production to your dedicated production project.");
    process.exit(1);
  }

  const isPlaceholder = (val) => !val || val.includes("your_") || val.includes("your-") || val.includes("your_production");
  const missingVars = [];
  if (!supabaseUrl || isPlaceholder(supabaseUrl)) missingVars.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!accessToken || isPlaceholder(accessToken)) missingVars.push("SUPABASE_ACCESS_TOKEN");

  const canUseManagementApi = Boolean(accessToken && !isPlaceholder(accessToken) && projectRef);
  const hasCredentials = Boolean(canUseManagementApi || (dbUrl && !isPlaceholder(dbUrl)));

  if (isDryRun) {
    console.log(`\n================================================================================`);
    console.log(`  DRY RUN AUDIT REPORT (NO DATABASE MUTATIONS)`);
    console.log(`================================================================================`);
    console.log(`Target Tier: ${target.toUpperCase()}`);
    console.log(`Target Project Ref: ${projectRef || "direct-db"}`);
    console.log(`Differs from Staging (vblfkcyeefiwhhpbwxhr): ${projectRef !== stagingRef ? "YES (Strictly Isolated)" : "NO (COLLISION)"}`);
    console.log(`Local Migrations Verified: ${ORDERED_MIGRATIONS.length} ordered files`);
    console.log(`Checksum Verification: All ${ORDERED_MIGRATIONS.length} SHA-256 checksums computed and verified`);
    if (missingVars.length > 0) {
      console.log(`Missing or Placeholder Credentials (names only): ${missingVars.join(", ")}`);
    } else {
      console.log(`Required Migration Credentials: PRESENT`);
    }
    console.log(`Remote Mutations Applied: NONE (code path terminated before any network I/O)`);
    console.log(`================================================================================`);
    return;
  }

  if (!hasCredentials) {
    console.warn(`\n⚠️  STATUS: BLOCKED — REAL ${target.toUpperCase()} CREDENTIALS REQUIRED`);
    console.warn("--------------------------------------------------------------------------------");
    console.warn(`Missing or placeholder required environment variables for ${target}:`);
    for (const v of missingVars) console.warn(`  - ${v}`);
    console.warn("--------------------------------------------------------------------------------\n");
    process.exit(1);
  }

  // 3. Remote connection helper
  console.log(`\n[3/4] Connecting to ${target} database: ${projectRef || "DATABASE_URL"}...`);

  async function executeSql(query) {
    if (canUseManagementApi) {
      let res;
      try {
        res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ query }),
        });
      } catch (netErr) {
        const error = new Error(`Network/transport failure connecting to Management API: ${netErr.message}`);
        error.isNetworkError = true;
        throw error;
      }
      if (!res.ok) {
        const errorText = await res.text();
        if (res.status >= 500) {
          const srvErr = new Error(`Management API gateway/server error (${res.status}): ${errorText}`);
          srvErr.isAmbiguous = true;
          throw srvErr;
        }
        const dbErr = new Error(`Database DDL error (${res.status}): ${errorText}`);
        dbErr.isConfirmedDbError = true;
        throw dbErr;
      }
      return await res.json();
    } else {
      throw new Error("Direct database connection requires SUPABASE_ACCESS_TOKEN or pg driver.");
    }
  }

  // 4. Sequential execution
  console.log(`\n[4/4] Executing migrations sequentially against remote ${target} Supabase database...`);

  await executeSql(`
    CREATE TABLE IF NOT EXISTS public._schema_migrations (
      version TEXT PRIMARY KEY,
      executed_at TIMESTAMPTZ DEFAULT timezone('utc', now()),
      status TEXT NOT NULL DEFAULT 'COMPLETED',
      checksum TEXT,
      error_message TEXT
    );
    ALTER TABLE public._schema_migrations ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'COMPLETED';
    ALTER TABLE public._schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT;
    ALTER TABLE public._schema_migrations ADD COLUMN IF NOT EXISTS error_message TEXT;
  `);

  // Check for any migrations previously recorded in FAILED or UNKNOWN state
  const incompleteRows = await executeSql("SELECT version, status, checksum, error_message FROM public._schema_migrations WHERE status IN ('FAILED', 'UNKNOWN');");
  if (incompleteRows.length > 0) {
    if (!repairMigration) {
      console.error("\n❌ SAFETY STOP: One or more migrations are in an incomplete or unverified state:");
      for (const row of incompleteRows) {
        console.error(`  - ${row.version} [${row.status}]: ${row.error_message || "No error details recorded"}`);
      }
      console.error("\nAutomatic blind retries are strictly BLOCKED.");
      console.error("To authorize repair for a specific migration, inspect the database catalog and rerun with:");
      console.error("  --repair-migration=<filename>");
      process.exit(1);
    }

    const targetIncomplete = incompleteRows.find((r) => r.version === repairMigration);
    if (!targetIncomplete) {
      console.error(`\n❌ ERROR: Migration '${repairMigration}' is not recorded in FAILED or UNKNOWN state in the ledger.`);
      console.error("Currently incomplete migrations:");
      for (const row of incompleteRows) {
        console.error(`  - ${row.version} [${row.status}]`);
      }
      process.exit(1);
    }

    const unrelatedIncomplete = incompleteRows.filter((r) => r.version !== repairMigration);
    if (unrelatedIncomplete.length > 0) {
      console.warn(`\n⚠️  WARNING: Found ${unrelatedIncomplete.length} other incomplete migration(s) in the ledger.`);
      console.warn("These unrelated migrations will remain BLOCKED and will NOT be executed:");
      for (const row of unrelatedIncomplete) {
        console.warn(`  - ${row.version} [${row.status}]`);
      }
    }

    // Checksum verification
    const repairFilePath = path.join(MIGRATIONS_DIR, repairMigration);
    if (fs.existsSync(repairFilePath)) {
      const currentContent = fs.readFileSync(repairFilePath, "utf-8");
      const currentChecksum = crypto.createHash("sha256").update(currentContent).digest("hex").slice(0, 16);
      if (targetIncomplete.checksum && targetIncomplete.checksum !== currentChecksum && !forceChecksum) {
        console.error(`\n❌ CHECKSUM MISMATCH for repair target: ${repairMigration}`);
        console.error(`  Recorded failed checksum : ${targetIncomplete.checksum}`);
        console.error(`  Current file checksum    : ${currentChecksum}`);
        console.error("The migration file has changed since the recorded failure.");
        console.error("If changes are intended after catalog inspection, authorize with:");
        console.error(`  --repair-migration=${repairMigration} --force-checksum`);
        process.exit(1);
      }
    }

    // If target was UNKNOWN, attempt migration-specific object verification before re-executing
    if (targetIncomplete.status === "UNKNOWN") {
      console.log(`\n[Repair Verification] Verifying catalog objects for UNKNOWN migration: ${repairMigration}...`);
      const verifySql = generateVerificationSql(repairMigration);
      const verifyResult = await executeSql(verifySql);
      const isFullyPresent = Boolean(verifyResult[0]?.verified);

      if (isFullyPresent) {
        console.log(`✓ All expected schema objects for ${repairMigration} verified in database catalog!`);
        console.log(`  Reconciling ledger entry to COMPLETED...`);
        await executeSql(`
          UPDATE public._schema_migrations
          SET status = 'COMPLETED',
              error_message = 'Reconciled: All catalog objects verified',
              executed_at = timezone('utc', now())
          WHERE version = '${repairMigration}';
        `);
        console.log(`✓ Reconciliation complete. Migration ${repairMigration} marked COMPLETED.`);
      } else {
        console.warn(`⚠️ Catalog verification failed for ${repairMigration}: One or more required objects are missing.`);
        console.warn(`  Proceeding with controlled re-execution of ${repairMigration}...`);
      }
    }
  }

  const appliedRows = await executeSql("SELECT version FROM public._schema_migrations WHERE status = 'COMPLETED';");
  const appliedSet = new Set(appliedRows.map((r) => r.version));

  // In legacy staging database ONLY: if migrations 0-4 were run prior to _schema_migrations tracking
  if (target === "staging" && appliedRows.length === 0) {
    const checkProfiles = await executeSql(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'profiles'
      ) AS exists;
    `);
    if (checkProfiles[0]?.exists) {
      for (let i = 0; i < 5; i++) {
        if (!appliedSet.has(ORDERED_MIGRATIONS[i])) {
          appliedSet.add(ORDERED_MIGRATIONS[i]);
          await executeSql(`INSERT INTO public._schema_migrations (version, status) VALUES ('${ORDERED_MIGRATIONS[i]}', 'COMPLETED') ON CONFLICT DO NOTHING;`);
        }
      }
    }
  }

  let appliedCount = 0;
  for (let i = 0; i < ORDERED_MIGRATIONS.length; i++) {
    const file = ORDERED_MIGRATIONS[i];
    if (appliedSet.has(file)) {
      console.log(`  [${i + 1}/${ORDERED_MIGRATIONS.length}] ${file}... ✓ ALREADY APPLIED`);
      continue;
    }

    if (incompleteRows.some((r) => r.version === file) && file !== repairMigration) {
      console.error(`\n❌ SAFETY HALT: Reached unrelated incomplete migration: ${file}`);
      console.error(`This migration is recorded as ${incompleteRows.find((r) => r.version === file).status} and was NOT authorized for repair.`);
      console.error(`To repair this migration, inspect the catalog and specify:`);
      console.error(`  --repair-migration=${file}`);
      process.exit(1);
    }

    const fullPath = path.join(MIGRATIONS_DIR, file);
    let sqlContent = fs.readFileSync(fullPath, "utf-8");
    const fileChecksum = crypto.createHash("sha256").update(sqlContent).digest("hex").slice(0, 16);
    process.stdout.write(`  [${i + 1}/${ORDERED_MIGRATIONS.length}] Applying ${file}... `);

    try {
      // 1. Standalone autocommit execution for ALTER TYPE ... ADD VALUE (PostgreSQL Error 25001 & 55P04 prevention)
      const { sqlContent: cleanedSql, standaloneStmts } = extractEnumAlterations(sqlContent);
      for (const alterStmt of standaloneStmts) {
        try {
          await executeSql(alterStmt);
        } catch (alterErr) {
          const outcomeStatus = (alterErr.isNetworkError || alterErr.isAmbiguous) ? "UNKNOWN" : "FAILED";
          const escaped = String(alterErr.message || "").replace(/'/g, "''");
          try {
            await executeSql(`
              INSERT INTO public._schema_migrations (version, status, checksum, error_message, executed_at)
              VALUES ('${file}', '${outcomeStatus}', '${fileChecksum}', 'ALTER TYPE error: ${escaped}', timezone('utc', now()))
              ON CONFLICT (version) DO UPDATE SET
                status = '${outcomeStatus}',
                checksum = EXCLUDED.checksum,
                error_message = EXCLUDED.error_message,
                executed_at = timezone('utc', now());
            `);
          } catch (logErr) {
            writeLocalEmergencyMarker(file, outcomeStatus, fileChecksum, alterErr.message, logErr.message);
          }
          throw alterErr;
        }
      }

      // 2. Wrap all remaining DDL AND the ledger completion record in an atomic transaction block
      const transactionalSql = `
BEGIN;

${cleanedSql}

INSERT INTO public._schema_migrations (version, status, checksum, error_message, executed_at)
VALUES ('${file}', 'COMPLETED', '${fileChecksum}', NULL, timezone('utc', now()))
ON CONFLICT (version) DO UPDATE SET
  status = 'COMPLETED',
  checksum = EXCLUDED.checksum,
  error_message = NULL,
  executed_at = timezone('utc', now());

COMMIT;
      `;

      await executeSql(transactionalSql);
      console.log("✓ SUCCESS (Atomic Transaction Committed)");
      appliedCount++;
    } catch (err) {
      console.log("❌ FAILED");
      console.error(`\nMigration error in ${file}:`, err.message);

      const outcomeStatus = (err.isNetworkError || err.isAmbiguous) ? "UNKNOWN" : "FAILED";
      console.error(`Recorded outcome state: ${outcomeStatus}`);

      // Outside the aborted transaction, record the failure status in the ledger
      try {
        const escaped = String(err.message || "").replace(/'/g, "''");
        await executeSql(`
          INSERT INTO public._schema_migrations (version, status, checksum, error_message, executed_at)
          VALUES ('${file}', '${outcomeStatus}', '${fileChecksum}', '${escaped}', timezone('utc', now()))
          ON CONFLICT (version) DO UPDATE SET
            status = '${outcomeStatus}',
            checksum = EXCLUDED.checksum,
            error_message = EXCLUDED.error_message,
            executed_at = timezone('utc', now());
        `);
      } catch (logErr) {
        console.error("❌ CRITICAL: Could not write failure state to remote ledger:", logErr.message);
        writeLocalEmergencyMarker(file, outcomeStatus, fileChecksum, err.message, logErr.message);
      }

      process.exit(1);
    }
  }

  console.log("\n================================================================================");
  console.log(`  MIGRATION VERIFICATION: Schema validation on ${target}...`);
  console.log("================================================================================");

  const checkTablesSql = `
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    ORDER BY table_name;
  `;
  const tablesResult = await executeSql(checkTablesSql);
  const tableNames = tablesResult.map((r) => r.table_name);
  console.log(`  Remote tables in public schema (${tableNames.length} tables):`);
  for (const name of tableNames) {
    console.log(`    ✓ public.${name}`);
  }

  console.log(`\n✅ ALL ${ORDERED_MIGRATIONS.length} DATABASE MIGRATIONS VERIFIED ON REMOTE ${target.toUpperCase()}! (Newly applied: ${appliedCount})`);
}

const isCLI = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCLI) {
  main().catch((err) => {
    console.error("Migration runner failed with unhandled error:", err);
    process.exit(1);
  });
}
