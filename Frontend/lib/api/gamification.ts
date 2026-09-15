import { fetchWithAuth } from "@/lib/fetch-with-auth";

// Get base URL for backend API
const API_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

export interface Drill {
  drill_id: string;
  sprint_id: string;
  format_type: 'FILL_BLANKS' | 'VIBE_CHECK' | 'RISK_RIZZ' | 'CODE_BREAKER' | 'FLOW_MASTER' | 'AUDIT_SPOTTER' | 'SPEED_RUN';
  title: string;
  base_xp: number;
  order_index: number;
  content_payload: any;
}

export interface Sprint {
  sprint_id: string;
  module_id: string;
  sprint_number: number;
  title: string;
  description: string;
  is_active: boolean;
  gamification_drills: Drill[];
}

export interface DrillProgressPayload {
  sprint_id: string;
  drill_id: string;
  completed: boolean;
  wrong_attempts: number;
  completion_time_seconds: number;
}

/**
 * Fetches all active gamification sprints for a given training module.
 * Sprints include embedded gamification_drills array.
 */
export async function fetchAssignedSprints(): Promise<Sprint[]> {
  try {
    const response = await fetchWithAuth(`${API_URL}/api/gamification/sprints`);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    return data?.data || [];
  } catch (error) {
    console.error("Failed to fetch gamification sprints:", error);
    throw error;
  }
}

/**
 * Submits the user's progress for a specific drill.
 * The backend computes the dynamic XP using the streak and mistake count.
 */
export async function submitDrillProgress(payload: DrillProgressPayload) {
  try {
    const response = await fetchWithAuth(`${API_URL}/api/gamification/progress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    return data?.data;
  } catch (error) {
    console.error("Failed to submit drill progress:", error);
    throw error;
  }
}

/**
 * Fetches the company leaderboard for the current user's company.
 */
export async function fetchLeaderboard() {
  try {
    const response = await fetchWithAuth(`${API_URL}/api/gamification/leaderboard`);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    return data?.data || [];
  } catch (error) {
    console.error("Failed to fetch leaderboard:", error);
    throw error;
  }
}

/**
 * Fetches the user's gamification profile (total XP, streak, etc).
 */
export async function fetchUserProfile() {
  try {
    const response = await fetchWithAuth(`${API_URL}/api/gamification/profile`);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    return data?.data || null;
  } catch (error) {
    console.error("Failed to fetch user profile:", error);
    throw error;
  }
}

