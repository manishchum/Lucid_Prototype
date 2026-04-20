'use client';

import { useState, useEffect } from 'react';
import { CareerJourneyDB } from '@/lib/types/career-journey';
import { Briefcase, ChevronRight, Zap, ArrowLeft, Star, Target, Layers, Clock, Loader2, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { getPublishedJourneys } from '@/lib/careerJourneyDatabase';

interface Sprint {
  id: string;
  name: string;
  completionTime?: string;
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
  dbId?: string;
  status?: 'draft' | 'published';
}

interface SkillUpgradeProps {
  onNotification?: (message: string, type: 'success' | 'error' | 'info') => void;
}

export default function SkillUpgrade({ onNotification }: SkillUpgradeProps) {
  const [publishedJourneys, setPublishedJourneys] = useState<CareerJourney[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedJourney, setSelectedJourney] = useState<CareerJourney | null>(null);
  const [activeLevel, setActiveLevel] = useState<Level | null>(null);

  // Transform database format to UI format
  const transformDBToUI = (dbJourney: CareerJourneyDB): CareerJourney => {
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
      level.sprints.push({
        id: skill.id,
        name: skill.title,
        completionTime: skill.estimatedHours ? `${skill.estimatedHours}h` : '',
      });
    });

    const transformedLevels = Array.from(levelsMap.values()).sort((a, b) => a.levelNumber - b.levelNumber);

    return {
      id: dbJourney.id!,
      roleName: dbJourney.title,
      levels: transformedLevels.length > 0 ? transformedLevels : [{ id: 'l1', levelNumber: 1, sprints: [], thresholdScore: 0 }],
      dbId: dbJourney.id,
      status: 'published',
    };
  };

  useEffect(() => {
    loadPublishedJourneys();
  }, []);

  const loadPublishedJourneys = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getPublishedJourneys();
      if (result.error) {
        setError(result.error);
        onNotification?.(result.error, 'error');
      } else if (result.data) {
        const transformedJourneys = result.data.map(db => transformDBToUI(db));
        setPublishedJourneys(transformedJourneys);
      }
    } catch (err: any) {
      const errorMsg = err.message || 'Failed to load career journeys';
      setError(errorMsg);
      onNotification?.(errorMsg, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectJourney = (journey: CareerJourney) => {
    setSelectedJourney(journey);
    setActiveLevel(journey.levels[0]);
  };

  const handleBack = () => {
    setSelectedJourney(null);
    setActiveLevel(null);
  };

  // --- Loading State ---
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-400">
        <div className="w-16 h-16 bg-gray-50 rounded-2xl flex items-center justify-center mb-4 border border-gray-100">
          <Loader2 size={32} className="text-blue-600 animate-spin" />
        </div>
        <p className="text-sm font-bold text-gray-400 uppercase tracking-widest">Loading journeys...</p>
      </div>
    );
  }

  // --- Error State ---
  if (error && publishedJourneys.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center justify-center py-20 gap-4"
      >
        <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center border border-red-100">
          <AlertCircle size={32} className="text-red-400" />
        </div>
        <div className="text-center">
          <h3 className="text-lg font-bold text-gray-600">Failed to load journeys</h3>
          <p className="text-sm text-gray-400 mt-1">{error}</p>
        </div>
        <button
          onClick={loadPublishedJourneys}
          className="px-6 py-2.5 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 transition-all"
        >
          Try Again
        </button>
      </motion.div>
    );
  }

  // --- Empty State ---
  if (publishedJourneys.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-400">
        <div className="w-16 h-16 bg-gray-50 rounded-2xl flex items-center justify-center mb-4 border border-gray-100">
          <Zap size={32} className="opacity-20" />
        </div>
        <h3 className="text-lg font-bold text-gray-600">No journeys available yet</h3>
        <p className="text-sm">Please wait for the admin to publish career journeys.</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-20">
      <AnimatePresence mode="wait">
        {!selectedJourney ? (
          // ── Journey List ──────────────────────────────────────────────────────
          <motion.div
            key="list"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="space-y-8"
          >
            <div className="bg-white rounded-xl shadow-sm p-8 border border-slate-200 mb-8">
            <h1 className="text-3xl font-bold text-gray-800 mb-2">
              Available Skill Upgrades
            </h1>
            {/* <p className="text-slate-600">
              Send nudge emails or WhatsApp messages to employees assigned to a sprint.
            </p> */}
          </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {publishedJourneys.map((journey) => (
                <motion.div
                  whileHover={{ y: -2 }}
                  key={journey.id}
                  onClick={() => handleSelectJourney(journey)}
                  className="group bg-white p-6 rounded-xl border border-gray-200 hover:border-gray-300 hover:shadow-md transition-all duration-300 cursor-pointer"
                >
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                      <div className="w-12 h-12 bg-gray-50 rounded-lg flex items-center justify-center text-gray-400 group-hover:bg-blue-50 group-hover:text-blue-600 transition-all">
                        <Briefcase size={24} />
                      </div>
                      <div className="flex -space-x-2">
                        {journey.levels.map((_, i) => (
                          <div key={i} className="w-7 h-7 rounded-full bg-white border border-gray-200 flex items-center justify-center text-[9px] font-semibold text-gray-600">
                            {i + 1}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <h3 className="text-lg font-bold text-gray-900 group-hover:text-blue-600 transition-colors">
                        {journey.roleName}
                      </h3>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-1 rounded-md">
                          {journey.levels.length} LEVELS
                        </span>
                        <span className="text-xs font-medium text-gray-500">
                          {journey.levels.reduce((acc, l) => acc + l.sprints.length, 0)} SPRINTS
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                      <span className="text-xs font-semibold text-gray-500 flex items-center gap-1">
                        <Star size={12} className="text-yellow-400 fill-yellow-400" /> Professional
                      </span>
                      <ChevronRight size={18} className="text-gray-300 group-hover:text-blue-600 transition-colors" />
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        ) : (
          // ── Journey Detail ────────────────────────────────────────────────────
          <motion.div
            key="details"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="space-y-12"
          >
            <button
              onClick={handleBack}
              className="flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-6 transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
              <span className="font-medium">Back to Scenarios</span>
            </button>            <div className="flex flex-col gap-16">
              {/* Role Title */}
              <div className="w-full text-center space-y-4">
                <h2 className="text-5xl md:text-6xl font-black text-gray-900 tracking-tighter uppercase leading-tight">
                  {selectedJourney.roleName}
                </h2>
                <div className="flex items-center justify-center gap-4">
                  <div className="flex items-center gap-2 px-5 py-2.5 bg-yellow-50 text-yellow-700 rounded-2xl font-black text-[10px] uppercase tracking-[0.15em] border border-yellow-100/50">
                    <Target size={14} /> Path Master
                  </div>
                  <div className="flex items-center gap-2 px-5 py-2.5 bg-purple-50 text-purple-700 rounded-2xl font-black text-[10px] uppercase tracking-[0.15em] border border-purple-100/50">
                    <Layers size={14} /> {selectedJourney.levels.length} LEVELS
                  </div>
                </div>
              </div>

              <div className="flex flex-col xl:flex-row items-center xl:items-start gap-12 w-full">
                {/* Circular Progression Map */}
                <div className="shrink-0 transform xl:scale-90 2xl:scale-100 transition-transform">
                  <div className="relative w-[440px] h-[440px] flex items-center justify-center bg-white rounded-full shadow-[0_0_100px_rgba(59,130,246,0.03)] border border-gray-50">
                    <div className="absolute inset-4 border-[1px] border-dashed border-gray-100 rounded-full" />
                    <div className="absolute inset-12 border-[20px] border-gray-50/50 rounded-full" />

                    {/* Center Icon */}
                    <motion.div
                      layoutId="journey-icon"
                      className="w-36 h-36 bg-white rounded-full shadow-[0_20px_50px_rgba(0,0,0,0.08)] border-4 border-blue-50 flex items-center justify-center text-blue-600 z-20"
                    >
                      <Briefcase size={56} />
                    </motion.div>

                    {/* Level Nodes */}
                    {selectedJourney.levels.map((level, index) => {
                      const total = selectedJourney.levels.length;
                      const angle = (index * (360 / total) - 90) * (Math.PI / 180);
                      const x = Math.cos(angle) * 175;
                      const y = Math.sin(angle) * 175;
                      const isActive = activeLevel?.id === level.id;

                      return (
                        <motion.button
                          key={level.id}
                          initial={{ opacity: 0, scale: 0 }}
                          animate={{ opacity: 1, scale: 1, x, y }}
                          transition={{ delay: index * 0.1 }}
                          onClick={() => setActiveLevel(level)}
                          className={`absolute w-20 h-20 rounded-[1.75rem] flex flex-col items-center justify-center transition-all z-30 group ${
                            isActive
                              ? 'bg-blue-600 text-white shadow-2xl shadow-blue-500/40 scale-110 -translate-y-1'
                              : 'bg-white text-gray-400 border border-gray-100 hover:border-blue-400 hover:text-blue-600 shadow-xl shadow-gray-200/20'
                          }`}
                        >
                          <span className={`text-[10px] font-black uppercase tracking-tighter leading-none mb-1 ${isActive ? 'opacity-70' : 'opacity-40'}`}>Level</span>
                          <span className="text-2xl font-black leading-none">{level.levelNumber}</span>
                          {isActive && (
                            <motion.div
                              layoutId="active-glow"
                              className="absolute -inset-2 bg-blue-100/50 rounded-[2.25rem] -z-10 blur-sm"
                            />
                          )}
                        </motion.button>
                      );
                    })}

                    {/* Dashed Ring */}
                    <svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none overflow-visible">
                      <circle
                        cx="220" cy="220" r="175"
                        fill="none"
                        stroke="#F3F4F6"
                        strokeWidth="2"
                        strokeDasharray="8 8"
                      />
                    </svg>
                  </div>
                </div>

                {/* Phase Detail Panel */}
                <div className="flex-1 w-full min-w-0">
                  <AnimatePresence mode="wait">
                    {activeLevel && (
                      <motion.div
                        key={activeLevel.id}
                        initial={{ opacity: 0, x: 30 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -30 }}
                        className="bg-white p-10 rounded-[3.5rem] border border-gray-100 shadow-2xl shadow-blue-900/10 relative overflow-hidden h-full min-h-[440px]"
                      >
                        <div className="relative z-10 space-y-10">
                          <div className="pb-8 border-b border-gray-50">
                            <div className="flex items-center gap-5">
                              <div className="w-14 h-14 bg-blue-600 text-white rounded-2xl flex items-center justify-center font-black text-2xl shadow-xl shadow-blue-500/20">
                                {activeLevel.levelNumber}
                              </div>
                              <div>
                                <h3 className="font-black text-3xl text-gray-900 uppercase tracking-tight">Level {activeLevel.levelNumber}</h3>
                                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-2">
                                  Master {activeLevel.sprints.length} Core Skills for this stage
                                </p>
                              </div>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {activeLevel.sprints.map((sprint, i) => (
                              <motion.div
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ delay: i * 0.05 }}
                                key={sprint.id}
                                className="group/sprint p-6 bg-gray-50/50 hover:bg-white rounded-[2rem] border border-gray-50 hover:border-blue-100 hover:shadow-xl transition-all flex flex-col gap-4 relative overflow-hidden"
                              >
                                <div className="flex items-center justify-between">
                                  <div className="w-10 h-10 bg-white rounded-2xl border border-gray-100 flex items-center justify-center group-hover/sprint:bg-blue-600 group-hover/sprint:text-white transition-all shadow-sm">
                                    <Zap size={18} />
                                  </div>
                                  <span className="text-[10px] font-black text-blue-600 hover:underline cursor-pointer opacity-0 group-hover/sprint:opacity-100 transition-opacity uppercase tracking-widest">
                                    START
                                  </span>
                                </div>
                                <div className="flex flex-col gap-1">
                                  <span className="font-black text-gray-800 group-hover/sprint:text-blue-600 transition-colors uppercase text-sm tracking-tight leading-snug">
                                    {sprint.name}
                                  </span>
                                  {sprint.completionTime && (
                                    <div className="flex items-center gap-1.5 text-[10px] font-black text-blue-500 uppercase tracking-widest opacity-70">
                                      <Clock size={12} /> {sprint.completionTime}
                                    </div>
                                  )}
                                </div>
                              </motion.div>
                            ))}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}