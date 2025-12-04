'use client';

import { useState, useEffect } from 'react';
// ...existing imports...

interface BaselineAssessmentStatus {
  isAssigned: boolean;
  isCompleted: boolean;
  assessmentId?: string;
}

interface Nudge {
  id: string;
  message: string;
  type: 'reminder' | 'encouragement' | 'deadline';
  priority: 'high' | 'medium' | 'low';
  moduleTitle?: string;
  dueDate?: string;
}

export default function LearnerDashboard() {
  // ...existing state...
  const [baselineStatus, setBaselineStatus] = useState<BaselineAssessmentStatus>({
    isAssigned: false,
    isCompleted: false
  });
  const [nudges, setNudges] = useState<Nudge[]>([]);

  // ...existing useEffect...

  useEffect(() => {
    const fetchBaselineStatus = async () => {
      try {
        const response = await fetch('/api/baseline-status', {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          setBaselineStatus(data);
        }
      } catch (error) {
        console.error('Error fetching baseline status:', error);
      }
    };

    const fetchNudges = async () => {
      try {
        const response = await fetch('/api/nudges', {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          setNudges(data);
        }
      } catch (error) {
        console.error('Error fetching nudges:', error);
      }
    };

    if (isLoggedIn) {
      fetchBaselineStatus();
      fetchNudges();
    }
  }, [isLoggedIn]);

  const isBaselineButtonDisabled = () => {
    return !baselineStatus.isAssigned || baselineStatus.isCompleted;
  };

  const getBaselineButtonText = () => {
    if (!baselineStatus.isAssigned) {
      return 'Not Assigned';
    }
    if (baselineStatus.isCompleted) {
      return 'Completed';
    }
    return 'Take Baseline Assessment';
  };

  const getNudgeIcon = (type: string) => {
    switch (type) {
      case 'reminder': return '🔔';
      case 'encouragement': return '💪';
      case 'deadline': return '⏰';
      default: return '📌';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'text-red-600';
      case 'medium': return 'text-yellow-600';
      case 'low': return 'text-green-600';
      default: return 'text-gray-600';
    }
  };

  // ...existing render logic until the baseline assessment section...

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* ...existing header and navigation... */}

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        {/* ...existing sections... */}

        {/* Baseline Assessment Section */}
        <section className="mb-8">
          <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">Baseline Assessment</h2>
                <p className="text-gray-600">
                  {!baselineStatus.isAssigned 
                    ? 'You have not been assigned a baseline assessment yet.'
                    : baselineStatus.isCompleted 
                      ? 'You have completed your baseline assessment.'
                      : 'Complete your baseline assessment to get personalized learning recommendations.'
                  }
                </p>
              </div>
              <button
                disabled={isBaselineButtonDisabled()}
                className={`px-6 py-3 rounded-lg font-semibold transition-all duration-300 ${
                  isBaselineButtonDisabled()
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-blue-600 text-white hover:bg-blue-700 hover:shadow-lg'
                }`}
                onClick={() => {
                  if (!isBaselineButtonDisabled()) {
                    router.push('/baseline-assessment');
                  }
                }}
              >
                {getBaselineButtonText()}
              </button>
            </div>
          </div>
        </section>

        {/* Nudges Section */}
        <section className="mb-8">
          <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-200">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Learning Reminders</h2>
            {nudges.length === 0 ? (
              <p className="text-gray-500">No reminders at the moment. Keep up the great work!</p>
            ) : (
              <div className="space-y-3">
                {nudges.map((nudge) => (
                  <div
                    key={nudge.id}
                    className="flex items-center p-4 bg-gray-50 rounded-lg border-l-4 border-blue-500"
                  >
                    <span className="text-2xl mr-3">{getNudgeIcon(nudge.type)}</span>
                    <div className="flex-1">
                      <p className={`font-medium ${getPriorityColor(nudge.priority)}`}>
                        {nudge.message}
                      </p>
                      {nudge.moduleTitle && (
                        <p className="text-sm text-gray-600 mt-1">
                          Module: {nudge.moduleTitle}
                        </p>
                      )}
                      {nudge.dueDate && (
                        <p className="text-sm text-gray-600 mt-1">
                          Due: {new Date(nudge.dueDate).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* ...rest of existing sections... */}
      </main>
    </div>
  );
}