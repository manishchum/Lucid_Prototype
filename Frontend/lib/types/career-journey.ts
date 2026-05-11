/**
 * Core Career Journey type representing a learning path
 */
export interface CareerJourney {
  id?: string;
  title: string;
  description: string;
  skills: SkillNode[];
  connections: SkillConnection[];
  thumbnail?: string;
  category?: string;
  tags?: string[];
}

/**
 * Individual skill in the journey
 */
export interface SkillNode {
  id: string;
  title: string;
  description: string;
  level: 'beginner' | 'intermediate' | 'advanced';
  moduleId?: string; // Reference to training module if available
  estimatedHours?: number;
  timeUnit?: 'days' | 'hours' | 'weeks' | 'months'; // Unit for the estimated time
  resources?: string[];
}

/**
 * Connection between two skills (prerequisite/dependency)
 */
export interface SkillConnection {
  from: string; // source skill id
  to: string;   // target skill id
  type: 'prerequisite' | 'recommended';
}

/**
 * Career Journey stored in database with metadata
 */
export interface CareerJourneyDB extends CareerJourney {
  status: 'draft' | 'published';
  createdBy: string; // user_id of creator
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}

/**
 * Request payload for creating/updating a career journey
 */
export interface CareerJourneyPayload {
  title: string;
  description: string;
  skills: SkillNode[];
  connections: SkillConnection[];
  thumbnail?: string;
  category?: string;
  tags?: string[];
}
