-- ==============================================================================
-- LIFE DROP: MILESTONE 2E — DONATION SCHEDULING, HOSPITAL CHECK-IN & DONATION COMPLETION
-- ==============================================================================

-- 1. EXTEND COMMITMENT STATUS ENUM
ALTER TYPE public.commitment_status_type ADD VALUE IF NOT EXISTS 'CHECKED_IN';
ALTER TYPE public.commitment_status_type ADD VALUE IF NOT EXISTS 'DONATION_IN_PROGRESS';
ALTER TYPE public.commitment_status_type ADD VALUE IF NOT EXISTS 'NO_SHOW';

-- 2. AUGMENT DONOR COMMITMENTS TABLE FOR CLINICAL AUDIT TRAIL
ALTER TABLE public.donor_commitments
  ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS checked_in_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS check_in_notes TEXT,
  ADD COLUMN IF NOT EXISTS donation_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS donation_recorded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recorded_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS units_donated INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS no_show_recorded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS no_show_recorded_by UUID REFERENCES public.profiles(id);

-- 3. INDEXES FOR HOSPITAL OPERATIONS PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_commitments_hospital_status
  ON public.donor_commitments(status, scheduled_at);

CREATE INDEX IF NOT EXISTS idx_commitments_scheduled_date
  ON public.donor_commitments(scheduled_at)
  WHERE status IN ('SCHEDULED', 'CHECKED_IN', 'DONATION_IN_PROGRESS');

-- 4. ATOMIC PROCEDURE: CHECK IN DONOR AT HOSPITAL
CREATE OR REPLACE FUNCTION public.check_in_donor_atomic(
  p_commitment_id UUID,
  p_actor_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_commitment RECORD;
  v_request RECORD;
  v_actor_profile RECORD;
BEGIN
  -- 1. Lock commitment
  SELECT * INTO v_commitment
  FROM public.donor_commitments
  WHERE id = p_commitment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Commitment record not found.');
  END IF;

  -- 2. State validation: Must be SCHEDULED
  IF v_commitment.status != 'SCHEDULED' THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'error', 'Cannot check in donor: Commitment is in status ' || v_commitment.status || '. Only SCHEDULED donors can be checked in.'
    );
  END IF;

  -- 3. Retrieve requisition
  SELECT * INTO v_request
  FROM public.blood_requests
  WHERE id = v_commitment.request_id;

  -- 4. Authorization & Scope check
  SELECT * INTO v_actor_profile
  FROM public.profiles
  WHERE id = p_actor_id;

  IF NOT FOUND OR v_actor_profile.role NOT IN ('HOSPITAL_STAFF', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN') THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Unauthorized: Only clinical hospital staff can check in arriving donors.');
  END IF;

  -- Verify hospital affiliation for HOSPITAL_STAFF
  IF v_actor_profile.role = 'HOSPITAL_STAFF' AND v_actor_profile.hospital_affiliation IS NOT NULL THEN
    IF LOWER(TRIM(v_request.hospital_name)) NOT LIKE '%' || LOWER(TRIM(v_actor_profile.hospital_affiliation)) || '%'
       AND LOWER(TRIM(v_actor_profile.hospital_affiliation)) NOT LIKE '%' || LOWER(TRIM(v_request.hospital_name)) || '%' THEN
      RETURN jsonb_build_object(
        'success', FALSE,
        'error', 'Hospital Staff scope violation: Staff member is not affiliated with ' || v_request.hospital_name
      );
    END IF;
  END IF;

  -- 5. Transition to CHECKED_IN
  UPDATE public.donor_commitments
  SET
    status = 'CHECKED_IN',
    checked_in_at = timezone('utc', now()),
    checked_in_by = p_actor_id,
    check_in_notes = p_notes
  WHERE id = p_commitment_id;

  -- 6. Audit Log
  INSERT INTO public.audit_logs (
    actor_id,
    action,
    target_table,
    target_id,
    previous_state,
    new_state
  ) VALUES (
    p_actor_id,
    'DONOR_CHECKED_IN',
    'donor_commitments',
    p_commitment_id,
    jsonb_build_object('status', 'SCHEDULED'),
    jsonb_build_object('status', 'CHECKED_IN', 'checked_in_at', now(), 'notes', p_notes)
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'commitment_id', p_commitment_id,
    'status', 'CHECKED_IN'
  );
END;
$$;

-- 5. ATOMIC PROCEDURE: START DONATION IN PROGRESS
CREATE OR REPLACE FUNCTION public.start_donation_atomic(
  p_commitment_id UUID,
  p_actor_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_commitment RECORD;
  v_actor_profile RECORD;
BEGIN
  SELECT * INTO v_commitment
  FROM public.donor_commitments
  WHERE id = p_commitment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Commitment not found.');
  END IF;

  IF v_commitment.status != 'CHECKED_IN' THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'error', 'Cannot start draw: Donor must be in CHECKED_IN status (Current: ' || v_commitment.status || ').'
    );
  END IF;

  SELECT * INTO v_actor_profile
  FROM public.profiles
  WHERE id = p_actor_id;

  IF NOT FOUND OR v_actor_profile.role NOT IN ('HOSPITAL_STAFF', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN') THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Unauthorized: Only clinical personnel can start donation draws.');
  END IF;

  UPDATE public.donor_commitments
  SET
    status = 'DONATION_IN_PROGRESS',
    donation_started_at = timezone('utc', now())
  WHERE id = p_commitment_id;

  INSERT INTO public.audit_logs (
    actor_id,
    action,
    target_table,
    target_id,
    previous_state,
    new_state
  ) VALUES (
    p_actor_id,
    'DONATION_IN_PROGRESS',
    'donor_commitments',
    p_commitment_id,
    jsonb_build_object('status', 'CHECKED_IN'),
    jsonb_build_object('status', 'DONATION_IN_PROGRESS', 'started_at', now())
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'commitment_id', p_commitment_id,
    'status', 'DONATION_IN_PROGRESS'
  );
END;
$$;

-- 6. ATOMIC PROCEDURE: MARK DONOR NO-SHOW
CREATE OR REPLACE FUNCTION public.mark_no_show_atomic(
  p_commitment_id UUID,
  p_actor_id UUID,
  p_reason TEXT DEFAULT 'Did not appear for scheduled donation appointment.'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_commitment RECORD;
  v_request RECORD;
  v_actor_profile RECORD;
  v_new_reserved INT;
  v_new_committed INT;
  v_new_status request_status_type;
BEGIN
  -- 1. Lock commitment
  SELECT * INTO v_commitment
  FROM public.donor_commitments
  WHERE id = p_commitment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Commitment not found.');
  END IF;

  IF v_commitment.status NOT IN ('SCHEDULED', 'CONFIRMED') THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'error', 'Cannot mark no-show: Commitment is in status ' || v_commitment.status
    );
  END IF;

  -- 2. Authorization check
  SELECT * INTO v_actor_profile
  FROM public.profiles
  WHERE id = p_actor_id;

  IF NOT FOUND OR v_actor_profile.role NOT IN ('HOSPITAL_STAFF', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN') THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Unauthorized: Only authorized hospital staff can record no-show.');
  END IF;

  -- 3. Lock request to release reserved unit
  SELECT * INTO v_request
  FROM public.blood_requests
  WHERE id = v_commitment.request_id
  FOR UPDATE;

  v_new_reserved := GREATEST(0, v_request.units_reserved - 1);
  v_new_committed := GREATEST(0, v_request.units_committed - 1);

  IF v_new_committed = 0 THEN
    v_new_status := 'ACTIVE';
  ELSE
    v_new_status := 'PARTIALLY_COMMITTED';
  END IF;

  -- 4. Update commitment
  UPDATE public.donor_commitments
  SET
    status = 'NO_SHOW',
    no_show_recorded_at = timezone('utc', now()),
    no_show_recorded_by = p_actor_id,
    cancellation_reason = p_reason
  WHERE id = p_commitment_id;

  -- 5. Update request
  UPDATE public.blood_requests
  SET
    units_reserved = v_new_reserved,
    units_committed = v_new_committed,
    status = v_new_status,
    updated_at = timezone('utc', now())
  WHERE id = v_request.id;

  -- 6. Audit log
  INSERT INTO public.audit_logs (
    actor_id,
    action,
    target_table,
    target_id,
    previous_state,
    new_state
  ) VALUES (
    p_actor_id,
    'DONATION_NO_SHOW',
    'donor_commitments',
    p_commitment_id,
    jsonb_build_object('status', v_commitment.status),
    jsonb_build_object('status', 'NO_SHOW', 'reason', p_reason, 'units_reserved', v_new_reserved)
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'commitment_id', p_commitment_id,
    'status', 'NO_SHOW',
    'request_status', v_new_status,
    'units_reserved', v_new_reserved
  );
END;
$$;
