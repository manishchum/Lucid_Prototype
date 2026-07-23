'use client';

import { useState, useEffect, type CSSProperties } from 'react';
import { CareerJourneyDB } from '@/lib/types/career-journey';
import { Briefcase, ChevronRight, Zap, ArrowLeft, Star, Target, Layers, Clock, Loader2, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { fetchWithAuth } from '@/lib/fetch-with-auth';

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

interface Sprint {
  id: string;
  name: string;
  completionTime?: string;
  timeUnit?: 'days' | 'hours' | 'weeks' | 'months';
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
const titleCase = (value: string) => {
  return value
    .replace(/[_-]/g, ' ')
    .replace(/\b\w+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .replace(/\s+/g, ' ')
    .trim();
};
// ─── Shared glass style ────────────────────────────────────────────────────────
const glass: CSSProperties = {
  background: 'rgba(255,255,255,0.02)',
  backdropFilter: 'blur(16px)',
  border: '1px solid rgba(255,255,255,0.05)',
  boxShadow: '0 8px 32px 0 rgba(0,0,0,0.3)',
};

// ─── StarField ─────────────────────────────────────────────────────────────────
function StarField() {
  const [stars, setStars] = useState<{ id: number; x: number; y: number; size: number; duration: number }[]>([]);

  useEffect(() => {
    const newStars = Array.from({ length: 150 }).map((_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 2 + 1,
      duration: Math.random() * 3 + 2,
    }));
    setStars(newStars);
  }, []);

  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden" style={{ background: '#05050a' }}>
      {/* Nebula Gradients */}
      <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] rounded-full" style={{ background: 'rgba(88,28,135,0.10)', filter: 'blur(120px)' }} />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full" style={{ background: 'rgba(29,78,216,0.10)', filter: 'blur(100px)' }} />

      {/* Shooting Stars */}
      {[0, 1, 2].map((i) => (
        <motion.div
          key={`shoot-${i}`}
          className="absolute h-px"
          style={{
            width: 100,
            background: 'linear-gradient(to right, transparent, white, transparent)',
            top: `${20 + i * 15}%`,
            left: -100,
            rotate: '25deg',
          }}
          animate={{ x: ['0vw', '120vw'], y: ['0vh', '50vh'], opacity: [0, 1, 0] }}
          transition={{ duration: 2, repeat: Infinity, delay: i * 8 + 2, ease: 'easeOut' }}
        />
      ))}

      {/* Twinkling Stars */}
      {stars.map((star) => (
        <motion.div
          key={star.id}
          className="absolute bg-white rounded-full"
          style={{ left: `${star.x}%`, top: `${star.y}%`, width: star.size, height: star.size, opacity: 0 }}
          animate={{ opacity: [0, 0.8, 0] }}
          transition={{ duration: star.duration, repeat: Infinity, delay: Math.random() * 5 }}
        />
      ))}
    </div>
  );
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
        completionTime: skill.estimatedHours ? `${skill.estimatedHours}` : '',
        timeUnit: skill.timeUnit || 'hours',
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
      const response = await fetchWithAuth(
        `${API_BASE}/api/career-journeys?status=published`
      );
      const result = await response.json();

      if (!response.ok) {
        const errorMsg = result?.error || result?.message || response.statusText || 'Failed to load career journeys';
        setError(errorMsg);
        onNotification?.(errorMsg, 'error');
        return;
      }

      const transformedJourneys = (result.data || []).map((db: CareerJourneyDB) => transformDBToUI(db));
      setPublishedJourneys(transformedJourneys);
    } catch (err: any) {
      const errorMsg = err?.message || 'Failed to load career journeys';
      setError(errorMsg);
      onNotification?.(errorMsg, 'error');
      setPublishedJourneys([]);
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

  // ── Loading State ────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center"
        style={{ fontFamily: "'Space Grotesk', ui-sans-serif, system-ui, sans-serif" }}
      >
        <StarField />
        <div className="relative z-10 flex flex-col items-center gap-4">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center"
            style={glass}
          >
            <Loader2 size={28} className="text-blue-400 animate-spin" />
          </div>
          <p className="text-[10px] font-black text-slate-600 uppercase tracking-[0.4em]">Loading journeys…</p>
        </div>
      </div>
    );
  }

  // ── Error State ──────────────────────────────────────────────────────────────
  if (error && publishedJourneys.length === 0) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center"
        style={{ fontFamily: "'Space Grotesk', ui-sans-serif, system-ui, sans-serif" }}
      >
        <StarField />
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative z-10 flex flex-col items-center gap-5 text-center"
        >
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center"
            style={{ ...glass, border: '1px solid rgba(239,68,68,0.2)' }}
          >
            <AlertCircle size={28} className="text-red-400" />
          </div>
          <div>
            <h3 className="text-lg font-black text-slate-300 uppercase tracking-tight">Failed to load journeys</h3>
            <p className="text-sm text-slate-600 mt-1">{error}</p>
          </div>
          <button
            onClick={loadPublishedJourneys}
            className="px-6 py-2.5 text-white rounded-xl font-black text-xs uppercase tracking-widest transition-all active:scale-95"
            style={{ background: '#2563eb', boxShadow: '0 4px 20px rgba(37,99,235,0.3)' }}
          >
            Try Again
          </button>
        </motion.div>
      </div>
    );
  }

  // ── Empty State ──────────────────────────────────────────────────────────────
  if (publishedJourneys.length === 0) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center"
        style={{ fontFamily: "'Space Grotesk', ui-sans-serif, system-ui, sans-serif" }}
      >
        <StarField />
        <div className="relative z-10 flex flex-col items-center gap-4 text-center">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center"
            style={glass}
          >
            <Zap size={28} className="text-slate-700" />
          </div>
          <h3 className="text-lg font-black text-slate-400 uppercase tracking-tight">No Journeys Available yet</h3>
          <p className="text-sm text-slate-600">Please Wait For The Admin To Publish SprintVerse.</p>
        </div>
      </div>
    );
  }

  // ── Main View ────────────────────────────────────────────────────────────────
  return (
    <div
      className="min-h-screen pb-20 text-slate-100"
      style={{ background: '#05050a', fontFamily: "'Space Grotesk', ui-sans-serif, system-ui, sans-serif" }}
    >
      <StarField />

      <div className="relative z-10 max-w-6xl mx-auto px-6 py-10 space-y-8">
        <AnimatePresence mode="wait">
          {!selectedJourney ? (
            // ── Journey List ─────────────────────────────────────────────────
            <motion.div
              key="list"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-8"
            >
              {/* Header Card */}
              <div className="rounded-[2.5rem] p-10 py-12 relative overflow-hidden" style={glass}>
                <div className="relative z-10">
                  <h1 className="text-4xl font-bold tracking-tight text-white mb-2">SprintVerse</h1>
                  <p className="text-slate-400 font-medium">Select a career path to explore its journey</p>
                </div>
                {/* Orbital decoration */}
                <div className="absolute right-[5%] top-1/2 -translate-y-1/2 pointer-events-none flex items-center justify-center">
                  <div className="relative w-40 h-40 flex items-center justify-center">
                    <div className="absolute inset-0 border border-white/5 rounded-full" />
                    <div className="absolute inset-4 border border-white/5 rounded-full" />
                    <div className="absolute inset-10 border border-white/5 rounded-full" />
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
                      className="absolute inset-0"
                    >
                      <div
                        className="absolute top-0 left-1/2 -translate-x-1/2 w-3 h-3 bg-blue-500 rounded-full"
                        style={{ filter: 'blur(2px)', boxShadow: '0 0 10px rgba(59,130,246,0.5)' }}
                      />
                    </motion.div>
                    <Zap className="w-7 h-7 text-white/20" />
                  </div>
                </div>
              </div>

              {/* Journey Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {publishedJourneys.map((journey) => (
                  <motion.div
                    whileHover={{ y: -2, x: 4 }}
                    key={journey.id}
                    onClick={() => handleSelectJourney(journey)}
                    className="group rounded-[2rem] p-6 px-8 cursor-pointer transition-all duration-300"
                    style={glass}
                  >
                    <div className="flex flex-col gap-5">
                      <div className="flex items-center justify-between">
                        <div
                          className="w-14 h-14 rounded-2xl flex items-center justify-center transition-all duration-300 group-hover:bg-blue-600"
                          style={{ background: 'rgba(37,99,235,0.05)', border: '1px solid rgba(37,99,235,0.15)' }}
                        >
                          <Briefcase size={24} className="text-blue-500 group-hover:text-white transition-colors" />
                        </div>
                        {/* Level bubbles */}
                        <div className="flex -space-x-2">
                          {journey.levels.map((_, i) => (
                            <div
                              key={i}
                              className="w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-black text-slate-400"
                              style={{ background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(255,255,255,0.07)' }}
                            >
                              {i + 1}
                            </div>
                          ))}
                        </div>
                      </div>

                      <div>
                          <h3 className="text-lg font-bold text-white group-hover:text-blue-400 transition-colors tracking-tight leading-snug">
                            {titleCase(journey.roleName)}
                        </h3>
                        <div className="flex items-center gap-3 mt-3">
                          <span
                            className="text-[10px] font-black text-blue-400 px-3 py-1 rounded-full uppercase tracking-widest"
                            style={{ background: 'rgba(37,99,235,0.1)', border: '1px solid rgba(37,99,235,0.2)' }}
                          >
                            {journey.levels.length} Levels
                          </span>
                          <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">
                            {journey.levels.reduce((acc, l) => acc + l.sprints.length, 0)} Sprints
                          </span>
                        </div>
                      </div>

                      <div
                        className="flex items-center justify-between pt-4"
                        style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}
                      >
                        <span className="text-[10px] font-black text-slate-600 flex items-center gap-2 uppercase tracking-widest">
                          <Star size={11} className="text-yellow-500" style={{ fill: '#eab308' }} /> Professional
                        </span>
                        <ChevronRight size={18} className="text-slate-700 group-hover:text-blue-400 transition-colors" />
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          ) : (
            // ── Journey Detail ───────────────────────────────────────────────
            <motion.div
              key="details"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="space-y-10"
            >
              {/* Back button */}
              <button
                onClick={handleBack}
                className="flex items-center gap-2 text-slate-500 hover:text-slate-200 transition-colors font-medium text-sm"
              >
                <ArrowLeft className="w-5 h-5" />
                Back to Scenarios
              </button>

              <div className="flex flex-col gap-14">
                {/* Role Title */}
                <div className="w-full text-center space-y-5">
                  <h2 className="text-3xl md:text-4xl font-black text-white tracking-tighter leading-tight">
                    {titleCase(selectedJourney.roleName)}
                  </h2>
                  <div className="flex items-center justify-center gap-4">
                    <div
                      className="flex items-center gap-2 px-5 py-2.5 rounded-2xl font-black text-[10px] uppercase tracking-[0.15em]"
                      style={{ background: 'rgba(234,179,8,0.08)', color: '#fbbf24', border: '1px solid rgba(234,179,8,0.15)' }}
                    >
                      <Target size={13} /> Path Master
                    </div>
                    <div
                      className="flex items-center gap-2 px-5 py-2.5 rounded-2xl font-black text-[10px] uppercase tracking-[0.15em]"
                      style={{ background: 'rgba(139,92,246,0.08)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.15)' }}
                    >
                      <Layers size={13} /> {selectedJourney.levels.length} Levels
                    </div>
                  </div>
                </div>

                <div className="flex flex-col xl:flex-row items-center xl:items-start gap-12 w-full">
                  {/* Circular Progression Map */}
                  <div className="shrink-0 transform xl:scale-90 2xl:scale-100 transition-transform">
                    <div
                      className="relative w-[440px] h-[440px] flex items-center justify-center rounded-full"
                      style={{
                        background: 'rgba(255,255,255,0.015)',
                        border: '1px solid rgba(255,255,255,0.05)',
                        boxShadow: '0 0 80px rgba(37,99,235,0.06)',
                      }}
                    >
                      <div className="absolute inset-4 border border-dashed border-white/5 rounded-full" />
                      <div className="absolute inset-12 rounded-full" style={{ border: '16px solid rgba(255,255,255,0.02)' }} />

                      {/* Center Icon */}
                      <motion.div
                        layoutId="journey-icon"
                        className="w-36 h-36 rounded-full flex items-center justify-center text-blue-400 z-20"
                        style={{
                          background: 'rgba(15,23,42,0.9)',
                          border: '4px solid rgba(37,99,235,0.15)',
                          boxShadow: '0 20px 50px rgba(0,0,0,0.4)',
                        }}
                      >
                        <Briefcase size={52} />
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
                            className="absolute w-20 h-20 rounded-[1.75rem] flex flex-col items-center justify-center transition-all z-30"
                            style={
                              isActive
                                ? {
                                    background: '#2563eb',
                                    color: 'white',
                                    boxShadow: '0 0 40px rgba(37,99,235,0.5)',
                                    transform: `translate(${x}px, ${y}px) scale(1.1) translateY(-4px)`,
                                  }
                                : {
                                    background: 'rgba(15,23,42,0.9)',
                                    color: '#64748b',
                                    border: '1px solid rgba(255,255,255,0.07)',
                                    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                                    transform: `translate(${x}px, ${y}px)`,
                                  }
                            }
                          >
                            <span
                              className="text-[9px] font-black uppercase tracking-tighter leading-none mb-1"
                              style={{ opacity: isActive ? 0.7 : 0.4 }}
                            >
                              Level
                            </span>
                            <span className="text-2xl font-black leading-none">{level.levelNumber}</span>
                            {isActive && (
                              <motion.div
                                layoutId="active-glow"
                                className="absolute -inset-2 rounded-[2.25rem] -z-10"
                                style={{ background: 'rgba(37,99,235,0.15)', filter: 'blur(6px)' }}
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
                          stroke="rgba(255,255,255,0.05)"
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
                          className="rounded-[3.5rem] p-10 relative overflow-hidden min-h-[440px]"
                          style={glass}
                        >
                          <div className="relative z-10 space-y-10">
                            <div className="pb-8" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                              <div className="flex items-center gap-5">
                                <div
                                  className="w-14 h-14 rounded-2xl flex items-center justify-center font-black text-2xl text-white"
                                  style={{ background: '#2563eb', boxShadow: '0 8px 20px rgba(37,99,235,0.35)' }}
                                >
                                  {activeLevel.levelNumber}
                                </div>
                                <div>
                                  <h3 className="font-black text-3xl text-white tracking-tight">
                                    Level {activeLevel.levelNumber}
                                  </h3>
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
                                  className="group/sprint p-6 rounded-[2rem] flex flex-col gap-4 relative overflow-hidden transition-all"
                                  style={{
                                    background: 'rgba(15,23,42,0.5)',
                                    border: '1px solid rgba(255,255,255,0.05)',
                                  }}
                                  onMouseEnter={(e) => {
                                    (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(37,99,235,0.3)';
                                    (e.currentTarget as HTMLDivElement).style.boxShadow = '0 8px 32px rgba(37,99,235,0.1)';
                                  }}
                                  onMouseLeave={(e) => {
                                    (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(255,255,255,0.05)';
                                    (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
                                  }}
                                >
                                  <div className="flex items-center justify-between">
                                    <div
                                      className="w-10 h-10 rounded-2xl flex items-center justify-center transition-all text-slate-500 group-hover/sprint:bg-blue-600 group-hover/sprint:text-white"
                                      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
                                    >
                                      <Zap size={16} />
                                    </div>
                                  </div>
                                  <div className="flex flex-col gap-1">
                                    <span className="font-black text-slate-200 group-hover/sprint:text-blue-400 transition-colors text-sm tracking-tight leading-snug">
                                      {titleCase(sprint.name)}
                                    </span>
                                    {sprint.completionTime && (
                                      <div className="flex items-center gap-1.5 text-[10px] font-black text-blue-400 uppercase tracking-widest opacity-70">
                                        <Clock size={11} />
                                        {sprint.completionTime}{' '}
                                        {titleCase(sprint.timeUnit || 'hours')}
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
    </div>
  );
}