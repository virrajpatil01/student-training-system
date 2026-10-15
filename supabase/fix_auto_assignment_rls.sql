-- ==============================================================================
-- Row-Level Security (RLS) Policies for Automated Batch Assignment
-- Run this script in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/zuxhwatwbwhruupujqeb/sql/new
-- ==============================================================================

-- 1. BATCHES TABLE
ALTER TABLE public.batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read on batches" ON public.batches;
CREATE POLICY "Allow public read on batches"
ON public.batches FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "Allow public insert on batches" ON public.batches;
CREATE POLICY "Allow public insert on batches"
ON public.batches FOR INSERT TO public WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public update on batches" ON public.batches;
CREATE POLICY "Allow public update on batches"
ON public.batches FOR UPDATE TO public USING (true) WITH CHECK (true);

-- 2. BATCH_STUDENTS TABLE
ALTER TABLE public.batch_students ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read on batch_students" ON public.batch_students;
CREATE POLICY "Allow public read on batch_students"
ON public.batch_students FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "Allow public insert on batch_students" ON public.batch_students;
CREATE POLICY "Allow public insert on batch_students"
ON public.batch_students FOR INSERT TO public WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public delete on batch_students" ON public.batch_students;
CREATE POLICY "Allow public delete on batch_students"
ON public.batch_students FOR DELETE TO public USING (true);
