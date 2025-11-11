import { supabase } from './supabase'
import { DocumentExtractor } from './document-extractor'

export interface AIProcessingResult {
  transcription?: string
  summary: string
  modules: string[]
  topics: string[]
  objectives: string[]
}

export interface ProcessingStatus {
  status: 'pending' | 'transcribing' | 'summarizing' | 'completed' | 'failed'
  message?: string
}

export class AIService {
  private static async callWhisperAPI(audioUrl: string): Promise<string> {
    try {
      const response = await fetch('/api/whisper', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ audioUrl }),
      })

      if (!response.ok) {
        throw new Error(`Whisper API error: ${response.statusText}`)
      }

      const data = await response.json()
      return data.transcription
    } catch (error) {
      console.error('Whisper API error:', error)
      throw error
    }
  }

  private static async callGPTAPI(content: string, contentType: string): Promise<{
    summary: string
    modules: string[]
    topics: string[]
    objectives: string[]
  }> {
    try {
      const response = await fetch('/api/gpt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content, contentType }),
      })

      if (!response.ok) {
        throw new Error(`GPT API error: ${response.statusText}`)
      }

      const data = await response.json()
      return {
        summary: data.summary,
        modules: data.modules,
        topics: data.topics,
        objectives: data.objectives,
      }
    } catch (error) {
      console.error('GPT API error:', error)
      throw error
    }
  }

  private static async updateProcessingStatus(
    moduleId: string,
    status: ProcessingStatus
  ): Promise<void> {
    try {
      const { error } = await supabase
        .from('training_modules')
        .update({
          processing_status: status.status,
        })
        .eq('module_id', moduleId)

      if (error) throw error
    } catch (error) {
      console.error('Failed to update processing status:', error)
    }
  }

  private static async updateAIResults(
    moduleId: string,
    results: AIProcessingResult
  ): Promise<void> {
    try {
      const { error } = await supabase
        .from('training_modules')
        .update({
          transcription: results.transcription || null,
          gpt_summary: results.summary,
          ai_modules: JSON.stringify(results.modules),
          ai_topics: JSON.stringify(results.topics),
          ai_objectives: JSON.stringify(results.objectives),
          processing_status: 'completed',
        })
        .eq('module_id', moduleId)

      if (error) throw error
    } catch (error) {
      console.error('Failed to update AI results:', error)
      throw error
    }
  }

  public static async processContent(
    moduleId: string,
    contentUrl: string,
    contentType: string
  ): Promise<void> {
    try {
      // Update status to transcribing
      await this.updateProcessingStatus(moduleId, {
        status: 'transcribing',
        message: 'Converting audio/video to text...',
      })

      let transcription: string | undefined
      let contentToAnalyze: string

      // Check if content needs transcription (audio/video files)
      const needsTranscription = [
        'audio/mpeg',
        'audio/wav',
        'audio/ogg',
        'audio/mp4',
        'audio/aac',
        'video/mp4',
        'video/avi',
        'video/mov',
        'video/wmv',
        'video/flv',
        'video/webm',
      ].includes(contentType)

      if (needsTranscription) {
        // Use Whisper for transcription
        transcription = await this.callWhisperAPI(contentUrl)
        contentToAnalyze = transcription
      } else {
        // For text-based files, we'll need to extract text content
        // This would require additional processing based on file type
        contentToAnalyze = await this.extractTextContent(contentUrl, contentType)
      }

      // Update status to summarizing
      await this.updateProcessingStatus(moduleId, {
        status: 'summarizing',
        message: 'Analyzing content and generating summary...',
      })

      // Use GPT for summarization and analysis
      const gptResults = await this.callGPTAPI(contentToAnalyze, contentType)

      // Update with final results
      await this.updateAIResults(moduleId, {
        transcription,
        ...gptResults,
      })

    } catch (error) {
      console.error('AI processing failed:', error)
      await this.updateProcessingStatus(moduleId, {
        status: 'failed',
        message: error instanceof Error ? error.message : 'Processing failed',
      })
      throw error
    }
  }

  private static async extractTextContent(contentUrl: string, contentType: string): Promise<string> {
    return await DocumentExtractor.extractTextFromDocument(contentUrl, contentType)
  }

  public static async getProcessingStatus(moduleId: string): Promise<ProcessingStatus | null> {
    try {
      const { data, error } = await supabase
        .from('training_modules')
        .select('processing_status')
        .eq('module_id', moduleId)
        .single()

      if (error) {
        console.error('Supabase error:', error)
        return null
      }

      if (!data) {
        console.error('No data found for module:', moduleId)
        return null
      }

      return {
        status: data.processing_status as ProcessingStatus['status'],
      }
    } catch (error) {
      console.error('Failed to get processing status:', error)
      return null
    }
  }
} 