-- ==============================================================================
-- Add Course Target Capacity and Details Support for "roles" table
-- Run this script in the Supabase SQL Editor:
-- https://supabase.com/dashboard/project/zuxhwatwbwhruupujqeb/sql/new
-- ==============================================================================

-- 1. Add capacity column (default target seats per course, e.g. 40)
ALTER TABLE public.roles
ADD COLUMN IF NOT EXISTS capacity INTEGER DEFAULT 40;

-- 2. Add description column (course syllabus, details, notes)
ALTER TABLE public.roles
ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';

-- 3. Update existing roles to have a default capacity of 40 if null
UPDATE public.roles
SET capacity = 40
WHERE capacity IS NULL;

-- 4. Verify columns
SELECT id, role_name, capacity, description, created_at
FROM public.roles
LIMIT 5;
