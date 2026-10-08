# LIFE DROP — ENGINEERING SKILLS & WORKFLOW MANUAL (`skills.md`)

**Document Version:** 1.0.0  
**Authority:** Practical Engineering Capabilities, Operational Procedures, and Validation Guidance  
**Scope:** Life Drop Platform (All Milestones: 2A through 2H)  

---

## 1. CORE OPERATIONAL PARADIGM

Every engineering activity in the Life Drop codebase MUST follow the standard 8-stage engineering loop:

$$\text{Inspect} \longrightarrow \text{Understand} \longrightarrow \text{Challenge} \longrightarrow \text{Plan} \longrightarrow \text{Implement} \longrightarrow \text{Test} \longrightarrow \text{Verify} \longrightarrow \text{Report}$$

### 1.1 Validation Classification Boundaries

Engineers and automated agents must NEVER conflate validation environments:

1. **`LOCAL VALIDATION` (Harness & Code Correctness)**
   - Executed locally via Vitest, ESLint, TypeScript compiler, and in-memory mock repositories.
   - Proves code compilation, type safety, mock contract validity, and internal logic branches.
   - **Crucial Rule:** Local validation DOES NOT prove remote infrastructure, remote RLS, or cloud services.
2. **`REMOTE STAGING VALIDATION` (Isolated Cloud Infrastructure)**
   - Executed against a dedicated, isolated Supabase staging project and Clerk staging application.
   - Proves network connectivity, real PostgreSQL migration deployment, active RLS policy enforcement, S3 private bucket storage, Svix webhook signature verification, and multi-actor coordination workflows.
   - Never uses production credentials or real patient/donor data.
3. **`PRODUCTION VALIDATION` (Live Production Verification)**
   - Post-deployment health verification on live production infrastructure with active telemetry and monitoring.

### 1.2 Verification Result Terminology

Reports and execution logs MUST strictly categorize every assessment item into one of four statuses:

- **`PASS`**: The capability or requirement was ACTUALLY tested against the target environment and verified successfully with concrete evidence.
- **`FAIL`**: The capability or requirement was tested and failed to meet expectations or violated an invariant.
- **`BLOCKED`**: The test or action could NOT be performed due to missing credentials, unreachable services, or unconfigured dependencies. *(Never report BLOCKED as PASS).*
- **`NOT APPLICABLE`**: The requirement is explicitly not relevant to the current scope or target.

---

## 2. STANDARD ENGINEERING WORKFLOWS

### Workflow 01: Project Inspection & Environment Audit
- **Goal:** Assess current workspace state, dependencies, and environment files without modifying anything.
- **Commands:**
  ```bash
  export PATH="$HOME/.local/node/bin:/usr/bin:/bin:$PATH"
  git status
  ls -la .env*
  npm run lint
  npx tsc --noEmit
  ```
- **Rules:** Never print secrets. Verify `.env*` files are ignored by Git.

### Workflow 02: Architecture & Clean Layering Review
- **Goal:** Verify that new or modified components adhere strictly to Life Drop's layered hierarchy:
  $$\text{UI} \longrightarrow \text{Server Action} \longrightarrow \text{Service} \longrightarrow \text{Domain} \longrightarrow \text{Repository} \longrightarrow \text{Supabase}$$
- **Verification:**
  - UI components must not import Supabase clients or execute database queries directly.
  - Domain logic must remain pure functions with zero I/O side effects.
  - Client bundles must never import `@clerk/nextjs/server` or `createSupabaseAdminClient`.

### Workflow 03: Database Migrations & Schema Deployment
- **Goal:** Apply deterministic SQL migrations in sequential order to the target Supabase PostgreSQL instance.
- **Script:** `npm run staging:migrate` (via `scripts/staging-deploy-migrations.mjs`)
- **Procedure:**
  1. Verify all migration files exist locally in `supabase/migrations/`.
  2. Verify credentials in `.env.staging` (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_ACCESS_TOKEN` or `DATABASE_URL`).
  3. Ensure migrations table `public._schema_migrations` tracks applied versions.
  4. Pre-commit any `ALTER TYPE ... ADD VALUE` statements in separate transactions before referencing them in index/table definitions.
  5. Verify created tables in `information_schema.tables`.

### Workflow 04: Supabase Cloud Connectivity & REST Validation
- **Goal:** Verify authenticated communication with Supabase PostgREST endpoints.
- **Procedure:**
  - Execute authenticated `GET /rest/v1/profiles?select=count` with `SUPABASE_SERVICE_ROLE_KEY`.
  - Expect HTTP `200 OK`.
  - Validate that public schema tables exist and respond to queries.

### Workflow 05: PostgreSQL Row Level Security (RLS) Validation
- **Goal:** Prove that database policies prevent cross-tenant and cross-role data leaks.
- **Test Scenarios:**
  - **Requester Isolation:** User A can read/update their own profile; cannot read User B's unmasked profile.
  - **Donor Privacy:** Donors can query their own commitments; cannot read unrelated donor contact details.
  - **Medical Document Privacy:** Donors and unrelated users receive 0 rows when querying `verification_documents`.
  - **Hospital Scoping:** Hospital Staff can only access requests affiliated with their assigned hospital.
  - **Admin Scope:** Moderators/Admins can access review queues and documents.

### Workflow 06: Clerk Authentication & Identity Mapping
- **Goal:** Verify Clerk user authentication and synchronization with Supabase `profiles`.
- **Procedure:**
  - Test live Clerk Backend API connectivity via `GET https://api.clerk.com/v1/users?limit=1`.
  - Ensure Server Actions extract identity via `currentUser()` or `auth()`.
  - Verify that client-provided `userId` parameters are completely ignored.

### Workflow 07: Clerk Webhook & Svix Signature Verification
- **Goal:** Validate cryptographic webhook processing at `/api/webhooks/clerk`.
- **Test Matrix:**
  - **Valid Signature:** Svix headers verified $\longrightarrow$ profile created/updated idempotently (`200 OK`).
  - **Invalid/Tampered Signature:** Cryptographic verification fails $\longrightarrow$ returns HTTP `401 Unauthorized`.
  - **Missing Headers:** Returns HTTP `400 Bad Request`.
  - **Replay Attack:** Duplicate message ID identified in `public.processed_webhooks` $\longrightarrow$ processed idempotently without side effects.

### Workflow 08: Server-Side Authorization & RBAC Validation
- **Goal:** Ensure elevated actions require verified roles (`USER`, `DONOR`, `HOSPITAL_STAFF`, `MODERATOR`, `ADMIN`).
- **Procedure:**
  - In Server Actions (e.g. `medicalReviewAction`, `checkInDonorAction`), verify role check precedes database mutations.
  - Reject non-admin calls to `/review/medical` and non-staff calls to `/hospital/donations`.

### Workflow 09: Insecure Direct Object Reference (IDOR) Testing
- **Goal:** Prove users cannot mutate or view records by guessing or supplying arbitrary UUIDs.
- **Test Matrix:**
  - User A attempts `bloodRequestActions.updateRequest(userBRequestId)` $\longrightarrow$ `DENIED`
  - Donor A attempts `donorActions.cancelCommitment(donorBCommitmentId)` $\longrightarrow$ `DENIED`
  - User A attempts to view `/api/storage/medical_prescriptions/{userBRequestId}/file` $\longrightarrow$ `DENIED`

### Workflow 10: Client Manipulation & Parameter Tampering Testing
- **Goal:** Verify server rejects client attempts to self-promote or force invalid state transitions.
- **Test Matrix:**
  - Client attempts to submit `{ role: "ADMIN" }` $\longrightarrow$ Ignored/Overwritten to `USER`.
  - Client attempts to submit `{ status: "VERIFIED" }` on new request $\longrightarrow$ Force-set to `SUBMITTED`.
  - Client attempts to submit `{ status: "COMPLETED" }` on commitment $\longrightarrow$ Rejected.

### Workflow 11: Database Concurrency & Race Condition Testing
- **Goal:** Prove atomic procedures prevent over-subscription and race conditions under concurrent load.
- **Test Matrix:**
  - **Commitment Race:** Two donors simultaneously attempt to accept the last available unit of a request.
    - Verified via `public.commit_donor_to_request_atomic` with `FOR UPDATE` lock.
    - Result: Exactly one succeeds; the second receives `ERR_INSUFFICIENT_UNITS`.
    - Invariant: $\text{units\_committed} + \text{units\_reserved} \le \text{units\_requested}$ is strictly preserved.
  - **Duplicate Check-in:** Simultaneous check-in calls for the same commitment $\longrightarrow$ Exactly one proceeds; the second is rejected.

### Workflow 12: Notification & Durable Outbox Testing
- **Goal:** Ensure transactional operations decouple notifications using the durable outbox queue.
- **Procedure:**
  - Trigger domain transition (e.g., `DONATION_COMPLETED`).
  - Verify event row is inserted into `public.notification_events` with status `PENDING`.
  - Verify worker processing updates status to `COMPLETED` and emits record to `public.notifications`.
  - Verify retry logic and dead-letter handling on delivery failure.

### Workflow 13: Audit Log & Immutability Verification
- **Goal:** Verify clinical audit logs are captured and cannot be tampered with.
- **Procedure:**
  - Trigger clinical action (e.g., `DONOR_CHECKED_IN`, `DONATION_RECORDED`).
  - Confirm entry exists in `public.audit_logs` with actor ID, target ID, and previous/new state JSONB.
  - Attempt `UPDATE` or `DELETE` on the audit row $\longrightarrow$ rejected by rule/trigger (`Audit logs are strictly immutable`).

### Workflow 14: Rate Limiting Verification
- **Goal:** Verify API protection against denial-of-service and credential stuffing.
- **Procedure:**
  - Send rapid burst requests to rate-limited action (e.g. request creation, document upload).
  - Verify HTTP `429 Too Many Requests` is returned once threshold is breached.
  - **Architecture Note:** Document that in-memory token buckets are valid for single-node staging; multi-node production horizontally scaled deployments require centralized Redis/Upstash.

### Workflow 15: Browser End-to-End Validation
- **Goal:** Verify UI rendering, client navigation, and user journeys in a real browser.
- **Procedure:**
  - Execute browser subagent or Playwright tests against target deployment URL.
  - Test sign-in modal, request submission form, donor discovery view, and hospital queue.
  - **Constraint:** If browser driver is unavailable (e.g. host CDN 404), report `BROWSER VALIDATION: BLOCKED — TOOLING UNAVAILABLE` without fabricating results.

### Workflow 16: Local Quality Gates Execution
- **Goal:** Verify full code health prior to any release or commit.
- **Commands:**
  ```bash
  export PATH="$HOME/.local/node/bin:/usr/bin:/bin:$PATH"
  npm test             # 117 tests across 8 suites must pass
  npm run lint         # ESLint: 0 errors, 0 warnings
  npx tsc --noEmit     # TypeScript: 0 type errors
  npm run build        # Next.js 16.4.0 production compilation: 14/14 routes compiled
  ```

### Workflow 17: Remote Staging Validation (18-Step Live Suite)
- **Goal:** Execute the complete end-to-end Life Drop lifecycle against real staging infrastructure.
- **Command:** `npm run staging:smoke` (via `scripts/staging-smoke-test.mjs`)
- **18 Steps Verified:**
  1. Requester Signs In (Clerk session verified)
  2. Profile Mapping (Roles: USER, DONOR, HOSPITAL_STAFF)
  3. Create Blood Request (Status: SUBMITTED)
  4. Prescription Upload (Private bucket `medical_prescriptions`, status: PENDING_REVIEW)
  5. Medical Verification (Reviewed by Hospital Staff $\longrightarrow$ VERIFIED)
  6. Activate Requisition (Status: ACTIVE)
  7. Donor Discovery (ABO/Rh compatibility match)
  8. Donor Expresses Interest (Status: ACCEPTED)
  9. Requester Confirms Commitment (Units committed, status: PARTIALLY_COMMITTED)
  10. Donation Scheduled (Appointment timestamp set, status: SCHEDULED)
  11. Hospital Queue Visibility (Central General Hospital queue verified)
  12. Hospital Staff Check-in (Status: CHECKED_IN)
  13. Start Blood Draw (Status: DONATION_IN_PROGRESS)
  14. Record Blood Draw (Volume and units recorded by clinical staff)
  15. Complete Donation (Status: DONATION_CONFIRMED)
  16. Fulfillment Sync (Request units synchronized)
  17. Outbox Delivery (Event queued in `notification_events`)
  18. Immutable Audit Log (Audit record verified; deletion blocked)

### Workflow 18: Security Review & Secret Leak Prevention
- **Goal:** Inspect workspace before concluding any task to guarantee no security leaks.
- **Procedure:**
  - Inspect `git status` and file diffs.
  - Confirm `.env*` files are NOT staged or tracked.
  - Confirm no API keys or service role secrets are hardcoded in test files or scripts.
  - Confirm no debug mock bypasses were left enabled in production paths.

### Workflow 19: Incident Investigation & Debugging
- **Goal:** Systematically diagnose runtime issues without destructive edits.
- **Procedure:**
  1. Inspect runtime error logs and terminal stack traces.
  2. Identify the failing layer (UI, Action, Service, Database, Network).
  3. Formulate minimal hypothesis.
  4. Implement minimal, targeted fix.
  5. Run regression suite (`npm test && npm run lint`) to ensure zero collateral breakage.
