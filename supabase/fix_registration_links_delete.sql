-- ==============================================================================
-- Fix Foreign Key Constraint & Deletion for Registration Links and Students
-- Run this script in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/zuxhwatwbwhruupujqeb/sql/new
-- ==============================================================================

-- 1. FIX FOREIGN KEY CONSTRAINT:
-- By default, PostgreSQL prevents deleting a registration link if students registered through it.
-- Changing it to ON DELETE SET NULL allows deleting intake links safely while keeping student records intact!
ALTER TABLE public.students
DROP CONSTRAINT IF EXISTS students_registration_link_id_fkey;

ALTER TABLE public.students
ADD CONSTRAINT students_registration_link_id_fkey
FOREIGN KEY (registration_link_id)
REFERENCES public.registration_links(id)
ON DELETE SET NULL;

-- 2. ALLOW AUTHENTICATED ADMINISTRATORS TO DELETE & UPDATE STUDENTS:
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated delete students" ON public.students;
CREATE POLICY "Allow authenticated delete students"
ON public.students FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow authenticated update students" ON public.students;
CREATE POLICY "Allow authenticated update students"
ON public.students FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- 3. ENSURE REGISTRATION LINKS CAN BE DELETED BY AUTHENTICATED ADMINS:
ALTER TABLE public.registration_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated delete on registration_links" ON public.registration_links;
CREATE POLICY "Allow authenticated delete on registration_links"
ON public.registration_links FOR DELETE TO authenticated USING (true);

-- 4. ENSURE BATCH STUDENTS CAN BE DELETED BY AUTHENTICATED ADMINS:
ALTER TABLE public.batch_students ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated delete on batch_students" ON public.batch_students;
CREATE POLICY "Allow authenticated delete on batch_students"
ON public.batch_students FOR DELETE TO authenticated USING (true);
