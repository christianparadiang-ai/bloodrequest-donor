-- ==============================================================================
-- LIFE DROP: PRODUCTION POSTGRESQL SCHEMA WITH ROW LEVEL SECURITY & CONSTRAINTS
-- ==============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. ENUMS
DO $$ BEGIN
    CREATE TYPE blood_group_type AS ENUM ('A', 'B', 'AB', 'O');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE rh_factor_type AS ENUM ('POSITIVE', 'NEGATIVE');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE blood_component_type AS ENUM ('WHOLE_BLOOD', 'PRBC', 'PLATELETS', 'FFP', 'CRYOPRECIPITATE');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE urgency_tier_type AS ENUM ('ROUTINE', 'URGENT', 'CRITICAL_STAT');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE request_status_type AS ENUM (
      'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'ACTIVE', 
      'PARTIALLY_COMMITTED', 'FULLY_COMMITTED', 'FULFILLED', 
      'EXPIRED', 'CANCELLED', 'REJECTED'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE commitment_status_type AS ENUM (
      'MATCHED', 'NOTIFIED', 'ACCEPTED', 'EN_ROUTE', 
      'ARRIVED_FACILITY', 'DONATION_CONFIRMED', 'DECLINED', 
      'CANCELLED', 'EXPIRED', 'NO_SHOW'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE user_role_type AS ENUM (
      'USER', 'DONOR', 'HOSPITAL_STAFF', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 3. PROFILES TABLE (Mirrors Clerk identity)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  phone_number TEXT,
  full_name TEXT NOT NULL,
  role user_role_type NOT NULL DEFAULT 'USER',
  is_phone_verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- 4. DONOR PROFILES
CREATE TABLE IF NOT EXISTS public.donor_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  blood_group blood_group_type NOT NULL,
  rh_factor rh_factor_type NOT NULL,
  is_available BOOLEAN DEFAULT TRUE,
  cooldown_until DATE,
  notification_radius_km INT DEFAULT 25 CHECK (notification_radius_km >= 1 AND notification_radius_km <= 150),
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  city TEXT NOT NULL,
  total_donations_count INT DEFAULT 0 CHECK (total_donations_count >= 0),
  last_donation_date DATE,
  reliability_score INT DEFAULT 100 CHECK (reliability_score >= 0 AND reliability_score <= 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT unique_donor_profile UNIQUE (profile_id)
);

-- 5. BLOOD REQUESTS
CREATE TABLE IF NOT EXISTS public.blood_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  patient_name_masked TEXT NOT NULL,
  hospital_name TEXT NOT NULL,
  hospital_city TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  blood_group blood_group_type NOT NULL,
  rh_factor rh_factor_type NOT NULL,
  blood_component blood_component_type NOT NULL DEFAULT 'WHOLE_BLOOD',
  units_requested INT NOT NULL CHECK (units_requested > 0 AND units_requested <= 20),
  units_committed INT NOT NULL DEFAULT 0 CHECK (units_committed >= 0 AND units_committed <= units_requested),
  urgency_level urgency_tier_type NOT NULL DEFAULT 'URGENT',
  status request_status_type NOT NULL DEFAULT 'ACTIVE',
  contact_number_masked TEXT NOT NULL,
  medical_notes TEXT,
  document_verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
  required_by TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- 6. DONOR COMMITMENTS (Atomic reservations)
CREATE TABLE IF NOT EXISTS public.donor_commitments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.blood_requests(id) ON DELETE RESTRICT,
  donor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  status commitment_status_type NOT NULL DEFAULT 'ACCEPTED',
  committed_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (timezone('utc', now()) + INTERVAL '4 hours'),
  cancellation_reason TEXT,
  CONSTRAINT unique_active_commitment UNIQUE (request_id, donor_id)
);

-- 7. IMMUTABLE AUDIT LOGS
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_table TEXT NOT NULL,
  target_id UUID NOT NULL,
  previous_state JSONB,
  new_state JSONB,
  ip_address_hash TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- Prevent UPDATE and DELETE on audit_logs
CREATE OR REPLACE RULE no_update_audit_logs AS ON UPDATE TO public.audit_logs DO INSTEAD NOTHING;
CREATE OR REPLACE RULE no_delete_audit_logs AS ON DELETE TO public.audit_logs DO INSTEAD NOTHING;

-- 8. INDEXES FOR HIGH-PERFORMANCE MATCHING & QUERIES
CREATE INDEX IF NOT EXISTS idx_blood_requests_active_urgency ON public.blood_requests (status, urgency_level);
CREATE INDEX IF NOT EXISTS idx_blood_requests_geo ON public.blood_requests (latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_donor_profiles_match_lookup ON public.donor_profiles (blood_group, rh_factor, is_available);
CREATE INDEX IF NOT EXISTS idx_donor_commitments_request ON public.donor_commitments (request_id, status);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON public.audit_logs (target_table, target_id);

-- 9. ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.donor_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blood_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.donor_commitments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Helper to extract user ID from Clerk JWT claims
CREATE OR REPLACE FUNCTION public.current_profile_id()
RETURNS UUID AS $$
  SELECT id FROM public.profiles WHERE clerk_user_id = auth.jwt()->>'sub' LIMIT 1;
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- Profiles Policies
DROP POLICY IF EXISTS "Users read own profile" ON public.profiles;
CREATE POLICY "Users read own profile" ON public.profiles
  FOR SELECT USING (clerk_user_id = auth.jwt()->>'sub');

DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
CREATE POLICY "Users update own profile" ON public.profiles
  FOR UPDATE USING (clerk_user_id = auth.jwt()->>'sub');

-- Requests Policies
DROP POLICY IF EXISTS "Public read active requests" ON public.blood_requests;
CREATE POLICY "Public read active requests" ON public.blood_requests
  FOR SELECT USING (status IN ('ACTIVE', 'PARTIALLY_COMMITTED', 'FULLY_COMMITTED'));

DROP POLICY IF EXISTS "Requesters manage own requests" ON public.blood_requests;
CREATE POLICY "Requesters manage own requests" ON public.blood_requests
  FOR ALL USING (requester_id = public.current_profile_id());

-- Audit Log Policy
DROP POLICY IF EXISTS "System appends audit logs" ON public.audit_logs;
CREATE POLICY "System appends audit logs" ON public.audit_logs
  FOR INSERT WITH CHECK (true);
