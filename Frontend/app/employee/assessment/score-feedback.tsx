// ScoreFeedbackCard: Shows score and GPT feedback for assessment
"use client";


import React from "react";
import AIFeedbackSections  from "./ai-feedback-sections";

interface ScoreFeedbackCardProps {
  score: number;
  maxScore: number;
  feedback: string;
}

const ScoreFeedbackCard: React.FC<ScoreFeedbackCardProps> = ({ score, maxScore, feedback }) => {
  return (
    <div className="border rounded-lg p-8 bg-white shadow-lg space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold mb-2 text-gray-800">Assessment Results</h2>
          <p className="text-xl text-gray-600">Score: <span className="font-semibold text-gray-800">{score} / {maxScore}</span></p>
        </div>
        <div className="bg-blue-100 text-blue-700 px-6 py-3 rounded-lg font-bold text-2xl shadow-sm">
          {Math.round((score / maxScore) * 100)}%
        </div>
      </div>
      <div className="space-y-6">
        <h3 className="text-xl font-semibold text-gray-800 border-b border-gray-200 pb-2">AI Feedback Summary</h3>
        <AIFeedbackSections feedback={feedback} />
      </div>
    </div>
  );
};

export default ScoreFeedbackCard;
