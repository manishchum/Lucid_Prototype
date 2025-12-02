// Server-side Gemini helper
import fetch from 'node-fetch'

export async function callGemini(modelName: string, promptText: string, maxOutputTokens = 512) {
  const key = process.env.GEMINI_API_KEY
  if (!key) return { data: null, error: 'no_gemini_key' }
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta2/models/${modelName}:generate?key=${key}`
    const body = {
      prompt: { text: promptText },
      temperature: 0.25,
      maxOutputTokens,
      candidateCount: 1
    }
    const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const text = await resp.text().catch(() => '')
    if (!resp.ok) {
      return { data: null, error: `status=${resp.status} ${text}` }
    }
    const data = JSON.parse(text || '{}')
    return { data, error: null }
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : String(err) }
  }
}

export const COMMON_GEMINI_MODELS = ['chat-bison-001', 'text-bison-001', 'chat-bison-002']
