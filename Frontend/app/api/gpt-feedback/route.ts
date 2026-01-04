import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    // console.log('🔄 GPT Feedback API - Legacy route called, redirecting to submit-assessment:', body);

    const { 
      user_id, 
      assessment_id, 
      answers, 
      userId, 
      assessmentId,
      userAnswers,
      // Legacy parameters that might be sent
      employeeId,
      moduleId,
      processedModuleId
    } = body;

    // Normalize parameters for the new API
    const normalizedUserId = user_id || userId || employeeId;
    const normalizedAssessmentId = assessment_id || assessmentId;
    const normalizedAnswers = answers || userAnswers;

    if (!normalizedUserId || !normalizedAssessmentId || !normalizedAnswers) {
      return NextResponse.json(
        { error: 'Missing required fields: user_id, assessment_id, and answers are required' },
        { status: 400 }
      );
    }

    // console.log('🔄 Calling submit-assessment API with normalized data:', {
    //   user_id: normalizedUserId,
    //   assessment_id: normalizedAssessmentId,
    //   answers: normalizedAnswers,
    //   type: (moduleId || processedModuleId) ? 'module' : 'baseline',
    //   module_id: moduleId || processedModuleId // Pass module_id for training-plan calls
    // });

    // Call the new submit-assessment API internally
    const submitAssessmentResponse = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/submit-assessment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: normalizedUserId,
        assessment_id: normalizedAssessmentId,
        answers: normalizedAnswers,
        type: (moduleId || processedModuleId) ? 'module' : 'baseline',
        module_id: moduleId || processedModuleId // Pass module_id for potential training-plan calls
      })
    });

    if (!submitAssessmentResponse.ok) {
      const errorText = await submitAssessmentResponse.text();
      console.error('❌ Submit assessment failed:', errorText);
      return NextResponse.json(
        { error: 'Failed to process assessment submission', details: errorText },
        { status: submitAssessmentResponse.status }
      );
    }

    const assessmentResult = await submitAssessmentResponse.json();

    // Return response in the format expected by legacy clients
    return NextResponse.json({
      success: true,
      score: assessmentResult.score,
      maxScore: assessmentResult.maxScore,
      percentage: assessmentResult.percentage,
      feedback: assessmentResult.feedback,
      questionFeedback: assessmentResult.questionFeedback,
      correctAnswers: assessmentResult.correctAnswers,
      message: assessmentResult.message,
      // Legacy format compatibility
      aiGeneratedFeedback: assessmentResult.feedback,
      detailedFeedback: assessmentResult.questionFeedback,
      result: {
        score: assessmentResult.score,
        totalQuestions: assessmentResult.maxScore,
        percentage: assessmentResult.percentage,
        correctAnswers: assessmentResult.correctAnswers,
        feedback: assessmentResult.feedback
      }
    });

  } catch (error) {
    console.error('❌ Error in GPT feedback API:', error);
    return NextResponse.json(
      { 
        error: 'Failed to process feedback request',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
