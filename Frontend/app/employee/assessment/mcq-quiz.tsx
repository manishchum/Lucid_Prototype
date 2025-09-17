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
}

const MCQQuiz: React.FC<MCQQuizProps> = ({ questions, onSubmit }) => {
  const QUESTIONS_PER_PAGE = 10;
  const [currentPage, setCurrentPage] = useState(0); // page index (0-based)
  const [selected, setSelected] = useState<(number | null)[]>(Array(questions.length).fill(null));
  const [feedback, setFeedback] = useState<string[]>(Array(questions.length).fill(""));
  const [score, setScore] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);

  // Calculate progress based on answered questions
  useEffect(() => {
    const answeredCount = selected.filter(answer => answer !== null).length;
    const progress = (answeredCount / questions.length) * 100;
    setProgressPercent(progress);
  }, [selected, questions.length]);

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
    console.log("Quiz submitted with score:", sc, "/", questions.length);
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
  if (submitted && score !== null) {
    const correctAnswers = feedback.filter(f => f === "Correct").length;
    const incorrectAnswers = questions.length - correctAnswers;
    const { message, icon: ScoreIcon, color } = getScoreMessage(score, questions.length);

    return (
      <div className="max-w-4xl mx-auto p-4 space-y-8">
        <Card className="shadow-xl border-2 border-blue-100">
          <CardHeader className="text-center bg-gradient-to-r from-blue-50 to-green-50 rounded-t-lg">
            <div className="flex justify-center mb-4">
              <ScoreIcon className={`w-20 h-20 ${color} drop-shadow-lg`} />
            </div>
            <CardTitle className="text-3xl font-extrabold tracking-tight">Quiz Complete!</CardTitle>
            <p className={`text-xl mt-2 ${color} font-semibold`}>{message}</p>
          </CardHeader>
          <CardContent className="space-y-8">
            <div className="flex flex-col sm:flex-row justify-center gap-6">
              <div className="flex-1 flex flex-col items-center bg-blue-50 rounded-lg p-6 shadow">
                <span className="text-4xl font-bold text-blue-600">{score}</span>
                <span className="text-base text-gray-600 mt-1">Total Score</span>
              </div>
              <div className="flex-1 flex flex-col items-center bg-green-50 rounded-lg p-6 shadow">
                <span className="text-4xl font-bold text-green-600">{correctAnswers}</span>
                <span className="text-base text-gray-600 mt-1">Correct</span>
              </div>
              <div className="flex-1 flex flex-col items-center bg-red-50 rounded-lg p-6 shadow">
                <span className="text-4xl font-bold text-red-600">{incorrectAnswers}</span>
                <span className="text-base text-gray-600 mt-1">Incorrect</span>
              </div>
            </div>

            <div className="space-y-6 mt-8">
              <h3 className="text-xl font-bold text-blue-700 mb-2 flex items-center gap-2">
                <TrendingUp className="w-6 h-6 text-blue-400" />
                Your Answers & Explanations
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {questions.map((q, idx) => (
                  <div key={idx} className={`rounded-lg border-2 p-4 shadow-sm transition-all duration-200 ${
                    feedback[idx] === "Correct"
                      ? "border-green-300 bg-green-50"
                      : "border-red-300 bg-red-50"
                  }`}>
                    <div className="flex items-center gap-2 mb-2">
                      {feedback[idx] === "Correct" ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-green-200 text-green-800">
                          <CheckCircle className="w-4 h-4 mr-1" /> Correct
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-red-200 text-red-800">
                          <XCircle className="w-4 h-4 mr-1" /> Incorrect
                        </span>
                      )}
                      <span className="text-xs text-gray-500">Q{idx + 1}</span>
                    </div>
                    <div className="font-medium text-gray-900 mb-1 text-sm sm:text-base">
                      {q.question}
                    </div>
                    <div className="mt-2">
                      <span className="font-semibold text-gray-700 text-xs">Your answer: </span>
                      <span className="text-xs sm:text-sm">
                        {typeof selected[idx] === 'number' ? q.options[selected[idx] as number] : <span className="italic text-gray-400">No answer</span>}
                      </span>
                    </div>
                    {feedback[idx] !== "Correct" && q.explanation && (
                      <div className="mt-2 p-2 rounded bg-yellow-50 border-l-4 border-yellow-400 text-yellow-800 text-xs sm:text-sm">
                        <span className="font-semibold">Explanation: </span>{q.explanation}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-6">
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
                {q.options.map((opt, oidx) => (
                  <button
                    key={oidx}
                    onClick={() => handleSelect(startIdx + idx, oidx)}
                    disabled={submitted}
                    className={`w-full p-4 text-left border-2 rounded-lg transition-all duration-200 hover:shadow-md ${
                      selected[startIdx + idx] === oidx
                        ? "border-blue-500 bg-blue-50 shadow-sm"
                        : "border-gray-200 hover:border-gray-300"
                    } ${submitted ? "cursor-not-allowed" : "cursor-pointer"}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                        selected[startIdx + idx] === oidx
                          ? "border-blue-500 bg-blue-500"
                          : "border-gray-300"
                      }`}>
                        {selected[startIdx + idx] === oidx && (
                          <div className="w-2 h-2 rounded-full bg-white"></div>
                        )}
                      </div>
                      <span className="text-sm sm:text-base">{opt}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {/* Navigation and Submit Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-between mt-6">
            <div className="flex gap-2">
              <Button
                onClick={handlePrevPage}
                disabled={currentPage === 0}
                variant="outline"
                size="sm"
                className="flex items-center gap-2"
              >
                <ChevronLeft className="w-4 h-4" />
                Previous
              </Button>
              {currentPage < totalPages - 1 && (
                <Button
                  onClick={handleNextPage}
                  disabled={!allCurrentPageAnswered}
                  variant="outline"
                  size="sm"
                  className="flex items-center gap-2"
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </Button>
              )}
            </div>
            {currentPage === totalPages - 1 && allCurrentPageAnswered && (
              <Button
                onClick={handleSubmit}
                className="bg-green-600 hover:bg-green-700 text-white px-6"
                size="sm"
              >
                Submit Quiz
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default MCQQuiz;
