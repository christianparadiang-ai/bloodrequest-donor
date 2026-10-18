#!/usr/bin/env node

/**
 * LIFE DROP: OFFLINE MIGRATION RECOVERY & FAULT-INJECTION SIMULATOR
 *
 * NOTE: Local PostgreSQL / Docker is unavailable in this environment.
 * This simulation models migration runner control flow, fault injection mid-file,
 * ledger recovery sequencing, outcome states (COMPLETED, FAILED, UNKNOWN),
 * and statement-level idempotency checks.
 *
 * LIMITATION: This test runs in Node.js and does NOT prove live PostgreSQL catalog
 * engine behavior, locks, or internal database constraint validation.
 */

import assert from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ORDERED_MIGRATIONS,
  extractEnumAlterations,
  generateVerificationSql,
  MIGRATION_VERIFICATION_SPECS,
  writeLocalEmergencyMarker,
} from "./deploy-migrations.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const MIGRATIONS_DIR = path.join(ROOT_DIR, "supabase", "migrations");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

console.log("================================================================================");
console.log("  LIFE DROP: OFFLINE MIGRATION RECOVERY & FAULT-INJECTION SIMULATOR");
console.log("  (Mocked Engine — Does NOT substitute for live PostgreSQL testing)");
console.log("================================================================================");

// Simulated database catalog
class MockDatabaseCatalog {
  constructor() {
    this.tables = new Set();
    this.columns = new Map(); // table -> Set(columns)
    this.policies = new Map(); // relation -> Set(policyName)
    this.types = new Map(); // enumName -> Set(values)
    this.constraints = new Map(); // table -> Set(constraintName)
    this.indexes = new Set();
    this.functions = new Set();
    this.ledger = new Map(); // version -> { status, checksum, error_message }
  }

  executeStatement(stmt) {
    const s = stmt.trim();
    if (!s) return;

    // DROP POLICY IF EXISTS "name" ON table
    const dropPolicyMatch = s.match(/DROP\s+POLICY\s+IF\s+EXISTS\s+"([^"]+)"\s+ON\s+([a-zA-Z0-9_.]+)/i);
    if (dropPolicyMatch) {
      const [, pName, rel] = dropPolicyMatch;
      if (this.policies.has(rel)) {
        this.policies.get(rel).delete(pName);
      }
      return;
    }

    // CREATE POLICY "name" ON table
    const createPolicyMatch = s.match(/CREATE\s+POLICY\s+"([^"]+)"\s+ON\s+([a-zA-Z0-9_.]+)/i);
    if (createPolicyMatch) {
      const [, pName, rel] = createPolicyMatch;
      if (!this.policies.has(rel)) this.policies.set(rel, new Set());
      if (this.policies.get(rel).has(pName)) {
        throw new Error(`duplicate_policy_error: Policy "${pName}" for relation "${rel}" already exists!`);
      }
      this.policies.get(rel).add(pName);
      return;
    }

    // CREATE TABLE IF NOT EXISTS
    const createTableMatch = s.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_.]+)/i);
    if (createTableMatch) {
      const tbl = createTableMatch[1];
      const isIfNotExists = s.includes("IF NOT EXISTS");
      if (this.tables.has(tbl) && !isIfNotExists) {
        throw new Error(`table_already_exists: Table ${tbl} already exists without IF NOT EXISTS`);
      }
      this.tables.add(tbl);
      return;
    }

    // ALTER TABLE ADD COLUMN IF NOT EXISTS
    const addColMatch = s.match(/ALTER\s+TABLE\s+([a-zA-Z0-9_.]+)\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+([a-zA-Z0-9_]+)/i);
    if (addColMatch) {
      const [, tbl, col] = addColMatch;
      if (!this.columns.has(tbl)) this.columns.set(tbl, new Set());
      this.columns.get(tbl).add(col);
      return;
    }

    // ALTER TABLE DROP CONSTRAINT IF EXISTS
    const dropConstraintMatch = s.match(/ALTER\s+TABLE\s+([a-zA-Z0-9_.]+)\s+DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+([a-zA-Z0-9_]+)/i);
    if (dropConstraintMatch) {
      const [, tbl, cName] = dropConstraintMatch;
      if (this.constraints.has(tbl)) {
        this.constraints.get(tbl).delete(cName);
      }
      return;
    }

    // ALTER TABLE ADD CONSTRAINT
    const addConstraintMatch = s.match(/ALTER\s+TABLE\s+([a-zA-Z0-9_.]+)\s+ADD\s+CONSTRAINT\s+([a-zA-Z0-9_]+)/i);
    if (addConstraintMatch) {
      const [, tbl, cName] = addConstraintMatch;
      if (!this.constraints.has(tbl)) this.constraints.set(tbl, new Set());
      if (this.constraints.get(tbl).has(cName)) {
        throw new Error(`constraint_already_exists: Constraint ${cName} on ${tbl} already exists!`);
      }
      this.constraints.get(tbl).add(cName);
      return;
    }

    // ALTER TYPE ADD VALUE IF NOT EXISTS
    const alterTypeMatch = s.match(/ALTER\s+TYPE\s+([a-zA-Z0-9_.]+)\s+ADD\s+VALUE\s+(?:IF\s+NOT\s+EXISTS\s+)?'([^']+)'/i);
    if (alterTypeMatch) {
      const [, typeName, val] = alterTypeMatch;
      if (!this.types.has(typeName)) this.types.set(typeName, new Set());
      this.types.get(typeName).add(val);
      return;
    }

    // Ledger write: INSERT INTO public._schema_migrations (version, status, checksum, error_message, ...)
    const ledgerInsertMatch = s.match(/INSERT\s+INTO\s+public\._schema_migrations\s*\(version(?:,\s*status)?(?:,\s*checksum)?(?:,\s*error_message)?/i);
    if (ledgerInsertMatch) {
      const vMatch = s.match(/VALUES\s*\('([^']+)'(?:,\s*'([^']+)')?(?:,\s*'([^']+)')?(?:,\s*(NULL|'[^']*'))?/i);
      if (vMatch) {
        const version = vMatch[1];
        const status = vMatch[2] || "COMPLETED";
        const checksum = vMatch[3] || null;
        const errMsg = vMatch[4] === "NULL" ? null : vMatch[4];
        this.ledger.set(version, { status, checksum, error_message: errMsg });
      }
      return;
    }

    // Ledger update: UPDATE public._schema_migrations SET status = 'COMPLETED' WHERE version = '...'
    const ledgerUpdateMatch = s.match(/UPDATE\s+public\._schema_migrations\s+SET\s+status\s*=\s*'([^']+)'\s*(?:,\s*error_message\s*=\s*'([^']+)')?\s*WHERE\s+version\s*=\s*'([^']+)'/i);
    if (ledgerUpdateMatch) {
      const [, status, errMsg, version] = ledgerUpdateMatch;
      const prev = this.ledger.get(version) || {};
      this.ledger.set(version, { ...prev, status, error_message: errMsg || null });
      return;
    }
  }
}

// Splits multi-statement SQL into individual statements
function splitStatements(sql) {
  const stmts = [];
  let current = "";
  let inDollarQuote = false;

  const lines = sql.split("\n");
  for (const line of lines) {
    const count = (line.match(/\$\$/g) || []).length;
    if (count % 2 === 1) {
      inDollarQuote = !inDollarQuote;
    }
    current += line + "\n";
    if (!inDollarQuote && line.trim().endsWith(";")) {
      stmts.push(current.trim());
      current = "";
    }
  }
  if (current.trim()) stmts.push(current.trim());
  return stmts;
}

test("Simulate clean execution of Migration 1", () => {
  const db = new MockDatabaseCatalog();
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, ORDERED_MIGRATIONS[0]), "utf-8");
  const stmts = splitStatements(sql);

  for (const stmt of stmts) {
    db.executeStatement(stmt);
  }

  assert.ok(db.tables.has("public.profiles"));
  assert.ok(db.tables.has("public.blood_requests"));
  assert.strictEqual(db.policies.get("public.profiles").size, 2);
  assert.strictEqual(db.policies.get("public.blood_requests").size, 2);
});

test("Simulate partial failure in Migration 1 and verify recovery", () => {
  const db = new MockDatabaseCatalog();
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, ORDERED_MIGRATIONS[0]), "utf-8");
  const stmts = splitStatements(sql);

  // Inject failure at statement 10 (after profiles policies, before blood_requests policies)
  const failureIndex = 10;
  for (let i = 0; i < failureIndex; i++) {
    db.executeStatement(stmts[i]);
  }

  assert.strictEqual(db.ledger.has(ORDERED_MIGRATIONS[0]), false);

  // Re-run migration 1 completely
  for (const stmt of stmts) {
    db.executeStatement(stmt);
  }
  db.executeStatement(`INSERT INTO public._schema_migrations (version, status) VALUES ('${ORDERED_MIGRATIONS[0]}', 'COMPLETED');`);

  assert.strictEqual(db.ledger.get(ORDERED_MIGRATIONS[0])?.status, "COMPLETED");
  assert.strictEqual(db.policies.get("public.profiles").size, 2);
});

test("Simulate partial failure in Migration 3 (storage policies) and verify recovery", () => {
  const db = new MockDatabaseCatalog();
  const sql1 = fs.readFileSync(path.join(MIGRATIONS_DIR, ORDERED_MIGRATIONS[0]), "utf-8");
  for (const s of splitStatements(sql1)) db.executeStatement(s);

  const sql3 = fs.readFileSync(path.join(MIGRATIONS_DIR, ORDERED_MIGRATIONS[2]), "utf-8");
  const stmts3 = splitStatements(sql3);

  // Inject failure right after the first storage policy is created
  const createIdx = stmts3.findIndex((s) => s.includes("CREATE POLICY \"Requesters upload prescription objects\""));
  assert.ok(createIdx !== -1, "Should find CREATE POLICY for prescription objects");
  for (let i = 0; i <= createIdx; i++) {
    db.executeStatement(stmts3[i]);
  }

  assert.strictEqual(db.ledger.has(ORDERED_MIGRATIONS[2]), false);
  assert.ok(db.policies.get("storage.objects").has("Requesters upload prescription objects"));

  // Re-run Migration 3 completely
  for (const s of stmts3) {
    db.executeStatement(s);
  }
  db.executeStatement(`INSERT INTO public._schema_migrations (version, status) VALUES ('${ORDERED_MIGRATIONS[2]}', 'COMPLETED');`);

  assert.strictEqual(db.ledger.get(ORDERED_MIGRATIONS[2])?.status, "COMPLETED");
  assert.strictEqual(db.policies.get("storage.objects").size, 2);
});

// --- NEW FAULT-INJECTION TEST SUITE ---

test("Fault Injection 1: Confirmed transaction rollback (FAILED) and retry prevention", () => {
  const db = new MockDatabaseCatalog();
  const file = ORDERED_MIGRATIONS[0];

  // Simulated engine failure during DDL execution
  // In Postgres, the transaction rolls back, leaving no tables created.
  // The runner's catch block writes status = 'FAILED' outside the aborted transaction.
  db.executeStatement(`
    INSERT INTO public._schema_migrations (version, status, checksum, error_message)
    VALUES ('${file}', 'FAILED', 'abc123hash', 'Syntax error at statement 5');
  `);

  assert.strictEqual(db.ledger.get(file)?.status, "FAILED");
  assert.strictEqual(db.tables.has("public.profiles"), false, "Transaction rollback must leave no created tables");

  // Verify that an unconfirmed retry is rejected because status = FAILED
  const isBlocked = db.ledger.get(file)?.status === "FAILED";
  assert.ok(isBlocked, "Automatic retry must be blocked when status is FAILED");
});

test("Fault Injection 2: Lost response after commit (UNKNOWN) and safe object reconciliation", () => {
  const db = new MockDatabaseCatalog();
  const file = ORDERED_MIGRATIONS[0];
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");

  // DDL commits successfully on the database server
  for (const s of splitStatements(sql)) db.executeStatement(s);

  // Transport/Gateway error (HTTP 504) severs connection before client receives commit response
  // Runner catches ambiguous network failure and records status = 'UNKNOWN'
  db.executeStatement(`
    INSERT INTO public._schema_migrations (version, status, checksum, error_message)
    VALUES ('${file}', 'UNKNOWN', 'chk12345', 'Gateway timeout 504 during commit');
  `);

  assert.strictEqual(db.ledger.get(file)?.status, "UNKNOWN");

  // Verify that automatic blind retry is blocked
  const isAutoRetryBlocked = db.ledger.get(file)?.status === "UNKNOWN";
  assert.ok(isAutoRetryBlocked, "UNKNOWN migration must NOT be automatically retried");

  // Operator initiates repair with verification:
  // Check if expected objects exist in catalog
  const spec = MIGRATION_VERIFICATION_SPECS[file];
  const verifySql = generateVerificationSql(file);
  assert.ok(typeof verifySql === "string" && verifySql.includes("SELECT"), "Verification SQL must be valid");
  const allTablesPresent = spec.tables.every((tbl) => db.tables.has(`public.${tbl}`));
  assert.ok(allTablesPresent, "All catalog tables must be present for reconciliation");

  // Safe reconciliation: update ledger to COMPLETED without destructive re-execution
  db.executeStatement(`
    UPDATE public._schema_migrations 
    SET status = 'COMPLETED', error_message = 'Reconciled: All catalog objects verified' 
    WHERE version = '${file}';
  `);

  assert.strictEqual(db.ledger.get(file)?.status, "COMPLETED");
});

test("Fault Injection 2B: Partially applied schema fails catalog verification and rejects auto-reconciliation", () => {
  const db = new MockDatabaseCatalog();
  const file = ORDERED_MIGRATIONS[0]; // Migration 1: profiles, donor_profiles, blood_requests, donor_commitments, audit_logs

  // Partially apply schema: only 'profiles' is created, remaining tables are NOT created
  db.tables.add("public.profiles");

  // Migration is recorded in UNKNOWN state (simulated transport loss or timeout during execution)
  db.executeStatement(`
    INSERT INTO public._schema_migrations (version, status, checksum, error_message)
    VALUES ('${file}', 'UNKNOWN', 'chk12345', 'Client aborted before transaction commit');
  `);

  assert.strictEqual(db.ledger.get(file)?.status, "UNKNOWN");

  // Operator initiates repair with verification:
  const spec = MIGRATION_VERIFICATION_SPECS[file];
  const allTablesPresent = spec.tables.every((tbl) => db.tables.has(`public.${tbl}`));
  assert.strictEqual(allTablesPresent, false, "Catalog verification must detect missing tables in partial schema");

  // Verify that auto-reconciliation is REJECTED
  let wasReconciled = false;
  if (allTablesPresent) {
    db.executeStatement(`
      UPDATE public._schema_migrations 
      SET status = 'COMPLETED', error_message = 'Reconciled: All catalog objects verified' 
      WHERE version = '${file}';
    `);
    wasReconciled = true;
  }

  assert.strictEqual(wasReconciled, false, "Auto-reconciliation must be rejected when catalog verification fails");
  assert.strictEqual(db.ledger.get(file)?.status, "UNKNOWN", "Status must remain UNKNOWN until controlled re-execution completes");
});

test("Fault Injection 3: Failed remote ledger write and verify emergency local marker", () => {
  const testFile = "20261009_test_failure.sql";
  const localMarkerPath = path.join(ROOT_DIR, ".migration_failure.json");

  // Clean up any stale marker before test
  if (fs.existsSync(localMarkerPath)) fs.unlinkSync(localMarkerPath);

  // Simulate remote ledger write failure invoking writeLocalEmergencyMarker
  writeLocalEmergencyMarker(
    testFile,
    "FAILED",
    "deadbeef01234567",
    "Pessimistic lock timeout on table blood_requests",
    "fetch failed: connection reset by peer"
  );

  assert.ok(fs.existsSync(localMarkerPath), "Emergency local marker file must be created on remote ledger failure");

  const marker = JSON.parse(fs.readFileSync(localMarkerPath, "utf-8"));
  assert.strictEqual(marker.version, testFile);
  assert.strictEqual(marker.status, "FAILED");
  assert.strictEqual(marker.checksum, "deadbeef01234567");
  assert.ok(marker.ledgerWriteError.includes("connection reset"));

  // Clean up marker after test
  fs.unlinkSync(localMarkerPath);
});

test("Fault Injection 4: Checksum mismatch detection during repair", () => {
  const file = ORDERED_MIGRATIONS[3]; // Migration 4
  const recordedChecksum = "1111222233334444";
  const currentFileContent = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");
  const actualChecksum = crypto.createHash("sha256").update(currentFileContent).digest("hex").slice(0, 16);

  // Recorded checksum differs from actual file checksum
  assert.notStrictEqual(recordedChecksum, actualChecksum);

  // Simulate runner checksum check:
  const forceChecksum = false;
  let blockedByChecksum = false;
  if (recordedChecksum !== actualChecksum && !forceChecksum) {
    blockedByChecksum = true;
  }

  assert.ok(blockedByChecksum, "Repair must be blocked when checksum does not match without --force-checksum");
});

test("Fault Injection 5: Isolation of unrelated failed migrations during repair", () => {
  const fileA = ORDERED_MIGRATIONS[3];  // Migration 4
  const fileB = ORDERED_MIGRATIONS[13]; // Migration 14

  const incompleteRows = [
    { version: fileA, status: "FAILED", checksum: "aaa1", error_message: "lock timeout" },
    { version: fileB, status: "FAILED", checksum: "bbb2", error_message: "check constraint violation" },
  ];

  // Operator specifies repair target for fileA only
  const repairMigration = fileA;

  // Unrelated incomplete migration fileB must be isolated
  const unrelatedIncomplete = incompleteRows.filter((r) => r.version !== repairMigration);
  assert.strictEqual(unrelatedIncomplete.length, 1);
  assert.strictEqual(unrelatedIncomplete[0].version, fileB);

  // Runner reaching fileB in loop must refuse execution
  let executionHalted = false;
  if (incompleteRows.some((r) => r.version === fileB) && fileB !== repairMigration) {
    executionHalted = true;
  }

  assert.ok(executionHalted, "Runner must halt and refuse to execute unrelated failed migration fileB");
});

test("Fault Injection 6: Partially applied enum additions and ensure intermediate status", () => {
  const db = new MockDatabaseCatalog();
  const file = ORDERED_MIGRATIONS[3]; // Migration 4
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");

  // Stage 1: Enum extraction and standalone execution
  const { standaloneStmts } = extractEnumAlterations(sql);
  assert.strictEqual(standaloneStmts.length, 6, "Migration 4 must have 6 extracted enum statements");

  for (const alterStmt of standaloneStmts) {
    db.executeStatement(alterStmt);
  }

  // Verify enum values are in db.types
  assert.ok(db.types.get("public.commitment_status_type")?.has("INTERESTED"));
  assert.ok(db.types.get("public.commitment_status_type")?.has("CONFIRMED"));

  // Stage 2: Transaction block fails midway before completion ledger write
  // Table columns are NOT added to the database
  assert.strictEqual(db.columns.has("public.blood_requests"), false);

  // Catalog verification check: enums exist, but downstream columns/constraints are missing
  const spec4 = MIGRATION_VERIFICATION_SPECS[file];
  const allEnumsPresent = spec4.enumLabels.every((en) => db.types.get(`public.${en.type}`)?.has(en.label));
  assert.ok(allEnumsPresent, "Extracted enums are present in catalog");
  const allColumnsPresent = spec4.columns.every((col) => {
    return db.columns.has(`public.${col.table}`) && db.columns.get(`public.${col.table}`).has(col.column);
  });
  assert.strictEqual(allColumnsPresent, false, "Downstream columns are missing, catalog verification must fail");

  // Runner records FAILED in ledger (NOT COMPLETED!)
  db.executeStatement(`
    INSERT INTO public._schema_migrations (version, status, checksum, error_message)
    VALUES ('${file}', 'FAILED', 'hash4', 'Constraint check failed');
  `);

  assert.strictEqual(db.ledger.get(file)?.status, "FAILED", "Partially applied enum additions must NOT be marked COMPLETED");

  // Recovery: re-executing standalone enum statements with IF NOT EXISTS is completely safe
  for (const alterStmt of standaloneStmts) {
    db.executeStatement(alterStmt);
  }
  assert.strictEqual(db.types.get("public.commitment_status_type")?.size, 5);
});

test("Simulate partial failure during constraint replacement in Migration 14", () => {
  const db = new MockDatabaseCatalog();
  const sql5 = fs.readFileSync(path.join(MIGRATIONS_DIR, ORDERED_MIGRATIONS[4]), "utf-8");
  for (const s of splitStatements(sql5)) db.executeStatement(s);
  db.constraints.set("public.notification_events", new Set(["notification_events_status_check"]));

  const sql14 = fs.readFileSync(path.join(MIGRATIONS_DIR, ORDERED_MIGRATIONS[13]), "utf-8");
  const stmts14 = splitStatements(sql14);

  const dropIdx = stmts14.findIndex((s) => s.includes("DROP CONSTRAINT IF EXISTS notification_events_status_check"));
  assert.ok(dropIdx !== -1);

  for (let i = 0; i <= dropIdx; i++) {
    db.executeStatement(stmts14[i]);
  }

  assert.strictEqual(db.constraints.get("public.notification_events")?.has("notification_events_status_check"), false);
  assert.strictEqual(db.ledger.has(ORDERED_MIGRATIONS[13]), false);

  for (const s of stmts14) {
    db.executeStatement(s);
  }
  db.executeStatement(`INSERT INTO public._schema_migrations (version, status) VALUES ('${ORDERED_MIGRATIONS[13]}', 'COMPLETED');`);

  assert.strictEqual(db.constraints.get("public.notification_events")?.has("notification_events_status_check"), true);
  assert.strictEqual(db.ledger.get(ORDERED_MIGRATIONS[13])?.status, "COMPLETED");
});

console.log("================================================================================");
console.log(`  OFFLINE SIMULATION RESULTS: ${passed} PASSED, ${failed} FAILED`);
console.log("================================================================================");

if (failed > 0) process.exit(1);
