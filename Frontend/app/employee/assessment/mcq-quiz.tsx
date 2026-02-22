// MCQQuiz component for employee assessment
"use client";

import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ChevronLeft, ChevronRight, CheckCircle, XCircle, Trophy, Target, TrendingUp } from "lucide-react";

interface MCQQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation?: string;
}

interface MCQQuizProps {
  questions: MCQQuestion[];
  onSubmit: (result: { score: number; answers: number[]; feedback: string[] }) => void;
  initialSelected?: (number | null)[];
  initialSubmitted?: boolean;
  readOnly?: boolean;
}

const MCQQuiz: React.FC<MCQQuizProps> = ({
  questions,
  onSubmit,
  initialSelected,
  initialSubmitted = false,
  readOnly = false
}) => {
  const QUESTIONS_PER_PAGE = 10;
  const [currentPage, setCurrentPage] = useState(0); // page index (0-based)
  const [selected, setSelected] = useState<(number | null)[]>(
    initialSelected || Array(questions.length).fill(null)
  );
  const [feedback, setFeedback] = useState<string[]>(Array(questions.length).fill(""));
  const [score, setScore] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(initialSubmitted);
  const [progressPercent, setProgressPercent] = useState(0);

  // Calculate progress based on answered questions
  useEffect(() => {
    const answeredCount = selected.filter(answer => answer !== null).length;
    const progress = (answeredCount / questions.length) * 100;
    setProgressPercent(progress);
  }, [selected, questions.length]);

  // Scroll to top whenever page changes
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [currentPage]);

  const handleSelect = (qIdx: number, optIdx: number) => {
    if (submitted) return;
    const newSelected = [...selected];
    newSelected[qIdx] = optIdx;
    setSelected(newSelected);
  };

  const totalPages = Math.ceil(questions.length / QUESTIONS_PER_PAGE);
  const handleNextPage = () => {
    if (currentPage < totalPages - 1) {
      setCurrentPage(currentPage + 1);
    }
  };
  const handlePrevPage = () => {
    if (currentPage > 0) {
      setCurrentPage(currentPage - 1);
    }
  };

  const handleSubmit = () => {
    let sc = 0;
    const fb: string[] = [];
    questions.forEach((q, i) => {
      if (selected[i] === q.correctIndex) {
        sc++;
        fb.push("Correct");
      } else {
        fb.push(q.explanation ? `Incorrect. ${q.explanation}` : "Incorrect");
      }
    });
    setScore(sc);
    setFeedback(fb);
    setSubmitted(true);
    onSubmit({ score: sc, answers: selected as number[], feedback: fb });
    // console.log("Quiz submitted with score:", sc, "/", questions.length);
  };

  const getScoreMessage = (score: number, total: number) => {
    const percentage = (score / total) * 100;
    if (percentage >= 90) return { message: "Outstanding! Excellent performance!", icon: Trophy, color: "text-yellow-500" };
    if (percentage >= 80) return { message: "Great job! Well done!", icon: Target, color: "text-green-500" };
    if (percentage >= 70) return { message: "Good work! Keep improving!", icon: TrendingUp, color: "text-blue-500" };
    return { message: "Keep learning and growing!", icon: TrendingUp, color: "text-orange-500" };
  };

  // For current page, check if all questions are answered
  const startIdx = currentPage * QUESTIONS_PER_PAGE;
  const endIdx = Math.min(startIdx + QUESTIONS_PER_PAGE, questions.length);
  const currentQuestions = questions.slice(startIdx, endIdx);
  const allCurrentPageAnswered = selected.slice(startIdx, endIdx).every(ans => ans !== null);
  const allAnswered = selected.every(answer => answer !== null);

  // Show summary after submission
  // if (submitted && score !== null) { ... removed redundant summary view ... }
  return (
    <div className="w-full mx-auto p-4 space-y-6">
      {/* Progress Bar */}
      <Card className="shadow-sm">
        <CardContent className="p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
            <h2 className="text-lg sm:text-xl font-semibold">Baseline Assessment Quiz</h2>
            <div className="text-sm text-gray-600">
              Page {currentPage + 1} of {totalPages}
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-sm text-gray-600">
              <span>Progress</span>
              <span>{Math.round(progressPercent)}% Complete</span>
            </div>
            <Progress value={progressPercent} className="h-2" />
          </div>
        </CardContent>
      </Card>

      {/* Questions for current page */}
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="text-lg sm:text-xl">
            Questions {startIdx + 1} - {endIdx}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-8">
          {currentQuestions.map((q, idx) => (
            <div key={startIdx + idx} className="space-y-3">
              <div className="font-medium text-base sm:text-lg mb-2">
                {startIdx + idx + 1}. {q.question}
              </div>
              <div className="space-y-2">
                {q.options.map((opt, oidx) => {
                  let buttonClass = "border-gray-200 hover:border-gray-300";
                  let circleClass = "border-gray-300";

                  if (submitted || readOnly) {
                    if (oidx === q.correctIndex) {
                      // Correct option
                      buttonClass = "border-green-500 bg-green-50 shadow-sm";
                      circleClass = "border-green-500 bg-green-500";
                    } else if (selected[startIdx + idx] === oidx) {
                      // User selected wrong option
                      buttonClass = "border-red-500 bg-red-50 shadow-sm";
                      circleClass = "border-red-500 bg-red-500";
                    } else {
                      // Other unselected wrong options
                      buttonClass = "border-gray-200 opacity-60";
                    }
                  } else if (selected[startIdx + idx] === oidx) {
                    // Selected state before submission
                    buttonClass = "border-blue-500 bg-blue-50 shadow-sm";
                    circleClass = "border-blue-500 bg-blue-500";
                  }

                  return (
                    <div key={oidx}>
                      <button
                        onClick={() => handleSelect(startIdx + idx, oidx)}
                        disabled={submitted || readOnly}
                        className={`w-full p-4 text-left border-2 rounded-lg transition-all duration-200 ${buttonClass} ${submitted || readOnly ? "cursor-not-allowed" : "cursor-pointer"}`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${circleClass}`}>
                              {(selected[startIdx + idx] === oidx || (submitted || readOnly) && oidx === q.correctIndex) && (
                                <div className="w-2 h-2 rounded-full bg-white"></div>
                              )}
                            </div>
                            <span className="text-sm sm:text-base">{opt}</span>
                          </div>
                          {(submitted || readOnly) && oidx === q.correctIndex && (
                            <CheckCircle className="w-5 h-5 text-green-600 shrink-0" />
                          )}
                          {(submitted || readOnly) && selected[startIdx + idx] === oidx && oidx !== q.correctIndex && (
                            <XCircle className="w-5 h-5 text-red-600 shrink-0" />
                          )}
                        </div>
                      </button>
                      {(submitted || readOnly) && selected[startIdx + idx] === oidx && q.explanation && (
                        <div className="mt-2 p-3 rounded-lg bg-blue-50/50 border border-blue-100 text-sm text-gray-700">
                          <span className="font-semibold text-blue-900">Explanation:</span> {q.explanation}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {/* Navigation and Submit Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-between mt-6">
            {/* Left: Previous */}
            <div className="flex">
              {totalPages > 1 && (
                <Button
                  onClick={handlePrevPage}
                  disabled={currentPage === 0 || readOnly}
                  variant="outline"
                  size="sm"
                  className="flex items-center gap-2"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Previous
                </Button>
              )}
            </div>
            {/* Right: Next or Submit */}
            <div className="flex justify-end">
              {currentPage < totalPages - 1 ? (
                <Button
                  onClick={handleNextPage}
                  size="sm"
                  disabled={readOnly}
                  className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 disabled:opacity-60"
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </Button>
              ) : (
                !readOnly && !submitted && (
                  <Button
                    onClick={handleSubmit}
                    disabled={!allAnswered}
                    className="bg-green-600 hover:bg-green-700 text-white px-6"
                    size="sm"
                  >
                    Submit Quiz
                  </Button>
                )
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default MCQQuiz;
