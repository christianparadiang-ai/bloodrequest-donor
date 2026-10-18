-- ==============================================================================
-- LIFE DROP: MILESTONE 3 — POTENTIAL DONOR DISCOVERY & MATCHING ENGINE
-- ==============================================================================

-- 1. Match status enum
DO $$ BEGIN
    CREATE TYPE match_status_type AS ENUM (
      'POTENTIAL_CANDIDATE',
      'NOTIFIED',
      'EXPIRED',
      'DECLINED'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 2. Potential Request Matches Table
CREATE TABLE IF NOT EXISTS public.request_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.blood_requests(id) ON DELETE CASCADE,
  donor_id UUID NOT NULL REFERENCES public.donor_profiles(id) ON DELETE CASCADE,
  status match_status_type NOT NULL DEFAULT 'POTENTIAL_CANDIDATE',
  discovery_score INT NOT NULL CHECK (discovery_score >= 0 AND discovery_score <= 100),
  distance_km DOUBLE PRECISION,
  is_exact_location BOOLEAN NOT NULL DEFAULT FALSE,
  reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT unique_request_donor_match UNIQUE (request_id, donor_id)
);

-- 3. High-Performance Indexes
CREATE INDEX IF NOT EXISTS idx_request_matches_request ON public.request_matches(request_id);
CREATE INDEX IF NOT EXISTS idx_request_matches_donor ON public.request_matches(donor_id);
CREATE INDEX IF NOT EXISTS idx_request_matches_score ON public.request_matches(request_id, discovery_score DESC);

-- 4. Enable Row-Level Security
ALTER TABLE public.request_matches ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if needed
DROP POLICY IF EXISTS "Requesters view own request matches" ON public.request_matches;
DROP POLICY IF EXISTS "Authorized staff view all matches" ON public.request_matches;
DROP POLICY IF EXISTS "Hospital staff view affiliated matches" ON public.request_matches;
DROP POLICY IF EXISTS "Donors view own matches" ON public.request_matches;

-- Policy A: Requesters can view matches for their own blood requests
CREATE POLICY "Requesters view own request matches" ON public.request_matches
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.blood_requests
      WHERE public.blood_requests.id = request_matches.request_id
        AND public.blood_requests.requester_id = public.current_profile_id()
    )
  );

-- Policy B: Authorized staff (Moderator, Admin, Super Admin) can view all matches
CREATE POLICY "Authorized staff view all matches" ON public.request_matches
  FOR SELECT USING (public.is_moderator_or_admin());

-- Policy C: Hospital staff can view matches for requests at their affiliated hospital
CREATE POLICY "Hospital staff view affiliated matches" ON public.request_matches
  FOR SELECT USING (public.is_affiliated_hospital_staff(request_id));

-- Policy D: Donors can view matches where they are the matched candidate
CREATE POLICY "Donors view own matches" ON public.request_matches
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.donor_profiles
      WHERE public.donor_profiles.id = request_matches.donor_id
        AND public.donor_profiles.profile_id = public.current_profile_id()
    )
  );
