-- ==============================================================================
-- LIFE DROP: SUPABASE COMPATIBILITY SHIM FOR VANILLA POSTGRESQL TESTING
-- ==============================================================================
-- Purpose:
--   Enables executing Life Drop Supabase migrations in order on a disposable,
--   vanilla PostgreSQL 15/16 instance (e.g. local Docker or CI test container)
--   WITHOUT requiring Supabase proprietary services or hosted infrastructure.
--
-- Components mocked:
--   1. auth schema & auth.jwt(), auth.uid(), auth.role()
--   2. storage schema & storage.buckets, storage.objects, storage.foldername()
-- ==============================================================================

-- 1. AUTH SCHEMA & FUNCTIONS
CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid() 
RETURNS uuid AS $$
  SELECT '00000000-0000-0000-0000-000000000001'::uuid;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION auth.jwt() 
RETURNS jsonb AS $$
  SELECT jsonb_build_object(
    'sub', 'test_clerk_sub_001',
    'role', 'authenticated',
    'email', 'test_user@lifedrop.example'
  );
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION auth.role() 
RETURNS text AS $$
  SELECT 'authenticated'::text;
$$ LANGUAGE sql STABLE;

-- 2. STORAGE SCHEMA, TABLES & FUNCTIONS
CREATE SCHEMA IF NOT EXISTS storage;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner UUID,
  created_at TIMESTAMPTZ DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ DEFAULT timezone('utc', now()),
  public BOOLEAN DEFAULT false,
  avif_autodetection BOOLEAN DEFAULT false,
  file_size_limit BIGINT,
  allowed_mime_types TEXT[],
  owner_id TEXT
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id TEXT REFERENCES storage.buckets(id),
  name TEXT,
  owner UUID,
  created_at TIMESTAMPTZ DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ DEFAULT timezone('utc', now()),
  last_accessed_at TIMESTAMPTZ DEFAULT timezone('utc', now()),
  metadata JSONB DEFAULT '{}'::jsonb,
  path_tokens TEXT[] GENERATED ALWAYS AS (string_to_array(name, '/')) STORED
);

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION storage.foldername(name text)
RETURNS text[] AS $$
  SELECT string_to_array(name, '/');
$$ LANGUAGE sql IMMUTABLE;

-- Comment indicating shim initialized
COMMENT ON SCHEMA auth IS 'Life Drop test compatibility mock for Supabase Auth';
COMMENT ON SCHEMA storage IS 'Life Drop test compatibility mock for Supabase Storage';
