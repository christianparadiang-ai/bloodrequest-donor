-- ==============================================================================
-- LIFE DROP: MILESTONE 2 — BLOOD REQUISITION INTAKE & VERIFICATION ENHANCEMENTS
-- ==============================================================================

-- 1. Add missing requisition attributes to public.blood_requests
ALTER TABLE public.blood_requests
ADD COLUMN IF NOT EXISTS province TEXT,
ADD COLUMN IF NOT EXISTS request_reason TEXT,
ADD COLUMN IF NOT EXISTS contact_name TEXT,
ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
ADD COLUMN IF NOT EXISTS reviewer_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

-- 2. Make latitude and longitude nullable for location flexibility
ALTER TABLE public.blood_requests
ALTER COLUMN latitude DROP NOT NULL,
ALTER COLUMN longitude DROP NOT NULL;

-- 3. Update default status for newly created blood requests to 'SUBMITTED'
ALTER TABLE public.blood_requests
ALTER COLUMN status SET DEFAULT 'SUBMITTED';

-- 4. Re-enforce and strengthen Row-Level Security (RLS) policies on blood_requests
DROP POLICY IF EXISTS "Public read active requests" ON public.blood_requests;
DROP POLICY IF EXISTS "Requesters manage own requests" ON public.blood_requests;
DROP POLICY IF EXISTS "Requesters view own requests" ON public.blood_requests;
DROP POLICY IF EXISTS "Requesters insert own requests" ON public.blood_requests;
DROP POLICY IF EXISTS "Requesters update own requests" ON public.blood_requests;
DROP POLICY IF EXISTS "Authorized staff view all requests" ON public.blood_requests;
DROP POLICY IF EXISTS "Hospital staff view affiliated requests" ON public.blood_requests;

-- Policy A: Requesters can view their own requests (any lifecycle status)
CREATE POLICY "Requesters view own requests" ON public.blood_requests
  FOR SELECT USING (requester_id = public.current_profile_id());

-- Policy B: Public can view active/broadcast requests (for potential donor discovery)
CREATE POLICY "Public read active requests" ON public.blood_requests
  FOR SELECT USING (status IN ('ACTIVE', 'PARTIALLY_COMMITTED', 'FULLY_COMMITTED', 'FULFILLED'));

-- Policy C: Moderators, Admins, and Super Admins can view all requests in all statuses
CREATE POLICY "Authorized staff view all requests" ON public.blood_requests
  FOR SELECT USING (public.is_moderator_or_admin());

-- Policy D: Hospital staff can view requests affiliated with their hospital
CREATE POLICY "Hospital staff view affiliated requests" ON public.blood_requests
  FOR SELECT USING (public.is_affiliated_hospital_staff(id));

-- Policy E: Requesters can insert their own requests
CREATE POLICY "Requesters insert own requests" ON public.blood_requests
  FOR INSERT WITH CHECK (requester_id = public.current_profile_id());

-- Policy F: Requesters can update their own DRAFT requests
CREATE POLICY "Requesters update own requests" ON public.blood_requests
  FOR UPDATE USING (
    requester_id = public.current_profile_id()
    AND status = 'DRAFT'
  );
