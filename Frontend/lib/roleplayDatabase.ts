// --- Custom Scenario DB Functions ---
import { Scenario } from './roleplay/types';
import { SCENARIOS } from './roleplay/constants';
import { supabase } from './supabase';

/**
 * Insert a new scenario into the public scenario table
 */
export async function insertCustomScenario(scenario: Scenario, companyId:string) {
  // Persist the custom scenario into Supabase `scenarios` table.
  // Map the in-memory Scenario shape to the DB schema. The DB schema uses array columns for
  // several fields (text[] / jsonb[] / bigint[]). For compatibility we wrap scalar values
  // into single-element arrays where appropriate.
  try {
    console.log('Inserting scenario for company ID:', companyId);
    const payload: any = {
      title: scenario.title || null,
      description: scenario.description || null,
      userRole: scenario.userRole || null,
      difficulty: scenario.difficulty || null,
      role: scenario.role || null,
      initialPrompt: scenario.initialPrompt || null,
      tone: scenario.tone || null,
      learnerBrief: scenario.learnerBrief || null,
      // instructionsForLearner not present on the UI model yet
      // instructionsForLearner: scenario.learnerBrief || null,
      company_id: companyId || null,
      // normalize optional fields into arrays expected by the DB schema
      // aiPersonality: scenario.aiPersonality ? [scenario.aiPersonality] : null,
      aiObjective: scenario.aiObjectives ? [scenario.aiObjectives] : null,
      maxDuration: typeof scenario.maxDuration === 'number' ? [scenario.maxDuration] : null,
      minTurns: typeof scenario.minTurns === 'number' ? [scenario.minTurns] : null,
      endConditions: scenario.endConditions ? [scenario.endConditions] : null,
      evaluationParams: scenario.evaluationParams && scenario.evaluationParams.length ? scenario.evaluationParams : null,
      passingScore: typeof scenario.passingScore === 'number' ? [scenario.passingScore] : null,
    };

    console.log('Inserting custom scenario:', payload);
    const { data, error } = await supabase
      .from('scenarios')
      .insert(payload)
      .select()
      .single();

    return { data, error };
  } catch (error) {
    return { data: null, error };
  }
}

export async function fetchAssignedScenarioIdsForUser(userId: string): Promise<{ data: string[] | null; error: any }> 
{
  try {
    const { data, error } = await supabase
      .from('scenario_assignments')
      .select('scenario_id')
      .eq('user_id', userId)

    if (error) {
      return { data: null, error };
    }
    const scenarioIds = data ? data.map(item => item.scenario_id) : [];
    return { data: scenarioIds, error: null };
  } catch (error) {
    return { data: null, error };
  }
}

/**
 * Fetch all scenarios (default + custom from database)
 */
export async function fetchAllScenarios(): Promise<{ data: Scenario[] | null; error: any }> {
  try {
    // Fetch custom scenarios from database
    const { data: dbScenarios, error: dbError } = await supabase
      .from('scenarios')
      .select('*')
      .order('created_at', { ascending: false });

    if (dbError) {
      console.error('Error fetching custom scenarios:', dbError);
      // Return default scenarios even if DB fetch fails
      return { data: SCENARIOS, error: null };
    }

    // Map database scenarios to Scenario type
    const customScenarios: Scenario[] = (dbScenarios || []).map((dbScenario: any) => {
      // Normalize difficulty to ensure proper capitalization
      let difficulty = dbScenario.difficulty || 'Medium';
      const difficultyLower = difficulty.toLowerCase();
      if (difficultyLower === 'easy') difficulty = 'Easy';
      else if (difficultyLower === 'medium') difficulty = 'Medium';
      else if (difficultyLower === 'hard') difficulty = 'Hard';
      
      return {
        scenario_id: dbScenario.scenario_id,
        title: dbScenario.title || '',
        description: dbScenario.description || '',
        role: dbScenario.role || '',
        difficulty: difficulty,
        initialPrompt: dbScenario.initialPrompt || '',
        userRole: dbScenario.userRole || '',
        tone: dbScenario.tone || 'Neutral',
        learnerBrief: dbScenario.learnerBrief || '',
        // aiPersonality: Array.isArray(dbScenario.aiPersonality) ? dbScenario.aiPersonality[0] : dbScenario.aiPersonality,
        aiObjectives: Array.isArray(dbScenario.aiObjective) ? dbScenario.aiObjective[0] : dbScenario.aiObjective,
        maxDuration: Array.isArray(dbScenario.maxDuration) ? dbScenario.maxDuration[0] : dbScenario.maxDuration,
        minTurns: Array.isArray(dbScenario.minTurns) ? dbScenario.minTurns[0] : dbScenario.minTurns,
        endConditions: Array.isArray(dbScenario.endConditions) ? dbScenario.endConditions[0] : dbScenario.endConditions,
        evaluationParams: Array.isArray(dbScenario.evaluationParams) ? dbScenario.evaluationParams : dbScenario.evaluationParams,
        passingScore: Array.isArray(dbScenario.passingScore) ? dbScenario.passingScore[0] : dbScenario.passingScore,
        isCustom: true, // Mark as custom so we know it can be edited
      };
    });

    // Remove duplicates from customScenarios based on title (case-insensitive)
    const seenTitles = new Map<string, Scenario>();
    const uniqueCustomScenarios: Scenario[] = [];
    
    for (const scenario of customScenarios) {
      const normalizedTitle = scenario.title.toLowerCase().trim();
      if (!seenTitles.has(normalizedTitle)) {
        seenTitles.set(normalizedTitle, scenario);
        uniqueCustomScenarios.push(scenario);
      }
    }

    // Create a Set of custom scenario titles to check for duplicates with default scenarios
    const customTitles = new Set(uniqueCustomScenarios.map(s => s.title.toLowerCase().trim()));
    
    console.log('🔍 Custom Titles:', Array.from(customTitles));
    console.log('🔍 Default Scenarios Before Filter:', SCENARIOS.map(s => s.title));
    
    // Filter out default scenarios that have the same title as custom ones
    const uniqueDefaultScenarios = SCENARIOS.filter(
      defaultScenario => !customTitles.has(defaultScenario.title.toLowerCase().trim())
    );
    
    console.log('🔍 Default Scenarios After Filter:', uniqueDefaultScenarios.map(s => s.title));

    // Combine filtered default scenarios with unique custom ones (custom first so they appear at top)
    const allScenarios = [...uniqueCustomScenarios, ...uniqueDefaultScenarios];
    
    // Sort scenarios by difficulty: Easy -> Medium -> Hard
    const difficultyOrder: { [key: string]: number } = { 'Easy': 1, 'Medium': 2, 'Hard': 3 };
    allScenarios.sort((a, b) => {
      const orderA = difficultyOrder[a.difficulty] || 2;
      const orderB = difficultyOrder[b.difficulty] || 2;
      return orderA - orderB;
    });
    
    // Debug: Log sorted scenarios
    console.log('🎭 Sorted Scenarios:', allScenarios.map(s => ({ 
      title: s.title, 
      difficulty: s.difficulty,
      order: difficultyOrder[s.difficulty] || 2
    })));
    
    return { data: allScenarios, error: null };
  } catch (error) {
    console.error('Exception fetching scenarios:', error);
    return { data: SCENARIOS, error };
  }
}

/**
 * Fetch scenarios for a specific user (filtered by assignments)
 * Admins see all scenarios, regular users only see assigned scenarios
 */
export async function fetchScenariosForUser(userId: string, isAdmin: boolean): Promise<{ data: Scenario[] | null; error: any }> {
  try {
    // Admin users see all scenarios
    if (isAdmin) {
      console.log("He is admin");
      return await fetchAllScenarios();
    }

    // Get scenarios assigned to this user
    const { data: assignedScenarioIds, error: assignError } = await getAssignedScenariosForUser(userId);
    console.log("Scenarios Ids",assignedScenarioIds);
    console.log(userId);
    if (assignError) {
      console.error('Error fetching assigned scenarios:', assignError);
      return { data: SCENARIOS, error: null };
    }else if(assignedScenarioIds){


      const { data: assignedScenarios, error: scenError } = await supabase
      .from('scenarios')
      .select('*')
      .in('scenario_id', assignedScenarioIds)
      .order('created_at', { ascending: false });
      if (scenError) {
        console.error('Error fetching assigned scenarios details:', scenError);
        return { data: SCENARIOS, error: null };
      }

      // Map database scenarios to proper Scenario type with scenario_id
      const mappedScenarios: Scenario[] = (assignedScenarios || []).map((dbScenario: any) => {
        let difficulty = dbScenario.difficulty || 'Medium';
        const difficultyLower = difficulty.toLowerCase();
        if (difficultyLower === 'easy') difficulty = 'Easy';
        else if (difficultyLower === 'medium') difficulty = 'Medium';
        else if (difficultyLower === 'hard') difficulty = 'Hard';
        
        return {
          scenario_id: dbScenario.scenario_id,
          title: dbScenario.title || '',
          description: dbScenario.description || '',
          role: dbScenario.role || '',
          difficulty: difficulty,
          initialPrompt: dbScenario.initialPrompt || '',
          userRole: dbScenario.userRole || '',
          tone: dbScenario.tone || 'Neutral',
          learnerBrief: dbScenario.learnerBrief || '',
          aiObjectives: Array.isArray(dbScenario.aiObjective) ? dbScenario.aiObjective[0] : dbScenario.aiObjective,
          maxDuration: Array.isArray(dbScenario.maxDuration) ? dbScenario.maxDuration[0] : dbScenario.maxDuration,
          minTurns: Array.isArray(dbScenario.minTurns) ? dbScenario.minTurns[0] : dbScenario.minTurns,
          endConditions: Array.isArray(dbScenario.endConditions) ? dbScenario.endConditions[0] : dbScenario.endConditions,
          evaluationParams: Array.isArray(dbScenario.evaluationParams) ? dbScenario.evaluationParams : dbScenario.evaluationParams,
          passingScore: Array.isArray(dbScenario.passingScore) ? dbScenario.passingScore[0] : dbScenario.passingScore,
          isCustom: true,
        };
      });

      console.log("Assigned Scenarios for the user are ",mappedScenarios);
      console.log("Assigned Scenario Ids for the user are ",assignedScenarioIds);
      return { data: mappedScenarios, error: null };
    
    }

    // Fetch all scenarios first
    const { data: allScenarios, error: scenError } = await fetchAllScenarios();
    
    if (scenError || !allScenarios) {
      return { data: SCENARIOS, error: scenError };
    }

    // If no assignments, show only default scenarios
    if (!assignedScenarioIds || assignedScenarioIds.length === 0) {
      return { data: SCENARIOS, error: null };
    }

    // Filter scenarios to only show assigned ones + default scenarios
    const filteredScenarios = allScenarios.filter(scenario => {
      // Always show default scenarios (no isCustom flag)
      if (!scenario.isCustom) return true;
      // Show custom scenarios only if assigned
      return (assignedScenarioIds as string[]).includes(scenario.scenario_id);
    });

    return { data: filteredScenarios, error: null };
  } catch (error) {
    console.error('Exception fetching scenarios for user:', error);
    return { data: SCENARIOS, error };
  }
}

/**
 * Update an existing custom scenario in the database
 */
export async function updateCustomScenario(scenarioId: string, scenario: Scenario) {
  try {
    const payload: any = {
      title: scenario.title || null,
      description: scenario.description || null,
      userRole: scenario.userRole || null,
      difficulty: scenario.difficulty || null,
      role: scenario.role || null,
      initialPrompt: scenario.initialPrompt || null,
      // tone: scenario.tone || null,
      learnerBrief: scenario.learnerBrief || null,
      // instructionsForLearner: null,
      // aiPersonality: scenario.aiPersonality ? [scenario.aiPersonality] : null,
      aiObjective: scenario.aiObjectives ? [scenario.aiObjectives] : null,
      maxDuration: typeof scenario.maxDuration === 'number' ? [scenario.maxDuration] : null,
      minTurns: typeof scenario.minTurns === 'number' ? [scenario.minTurns] : null,
      endConditions: scenario.endConditions ? [scenario.endConditions] : null,
      evaluationParams: scenario.evaluationParams && scenario.evaluationParams.length ? scenario.evaluationParams : null,
      passingScore: typeof scenario.passingScore === 'number' ? [scenario.passingScore] : null,
    };

    console.log('Updating scenario:', scenarioId, payload);
    const { data, error } = await supabase
      .from('scenarios')
      .update(payload)
      .eq('scenario_id', scenarioId)
      .select()
      .single();

    return { data, error };
  } catch (error) {
    return { data: null, error };
  }
}

/**
 * Delete a custom scenario from the database
 */
export async function deleteCustomScenario(scenarioId: string) {
  try {
    console.log('Deleting scenario:', scenarioId);
    const { error } = await supabase
      .from('scenarios')
      .delete()
      .eq('scenario_id', scenarioId);

    return { error };
  } catch (error) {
    return { error };
  }
}

/**
 * Assign a scenario to departments, sub-departments, or users
 */
export async function assignScenario(
  scenarioId: string,
  assignmentType: 'department' | 'sub_department' | 'user',
  targetIds: string[],
  companyId: string
) {
  try {
    const assignments = targetIds.map(targetId => ({
      scenario_id: scenarioId,
      assignment_type: assignmentType,
      user_id: targetId,
      company_id: companyId,
      assigned_at: new Date().toISOString(),
    }));

    const { data, error } = await supabase
      .from('scenario_assignments')
      .upsert(assignments, {
        onConflict: 'scenario_id,assignment_type,department_id',
        ignoreDuplicates: false
      })
      .select();

    return { data, error };
  } catch (error) {
    return { data: null, error };
  }
}

/**
 * Get assignments for a specific scenario
 */
export async function getScenarioAssignments(scenarioId: string) {
  try {
    const { data, error } = await supabase
      .from('scenario_assignments')
      .select('*')
      .eq('scenario_id', scenarioId);

    return { data, error };
  } catch (error) {
    return { data: null, error };
  }
}

/**
 * Remove scenario assignments
 */
export async function removeScenarioAssignments(assignmentIds: string[]) {
  try {
    const { error } = await supabase
      .from('scenario_assignments')
      .delete()
      .in('assignment_id', assignmentIds);

    return { error };
  } catch (error) {
    return { error };
  }
}

/**
 * Get scenarios assigned to a specific user
 * Checks user's direct assignments and department assignments
 */
export async function getAssignedScenariosForUser(userId: string) {
  try {
    // Get user's department_id
    console.log("Inside fetching scenarios id for the user",userId);
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('department_id')
      .eq('user_id', userId)
      .single();


      const {data:role_ids, error: roleErrors} = await supabase
      .from('user_role_assignments')
      .select('role_id')
      .eq('user_id', userId)
      
      if(roleErrors){
        console.error('Error fetching user roles:', roleErrors);
        return { data: [], error: roleErrors };
      }
      if(role_ids && role_ids.length >1){
        console.log("User has multiple roles assigned");
        console.log("He is admin");
        const {data:allScenarios, error: scenError} = await supabase  
        .from('scenarios')
        .select('scenario_id')
        .order('created_at', { ascending: false })
        ;
        return allScenarios;
      
      }


    if (userError) {
      console.error('Error fetching user data:', userError);
      return { data: [], error: userError };
    }

    // Build OR condition for assignments
    let orCondition = `user_id.eq.${userId}`;
    if (userData.department_id) {
      orCondition += `,department_id.eq.${userData.department_id}`;
    }

    // Get all assignments for this user (direct or department)
    const { data: assignments, error: assignError } = await supabase
      .from('scenario_assignments')
      .select('scenario_id')
      .eq('user_id', userId)
      // .or(orCondition);

      // if()
    if (assignError) {
      const {data:assignments, error: assignError} = await supabase
      .from('scenario_assignments')
      .select('scenario_id')
      .eq('department_id', userData.department_id);
      
      
      
      if (assignError) {
        console.log("No Modules found for the user");
      return { data: [], error: assignError };}



    const scenarioIds = [...new Set(assignments?.map((a: any) => a.scenario_id) || [])];
    return { data: scenarioIds, error: null };
    }

    // Extract unique scenario IDs
    const scenarioIds = [...new Set(assignments?.map((a: any) => a.scenario_id) || [])];
    
    return { data: scenarioIds, error: null };
  } catch (error) {
    console.error('Exception in getAssignedScenariosForUser:', error);
    return { data: [], error };
  }
}

// Helper functions for role-play session database operations
import { Message } from './roleplay/types';
import { callGemini } from './gemini-helper';

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


  console.log("This is creating roleplay session")
  console.log("Scenario Id",scenarioId);
  const { data, error } = await supabase
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

  const { data, error } = await supabase
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


  console.log("This is saving the assessment")
  console.log("This is the session id",sessionId);
  const { data, error } = await supabase
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
  const { data, error } = await supabase
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
  const { data, error } = await supabase
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
  const { data: sessions, error: sessionsError } = await supabase
    .from('roleplay_sessions')
    .select('id, scenario_id, completed_at')
    .eq('employee_id', employeeId)
    .not('completed_at', 'is', null);

  if (sessionsError) return { data: null, error: sessionsError };

  const { data: assessments, error: assessmentsError } = await supabase
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
  const { error } = await supabase
    .from('roleplay_sessions')
    .delete()
    .eq('id', sessionId);

  return { error };
}
