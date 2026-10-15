-- ==============================================================================
-- Fix Row-Level Security (RLS) Policies for Public Student Registration
-- Run this script in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/zuxhwatwbwhruupujqeb/sql/new
-- ==============================================================================

-- 1. Enable RLS on the students table
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;

-- 2. Drop any previous conflicting policies on students table
DROP POLICY IF EXISTS "Allow anon student registration" ON public.students;
DROP POLICY IF EXISTS "Allow public student registration" ON public.students;
DROP POLICY IF EXISTS "Allow authenticated manage students" ON public.students;
DROP POLICY IF EXISTS "Allow authenticated read students" ON public.students;
DROP POLICY IF EXISTS "Allow authenticated insert students" ON public.students;
DROP POLICY IF EXISTS "Allow authenticated update students" ON public.students;
DROP POLICY IF EXISTS "Allow authenticated delete students" ON public.students;

-- 3. Policy: Allow ANYONE (anonymous public students) to INSERT their registration
CREATE POLICY "Allow public student registration"
ON public.students
FOR INSERT
TO public
WITH CHECK (true);

-- 4. Policy: Allow logged-in administrators to VIEW (SELECT) all students
CREATE POLICY "Allow authenticated read students"
ON public.students
FOR SELECT
TO authenticated
USING (true);

-- 5. Policy: Allow logged-in administrators to UPDATE students
CREATE POLICY "Allow authenticated update students"
ON public.students
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- 6. Policy: Allow logged-in administrators to DELETE students
CREATE POLICY "Allow authenticated delete students"
ON public.students
FOR DELETE
TO authenticated
USING (true);


-- ==============================================================================
-- Ensure registration_links and roles are readable by public students
-- ==============================================================================

-- 7. Ensure public can read registration_links to validate tokens
ALTER TABLE public.registration_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read on registration_links" ON public.registration_links;
CREATE POLICY "Allow public read on registration_links"
ON public.registration_links
FOR SELECT
TO public
USING (true);

DROP POLICY IF EXISTS "Allow authenticated manage on registration_links" ON public.registration_links;
CREATE POLICY "Allow authenticated manage on registration_links"
ON public.registration_links
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);


-- 8. Ensure public can read roles to populate role dropdown
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read access on roles" ON public.roles;
CREATE POLICY "Allow public read access on roles"
ON public.roles
FOR SELECT
TO public
USING (true);
