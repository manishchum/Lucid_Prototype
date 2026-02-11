export interface EvaluationParameter {
  name: string;
  description: string;
  weight: number;
}

export interface Scenario {
  scenario_id: string;
  title: string;
  description: string;
  initialPrompt: string;
  role: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  userRole?: string;
  tone?: 'Friendly' | 'Neutral' | 'Aggressive';
  learnerBrief?: string;
  aiPersonality?: string;
  aiObjectives?: string;
  maxDuration?: number;
  minTurns?: number;
  endConditions?: string;
  evaluationParams?: EvaluationParameter[];
  passingScore?: number;
  isCustom?: boolean; // Flag to indicate if this is a custom scenario from DB
}

export interface AssessmentParameter {
  name: string;
  score: number;
  feedback: string;
}

export interface AssessmentReport {
  overallScore: number;
  summary: string;
  parameters: AssessmentParameter[];
  recommendations: string[];
}

export interface Message {
  text: string;
  sender: 'user' | 'avatar';
  timestamp: string;
}

export type AppScreen = 'scenarioSelection' | 'config' | 'rolePlay' | 'assessmentReport';
