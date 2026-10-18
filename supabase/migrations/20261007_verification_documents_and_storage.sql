-- ==============================================================================
-- LIFE DROP: MEDICAL VERIFICATION DOCUMENTS, ROLE SCOPING & SECURE STORAGE
-- ==============================================================================

-- 1. ADD HOSPITAL AFFILIATION TO PROFILES (For Hospital Staff Scoped Access)
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS hospital_affiliation TEXT;

-- 2. VERIFICATION TYPES
DO $$ BEGIN
    CREATE TYPE verification_status_type AS ENUM (
      'PENDING_REVIEW', 'VERIFIED', 'REJECTED'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE rejection_reason_type AS ENUM (
      'DOCUMENT_UNREADABLE',
      'DOCUMENT_INCOMPLETE',
      'INFORMATION_MISMATCH',
      'ADDITIONAL_INFORMATION_REQUIRED',
      'OTHER'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 3. MEDICAL VERIFICATION DOCUMENTS TABLE
-- Stores immutable versions of submitted doctor's requisitions/prescriptions
CREATE TABLE IF NOT EXISTS public.verification_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.blood_requests(id) ON DELETE CASCADE,
  uploader_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  storage_path TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size_bytes INT NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 10485760),
  version_number INT NOT NULL DEFAULT 1 CHECK (version_number >= 1),
  status verification_status_type NOT NULL DEFAULT 'PENDING_REVIEW',
  reviewer_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  rejection_reason rejection_reason_type,
  reviewer_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT unique_request_document_version UNIQUE (request_id, version_number)
);

-- 4. PERFORMANCE & LOOKUP INDEXES
CREATE INDEX IF NOT EXISTS idx_verification_docs_request ON public.verification_documents(request_id);
CREATE INDEX IF NOT EXISTS idx_verification_docs_status ON public.verification_documents(status);
CREATE INDEX IF NOT EXISTS idx_verification_docs_reviewer ON public.verification_documents(reviewer_id);

-- 5. ROW LEVEL SECURITY (RLS) FOR VERIFICATION DOCUMENTS
ALTER TABLE public.verification_documents ENABLE ROW LEVEL SECURITY;

-- Helper to check if current user is an authorized moderator or admin
CREATE OR REPLACE FUNCTION public.is_moderator_or_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = public.current_profile_id()
      AND role IN ('MODERATOR', 'ADMIN', 'SUPER_ADMIN')
  );
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- Helper to check if current user is hospital staff affiliated with this request's hospital
CREATE OR REPLACE FUNCTION public.is_affiliated_hospital_staff(p_request_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.blood_requests r ON r.id = p_request_id
    WHERE p.id = public.current_profile_id()
      AND p.role = 'HOSPITAL_STAFF'
      AND LOWER(TRIM(p.hospital_affiliation)) = LOWER(TRIM(r.hospital_name))
  );
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- SELECT POLICY:
-- Requesters can view their own documents;
-- Moderators and Admins can view any documents;
-- Hospital staff can view documents scoped to their affiliated hospital.
-- Donors and unauthorized users are DENIED.
DROP POLICY IF EXISTS "Authorized view verification documents" ON public.verification_documents;
CREATE POLICY "Authorized view verification documents" ON public.verification_documents
  FOR SELECT USING (
    -- Owner check
    uploader_id = public.current_profile_id()
    OR public.is_moderator_or_admin()
    OR public.is_affiliated_hospital_staff(request_id)
  );

-- INSERT POLICY:
-- Only the requester who owns the blood request can upload documents for it.
DROP POLICY IF EXISTS "Requesters upload own documents" ON public.verification_documents;
CREATE POLICY "Requesters upload own documents" ON public.verification_documents
  FOR INSERT WITH CHECK (
    uploader_id = public.current_profile_id()
    AND EXISTS (
      SELECT 1 FROM public.blood_requests
      WHERE id = request_id
        AND requester_id = public.current_profile_id()
    )
  );

-- UPDATE POLICY:
-- Only authorized reviewers (Moderators/Admins or affiliated Hospital Staff) can update status, reason, notes.
-- Requesters CANNOT update verification documents (must upload new version).
DROP POLICY IF EXISTS "Reviewers update verification status" ON public.verification_documents;
CREATE POLICY "Reviewers update verification status" ON public.verification_documents
  FOR UPDATE USING (
    public.is_moderator_or_admin()
    OR public.is_affiliated_hospital_staff(request_id)
  );

-- 6. PRIVATE SUPABASE STORAGE BUCKET CONFIGURATION
-- Bucket is explicitly PRIVATE (public = false)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'medical_prescriptions',
  'medical_prescriptions',
  false,
  10485760, -- 10MB maximum file size
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

-- Storage Object Policies
-- Path format: medical_prescriptions/{request_id}/{filename}

-- Upload policy:
DROP POLICY IF EXISTS "Requesters upload prescription objects" ON storage.objects;
CREATE POLICY "Requesters upload prescription objects"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'medical_prescriptions'
  AND EXISTS (
    SELECT 1 FROM public.blood_requests
    WHERE id::text = (storage.foldername(name))[1]
      AND requester_id = public.current_profile_id()
  )
);

-- Read policy:
DROP POLICY IF EXISTS "Authorized read prescription objects" ON storage.objects;
CREATE POLICY "Authorized read prescription objects"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'medical_prescriptions'
  AND (
    EXISTS (
      SELECT 1 FROM public.blood_requests
      WHERE id::text = (storage.foldername(name))[1]
        AND requester_id = public.current_profile_id()
    )
    OR public.is_moderator_or_admin()
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.blood_requests r ON r.id::text = (storage.foldername(name))[1]
      WHERE p.id = public.current_profile_id()
        AND p.role = 'HOSPITAL_STAFF'
        AND LOWER(TRIM(p.hospital_affiliation)) = LOWER(TRIM(r.hospital_name))
    )
  )
);
