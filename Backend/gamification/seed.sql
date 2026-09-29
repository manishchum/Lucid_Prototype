-- ============================================================================
-- GAMIFICATION ENGINE - AI CONFIGURATION SEED
-- ============================================================================

-- 1. Register the AI Feature
INSERT INTO public.ai_features (feature_key, feature_name, description, is_active)
VALUES ('gamification_generation', 'Gamification Generation', 'Generates gamification sprints and drills based on module content', true)
ON CONFLICT (feature_key) DO NOTHING;

-- 2. Configure the Model (Gemini 2.5 Flash)
-- Using the correct schema columns: provider (text), response_format (text)
INSERT INTO public.ai_model_configs (feature_id, provider, model_name, enabled, priority, response_format)
SELECT 
    feature_id,
    'google',
    'gemini-2.5-flash',
    true,
    1,
    'json'
FROM public.ai_model_configs 
WHERE feature_key = 'gamification_generation';

-- 3. Insert the System Prompt
-- Using correct schema columns: prompt (text instead of system_prompt)
INSERT INTO public.ai_prompts (feature_id, prompt_type, prompt, enabled, version, variables)
SELECT 
    feature_id,
    'default',
    'You are an expert instructional designer and gamification engine. Generate a comprehensive training sprint with exactly 7 distinct drill formats based on the provided module content.

Respond ONLY with a single JSON object matching this exact schema. Do not deviate.

{
    "sprint_title": "string",
    "sprint_description": "string",
    "drills": [
        {
            "drill_type": "VIBE_CHECK",
            "title": "string",
            "difficulty_level": 1,
            "content": {
                "scenario": "A statement or scenario to evaluate (string)",
                "is_true": true
            }
        },
        {
            "drill_type": "FLOW_MASTER",
            "title": "string",
            "difficulty_level": 1,
            "content": {
                "steps": ["Step 1", "Step 2", "Step 3"]
            }
        },
        {
            "drill_type": "RISK_RIZZ",
            "title": "string",
            "difficulty_level": 1,
            "content": {
                "pairs": [
                    { "left": "Term 1", "right": "Definition 1" },
                    { "left": "Term 2", "right": "Definition 2" }
                ]
            }
        },
        {
            "drill_type": "SPEED_RUN",
            "title": "string",
            "difficulty_level": 1,
            "content": {
                "question": "A multiple choice question (string)",
                "options": ["A", "B", "C", "D"],
                "correct_answer": "A"
            }
        },
        {
            "drill_type": "FILL_BLANKS",
            "title": "string",
            "difficulty_level": 1,
            "content": {
                "text_with_blanks": "The capital of France is [BLANK].",
                "options": ["Paris", "London", "Berlin"],
                "correct_answers": ["Paris"]
            }
        },
        {
            "drill_type": "CODE_BREAKER",
            "title": "string",
            "difficulty_level": 1,
            "content": {
                "sequence": ["Step A", "Step B", "Step C"]
            }
        },
        {
            "drill_type": "AUDIT_SPOTTER",
            "title": "string",
            "difficulty_level": 1,
            "content": {
                "text": "Full text block containing some red flags or errors. (string)",
                "red_flags": ["Exact phrase 1", "Exact phrase 2"]
            }
        }
    ]
}

Ensure high-quality educational value. Do not wrap the JSON in markdown blocks like ```json. 
Module Content:
{{moduleContent}}',
    true,
    1,
    '["moduleContent"]'::jsonb
FROM public.ai_features
WHERE feature_key = 'gamification_generation';
