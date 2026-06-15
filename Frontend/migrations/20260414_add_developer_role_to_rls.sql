-- Migration: Add DEVELOPER role to super admin privileges in RLS
-- Created: 2026-04-14
-- Purpose: The application layer treats DEVELOPER (level 6) as having full cross-tenant 
-- access alongside SUPER_ADMIN (level 4). The baseline RLS policies need to reflect this 
-- so that RLS does not block legitimate developer operations.

BEGIN;

-- Update is_super_admin to include DEVELOPER
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_role_assignments ura
    JOIN public.roles r ON r.role_id = ura.role_id
    WHERE ura.user_id = public.current_app_user_id()
      AND ura.is_active = true
      AND (ura.expires_at IS NULL OR ura.expires_at > now())
      AND r.name IN ('SUPER_ADMIN', 'DEVELOPER')
  );
$$;

-- Update is_company_admin to include DEVELOPER
CREATE OR REPLACE FUNCTION public.is_company_admin(target_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_role_assignments ura
    JOIN public.roles r ON r.role_id = ura.role_id
    WHERE ura.user_id = public.current_app_user_id()
      AND ura.is_active = true
      AND (ura.expires_at IS NULL OR ura.expires_at > now())
      AND (
        (ura.scope_type = 'COMPANY' AND ura.scope_id = target_company_id)
        OR r.name IN ('SUPER_ADMIN', 'DEVELOPER')
      )
      AND r.name IN ('CEO', 'SUPER_ADMIN', 'ADMIN', 'DEVELOPER')
  );
$$;

COMMIT;
