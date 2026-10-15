-- ==============================================================================
-- Comprehensive Row-Level Security (RLS) Policies for all system tables
-- Run this script in the Supabase SQL Editor if any other tables encounter RLS errors
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. ROLES TABLE
-- ------------------------------------------------------------------------------
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read access on roles" ON public.roles;
DROP POLICY IF EXISTS "Allow authenticated insert on roles" ON public.roles;
DROP POLICY IF EXISTS "Allow authenticated update on roles" ON public.roles;
DROP POLICY IF EXISTS "Allow authenticated delete on roles" ON public.roles;

CREATE POLICY "Allow public read access on roles"
ON public.roles FOR SELECT TO public USING (true);

CREATE POLICY "Allow authenticated insert on roles"
ON public.roles FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated update on roles"
ON public.roles FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow authenticated delete on roles"
ON public.roles FOR DELETE TO authenticated USING (true);


-- ------------------------------------------------------------------------------
-- 2. REGISTRATION LINKS TABLE
-- ------------------------------------------------------------------------------
ALTER TABLE public.registration_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read on registration_links" ON public.registration_links;
DROP POLICY IF EXISTS "Allow authenticated manage on registration_links" ON public.registration_links;

-- Public can check if link token is valid
CREATE POLICY "Allow public read on registration_links"
ON public.registration_links FOR SELECT TO public USING (true);

-- Authenticated admins can create, update, delete links
CREATE POLICY "Allow authenticated manage on registration_links"
ON public.registration_links FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ------------------------------------------------------------------------------
-- 3. STUDENTS TABLE
-- ------------------------------------------------------------------------------
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anon student registration" ON public.students;
DROP POLICY IF EXISTS "Allow authenticated manage students" ON public.students;

-- Students register via public links (anon or authenticated)
CREATE POLICY "Allow anon student registration"
ON public.students FOR INSERT TO public WITH CHECK (true);

-- Authenticated admins can view, update, and delete students
CREATE POLICY "Allow authenticated manage students"
ON public.students FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ------------------------------------------------------------------------------
-- 4. TRAINERS & BATCHES TABLES (if present)
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'trainers') THEN
    ALTER TABLE public.trainers ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "Allow authenticated manage trainers" ON public.trainers;
    CREATE POLICY "Allow authenticated manage trainers" ON public.trainers FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;

  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'batches') THEN
    ALTER TABLE public.batches ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "Allow authenticated manage batches" ON public.batches;
    CREATE POLICY "Allow authenticated manage batches" ON public.batches FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
