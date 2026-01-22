export interface Scenario {
  id: string;
  title: string;
  description: string;
  initialPrompt: string;
  role: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  userRole?: string;
  tone?: 'Friendly' | 'Neutral' | 'Aggressive';
  learnerBrief?: string;
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
