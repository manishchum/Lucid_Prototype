import React from 'react';
import { useRouter } from 'next/navigation';

interface AIFeedbackModalProps {
  open: boolean;
  onClose: () => void;
  data: any;
  simplified?: boolean;
}

const SafeKeyValueList = ({ obj }: { obj: any }) => {
  if (!obj || typeof obj !== 'object') return null;
  return (
    <div className="space-y-2">
      {Object.entries(obj).map(([k, v]) => (
        <div key={k} className="text-sm">
          <div className="text-xs text-gray-400">{k}</div>
          <div className="text-sm text-gray-800">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</div>
        </div>
      ))}
    </div>
  );
};

export default function AIFeedbackModal({ open, onClose, data, simplified = false }: AIFeedbackModalProps) {
  const router = useRouter();
  if (!open) return null;

  const isText = data?.submission_type === 'text';
  const isMCQ = data?.submission_type === 'multiple_choice';

  const score = data.overall_score ?? data.score ?? 0;
  const isPassed = data.ai_validation_pass ?? data.ai_validation?.pass ?? (score >= 60);

  if (simplified) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="absolute inset-0 bg-black/40" onClick={onClose} />
        <div className="bg-white rounded-2xl border p-6 z-10 w-full max-w-sm shadow-xl text-center space-y-6">
          <div className="flex justify-between items-center border-b pb-3 text-left">
            <h3 className="font-bold text-lg text-gray-900">Task Feedback</h3>
            <button className="text-sm font-semibold text-gray-500 hover:text-gray-700" onClick={onClose}>Close</button>
          </div>
          
          <div className="space-y-3">
            <div className="text-sm text-gray-500 font-semibold uppercase tracking-wider">Your Result</div>
            <div className="text-4xl font-extrabold text-blue-600">{score}/100</div>
            <div className={`inline-flex items-center px-4 py-1.5 rounded-full text-sm font-bold border ${
              isPassed 
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                : 'bg-red-50 text-red-700 border-red-200'
            }`}>
              {isPassed ? 'Passed ✓' : 'Failed ✗'}
            </div>
          </div>

          <div className="flex gap-3 pt-3 border-t">
            <button 
              className="flex-1 py-2 border border-gray-250 rounded-xl text-xs font-semibold hover:bg-gray-50 text-gray-700 cursor-pointer"
              onClick={onClose}
            >
              Close
            </button>
            <button 
              className="flex-1 py-2 bg-[#2F63FF] hover:bg-blue-700 text-white rounded-xl text-xs font-semibold cursor-pointer shadow-md"
              onClick={() => {
                router.push('/employee/score-history?tab=tasks');
                onClose();
              }}
            >
              Full Report
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="bg-white rounded-2xl border p-6 z-10 w-full max-w-2xl max-h-[85vh] overflow-y-auto shadow-xl">
        <div className="flex items-start justify-between border-b pb-3">
          <div>
            <h3 className="font-bold text-lg text-gray-900">AI Submission Feedback</h3>
            <p className="text-xs text-gray-500 mt-1">
              {isText ? 'Text Analysis Report' : isMCQ ? 'Multiple Choice Evaluation' : 'Detailed AI analysis for your submission'}
            </p>
          </div>
          <button className="text-sm font-semibold text-gray-500 hover:text-gray-700" onClick={onClose}>Close</button>
        </div>

        <div className="mt-4 space-y-4 text-sm text-gray-800">
          {data ? (
            <div>
              {/* Overall Verdict */}
              <div className="mb-4 flex items-center justify-between p-3 bg-gray-50 rounded-xl border">
                <div>
                  <span className="text-xs text-gray-400 block uppercase font-semibold">Verdict</span>
                  <span className="font-bold text-gray-800">
                    {data.ai_result ?? data.ai_validation?.verdict ?? (data.overall_score >= 60 ? 'PASS' : 'REVIEW')}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-xs text-gray-400 block uppercase font-semibold">Overall Score</span>
                  <span className="font-bold text-lg text-blue-600">
                    {data.overall_score ?? data.score ?? 'N/A'}/100
                  </span>
                </div>
              </div>

              {/* Text submission feedback format */}
              {isText && (
                <div className="space-y-4">
                  {/* Detailed Scores */}
                  {data.scores && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {Object.entries(data.scores).map(([key, score]) => (
                        <div key={key} className="p-2.5 border rounded-xl bg-white text-center shadow-xs">
                          <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">{key}</div>
                          <div className="font-bold text-gray-800 mt-1">{String(score)}/100</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Feedback Text */}
                  <div className="p-4 border rounded-xl bg-blue-50/20 border-blue-100">
                    <h4 className="font-bold text-blue-900 text-xs uppercase mb-1">AI Remarks</h4>
                    <p className="text-gray-700 leading-relaxed">{data.feedback ?? 'No remarks provided.'}</p>
                  </div>

                  {/* Strengths & Improvements */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {data.strengths && data.strengths.length > 0 && (
                      <div className="p-3 border rounded-xl bg-emerald-50/10 border-emerald-100">
                        <h5 className="font-bold text-emerald-800 text-xs uppercase mb-1.5">Strengths</h5>
                        <ul className="list-disc list-inside text-xs text-gray-650 space-y-1">
                          {data.strengths.map((s: string, i: number) => <li key={i}>{s}</li>)}
                        </ul>
                      </div>
                    )}
                    {data.improvements && data.improvements.length > 0 && (
                      <div className="p-3 border rounded-xl bg-amber-50/10 border-amber-100">
                        <h5 className="font-bold text-amber-800 text-xs uppercase mb-1.5">Suggested Improvements</h5>
                        <ul className="list-disc list-inside text-xs text-gray-650 space-y-1">
                          {data.improvements.map((imp: string, i: number) => <li key={i}>{imp}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Multiple Choice submission feedback format */}
              {isMCQ && (
                <div className="space-y-4">
                  {/* Summary of correctness */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="p-2.5 border rounded-xl bg-white text-center">
                      <div className="text-[10px] text-gray-400 uppercase font-bold">Total Questions</div>
                      <div className="font-bold text-gray-800 mt-1">{data.total_questions ?? 0}</div>
                    </div>
                    <div className="p-2.5 border rounded-xl bg-green-50/20 border-green-150 text-center">
                      <div className="text-[10px] text-green-700 uppercase font-bold">Correct</div>
                      <div className="font-bold text-green-800 mt-1">{data.correct_answers ?? 0}</div>
                    </div>
                    <div className="p-2.5 border rounded-xl bg-red-50/20 border-red-150 text-center">
                      <div className="text-[10px] text-red-750 uppercase font-bold">Wrong</div>
                      <div className="font-bold text-red-800 mt-1">
                        {Math.max(0, (data.total_questions ?? 0) - (data.correct_answers ?? 0))}
                      </div>
                    </div>
                  </div>

                  {/* General feedback */}
                  <div className="p-4 border rounded-xl bg-indigo-50/20 border-indigo-100">
                    <h4 className="font-bold text-indigo-900 text-xs uppercase mb-1">Feedback</h4>
                    <p className="text-gray-700 leading-relaxed">{data.feedback ?? 'No feedback provided.'}</p>
                  </div>

                  {/* Question wise explanation */}
                  {data.question_analysis && data.question_analysis.length > 0 && (
                    <div className="space-y-3">
                      <h4 className="font-bold text-xs uppercase text-gray-500">Question-by-Question Analysis</h4>
                      {data.question_analysis.map((qa: any, idx: number) => (
                        <div key={idx} className="p-3 border rounded-xl bg-white space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <span className="font-semibold text-xs text-gray-850">Q{idx + 1}: {qa.question}</span>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              qa.is_correct ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                            }`}>
                              {qa.is_correct ? 'Correct' : 'Incorrect'}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="p-2 bg-gray-50 rounded-lg">
                              <span className="text-[9px] text-gray-400 block uppercase font-semibold">Your Answer</span>
                              <span className="font-medium text-gray-800">{qa.selected_answer}</span>
                            </div>
                            <div className="p-2 bg-green-50/30 rounded-lg">
                              <span className="text-[9px] text-green-700 block uppercase font-semibold">Correct Answer</span>
                              <span className="font-medium text-green-800">{qa.correct_answer}</span>
                            </div>
                          </div>
                          {qa.feedback && (
                            <p className="text-xs text-gray-600 leading-relaxed pt-1 border-t border-dashed">
                              <strong>Explanation:</strong> {qa.feedback}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Fallback to original fields if it's neither text nor MCQ */}
              {!isText && !isMCQ && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="p-3 border rounded-lg">
                    <div className="text-xs text-gray-400">Score</div>
                    <div className="font-bold text-lg">{data.overall_score ?? data.score ?? 'N/A'}/100</div>
                    <SafeKeyValueList obj={data.audio_analysis} />
                  </div>

                  <div className="p-3 border rounded-lg">
                    <div className="text-xs text-gray-400">AI Feedback</div>
                    <div className="mt-1 text-sm text-gray-700">{data.feedback ?? data.ai_validation?.reason ?? 'No feedback available'}</div>
                    <SafeKeyValueList obj={data.video_analysis} />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm text-gray-600">No AI feedback available for this submission yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}
