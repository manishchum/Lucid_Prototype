-- Create a helper RPC to atomically append a JSONB message into chatbot_user_interactions.chat
-- Run this on your Supabase (Postgres) instance as a SQL migration.

create or replace function public.append_chat_message(p_user uuid, p_message jsonb)
returns void
language plpgsql
security definer
as $$
begin
  insert into public.chatbot_user_interactions(user_id, chat, created_at, updated_at)
  values (p_user, jsonb_build_array(p_message), now(), now())
  on conflict (user_id) do
    update set chat = coalesce(chat, '[]'::jsonb) || jsonb_build_array(p_message), updated_at = now();
end;
$$;
