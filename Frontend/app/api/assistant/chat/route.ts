import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '../../../../lib/supabase'

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url)
    const userId = url.searchParams.get('user_id')
    if (!userId) return NextResponse.json({ error: 'user_id required' }, { status: 400 })

    const { data, error } = await supabase.from('chatbot_user_interactions').select('chat').eq('user_id', userId).single()
    if (error) {
      console.warn('[assistant/chat] supabase select error', { user: userId, error })
      // return an empty array rather than a hard failure so the frontend can still render
      return NextResponse.json({ chat: [] })
    }
    const chat = (data && Array.isArray(data.chat)) ? data.chat : []
    return NextResponse.json({ chat })
  } catch (e) {
    console.error('[assistant/chat] unexpected error', e)
    return NextResponse.json({ error: 'unexpected error' }, { status: 500 })
  }
}
