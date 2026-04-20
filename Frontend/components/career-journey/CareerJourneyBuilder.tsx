'use client';

import React, { useState, useEffect } from 'react';
import { Plus, X, Layers, Clock } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface Goal {
  id: string;
  description: string;
  timeInDays: number;
}

interface Level {
  id: string;
  levelNumber: number;
  goals: Goal[];
}

interface CareerJourneyFormData {
  roleName: string;
  numberOfLevels: number;
  levels: Level[];
}

interface CareerJourneyBuilderProps {
  userId: string;
  onClose: () => void;
  onSave: (data: CareerJourneyFormData) => Promise<void>;
  onNotification?: (message: string, type: 'success' | 'error' | 'info') => void;
  initialData?: CareerJourneyFormData | null;
}

export default function CareerJourneyBuilder({
  userId,
  onClose,
  onSave,
  onNotification,
  initialData,
}: CareerJourneyBuilderProps) {
  const [roleName, setRoleName] = useState(initialData?.roleName || '');
  const [numberOfLevels, setNumberOfLevels] = useState(initialData?.numberOfLevels || 1);
  const [levels, setLevels] = useState<Level[]>(
    initialData?.levels ||
    Array.from({ length: 1 }, (_, i) => ({
      id: `level-${i}`,
      levelNumber: i + 1,
      goals: [],
    }))
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [savedJourneyId, setSavedJourneyId] = useState<string | null>(null);

  // Update levels when numberOfLevels changes
  useEffect(() => {
    if (!initialData && numberOfLevels !== levels.length) {
      if (numberOfLevels > levels.length) {
        // Add new levels
        const newLevels = [...levels];
        for (let i = levels.length; i < numberOfLevels; i++) {
          newLevels.push({
            id: `level-${i}`,
            levelNumber: i + 1,
            goals: [],
          });
        }
        setLevels(newLevels);
      } else {
        // Remove levels
        setLevels(levels.slice(0, numberOfLevels));
      }
    }
  }, [numberOfLevels, levels, initialData]);

  const handleAddGoal = (levelId: string) => {
    setLevels((prev) =>
      prev.map((level) =>
        level.id === levelId
          ? {
              ...level,
              goals: [
                ...level.goals,
                {
                  id: `goal-${Date.now()}`,
                  description: '',
                  timeInDays: 0,
                },
              ],
            }
          : level
      )
    );
  };

  const handleUpdateGoal = (
    levelId: string,
    goalId: string,
    field: 'description' | 'timeInDays',
    value: any
  ) => {
    setLevels((prev) =>
      prev.map((level) =>
        level.id === levelId
          ? {
              ...level,
              goals: level.goals.map((goal) =>
                goal.id === goalId ? { ...goal, [field]: value } : goal
              ),
            }
          : level
      )
    );
  };

  const handleRemoveGoal = (levelId: string, goalId: string) => {
    setLevels((prev) =>
      prev.map((level) =>
        level.id === levelId
          ? {
              ...level,
              goals: level.goals.filter((g) => g.id !== goalId),
            }
          : level
      )
    );
  };

  const handleSubmit = async () => {
    if (!roleName.trim()) {
      onNotification?.('Please enter a role name', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      await onSave({
        roleName,
        numberOfLevels,
        levels,
      });
      // Generate a journey ID for publishing
      setSavedJourneyId(`journey-${Date.now()}`);
      onNotification?.('Career journey saved successfully', 'success');
    } catch (error) {
      onNotification?.(
        error instanceof Error ? error.message : 'Failed to save career journey',
        'error'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePublish = async () => {
    if (!savedJourneyId) {
      onNotification?.('Please save the journey first', 'error');
      return;
    }

    setIsPublishing(true);
    try {
      // Simulate publishing - in real app, would call API
      onNotification?.('Career journey published successfully!', 'success');
      setTimeout(() => {
        setSavedJourneyId(null);
        onClose();
      }, 1000);
    } catch (error) {
      onNotification?.(
        error instanceof Error ? error.message : 'Failed to publish journey',
        'error'
      );
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] overflow-y-auto">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 p-8 flex justify-between items-start sticky top-0 z-10">
        <div>
          <h2 className="text-3xl font-bold text-slate-900">Career Journey Builder</h2>
          <p className="text-gray-500 text-base mt-1">
            Design multiple structured progression paths for different roles.
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 font-medium text-sm"
        >
          × CLEAR BUILDER
        </button>
      </div>

      {/* Content */}
      <div className="p-8 space-y-8">
        {/* Role Name Section */}
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <label className="block text-sm font-bold text-gray-800 mb-3 uppercase tracking-wide">
            Role Name
          </label>
          <input
            type="text"
            placeholder="e.g. Senior Frontend Engineer"
            value={roleName}
            onChange={(e) => setRoleName(e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-600 placeholder-gray-400 text-lg"
          />
        </div>

        {/* Number of Levels Selector */}
        <div>
          <div className="flex items-center gap-3 mb-6">
            <Layers size={20} className="text-blue-600" />
            <h3 className="text-xl font-bold text-slate-900">Levels</h3>
            <button
              onClick={() => {
                if (numberOfLevels < 10) {
                  setNumberOfLevels(numberOfLevels + 1);
                }
              }}
              className="ml-auto px-4 py-2 text-blue-600 hover:text-blue-700 font-semibold text-sm flex items-center gap-2 hover:bg-blue-50 rounded-lg transition-colors"
            >
              <Plus size={18} />
              Add Level
            </button>
          </div>

          {/* Levels */}
          <div className="space-y-6">
            <AnimatePresence>
              {levels.map((level) => (
                <motion.div
                  key={level.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="bg-gray-50 border border-gray-200 rounded-xl p-8"
                >
                  {/* Level Header */}
                  <div className="flex items-center gap-4 mb-6">
                    <div className="w-12 h-12 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold text-xl">
                      {level.levelNumber}
                    </div>
                    <div>
                      <h4 className="text-xl font-bold text-slate-900">Level {level.levelNumber}</h4>
                      <p className="text-sm text-gray-500 uppercase tracking-wide">
                        Define Sprints for This Stage
                      </p>
                    </div>
                  </div>

                  {/* Goals Section */}
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-4 uppercase tracking-wider">
                      Phase Goals / Sprints
                    </label>

                    <div className="space-y-3">
                      <AnimatePresence>
                        {level.goals.map((goal) => (
                          <motion.div
                            key={goal.id}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 10 }}
                            className="flex gap-3 items-end"
                          >
                            <div className="flex-1">
                              <input
                                type="text"
                                placeholder="What should they complete next?"
                                value={goal.description}
                                onChange={(e) =>
                                  handleUpdateGoal(
                                    level.id,
                                    goal.id,
                                    'description',
                                    e.target.value
                                  )
                                }
                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-600 placeholder-gray-400"
                              />
                            </div>
                            <div className="w-40 flex items-center gap-2">
                              <Clock size={18} className="text-gray-400 flex-shrink-0" />
                              <input
                                type="number"
                                placeholder="Days"
                                value={goal.timeInDays}
                                onChange={(e) =>
                                  handleUpdateGoal(
                                    level.id,
                                    goal.id,
                                    'timeInDays',
                                    parseInt(e.target.value) || 0
                                  )
                                }
                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-600 placeholder-gray-400"
                              />
                            </div>
                            <button
                              onClick={() => handleRemoveGoal(level.id, goal.id)}
                              className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0"
                            >
                              <X size={20} />
                            </button>
                          </motion.div>
                        ))}
                      </AnimatePresence>

                      {level.goals.length === 0 && (
                        <p className="text-center py-8 text-gray-400 text-sm">
                          NO SPRINTS DEFINED
                        </p>
                      )}
                    </div>

                    {/* Add Goal Button */}
                    <button
                      onClick={() => handleAddGoal(level.id)}
                      className="w-full mt-4 px-6 py-3 bg-gray-900 text-white rounded-lg hover:bg-gray-800 font-semibold transition-colors flex items-center justify-center gap-2 text-base"
                    >
                      <Plus size={20} />
                      Add Goal with Time
                    </button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="bg-gray-50 border-t border-gray-200 p-6 flex justify-between items-center sticky bottom-0">
        <button
          onClick={onClose}
          className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 font-semibold transition-colors"
        >
          Cancel
        </button>
        <div className="flex gap-3">
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isSubmitting ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Saving...
              </>
            ) : (
              'Save Journey'
            )}
          </button>

          {savedJourneyId && (
            <button
              onClick={handlePublish}
              disabled={isPublishing}
              className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isPublishing ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Publishing...
                </>
              ) : (
                '✓ Publish'
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
