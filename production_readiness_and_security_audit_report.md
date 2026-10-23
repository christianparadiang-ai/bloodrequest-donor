# Life Drop: Production Readiness & Security Audit Report

**System:** Life Drop — Blood Request and Donor Coordination Platform  
**Target Authorized Administrator:** `christian.paradiang@urios.edu.ph` (Clerk ID: `user_3KTw3DOq4dsbAKiqeQ50fiwOZZU`)  
**Staging Supabase Reference:** `vblfkcyeefiwhhpbwxhr` (`https://vblfkcyeefiwhhpbwxhr.supabase.co`)  
**Production Supabase Reference:** `yvddbpugkfpoeleuyzci` (`https://yvddbpugkfpoeleuyzci.supabase.co`)  
**Current Branch:** `main`  
**Base Commit:** `04b8edf8bf1ec94bf6e2bc6870a4697394625f5d` (`04b8edf`)  
**Remote Tracking:** `https://github.com/christianparadiang-ai/bloodrequest-donor.git`  
**Date of Audit:** October 23, 2026  

---

## Executive Verdict Summary

| Evaluation Domain | Audit Verdict | Current State & Operational Constraint |
| :--- | :---: | :--- |
| **Database Migration Gate** | **INSUFFICIENT EVIDENCE** | **BLOCKED FROM EXECUTION.** Remote production schema catalog, pre-existing tables, ledger status, and backup snapshot are **UNKNOWN / UNCONFIRMED**. Migration execution (`npm run prod:migrate -- --confirm`) remains strictly prohibited until manual backup and read-only catalog verification are completed. |
| **Application Deployment Gate** | **READY FOR PRODUCTION REVIEW** | **CODEBASE VERIFIED.** Next.js 16.4.2 build, TypeScript type safety, ESLint, Clerk authentication, admin-only server authorization, points ledger idempotency, CSV sanitization, and all 11 test suites pass with Exit Code `0`. Zero code regressions. Live hosting deployment is **BLOCKED** on account-side Vercel configuration, environment variables, and migration completion. |

---

## 1. Task 1 — Production Database Access & Runner Inspection

### 1.1 Remote Read-Only Capabilities of Migration Runner (`scripts/deploy-migrations.mjs`)
A thorough architectural inspection of `scripts/deploy-migrations.mjs` was conducted:
1. **`--dry-run` Limitation:**
   - When invoked with `--dry-run`, the runner hashes all 16 local migration files and checks for placeholder tokens in `.env.production`.
   - **Crucial Finding:** `--dry-run` performs **zero network I/O** (terminates at line 488 before any socket connection or HTTP request). It does not probe remote database existence, schema objects, or migration ledger state.
2. **Missing Dedicated Read-Only Query Mode:**
   - The runner does not possess a read-only `--inspect` or `--status` mode.
   - If executed without `--dry-run`, the runner immediately attempts DDL mutations at lines 540–551:
     ```sql
     CREATE TABLE IF NOT EXISTS public._schema_migrations (...);
     ALTER TABLE public._schema_migrations ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'COMPLETED';
     ALTER TABLE public._schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT;
     ALTER TABLE public._schema_migrations ADD COLUMN IF NOT EXISTS error_message TEXT;
     ```
   - Running the script against an uninspected database violates the read-only safety invariant by creating/altering `public._schema_migrations`.
3. **Transport Mechanism & Driver Constraints:**
   - The runner communicates exclusively via HTTPS POST requests to the Supabase Management API:
     `https://api.supabase.com/v1/projects/${projectRef}/database/query`
   - This endpoint requires a valid `SUPABASE_ACCESS_TOKEN` (Supabase Personal Access Token).
   - The runner has no direct PostgreSQL client (`pg` driver) configured. Although `DATABASE_URL` is parsed if provided, line 533 explicitly throws:
     `Error: Direct database connection requires SUPABASE_ACCESS_TOKEN or pg driver.`
4. **Service-Role Key Limitation:**
   - Using `SUPABASE_SERVICE_ROLE_KEY` via PostgREST REST endpoints (`/rest/v1/`) cannot substitute for administrative catalog inspection:
     - PostgREST only exposes tables registered in exposed schemas (`public`) and cached in schema cache.
     - PostgREST cannot query `information_schema`, `pg_catalog`, `pg_proc`, `pg_policies`, or execute arbitrary `SELECT EXISTS (...)` statements.
     - Attempting to query non-existent tables via PostgREST yields ambiguous 404 responses rather than authoritative catalog inspection.

### 1.2 Remote Production Database Access Findings
- **Target URL:** `https://yvddbpugkfpoeleuyzci.supabase.co`
- **Network Reachability:** HTTPS requests return HTTP 401 Unauthorized (confirming active Supabase infrastructure listening on DNS).
- **Workspace Credentials:** `.env.production` contains unconfigured placeholders:
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY=your_production_supabase_anon_key`
  - `SUPABASE_SERVICE_ROLE_KEY=your_production_supabase_service_role_key`
  - `SUPABASE_ACCESS_TOKEN` is unset.
- **Empirical Determination:**
  - Whether production tables (`profiles`, `blood_requests`, etc.) already exist: **UNKNOWN**.
  - Whether `public._schema_migrations` exists: **UNKNOWN**.
  - Which migrations are recorded as completed, failed, or unknown: **UNKNOWN**.
  - Whether actual table definitions and constraints match migration assumptions: **UNKNOWN**.
- **Engineering Principle:** Under strict audit standards, an empty database **CANNOT** be inferred from DNS reachability, HTTP 401 unauthenticated responses, local dry runs, or missing access.

---

## 2. Task 2 — In-Depth Migration Correctness & Risk Review

A line-by-line inspection of all 16 SQL migration files and the runner logic revealed the following findings:

### 2.1 Dependency Chain & Execution Order
The 16 migrations exhibit strict sequential dependency ordering:
1. `20261007_init_lifedrop_schema.sql`: Base enums, `profiles`, `donor_profiles`, `blood_requests`, `donor_commitments`, `audit_logs`.
2. `20261007_enhanced_rls_and_atomic_commitment.sql`: Depends on tables in #1; creates `commit_donor_to_request_atomic`.
3. `20261007_verification_documents_and_storage.sql`: Defines `is_moderator_or_admin` and `is_affiliated_hospital_staff`.
4. `20261007_donor_coordination_and_commitments.sql`: Extends `blood_requests` and `donor_commitments` with reservation counters and atomic functions.
5. `20261007_notifications_and_outbox.sql`: Creates `notifications` and `notification_events` outbox.
6. `20261007_donation_operations_and_checkin.sql`: Adds check-in enums and columns to `donor_commitments`.
7. `20261007_production_hardening.sql`: Creates `processed_webhooks` and immutable audit log trigger.
8. `20261008_milestone1_donor_profile_enhancements.sql`: Adds `province`, `consent_to_contact` to `donor_profiles`.
9. `20261008_milestone2_blood_request_enhancements.sql`: Adds requisition fields; depends on `is_moderator_or_admin` and `is_affiliated_hospital_staff` (created in #3).
10. `20261008_milestone3_matching_engine.sql`: Creates `request_matches`; depends on `blood_requests` (#1) and `donor_profiles` (#1).
11. `20261008_milestone4_donor_notifications.sql`: Adds `match_id` foreign key referencing `request_matches` (created in #10).
12. `20261008_milestone5_donor_commitments.sql`: Adds `match_id` foreign key referencing `request_matches` (#10) and `donor_profile_id` referencing `donor_profiles` (#1).
13. `20261009_milestone6_donation_tracking.sql`: Creates `donations` table; references `blood_requests`, `donor_commitments`, and `donor_profiles`.
14. `20261009_milestone7_outbox_and_reconciliation.sql`: Creates `claim_outbox_jobs` and `reconcile_request_counters`; references tables from #1, #5, #13.
15. `20261009_milestone8_security_hardening.sql`: Hardens functions from #14; enables RLS across all 11 tables.
16. `20261020_milestone9_donor_points_and_reporting.sql`: Creates `points_config` and `donor_points_transactions`; references `profiles`, `donor_profiles`, and `donations` (#13).

**Finding:** The sequential order (1 through 16) is logically sound and satisfied without forward-referencing cycles.

### 2.2 Row-Level Security Policy Evolution & Strictness
Across the migrations, RLS policies are systematically dropped with `DROP POLICY IF EXISTS` before re-creation:
- In Migration 1, `blood_requests` permitted broad requester operations: `CREATE POLICY "Requesters manage own requests" FOR ALL USING (requester_id = public.current_profile_id())`.
- In Migration 9 (Milestone 2), this was replaced with granular, stricter policies:
  - Requesters can SELECT own requests at any time.
  - Requesters can INSERT own requests.
  - Requesters can UPDATE own requests **only when status = 'DRAFT'**.
  - All status transitions to ACTIVE or UNDER_REVIEW require verified hospital staff or moderator review.
- In Migration 12 (Milestone 5), donors can update commitments **only to mark status as 'WITHDRAWN'**.
- In Migration 15 (Milestone 8), `ENABLE ROW LEVEL SECURITY` is explicitly reapplied across all 11 public tables to prevent accidental unshielded tables.
- In Migration 16 (Milestone 9), points rules modification is restricted strictly to `ADMIN` and `SUPER_ADMIN`.

**Finding:** RLS policies are recreated with equivalent or substantially stricter access controls.

### 2.3 Standalone Enum Side Effects vs. Transactional Boundaries
- **PostgreSQL Enum Limitation:** Adding enum values via `ALTER TYPE ... ADD VALUE` cannot run inside a multi-statement transaction in PostgreSQL (Error 25001 / 55P04).
- **Runner Handling:** `extractEnumAlterations()` extracts all `ALTER TYPE ... ADD VALUE` statements (found in DO blocks or bare lines) and executes them in separate autocommit transactions *before* opening the migration's `BEGIN; ... COMMIT;` block.
- **Risk Identification:** If standalone enum alterations succeed, but the subsequent transactional block fails:
  - The newly added enum values remain permanently committed in PostgreSQL `pg_enum`.
  - The transactional DDL rolls back, leaving the migration recorded as `FAILED`.
  - **Mitigation in SQL:** All enum statements in migrations 4, 6, 11, and 12 use `ADD VALUE IF NOT EXISTS` or `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN null; END $$;`. Subsequent reruns will safely ignore the committed enum values.

### 2.4 Reconciliation Vulnerability for `UNKNOWN` State
When an execution drops connection or times out, the runner records status `UNKNOWN`. Before re-executing, `--repair-migration` runs `generateVerificationSql()` against `MIGRATION_VERIFICATION_SPECS`:
- **Critical Flaw in Milestone 8 Verification Spec:**
  - `MIGRATION_VERIFICATION_SPECS["20261009_milestone8_security_hardening.sql"]` specifies:
    ```javascript
    functions: ["claim_outbox_jobs", "reconcile_request_counters", "prevent_audit_log_modification"]
    ```
  - However, all three functions were already defined in earlier migrations (Milestone 7 and Production Hardening).
  - If Milestone 8 terminates in `UNKNOWN` state, `generateVerificationSql` will evaluate to `true` even if Milestone 8 never committed its security hardening (REVOKE/GRANT execution restrictions and RLS re-activation)!
  - **Recommendation:** `MIGRATION_VERIFICATION_SPECS` for Milestone 8 must be enhanced to inspect specific routine privileges (`has_function_privilege`) or RLS status rather than mere routine names.

### 2.5 Assumptions That Only Hold for a Fresh Database
1. **Partial Unique Indexes on Pre-existing Data:**
   - In Migration 12 (Milestone 5), whole-table constraint `unique_active_commitment` is dropped and replaced with partial index `idx_donor_commitments_active_donor_req`. If a pre-existing dirty database contains duplicate active commitments, this index creation will fail.
   - In Migration 16 (Milestone 9), `idx_points_unique_completed_donation` creates a partial unique index on `(donation_id)` WHERE `transaction_type = 'DONATION_COMPLETED'`. Pre-existing duplicate point awards will cause an unrecoverable failure.
2. **Staging vs. Production Auto-Reconciliation Bias:**
   - Lines 630–646 of `deploy-migrations.mjs` contain a legacy backfill rule that marks migrations 1–5 as `COMPLETED` if `profiles` table exists.
   - This rule explicitly checks `target === "staging"`. In `target === "production"`, if tables exist without `_schema_migrations`, the runner will attempt to re-execute migration 1 and fail on table collision.

---

## 3. Task 3 — Backup and Disaster Recovery Verification

### 3.1 Verification Status: UNCONFIRMED
Because remote management API credentials and database access are unavailable in the workspace, backup and Point-In-Time Recovery (PITR) status cannot be inspected programmatically.

### 3.2 Exact Manual Verification Steps for Account Owner
Prior to authorizing any production database migrations, the account owner must perform the following actions:
1. Log in to the official [Supabase Dashboard](https://supabase.com/dashboard).
2. Select target production project: **`yvddbpugkfpoeleuyzci`**.
3. In the left navigation menu, navigate to:
   **Project Settings -> Database -> Backups** (or direct URL: `https://supabase.com/dashboard/project/yvddbpugkfpoeleuyzci/database/backups/scheduled`).
4. **Inspect Automated Backups:** Verify that daily automated backups are scheduled and active.
5. **Inspect PITR (Point-in-Time Recovery):** Verify whether PITR is enabled (recommended for production).
6. **Trigger Immediate Pre-Migration Snapshot:**
   - Click the **Take Backup** button.
   - Wait for snapshot completion.
   - Record the exact snapshot timestamp (UTC) in deployment records.

---

## 4. Task 4 — Application Deployment Readiness Assessment

### 4.1 Automated Verification Command Suite Results
Every test suite was executed on `main` at base commit `04b8edf` with exact exit code `0`:

| # | Verification Suite | Exact Command Executed | Exit Code | Verified Empirical Result | Status |
| :-: | :--- | :--- | :-: | :--- | :-: |
| 1 | **Clean Dependency Tree** | `npm ci` | `0` | 621 packages locked; Next.js 16.4.2 audited cleanly | **PASS** |
| 2 | **Static Code Linting** | `npm run lint` | `0` | Zero ESLint warnings; zero errors | **PASS** |
| 3 | **TypeScript Type Safety** | `npx tsc --noEmit` | `0` | Zero type errors across all routes, actions, and shims | **PASS** |
| 4 | **Admin Role & Authorization** | `npm run test:admin` | `0` | 9/9 suites passed; identity pinning verified | **PASS** |
| 5 | **Points Ledger & Reports** | `npm run test:points-reports` | `0` | 21/21 assertions passed; formula injection shielded | **PASS** |
| 6 | **Pre-Deployment Schema Integrity** | `npm run test:pre-deploy` | `0` | 41/41 assertions passed; server secrets strictly shielded | **PASS** |
| 7 | **Multi-Role End-to-End Audit** | `npm run test:e2e` | `0` | 24/24 assertions passed across 5 live personas | **PASS** |
| 8 | **Remote Staging Smoke Walkthrough** | `node scripts/staging-smoke-test.mjs` | `0` | 18/18 live lifecycle steps passed against staging | **PASS** |
| 9 | **Offline Recovery Simulator** | `node scripts/test-offline-recovery.mjs` | `0` | 11/11 fault-injection cases passed | **PASS** |
| 10 | **Production Migration Dry Run** | `npm run prod:migrate -- --dry-run` | `0` | 16/16 SHA-256 checksums verified; 0 network mutations | **PASS** |
| 11 | **Turbopack Production Build** | `npx next build` | `0` | 21/21 routes compiled cleanly in Turbopack | **PASS** |

### 4.2 Application Security & Architectural Review
- **Clerk Production Authentication & Webhook:**
  - Route: `/api/webhooks/clerk`.
  - Cryptographic verification via Svix headers (`svix-id`, `svix-timestamp`, `svix-signature`).
  - Replay tolerance strictly capped at 300 seconds.
  - Live keys (`pk_live_...`, `sk_live_...`, `whsec_...`) must be configured in hosting environment.
- **Role Authorization & Identity Pinning:**
  - Target Administrator: `christian.paradiang@urios.edu.ph` (`user_3KTw3DOq4dsbAKiqeQ50fiwOZZU`).
  - Strict server-side role clamp in `lib/auth/roles.ts`: Client metadata or forged roles are ignored; ordinary users default strictly to `USER`.
  - Admin routes (`/admin`, `/admin/donors`, `/admin/reports`) reject unauthorized access.
- **Donor Privacy & Sensitive Data:**
  - Donor names are masked in reports and non-clinical interfaces (`Juan D.` format).
  - Medical notes and prescriptions require hospital staff authorization.
- **Points Ledger & CSV Security:**
  - `donor_points_transactions` enforces exact-once point awards per donation via unique partial index.
  - CSV reports serializer sanitizes spreadsheet formula triggers (`=`, `+`, `-`, `@`, `\t`, `\r`) and applies RFC 4180 escaping with UTF-8 BOM.
- **Workers & Background Tasks:**
  - Outbox (`/api/workers/outbox`) and Reconciliation (`/api/workers/reconciliation`) endpoints require `WORKER_SECRET` or `CRON_SECRET`.
  - Cron schedule defined in `vercel.json` (`* * * * *` and `*/5 * * * *`).
- **Distributed Rate Limiting:**
  - Upstash Redis rate limiting configured in `lib/rate-limit.ts`; requires `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in production for multi-instance serverless edge coordination.

### 4.3 Hosting Deployment Blockers
The application codebase is fully ready for production deployment review, but live deployment cannot proceed until:
1. **Vercel Project Linking:** No `.vercel` configuration exists; the project must be imported via Vercel Dashboard.
2. **Environment Variables:** Production environment variables (Category A) must be populated in Vercel.
3. **Database Migration Prerequisite:** Production database migrations must be applied to `yvddbpugkfpoeleuyzci` before pointing production traffic to it.

---

## 5. Production Environment Variables Checklist

### Category A: Required in Vercel Project Settings (Runtime)
- `NEXT_PUBLIC_APP_ENV`: `production`
- `NODE_ENV`: `production`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`: Live Clerk publishable key (`pk_live_...`)
- `NEXT_PUBLIC_CLERK_SIGN_IN_URL`: `/sign-in`
- `NEXT_PUBLIC_CLERK_SIGN_UP_URL`: `/sign-up`
- `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL`: `/dashboard`
- `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL`: `/dashboard`
- `NEXT_PUBLIC_SUPABASE_URL`: `https://yvddbpugkfpoeleuyzci.supabase.co`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Production Supabase anon key
- `NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET`: `verification-documents`
- `CLERK_SECRET_KEY`: Live Clerk secret key (`sk_live_...`)
- `CLERK_WEBHOOK_SECRET`: Live Svix secret (`whsec_...`)
- `SUPABASE_SERVICE_ROLE_KEY`: Production Supabase service role key (server-only)
- `CRON_SECRET`: Random 32+ character string for Vercel cron headers
- `WORKER_SECRET`: Random 32+ character string for worker authorization

### Category B: Required Locally for One-Time Migration Execution
- `SUPABASE_ACCESS_TOKEN`: Supabase Personal Access Token (for `npm run prod:migrate -- --confirm`). **Do not add to Vercel runtime.**

### Category C: Recommended for Full Production Resiliency
- `UPSTASH_REDIS_REST_URL` & `UPSTASH_REDIS_REST_TOKEN`: Edge rate limiting across serverless lambdas.
- `RESEND_API_KEY`: Email notification dispatch.
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`: SMS emergency broadcasts.

### Category D: Optional / Unused by Core Runner
- `DATABASE_URL`: Direct PostgreSQL connection string (not required by `deploy-migrations.mjs`).

---

## 6. Prioritized Remaining Actions

| Priority | Action Item | Responsible Party | Operational Environment | Status |
| :-: | :--- | :--- | :--- | :---: |
| **P0** | Manually take pre-migration database backup snapshot | Account Owner | Supabase Dashboard (`yvddbpugkfpoeleuyzci`) | **REQUIRED** |
| **P0** | Generate Supabase Personal Access Token (`sbp_...`) | Account Owner | Supabase Dashboard (Account Settings -> Access Tokens) | **REQUIRED** |
| **P0** | Perform authorized read-only inspection of remote catalog | Authorized Agent / Owner | Supabase Management API | **REQUIRED** |
| **P0** | Execute production migrations (`npm run prod:migrate -- --confirm`) | Authorized Agent / Owner | Local Shell (Isolated Environment) | **PENDING P0s** |
| **P0** | Link GitHub repo to Vercel and populate Category A variables | Account Owner | Vercel Dashboard | **PENDING MIGRATION** |
| **P0** | Register production Clerk webhook endpoint (`https://<domain>/api/webhooks/clerk`) | Account Owner | Clerk Dashboard | **PENDING DOMAIN** |
| **P1** | Revoke exposed Clerk test keys | Account Owner | Clerk Dashboard | **RECOMMENDED** |
| **P1** | Configure Upstash Redis distributed rate limiting | Account Owner | Vercel Environment | **RECOMMENDED** |
| **P2** | Perform live production smoke test walkthrough against live URL | Authorized Agent / Owner | Production Web Application | **PENDING DEPLOY** |

---

## 7. Dual Verdict Declaration

### Database Migration Verdict: **INSUFFICIENT EVIDENCE**
- The 16 migration SQL files are structurally additive and sound.
- However, the remote production database (`yvddbpugkfpoeleuyzci`) schema, table existence, and backup status remain **UNKNOWN / UNCONFIRMED** due to absent read-only credentials.
- In accordance with safety rules, production migration execution is **BLOCKED**.

### Application Deployment Verdict: **READY FOR PRODUCTION REVIEW**
- The application codebase, Turbopack production build, Next.js 16.4.2 patch, Clerk auth architecture, admin identity pinning, points idempotency, and test suites are verified with **Exit Code 0 across all 11 suites**.
- The software artifact itself is ready for deployment once hosting and database prerequisites are completed.
