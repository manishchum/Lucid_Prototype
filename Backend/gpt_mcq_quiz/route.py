import os
import re
import json
import hashlib
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Request, Depends
from fastapi.responses import JSONResponse
# from supabase import create_client, Client
from utils.supabase_client import supabase
from utils.auth import RequestAuth, get_request_auth_required
from utils.auth_bridge import get_service_supabase_client
from utils.redis_client import get_cache, set_cache

# import google.generativeai as genai

from ai.ai_gateway import AI
from ai.types import AIRequest

router = APIRouter()

# Equivalent of: import { supabase } from '@/lib/supabase';
# supabaseUrl = os.getenv("NEXT_PUBLIC_SUPABASE_URL") or os.getenv("SUPABASE_URL") or ""
# supabaseKey = (
#     os.getenv("SUPABASE_SERVICE_ROLE_KEY")
#     or os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
#     or os.getenv("SUPABASE_ANON_KEY")
#     or ""
# )

# supabase: Client = create_client(supabaseUrl, supabaseKey)

# Verify GEMINI_API_KEY is loaded
# if not os.getenv("GEMINI_API_KEY"):
#     print("[gpt-mcq-quiz] CRITICAL: GEMINI_API_KEY is not set in environment variables!")

# genai.configure(api_key=os.getenv("GEMINI_API_KEY") or "")


# -----------------------------
# Deep comparison helpers for modules
# -----------------------------
def normalizeModules(modules: Any):
    if not isinstance(modules, list):
        return []

    validModules = [
        m for m in modules
        if m and isinstance(m, dict) and isinstance(m.get("title"), str)
    ]

    return sorted(
        [
            {
                **m,
                "topics": sorted(list(m.get("topics"))) if isinstance(m.get("topics"), list) else [],
                "objectives": sorted(list(m.get("objectives"))) if isinstance(m.get("objectives"), list) else [],
            }
            for m in validModules
        ],
        key=lambda x: x.get("title", "")
    )

def parse_quiz_response(content: Any) -> List[Any]:
    if not content:
        return []

    if isinstance(content, list):
        return content

    if isinstance(content, dict):
        return [content]

    if not isinstance(content, str):
        return []

    cleaned_content = content.strip()

    json_start = cleaned_content.find("[")
    json_end = cleaned_content.rfind("]")

    if json_start != -1 and json_end != -1 and json_end > json_start:
        cleaned_content = cleaned_content[json_start:json_end + 1]
    else:
        if cleaned_content.startswith("```json"):
            cleaned_content = cleaned_content.replace("```json", "", 1).strip()
            if cleaned_content.endswith("```"):
                cleaned_content = cleaned_content[:-3].strip()
        elif cleaned_content.startswith("```"):
            cleaned_content = cleaned_content.replace("```", "", 1).strip()
            if cleaned_content.endswith("```"):
                cleaned_content = cleaned_content[:-3].strip()

    try:
        parsed = json.loads(cleaned_content)
    except Exception as exc:
        print("[gpt-mcq-quiz] Failed to parse AI response:", exc)
        return []

    return parsed if isinstance(parsed, list) else []
# -----------------------------
# Helper to call Gemini for MCQ quiz generation
# -----------------------------
# async def generateMCQQuiz(summary: str, modules: Any, objectives: Any) -> List[Any]:
#     prompt = f"""You are an expert instructional designer. Your task is to generate multiple-choice questions (MCQs) from the provided learning content using Bloom's Taxonomy.

# Input: A learning asset (text, notes, or structured content).

# Output: A set of 30 MCQs (Multiple Choice Questions) distributed across difficulty levels based on Bloom's Taxonomy.

# Easy → Remember & Understand (default: 20%)
# Average → Apply & Analyze (default: 50%)
# Difficult → Evaluate & Create (default: 30%)

# Bloom's Level Mapping:
# Remember: Define, List, Identify, Recall, Name, Label, Recognize, State, Match, Repeat, Select
# Understand: Explain, Summarize, Describe, Interpret, Restate, Paraphrase, Classify, Discuss, Illustrate, Compare (basic), Report
# Apply: Solve, Demonstrate, Use, Implement, Apply, Execute, Practice, Show, Operate, Employ, Perform
# Analyze: Differentiate, Compare, Contrast, Organize, Examine, Break down, Categorize, Investigate, Distinguish, Attribute, Diagram
# Evaluate: Judge, Critique, Justify, Recommend, Assess, Evaluate, Defend, Support, Argue, Prioritize, Appraise, Rate, Validate
# Create: Design, Generate, Propose, Develop, Formulate, Construct, Invent, Plan, Compose, Produce, Hypothesize, Integrate, Originate

# Exhaustive Question-Type Bank (Stems/Patterns):
# Remember: "What is…?", "Which of the following defines…?", "Identify…", "Who discovered…?", "When/Where did…?", "Match the term with…"
# Understand: "Which best explains…?", "Summarize…", "What does this mean…?", "Which example illustrates…?", "Why does…happen?"
# Apply: "Which principle would you use if…?", "What is the correct method to…?", "How would you solve…?", "Which tool/technique applies to…?", "Which step comes next…?"
# Analyze: "Which factor contributes most to…?", "What pattern best explains…?", "Which cause-effect relationship is correct…?", "What evidence supports…?", "Which statement best differentiates between…?"
# Evaluate: "Which option provides the best justification…?", "Which solution is most effective and why?", "Which argument is strongest?", "Which evidence best supports…?", "What decision is most appropriate…?"
# Create: "What new approach could be developed…?", "Which design achieves…?", "How would you improve…?", "Which combination of ideas solves…?", "What hypothesis could you form…?"

# Question Design Rules:
# - Each question must explicitly map to its Bloom's level.
# - Provide 4 answer choices (A–D).
# - Clearly mark the correct answer.
# - Avoid ambiguity; test one concept per question. Ensure every concept is tested.

# Return ONLY a valid JSON array of 30 question objects, with no extra text, markdown, code blocks, or formatting. Each object must include:
# {{
#   "question": string,
#   "bloomLevel": string,
#   "options": [string, string, string, string],
#   "correctIndex": number,
#   "explanation": string (optional)
# }}

# Learning Content:
# Summary: {summary}
# Modules: {json.dumps(modules)}
# Objectives: {json.dumps(objectives)}
# """

#     try:
#         model = genai.GenerativeModel("gemini-2.5-pro")
#         result = model.generate_content(prompt)
#         content = result.text if result else None

#         if not content:
#             print("[gpt-mcq-quiz][ERROR] Gemini returned empty response")
#             return []

#         quiz: Any = None
#         try:
#             cleanedContent = content.strip()

#             jsonStart = cleanedContent.find("[")
#             jsonEnd = cleanedContent.rfind("]")

#             if jsonStart != -1 and jsonEnd != -1 and jsonEnd > jsonStart:
#                 cleanedContent = cleanedContent[jsonStart:jsonEnd + 1]
#             else:
#                 if cleanedContent.startswith("```json"):
#                     cleanedContent = cleanedContent.replace("```json", "", 1).strip()
#                     if cleanedContent.endswith("```"):
#                         cleanedContent = cleanedContent[:-3].strip()
#                 elif cleanedContent.startswith("```"):
#                     cleanedContent = cleanedContent.replace("```", "", 1).strip()
#                     if cleanedContent.endswith("```"):
#                         cleanedContent = cleanedContent[:-3].strip()

#             quiz = json.loads(cleanedContent)

#             if (not isinstance(quiz, list)) or len(quiz) == 0:
#                 print("[gpt-mcq-quiz][WARN] Parsed quiz is empty or not an array:", quiz)
#                 quiz = []

#         except Exception as err:
#             print("[gpt-mcq-quiz][ERROR] Failed to parse Gemini response:", err)
#             print("[gpt-mcq-quiz][ERROR] Content that failed to parse:", content)
#             quiz = []

#         if (not isinstance(quiz, list)) or len(quiz) == 0:
#             print("[gpt-mcq-quiz][ERROR] No valid questions generated")

#         return quiz

#     except Exception as error:
#         print("Error calling Gemini API:", error)
#         raise error


@router.post("/gpt-mcq-quiz")
async def POST(request: Request, auth_ctx: RequestAuth = Depends(get_request_auth_required)):
    body = await request.json()

    query_client = supabase
    if auth_ctx.claims:
        query_client = get_service_supabase_client()

    # Derive learning style from provided user_id when available
    reqUserId = body.get("userId") or body.get("user_id") or None
    userLearningStyle: Optional[str] = None

    if reqUserId:
        try:
            lsRes = (
                query_client
                .table("employee_learning_style")
                .select("learning_style")
                .eq("user_id", reqUserId)
                .maybe_single()
                .execute()
            )
            lsRow = getattr(lsRes, "data", None)
            lsErr = getattr(lsRes, "error", None)
            if lsErr:
                print("[gpt-mcq-quiz] learning style lookup warning:", lsErr)
            userLearningStyle = (lsRow.get("learning_style") if isinstance(lsRow, dict) else None) or None
        except Exception as e:
            print("[gpt-mcq-quiz] Error fetching learning style:", e)

    # Determine if baseline request

    print("baseline check - body:", body)
    isBaselineRequest = body.get("isBaseline") is True or body.get("assessmentType") == "baseline"

    # Per-module quiz branch: supports BOTH keys exactly like TS
    explicitModuleId = (
        body.get("moduleId")
        or body.get("processed_module_id")
        or body.get("module_id")
        or None
    )
    
    # Handle moduleIds array - extract first element if it's a list
    if not explicitModuleId and body.get("moduleIds"):
        moduleIds = body.get("moduleIds")
        if isinstance(moduleIds, list) and len(moduleIds) > 0:
            explicitModuleId = moduleIds[0]
    
    moduleId = str(explicitModuleId) if explicitModuleId else None

    if moduleId and (not isBaselineRequest):
        if (not moduleId) or moduleId == "undefined" or moduleId == "null":
            return JSONResponse(content={"error": "Invalid moduleId"}, status_code=400)

        learningStyle = body.get("learningStyle") or userLearningStyle or None
        if not learningStyle:
            return JSONResponse(
                content={"error": "Missing learningStyle; provide user_id or learningStyle in request."},
                status_code=400
            )

        processedModuleId: Optional[str] = None
        existingProcessed: Any = None

        # Try Redis cache for processed_module_id resolution and existing quiz
        pm_cache_key = f"module:pm_id:{moduleId}"
        cached_pm_id = get_cache(pm_cache_key)
        if cached_pm_id:
            processedModuleId = str(cached_pm_id)
            quiz_cache_key = f"quiz:module:{processedModuleId}:{learningStyle}"
            cached_quiz = get_cache(quiz_cache_key)
            if cached_quiz and isinstance(cached_quiz, dict) and cached_quiz.get("quiz"):
                return JSONResponse(content=cached_quiz)

        # lookup processed_modules by processed_module_id first
        if not processedModuleId:
            try:
                pmRes = (
                    query_client
                    .table("processed_modules")
                    .select("processed_module_id, title, content, original_module_id, learning_style")
                    .eq("processed_module_id", moduleId)
                    .execute()
                )
                pmById = getattr(pmRes, "data", None)
                pmIdErr = getattr(pmRes, "error", None)
                if pmIdErr:
                    print("[gpt-mcq-quiz] lookup processed_modules by processed_module_id warning:", pmIdErr)

                # ✅ TS logic intends a single object, but supabase-py returns list for .execute()
                if pmById and isinstance(pmById, list) and len(pmById) > 0 and pmById[0].get("processed_module_id"):
                    existingProcessed = pmById[0]
                    processedModuleId = pmById[0].get("processed_module_id")

            except Exception as e:
                print("[gpt-mcq-quiz] Error querying processed_modules by id:", e)

        # fallback lookup by original_module_id
        if not processedModuleId:
            try:
                pmOrigRes = (
                    query_client
                .table("processed_modules")
                    .select("processed_module_id, title, content, original_module_id, learning_style")
                    .eq("original_module_id", moduleId)
                    .execute()
                )
                pmByOriginal = getattr(pmOrigRes, "data", None)
                pmOrigErr = getattr(pmOrigRes, "error", None)
                if pmOrigErr:
                    print("[gpt-mcq-quiz] lookup processed_modules by original_module_id warning:", pmOrigErr)

                if isinstance(pmByOriginal, list) and len(pmByOriginal) > 0 and pmByOriginal[0].get("processed_module_id"):
                    existingProcessed = pmByOriginal[0]
                    processedModuleId = pmByOriginal[0].get("processed_module_id")

                # TS has an extra fallback: if pmByOriginal is empty, query by processed_module_id again
                if (not processedModuleId) and isinstance(pmByOriginal, list) and len(pmByOriginal) == 0:
                    pmRes2 = (
                        query_client
                        .table("processed_modules")
                        .select("processed_module_id, title, content, original_module_id, learning_style")
                        .eq("processed_module_id", moduleId)
                        .maybe_single()
                        .execute()
                    )
                    module_idd = getattr(pmRes2, "data", None)
                    if isinstance(module_idd, dict) and module_idd.get("processed_module_id"):
                        existingProcessed = module_idd
                        processedModuleId = module_idd.get("processed_module_id")

            except Exception as e:
                print("[gpt-mcq-quiz] Error querying processed_modules by original_module_id:", e)

        # If no processed module found, fallback to training_modules and create processed entry
        if not processedModuleId:
            try:
                tmRes = (
                    query_client
                    .table("training_modules")
                    .select("module_id, title, gpt_summary")
                    .eq("module_id", moduleId)
                    .maybe_single()
                    .execute()
                )
                trainingModule = getattr(tmRes, "data", None)
                tmError = getattr(tmRes, "error", None)

                if tmError or (not trainingModule):
                    print("[gpt-mcq-quiz] Training module not found:", tmError)
                    return JSONResponse(
                        content={"error": "Module not found in training_modules or processed_modules."},
                        status_code=404
                    )

                insertRes = (
                    query_client
                .table("processed_modules")
                    .insert({
                        "original_module_id": str(moduleId),
                        "title": trainingModule.get("title"),
                        "content": trainingModule.get("gpt_summary") or "",
                        "learning_style": learningStyle,
                    }, returning="representation")
                    .execute()
                )

                newProcessedData = getattr(insertRes, "data", None)
                insertErr = getattr(insertRes, "error", None)

                newProcessed = None
                if isinstance(newProcessedData, list) and len(newProcessedData) > 0:
                    newProcessed = newProcessedData[0]
                elif isinstance(newProcessedData, dict):
                    newProcessed = newProcessedData

                if insertErr:
                    insert_code = insertErr.get("code") if isinstance(insertErr, dict) else getattr(insertErr, "code", None)

                    if insert_code == "23505":
                        reRes = (
                            query_client
                .table("processed_modules")
                            .select("processed_module_id, title, content")
                            .eq("original_module_id", moduleId)
                            .eq("learning_style", learningStyle)
                            .maybe_single()
                            .execute()
                        )
                        requery = getattr(reRes, "data", None)
                        if isinstance(requery, dict) and requery.get("processed_module_id"):
                            processedModuleId = requery.get("processed_module_id")
                            existingProcessed = requery
                    else:
                        print("[gpt-mcq-quiz] Failed to create processed_module:", insertErr)
                        return JSONResponse(content={"error": "Failed to create processed module."}, status_code=500)

                elif newProcessed and isinstance(newProcessed, dict) and newProcessed.get("processed_module_id"):
                    processedModuleId = newProcessed["processed_module_id"]
                    existingProcessed = {
                        "title": trainingModule.get("title"),
                        "content": trainingModule.get("gpt_summary") or trainingModule.get("content")
                    }

            except Exception as e:
                print("[gpt-mcq-quiz] Error in fallback logic:", e)
                return JSONResponse(content={"error": "Failed to fetch or create module."}, status_code=500)

        if not processedModuleId:
            return JSONResponse(
                content={"error": "Processed module not found. Ensure a processed_modules entry exists for this module."},
                status_code=404
            )

        # Cache resolved processed_module_id
        set_cache(pm_cache_key, processedModuleId, ttl=86400)
        set_cache(f"module:pm_id:{processedModuleId}", processedModuleId, ttl=86400)

        moduleTitle = (existingProcessed.get("title") if isinstance(existingProcessed, dict) else "") or ""
        moduleContent = (existingProcessed.get("content") if isinstance(existingProcessed, dict) else "") or ""

        # Existing quiz check with Redis cache
        quiz_cache_key = f"quiz:module:{processedModuleId}:{learningStyle}"
        cached_quiz = get_cache(quiz_cache_key)
        if cached_quiz and isinstance(cached_quiz, dict) and cached_quiz.get("quiz"):
            return JSONResponse(content=cached_quiz)

        assessmentsRes = (
            query_client
                .table("assessments")
            .select("assessment_id, questions")
            .eq("type", "module")
            .eq("processed_module_id", processedModuleId)
            .eq("learning_style", learningStyle)
            .order("assessment_id", desc=True)
            .limit(1)
            .execute()
        )

        assessmentsList = getattr(assessmentsRes, "data", None)
        existing = assessmentsList[0] if isinstance(assessmentsList, list) and len(assessmentsList) > 0 else None

        if existing:
            try:
                quizExisting = existing.get("questions")
                quizExisting = quizExisting if isinstance(quizExisting, list) else json.loads(quizExisting)
                payload = {"quiz": quizExisting, "assessmentId": existing.get("assessment_id")}
                set_cache(quiz_cache_key, payload, ttl=86400)
                return JSONResponse(content=payload)
            except Exception:
                payload = {"quiz": existing.get("questions"), "assessmentId": existing.get("assessment_id")}
                set_cache(quiz_cache_key, payload, ttl=86400)
                return JSONResponse(content=payload)

        # ✅ TS PER-MODULE PROMPT (preserved EXACT structure/content)
        # prompt = f"""You are an expert instructional designer. Your task is to generate multiple-choice questions (MCQs) from the provided learning content using Bloom's Taxonomy.

# Input: A learning asset (text, notes, or structured content).

# Output: A set of 10-13 MCQs (Multiple Choice Questions) distributed across difficulty levels based on Bloom's Taxonomy.

# Easy → Remember & Understand (default: 20%)
# Average → Apply & Analyze (default: 50%)
# Difficult → Evaluate & Create (default: 30%)

# Bloom's Level Mapping:
# Remember: Define, List, Identify, Recall, Name, Label, Recognize, State, Match, Repeat, Select
# Understand: Explain, Summarize, Describe, Interpret, Restate, Paraphrase, Classify, Discuss, Illustrate, Compare (basic), Report
# Apply: Solve, Demonstrate, Use, Implement, Apply, Execute, Practice, Show, Operate, Employ, Perform
# Analyze: Differentiate, Compare, Contrast, Organize, Examine, Break down, Categorize, Investigate, Distinguish, Attribute, Diagram
# Evaluate: Judge, Critique, Justify, Recommend, Assess, Evaluate, Defend, Support, Argue, Prioritize, Appraise, Rate, Validate
# Create: Design, Generate, Propose, Develop, Formulate, Construct, Invent, Plan, Compose, Produce, Hypothesize, Integrate, Originate

# Exhaustive Question-Type Bank (Stems/Patterns):
# Remember: "What is…?", "Which of the following defines…?", "Identify…", "Who discovered…?", "When/Where did…?", "Match the term with…"
# Understand: "Which best explains…?", "Summarize…", "What does this mean…?", "Which example illustrates…?", "Why does…happen?"
# Apply: "Which principle would you use if…?", "What is the correct method to…?", "How would you solve…?", "Which tool/technique applies to…?", "Which step comes next…?"
# Analyze: "Which factor contributes most to…?", "What pattern best explains…?", "Which cause-effect relationship is correct…?", "What evidence supports…?", "Which statement best differentiates between…?"
# Evaluate: "Which option provides the best justification…?", "Which solution is most effective and why?", "Which argument is strongest?", "Which evidence best supports…?", "What decision is most appropriate…?"
# Create: "What new approach could be developed…?", "Which design achieves…?", "How would you improve…?", "Which combination of ideas solves…?", "What hypothesis could you form…?"

# Question Design Rules:
# - Each question must explicitly map to its Bloom's level.
# - Provide 4 answer choices (A–D).
# - Clearly mark the correct answer.
# - Avoid ambiguity; test one concept per question. Ensure every concept is tested.

# Return ONLY a valid JSON array of 10-13 question objects, with no extra text, markdown, code blocks, or formatting. Each object must include:
# {{
#   "question": string,
#   "bloomLevel": string,
#   "options": [string, string, string, string],
#   "correctIndex": number,
#   "explanation": string (optional)
# }}

# Learning Content:
# Summary: {moduleTitle}
# Modules: {json.dumps([moduleTitle])}
# Objectives: {json.dumps([moduleContent])}"""


        try:
            ai_response = await AI.execute(
                AIRequest(
                    feature="quiz_generation_module",
                    company_id=str(body.get("companyId") or ""),
                    user_id=str(reqUserId or ""),
                    route="/gpt-mcq-quiz",
                    variables={
                        "moduleTitle": moduleTitle,
                        "modules": json.dumps([moduleTitle]),
                        "objectives": json.dumps([moduleContent]),
                    },
                    response_format="json",
                )
            )

            quiz = parse_quiz_response(ai_response.content)
        #     model = genai.GenerativeModel("gemini-3.1-pro-preview")
        #     # model = genai.GenerativeModel("gemini-3.1-pro-preview")
        #     result = model.generate_content(prompt)
        #     content = result.text if result else ""

        #     quiz: List[Any] = []
        #     try:
        #         cleanedContent = content.strip()
        #         jsonStart = cleanedContent.find("[")
        #         jsonEnd = cleanedContent.rfind("]")

        #         if jsonStart != -1 and jsonEnd != -1 and jsonEnd > jsonStart:
        #             cleanedContent = cleanedContent[jsonStart:jsonEnd + 1]
        #         else:
        #             if cleanedContent.startswith("```json"):
        #                 cleanedContent = cleanedContent.replace("```json", "", 1).strip()
        #                 if cleanedContent.endswith("```"):
        #                     cleanedContent = cleanedContent[:-3].strip()
        #             elif cleanedContent.startswith("```"):
        #                 cleanedContent = cleanedContent.replace("```", "", 1).strip()
        #                 if cleanedContent.endswith("```"):
        #                     cleanedContent = cleanedContent[:-3].strip()

        #         quiz = json.loads(cleanedContent)
        #     except Exception:
        #         quiz = []

        #     # Save quiz for this learning style, deterministic UUID (SHA1)
        #     stableIdSeed = f"module:{processedModuleId}|style:{learningStyle}"
        #     hash_hex = hashlib.sha1(stableIdSeed.encode("utf-8")).hexdigest()
        #     stableId = f"{hash_hex[0:8]}-{hash_hex[8:12]}-{hash_hex[12:16]}-{hash_hex[16:20]}-{hash_hex[20:32]}"

        #     insertAssessmentRes = (
        #         query_client
        #         .table("assessments")
        #         .insert({
        #             "assessment_id": stableId,
        #             "type": "module",
        #             "processed_module_id": processedModuleId,
        #             "questions": json.dumps(quiz),
        #             "learning_style": learningStyle,
        #             "company_id": body.get("companyId") or None
        #         })
        #         .execute()
        #     )

        #     insertError = getattr(insertAssessmentRes, "error", None)

        #     if insertError:
        #         insert_code = insertError.get("code") if isinstance(insertError, dict) else getattr(insertError, "code", None)

        #         if insert_code in ["23505", "409"]:
        #             existingListAfterRes = (
        #                 query_client
        #                 .table("assessments")
        #                 .select("assessment_id, questions")
        #                 .eq("type", "module")
        #                 .eq("processed_module_id", processedModuleId)
        #                 .eq("learning_style", learningStyle)
        #                 .order("assessment_id", desc=True)
        #                 .limit(1)
        #                 .execute()
        #             )

        #             existingListAfter = getattr(existingListAfterRes, "data", None)
        #             existingAfter = existingListAfter[0] if isinstance(existingListAfter, list) and len(existingListAfter) > 0 else None

        #             if existingAfter:
        #                 try:
        #                     quizExisting = existingAfter.get("questions")
        #                     quizExisting = quizExisting if isinstance(quizExisting, list) else json.loads(quizExisting)
        #                     return JSONResponse(content={"quiz": quizExisting, "assessmentId": existingAfter.get("assessment_id")})
        #                 except Exception:
        #                     return JSONResponse(content={"quiz": existingAfter.get("questions"), "assessmentId": existingAfter.get("assessment_id")})

        #             return JSONResponse(content={"quiz": quiz, "assessmentId": stableId})

        #         return JSONResponse(content={"error": "Failed to save assessment"}, status_code=500)

        #     return JSONResponse(content={"quiz": quiz, "assessmentId": stableId})
            if (not isinstance(quiz, list)) or len(quiz) == 0:
                return JSONResponse(
                    content={
                        "error": "Quiz generation failed or returned empty array.",
                        "details": "The AI model did not generate any valid questions. Please try again.",
                        "rawResponse": quiz
                    },
                    status_code=500
                )

            # Save quiz for this learning style, deterministic UUID (SHA1)
            stableIdSeed = f"module:{processedModuleId}|style:{learningStyle}"
            hash_hex = hashlib.sha1(stableIdSeed.encode("utf-8")).hexdigest()
            stableId = (
                f"{hash_hex[0:8]}-{hash_hex[8:12]}-"
                f"{hash_hex[12:16]}-{hash_hex[16:20]}-{hash_hex[20:32]}"
            )

            is_conflict = False
            try:
                insertAssessmentRes = (
                    query_client
                    .table("assessments")
                    .insert({
                        "assessment_id": stableId,
                        "type": "module",
                        "processed_module_id": processedModuleId,
                        "questions": json.dumps(quiz),
                        "learning_style": learningStyle,
                        "company_id": body.get("companyId") or None
                    })
                    .execute()
                )
                insertError = getattr(insertAssessmentRes, "error", None)
                if insertError:
                    insert_code = (
                        insertError.get("code")
                        if isinstance(insertError, dict)
                        else getattr(insertError, "code", None)
                    )
                    if insert_code in ["23505", "409"]:
                        is_conflict = True
                    else:
                        return JSONResponse(
                            content={"error": "Failed to save assessment"},
                            status_code=500
                        )
            except Exception as insert_exc:
                exc_str = str(insert_exc)
                if "23505" in exc_str or "duplicate key" in exc_str or "already exists" in exc_str or "409" in exc_str:
                    is_conflict = True
                else:
                    raise insert_exc

            if is_conflict:
                existingListAfterRes = (
                    query_client
                    .table("assessments")
                    .select("assessment_id, questions")
                    .eq("type", "module")
                    .eq("processed_module_id", processedModuleId)
                    .eq("learning_style", learningStyle)
                    .order("assessment_id", desc=True)
                    .limit(1)
                    .execute()
                )

                existingListAfter = getattr(
                    existingListAfterRes, "data", None
                )

                existingAfter = (
                    existingListAfter[0]
                    if isinstance(existingListAfter, list)
                    and len(existingListAfter) > 0
                    else None
                )

                if existingAfter:
                    try:
                        quizExisting = existingAfter.get("questions")
                        quizExisting = (
                            quizExisting
                            if isinstance(quizExisting, list)
                            else json.loads(quizExisting)
                        )
                    except Exception:
                        quizExisting = existingAfter.get("questions")

                    conflict_payload = {
                        "quiz": quizExisting,
                        "assessmentId": existingAfter.get("assessment_id")
                    }
                    set_cache(quiz_cache_key, conflict_payload, ttl=86400)
                    return JSONResponse(content=conflict_payload)
                else:
                    conflict_payload = {
                        "quiz": quiz,
                        "assessmentId": stableId
                    }
                    set_cache(quiz_cache_key, conflict_payload, ttl=86400)
                    return JSONResponse(content=conflict_payload)

            new_quiz_payload = {
                "quiz": quiz,
                "assessmentId": stableId
            }
            set_cache(quiz_cache_key, new_quiz_payload, ttl=86400)
            return JSONResponse(content=new_quiz_payload)
        except Exception as error:
            print("[gpt-mcq-quiz]Error generating quiz:", error)
            return JSONResponse(content={"error": "Failed to generate quiz"}, status_code=500)

    # ----------------------------------------------------------------------
    # BASELINE (multi-module) quiz generation (merged TS logic)
    # ----------------------------------------------------------------------
    moduleIds = body.get("moduleIds")
    companyId = body.get("companyId")
    assessmentType = body.get("assessmentType")
    isBaseline = body.get("isBaseline")
    user_id = str(reqUserId or "")

    if (not moduleIds) or (not isinstance(moduleIds, list)) or len(moduleIds) == 0:
        return JSONResponse(content={"error": "moduleIds (array) required"}, status_code=400)

    if not companyId:
        return JSONResponse(content={"error": "companyId required"}, status_code=400)

    # Check baseline quiz in Redis cache first
    sorted_mod_str = ",".join(sorted(str(m) for m in moduleIds))
    baseline_cache_key = f"quiz:baseline:{companyId}:{sorted_mod_str}"
    cached_baseline = get_cache(baseline_cache_key)
    if cached_baseline and isinstance(cached_baseline, dict) and (cached_baseline.get("quiz") or cached_baseline.get("quizMapping")):
        return JSONResponse(content=cached_baseline)

    # 1) training_modules for company
    tmRes = (
        query_client
                .table("training_modules")
        .select("module_id, title, gpt_summary, ai_modules, ai_objectives, company_id")
        .in_("module_id", moduleIds)
        .eq("company_id", companyId)
        .execute()
    )
    data = getattr(tmRes, "data", None)
    error = getattr(tmRes, "error", None)

    if error or (not data) or (not isinstance(data, list)) or len(data) == 0:
        return JSONResponse(content={"error": "Modules not found"}, status_code=404)

    # tmMap: module_id -> row
    tmMap: Dict[str, Any] = {}
    for r in data:
        tmMap[str(r.get("module_id"))] = r

    # 2) Ensure processed_modules exist per original_module_id
    processedRes = (
        query_client
                .table("processed_modules")
        .select("processed_module_id, original_module_id")
        .in_("original_module_id", moduleIds)
        .execute()
    )
    processedRows = getattr(processedRes, "data", None)
    processedError = getattr(processedRes, "error", None)
    if processedError:
        print("[gpt-mcq-quiz] lookup processed_modules warning:", processedError)

    processedMap: Dict[str, str] = {}
    if isinstance(processedRows, list):
        for p in processedRows:
            if p and p.get("original_module_id") and p.get("processed_module_id"):
                processedMap[str(p["original_module_id"])] = str(p["processed_module_id"])

    missingModuleIds = [mId for mId in moduleIds if str(mId) not in processedMap]

    # insert missing processed_modules (try upsert, fallback insert+requery)
    if len(missingModuleIds) > 0:
        inserts = []
        for mId in missingModuleIds:
            tm = tmMap.get(str(mId), {}) or {}
            inserts.append({
                "original_module_id": str(mId),
                "title": tm.get("title") or None,
                "content": tm.get("gpt_summary") or None,
                "learning_style": userLearningStyle or None,
            })

        upsertRes = (
            query_client
                .table("processed_modules")
            .upsert(inserts, on_conflict="original_module_id")
            .execute()
        )
        insErr = getattr(upsertRes, "error", None)

        insData = None
        if not insErr:
            requeryRes = (
                query_client
                .table("processed_modules")
                .select("processed_module_id, original_module_id")
                .in_("original_module_id", missingModuleIds)
                .execute()
            )
            insData = getattr(requeryRes, "data", None)
        else:
            if isinstance(insErr, dict) and insErr.get("code") == "42P10":
                print("[gpt-mcq-quiz] upsert failed (no unique constraint). Falling back to insert + re-query.", insErr.get("message"))

                insertRes = (
                    query_client
                .table("processed_modules")
                    .insert(inserts)
                    .execute()
                )
                insertErr = getattr(insertRes, "error", None)
                if insertErr:
                    print("[gpt-mcq-quiz] insert fallback failed; re-querying processed_modules for missing module ids.", insertErr)

                requeryRes = (
                    query_client
                .table("processed_modules")
                    .select("processed_module_id, original_module_id")
                    .in_("original_module_id", missingModuleIds)
                    .execute()
                )
                requeryRows = getattr(requeryRes, "data", None)
                requeryErr = getattr(requeryRes, "error", None)

                if not requeryErr:
                    insData = requeryRows
                else:
                    print("[gpt-mcq-quiz] Re-query after failed insert also failed:", requeryErr)
                    return JSONResponse(content={"error": "Failed to ensure processed_modules entries"}, status_code=500)
            else:
                print("[gpt-mcq-quiz] Failed to upsert processed_modules:", insErr)
                return JSONResponse(content={"error": "Failed to ensure processed_modules entries"}, status_code=500)

        if isinstance(insData, list):
            for p in insData:
                if p and p.get("original_module_id") and p.get("processed_module_id"):
                    processedMap[str(p["original_module_id"])] = str(p["processed_module_id"])

    processedIds = [processedMap.get(str(mId)) for mId in moduleIds]
    processedIds = [x for x in processedIds if x]

    for orig_id, proc_id in processedMap.items():
        if orig_id and proc_id:
            set_cache(f"module:pm_id:{orig_id}", str(proc_id), ttl=86400)
            set_cache(f"module:pm_id:{proc_id}", str(proc_id), ttl=86400)

    # 3) Direct baseline assessment check in assessments table (fast, indexed)
    existingAssessmentsRes = (
        query_client
        .table("assessments")
        .select("assessment_id, questions, processed_module_id, company_id, modules_snapshot")
        .eq("type", "baseline")
        .eq("company_id", companyId)
        .in_("processed_module_id", processedIds)
        .order("created_at", desc=True)
        .execute()
    )
    existingAssessments = getattr(existingAssessmentsRes, "data", None) or []

    if len(existingAssessments) > 0:
        resultMap = []
        for a in existingAssessments:
            questions = a.get("questions")
            if isinstance(questions, str):
                try:
                    questions = json.loads(questions)
                except Exception:
                    pass

            procId = a.get("processed_module_id")
            moduleIdFound = None
            for k, v in processedMap.items():
                if str(v) == str(procId):
                    moduleIdFound = k
                    break

            resultMap.append({
                "module_id": moduleIdFound,
                "processed_module_id": procId,
                "assessment_id": a.get("assessment_id"),
                "questions": questions
            })

        response_payload = {
            "quizMapping": resultMap,
            "quiz": resultMap[0].get("questions"),
            "assessmentId": resultMap[0].get("assessment_id"),
            "source": "db"
        }
        set_cache(baseline_cache_key, response_payload, ttl=86400)
        return JSONResponse(content=response_payload)

    # 4) Prepare normalized snapshot
    currentModules = []
    for mod in data:
        ai_modules = mod.get("ai_modules") if isinstance(mod, dict) else None
        if ai_modules:
            try:
                currentModules.extend(json.loads(ai_modules) if isinstance(ai_modules, str) else ai_modules)
            except Exception:
                pass

    normalizedSnapshot = json.dumps(normalizeModules(currentModules))
    existingAssessment = None

    combinedSummary = "\n".join([mod.get("gpt_summary") for mod in data if isinstance(mod, dict) and mod.get("gpt_summary")])
    combinedObjectives = []
    for mod in data:
        ai_objectives = mod.get("ai_objectives") if isinstance(mod, dict) else None
        if ai_objectives:
            try:
                combinedObjectives.extend(json.loads(ai_objectives) if isinstance(ai_objectives, str) else ai_objectives)
            except Exception:
                pass

    # quiz = await generateMCQQuiz(combinedSummary, currentModules, combinedObjectives)
    
    ai_response = await AI.execute(
        AIRequest(
            feature="quiz_generation_baseline",
            company_id=str(companyId),
            user_id=str(reqUserId or ""),
            route="/gpt-mcq-quiz",
            variables={
                "summary": combinedSummary,
                "modules": json.dumps(currentModules),
                "objectives": json.dumps(combinedObjectives),
            },
            response_format="json",
        )
    )

    quiz = parse_quiz_response(ai_response.content)


    if (not isinstance(quiz, list)) or len(quiz) == 0:
        return JSONResponse(content={
            "error": "Quiz generation failed or returned empty array.",
            "details": "The AI model did not generate any valid questions. Please try again.",
            "rawResponse": quiz
        }, status_code=500)

    # update or insert
    if existingAssessment and isinstance(existingAssessment, dict) and existingAssessment.get("assessment_id"):
        updateRes = (
            query_client
                .table("assessments")
            .update({
                "questions": json.dumps(quiz),
                "modules_snapshot": normalizedSnapshot
            })
            .eq("assessment_id", existingAssessment.get("assessment_id"))
            .eq("company_id", companyId)
            .execute()
        )
        updateError = getattr(updateRes, "error", None)
        if updateError:
            print("[gpt-mcq-quiz] Failed to update baseline assessment:", updateError)
            return JSONResponse(content={"error": "Failed to save baseline assessment (update)."}, status_code=500)

        payload = {"quiz": quiz, "source": "generated", "assessmentId": existingAssessment.get("assessment_id")}
        set_cache(baseline_cache_key, payload, ttl=86400)
        return JSONResponse(content=payload)

    # Insert baseline rows: 1 per module
    rowsToInsert = []
    snapshotHash = hashlib.sha1(normalizedSnapshot.encode("utf-8")).hexdigest()
    for mId in moduleIds:
        processedId = processedMap.get(str(mId))
        if not processedId:
            continue

        stableSeed = f"baseline:{companyId}|pm:{processedId}|style:{userLearningStyle or ''}|snap:{snapshotHash}"
        hash_hex = hashlib.sha1(stableSeed.encode("utf-8")).hexdigest()
        stableId = f"{hash_hex[0:8]}-{hash_hex[8:12]}-{hash_hex[12:16]}-{hash_hex[16:20]}-{hash_hex[20:32]}"

        rowsToInsert.append({
            "assessment_id": stableId,
            "type": "baseline",
            "questions": json.dumps(quiz),
            "company_id": companyId,
            "modules_snapshot": normalizedSnapshot,
            "processed_module_id": processedId,
            "learning_style": userLearningStyle or None
        })

    if len(rowsToInsert) == 0:
        return JSONResponse(content={"error": "Failed to map moduleIds to processed_modules."}, status_code=500)

    # supabase-py/postgrest does not support chaining `.select()` after `.insert()` in this environment
    is_baseline_conflict = False
    insertData = None
    try:
        insertAssessmentRes = (
            query_client
            .table("assessments")
            .insert(rowsToInsert)
            .execute()
        )
        insertData = getattr(insertAssessmentRes, "data", None)
        insertError = getattr(insertAssessmentRes, "error", None)
        if insertError:
            insert_code = insertError.get("code") if isinstance(insertError, dict) else getattr(insertError, "code", None)
            if insert_code in ["23505", "409"]:
                is_baseline_conflict = True
            else:
                print("[gpt-mcq-quiz] Failed to insert baseline assessment(s):", insertError)
                return JSONResponse(content={"error": "Failed to save baseline assessment (insert)."}, status_code=500)
    except Exception as insert_exc:
        exc_str = str(insert_exc)
        if "23505" in exc_str or "duplicate key" in exc_str or "already exists" in exc_str or "409" in exc_str:
            is_baseline_conflict = True
        else:
            print("[gpt-mcq-quiz] Exception inserting baseline assessment(s):", insert_exc)
            return JSONResponse(content={"error": "Failed to save baseline assessment (insert)."}, status_code=500)

    if is_baseline_conflict:
        stableIds = [r.get("assessment_id") for r in rowsToInsert if isinstance(r, dict) and r.get("assessment_id")]
        reRes = (
            query_client
            .table("assessments")
            .select("assessment_id, processed_module_id, questions")
            .in_("assessment_id", stableIds)
            .execute()
        )
        reData = getattr(reRes, "data", None)
        reErr = getattr(reRes, "error", None)
        if not reErr and reData and len(reData) > 0:
            q = reData[0].get("questions")
            try:
                q_parsed = q if isinstance(q, list) else json.loads(q)
            except Exception:
                q_parsed = q or quiz
            response_payload = {
                "quiz": q_parsed,
                "source": "generated",
                "inserted": reData,
                "assessmentId": stableIds[0] if len(stableIds) > 0 else None
            }
            set_cache(baseline_cache_key, response_payload, ttl=86400)
            return JSONResponse(content=response_payload)
        else:
            response_payload = {
                "quiz": quiz,
                "source": "generated",
                "inserted": rowsToInsert,
                "assessmentId": stableIds[0] if len(stableIds) > 0 else None
            }
            set_cache(baseline_cache_key, response_payload, ttl=86400)
            return JSONResponse(content=response_payload)

    response_payload = {
        "quiz": quiz,
        "source": "generated",
        "inserted": insertData,
        "assessmentId": rowsToInsert[0].get("assessment_id") if len(rowsToInsert) > 0 else None
    }
    set_cache(baseline_cache_key, response_payload, ttl=86400)
    return JSONResponse(content=response_payload)
