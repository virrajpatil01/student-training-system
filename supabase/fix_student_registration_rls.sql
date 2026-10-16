-- ==============================================================================
-- Secure Row-Level Security (RLS) & Server-Side Validation for Student Registration
-- Run this script in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/zuxhwatwbwhruupujqeb/sql/new
-- ==============================================================================

-- 1. Ensure students table has extra_fields column for custom form builder fields
ALTER TABLE public.students
ADD COLUMN IF NOT EXISTS extra_fields JSONB DEFAULT '{}'::jsonb;

-- Ensure index on registration_link_id for fast RLS policy subqueries
CREATE INDEX IF NOT EXISTS idx_students_registration_link_id
ON public.students (registration_link_id);

CREATE INDEX IF NOT EXISTS idx_registration_links_token
ON public.registration_links (token);


-- 2. Enable Row-Level Security (RLS) on all relevant tables
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registration_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;


-- 3. Drop any outdated, insecure, or unrestricted policies on students
DROP POLICY IF EXISTS "Allow anon student registration" ON public.students;
DROP POLICY IF EXISTS "Allow public student registration" ON public.students;
DROP POLICY IF EXISTS "Allow public insert with valid registration link" ON public.students;
DROP POLICY IF EXISTS "Allow authenticated manage students" ON public.students;
DROP POLICY IF EXISTS "Allow authenticated read students" ON public.students;
DROP POLICY IF EXISTS "Allow authenticated insert students" ON public.students;
DROP POLICY IF EXISTS "Allow authenticated update students" ON public.students;
DROP POLICY IF EXISTS "Allow authenticated delete students" ON public.students;


-- 4. STRICT INSERT POLICY: Never WITH CHECK (true).
-- Legitimate public registrations are permitted ONLY when linked to an active, non-expired registration link.
CREATE POLICY "Allow public insert with valid registration link"
ON public.students
FOR INSERT
TO public
WITH CHECK (
  registration_link_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.registration_links rl
    WHERE rl.id = registration_link_id
      AND rl.is_active = true
      AND (rl.expires_at IS NULL OR rl.expires_at > now())
  )
);


-- 5. ADMIN POLICY: Logged-in administrators have full access to view, update, and manage students
CREATE POLICY "Allow authenticated manage students"
ON public.students
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);


-- 6. Ensure public can read active registration links (needed for link validation and RLS checks)
DROP POLICY IF EXISTS "Allow public read on registration_links" ON public.registration_links;
DROP POLICY IF EXISTS "Allow authenticated manage on registration_links" ON public.registration_links;

CREATE POLICY "Allow public read on registration_links"
ON public.registration_links
FOR SELECT
TO public
USING (true);

CREATE POLICY "Allow authenticated manage on registration_links"
ON public.registration_links
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);


-- 7. Ensure public can read roles to populate course selection dropdowns
DROP POLICY IF EXISTS "Allow public read access on roles" ON public.roles;
DROP POLICY IF EXISTS "Allow authenticated manage roles" ON public.roles;

CREATE POLICY "Allow public read access on roles"
ON public.roles
FOR SELECT
TO public
USING (true);

CREATE POLICY "Allow authenticated manage roles"
ON public.roles
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);


-- ==============================================================================
-- 8. SECURE SERVER-SIDE REGISTRATION FUNCTION (RPC)
-- ==============================================================================
-- Eliminates Code 42501 (caused by RETURNING clause evaluating SELECT policy on anon)
-- Validates token, expiry, active status, course existence, and duplicate registration.
-- Executes with SECURITY DEFINER so it can return the new student_id safely.

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
  v_has_extra_col boolean;
  v_composite_name text;
  v_clean_email text := '';
  v_duplicate_exists boolean;
BEGIN
  -- A. Validate registration token input
  IF v_clean_token = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INVALID_TOKEN',
      'error', 'Registration token or short code is required.'
    );
  END IF;

  -- B. Validate student name
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
    ) INTO v_duplicate_exists;

    IF v_duplicate_exists THEN
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

  -- H. Insert student record into public.students
  BEGIN
    IF v_has_extra_col THEN
      INSERT INTO public.students (name, role_id, registration_link_id, extra_fields)
      VALUES (v_clean_name, p_role_id, v_link.id, COALESCE(p_extra_fields, '{}'::jsonb))
      RETURNING id INTO v_student_id;
    ELSE
      -- If extra_fields column is not yet present, build composite name fallback
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

  -- G. Return success payload with newly generated student_id and confirmed role_id
  RETURN jsonb_build_object(
    'success', true,
    'student_id', v_student_id,
    'role_id', p_role_id,
    'link_id', v_link.id,
    'message', 'Registration submitted successfully.'
  );
END;
$$;

-- Grant execution permission to anonymous students, authenticated users, and service role
GRANT EXECUTE ON FUNCTION public.register_student(text, text, uuid, jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.register_student(text, text, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_student(text, text, uuid, jsonb) TO service_role;
