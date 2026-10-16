-- ==============================================================================
-- Migration: Fix Duplicate Registration Validation
-- 1. Student Name CAN be duplicated across same or different courses.
-- 2. Email Address MUST be globally unique (case-insensitive & trimmed).
-- 3. Database-level validation with unique indexes, advisory locking, and trigger.
--
-- Run this script in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/zuxhwatwbwhruupujqeb/sql/new
-- ==============================================================================

-- Step 1: Ensure public.students has email column
ALTER TABLE public.students
ADD COLUMN IF NOT EXISTS email TEXT;

-- Step 2: Backfill email column from extra_fields for existing students
UPDATE public.students
SET email = lower(trim(
  COALESCE(
    extra_fields->>'email',
    extra_fields->>'Email',
    extra_fields->>'email_address',
    extra_fields->>'Email Address',
    (
      SELECT kv.value
      FROM jsonb_each_text(COALESCE(extra_fields, '{}'::jsonb)) kv
      WHERE kv.value ~* '^[^\s@]+@[^\s@]+\.[^\s@]+$'
      LIMIT 1
    )
  )
))
WHERE email IS NULL OR email = '';

-- Step 3: Create unique index on lower(trim(email)) to prevent duplicate emails
CREATE UNIQUE INDEX IF NOT EXISTS idx_students_unique_email
ON public.students (lower(trim(email)))
WHERE email IS NOT NULL AND trim(email) <> '';

-- Step 3b: Create functional unique index on lower(trim(extra_fields->>'email'))
CREATE UNIQUE INDEX IF NOT EXISTS idx_students_unique_extra_fields_email
ON public.students (lower(trim(extra_fields->>'email')))
WHERE extra_fields->>'email' IS NOT NULL AND trim(extra_fields->>'email') <> '';

-- Step 4: Database Trigger to enforce case-insensitive email uniqueness and normalization on direct inserts
CREATE OR REPLACE FUNCTION public.trg_enforce_student_email_unique()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_extracted_email text;
  v_existing_id uuid;
BEGIN
  -- 1. Determine clean email from direct column or extra_fields
  v_extracted_email := lower(trim(COALESCE(
    NEW.email,
    NEW.extra_fields->>'email',
    NEW.extra_fields->>'Email',
    NEW.extra_fields->>'email_address',
    NEW.extra_fields->>'Email Address',
    (
      SELECT kv.value
      FROM jsonb_each_text(COALESCE(NEW.extra_fields, '{}'::jsonb)) kv
      WHERE kv.value ~* '^[^\s@]+@[^\s@]+\.[^\s@]+$'
      LIMIT 1
    )
  )));

  IF v_extracted_email IS NOT NULL AND v_extracted_email <> '' THEN
    NEW.email := v_extracted_email;

    -- Ensure extra_fields also has the normalized email
    IF NEW.extra_fields IS NOT NULL AND NEW.extra_fields ? 'email' THEN
      NEW.extra_fields := jsonb_set(NEW.extra_fields, '{email}', to_jsonb(v_extracted_email));
    END IF;

    -- Check if another student row already has this email (case-insensitive)
    SELECT id INTO v_existing_id
    FROM public.students
    WHERE id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND (
        lower(trim(COALESCE(email, ''))) = v_extracted_email
        OR lower(trim(COALESCE(extra_fields->>'email', ''))) = v_extracted_email
        OR lower(trim(COALESCE(extra_fields->>'Email Address', ''))) = v_extracted_email
        OR lower(trim(COALESCE(extra_fields->>'email_address', ''))) = v_extracted_email
      )
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      RAISE EXCEPTION 'This email address is already registered. Please use a different email address.'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_students_email_unique_check ON public.students;
CREATE TRIGGER trg_students_email_unique_check
BEFORE INSERT OR UPDATE ON public.students
FOR EACH ROW
EXECUTE FUNCTION public.trg_enforce_student_email_unique();


-- Step 5: Secure Server-Side Registration Function (RPC)
-- 1. Permits multiple students with the exact same Full Name across any courses.
-- 2. Strictly enforces unique, case-insensitive, trimmed email addresses.
-- 3. Employs pg_advisory_xact_lock to handle concurrent registrations safely.
CREATE OR REPLACE FUNCTION public.register_student(
  p_token text,
  p_name text,
  p_role_id uuid,
  p_extra_fields jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_link record;
  v_role record;
  v_student_id uuid;
  v_clean_token text := trim(COALESCE(p_token, ''));
  v_clean_name text := trim(COALESCE(p_name, ''));
  v_clean_email text := '';
  v_email_exists boolean := false;
  v_has_extra_col boolean := false;
  v_has_email_col boolean := false;
  v_composite_name text;
BEGIN
  -- A. Validate registration token input
  IF v_clean_token = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INVALID_TOKEN',
      'error', 'Registration token or short code is required.'
    );
  END IF;

  -- B. Validate student name (minimum length; duplicates are completely allowed)
  IF length(v_clean_name) < 2 THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INVALID_NAME',
      'error', 'Student name must be at least 2 characters.'
    );
  END IF;

  -- C. Resolve and validate registration link (exact match first, then prefix match for short codes)
  SELECT * INTO v_link
  FROM public.registration_links
  WHERE token = v_clean_token
  LIMIT 1;

  IF v_link.id IS NULL AND length(v_clean_token) >= 6 THEN
    SELECT * INTO v_link
    FROM public.registration_links
    WHERE token ILIKE (v_clean_token || '%')
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  IF v_link.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'LINK_NOT_FOUND',
      'error', 'This registration link does not exist or has been removed.'
    );
  END IF;

  IF v_link.is_active IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'LINK_INACTIVE',
      'error', 'This registration link has been deactivated by the administrator.'
    );
  END IF;

  IF v_link.expires_at IS NOT NULL AND v_link.expires_at <= now() THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'LINK_EXPIRED',
      'error', 'This registration link has expired. Registrations are closed.'
    );
  END IF;

  -- D. Validate course / role exists and is not an internal system role
  SELECT * INTO v_role
  FROM public.roles
  WHERE id = p_role_id
    AND NOT (role_name LIKE 'SYS_%' OR role_name LIKE '__SYS%')
  LIMIT 1;

  IF v_role.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'ROLE_NOT_FOUND',
      'error', 'Selected course does not exist.'
    );
  END IF;

  -- E. Extract and normalize email address (case-insensitive & trimmed)
  v_clean_email := lower(trim(COALESCE(
    p_extra_fields->>'email',
    p_extra_fields->>'Email',
    p_extra_fields->>'email_address',
    p_extra_fields->>'Email Address',
    (
      SELECT kv.value
      FROM jsonb_each_text(COALESCE(p_extra_fields, '{}'::jsonb)) kv
      WHERE kv.value ~* '^[^\s@]+@[^\s@]+\.[^\s@]+$'
      LIMIT 1
    ),
    ''
  )));

  -- F. Concurrency Protection & Email Uniqueness Check
  -- Advisory transaction lock prevents concurrent requests from registering the exact same email simultaneously
  IF v_clean_email <> '' THEN
    PERFORM pg_advisory_xact_lock(hashtext(v_clean_email));

    SELECT EXISTS (
      SELECT 1 FROM public.students
      WHERE (
        lower(trim(COALESCE(email, ''))) = v_clean_email
        OR lower(trim(COALESCE(extra_fields->>'email', ''))) = v_clean_email
        OR lower(trim(COALESCE(extra_fields->>'Email', ''))) = v_clean_email
        OR lower(trim(COALESCE(extra_fields->>'email_address', ''))) = v_clean_email
        OR lower(trim(COALESCE(extra_fields->>'Email Address', ''))) = v_clean_email
        OR EXISTS (
          SELECT 1 FROM jsonb_each_text(COALESCE(extra_fields, '{}'::jsonb)) kv
          WHERE lower(trim(kv.value)) = v_clean_email
        )
      )
    ) INTO v_email_exists;

    IF v_email_exists THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'EMAIL_ALREADY_REGISTERED',
        'error', 'This email address is already registered. Please use a different email address.'
      );
    END IF;
  END IF;

  -- G. Check column availability in public.students
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'students'
      AND column_name = 'extra_fields'
  ) INTO v_has_extra_col;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'students'
      AND column_name = 'email'
  ) INTO v_has_email_col;

  -- H. Insert student record into public.students
  BEGIN
    IF v_has_extra_col AND v_has_email_col THEN
      INSERT INTO public.students (name, role_id, registration_link_id, extra_fields, email)
      VALUES (
        v_clean_name,
        p_role_id,
        v_link.id,
        COALESCE(p_extra_fields, '{}'::jsonb),
        NULLIF(v_clean_email, '')
      )
      RETURNING id INTO v_student_id;
    ELSIF v_has_extra_col THEN
      INSERT INTO public.students (name, role_id, registration_link_id, extra_fields)
      VALUES (
        v_clean_name,
        p_role_id,
        v_link.id,
        COALESCE(p_extra_fields, '{}'::jsonb)
      )
      RETURNING id INTO v_student_id;
    ELSE
      -- Fallback if extra_fields column is not yet present
      IF p_extra_fields IS NOT NULL AND p_extra_fields <> '{}'::jsonb THEN
        v_composite_name := v_clean_name || ' (' || (
          SELECT string_agg(key || ': ' || (value #>> '{}'), ' | ')
          FROM jsonb_each(p_extra_fields)
          WHERE value #>> '{}' <> ''
        ) || ')';
      ELSE
        v_composite_name := v_clean_name;
      END IF;

      INSERT INTO public.students (name, role_id, registration_link_id)
      VALUES (v_composite_name, p_role_id, v_link.id)
      RETURNING id INTO v_student_id;
    END IF;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'EMAIL_ALREADY_REGISTERED',
      'error', 'This email address is already registered. Please use a different email address.'
    );
  END;

  -- I. Return success payload
  RETURN jsonb_build_object(
    'success', true,
    'student_id', v_student_id,
    'role_id', p_role_id,
    'link_id', v_link.id,
    'message', 'Registration submitted successfully.'
  );
END;
$$;

-- Grant execution permission to public anonymous, authenticated users, and service role
GRANT EXECUTE ON FUNCTION public.register_student(text, text, uuid, jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.register_student(text, text, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_student(text, text, uuid, jsonb) TO service_role;
