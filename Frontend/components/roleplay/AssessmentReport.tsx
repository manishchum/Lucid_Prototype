"use client";

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CheckCircle, TrendingUp, Target, Lightbulb } from 'lucide-react';

interface AssessmentParameter {
  name: string;
  score: number;
  feedback: string;
}

interface AssessmentReport {
  overallScore: number;
  summary: string;
  parameters: AssessmentParameter[];
  recommendations: string[];
}

interface AssessmentReportProps {
  report: AssessmentReport;
  scenarioTitle: string;
  passingScore?: number;
  onStartNew: () => void;
}

export default function AssessmentReportComponent({ report, scenarioTitle, passingScore = 60, onStartNew }: AssessmentReportProps) {
  const getScoreColor = (score: number) => {
    return score >= passingScore ? 'text-green-600 bg-green-100' : 'text-red-600 bg-red-100';
  };

  const getScoreBadge = (score: number) => {
    return score >= passingScore
      ? { label: 'Passed', color: 'bg-green-500' }
      : { label: 'Needs Improvement', color: 'bg-red-500' };
  };

  const badge = getScoreBadge(report.overallScore);

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="bg-gradient-to-r from-purple-600 to-blue-600 text-white p-8">
        <div className="text-center">
          <CheckCircle className="w-16 h-16 mx-auto mb-4" />
          <h2 className="text-3xl font-bold mb-2">Session Complete!</h2>
          <p className="text-purple-100">Here's your performance assessment for:</p>
          <p className="text-xl font-semibold mt-1">{scenarioTitle}</p>
        </div>
      </Card>

      {/* Overall Score */}
      <Card className="p-8 text-center">
        <h3 className="text-lg font-semibold text-slate-700 mb-6">Overall Performance</h3>
        <div className="flex flex-col items-center justify-center space-y-4 max-w-xl mx-auto">
          <div className={`w-32 h-32 rounded-full flex items-center justify-center ${getScoreColor(report.overallScore)}`}>
            <span className="text-4xl font-bold">{report.overallScore}</span>
          </div>
          <div className={`inline-block px-4 py-2 rounded-full text-white font-semibold ${badge.color}`}>
            {badge.label}
          </div>
          <p className="text-slate-600 text-justify text-sm leading-relaxed w-full mt-2">{report.summary}</p>
        </div>
      </Card>

      {/* Performance Parameters */}
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <Target className="w-5 h-5 text-blue-600" />
          <h3 className="text-lg font-semibold text-slate-800">Performance Breakdown</h3>
        </div>
        <div className="space-y-4">
          {report.parameters
            .map((param, index) => (
            <div key={index} className="border-b border-slate-200 pb-4 last:border-0">
              <div className="flex justify-between items-center mb-2">
                <span className="font-semibold text-slate-700">{param.name}</span>
                <span className={`px-3 py-1 rounded-full font-bold ${getScoreColor(param.score)}`}>
                  {param.score}/100
                </span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-2 mb-2">
                <div
                  className={`h-2 rounded-full transition-all ${
                    param.score >= passingScore ? 'bg-green-500' : 'bg-red-500'
                  }`}
                  style={{ width: `${param.score}%` }}
                />
              </div>
              <p className="text-sm text-slate-600">{param.feedback}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* Recommendations */}
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <Lightbulb className="w-5 h-5 text-yellow-600" />
          <h3 className="text-lg font-semibold text-slate-800">Recommendations for Improvement</h3>
        </div>
        <ul className="space-y-3">
          {report.recommendations.map((rec, index) => (
            <li key={index} className="flex gap-3">
              <TrendingUp className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <span className="text-slate-700">{rec}</span>
            </li>
          ))}
        </ul>
      </Card>

      {/* Action Button */}
      <div className="flex justify-center">
        <Button
          onClick={onStartNew}
          className="px-8 py-3 text-lg bg-purple-600 hover:bg-purple-700 text-white"
        >
          Start New Role-Play
        </Button>
      </div>
    </div>
  );
}