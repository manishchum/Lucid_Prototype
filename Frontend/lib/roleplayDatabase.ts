// Helper functions for role-play session database operations
import { supabase } from './supabase';
import { Message } from './roleplay/types';

export interface RolePlaySession {
  id?: string;
  employee_id: string;
  module_id?: string;
  scenario_id: string;
  scenario_title: string;
  scenario_role: string;
  scenario_difficulty: string;
  conversation_transcript: Message[];
  started_at?: string;
  completed_at?: string;
  duration_seconds?: number;
  message_count?: number;
}

export interface RolePlayAssessment {
  id?: string;
  session_id: string;
  employee_id: string;
  overall_score: number;
  summary: string;
  parameters: Array<{
    name: string;
    score: number;
    feedback: string;
  }>;
  recommendations: string[];
}

/**
 * Create a new role-play session
 */
export async function createRolePlaySession(
  employeeId: string,
  scenarioId: string,
  scenarioTitle: string,
  scenarioRole: string,
  scenarioDifficulty: string,
  moduleId?: string
): Promise<{ data: any; error: any }> {
  const { data, error } = await supabaseAdmin
    .from('roleplay_sessions')
    .insert({
      employee_id: employeeId,
      module_id: moduleId,
      scenario_id: scenarioId,
      scenario_title: scenarioTitle,
      scenario_role: scenarioRole,
      scenario_difficulty: scenarioDifficulty,
      conversation_transcript: [],
      message_count: 0,
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  return { data, error };
}

/**
 * Update role-play session with conversation transcript
 */
export async function updateRolePlaySession(
  sessionId: string,
  messages: Message[],
  isCompleted: boolean = false
): Promise<{ data: any; error: any }> {
  const updateData: any = {
    conversation_transcript: messages,
    message_count: messages.length,
  };

  if (isCompleted) {
    updateData.completed_at = new Date().toISOString();
    
    // Calculate duration if we have timestamps
    if (messages.length >= 2) {
      const startTime = new Date(messages[0].timestamp).getTime();
      const endTime = new Date(messages[messages.length - 1].timestamp).getTime();
      updateData.duration_seconds = Math.floor((endTime - startTime) / 1000);
    }
  }

  const { data, error } = await supabaseAdmin
    .from('roleplay_sessions')
    .update(updateData)
    .eq('id', sessionId)
    .select()
    .single();

  return { data, error };
}

/**
 * Create a role-play assessment
 */
export async function createRolePlayAssessment(
  sessionId: string,
  employeeId: string,
  assessmentData: {
    overallScore: number;
    summary: string;
    parameters: Array<{ name: string; score: number; feedback: string }>;
    recommendations: string[];
  }
): Promise<{ data: any; error: any }> {
  const { data, error } = await supabaseAdmin
    .from('roleplay_assessments')
    .insert({
      session_id: sessionId,
      employee_id: employeeId,
      overall_score: assessmentData.overallScore,
      summary: assessmentData.summary,
      parameters: assessmentData.parameters,
      recommendations: assessmentData.recommendations,
    })
    .select()
    .single();

  return { data, error };
}

/**
 * Get all role-play sessions for an employee
 */
export async function getEmployeeRolePlaySessions(
  employeeId: string,
  limit: number = 10
): Promise<{ data: any[] | null; error: any }> {
  const { data, error } = await supabaseAdmin
    .from('roleplay_sessions')
    .select('*, roleplay_assessments(*)')
    .eq('employee_id', employeeId)
    .order('completed_at', { ascending: false, nullsFirst: false })
    .limit(limit);

  return { data, error };
}

/**
 * Get a specific session with its assessment
 */
export async function getRolePlaySessionWithAssessment(
  sessionId: string
): Promise<{ data: any; error: any }> {
  const { data, error } = await supabaseAdmin
    .from('roleplay_sessions')
    .select('*, roleplay_assessments(*)')
    .eq('id', sessionId)
    .single();

  return { data, error };
}

/**
 * Get employee's role-play statistics
 */
export async function getEmployeeRolePlayStats(
  employeeId: string
): Promise<{ data: any; error: any }> {
  const { data: sessions, error: sessionsError } = await supabaseAdmin
    .from('roleplay_sessions')
    .select('id, scenario_id, completed_at')
    .eq('employee_id', employeeId)
    .not('completed_at', 'is', null);

  if (sessionsError) return { data: null, error: sessionsError };

  const { data: assessments, error: assessmentsError } = await supabaseAdmin
    .from('roleplay_assessments')
    .select('overall_score, created_at')
    .eq('employee_id', employeeId);

  if (assessmentsError) return { data: null, error: assessmentsError };

  // Calculate statistics
  const stats = {
    total_sessions: sessions?.length || 0,
    completed_sessions: sessions?.filter((s: any) => s.completed_at).length || 0,
    average_score: assessments?.length 
      ? Math.round(assessments.reduce((sum: number, a: any) => sum + a.overall_score, 0) / assessments.length)
      : 0,
    best_score: assessments?.length 
      ? Math.max(...assessments.map((a: any) => a.overall_score))
      : 0,
    recent_sessions: sessions?.slice(0, 5) || [],
  };

  return { data: stats, error: null };
}

/**
 * Delete a role-play session (cascade deletes assessment)
 */
export async function deleteRolePlaySession(
  sessionId: string
): Promise<{ error: any }> {
  const { error } = await supabaseAdmin
    .from('roleplay_sessions')
    .delete()
    .eq('id', sessionId);

  return { error };
}
