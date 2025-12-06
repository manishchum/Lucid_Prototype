-- Create a helper RPC to atomically append a JSONB practice item into chatbot_user_interactions.practice_ques (legacy column)
-- Run this on your Supabase (Postgres) instance as a SQL migration.

create or replace function public.append_practice_ques(p_user uuid, p_item jsonb)
returns void
language plpgsql
security definer
as $$
begin
  insert into public.chatbot_user_interactions(user_id, practice_ques, created_at, updated_at)
  values (p_user, jsonb_build_array(p_item), now(), now())
  on conflict (user_id) do
    update set practice_ques = coalesce(practice_ques, '[]'::jsonb) || jsonb_build_array(p_item), updated_at = now();
end;
$$;
