"use client";

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, XCircle, Clock, Award, BookOpen, TrendingUp } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import AIFeedbackSections  from './ai-feedback-sections';

interface QuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation?: string;
  bloomLevel?: string;
}

interface QuizProps {
  quiz: QuizQuestion[];
  assessmentId?: string;
  moduleId?: string;
  processedModuleId?: string;
  onComplete?: (result: any) => void;
  showFeedback?: boolean;
}

interface QuizResult {
  success: boolean;
  score: number;
  maxScore: number;
  percentage: number;
  feedback?: string;
  questionFeedback?: string[];
  correctAnswers?: any[];
  message?: string;
}

const Quiz: React.FC<QuizProps> = ({ 
  quiz, 
  assessmentId, 
  moduleId, 
  processedModuleId,
  onComplete,
  showFeedback = true 
}) => {
  const { user } = useAuth();
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [quizResult, setQuizResult] = useState<QuizResult | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [timeSpent, setTimeSpent] = useState(0);

  // Timer effect
  useEffect(() => {
    if (!showResults && quiz.length > 0) {
      const timer = setInterval(() => {
        setTimeSpent(prev => prev + 1);
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [showResults, quiz.length]);

  const handleAnswerSelect = (answerIndex: number) => {
    setSelectedAnswer(answerIndex);
  };

  const handleNext = () => {
    if (selectedAnswer !== null) {
      const newAnswers = [...answers];
      newAnswers[currentQuestion] = selectedAnswer;
      setAnswers(newAnswers);
      setSelectedAnswer(null);

      if (currentQuestion < quiz.length - 1) {
        setCurrentQuestion(currentQuestion + 1);
        // Set selected answer if user already answered this question
        if (newAnswers[currentQuestion + 1] !== undefined) {
          setSelectedAnswer(newAnswers[currentQuestion + 1]);
        }
        // Scroll to top smoothly
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        // Quiz is complete, submit it
        submitQuiz(newAnswers);
      }
    }
  };

  const handlePrevious = () => {
    if (currentQuestion > 0) {
      setCurrentQuestion(currentQuestion - 1);
      // Set the previously selected answer
      if (answers[currentQuestion - 1] !== undefined) {
        setSelectedAnswer(answers[currentQuestion - 1]);
      } else {
        setSelectedAnswer(null);
      }
      // Scroll to top smoothly
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const submitQuiz = async (finalAnswers: number[]) => {
    if (!user?.uid || !assessmentId) {
      console.error('Missing user ID or assessment ID');
      return;
    }

    setIsSubmitting(true);

    try {
      // console.log('🧪 Submitting quiz:', { 
      //   user_id: user.uid, 
      //   assessment_id: assessmentId, 
      //   answers: finalAnswers,
      //   totalQuestions: quiz.length 
      // });

      // Log the answers being sent for debugging
      // console.log('🔍 Final answers being submitted:', finalAnswers.map((answer, index) => ({
      //   questionIndex: index,
      //   selectedOptionIndex: answer,
      //   selectedOptionText: quiz[index]?.options[answer] || 'No answer',
      //   correctIndex: quiz[index]?.correctIndex
      // })));

      const response = await fetch('/api/submit-assessment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: user.uid,
          assessment_id: assessmentId,
          answers: finalAnswers,
          type: moduleId || processedModuleId ? 'module' : 'baseline'
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Assessment submission failed: ${errorText}`);
      }

      const result: QuizResult = await response.json();
      // console.log('✅ Quiz submitted successfully:', result);

      setQuizResult(result);
      setShowResults(true);

      // Call onComplete callback if provided
      if (onComplete) {
        onComplete(result);
      }

    } catch (error) {
      console.error('❌ Error submitting quiz:', error);
      alert(`Failed to submit quiz: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getScoreColor = (percentage: number) => {
    if (percentage >= 80) return 'text-green-600';
    if (percentage >= 60) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getScoreBadgeVariant = (percentage: number): "default" | "secondary" | "destructive" => {
    if (percentage >= 80) return 'default';
    if (percentage >= 60) return 'secondary';
    return 'destructive';
  };

  // Show loading state
  if (!quiz || quiz.length === 0) {
    return (
      <Card className="w-full max-w-4xl mx-auto">
        <CardContent className="flex items-center justify-center p-8">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading quiz questions...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Show results page
  if (showResults && quizResult) {
    return (
      <div className="w-full max-w-4xl mx-auto space-y-6">
        {/* Results Header */}
        <Card className="border-l-4 border-l-blue-500">
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              <Award className="h-6 w-6 text-blue-500" />
              Quiz Results
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              <div className="text-center">
                <div className={`text-2xl font-bold ${getScoreColor(quizResult.percentage)}`}>
                  {quizResult.score}/{quizResult.maxScore}
                </div>
                <div className="text-sm text-gray-600">Score</div>
              </div>
              <div className="text-center">
                <div className={`text-2xl font-bold ${getScoreColor(quizResult.percentage)}`}>
                  {quizResult.percentage}%
                </div>
                <div className="text-sm text-gray-600">Percentage</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">
                  {formatTime(timeSpent)}
                </div>
                <div className="text-sm text-gray-600">Time Spent</div>
              </div>
              <div className="text-center">
                <Badge variant={getScoreBadgeVariant(quizResult.percentage)} className="text-lg px-3 py-1">
                  {quizResult.percentage >= 80 ? 'Excellent' : 
                   quizResult.percentage >= 60 ? 'Good' : 'Needs Improvement'}
                </Badge>
              </div>
            </div>

            {quizResult.message && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-blue-800 font-medium">{quizResult.message}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Question-by-Question Breakdown */}
        {quizResult.correctAnswers && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-5 w-5" />
                Question Breakdown
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {quiz.map((question, index) => {
                  const result = quizResult.correctAnswers?.[index];
                  const isCorrect = result?.isCorrect;
                  
                  return (
                    <div key={index} className="border rounded-lg p-4">
                      <div className="flex items-start gap-3">
                        {isCorrect ? (
                          <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0 mt-1" />
                        ) : (
                          <XCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-1" />
                        )}
                        <div className="flex-1">
                          <h4 className="font-medium mb-2">Question {index + 1}</h4>
                          <p className="text-gray-700 mb-3">{question.question}</p>
                          
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">Your answer:</span>
                              <span className={`px-2 py-1 rounded text-sm ${
                                isCorrect ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                              }`}>
                                {result?.userAnswer !== undefined 
                                  ? question.options[result.userAnswer] || 'No answer selected'
                                  : 'No answer selected'
                                }
                              </span>
                            </div>
                            
                            {!isCorrect && (
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium">Correct answer:</span>
                                <span className="px-2 py-1 rounded text-sm bg-green-100 text-green-800">
                                  {question.options[question.correctIndex]}
                                </span>
                              </div>
                            )}
                          </div>

                          {question.explanation && (
                            <div className="mt-3 p-3 bg-gray-50 rounded">
                              <p className="text-sm text-gray-700">
                                <strong>Explanation:</strong> {question.explanation}
                              </p>
                            </div>
                          )}
                          
                          {question.bloomLevel && (
                            <div className="mt-2">
                              <Badge variant="outline" className="text-xs">
                                {question.bloomLevel}
                              </Badge>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* AI Feedback */}
        {showFeedback && quizResult.feedback && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Personalized Feedback
              </CardTitle>
            </CardHeader>
            <CardContent>
              <AIFeedbackSections feedback={quizResult.feedback} />
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // Show quiz interface
  const currentQuizQuestion = quiz[currentQuestion];
  const progress = ((currentQuestion + 1) / quiz.length) * 100;

  return (
    <Card className="w-full max-w-4xl mx-auto">
      <CardHeader>
        <div className="flex justify-between items-center">
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Question {currentQuestion + 1} of {quiz.length}
          </CardTitle>
          <div className="flex items-center gap-4 text-sm text-gray-600">
            <div className="flex items-center gap-1">
              <Clock className="h-4 w-4" />
              {formatTime(timeSpent)}
            </div>
          </div>
        </div>
        
        {/* Progress Bar */}
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div 
            className="bg-blue-500 h-2 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </CardHeader>

      <CardContent>
        <div className="space-y-6">
          {/* Question */}
          <div>
            <h3 className="text-lg font-medium mb-4">{currentQuizQuestion.question}</h3>
            
            {currentQuizQuestion.bloomLevel && (
              <Badge variant="outline" className="mb-4">
                {currentQuizQuestion.bloomLevel}
              </Badge>
            )}
          </div>

          {/* Options */}
          <div className="space-y-3">
            {currentQuizQuestion.options.map((option, index) => (
              <button
                key={index}
                className={`w-full text-left p-4 border rounded-lg transition-colors ${
                  selectedAnswer === index
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                }`}
                onClick={() => handleAnswerSelect(index)}
              >
                <div className="flex items-center">
                  <div className={`w-6 h-6 rounded-full border-2 mr-3 flex items-center justify-center ${
                    selectedAnswer === index
                      ? 'border-blue-500 bg-blue-500'
                      : 'border-gray-300'
                  }`}>
                    {selectedAnswer === index && (
                      <div className="w-2 h-2 bg-white rounded-full" />
                    )}
                  </div>
                  <span>{option}</span>
                </div>
              </button>
            ))}
          </div>

          {/* Navigation */}
          <div className="flex justify-between pt-4">
            <Button
              variant="outline"
              onClick={handlePrevious}
              disabled={currentQuestion === 0}
            >
              Previous
            </Button>
            
            <Button
              onClick={handleNext}
              disabled={selectedAnswer === null || isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Submitting...
                </>
              ) : currentQuestion === quiz.length - 1 ? (
                'Submit Quiz'
              ) : (
                'Next'
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default Quiz;
