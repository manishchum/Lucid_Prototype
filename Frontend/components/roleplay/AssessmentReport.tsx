"use client";

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { 
  Trophy, 
  Mic, 
  Gauge, 
  Clock, 
  Award, 
  Lightbulb, 
  Target, 
  Activity, 
  FileText, 
  RotateCcw, 
  ArrowLeft, 
  Download, 
  ChevronDown, 
  ChevronUp, 
  MessageSquare,
  Sparkles,
  CheckCircle2,
  Users
} from 'lucide-react';
import { Message } from '@/lib/roleplayApi';

export interface AssessmentParameter {
  name: string;
  score: number;
  feedback: string;
}

export interface ConversationalMetrics {
  user_talk_percent: number;
  ai_talk_percent: number;
  user_word_count?: number;
  ai_word_count?: number;
  words_per_minute?: number;
  duration_seconds?: number;
}

export interface AssessmentReport {
  overallScore: number;
  summary: string;
  parameters: AssessmentParameter[];
  recommendations: string[];
  metrics?: ConversationalMetrics;
}

interface AssessmentReportProps {
  report: AssessmentReport;
  scenarioTitle: string;
  scenarioRole?: string;
  userRole?: string;
  passingScore?: number;
  durationSeconds?: number;
  conversationHistory?: Message[];
  onRetake?: () => void;
  onBackToScenarios?: () => void;
  onStartNew?: () => void;
}

// Helper to convert paragraph or text feedback into distinct pointers/bullet points
const formatFeedbackPoints = (feedback: string): string[] => {
  if (!feedback) return [];
  
  // If text already has newline, bullet symbol, or dash bullets
  if (feedback.includes('\n') || feedback.includes('•') || feedback.includes('- ')) {
    return feedback
      .split(/\n|•|(?<=\s)-\s/)
      .map(p => p.trim())
      .filter(p => p.length > 0 && p !== '-');
  }
  
  // Fallback: split clean sentences into bullet points
  const sentences = feedback
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  return sentences.length > 0 ? sentences : [feedback];
};

export default function AssessmentReportComponent({
  report,
  scenarioTitle,
  scenarioRole,
  userRole,
  passingScore = 60,
  durationSeconds,
  conversationHistory = [],
  onRetake,
  onBackToScenarios,
  onStartNew,
}: AssessmentReportProps) {
  const [showTranscript, setShowTranscript] = useState(false);

  const isPassed = report.overallScore >= passingScore;
  const metrics = report.metrics;
  const effectiveDuration = durationSeconds ?? metrics?.duration_seconds ?? 0;
  
  const formattedDuration = effectiveDuration > 0
    ? `${Math.floor(effectiveDuration / 60)}m ${effectiveDuration % 60}s`
    : '1m 30s';

  const handleBack = onBackToScenarios || onStartNew;
  const handleRetake = onRetake || onStartNew;

  const handleDownloadReport = () => {
    window.print();
  };

  const getPaceStatus = (wpm?: number) => {
    if (wpm === undefined) return { label: 'Optimal Cadence', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    if (wpm >= 110 && wpm <= 165) return { label: 'Optimal Cadence', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    if (wpm < 110) return { label: 'Deliberate / Measured', color: 'bg-amber-50 text-amber-700 border-amber-200' };
    return { label: 'Rapid Pace', color: 'bg-rose-50 text-rose-700 border-rose-200' };
  };

  const paceStatus = getPaceStatus(metrics?.words_per_minute);

  // Participant turns breakdown
  const userTurnsCount = conversationHistory.filter(m => {
    const role = String(m.sender || (m as any).role || '').toLowerCase();
    return ['user', 'learner', 'human'].includes(role);
  }).length;
  const aiTurnsCount = conversationHistory.filter(m => {
    const role = String(m.sender || (m as any).role || '').toLowerCase();
    return ['avatar', 'bot', 'assistant', 'ai', 'model'].includes(role);
  }).length;

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12 print:p-0 print:m-0 print:space-y-4">
      {/* Top Header Card */}
      <Card className="p-6 bg-white border border-slate-200 shadow-sm rounded-2xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-700">
                Performance Evaluation
              </span>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
                isPassed ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'
              }`}>
                {isPassed ? 'Passed' : 'Needs Practice'}
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              {scenarioTitle}
            </h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500 pt-1">
              {userRole && <span><strong>Your Role:</strong> {userRole}</span>}
              {scenarioRole && <span>• <strong>AI Role:</strong> {scenarioRole}</span>}
              <span>• <strong>Passing Score:</strong> {passingScore}/100</span>
            </div>
          </div>

          {/* Quick Action Buttons (Hidden on Print) */}
          <div className="flex flex-wrap items-center gap-2.5 print:hidden">
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadReport}
              className="gap-2 text-slate-700 border-slate-200 hover:bg-slate-50"
            >
              <Download className="w-4 h-4" />
              Download Report
            </Button>
            {handleBack && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleBack}
                className="gap-2 text-slate-700 border-slate-200 hover:bg-slate-50"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to Scenarios
              </Button>
            )}
            {handleRetake && (
              <Button
                size="sm"
                onClick={handleRetake}
                className="gap-2 bg-purple-600 hover:bg-purple-700 text-white shadow-sm"
              >
                <RotateCcw className="w-4 h-4" />
                Retake Roleplay
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Non-Redundant Key Performance Indicators Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Metric 1: Overall Score */}
        <Card className="p-5 bg-white border border-slate-200 shadow-sm rounded-xl">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Overall Score</span>
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              isPassed ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'
            }`}>
              <Award className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-slate-900">{report.overallScore}</span>
            <span className="text-xs text-slate-500 font-medium">/ 100</span>
          </div>
          <p className={`text-xs font-semibold mt-2 ${isPassed ? 'text-emerald-600' : 'text-rose-600'}`}>
            {isPassed ? '✓ Met Passing Standard' : '✗ Below Passing Cutoff'}
          </p>
        </Card>

        {/* Metric 2: Session Duration */}
        <Card className="p-5 bg-white border border-slate-200 shadow-sm rounded-xl">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Session Duration</span>
            <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-slate-900">{formattedDuration}</span>
          </div>
          <p className="text-xs text-slate-500 font-medium mt-2">
            Live Voice Simulation
          </p>
        </Card>

        {/* Metric 3: Dialogue Turns Exchanged */}
        <Card className="p-5 bg-white border border-slate-200 shadow-sm rounded-xl">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Dialogue Turns</span>
            <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center">
              <MessageSquare className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-3xl font-extrabold text-slate-900">
              {conversationHistory.length}
            </span>
            <span className="text-xs text-slate-500 font-medium">turns</span>
          </div>
          <p className="text-xs text-slate-500 font-medium mt-2">
            {userTurnsCount} You • {aiTurnsCount} Partner
          </p>
        </Card>

        {/* Metric 4: Evaluation Benchmark */}
        <Card className="p-5 bg-white border border-slate-200 shadow-sm rounded-xl">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Evaluation Verdict</span>
            <div className="w-8 h-8 rounded-lg bg-purple-100 text-purple-600 flex items-center justify-center">
              <Sparkles className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-extrabold text-slate-900 truncate">
              {report.overallScore >= 80 ? 'Proficient' : report.overallScore >= passingScore ? 'Competent' : 'Practice Needed'}
            </span>
          </div>
          <p className="text-xs text-slate-500 font-medium mt-2">
            Target Cutoff: {passingScore}/100
          </p>
        </Card>
      </div>

      {/* Executive Performance Summary Card */}
      <Card className="p-6 bg-white border border-slate-200 shadow-sm rounded-2xl">
        <div className="flex items-center gap-2 mb-3">
          <FileText className="w-5 h-5 text-purple-600" />
          <h2 className="text-base font-bold text-slate-900">Performance Summary</h2>
        </div>
        <p className="text-sm text-slate-700 leading-relaxed bg-slate-50/80 p-4 rounded-xl border border-slate-100">
          {report.summary}
        </p>
      </Card>

      {/* Conversational Dynamics (Dedicated Section - No Redundancy) */}
      {metrics && (
        <Card className="p-6 bg-white border border-slate-200 shadow-sm rounded-2xl">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-5 h-5 text-indigo-600" />
            <h2 className="text-base font-bold text-slate-900">Conversational Dynamics</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Left Card: Talk-to-Listen Ratio */}
            <div className="p-5 bg-slate-50/70 rounded-2xl border border-slate-200">
              <div className="flex justify-between items-center mb-3">
                <span className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                  <Mic className="w-4 h-4 text-purple-600" />
                  Talk-to-Listen Ratio
                </span>
                <span className="text-xs font-medium text-slate-500">
                  Learner vs AI
                </span>
              </div>

              {/* Progress bar */}
              <div className="w-full bg-slate-200 rounded-full h-3.5 flex overflow-hidden mb-3">
                <div
                  className="bg-purple-600 h-full transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.max(0, metrics.user_talk_percent))}%` }}
                />
                <div
                  className="bg-slate-400 h-full transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.max(0, metrics.ai_talk_percent))}%` }}
                />
              </div>

              {/* Legend */}
              <div className="flex justify-between text-xs font-medium text-slate-700">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-purple-600 inline-block" />
                  <span>You ({metrics.user_talk_percent}%)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-slate-400 inline-block" />
                  <span>AI Avatar ({metrics.ai_talk_percent}%)</span>
                </div>
              </div>

              {typeof metrics.user_word_count === 'number' && (
                <p className="text-xs text-slate-500 mt-4 pt-3 border-t border-slate-200/80">
                  Spoke <strong className="text-slate-800">{metrics.user_word_count}</strong> words
                  {typeof metrics.ai_word_count === 'number' && (
                    <> vs <strong className="text-slate-800">{metrics.ai_word_count}</strong> words by partner</>
                  )}.
                </p>
              )}
            </div>

            {/* Right Card: Speaking Pace */}
            <div className="p-5 bg-slate-50/70 rounded-2xl border border-slate-200">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                  <Gauge className="w-4 h-4 text-blue-600" />
                  Speaking Pace
                </span>
                {metrics.words_per_minute !== undefined && (
                  <span className={`text-xs px-2.5 py-0.5 rounded-full font-semibold border ${paceStatus.color}`}>
                    {paceStatus.label}
                  </span>
                )}
              </div>

              <div className="flex items-baseline gap-2 mt-2">
                <span className="text-3xl font-extrabold text-slate-900">
                  {metrics.words_per_minute ?? 'N/A'}
                </span>
                <span className="text-sm text-slate-500 font-medium">words per min (WPM)</span>
              </div>

              <p className="text-xs text-slate-600 mt-3 leading-relaxed">
                {metrics.words_per_minute !== undefined && metrics.words_per_minute >= 110 && metrics.words_per_minute <= 165
                  ? "Great speaking pace! Your cadence allows clear pronunciation and active listener comprehension."
                  : metrics.words_per_minute !== undefined && metrics.words_per_minute < 110
                  ? "A slightly more energetic pace can help keep the dialogue engaging and proactive."
                  : "Consider slowing down slightly on key objection points to ensure maximum clarity."}
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Performance Breakdown (Pointers / Points Layout) */}
      <Card className="p-6 bg-white border border-slate-200 shadow-sm rounded-2xl">
        <div className="flex items-center gap-2 mb-4">
          <Target className="w-5 h-5 text-blue-600" />
          <h2 className="text-base font-bold text-slate-900">Performance Breakdown</h2>
        </div>

        <div className="space-y-4">
          {report.parameters.map((param, index) => {
            const points = formatFeedbackPoints(param.feedback);
            const isParamPassed = param.score >= passingScore;

            return (
              <div key={index} className="p-4 rounded-xl border border-slate-200/90 bg-slate-50/50 hover:bg-slate-50 transition-colors">
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-sm font-bold text-slate-900">{param.name}</span>
                  <span className={`text-xs font-extrabold px-2.5 py-0.5 rounded-full border ${
                    isParamPassed ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'
                  }`}>
                    {param.score}/100
                  </span>
                </div>

                {/* Progress bar */}
                <div className="w-full bg-slate-200 rounded-full h-2 mb-3">
                  <div
                    className={`h-2 rounded-full transition-all duration-500 ${
                      isParamPassed ? 'bg-emerald-500' : 'bg-rose-500'
                    }`}
                    style={{ width: `${Math.min(100, Math.max(0, param.score))}%` }}
                  />
                </div>

                {/* Feedback rendered into distinct pointers */}
                <ul className="space-y-1.5 mt-2">
                  {points.map((pt, pIdx) => (
                    <li key={pIdx} className="flex items-start gap-2 text-xs sm:text-sm text-slate-700">
                      <span className="text-purple-600 font-bold mt-0.5 shrink-0">•</span>
                      <span className="leading-relaxed">{pt}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Coaching Recommendations */}
      <Card className="p-6 bg-white border border-slate-200 shadow-sm rounded-2xl">
        <div className="flex items-center gap-2 mb-4">
          <Lightbulb className="w-5 h-5 text-amber-500" />
          <h2 className="text-base font-bold text-slate-900">Coaching Recommendations</h2>
        </div>
        <ul className="space-y-2.5">
          {report.recommendations.map((rec, index) => (
            <li key={index} className="flex items-start gap-3 p-3 rounded-xl bg-amber-50/50 border border-amber-100 text-slate-800 text-xs sm:text-sm">
              <Sparkles className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <span className="leading-relaxed font-medium">{rec}</span>
            </li>
          ))}
        </ul>
      </Card>

      {/* Expandable Conversation Transcript - Displays Both Sides */}
      {conversationHistory.length > 0 && (
        <Card className="p-6 bg-white border border-slate-200 shadow-sm rounded-2xl">
          <button
            type="button"
            onClick={() => setShowTranscript(prev => !prev)}
            className="w-full flex items-center justify-between text-left group"
          >
            <div className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-indigo-600" />
              <h2 className="text-base font-bold text-slate-900 group-hover:text-purple-600 transition-colors">
                Full Conversation Transcript
              </h2>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 font-semibold">
                {conversationHistory.length} messages
              </span>
            </div>
            {showTranscript ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
          </button>

          {showTranscript && (
            <div className="mt-4 pt-4 border-t border-slate-100 max-h-96 overflow-y-auto space-y-3 pr-2">
              {conversationHistory.map((msg, idx) => {
                const role = String(msg.sender || (msg as any).role || '').toLowerCase();
                const isUser = ['user', 'learner', 'human'].includes(role);
                const speakerLabel = isUser ? 'You (Learner)' : (scenarioRole || 'AI Roleplay Partner');

                return (
                  <div key={idx} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded-2xl px-4 py-3 shadow-sm ${
                      isUser
                        ? 'bg-blue-600 text-white rounded-br-sm'
                        : 'bg-white text-slate-900 rounded-bl-sm border-2 border-slate-200/90'
                    }`}>
                      <div className="flex items-center justify-between gap-3 mb-1.5">
                        <span className={`text-[11px] font-bold ${isUser ? 'text-blue-100' : 'text-purple-700'}`}>
                          {speakerLabel}
                        </span>
                        {msg.timestamp && (
                          <span className={`text-[10px] ${isUser ? 'text-blue-200' : 'text-slate-400'}`}>
                            {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        )}
                      </div>
                      <p className="text-xs sm:text-sm leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {/* Footer Action Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4 print:hidden">
        {handleRetake && (
          <Button
            onClick={handleRetake}
            className="w-full sm:w-auto px-8 py-3 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl shadow-md gap-2"
          >
            <RotateCcw className="w-4 h-4" />
            Retake Roleplay
          </Button>
        )}
        {handleBack && (
          <Button
            onClick={handleBack}
            variant="outline"
            className="w-full sm:w-auto px-8 py-3 border-slate-300 text-slate-700 font-bold rounded-xl hover:bg-slate-50 gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Scenarios
          </Button>
        )}
        <Button
          onClick={handleDownloadReport}
          variant="ghost"
          className="w-full sm:w-auto px-6 py-3 text-slate-600 font-medium hover:text-slate-900 gap-2"
        >
          <Download className="w-4 h-4" />
          Download PDF
        </Button>
      </div>
    </div>
  );
}
