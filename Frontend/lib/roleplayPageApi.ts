/**
 * Frontend API utility layer for roleplay page operations
 * Handles all backend API calls for scenario fetching, deletion, and assignment
 * This replaces direct Supabase calls with secure backend proxy
 */

import { callGemini } from './gemini-helper';
import { Scenario } from './roleplay/types';

const API_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

interface FetchScenariosResponse {
  success: boolean;
  data: Scenario[];
  error?: string;
}

interface DeleteScenarioResponse {
  success: boolean;
  message: string;
  error?: string;
}

interface AssignScenarioResponse {
  success: boolean;
  data: any[];
  message: string;
  error?: string;
}

interface GetAssignmentsResponse {
  success: boolean;
  data: any[];
  error?: string;
}

/**
 * Fetch scenarios for a user
 * Admins see all scenarios, regular users see only assigned scenarios
 * 
 * @param userId - User ID from auth
 * @param isAdmin - Whether user has admin role
 * @returns Promise with scenarios array
 */
export async function fetchScenariosForUserAPI(
  userId: string,
  isAdmin: boolean
): Promise<{ data: Scenario[] | null; error: any }> {
  try {
    const response = await fetch(`${API_URL}/api/roleplay/page/scenarios?is_admin=${isAdmin}`, {
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

    console.log('API fetchScenariosForUserAPI result:', result.data);
    console.log('API fetchScenariosForUserAPI raw response:', response);
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

/**
 * Delete a custom scenario
 * 
 * @param scenarioId - ID of scenario to delete
 * @param userId - User ID (for authentication)
 * @param companyId - Company ID (for authorization)
 * @returns Promise with deletion result
 */
export async function deleteCustomScenarioAPI(
  scenarioId: string,
  userId: string,
  companyId: string
): Promise<{ error: any }> {
  try {
    const response = await fetch(`${API_URL}/api/roleplay/page/scenarios/${scenarioId}`, {
      method: 'DELETE',
      headers: {
        'X-User-ID': userId,
        'X-Company-ID': companyId,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      const errorData = await response.json();
      return {
        error: {
          code: 'API_ERROR',
          status: response.status,
          message: errorData.detail || 'Failed to delete scenario',
        },
      };
    }

    const result: DeleteScenarioResponse = await response.json();
    
    if (!result.success) {
      return {
        error: {
          code: 'API_ERROR',
          message: result.error || 'Failed to delete scenario',
        },
      };
    }

    return { error: null };
  } catch (error) {
    console.error('Error deleting scenario:', error);
    return {
      error: {
        code: 'FETCH_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    };
  }
}

/**
 * Assign a scenario to departments, sub-departments, or users
 * 
 * @param scenarioId - ID of scenario to assign
 * @param assignmentType - Type of target ('user', 'department', 'sub_department')
 * @param targetIds - IDs of targets to assign to
 * @param companyId - Company ID
 * @param userId - User ID (for authentication)
 * @returns Promise with assignment result
 */
export async function assignScenarioAPI(
  scenarioId: string,
  assignmentType: 'department' | 'sub_department' | 'user',
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

    const response = await fetch(`${API_URL}/api/roleplay/page/scenarios/assign`, {
      method: 'POST',
      headers: {
        'X-User-ID': userId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        scenario_id: scenarioId,
        assignment_type: assignmentType,
        target_ids: targetIds,
        company_id: companyId,
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

/**
 * Get all assignments for a scenario
 * 
 * @param scenarioId - ID of scenario
 * @param userId - User ID (for authentication)
 * @returns Promise with assignments
 */
export async function getScenarioAssignmentsAPI(
  scenarioId: string,
  userId: string
): Promise<{ data: any; error: any }> {
  try {
    const response = await fetch(
      `${API_URL}/api/roleplay/page/scenarios/assignments/${scenarioId}`,
      {
        method: 'GET',
        headers: {
          'X-User-ID': userId,
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      return {
        data: null,
        error: {
          code: 'API_ERROR',
          status: response.status,
          message: errorData.detail || 'Failed to fetch assignments',
        },
      };
    }

    const result: GetAssignmentsResponse = await response.json();
    
    if (!result.success) {
      return {
        data: null,
        error: {
          code: 'API_ERROR',
          message: result.error || 'Failed to fetch assignments',
        },
      };
    }

    return {
      data: result.data,
      error: null,
    };
  } catch (error) {
    console.error('Error fetching assignments:', error);
    return {
      data: null,
      error: {
        code: 'FETCH_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    };
  }
}
