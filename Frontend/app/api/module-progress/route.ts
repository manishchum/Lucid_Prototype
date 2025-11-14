import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// Upsert module progress by user_id + processed_module_id
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      user_id,
      processed_module_id,
      // Optional legacy field for grouping, if you still use training_modules
      module_id,
      viewed_at,
      started_at,
      completed_at,
      audio_listen_duration, // seconds to add
      quiz_score,
      // max_score,
      quiz_feedback,
    } = body;

    if (!user_id || !processed_module_id) {
      return NextResponse.json({ error: 'user_id and processed_module_id are required' }, { status: 400 });
    }

    // Fetch existing progress
    const { data: existing, error: fetchErr } = await supabase
      .from('module_progress')
      .select('*')
      .eq('user_id', user_id)
      .eq('processed_module_id', processed_module_id)
      .maybeSingle();

    if (fetchErr && fetchErr.code !== 'PGRST116') {
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }

    // Build patch
    const patch: any = {};
  if (module_id) patch.module_id = module_id; // optional legacy linkage
  if (typeof viewed_at === 'string') patch.viewed_at = viewed_at;
  if (typeof started_at === 'string') patch.started_at = started_at;
  if (typeof completed_at === 'string') patch.completed_at = completed_at;
  if (typeof quiz_score === 'number') patch.quiz_score = quiz_score;
  // if (typeof max_score === 'number') patch.max_score = max_score;  if (typeof quiz_feedback === 'string') patch.quiz_feedback = quiz_feedback;

    if (!existing) {
      // Insert new row
      const insertPayload = {
        user_id,
        processed_module_id,
        ...patch,
        audio_listen_duration: typeof audio_listen_duration === 'number' ? audio_listen_duration : null,
      };
      const { data, error } = await supabase.from('module_progress').insert(insertPayload).select('*').maybeSingle();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ data });
    } else {
      // Update existing: accumulate audio duration
  const newDuration = (existing.audio_listen_duration || 0) + (typeof audio_listen_duration === 'number' ? audio_listen_duration : 0);
  const updatePayload = { ...patch, audio_listen_duration: newDuration };
      const { data, error } = await supabase
        .from('module_progress')
        .update(updatePayload)
        .eq('user_id', user_id)
        .eq('processed_module_id', processed_module_id)
        .select('*')
        .maybeSingle();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ data });
    }
  } catch (err: any) {
    console.error('[module-progress] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
