-- ==============================================================================
-- Add Form Builder Support for Custom Registration Forms
-- Run this script in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/zuxhwatwbwhruupujqeb/sql/new
-- ==============================================================================

-- 1. Add form_config to registration_links table
ALTER TABLE public.registration_links
ADD COLUMN IF NOT EXISTS form_config JSONB DEFAULT '[
  {"id": "name", "name": "Name", "type": "text", "required": true, "isDefault": true},
  {"id": "role", "name": "Role", "type": "dropdown", "required": true, "isDefault": true}
]'::jsonb;

-- 2. Add extra_fields to students table to store custom field submissions
ALTER TABLE public.students
ADD COLUMN IF NOT EXISTS extra_fields JSONB DEFAULT '{}'::jsonb;
