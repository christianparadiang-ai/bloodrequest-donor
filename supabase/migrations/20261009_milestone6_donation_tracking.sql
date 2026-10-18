-- ==============================================================================
-- LIFE DROP: MILESTONE 6 — FULFILLMENT / DONATION TRACKING
-- ==============================================================================

-- 1. ENUM FOR OPERATIONAL DONATION LIFECYCLE
DO $$ BEGIN
  CREATE TYPE donation_status_type AS ENUM (
    'SCHEDULED',
    'ATTENDED',
    'RECORDED',
    'CANCELLED',
    'NO_SHOW'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 2. NORMALIZED DONATIONS TABLE
CREATE TABLE IF NOT EXISTS public.donations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.blood_requests(id) ON DELETE CASCADE,
  commitment_id UUID NOT NULL REFERENCES public.donor_commitments(id) ON DELETE CASCADE,
  donor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  donor_profile_id UUID REFERENCES public.donor_profiles(id) ON DELETE SET NULL,
  status donation_status_type NOT NULL DEFAULT 'SCHEDULED',
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  attended_at TIMESTAMPTZ,
  recorded_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  no_show_at TIMESTAMPTZ,
  units_donated INT NOT NULL DEFAULT 0 CHECK (units_donated >= 0),
  blood_group blood_group_type,
  component_type blood_component_type NOT NULL DEFAULT 'WHOLE_BLOOD',
  facility_name TEXT,
  recorded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes TEXT,
  cancellation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- 3. CONSTRAINTS & INDEXES FOR CONCURRENCY AND AUDITABILITY
-- Prevent multiple active donations for the exact same commitment
CREATE UNIQUE INDEX IF NOT EXISTS idx_donations_unique_active_commitment
  ON public.donations (commitment_id)
  WHERE status NOT IN ('CANCELLED', 'NO_SHOW');

-- Performance lookup indexes
CREATE INDEX IF NOT EXISTS idx_donations_request_id ON public.donations (request_id);
CREATE INDEX IF NOT EXISTS idx_donations_donor_id ON public.donations (donor_id);
CREATE INDEX IF NOT EXISTS idx_donations_commitment_id ON public.donations (commitment_id);
CREATE INDEX IF NOT EXISTS idx_donations_status ON public.donations (status);
CREATE INDEX IF NOT EXISTS idx_donations_scheduled_at ON public.donations (scheduled_at);

-- 4. ROW-LEVEL SECURITY POLICIES
ALTER TABLE public.donations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Donors view own donations" ON public.donations;
DROP POLICY IF EXISTS "Requesters view request donations" ON public.donations;
DROP POLICY IF EXISTS "Authorized staff view all donations" ON public.donations;
DROP POLICY IF EXISTS "Hospital staff view affiliated donations" ON public.donations;

-- Policy A: Donors view their own donation records
CREATE POLICY "Donors view own donations" ON public.donations
  FOR SELECT USING (
    donor_id = public.current_profile_id()
    OR donor_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = donations.donor_id
        AND p.clerk_user_id = auth.jwt()->>'sub'
    )
  );

-- Policy B: Requesters view donation records for their own blood requests
CREATE POLICY "Requesters view request donations" ON public.donations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.blood_requests
      WHERE public.blood_requests.id = public.donations.request_id
        AND public.blood_requests.requester_id = public.current_profile_id()
    )
  );

-- Policy C: Authorized moderators and admins can view all donations for oversight
CREATE POLICY "Authorized staff view all donations" ON public.donations
  FOR SELECT USING (public.is_moderator_or_admin());

-- Policy D: Hospital staff can view donations for requests at their affiliated hospital
CREATE POLICY "Hospital staff view affiliated donations" ON public.donations
  FOR SELECT USING (public.is_affiliated_hospital_staff(request_id));
