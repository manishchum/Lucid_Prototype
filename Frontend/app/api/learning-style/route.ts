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
  const prompt = `You are an expert educational psychologist specializing in learning style models. Your goal is to administer the Gregorc Learning Style Delineator, analyze the user's responses, calculate their scores, and generate a detailed and empathetic report on their dominant learning style(s).

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
Generate the learning style assessment report with the following structure.
Title: Your Personal Learning Style Insights

Based on your answers, here’s what we discovered about how you learn best. Use these insights to understand your strengths and find learning plans that work for you.
1. Your Natural Learning Style:
  • "Your approach to learning is most like that of The [Organizer/Thinker/Connector/Innovator]."
  • Provide a 2-3 paragraph engaging description of dominant learning style.
2. How You Thrive:
  • Ideal Learning Environment: List 4-5 conditions.
  • Your Superpowers: List 3-4 strengths.
3. Tips to Make Learning Easier:
  • If you feel stuck, try: List 3-4 actionable strategies.
  • What to Look For: Suggest content types.

Return JSON: {
  scores: { CS: number, AS: number, AR: number, CR: number },
  dominant_style: "CS|AS|AR|CR",
  secondary_style: "CS|AS|AR|CR",
  report: "...full user report..."
}

Survey Responses:
${qaPairs}`;
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
    if (gptResult && (gptResult.dominant_style || gptResult.learning_style) && gptResult.report) {
      await adminClient
        .from("employee_learning_style")
        .update({
          learning_style: gptResult.dominant_style || gptResult.learning_style,
          gpt_analysis: gptResult.report
        })
        .eq("employee_id", employee_id)
      console.log("GPT Analysis saved to Supabase")
    }

    return NextResponse.json({ success: true, gpt: gptResult })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Unknown error" }, { status: 500 })
  }
}
