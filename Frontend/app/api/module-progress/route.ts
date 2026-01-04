import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { 
      user_id, 
      processed_module_id, 
      quiz_score, 
      max_score, 
      quiz_feedback, 
      completed_at,
      viewOnly
    } = body

    if (!user_id || !processed_module_id) {
      return NextResponse.json(
        { error: 'Missing required fields: user_id or processed_module_id' },
        { status: 400 }
      )
    }

    // console.log('[module-progress] Recording progress:', { 
    //   user_id, 
    //   processed_module_id, 
    //   quiz_score, 
    //   max_score 
    // })

    // Check if progress record already exists
    const { data: existingProgress, error: checkError } = await supabase
      .from('module_progress')
      .select('module_progress_id, completed_at')
      .eq('user_id', user_id)
      .eq('processed_module_id', processed_module_id)
      .maybeSingle()

    if (checkError && checkError.code !== 'PGRST116') {
      console.error('[module-progress] Error checking existing progress:', checkError)
      return NextResponse.json(
        { error: 'Failed to check existing progress' },
        { status: 500 }
      )
    }

    let result
    const progressData = {
      user_id,
      processed_module_id,
      quiz_score: quiz_score || null,
      quiz_feedback: quiz_feedback || null,
      completed_at: completed_at || null,
      started_at: existingProgress?.completed_at ? undefined : new Date().toISOString()
    }

    if (existingProgress) {
      // If viewOnly, don't update - just return success
      if (viewOnly) {
        return NextResponse.json({
          success: true,
          message: 'Module view logged (already started)',
          data: existingProgress
        })
      }
      
      // Update existing progress with quiz/completion data
      const updateData: any = {}
      if (quiz_score !== undefined) updateData.quiz_score = progressData.quiz_score
      if (quiz_feedback !== undefined) updateData.quiz_feedback = progressData.quiz_feedback
      if (completed_at) updateData.completed_at = progressData.completed_at
      
      const { data, error } = await supabase
        .from('module_progress')
        .update(updateData)
        .eq('module_progress_id', existingProgress.module_progress_id)
        .select()
        .single()

      if (error) {
        console.error('[module-progress] Error updating progress:', error)
        return NextResponse.json(
          { error: 'Failed to update progress record' },
          { status: 500 }
        )
      }
      result = data
    } else {
      // Create new progress record
      const { data, error } = await supabase
        .from('module_progress')
        .insert(progressData)
        .select()
        .single()

      if (error) {
        console.error('[module-progress] Error creating progress:', error)
        return NextResponse.json(
          { error: 'Failed to create progress record' },
          { status: 500 }
        )
      }
      result = data
    }

    // console.log('[module-progress] Progress recorded successfully:', result?.module_progress_id)

    return NextResponse.json({
      success: true,
      message: 'Module progress recorded successfully',
      data: result
    })

  } catch (error) {
    console.error('[module-progress] Error:', error)
    return NextResponse.json(
      { 
        error: 'Failed to record module progress',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
