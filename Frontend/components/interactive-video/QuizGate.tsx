"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, X, AlertTriangle, ArrowRight, RotateCcw } from "lucide-react";
import { fetchWithAuth } from "@/lib/fetch-with-auth";

interface QuizQuestion {
  id: str;
  text: str;
  options: string[];
  correct: number;
  explanation: string;
}

interface QuizGateProps {
  segmentId: string;
  processedModuleId: string;
  questions: QuizQuestion[];
  passThreshold: number;
  maxAttempts: number;
  replaySegmentId: string;
  onPass: () => void;
  onReplayTriggered: (replayId: string) => void;
}

export default function QuizGate({
  segmentId,
  processedModuleId,
  questions,
  passThreshold,
  maxAttempts,
  replaySegmentId,
  onPass,
  onReplayTriggered,
}: QuizGateProps) {
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, number>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [attempts, setAttempts] = useState(0);

  const handleSelectOption = (qId: string, optionIndex: number) => {
    if (result) return; // Prevent changing after submission
    setSelectedAnswers((prev) => ({
      ...prev,
      [qId]: optionIndex,
    }));
  };

  const allAnswered = questions.every((q) => selectedAnswers[q.id] !== undefined);

  const handleSubmit = async () => {
    if (!allAnswered || isSubmitting) return;

    setIsSubmitting(true);
    const answersPayload = Object.entries(selectedAnswers).map(([question_id, chosen_index]) => ({
      question_id,
      chosen_index,
    }));

    try {
      const response = await fetchWithAuth(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/interactive-video/quiz-attempt`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            processed_module_id: processedModuleId,
            segment_id: segmentId,
            answers: answersPayload,
          }),
        }
      );

      if (!response.ok) {
        throw new Error("Failed to submit quiz attempt");
      }

      const data = await response.json();
      setResult(data);
      setAttempts(data.attempt_number);
    } catch (error) {
      console.error("Quiz submission error:", error);
      alert("Failed to submit answers. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRetry = () => {
    setResult(null);
    setSelectedAnswers({});
  };

  const handleReplay = () => {
    if (replaySegmentId) {
      onReplayTriggered(replaySegmentId);
    }
  };

  return (
    <div className="absolute inset-0 bg-slate-950/90 flex items-center justify-center p-6 z-20 overflow-y-auto">
      <div className="w-full max-w-3xl bg-slate-900 border border-slate-700/60 rounded-3xl p-8 shadow-2xl flex flex-col gap-6 text-slate-100 max-h-[90%] overflow-y-auto my-auto scrollbar-thin scrollbar-thumb-slate-700">
        <div className="flex justify-between items-center border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              🧠 Quiz Gate Checkpoint
            </h2>
            <p className="text-slate-400 text-sm mt-1">
              Complete the questions below to unlock the next module. Pass threshold is {passThreshold * 100}%.
            </p>
          </div>
          {result && (
            <div className="text-right">
              <span className="text-xs text-slate-400 font-medium uppercase tracking-wider block">Score</span>
              <span className="text-3xl font-black text-white">
                {result.correct} / {result.total_questions}
              </span>
            </div>
          )}
        </div>

        {/* Quiz Body */}
        {!result ? (
          <div className="flex flex-col gap-8">
            {questions.map((q, idx) => (
              <div key={q.id} className="flex flex-col gap-4">
                <h3 className="font-semibold text-lg text-slate-200">
                  <span className="text-indigo-400 mr-2">Q{idx + 1}.</span> {q.text}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {q.options.map((opt, oIdx) => {
                    const isSelected = selectedAnswers[q.id] === oIdx;
                    return (
                      <button
                        key={oIdx}
                        onClick={() => handleSelectOption(q.id, oIdx)}
                        className={`flex items-center gap-3 px-5 py-4 rounded-xl border text-left font-medium transition-all duration-200 ${
                          isSelected
                            ? "bg-indigo-600/30 border-indigo-500 text-white shadow-[0_0_15px_rgba(99,102,241,0.2)]"
                            : "bg-slate-800/40 border-slate-700/50 hover:bg-slate-800/80 hover:border-slate-600 text-slate-300"
                        }`}
                      >
                        <span
                          className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-200 ${
                            isSelected
                              ? "bg-indigo-500 text-white"
                              : "bg-slate-700/50 text-slate-400 border border-slate-600/40"
                          }`}
                        >
                          {String.fromCharCode(65 + oIdx)}
                        </span>
                        <span>{opt}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            <div className="border-t border-slate-800 pt-6 flex justify-end">
              <Button
                onClick={handleSubmit}
                disabled={!allAnswered || isSubmitting}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-6 rounded-xl font-bold flex items-center gap-2"
              >
                {isSubmitting ? "Submitting..." : "Verify Answers"}
                <ArrowRight className="w-5 h-5" />
              </Button>
            </div>
          </div>
        ) : (
          /* Quiz Feedback Result View */
          <div className="flex flex-col gap-6">
            {/* Pass/Fail Header Badge */}
            <div
              className={`p-6 rounded-2xl border flex items-center gap-4 ${
                result.passed
                  ? "bg-emerald-950/40 border-emerald-500/50 text-emerald-100"
                  : "bg-rose-950/40 border-rose-500/50 text-rose-100"
              }`}
            >
              {result.passed ? (
                <div className="w-12 h-12 rounded-full bg-emerald-500 flex items-center justify-center text-slate-900 shrink-0">
                  <Check className="w-7 h-7 stroke-[3]" />
                </div>
              ) : (
                <div className="w-12 h-12 rounded-full bg-rose-500 flex items-center justify-center text-white shrink-0">
                  <X className="w-7 h-7 stroke-[3]" />
                </div>
              )}
              <div>
                <h4 className="text-xl font-extrabold">
                  {result.passed ? "Checkpoint Cleared!" : "Gate Closed - Review Required"}
                </h4>
                <p className="text-sm opacity-80 mt-1">
                  {result.passed
                    ? "Great job! You achieved a passing score and unlocked the next module."
                    : result.should_replay
                    ? `You used all ${maxAttempts} attempts. Let's auto-replay the content segment to refresh your concepts.`
                    : `That's attempt ${result.attempt_number} of ${maxAttempts}. Take a moment to retry the incorrect items below.`}
                </p>
              </div>
            </div>

            {/* Questions Detailed Explanations */}
            <div className="flex flex-col gap-6 border-y border-slate-800 py-6 max-h-[300px] overflow-y-auto pr-2 scrollbar-thin">
              {result.feedback.map((fb: any, idx: number) => (
                <div key={fb.question_id} className="flex flex-col gap-2">
                  <div className="flex items-start gap-2">
                    {fb.is_correct ? (
                      <Check className="w-5 h-5 text-emerald-500 shrink-0 mt-1" />
                    ) : (
                      <X className="w-5 h-5 text-rose-500 shrink-0 mt-1" />
                    )}
                    <h5 className="font-semibold text-slate-200">
                      Q{idx + 1}. {fb.text}
                    </h5>
                  </div>
                  <div className="pl-7 text-sm">
                    <p className="text-slate-400">
                      Your answer:{" "}
                      <span className={fb.is_correct ? "text-emerald-400 font-medium" : "text-rose-400 font-medium"}>
                        {fb.options[fb.chosen_index]}
                      </span>
                    </p>
                    <p className="text-slate-400 mt-0.5">
                      Correct answer: <span className="text-emerald-400 font-medium">{fb.options[fb.correct_index]}</span>
                    </p>
                    <div className="mt-2 bg-slate-850 p-3 rounded-lg border border-slate-800 text-slate-300 text-xs italic">
                      💡 {fb.explanation}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Footer actions */}
            <div className="flex justify-end gap-3 pt-4">
              {result.passed ? (
                <Button
                  onClick={onPass}
                  className="bg-emerald-600 hover:bg-emerald-700 text-slate-900 px-8 py-6 rounded-xl font-bold flex items-center gap-2"
                >
                  Continue Course
                  <ArrowRight className="w-5 h-5" />
                </Button>
              ) : result.should_replay ? (
                <Button
                  onClick={handleReplay}
                  className="bg-rose-600 hover:bg-rose-700 text-white px-8 py-6 rounded-xl font-bold flex items-center gap-2"
                >
                  <RotateCcw className="w-5 h-5" />
                  Replay Segment
                </Button>
              ) : (
                <Button
                  onClick={handleRetry}
                  className="bg-slate-850 hover:bg-slate-800 text-white border border-slate-700 px-8 py-6 rounded-xl font-bold flex items-center gap-2"
                >
                  <RotateCcw className="w-5 h-5" />
                  Retry Quiz ({result.attempt_number}/{maxAttempts})
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
