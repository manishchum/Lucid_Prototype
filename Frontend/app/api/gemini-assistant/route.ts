import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '../../../lib/supabase'
import { callGemini } from '../../../lib/gemini-helper'

// Simple intent detection heuristics
function detectIntent(q: string, mode?: string) {
  const t = (q || '').toLowerCase()
  if (mode === 'doubt') return 'ask_doubt'
  if (/summar|tl;dr|brief|short/.test(t)) return 'summarize'
  if (/detail|detailed|long|explain in detail/.test(t)) return 'summarize_long'
  if (/quiz|mcq|question|practice|test|generate questions/.test(t)) return 'generate_questions'
  if (/explain|clarif|what does .* mean|how does/.test(t)) return 'explain'
  if (/flashcard|flashcards|revise|cards/.test(t)) return 'flashcards'
  if (/how|why|what|who|when|where/.test(t)) return 'ask_doubt'
  return 'summarize'
}

// Reuse a condensed section extractor (keeps route focused but simple)
function excerptFromContent(content: string, max = 2000) {
  if (!content) return ''
  const cleaned = content.replace(/\s+/g, ' ').trim()
  return cleaned.length > max ? cleaned.slice(0, max) + '\n...[truncated]' : cleaned
}

const saveAskDoubt = async (uid: string | null, question: string, answer: string) => {
  if (!uid) return
  try {
    const { error } = await supabase.rpc('append_ask_doubt_qna', { p_user: uid, p_question: question, p_answer: answer })
    if (error) {
      // fallback: read, push, upsert
      const { data: existing } = await supabase.from('chatbot_user_interactions').select('ask_doubt').eq('user_id', uid).single()
      let arr: any[] = []
      if (existing && Array.isArray(existing.ask_doubt)) arr = existing.ask_doubt
      arr.push({ question, answer, created_at: new Date().toISOString() })
      await supabase.from('chatbot_user_interactions').upsert([{ user_id: uid, ask_doubt: arr, updated_at: new Date().toISOString() }], { onConflict: 'user_id' })
    }
  } catch (e) {
    console.warn('[gemini-assistant] saveAskDoubt failed', e)
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const query = (body?.query || '').toString().trim()
    const userId = body?.user_id || null
    const style = body?.style || 'default' // visual, storytelling, simple
    const lengthPref = body?.length || 'short' // short|detailed

    const intent = detectIntent(query, body?.mode)

    // fetch relevant modules/content from processed_modules (weighted by title/content match)
    let matches: any[] = []
    try {
      const { data } = await supabase
        .from('processed_modules')
        .select('processed_module_id, title, content, original_module_id')
        .ilike('content', `%${query}%`)
        .limit(6)
      matches = data || []
    } catch (e) {
      console.error('[gemini-assistant] supabase search failed', e)
    }

    // build grounding text
    const sourceParts = matches.map(m => `Title: ${m.title || 'unknown'}\n\n${excerptFromContent(m.content || '', 1200)}`).join('\n\n---\n\n')

    // hardcoded Gemini model
    const geminiModel = 'gemini-2.5-flash-lite'
    if (!process.env.GEMINI_API_KEY) {
      const fallback = excerptFromContent(sourceParts || '')
      return NextResponse.json({ answer: fallback || `No content found for "${query}".`, llm_model_used: null, llm_error: [{ model: 'gemini', error: 'no_gemini_key' }] })
    }

    // construct prompt per intent
    let system = `You are an empathetic learning assistant that helps learners understand module content. Be concise when asked, friendly, use examples and step-by-step breakdowns when helpful.`
    let userPrompt = ''

    if (intent === 'summarize' || intent === 'summarize_long') {
      const brev = intent === 'summarize' || lengthPref === 'short' ? 'short (3-6 bullets or 2-4 sentences)' : 'detailed (structured sections with examples)'
      userPrompt = `Please ${brev} summary of the following content for a learner. Output in a friendly, actionable tone and use bullets when helpful. Learning style: ${style}.\n\nContent:\n${sourceParts}`
    } else if (intent === 'ask_doubt') {
      userPrompt = `Answer the learner's question clearly using the provided module content. Be step-by-step, show examples if helpful, and avoid inventing facts. Learner question: ${query}\n\nContent:\n${sourceParts}`
    } else if (intent === 'generate_questions') {
      userPrompt = `Generate a set of practice items from the content. Provide: 6 MCQs with 4 options and correct answer indicated, 3 short-answer prompts, and 2 scenario-based open questions. Use clear language and map each item to the topic section if possible. Content:\n${sourceParts}`
    } else if (intent === 'explain') {
      userPrompt = `Explain this concept to a learner using simple analogies and step-by-step examples. Provide a short definition, 2 analogies, and a worked example. Learner question: ${query}\n\nContent:\n${sourceParts}`
    } else if (intent === 'flashcards') {
      userPrompt = `Create concise flashcards from the content. Output as JSON array of {front,back}. Generate up to 12 cards. Content:\n${sourceParts}`
    } else {
      userPrompt = `Provide a helpful learner-focused reply to: ${query}. Use the provided content for grounding. Content:\n${sourceParts}`
    }

    // call Gemini (single model preference)
    const gResp = await callGemini(userPrompt, { candidateModels: [geminiModel], maxOutputTokens: 1200 })
    if (!gResp || !gResp.ok || !gResp.data) {
      const err = (gResp && !gResp?.ok) || 'unknown_gemini_error'
      console.error('[gemini-assistant] gemini error', err)
      const fallback = excerptFromContent(sourceParts || '')
      // save fallback if it's a doubt
      if (intent === 'ask_doubt' && userId) await saveAskDoubt(userId, query, fallback)
      return NextResponse.json({ answer: fallback || `I couldn't synthesize an answer.`, llm_model_used: null, llm_error: [{ model: `gemini:${geminiModel}`, error: err }] })
    }

    // Prefer the normalized text (callGemini sets data.text) but fall back to raw candidates
    const cand = (gResp.data && (gResp.data.text || gResp.data.candidates?.[0]?.content || gResp.data.output?.[0]?.content)) || ''
    const answer = (cand || '').toString().trim()

    if (intent === 'ask_doubt' && userId) {
      await saveAskDoubt(userId, query, answer)
    }

    return NextResponse.json({ answer, llm_model_used: `gemini:${geminiModel}`, llm_error: null, sources: matches.map(m => ({ id: m.processed_module_id, title: m.title })) })

  } catch (err) {
    console.error('[gemini-assistant] unexpected error', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'unknown' }, { status: 500 })
  }
}
