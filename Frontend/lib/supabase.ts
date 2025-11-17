import { createClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Toggle mock supabase behavior during development. Set `USE_MOCK_API=true` in your env to enable.
const useMock = process.env.USE_MOCK_API === "true";

// Mock data and helpers
const mockUser = {
  user_id: "mock-user-1",
  email: "user@example.com",
  name: "Mock User",
  company_id: "mock-company-1",
};

const mockTrainingModules = [
  {
    id: "module-1",
    company_id: "mock-company-1",
    title: "Introduction to Product",
    description: "A short intro module",
    content_type: "article",
    content_url: "",
    gpt_summary: null,
    transcription: null,
    ai_modules: null,
    ai_topics: null,
    ai_objectives: null,
    processing_status: "completed",
    created_at: new Date().toISOString(),
  },
];

const mockProcessedModules = [
  { id: "pm-1", original_module_id: "module-1", title: "Intro - Section 1", content: "Content 1", order_index: 1 },
];

function mockResponseForTable(table: string) {
  switch (table) {
    case "users":
      return [mockUser];
    case "user_role_assignments":
      return [{ roles: { name: "employee" } }];
    case "training_modules":
      return mockTrainingModules;
    case "processed_modules":
      return mockProcessedModules;
    case "module_progress":
      return [];
    case "employee_assessments":
    case "assessments":
      return [];
    default:
      return [];
  }
}

function createMockFrom(table: string) {
  const chain: any = {
    _table: table,
    select(_s?: string) {
      return chain;
    },
    maybeSingle() {
      const data = mockResponseForTable(table);
      return Promise.resolve({ data: data.length > 0 ? data[0] : null, error: null });
    },
    single() {
      const data = mockResponseForTable(table);
      return Promise.resolve({ data: data.length > 0 ? data[0] : null, error: null });
    },
    eq(_k: string, _v: any) {
      return chain;
    },
    in(_k: string, _v: any[]) {
      return chain;
    },
    order() { return chain; },
    limit() { return chain; },
    insert(payload: any) {
      return Promise.resolve({ data: payload, error: null });
    },
    update(payload: any) {
      return Promise.resolve({ data: payload, error: null });
    },
    delete() {
      return Promise.resolve({ data: [], error: null });
    },
  };
  return chain;
}

const mockAuth = {
  getUser: async () => ({ data: { user: mockUser }, error: null }),
  signInWithPassword: async () => ({ data: { user: mockUser }, error: null }),
  signOut: async () => ({ error: null }),
};

const mockSupabase = {
  from: createMockFrom,
  auth: mockAuth,
  _isMock: true,
};

const realSupabase = createClient(supabaseUrl, supabaseAnonKey);

export const supabase: any = useMock ? mockSupabase : realSupabase;

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
