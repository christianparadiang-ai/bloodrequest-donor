# Life Drop: Deterministic Migration Execution Order

When deploying to a fresh PostgreSQL / Supabase cluster, migrations **MUST** be executed in the following strict sequential dependency order:

| Step | Migration File | Milestone | Description |
| :---: | :--- | :---: | :--- |
| **01** | `20261007_init_lifedrop_schema.sql` | 2A | Schema enums, `profiles`, `donors`, `blood_requests`, `donor_commitments`, `audit_logs`, baseline RLS. |
| **02** | `20261007_enhanced_rls_and_atomic_commitment.sql` | 2A | Atomic `commit_donor_to_request_atomic()` function, strict reservation counters. |
| **03** | `20261007_verification_documents_and_storage.sql` | 2B | `verification_documents` table, private `medical_prescriptions` storage bucket and RLS policies. |
| **04** | `20261007_donor_coordination_and_commitments.sql` | 2C | Donor coordination state transitions, `express_donor_interest_atomic()`, `confirm_donor_commitment_atomic()`, `record_donation_atomic()`. |
| **05** | `20261007_notifications_and_outbox.sql` | 2D | Durable outbox `notification_events`, `notifications` table, delivery preferences, RLS. |
| **06** | `20261007_donation_operations_and_checkin.sql` | 2E | Enum additions (`CHECKED_IN`, `DONATION_IN_PROGRESS`, `NO_SHOW`), clinical check-in & no-show atomic functions. |
| **07** | `20261007_production_hardening.sql` | 2F | `SET search_path = public, pg_temp;` hardening, webhook replay protection, performance indexes, immutable audit trigger. |

### Rollback Limitations & Caution
- **Enums**: PostgreSQL does not support dropping individual enum values (`ALTER TYPE ... DROP VALUE`). Rollback requires dropping the dependent tables or rebuilding the cluster.
- **Audit Logs**: The table is protected by `trg_audit_logs_immutable`. No updates or deletions can occur.
- **Storage**: Medical prescriptions bucket must not be deleted while verified documents exist.
