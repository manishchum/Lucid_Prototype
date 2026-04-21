/**
 * Career Journey database operations
 * Handles CRUD operations for career journeys (admin and user views)
 */

import { CareerJourneyDB, CareerJourneyPayload } from '@/lib/types/career-journey';

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

/**
 * Create a new career journey as a draft
 * @param payload Career journey data
 * @param userId ID of the creating admin
 */
export async function createCareerJourney(
  payload: CareerJourneyPayload,
  userId: string
): Promise<{ data: CareerJourneyDB | null; error: string | null }> {
  try {
    const response = await fetch(`${API_BASE}/api/career-journeys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-ID': userId,
      },
      body: JSON.stringify({
        ...payload,
        status: 'draft',
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    const result: ApiResponse<CareerJourneyDB> = await response.json();
    return { data: result.data || null, error: null };
  } catch (error: any) {
    console.error('Error creating career journey:', error);
    return { data: null, error: error.message || 'Failed to create career journey' };
  }
}

/**
 * Update an existing career journey draft
 * @param journeyId ID of the journey to update
 * @param payload Updated journey data
 * @param userId ID of the updating admin
 */
export async function updateCareerJourney(
  journeyId: string,
  payload: CareerJourneyPayload,
  userId: string
): Promise<{ data: CareerJourneyDB | null; error: string | null }> {
  try {
    const response = await fetch(`${API_BASE}/api/career-journeys/${journeyId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-User-ID': userId,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    const result: ApiResponse<CareerJourneyDB> = await response.json();
    return { data: result.data || null, error: null };
  } catch (error: any) {
    console.error('Error updating career journey:', error);
    return { data: null, error: error.message || 'Failed to update career journey' };
  }
}

/**
 * Get all draft career journeys (admin view)
 * @param userId ID of the requesting admin (for permission check)
 */
export async function getDraftJourneys(
  userId: string
): Promise<{ data: CareerJourneyDB[]; error: string | null }> {
  try {
    const response = await fetch(`${API_BASE}/api/career-journeys?status=draft`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-User-ID': userId,
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    const result: ApiResponse<CareerJourneyDB[]> = await response.json();
    return { data: result.data || [], error: null };
  } catch (error: any) {
    console.error('Error fetching draft journeys:', error);
    return { data: [], error: error.message || 'Failed to fetch draft journeys' };
  }
}

/**
 * Get a single career journey by ID (for editing drafts)
 * @param journeyId ID of the journey
 * @param userId ID of the requesting admin
 */
export async function getCareerJourneyById(
  journeyId: string,
  userId: string
): Promise<{ data: CareerJourneyDB | null; error: string | null }> {
  try {
    const response = await fetch(`${API_BASE}/api/career-journeys/${journeyId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-User-ID': userId,
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    const result: ApiResponse<CareerJourneyDB> = await response.json();
    return { data: result.data || null, error: null };
  } catch (error: any) {
    console.error('Error fetching career journey:', error);
    return { data: null, error: error.message || 'Failed to fetch career journey' };
  }
}

/**
 * Publish a career journey (changes status from draft to published)
 * @param journeyId ID of the journey to publish
 * @param userId ID of the publishing admin
 */
export async function publishCareerJourney(
  journeyId: string,
  userId: string
): Promise<{ data: CareerJourneyDB | null; error: string | null }> {
  try {
    const response = await fetch(`${API_BASE}/api/career-journeys/${journeyId}/publish`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-User-ID': userId,
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    const result: ApiResponse<CareerJourneyDB> = await response.json();
    return { data: result.data || null, error: null };
  } catch (error: any) {
    console.error('Error publishing career journey:', error);
    return { data: null, error: error.message || 'Failed to publish career journey' };
  }
}

/**
 * Get all published career journeys (user view)
 */
export async function getPublishedJourneys(): Promise<{
  data: CareerJourneyDB[];
  error: string | null;
}> {
  try {
    const response = await fetch(`${API_BASE}/api/career-journeys?status=published`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    const result: ApiResponse<CareerJourneyDB[]> = await response.json();
    return { data: result.data || [], error: null };
  } catch (error: any) {
    console.error('Error fetching published journeys:', error);
    return { data: [], error: error.message || 'Failed to fetch published journeys' };
  }
}

/**
 * Delete a career journey draft
 * @param journeyId ID of the journey to delete
 * @param userId ID of the requesting admin
 */
export async function deleteCareerJourney(
  journeyId: string,
  userId: string
): Promise<{ success: boolean; error: string | null }> {
  try {
    const response = await fetch(`${API_BASE}/api/career-journeys/${journeyId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'X-User-ID': userId,
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    return { success: true, error: null };
  } catch (error: any) {
    console.error('Error deleting career journey:', error);
    return { success: false, error: error.message || 'Failed to delete career journey' };
  }
}
