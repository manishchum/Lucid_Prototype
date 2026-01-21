
export interface Scenario {
  id: string;
  title: string;
  description: string;
  initialPrompt: string; // The initial message to start the role-play
  role: string; // e.g., "Customer", "Stakeholder"
  difficulty: 'Easy' | 'Medium' | 'Hard';
}

export interface AssessmentParameter {
  name: string;
  score: number; // 0-100
  feedback: string;
}

export interface AssessmentReport {
  overallScore: number; // 0-100
  summary: string;
  parameters: AssessmentParameter[];
  recommendations: string[];
}

export interface Message {
  text: string;
  sender: 'user' | 'avatar';
  timestamp: string;
}

export type AppScreen = 'scenarioSelection' | 'rolePlay' | 'assessmentReport';
