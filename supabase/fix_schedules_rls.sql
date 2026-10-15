-- ==============================================================================
-- Row-Level Security (RLS) Policies for the "schedules" table
-- Run this script in the Supabase SQL Editor:
-- https://supabase.com/dashboard/project/zuxhwatwbwhruupujqeb/sql/new
-- ==============================================================================

-- 1. Ensure RLS is active on public.schedules
ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;

-- 2. Drop any previous conflicting policies on schedules
DROP POLICY IF EXISTS "Allow authenticated read on schedules" ON public.schedules;
DROP POLICY IF EXISTS "Allow authenticated insert on schedules" ON public.schedules;
DROP POLICY IF EXISTS "Allow authenticated update on schedules" ON public.schedules;
DROP POLICY IF EXISTS "Allow authenticated delete on schedules" ON public.schedules;

-- 3. Policy: Allow logged-in administrators to SELECT schedules
CREATE POLICY "Allow authenticated read on schedules"
ON public.schedules
FOR SELECT
TO authenticated
USING (true);

-- 4. Policy: Allow logged-in administrators to INSERT schedules
CREATE POLICY "Allow authenticated insert on schedules"
ON public.schedules
FOR INSERT
TO authenticated
WITH CHECK (true);

-- 5. Policy: Allow logged-in administrators to UPDATE schedules
CREATE POLICY "Allow authenticated update on schedules"
ON public.schedules
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- 6. Policy: Allow logged-in administrators to DELETE schedules
CREATE POLICY "Allow authenticated delete on schedules"
ON public.schedules
FOR DELETE
TO authenticated
USING (true);
