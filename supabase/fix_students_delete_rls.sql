-- ==============================================================================
-- Fix Row-Level Security (RLS) Policy for Students Table Deletion
-- Run this in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/zuxhwatwbwhruupujqeb/sql/new
-- ==============================================================================

-- 1. Ensure RLS is enabled on public.students
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;

-- 2. Drop any previous conflicting DELETE policies on students table
DROP POLICY IF EXISTS "Allow authenticated delete students" ON public.students;
DROP POLICY IF EXISTS "Allow authenticated manage students" ON public.students;

-- 3. Policy: Allow logged-in administrators (authenticated users) to DELETE students
CREATE POLICY "Allow authenticated delete students"
ON public.students
FOR DELETE
TO authenticated
USING (true);

-- 4. Policy: Allow logged-in administrators to UPDATE students if needed
DROP POLICY IF EXISTS "Allow authenticated update students" ON public.students;
CREATE POLICY "Allow authenticated update students"
ON public.students
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- 5. Ensure batch_students also has explicit DELETE policy for authenticated admins
ALTER TABLE public.batch_students ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated delete on batch_students" ON public.batch_students;
CREATE POLICY "Allow authenticated delete on batch_students"
ON public.batch_students
FOR DELETE
TO authenticated
USING (true);

-- ==============================================================================
-- Verification Query: Check that the policies exist
-- ==============================================================================
SELECT tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('students', 'batch_students');
