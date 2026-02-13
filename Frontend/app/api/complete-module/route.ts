import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    // console.log('📚 DEBUG: Complete module request body:', body)
    
    const { 
      employeeId, 
      moduleId, 
      quizScore, 
      quizFeedback, 
      maxScore,
      processed_module_id,
      user_id,
      quiz_score,
      max_score,
      quiz_feedback
    } = body


    
    // Handle both old and new parameter formats
    const userId = employeeId || user_id
    const processedModuleId = processed_module_id || moduleId
    const score = quizScore || quiz_score
    const feedback = quizFeedback || quiz_feedback
    const maximum = maxScore || max_score

    if (!userId || !processedModuleId) {
      return NextResponse.json(
        { error: 'Missing required fields: user_id and processed_module_id are required' },
        { status: 400 }
      )
    }

    // console.log('📚 DEBUG: Processing module completion:', { 
    //   userId, 
    //   processedModuleId, 
    //   score, 
    //   maximum, 
    //   feedback: feedback ? 'present' : 'missing' 
    // })

    // Check if there's already a progress record for this user and processed module
    console.log("User id",userId)
    const { data: existingProgress, error: checkError } = await supabase
      .from('module_progress')
      .select('module_progress_id, completed_at, quiz_score')
      .eq('user_id', userId)
      .eq('processed_module_id', processedModuleId)


      console.log("Data of thej ust fetched existing progress",existingProgress)
    if (checkError && checkError.code !== 'PGRST116') {
      console.error('📚 DEBUG: Error checking existing progress:', checkError)
      return NextResponse.json(
        { error: 'Failed to check existing progress' },
        { status: 500 }
      )
    }

    let progressData
    const completionTime = new Date().toISOString()

    if (existingProgress && existingProgress.length > 0) {
      console.log('📚 DEBUG: Updating existing progress record:', existingProgress[0].module_progress_id)
      console.log("Module Id is :",moduleId)

      
      // Update existing progress record - only update columns that exist in the schema
      const updateData: any = {
        quiz_score: score || null,
        quiz_feedback: feedback || null
      }

      const { data, error: updateError } = await supabase
        .from('module_progress')
        .update(updateData)
        .eq('module_progress_id', existingProgress[0].module_progress_id)
        .select()  // Add this to return the updated data

      if (updateError) {
        console.error('📚 DEBUG: Error updating module progress:', updateError)
        return NextResponse.json(
          { error: 'Failed to update module progress' },
          { status: 500 }
        )
      }
      progressData = data?.[0] || null
    } else {
      // console.log('📚 DEBUG: Creating new progress record')
      
      // Create new progress record - only include columns that exist in the schema
      const insertData: any = {
        user_id: userId,
        processed_module_id: processedModuleId,
        started_at: completionTime,
        completed_at: completionTime,
        quiz_score: score || null,
        quiz_feedback: feedback || null
      }


      console.log("Creating new progress record")

      const { data, error: insertError } = await supabase
        .from('module_progress')
        .insert(insertData)  // Changed from .update() to .insert()
        .select()  // Add this to return the inserted data

      if (insertError) {
        console.error('📚 DEBUG: Error creating module progress:', insertError)
        return NextResponse.json(
          { error: 'Failed to create module progress record' },
          { status: 500 }
        )
      }
      progressData = data?.[0] || null
    }

    // console.log('📚 DEBUG: Module completion recorded successfully:', progressData)

    console.log("Error outside the if")
    // Only send admin notification if this is a new completion (not an update)
    const isNewCompletion = !existingProgress?.completed_at
    if (isNewCompletion) {
      try {
        // console.log('📧 DEBUG: Triggering admin notification for new completion')
        
        // Call the admin notification API
        const notificationResponse = await fetch(`${process.env.INTERNAL_API_BASE_URL}/api/notify-admin-completion`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            employeeId: userId,
            moduleId: processedModuleId,
            completionDate: completionTime
          }),
        })

        if (!notificationResponse.ok) {
          console.error('📧 DEBUG: Admin notification failed:', await notificationResponse.text())
        } else {
          const notificationData = await notificationResponse.json()
          // console.log('📧 DEBUG: Admin notification sent successfully:', notificationData.message)
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
      isNewCompletion,
      score: score || null,
      maxScore: maximum || null,
      feedback: feedback || null
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