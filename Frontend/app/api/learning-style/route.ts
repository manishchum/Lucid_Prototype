import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"
import { GoogleGenerativeAI } from "@google/generative-ai"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { user_id, answers } = body
    if (!user_id || !answers || !Array.isArray(answers) || answers.length !== 40) {
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
      .select("user_id, learning_style, gpt_analysis, answers")
      .eq("user_id", user_id)
      .single()
    
    if (fetchError && fetchError.code !== "PGRST116") { // PGRST116: No rows found
      return NextResponse.json({ error: fetchError.message }, { status: 500 })
    }

    const now = new Date().toISOString();
    
    // If learning style and analysis already exist, just update answers and return existing data
    if (existing && existing.learning_style && existing.gpt_analysis) {
      // console.log('[LearningStyle] Learning style already determined, updating answers only:', existing.learning_style)
      
      // Update only the answers to keep record of latest submission
      const { error: updateError } = await adminClient
        .from('employee_learning_style')
        .update({ answers, updated_at: now })
        .eq('user_id', user_id)
      
      if (updateError) {
        console.error('[LearningStyle] Error updating answers:', updateError)
      }
      
      // Return existing analysis without regenerating
      return NextResponse.json({ 
        success: true, 
        gpt: { 
          dominant_style: existing.learning_style,
          learning_style: existing.learning_style,
          report: existing.gpt_analysis 
        },
        message: 'Learning style already determined - using existing analysis'
      })
    }

    if (existing) {
      // If a row exists but no learning style determined yet, update answers and continue with analysis
      const { error: updateError } = await adminClient
        .from('employee_learning_style')
        .update({ answers, updated_at: now })
        .eq('user_id', user_id)
      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 })
      }
    } else {
      // Insert new entry
      const { error: insertError } = await adminClient
        .from("employee_learning_style")
        .insert({ user_id, answers, created_at: now, updated_at: now })
      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 500 })
      }
    }

    // Compute deterministic fallback learning style from the answers (10 questions per style)
    let fallbackStyle: string | null = null
    try {
      const nums = answers.map((a: any) => Number(a) || 0)
      const sumRange = (start: number, end: number) => nums.slice(start, end).reduce((s: number, v: number) => s + v, 0)
      const scores = {
        CS: sumRange(0, 10),
        AS: sumRange(10, 20),
        AR: sumRange(20, 30),
        CR: sumRange(30, 40),
      }
      const entries = Object.entries(scores)
      entries.sort((a, b) => b[1] - a[1])
      fallbackStyle = entries[0][0]
      // Save fallback learning style immediately so row isn't left null
      const { error: fallbackErr } = await adminClient
        .from('employee_learning_style')
        .update({ learning_style: fallbackStyle, updated_at: new Date().toISOString() })
        .eq('user_id', user_id)
      if (fallbackErr) {
        console.error('[LearningStyle] Failed to save fallback learning style', fallbackErr)
      } else {
        // console.log('[Le//arningStyle] Saved fallback learning style:', fallbackStyle)
      }
    } catch (e) {
      console.error('[LearningStyle] Fallback computation error', e)
    }

    // Call Gemini for learning style analysis
    let gptResult: any = null
    let learnedStyle: string | null = null
    let rawGPTText: string | null = null
    try {
      // Initialize Gemini AI
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" })

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
  // console.log("[LearningStyle] QA Pairs:", qaPairs);
  // Current (active) prompt: legacy-style narrative, but with strict section formatting for the UI parser
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

Return JSON: {
  scores: { CS: number, AS: number, AR: number, CR: number },
  dominant_style: "CS|AS|AR|CR",
  secondary_style: "CS|AS|AR|CR",
  report: "...full user report..."
}

Survey Responses:
${qaPairs}`;

  /* Structured JSON-only prompt (kept for reference, not active)
  const prompt = `...structured schema version...`
  */
      // console.log("[LearningStyle] Gemini prompt:", prompt)
      
      const result = await model.generateContent(prompt)
      const response = await result.response
      const gptText = response.text()
      rawGPTText = gptText

      // console.log("[LearningStyle] Gemini raw response:", gptText)

      // Try to parse JSON if the model returned it
      let analysisText: string | null = null
      try {
        const parsed = JSON.parse(gptText)
        gptResult = parsed
        learnedStyle = parsed.dominant_style || parsed.learning_style || parsed.dominant || null
        analysisText = parsed.report || parsed.analysis || parsed.reportText || null
        if (!learnedStyle && parsed.scores && typeof parsed.scores === 'object') {
          const sEntries = Object.entries(parsed.scores)
          sEntries.sort((a: any, b: any) => Number(b[1]) - Number(a[1]))
          learnedStyle = sEntries[0]?.[0] || null
        }
      } catch (e) {
        // Fallback to raw text as the report
        gptResult = { raw: gptText }
        analysisText = gptText
      }

      const updatePayload: any = { updated_at: new Date().toISOString() }
      // Always prefer to keep the deterministic fallback unless we have an actual GPT analysis text
      // Save analysis text if available (from parsed report or raw GPT text)
      if (analysisText) {
        updatePayload.gpt_analysis = analysisText
      } else if (gptResult && (gptResult.raw || gptResult.raw_text)) {
        // If parsing didn't yield structured report, persist raw GPT text as analysis
        updatePayload.gpt_analysis = String(gptResult.raw || gptResult.raw_text)
      } else if (rawGPTText) {
        // Fallback: if we captured rawGPTText earlier, persist that
        updatePayload.gpt_analysis = rawGPTText
      }

      // Decide the final style to persist and return: prefer GPT-derived only when we also have analysis text
      const finalStyle = (learnedStyle && updatePayload.gpt_analysis) ? learnedStyle : fallbackStyle

      if (finalStyle) updatePayload.learning_style = finalStyle

      // If we have something besides updated_at to save, update the row
      if (Object.keys(updatePayload).length > 1) {
        const { error: saveErr } = await adminClient
          .from('employee_learning_style')
          .update(updatePayload)
          .eq('user_id', user_id)
        if (saveErr) {
          console.error('[LearningStyle] Failed to save GPT analysis', saveErr)
        } else {
          // console.log('[LearningStyle] GPT analysis & learning_style saved for', user_id, 'finalStyle=', finalStyle)
        }
      } else {
        // console.log('[LearningStyle] No GPT-derived learning_style or analysis to save (kept fallback)')
      }

      // Ensure the response contains the same dominant_style the DB now has
      if (gptResult && typeof gptResult === 'object') {
        gptResult.dominant_style = finalStyle || gptResult.dominant_style || gptResult.learning_style || null
        // Ensure report field has actual newlines, not escaped ones
        if (gptResult.report && typeof gptResult.report === 'string') {
          gptResult.report = gptResult.report.replace(/\\n/g, '\n')
        }
      } else if (!gptResult) {
        gptResult = { dominant_style: finalStyle }
      }
    } catch (saveEx) {
      console.error('[LearningStyle] Error saving GPT result', saveEx)
    }

    return NextResponse.json({ success: true, gpt: gptResult })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Unknown error" }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const user_id = searchParams.get('user_id')

    if (!user_id) {
      return NextResponse.json({ error: 'user_id required' }, { status: 400 })
    }

    const { createClient } = await import('@supabase/supabase-js')
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Supabase service key missing' }, { status: 500 })
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey)

    const { data: record, error } = await adminClient
      .from('employee_learning_style')
      .select('learning_style, gpt_analysis')
      .eq('user_id', user_id)
      .single()

    if (error && error.code !== 'PGRST116') {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!record) {
      return NextResponse.json({ data: null })
    }

    // Ensure gpt_analysis has actual newlines, not escaped ones
    let gpt_analysis = record.gpt_analysis
    if (gpt_analysis && typeof gpt_analysis === 'string') {
      gpt_analysis = gpt_analysis.replace(/\\n/g, '\n')
    }

    return NextResponse.json({
      success: true,
      data: {
        learning_style: record.learning_style,
        gpt_analysis: gpt_analysis
      }
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Unknown error' }, { status: 500 })
  }
}
