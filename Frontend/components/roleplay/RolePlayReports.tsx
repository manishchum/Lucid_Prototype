"use client";

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { 
  ChevronDown, 
  ChevronUp, 
  MessageCircle, 
  Trophy, 
  TrendingUp, 
  Calendar,
  Target,
  Lightbulb,
  Activity,
  Mic,
  Gauge
} from 'lucide-react';
import { getEmployeeRoleplayReports } from '@/lib/roleplayApi';
import { Message } from '@/lib/roleplayApi';

interface RolePlaySession {
  id: string;
  scenario_title: string;
  scenario_role: string;
  scenario_difficulty: string;
  conversation_transcript: Message[] | string;
  completed_at: string;
  duration_seconds: number;
  message_count: number;
  video_url?: string;
  scenarios?: { passingScore?: number[] | number | null };
  roleplay_assessments: Array<{
    overall_score: number;
    summary: string;
    parameters: Array<{
      name: string;
      score: number;
      feedback: string;
    }>;
    recommendations: string[];
    metrics?: {
      user_talk_percent: number;
      ai_talk_percent: number;
      user_word_count?: number;
      ai_word_count?: number;
      words_per_minute?: number;
      duration_seconds?: number;
    };
  }>;
}

const formatFeedbackPoints = (feedback: string): string[] => {
  if (!feedback) return [];
  if (feedback.includes('\n') || feedback.includes('•') || feedback.includes('- ')) {
    return feedback
      .split(/\n|•|(?<=\s)-\s/)
      .map(p => p.trim())
      .filter(p => p.length > 0 && p !== '-');
  }
  const sentences = feedback
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean);
  return sentences.length > 0 ? sentences : [feedback];
};

interface RolePlayReportsProps {
  employeeId: string;
}

export default function RolePlayReports({ employeeId }: RolePlayReportsProps) {
  const [sessions, setSessions] = useState<RolePlaySession[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [expandedSession, setExpandedSession] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, [employeeId]);

  const loadData = async () => {
  setLoading(true);

  try {
    const { data, error } =
      await getEmployeeRoleplayReports(
        employeeId,
        20
      );

    if (error) {
      console.error(
        "Error loading reports:",
        error
      );
      return;
    }

    setSessions(data.sessions || []);
    setStats(data.stats || null);

  } catch (error) {
    console.error(
      "Exception loading role-play reports:",
      error
    );
  } finally {
    setLoading(false);
  }
};
  const getScoreColor = (score: number, passingScore: number) => {
    return score >= passingScore
      ? 'text-green-600 bg-green-50 border-green-200'
      : 'text-red-600 bg-red-50 border-red-200';
  };

  const getScoreBadge = (score: number, passingScore: number) => {
    return score >= passingScore ? '✅ Passed' : '💪 Keep Practicing';
  };

  const getDifficultyColor = (difficulty: string) => {
    switch (difficulty.toLowerCase()) {
      case 'easy': return 'bg-green-100 text-green-700';
      case 'medium': return 'bg-yellow-100 text-yellow-700';
      case 'hard': return 'bg-red-100 text-red-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
          <p className="text-slate-600">Loading role-play reports...</p>
        </div>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <Card className="p-8 text-center">
        <div className="text-6xl mb-4">🎭</div>
        <h3 className="text-xl font-bold text-slate-800 mb-2">No Role-Play Sessions Yet</h3>
        <p className="text-slate-600 mb-4">
          Start practicing your communication skills with AI-powered role-play scenarios!
        </p>
        <Button onClick={() => window.location.href = '/employee/roleplay'}>
          Start Your First Role-Play
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Statistics Overview */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="p-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-purple-100 flex items-center justify-center">
                <MessageCircle className="w-6 h-6 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-slate-600">Total Sessions</p>
                <p className="text-2xl font-bold text-slate-900">{stats.completed_sessions}</p>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center">
                <TrendingUp className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-slate-600">Average Score</p>
                <p className="text-2xl font-bold text-slate-900">{stats.average_score}</p>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
                <Trophy className="w-6 h-6 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-slate-600">Best Score</p>
                <p className="text-2xl font-bold text-slate-900">{stats.best_score}</p>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-orange-100 flex items-center justify-center">
                <Target className="w-6 h-6 text-orange-600" />
              </div>
              <div>
                <p className="text-sm text-slate-600">Progress</p>
                <p className="text-2xl font-bold text-slate-900">
                  {stats.completed_sessions >= 5 ? '🔥' : '📈'}
                </p>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Session List */}
      <div className="space-y-4">
        <h3 className="text-xl font-bold text-slate-900">Practice Sessions</h3>
        
        {sessions.map((session) => {
          const assessment = session.roleplay_assessments?.[0];
          const isExpanded = expandedSession === session.id;

          // Resolve passing score from joined scenarios relation (stored as array in DB)
          const rawPs = session.scenarios?.passingScore;
          const passingScore: number = Array.isArray(rawPs) ? (rawPs[0] ?? 60) : (typeof rawPs === 'number' ? rawPs : 60);

          // Parse transcript — Supabase may return it as a JSON string
          let transcript: Message[] = [];
          if (session.conversation_transcript) {
            if (typeof session.conversation_transcript === 'string') {
              try {
                transcript = JSON.parse(session.conversation_transcript);
              } catch (e) {
                console.error(`[RolePlayReports] Failed to parse transcript for session ${session.id}:`, e);
                transcript = [];
              }
            } else if (Array.isArray(session.conversation_transcript)) {
              transcript = session.conversation_transcript;
            }
          } else {
            console.warn(`[RolePlayReports] No transcript found for session ${session.id}. message_count: ${session.message_count}`);
          }

          return (
            <Card key={session.id} className="overflow-hidden">
              {/* Header */}
              <div
                className="p-4 sm:p-6 cursor-pointer hover:bg-slate-50 transition-colors"
                onClick={() => setExpandedSession(isExpanded ? null : session.id)}
              >
                <div className="flex flex-col sm:flex-row items-start sm:justify-between gap-4">
                  <div className="flex-1 w-full">
                    <div className="flex items-center gap-3 mb-2">
                      <h4 className="text-lg font-bold text-slate-900">{session.scenario_title}</h4>
                      <span className={`px-3 py-1 rounded-full text-xs font-bold ${getDifficultyColor(session.scenario_difficulty)}`}>
                        {session.scenario_difficulty}
                      </span>
                    </div>
                    <p className="text-sm text-slate-600 mb-3">Role: {session.scenario_role}</p>
                    
                    <div className="flex flex-wrap items-center gap-4 text-sm text-slate-500">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-4 h-4" />
                        {session.completed_at ? new Date(session.completed_at).toLocaleDateString() : 'In Progress'}
                      </span>
                      <span className="flex items-center gap-1">
                        <MessageCircle className="w-4 h-4" />
                        {session.message_count || transcript.length} messages
                      </span>
                      {session.duration_seconds > 0 && (
                        <span>
                          ⏱️ {Math.floor(session.duration_seconds / 60)}m {session.duration_seconds % 60}s
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-start w-full sm:w-auto gap-2">
                    {assessment && (
                      <div className="flex items-center sm:flex-col gap-2 sm:gap-1">
                        <div className={`px-3 py-1 sm:px-4 sm:py-2 rounded-lg border-2 ${getScoreColor(assessment.overall_score, passingScore)}`}>
                          <p className="text-xl sm:text-3xl font-bold">{assessment.overall_score}</p>
                        </div>
                        <span className="text-xs sm:text-sm font-medium text-slate-600">
                          {getScoreBadge(assessment.overall_score, passingScore)}
                        </span>
                      </div>
                    )}
                    <Button variant="ghost" size="sm" className="ml-auto sm:ml-0">
                      {isExpanded ? <ChevronUp /> : <ChevronDown />}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Expanded Content */}
              {isExpanded && (
                <div className="border-t border-slate-200 bg-slate-50 p-4 sm:p-6 space-y-6">
                  {/* Summary */}
                  {assessment && (
                    <>
                      <div>
                        <h5 className="font-semibold text-slate-900 mb-2">Performance Summary</h5>
                        <p className="text-slate-700">{assessment.summary}</p>
                      </div>

                      {/* Video Recording */}
                      {session.video_url && (
                        <div>
                          <h5 className="font-semibold text-slate-900 mb-3">Session Recording</h5>
                          <div className="bg-black rounded-lg overflow-hidden">
                            <video 
                              src={session.video_url} 
                              controls 
                              className="w-full"
                              style={{ maxHeight: '400px' }}
                            >
                              Your browser does not support the video tag.
                            </video>
                          </div>
                        </div>
                      )}

                      {/* Conversational Dynamics (if metrics available) */}
                      {assessment.metrics && (
                        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
                          <div className="flex items-center gap-2 mb-4">
                            <Activity className="w-5 h-5 text-indigo-600" />
                            <h5 className="font-semibold text-slate-900">Conversational Dynamics</h5>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Talk vs Listen Ratio */}
                            <div className="p-4 bg-slate-50/80 rounded-xl border border-slate-200">
                              <div className="flex justify-between items-center mb-2">
                                <span className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                                  <Mic className="w-4 h-4 text-purple-600" />
                                  Talk-to-Listen Ratio
                                </span>
                                <span className="text-xs font-medium text-slate-500">
                                  Learner vs AI
                                </span>
                              </div>

                              {/* Progress bar */}
                              <div className="w-full bg-slate-200 rounded-full h-3 flex overflow-hidden mb-3">
                                <div
                                  className="bg-purple-600 h-full transition-all duration-500"
                                  style={{ width: `${Math.min(100, Math.max(0, assessment.metrics.user_talk_percent))}%` }}
                                />
                                <div
                                  className="bg-slate-400 h-full transition-all duration-500"
                                  style={{ width: `${Math.min(100, Math.max(0, assessment.metrics.ai_talk_percent))}%` }}
                                />
                              </div>

                              <div className="flex justify-between text-xs text-slate-600">
                                <div className="flex items-center gap-1.5">
                                  <span className="w-2.5 h-2.5 rounded-full bg-purple-600 inline-block" />
                                  <span>You ({assessment.metrics.user_talk_percent}%)</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className="w-2.5 h-2.5 rounded-full bg-slate-400 inline-block" />
                                  <span>AI Avatar ({assessment.metrics.ai_talk_percent}%)</span>
                                </div>
                              </div>

                              {typeof assessment.metrics.user_word_count === 'number' && (
                                <p className="text-xs text-slate-500 mt-3 pt-2 border-t border-slate-200">
                                  Spoke <strong className="text-slate-700">{assessment.metrics.user_word_count}</strong> words
                                  {typeof assessment.metrics.ai_word_count === 'number' && (
                                    <> vs <strong className="text-slate-700">{assessment.metrics.ai_word_count}</strong> words by partner</>
                                  )}.
                                </p>
                              )}
                            </div>

                            {/* Speaking Pace / WPM */}
                            <div className="p-4 bg-slate-50/80 rounded-xl border border-slate-200">
                              <div className="flex justify-between items-center mb-2">
                                <span className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                                  <Gauge className="w-4 h-4 text-blue-600" />
                                  Speaking Pace
                                </span>
                                {assessment.metrics.words_per_minute !== undefined && (
                                  <span
                                    className={`text-xs px-2.5 py-0.5 rounded-full font-semibold ${
                                      assessment.metrics.words_per_minute >= 110 && assessment.metrics.words_per_minute <= 165
                                        ? "bg-green-100 text-green-700"
                                        : assessment.metrics.words_per_minute < 110
                                        ? "bg-amber-100 text-amber-700"
                                        : "bg-red-100 text-red-700"
                                    }`}
                                  >
                                    {assessment.metrics.words_per_minute >= 110 && assessment.metrics.words_per_minute <= 165
                                      ? "Optimal Cadence"
                                      : assessment.metrics.words_per_minute < 110
                                      ? "Deliberate / Measured"
                                      : "Rapid Pace"}
                                  </span>
                                )}
                              </div>

                              <div className="flex items-baseline gap-2 mt-2">
                                <span className="text-3xl font-bold text-slate-800">
                                  {assessment.metrics.words_per_minute ?? "N/A"}
                                </span>
                                <span className="text-sm text-slate-500 font-medium">words per min (WPM)</span>
                              </div>

                              <p className="text-xs text-slate-600 mt-3 leading-relaxed">
                                {assessment.metrics.words_per_minute !== undefined && assessment.metrics.words_per_minute >= 110 && assessment.metrics.words_per_minute <= 165
                                  ? "Great speaking pace! Your cadence allows clear pronunciation and active listener comprehension."
                                  : assessment.metrics.words_per_minute !== undefined && assessment.metrics.words_per_minute < 110
                                  ? "A slightly more energetic pace can help keep the dialogue engaging and proactive."
                                  : "Consider slowing down slightly on key objection points to ensure maximum clarity."}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Performance Breakdown */}
                      <div>
                        <h5 className="font-semibold text-slate-900 mb-3">Performance Breakdown</h5>
                        <div className="space-y-4">
                          {assessment.parameters.map((param, idx) => {
                            const points = formatFeedbackPoints(param.feedback);
                            return (
                              <div key={idx} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                                <div className="flex items-center justify-between mb-1.5">
                                  <span className="text-sm font-semibold text-slate-800">{param.name}</span>
                                  <span className={`text-sm font-bold px-2 py-0.5 rounded ${param.score >= passingScore ? 'text-green-700 bg-green-50' : 'text-red-700 bg-red-50'}`}>
                                    {param.score}/100
                                  </span>
                                </div>
                                <div className="w-full bg-slate-100 rounded-full h-2 mb-3">
                                  <div
                                    className={`h-2 rounded-full transition-all ${
                                      param.score >= passingScore ? 'bg-green-500' : 'bg-red-500'
                                    }`}
                                    style={{ width: `${param.score}%` }}
                                  />
                                </div>
                                <ul className="space-y-1.5">
                                  {points.map((pt, pIdx) => (
                                    <li key={pIdx} className="flex items-start gap-2 text-xs sm:text-sm text-slate-600">
                                      <span className="text-purple-600 font-bold mt-0.5 shrink-0">•</span>
                                      <span>{pt}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Recommendations */}
                      <div>
                        <h5 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                          <Lightbulb className="w-5 h-5 text-yellow-500" />
                          Recommendations
                        </h5>
                        <ul className="space-y-2">
                          {assessment.recommendations.map((rec, idx) => (
                            <li key={idx} className="flex items-start gap-2 text-slate-700">
                              <span className="text-purple-600 font-bold mt-0.5">•</span>
                              <span className="text-sm">{rec}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </>
                  )}

                  {/* Conversation Transcript — always shown when expanded */}
                  <div>
                    <h5 className="font-semibold text-slate-900 mb-3">Conversation Transcript</h5>
                    {transcript.length > 0 ? (
                      <div className="bg-white rounded-lg p-4 max-h-96 overflow-y-auto space-y-3">
                        {transcript.map((msg, idx) => {
                          const role = String(msg.sender || (msg as any).role || '').toLowerCase();
                          const isUser = ['user', 'learner', 'human'].includes(role);
                          const speakerLabel = isUser
                            ? 'You'
                            : (session.scenario_role?.length > 40 ? session.scenario_role.slice(0, 40) + '...' : session.scenario_role || 'AI Partner');

                          return (
                            <div
                              key={idx}
                              className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
                            >
                              <div
                                className={`max-w-[85%] rounded-2xl px-4 py-2.5 shadow-sm ${
                                  isUser
                                    ? 'bg-blue-600 text-white rounded-br-sm'
                                    : 'bg-white text-slate-900 rounded-bl-sm border-2 border-slate-200'
                                }`}
                              >
                                <p className={`text-xs font-semibold mb-1 ${isUser ? 'opacity-80' : 'text-purple-700'}`}>
                                  {speakerLabel}
                                </p>
                                <p className="text-sm whitespace-pre-wrap">{msg.text}</p>
                                {msg.timestamp && (
                                  <p className={`text-[10px] mt-1 ${isUser ? 'opacity-70' : 'text-slate-400'}`}>
                                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </p>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="bg-white rounded-lg p-6 text-center text-slate-400">
                        <MessageCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">No transcript available for this session.</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}