-- Migration: create append_ask_doubt_qna RPC

CREATE OR REPLACE FUNCTION append_ask_doubt_qna(p_user uuid, p_question text, p_answer text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO chatbot_user_interactions (user_id, ask_doubt, created_at, updated_at)
  VALUES (
    p_user,
    jsonb_build_array(jsonb_build_object('question', p_question, 'answer', p_answer)),
    now(),
    now()
  )
  ON CONFLICT (user_id) DO UPDATE
    SET ask_doubt = chatbot_user_interactions.ask_doubt || jsonb_build_array(jsonb_build_object('question', p_question, 'answer', p_answer)),
        updated_at = now();
END;
$$;
