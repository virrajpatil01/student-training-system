-- ==============================================================================
-- Row-Level Security (RLS) Policies for batch_students table
-- Run this script in the Supabase SQL Editor if needed:
-- https://supabase.com/dashboard/project/zuxhwatwbwhruupujqeb/sql/new
-- ==============================================================================

ALTER TABLE public.batch_students ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated read on batch_students" ON public.batch_students;
DROP POLICY IF EXISTS "Allow authenticated insert on batch_students" ON public.batch_students;
DROP POLICY IF EXISTS "Allow authenticated delete on batch_students" ON public.batch_students;

CREATE POLICY "Allow authenticated read on batch_students"
ON public.batch_students
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Allow authenticated insert on batch_students"
ON public.batch_students
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Allow authenticated delete on batch_students"
ON public.batch_students
FOR DELETE
TO authenticated
USING (true);
