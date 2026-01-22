import os
import json
import hashlib
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from supabase import create_client, Client
import google.generativeai as genai


router = APIRouter()

# Supabase init (equivalent of import { supabase } from "@/lib/supabase")
supabaseUrl = os.getenv("NEXT_PUBLIC_SUPABASE_URL") or os.getenv("SUPABASE_URL") or ""
supabaseKey = (
    os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    or os.getenv("SUPABASE_ANON_KEY")
    or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    or ""
)
supabase: Client = create_client(supabaseUrl, supabaseKey)

# Gemini init
genAI = genai
genai.configure(api_key=os.getenv("GEMINI_API_KEY") or "")


def parseGeminiJSON(raw_text: str) -> dict:
    """Extract and parse JSON from Gemini response, handling markdown code blocks and duplicates"""
    try:
        # Remove markdown code blocks if present
        cleaned = raw_text.strip()
        
        # Handle ```json...``` blocks
        if cleaned.startswith('```'):
            # Find first opening backticks
            start = cleaned.find('```')
            if start != -1:
                # Skip past language identifier (e.g., 'json')
                content_start = cleaned.find('\n', start + 3)
                if content_start != -1:
                    # Find closing backticks
                    end = cleaned.find('```', content_start)
                    if end != -1:
                        cleaned = cleaned[content_start:end].strip()
        
        # If there are multiple JSON objects (duplicates), take only the first complete one
        first_open = cleaned.find('{')
        if first_open != -1:
            brace_count = 0
            for i in range(first_open, len(cleaned)):
                if cleaned[i] == '{':
                    brace_count += 1
                elif cleaned[i] == '}':
                    brace_count -= 1
                    if brace_count == 0:
                        # Found complete first JSON object
                        cleaned = cleaned[first_open:i+1]
                        break
        
        return json.loads(cleaned)
    
    except json.JSONDecodeError as e:
        print(f"[parseGeminiJSON] JSON parsing failed: {e}")
        print(f"[parseGeminiJSON] Attempted to parse: {cleaned[:500] if cleaned else 'empty'}...")
        raise ValueError(f"Invalid JSON in Gemini response: {str(e)}")


@router.post("/training-plan")
async def POST(request: Request):
    try:
        body = await request.json()
        user_id = body.get("user_id")
        module_id = body.get("module_id")
        processedModuleIds = body.get("processedModuleIds")

        if not user_id:
            return JSONResponse(content={"error": "user_id is required"}, status_code=400)

        # Resolve company_id upfront
        company_id = None
        empRes = (
            supabase
            .table("users")
            .select("company_id")
            .eq("user_id", user_id)
            .maybe_single()
            .execute()
        )
        empRecord = getattr(empRes, "data", None)
        empError = getattr(empRes, "error", None)



        if empError or (not empRecord) or (not empRecord.get("company_id")):
            print("[Training Plan API] Could not find company for employee")
            return JSONResponse(content={"error": "Could not find company for employee"}, status_code=400)

        company_id = empRecord.get("company_id")

        checkForBaselineRes = (
            supabase
            .table("learning_plan")
            .select("baseline_assessment")
            .eq("user_id", user_id)
            .eq("module_id", module_id)
            .execute()
        )
        checkForBaseline = getattr(checkForBaselineRes, "data", None)
        userError = getattr(checkForBaselineRes, "error", None)


        print("Failing in this")

        # NOTE: table name has trailing space in TS: 'employee_assessments '
        assessmentDataRes = (
            supabase
            .table("employee_assessments")
            .select("assessment_id,assessments!inner(type)")
            .eq("user_id", user_id)
            .eq("assessments.type", "baseline")
            .execute()
        )
        assessmentData = getattr(assessmentDataRes, "data", None)
        baselineError = getattr(assessmentDataRes, "error", None)


        print("Failing in this 3")

        if (
            checkForBaseline
            and isinstance(checkForBaseline, list)
            and len(checkForBaseline) > 0
            and checkForBaseline[0].get("baseline_assessment") == 1
            and (not assessmentData or len(assessmentData) == 0)
        ):
            return JSONResponse(
                content={"error": "BASELINE_REQUIRED", "message": "Please complete the baseline assessment first."},
                status_code=403,
            )

        if userError:
            print("Error checking for baseline assessment:", userError)


        print("Failing in this 2")

        # Check if we already have a learning plan for this user and module
        if module_id:
            existingPlanRes = (
                supabase
                .table("learning_plan")
                .select("learning_plan_id, plan_json, status, reasoning")
                .eq("user_id", user_id)
                .eq("module_id", module_id)
                .order("assigned_on", desc=True)
                .limit(1)
                .maybe_single()
                .execute()
            )
            existingPlan = getattr(existingPlanRes, "data", None)
            planCheckError = getattr(existingPlanRes, "error", None)

            if planCheckError and isinstance(planCheckError, dict) and planCheckError.get("code") != "PGRST116":
                print("Error checking existing plan:", planCheckError)

            if existingPlan and existingPlan.get("plan_json"):
                planContent = None
                try:
                    plan_json_val = existingPlan.get("plan_json")
                    planContent = json.loads(plan_json_val) if isinstance(plan_json_val, str) else plan_json_val
                except Exception as e:
                    print("Existing plan has corrupted JSON, will regenerate:", e)
                    planContent = None

                if planContent:
                    # ensureProcessedModulesForPlan intentionally commented (same as TS)
                    return JSONResponse(
                        content={
                            "plan": planContent,
                            "reasoning": existingPlan.get("reasoning"),
                            "planId": existingPlan.get("learning_plan_id"),
                            "status": existingPlan.get("status"),
                            "message": "Using existing stable learning plan - no regeneration needed",
                        }
                    )

        module_id_query = None
        try:
            module_id_query = request.query_params.get("module_id")
        except Exception:
            module_id_query = None

        if not os.getenv("GEMINI_API_KEY"):
            print("[Training Plan API] GEMINI_API_KEY is not set")
            return JSONResponse(
                content={"error": "Server misconfiguration: GEMINI_API_KEY is missing."},
                status_code=500,
            )




        # Baseline enforcement logic (same as TS)
        baselineRequired = False
        try:
            baselineDefsRes = (
                supabase
                .table("assessments")
                .select("assessment_id, type, employee_assessments!inner(user_id)")
                .eq("type", "baseline")
                .eq("company_id", company_id)
                .eq("employee_assessments.user_id", user_id)
                .execute()
            )
            baselineDefs = getattr(baselineDefsRes, "data", None)
            baselineDefError = getattr(baselineDefsRes, "error", None)

            if baselineDefError:
                print("[Training Plan API] Error fetching baseline assessment definitions:", baselineDefError)
            elif baselineDefs and isinstance(baselineDefs, list) and len(baselineDefs) > 0:
                baselineRequired = True
                baselineIds = [
                    b.get("assessment_id")
                    for b in baselineDefs
                    if isinstance(b, dict) and b.get("assessment_id")
                ]
                if len(baselineIds) > 0:
                    userBaselinesRes = (
                        supabase
                        .table("employee_assessments")
                        .select("assessment_id")
                        .in_("assessment_id", baselineIds)
                        .eq("user_id", user_id)
                        .execute()
                    )
                    userBaselines = getattr(userBaselinesRes, "data", None)
                    userBaselineError = getattr(userBaselinesRes, "error", None)

                    if userBaselineError:
                        print("[Training Plan API] Error checking employee baseline submissions:", userBaselineError)
                    elif (not userBaselines) or len(userBaselines) == 0:
                        return JSONResponse(
                            content={"error": "BASELINE_REQUIRED", "message": "Please complete the baseline assessment first."},
                            status_code=403,
                        )
            else:
                baselineRequired = False
        except Exception as e:
            print("[Training Plan API] Unexpected error while enforcing baseline requirement:", e)

        # Fetch all assessments for this employee, including baseline
        assessmentsRes = (
            supabase
            .table("employee_assessments")
            .select("score, max_score, feedback, assessment_id, assessments(type, questions)")
            .eq("user_id", user_id)
            .execute()
        )
        assessments = getattr(assessmentsRes, "data", None)
        assessError = getattr(assessmentsRes, "error", None)

        if assessError:
            print("[Training Plan API] Error fetching assessments:", assessError)
            msg = assessError.get("message") if isinstance(assessError, dict) else str(assessError)
            return JSONResponse(content={"error": msg}, status_code=500)

        # Separate all baseline and all module assessments
        baselineAssessments = []
        moduleAssessments = []

        for a in (assessments or []):
            arr = a.get("assessments")
            if isinstance(arr, list):
                rel = arr
            elif arr:
                rel = [arr]
            else:
                rel = []

            if any((ass or {}).get("type") == "baseline" for ass in rel if isinstance(ass, dict)):
                baselineAssessments.append(a)
            else:
                moduleAssessments.append(a)

        # Compute percentage-based baseline results
        baselinePercentAssessments = []
        for row in (baselineAssessments or []):
            score = float(row.get("score") or 0)
            max_score = float(row.get("max_score") or 0)
            percent = round((score / max_score) * 100) if max_score > 0 else None
            baselinePercentAssessments.append(
                {
                    "assessment_id": row.get("assessment_id") if isinstance(row, dict) else None,
                    "score": score,
                    "max_score": max_score,
                    "score_percent": percent,
                    "feedback": row.get("feedback") if isinstance(row, dict) else None,
                }
            )

        print("[Training Plan API] Baseline percent assessments:", baselinePercentAssessments)

        # Compute assessmentHash using SHA256
        assessmentHash = hashlib.sha256(
            json.dumps(
                {
                    "baselinePercentAssessments": baselinePercentAssessments,
                    "module_id": module_id if module_id is not None else None,
                }
            ).encode("utf-8")
        ).hexdigest()

        # Check latest assigned learning plan (stable)
        existingPlan = None
        existingPlanError = None
        try:
            if module_id:
                epRes = (
                    supabase
                    .table("learning_plan")
                    .select("learning_plan_id, plan_json, reasoning, status, assessment_hash, module_id")
                    .eq("user_id", user_id)
                    .eq("module_id", module_id)
                    .eq("status", "ASSIGNED")
                    .order("learning_plan_id", desc=True)
                    .limit(1)
                    .maybe_single()
                    .execute()
                )
            else:
                epRes = (
                    supabase
                    .table("learning_plan")
                    .select("learning_plan_id, plan_json, reasoning, status, assessment_hash, module_id")
                    .eq("user_id", user_id)
                    .eq("status", "ASSIGNED")
                    .order("learning_plan_id", desc=True)
                    .limit(1)
                    .maybe_single()
                    .execute()
                )

            existingPlan = getattr(epRes, "data", None)
            existingPlanError = getattr(epRes, "error", None)
        except Exception as e:
            existingPlanError = e

        if existingPlanError and (not (isinstance(existingPlanError, dict) and existingPlanError.get("code") == "PGRST116")):
            msg = existingPlanError.get("message") if isinstance(existingPlanError, dict) else str(existingPlanError)
            print("[Training Plan API] Error checking existing plan:", existingPlanError)
            return JSONResponse(content={"error": msg}, status_code=500)

        # If any plan exists for this user/module combination, return it (stable behavior)
        if existingPlan and existingPlan.get("plan_json"):
            return JSONResponse(
                content={
                    "plan": existingPlan.get("plan_json"),
                    "reasoning": existingPlan.get("reasoning"),
                    "message": "Using existing stable learning plan",
                }
            )

        # Fetch all processed modules for this company
        modules: List[Any] = []

        if module_id:
            try:
                moduleCheckRes = (
                    supabase
                    .table("training_modules")
                    .select("module_id, title")
                    .eq("module_id", module_id)
                    .eq("company_id", company_id)
                    .single()
                    .execute()
                )
                moduleCheck = getattr(moduleCheckRes, "data", None)
                moduleCheckError = getattr(moduleCheckRes, "error", None)

                if moduleCheckError or (not moduleCheck):
                    print("[Training Plan API] Module not found or doesn't belong to company:", moduleCheckError)
                    return JSONResponse(
                        content={
                            "error": "MODULE_NOT_FOUND",
                            "message": "The specified module was not found or doesn't belong to your company.",
                        },
                        status_code=404,
                    )

                pmRes = (
                    supabase
                    .table("processed_modules")
                    .select("processed_module_id, title, content, order_index, original_module_id, training_modules(company_id)")
                    .eq("original_module_id", module_id)
                    .execute()
                )
                pmRows = getattr(pmRes, "data", None)
                modError = getattr(pmRes, "error", None)

                if modError:
                    msg = modError.get("message") if isinstance(modError, dict) else str(modError)
                    print("[Training Plan API] Error fetching processed module:", modError)
                    return JSONResponse(content={"error": msg}, status_code=500)

                modules = pmRows or []

                if len(modules) == 0 and (not baselineRequired):
                    tmFallbackRes = (
                        supabase
                        .table("training_modules")
                        .select("module_id, title, gpt_summary, company_id")
                        .eq("module_id", module_id)
                        .eq("company_id", company_id)
                        .execute()
                    )
                    tmRows = getattr(tmFallbackRes, "data", None)
                    tmError = getattr(tmFallbackRes, "error", None)

                    if tmError:
                        print("[Training Plan API] Error fetching training module fallback:", tmError)
                    elif tmRows and isinstance(tmRows, list) and len(tmRows) > 0:
                        modules = [
                            {
                                "processed_module_id": m.get("module_id"),
                                "title": m.get("title"),
                                "content": m.get("gpt_summary"),
                                "original_module_id": m.get("module_id"),
                                "training_modules": {"company_id": m.get("company_id")},
                            }
                            for m in tmRows
                        ]

                print("Inside the if statement", company_id)

            except Exception as e:
                print("[Training Plan API] Unexpected error filtering module:", e)
                return JSONResponse(content={"error": str(e)}, status_code=500)

        else:
            print("Inside the else statement", company_id)

            trainingModuleRowsRes = (
                supabase
                .table("training_modules")
                .select("module_id")
                .eq("company_id", company_id)
                .execute()
            )
            trainingModuleRows = getattr(trainingModuleRowsRes, "data", None)
            tmError = getattr(trainingModuleRowsRes, "error", None)

            if tmError:
                msg = tmError.get("message") if isinstance(tmError, dict) else str(tmError)
                print("[Training Plan API] Error fetching training modules:", tmError)
                return JSONResponse(content={"error": msg}, status_code=500)

            tmIds = [
                m.get("module_id")
                for m in (trainingModuleRows or [])
                if isinstance(m, dict) and m.get("module_id")
            ]

            if len(tmIds) > 0:
                pmRes = (
                    supabase
                    .table("processed_modules")
                    .select("processed_module_id, title, content, order_index, original_module_id, training_modules(company_id)")
                    .in_("original_module_id", tmIds)
                    .execute()
                )
                pmRows = getattr(pmRes, "data", None)
                modError = getattr(pmRes, "error", None)

                if modError:
                    msg = modError.get("message") if isinstance(modError, dict) else str(modError)
                    print("[Training Plan API] Error fetching modules:", modError)
                    return JSONResponse(content={"error": msg}, status_code=500)

                modules = pmRows or []

                if len(modules) == 0 and (not baselineRequired):
                    tmFallbackRes = (
                        supabase
                        .table("training_modules")
                        .select("module_id, title, content, company_id")
                        .in_("module_id", tmIds)
                        .eq("company_id", company_id)
                        .execute()
                    )
                    tmRows = getattr(tmFallbackRes, "data", None)
                    tmFallbackError = getattr(tmFallbackRes, "error", None)

                    if tmFallbackError:
                        print("[Training Plan API] Error fetching training modules fallback:", tmFallbackError)
                    elif tmRows and isinstance(tmRows, list) and len(tmRows) > 0:
                        modules = [
                            {
                                "processed_module_id": m.get("module_id"),
                                "title": m.get("title"),
                                "content": m.get("content"),
                                "original_module_id": m.get("module_id"),
                                "training_modules": {"company_id": m.get("company_id")},
                            }
                            for m in tmRows
                        ]

        print("[Training Plan API] Modules for company_id:", company_id, modules)

        # Fetch learning style (TS uses gemini_analysis column name)
        lsRes = (
            supabase
            .table("employee_learning_style")
            .select("learning_style")
            .eq("user_id", user_id)
            .single()
            .execute()
        )
        lsData = getattr(lsRes, "data", None)
        lsError = getattr(lsRes, "error", None)

        geminiText = ""
        if lsData:
            geminiText = f"Learning Style: {lsData.get('learning_style')}"

        # Fetch employee KPIs
        kpiRes = (
            supabase
            .table("employee_kpi")
            .select("score, kpis(description, target, datatype)")
            .eq("user_id", user_id)
            .execute()
        )
        kpiRows = getattr(kpiRes, "data", None)
        kpiError = getattr(kpiRes, "error", None)

        kpiText = ""
        if kpiRows and isinstance(kpiRows, list) and len(kpiRows) > 0:
            kpiText = (
                "Employee KPIs (description, score, benchmark, datatype):\n"
                + "\n".join(
                    [
                        f"KPI: {((row.get('kpis') or {}).get('description') or 'N/A')}, "
                        f"Score: {row.get('score')}, "
                        f"Benchmark: {((row.get('kpis') or {}).get('target') if row.get('kpis') else 'N/A')}, "
                        f"Datatype: {((row.get('kpis') or {}).get('datatype') if row.get('kpis') else 'N/A')}"
                        for row in kpiRows
                        if isinstance(row, dict)
                    ]
                )
            )

        # Module count constraints
        availableModuleCount = len(modules)
        moduleRequirements = ""

        if availableModuleCount == 0:
            moduleRequirements = "- No modules are currently available. Inform the user that no training modules match their needs."
        elif availableModuleCount == 1:
            moduleRequirements = "- For all scores: Recommend the 1 available module. Allocate time based on score (2-6 hours)."
        elif availableModuleCount == 2:
            moduleRequirements = "- For all scores: Recommend both available modules if needed. Allocate 3-5 hours per module based on score severity."
        else:
            moduleRequirements = (
                "- For scores 0-30%: Recommend MINIMUM 3-4 modules (or all if fewer available). Allocate 5-6 hours per module.\n"
                "- For scores 31-50%: Recommend MINIMUM 2-3 modules (or all if fewer available). Allocate 4-5 hours per module.\n"
                "- For scores 51-70%: Recommend 2-3 modules. Allocate 3-4 hours per module.\n"
                "- For scores 71-85%: Recommend 1-2 modules. Allocate 2-3 hours per module.\n"
                "- For scores 86-100%: Recommend 1-2 modules. Allocate 2 hours per module."
            )

        # prompts EXACTLY preserved
        prompt1 = (
            "You are an expert corporate trainer. Given the following assessment results and feedback for an employee, the available training modules, and the employee's learning style and analysis, generate a personalized JSON learning plan. If KPI scores (description, score, benchmark, and datatype) are available, use them; otherwise, rely only on baseline assessments.\n\n"
            + geminiText
            + "\n\n"
            + (kpiText + "\n\n" if kpiText else "")
            + "The employee's learning style is classified as one of: Concrete Sequential (CS), Concrete Random (CR), Abstract Sequential (AS), or Abstract Random (AR).\n\n"
            + "When generating the plan, tailor your recommendations, study strategies, and tips to fit the employee's specific learning style and analysis. For example, suggest structured, step-by-step approaches for CS, creative and flexible methods for CR, analytical and theory-driven strategies for AS, and collaborative or intuitive approaches for AR.\n\n"
            + "CRITICAL MODULE SELECTION REQUIREMENTS - MUST FOLLOW:\n"
            + moduleRequirements
            + "\n"
            + "- NEVER recommend modules that are NOT in the Available Modules list.\n"
            + "- NEVER generate, invent, or assume modules that don't exist.\n"
            + "- NEVER recommend only 1 module for low scores (below 50%) if more are available.\n"
            + "- Each module must include: title (or name), recommended_time (in hours), and order.\n"
            + "- Prioritize modules addressing the most critical skill gaps shown in the assessment.\n\n"
            + "The plan should:\n"
            + "- Identify weak areas based on scores, benchmarks, datatypes, and feedback\n"
            + "- Select modules ONLY from the Available Modules list\n"
            + "- Map each selected module to specific weaknesses\n"
            + "- Specify study order, recommended time per module (in hours)\n"
            + "- Include actionable tips and recommendations\n"
            + "- Ensure all recommendations align with the employee's learning style\n\n"
            + "KPI Comparison Instructions:\n"
            + "- For each KPI, compare the employee's score to the benchmark using the provided datatype.\n"
            + "- If datatype is 'percentage', treat both score and benchmark as percentages out of 100.\n"
            + "- If datatype is 'numeric', compare the raw numbers.\n"
            + "- If datatype is 'ratio', compare as a ratio (e.g., score/benchmark).\n"
            + "- Use this comparison to identify strengths and weaknesses for each KPI.\n\n"
            + "Additionally, provide a detailed reasoning (as a separate JSON object) explaining how you arrived at this learning plan, including:\n- Which assessment results, feedback, learning style, and KPI factors (including benchmark and datatype) influenced your choices\n- For each module, justify the recommended time duration (e.g., why 3 hours and not less or more) based on the employee's needs, weaknesses, learning style, and KPIs (including benchmark and datatype)\n- Explicitly explain how the score, benchmark, and datatype influenced the number of modules and total study hours.\n\n"
            + "Assessment Results (baseline only, percentage-based):\n"
            + json.dumps(baselinePercentAssessments, indent=2)
            + "\n\n"
            + "Available Modules:\n"
            + json.dumps(modules, indent=2)
            + "\n\n"
            + "Output ONLY a single JSON object with two top-level keys: plan and reasoning.\n"
            + "JSON format:\n"
            + "{\n"
            + '  "plan": {\n'
            + '    "modules": [\n'
            + '      { "title": "Module Name", "recommended_time": 5, "order": 1 },\n'
            + '      { "title": "Module Name 2", "recommended_time": 5, "order": 2 }\n'
            + "    ],\n"
            + '    "tips": "..."\n'
            + "  },\n"
            + '  "reasoning": { ... }\n'
            + "}\n"
            + "The 'reasoning' key must contain a valid JSON object with the following structure:\n"
            + '{\n  "score_analysis": string,\n  "module_selection": [\n    {\n      "module_name": string,\n      "justification": string,\n      "recommended_time": number\n    }\n  ],\n  "learning_style_influence": string,\n  "kpi_influence": string,\n  "overall_strategy": string\n}\n'
            + 'Do NOT include any other text, explanation, or formatting. Example: { "plan": { ... }, "reasoning": { ... } }'
            + '\n\nCRITICAL: Return ONLY ONE JSON object. Do not duplicate the response. Do not wrap in markdown code blocks. Return raw JSON only.'
        )

        prompt2 = (
            "You are an expert corporate trainer. Given the following assessment results and feedback for an employee, the available training modules, and the employee's learning style and analysis, generate a personalized JSON learning plan.\n\n"
            + geminiText
            + "\n\n"
            + "The employee's learning style is classified as one of: Concrete Sequential (CS), Concrete Random (CR), Abstract Sequential (AS), or Abstract Random (AR).\n\n"
            + "When generating the plan, tailor your recommendations, study strategies, and tips to fit the employee's specific learning style and analysis. For example, suggest structured, step-by-step approaches for CS, creative and flexible methods for CR, analytical and theory-driven strategies for AS, and collaborative or intuitive approaches for AR.\n\n"
            + "CRITICAL MODULE SELECTION REQUIREMENTS - MUST FOLLOW:\n"
            + moduleRequirements
            + "\n"
            + "- NEVER recommend modules that are NOT in the Available Modules list.\n"
            + "- NEVER generate, invent, or assume modules that don't exist.\n"
            + "- Each module must include: title (or name), recommended_time (in hours), and order.\n"
            + "- Prioritize modules addressing the most critical skill gaps shown in the assessment.\n\n"
            + "The plan should:\n"
            + "- Map each selected module to specific weaknesses\n"
            + "- Specify study order, recommended time per module (in hours)\n"
            + "- Include actionable tips and recommendations\n"
            + "- Ensure all recommendations align with the employee's learning style\n"
            + "Additionally, provide a detailed reasoning (as a separate JSON object) explaining how you arrived at this learning plan, including:\n- Which assessment results, feedback, and learning style factors influenced your choices\n- For each module, justify the recommended time duration based on the employee's needs, weaknesses, and learning style\n\n"
            + "Available Modules:\n"
            + json.dumps(modules, indent=2)
            + "\n\n"
            + "Output ONLY a single JSON object with two top-level keys: plan and reasoning.\n"
            + "JSON format:\n"
            + "{\n"
            + '  "plan": {\n'
            + '    "modules": [\n'
            + '      { "title": "Module Name", "recommended_time": 5, "order": 1 },\n'
            + '      { "title": "Module Name 2", "recommended_time": 5, "order": 2 }\n'
            + "    ],\n"
            + '    "tips": "..."\n'
            + "  },\n"
            + '  "reasoning": { ... }\n'
            + "}\n"
            + "The 'reasoning' key must contain a valid JSON object with the following structure:\n"
            + '{\n  "score_analysis": string,\n  "module_selection": [\n    {\n      "module_name": string,\n      "justification": string,\n      "recommended_time": number\n    }\n  ],\n  "learning_style_influence": string,\n  "overall_strategy": string\n}\n'
            + 'Do NOT include any other text, explanation, or formatting. Example: { "plan": { ... }, "reasoning": { ... } }'
            + '\n\nCRITICAL: Return ONLY ONE JSON object. Do not duplicate the response. Do not wrap in markdown code blocks. Return raw JSON only.'
        )

        prompt = prompt1 if len(baselinePercentAssessments) > 0 else prompt2

        # Call Gemini
        planJsonRaw = ""
        try:
            model = genai.GenerativeModel("gemini-2.5-flash-lite")
            result = model.generate_content(prompt)
            planJsonRaw = (result.text or "").strip()
        except Exception as err:
            print("[Training Plan API] Gemini call failed:", str(err))
            return JSONResponse(content={"error": "Gemini call failed", "details": str(err)}, status_code=500)

        # Clean response
        cleanedContent = planJsonRaw.strip()
        if cleanedContent.lower().startswith("```json"):
            cleanedContent = cleanedContent.replace("```json", "", 1).strip()
        elif cleanedContent.lower().startswith("```"):
            cleanedContent = cleanedContent.replace("```", "", 1).strip()
        if cleanedContent.endswith("```"):
            cleanedContent = cleanedContent[:-3].strip()

        cleanedContent = cleanedContent.strip()
        jsonStart = cleanedContent.find("{")
        jsonEnd = cleanedContent.rfind("}")
        if jsonStart != -1 and jsonEnd != -1 and jsonEnd > jsonStart:
            cleanedContent = cleanedContent[jsonStart : jsonEnd + 1]

        plan = None
        reasoning = None

        def sanitizeJson(s: str) -> str:
            out = s.strip()
            out = out.replace("“", '"').replace("”", '"').replace("’", "'")
            import re
            out = re.sub(r"\"([^\"\n]+)\"\s+and\s+\"([^\"\n]+)\"\s*:", r'"\1 and \2":', out)
            out = re.sub(r",\s*([}\]])", r"\1", out)
            firstBrace = out.find("{")
            lastBrace = out.rfind("}")
            if firstBrace != -1 and lastBrace != -1 and lastBrace > firstBrace:
                out = out[firstBrace : lastBrace + 1]
            return out

        def tryParse(raw: str):
            print(raw)
            try:
                parsed = json.loads(raw)
                if isinstance(parsed, dict) and ("plan" in parsed or "reasoning" in parsed):
                    return {"plan": parsed.get("plan"), "reasoning": parsed.get("reasoning")}
                return {"plan": parsed, "reasoning": None}
            except Exception:
                return None

        parsed = tryParse(cleanedContent)
        if not parsed:
            cleaned = sanitizeJson(cleanedContent)
            parsed = tryParse(cleaned)
            if not parsed:
                cleaned2 = sanitizeJson(cleanedContent)
                import re
                planBlock = None
                reasoningBlock = None
                planMatch = re.search(r"\"plan\"\s*:\s*({[\s\S]*?})\s*(,|})", cleaned2)
                reasoningMatch = re.search(r"\"reasoning\"\s*:\s*({[\s\S]*?})\s*(,|})", cleaned2)
                try:
                    planBlock = json.loads(sanitizeJson(planMatch.group(1))) if planMatch else None
                except Exception:
                    planBlock = None
                try:
                    reasoningBlock = json.loads(sanitizeJson(reasoningMatch.group(1))) if reasoningMatch else None
                except Exception:
                    reasoningBlock = None
                if planBlock or reasoningBlock:
                    parsed = {"plan": planBlock, "reasoning": reasoningBlock}

        if not parsed:
            print("[Training Plan API] Could not parse Gemini response as JSON after sanitation. Raw response:", planJsonRaw)
            return JSONResponse(
                content={"error": "Could not parse Gemini response as JSON.", "raw": planJsonRaw},
                status_code=500,
            )

        plan = parsed.get("plan")
        reasoning = parsed.get("reasoning")

        # sanitize plan for frontend safety
        def sanitizePlan(p: Any):
            if not p:
                return p
            if isinstance(p, dict) and isinstance(p.get("modules"), list):
                newMods = []
                for m in p["modules"]:
                    if not isinstance(m, dict):
                        continue
                    m2 = dict(m)
                    if "objectives" in m2:
                        del m2["objectives"]
                    newMods.append(m2)
                p["modules"] = newMods
            return p

        plan = sanitizePlan(plan)

        # Deduplicate modules by title - keep only first occurrence
        def deduplicateModules(p: Any):
            if not p or (not isinstance(p, dict)) or (not isinstance(p.get("modules"), list)):
                return p

            seen = set()
            deduplicated = []
            for module in p["modules"]:
                if not isinstance(module, dict):
                    continue
                title = (module.get("title") or "").strip().lower()
                if not title:
                    continue
                if title in seen:
                    print(f"[Training Plan API] Removing duplicate module: {module.get('title')}")
                    continue
                seen.add(title)
                deduplicated.append(module)

            deduplicated.sort(key=lambda x: x.get("order") or 0)
            for idx, module in enumerate(deduplicated):
                module["order"] = idx + 1

            return {**p, "modules": deduplicated}

        plan = deduplicateModules(plan)

        # Save plan
        dbResult = None
        if existingPlan:
            dbResult = (
                supabase
                .table("learning_plan")
                .update(
                    {
                        "plan_json": plan,
                        "reasoning": reasoning,
                        "status": "ASSIGNED",
                        "assessment_hash": assessmentHash,
                    }
                )
                .eq("learning_plan_id", existingPlan.get("learning_plan_id"))
                .execute()
            )
        else:
            dbResult = (
                supabase
                .table("learning_plan")
                .insert(
                    {
                        "user_id": user_id,
                        "plan_json": plan,
                        "reasoning": reasoning,
                        "status": "ASSIGNED",
                        "module_id": module_id if module_id is not None else None,
                        "assessment_hash": assessmentHash,
                    }
                )
                .execute()
            )

        if getattr(dbResult, "error", None):
            err = getattr(dbResult, "error", None)
            msg = err.get("message") if isinstance(err, dict) else str(err)
            print("[Training Plan API] Error saving plan:", err)
            return JSONResponse(content={"error": msg}, status_code=500)

        # -------------------------------
        # ✅ MERGED FROM TS: module_progress insertion loop
        # -------------------------------
        print("Outside the for loop")
        print(processedModuleIds)

        if processedModuleIds and isinstance(processedModuleIds, list):
            for m in processedModuleIds:
                try:
                    print("Inside the try catch second")
                    insertRes = (
                        supabase
                        .table("module_progress")
                        .insert({"user_id": user_id, "module_id": m, "status": "NOT_STARTED"})
                        .execute()
                    )
                    insertedData = getattr(insertRes, "data", None)
                    print(insertedData)
                except Exception as e:
                    # TS does not fail the whole request, it just logs.
                    print("[Training Plan API] module_progress insert failed:", e)

        return JSONResponse(content={"plan": plan, "reasoning": reasoning})

    except Exception as error:
        print("[Training Plan API] Unexpected error:", error)
        return JSONResponse(content={"error": "Unexpected error occurred"}, status_code=500)
