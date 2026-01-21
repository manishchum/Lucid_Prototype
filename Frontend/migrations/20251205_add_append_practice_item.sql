-- Create a helper RPC to atomically append a JSONB practice item into chatbot_user_interactions.practice
-- Run this on your Supabase (Postgres) instance as a SQL migration.

create or replace function public.append_practice_item(p_user uuid, p_item jsonb)
returns void
language plpgsql
security definer
as $$
begin
  insert into public.chatbot_user_interactions(user_id, practice, created_at, updated_at)
  values (p_user, jsonb_build_array(p_item), now(), now())
  on conflict (user_id) do
    update set practice = coalesce(practice, '[]'::jsonb) || jsonb_build_array(p_item), updated_at = now();
end;
$$;
