-- ==============================================================================
-- Add Dynamic Form Configuration Support for Registration Links & Students
-- Run this script in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/zuxhwatwbwhruupujqeb/sql/new
-- ==============================================================================

-- 1. Add form_config JSONB column to registration_links table
ALTER TABLE public.registration_links
ADD COLUMN IF NOT EXISTS form_config JSONB DEFAULT '[
  {"id": "name", "name": "Full Name", "type": "text", "required": true, "isDefault": true},
  {"id": "role", "name": "Role", "type": "dropdown", "required": true, "isDefault": true}
]'::jsonb;

-- 2. Add extra_fields JSONB column to students table to store custom field submissions
ALTER TABLE public.students
ADD COLUMN IF NOT EXISTS extra_fields JSONB DEFAULT '{}'::jsonb;

-- 2b. Add index on token for fast exact and prefix lookups (/r/:shortCode)
CREATE INDEX IF NOT EXISTS idx_registration_links_token ON public.registration_links (token);

-- 3. Ensure Row-Level Security (RLS) allows public to read form_config on active links
ALTER TABLE public.registration_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read on registration_links" ON public.registration_links;
CREATE POLICY "Allow public read on registration_links"
ON public.registration_links
FOR SELECT
TO public
USING (true);

DROP POLICY IF EXISTS "Allow authenticated manage registration_links" ON public.registration_links;
CREATE POLICY "Allow authenticated manage registration_links"
ON public.registration_links
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- 4. Ensure Row-Level Security (RLS) allows public to insert student registrations for active links
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public student registration" ON public.students;
DROP POLICY IF EXISTS "Allow public insert with valid registration link" ON public.students;

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

-- 5. Backfill existing active registration link with its 5 customized fields
UPDATE public.registration_links
SET form_config = '[
  {"id": "name", "name": "Full Name", "type": "text", "required": true, "isDefault": true},
  {"id": "role", "name": "Role", "type": "dropdown", "required": true, "isDefault": true},
  {"id": "phone", "name": "Phone Number", "type": "tel", "required": true, "isDefault": false},
  {"id": "email", "name": "Email Address", "type": "email", "required": true, "isDefault": false},
  {"id": "college", "name": "College / University", "type": "text", "required": true, "isDefault": false}
]'::jsonb
WHERE token = '497cc4d75244411fcececcae0b93c04c3e2b12e9232b95f6a2ed22d3f5b0ffaf';
