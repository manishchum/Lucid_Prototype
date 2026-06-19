import os
import json
import ast
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Request, Depends
from fastapi.responses import JSONResponse
# from supabase import create_client, Client
from utils.supabase_client import supabase
from utils.auth import RequestAuth, get_request_auth_required
from utils.auth_bridge import get_service_supabase_client
from utils.redis_client import get_cache, set_cache, redis_client

import google.generativeai as genai

router = APIRouter()


def _to_iso_now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _get_supabase_error_code(err: Any) -> Optional[str]:
    if not err:
        return None

    # Common cases across supabase-py versions
    if isinstance(err, dict):
        return err.get("code") or err.get("error") or err.get("statusCode")

    # Some versions have attributes
    return getattr(err, "code", None) or getattr(err, "error", None) or getattr(err, "status_code", None)


# NOTE:
# In Next.js you did:
# const { createClient } = await import("@supabase/supabase-js")
# const adminClient = createClient(supabaseUrl, supabaseServiceKey)
#
# In FastAPI Python we do it here similarly.
# def _get_admin_client():
#     supabaseUrl = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
#     supabaseServiceKey = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
#     if not supabaseUrl or not supabaseServiceKey:
#         return None, supabaseUrl, supabaseServiceKey
#     adminClient: Client = create_client(supabaseUrl, supabaseServiceKey)
#     return adminClient, supabaseUrl, supabaseServiceKey


@router.post("/learning-style")
async def POST(req: Request, auth_ctx: RequestAuth = Depends(get_request_auth_required)):
    stage = "start"
    try:
        query_client = supabase
        if auth_ctx.claims:
            query_client = get_service_supabase_client()

        stage = "read_body"
        body = await req.json()
        user_id = body.get("user_id")
        answers = body.get("answers")
        print(f"[LearningStyle][POST] stage={stage} user_id={user_id} answers_len={len(answers) if isinstance(answers, list) else 'n/a'}")

        if (not user_id) or (not answers) or (not isinstance(answers, list)) or (len(answers) != 40):
            return JSONResponse(content={"error": "Invalid payload"}, status_code=400)

        # Use supabase admin client for server-side inserts
        # stage = "get_admin_client"
        # adminClient, supabaseUrl, supabaseServiceKey = _get_admin_client()
        # if not supabaseUrl or not supabaseServiceKey or not adminClient:
        #     return JSONResponse(content={"error": "Supabase service key missing"}, status_code=500)

        # Check if already exists for this employee
        stage = "fetch_existing"
        existing = None
        fetchError: Any = None
        try:
            fetch_resp = (
                query_client
                .table("employee_learning_style")
                .select("user_id, learning_style, gpt_analysis, answers")
                .eq("user_id", user_id)
                .single()
                .execute()
            )
            existing = getattr(fetch_resp, "data", None)
            fetchError = getattr(fetch_resp, "error", None)
        except Exception as fetch_ex:
            # Some supabase-py/postgrest versions raise on .single() when 0 rows
            fetchError = getattr(fetch_ex, "message", None) or getattr(fetch_ex, "args", None) or str(fetch_ex)

        # Normalize common error shapes so we can reliably read error["code"]
        if isinstance(fetchError, (list, tuple)) and len(fetchError) == 1:
            fetchError = fetchError[0]
        if isinstance(fetchError, str):
            s = fetchError.strip()
            if s.startswith("{") and ("'code'" in s or '"code"' in s):
                try:
                    parsed_err = ast.literal_eval(s)
                    if isinstance(parsed_err, dict):
                        fetchError = parsed_err
                except Exception:
                    pass

        fetch_error_code = None
        if fetchError and isinstance(fetchError, dict):
            fetch_error_code = fetchError.get("code")
        else:
            fetch_error_code = _get_supabase_error_code(fetchError)

        # Some versions surface PGRST116 only via the error message
        if fetchError and not fetch_error_code:
            if "Cannot coerce the result to a single JSON object" in str(fetchError):
                fetch_error_code = "PGRST116"

        if fetchError and fetch_error_code:
            print(f"[LearningStyle][POST] stage={stage} supabase_fetch_error_code={fetch_error_code} supabase_fetch_error={fetchError}")

        # IMPORTANT: preserve logic
        # if (fetchError && fetchError.code !== "PGRST116") return 500
        if fetchError and fetch_error_code != "PGRST116":
            return JSONResponse(
                content={"error": fetchError.get("message") if isinstance(fetchError, dict) else str(fetchError)},
                status_code=500,
            )

        # Treat no-rows as no existing record
        if fetch_error_code == "PGRST116":
            existing = None

        stage = "compute_now"
        now = _to_iso_now()

        # If learning style and analysis already exist, just update answers and return existing data
        if existing and existing.get("learning_style") and existing.get("gpt_analysis"):
            stage = "existing_has_analysis_update_answers"
            # Update only the answers to keep record of latest submission
            update_resp = (
                query_client
                .table("employee_learning_style")
                .update({"answers": answers, "updated_at": now})
                .eq("user_id", user_id)
                .execute()
            )

            updateError = getattr(update_resp, "error", None)
            if updateError:
                print("[LearningStyle] Error updating answers:", updateError)

            return JSONResponse(content={
                "success": True,
                "gpt": {
                    "dominant_style": existing.get("learning_style"),
                    "learning_style": existing.get("learning_style"),
                    "report": existing.get("gpt_analysis")
                },
                "message": "Learning style already determined - using existing analysis"
            })

        if existing:
            stage = "existing_no_analysis_update_answers"
            # If a row exists but no learning style determined yet, update answers and continue with analysis
            update_resp = (
                query_client
                .table("employee_learning_style")
                .update({"answers": answers, "updated_at": now})
                .eq("user_id", user_id)
                .execute()
            )
            updateError = getattr(update_resp, "error", None)
            if updateError:
                return JSONResponse(content={"error": updateError.message}, status_code=500)
        else:
            stage = "insert_new_row"
            # Insert new entry
            insert_resp = (
                query_client
                .table("employee_learning_style")
                .insert({"user_id": user_id, "answers": answers, "created_at": now, "updated_at": now})
                .execute()
            )
            insertError = getattr(insert_resp, "error", None)
            if insertError:
                return JSONResponse(content={"error": insertError.message}, status_code=500)

        # Compute deterministic fallback learning style from the answers (10 questions per style)
        stage = "compute_fallback"
        fallbackStyle: Optional[str] = None
        try:
            nums = [(float(a) if a is not None else 0.0) for a in answers]

            def sumRange(start: int, end: int):
                return sum(nums[start:end])

            scores = {
                "CS": sumRange(0, 10),
                "AS": sumRange(10, 20),
                "AR": sumRange(20, 30),
                "CR": sumRange(30, 40),
            }

            entries = list(scores.items())
            entries.sort(key=lambda x: x[1], reverse=True)
            fallbackStyle = entries[0][0]

            # Save fallback learning style immediately so row isn't left null
            fallback_update_resp = (
                query_client
                .table("employee_learning_style")
                .update({"learning_style": fallbackStyle, "updated_at": _to_iso_now()})
                .eq("user_id", user_id)
                .execute()
            )

            fallbackErr = getattr(fallback_update_resp, "error", None)
            if fallbackErr:
                print("[LearningStyle] Failed to save fallback learning style", fallbackErr)
            else:
                pass
        except Exception as e:
            print("[LearningStyle] Fallback computation error", e)
        redis_client.delete(f"learning_style:{user_id}")

        # Call Gemini for learning style analysis
        gptResult: Any = None
        learnedStyle: Optional[str] = None
        rawGPTText: Optional[str] = None

        try:
            # Initialize Gemini AI
            stage = "gemini_init"
            if not os.getenv("GEMINI_API_KEY"):
                raise Exception("GEMINI_API_KEY is missing")

            genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
            model = genai.GenerativeModel("gemini-3.1-pro-preview")

            # List of 48 learning style questions
            questions = [
                "I like having written directions before starting a task.",
                "I prefer to follow a schedule rather than improvise.",
                "I feel most comfortable when rules are clear.",
                "I focus on details before seeing the big picture.",
                "I rely on tried-and-tested methods to get things done.",
                "I need to finish one task before moving to the next.",
                "I learn best by practicing exact procedures.",
                "I find comfort in structure, order, and neatness.",
                "I like working with checklists and measurable steps.",
                "I feel uneasy when things are left open-ended.",
                "I enjoy reading and researching before making decisions.",
                "I like breaking down problems into smaller parts.",
                "I prefer arguments backed by evidence and facts.",
                "I think logically through situations before acting.",
                "I enjoy analyzing patterns, models, and systems.",
                "I often reflect deeply before I share my opinion.",
                "I value accuracy and logical consistency.",
                "I prefer theories and principles to practical examples.",
                "I like well-reasoned debates and discussions.",
                "I enjoy working independently on complex problems.",
                "I learn best through stories or real-life experiences.",
                "I am motivated when learning is connected to people’s lives.",
                "I prefer group projects and collaborative discussions.",
                "I often trust my intuition more than data.",
                "I enjoy free-flowing brainstorming sessions.",
                "I find it easy to sense others’ feelings in a group.",
                "I value relationships more than rigid rules.",
                "I like using imagination to explore new ideas.",
                "I prefer flexible plans that allow room for change.",
                "I need an emotional connection to stay interested in learning.",
                "I like trying out new methods, even if they fail.",
                "I enjoy solving problems in unconventional ways.",
                "I learn best by experimenting and adjusting as I go.",
                "I dislike strict rules that limit my creativity.",
                "I am energized by competition and challenges.",
                "I like taking risks if there’s a chance of high reward.",
                "I get bored doing the same task repeatedly.",
                "I prefer freedom to explore multiple approaches.",
                "I often act quickly and figure things out later.",
                "I am comfortable making decisions with limited information."
            ]

            # Pair each question with its answer
            qaPairs = "\n".join([
                f"Q{i+1}: {q}\nA{i+1}: {answers[i] if i < len(answers) else ''}"
                for i, q in enumerate(questions)
            ])

            # Prompt preserved EXACTLY
            prompt = f"""You are an expert educational psychologist specializing in learning style models. Your goal is to administer the Gregorc Learning Style Delineator, analyze the user's responses, calculate their scores, and generate a detailed and empathetic report on their dominant learning style(s).

Background on the Model: The Gregorc model defines four learning styles based on how individuals perceive and order information:
1. Concrete Sequential (CS): The organizer. Learns through hands-on experience, logical sequence, structured environments, and practicality. Prefers clear instructions, deadlines, and facts.
2. Abstract Sequential (AS): The thinker. Learns through analysis, intellectual exploration, theoretical models, and critical thinking. Prefers lectures, reading, research, and independent work.
3. Abstract Random (AR): The empathizer. Learns through reflection, emotional connection, group harmony, and holistic understanding. Prefers group discussions, open-ended activities, and personal relationships with instructors.
4. Concrete Random (CR): The innovator. Learns through experimentation, intuition, discovery, and solving problems in unconventional ways. Prefers trial-and-error, options, flexibility, and challenging the status quo.
Most people have a blend but with a dominant preference.

Step 1- Assess the learning style
You are an expert in learning style assessment and data analysis. Your task is to calculate and interpret the results of a learning style assessment questionnaire based on Gregorc Learning Style
The Background:
• The questionnaire is based on Dr. Anthony Gregorc's model.
• It measures four distinct learning styles: Concrete Sequential (CS), Abstract Sequential (AS), Abstract Random (AR), and Concrete Random (CR).
• The test consists of 40 total questions.
• There are 10 questions dedicated to each of the four learning styles.
• Respondents answer using a Likert scale (e.g., from 1 = "Least Like Me" to 5 = "Most Like Me").
• For each learning style there are 10 questions. Mapping of the questions to learning style is:
  - Concrete Sequential (CS): Questions 1-10
  - Abstract Sequential (AS): Questions 11-20
  - Abstract Random (AR): Questions 21-30
  - Concrete Random (CR): Questions 31-40

Your Step-by-Step Task:
1. Calculate the Scores:
  - For each of the four styles, calculate the total sum of the scores for its corresponding 10 questions.
  - Present the four totals clearly. The maximum possible score for any style is 50 (10 questions * 5). The minimum is 10.
2. Identify Dominant and Secondary Styles:
  - Dominant Style: The style with the highest total score is the dominant learning style.
  - Secondary Style(s): The style with the second-highest score is a strong secondary preference. If scores are very close (e.g., within 2-3 points), note that the person has a strong blend of those styles.
  - Use the following class intervals to describe the strength of the preference for each style:
    • 40-50 Points: Very Strong Preference
    • 30-39 Points: Strong Preference
    • 20-29 Points: Moderate Preference
    • 10-19 Points: Low Preference

Step 2: Generate the User Report
Return the report as plain text with EXACTLY these headings and bullet structure so it can be parsed:

Title: Your Personal Learning Style Insights

1. Your Natural Learning Style:
  - "Your approach to learning is most like that of The [Organizer/Thinker/Connector/Innovator]."
  - Provide a concise 2-3 paragraph description of the dominant style.

2. How You Thrive:
  - Ideal Learning Environment: bullet 4-5 items
  - Your Superpowers: bullet 3-4 items

3. Tips to Make Learning Easier:
  - If you feel stuck, try: bullet 4-5 actionable strategies
  - What to Look For: bullet 3-4 content types

Return JSON: {{
  scores: {{ CS: number, AS: number, AR: number, CR: number }},
  dominant_style: "CS|AS|AR|CR",
  secondary_style: "CS|AS|AR|CR",
  report: "...full user report..."
}}

Survey Responses:
{qaPairs}"""

            stage = "gemini_generate_content"
            result = model.generate_content(prompt)
            response = result.text
            gptText = response
            rawGPTText = gptText

            print(f"[LearningStyle][POST] stage={stage} gemini_text_len={len(gptText) if gptText else 0}")

            analysisText: Optional[str] = None

            try:
                stage = "gemini_parse_json"
                parsed = json.loads(gptText)
                gptResult = parsed
                learnedStyle = parsed.get("dominant_style") or parsed.get("learning_style") or parsed.get("dominant") or None
                analysisText = parsed.get("report") or parsed.get("analysis") or parsed.get("reportText") or None

                if (not learnedStyle) and parsed.get("scores") and isinstance(parsed.get("scores"), dict):
                    sEntries = list(parsed["scores"].items())
                    sEntries.sort(key=lambda x: float(x[1]), reverse=True)
                    learnedStyle = sEntries[0][0] if len(sEntries) > 0 else None

            except Exception as parse_ex:
                print(f"[LearningStyle][POST] stage={stage} json_parse_failed err={parse_ex} (falling back to raw text)")
                gptResult = {"raw": gptText}
                analysisText = gptText

            stage = "save_gpt_analysis"
            updatePayload: Dict[str, Any] = {"updated_at": _to_iso_now()}

            # Save analysis text if available
            if analysisText:
                updatePayload["gpt_analysis"] = analysisText
            elif gptResult and isinstance(gptResult, dict) and (gptResult.get("raw") or gptResult.get("raw_text")):
                updatePayload["gpt_analysis"] = str(gptResult.get("raw") or gptResult.get("raw_text"))
            elif rawGPTText:
                updatePayload["gpt_analysis"] = rawGPTText

            # Decide the final style to persist and return
            finalStyle = learnedStyle if (learnedStyle and updatePayload.get("gpt_analysis")) else fallbackStyle

            if finalStyle:
                updatePayload["learning_style"] = finalStyle

            # If we have something besides updated_at to save, update the row
            if len(updatePayload.keys()) > 1:
                save_resp = (
                    query_client
                .table("employee_learning_style")
                    .update(updatePayload)
                    .eq("user_id", user_id)
                    .execute()
                )
                saveErr = getattr(save_resp, "error", None)
                if saveErr:
                    print("[LearningStyle] Failed to save GPT analysis", saveErr)
                else:
                    print(f"[LearningStyle][POST] stage={stage} saved learning_style={updatePayload.get('learning_style')} gpt_analysis_len={len(str(updatePayload.get('gpt_analysis') or ''))}")
                redis_client.delete(f"learning_style:{user_id}")

            # Ensure response contains dominant_style
            if gptResult and isinstance(gptResult, dict):
                gptResult["dominant_style"] = finalStyle or gptResult.get("dominant_style") or gptResult.get("learning_style") or None
                if gptResult.get("report") and isinstance(gptResult.get("report"), str):
                    gptResult["report"] = gptResult["report"].replace("\\n", "\n")
            elif not gptResult:
                gptResult = {"dominant_style": finalStyle}

        except Exception as saveEx:
            print(f"[LearningStyle][POST] stage={stage} error_in_gemini_or_save: {saveEx}")

        return JSONResponse(content={"success": True, "gpt": gptResult})

    except Exception as err:
        print(f"[LearningStyle][POST] stage={stage} fatal_error: {err}")
        return JSONResponse(content={"error": str(err) if str(err) else "Unknown error", "stage": stage}, status_code=500)


@router.get("/learning-style")
async def GET(req: Request, auth_ctx: RequestAuth = Depends(get_request_auth_required)):
    try:
        query_client = supabase
        if auth_ctx.claims:
            query_client = get_service_supabase_client()

        user_id = req.query_params.get("user_id")

        if not user_id:
            return JSONResponse(content={"error": "user_id required"}, status_code=400)

        cache_key = f"learning_style:{user_id}"
        cached = get_cache(cache_key)
        if cached:
            print(f"LEARNING STYLE CACHE HIT {cache_key}")
            return JSONResponse(content=cached)
        print(f"LEARNING STYLE CACHE MISS {cache_key}")
        
        # adminClient, supabaseUrl, supabaseServiceKey = _get_admin_client()
        # if not supabaseUrl or not supabaseServiceKey or not adminClient:
        #     return JSONResponse(content={"error": "Supabase service key missing"}, status_code=500)

        record = None
        error: Any = None
        try:
            fetch_resp = (
                query_client
                .table("employee_learning_style")
                .select("learning_style, gpt_analysis")
                .eq("user_id", user_id)
                .single()
                .execute()
            )

            record = getattr(fetch_resp, "data", None)
            error = getattr(fetch_resp, "error", None)
        except Exception as fetch_ex:
            # Some supabase-py/postgrest versions raise on .single() when 0 rows
            error = getattr(fetch_ex, "message", None) or getattr(fetch_ex, "args", None) or str(fetch_ex)

        # Normalize common error shapes so we can reliably read error["code"]
        if isinstance(error, (list, tuple)) and len(error) == 1:
            error = error[0]
        if isinstance(error, str):
            s = error.strip()
            if s.startswith("{") and ("'code'" in s or '"code"' in s):
                try:
                    parsed_err = ast.literal_eval(s)
                    if isinstance(parsed_err, dict):
                        error = parsed_err
                except Exception:
                    pass

        # ✅ Python supabase can return error as dict (your case)
        error_code = None
        if error and isinstance(error, dict):
            error_code = error.get("code")
        else:
            error_code = _get_supabase_error_code(error)

        # Some versions surface PGRST116 only via the error message
        if error and not error_code:
            if "Cannot coerce the result to a single JSON object" in str(error):
                error_code = "PGRST116"

        # preserve TS logic:
        # if (error && error.code !== 'PGRST116') return 500
        if error and error_code != "PGRST116":
            return JSONResponse(
                content={"error": error.get("message") if isinstance(error, dict) else str(error)},
                status_code=500,
            )

        # TS logic: if (!record) return { data: null }
        if not record:
            return JSONResponse(content={"data": None})

        gpt_analysis = record.get("gpt_analysis")
        if gpt_analysis and isinstance(gpt_analysis, str):
            gpt_analysis = gpt_analysis.replace("\\n", "\n")

        response_payload = {
            "success": True,
            "data": {
                "learning_style": record.get("learning_style"),
                "gpt_analysis": gpt_analysis
            }
        }
        set_cache(cache_key, response_payload, ttl=3600)
        return JSONResponse(content=response_payload)

    except Exception as err:
        return JSONResponse(content={"error": str(err) if str(err) else "Unknown error"}, status_code=500)
