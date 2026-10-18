-- ==============================================================================
-- LIFE DROP: MILESTONE 1 — DONOR PROFILE & AVAILABILITY ENHANCEMENTS
-- ==============================================================================

-- 1. ADD PROVINCE AND CONTACT CONSENT COLUMNS
ALTER TABLE public.donor_profiles 
  ADD COLUMN IF NOT EXISTS province TEXT,
  ADD COLUMN IF NOT EXISTS consent_to_contact BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. ALLOW NULLABLE COORDINATES (Location resolved via city & province)
ALTER TABLE public.donor_profiles 
  ALTER COLUMN latitude DROP NOT NULL,
  ALTER COLUMN longitude DROP NOT NULL;

-- 3. ENSURE RLS POLICIES FOR DONOR PROFILES
ALTER TABLE public.donor_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users insert own donor profile" ON public.donor_profiles;
DROP POLICY IF EXISTS "Users update own donor profile" ON public.donor_profiles;
DROP POLICY IF EXISTS "Donors read own profile" ON public.donor_profiles;

-- Donors can read their own profile (including private contact consent and radius)
CREATE POLICY "Donors read own profile" ON public.donor_profiles
  FOR SELECT USING (profile_id = public.current_profile_id());

-- Users can insert their own donor profile only
CREATE POLICY "Users insert own donor profile" ON public.donor_profiles
  FOR INSERT WITH CHECK (profile_id = public.current_profile_id());

-- Users can update only their own donor profile
CREATE POLICY "Users update own donor profile" ON public.donor_profiles
  FOR UPDATE USING (profile_id = public.current_profile_id());

-- 4. PERFORMANCE INDEX ON AVAILABILITY AND SERVICE LOCATION
CREATE INDEX IF NOT EXISTS idx_donor_profiles_location_avail 
  ON public.donor_profiles (city, province, is_available, consent_to_contact);
