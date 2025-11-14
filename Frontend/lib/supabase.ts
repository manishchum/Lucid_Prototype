import { createClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export type Database = {
  public: {
    Tables: {
      companies: {
        Row: {
          id: string
          name: string
          domain: string
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          domain: string
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          domain?: string
          created_at?: string
        }
      }
      admins: {
        Row: {
          id: string
          email: string
          name: string | null
          company_id: string
          created_at: string
        }
        Insert: {
          id?: string
          email: string
          name?: string | null
          company_id: string
          created_at?: string
        }
        Update: {
          id?: string
          email?: string
          name?: string | null
          company_id?: string
          created_at?: string
        }
      }
      employees: {
        Row: {
          id: string
          email: string
          name: string | null
          company_id: string
          joined_at: string
        }
        Insert: {
          id?: string
          email: string
          name?: string | null
          company_id: string
          joined_at?: string
        }
        Update: {
          id?: string
          email?: string
          name?: string | null
          company_id?: string
          joined_at?: string
        }
      }
      training_modules: {
        Row: {
          id: string
          company_id: string
          title: string
          description: string | null
          content_type: string
          content_url: string
          gpt_summary: string | null
          transcription: string | null
          ai_modules: string | null
          ai_topics: string | null
          ai_objectives: string | null
          processing_status: string
          created_at: string
        }
        Insert: {
          id?: string
          company_id: string
          title: string
          description?: string | null
          content_type: string
          content_url: string
          gpt_summary?: string | null
          transcription?: string | null
          ai_modules?: string | null
          ai_topics?: string | null
          ai_objectives?: string | null
          processing_status?: string
          created_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          title?: string
          description?: string | null
          content_type?: string
          content_url?: string
          gpt_summary?: string | null
          transcription?: string | null
          ai_modules?: string | null
          ai_topics?: string | null
          ai_objectives?: string | null
          processing_status?: string
          created_at?: string
        }
      },
      assessments: {
        Row: {
          id: string;
          type: string; // e.g., 'baseline', 'module', etc.
          questions: string; // JSON stringified array of questions
          created_at: string;
        };
        Insert: {
          id?: string;
          type: string;
          questions: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          type?: string;
          questions?: string;
          created_at?: string;
        };
      },
      employee_assessments: {
        Row: {
          id: string;
          user_id: string;
          assessment_id: string;
          score: number;
          max_score: number;
          answers: any; // jsonb
          feedback: string; // summary feedback
          question_feedback: any; // jsonb, new: question-wise feedback
        };
        Insert: {
          id?: string;
          user_id: string;
          assessment_id: string;
          score: number;
          max_score: number;
          answers: any;
          feedback: string;
          question_feedback: any;
        };
        Update: {
          id?: string;
          user_id?: string;
          assessment_id?: string;
          score?: number;
          max_score?: number;
          answers?: any;
          feedback?: string;
          question_feedback?: any;
        };
      },
      processed_modules: {
        Row: {
          id: string;
          original_module_id: string | null;
          title: string;
          content: string;
          section_type: string | null;
          order_index: number | null;
          created_at: string | null;
          audio_url: string | null;
          audio_duration: number | null;
          audio_generated_at: string | null;
        };
        Insert: {
          id?: string;
          original_module_id?: string | null;
          title: string;
          content: string;
          section_type?: string | null;
          order_index?: number | null;
          created_at?: string | null;
          audio_url?: string | null;
          audio_duration?: number | null;
          audio_generated_at?: string | null;
        };
        Update: {
          id?: string;
          original_module_id?: string | null;
          title?: string;
          content?: string;
          section_type?: string | null;
          order_index?: number | null;
          created_at?: string | null;
          audio_url?: string | null;
          audio_duration?: number | null;
          audio_generated_at?: string | null;
        };
      },
      module_progress: {
        Row: {
          id: string;
          user_id: string | null;
          module_id: string | null; // original training_modules id (for grouping)
          processed_module_id?: string | null; // optional if added later
          started_at: string | null;
          completed_at: string | null;
          viewed_at: string | null;
          audio_listen_duration: number | null;
          quiz_score: number | null;
          quiz_feedback: string | null;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          module_id?: string | null;
          processed_module_id?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          viewed_at?: string | null;
          audio_listen_duration?: number | null;
          quiz_score?: number | null;
          quiz_feedback?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          module_id?: string | null;
          processed_module_id?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          viewed_at?: string | null;
          audio_listen_duration?: number | null;
          quiz_score?: number | null;
          quiz_feedback?: string | null;
        };
      }
    }
  }
}
