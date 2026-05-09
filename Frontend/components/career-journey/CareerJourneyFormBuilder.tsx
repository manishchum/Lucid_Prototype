'use client';

import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Edit2, Save, X, ChevronDown, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface Sprint {
  id: string;
  name: string;
  description: string;
  duration: number; // in days
}

interface Level {
  id: string;
  levelNumber: number;
  title: string;
  description: string;
  sprints: Sprint[];
}

interface CareerJourneyFormData {
  roleName: string;
  roleDescription: string;
  numberOfLevels: number;
  levels: Level[];
}

interface CareerJourneyFormBuilderProps {
  userId: string;
  onClose: () => void;
  onSave: (data: CareerJourneyFormData) => Promise<void>;
  onNotification?: (message: string, type: 'success' | 'error' | 'info') => void;
  initialData?: CareerJourneyFormData | null;
}

export default function CareerJourneyFormBuilder({
  userId,
  onClose,
  onSave,
  onNotification,
  initialData,
}: CareerJourneyFormBuilderProps) {
  const [formData, setFormData] = useState<CareerJourneyFormData>(
    initialData || {
      roleName: '',
      roleDescription: '',
      numberOfLevels: 1,
      levels: [],
    }
  );

  const [expandedLevelId, setExpandedLevelId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Initialize levels when numberOfLevels changes
  useEffect(() => {
    if (!initialData && formData.numberOfLevels > formData.levels.length) {
      const newLevels = [...formData.levels];
      for (let i = formData.levels.length; i < formData.numberOfLevels; i++) {
        newLevels.push({
          id: `level-${Date.now()}-${i}`,
          levelNumber: i + 1,
          title: `Level ${i + 1}`,
          description: '',
          sprints: [],
        });
      }
      setFormData((prev) => ({
        ...prev,
        levels: newLevels,
      }));
    }
  }, [formData.numberOfLevels, initialData]);

  const handleAddSprint = (levelId: string) => {
    setFormData((prev) => ({
      ...prev,
      levels: prev.levels.map((level) =>
        level.id === levelId
          ? {
              ...level,
              sprints: [
                ...level.sprints,
                {
                  id: `sprint-${Date.now()}`,
                  name: `Sprint ${level.sprints.length + 1}`,
                  description: '',
                  duration: 14, // default 2 weeks
                },
              ],
            }
          : level
      ),
    }));
    onNotification?.('Sprint added', 'info');
  };

  const handleRemoveSprint = (levelId: string, sprintId: string) => {
    setFormData((prev) => ({
      ...prev,
      levels: prev.levels.map((level) =>
        level.id === levelId
          ? {
              ...level,
              sprints: level.sprints.filter((s) => s.id !== sprintId),
            }
          : level
      ),
    }));
  };

  const handleUpdateSprint = (
    levelId: string,
    sprintId: string,
    field: string,
    value: any
  ) => {
    setFormData((prev) => ({
      ...prev,
      levels: prev.levels.map((level) =>
        level.id === levelId
          ? {
              ...level,
              sprints: level.sprints.map((s) =>
                s.id === sprintId ? { ...s, [field]: value } : s
              ),
            }
          : level
      ),
    }));
  };

  const handleUpdateLevel = (levelId: string, field: string, value: any) => {
    setFormData((prev) => ({
      ...prev,
      levels: prev.levels.map((level) =>
        level.id === levelId ? { ...level, [field]: value } : level
      ),
    }));
  };

  const handleSubmit = async () => {
    // Validation
    if (!formData.roleName.trim()) {
      onNotification?.('Please enter a role name', 'error');
      return;
    }

    if (formData.levels.some((l) => !l.title.trim())) {
      onNotification?.('All levels must have a title', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      await onSave(formData);
      onNotification?.('Career journey saved successfully', 'success');
      setTimeout(onClose, 1000);
    } catch (error) {
      onNotification?.(
        error instanceof Error ? error.message : 'Failed to save career journey',
        'error'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto"
    >
      {/* Header */}
      <div className="sticky top-0 bg-gradient-to-r from-blue-600 to-blue-700 text-white p-6 flex justify-between items-center z-10">
        <div>
          <h2 className="text-2xl font-bold">+Sprintverse Builder</h2>
          <p className="text-blue-100 text-sm">Design a Career Progression Path For a Role</p>
        </div>
        <button
          onClick={onClose}
          className="p-2 hover:bg-blue-800 rounded-lg transition-colors"
        >
          <X size={24} />
        </button>
      </div>

      {/* Content */}
      <div className="p-6 space-y-6">
        {/* Role Information Section */}
        <div className="bg-slate-50 p-6 rounded-xl border border-slate-200">
          <h3 className="text-lg font-bold text-slate-900 mb-4">Role Information</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Role Name *
              </label>
              <input
                type="text"
                placeholder="e.g., Senior Frontend Engineer"
                value={formData.roleName}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    roleName: e.target.value,
                  }))
                }
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Role Description
              </label>
              <textarea
                placeholder="Describe what this role involves..."
                value={formData.roleDescription}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    roleDescription: e.target.value,
                  }))
                }
                rows={3}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Number of Levels *
              </label>
              <div className="flex items-center gap-4">
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={formData.numberOfLevels}
                  onChange={(e) => {
                    const value = Math.min(10, Math.max(1, parseInt(e.target.value) || 1));
                    setFormData((prev) => ({
                      ...prev,
                      numberOfLevels: value,
                    }));
                  }}
                  className="w-24 px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-sm text-slate-600">
                  (1-10 levels in this journey)
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Levels Section */}
        <div>
          <h3 className="text-lg font-bold text-slate-900 mb-4">Levels</h3>
          <div className="space-y-3">
            <AnimatePresence>
              {formData.levels.map((level) => (
                <motion.div
                  key={level.id}
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="bg-slate-50 border border-slate-200 rounded-xl overflow-hidden"
                >
                  {/* Level Header */}
                  <button
                    onClick={() =>
                      setExpandedLevelId(
                        expandedLevelId === level.id ? null : level.id
                      )
                    }
                    className="w-full p-4 flex items-center justify-between hover:bg-slate-100 transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold">
                        {level.levelNumber}
                      </div>
                      <div className="text-left">
                        <h4 className="font-semibold text-slate-900">
                          {level.title || `Level ${level.levelNumber}`}
                        </h4>
                        <p className="text-sm text-slate-600">
                          {level.sprints.length} sprint{level.sprints.length !== 1 ? 's' : ''}
                        </p>
                      </div>
                    </div>
                    {expandedLevelId === level.id ? (
                      <ChevronUp size={20} className="text-slate-600" />
                    ) : (
                      <ChevronDown size={20} className="text-slate-600" />
                    )}
                  </button>

                  {/* Level Expanded Content */}
                  <AnimatePresence>
                    {expandedLevelId === level.id && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="border-t border-slate-200 bg-white p-4 space-y-4"
                      >
                        {/* Level Title and Description */}
                        <div className="space-y-3">
                          <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1">
                              Level Title
                            </label>
                            <input
                              type="text"
                              value={level.title}
                              onChange={(e) =>
                                handleUpdateLevel(level.id, 'title', e.target.value)
                              }
                              placeholder={`Level ${level.levelNumber} Title`}
                              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                            />
                          </div>

                          <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1">
                              Level Description
                            </label>
                            <textarea
                              value={level.description}
                              onChange={(e) =>
                                handleUpdateLevel(level.id, 'description', e.target.value)
                              }
                              placeholder="What will employees learn at this level?"
                              rows={2}
                              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                        </div>

                        {/* Sprints for this Level */}
                        <div className="border-t border-slate-200 pt-4">
                          <div className="flex justify-between items-center mb-3">
                            <label className="text-sm font-semibold text-slate-700">
                              Sprints ({level.sprints.length})
                            </label>
                            <button
                              onClick={() => handleAddSprint(level.id)}
                              className="flex items-center gap-1 px-3 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium transition-colors"
                            >
                              <Plus size={16} />
                              Add Sprint
                            </button>
                          </div>

                          <div className="space-y-3">
                            <AnimatePresence>
                              {level.sprints.map((sprint, sprintIndex) => (
                                <motion.div
                                  key={sprint.id}
                                  initial={{ opacity: 0, x: -10 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  exit={{ opacity: 0, x: -10 }}
                                  className="bg-slate-100 p-3 rounded-lg space-y-2 border border-slate-200"
                                >
                                  <div className="flex justify-between items-start gap-2">
                                    <div className="flex-1 space-y-2">
                                      <input
                                        type="text"
                                        value={sprint.name}
                                        onChange={(e) =>
                                          handleUpdateSprint(
                                            level.id,
                                            sprint.id,
                                            'name',
                                            e.target.value
                                          )
                                        }
                                        placeholder="Sprint name"
                                        className="w-full px-2 py-1 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
                                      />
                                      <textarea
                                        value={sprint.description}
                                        onChange={(e) =>
                                          handleUpdateSprint(
                                            level.id,
                                            sprint.id,
                                            'description',
                                            e.target.value
                                          )
                                        }
                                        placeholder="Sprint description"
                                        rows={2}
                                        className="w-full px-2 py-1 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
                                      />
                                      <div className="flex items-center gap-2">
                                        <label className="text-xs font-semibold text-slate-600">
                                          Duration (days):
                                        </label>
                                        <input
                                          type="number"
                                          min="1"
                                          max="365"
                                          value={sprint.duration}
                                          onChange={(e) =>
                                            handleUpdateSprint(
                                              level.id,
                                              sprint.id,
                                              'duration',
                                              parseInt(e.target.value)
                                            )
                                          }
                                          className="w-20 px-2 py-1 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
                                        />
                                      </div>
                                    </div>
                                    <button
                                      onClick={() =>
                                        handleRemoveSprint(level.id, sprint.id)
                                      }
                                      className="p-1.5 hover:bg-red-100 text-red-600 rounded transition-colors"
                                      title="Remove sprint"
                                    >
                                      <Trash2 size={16} />
                                    </button>
                                  </div>
                                </motion.div>
                              ))}
                            </AnimatePresence>

                            {level.sprints.length === 0 && (
                              <p className="text-sm text-slate-500 italic text-center py-2">
                                No sprints yet. Add one to get started!
                              </p>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Footer Actions */}
      <div className="sticky bottom-0 bg-slate-50 border-t border-slate-200 p-6 flex justify-end gap-3">
        <button
          onClick={onClose}
          className="px-6 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-100 font-semibold transition-colors"
        >
          Cancel
        </button>
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
            <>
              <Save size={18} />
              Save Journey
            </>
          )}
        </button>
      </div>
    </motion.div>
  );
}
