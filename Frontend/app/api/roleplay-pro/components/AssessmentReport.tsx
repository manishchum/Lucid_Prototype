
import React from 'react';
import { AssessmentReport, Scenario } from '../types';
import Button from './ui/Button';
import Card from './ui/Card';

interface AssessmentReportProps {
  report: AssessmentReport;
  scenario: Scenario;
  onStartNewRolePlay: () => void;
}

const AssessmentReport: React.FC<AssessmentReportProps> = ({ report, scenario, onStartNewRolePlay }) => {
  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getProgressBarColor = (score: number) => {
    if (score >= 80) return 'bg-green-500';
    if (score >= 60) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  return (
    <div className="flex flex-col items-center p-4">
      <h1 className="text-4xl md:text-5xl font-extrabold text-gray-800 mb-8 text-center leading-tight">
        Role-Play <span className="text-green-600">Assessment</span>
      </h1>

      <Card className="w-full max-w-3xl mb-8">
        <h2 className="text-3xl font-bold text-gray-800 mb-4 text-center">Overall Performance:</h2>
        <div className="flex flex-col items-center justify-center mb-6">
          <div className={`text-6xl font-extrabold ${getScoreColor(report.overallScore)} mb-2`}>
            {report.overallScore}%
          </div>
          <div className="w-full bg-gray-200 rounded-full h-4">
            <div
              className={`${getProgressBarColor(report.overallScore)} h-4 rounded-full transition-all duration-500`}
              style={{ width: `${report.overallScore}%` }}
            ></div>
          </div>
        </div>
        <p className="text-gray-700 text-lg leading-relaxed mb-6 text-center">{report.summary}</p>
        <div className="text-center">
            <h3 className="text-xl font-semibold text-gray-800 mb-3">Scenario: <span className="text-indigo-600">{scenario.title}</span></h3>
            <p className="text-gray-600 text-sm">{scenario.description}</p>
        </div>
      </Card>

      <div className="w-full max-w-3xl grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {report.parameters.map((param) => (
          <Card key={param.name}>
            <h3 className="text-xl font-semibold text-gray-800 mb-2">{param.name}</h3>
            <div className="flex items-center mb-3">
              <span className={`text-2xl font-bold ${getScoreColor(param.score)} mr-3`}>
                {param.score}%
              </span>
              <div className="flex-1 bg-gray-200 rounded-full h-3">
                <div
                  className={`${getProgressBarColor(param.score)} h-3 rounded-full transition-all duration-500`}
                  style={{ width: `${param.score}%` }}
                ></div>
              </div>
            </div>
            <p className="text-gray-700 text-sm leading-relaxed">{param.feedback}</p>
          </Card>
        ))}
      </div>

      <Card className="w-full max-w-3xl mb-8">
        <h2 className="text-2xl font-bold text-gray-800 mb-4 text-center">Recommendations for Improvement:</h2>
        <ul className="list-disc list-inside space-y-2 text-gray-700 text-lg">
          {report.recommendations.map((rec, index) => (
            <li key={index}>{rec}</li>
          ))}
        </ul>
      </Card>

      <div className="w-full flex justify-center">
        <Button onClick={onStartNewRolePlay} size="lg" className="max-w-sm">
          <svg className="w-6 h-6 mr-2" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd"></path></svg>
          Start New Role-Play
        </Button>
      </div>
    </div>
  );
};

export default AssessmentReport;
