-- ==============================================================================
-- LIFE DROP: MILESTONE 4 — DONOR NOTIFICATION & DISPATCH WORKFLOW
-- ==============================================================================

-- 1. ADD NEW NOTIFICATION TYPES AND DELIVERY STATUSES IF NEEDED
DO $$ BEGIN
  ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'POTENTIAL_DONOR_ALERT';
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TYPE notification_delivery_status ADD VALUE IF NOT EXISTS 'SENT';
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 2. ENHANCE NOTIFICATIONS TABLE FOR MATCH-LEVEL DISPATCH TRACKING
ALTER TABLE public.notifications
ADD COLUMN IF NOT EXISTS match_id UUID REFERENCES public.request_matches(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS error_details TEXT;

-- 3. INDEXES FOR FAST LOOKUP AND IDEMPOTENCY
CREATE INDEX IF NOT EXISTS idx_notifications_match_id ON public.notifications(match_id);
CREATE INDEX IF NOT EXISTS idx_notifications_request_id ON public.notifications(request_id);
CREATE INDEX IF NOT EXISTS idx_notifications_idempotency ON public.notifications(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- 4. RE-ENFORCE AND STRENGTHEN NOTIFICATION ROW LEVEL SECURITY
DROP POLICY IF EXISTS "Users view own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users update read status on own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Authorized staff view all notifications" ON public.notifications;

-- Donors view their own notifications (whether referenced by profile id or clerk user id)
CREATE POLICY "Users view own notifications" ON public.notifications
  FOR SELECT USING (
    recipient_user_id = public.current_profile_id()::text 
    OR recipient_user_id = auth.jwt()->>'sub'
    OR recipient_user_id = auth.uid()::text
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE (p.id::text = notifications.recipient_user_id OR p.clerk_user_id = notifications.recipient_user_id)
        AND p.clerk_user_id = auth.jwt()->>'sub'
    )
  );

-- Donors can update only their own read status
CREATE POLICY "Users update read status on own notifications" ON public.notifications
  FOR UPDATE USING (
    recipient_user_id = public.current_profile_id()::text 
    OR recipient_user_id = auth.jwt()->>'sub'
    OR recipient_user_id = auth.uid()::text
  )
  WITH CHECK (
    status IN ('READ', 'DELIVERED')
  );

-- Authorized moderators and admins can view all notifications for audit and oversight
CREATE POLICY "Authorized staff view all notifications" ON public.notifications
  FOR SELECT USING (public.is_moderator_or_admin());
