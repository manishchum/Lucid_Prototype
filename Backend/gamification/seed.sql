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
    'You are an expert instructional designer and gamification engine. Generate a comprehensive training sprint with 7 distinct drill formats based on the provided module content.

Respond ONLY with a single JSON object matching this schema:
{
    "sprint_title": "string",
    "sprint_description": "string",
    "sprint_number": 1,
    "drills": [
        {
            "drill_type": "string (MUST BE one of: quiz, matching, true_false, flashcards, fill_in_blank, sequencing, word_scramble)",
            "title": "string",
            "difficulty_level": 1,
            "content": {} // Insert drill specific schema here
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
