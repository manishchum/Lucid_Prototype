import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import OpenAI from "openai";
import crypto from "crypto";
import ensureProcessedModulesForPlan from "@/lib/processedModulesHelper";

export async function POST(req: NextRequest) {
  console.log("[Training Plan API] Request received");
  const { user_id } = await req.json();
  console.log("[Training Plan API] user_id:", user_id);
  if (!user_id) {
    console.error("[Training Plan API] Missing user_id");
    return NextResponse.json({ error: "Missing user_id" }, { status: 400 });
  }
  // Validate OpenAI API key early to avoid opaque 500s later
  if (!process.env.OPENAI_API_KEY) {
    console.error("[Training Plan API] OPENAI_API_KEY is not set");
    return NextResponse.json({ error: "Server misconfiguration: OPENAI_API_KEY is missing." }, { status: 500 });
  }
  // Fetch company_id for this employee
  let company_id = null;
  const { data: empRecord, error: empError } = await supabase
    .from("users")
    .select("company_id")
    .eq("user_id", user_id)
    .maybeSingle();
  if (empError || !empRecord?.company_id) {
    console.error("[Training Plan API] Could not find company for employee");
    return NextResponse.json({ error: "Could not find company for employee" }, { status: 400 });
  }
  company_id = empRecord.company_id;

  // Fetch all assessments for this employee, including baseline
  console.log("[Training Plan API] Fetching assessments for employee...");
  const { data: assessments, error: assessError } = await supabase
    .from("employee_assessments")
    .select("score, max_score, feedback, assessment_id, assessments(type, questions)")
    .eq("user_id", user_id);
  if (assessError) {
    console.error("[Training Plan API] Error fetching assessments:", assessError);
    return NextResponse.json({ error: assessError.message }, { status: 500 });
  }
  console.log("[Training Plan API] Assessments:", assessments);

  // Separate all baseline and all module assessments
  const baselineAssessments = (assessments || []).filter((a: any) => {
    const arr = Array.isArray(a?.assessments) ? a.assessments : [a?.assessments].filter(Boolean);
    return arr.some((ass: any) => ass?.type === "baseline");
  });
  const moduleAssessments = (assessments || []).filter((a: any) => {
    const arr = Array.isArray(a?.assessments) ? a.assessments : [a?.assessments].filter(Boolean);
    return arr.some((ass: any) => ass?.type !== "baseline");
  });
  console.log("[Training Plan API] Baseline assessments:", baselineAssessments);
  console.log("[Training Plan API] Module assessments:", moduleAssessments);

  // Compute percentage-based baseline results for plan generation
  const baselinePercentAssessments = (baselineAssessments || []).map((row: any) => {
    const score = Number(row?.score ?? 0);
    const max = Number(row?.max_score ?? 0);
    const percent = max > 0 ? Math.round((score / max) * 100) : null;
    return {
      assessment_id: row?.assessment_id ?? null,
      score,
      max_score: max,
      score_percent: percent, // used by GPT
      feedback: row?.feedback ?? null,
    };
  });
  console.log("[Training Plan API] Baseline percent assessments:", baselinePercentAssessments);

  // Compute hash only from baseline assessments so module quizzes don't change the plan
  const assessmentHash = crypto.createHash("sha256")
    .update(JSON.stringify({ baselinePercentAssessments }))
    .digest("hex");
  console.log("[Training Plan API] assessmentHash:", assessmentHash);

  // Fetch all processed modules for this company by joining training_modules, handling empty lists safely
  console.log("[Training Plan API] Fetching processed modules for company_id:", company_id);
  const { data: trainingModuleRows, error: tmError } = await supabase
    .from("training_modules")
    .select("module_id")
    .eq("company_id", company_id);
  if (tmError) {
    console.error("[Training Plan API] Error fetching training modules:", tmError);
    return NextResponse.json({ error: tmError.message }, { status: 500 });
  }
  const tmIds = (trainingModuleRows || []).map((m: any) => m.module_id);
  let modules: any[] = [];
  if (tmIds.length > 0) {
    const { data: pmRows, error: modError } = await supabase
      .from("processed_modules")
      .select("processed_module_id, title, content, order_index, original_module_id, training_modules(company_id)")
      .in("original_module_id", tmIds);
    if (modError) {
      console.error("[Training Plan API] Error fetching modules:", modError);
      return NextResponse.json({ error: modError.message }, { status: 500 });
    }
    modules = pmRows || [];
  } else {
    console.log("[Training Plan API] No training modules found for company; proceeding with empty module list");
  }
  console.log("[Training Plan API] Modules for company_id:", company_id, modules);

  const { data: lsData, error: lsError } = await supabase
    .from("employee_learning_style")
    .select("learning_style, gpt_analysis")
    .eq("user_id", user_id)
    .single();
  let gptText = "";
  if (lsData) {
    gptText = `Learning Style: ${lsData.learning_style}\nAnalysis: ${lsData.gpt_analysis}`;
  }

  // Step 1.5: Check if a learning plan already exists and matches the current assessment state (avoid unnecessary GPT calls)
  console.log("[Training Plan API] Checking for latest assigned learning plan...");
  const { data: existingPlan, error: existingPlanError } = await supabase
    .from("learning_plan")
    .select("learning_plan_id, plan_json, reasoning, status, assessment_hash")
    .eq("user_id", user_id)
  .eq("status", "ASSIGNED")
    .order("learning_plan_id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingPlanError && (existingPlanError as any).code !== "PGRST116") { // PGRST116: No rows found
    console.error("[Training Plan API] Error checking existing plan:", existingPlanError);
    return NextResponse.json({ error: existingPlanError.message }, { status: 500 });
  }
  if (existingPlan && existingPlan.assessment_hash === assessmentHash) {
    console.log("[Training Plan API] No change in assessments. Returning existing plan (pre-GPT).");
    // Ensure processed_modules exist for modules referenced by the cached plan
    try {
      await ensureProcessedModulesForPlan(user_id, company_id, existingPlan.plan_json);
    } catch (e) {
      console.error("[Training Plan API] ensureProcessedModulesForPlan failed on cache-hit:", e);
    }
    return NextResponse.json({ plan: existingPlan.plan_json, reasoning: existingPlan.reasoning });
  }

  // Fetch employee KPIs (description and score)
  const { data: kpiRows, error: kpiError } = await supabase
    .from("employee_kpi")
    .select("score, kpis(description, benchmark, datatype)")
    .eq("user_id", user_id);
  let kpiText = "";
  if (kpiRows && kpiRows.length > 0) {
    kpiText = "Employee KPIs (description, score, benchmark, datatype):\n" +
      kpiRows.map((row: any) => {
        const desc = row.kpis?.description || "N/A";
        const score = row.score;
        const benchmark = row.kpis?.benchmark ?? "N/A";
        const datatype = row.kpis?.datatype || "N/A";
        return `KPI: ${desc}, Score: ${score}, Benchmark: ${benchmark}, Datatype: ${datatype}`;
      }).join("\n");
  }

  // Compose prompt for GPT
  const prompt =
    "You are an expert corporate trainer. Given the following assessment results and feedback for an employee, the available training modules, and the employee's learning style and analysis, generate a personalized JSON learning plan. If KPI scores (description, score, benchmark, and datatype) are available, use them; otherwise, rely only on baseline assessments.\n\n" +
    gptText + "\n\n" +
    (kpiText ? kpiText + "\n\n" : "") +
    "The employee's learning style is classified as one of: Concrete Sequential (CS), Concrete Random (CR), Abstract Sequential (AS), or Abstract Random (AR).\n\n" +
    "When generating the plan, tailor your recommendations, study strategies, and tips to fit the employee's specific learning style and analysis. For example, suggest structured, step-by-step approaches for CS, creative and flexible methods for CR, analytical and theory-driven strategies for AS, and collaborative or intuitive approaches for AR.\n\n" +
    "STRICT CONSTRAINTS:\n" +
    "- The number of modules and total study hours must decrease as the employee's score increases.\n" +
    "- For scores above 80% of the maximum, recommend only essential modules and minimize study hours (max 1 hours per module).\n" +
    "- For scores below 40% of the maximum, recommend more modules and study hours as needed, but justify each.\n" +
    "- For scores in between, recommend a moderate number of modules and study hours, proportional to weaknesses.\n" +
    "- For each module, provide a clear justification for its inclusion and the recommended study time, based on the employee's weaknesses and learning style.\n" +
    "- Do not recommend unnecessary modules or excessive study time for high performers.\n" +
    "- The plan must be efficient and fair: high performers should not be overburdened, and weaker performers should get enough support.\n\n" +
    "The plan should:\n- Identify weak areas based on scores, benchmarks, datatypes, and feedback\n- Match module objectives to weaknesses\n- Specify what to study, in what order, and how much time for each\n- Output a JSON object with: modules (ordered), objectives, recommended time (hours), and any tips or recommendations\n- Ensure all recommendations and tips are personalized to the employee's learning style\n\n" +
    "KPI Comparison Instructions:\n" +
    "- For each KPI, compare the employee's score to the benchmark using the provided datatype.\n" +
    "- If datatype is 'percentage', treat both score and benchmark as percentages out of 100.\n" +
    "- If datatype is 'numeric', compare the raw numbers.\n" +
    "- If datatype is 'ratio', compare as a ratio (e.g., score/benchmark).\n" +
    "- Use this comparison to identify strengths and weaknesses for each KPI.\n\n" +
    "Additionally, provide a detailed reasoning (as a separate JSON object) explaining how you arrived at this learning plan, including:\n- Which assessment results, feedback, learning style, and KPI factors (including benchmark and datatype) influenced your choices\n- For each module, justify the recommended time duration (e.g., why 3 hours and not less or more) based on the employee's needs, weaknesses, learning style, and KPIs (including benchmark and datatype)\n- Explicitly explain how the score, benchmark, and datatype influenced the number of modules and total study hours.\n\n" +
  "Assessment Results (baseline only, percentage-based):\n" + JSON.stringify(baselinePercentAssessments, null, 2) + "\n\n" +
    "Available Modules:\n" + JSON.stringify(modules, null, 2) + "\n\n" +
    "Output ONLY a single JSON object with two top-level keys: plan and reasoning.\n" +
    "The 'reasoning' key must contain a valid JSON object with the following structure:\n" +
    "{\n  \"score_analysis\": string,\n  \"module_selection\": [\n    {\n      \"module_name\": string,\n      \"justification\": string,\n      \"recommended_time\": number\n    }\n  ],\n  \"learning_style_influence\": string,\n  \"kpi_influence\": string,\n  \"overall_strategy\": string\n}\n" +
    "Do NOT include any other text, explanation, or formatting. Example: { \"plan\": { ... }, \"reasoning\": { ... } }";
  console.log("[Training Plan API] Prompt for GPT:", prompt);

  // Call OpenAI with a widely supported model and safe token limits
  console.log("[Training Plan API] Calling OpenAI (gpt-4o-mini)...");
  let planJsonRaw = "";
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are an expert corporate trainer and instructional designer." },
        { role: "user", content: prompt },
      ],
      // Keep output size reasonable to reduce errors; adjust if needed
      max_tokens: 3000,
      temperature: 0.7,
    });
    planJsonRaw = completion.choices[0]?.message?.content?.trim() || "";
    console.log("[Training Plan API] GPT raw response:", planJsonRaw);
  } catch (err: any) {
    console.error("[Training Plan API] OpenAI call failed:", err?.response?.data || err?.message || err);
    return NextResponse.json({ error: "OpenAI call failed", details: err?.message || String(err) }, { status: 500 });
  }

  // Remove Markdown code block markers if present
  planJsonRaw = planJsonRaw.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();

  // Hardened parsing with sanitation and fallbacks
  let plan: any = null;
  let reasoning: any = null;

  const sanitizeJson = (s: string): string => {
    let out = s.trim();
    // Normalize smart quotes and apostrophes
    out = out.replace(/[“”]/g, '"').replace(/[’]/g, "'");
    // Merge keys like "Key1" and "Key2": into a single valid JSON key
    out = out.replace(/"([^"\n]+)"\s+and\s+"([^"\n]+)"\s*:/g, '"$1 and $2":');
    // Remove trailing commas before } or ]
    out = out.replace(/,\s*([}\]])/g, '$1');
    // Ensure there is only one top-level JSON object
    const firstBrace = out.indexOf('{');
    const lastBrace = out.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      out = out.slice(firstBrace, lastBrace + 1);
    }
    return out;
  };

  const tryParse = (raw: string): { plan?: any; reasoning?: any } | null => {
    try {
      const parsed = JSON.parse(raw);
      if (parsed.plan || parsed.reasoning) {
        return { plan: parsed.plan ?? null, reasoning: parsed.reasoning ?? null };
      }
      return { plan: parsed, reasoning: null };
    } catch {
      return null;
    }
  };

  // Attempt 1: strict parse
  let parsed = tryParse(planJsonRaw);
  if (!parsed) {
    // Attempt 2: sanitize and parse
    const cleaned = sanitizeJson(planJsonRaw);
    parsed = tryParse(cleaned);
    if (!parsed) {
      // Attempt 3: extract plan and reasoning blocks separately
      const cleaned2 = sanitizeJson(planJsonRaw);
      let planBlock: any = null;
      let reasoningBlock: any = null;
      const planMatch = cleaned2.match(/"plan"\s*:\s*({[\s\S]*?})\s*(,|})/);
      const reasoningMatch = cleaned2.match(/"reasoning"\s*:\s*({[\s\S]*?})\s*(,|})/);
      try { planBlock = planMatch ? JSON.parse(sanitizeJson(planMatch[1])) : null; } catch { planBlock = null; }
      try { reasoningBlock = reasoningMatch ? JSON.parse(sanitizeJson(reasoningMatch[1])) : null; } catch { reasoningBlock = null; }
      if (planBlock || reasoningBlock) {
        parsed = { plan: planBlock, reasoning: reasoningBlock };
      }
    }
  }

  if (!parsed) {
    console.error("[Training Plan API] Could not parse GPT response as JSON after sanitation. Raw response:", planJsonRaw);
    return NextResponse.json({ error: "Could not parse GPT response as JSON.", raw: planJsonRaw }, { status: 500 });
  }
  plan = parsed.plan ?? null;
  reasoning = parsed.reasoning ?? null;

  // 🔹 sanitize plan for frontend safety
  const sanitizePlan = (p: any) => {
    if (!p) return p;
    if (Array.isArray(p.modules)) {
      p.modules = p.modules.map((m: any) => ({
        ...m,
        objectives: Array.isArray(m.objectives)
          ? m.objectives.map((obj: any) =>
              typeof obj === "object" && obj !== null ? JSON.stringify(obj) : obj
            )
          : typeof m.objectives === "object" && m.objectives !== null
          ? [JSON.stringify(m.objectives)]
          : m.objectives,
      }));
    }
    return p;
  };

  plan = sanitizePlan(plan);
  console.log("[Training Plan API] Parsed plan:", plan);
  console.log("[Training Plan API] Parsed reasoning:", reasoning);

  // Step 2: Only update/insert if assessmentHash has changed (existingPlan already fetched above)

  // Step 3: If plan exists, update it. If not, insert new.
  let dbResult;
  if (existingPlan) {
    console.log("[Training Plan API] Existing plan found. Updating...");
    dbResult = await supabase
      .from("learning_plan")
      .update({ plan_json: plan, reasoning: reasoning, status: "ASSIGNED", assessment_hash: assessmentHash })
      .eq("learning_plan_id", existingPlan.learning_plan_id);
  } else {
    console.log("[Training Plan API] No existing plan. Inserting new...");
    dbResult = await supabase
      .from("learning_plan")
      // Right now the last updated module is assigned 
      .insert({ user_id, plan_json: plan, reasoning: reasoning, status: "ASSIGNED", module_id: tmIds[tmIds.length-1], assessment_hash: assessmentHash });
  }
  if (dbResult.error) {
    console.error("[Training Plan API] Error saving plan:", dbResult.error);
    return NextResponse.json({ error: dbResult.error.message }, { status: 500 });
  }
  console.log("[Training Plan API] Plan saved successfully.");

  // Ensure processed_modules exist for modules in the newly saved plan
  try {
    await ensureProcessedModulesForPlan(user_id, company_id, plan);
  } catch (e) {
    console.error("[Training Plan API] ensureProcessedModulesForPlan failed after save:", e);
  }

  // Always return parsed plan and reasoning
  return NextResponse.json({ plan, reasoning });
}
