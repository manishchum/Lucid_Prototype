import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"
import OpenAI from "openai"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { employee_id, answers } = body
    if (!employee_id || !answers || !Array.isArray(answers) || answers.length !== 40) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
    }
    // Use supabase admin client for server-side inserts
    const { createClient } = await import("@supabase/supabase-js")
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "Supabase service key missing" }, { status: 500 })
    }
    const adminClient = createClient(supabaseUrl, supabaseServiceKey)
    // Check if already exists for this employee
    const { data: existing, error: fetchError } = await adminClient
      .from("employee_learning_style")
      .select("employee_id")
      .eq("employee_id", employee_id)
      .single()
    if (fetchError && fetchError.code !== "PGRST116") { // PGRST116: No rows found
      return NextResponse.json({ error: fetchError.message }, { status: 500 })
    }
    if (existing) {
      return NextResponse.json({ error: "Learning style already submitted for this user." }, { status: 403 })
    }
    // Insert new entry
    const { error: insertError } = await adminClient
      .from("employee_learning_style")
      .insert({ employee_id, answers })
    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    // Call GPT for learning style analysis
    let gptResult = null
    try {
      // Import OpenAI library (edge/serverless compatible)
      const openaiModule = await import("openai")
      const openai = new openaiModule.OpenAI({ apiKey: process.env.OPENAI_API_KEY })
      // List of 48 learning style questions
      const questions = [
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
      ];
      // Pair each question with its answer
      let qaPairs = questions.map((q, i) => `Q${i+1}: ${q}\nA${i+1}: ${answers[i] || ""}`).join("\n");
  console.log("[LearningStyle] QA Pairs:", qaPairs);
  const prompt = `You are an expert in learning styles. Given the following 40 survey questions and the user's answers (1-5 scale), analyze and classify the user's dominant learning style as one of the following: Concrete Sequential (CS), Concrete Random (CR), Abstract Sequential (AS), or Abstract Random (AR).\n\nFor your response:\n1. Return the best-fit learning style as one of CS, CR, AS, or AR.\n2. Provide a detailed analysis justifying the classification and describing how the user learns best according to this style.\nReturn JSON: { learning_style: \"...\", analysis: \"...\" }\n\nSurvey Responses:\n${qaPairs}`;
      //   console.log("[LearningStyle] OpenAI prompt:", prompt)
      const completion = await openai.chat.completions.create({
        model: "gpt-4.1",
        messages: [
          { role: "system", content: "You are an expert learning style analyst." },
          { role: "user", content: prompt }
        ],
        temperature: 0.2,
        max_tokens: 1000
      })
      console.log("[LearningStyle] GPT prompt:", prompt)
      console.log("[LearningStyle] OpenAI raw response:", completion)
      // Parse GPT response
      const gptText = completion.choices[0]?.message?.content || ""
      console.log("[LearningStyle] OpenAI parsed text:", gptText)
      // Remove Markdown code fences if present
      let cleanedText = gptText.trim()
      if (cleanedText.startsWith('```json')) {
        cleanedText = cleanedText.replace(/^```json/, '').replace(/```$/, '').trim()
      } else if (cleanedText.startsWith('```')) {
        cleanedText = cleanedText.replace(/^```/, '').replace(/```$/, '').trim()
      }
      try {
        gptResult = JSON.parse(cleanedText)
        console.log("[LearningStyle] OpenAI parsed JSON:", gptResult)
      } catch (jsonErr) {
        gptResult = { error: "GPT response not valid JSON", raw: gptText }
        console.error("[LearningStyle] OpenAI JSON parse error:", jsonErr)
      }
    } catch (gptErr: any) {
      gptResult = { error: "GPT analysis failed", details: gptErr?.message || String(gptErr) }
      console.error("[LearningStyle] OpenAI call error:", gptErr)
    }

    // Save GPT result (learning style classification and analysis) in employee_learning_style
    if (gptResult && gptResult.learning_style && gptResult.analysis) {
      await adminClient
        .from("employee_learning_style")
        .update({ learning_style: gptResult.learning_style, gpt_analysis: gptResult.analysis })
        .eq("employee_id", employee_id)
        console.log("GPT Analysis")
    }

    return NextResponse.json({ success: true, gpt: gptResult })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Unknown error" }, { status: 500 })
  }
}
