#!/usr/bin/env node

/**
 * LIFE DROP: PRE-DEPLOYMENT SAFETY & CONFIGURATION TEST SUITE
 *
 * Verifies:
 * 1. Supabase public-key selection & fallback (ANON_KEY vs PUBLISHABLE_KEY)
 * 2. Missing configuration reporting without secret leakage
 * 3. Server-only admin credentials strictly guarded from client browser
 * 4. Migration runner isolation guards, confirmation barriers, and non-mutating dry run
 */

import assert from "node:assert";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ORDERED_MIGRATIONS,
  extractEnumAlterations,
  generateVerificationSql,
  MIGRATION_VERIFICATION_SPECS,
} from "./deploy-migrations.mjs";
import {
  performSurgicalTeardown,
  auditDatabaseDisposability,
  LIFEDROP_FUNCTIONS,
  normalizeSignature,
  validateTestDatabaseUrl,
} from "./test-integration-postgres.mjs";

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
  console.log("  LIFE DROP: PRE-DEPLOYMENT CONFIGURATION & SAFETY TEST SUITE");
  console.log("================================================================================");

  // Preserve initial environment
  const originalEnv = { ...process.env };

  try {
    // --------------------------------------------------------------------------
    // SUITE 1: Supabase Public-Key Selection & Fallback
    // --------------------------------------------------------------------------
    console.log("\n[Suite 1] Supabase Public-Key Selection & Fallback...");

    const { getSupabasePublicKey, validateSupabasePublicConfig, env } = await import("../lib/env.js");

    test("Resolves NEXT_PUBLIC_SUPABASE_ANON_KEY when only anon key is set", () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://yvddbpugkfpoeleuyzci.supabase.co";
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test_anon_key";
      delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

      const key = getSupabasePublicKey();
      assert.strictEqual(key, "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test_anon_key");

      const status = validateSupabasePublicConfig();
      assert.strictEqual(status.isConfigured, true);
      assert.strictEqual(status.keySource, "ANON_KEY");
      assert.strictEqual(status.hasUrl, true);
      assert.strictEqual(status.hasKey, true);
    });

    test("Resolves NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY when only publishable key is set", () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://yvddbpugkfpoeleuyzci.supabase.co";
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_prod_token_test_12345";

      const key = getSupabasePublicKey();
      assert.strictEqual(key, "sb_publishable_prod_token_test_12345");

      const status = validateSupabasePublicConfig();
      assert.strictEqual(status.isConfigured, true);
      assert.strictEqual(status.keySource, "PUBLISHABLE_KEY");
      assert.strictEqual(status.hasUrl, true);
      assert.strictEqual(status.hasKey, true);
    });

    test("Prioritizes ANON_KEY when both anon and publishable keys are present", () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://yvddbpugkfpoeleuyzci.supabase.co";
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "real_anon_key_priority";
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_secondary";

      const key = getSupabasePublicKey();
      assert.strictEqual(key, "real_anon_key_priority");

      const status = validateSupabasePublicConfig();
      assert.strictEqual(status.keySource, "ANON_KEY");
    });

    test("Rejects placeholder token values and returns undefined", () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://yvddbpugkfpoeleuyzci.supabase.co";
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "your_production_anon_key";
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "your-publishable-key";

      const key = getSupabasePublicKey();
      assert.strictEqual(key, undefined);

      const status = validateSupabasePublicConfig();
      assert.strictEqual(status.isConfigured, false);
      assert.strictEqual(status.hasKey, false);
      assert.strictEqual(status.keySource, "NONE");
      assert.ok(status.error.includes("Neither NEXT_PUBLIC_SUPABASE_ANON_KEY nor"));
    });

    test("Handles both keys completely missing", () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://yvddbpugkfpoeleuyzci.supabase.co";
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

      const key = getSupabasePublicKey();
      assert.strictEqual(key, undefined);

      const status = validateSupabasePublicConfig();
      assert.strictEqual(status.isConfigured, false);
      assert.strictEqual(status.hasKey, false);
      assert.strictEqual(status.keySource, "NONE");
    });

    test("Reports missing URL without throwing or leaking secret values", () => {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "real_anon_key_secret_12345";
      delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

      const status = validateSupabasePublicConfig();
      assert.strictEqual(status.isConfigured, false);
      assert.strictEqual(status.hasUrl, false);
      assert.strictEqual(status.hasKey, true);
      assert.ok(status.error.includes("NEXT_PUBLIC_SUPABASE_URL is missing"));
      assert.ok(!status.error.includes("real_anon_key_secret_12345"), "Must not leak secret in error");
    });

    test("Reports invalid or malformed URL safely", () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = "not-a-valid-url";
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "real_anon_key_12345";
      delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

      const status = validateSupabasePublicConfig();
      assert.strictEqual(status.isConfigured, false);
      assert.strictEqual(status.hasUrl, false);
      assert.strictEqual(status.hasKey, true);
      assert.ok(status.error.includes("NEXT_PUBLIC_SUPABASE_URL is missing, invalid, or placeholder"));

      assert.strictEqual(env.isSupabaseConfigured(), false);
    });

    // --------------------------------------------------------------------------
    // SUITE 2: Server-Only Admin Credentials Protection
    // --------------------------------------------------------------------------
    console.log("\n[Suite 2] Server-Only Admin Credentials Protection...");

    const { createSupabaseAdminClient } = await import("../lib/supabase/admin.js");

    test("Client public env strictly excludes SUPABASE_SERVICE_ROLE_KEY", () => {
      const publicKeys = Object.keys(env.public);
      assert.strictEqual(publicKeys.includes("SUPABASE_SERVICE_ROLE_KEY"), false);
      assert.strictEqual(publicKeys.includes("CLERK_SECRET_KEY"), false);
      assert.strictEqual(publicKeys.includes("CRON_SECRET"), false);
      assert.strictEqual(publicKeys.includes("WORKER_SECRET"), false);
    });

    test("createSupabaseAdminClient throws security error when window is defined", () => {
      const originalWindow = globalThis.window;
      try {
        globalThis.window = {};
        assert.throws(
          () => createSupabaseAdminClient(),
          /SECURITY CRITICAL: Attempted to instantiate Supabase Admin Client in client browser!/
        );
      } finally {
        globalThis.window = originalWindow;
      }
    });

    test("env.server throws security error when window is defined", () => {
      const originalWindow = globalThis.window;
      try {
        globalThis.window = {};
        assert.throws(
          () => env.server,
          /SECURITY CRITICAL: Attempted to access server-only environment variables in client browser!/
        );
      } finally {
        globalThis.window = originalWindow;
      }
    });

    // --------------------------------------------------------------------------
    // SUITE 3: Migration Runner Safety & Isolation
    // --------------------------------------------------------------------------
    console.log("\n[Suite 3] Migration Runner Safety & Isolation Guards...");

    // Clean mutated public env vars so deploy-migrations.mjs loads .env.production cleanly
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    test("Production migration without --confirm or --dry-run exits with code 1", () => {
      try {
        execSync("node scripts/deploy-migrations.mjs --target=production", {
          cwd: ROOT_DIR,
          stdio: "pipe",
        });
        assert.fail("Should have exited with code 1");
      } catch (err) {
        assert.strictEqual(err.status, 1);
        const stderr = err.stderr.toString();
        assert.ok(stderr.includes("SAFETY ERROR: Production deployment requires explicit confirmation flag"));
      }
    });

    test("Production migration runner dry-run outputs audit report with zero mutations", () => {
      const output = execSync("node scripts/deploy-migrations.mjs --target=production --dry-run", {
        cwd: ROOT_DIR,
        stdio: "pipe",
      }).toString();

      assert.ok(output.includes("DRY RUN AUDIT REPORT (NO DATABASE MUTATIONS)"));
      assert.ok(output.includes("Differs from Staging (vblfkcyeefiwhhpbwxhr): YES (Strictly Isolated)"));
      assert.ok(output.includes(`Local Migrations Verified: ${ORDERED_MIGRATIONS.length} ordered files`));
      assert.ok(output.includes("Remote Mutations Applied: NONE"));
    });

    test("Production migration runner aborts with code 1 when credentials are placeholders", () => {
      try {
        execSync("node scripts/deploy-migrations.mjs --target=production --confirm", {
          cwd: ROOT_DIR,
          stdio: "pipe",
        });
        assert.fail("Should have exited with code 1");
      } catch (err) {
        assert.strictEqual(err.status, 1);
        const output = (err.stdout?.toString() || "") + (err.stderr?.toString() || "");
        assert.ok(output.includes("STATUS: BLOCKED — REAL PRODUCTION CREDENTIALS REQUIRED"));
        assert.ok(output.includes("SUPABASE_ACCESS_TOKEN"));
      }
    });

    test(`All ${ORDERED_MIGRATIONS.length} ordered migration files exist and compute valid SHA-256 checksums`, () => {
      const output = execSync("node scripts/deploy-migrations.mjs --target=production --dry-run", {
        cwd: ROOT_DIR,
        stdio: "pipe",
      }).toString();

      const checksumMatches = output.match(/sha256:[a-f0-9]{16}\.\.\./g);
      assert.ok(checksumMatches, "Should find checksum matches");
      assert.strictEqual(checksumMatches.length, ORDERED_MIGRATIONS.length, "Should compute checksums for all ordered migrations");
    });

    test("Migration runner in --dry-run mode makes zero network requests and terminates before I/O", () => {
      const startTime = Date.now();
      const output = execSync("node scripts/deploy-migrations.mjs --target=production --dry-run", {
        cwd: ROOT_DIR,
        env: {
          ...process.env,
          // Point to a non-routable test domain; any network fetch would fail/hang
          NEXT_PUBLIC_SUPABASE_URL: "https://nonexistent-dryrun-trap-test.supabase.co",
          SUPABASE_ACCESS_TOKEN: "sbp_mock_token_for_dryrun_verification",
        },
        stdio: "pipe",
      }).toString();
      const durationMs = Date.now() - startTime;

      assert.ok(output.includes("DRY RUN AUDIT REPORT (NO DATABASE MUTATIONS)"));
      assert.ok(output.includes("Remote Mutations Applied: NONE (code path terminated before any network I/O)"));
      assert.ok(durationMs < 2000, `Dry run took ${durationMs}ms, indicating possible network attempt`);
    });

    test("Static AST/Code analysis verifies --dry-run returns before any executeSql definition or invocation", () => {
      const runnerSrc = fs.readFileSync(path.join(ROOT_DIR, "scripts", "deploy-migrations.mjs"), "utf-8");
      const dryRunReturnIdx = runnerSrc.indexOf("if (isDryRun) {");
      assert.ok(dryRunReturnIdx !== -1, "Should locate isDryRun block");
      const executeSqlDefIdx = runnerSrc.indexOf("async function executeSql(");
      assert.ok(executeSqlDefIdx !== -1, "Should locate executeSql definition");

      assert.ok(
        dryRunReturnIdx < executeSqlDefIdx,
        "isDryRun check and early return MUST precede executeSql definition and invocation"
      );
    });

    test("Integration runner strictly validates TEST_DATABASE_URL isolation and allowlist", () => {
      // 1. Mandatory check
      assert.throws(() => validateTestDatabaseUrl(""), /TEST_DATABASE_URL is mandatory/);

      // 2. Production/Staging Supabase references blocked
      assert.throws(
        () => validateTestDatabaseUrl("postgres://user:pass@yvddbpugkfpoeleuyzci.supabase.co:5432/postgres"),
        /SECURITY VIOLATION.*forbidden pattern/
      );
      assert.throws(
        () => validateTestDatabaseUrl("postgres://user:pass@vblfkcyeefiwhhpbwxhr.supabase.co:5432/postgres"),
        /SECURITY VIOLATION.*forbidden pattern/
      );
      assert.throws(
        () => validateTestDatabaseUrl("postgres://user:pass@ep-random.supabase.co:6543/postgres"),
        /SECURITY VIOLATION.*forbidden pattern/
      );

      // 3. Non-permitted remote host blocked
      assert.throws(
        () => validateTestDatabaseUrl("postgres://user:pass@external-database.rds.amazonaws.com:5432/testdb"),
        /HOST NOT PERMITTED/
      );

      // 4. Dangerous database name blocked
      assert.throws(
        () => validateTestDatabaseUrl("postgres://user:pass@localhost:5432/production"),
        /DANGEROUS DATABASE NAME/
      );

      // 5. Valid disposable host permitted
      const localResult = validateTestDatabaseUrl("postgres://postgres:postgres@localhost:5432/postgres");
      assert.strictEqual(localResult.isValid, true);
      assert.strictEqual(localResult.hostname, "localhost");

      const dockerResult = validateTestDatabaseUrl("postgres://postgres:postgres@host.docker.internal:5432/lifedrop_test");
      assert.strictEqual(dockerResult.isValid, true);
      assert.strictEqual(dockerResult.hostname, "host.docker.internal");

      const pgServiceResult = validateTestDatabaseUrl("postgres://postgres:postgres@postgres:5432/postgres");
      assert.strictEqual(pgServiceResult.isValid, true);
      assert.strictEqual(pgServiceResult.hostname, "postgres");
    });

    test("Integration runner rejects skipped execution in CI environment (exits with code 1)", () => {
      try {
        execSync("node scripts/test-integration-postgres.mjs", {
          cwd: ROOT_DIR,
          env: {
            ...process.env,
            CI: "true",
            TEST_DATABASE_URL: "",
          },
          stdio: "pipe",
        });
        assert.fail("Should have exited with code 1 in CI when TEST_DATABASE_URL is missing");
      } catch (err) {
        assert.strictEqual(err.status, 1);
        const output = (err.stdout?.toString() || "") + (err.stderr?.toString() || "");
        assert.ok(output.includes("CI ERROR: TEST_DATABASE_URL is required in CI environments"));
      }
    });

    test("Integration runner statically eliminates DROP SCHEMA public CASCADE and enforces comprehensive pre-flight", () => {
      const runnerSrc = fs.readFileSync(path.join(ROOT_DIR, "scripts", "test-integration-postgres.mjs"), "utf-8");

      // Must NOT execute blanket DROP SCHEMA public
      assert.strictEqual(
        /executePsql\([^)]*DROP\s+SCHEMA\s+(?:IF\s+EXISTS\s+)?public/i.test(runnerSrc),
        false,
        "Runner must NEVER execute DROP SCHEMA public"
      );

      // Must contain anti-hang timeouts
      assert.ok(runnerSrc.includes("statement_timeout=30000"), "Must enforce statement_timeout");
      assert.ok(runnerSrc.includes("connect-timeout=10"), "Must enforce connect-timeout");

      // Must inspect views, sequences, routines, and custom types in pre-flight using pg_class and catalogs
      assert.ok(runnerSrc.includes("relkind IN ('v', 'm')"), "Must inspect standard and materialized views");
      assert.ok(runnerSrc.includes("relkind = 'S'"), "Must inspect sequences");
      assert.ok(runnerSrc.includes("pg_proc"), "Must inspect routines");
      assert.ok(runnerSrc.includes("pg_type"), "Must inspect custom types");
      assert.ok(runnerSrc.includes("auth"), "Must inspect auth schema");
      assert.ok(runnerSrc.includes("storage"), "Must inspect storage schema");
      assert.ok(runnerSrc.includes("_lifedrop_disposable_canary"), "Must enforce canary validation");
    });

    test("Integration runner statically eliminates all CASCADE teardowns and enforces RESTRICT on all object drops", () => {
      const runnerSrc = fs.readFileSync(path.join(ROOT_DIR, "scripts", "test-integration-postgres.mjs"), "utf-8");

      // Must NOT execute any DROP ... CASCADE
      assert.strictEqual(
        /executePsql\([^)]*DROP\s+(?:SCHEMA|TABLE|FUNCTION|TYPE)\s+[^)]*CASCADE/i.test(runnerSrc),
        false,
        "Runner must NEVER execute any DROP statement with CASCADE"
      );

      // Must enforce RESTRICT on table, type, and function drops
      assert.ok(runnerSrc.includes("DROP TABLE IF EXISTS public.${tbl} RESTRICT;"), "Must drop tables with RESTRICT");
      assert.ok(runnerSrc.includes("DROP FUNCTION IF EXISTS public.${fn} RESTRICT;"), "Must drop functions with RESTRICT");
      assert.ok(runnerSrc.includes("DROP TYPE IF EXISTS public.${typ} RESTRICT;"), "Must drop types with RESTRICT");
    });

    test("LIFEDROP_FUNCTIONS exact signatures match all functions defined across migrations", () => {
      const MIGRATIONS_DIR = path.join(ROOT_DIR, "supabase", "migrations");

      // Extract all function definitions from migration files
      const migrationFunctions = new Map();
      const fnRegex = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.([a-zA-Z0-9_]+)\s*\(([\s\S]*?)\)\s*RETURNS/gi;

      for (const file of ORDERED_MIGRATIONS) {
        const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");
        let match;
        while ((match = fnRegex.exec(sql)) !== null) {
          const fnName = match[1];
          const rawArgs = match[2].trim();
          const argTypes = rawArgs
            ? rawArgs.split(",").map((arg) => {
                const parts = arg.trim().split(/\s+/);
                let typeCandidate = parts[1] || parts[0];
                if (parts[0].toLowerCase().startsWith("p_") && parts[1]) {
                  typeCandidate = parts[1];
                }
                return typeCandidate.toLowerCase();
              }).join(", ")
            : "";
          const sig = normalizeSignature(`${fnName}(${argTypes})`);
          migrationFunctions.set(fnName, sig);
        }
      }

      assert.strictEqual(LIFEDROP_FUNCTIONS.length, 13, "Expected exactly 13 unique functions in LIFEDROP_FUNCTIONS");
      for (const fnSig of LIFEDROP_FUNCTIONS) {
        const normalized = normalizeSignature(fnSig);
        const fnName = normalized.split("(")[0];
        assert.ok(migrationFunctions.has(fnName), `Function ${fnName} must exist in migration files`);
        assert.strictEqual(
          normalized,
          migrationFunctions.get(fnName),
          `Signature mismatch for ${fnName}: expected ${migrationFunctions.get(fnName)}, got ${normalized}`
        );
      }
    });

    test("performSurgicalTeardown strictly enforces session canary token and runner PID validation", () => {
      // 1. Missing canary token
      assert.throws(
        () => performSurgicalTeardown(() => "", ""),
        /SECURITY VIOLATION: Missing session canary token/
      );

      // 2. Mismatched canary token in database
      const mockPsqlInvalid = (sql) => {
        if (sql.includes("_lifedrop_disposable_canary")) {
          return "canary_token|runner_pid|is_disposable\n---|---|---\ndifferent_token|99999|t\n";
        }
        return "";
      };

      assert.throws(
        () => performSurgicalTeardown(mockPsqlInvalid, "my_session_token_12345", 1234),
        /CRITICAL SECURITY ERROR: Session canary token verification failed/
      );
    });

    test("performSurgicalTeardown drops public objects BEFORE auth/storage shim objects in reverse dependency order", () => {
      const executedSqls = [];
      const mockPsqlValid = (sql) => {
        executedSqls.push(sql.trim());
        if (sql.includes("_lifedrop_disposable_canary") && sql.includes("SELECT")) {
          return "canary_token|runner_pid|is_disposable\n---|---|---\nvalid_canary_abc|12345|t\n";
        }
        if (sql.includes("nspname = 'storage'") && sql.includes("pg_class")) {
          return "relname|comment\n---|---\nobjects|Life Drop test compatibility mock for storage.objects\nbuckets|Life Drop test compatibility mock for storage.buckets\n";
        }
        if (sql.includes("nspname = 'storage'") && sql.includes("pg_proc")) {
          return "proname|comment\n---|---\nfoldername|Life Drop test compatibility mock for storage.foldername\n";
        }
        if (sql.includes("nspname = 'auth'") && sql.includes("pg_class")) {
          return "relname|comment\n---|---\n";
        }
        if (sql.includes("nspname = 'auth'") && sql.includes("pg_proc")) {
          return "proname|comment\n---|---\nuid|Life Drop test compatibility mock for auth.uid\njwt|Life Drop test compatibility mock for auth.jwt\nrole|Life Drop test compatibility mock for auth.role\n";
        }
        if (sql.includes("obj_description(oid, 'pg_namespace')") && sql.includes("storage")) {
          return "Life Drop test compatibility mock";
        }
        if (sql.includes("obj_description(oid, 'pg_namespace')") && sql.includes("auth")) {
          return "Life Drop test compatibility mock";
        }
        if (sql.includes("count(*)")) {
          return "count\n-----\n0\n";
        }
        if (sql.includes("pg_proc p JOIN pg_namespace") || sql.includes("residualAuditSql")) {
          return "tables|views|foreign_tables|sequences|routines|custom_types\n---|---|---|---|---|---\n0|0|0|0|0|0\n";
        }
        return "";
      };

      performSurgicalTeardown(mockPsqlValid, "valid_canary_abc", 12345);

      // Verify zero CASCADE keywords in any executed statement
      for (const stmt of executedSqls) {
        assert.strictEqual(
          /CASCADE/i.test(stmt),
          false,
          `Statement must not contain CASCADE: ${stmt}`
        );
      }

      // Verify dependency phases:
      // Tables dropped before Functions, Functions before Types, Types before Storage/Auth
      const firstTableDrop = executedSqls.findIndex((s) => s.includes("DROP TABLE IF EXISTS public.donations"));
      const firstFunctionDrop = executedSqls.findIndex((s) => s.includes("DROP FUNCTION IF EXISTS public."));
      const firstTypeDrop = executedSqls.findIndex((s) => s.includes("DROP TYPE IF EXISTS public."));
      const firstStorageDrop = executedSqls.findIndex((s) => s.includes("storage.objects"));
      const firstAuthDrop = executedSqls.findIndex((s) => s.includes("auth.uid"));
      const canaryDrop = executedSqls.findIndex((s) => s.includes("DROP TABLE IF EXISTS public._lifedrop_disposable_canary"));

      assert.ok(firstTableDrop !== -1, "Tables must be dropped");
      assert.ok(firstFunctionDrop !== -1, "Functions must be dropped");
      assert.ok(firstTypeDrop !== -1, "Types must be dropped");
      assert.ok(firstStorageDrop !== -1, "Storage objects must be dropped");
      assert.ok(firstAuthDrop !== -1, "Auth objects must be dropped");
      assert.ok(canaryDrop !== -1, "Canary must be dropped");

      assert.ok(firstTableDrop < firstFunctionDrop, "Public tables must drop BEFORE public functions");
      assert.ok(firstFunctionDrop < firstTypeDrop, "Public functions must drop BEFORE public types");
      assert.ok(firstTypeDrop < firstStorageDrop, "Public types must drop BEFORE storage shim objects");
      assert.ok(firstTypeDrop < firstAuthDrop, "Public types must drop BEFORE auth shim objects");
      assert.ok(firstAuthDrop < canaryDrop, "Auth shim objects must drop BEFORE canary table");

      // Verify reverse dependency order of drops among tables
      const tableDropIdx = (tbl) => executedSqls.findIndex((s) => s.includes(`DROP TABLE IF EXISTS public.${tbl} RESTRICT`));

      const idxDonations = tableDropIdx("donations");
      const idxCommitments = tableDropIdx("donor_commitments");
      const idxMatches = tableDropIdx("request_matches");
      const idxRequests = tableDropIdx("blood_requests");
      const idxDonorProfiles = tableDropIdx("donor_profiles");
      const idxProfiles = tableDropIdx("profiles");

      assert.ok(idxDonations < idxCommitments, "donations must drop before donor_commitments");
      assert.ok(idxCommitments < idxMatches, "donor_commitments must drop before request_matches");
      assert.ok(idxMatches < idxRequests, "request_matches must drop before blood_requests");
      assert.ok(idxRequests < idxProfiles, "blood_requests must drop before profiles");
      assert.ok(idxDonorProfiles < idxProfiles, "donor_profiles must drop before profiles");
    });

    test("performSurgicalTeardown aborts with safety violation when PostgreSQL RESTRICT blocks on unexpected dependency", () => {
      const mockPsqlWithDependency = (sql) => {
        if (sql.includes("_lifedrop_disposable_canary")) {
          return "canary_token|runner_pid|is_disposable\n---|---|---\nvalid_canary_abc|12345|t\n";
        }
        if (sql.includes("count(*)")) {
          return "count\n-----\n0\n";
        }
        if (sql.includes("DROP TABLE IF EXISTS public.profiles RESTRICT")) {
          throw new Error("ERROR: 2BP01: cannot drop table public.profiles because other objects depend on it\nDETAIL: table foreign_tenant_orders depends on table public.profiles");
        }
        return "";
      };

      assert.throws(
        () => performSurgicalTeardown(mockPsqlWithDependency, "valid_canary_abc", 12345),
        /SAFETY VIOLATION: Unexpected dependency detected on public\.profiles!.*PostgreSQL RESTRICT blocked the drop/
      );
    });

    test("performSurgicalTeardown preserves auth and storage schemas when provenance comment is absent", () => {
      const executedSqls = [];
      const mockPsqlNoComment = (sql) => {
        executedSqls.push(sql.trim());
        if (sql.includes("_lifedrop_disposable_canary") && sql.includes("SELECT")) {
          return "canary_token|runner_pid|is_disposable\n---|---|---\nvalid_canary_abc|12345|t\n";
        }
        if (sql.includes("obj_description") || (sql.includes("pg_namespace") && (sql.includes("storage") || sql.includes("auth")))) {
          return "";
        }
        if (sql.includes("pg_proc p JOIN pg_namespace") || sql.includes("residualAuditSql")) {
          return "tables|views|foreign_tables|sequences|routines|custom_types\n---|---|---|---|---|---\n0|0|0|0|0|0\n";
        }
        return "";
      };

      performSurgicalTeardown(mockPsqlNoComment, "valid_canary_abc", 12345);

      // Must NOT drop storage.objects or auth.uid() or schemas
      assert.strictEqual(executedSqls.some((s) => s.includes("storage.objects")), false, "Must not drop storage.objects without provenance");
      assert.strictEqual(executedSqls.some((s) => s.includes("auth.uid")), false, "Must not drop auth.uid without provenance");
      assert.strictEqual(executedSqls.some((s) => s.includes("DROP SCHEMA IF EXISTS storage")), false, "Must not drop storage schema without provenance");
      assert.strictEqual(executedSqls.some((s) => s.includes("DROP SCHEMA IF EXISTS auth")), false, "Must not drop auth schema without provenance");
    });

    test("performSurgicalTeardown aborts with safety violation when marked storage schema contains an unmarked table", () => {
      const executedSqls = [];
      const mockPsqlUnmarkedStorageTable = (sql) => {
        executedSqls.push(sql.trim());
        if (sql.includes("_lifedrop_disposable_canary") && sql.includes("SELECT")) {
          return "canary_token|runner_pid|is_disposable\n---|---|---\nvalid_canary_abc|12345|t\n";
        }
        if (sql.includes("nspname = 'storage'") && sql.includes("pg_class")) {
          return "relname|comment\n---|---\nsecret_user_data|\n";
        }
        if (sql.includes("nspname = 'storage'") && sql.includes("pg_proc")) {
          return "proname|comment\n---|---\n";
        }
        if (sql.includes("obj_description(oid, 'pg_namespace')") && sql.includes("storage")) {
          return "Life Drop test compatibility mock";
        }
        return "";
      };

      assert.throws(
        () => performSurgicalTeardown(mockPsqlUnmarkedStorageTable, "valid_canary_abc", 12345),
        /SAFETY VIOLATION: storage schema contains unmarked table "secret_user_data" without runner provenance!/
      );

      assert.strictEqual(executedSqls.some((s) => s.includes("secret_user_data")), false, "Must NOT drop unmarked table");
      assert.strictEqual(executedSqls.some((s) => s.includes("DROP SCHEMA IF EXISTS storage")), false, "Must NOT drop storage schema");
    });

    test("performSurgicalTeardown aborts with safety violation when marked auth schema contains an unmarked routine", () => {
      const executedSqls = [];
      const mockPsqlUnmarkedAuthRoutine = (sql) => {
        executedSqls.push(sql.trim());
        if (sql.includes("_lifedrop_disposable_canary") && sql.includes("SELECT")) {
          return "canary_token|runner_pid|is_disposable\n---|---|---\nvalid_canary_abc|12345|t\n";
        }
        if (sql.includes("obj_description(oid, 'pg_namespace')") && sql.includes("storage")) {
          return "";
        }
        if (sql.includes("nspname = 'auth'") && sql.includes("pg_class")) {
          return "relname|comment\n---|---\n";
        }
        if (sql.includes("nspname = 'auth'") && sql.includes("pg_proc")) {
          return "proname|comment\n---|---\ncustom_auth_helper|\n";
        }
        if (sql.includes("obj_description(oid, 'pg_namespace')") && sql.includes("auth")) {
          return "Life Drop test compatibility mock";
        }
        return "";
      };

      assert.throws(
        () => performSurgicalTeardown(mockPsqlUnmarkedAuthRoutine, "valid_canary_abc", 12345),
        /SAFETY VIOLATION: auth schema contains unmarked routine "custom_auth_helper" without runner provenance!/
      );

      assert.strictEqual(executedSqls.some((s) => s.includes("custom_auth_helper")), false, "Must NOT drop unmarked routine");
      assert.strictEqual(executedSqls.some((s) => s.includes("DROP SCHEMA IF EXISTS auth")), false, "Must NOT drop auth schema");
    });

    test("performSurgicalTeardown safely handles partially created shim objects without error", () => {
      const executedSqls = [];
      const mockPsqlPartialShim = (sql) => {
        executedSqls.push(sql.trim());
        if (sql.includes("_lifedrop_disposable_canary") && sql.includes("SELECT")) {
          return "canary_token|runner_pid|is_disposable\n---|---|---\nvalid_canary_abc|12345|t\n";
        }
        if (sql.includes("nspname = 'storage'") && sql.includes("pg_class")) {
          return "relname|comment\n---|---\nbuckets|Life Drop test compatibility mock for storage.buckets\n";
        }
        if (sql.includes("nspname = 'storage'") && sql.includes("pg_proc")) {
          return "proname|comment\n---|---\n";
        }
        if (sql.includes("nspname = 'auth'") && sql.includes("pg_class")) {
          return "relname|comment\n---|---\n";
        }
        if (sql.includes("nspname = 'auth'") && sql.includes("pg_proc")) {
          return "proname|comment\n---|---\nuid|Life Drop test compatibility mock for auth.uid\n";
        }
        if (sql.includes("obj_description(oid, 'pg_namespace')") && sql.includes("storage")) {
          return "Life Drop test compatibility mock";
        }
        if (sql.includes("obj_description(oid, 'pg_namespace')") && sql.includes("auth")) {
          return "Life Drop test compatibility mock";
        }
        if (sql.includes("count(*)")) {
          return "count\n-----\n0\n";
        }
        if (sql.includes("pg_proc p JOIN pg_namespace") || sql.includes("residualAuditSql")) {
          return "tables|views|foreign_tables|sequences|routines|custom_types\n---|---|---|---|---|---\n0|0|0|0|0|0\n";
        }
        return "";
      };

      performSurgicalTeardown(mockPsqlPartialShim, "valid_canary_abc", 12345);

      assert.ok(executedSqls.some((s) => s.includes("DROP TABLE storage.buckets RESTRICT")), "Should drop existing buckets");
      assert.strictEqual(executedSqls.some((s) => s.includes("DROP TABLE storage.objects RESTRICT")), false, "Should not attempt drop on non-existent objects");
      assert.ok(executedSqls.some((s) => s.includes("DROP FUNCTION auth.uid() RESTRICT")), "Should drop existing auth.uid");
      assert.strictEqual(executedSqls.some((s) => s.includes("DROP FUNCTION auth.jwt() RESTRICT")), false, "Should not attempt drop on non-existent auth.jwt");
    });

    test("performSurgicalTeardown aborts teardown on ambiguous object ownership", () => {
      const executedSqls = [];
      const mockPsqlAmbiguous = (sql) => {
        executedSqls.push(sql.trim());
        if (sql.includes("_lifedrop_disposable_canary") && sql.includes("SELECT")) {
          return "canary_token|runner_pid|is_disposable\n---|---|---\nvalid_canary_abc|12345|t\n";
        }
        if (sql.includes("nspname = 'storage'") && sql.includes("pg_class")) {
          return "relname|comment\n---|---\nobjects|production table created by tenant\n";
        }
        if (sql.includes("nspname = 'storage'") && sql.includes("pg_proc")) {
          return "proname|comment\n---|---\n";
        }
        if (sql.includes("obj_description(oid, 'pg_namespace')") && sql.includes("storage")) {
          return "Life Drop test compatibility mock";
        }
        return "";
      };

      assert.throws(
        () => performSurgicalTeardown(mockPsqlAmbiguous, "valid_canary_abc", 12345),
        /SAFETY VIOLATION: storage schema contains unmarked table "objects" without runner provenance!/
      );

      assert.strictEqual(executedSqls.some((s) => s.includes("DROP TABLE storage.objects")), false, "Must NOT drop objects on ambiguous ownership");
    });

    test("Preflight catalog audit detects and rejects pre-existing materialized views", () => {
      const mockPsqlWithMatView = () => {
        return "tables|views|foreign_tables|sequences|routines|custom_types|foreign_schemas|has_canary\n---|---|---|---|---|---|---|---\n0|1|0|0|0|0|0|f\n";
      };

      const audit = auditDatabaseDisposability(mockPsqlWithMatView);
      assert.strictEqual(audit.numViews, 1, "Should count 1 view/materialized view");
      assert.strictEqual(audit.totalObjects, 1, "Total objects should be 1");
      assert.strictEqual(audit.isDisposable, false, "Database with materialized view must NOT be disposable");
    });

    test("Preflight catalog audit detects and rejects pre-existing foreign tables", () => {
      const mockPsqlWithForeignTable = () => {
        return "tables|views|foreign_tables|sequences|routines|custom_types|foreign_schemas|has_canary\n---|---|---|---|---|---|---|---\n0|0|1|0|0|0|0|f\n";
      };

      const audit = auditDatabaseDisposability(mockPsqlWithForeignTable);
      assert.strictEqual(audit.numForeignTables, 1, "Should count 1 foreign table");
      assert.strictEqual(audit.totalObjects, 1, "Total objects should be 1");
      assert.strictEqual(audit.isDisposable, false, "Database with foreign table must NOT be disposable");
    });

    test("Preflight catalog audit confirms pristine disposable database (0 objects)", () => {
      const mockPsqlPristine = () => {
        return "tables|views|foreign_tables|sequences|routines|custom_types|foreign_schemas|has_canary\n---|---|---|---|---|---|---|---\n0|0|0|0|0|0|0|f\n";
      };

      const audit = auditDatabaseDisposability(mockPsqlPristine);
      assert.strictEqual(audit.totalObjects, 0, "Total objects must be 0");
      assert.strictEqual(audit.isDisposable, true, "Pristine database must be disposable");
    });

    test("performSurgicalTeardown throws TEARDOWN INCOMPLETE when residual functions, types, sequences, or views remain", () => {
      const mockPsqlWithResiduals = (sql) => {
        if (sql.includes("_lifedrop_disposable_canary") && sql.includes("SELECT")) {
          return "canary_token|runner_pid|is_disposable\n---|---|---\nvalid_canary_abc|12345|t\n";
        }
        if (sql.includes("pg_namespace") && (sql.includes("storage") || sql.includes("auth"))) {
          return "";
        }
        // Report 1 residual routine and 1 residual custom type in public schema
        if (sql.includes("pg_proc p JOIN pg_namespace") || sql.includes("residualAuditSql")) {
          return "tables|views|foreign_tables|sequences|routines|custom_types\n---|---|---|---|---|---\n0|0|0|0|1|1\n";
        }
        return "";
      };

      assert.throws(
        () => performSurgicalTeardown(mockPsqlWithResiduals, "valid_canary_abc", 12345),
        /TEARDOWN INCOMPLETE: Residual objects detected in public schema: 1 residual routine\(s\), 1 residual custom type\(s\)/
      );
    });

    test("Integration runner pre-flight statically enforces fail-closed abort on non-empty databases", () => {
      const runnerSrc = fs.readFileSync(path.join(ROOT_DIR, "scripts", "test-integration-postgres.mjs"), "utf-8");

      assert.ok(
        runnerSrc.includes("isDisposable: totalObjects === 0") || runnerSrc.includes("totalObjects > 0"),
        "Must check totalObjects === 0 / totalObjects > 0"
      );
      assert.ok(runnerSrc.includes("CRITICAL SAFETY STOP: Target database is NOT empty!"), "Must report critical safety stop");
      assert.strictEqual(
        runnerSrc.includes("Cleaning up safely before run"),
        false,
        "Must NOT contain fake 'Cleaning up safely before run' log"
      );
    });

    test("Integration runner source code preserves primary test error alongside teardown error on dual failure", () => {
      const runnerSrc = fs.readFileSync(path.join(ROOT_DIR, "scripts", "test-integration-postgres.mjs"), "utf-8");

      assert.ok(
        runnerSrc.includes("CRITICAL DUAL FAILURE: BOTH TEST SUITE AND TEARDOWN FAILED"),
        "Must log dual failure header"
      );
      assert.ok(
        runnerSrc.includes("1. Primary Test Failure : ${testError.message}"),
        "Must preserve primary test failure message"
      );
      assert.ok(
        runnerSrc.includes("2. Teardown Failure     : ${teardownError.message}"),
        "Must preserve teardown failure message"
      );
    });

    // --------------------------------------------------------------------------
    // SUITE 4: Migration Idempotency & Partial-Failure Recovery Safeguards
    // --------------------------------------------------------------------------
    console.log("\n[Suite 4] Migration Idempotency & Recovery Safeguards...");

    const MIGRATIONS_DIR = path.join(ROOT_DIR, "supabase", "migrations");

    test("Every CREATE POLICY across all migration files is guarded by DROP POLICY IF EXISTS", () => {
      const policyCreationRegex = /CREATE\s+POLICY\s+"([^"]+)"/g;

      for (const migrationFile of ORDERED_MIGRATIONS) {
        const filePath = path.join(MIGRATIONS_DIR, migrationFile);
        const sql = fs.readFileSync(filePath, "utf-8");

        let match;
        while ((match = policyCreationRegex.exec(sql)) !== null) {
          const policyName = match[1];
          const dropPattern = new RegExp(`DROP\\s+POLICY\\s+IF\\s+EXISTS\\s+"${policyName}"`, "i");
          assert.ok(
            dropPattern.test(sql),
            `Policy "${policyName}" in ${migrationFile} is missing preceding DROP POLICY IF EXISTS`
          );
        }
      }
    });

    test("All CREATE TABLE statements in migrations use IF NOT EXISTS", () => {
      for (const migrationFile of ORDERED_MIGRATIONS) {
        const filePath = path.join(MIGRATIONS_DIR, migrationFile);
        const sql = fs.readFileSync(filePath, "utf-8");

        const bareTableMatch = sql.match(/CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)[a-zA-Z0-9_.]+/i);
        assert.strictEqual(
          bareTableMatch,
          null,
          `Found bare CREATE TABLE in ${migrationFile}: ${bareTableMatch?.[0]}`
        );
      }
    });

    test("Migration runner wraps DDL and completion ledger in atomic transaction block", () => {
      const runnerPath = path.join(ROOT_DIR, "scripts", "deploy-migrations.mjs");
      const runnerSrc = fs.readFileSync(runnerPath, "utf-8");

      assert.ok(runnerSrc.includes("BEGIN;"), "Runner must start an explicit transaction block");
      assert.ok(runnerSrc.includes("COMMIT;"), "Runner must commit the transaction block");
      assert.ok(
        runnerSrc.includes("INSERT INTO public._schema_migrations (version, status, checksum, error_message, executed_at)"),
        "Completion record must be part of the atomic transaction"
      );
    });

    test("Migration runner distinguishes FAILED vs UNKNOWN outcomes and enforces --repair-migration", () => {
      const runnerPath = path.join(ROOT_DIR, "scripts", "deploy-migrations.mjs");
      const runnerSrc = fs.readFileSync(runnerPath, "utf-8");

      assert.ok(
        runnerSrc.includes("status IN ('FAILED', 'UNKNOWN')"),
        "Runner must query for both FAILED and UNKNOWN states at startup"
      );
      assert.ok(
        runnerSrc.includes("--repair-migration="),
        "Runner must require explicit migration-specific repair parameter"
      );
      assert.ok(
        runnerSrc.includes("--force-checksum"),
        "Runner must support force-checksum for intentional modifications under repair"
      );
      assert.ok(
        runnerSrc.includes(".migration_failure.json"),
        "Runner must write local emergency marker if remote ledger write fails"
      );
    });

    test(`All ${ORDERED_MIGRATIONS.length} ordered migrations have valid verification specifications`, () => {
      for (const migrationFile of ORDERED_MIGRATIONS) {
        assert.ok(
          MIGRATION_VERIFICATION_SPECS[migrationFile],
          `Missing verification specification for ${migrationFile}`
        );
        const sql = generateVerificationSql(migrationFile);
        assert.ok(typeof sql === "string" && sql.includes("SELECT"), `Invalid verification SQL for ${migrationFile}`);
      }
    });

    test("Non-transactional enum statements are extracted to prevent PostgreSQL Error 25001 & 55P04", () => {
      let totalExtracted = 0;
      for (const migrationFile of ORDERED_MIGRATIONS) {
        const filePath = path.join(MIGRATIONS_DIR, migrationFile);
        const sql = fs.readFileSync(filePath, "utf-8");
        const { sqlContent: cleanedSql, standaloneStmts } = extractEnumAlterations(sql);

        totalExtracted += standaloneStmts.length;
        // Verify no ALTER TYPE ... ADD VALUE remains in cleaned SQL that enters the transaction
        const remainingBare = cleanedSql.match(/^[ \t]*ALTER\s+TYPE\s+[^;]+ADD\s+VALUE/gim);
        assert.strictEqual(
          remainingBare,
          null,
          `Found unextracted ALTER TYPE ADD VALUE in ${migrationFile}`
        );
      }
      assert.strictEqual(totalExtracted, 15, "Expected exactly 15 enum alterations extracted across migrations");
    });
  } finally {
    // Restore original environment
    process.env = originalEnv;
  }

  console.log("\n================================================================================");
  console.log(`  PRE-DEPLOYMENT RESULTS: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log("================================================================================");

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test runner failed:", err);
  process.exit(1);
});
