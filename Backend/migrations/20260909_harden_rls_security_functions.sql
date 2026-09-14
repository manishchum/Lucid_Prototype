-- ============================================================================
-- Migration: 20260909_harden_rls_security_functions.sql
-- Description: Harden security definer functions with early NULL exits and
--              safe JSON parsing to eliminate statement timeouts (57014)
--              and JSON syntax errors (22P02).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.current_app_user_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_headers text;
  v_user_id text;
  v_email text;
  v_resolved uuid;
BEGIN
  -- 1. Try auth.uid()
  BEGIN
    v_resolved := auth.uid();
    IF v_resolved IS NOT NULL THEN
      RETURN v_resolved;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- 2. Try request.headers
  BEGIN
    v_headers := current_setting('request.headers', true);
    IF v_headers IS NOT NULL AND v_headers <> '' AND v_headers LIKE '{%' THEN
      v_user_id := COALESCE(
        v_headers::json ->> 'x-user-id',
        v_headers::json ->> 'X-User-ID'
      );
      IF v_user_id IS NOT NULL AND v_user_id <> '' THEN
        RETURN v_user_id::uuid;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- 3. Try email from JWT
  BEGIN
    v_email := auth.jwt() ->> 'email';
    IF v_email IS NOT NULL AND v_email <> '' THEN
      SELECT u.user_id INTO v_resolved
      FROM public.users u
      WHERE lower(u.email) = lower(v_email)
      LIMIT 1;
      IF v_resolved IS NOT NULL THEN
        RETURN v_resolved;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.current_app_company_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_headers text;
  v_comp_id text;
  v_user_id uuid;
  v_resolved uuid;
BEGIN
  -- 1. Try request.headers
  BEGIN
    v_headers := current_setting('request.headers', true);
    IF v_headers IS NOT NULL AND v_headers <> '' AND v_headers LIKE '{%' THEN
      v_comp_id := COALESCE(
        v_headers::json ->> 'x-company-id',
        v_headers::json ->> 'X-Company-ID'
      );
      IF v_comp_id IS NOT NULL AND v_comp_id <> '' THEN
        RETURN v_comp_id::uuid;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- 2. Fall back to current user's company (only if user is known)
  v_user_id := public.current_app_user_id();
  IF v_user_id IS NOT NULL THEN
    SELECT u.company_id INTO v_resolved
    FROM public.users u
    WHERE u.user_id = v_user_id
    LIMIT 1;
    RETURN v_resolved;
  END IF;

  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN public.current_app_user_id() IS NULL THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.user_role_assignments ura
      JOIN public.roles r ON r.role_id = ura.role_id
      WHERE ura.user_id = public.current_app_user_id()
        AND ura.is_active = true
        AND (ura.expires_at IS NULL OR ura.expires_at > now())
        AND r.name IN ('SUPER_ADMIN', 'DEVELOPER')
    )
  END;
$function$;

CREATE OR REPLACE FUNCTION public.is_company_admin(target_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN public.current_app_user_id() IS NULL THEN false
    ELSE EXISTS (
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
    )
  END;
$function$;

CREATE OR REPLACE FUNCTION public.can_access_user(target_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN public.current_app_user_id() IS NULL THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.user_id = target_user_id
        AND (
          u.user_id = public.current_app_user_id()
          OR public.can_access_company(u.company_id)
        )
    )
  END;
$function$;

CREATE OR REPLACE FUNCTION public.can_access_company(target_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN target_company_id IS NULL THEN false
    WHEN public.current_app_user_id() IS NULL AND public.current_app_company_id() IS NULL THEN false
    ELSE (
      target_company_id = public.current_app_company_id()
      OR public.is_company_admin(target_company_id)
      OR public.is_super_admin()
    )
  END;
$function$;
