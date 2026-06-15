-- Migration: Allow company admins to upload to content library under RLS
-- Created: 2026-04-15
-- Purpose: Remove dependence on service-role for content uploads and enforce company-scoped paths.

BEGIN;

-- Courses writes should be possible for company admins/super admins under authenticated context.
DROP POLICY IF EXISTS rls_courses_admin_write ON public.courses;
CREATE POLICY rls_courses_admin_write ON public.courses
FOR ALL USING (
  public.is_company_admin(public.current_app_company_id())
  OR public.is_super_admin()
)
WITH CHECK (
  public.is_company_admin(public.current_app_company_id())
  OR public.is_super_admin()
);

-- Storage policies for `content library` bucket, scoped to company-prefixed object paths.
DROP POLICY IF EXISTS rls_content_library_admin_read ON storage.objects;
DROP POLICY IF EXISTS rls_content_library_admin_insert ON storage.objects;
DROP POLICY IF EXISTS rls_content_library_admin_update ON storage.objects;
DROP POLICY IF EXISTS rls_content_library_admin_delete ON storage.objects;

CREATE POLICY rls_content_library_admin_read ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'content library'
  AND (
    public.is_super_admin()
    OR (
      public.current_app_company_id() IS NOT NULL
      AND name LIKE (public.current_app_company_id()::text || '/%')
      AND public.is_company_admin(public.current_app_company_id())
    )
  )
);

CREATE POLICY rls_content_library_admin_insert ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'content library'
  AND (
    public.is_super_admin()
    OR (
      public.current_app_company_id() IS NOT NULL
      AND name LIKE (public.current_app_company_id()::text || '/uploads/%')
      AND public.is_company_admin(public.current_app_company_id())
    )
  )
);

CREATE POLICY rls_content_library_admin_update ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'content library'
  AND (
    public.is_super_admin()
    OR (
      public.current_app_company_id() IS NOT NULL
      AND name LIKE (public.current_app_company_id()::text || '/%')
      AND public.is_company_admin(public.current_app_company_id())
    )
  )
)
WITH CHECK (
  bucket_id = 'content library'
  AND (
    public.is_super_admin()
    OR (
      public.current_app_company_id() IS NOT NULL
      AND name LIKE (public.current_app_company_id()::text || '/%')
      AND public.is_company_admin(public.current_app_company_id())
    )
  )
);

CREATE POLICY rls_content_library_admin_delete ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'content library'
  AND (
    public.is_super_admin()
    OR (
      public.current_app_company_id() IS NOT NULL
      AND name LIKE (public.current_app_company_id()::text || '/%')
      AND public.is_company_admin(public.current_app_company_id())
    )
  )
);

COMMIT;
