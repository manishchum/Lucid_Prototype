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
  const userId = employeeId ?? user_id
  const processedModuleId = processed_module_id ?? moduleId
  const score = quizScore ?? quiz_score
  const feedback = quizFeedback ?? quiz_feedback
  const maximum = maxScore ?? max_score

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
    console.log("User id", userId)
    const { data: existingProgress, error: checkError } = await supabase
      .from('module_progress')
      .select('module_progress_id, completed_at, quiz_score')
      .eq('user_id', userId)
      .eq('processed_module_id', processedModuleId)

    console.log("Data of the just fetched existing progress", existingProgress)
    if (checkError) {
      console.error('📚 DEBUG: Error checking existing progress:', checkError)
      return NextResponse.json(
        { error: 'Failed to check existing progress' },
        { status: 500 }
      )
    }

    let progressData
    const completionTime = new Date().toISOString()
    const existingRecord = Array.isArray(existingProgress) && existingProgress.length > 0
      ? existingProgress[0]
      : null
    const wasAlreadyCompleted = Boolean(existingRecord?.completed_at)

    // Resolve original module id for threshold/pass-status evaluation.
    const { data: processedModuleData } = await supabase
      .from('processed_modules')
      .select('original_module_id')
      .eq('processed_module_id', processedModuleId)
      .maybeSingle()

    const resolvedModuleId = moduleId ?? processedModuleData?.original_module_id ?? null

    let passStatus: boolean | null = null
    if (typeof score === 'number' && typeof maximum === 'number' && maximum > 0 && resolvedModuleId) {
      const { data: thresholdRow } = await supabase
        .from('training_modules')
        .select('threshold_value')
        .eq('module_id', resolvedModuleId)
        .maybeSingle()

      const threshold = typeof thresholdRow?.threshold_value === 'number'
        ? thresholdRow.threshold_value
        : null

      if (threshold !== null) {
        const scorePercent = (score / maximum) * 100
        passStatus = scorePercent >= threshold
      }
    }

    if (existingRecord) {
      console.log('📚 DEBUG: Updating existing progress record:', existingRecord.module_progress_id)
      console.log('Resolved Module Id:', resolvedModuleId)

      
      // Update existing progress record - only update columns that exist in the schema
      const updateData: any = {
        quiz_score: score ?? null,
        quiz_feedback: feedback ?? null,
        completed_at: completionTime,
      }

      if (passStatus !== null) {
        updateData.pass_status = passStatus
      }

      const { data, error: updateError } = await supabase
        .from('module_progress')
        .update(updateData)
        .eq('module_progress_id', existingRecord.module_progress_id)
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
        quiz_score: score ?? null,
        quiz_feedback: feedback ?? null,
      }

      if (passStatus !== null) {
        insertData.pass_status = passStatus
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

    console.log('📚 DEBUG: Complete module done')

    // START: Update overall_status in learning_plan
    if (resolvedModuleId) {
      try {
        const { data: plans } = await supabase
          .from('learning_plan')
          .select('learning_plan_id, processed_module_ids')
          .eq('user_id', userId)
          .eq('module_id', resolvedModuleId)
          .maybeSingle()

        if (plans && Array.isArray(plans.processed_module_ids) && plans.processed_module_ids.length > 0) {
          const requiredIds = plans.processed_module_ids
          
          const { data: progressRecords } = await supabase
            .from('module_progress')
            .select('processed_module_id, pass_status, completed_at')
            .eq('user_id', userId)
            .in('processed_module_id', requiredIds)

          if (progressRecords) {
            let allPassed = true
            for (const reqId of requiredIds) {
              const rec = progressRecords.find((r: any) => r.processed_module_id === reqId)
              if (!rec || !rec.completed_at || rec.pass_status !== true) {
                allPassed = false
                break
              }
            }

            if (allPassed) {
              console.log('🏆 Target Sprint Completed! Updating learning_plan overall_status to TRUE.')
              await supabase
                .from('learning_plan')
                .update({
                  overall_status: true,
                  status: 'COMPLETED',
                  completed_at: completionTime
                })
                .eq('learning_plan_id', plans.learning_plan_id)
            }
          }
        }
      } catch (lpErr) {
        console.error('📚 DEBUG: Error updating learning plan overall_status:', lpErr)
      }
    }
    // END: Update overall_status in learning_plan

    // Only send admin notification if this is a new completion (not an update)
    const isNewCompletion = !wasAlreadyCompleted
    if (isNewCompletion) {
      try {
        // console.log('📧 DEBUG: Triggering admin notification for new completion')
        
        // Call the admin notification API
        const internalBaseUrl =
          process.env.INTERNAL_API_BASE_URL ||
          process.env.NEXT_PUBLIC_APP_URL ||
          request.nextUrl.origin

        const notificationResponse = await fetch(new URL('/api/notify-admin-completion', internalBaseUrl).toString(), {
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