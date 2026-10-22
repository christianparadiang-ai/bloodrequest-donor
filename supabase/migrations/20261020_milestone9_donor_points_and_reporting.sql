-- ==============================================================================
-- LIFE DROP: MILESTONE 9 — DONOR POINTS LEDGER & REPORTING INDEXES
-- ==============================================================================

-- 1. CONFIGURABLE POINTS AND RECOGNITION RULES TABLE
CREATE TABLE IF NOT EXISTS public.points_config (
  key TEXT PRIMARY KEY,
  value INT NOT NULL,
  description TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

-- Seed configurable points policy (subject to administrative approval)
INSERT INTO public.points_config (key, value, description)
VALUES 
  ('points_per_donation', 100, 'Default non-monetary recognition points awarded per verified completed donation (policy proposal subject to review).'),
  ('tier_bronze_threshold', 100, 'Points threshold for Bronze Life Donor recognition level.'),
  ('tier_silver_threshold', 300, 'Points threshold for Silver Life Donor recognition level.'),
  ('tier_gold_threshold', 600, 'Points threshold for Gold Life Donor recognition level.'),
  ('tier_platinum_threshold', 1000, 'Points threshold for Platinum Life Donor recognition level.')
ON CONFLICT (key) DO NOTHING;

-- 2. DONOR POINTS TRANSACTIONS LEDGER
-- Non-monetary donor recognition ledger. Strictly auditable.
CREATE TABLE IF NOT EXISTS public.donor_points_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  donor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  donor_profile_id UUID REFERENCES public.donor_profiles(id) ON DELETE CASCADE,
  donation_id UUID REFERENCES public.donations(id) ON DELETE SET NULL,
  points INT NOT NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('DONATION_COMPLETED', 'MANUAL_ADJUSTMENT', 'REVERSAL')),
  reason TEXT NOT NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- 3. IDEMPOTENCY AND AUDIT INDEXES
-- Invariant: Exactly one DONATION_COMPLETED point award per verified completed donation record.
CREATE UNIQUE INDEX IF NOT EXISTS idx_points_unique_completed_donation
  ON public.donor_points_transactions (donation_id)
  WHERE transaction_type = 'DONATION_COMPLETED';

CREATE INDEX IF NOT EXISTS idx_points_transactions_donor_id 
  ON public.donor_points_transactions (donor_id);

CREATE INDEX IF NOT EXISTS idx_points_transactions_donor_profile_id 
  ON public.donor_points_transactions (donor_profile_id);

CREATE INDEX IF NOT EXISTS idx_points_transactions_created_at 
  ON public.donor_points_transactions (created_at);

-- 4. REPORTING PERFORMANCE OPTIMIZATION INDEXES
CREATE INDEX IF NOT EXISTS idx_blood_requests_created_at 
  ON public.blood_requests (created_at);

CREATE INDEX IF NOT EXISTS idx_blood_requests_status_created_at 
  ON public.blood_requests (status, created_at);

CREATE INDEX IF NOT EXISTS idx_donations_created_at 
  ON public.donations (created_at);

CREATE INDEX IF NOT EXISTS idx_donations_recorded_at 
  ON public.donations (recorded_at);

CREATE INDEX IF NOT EXISTS idx_donor_profiles_created_at 
  ON public.donor_profiles (created_at);

-- 5. ROW-LEVEL SECURITY POLICIES
ALTER TABLE public.points_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.donor_points_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read points config" ON public.points_config;
DROP POLICY IF EXISTS "Authorized staff manage points config" ON public.points_config;

-- Public/Authenticated read access to recognition rules and thresholds
CREATE POLICY "Anyone can read points config" ON public.points_config
  FOR SELECT USING (true);

-- Only privileged administrators can modify points rules
CREATE POLICY "Authorized staff manage points config" ON public.points_config
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = public.current_profile_id()
        AND p.role IN ('ADMIN', 'SUPER_ADMIN')
    )
  );

DROP POLICY IF EXISTS "Donors view own points transactions" ON public.donor_points_transactions;
DROP POLICY IF EXISTS "Authorized staff view all points transactions" ON public.donor_points_transactions;
DROP POLICY IF EXISTS "Privileged staff insert points adjustments" ON public.donor_points_transactions;

-- Donors view only their own points transactions
CREATE POLICY "Donors view own points transactions" ON public.donor_points_transactions
  FOR SELECT USING (
    donor_id = public.current_profile_id()
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = donor_points_transactions.donor_id
        AND p.clerk_user_id = auth.jwt()->>'sub'
    )
  );

-- Authorized staff/admins view all transactions
CREATE POLICY "Authorized staff view all points transactions" ON public.donor_points_transactions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = public.current_profile_id()
        AND p.role IN ('HOSPITAL_STAFF', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN')
    )
  );

-- Privileged staff insert manual adjustments
CREATE POLICY "Privileged staff insert points adjustments" ON public.donor_points_transactions
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = public.current_profile_id()
        AND p.role IN ('MODERATOR', 'ADMIN', 'SUPER_ADMIN')
    )
  );
