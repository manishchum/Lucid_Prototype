/**
 * Roleplay Scenario API Utility
 * Interfaces with backend routes instead of direct Supabase calls
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

import { fetchWithAuth } from "@/lib/fetch-with-auth";
import { Message } from '@/lib/roleplay/types';

interface EvaluationParameter {
  name: string;
  description: string;
  weight: number;
}

interface ScenarioData {
  title: string;
  description?: string;
  learnerBrief: string;
  aiRole: string;
  aiPersonality?: string;
  aiObjectives?: string;
  endConditions?: string;
  maxDuration?: number;
  minTurns?: number;
  evaluationParameters: EvaluationParameter[];
  cutoffScore?: number;
  difficulty?: "Easy" | "Medium" | "Hard";
  tone?: "Friendly" | "Neutral" | "Aggressive";
  userRole: string;
  initialPrompt: string;
}

interface UserData {
  user_id: string;
  company_id: string;
}

/**
 * Fetch user data by email
 * @param email User email address
 * @returns User data (user_id and company_id)
 */
export async function fetchUserDataAPI(email: string): Promise<{ data: UserData | null; error: any }> {
  try {
    const response = await fetchWithAuth(
      `${API_BASE_URL}/api/roleplay/user-data/${encodeURIComponent(email)}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    const result = await response.json();

    if (!response.ok) {
      return { data: null, error: result.detail || "Failed to fetch user data" };
    }

    return { data: result.data, error: null };
  } catch (error) {
    console.error("Error fetching user data:", error);
    return { data: null, error };
  }
}

/**
 * Create a new custom scenario via backend API
 * @param scenario Scenario data to create
 * @param userId User ID
 * @param companyId Company ID
 * @returns Created scenario data or error
 */
export async function insertCustomScenarioAPI(
  scenario: ScenarioData,
  userId: string,
  companyId: string
): Promise<{ data: any; error: any }> {
  try {
    // Ensure evaluation parameters are plain objects
    const cleanScenario = {
      ...scenario,
      evaluationParameters: Array.isArray(scenario.evaluationParameters)
        ? scenario.evaluationParameters.map(param => ({
            name: param.name,
            description: param.description,
            weight: param.weight,
          }))
        : scenario.evaluationParameters,
    };

    const response = await fetchWithAuth(`${API_BASE_URL}/api/roleplay/scenarios`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-User-ID": userId,
        "X-Company-ID": companyId,
      },
      body: JSON.stringify(cleanScenario),
    });

    const result = await response.json();

    if (!response.ok) {
      return { data: null, error: result.detail || "Failed to create scenario" };
    }

    return { data: result.data, error: null };
  } catch (error) {
    console.error("Error creating scenario:", error);
    return { data: null, error };
  }
}

/**
 * Update an existing custom scenario via backend API
 * @param scenarioId Scenario ID to update
 * @param scenario Updated scenario data
 * @param userId User ID
 * @param companyId Company ID
 * @returns Updated scenario data or error
 */
export async function updateCustomScenarioAPI(
  scenarioId: string,
  scenario: Partial<ScenarioData>,
  userId: string,
  companyId: string
): Promise<{ data: any; error: any }> {
  try {
    // Ensure evaluation parameters are plain objects if they exist
    const cleanScenario = {
      ...scenario,
      ...(scenario.evaluationParameters && {
        evaluationParameters: Array.isArray(scenario.evaluationParameters)
          ? scenario.evaluationParameters.map(param => ({
              name: param.name,
              description: param.description,
              weight: param.weight,
            }))
          : scenario.evaluationParameters,
      }),
    };

    const response = await fetchWithAuth(`${API_BASE_URL}/api/roleplay/scenarios/${scenarioId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-User-ID": userId,
        "X-Company-ID": companyId,
      },
      body: JSON.stringify(cleanScenario),
    });

    const result = await response.json();

    if (!response.ok) {
      return { data: null, error: result.detail || "Failed to update scenario" };
    }

    return { data: result.data, error: null };
  } catch (error) {
    console.error("Error updating scenario:", error);
    return { data: null, error };
  }
}

/**
 * Delete a custom scenario via backend API
 * @param scenarioId Scenario ID to delete
 * @param userId User ID
 * @param companyId Company ID
 * @returns Success or error
 */
export async function deleteCustomScenarioAPI(
  scenarioId: string,
  userId: string,
  companyId: string
): Promise<{ success: boolean; error: any }> {
  try {
    const response = await fetchWithAuth(`${API_BASE_URL}/api/roleplay/scenarios/${scenarioId}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "X-User-ID": userId,
        "X-Company-ID": companyId,
      },
    });

    const result = await response.json();

    if (!response.ok) {
      return { success: false, error: result.detail || "Failed to delete scenario" };
    }

    return { success: true, error: null };
  } catch (error) {
    console.error("Error deleting scenario:", error);
    return { success: false, error };
  }
}

export async function createRolePlaySessionAPI(
  employeeId: string,
  scenarioId: string,
  scenarioTitle: string,
  scenarioRole: string,
  scenarioDifficulty: string,
  moduleId?: string
) {
  const response = await fetchWithAuth(
    `${API_BASE_URL}/api/roleplay/sessions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        employee_id: employeeId,
        scenario_id: scenarioId,
        scenario_title: scenarioTitle,
        scenario_role: scenarioRole,
        scenario_difficulty: scenarioDifficulty,
        module_id: moduleId,
      }),
    }
  );

  const result = await response.json();

  if (!response.ok) {
    return {
      data: null,
      error: result,
    };
  }

  return {
    data: result.data,
    error: null,
  };
}

export async function getEmployeeRolePlaySessions(
    employeeId: string,
    limit = 20
) {
    try {
        const response = await fetchWithAuth(
            `${API_BASE_URL}/api/roleplay/sessions/employee/${employeeId}?limit=${limit}`
        );

        const result = await response.json();

        if (!response.ok) {
            return {
                data: null,
                error: result.detail
            };
        }

        return {
            data: result.data,
            error: null
        };
    } catch (error) {
        return {
            data: null,
            error
        };
    }
}

export async function getEmployeeRolePlayStats(
    employeeId: string
) {
    try {

        const response = await fetchWithAuth(
            `${API_BASE_URL}/api/roleplay/stats/${employeeId}`
        );

        const result = await response.json();

        if (!response.ok) {
            return {
                data:null,
                error:result.detail
            };
        }

        return {
            data:result.data,
            error:null
        };

    } catch(error){

        return{
            data:null,
            error
        }

    }
}

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
  // console.log('[createRolePlayAssessment] Saving assessment:', {
  //   sessionId,
  //   employeeId,
  //   overallScore: assessmentData.overallScore,
  //   parametersCount: assessmentData.parameters.length
  // });

  try {
    const response = await fetchWithAuth(`${API_BASE_URL}/api/roleplay/assessments/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        session_id: sessionId,
        employee_id: employeeId,
        overallScore: assessmentData.overallScore,
        summary: assessmentData.summary,
        parameters: assessmentData.parameters,
        recommendations: assessmentData.recommendations
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('[createRolePlayAssessment] Error:', errorData.detail);
      return { data: null, error: errorData };
    }

    const result = await response.json();
    const data = result.data;
    console.log('[createRolePlayAssessment] Success:', { id: data?.id, score: data?.overall_score });
    return { data, error: null };
  } catch (error) {
    console.error('[createRolePlayAssessment] Network Error:', error);
    return { data: null, error };
  }
}

export async function updateRolePlaySession(
  sessionId: string,
  messages: Message[],
  isCompleted: boolean = false
): Promise<{ data: any; error: any }> {
  console.log('[updateRolePlaySession] Saving session:', {
    sessionId,
    messagesCount: messages.length,
    isCompleted,
    messagePreview: messages.slice(0, 2).map(m => `${m.sender}: ${m.text.substring(0, 30)}...`)
  });

  try {
    const response = await fetchWithAuth(`${API_BASE_URL}/api/roleplay/sessions/${sessionId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: messages,
        is_completed: isCompleted
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('[updateRolePlaySession] ❌ Error:', errorData.detail);
      return { data: null, error: errorData };
    }

    const result = await response.json();
    const data = result.data;
    console.log('[updateRolePlaySession] ✅ Success:', { 
      id: data?.id,
      savedMessageCount: data?.message_count,
      hasTranscript: !!data?.conversation_transcript
    });
    return { data, error: null };
  } catch (error) {
    console.error('[updateRolePlaySession] ❌ Network Error:', error);
    return { data: null, error };
  }
}

export async function fetchScenariosForUserAPI(
  userId: string,
  isAdmin: boolean
): Promise<{ data: Scenario[] | null; error: any }> {
  try {
    const response = await fetchWithAuth(`${API_BASE_URL}/api/roleplay/scenarios?is_admin=${isAdmin}`, {
      method: 'GET',
      headers: {
        'X-User-ID': userId,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      const errorData = await response.json();
      return {
        data: null,
        error: {
          code: 'API_ERROR',
          status: response.status,
          message: errorData.detail || 'Failed to fetch scenarios',
        },
      };
    }

    const result: FetchScenariosResponse = await response.json();
    
    if (!result.success) {
      return {
        data: null,
        error: {
          code: 'API_ERROR',
          message: result.error || 'Failed to fetch scenarios',
        },
      };
    }

    // console.log('API fetchScenariosForUserAPI result:', result.data);
    // console.log('API fetchScenariosForUserAPI raw response:', response);
    return {
      data: result.data,
      error: null,
    };
  } catch (error) {
    console.error('Error fetching scenarios:', error);
    return {
      data: null,
      error: {
        code: 'FETCH_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    };
  }
}

export async function assignScenarioAPI(
  scenarioId: string,
  assignmentType: 'function' | 'sub_function' | 'user',
  targetIds: string[],
  companyId: string,
  userId: string
): Promise<{ data: any; error: any }> {
  try {
    if (!targetIds || targetIds.length === 0) {
      return {
        data: null,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'No targets provided',
        },
      };
    }

    const response = await fetchWithAuth(`${API_BASE_URL}/api/roleplay/scenarios/${scenarioId}/assignments`, {
      method: 'POST',
      headers: {
        'X-User-ID': userId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        assignment_type: assignmentType,
        target_ids: targetIds,
      }),
      cache: 'no-store',
    });

    if (!response.ok) {
      const errorData = await response.json();
      return {
        data: null,
        error: {
          code: 'API_ERROR',
          status: response.status,
          message: errorData.detail || 'Failed to assign scenario',
        },
      };
    }

    const result: AssignScenarioResponse = await response.json();
    
    if (!result.success) {
      return {
        data: null,
        error: {
          code: 'API_ERROR',
          message: result.error || 'Failed to assign scenario',
        },
      };
    }

    return {
      data: result.data,
      error: null,
    };
  } catch (error) {
    console.error('Error assigning scenario:', error);
    return {
      data: null,
      error: {
        code: 'FETCH_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    };
  }
}