-- Migration: Enable RLS on missed tables
-- Purpose: Enable RLS on notifications and module_chat_conversations
BEGIN;

-- Enable RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.module_chat_conversations ENABLE ROW LEVEL SECURITY;

-- Notifications policies
DROP POLICY IF EXISTS rls_notifications_select ON public.notifications;
DROP POLICY IF EXISTS rls_notifications_insert ON public.notifications;
DROP POLICY IF EXISTS rls_notifications_update ON public.notifications;
DROP POLICY IF EXISTS rls_notifications_delete ON public.notifications;

CREATE POLICY rls_notifications_select ON public.notifications
FOR SELECT USING (user_id = public.current_app_user_id());

CREATE POLICY rls_notifications_insert ON public.notifications
FOR INSERT WITH CHECK (user_id = public.current_app_user_id());

CREATE POLICY rls_notifications_update ON public.notifications
FOR UPDATE USING (user_id = public.current_app_user_id())
WITH CHECK (user_id = public.current_app_user_id());

CREATE POLICY rls_notifications_delete ON public.notifications
FOR DELETE USING (user_id = public.current_app_user_id());


-- Module Chat Conversations policies
DROP POLICY IF EXISTS rls_chat_conv_select ON public.module_chat_conversations;
DROP POLICY IF EXISTS rls_chat_conv_insert ON public.module_chat_conversations;
DROP POLICY IF EXISTS rls_chat_conv_update ON public.module_chat_conversations;
DROP POLICY IF EXISTS rls_chat_conv_delete ON public.module_chat_conversations;

CREATE POLICY rls_chat_conv_select ON public.module_chat_conversations
FOR SELECT USING (user_id = public.current_app_user_id());

CREATE POLICY rls_chat_conv_insert ON public.module_chat_conversations
FOR INSERT WITH CHECK (user_id = public.current_app_user_id());

CREATE POLICY rls_chat_conv_update ON public.module_chat_conversations
FOR UPDATE USING (user_id = public.current_app_user_id())
WITH CHECK (user_id = public.current_app_user_id());

CREATE POLICY rls_chat_conv_delete ON public.module_chat_conversations
FOR DELETE USING (user_id = public.current_app_user_id());

COMMIT;
