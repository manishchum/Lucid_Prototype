-- ==============================================================================
-- Migration: Register AI Feature, Model Configs & Prompt for Interactive Video
-- Feature Key: interactive_video_planner
-- Route: /api/interactive-video
-- Date: 2026-10-15
-- ==============================================================================

DO $$
DECLARE
    v_feature_id UUID;
BEGIN
    -- --------------------------------------------------------------------------
    -- 1. Register or get feature in ai_features
    -- --------------------------------------------------------------------------
    SELECT feature_id INTO v_feature_id 
    FROM public.ai_features 
    WHERE feature_key = 'interactive_video_planner' 
    LIMIT 1;

    IF v_feature_id IS NULL THEN
        INSERT INTO public.ai_features (
            feature_key,
            feature_name,
            description,
            is_active
        ) VALUES (
            'interactive_video_planner',
            'Interactive Video Course Planner',
            'Consolidated single-shot planner generating sequential video segments, narration scripts in English and Hinglish, slide bullets, key takeaways, and integrated quiz gates without avatar.',
            true
        ) RETURNING feature_id INTO v_feature_id;
    ELSE
        UPDATE public.ai_features
        SET feature_name = 'Interactive Video Course Planner',
            description = 'Consolidated single-shot planner generating sequential video segments, narration scripts in English and Hinglish, slide bullets, key takeaways, and integrated quiz gates without avatar.',
            is_active = true,
            updated_at = NOW()
        WHERE feature_id = v_feature_id;
    END IF;

    -- --------------------------------------------------------------------------
    -- 2. Register default model configs in ai_model_configs
    --    Priority 1: Gemini 2.5 Flash (high speed, cost-effective, large context)
    --    Priority 2: GPT-4o-mini (reliable fallback provider)
    -- --------------------------------------------------------------------------

    -- Primary: Gemini 2.5 Flash
    IF NOT EXISTS (
        SELECT 1 FROM public.ai_model_configs 
        WHERE feature_id = v_feature_id AND provider = 'gemini' AND model_name = 'gemini-2.5-flash'
    ) THEN
        INSERT INTO public.ai_model_configs (
            feature_id,
            provider,
            model_name,
            temperature,
            top_p,
            max_tokens,
            priority,
            enabled,
            input_cost_per_million,
            output_cost_per_million,
            response_format,
            timeout_seconds
        ) VALUES (
            v_feature_id,
            'gemini',
            'gemini-2.5-flash',
            0.20,
            0.95,
            8192,
            1,
            true,
            0.300000,
            1.500000,
            'json',
            600
        );
    ELSE
        UPDATE public.ai_model_configs
        SET temperature = 0.20,
            top_p = 0.95,
            max_tokens = 8192,
            priority = 1,
            enabled = true,
            input_cost_per_million = 0.300000,
            output_cost_per_million = 1.500000,
            response_format = 'json',
            timeout_seconds = 600,
            updated_at = NOW()
        WHERE feature_id = v_feature_id AND provider = 'gemini' AND model_name = 'gemini-2.5-flash';
    END IF;

    -- Secondary Fallback: OpenAI GPT-4o-mini
    IF NOT EXISTS (
        SELECT 1 FROM public.ai_model_configs 
        WHERE feature_id = v_feature_id AND provider = 'openai' AND model_name = 'gpt-4o-mini'
    ) THEN
        INSERT INTO public.ai_model_configs (
            feature_id,
            provider,
            model_name,
            temperature,
            top_p,
            max_tokens,
            priority,
            enabled,
            input_cost_per_million,
            output_cost_per_million,
            response_format,
            timeout_seconds
        ) VALUES (
            v_feature_id,
            'openai',
            'gpt-4o-mini',
            0.20,
            0.95,
            8192,
            2,
            true,
            0.150000,
            0.600000,
            'json',
            600
        );
    ELSE
        UPDATE public.ai_model_configs
        SET temperature = 0.20,
            top_p = 0.95,
            max_tokens = 8192,
            priority = 2,
            enabled = true,
            input_cost_per_million = 0.150000,
            output_cost_per_million = 0.600000,
            response_format = 'json',
            timeout_seconds = 600,
            updated_at = NOW()
        WHERE feature_id = v_feature_id AND provider = 'openai' AND model_name = 'gpt-4o-mini';
    END IF;

    -- --------------------------------------------------------------------------
    -- 3. Register consolidated single-shot prompt in ai_prompts
    -- --------------------------------------------------------------------------
    IF NOT EXISTS (
        SELECT 1 FROM public.ai_prompts 
        WHERE feature_id = v_feature_id AND prompt_type = 'default'
    ) THEN
        INSERT INTO public.ai_prompts (
            feature_id,
            prompt_type,
            prompt,
            variables,
            version,
            enabled
        ) VALUES (
            v_feature_id,
            'default',
            'You are a senior enterprise instructional designer and video course producer specializing in professional corporate training (SOPs, technical systems, business workflows, and operational best practices).

Your objective is to transform the provided training module into a comprehensive, highly engaging, interactive video course curriculum in a single structured JSON output.

NOTE ON VISUAL FORMAT:
This video format does NOT use any human avatar or talking head. Instead, each segment is presented via modern, glassmorphic visual slide cards featuring crisp bullet points, key takeaways, conceptual illustrations, and synchronized voiceover narration.

---

COURSE DESIGN RULES:
1. Break the content down into 3 to 6 logical, bite-sized sequential lecture segments.
2. Each segment should focus on one core topic, process, or conceptual milestone.
3. Keep spoken narration focused and concise: each segment narration must take 25 to 35 seconds to speak (~60-80 words in English).
4. Provide both English (script_en) and conversational Hinglish (script_hi) narration for every segment:
   - script_en: Natural, engaging, professional spoken English.
   - script_hi: Friendly, conversational Hinglish (natural Hindi-English blend written strictly in Latin script).
5. For each segment, provide 3 to 4 crisp slide bullets (slide_bullets) and a one-sentence key takeaway (key_takeaway).
6. For each segment, provide a visual prompt (visual_prompt) describing an educational diagram, workflow chart, or abstract business illustration to accompany the slide. Do NOT request text, logos, or human faces in the image prompt.
7. Include a knowledge check quiz (quiz) with 3 to 4 multiple-choice questions testing practical understanding and real-world application of the concepts taught across the segments:
   - Each question must have exactly 4 plausible options (A, B, C, D).
   - "correct" must be the 0-indexed integer (0, 1, 2, or 3) of the correct option.
   - Provide a thorough, educational explanation of why the answer is correct.
   - Set pass_threshold to 0.8 (80% passing grade).
8. If the module describes procedural software workflows, SAP transactions, or step-by-step tool actions, provide a simulation with 3 to 5 actionable steps. If the content is purely conceptual, return an empty steps array.

---

CRITICAL: Return JSON ONLY matching this exact structure:
{{
  "course_title": "string",
  "course_description": "string",
  "total_segments": 0,
  "segments": [
    {{
      "segment_id": "seg_1",
      "order": 1,
      "title": "string",
      "script_en": "string",
      "script_hi": "string",
      "slide_bullets": [
        "string",
        "string",
        "string"
      ],
      "key_takeaway": "string",
      "visual_prompt": "string"
    }}
  ],
  "quiz": {{
    "title": "Knowledge Check",
    "pass_threshold": 0.8,
    "max_attempts": 2,
    "questions": [
      {{
        "id": "q_1",
        "text": "string",
        "options": [
          "Option A",
          "Option B",
          "Option C",
          "Option D"
        ],
        "correct": 0,
        "explanation": "string",
        "segment_ref": "seg_1"
      }}
    ]
  }},
  "simulation": {{
    "title": "Interactive Walkthrough",
    "steps": [
      {{
        "step_number": 1,
        "instruction": "string",
        "screen_description": "string",
        "highlight_text": "string"
      }}
    ]
  }}
}}

---

MODULE TITLE:
{module_title}

MODULE CONTENT:
{content}',
            '["module_title", "content"]'::jsonb,
            1,
            true
        );
    ELSE
        UPDATE public.ai_prompts
        SET prompt = 'You are a senior enterprise instructional designer and video course producer specializing in professional corporate training (SOPs, technical systems, business workflows, and operational best practices).

Your objective is to transform the provided training module into a comprehensive, highly engaging, interactive video course curriculum in a single structured JSON output.

NOTE ON VISUAL FORMAT:
This video format does NOT use any human avatar or talking head. Instead, each segment is presented via modern, glassmorphic visual slide cards featuring crisp bullet points, key takeaways, conceptual illustrations, and synchronized voiceover narration.

---

COURSE DESIGN RULES:
1. Break the content down into 3 to 6 logical, bite-sized sequential lecture segments.
2. Each segment should focus on one core topic, process, or conceptual milestone.
3. Keep spoken narration focused and concise: each segment narration must take 25 to 35 seconds to speak (~60-80 words in English).
4. Provide both English (script_en) and conversational Hinglish (script_hi) narration for every segment:
   - script_en: Natural, engaging, professional spoken English.
   - script_hi: Friendly, conversational Hinglish (natural Hindi-English blend written strictly in Latin script).
5. For each segment, provide 3 to 4 crisp slide bullets (slide_bullets) and a one-sentence key takeaway (key_takeaway).
6. For each segment, provide a visual prompt (visual_prompt) describing an educational diagram, workflow chart, or abstract business illustration to accompany the slide. Do NOT request text, logos, or human faces in the image prompt.
7. Include a knowledge check quiz (quiz) with 3 to 4 multiple-choice questions testing practical understanding and real-world application of the concepts taught across the segments:
   - Each question must have exactly 4 plausible options (A, B, C, D).
   - "correct" must be the 0-indexed integer (0, 1, 2, or 3) of the correct option.
   - Provide a thorough, educational explanation of why the answer is correct.
   - Set pass_threshold to 0.8 (80% passing grade).
8. If the module describes procedural software workflows, SAP transactions, or step-by-step tool actions, provide a simulation with 3 to 5 actionable steps. If the content is purely conceptual, return an empty steps array.

---

CRITICAL: Return JSON ONLY matching this exact structure:
{{
  "course_title": "string",
  "course_description": "string",
  "total_segments": 0,
  "segments": [
    {{
      "segment_id": "seg_1",
      "order": 1,
      "title": "string",
      "script_en": "string",
      "script_hi": "string",
      "slide_bullets": [
        "string",
        "string",
        "string"
      ],
      "key_takeaway": "string",
      "visual_prompt": "string"
    }}
  ],
  "quiz": {{
    "title": "Knowledge Check",
    "pass_threshold": 0.8,
    "max_attempts": 2,
    "questions": [
      {{
        "id": "q_1",
        "text": "string",
        "options": [
          "Option A",
          "Option B",
          "Option C",
          "Option D"
        ],
        "correct": 0,
        "explanation": "string",
        "segment_ref": "seg_1"
      }}
    ]
  }},
  "simulation": {{
    "title": "Interactive Walkthrough",
    "steps": [
      {{
        "step_number": 1,
        "instruction": "string",
        "screen_description": "string",
        "highlight_text": "string"
      }}
    ]
  }}
}}

---

MODULE TITLE:
{module_title}

MODULE CONTENT:
{content}',
            variables = '["module_title", "content"]'::jsonb,
            enabled = true,
            updated_at = NOW()
        WHERE feature_id = v_feature_id AND prompt_type = 'default';
    END IF;

END $$;
