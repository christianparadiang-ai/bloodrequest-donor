-- ==============================================================================
-- LIFE DROP: MILESTONE 2F — PRODUCTION HARDENING & SECURITY MIGRATION
-- ==============================================================================

-- 1. HARDEN SECURITY DEFINER SEARCH PATHS (PREVENT SEARCH_PATH HIJACKING)
CREATE OR REPLACE FUNCTION public.current_profile_id()
RETURNS UUID AS $$
  SELECT id FROM public.profiles WHERE clerk_user_id = auth.jwt()->>'sub' LIMIT 1;
$$ LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.is_moderator_or_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = public.current_profile_id()
      AND role IN ('MODERATOR', 'ADMIN', 'SUPER_ADMIN')
  );
$$ LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.is_affiliated_hospital_staff(p_request_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.blood_requests r ON r.id = p_request_id
    WHERE p.id = public.current_profile_id()
      AND p.role = 'HOSPITAL_STAFF'
      AND LOWER(TRIM(p.hospital_affiliation)) = LOWER(TRIM(r.hospital_name))
  );
$$ LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public, pg_temp;

-- 2. IDEMPOTENT WEBHOOK LOGGING TABLE (REPLAY ATTACK PREVENTION)
CREATE TABLE IF NOT EXISTS public.processed_webhooks (
  id TEXT PRIMARY KEY, -- Svix message ID
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.processed_webhooks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages processed webhooks" ON public.processed_webhooks;
CREATE POLICY "Service role manages processed webhooks" ON public.processed_webhooks
  FOR ALL USING (auth.role() = 'service_role');

-- 3. CRITICAL PERFORMANCE & QUEUE INDEXES
CREATE INDEX IF NOT EXISTS idx_commitments_hospital_queue
  ON public.donor_commitments (status, scheduled_at)
  WHERE status IN ('SCHEDULED', 'CHECKED_IN', 'DONATION_IN_PROGRESS', 'DONATION_RECORDED');

CREATE INDEX IF NOT EXISTS idx_requests_active_discovery
  ON public.blood_requests (status, blood_group, rh_factor)
  WHERE status IN ('ACTIVE', 'PARTIALLY_COMMITTED');

CREATE INDEX IF NOT EXISTS idx_verification_docs_review_queue
  ON public.verification_documents (status, created_at)
  WHERE status = 'PENDING_REVIEW';

-- 4. IMMUTABILITY AUDIT LOG TRIGGER
-- Ensures audit logs can never be altered or deleted, even by application services
CREATE OR REPLACE FUNCTION public.prevent_audit_log_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit logs are strictly immutable and cannot be updated or deleted.';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_audit_logs_immutable ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_immutable
  BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_audit_log_modification();
