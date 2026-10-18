-- ==============================================================================
-- LIFE DROP: MILESTONE 7 — PLATFORM NOTIFICATION OUTBOX & RECONCILIATION
-- ==============================================================================

-- 1. EXTEND NOTIFICATION OUTBOX STATUS CONSTRAINT
ALTER TABLE public.notification_events 
  DROP CONSTRAINT IF EXISTS notification_events_status_check;

ALTER TABLE public.notification_events 
  ADD CONSTRAINT notification_events_status_check 
  CHECK (status IN ('PENDING', 'PROCESSING', 'DELIVERED', 'COMPLETED', 'RETRYABLE_FAILURE', 'PERMANENT_FAILURE', 'FAILED'));

-- 2. AUGMENT NOTIFICATION_EVENTS TABLE FOR DURABLE ATOMIC OUTBOX QUEUE
ALTER TABLE public.notification_events
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS recipient_user_id TEXT,
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'IN_APP',
  ADD COLUMN IF NOT EXISTS attempt_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ DEFAULT timezone('utc', now()),
  ADD COLUMN IF NOT EXISTS lease_token TEXT,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error_category TEXT,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now());

-- 3. OUTBOX QUEUE INDEXES FOR ULTRA-FAST JOB CLAIMING AND EXPIRATION RECOVERY
CREATE INDEX IF NOT EXISTS idx_notification_events_claim 
  ON public.notification_events (status, next_attempt_at) 
  WHERE status IN ('PENDING', 'RETRYABLE_FAILURE');

CREATE INDEX IF NOT EXISTS idx_notification_events_lease 
  ON public.notification_events (status, lease_expires_at) 
  WHERE status = 'PROCESSING';

CREATE INDEX IF NOT EXISTS idx_notification_events_recipient 
  ON public.notification_events (recipient_user_id);

CREATE INDEX IF NOT EXISTS idx_notification_events_idempotency 
  ON public.notification_events (idempotency_key) 
  WHERE idempotency_key IS NOT NULL;

-- 4. CONCURRENCY-SAFE ATOMIC WORKER CLAIM STORED PROCEDURE
CREATE OR REPLACE FUNCTION public.claim_outbox_jobs(
  p_batch_size INT DEFAULT 20,
  p_lease_seconds INT DEFAULT 60,
  p_worker_id TEXT DEFAULT 'worker-default'
)
RETURNS SETOF public.notification_events
LANGUAGE plpgsql
SECURITY DEFINER
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

-- 5. ATOMIC DISCREPANCY RECONCILIATION FOR REQUEST COUNTERS
CREATE OR REPLACE FUNCTION public.reconcile_request_counters(p_request_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
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
  -- Fetch current request counters
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

-- 6. ROW-LEVEL SECURITY POLICIES FOR ADMIN OVERSIGHT
ALTER TABLE public.notification_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authorized staff view notification outbox" ON public.notification_events;
CREATE POLICY "Authorized staff view notification outbox" ON public.notification_events
  FOR SELECT USING (public.is_moderator_or_admin());
