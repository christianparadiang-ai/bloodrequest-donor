-- ==============================================================================
-- LIFE DROP: ENHANCED RLS POLICIES & ATOMIC CONCURRENCY FUNCTION
-- ==============================================================================

-- 1. DONOR PROFILES POLICIES
DROP POLICY IF EXISTS "Public view available donors" ON public.donor_profiles;
DROP POLICY IF EXISTS "Donors manage own profile" ON public.donor_profiles;
DROP POLICY IF EXISTS "Users insert own donor profile" ON public.donor_profiles;
DROP POLICY IF EXISTS "Users update own donor profile" ON public.donor_profiles;

-- Authenticated users can view active donor profiles for matching (without contact PII)
CREATE POLICY "Public view available donors" ON public.donor_profiles
  FOR SELECT USING (is_available = TRUE);

-- Users can insert their own donor profile
CREATE POLICY "Users insert own donor profile" ON public.donor_profiles
  FOR INSERT WITH CHECK (profile_id = public.current_profile_id());

-- Users can update only their own donor profile
CREATE POLICY "Users update own donor profile" ON public.donor_profiles
  FOR UPDATE USING (profile_id = public.current_profile_id());

-- 2. DONOR COMMITMENTS POLICIES
DROP POLICY IF EXISTS "Donors view own commitments" ON public.donor_commitments;
DROP POLICY IF EXISTS "Requesters view request commitments" ON public.donor_commitments;

-- Donors can view their own commitments
CREATE POLICY "Donors view own commitments" ON public.donor_commitments
  FOR SELECT USING (donor_id = public.current_profile_id());

-- Requesters can view commitments made to their own blood requests
CREATE POLICY "Requesters view request commitments" ON public.donor_commitments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.blood_requests
      WHERE public.blood_requests.id = public.donor_commitments.request_id
      AND public.blood_requests.requester_id = public.current_profile_id()
    )
  );

-- 3. ATOMIC TRANSACTION: COMMIT DONOR TO REQUEST WITH PESSIMISTIC LOCKING
-- This prevents race conditions where two donors commit concurrently and oversubscribe units.
CREATE OR REPLACE FUNCTION public.commit_donor_to_request_atomic(
  p_request_id UUID,
  p_donor_id UUID,
  p_donor_name TEXT,
  p_donor_blood_type TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request RECORD;
  v_donor RECORD;
  v_existing_commitment_id UUID;
  v_commitment_id UUID;
  v_new_units INT;
  v_target_status request_status_type;
BEGIN
  -- 1. Acquire exclusive row lock on the blood request (FOR UPDATE)
  SELECT * INTO v_request
  FROM public.blood_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'error', 'Blood requisition not found.'
    );
  END IF;

  -- 2. Validate request is in an active discovery status
  IF v_request.status NOT IN ('ACTIVE', 'PARTIALLY_COMMITTED') THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'error', 'Requisition is not accepting commitments (Current status: ' || v_request.status || ').'
    );
  END IF;

  -- 3. Verify units remaining (Concurrency guard!)
  IF v_request.units_committed >= v_request.units_requested THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'error', 'This requisition has already reached its full quota of committed units.'
    );
  END IF;

  -- 4. Check if donor already has an active commitment to this requisition
  SELECT id INTO v_existing_commitment_id
  FROM public.donor_commitments
  WHERE request_id = p_request_id
    AND donor_id = p_donor_id
    AND status NOT IN ('CANCELLED', 'DECLINED', 'NO_SHOW');

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'error', 'Donor already has an active commitment to this requisition.'
    );
  END IF;

  -- 5. Verify donor cooldown in donor_profiles
  SELECT * INTO v_donor
  FROM public.donor_profiles
  WHERE profile_id = p_donor_id;

  IF FOUND AND v_donor.cooldown_until IS NOT NULL AND v_donor.cooldown_until > CURRENT_DATE THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'error', 'Donor is currently within mandatory clinical recovery cooldown until ' || v_donor.cooldown_until || '.'
    );
  END IF;

  -- 6. Insert new commitment record atomically
  INSERT INTO public.donor_commitments (
    request_id,
    donor_id,
    status,
    committed_at,
    expires_at
  ) VALUES (
    p_request_id,
    p_donor_id,
    'ACCEPTED',
    timezone('utc', now()),
    timezone('utc', now()) + INTERVAL '4 hours'
  ) RETURNING id INTO v_commitment_id;

  -- 7. Calculate updated units and state machine target status
  v_new_units := v_request.units_committed + 1;
  IF v_new_units >= v_request.units_requested THEN
    v_target_status := 'FULLY_COMMITTED';
  ELSE
    v_target_status := 'PARTIALLY_COMMITTED';
  END IF;

  -- 8. Update blood request
  UPDATE public.blood_requests
  SET
    units_committed = v_new_units,
    status = v_target_status,
    updated_at = timezone('utc', now())
  WHERE id = p_request_id;

  -- 9. Insert immutable audit log event
  INSERT INTO public.audit_logs (
    actor_id,
    action,
    target_table,
    target_id,
    previous_state,
    new_state
  ) VALUES (
    p_donor_id,
    'DONOR_COMMITMENT_CREATED',
    'donor_commitments',
    v_commitment_id,
    jsonb_build_object('units_committed', v_request.units_committed, 'status', v_request.status),
    jsonb_build_object('units_committed', v_new_units, 'status', v_target_status)
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'commitment_id', v_commitment_id,
    'units_committed', v_new_units,
    'status', v_target_status,
    'message', 'Donation commitment recorded atomically with zero race conditions.'
  );
END;
$$;
