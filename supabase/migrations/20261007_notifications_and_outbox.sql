-- ==============================================================================
-- LIFE DROP: MILESTONE 2D — NOTIFICATIONS & COMMUNICATION OUTBOX ARCHITECTURE
-- ==============================================================================

-- 1. NOTIFICATION TYPE ENUM
DO $$ BEGIN
  CREATE TYPE notification_type AS ENUM (
    'DONOR_INTEREST_RECEIVED',
    'COMMITMENT_CONFIRMED',
    'COMMITMENT_DECLINED',
    'COMMITMENT_CANCELLED',
    'DONATION_SCHEDULED',
    'DONATION_REMINDER',
    'DONATION_RECORDED',
    'DONATION_COMPLETED',
    'REQUEST_PARTIALLY_FULFILLED',
    'REQUEST_FULFILLED',
    'REQUEST_EXPIRING',
    'VERIFICATION_APPROVED',
    'VERIFICATION_REJECTED',
    'DOCUMENT_AMENDMENT_REQUIRED'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 2. NOTIFICATION DELIVERY STATUS ENUM
DO $$ BEGIN
  CREATE TYPE notification_delivery_status AS ENUM (
    'PENDING',
    'PROCESSING',
    'DELIVERED',
    'FAILED',
    'READ'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 3. NOTIFICATIONS TABLE (In-App Delivery Store)
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id TEXT NOT NULL,
  type notification_type NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  request_id UUID REFERENCES public.blood_requests(id) ON DELETE CASCADE,
  commitment_id UUID REFERENCES public.donor_commitments(id) ON DELETE SET NULL,
  status notification_delivery_status NOT NULL DEFAULT 'DELIVERED',
  read_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb,
  idempotency_key TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- 4. NOTIFICATION EVENTS TABLE (Durable Outbox Queue)
CREATE TABLE IF NOT EXISTS public.notification_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
  retry_count INT NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  processed_at TIMESTAMPTZ
);

-- 5. USER NOTIFICATION PREFERENCES TABLE
CREATE TABLE IF NOT EXISTS public.user_notification_preferences (
  user_id TEXT PRIMARY KEY,
  in_app_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- 6. PERFORMANCE INDEXES
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_unread 
  ON public.notifications (recipient_user_id, read_at) 
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_created_at 
  ON public.notifications (recipient_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_events_pending 
  ON public.notification_events (status, created_at) 
  WHERE status = 'PENDING';

-- 7. ROW LEVEL SECURITY POLICIES
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_notification_preferences ENABLE ROW LEVEL SECURITY;

-- Notifications RLS
DROP POLICY IF EXISTS "Users view own notifications" ON public.notifications;
CREATE POLICY "Users view own notifications" ON public.notifications
  FOR SELECT USING (
    recipient_user_id = public.current_profile_id()::text 
    OR recipient_user_id = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users update read status on own notifications" ON public.notifications;
CREATE POLICY "Users update read status on own notifications" ON public.notifications
  FOR UPDATE USING (
    recipient_user_id = public.current_profile_id()::text 
    OR recipient_user_id = auth.uid()::text
  );

-- Outbox Events RLS: Only elevated service role can access the outbox
DROP POLICY IF EXISTS "Service role manages notification outbox" ON public.notification_events;
CREATE POLICY "Service role manages notification outbox" ON public.notification_events
  FOR ALL USING (auth.role() = 'service_role');

-- Preferences RLS
DROP POLICY IF EXISTS "Users manage own preferences" ON public.user_notification_preferences;
CREATE POLICY "Users manage own preferences" ON public.user_notification_preferences
  FOR ALL USING (
    user_id = public.current_profile_id()::text 
    OR user_id = auth.uid()::text
  );
