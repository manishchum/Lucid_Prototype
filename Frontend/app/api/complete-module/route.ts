import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { employeeId, moduleId, quizScore, quizFeedback } = body

    if (!employeeId || !moduleId) {
      return NextResponse.json(
        { error: 'Missing required fields: employeeId or moduleId' },
        { status: 400 }
      )
    }

    console.log('📚 DEBUG: Processing module completion:', { employeeId, moduleId })

    // Check if there's already a progress record for this employee and module
    const { data: existingProgress, error: checkError } = await supabase
      .from('module_progress')
      .select('id, completed_at')
      .eq('user_id', employeeId)
      .eq('module_id', moduleId)
      .single()

    let progressData
    const completionTime = new Date().toISOString()

    if (existingProgress) {
      // Update existing progress record
      const { data, error: updateError } = await supabase
        .from('module_progress')
        .update({
          completed_at: completionTime,
          quiz_score: quizScore || null,
          quiz_feedback: quizFeedback || null
        })
        .eq('module_progress_id', existingProgress.id)
        .select()
        .single()

      if (updateError) {
        console.error('📚 DEBUG: Error updating module progress:', updateError)
        return NextResponse.json(
          { error: 'Failed to update module progress' },
          { status: 500 }
        )
      }
      progressData = data
    } else {
      // Create new progress record
      const { data, error: insertError } = await supabase
        .from('module_progress')
        .insert({
          user_id: employeeId,
          module_id: moduleId,
          started_at: completionTime, // Assuming they started when they completed
          completed_at: completionTime,
          quiz_score: quizScore || null,
          quiz_feedback: quizFeedback || null
        })
        .select()
        .single()

      if (insertError) {
        console.error('📚 DEBUG: Error creating module progress:', insertError)
        return NextResponse.json(
          { error: 'Failed to create module progress record' },
          { status: 500 }
        )
      }
      progressData = data
    }

    console.log('📚 DEBUG: Module completion recorded successfully')

    // Only send admin notification if this is a new completion (not an update)
    if (!existingProgress?.completed_at) {
      try {
        console.log('📧 DEBUG: Triggering admin notification for new completion')
        
        // Call the admin notification API
        const notificationResponse = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/notify-admin-completion`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            employeeId: employeeId,
            moduleId: moduleId,
            completionDate: completionTime
          }),
        })

        if (!notificationResponse.ok) {
          console.error('📧 DEBUG: Admin notification failed:', await notificationResponse.text())
        } else {
          const notificationData = await notificationResponse.json()
          console.log('📧 DEBUG: Admin notification sent successfully:', notificationData.message)
        }
      } catch (notificationError) {
        console.error('📧 DEBUG: Error sending admin notification:', notificationError)
        // Don't fail the whole request if notification fails
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Module completion recorded successfully',
      data: progressData,
      isNewCompletion: !existingProgress?.completed_at
    })

  } catch (error) {
    console.error('📚 DEBUG: Error in complete-module API:', error)
    return NextResponse.json(
      { 
        error: 'Failed to record module completion',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}