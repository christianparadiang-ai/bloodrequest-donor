               -- ==============================================================================
-- LIFE DROP: MILESTONE 2C — DONOR COORDINATION & COMMITMENT WORKFLOW
-- ==============================================================================

-- 1. EXTEND COMMITMENT STATUS ENUM
DO $$ BEGIN
  ALTER TYPE public.commitment_status_type ADD VALUE IF NOT EXISTS 'INTERESTED';
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TYPE public.commitment_status_type ADD VALUE IF NOT EXISTS 'CONFIRMED';
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TYPE public.commitment_status_type ADD VALUE IF NOT EXISTS 'SCHEDULED';
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TYPE public.commitment_status_type ADD VALUE IF NOT EXISTS 'DONATION_RECORDED';
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TYPE public.commitment_status_type ADD VALUE IF NOT EXISTS 'COMPLETED';
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 2. EXTEND REQUEST STATUS ENUM
DO $$ BEGIN
  ALTER TYPE public.request_status_type ADD VALUE IF NOT EXISTS 'PARTIALLY_FULFILLED';
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 3. SCHEMA AUGMENTATIONS FOR FULFILLMENT TRACKING
ALTER TABLE public.blood_requests 
  ADD COLUMN IF NOT EXISTS units_reserved INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS units_donated INT NOT NULL DEFAULT 0;

ALTER TABLE public.donor_commitments
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- 4. CONSTRAINTS
ALTER TABLE public.blood_requests
  DROP CONSTRAINT IF EXISTS check_units_fulfillment_balance;

ALTER TABLE public.blood_requests
  ADD CONSTRAINT check_units_fulfillment_balance
  CHECK (units_donated >= 0 AND units_reserved >= 0 AND (units_donated + units_reserved) <= units_requested);

-- 5. ATOMIC STORED PROCEDURE: EXPRESS DONOR INTEREST
-- Validates availability, active cooldown, verified requisition, and remaining units under row lock.
CREATE OR REPLACE FUNCTION public.express_donor_interest_atomic(
  p_request_id UUID,
  p_donor_id UUID
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
BEGIN
  -- 1. Acquire exclusive lock on the blood request
  SELECT * INTO v_request
  FROM public.blood_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Blood requisition not found.');
  END IF;

  -- 2. Validate request is ACTIVE
  IF v_request.status NOT IN ('ACTIVE', 'PARTIALLY_COMMITTED', 'PARTIALLY_FULFILLED') THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'error', 'Requisition is not accepting donor interest (Current status: ' || v_request.status || ').'
    );
  END IF;

  -- 3. Validate medical verification status is VERIFIED
  IF v_request.document_verification_status != 'VERIFIED' THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'error', 'Requisition has not completed mandatory medical prescription verification.'
    );
  END IF;

  -- 4. Verify units available
  IF (v_request.units_committed >= v_request.units_requested) THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'error', 'This requisition has already reached its full quota of committed units.'
    );
  END IF;

  -- 5. Check if donor already has an active commitment to this requisition
  SELECT id INTO v_existing_commitment_id
  FROM public.donor_commitments
  WHERE request_id = p_request_id
    AND donor_id = p_donor_id
    AND status NOT IN ('CANCELLED', 'DECLINED', 'NO_SHOW', 'EXPIRED');

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'error', 'Donor already has an active interest or commitment to this requisition.'
    );
  END IF;

  -- 6. Verify donor profile status & cooldown
  SELECT * INTO v_donor
  FROM public.donor_profiles
  WHERE profile_id = p_donor_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Donor profile not found.');
  END IF;

  IF v_donor.is_available = FALSE THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Donor readiness status is currently paused.');
  END IF;

  IF v_donor.cooldown_until IS NOT NULL AND v_donor.cooldown_until > CURRENT_DATE THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'error', 'Donor is currently within mandatory clinical recovery cooldown until ' || v_donor.cooldown_until || '.'
    );
  END IF;

  -- 7. Insert commitment record in INTERESTED status
  INSERT INTO public.donor_commitments (
    request_id,
    donor_id,
    status,
    committed_at,
    expires_at
  ) VALUES (
    p_request_id,
    p_donor_id,
    'INTERESTED',
    timezone('utc', now()),
    timezone('utc', now()) + INTERVAL '12 hours'
  ) RETURNING id INTO v_commitment_id;

  -- 8. Record audit log event
  INSERT INTO public.audit_logs (
    actor_id,
    action,
    target_table,
    target_id,
    new_state
  ) VALUES (
    p_donor_id,
    'DONOR_INTEREST_EXPRESSED',
    'donor_commitments',
    v_commitment_id,
    jsonb_build_object('request_id', p_request_id, 'status', 'INTERESTED')
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'commitment_id', v_commitment_id,
    'status', 'INTERESTED',
    'message', 'Your interest has been registered and transmitted to the requisition coordinator.'
  );
END;
$$;

-- 6. ATOMIC STORED PROCEDURE: CONFIRM DONOR COMMITMENT
-- Only requester or hospital staff can confirm. Locks request and reserves unit.
CREATE OR REPLACE FUNCTION public.confirm_donor_commitment_atomic(
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
  v_request RECORD;
  v_new_reserved INT;
  v_new_committed INT;
  v_target_status request_status_type;
BEGIN
  -- 1. Lock commitment
  SELECT * INTO v_commitment
  FROM public.donor_commitments
  WHERE id = p_commitment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Commitment record not found.');
  END IF;

  IF v_commitment.status != 'INTERESTED' THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'error', 'Commitment cannot be confirmed from status: ' || v_commitment.status
    );
  END IF;

  -- 2. Lock request
  SELECT * INTO v_request
  FROM public.blood_requests
  WHERE id = v_commitment.request_id
  FOR UPDATE;

  -- Authorization check: Actor must be requester or hospital staff/admin
  IF v_request.requester_id != p_actor_id AND NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = p_actor_id AND role IN ('HOSPITAL_STAFF', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN')
  ) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Unauthorized to confirm this donor commitment.');
  END IF;

  -- Check available quota
  IF (v_request.units_committed >= v_request.units_requested) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Requisition quota is already fulfilled.');
  END IF;

  -- Update commitment status to CONFIRMED
  UPDATE public.donor_commitments
  SET status = 'CONFIRMED'
  WHERE id = p_commitment_id;

  -- Increment reserved and committed units
  v_new_reserved := v_request.units_reserved + 1;
  v_new_committed := v_request.units_committed + 1;

  IF v_new_committed >= v_request.units_requested THEN
    v_target_status := 'FULLY_COMMITTED';
  ELSE
    v_target_status := 'PARTIALLY_COMMITTED';
  END IF;

  UPDATE public.blood_requests
  SET
    units_reserved = v_new_reserved,
    units_committed = v_new_committed,
    status = v_target_status,
    updated_at = timezone('utc', now())
  WHERE id = v_request.id;

  -- Emit audit event
  INSERT INTO public.audit_logs (
    actor_id,
    action,
    target_table,
    target_id,
    previous_state,
    new_state
  ) VALUES (
    p_actor_id,
    'COMMITMENT_CONFIRMED',
    'donor_commitments',
    p_commitment_id,
    jsonb_build_object('status', 'INTERESTED'),
    jsonb_build_object('status', 'CONFIRMED', 'units_reserved', v_new_reserved)
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'commitment_id', p_commitment_id,
    'status', 'CONFIRMED',
    'units_reserved', v_new_reserved,
    'request_status', v_target_status
  );
END;
$$;

-- 7. ATOMIC STORED PROCEDURE: RECORD DONATION DRAW
-- Clinical personnel records that donor has successfully donated unit.
CREATE OR REPLACE FUNCTION public.record_donation_atomic(
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
  v_request RECORD;
  v_new_donated INT;
  v_new_reserved INT;
  v_target_status request_status_type;
BEGIN
  SELECT * INTO v_commitment
  FROM public.donor_commitments
  WHERE id = p_commitment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Commitment not found.');
  END IF;

  IF v_commitment.status NOT IN ('SCHEDULED', 'CONFIRMED', 'ARRIVED_FACILITY') THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'error', 'Cannot record donation for commitment in status: ' || v_commitment.status
    );
  END IF;

  SELECT * INTO v_request
  FROM public.blood_requests
  WHERE id = v_commitment.request_id
  FOR UPDATE;

  -- Role check: Clinical staff or Admin
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = p_actor_id AND role IN ('HOSPITAL_STAFF', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN')
  ) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Only clinical staff can verify and record donation draws.');
  END IF;

  -- Update commitment to DONATION_RECORDED
  UPDATE public.donor_commitments
  SET
    status = 'DONATION_RECORDED',
    completed_at = timezone('utc', now())
  WHERE id = p_commitment_id;

  -- Shift unit from reserved to completed donated
  v_new_reserved := GREATEST(0, v_request.units_reserved - 1);
  v_new_donated := v_request.units_donated + 1;

  IF v_new_donated >= v_request.units_requested THEN
    v_target_status := 'FULFILLED';
  ELSE
    v_target_status := 'PARTIALLY_FULFILLED';
  END IF;

  UPDATE public.blood_requests
  SET
    units_reserved = v_new_reserved,
    units_donated = v_new_donated,
    status = v_target_status,
    updated_at = timezone('utc', now())
  WHERE id = v_request.id;

  -- Put donor into clinical recovery cooldown based on blood component
  UPDATE public.donor_profiles
  SET
    last_donation_date = CURRENT_DATE,
    total_donations_count = total_donations_count + 1,
    cooldown_until = CURRENT_DATE + INTERVAL '56 days'
  WHERE profile_id = v_commitment.donor_id;

  INSERT INTO public.audit_logs (
    actor_id,
    action,
    target_table,
    target_id,
    previous_state,
    new_state
  ) VALUES (
    p_actor_id,
    'DONATION_RECORDED',
    'donor_commitments',
    p_commitment_id,
    jsonb_build_object('status', v_commitment.status),
    jsonb_build_object('status', 'DONATION_RECORDED', 'units_donated', v_new_donated, 'request_status', v_target_status)
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'commitment_id', p_commitment_id,
    'status', 'DONATION_RECORDED',
    'units_donated', v_new_donated,
    'request_status', v_target_status
  );
END;
$$;
