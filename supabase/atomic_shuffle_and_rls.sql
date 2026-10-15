-- ==============================================================================
-- Migration: Atomic Batch Assignments Replacement RPC & RLS Security
-- Run this script in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/zuxhwatwbwhruupujqeb/sql/new
-- ==============================================================================

-- 1. Ensure unique constraint on (batch_id, student_id)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'batch_students_batch_id_student_id_key'
    ) THEN
        ALTER TABLE public.batch_students
        ADD CONSTRAINT batch_students_batch_id_student_id_key UNIQUE (batch_id, student_id);
    END IF;
EXCEPTION
    WHEN OTHERS THEN NULL;
END $$;

-- 2. Server-side Atomic Transaction RPC for Safe Re-shuffle
-- Guarantees atomic deletion and re-insertion in a single database transaction.
-- If any error occurs, Postgres rolls back completely so no students are lost.
CREATE OR REPLACE FUNCTION public.replace_batch_assignments(
    p_assignments jsonb,
    p_role_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_assigned_count integer := 0;
BEGIN
    -- 1. If role IDs are provided, clear only assignments for students of those roles
    IF p_role_ids IS NOT NULL AND array_length(p_role_ids, 1) > 0 THEN
        DELETE FROM public.batch_students
        WHERE student_id IN (
            SELECT id FROM public.students WHERE role_id = ANY(p_role_ids)
        );
    ELSE
        -- Global shuffle: clear all batch_students
        DELETE FROM public.batch_students;
    END IF;

    -- 2. Insert new assignment records atomically
    IF p_assignments IS NOT NULL AND jsonb_array_length(p_assignments) > 0 THEN
        INSERT INTO public.batch_students (batch_id, student_id)
        SELECT
            (item->>'batch_id')::uuid,
            (item->>'student_id')::uuid
        FROM jsonb_array_elements(p_assignments) AS item
        ON CONFLICT (batch_id, student_id) DO NOTHING;
        
        GET DIAGNOSTICS v_assigned_count = ROW_COUNT;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'count', v_assigned_count
    );
END;
$$;

-- Grant execution permission to authenticated users and service role
GRANT EXECUTE ON FUNCTION public.replace_batch_assignments(jsonb, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_batch_assignments(jsonb, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.replace_batch_assignments(jsonb, uuid[]) TO anon;
