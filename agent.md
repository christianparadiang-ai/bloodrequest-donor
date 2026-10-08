# LIFE DROP — SENIOR ENGINEERING AGENT INSTRUCTION MANUAL (`agent.md`)

**Document Version:** 1.0.0  
**Authority:** Primary Governance for Engineering Behavior, Architecture, Security, and Verification  
**Scope:** Life Drop Platform (All Milestones: 2A through 2H)  

---

## 1. MISSION & CRITICAL DOMAIN BOUNDARY

**Life Drop** is a voluntary blood-request and donor-coordination network designed to connect urgent patient blood needs with compatible local voluntary donors in minutes.

> ### ⚠️ ESSENTIAL DOMAIN BOUNDARY
> **Life Drop is NOT a replacement for hospitals, blood banks, transfusion specialists, or licensed medical professionals.**
> - Life Drop does NOT diagnose conditions, prescribe blood products, or authorize transfusions.
> - Life Drop coordinates information and voluntary donor logistics only.
> - Actual medical eligibility verification, cross-matching, blood draws, clinical testing, and transfusions are performed exclusively by qualified clinical personnel at authorized hospital facilities.

---

## 2. ENGINEERING DECISION-MAKING HIERARCHY

When evaluating technical tradeoffs, architectural patterns, or bug resolutions, every engineering agent MUST strictly respect this priority order:

```text
1. Safety (Clinical & Patient Well-being)
2. Data Integrity (Database Transactions & Concurrency Invariants)
3. Security and Privacy (HIPAA/Medical Data Confidentiality, RLS, Identity)
4. Business & Domain Correctness (Blood Compatibility Rules, Lifecycles)
5. User Experience (Fast, Accessible, Error-Tolerant Clinical & Public UI)
6. Reliability (High Availability, Durable Outbox, Graceful Fallbacks)
7. Maintainability (Clean Layering, Strict Typing, Modular Architecture)
8. Performance (Optimized Queries, Indexed Lookups, Efficient Caching)
9. Developer Convenience (Never sacrifice 1–8 for developer shortcuts)
```

---

## 3. CORE ENGINEERING PRINCIPLES & NON-NEGOTIABLE RULES

1. **Never fabricate test results, credentials, or infrastructure.**
   - Never claim remote infrastructure was validated without executing real tests against live endpoints.
   - If a test cannot be executed, mark it `BLOCKED` — never convert `BLOCKED` into `PASS`.
2. **Strict Environment Separation.**
   - Staging must use a dedicated, isolated Supabase project and Clerk application.
   - Never use production credentials, database instances, or storage buckets for staging validation.
   - Never use real patient or donor medical data in development or staging environments. Synthetic personas only.
3. **Zero Secrets in Code or Logs.**
   - Never print or log secret values (`SUPABASE_SERVICE_ROLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET`).
   - Never commit `.env`, `.env.local`, or `.env.staging` files.
   - Mask sensitive tokens in all diagnostic output.
4. **Never Trust Client-Controlled State or Input.**
   - Always derive identity from authenticated server-side context (`currentUser()`, `auth()`, `auth.jwt()`).
   - Server Actions and API endpoints must independently authenticate and authorize every invocation.
   - Client-supplied `userId`, `role`, `status`, `verificationStatus`, or `commitmentStatus` must be ignored or rejected.
5. **Defense-in-Depth Authorization.**
   - Enforce authorization in Server Actions/Services AND at the PostgreSQL database layer via Row Level Security (RLS).
6. **Preserve Business & Domain Invariants.**
   - Use atomic database operations (`plpgsql` functions with `FOR UPDATE` locking) for concurrency-sensitive workflows.
   - Never allow over-subscription of requested units:
     $$\text{units\_donated} + \text{units\_reserved} \le \text{units\_requested}$$
7. **Blood Compatibility $\ne$ Donor Matching.**
   - **Blood Compatibility** is a strict, immutable medical rule governed by antigen-antibody science (e.g., O-negative Whole Blood is universally compatible for red blood cells; AB-positive is universal plasma recipient).
   - **Donor Matching** is an operational process that combines medical compatibility with geographic proximity, donation cooldown periods, donor availability, and medical requisition verification.
   - Never invent or loosen medical compatibility rules.
8. **Conservative Code Modification.**
   - Do not rewrite working code unnecessarily.
   - Run full regression suites (`npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`) after changes.

---

## 4. SYSTEM ARCHITECTURE & LAYER BOUNDARIES

Every feature must conform to Life Drop's strict unidirectional architectural layering:

```text
┌────────────────────────────────────────────────────────┐
│             UI / Presentation Layer                    │
│   (Next.js App Router, React Server Components, Forms)  │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│             Server Action / API Gateway                │
│    (Session extraction, Rate limiting, Input parsing)   │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│             Application Service Layer                  │
│    (Orchestration, Transaction coordination, Outbox)   │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│               Domain Logic Layer                       │
│    (Pure business rules, Compatibility matrices, State) │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│             Repository / Data Access Layer             │
│   (Supabase JS Client, Query builders, PostgREST)      │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│             Database & Storage Layer                   │
│   (PostgreSQL 17, RLS Policies, Triggers, S3 Storage)  │
└────────────────────────────────────────────────────────┘
```

- **Rule 1:** Presentation components NEVER query Supabase directly; they invoke Server Actions.
- **Rule 2:** Domain logic NEVER performs I/O or database queries; it evaluates pure state and business invariants.
- **Rule 3:** Administrative operations requiring elevated privileges MUST use `createSupabaseAdminClient()` strictly on the server, never exposed to client bundles.

---

## 5. LIFECYCLE STATE MACHINES

### 5.1 Blood Request Lifecycle

```text
  [DRAFT]
     │
     ▼ (User submits with prescription)
 [SUBMITTED]
     │
     ▼ (Medical review in progress)
 [UNDER_REVIEW] ───────────► [REJECTED] (Unreadable/Invalid Rx)
     │
     ▼ (Doctor prescription verified)
  [ACTIVE] ◄─────────────────┐
     │                       │ (Commitment cancelled/no-show)
     ▼ (Donor accepts)       │
 [PARTIALLY_COMMITTED] ──────┘
     │
     ▼ (All required units reserved)
 [FULLY_COMMITTED]
     │
     ▼ (Hospital confirms blood draws)
 [PARTIALLY_FULFILLED]
     │
     ▼ (All units drawn and confirmed)
  [FULFILLED] (Terminal Success)

Exception Transitions:
- Any non-fulfilled state ──► [CANCELLED] (Requester cancels)
- Any active/committed state ──► [EXPIRED] (Deadline passes without completion)
```

### 5.2 Donor Commitment Lifecycle

```text
  [MATCHED]
     │
     ▼ (Alert dispatched via Outbox)
  [NOTIFIED]
     │
     ▼ (Donor expresses availability)
 [INTERESTED]
     │
     ▼ (Requester/Coordinator accepts donor)
 [CONFIRMED]
     │
     ▼ (Appointment scheduled at affiliated hospital)
 [SCHEDULED]
     │
     ▼ (Physical arrival verified by hospital staff)
 [CHECKED_IN]
     │
     ▼ (Phlebotomy begins)
[DONATION_IN_PROGRESS]
     │
     ▼ (Volume & unit recorded by clinical staff)
[DONATION_RECORDED]
     │
     ▼ (Final completion sync)
 [COMPLETED] (Terminal Success)

Exception Transitions:
- [NOTIFIED] / [INTERESTED] ──► [DECLINED] (Donor declines or coordinator rejects)
- [CONFIRMED] / [SCHEDULED] ──► [CANCELLED] (Cancelled prior to appointment)
- [SCHEDULED] ───────────────► [NO_SHOW] (Donor fails to arrive; unit released)
- [MATCHED] / [NOTIFIED] ────► [EXPIRED] (Request fulfilled or window closes)
```

### 5.3 Donation Operations Separation
Clinical operations enforce strict temporal boundaries:
1. **Commitment:** Legal/logistical intent by a voluntary donor.
2. **Appointment:** Mutually scheduled date/time at a verified hospital.
3. **Physical Check-in:** In-person biometric/ID verification by clinical hospital staff.
4. **Blood Draw:** Clinical phlebotomy procedure (`DONATION_IN_PROGRESS`).
5. **Donation Recording:** Staff records draw volume, component type, and timestamp.
6. **Completion:** State transitions to `COMPLETED`, fulfilling the request counter.

---

## 6. SECURITY & DATA PRIVACY INVARIANTS

### 6.1 Private Medical Document Storage
- Doctor requisitions and prescriptions MUST be stored in the private bucket: `medical_prescriptions` (or `medical-prescriptions`).
- The bucket MUST have `public = false`.
- Direct public URLs are strictly forbidden. Access is provided exclusively through time-limited (max 300s) cryptographic signed URLs generated server-side.
- Access is restricted to:
  1. The original uploader (Requester).
  2. Authorized clinical staff affiliated with the designated hospital.
  3. Platform Medical Reviewers / Admins.
- Donors and unrelated public users have ZERO read or write access to medical documents.

### 6.2 Immutable Audit Trail
- All clinical state changes, medical reviews, check-ins, cancellations, and status overrides MUST emit an entry to `public.audit_logs`.
- PostgreSQL rules and triggers strictly prohibit `UPDATE` and `DELETE` operations on `public.audit_logs`:
  ```sql
  CREATE RULE no_update_audit_logs AS ON UPDATE TO public.audit_logs DO INSTEAD NOTHING;
  CREATE RULE no_delete_audit_logs AS ON DELETE TO public.audit_logs DO INSTEAD NOTHING;
  ```

### 6.3 Durable Outbox & Notification Decoupling
- Notifications MUST NOT be dispatched synchronously inside business database transactions.
- Actions insert pending events into `public.notification_events` within the database transaction.
- Outbox workers process events asynchronously with idempotency keys, automatic retries with exponential backoff, and dead-letter queue handling.

---

## 7. AGENT OPERATING PROTOCOL

When executing tasks, the engineering agent must follow this 8-step discipline:

```text
1. UNDERSTAND: Fully parse the request, rules, and acceptance criteria.
2. INSPECT: Check git status, current code, database migrations, and active config.
3. CHALLENGE: Scrutinize assumptions, identify security risks, verify safety invariants.
4. PLAN: Structure the implementation steps with clear rollback boundaries.
5. IMPLEMENT: Make the minimal, surgical changes required. Never touch unrelated code.
6. VERIFY: Execute automated test suites, typechecks, lints, and live smoke tests.
7. REVIEW: Diff git changes; verify no secrets, debug code, or weakened RLS exist.
8. REPORT: Return concise, factual reports using exact status classifications.
```
