import { NextRequest, NextResponse } from 'next/server'
import { OpenAIUploadService } from '@/lib/openai-upload-service'

export async function POST(request: NextRequest) {
  try {
    const { audioUrl } = await request.json()

    if (!audioUrl) {
      return NextResponse.json(
        { error: 'Audio URL is required' },
        { status: 400 }
      )
    }

    // Toggle between real API and simulated responses
    const USE_REAL_API = process.env.USE_REAL_API === 'true'
    
    /*
    if (!USE_REAL_API) {
      // Simulated transcription for development
      const simulatedTranscription = `This is a simulated transcription of the audio/video content from ${audioUrl}. 
      
      In a real implementation, this would be the actual transcribed text from the audio or video file. 
      The Whisper API would process the audio and return the spoken words as text.
      
      This transcription would then be used for further AI processing to generate summaries, modules, topics, and learning objectives.`

      // Simulate processing time
      await new Promise(resolve => setTimeout(resolve, 2000))

      return NextResponse.json({
        transcription: simulatedTranscription,
      })
    }

    */
    // Use improved OpenAI upload service
    const result = await OpenAIUploadService.uploadToWhisper(audioUrl, 'audio.mp4')
    
    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 500 }
      )
    }

    return NextResponse.json({ transcription: result.data })

  } catch (error) {
    console.error('Whisper API error:', error)
    return NextResponse.json(
      { error: 'Failed to transcribe audio' },
      { status: 500 }
    )
  }
} 