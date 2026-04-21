'use client';

import { useAuth } from '@/contexts/auth-context';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Layers, X, CheckCircle2, ChevronRight, Briefcase, Edit2, Rocket, Clock } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

function useIllusionProgress(active: boolean) {
  const [progress, setProgress] = useState(12);
  const [show, setShow] = useState(active);

  useEffect(() => {
    if (!active) {
      setProgress(100);
      const timeout = setTimeout(() => setShow(false), 180);
      return () => clearTimeout(timeout);
    }

    setShow(true);
    setProgress(Math.min(25, 10 + Math.round(Math.random() * 12)));

    const id = setInterval(() => {
      setProgress((prev) => {
        const shouldHold = prev > 70 ? Math.random() < 0.45 : Math.random() < 0.25;
        if (shouldHold) return prev;
        const increment = Math.max(1, Math.round(Math.random() * 7));
        return Math.min(prev + increment, 93);
      });
    }, 420 + Math.round(Math.random() * 240));

    return () => clearInterval(id);
  }, [active]);

  return { progress: Math.min(progress, 100), show };
}

function LoadingProgress({ label, progress }: { label: string; progress: number }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-purple-50 px-4">
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-lg border border-slate-100 p-6 space-y-4">
        <div className="flex items-center justify-between text-sm font-semibold text-slate-700">
          <span>{label}</span>
          <span className="text-slate-900 text-base font-black">{progress}%</span>
        </div>
        <div className="relative h-3 rounded-full bg-slate-100 overflow-hidden">
          <div
            className="absolute left-0 top-0 h-full bg-gradient-to-r from-blue-500 via-indigo-500 to-cyan-400 transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-xs text-slate-500 font-medium">Preparing career journeys. This may take a moment.</p>
      </div>
    </div>
  );
}
import {
  createCareerJourney,
  updateCareerJourney,
  publishCareerJourney,
  deleteCareerJourney,
  getDraftJourneys,
  getPublishedJourneys,
} from '@/lib/careerJourneyDatabase';
import { CareerJourneyDB } from '@/lib/types/career-journey';

interface Sprint {
  id: string;
  name: string;
  completionTime?: string;
  timeUnit?: 'days' | 'hours';
}

interface Level {
  id: string;
  levelNumber: number;
  sprints: Sprint[];
  thresholdScore: number;
}

interface CareerJourney {
  id: string;
  roleName: string;
  levels: Level[];
  dbId?: string; // Reference to database ID
  status?: 'draft' | 'published';
}

export default function CareerJourneysPage() {
  const { isAdmin, userId } = useAuth();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const { progress: loadingProgress, show: showLoadingProgress } = useIllusionProgress(isLoading);

  useEffect(() => {
    if (!isAdmin) {
      router.push('/admin/career-journeys');
      return;
    }
    setIsLoading(false);
  }, [isAdmin, router]);

  // File B state variables
  const [roleName, setRoleName] = useState('');
  const [levels, setLevels] = useState<Level[]>([
    { id: 'l1', levelNumber: 1, sprints: [], thresholdScore: 0 }
  ]);
  const [sprintInputs, setSprintInputs] = useState<Record<string, string>>({});
  const [sprintTimeInputs, setSprintTimeInputs] = useState<Record<string, string>>({});
  const [sprintTimeUnits, setSprintTimeUnits] = useState<Record<string, 'days' | 'hours'>>({});
  const [notification, setNotification] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const [submittedJourney, setSubmittedJourney] = useState<CareerJourney | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [draftJourneys, setDraftJourneys] = useState<CareerJourney[]>([]);
  const [publishedJourneys, setPublishedJourneys] = useState<CareerJourney[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);

  // Load journeys on mount
  useEffect(() => {
    if (!isLoading && userId && isAdmin) {
      loadJourneys();
    }
  }, [isLoading, userId, isAdmin]);

  const loadJourneys = async () => {
    if (!userId) return;
    try {
      const [draftsResult, publishedResult] = await Promise.all([
        getDraftJourneys(userId),
        getPublishedJourneys(),
      ]);

      if (draftsResult.data) {
        const draftList = draftsResult.data.map(db => transformDBToUI(db, 'draft'));
        setDraftJourneys(draftList);
      }

      if (publishedResult.data) {
        const publishedList = publishedResult.data.map(db => transformDBToUI(db, 'published'));
        setPublishedJourneys(publishedList);
      }
    } catch (error) {
      console.error('Failed to load journeys:', error);
      setNotification({ type: 'error', message: 'Failed to load journeys' });
      setTimeout(() => setNotification(null), 3000);
    }
  };

  // Transform database format to UI format
  const transformDBToUI = (dbJourney: CareerJourneyDB, status: 'draft' | 'published'): CareerJourney => {
    // Skills become levels and sprints
    const levelsMap = new Map<string, Level>();
    
    dbJourney.skills?.forEach((skill) => {
      let level = levelsMap.get(skill.level);
      if (!level) {
        level = {
          id: `level-${skill.level}`,
          levelNumber: skill.level === 'beginner' ? 1 : skill.level === 'intermediate' ? 2 : 3,
          sprints: [],
          thresholdScore: 0,
        };
        levelsMap.set(skill.level, level);
      }
      const sprint = {
        id: skill.id,
        name: skill.title,
        completionTime: skill.estimatedHours ? `${skill.estimatedHours}` : '',
        timeUnit: skill.timeUnit || 'hours'
      };
      level.sprints.push(sprint);
    });

    const transformedLevels = Array.from(levelsMap.values()).sort((a, b) => a.levelNumber - b.levelNumber);

    return {
      id: dbJourney.id!,
      roleName: dbJourney.title,
      levels: transformedLevels.length > 0 ? transformedLevels : [{ id: 'l1', levelNumber: 1, sprints: [], thresholdScore: 0 }],
      dbId: dbJourney.id,
      status,
    };
  };

  // Transform UI format to database format
  const transformUIToDB = (uiJourney: CareerJourney) => {
    const skills = uiJourney.levels.flatMap((level) =>
      level.sprints.map((sprint) => ({
        id: sprint.id,
        title: sprint.name,
        description: '',
        level: (level.levelNumber === 1 ? 'beginner' : level.levelNumber === 2 ? 'intermediate' : 'advanced') as 'beginner' | 'intermediate' | 'advanced',
        estimatedHours: sprint.completionTime ? parseInt(sprint.completionTime) : undefined,
        timeUnit: sprint.timeUnit || 'days',
      }))
    );

    return {
      title: uiJourney.roleName,
      description: `Career progression path for ${uiJourney.roleName}`,
      skills,
      connections: [],
      category: 'career-progression',
      tags: ['career-journey'],
    };
  };

  // File B handlers
  const addLevel = () => {
    const newLevel: Level = {
      id: crypto.randomUUID(),
      levelNumber: levels.length + 1,
      sprints: [],
      thresholdScore: 0
    };
    setLevels([...levels, newLevel]);
  };

  const removeLevel = (id: string) => {
    if (levels.length <= 1) return;
    const updated = levels
      .filter(l => l.id !== id)
      .map((l, index) => ({ ...l, levelNumber: index + 1 }));
    setLevels(updated);
  };

  const updateLevel = (id: string, updates: Partial<Level>) => {
    setLevels(levels.map(l => l.id === id ? { ...l, ...updates } : l));
  };

  const addSprint = (levelId: string) => {
    const name = sprintInputs[levelId]?.trim();
    const time = sprintTimeInputs[levelId]?.trim();
    const timeUnit = sprintTimeUnits[levelId] || 'days';
    
    if (!name) return;

    const level = levels.find(l => l.id === levelId);
    if (!level) return;

    if (level.sprints.some(s => s.name === name)) {
      setNotification({ type: 'error', message: 'Sprint already exists in this level' });
      setTimeout(() => setNotification(null), 3000);
      return;
    }

    const newSprint = {
      id: crypto.randomUUID(),
      name,
      completionTime: time,
      timeUnit: timeUnit
    };

    updateLevel(levelId, { sprints: [...level.sprints, newSprint] });
    setSprintInputs({ ...sprintInputs, [levelId]: '' });
    setSprintTimeInputs({ ...sprintTimeInputs, [levelId]: '' });
    setSprintTimeUnits({ ...sprintTimeUnits, [levelId]: 'days' });
  };

  const removeSprint = (levelId: string, sprintId: string) => {
    const level = levels.find(l => l.id === levelId);
    if (!level) return;

    updateLevel(levelId, { sprints: level.sprints.filter(s => s.id !== sprintId) });
  };

  const handleSubmit = async () => {
    if (!roleName) {
      setNotification({ type: 'error', message: 'Please enter a role name' });
      setTimeout(() => setNotification(null), 3000);
      return;
    }

    if (levels.some(l => l.sprints.length === 0)) {
      setNotification({ type: 'error', message: 'Each level must have at least one sprint' });
      setTimeout(() => setNotification(null), 3000);
      return;
    }

    if (!userId) {
      setNotification({ type: 'error', message: 'User not authenticated' });
      setTimeout(() => setNotification(null), 3000);
      return;
    }

    setIsSaving(true);
    try {
      const journeyData = transformUIToDB({
        id: editingDraftId || `temp-${Date.now()}`,
        roleName,
        levels: JSON.parse(JSON.stringify(levels)),
      });

      let result;
      if (editingDraftId) {
        // Update existing draft
        result = await updateCareerJourney(editingDraftId, journeyData, userId);
      } else {
        // Create new draft
        result = await createCareerJourney(journeyData, userId);
      }

      if (result.error) {
        setNotification({ type: 'error', message: result.error });
        setTimeout(() => setNotification(null), 3000);
        setIsSaving(false);
        return;
      }

      // Transform back to UI format for display
      const uiJourney = transformDBToUI(result.data!, 'draft');
      setSubmittedJourney(uiJourney);

      // Update drafts list
      setDraftJourneys((prev) => {
        const filtered = prev.filter(j => j.dbId !== result.data!.id);
        return [uiJourney, ...filtered];
      });

      setNotification({ type: 'success', message: editingDraftId ? 'Draft updated!' : 'Journey saved to drafts!' });
      setTimeout(() => setNotification(null), 3000);
    } catch (error) {
      console.error('Error saving journey:', error);
      setNotification({ type: 'error', message: 'Failed to save journey' });
      setTimeout(() => setNotification(null), 3000);
    } finally {
      setIsSaving(false);
    }
  };

  const handleEdit = () => {
    if (!submittedJourney) return;
    setRoleName(submittedJourney.roleName);
    setLevels(submittedJourney.levels);
    setEditingDraftId(submittedJourney.id);
    setSubmittedJourney(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handlePublish = async () => {
    if (!submittedJourney || !userId) return;

    setIsPublishing(true);
    try {
      // Use the database ID to publish
      const dbId = submittedJourney.dbId || submittedJourney.id;
      const result = await publishCareerJourney(dbId, userId);

      if (result.error) {
        setNotification({ type: 'error', message: result.error });
        setTimeout(() => setNotification(null), 3000);
        setIsPublishing(false);
        return;
      }

      // Move from drafts to published
      const publishedJourney = transformDBToUI(result.data!, 'published');
      setDraftJourneys(prev => prev.filter(j => j.dbId !== dbId));
      setPublishedJourneys([publishedJourney, ...publishedJourneys]);
      setSubmittedJourney(publishedJourney);

      setNotification({ type: 'success', message: 'Journey published successfully!' });
      setTimeout(() => setNotification(null), 3000);
    } catch (error) {
      console.error('Error publishing journey:', error);
      setNotification({ type: 'error', message: 'Failed to publish journey' });
      setTimeout(() => setNotification(null), 3000);
    } finally {
      setIsPublishing(false);
    }
  };

  const isAlreadyPublished = submittedJourney && publishedJourneys.some(j => j.id === submittedJourney.id);

  const handleClear = () => {
    setRoleName('');
    setLevels([{ id: 'l1', levelNumber: 1, sprints: [], thresholdScore: 0 }]);
    setSubmittedJourney(null);
    setEditingDraftId(null);
  };

  const handleDelete = async (id: string, isPublished: boolean) => {
    if (!userId) return;

    try {
      const result = await deleteCareerJourney(id, userId);

      if (result.error) {
        setNotification({ type: 'error', message: result.error });
        setTimeout(() => setNotification(null), 3000);
        return;
      }

      if (isPublished) {
        setPublishedJourneys(prev => prev.filter(j => j.dbId !== id));
      } else {
        setDraftJourneys(prev => prev.filter(j => j.dbId !== id));
      }

      setNotification({ type: 'success', message: 'Journey deleted successfully' });
      setTimeout(() => setNotification(null), 3000);
    } catch (error) {
      console.error('Error deleting journey:', error);
      setNotification({ type: 'error', message: 'Failed to delete journey' });
      setTimeout(() => setNotification(null), 3000);
    }
  };

  if (isLoading || !userId) {
    return (
      showLoadingProgress
        ? <LoadingProgress label="Loading career journeys..." progress={loadingProgress} />
        : (
          <div className="flex items-center justify-center h-screen">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
              <p className="text-gray-600">Loading...</p>
            </div>
          </div>
        )
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      <div className="max-w-6xl mx-auto space-y-8 pb-20 px-4 py-8">
        {/* Career Journey Studio Banner */}
        <div className="bg-white border border-gray-200 rounded-xl p-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Career Journey Studio</h1>
          <p className="text-sm text-gray-600">Create New Career Path for your Organization</p>
        </div>

      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className={`p-4 rounded-xl border z-50 fixed bottom-8 right-8 shadow-2xl ${
              notification.type === 'success' 
                ? 'bg-blue-600 text-white border-blue-500' 
                : 'bg-red-600 text-white border-red-500'
            }`}
          >
            <div className="flex items-center gap-3">
              {notification.type === 'success' ? <CheckCircle2 size={20} /> : <X size={20} />}
              <span className="font-bold">{notification.message}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <section className="bg-white p-8 rounded-xl border border-gray-200 space-y-6">
        <div>
          <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Role Name</label>
          <input
            type="text"
            value={roleName}
            onChange={(e) => setRoleName(e.target.value)}
            placeholder="e.g. Senior Frontend Engineer"
            className="w-full px-4 py-2.5 rounded-lg border border-gray-200 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all placeholder:text-gray-400 text-sm font-medium bg-white"
          />
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-gray-100">
          <div className="flex items-center gap-2 text-gray-900">
            <Layers size={18} className="text-gray-400" />
            <span className="font-semibold text-sm">Levels</span>
          </div>
          <button
            onClick={addLevel}
            className="bg-blue-50 text-blue-600 hover:bg-blue-100 px-4 py-2 rounded-lg font-semibold flex items-center gap-2 transition-all text-xs active:scale-95"
          >
            <Plus size={16} />
            Add Level
          </button>
        </div>

        <div className="space-y-4">
          {levels.map((level) => (
            <motion.div
              layout
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              key={level.id}
              className="p-8 rounded-lg border border-gray-200 bg-gray-50 relative group transition-colors hover:bg-white"
            >
              {levels.length > 1 && (
                <button
                  onClick={() => removeLevel(level.id)}
                  className="absolute top-6 right-6 text-gray-300 hover:text-red-500 transition-colors p-1.5 bg-white rounded-lg"
                >
                  <Trash2 size={16} />
                </button>
              )}

              <div className="flex items-center gap-3 mb-8">
                <div className="w-8 h-8 bg-blue-600 text-white rounded-lg flex items-center justify-center font-bold text-xs">
                  {level.levelNumber}
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 text-sm">Level {level.levelNumber}</h3>
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">Define Sprints</p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6">
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Level Goals</label>
                    <div className="flex flex-col gap-3">
                      <div className="flex gap-3 items-end">
                        <input
                          type="text"
                          value={sprintInputs[level.id] || ''}
                          onChange={(e) => setSprintInputs({ ...sprintInputs, [level.id]: e.target.value })}
                          onKeyDown={(e) => e.key === 'Enter' && addSprint(level.id)}
                          placeholder="What should they complete?"
                          className="flex-1 px-4 py-3 rounded-lg border border-gray-200 bg-white text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all placeholder:text-gray-300"
                        />
                        <div className="flex items-center gap-2">
                          <Clock className="text-gray-400 flex-shrink-0" size={18} />
                          <input
                            type="number"
                            value={sprintTimeInputs[level.id] || ''}
                            onChange={(e) => setSprintTimeInputs({ ...sprintTimeInputs, [level.id]: e.target.value })}
                            onKeyDown={(e) => e.key === 'Enter' && addSprint(level.id)}
                            placeholder="0"
                            className="w-16 px-3 py-3 rounded-lg border border-gray-200 bg-white text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all placeholder:text-gray-300"
                          />
                          <select
                            value={sprintTimeUnits[level.id] || 'days'}
                            onChange={(e) => setSprintTimeUnits({ ...sprintTimeUnits, [level.id]: e.target.value as 'days' | 'hours' })}
                            className="px-3 py-3 rounded-lg border border-gray-200 bg-white text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all text-gray-600"
                          >
                            <option value="days">Days</option>
                            <option value="hours">Hours</option>
                          </select>
                        </div>
                        <button
                          onClick={() => addSprint(level.id)}
                          className="px-6 py-3 bg-gray-900 text-white rounded-lg hover:bg-black transition-all font-semibold text-sm active:scale-95 flex items-center justify-center gap-2 flex-shrink-0 whitespace-nowrap"
                        >
                          <Plus size={18} /> Add Goal
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <AnimatePresence initial={false}>
                      {level.sprints.map((sprint) => (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.8 }}
                          key={sprint.id}
                          className="flex items-center justify-between p-4 bg-white border border-gray-100 rounded-lg text-sm group/sprint hover:border-blue-200 transition-all"
                        >
                          <div className="flex flex-col gap-1 overflow-hidden">
                            <span className="font-semibold text-gray-700 truncate text-sm">{sprint.name}</span>
                            {sprint.completionTime && (
                              <span className="text-xs font-medium text-blue-600 flex items-center gap-1 uppercase">
                                <Clock size={12} /> {sprint.completionTime} {sprint.timeUnit === 'hours' ? 'hours' : 'days'}
                              </span>
                            )}
                          </div>
                          <button
                            onClick={() => removeSprint(level.id, sprint.id)}
                            className="text-gray-300 hover:text-red-500 transition-colors ml-2 p-1.5"
                          >
                            <X size={16} />
                          </button>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                    {level.sprints.length === 0 && (
                      <div className="w-full col-span-2 text-center py-6 border border-dashed border-gray-200 rounded-lg">
                        <p className="text-sm font-medium text-gray-300">No goals defined</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        <div className="pt-4 border-t border-gray-100 flex justify-end">
          <button
            onClick={handleSubmit}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg font-semibold flex items-center gap-2 transition-all active:scale-95 text-sm"
          >
            <CheckCircle2 size={18} />
            Submit for Preview
          </button>
        </div>
      </section>

      {/* Submitted Journey Preview */}
      <AnimatePresence>
        {submittedJourney && (
          <motion.section
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="space-y-6"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-2 h-8 bg-blue-600 rounded-full" />
                <h2 className="text-2xl font-black text-gray-900 tracking-tight italic">
                  {isAlreadyPublished ? 'Publish Complete' : 'Draft Ready'}
                </h2>
              </div>
              <div className="flex items-center gap-4">
                <button
                  onClick={handleEdit}
                  className="flex items-center gap-2 px-6 py-3 text-gray-600 hover:bg-gray-100 rounded-2xl font-black transition-all text-sm uppercase tracking-wider"
                >
                  <Edit2 size={18} />
                  {isAlreadyPublished ? 'Modify Original' : 'Edit'}
                </button>
                {!isAlreadyPublished ? (
                  <button
                    onClick={handlePublish}
                    className="flex items-center gap-3 px-8 py-4 bg-green-600 hover:bg-green-700 text-white rounded-2xl font-black transition-all shadow-xl shadow-green-500/20 active:scale-95 uppercase tracking-wider"
                  >
                    <Rocket size={20} />
                    Publish Live
                  </button>
                ) : (
                  <div className="flex items-center gap-3 px-8 py-4 bg-blue-50 text-blue-600 rounded-2xl font-black uppercase tracking-wider border border-blue-100 italic">
                    <CheckCircle2 size={20} />
                    Live on Dashboard
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white p-10 rounded-[2.5rem] border border-gray-100 shadow-2xl shadow-blue-900/10">
              <div className="flex items-center justify-between mb-10 pb-8 border-b border-gray-50">
                <div className="flex items-center gap-6">
                  <div className="w-16 h-16 bg-blue-50 rounded-3xl flex items-center justify-center text-blue-600 shadow-inner">
                    <Briefcase size={32} />
                  </div>
                  <div>
                    <h3 className="text-4xl font-black text-gray-900 tracking-tighter leading-none mb-2">{submittedJourney.roleName}</h3>
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-black text-white bg-blue-600 px-3 py-1 rounded-full uppercase tracking-widest">
                        {submittedJourney.levels.length} LEVELS
                      </span>
                      <span className="text-xs font-black text-gray-400 uppercase tracking-widest">
                        {submittedJourney.levels.reduce((acc, l) => acc + l.sprints.length, 0)} SPRINTS
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-10 relative before:absolute before:left-[21px] before:top-6 before:bottom-6 before:w-1 before:bg-gradient-to-b before:from-blue-600 before:to-gray-100 before:rounded-full">
                {submittedJourney.levels.map((level) => (
                  <div key={level.id} className="relative z-10 flex gap-10 group">
                    <div className="w-11 h-11 bg-blue-600 rounded-2xl flex items-center justify-center text-white font-black text-lg shadow-xl shadow-blue-500/30 border-4 border-white transition-transform group-hover:scale-110">
                      {level.levelNumber}
                    </div>
                    <div className="flex-1 bg-gray-50/50 p-8 rounded-[2rem] border border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-8 group hover:bg-white hover:shadow-2xl hover:shadow-blue-900/5 transition-all duration-500">
                        <div className="space-y-6 flex-1">
                          <div className="flex items-center gap-4">
                            <h4 className="font-black text-gray-900 text-2xl tracking-tight">Level {level.levelNumber}</h4>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {level.sprints.map((s) => (
                            <div key={s.id} className="flex flex-col gap-1 p-5 bg-white border border-gray-100 rounded-2xl shadow-sm group-hover:border-blue-200 transition-all">
                              <span className="text-gray-700 font-black uppercase text-xs tracking-wide">
                                {s.name}
                              </span>
                              {s.completionTime && (
                                <span className="text-[10px] font-black text-blue-600 flex items-center gap-1 uppercase tracking-widest opacity-70">
                                  <Clock size={10} /> {s.completionTime} {s.timeUnit === 'hours' ? 'hours' : 'days'}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {/* Drafts List */}
      {draftJourneys.length > 0 && (
        <section className="pt-20 space-y-8">
          <div className="flex items-center gap-4">
            <div className="w-12 h-1 bg-blue-100 rounded-full" />
            <h2 className="text-2xl font-black text-gray-900 uppercase tracking-tighter italic">Saved Drafts</h2>
            <div className="flex-1 h-1 bg-blue-100 rounded-full" />
          </div>

          <div className="grid grid-cols-1 gap-6">
            <AnimatePresence>
              {draftJourneys.map((journey) => (
                <motion.div
                  layout
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  key={journey.id}
                  className={`bg-white rounded-[2rem] border border-gray-100 shadow-xl overflow-hidden group transition-all duration-300 ${
                    expandedId === journey.id ? 'shadow-blue-900/10 border-blue-100' : 'shadow-gray-200/20'
                  } ${submittedJourney?.id === journey.id ? 'ring-4 ring-blue-600 ring-offset-4' : ''}`}
                >
                  <div 
                    className="p-6 flex items-center justify-between gap-8"
                  >
                    <div 
                      onClick={() => {
                        setSubmittedJourney(journey);
                        setEditingDraftId(journey.id);
                      }}
                      className="flex items-center gap-6 cursor-pointer flex-1"
                    >
                      <div className="w-16 h-16 bg-blue-50 rounded-3xl flex items-center justify-center text-blue-400 group-hover:bg-blue-100 group-hover:text-blue-600 transition-all shadow-inner">
                        <Layers size={28} />
                      </div>
                      <div>
                        <h3 className="text-2xl font-black text-gray-900 tracking-tighter uppercase">{journey.roleName}</h3>
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-1">
                          {journey.levels.length} Levels • {journey.levels.reduce((acc, l) => acc + l.sprints.length, 0)} SPRINTS
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      {submittedJourney?.id === journey.id && (
                        <div className="px-4 py-2 bg-blue-600 text-white font-black text-[10px] rounded-full uppercase tracking-widest border border-blue-500 shadow-lg shadow-blue-500/20 animate-pulse">
                          PREVIEWING
                        </div>
                      )}
                      {!isAlreadyPublished && (
                        <div className="px-4 py-2 bg-yellow-50 text-yellow-600 font-black text-[10px] rounded-full uppercase tracking-widest border border-yellow-100">
                          DRAFT
                        </div>
                      )}
                      <button
                        onClick={() => setExpandedId(expandedId === journey.id ? null : journey.id)}
                        className={`w-12 h-12 flex items-center justify-center bg-gray-50 text-gray-400 rounded-2xl transition-all border border-gray-100 active:scale-95 ${expandedId === journey.id ? 'rotate-90 text-blue-600 bg-blue-50' : ''}`}
                      >
                        <ChevronRight size={20} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (submittedJourney?.id === journey.id) setSubmittedJourney(null);
                          handleDelete(journey.id, false);
                        }}
                        className="w-12 h-12 flex items-center justify-center bg-white text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-2xl transition-all border border-gray-100 active:scale-95"
                      >
                        <Trash2 size={20} />
                      </button>
                    </div>
                  </div>

                  <AnimatePresence>
                    {expandedId === journey.id && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="border-t border-gray-50 bg-gray-50/30 p-8"
                      >
                        <div className="flex flex-col gap-8 relative before:absolute before:left-[17px] before:top-4 before:bottom-4 before:w-0.5 before:bg-gradient-to-b before:from-blue-600 before:to-gray-100">
                          {journey.levels.map((level) => (
                            <div key={level.id} className="relative z-10 flex gap-6">
                              <div className="w-9 h-9 bg-blue-600 rounded-full flex items-center justify-center text-white font-black text-sm shadow-lg shadow-blue-500/20 border-4 border-white">
                                {level.levelNumber}
                              </div>
                              <div className="flex-1 bg-white p-6 rounded-2xl border border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-6 group/item hover:shadow-md transition-all">
                                <div className="space-y-4">
                                  <h4 className="font-bold text-gray-900 text-lg tracking-tight uppercase">Level {level.levelNumber}</h4>
                                  <div className="flex flex-wrap gap-2">
                                    {level.sprints.map((s) => (
                                      <span key={s.id} className="px-3 py-1 bg-gray-50 border border-gray-100 rounded-lg text-sm text-gray-600 font-bold uppercase tracking-wide">
                                        {s.name}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="mt-8 pt-8 border-t border-gray-100 flex justify-end">
                           <button
                            onClick={() => {
                              setSubmittedJourney(journey);
                              setEditingDraftId(journey.id);
                              window.scrollTo({ top: 300, behavior: 'smooth' });
                            }}
                            className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-lg shadow-blue-500/20 hover:bg-blue-700 transition-all"
                          >
                            Preview This Draft
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </section>
      )}

      {/* Published Journeys List */}
      {publishedJourneys.length > 0 && (
        <section className="pt-20 space-y-8">
          <div className="flex items-center gap-4">
            <div className="w-12 h-1 bg-gray-200 rounded-full" />
            <h2 className="text-2xl font-black text-gray-900 uppercase tracking-tighter italic">Manage Published Journeys</h2>
            <div className="flex-1 h-1 bg-gray-200 rounded-full" />
          </div>

          <div className="grid grid-cols-1 gap-6">
            <AnimatePresence>
              {publishedJourneys.map((journey) => (
                <motion.div
                  layout
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  key={journey.id}
                  className={`bg-white rounded-[2rem] border border-gray-100 shadow-xl overflow-hidden group transition-all duration-300 ${
                    expandedId === journey.id ? 'shadow-blue-900/10 border-blue-100' : 'shadow-gray-200/20'
                  }`}
                >
                  <div 
                    onClick={() => setExpandedId(expandedId === journey.id ? null : journey.id)}
                    className="p-6 flex items-center justify-between gap-8 cursor-pointer hover:bg-gray-50/50 transition-colors"
                  >
                    <div className="flex items-center gap-6">
                      <div className="w-16 h-16 bg-gray-50 rounded-3xl flex items-center justify-center text-gray-400 group-hover:bg-blue-50 group-hover:text-blue-600 transition-all shadow-inner">
                        <Briefcase size={28} />
                      </div>
                      <div>
                        <h3 className="text-2xl font-black text-gray-900 tracking-tighter uppercase">{journey.roleName}</h3>
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-1">
                          {journey.levels.length} Levels • {journey.levels.reduce((acc, l) => acc + l.sprints.length, 0)} SPRINTS
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="px-4 py-2 bg-green-50 text-green-600 font-black text-[10px] rounded-full uppercase tracking-widest border border-green-100">
                        LIVE ON DASHBOARD
                      </div>
                      <ChevronRight 
                        size={20} 
                        className={`text-gray-300 transition-transform duration-300 ${expandedId === journey.id ? 'rotate-90 text-blue-600' : ''}`} 
                      />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(journey.id, true);
                        }}
                        className="w-12 h-12 flex items-center justify-center bg-white text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-2xl transition-all border border-gray-100 active:scale-95"
                      >
                        <Trash2 size={20} />
                      </button>
                    </div>
                  </div>

                  <AnimatePresence>
                    {expandedId === journey.id && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="border-t border-gray-50 bg-gray-50/30 p-8"
                      >
                        <div className="flex flex-col gap-8 relative before:absolute before:left-[17px] before:top-4 before:bottom-4 before:w-0.5 before:bg-gradient-to-b before:from-blue-600 before:to-gray-100">
                          {journey.levels.map((level) => (
                            <div key={level.id} className="relative z-10 flex gap-6">
                              <div className="w-9 h-9 bg-blue-600 rounded-full flex items-center justify-center text-white font-black text-sm shadow-lg shadow-blue-500/20 border-4 border-white">
                                {level.levelNumber}
                              </div>
                              <div className="flex-1 bg-white p-6 rounded-2xl border border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-6 group/item hover:shadow-md transition-all">
                                <div className="space-y-4">
                                  <h4 className="font-bold text-gray-900 text-lg tracking-tight uppercase">Level {level.levelNumber}</h4>
                                  <div className="flex flex-wrap gap-2">
                                    {level.sprints.map((s) => (
                                      <span key={s.id} className="px-3 py-1 bg-gray-50 border border-gray-100 rounded-lg text-sm text-gray-600 font-bold uppercase tracking-wide">
                                        {s.name}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </section>
      )}
      </div>
    </div>
  );
}
