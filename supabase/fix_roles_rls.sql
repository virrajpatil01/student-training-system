-- ==============================================================================
-- Fix Row-Level Security (RLS) Policies for the "roles" table
-- Run this script in the Supabase SQL Editor:
-- https://supabase.com/dashboard/project/zuxhwatwbwhruupujqeb/sql/new
-- ==============================================================================

-- 1. Ensure RLS is enabled on the roles table
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;

-- 2. Remove any existing conflicting policies on the roles table
DROP POLICY IF EXISTS "Allow public read access on roles" ON public.roles;
DROP POLICY IF EXISTS "Allow authenticated insert on roles" ON public.roles;
DROP POLICY IF EXISTS "Allow authenticated update on roles" ON public.roles;
DROP POLICY IF EXISTS "Allow authenticated delete on roles" ON public.roles;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.roles;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public.roles;
DROP POLICY IF EXISTS "Enable update for authenticated users only" ON public.roles;
DROP POLICY IF EXISTS "Enable delete for authenticated users only" ON public.roles;
DROP POLICY IF EXISTS "roles_read_policy" ON public.roles;
DROP POLICY IF EXISTS "roles_insert_policy" ON public.roles;
DROP POLICY IF EXISTS "roles_update_policy" ON public.roles;
DROP POLICY IF EXISTS "roles_delete_policy" ON public.roles;

-- 3. Policy: Allow EVERYONE (authenticated admins + anonymous students) to read roles
-- (Needed so students can see and select available roles in the registration form)
CREATE POLICY "Allow public read access on roles"
ON public.roles
FOR SELECT
TO public
USING (true);

-- 4. Policy: Allow logged-in administrators to INSERT new roles
CREATE POLICY "Allow authenticated insert on roles"
ON public.roles
FOR INSERT
TO authenticated
WITH CHECK (true);

-- 5. Policy: Allow logged-in administrators to UPDATE roles
CREATE POLICY "Allow authenticated update on roles"
ON public.roles
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- 6. Policy: Allow logged-in administrators to DELETE roles
CREATE POLICY "Allow authenticated delete on roles"
ON public.roles
FOR DELETE
TO authenticated
USING (true);
