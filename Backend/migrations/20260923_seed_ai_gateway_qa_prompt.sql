-- Migration: Seed ai_features, ai_model_configs, and ai_prompts for Q&A Generation
-- Date: 2026-09-23

DO $$
DECLARE
    v_feature_id UUID;
BEGIN
    -- 1. Get or create feature in ai_features
    SELECT feature_id INTO v_feature_id 
    FROM public.ai_features 
    WHERE feature_key = 'module_chat' 
    LIMIT 1;

    IF v_feature_id IS NULL THEN
        INSERT INTO public.ai_features (feature_key, feature_name, description, is_active)
        VALUES ('module_chat', 'Module Chat RAG', 'Q&A generation and RAG chat assistant for training modules', true)
        RETURNING feature_id INTO v_feature_id;
    END IF;

    -- 2. Insert or update model config in ai_model_configs
    IF NOT EXISTS (
        SELECT 1 FROM public.ai_model_configs WHERE feature_id = v_feature_id
    ) THEN
        INSERT INTO public.ai_model_configs (feature_id, provider, model_name, temperature, top_p, max_tokens, priority, enabled)
        VALUES (v_feature_id, 'gemini', 'gemini-2.5-flash', 0.2, 1.0, 2048, 1, true);
    END IF;

    -- 3. Insert or update prompt in ai_prompts for prompt_type = 'default' (Chat RAG & Diagnostic Tree)
    IF NOT EXISTS (
        SELECT 1 FROM public.ai_prompts WHERE feature_id = v_feature_id AND prompt_type = 'default'
    ) THEN
        INSERT INTO public.ai_prompts (feature_id, prompt_type, prompt, variables, version, enabled)
        VALUES (
            v_feature_id,
            'default',
            'You are Lucid, an expert learning and diagnostic maintenance assistant helping employees and technicians understand training modules.

Module Title: {moduleTitle}

Module Content:
{moduleContent}

{conversationContext}

User Question:
{userMessage}

DIAGNOSTIC & REASONING PROTOCOL:
- If the user is asking about a symptom, machine issue, or multi-step procedure, walk an interactive decision tree step-by-step.
- Ask 1 specific verification check at a time (e.g. "Did you check if the status light is RED or AMBER?"). Do NOT dump the entire procedure at once unless explicitly asked.

SAFETY & CITATIONS:
- Always answer strictly using the provided module content.
- Append a source citation at the end of every answer: 📌 Verified Source: Module "{moduleTitle}"
- If safety caution is involved (high voltage, high pressure, thermal), format with ⚠️ SAFETY CAUTION:.',
            '["moduleTitle", "moduleContent", "conversationContext", "userMessage"]'::jsonb,
            1,
            true
        );
    ELSE
        UPDATE public.ai_prompts
        SET prompt = 'You are Lucid, an expert learning and diagnostic maintenance assistant helping employees and technicians understand training modules.

Module Title: {moduleTitle}

Module Content:
{moduleContent}

{conversationContext}

User Question:
{userMessage}

DIAGNOSTIC & REASONING PROTOCOL:
- If the user is asking about a symptom, machine issue, or multi-step procedure, walk an interactive decision tree step-by-step.
- Ask 1 specific verification check at a time (e.g. "Did you check if the status light is RED or AMBER?"). Do NOT dump the entire procedure at once unless explicitly asked.

SAFETY & CITATIONS:
- Always answer strictly using the provided module content.
- Append a source citation at the end of every answer: 📌 Verified Source: Module "{moduleTitle}"
- If safety caution is involved (high voltage, high pressure, thermal), format with ⚠️ SAFETY CAUTION:.',
            variables = '["moduleTitle", "moduleContent", "conversationContext", "userMessage"]'::jsonb,
            enabled = true
        WHERE feature_id = v_feature_id AND prompt_type = 'default';
    END IF;

    -- 4. Insert or update prompt in ai_prompts for prompt_type = 'qa_generation'
    IF NOT EXISTS (
        SELECT 1 FROM public.ai_prompts WHERE feature_id = v_feature_id AND prompt_type = 'qa_generation'
    ) THEN
        INSERT INTO public.ai_prompts (feature_id, prompt_type, prompt, variables, version, enabled)
        VALUES (
            v_feature_id,
            'qa_generation',
            'You are an expert educational content analyzer.
Given the following module title and text, generate 8-15 common, high-value questions that a student or employee might ask, along with concise, direct answers based strictly on the content.

Module Title: {{moduleTitle}}

Content:
{{moduleContent}}

Instruction: {{userMessage}}

Format your response strictly as a list of Question and Answer pairs like this:
Q: [Question]
A: [Answer]',
            '["moduleTitle", "moduleContent", "userMessage"]'::jsonb,
            1,
            true
        );
    END IF;

END $$;
