import os
import re
import json
import hashlib
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
# from supabase import create_client, Client
from utils.supabase_client import supabase

import google.generativeai as genai


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
if not os.getenv("GEMINI_API_KEY"):
    print("[gpt-mcq-quiz] CRITICAL: GEMINI_API_KEY is not set in environment variables!")

genai.configure(api_key=os.getenv("GEMINI_API_KEY") or "")


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


# -----------------------------
# Helper to call Gemini for MCQ quiz generation
# -----------------------------
async def generateMCQQuiz(summary: str, modules: Any, objectives: Any) -> List[Any]:
    prompt = f"""You are an expert instructional designer. Your task is to generate multiple-choice questions (MCQs) from the provided learning content using Bloom's Taxonomy.

Input: A learning asset (text, notes, or structured content).

Output: A set of 30 MCQs (Multiple Choice Questions) distributed across difficulty levels based on Bloom's Taxonomy.

Easy → Remember & Understand (default: 20%)
Average → Apply & Analyze (default: 50%)
Difficult → Evaluate & Create (default: 30%)

Bloom's Level Mapping:
Remember: Define, List, Identify, Recall, Name, Label, Recognize, State, Match, Repeat, Select
Understand: Explain, Summarize, Describe, Interpret, Restate, Paraphrase, Classify, Discuss, Illustrate, Compare (basic), Report
Apply: Solve, Demonstrate, Use, Implement, Apply, Execute, Practice, Show, Operate, Employ, Perform
Analyze: Differentiate, Compare, Contrast, Organize, Examine, Break down, Categorize, Investigate, Distinguish, Attribute, Diagram
Evaluate: Judge, Critique, Justify, Recommend, Assess, Evaluate, Defend, Support, Argue, Prioritize, Appraise, Rate, Validate
Create: Design, Generate, Propose, Develop, Formulate, Construct, Invent, Plan, Compose, Produce, Hypothesize, Integrate, Originate

Exhaustive Question-Type Bank (Stems/Patterns):
Remember: "What is…?", "Which of the following defines…?", "Identify…", "Who discovered…?", "When/Where did…?", "Match the term with…"
Understand: "Which best explains…?", "Summarize…", "What does this mean…?", "Which example illustrates…?", "Why does…happen?"
Apply: "Which principle would you use if…?", "What is the correct method to…?", "How would you solve…?", "Which tool/technique applies to…?", "Which step comes next…?"
Analyze: "Which factor contributes most to…?", "What pattern best explains…?", "Which cause-effect relationship is correct…?", "What evidence supports…?", "Which statement best differentiates between…?"
Evaluate: "Which option provides the best justification…?", "Which solution is most effective and why?", "Which argument is strongest?", "Which evidence best supports…?", "What decision is most appropriate…?"
Create: "What new approach could be developed…?", "Which design achieves…?", "How would you improve…?", "Which combination of ideas solves…?", "What hypothesis could you form…?"

Question Design Rules:
- Each question must explicitly map to its Bloom's level.
- Provide 4 answer choices (A–D).
- Clearly mark the correct answer.
- Avoid ambiguity; test one concept per question. Ensure every concept is tested.

Return ONLY a valid JSON array of 30 question objects, with no extra text, markdown, code blocks, or formatting. Each object must include:
{{
  "question": string,
  "bloomLevel": string,
  "options": [string, string, string, string],
  "correctIndex": number,
  "explanation": string (optional)
}}

Learning Content:
Summary: {summary}
Modules: {json.dumps(modules)}
Objectives: {json.dumps(objectives)}
"""

    try:
        model = genai.GenerativeModel("gemini-3-pro-preview")
        result = model.generate_content(prompt)
        content = result.text if result else None

        if not content:
            print("[gpt-mcq-quiz][ERROR] Gemini returned empty response")
            return []

        quiz: Any = None
        try:
            cleanedContent = content.strip()

            jsonStart = cleanedContent.find("[")
            jsonEnd = cleanedContent.rfind("]")

            if jsonStart != -1 and jsonEnd != -1 and jsonEnd > jsonStart:
                cleanedContent = cleanedContent[jsonStart:jsonEnd + 1]
            else:
                if cleanedContent.startswith("```json"):
                    cleanedContent = cleanedContent.replace("```json", "", 1).strip()
                    if cleanedContent.endswith("```"):
                        cleanedContent = cleanedContent[:-3].strip()
                elif cleanedContent.startswith("```"):
                    cleanedContent = cleanedContent.replace("```", "", 1).strip()
                    if cleanedContent.endswith("```"):
                        cleanedContent = cleanedContent[:-3].strip()

            quiz = json.loads(cleanedContent)

            if (not isinstance(quiz, list)) or len(quiz) == 0:
                print("[gpt-mcq-quiz][WARN] Parsed quiz is empty or not an array:", quiz)
                quiz = []

        except Exception as err:
            print("[gpt-mcq-quiz][ERROR] Failed to parse Gemini response:", err)
            print("[gpt-mcq-quiz][ERROR] Content that failed to parse:", content)
            quiz = []

        if (not isinstance(quiz, list)) or len(quiz) == 0:
            print("[gpt-mcq-quiz][ERROR] No valid questions generated")

        return quiz

    except Exception as error:
        print("Error calling Gemini API:", error)
        raise error


@router.post("/gpt-mcq-quiz")
async def POST(request: Request):
    body = await request.json()

    # Derive learning style from provided user_id when available
    reqUserId = body.get("userId") or body.get("user_id") or None
    userLearningStyle: Optional[str] = None

    if reqUserId:
        try:
            lsRes = (
                supabase
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

        # lookup processed_modules by processed_module_id first
        try:
            pmRes = (
                supabase
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
                    supabase
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
                        supabase
                        .table("processed_modules")
                        .select("processed_module_id, title, content, original_module_id, learning_style")
                        .eq("processed_module_id", moduleId)
                        .execute()
                    )
                    module_idd = getattr(pmRes2, "data", None)
                    if isinstance(module_idd, list) and len(module_idd) > 0 and module_idd[0].get("processed_module_id"):
                        existingProcessed = module_idd[0]
                        processedModuleId = module_idd[0].get("processed_module_id")

            except Exception as e:
                print("[gpt-mcq-quiz] Error querying processed_modules by original_module_id:", e)

        # If no processed module found, fallback to training_modules and create processed entry
        if not processedModuleId:
            try:
                tmRes = (
                    supabase
                    .table("training_modules")
                    .select("module_id, title, gpt_summary")
                    .eq("module_id", moduleId)
                    .single()
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
                    supabase
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
                            supabase
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

        moduleTitle = (existingProcessed.get("title") if isinstance(existingProcessed, dict) else "") or ""
        moduleContent = (existingProcessed.get("content") if isinstance(existingProcessed, dict) else "") or ""

        # Existing quiz check
        assessmentsRes = (
            supabase
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
                return JSONResponse(content={"quiz": quizExisting, "assessmentId": existing.get("assessment_id")})
            except Exception:
                return JSONResponse(content={"quiz": existing.get("questions"), "assessmentId": existing.get("assessment_id")})

        # ✅ TS PER-MODULE PROMPT (preserved EXACT structure/content)
        prompt = f"""You are an expert instructional designer. Your task is to generate multiple-choice questions (MCQs) from the provided learning content using Bloom's Taxonomy.

Input: A learning asset (text, notes, or structured content).

Output: A set of 10-13 MCQs (Multiple Choice Questions) distributed across difficulty levels based on Bloom's Taxonomy.

Easy → Remember & Understand (default: 20%)
Average → Apply & Analyze (default: 50%)
Difficult → Evaluate & Create (default: 30%)

Bloom's Level Mapping:
Remember: Define, List, Identify, Recall, Name, Label, Recognize, State, Match, Repeat, Select
Understand: Explain, Summarize, Describe, Interpret, Restate, Paraphrase, Classify, Discuss, Illustrate, Compare (basic), Report
Apply: Solve, Demonstrate, Use, Implement, Apply, Execute, Practice, Show, Operate, Employ, Perform
Analyze: Differentiate, Compare, Contrast, Organize, Examine, Break down, Categorize, Investigate, Distinguish, Attribute, Diagram
Evaluate: Judge, Critique, Justify, Recommend, Assess, Evaluate, Defend, Support, Argue, Prioritize, Appraise, Rate, Validate
Create: Design, Generate, Propose, Develop, Formulate, Construct, Invent, Plan, Compose, Produce, Hypothesize, Integrate, Originate

Exhaustive Question-Type Bank (Stems/Patterns):
Remember: "What is…?", "Which of the following defines…?", "Identify…", "Who discovered…?", "When/Where did…?", "Match the term with…"
Understand: "Which best explains…?", "Summarize…", "What does this mean…?", "Which example illustrates…?", "Why does…happen?"
Apply: "Which principle would you use if…?", "What is the correct method to…?", "How would you solve…?", "Which tool/technique applies to…?", "Which step comes next…?"
Analyze: "Which factor contributes most to…?", "What pattern best explains…?", "Which cause-effect relationship is correct…?", "What evidence supports…?", "Which statement best differentiates between…?"
Evaluate: "Which option provides the best justification…?", "Which solution is most effective and why?", "Which argument is strongest?", "Which evidence best supports…?", "What decision is most appropriate…?"
Create: "What new approach could be developed…?", "Which design achieves…?", "How would you improve…?", "Which combination of ideas solves…?", "What hypothesis could you form…?"

Question Design Rules:
- Each question must explicitly map to its Bloom's level.
- Provide 4 answer choices (A–D).
- Clearly mark the correct answer.
- Avoid ambiguity; test one concept per question. Ensure every concept is tested.

Return ONLY a valid JSON array of 10-13 question objects, with no extra text, markdown, code blocks, or formatting. Each object must include:
{{
  "question": string,
  "bloomLevel": string,
  "options": [string, string, string, string],
  "correctIndex": number,
  "explanation": string (optional)
}}

Learning Content:
Summary: {moduleTitle}
Modules: {json.dumps([moduleTitle])}
Objectives: {json.dumps([moduleContent])}"""

        try:
            model = genai.GenerativeModel("gemini-3-pro-preview")
            result = model.generate_content(prompt)
            content = result.text if result else ""

            quiz: List[Any] = []
            try:
                cleanedContent = content.strip()
                jsonStart = cleanedContent.find("[")
                jsonEnd = cleanedContent.rfind("]")

                if jsonStart != -1 and jsonEnd != -1 and jsonEnd > jsonStart:
                    cleanedContent = cleanedContent[jsonStart:jsonEnd + 1]
                else:
                    if cleanedContent.startswith("```json"):
                        cleanedContent = cleanedContent.replace("```json", "", 1).strip()
                        if cleanedContent.endswith("```"):
                            cleanedContent = cleanedContent[:-3].strip()
                    elif cleanedContent.startswith("```"):
                        cleanedContent = cleanedContent.replace("```", "", 1).strip()
                        if cleanedContent.endswith("```"):
                            cleanedContent = cleanedContent[:-3].strip()

                quiz = json.loads(cleanedContent)
            except Exception:
                quiz = []

            # Save quiz for this learning style, deterministic UUID (SHA1)
            stableIdSeed = f"module:{processedModuleId}|style:{learningStyle}"
            hash_hex = hashlib.sha1(stableIdSeed.encode("utf-8")).hexdigest()
            stableId = f"{hash_hex[0:8]}-{hash_hex[8:12]}-{hash_hex[12:16]}-{hash_hex[16:20]}-{hash_hex[20:32]}"

            insertAssessmentRes = (
                supabase
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
                insert_code = insertError.get("code") if isinstance(insertError, dict) else getattr(insertError, "code", None)

                if insert_code in ["23505", "409"]:
                    existingListAfterRes = (
                        supabase
                        .table("assessments")
                        .select("assessment_id, questions")
                        .eq("type", "module")
                        .eq("processed_module_id", processedModuleId)
                        .eq("learning_style", learningStyle)
                        .order("assessment_id", desc=True)
                        .limit(1)
                        .execute()
                    )

                    existingListAfter = getattr(existingListAfterRes, "data", None)
                    existingAfter = existingListAfter[0] if isinstance(existingListAfter, list) and len(existingListAfter) > 0 else None

                    if existingAfter:
                        try:
                            quizExisting = existingAfter.get("questions")
                            quizExisting = quizExisting if isinstance(quizExisting, list) else json.loads(quizExisting)
                            return JSONResponse(content={"quiz": quizExisting})
                        except Exception:
                            return JSONResponse(content={"quiz": existingAfter.get("questions")})

                    return JSONResponse(content={"quiz": quiz})

                return JSONResponse(content={"error": "Failed to save assessment"}, status_code=500)

            return JSONResponse(content={"quiz": quiz})

        except Exception as error:
            print("Error generating quiz with Gemini:", error)
            return JSONResponse(content={"error": "Failed to generate quiz"}, status_code=500)

    # ----------------------------------------------------------------------
    # BASELINE (multi-module) quiz generation (merged TS logic)
    # ----------------------------------------------------------------------
    moduleIds = body.get("moduleIds")
    companyId = body.get("companyId")
    assessmentType = body.get("assessmentType")
    isBaseline = body.get("isBaseline")
    user_id = body.get("user_id")

    if (not moduleIds) or (not isinstance(moduleIds, list)) or len(moduleIds) == 0:
        return JSONResponse(content={"error": "moduleIds (array) required"}, status_code=400)

    if not companyId:
        return JSONResponse(content={"error": "companyId required"}, status_code=400)

    # 1) training_modules for company
    tmRes = (
        supabase
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
        supabase
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
            supabase
            .table("processed_modules")
            .upsert(inserts, on_conflict="original_module_id")
            .execute()
        )
        insErr = getattr(upsertRes, "error", None)

        insData = None
        if not insErr:
            requeryRes = (
                supabase
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
                    supabase
                    .table("processed_modules")
                    .insert(inserts)
                    .execute()
                )
                insertErr = getattr(insertRes, "error", None)
                if insertErr:
                    print("[gpt-mcq-quiz] insert fallback failed; re-querying processed_modules for missing module ids.", insertErr)

                requeryRes = (
                    supabase
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

    # 3) Baseline template check using employee_assessments join assessments
    existingEmployeeAssessmentsRes = (
        supabase
        .table("employee_assessments")
        .select("assessment_id, assessments(assessment_id, processed_module_id, company_id, type)")
        .execute()
    )
    existingEmployeeAssessments = getattr(existingEmployeeAssessmentsRes, "data", None)
    existingBaselinesError = getattr(existingEmployeeAssessmentsRes, "error", None)

    if existingBaselinesError:
        print("[gpt-mcq-quiz] lookup employee_assessments warning:", existingBaselinesError)

    matched = []
    if isinstance(existingEmployeeAssessments, list):
        for r in existingEmployeeAssessments:
            rel = r.get("assessments") if isinstance(r, dict) else None
            if isinstance(rel, list) and len(rel) > 0:
                rel = rel[0]
            if isinstance(rel, dict):
                if rel.get("type") == "baseline" and str(rel.get("processed_module_id")) in set(map(str, processedIds)):
                    matched.append(r)

    if len(matched) > 0:
        templateMap: Dict[str, Optional[str]] = {}
        for r in matched:
            rel = r.get("assessments") if isinstance(r, dict) else None
            if isinstance(rel, list) and len(rel) > 0:
                rel = rel[0]
            aid = rel.get("assessment_id") if isinstance(rel, dict) else None
            pmid = rel.get("processed_module_id") if isinstance(rel, dict) else None
            if aid:
                templateMap[str(aid)] = str(pmid) if pmid else None

        templateIds = list(templateMap.keys())

        assessmentsRowsRes = (
            supabase
            .table("assessments")
            .select("assessment_id, questions, processed_module_id")
            .in_("assessment_id", templateIds)
            .execute()
        )
        assessmentsRows = getattr(assessmentsRowsRes, "data", None)
        assessmentsErr = getattr(assessmentsRowsRes, "error", None)
        if assessmentsErr:
            print("[gpt-mcq-quiz] fetch assessments for existing templates warning:", assessmentsErr)

        resultMap = []
        for a in (assessmentsRows or []):
            questions = a.get("questions") if isinstance(a, dict) else None
            try:
                if isinstance(questions, str):
                    questions = json.loads(questions)
            except Exception:
                pass

            procId = (a.get("processed_module_id") if isinstance(a, dict) else None) or templateMap.get(str(a.get("assessment_id")))
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

        # assign to requesting user
        if reqUserId:
            rowsToUpsert = []
            for a in (assessmentsRows or []):
                if not isinstance(a, dict):
                    continue
                rowsToUpsert.append({
                    "user_id": reqUserId,
                    "assessment_id": a.get("assessment_id"),
                    "score": None,
                    "max_score": None,
                    "answers": None,
                    "feedback": None,
                    "question_feedback": None
                })

            if len(rowsToUpsert) > 0:
                upsertEARes = (
                    supabase
                    .table("employee_assessments")
                    .upsert(rowsToUpsert, on_conflict="user_id,assessment_id")
                    .execute()
                )
                upsertErr = getattr(upsertEARes, "error", None)
                if upsertErr:
                    print("[gpt-mcq-quiz] upsert employee_assessments warning:", upsertErr)

            if len(resultMap) == 1:
                return JSONResponse(content={
                    "quizMapping": resultMap,
                    "quiz": resultMap[0].get("questions"),
                    "source": "db",
                    "assignedTo": reqUserId
                })
            return JSONResponse(content={"quizMapping": resultMap, "source": "db", "assignedTo": reqUserId})

        # bulk assign
        try:
            plansRes = (
                supabase
                .table("learning_plan")
                .select("user_id")
                .eq("company_id", companyId)
                .execute()
            )
            plans = getattr(plansRes, "data", None) or []
            users = [p.get("user_id") for p in plans if isinstance(p, dict) and p.get("user_id")]

            bulkRows = []
            for u in users:
                for a in (assessmentsRows or []):
                    if not isinstance(a, dict):
                        continue
                    bulkRows.append({
                        "user_id": u,
                        "assessment_id": a.get("assessment_id"),
                        "score": None,
                        "max_score": None,
                        "answers": None,
                        "feedback": None,
                        "question_feedback": None
                    })

            if len(bulkRows) > 0:
                bulkRes = (
                    supabase
                    .table("employee_assessments")
                    .upsert(bulkRows, on_conflict="user_id,assessment_id")
                    .execute()
                )
                bulkErr = getattr(bulkRes, "error", None)
                if bulkErr:
                    print("[gpt-mcq-quiz] bulk upsert employee_assessments warning:", bulkErr)

        except Exception as e:
            print("[gpt-mcq-quiz] bulk-assign warning:", e)

        if len(resultMap) == 1:
            return JSONResponse(content={
                "quizMapping": resultMap,
                "quiz": resultMap[0].get("questions"),
                "source": "db",
                "assignedTo": "bulk"
            })
        return JSONResponse(content={"quizMapping": resultMap, "source": "db", "assignedTo": "bulk"})

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

    # 5) Check existing assessment with snapshot for ANY of processedIds
    existingAssessmentRes = (
        supabase
        .table("assessments")
        .select("assessment_id, questions, company_id, modules_snapshot, processed_module_id")
        .eq("type", "baseline")
        .eq("company_id", companyId)
        .in_("processed_module_id", processedIds)
        .order("created_at", desc=True)
        .limit(1)
        .maybe_single()
        .execute()
    )

    existingAssessment = getattr(existingAssessmentRes, "data", None)
    assessmentError = getattr(existingAssessmentRes, "error", None)

    if assessmentError and (not (isinstance(assessmentError, dict) and assessmentError.get("code") == "PGRST116")):
        print("[gpt-mcq-quiz] existing baseline lookup warning:", assessmentError)

    if existingAssessment and isinstance(existingAssessment, dict) and existingAssessment.get("modules_snapshot"):
        if existingAssessment.get("modules_snapshot") == normalizedSnapshot:
            try:
                quizData = existingAssessment.get("questions")
                if isinstance(quizData, str):
                    quizData = json.loads(quizData)
                return JSONResponse(content={"quiz": quizData, "source": "db", "assessmentId": existingAssessment.get("assessment_id")})
            except Exception:
                pass

    combinedSummary = "\n".join([mod.get("gpt_summary") for mod in data if isinstance(mod, dict) and mod.get("gpt_summary")])
    combinedObjectives = []
    for mod in data:
        ai_objectives = mod.get("ai_objectives") if isinstance(mod, dict) else None
        if ai_objectives:
            try:
                combinedObjectives.extend(json.loads(ai_objectives) if isinstance(ai_objectives, str) else ai_objectives)
            except Exception:
                pass

    quiz = await generateMCQQuiz(combinedSummary, currentModules, combinedObjectives)

    if (not isinstance(quiz, list)) or len(quiz) == 0:
        return JSONResponse(content={
            "error": "Quiz generation failed or returned empty array.",
            "details": "The AI model did not generate any valid questions. Please try again.",
            "rawResponse": quiz
        }, status_code=500)

    # update or insert
    if existingAssessment and isinstance(existingAssessment, dict) and existingAssessment.get("assessment_id"):
        updateRes = (
            supabase
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

        return JSONResponse(content={"quiz": quiz, "source": "generated", "assessmentId": existingAssessment.get("assessment_id")})

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
    insertAssessmentRes = (
        supabase
        .table("assessments")
        .insert(rowsToInsert)
        .execute()
    )

    insertData = getattr(insertAssessmentRes, "data", None)
    insertError = getattr(insertAssessmentRes, "error", None)

    if insertError:
        insert_code = insertError.get("code") if isinstance(insertError, dict) else getattr(insertError, "code", None)

        # If the deterministic IDs already exist, fetch and return them
        if insert_code in ["23505", "409"]:
            stableIds = [r.get("assessment_id") for r in rowsToInsert if isinstance(r, dict) and r.get("assessment_id")]
            reRes = (
                supabase
                .table("assessments")
                .select("assessment_id, processed_module_id")
                .in_("assessment_id", stableIds)
                .execute()
            )
            reData = getattr(reRes, "data", None)
            reErr = getattr(reRes, "error", None)
            if not reErr:
                return JSONResponse(content={"quiz": quiz, "source": "generated", "inserted": reData})

        print("[gpt-mcq-quiz] Failed to insert baseline assessment(s):", insertError)
        return JSONResponse(content={"error": "Failed to save baseline assessment (insert)."}, status_code=500)

    return JSONResponse(content={"quiz": quiz, "source": "generated", "inserted": insertData})
