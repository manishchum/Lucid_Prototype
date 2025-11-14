// import { NextRequest, NextResponse } from "next/server";
// import { supabase } from "@/lib/supabase";
// import OpenAI from "openai";

// const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// export async function POST(req: NextRequest) {
//   const { user_id } = await req.json();
//   if (!user_id) return NextResponse.json({ error: "Missing user_id" }, { status: 400 });

//   // Fetch learning style and analysis for this employee
//   const { data: lsData, error: lsError } = await supabase
//     .from("employee_learning_style")
//     .select("learning_style, gpt_analysis")
//     .eq("user_id", user_id)
//     .single();
//   let gptText = "";
//   if (lsData) {
//     gptText = `Learning Style: ${lsData.learning_style}\nAnalysis: ${lsData.gpt_analysis}`;
//   }
//   // Optionally, handle error or missing data if needed

//   // Fetch all assessments for this employee
//   const { data: assessments, error: assessError } = await supabase
//     .from("employee_assessments")
//     .select("score, feedback, assessment_id, assessments(type, questions)")
//     .eq("user_id", user_id);
//   if (assessError) return NextResponse.json({ error: assessError.message }, { status: 500 });

//   // Fetch all modules/objectives
//   const { data: modules, error: modError } = await supabase
//     .from("processed_modules")
//     .select("id, title, content, order_index");
//   if (modError) return NextResponse.json({ error: modError.message }, { status: 500 });

//   // // Compose prompt for GPT
//   const prompt = `You are an expert corporate trainer. Given the following assessment results and feedback for an employee, the available training modules, and the employee's learning style and analysis, generate a personalized JSON learning plan.\n\n${gptText}\n\nThe employee's learning style is classified as one of: Concrete Sequential (CS), Concrete Random (CR), Abstract Sequential (AS), or Abstract Random (AR).\n\nWhen generating the plan, tailor your recommendations, study strategies, and tips to fit the employee's specific learning style and analysis. For example, suggest structured, step-by-step approaches for CS, creative and flexible methods for CR, analytical and theory-driven strategies for AS, and collaborative or intuitive approaches for AR.\n\nThe plan should:\n- Identify weak areas based on scores and feedback\n- Match module objectives to weaknesses\n- Specify what to study, in what order, and how much time for each\n- Output a JSON object with: modules (ordered), objectives, recommended time (hours), and any tips or recommendations\n- Ensure all recommendations and tips are personalized to the employee's learning style\n\nAdditionally, provide a detailed reasoning (as a separate JSON object) explaining how you arrived at this learning plan, including which assessment results, feedback, and learning style factors influenced your choices.\n\nAssessment Results:\n${JSON.stringify(assessments, null, 2)}\n\nAvailable Modules:\n${JSON.stringify(modules, null, 2)}\n\nOutput ONLY a single JSON object with two top-level keys: plan and reasoning. Do NOT include any other text, explanation, or formatting. Example:
// {
//   "plan": { ... },
//   "reasoning": { ... }
// }`;

//   // Call GPT-4.1
//   const completion = await openai.chat.completions.create({
//     model: "gpt-4-turbo",
//     messages: [
//       { role: "system", content: "You are an expert corporate trainer and instructional desigWner." },
//       { role: "user", content: prompt },
//     ],
//     max_tokens: 2048,
//     temperature: 0.7,
//   });
//   const planJsonRaw = completion.choices[0]?.message?.content?.trim() || "";

//   let planJson;
//   let plan = null;
//   let reasoning = null;
//   try {
//     const parsed = JSON.parse(planJsonRaw);
//     if (parsed.plan && parsed.reasoning) {
//       plan = parsed.plan;
//       reasoning = parsed.reasoning;
//     } else {
//       plan = parsed.plan || parsed;
//       reasoning = parsed.reasoning || { raw: planJsonRaw, message: "No reasoning provided by GPT." };
//     }
//   } catch {
//     plan = { raw: planJsonRaw };
//     reasoning = { raw: planJsonRaw, message: "Could not parse GPT response as JSON." };
//   }

//   // Store in learning_plan table
//   const { error: lpError } = await supabase
//     .from("learning_plan")
//     .insert({
//       user_id,
//       plan_json: plan,
//       reasoning: reasoning,
//       status: "assigned"
//     });
//   if (lpError) return NextResponse.json({ error: lpError.message }, { status: 500 });

//   return NextResponse.json({ plan: planJson });
// }
