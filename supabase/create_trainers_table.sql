-- ==============================================================================
-- Trainers Table & Row-Level Security (RLS) Policies
-- Run this script in the Supabase SQL Editor:
-- https://supabase.com/dashboard/project/zuxhwatwbwhruupujqeb/sql/new
-- ==============================================================================

-- 1. Create the trainers table
CREATE TABLE IF NOT EXISTS public.trainers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    specialization TEXT,
    capacity INTEGER NOT NULL DEFAULT 30,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Enable Row-Level Security (RLS) on trainers
ALTER TABLE public.trainers ENABLE ROW LEVEL SECURITY;

-- 3. Drop existing policies to ensure clean state
DROP POLICY IF EXISTS "Allow authenticated read on trainers" ON public.trainers;
DROP POLICY IF EXISTS "Allow authenticated insert on trainers" ON public.trainers;
DROP POLICY IF EXISTS "Allow authenticated update on trainers" ON public.trainers;
DROP POLICY IF EXISTS "Allow authenticated delete on trainers" ON public.trainers;

-- 4. Policy: Allow logged-in administrators to SELECT trainers
CREATE POLICY "Allow authenticated read on trainers"
ON public.trainers
FOR SELECT
TO authenticated
USING (true);

-- 5. Policy: Allow logged-in administrators to INSERT new trainers
CREATE POLICY "Allow authenticated insert on trainers"
ON public.trainers
FOR INSERT
TO authenticated
WITH CHECK (true);

-- 6. Policy: Allow logged-in administrators to UPDATE trainers
CREATE POLICY "Allow authenticated update on trainers"
ON public.trainers
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- 7. Policy: Allow logged-in administrators to DELETE trainers
CREATE POLICY "Allow authenticated delete on trainers"
ON public.trainers
FOR DELETE
TO authenticated
USING (true);
