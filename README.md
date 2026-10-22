# 🩸 Life Drop — Voluntary Blood Request & Donor Coordination System

> **A mission-critical coordination network connecting urgent patient blood requests with compatible local voluntary donors in minutes.**

[![TypeScript Strict](https://img.shields.io/badge/TypeScript-Strict-blue.svg)](https://www.typescriptlang.org/)
[![Next.js 15](https://img.shields.io/badge/Next.js-15%20App%20Router-black.svg)](https://nextjs.org/)
[![Supabase Database](https://img.shields.io/badge/Supabase-PostgreSQL%2016-green.svg)](https://supabase.com/)
[![Clerk Authentication](https://img.shields.io/badge/Clerk-Authentication-6C47FF.svg)](https://clerk.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## ⚠️ Essential Medical & Domain Boundaries

**Life Drop is NOT a hospital, blood bank, or replacement for licensed clinical healthcare providers.**

- **Voluntary Logistics Only:** Life Drop coordinates communication, blood compatibility discovery, and commitment tracking between requesters and voluntary donors.
- **Clinical Verification:** Medical eligibility assessment, laboratory cross-matching, clinical blood draws, infectious disease screening, and transfusions are conducted **strictly and exclusively** by qualified medical personnel at licensed clinical facilities.
- **Voluntary & Unpaid:** Life Drop strictly upholds international voluntary, unpaid blood donation standards. Points and recognition tiers are non-monetary and convey no financial value, clinical priority, or commercial benefit.

---

## 🌟 Key System Capabilities

### 1. Requisition Lifecycle & Verification Queue
- Requisitions transition through an immutable state machine: `SUBMITTED ➔ UNDER_REVIEW ➔ ACTIVE ➔ PARTIALLY_COMMITTED ➔ FULLY_COMMITTED ➔ FULFILLED`.
- Terminal states (`CANCELLED`, `EXPIRED`, `REJECTED`) reject subsequent mutations.
- Clinical review gate: Hospital staff or moderators must verify prescriptions before requisitions become active for donor discovery.

### 2. Intelligent Matching Engine
- Multi-factor compatibility calculation: ABO/Rh blood group matrix matching, geographic proximity calculation (Haversine formula), and donor eligibility intervals (56 days for whole blood).
- Privacy-preserving contact masking prevents unsolicited outreach until a clinical appointment is scheduled.

### 3. Multi-Role Access Control (RBAC + RLS)
- Five distinct personas enforced in Next.js Server Actions and PostgreSQL Row Level Security:
  1. `DONOR` — Manages voluntary donor profile, availability, commitment schedules, and views non-monetary points.
  2. `USER` (Requester) — Submits requisitions, uploads medical prescriptions, tracks commitments.
  3. `HOSPITAL_STAFF` — Reviews requisitions, manages hospital queues, conducts phlebotomy check-ins, records blood draws.
  4. `MODERATOR` — Audits requests, reviews prescription uploads, moderates flagged content.
  5. `ADMIN` / `SUPER_ADMIN` — System-wide analytics, points ledger adjustments, audit trail monitoring.

### 4. Non-Monetary Donor Recognition & Points Ledger
- Configurable points policies (`points_config`) with 4 distinct donor recognition tiers:
  - 🥉 **Bronze Life Donor** (100 pts)
  - 🥈 **Silver Life Donor** (300 pts)
  - 🥇 **Gold Life Donor** (600 pts)
  - 💎 **Platinum Life Donor** (1,000 pts)
- Auditable transaction ledger (`donor_points_transactions`) with database-enforced exact-once constraint on `(donation_id)` for `DONATION_COMPLETED`.
- Prevents double-awarding via PostgreSQL unique partial index.

### 5. Durable Notification Outbox & Offline Sync
- Outbox pattern ensures transactional durability: notification events are queued atomically with database state changes.
- Periodic workers dispatch via Webhooks, in-app notifications, SMS, and email.
- Progressive Web App (PWA) client with offline mutation queue and automatic background sync upon network reconnection.

### 6. Hospital Analytics & Secure CSV Exports
- Comprehensive operational reports: Blood inventory, donation frequency, hospital fulfillment velocity, and donor tier breakdown.
- Multi-interval reporting: Day, Week (ISO Monday–Sunday), Month, Year, and Custom Date Ranges.
- Formula injection protection: Sanitizes cells starting with `=, +, -, @, \t, \r` with RFC 4180 escaping and UTF-8 BOM encoding.

---

## 🏗️ Technology Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Next.js 15 (App Router)                   │
│   React 19 Server Components • TailwindCSS • shadcn/ui       │
├──────────────────────────────────────────────────────────────┤
│                     Identity & Security                      │
│   Clerk Auth • JWT Session Verification • Svix Webhooks      │
├──────────────────────────────────────────────────────────────┤
│                     Data & Ledger Layer                      │
│   Supabase PostgreSQL • Row Level Security • Atomic RPCs     │
│   Private Storage Buckets • Outbox Workers • Audit Logs      │
└──────────────────────────────────────────────────────────────┘
```

---

## 🗄️ Database Migrations

The database schema is cataloged into 16 chronologically ordered migrations in `supabase/migrations/`:

| # | Migration | Core Tables & Objectives |
|:---|:---|:---|
| 01 | `20261007_init_lifedrop_schema.sql` | Core schema: `profiles`, `blood_requests`, `donations`, `audit_logs` |
| 02 | `20261007_enhanced_rls_and_atomic_commitment.sql` | Atomic commitment locks, `current_profile_id()` helper |
| 03 | `20261007_verification_documents_and_storage.sql` | `medical_prescriptions` table and private storage bucket |
| 04 | `20261007_donor_coordination_and_commitments.sql` | `donor_commitments`, `request_matches`, fulfillment sync |
| 05 | `20261007_notifications_and_outbox.sql` | `notification_events` transactional outbox |
| 06 | `20261007_donation_operations_and_checkin.sql` | Hospital queue visibility, check-in, phlebotomy verification |
| 07 | `20261007_production_hardening.sql` | Invariant checks, immutable audit logging triggers |
| 08–15 | `20261008_milestone1` through `milestone8` | Matching engine, status transitions, reconciliation workers |
| 16 | `20261020_milestone9_donor_points_and_reporting.sql` | `points_config`, `donor_points_transactions`, reporting indexes |

---

## 🚀 Getting Started

### Prerequisites
- **Node.js** >= 20.18.0
- **npm** >= 10.8.0
- Dedicated **Supabase** Project
- Dedicated **Clerk** Application

### Environment Configuration
Copy `.env.staging.example` to `.env.local`:
```bash
cp .env.staging.example .env.local
```

Fill in your staging credentials:
```env
# Application
NEXT_PUBLIC_APP_ENV=staging

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>

# Clerk Authentication
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_<your-publishable-key>
CLERK_SECRET_KEY=sk_test_<your-secret-key>
CLERK_WEBHOOK_SECRET=whsec_<your-webhook-secret>
```

### Running Locally
```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000) to view the application.

---

## 🧪 Comprehensive Verification Suite

Execute the automated test suites:

```bash
# 1. Code quality and type safety
npm run lint
npx tsc --noEmit

# 2. Points ledger and reporting calculations (21 tests)
npm run test:points-reports

# 3. Pre-deployment integrity and schema safety (41 tests)
npm run test:pre-deploy

# 4. Multi-role end-to-end integration test (24 tests)
npm run test:e2e

# 5. Remote staging smoke test walkthrough (18 steps)
node scripts/staging-smoke-test.mjs

# 6. Offline recovery simulator (11 tests)
node scripts/test-offline-recovery.mjs

# 7. Production Next.js build compilation
npx next build
```

---

## 📄 License

This project is open source and available under the [MIT License](LICENSE).
