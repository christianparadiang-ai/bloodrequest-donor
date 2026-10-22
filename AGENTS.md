# LIFE DROP — AGENT AUTONOMY & OPERATIONAL WORKFLOWS (`AGENTS.md`)

This file governs autonomous agent behavior, environment configurations, and verification routines for the **Life Drop — Blood Request and Donor System**.

---

## 1. Environment & Infrastructure Invariants

- **Active Staging Supabase Project Ref:** `vblfkcyeefiwhhpbwxhr`
- **Active Staging Supabase URL:** `https://vblfkcyeefiwhhpbwxhr.supabase.co`
- **Node Binary Location:** `/Users/Kylabels/.local/node/bin`
  - Always prefix shell execution with:
    ```bash
    export PATH="$HOME/.local/node/bin:/usr/bin:/bin:$PATH"
    ```
- **Database Migrations Catalog:**
  - Migrations 1 through 16 are fully applied, verified, and active in `public._schema_migrations`.
  - Migration 16 (`20261020_milestone9_donor_points_and_reporting.sql`) established:
    - `public.points_config` (Default 100 points/donation, 4 recognition tiers: Bronze 100, Silver 300, Gold 600, Platinum 1000).
    - `public.donor_points_transactions` (Auditable ledger with exact-once constraint on `(donation_id)` WHERE `transaction_type = 'DONATION_COMPLETED'`).
    - Reporting performance indexes on `blood_requests`, `donations`, and `donor_profiles`.

---

## 2. Autonomous Verification Command Suite

Whenever verification is requested, run the following automated suites in sequence without blocking on manual prompts:

```bash
export PATH="$HOME/.local/node/bin:/usr/bin:/bin:$PATH"

# 1. Static type safety and code quality
npm run lint
npx tsc --noEmit

# 2. Points ledger and reporting calculations
npm run test:points-reports

# 3. Pre-deployment integrity and schema safety
npm run test:pre-deploy

# 4. Multi-role end-to-end integration test (exercising live staging tables)
npm run test:e2e

# 5. Remote 18-step staging smoke test
node scripts/staging-smoke-test.mjs

# 6. Offline recovery simulator
node scripts/test-offline-recovery.mjs

# 7. Production bundle compilation
npx next build
```

---

## 3. Strict Operating Rules

1. **Autonomous Execution:** Proactively diagnose, fix, and verify code and migrations. Never block or prompt the user for intermediate steps when execution can be performed autonomously.
2. **Zero Secrets in Code/Logs:** Never print, log, or commit secret keys or tokens (`SUPABASE_SERVICE_ROLE_KEY`, `CLERK_SECRET_KEY`, etc.).
3. **Data Protection:** Never run destructive SQL (`DROP TABLE`, `DROP COLUMN`) against staging or production databases.
