-- ==============================================================================
-- Migration: Register AI Features, Model Configs & Prompts for Task Manager
-- Features:
--   1. task_evaluation_text   (Text Submission Evaluation)
--   2. task_evaluation_audio  (Audio Communication & Compliance Verification)
--   3. task_evaluation_vision (Image Proof Verification & Video Frame Analysis)
--   4. task_insights          (Business Outcomes & Manager Coaching Insights)
-- Date: 2026-11-02
-- ==============================================================================

DO $$
DECLARE
    v_text_feature_id UUID;
    v_audio_feature_id UUID;
    v_vision_feature_id UUID;
    v_insights_feature_id UUID;
BEGIN

    -- ==========================================================================
    -- 1. FEATURE: task_evaluation_text
    -- ==========================================================================
    SELECT feature_id INTO v_text_feature_id
    FROM public.ai_features
    WHERE feature_key = 'task_evaluation_text'
    LIMIT 1;

    IF v_text_feature_id IS NULL THEN
        INSERT INTO public.ai_features (
            feature_key,
            feature_name,
            description,
            is_active
        ) VALUES (
            'task_evaluation_text',
            'Task Evaluation - Text Response',
            'Qualitative and structured assessment of employee text responses against task requirements, evaluation criteria, and reference answers.',
            true
        ) RETURNING feature_id INTO v_text_feature_id;
    ELSE
        UPDATE public.ai_features
        SET feature_name = 'Task Evaluation - Text Response',
            description = 'Qualitative and structured assessment of employee text responses against task requirements, evaluation criteria, and reference answers.',
            is_active = true,
            updated_at = NOW()
        WHERE feature_id = v_text_feature_id;
    END IF;

    -- Model Config: Primary Gemini 2.5 Flash
    IF NOT EXISTS (
        SELECT 1 FROM public.ai_model_configs
        WHERE feature_id = v_text_feature_id AND provider = 'gemini' AND model_name = 'gemini-2.5-flash'
    ) THEN
        INSERT INTO public.ai_model_configs (
            feature_id, provider, model_name, temperature, top_p, max_tokens,
            priority, enabled, input_cost_per_million, output_cost_per_million,
            response_format, timeout_seconds
        ) VALUES (
            v_text_feature_id, 'gemini', 'gemini-2.5-flash', 0.20, 0.95, 4096,
            1, true, 0.300000, 1.500000, 'json', 300
        );
    ELSE
        UPDATE public.ai_model_configs
        SET temperature = 0.20, top_p = 0.95, max_tokens = 4096, priority = 1,
            enabled = true, input_cost_per_million = 0.300000, output_cost_per_million = 1.500000,
            response_format = 'json', timeout_seconds = 300, updated_at = NOW()
        WHERE feature_id = v_text_feature_id AND provider = 'gemini' AND model_name = 'gemini-2.5-flash';
    END IF;

    -- Model Config: Fallback OpenAI GPT-4o-mini
    IF NOT EXISTS (
        SELECT 1 FROM public.ai_model_configs
        WHERE feature_id = v_text_feature_id AND provider = 'openai' AND model_name = 'gpt-4o-mini'
    ) THEN
        INSERT INTO public.ai_model_configs (
            feature_id, provider, model_name, temperature, top_p, max_tokens,
            priority, enabled, input_cost_per_million, output_cost_per_million,
            response_format, timeout_seconds
        ) VALUES (
            v_text_feature_id, 'openai', 'gpt-4o-mini', 0.20, 0.95, 4096,
            2, true, 0.150000, 0.600000, 'json', 300
        );
    ELSE
        UPDATE public.ai_model_configs
        SET temperature = 0.20, top_p = 0.95, max_tokens = 4096, priority = 2,
            enabled = true, input_cost_per_million = 0.150000, output_cost_per_million = 0.600000,
            response_format = 'json', timeout_seconds = 300, updated_at = NOW()
        WHERE feature_id = v_text_feature_id AND provider = 'openai' AND model_name = 'gpt-4o-mini';
    END IF;

    -- Prompt: default
    IF NOT EXISTS (
        SELECT 1 FROM public.ai_prompts
        WHERE feature_id = v_text_feature_id AND prompt_type = 'default'
    ) THEN
        INSERT INTO public.ai_prompts (
            feature_id, prompt_type, prompt, variables, version, enabled
        ) VALUES (
            v_text_feature_id,
            'default',
            'You are evaluating an employee''s response.

TASK:
{task_context}

EVALUATION CRITERIA:
{analyzing_parameters}

REFERENCE ANSWER:
{expected_answer}

EMPLOYEE RESPONSE:
{employee_response}

Evaluate only the employee response based on the task and supplied evaluation criteria.
Do not infer information not explicitly present.
Score the response according to completeness, relevance, specificity, and actionability unless custom evaluation criteria are provided.

Scoring guidance:
90-100: Complete, specific, relevant, and actionable.
70-89: Good response with minor gaps.
40-69: Partially complete, vague, or missing important details.
1-39: Poor, substantially incomplete, or minimally relevant.
0: Does not answer the task.

Return valid JSON only:
{{
  "overall_score": 0,
  "sentiment": "positive|neutral|negative|mixed",
  "key_themes": [],
  "strengths": [],
  "concerns": [],
  "action_orientation": "high|medium|low",
  "engagement": "high|medium|low",
  "summary": "",
  "recommendations": [],
  "measurable_outcomes": [],
  "actions_taken": [],
  "unique_methods": [],
  "challenges": [],
  "learnings": [],
  "missing_information": [],
  "extraction_confidence": "high|medium|low"
}}',
            '["task_context", "analyzing_parameters", "expected_answer", "employee_response"]'::jsonb,
            1,
            true
        );
    ELSE
        UPDATE public.ai_prompts
        SET prompt = 'You are evaluating an employee''s response.

TASK:
{task_context}

EVALUATION CRITERIA:
{analyzing_parameters}

REFERENCE ANSWER:
{expected_answer}

EMPLOYEE RESPONSE:
{employee_response}

Evaluate only the employee response based on the task and supplied evaluation criteria.
Do not infer information not explicitly present.
Score the response according to completeness, relevance, specificity, and actionability unless custom evaluation criteria are provided.

Scoring guidance:
90-100: Complete, specific, relevant, and actionable.
70-89: Good response with minor gaps.
40-69: Partially complete, vague, or missing important details.
1-39: Poor, substantially incomplete, or minimally relevant.
0: Does not answer the task.

Return valid JSON only:
{{
  "overall_score": 0,
  "sentiment": "positive|neutral|negative|mixed",
  "key_themes": [],
  "strengths": [],
  "concerns": [],
  "action_orientation": "high|medium|low",
  "engagement": "high|medium|low",
  "summary": "",
  "recommendations": [],
  "measurable_outcomes": [],
  "actions_taken": [],
  "unique_methods": [],
  "challenges": [],
  "learnings": [],
  "missing_information": [],
  "extraction_confidence": "high|medium|low"
}}',
            variables = '["task_context", "analyzing_parameters", "expected_answer", "employee_response"]'::jsonb,
            enabled = true,
            updated_at = NOW()
        WHERE feature_id = v_text_feature_id AND prompt_type = 'default';
    END IF;


    -- ==========================================================================
    -- 2. FEATURE: task_evaluation_audio
    -- ==========================================================================
    SELECT feature_id INTO v_audio_feature_id
    FROM public.ai_features
    WHERE feature_key = 'task_evaluation_audio'
    LIMIT 1;

    IF v_audio_feature_id IS NULL THEN
        INSERT INTO public.ai_features (
            feature_key,
            feature_name,
            description,
            is_active
        ) VALUES (
            'task_evaluation_audio',
            'Task Evaluation - Audio Submission',
            'Speech communication quality assessment and transcript requirement compliance verification for audio submissions.',
            true
        ) RETURNING feature_id INTO v_audio_feature_id;
    ELSE
        UPDATE public.ai_features
        SET feature_name = 'Task Evaluation - Audio Submission',
            description = 'Speech communication quality assessment and transcript requirement compliance verification for audio submissions.',
            is_active = true,
            updated_at = NOW()
        WHERE feature_id = v_audio_feature_id;
    END IF;

    -- Model Config: Primary Gemini 2.5 Flash
    IF NOT EXISTS (
        SELECT 1 FROM public.ai_model_configs
        WHERE feature_id = v_audio_feature_id AND provider = 'gemini' AND model_name = 'gemini-2.5-flash'
    ) THEN
        INSERT INTO public.ai_model_configs (
            feature_id, provider, model_name, temperature, top_p, max_tokens,
            priority, enabled, input_cost_per_million, output_cost_per_million,
            response_format, timeout_seconds
        ) VALUES (
            v_audio_feature_id, 'gemini', 'gemini-2.5-flash', 0.20, 0.95, 4096,
            1, true, 0.300000, 1.500000, 'json', 300
        );
    ELSE
        UPDATE public.ai_model_configs
        SET temperature = 0.20, top_p = 0.95, max_tokens = 4096, priority = 1,
            enabled = true, input_cost_per_million = 0.300000, output_cost_per_million = 1.500000,
            response_format = 'json', timeout_seconds = 300, updated_at = NOW()
        WHERE feature_id = v_audio_feature_id AND provider = 'gemini' AND model_name = 'gemini-2.5-flash';
    END IF;

    -- Model Config: Fallback OpenAI GPT-4o-mini
    IF NOT EXISTS (
        SELECT 1 FROM public.ai_model_configs
        WHERE feature_id = v_audio_feature_id AND provider = 'openai' AND model_name = 'gpt-4o-mini'
    ) THEN
        INSERT INTO public.ai_model_configs (
            feature_id, provider, model_name, temperature, top_p, max_tokens,
            priority, enabled, input_cost_per_million, output_cost_per_million,
            response_format, timeout_seconds
        ) VALUES (
            v_audio_feature_id, 'openai', 'gpt-4o-mini', 0.20, 0.95, 4096,
            2, true, 0.150000, 0.600000, 'json', 300
        );
    ELSE
        UPDATE public.ai_model_configs
        SET temperature = 0.20, top_p = 0.95, max_tokens = 4096, priority = 2,
            enabled = true, input_cost_per_million = 0.150000, output_cost_per_million = 0.600000,
            response_format = 'json', timeout_seconds = 300, updated_at = NOW()
        WHERE feature_id = v_audio_feature_id AND provider = 'openai' AND model_name = 'gpt-4o-mini';
    END IF;

    -- Prompt: default & compliance (Transcript Task Compliance)
    IF NOT EXISTS (
        SELECT 1 FROM public.ai_prompts
        WHERE feature_id = v_audio_feature_id AND prompt_type = 'default'
    ) THEN
        INSERT INTO public.ai_prompts (
            feature_id, prompt_type, prompt, variables, version, enabled
        ) VALUES (
            v_audio_feature_id,
            'default',
            'You are an enterprise task-verification AI.

Evaluate the employee''s audio transcript against the task requirements.

TASK TITLE:
{task_title}

TASK DESCRIPTION:
{task_description}

ANALYZING PARAMETERS:
{analyzing_parameters}

EXPECTED ANSWER:
{expected_answer}

EMPLOYEE TRANSCRIPT:
{transcript}

Evaluate whether the employee actually completed the requested task.

Important:
- Evaluate the CONTENT of the transcript against the task.
- Do not penalize the employee merely because the response contains additional information.
- Check each explicit requirement separately.
- If a requirement is clearly satisfied, mark it satisfied.
- If a requirement is missing, mark it missing.
- Do not invent information that is not present in the transcript.

Return STRICT JSON ONLY:
{{
    "score": 0,
    "passed": true,
    "criteria": [
        {{
            "requirement": "requirement description",
            "satisfied": true,
            "evidence": "short evidence from transcript"
        }}
    ],
    "feedback": "short explanation"
}}',
            '["task_title", "task_description", "analyzing_parameters", "expected_answer", "transcript"]'::jsonb,
            1,
            true
        );
    ELSE
        UPDATE public.ai_prompts
        SET prompt = 'You are an enterprise task-verification AI.

Evaluate the employee''s audio transcript against the task requirements.

TASK TITLE:
{task_title}

TASK DESCRIPTION:
{task_description}

ANALYZING PARAMETERS:
{analyzing_parameters}

EXPECTED ANSWER:
{expected_answer}

EMPLOYEE TRANSCRIPT:
{transcript}

Evaluate whether the employee actually completed the requested task.

Important:
- Evaluate the CONTENT of the transcript against the task.
- Do not penalize the employee merely because the response contains additional information.
- Check each explicit requirement separately.
- If a requirement is clearly satisfied, mark it satisfied.
- If a requirement is missing, mark it missing.
- Do not invent information that is not present in the transcript.

Return STRICT JSON ONLY:
{{
    "score": 0,
    "passed": true,
    "criteria": [
        {{
            "requirement": "requirement description",
            "satisfied": true,
            "evidence": "short evidence from transcript"
        }}
    ],
    "feedback": "short explanation"
}}',
            variables = '["task_title", "task_description", "analyzing_parameters", "expected_answer", "transcript"]'::jsonb,
            enabled = true,
            updated_at = NOW()
        WHERE feature_id = v_audio_feature_id AND prompt_type = 'default';
    END IF;

    -- Prompt: compliance (alias for explicit compliance prompt_type)
    IF NOT EXISTS (
        SELECT 1 FROM public.ai_prompts
        WHERE feature_id = v_audio_feature_id AND prompt_type = 'compliance'
    ) THEN
        INSERT INTO public.ai_prompts (
            feature_id, prompt_type, prompt, variables, version, enabled
        ) VALUES (
            v_audio_feature_id,
            'compliance',
            'You are an enterprise task-verification AI.

Evaluate the employee''s audio transcript against the task requirements.

TASK TITLE:
{task_title}

TASK DESCRIPTION:
{task_description}

ANALYZING PARAMETERS:
{analyzing_parameters}

EXPECTED ANSWER:
{expected_answer}

EMPLOYEE TRANSCRIPT:
{transcript}

Evaluate whether the employee actually completed the requested task.

Important:
- Evaluate the CONTENT of the transcript against the task.
- Do not penalize the employee merely because the response contains additional information.
- Check each explicit requirement separately.
- If a requirement is clearly satisfied, mark it satisfied.
- If a requirement is missing, mark it missing.
- Do not invent information that is not present in the transcript.

Return STRICT JSON ONLY:
{{
    "score": 0,
    "passed": true,
    "criteria": [
        {{
            "requirement": "requirement description",
            "satisfied": true,
            "evidence": "short evidence from transcript"
        }}
    ],
    "feedback": "short explanation"
}}',
            '["task_title", "task_description", "analyzing_parameters", "expected_answer", "transcript"]'::jsonb,
            1,
            true
        );
    END IF;

    -- Prompt: communication (Multimodal Audio Communication Analysis)
    IF NOT EXISTS (
        SELECT 1 FROM public.ai_prompts
        WHERE feature_id = v_audio_feature_id AND prompt_type = 'communication'
    ) THEN
        INSERT INTO public.ai_prompts (
            feature_id, prompt_type, prompt, variables, version, enabled
        ) VALUES (
            v_audio_feature_id,
            'communication',
            'You are an enterprise task communication evaluator. Transcribe the speech and analyze tone, professionalism, communication quality, sentence structure, language confidence, filler words, strengths, weaknesses, feedback, and improvement suggestions.

Return STRICT JSON ONLY matching:
{{
  "transcript": "string",
  "tone": "string",
  "communication_score": 0,
  "filler_words": [],
  "strengths": [],
  "weaknesses": [],
  "feedback": "string",
  "improvement_suggestions": []
}}
Scores must be 0-100.',
            '[]'::jsonb,
            1,
            true
        );
    ELSE
        UPDATE public.ai_prompts
        SET prompt = 'You are an enterprise task communication evaluator. Transcribe the speech and analyze tone, professionalism, communication quality, sentence structure, language confidence, filler words, strengths, weaknesses, feedback, and improvement suggestions.

Return STRICT JSON ONLY matching:
{{
  "transcript": "string",
  "tone": "string",
  "communication_score": 0,
  "filler_words": [],
  "strengths": [],
  "weaknesses": [],
  "feedback": "string",
  "improvement_suggestions": []
}}
Scores must be 0-100.',
            variables = '[]'::jsonb,
            enabled = true,
            updated_at = NOW()
        WHERE feature_id = v_audio_feature_id AND prompt_type = 'communication';
    END IF;


    -- ==========================================================================
    -- 3. FEATURE: task_evaluation_vision
    -- ==========================================================================
    SELECT feature_id INTO v_vision_feature_id
    FROM public.ai_features
    WHERE feature_key = 'task_evaluation_vision'
    LIMIT 1;

    IF v_vision_feature_id IS NULL THEN
        INSERT INTO public.ai_features (
            feature_key,
            feature_name,
            description,
            is_active
        ) VALUES (
            'task_evaluation_vision',
            'Task Evaluation - Vision & Video',
            'Multimodal image proof verification and video frame analysis for employee practical and physical tasks.',
            true
        ) RETURNING feature_id INTO v_vision_feature_id;
    ELSE
        UPDATE public.ai_features
        SET feature_name = 'Task Evaluation - Vision & Video',
            description = 'Multimodal image proof verification and video frame analysis for employee practical and physical tasks.',
            is_active = true,
            updated_at = NOW()
        WHERE feature_id = v_vision_feature_id;
    END IF;

    -- Model Config: Primary Gemini 2.5 Flash
    IF NOT EXISTS (
        SELECT 1 FROM public.ai_model_configs
        WHERE feature_id = v_vision_feature_id AND provider = 'gemini' AND model_name = 'gemini-2.5-flash'
    ) THEN
        INSERT INTO public.ai_model_configs (
            feature_id, provider, model_name, temperature, top_p, max_tokens,
            priority, enabled, input_cost_per_million, output_cost_per_million,
            response_format, timeout_seconds
        ) VALUES (
            v_vision_feature_id, 'gemini', 'gemini-2.5-flash', 0.20, 0.95, 4096,
            1, true, 0.300000, 1.500000, 'json', 300
        );
    ELSE
        UPDATE public.ai_model_configs
        SET temperature = 0.20, top_p = 0.95, max_tokens = 4096, priority = 1,
            enabled = true, input_cost_per_million = 0.300000, output_cost_per_million = 1.500000,
            response_format = 'json', timeout_seconds = 300, updated_at = NOW()
        WHERE feature_id = v_vision_feature_id AND provider = 'gemini' AND model_name = 'gemini-2.5-flash';
    END IF;

    -- Model Config: Fallback OpenAI GPT-4o
    IF NOT EXISTS (
        SELECT 1 FROM public.ai_model_configs
        WHERE feature_id = v_vision_feature_id AND provider = 'openai' AND model_name = 'gpt-4o'
    ) THEN
        INSERT INTO public.ai_model_configs (
            feature_id, provider, model_name, temperature, top_p, max_tokens,
            priority, enabled, input_cost_per_million, output_cost_per_million,
            response_format, timeout_seconds
        ) VALUES (
            v_vision_feature_id, 'openai', 'gpt-4o', 0.20, 0.95, 4096,
            2, true, 2.500000, 10.000000, 'json', 300
        );
    ELSE
        UPDATE public.ai_model_configs
        SET temperature = 0.20, top_p = 0.95, max_tokens = 4096, priority = 2,
            enabled = true, input_cost_per_million = 2.500000, output_cost_per_million = 10.000000,
            response_format = 'json', timeout_seconds = 300, updated_at = NOW()
        WHERE feature_id = v_vision_feature_id AND provider = 'openai' AND model_name = 'gpt-4o';
    END IF;

    -- Prompt: default & image_verification (Image Proof Verification)
    IF NOT EXISTS (
        SELECT 1 FROM public.ai_prompts
        WHERE feature_id = v_vision_feature_id AND prompt_type = 'default'
    ) THEN
        INSERT INTO public.ai_prompts (
            feature_id, prompt_type, prompt, variables, version, enabled
        ) VALUES (
            v_vision_feature_id,
            'default',
            'You are an enterprise task verification AI.

Analyze whether the uploaded task proof satisfies the task.

Task:
{instruction}

Analyzing Parameters:
{analyzing_parameters}

Evidence summary:
{evidence_summary}

Rules:
- Use detected objects as visual proof
- Use CLIP score for semantic similarity
- Use OCR only when text matters
- Use pose/activity when relevant
- Missing required objects should reduce score
- Reject fake or unrelated submissions
- You have access to the actual uploaded image. Inspect it directly.
- Follow the Analyzing Parameters when evaluating the submission.
- If the task requires a visual classification, make that classification from the image itself.
- Do not assume a task is satisfied merely because the CLIP score is high.
- If the image does not contain enough visual evidence to evaluate the criteria, mark the submission for review.

Return STRICT JSON ONLY:
{{
 "passed": true,
 "score": 0,
 "feedback": "short explanation",
 "classification": "if applicable, otherwise null"
}}',
            '["instruction", "analyzing_parameters", "evidence_summary"]'::jsonb,
            1,
            true
        );
    ELSE
        UPDATE public.ai_prompts
        SET prompt = 'You are an enterprise task verification AI.

Analyze whether the uploaded task proof satisfies the task.

Task:
{instruction}

Analyzing Parameters:
{analyzing_parameters}

Evidence summary:
{evidence_summary}

Rules:
- Use detected objects as visual proof
- Use CLIP score for semantic similarity
- Use OCR only when text matters
- Use pose/activity when relevant
- Missing required objects should reduce score
- Reject fake or unrelated submissions
- You have access to the actual uploaded image. Inspect it directly.
- Follow the Analyzing Parameters when evaluating the submission.
- If the task requires a visual classification, make that classification from the image itself.
- Do not assume a task is satisfied merely because the CLIP score is high.
- If the image does not contain enough visual evidence to evaluate the criteria, mark the submission for review.

Return STRICT JSON ONLY:
{{
 "passed": true,
 "score": 0,
 "feedback": "short explanation",
 "classification": "if applicable, otherwise null"
}}',
            variables = '["instruction", "analyzing_parameters", "evidence_summary"]'::jsonb,
            enabled = true,
            updated_at = NOW()
        WHERE feature_id = v_vision_feature_id AND prompt_type = 'default';
    END IF;

    -- Prompt: image_verification (alias)
    IF NOT EXISTS (
        SELECT 1 FROM public.ai_prompts
        WHERE feature_id = v_vision_feature_id AND prompt_type = 'image_verification'
    ) THEN
        INSERT INTO public.ai_prompts (
            feature_id, prompt_type, prompt, variables, version, enabled
        ) VALUES (
            v_vision_feature_id,
            'image_verification',
            'You are an enterprise task verification AI.

Analyze whether the uploaded task proof satisfies the task.

Task:
{instruction}

Analyzing Parameters:
{analyzing_parameters}

Evidence summary:
{evidence_summary}

Rules:
- Use detected objects as visual proof
- Use CLIP score for semantic similarity
- Use OCR only when text matters
- Use pose/activity when relevant
- Missing required objects should reduce score
- Reject fake or unrelated submissions
- You have access to the actual uploaded image. Inspect it directly.
- Follow the Analyzing Parameters when evaluating the submission.
- If the task requires a visual classification, make that classification from the image itself.
- Do not assume a task is satisfied merely because the CLIP score is high.
- If the image does not contain enough visual evidence to evaluate the criteria, mark the submission for review.

Return STRICT JSON ONLY:
{{
 "passed": true,
 "score": 0,
 "feedback": "short explanation",
 "classification": "if applicable, otherwise null"
}}',
            '["instruction", "analyzing_parameters", "evidence_summary"]'::jsonb,
            1,
            true
        );
    END IF;

    -- Prompt: video_frames (Video Frame Analysis)
    IF NOT EXISTS (
        SELECT 1 FROM public.ai_prompts
        WHERE feature_id = v_vision_feature_id AND prompt_type = 'video_frames'
    ) THEN
        INSERT INTO public.ai_prompts (
            feature_id, prompt_type, prompt, variables, version, enabled
        ) VALUES (
            v_vision_feature_id,
            'video_frames',
            'You are an employee performance evaluator.

Analyze these video frames for the employee task.

Task:
{task_description}

IMPORTANT RULES:
- A person may appear in a small part of the frame.
- A person may appear along with slides, screen, product, or objects.
- If ANY human face/body/person is visible in ANY frame, person_visible MUST be true.
- Do NOT mark person_visible false just because slides or animations are present.
- Evaluate the visible employee only.

Return ONLY valid JSON:
{{
 "task_completed": true,
 "person_visible": true,
 "visual_score": 0,
 "eye_contact_score": 0,
 "body_language_score": 0,
 "professionalism_score": 0,
 "engagement_score": 0,
 "strengths": [],
 "weaknesses": [],
 "feedback": ""
}}

Scoring:
- visual_score means how well the employee performed the task visually.
- eye_contact_score means looking towards camera/audience.
- body_language_score means posture, gestures, confidence.
- professionalism_score means appearance and presentation.
- engagement_score means energy and involvement.

If employee is visible:
Never return all visual scores as 0.',
            '["task_description"]'::jsonb,
            1,
            true
        );
    ELSE
        UPDATE public.ai_prompts
        SET prompt = 'You are an employee performance evaluator.

Analyze these video frames for the employee task.

Task:
{task_description}

IMPORTANT RULES:
- A person may appear in a small part of the frame.
- A person may appear along with slides, screen, product, or objects.
- If ANY human face/body/person is visible in ANY frame, person_visible MUST be true.
- Do NOT mark person_visible false just because slides or animations are present.
- Evaluate the visible employee only.

Return ONLY valid JSON:
{{
 "task_completed": true,
 "person_visible": true,
 "visual_score": 0,
 "eye_contact_score": 0,
 "body_language_score": 0,
 "professionalism_score": 0,
 "engagement_score": 0,
 "strengths": [],
 "weaknesses": [],
 "feedback": ""
}}

Scoring:
- visual_score means how well the employee performed the task visually.
- eye_contact_score means looking towards camera/audience.
- body_language_score means posture, gestures, confidence.
- professionalism_score means appearance and presentation.
- engagement_score means energy and involvement.

If employee is visible:
Never return all visual scores as 0.',
            variables = '["task_description"]'::jsonb,
            enabled = true,
            updated_at = NOW()
        WHERE feature_id = v_vision_feature_id AND prompt_type = 'video_frames';
    END IF;


    -- ==========================================================================
    -- 4. FEATURE: task_insights
    -- ==========================================================================
    SELECT feature_id INTO v_insights_feature_id
    FROM public.ai_features
    WHERE feature_key = 'task_insights'
    LIMIT 1;

    IF v_insights_feature_id IS NULL THEN
        INSERT INTO public.ai_features (
            feature_key,
            feature_name,
            description,
            is_active
        ) VALUES (
            'task_insights',
            'Task Insights & Coaching Outcomes',
            'Synthesizes manager-ready business outcomes, actions taken, learnings, and coaching insights across task submissions.',
            true
        ) RETURNING feature_id INTO v_insights_feature_id;
    ELSE
        UPDATE public.ai_features
        SET feature_name = 'Task Insights & Coaching Outcomes',
            description = 'Synthesizes manager-ready business outcomes, actions taken, learnings, and coaching insights across task submissions.',
            is_active = true,
            updated_at = NOW()
        WHERE feature_id = v_insights_feature_id;
    END IF;

    -- Model Config: Primary Gemini 2.5 Flash
    IF NOT EXISTS (
        SELECT 1 FROM public.ai_model_configs
        WHERE feature_id = v_insights_feature_id AND provider = 'gemini' AND model_name = 'gemini-2.5-flash'
    ) THEN
        INSERT INTO public.ai_model_configs (
            feature_id, provider, model_name, temperature, top_p, max_tokens,
            priority, enabled, input_cost_per_million, output_cost_per_million,
            response_format, timeout_seconds
        ) VALUES (
            v_insights_feature_id, 'gemini', 'gemini-2.5-flash', 0.20, 0.95, 4096,
            1, true, 0.300000, 1.500000, 'json', 300
        );
    ELSE
        UPDATE public.ai_model_configs
        SET temperature = 0.20, top_p = 0.95, max_tokens = 4096, priority = 1,
            enabled = true, input_cost_per_million = 0.300000, output_cost_per_million = 1.500000,
            response_format = 'json', timeout_seconds = 300, updated_at = NOW()
        WHERE feature_id = v_insights_feature_id AND provider = 'gemini' AND model_name = 'gemini-2.5-flash';
    END IF;

    -- Model Config: Fallback OpenAI GPT-4o-mini
    IF NOT EXISTS (
        SELECT 1 FROM public.ai_model_configs
        WHERE feature_id = v_insights_feature_id AND provider = 'openai' AND model_name = 'gpt-4o-mini'
    ) THEN
        INSERT INTO public.ai_model_configs (
            feature_id, provider, model_name, temperature, top_p, max_tokens,
            priority, enabled, input_cost_per_million, output_cost_per_million,
            response_format, timeout_seconds
        ) VALUES (
            v_insights_feature_id, 'openai', 'gpt-4o-mini', 0.20, 0.95, 4096,
            2, true, 0.150000, 0.600000, 'json', 300
        );
    ELSE
        UPDATE public.ai_model_configs
        SET temperature = 0.20, top_p = 0.95, max_tokens = 4096, priority = 2,
            enabled = true, input_cost_per_million = 0.150000, output_cost_per_million = 0.600000,
            response_format = 'json', timeout_seconds = 300, updated_at = NOW()
        WHERE feature_id = v_insights_feature_id AND provider = 'openai' AND model_name = 'gpt-4o-mini';
    END IF;

    -- Prompt: default (Task Coaching & Business Insights)
    IF NOT EXISTS (
        SELECT 1 FROM public.ai_prompts
        WHERE feature_id = v_insights_feature_id AND prompt_type = 'default'
    ) THEN
        INSERT INTO public.ai_prompts (
            feature_id, prompt_type, prompt, variables, version, enabled
        ) VALUES (
            v_insights_feature_id,
            'default',
            'You are an AI task analyst and expert Enterprise AI Coaching Assistant.
Your task is to extract BUSINESS outcomes and manager-ready coaching insights from the employee submission.
Ignore AI quality metrics, CLIP scores, audio quality, and visual scores. Focus on employee performance.

Task: {task_title}
Description: {task_description}
Expected Answer/Behavior: {expected_answer}
Analyzing Parameters (Evaluation Criteria): {analyzing_parameters}
Submission Type: {submission_type}

ANALYSIS FOCUS:
You must ONLY analyze the following criteria relevant to this submission type:
{analysis_focus}

SCHEMA MAPPING INSTRUCTIONS:
Map your findings into the JSON output according to these exact rules:
{schema_mapping}

STRICT CONSTRAINTS:
1. NEVER invent or hallucinate information.
2. Metrics need exact evidence from the submission.
3. If information for a field cannot be inferred, you MUST return an empty array [].
4. Do NOT write "Missing", "Not applicable", or "None found" inside the array.
5. For AUDIO submissions, the transcript is generated by ASR and may contain minor typos. Focus on the semantic meaning.

SUBMISSION CONTENT:
{submission_content}

{evaluation_summary}

Return STRICT JSON ONLY matching:
{{
  "summary": "string",
  "measurable_outcomes": [],
  "actions_taken": [],
  "unique_methods": [],
  "challenges": [],
  "learnings": [],
  "missing_information": [],
  "extraction_confidence": "high|medium|low"
}}',
            '["task_title", "task_description", "expected_answer", "analyzing_parameters", "submission_type", "analysis_focus", "schema_mapping", "submission_content", "evaluation_summary"]'::jsonb,
            1,
            true
        );
    ELSE
        UPDATE public.ai_prompts
        SET prompt = 'You are an AI task analyst and expert Enterprise AI Coaching Assistant.
Your task is to extract BUSINESS outcomes and manager-ready coaching insights from the employee submission.
Ignore AI quality metrics, CLIP scores, audio quality, and visual scores. Focus on employee performance.

Task: {task_title}
Description: {task_description}
Expected Answer/Behavior: {expected_answer}
Analyzing Parameters (Evaluation Criteria): {analyzing_parameters}
Submission Type: {submission_type}

ANALYSIS FOCUS:
You must ONLY analyze the following criteria relevant to this submission type:
{analysis_focus}

SCHEMA MAPPING INSTRUCTIONS:
Map your findings into the JSON output according to these exact rules:
{schema_mapping}

STRICT CONSTRAINTS:
1. NEVER invent or hallucinate information.
2. Metrics need exact evidence from the submission.
3. If information for a field cannot be inferred, you MUST return an empty array [].
4. Do NOT write "Missing", "Not applicable", or "None found" inside the array.
5. For AUDIO submissions, the transcript is generated by ASR and may contain minor typos. Focus on the semantic meaning.

SUBMISSION CONTENT:
{submission_content}

{evaluation_summary}

Return STRICT JSON ONLY matching:
{{
  "summary": "string",
  "measurable_outcomes": [],
  "actions_taken": [],
  "unique_methods": [],
  "challenges": [],
  "learnings": [],
  "missing_information": [],
  "extraction_confidence": "high|medium|low"
}}',
            variables = '["task_title", "task_description", "expected_answer", "analyzing_parameters", "submission_type", "analysis_focus", "schema_mapping", "submission_content", "evaluation_summary"]'::jsonb,
            enabled = true,
            updated_at = NOW()
        WHERE feature_id = v_insights_feature_id AND prompt_type = 'default';
    END IF;

END $$;

