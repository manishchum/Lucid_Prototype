/**
 * Roleplay Scenario API Utility
 * Interfaces with backend routes instead of direct Supabase calls
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";

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
    const response = await fetch(
      `${API_BASE_URL}/roleplay/scenarios/user-data/${encodeURIComponent(email)}`,
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

    const response = await fetch(`${API_BASE_URL}/roleplay/scenarios/create`, {
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

    const response = await fetch(`${API_BASE_URL}/roleplay/scenarios/${scenarioId}`, {
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
    const response = await fetch(`${API_BASE_URL}/roleplay/scenarios/${scenarioId}`, {
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
