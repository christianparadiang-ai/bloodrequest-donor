-- ==============================================================================
-- LIFE DROP: MILESTONE 5 — DONOR RESPONSE & COMMITMENT WORKFLOW
-- ==============================================================================

-- 1. ADD NEW RESPONSE AND COMMITMENT ENUM VALUES
DO $$ BEGIN
  CREATE TYPE donor_response_type AS ENUM ('NOT_RESPONDED', 'INTERESTED', 'DECLINED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TYPE public.commitment_status_type ADD VALUE IF NOT EXISTS 'PENDING';
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TYPE public.commitment_status_type ADD VALUE IF NOT EXISTS 'WITHDRAWN';
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TYPE public.match_status_type ADD VALUE IF NOT EXISTS 'ACCEPTED';
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TYPE public.match_status_type ADD VALUE IF NOT EXISTS 'WITHDRAWN';
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 2. AUGMENT DONOR COMMITMENTS TABLE FOR CONTROLLED WORKFLOW
ALTER TABLE public.donor_commitments
  ADD COLUMN IF NOT EXISTS match_id UUID REFERENCES public.request_matches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS donor_profile_id UUID REFERENCES public.donor_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS response donor_response_type NOT NULL DEFAULT 'INTERESTED',
  ADD COLUMN IF NOT EXISTS responded_at TIMESTAMPTZ DEFAULT timezone('utc', now()),
  ADD COLUMN IF NOT EXISTS withdrawn_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now());

-- 3. DROP WHOLE-TABLE CONSTRAINT IN FAVOR OF ACTIVE-ONLY UNIQUE CONSTRAINTS
ALTER TABLE public.donor_commitments DROP CONSTRAINT IF EXISTS unique_active_commitment;

-- Ensure a donor can have at most ONE ACTIVE commitment per blood requisition
CREATE UNIQUE INDEX IF NOT EXISTS idx_donor_commitments_active_donor_req
  ON public.donor_commitments (request_id, donor_id)
  WHERE status NOT IN ('CANCELLED', 'DECLINED', 'WITHDRAWN', 'EXPIRED');

-- Ensure a candidate match can have at most ONE ACTIVE commitment
CREATE UNIQUE INDEX IF NOT EXISTS idx_donor_commitments_active_match
  ON public.donor_commitments (match_id)
  WHERE match_id IS NOT NULL AND status NOT IN ('CANCELLED', 'DECLINED', 'WITHDRAWN', 'EXPIRED');

-- Fast lookup indexes
CREATE INDEX IF NOT EXISTS idx_donor_commitments_request_id ON public.donor_commitments (request_id);
CREATE INDEX IF NOT EXISTS idx_donor_commitments_donor_id ON public.donor_commitments (donor_id);
CREATE INDEX IF NOT EXISTS idx_donor_commitments_match_id ON public.donor_commitments (match_id);
CREATE INDEX IF NOT EXISTS idx_donor_commitments_status ON public.donor_commitments (status);

-- 4. ROW-LEVEL SECURITY POLICIES
ALTER TABLE public.donor_commitments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Donors view own commitments" ON public.donor_commitments;
DROP POLICY IF EXISTS "Requesters view request commitments" ON public.donor_commitments;
DROP POLICY IF EXISTS "Authorized staff view all commitments" ON public.donor_commitments;
DROP POLICY IF EXISTS "Hospital staff view affiliated commitments" ON public.donor_commitments;
DROP POLICY IF EXISTS "Donors withdraw own commitments" ON public.donor_commitments;

-- Policy A: Donors view their own commitments
CREATE POLICY "Donors view own commitments" ON public.donor_commitments
  FOR SELECT USING (
    donor_id = public.current_profile_id()
    OR donor_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = donor_commitments.donor_id
        AND p.clerk_user_id = auth.jwt()->>'sub'
    )
  );

-- Policy B: Requesters view commitments made to their own blood requests
CREATE POLICY "Requesters view request commitments" ON public.donor_commitments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.blood_requests
      WHERE public.blood_requests.id = public.donor_commitments.request_id
        AND public.blood_requests.requester_id = public.current_profile_id()
    )
  );

-- Policy C: Authorized moderators and admins can view all commitments for audit/oversight
CREATE POLICY "Authorized staff view all commitments" ON public.donor_commitments
  FOR SELECT USING (public.is_moderator_or_admin());

-- Policy D: Hospital staff can view commitments for requests at their affiliated hospital
CREATE POLICY "Hospital staff view affiliated commitments" ON public.donor_commitments
  FOR SELECT USING (public.is_affiliated_hospital_staff(request_id));

-- Policy E: Donors can update only their own active commitment to mark as WITHDRAWN
CREATE POLICY "Donors withdraw own commitments" ON public.donor_commitments
  FOR UPDATE USING (
    donor_id = public.current_profile_id()
    OR donor_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = donor_commitments.donor_id
        AND p.clerk_user_id = auth.jwt()->>'sub'
    )
  )
  WITH CHECK (
    status = 'WITHDRAWN'
  );
