import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import OpenAI from "openai";
import crypto from "crypto";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: NextRequest) {
  console.log("[Training Plan API] Request received");
  const { employee_id } = await req.json();
  console.log("[Training Plan API] employee_id:", employee_id);
  if (!employee_id) {
    console.error("[Training Plan API] Missing employee_id");
    return NextResponse.json({ error: "Missing employee_id" }, { status: 400 });
  }

  // Fetch all assessments for this employee, including baseline
  console.log("[Training Plan API] Fetching assessments for employee...");
  const { data: assessments, error: assessError } = await supabase
    .from("employee_assessments")
    .select("score, feedback, assessment_id, assessments(type, questions)")
    .eq("employee_id", employee_id);
  if (assessError) {
    console.error("[Training Plan API] Error fetching assessments:", assessError);
    return NextResponse.json({ error: assessError.message }, { status: 500 });
  }
  console.log("[Training Plan API] Assessments:", assessments);

  // Separate all baseline and all module assessments
  const baselineAssessments = (assessments || []).filter(a => {
    if (Array.isArray(a.assessments)) {
      return a.assessments.some((ass: any) => ass.type === "baseline");
    }
    return a.assessments?.type === "baseline";
  });
  const moduleAssessments = (assessments || []).filter(a => {
    if (Array.isArray(a.assessments)) {
      return a.assessments.some((ass: any) => ass.type !== "baseline");
    }
    return a.assessments?.type !== "baseline";
  });
  console.log("[Training Plan API] Baseline assessments:", baselineAssessments);
  console.log("[Training Plan API] Module assessments:", moduleAssessments);

  // Compute hash of all assessment scores and feedback
  const assessmentHash = crypto.createHash("sha256")
    .update(JSON.stringify({ baselineAssessments, moduleAssessments }))
    .digest("hex");
  console.log("[Training Plan API] assessmentHash:", assessmentHash);

  // Fetch all modules/objectives
  console.log("[Training Plan API] Fetching processed modules...");
  const { data: modules, error: modError } = await supabase
    .from("processed_modules")
    .select("id, title, content, order_index");
  if (modError) {
    console.error("[Training Plan API] Error fetching modules:", modError);
    return NextResponse.json({ error: modError.message }, { status: 500 });
  }
  console.log("[Training Plan API] Modules:", modules);

  // Compose prompt for GPT
  const prompt = `You are an expert corporate trainer. Given the following:\n1. All baseline assessment scores and feedback for the employee:\n${JSON.stringify(baselineAssessments, null, 2)}\n2. All module assessment scores and feedback for the employee:\n${JSON.stringify(moduleAssessments, null, 2)}\n3. The available training modules:\n${JSON.stringify(modules, null, 2)}\n\nGenerate a personalized JSON learning plan for this employee. The plan should:\n- Identify weak areas based on baseline and module scores/feedback\n- Match module objectives to weaknesses\n- Specify what to study, in what order, and how much time for each\n- Output a JSON object with: modules (ordered), objectives, recommended time (hours), and any tips or recommendations\n\nOutput only the JSON plan.`;
  console.log("[Training Plan API] Prompt for GPT:", prompt);

  // Call GPT-4.1
  console.log("[Training Plan API] Calling GPT-4.1...");
  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini-2025-04-14",
    messages: [
      { role: "system", content: "You are an expert corporate trainer and instructional designer." },
      { role: "user", content: prompt },
    ],
    max_tokens: 2048,
    temperature: 0.7,
  });
  let planJsonRaw = completion.choices[0]?.message?.content?.trim() || "";
  console.log("[Training Plan API] GPT raw response:", planJsonRaw);

  // Remove Markdown code block markers if present
  planJsonRaw = planJsonRaw.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();

  let planJson;
  try {
    planJson = JSON.parse(planJsonRaw);
    console.log("[Training Plan API] Parsed plan JSON:", planJson);
  } catch {
    planJson = { raw: planJsonRaw };
    console.warn("[Training Plan API] Could not parse plan JSON, storing raw response.");
  }

  // Step 1: Check if a learning plan already exists for this employee (latest assigned)
  console.log("[Training Plan API] Checking for latest assigned learning plan...");
  const { data: existingPlan, error: existingPlanError } = await supabase
    .from("learning_plan")
    .select("id, plan_json, status, assessment_hash")
    .eq("employee_id", employee_id)
    .eq("status", "assigned")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingPlanError && existingPlanError.code !== "PGRST116") { // PGRST116: No rows found
    console.error("[Training Plan API] Error checking existing plan:", existingPlanError);
    return NextResponse.json({ error: existingPlanError.message }, { status: 500 });
  }

  // Step 2: Only update/insert if assessmentHash has changed
  if (existingPlan && existingPlan.assessment_hash === assessmentHash) {
    console.log("[Training Plan API] No change in assessments. Returning existing plan.");
    return NextResponse.json({ plan: existingPlan.plan_json });
  }

  // ...existing code for generating planJson...

  // Step 3: If plan exists, update it. If not, insert new.
  let dbResult;
  if (existingPlan) {
    console.log("[Training Plan API] Existing plan found. Updating...");
    dbResult = await supabase
      .from("learning_plan")
      .update({ plan_json: planJson, status: "assigned", assessment_hash: assessmentHash })
      .eq("id", existingPlan.id);
  } else {
    console.log("[Training Plan API] No existing plan. Inserting new...");
    dbResult = await supabase
      .from("learning_plan")
      .insert({ employee_id, plan_json: planJson, status: "assigned", assessment_hash: assessmentHash });
  }
  if (dbResult.error) {
    console.error("[Training Plan API] Error saving plan:", dbResult.error);
    return NextResponse.json({ error: dbResult.error.message }, { status: 500 });
  }
  console.log("[Training Plan API] Plan saved successfully.");

  return NextResponse.json({ plan: planJson });
}
