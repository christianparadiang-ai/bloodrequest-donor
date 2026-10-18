-- ==============================================================================
-- LIFE DROP: MILESTONE 8 — PRODUCTION SECURITY HARDENING & RLS VERIFICATION
-- ==============================================================================

-- 1. HARDEN STORED PROCEDURES WITH RESTRICTED EXECUTION & SAFE SEARCH PATHS
-- Prevents unauthorized RPC execution and search_path hijacking vulnerabilities.

CREATE OR REPLACE FUNCTION public.claim_outbox_jobs(
  p_batch_size INT DEFAULT 20,
  p_lease_seconds INT DEFAULT 60,
  p_worker_id TEXT DEFAULT 'worker-default'
)
RETURNS SETOF public.notification_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  WITH claimable AS (
    SELECT id
    FROM public.notification_events
    WHERE (
      (status IN ('PENDING', 'RETRYABLE_FAILURE') AND (next_attempt_at IS NULL OR next_attempt_at <= timezone('utc', now())))
      OR
      (status = 'PROCESSING' AND lease_expires_at IS NOT NULL AND lease_expires_at <= timezone('utc', now()))
    )
    ORDER BY created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT p_batch_size
  )
  UPDATE public.notification_events e
  SET
    status = 'PROCESSING',
    lease_token = p_worker_id,
    lease_expires_at = timezone('utc', now()) + (p_lease_seconds || ' seconds')::interval,
    attempt_count = e.attempt_count + 1,
    retry_count = e.retry_count + 1,
    updated_at = timezone('utc', now())
  FROM claimable
  WHERE e.id = claimable.id
  RETURNING e.*;
END;
$$;

-- Restrict claim_outbox_jobs execution strictly to privileged server-side service role
REVOKE ALL ON FUNCTION public.claim_outbox_jobs(INT, INT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_outbox_jobs(INT, INT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.claim_outbox_jobs(INT, INT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_outbox_jobs(INT, INT, TEXT) TO service_role;

-- 2. HARDEN ATOMIC COUNTER RECONCILIATION FUNCTION
CREATE OR REPLACE FUNCTION public.reconcile_request_counters(p_request_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_committed INT := 0;
  v_donated INT := 0;
  v_requested INT := 0;
  v_current_committed INT := 0;
  v_current_donated INT := 0;
  v_current_status public.request_status_type;
  v_new_status public.request_status_type;
  v_discrepancy BOOLEAN := false;
BEGIN
  -- Fetch current request counters with pessimistic lock
  SELECT units_requested, units_committed, units_donated, status
  INTO v_requested, v_current_committed, v_current_donated, v_current_status
  FROM public.blood_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request not found');
  END IF;

  -- Authoritative count of active commitments (1 unit each)
  SELECT COUNT(*)
  INTO v_committed
  FROM public.donor_commitments
  WHERE request_id = p_request_id
    AND status IN ('ACCEPTED', 'SCHEDULED', 'CHECKED_IN');

  -- Authoritative count of recorded donation units
  SELECT COALESCE(SUM(units_donated), 0)
  INTO v_donated
  FROM public.donations
  WHERE request_id = p_request_id
    AND status = 'RECORDED';

  -- Check if discrepancy exists
  IF v_current_committed != v_committed OR v_current_donated != v_donated THEN
    v_discrepancy := true;
  END IF;

  v_new_status := v_current_status;

  -- If authoritative recorded donations meet or exceed requested quota and not terminal
  IF v_donated >= v_requested AND v_current_status NOT IN ('CANCELLED', 'EXPIRED', 'REJECTED') THEN
    v_new_status := 'FULFILLED';
  END IF;

  IF v_discrepancy OR v_new_status != v_current_status THEN
    UPDATE public.blood_requests
    SET
      units_committed = v_committed,
      units_donated = v_donated,
      status = v_new_status,
      updated_at = timezone('utc', now())
    WHERE id = p_request_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'requestId', p_request_id,
    'discrepancyFound', v_discrepancy,
    'previousCommitted', v_current_committed,
    'newCommitted', v_committed,
    'previousDonated', v_current_donated,
    'newDonated', v_donated,
    'previousStatus', v_current_status,
    'newStatus', v_new_status
  );
END;
$$;

-- Restrict reconcile_request_counters execution
REVOKE ALL ON FUNCTION public.reconcile_request_counters(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconcile_request_counters(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.reconcile_request_counters(UUID) TO service_role;

-- 3. ENSURE ROW-LEVEL SECURITY IS ACTIVATED ON ALL PUBLIC TABLES
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blood_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.donor_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.request_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.donor_commitments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.donations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verification_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processed_webhooks ENABLE ROW LEVEL SECURITY;

-- 4. HARDEN AUDIT LOG IMMUTABILITY TRIGGER
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
