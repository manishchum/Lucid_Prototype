'use client';

import { useAuth } from '@/contexts/auth-context';
import type { CareerJourneyDB } from '@/lib/types/career-journey';
import {
  createCareerJourney,
  updateCareerJourney,
  publishCareerJourney,
  deleteCareerJourney,
  getDraftJourneys,
  getPublishedJourneys,
} from '@/lib/careerJourneyDatabase';
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Layers, X, CheckCircle2, ChevronRight, Briefcase, Edit2, Rocket, Clock, Target } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// ─── Starfield Background ─────────────────────────────────────────────────────
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
      <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] rounded-full" style={{ background: 'rgba(88,28,135,0.10)', filter: 'blur(120px)' }} />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full" style={{ background: 'rgba(29,78,216,0.10)', filter: 'blur(100px)' }} />
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

// ─── Loading Progress ─────────────────────────────────────────────────────────
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
        return Math.min(prev + Math.max(1, Math.round(Math.random() * 7)), 93);
      });
    }, 420 + Math.round(Math.random() * 240));
    return () => clearInterval(id);
  }, [active]);

  return { progress: Math.min(progress, 100), show };
}

function LoadingProgress({ label, progress }: { label: string; progress: number }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: '#05050a' }}>
      <div className="w-full max-w-xl rounded-2xl p-6 space-y-4" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="flex items-center justify-between text-sm font-semibold text-slate-300">
          <span>{label}</span>
          <span className="text-white font-black">{progress}%</span>
        </div>
        <div className="relative h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
          <div
            className="absolute left-0 top-0 h-full transition-all duration-500 ease-out"
            style={{ width: `${progress}%`, background: 'linear-gradient(to right, #2563eb, #6366f1, #06b6d4)' }}
          />
        </div>
        <p className="text-xs text-slate-600 font-medium uppercase tracking-widest">Preparing +SprintVerse…</p>
      </div>
    </div>
  );
}

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

// ─── Glass style helper ───────────────────────────────────────────────────────
const glass: CSSProperties = {
  background: 'rgba(255,255,255,0.02)',
  backdropFilter: 'blur(16px)',
  border: '1px solid rgba(255,255,255,0.05)',
  boxShadow: '0 8px 32px 0 rgba(0,0,0,0.3)',
};

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

  const [roleName, setRoleName] = useState('');
  const [levels, setLevels] = useState<Level[]>([
    { id: 'l1', levelNumber: 1, sprints: [], thresholdScore: 0 }
  ]);
  const [sprintInputs, setSprintInputs] = useState<Record<string, string>>({});
  const [sprintTimeInputs, setSprintTimeInputs] = useState<Record<string, string>>({});
  const [sprintTimeUnits, setSprintTimeUnits] = useState<Record<string, 'days' | 'hours' | 'weeks' | 'months'>>({});
  const [notification, setNotification] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const [submittedJourney, setSubmittedJourney] = useState<CareerJourney | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [draftJourneys, setDraftJourneys] = useState<CareerJourney[]>([]);
  const [publishedJourneys, setPublishedJourneys] = useState<CareerJourney[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [mode, setMode] = useState<'studio' | 'manage'>('studio');

  useEffect(() => {
    if (!isLoading && userId && isAdmin) loadJourneys();
  }, [isLoading, userId, isAdmin]);

  const loadJourneys = async () => {
    if (!userId) return;
    try {
      const [draftsResult, publishedResult] = await Promise.all([
        getDraftJourneys(userId),
        getPublishedJourneys(),
      ]);
      if (draftsResult.data) setDraftJourneys(draftsResult.data.map(db => transformDBToUI(db, 'draft')));
      if (publishedResult.data) setPublishedJourneys(publishedResult.data.map(db => transformDBToUI(db, 'published')));
    } catch (error) {
      console.error('Failed to load journeys:', error);
      notify('error', 'Failed to load journeys');
    }
  };

  const notify = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 3000);
  };

  const transformDBToUI = (dbJourney: CareerJourneyDB, status: 'draft' | 'published'): CareerJourney => {
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
        timeUnit: skill.timeUnit || 'hours'
      });
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

  const transformUIToDB = (uiJourney: CareerJourney) => ({
    title: uiJourney.roleName,
    description: `Career progression path for ${uiJourney.roleName}`,
    skills: uiJourney.levels.flatMap((level) =>
      level.sprints.map((sprint) => ({
        id: sprint.id,
        title: sprint.name,
        description: '',
        level: (level.levelNumber === 1 ? 'beginner' : level.levelNumber === 2 ? 'intermediate' : 'advanced') as 'beginner' | 'intermediate' | 'advanced',
        estimatedHours: sprint.completionTime ? parseInt(sprint.completionTime) : undefined,
        timeUnit: sprint.timeUnit || 'days',
      }))
    ),
    connections: [],
    category: 'career-progression',
    tags: ['career-journey'],
  });

  const addLevel = () => {
    setLevels([...levels, { id: crypto.randomUUID(), levelNumber: levels.length + 1, sprints: [], thresholdScore: 0 }]);
  };

  const removeLevel = (id: string) => {
    if (levels.length <= 1) return;
    setLevels(levels.filter(l => l.id !== id).map((l, i) => ({ ...l, levelNumber: i + 1 })));
  };

  const updateLevel = (id: string, updates: Partial<Level>) =>
    setLevels(levels.map(l => l.id === id ? { ...l, ...updates } : l));

  const addSprint = (levelId: string) => {
    const name = sprintInputs[levelId]?.trim();
    if (!name) return;
    const level = levels.find(l => l.id === levelId);
    if (!level) return;
    if (level.sprints.some(s => s.name === name)) { notify('error', 'Sprint already exists in this level'); return; }
    const time = sprintTimeInputs[levelId]?.trim();
    const timeUnit = sprintTimeUnits[levelId] || 'days';
    updateLevel(levelId, { sprints: [...level.sprints, { id: crypto.randomUUID(), name, completionTime: time, timeUnit }] });
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
    if (!roleName) { notify('error', 'Please enter a role name'); return; }
    if (levels.some(l => l.sprints.length === 0)) { notify('error', 'Each level must have at least one sprint'); return; }
    if (!userId) { notify('error', 'User not authenticated'); return; }
    setIsSaving(true);
    try {
      const journeyData = transformUIToDB({ id: editingDraftId || `temp-${Date.now()}`, roleName, levels: JSON.parse(JSON.stringify(levels)) });
      console.debug('Submitting career journey payload:', journeyData);
      const result = editingDraftId
        ? await updateCareerJourney(editingDraftId, journeyData, userId)
        : await createCareerJourney(journeyData, userId);
      if (result.error) { notify('error', result.error); return; }
      const uiJourney = transformDBToUI(result.data!, 'draft');
      setSubmittedJourney(uiJourney);
      setDraftJourneys(prev => [uiJourney, ...prev.filter(j => j.dbId !== result.data!.id)]);
      notify('success', editingDraftId ? 'Draft updated!' : 'Journey saved to drafts!');
    } catch { notify('error', 'Failed to save journey'); }
    finally { setIsSaving(false); }
  };

  const handleEdit = () => {
    if (!submittedJourney) return;
    setMode('studio');
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
      const dbId = submittedJourney.dbId || submittedJourney.id;
      const result = await publishCareerJourney(dbId, userId);
      if (result.error) { notify('error', result.error); return; }
      const published = transformDBToUI(result.data!, 'published');
      setDraftJourneys(prev => prev.filter(j => j.dbId !== dbId));
      setPublishedJourneys([published, ...publishedJourneys]);
      setSubmittedJourney(published);
      notify('success', 'Journey published successfully!');
    } catch { notify('error', 'Failed to publish journey'); }
    finally { setIsPublishing(false); }
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
      if (result.error) { notify('error', result.error); return; }
      if (isPublished) setPublishedJourneys(prev => prev.filter(j => j.dbId !== id));
      else setDraftJourneys(prev => prev.filter(j => j.dbId !== id));
      notify('success', 'Journey deleted successfully');
    } catch { notify('error', 'Failed to delete journey'); }
  };

  if (isLoading || !userId) {
    return showLoadingProgress
      ? <LoadingProgress label="Loading career journeys..." progress={loadingProgress} />
      : (
        <div className="flex items-center justify-center h-screen" style={{ background: '#05050a' }}>
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4" />
            <p className="text-slate-500 text-sm font-medium uppercase tracking-widest">Loading…</p>
          </div>
        </div>
      );
  }

  return (
    <div className="min-h-screen pb-6 selection:bg-blue-500/30 text-slate-100" style={{ fontFamily: "'Space Grotesk', ui-sans-serif, system-ui, sans-serif" }}>
      <StarField />

      {/* ── Toast Notification ── */}
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3 rounded-2xl font-bold shadow-2xl"
            style={{
              background: notification.type === 'success' ? 'rgba(37,99,235,0.95)' : 'rgba(220,38,38,0.95)',
              border: `1px solid ${notification.type === 'success' ? 'rgba(59,130,246,0.5)' : 'rgba(239,68,68,0.5)'}`,
              backdropFilter: 'blur(16px)',
            }}
          >
            {notification.type === 'success' ? <CheckCircle2 size={16} /> : <X size={16} />}
            <span className="text-sm">{notification.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="relative z-10 max-w-5xl mx-auto px-6 py-4 space-y-3">
        {/* ── Mode Toggle (Studio / Manage) ── */}
        <div className="flex items-center justify-start">
          <div className="rounded-full bg-white/5 p-1 flex items-center gap-1" role="tablist" aria-label="Career journeys view switch">
            <button
              onClick={() => setMode('studio')}
              aria-pressed={mode === 'studio'}
              className={`px-4 py-1.5 rounded-full text-xs font-black transition-colors ${mode === 'studio' ? 'bg-white/10 text-white' : 'text-slate-400'}`}
            >
              Builder
            </button>
            <button
              onClick={() => setMode('manage')}
              aria-pressed={mode === 'manage'}
              className={`px-4 py-1.5 rounded-full text-xs font-black transition-colors ${mode === 'manage' ? 'bg-white/10 text-white' : 'text-slate-400'}`}
            >
              Manage
            </button>
          </div>
        </div>

        {mode === 'studio' && (
          <>
            {/* ── Header Card ── */}
            <div className="rounded-2xl px-6 py-4 relative overflow-hidden" style={glass}>
              <div className="relative z-10 flex items-center gap-4">
                <div>
                  <h1 className="text-2xl font-bold tracking-tight text-white leading-none mb-0.5">+SprintVerse</h1>
                  <p className="text-slate-400 text-sm font-medium">Create New SprintVerse</p>
                </div>
              </div>
              {/* Compact orbital decoration */}
              <div className="absolute right-6 top-1/2 -translate-y-1/2 pointer-events-none flex items-center justify-center">
                <div className="relative w-16 h-16 flex items-center justify-center">
                  <div className="absolute inset-0 border border-white/5 rounded-full" />
                  <div className="absolute inset-2 border border-white/5 rounded-full" />
                  <motion.div animate={{ rotate: 360 }} transition={{ duration: 20, repeat: Infinity, ease: 'linear' }} className="absolute inset-0">
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-2 h-2 bg-blue-500 rounded-full" style={{ boxShadow: '0 0 6px rgba(59,130,246,0.5)' }} />
                  </motion.div>
                  <Briefcase className="w-4 h-4 text-white/20" />
                </div>
              </div>
            </div>

            {/* ── Role Name ── */}
            <div className="rounded-2xl px-5 py-4 space-y-2" style={glass}>
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block">Persona Matrix</label>
              <div className="relative">
                <input
                  type="text"
                  value={roleName}
                  onChange={(e) => setRoleName(e.target.value)}
                  placeholder="e.g. Senior Frontend Engineer"
                  className="w-full rounded-xl px-4 py-3 text-base text-white placeholder:text-slate-700 focus:outline-none transition-all font-medium pr-12"
                  style={{ background: 'rgba(2,4,15,0.4)', border: '1px solid rgba(100,116,139,0.3)' }}
                />
                <Target className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-700 w-5 h-5" />
              </div>
            </div>

            {/* ── Levels Container ── */}
            <div className="rounded-2xl px-5 py-4 space-y-4" style={glass}>
              <div className="flex justify-between items-center border-b pb-3" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                <div className="flex items-center gap-2 text-white">
                  <Layers className="w-4 h-4 text-slate-400" />
                  <h2 className="text-sm font-black uppercase tracking-widest text-slate-200">Levels</h2>
                </div>
                <button
                  onClick={addLevel}
                  className="flex items-center gap-1.5 bg-blue-600 text-white px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all active:scale-95"
                  style={{ boxShadow: '0 4px 20px rgba(37,99,235,0.25)' }}
                >
                  <Plus className="w-3.5 h-3.5" /> Add Level
                </button>
              </div>

              <div className="space-y-4">
                {levels.map((level, idx) => (
                  <motion.div
                    layout
                    key={level.id}
                    initial={{ opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="rounded-2xl p-5 space-y-4 relative group"
                    style={{ background: 'rgba(15,15,30,0.4)', border: '1px solid rgba(100,116,139,0.12)' }}
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex gap-3">
                        <div
                          className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-black text-base shrink-0"
                          style={{ background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', boxShadow: '0 4px 12px rgba(37,99,235,0.3)' }}
                        >
                          {idx + 1}
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-white mb-0.5">Level {level.levelNumber}</h3>
                          <p className="text-[10px] font-black text-slate-600 uppercase tracking-[0.3em]">Define Sprints</p>
                        </div>
                      </div>
                      {levels.length > 1 && (
                        <button
                          onClick={() => removeLevel(level.id)}
                          className="p-2 rounded-lg text-slate-600 hover:text-red-400 transition-all opacity-0 group-hover:opacity-100"
                          style={{ background: 'rgba(255,255,255,0.05)' }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    <div className="space-y-3">
                      <label className="text-[10px] font-black text-slate-600 uppercase tracking-widest block">Level Goals</label>

                      <div className="flex flex-col md:flex-row gap-2">
                        <input
                          type="text"
                          value={sprintInputs[level.id] || ''}
                          onChange={(e) => setSprintInputs({ ...sprintInputs, [level.id]: e.target.value })}
                          onKeyDown={(e) => e.key === 'Enter' && addSprint(level.id)}
                          placeholder="What should they complete?"
                          className="flex-1 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:outline-none transition-all"
                          style={{ background: 'rgba(2,4,15,0.4)', border: '1px solid rgba(100,116,139,0.3)' }}
                        />
                        <div className="flex items-center gap-2 rounded-xl px-4 py-2.5" style={{ background: 'rgba(2,4,15,0.4)', border: '1px solid rgba(100,116,139,0.3)' }}>
                          <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <input
                            type="number"
                            value={sprintTimeInputs[level.id] || ''}
                            onChange={(e) => setSprintTimeInputs({ ...sprintTimeInputs, [level.id]: e.target.value })}
                            onKeyDown={(e) => e.key === 'Enter' && addSprint(level.id)}
                            placeholder="0"
                            className="w-10 bg-transparent border-none p-0 text-sm text-white focus:ring-0 font-extrabold"
                          />
                          <select
                            value={sprintTimeUnits[level.id] || 'days'}
                            onChange={(e) => setSprintTimeUnits({ ...sprintTimeUnits, [level.id]: e.target.value as 'days' | 'hours' | 'weeks' | 'months' })}
                            className="bg-transparent border-none text-[10px] font-black text-slate-400 focus:ring-0 cursor-pointer uppercase tracking-widest"
                          >
                            <option className="bg-slate-900" value="days">Days</option>
                            <option className="bg-slate-900" value="hours">Hours</option>
                            <option className="bg-slate-900" value="weeks">Weeks</option>
                            <option className="bg-slate-900" value="months">Months</option>
                          </select>
                        </div>
                        <button
                          onClick={() => addSprint(level.id)}
                          className="rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all active:scale-95 px-5 py-2.5 text-white"
                          style={{ background: '#0f172a', border: '1px solid rgba(100,116,139,0.2)', boxShadow: '0 4px 20px rgba(0,0,0,0.3)' }}
                        >
                          <Plus className="w-3.5 h-3.5" /> Add Goal
                        </button>
                      </div>

                      {/* Goals Display */}
                      <div
                        className="rounded-2xl p-4"
                        style={{ background: 'rgba(2,4,15,0.2)', border: '1px dashed rgba(100,116,139,0.2)', minHeight: level.sprints.length === 0 ? '56px' : undefined }}
                      >
                        {level.sprints.length === 0 ? (
                          <div className="h-full flex items-center justify-center text-slate-700 text-[10px] font-black uppercase tracking-[0.3em] gap-2 italic">
                            <Target className="w-3.5 h-3.5 opacity-30" /> No goals defined in this sector
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <AnimatePresence initial={false}>
                              {level.sprints.map((sprint) => (
                                <motion.div
                                  key={sprint.id}
                                  initial={{ opacity: 0, x: 20 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  exit={{ opacity: 0, x: -20 }}
                                  className="flex items-center justify-between group/item px-4 py-2.5 rounded-xl transition-all"
                                  style={{ background: 'rgba(15,23,42,0.5)', border: '1px solid rgba(255,255,255,0.05)' }}
                                >
                                  <div className="flex items-center gap-3">
                                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" style={{ boxShadow: '0 0 8px rgba(59,130,246,0.8)' }} />
                                    <span className="text-sm font-medium text-slate-300">{sprint.name}</span>
                                    {sprint.completionTime && (
                                      <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full" style={{ background: 'rgba(37,99,235,0.1)', border: '1px solid rgba(37,99,235,0.2)' }}>
                                        <Clock className="w-3 h-3 text-blue-400" />
                                        <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest">{sprint.completionTime} {sprint.timeUnit === 'hours' ? 'hours' : sprint.timeUnit === 'weeks' ? 'weeks' : sprint.timeUnit === 'months' ? 'months' : 'days'}</span>
                                      </div>
                                    )}
                                  </div>
                                  <button
                                    onClick={() => removeSprint(level.id, sprint.id)}
                                    className="text-slate-600 hover:text-red-400 p-1.5 opacity-0 group-hover/item:opacity-100 transition-all rounded-lg"
                                    style={{ background: 'rgba(255,255,255,0.05)' }}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </motion.div>
                              ))}
                            </AnimatePresence>
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>

              <div className="flex justify-end pt-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                <button
                  onClick={handleSubmit}
                  disabled={isSaving}
                  className="text-white font-black px-8 py-3 rounded-xl text-xs uppercase tracking-[0.2em] flex items-center gap-3 transition-all active:scale-95 disabled:opacity-60"
                  style={{ background: '#2563eb', boxShadow: '0 6px 24px rgba(37,99,235,0.35)' }}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {isSaving ? 'Saving…' : 'Submit for Preview'}
                </button>
              </div>
            </div>

            {/* ── Submitted Journey Preview ── */}
            <AnimatePresence>
              {submittedJourney && (
                <motion.section
                  initial={{ opacity: 0, y: 40 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-1.5 h-6 bg-blue-600 rounded-full" />
                      <h2 className="text-lg font-black text-white tracking-tight italic">
                        {isAlreadyPublished ? 'Publish Complete' : 'Draft Ready'}
                      </h2>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleEdit}
                        className="flex items-center gap-2 px-4 py-2 text-slate-400 hover:text-white rounded-xl font-black transition-all text-xs uppercase tracking-wider"
                        style={{ background: 'rgba(255,255,255,0.05)' }}
                      >
                        <Edit2 size={14} />
                        {isAlreadyPublished ? 'Modify Original' : 'Edit'}
                      </button>
                      {!isAlreadyPublished ? (
                        <button
                          onClick={handlePublish}
                          disabled={isPublishing}
                          className="flex items-center gap-2 px-6 py-2.5 text-white rounded-xl font-black transition-all active:scale-95 uppercase tracking-wider text-xs disabled:opacity-60"
                          style={{ background: '#16a34a', boxShadow: '0 6px 24px rgba(22,163,74,0.25)' }}
                        >
                          <Rocket size={14} />
                          {isPublishing ? 'Publishing…' : 'Publish Live'}
                        </button>
                      ) : (
                        <div
                          className="flex items-center gap-2 px-6 py-2.5 rounded-xl font-black uppercase tracking-wider text-xs italic"
                          style={{ background: 'rgba(37,99,235,0.08)', color: '#60a5fa', border: '1px solid rgba(37,99,235,0.15)' }}
                        >
                          <CheckCircle2 size={14} /> Live on Dashboard
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl p-6" style={glass}>
                    <div className="flex items-center justify-between mb-6 pb-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(37,99,235,0.08)', border: '1px solid rgba(37,99,235,0.15)' }}>
                          <Briefcase className="w-6 h-6 text-blue-400" />
                        </div>
                        <div>
                          <h3 className="text-2xl font-black text-white tracking-tighter leading-none mb-1">{submittedJourney.roleName}</h3>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-black text-white px-2.5 py-0.5 rounded-full uppercase tracking-widest" style={{ background: '#2563eb' }}>
                              {submittedJourney.levels.length} Levels
                            </span>
                            <span className="text-xs font-black text-slate-500 uppercase tracking-widest">
                              {submittedJourney.levels.reduce((acc, l) => acc + l.sprints.length, 0)} Sprints
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-6 relative" style={{ paddingLeft: 0 }}>
                      <div className="absolute left-[17px] top-5 bottom-5 w-px" style={{ background: 'linear-gradient(to bottom, #2563eb, rgba(255,255,255,0.05))' }} />

                      {submittedJourney.levels.map((level) => (
                        <div key={level.id} className="relative z-10 flex gap-6 group">
                          <div
                            className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-black text-base border-4 shrink-0 transition-transform group-hover:scale-110"
                            style={{ background: '#2563eb', borderColor: 'rgba(5,5,10,1)', boxShadow: '0 4px 12px rgba(37,99,235,0.3)' }}
                          >
                            {level.levelNumber}
                          </div>
                          <div
                            className="flex-1 p-5 rounded-2xl transition-all duration-500 group-hover:border-blue-500/20"
                            style={{ background: 'rgba(15,15,30,0.4)', border: '1px solid rgba(255,255,255,0.05)' }}
                          >
                            <h4 className="font-black text-white text-lg tracking-tight mb-4">Level {level.levelNumber}</h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                              {level.sprints.map((s) => (
                                <div key={s.id} className="flex flex-col gap-0.5 p-3 rounded-xl" style={{ background: 'rgba(2,4,15,0.6)', border: '1px solid rgba(255,255,255,0.05)' }}>
                                  <span className="text-slate-200 font-black uppercase text-xs tracking-wide">{s.name}</span>
                                  {s.completionTime && (
                                    <span className="text-[10px] font-black text-blue-400 flex items-center gap-1 uppercase tracking-widest opacity-70">
                                      <Clock size={9} /> {s.completionTime} {s.timeUnit === 'hours' ? 'hours' : s.timeUnit === 'weeks' ? 'weeks' : s.timeUnit === 'months' ? 'months' : 'days'}
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.section>
              )}
            </AnimatePresence>
          </>
        )}

        {/* ── Saved Drafts ── */}
        {mode === 'manage' && draftJourneys.length > 0 && (
          <section className="pt-4 space-y-3">
            <div className="flex items-center gap-4">
              <div className="h-px flex-1" style={{ background: 'rgba(255,255,255,0.06)' }} />
              <h2 className="text-[10px] font-black uppercase tracking-[0.5em] text-slate-500 italic shrink-0 px-2">Saved Drafts</h2>
              <div className="h-px flex-1" style={{ background: 'rgba(255,255,255,0.06)' }} />
            </div>

            <div className="space-y-2">
              <AnimatePresence>
                {draftJourneys.map((journey) => (
                  <motion.div
                    layout
                    key={journey.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="rounded-2xl overflow-hidden group transition-all duration-300"
                    style={{
                      ...glass,
                      outline: submittedJourney?.id === journey.id ? '2px solid #2563eb' : 'none',
                      outlineOffset: 4,
                    }}
                  >
                    <div className="p-4 px-6 flex items-center gap-5">
                      <div
                        onClick={() => {
                          setSubmittedJourney(journey);
                          setEditingDraftId(journey.id);
                          setMode('studio');
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="flex items-center gap-4 cursor-pointer flex-1"
                      >
                        <div
                          className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 transition-all duration-300 group-hover:bg-blue-600"
                          style={{ background: 'rgba(37,99,235,0.05)', border: '1px solid rgba(37,99,235,0.15)' }}
                        >
                          <Layers className="w-5 h-5 text-blue-500 group-hover:text-white transition-colors" />
                        </div>
                        <div>
                          <h3 className="text-base font-bold text-white uppercase tracking-tight leading-none mb-1.5">{journey.roleName}</h3>
                          <div className="flex items-center gap-3 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                            <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.05)' }}>
                              <span className="text-white">{journey.levels.length}</span> Levels
                            </div>
                            <div className="w-1 h-1 rounded-full" style={{ background: '#1e293b' }} />
                            <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.05)' }}>
                              <span className="text-white">{journey.levels.reduce((acc, l) => acc + l.sprints.length, 0)}</span> Sprints
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        {submittedJourney?.id === journey.id && (
                          <div className="px-3 py-1 text-white font-black text-[10px] rounded-full uppercase tracking-widest animate-pulse" style={{ background: '#2563eb' }}>
                            Previewing
                          </div>
                        )}
                        <span className="px-3 py-1 font-black text-[9px] rounded-full uppercase tracking-widest" style={{ background: 'rgba(234,179,8,0.05)', color: '#eab308', border: '1px solid rgba(234,179,8,0.15)' }}>
                          Draft
                        </span>
                        <button
                          onClick={() => setExpandedId(expandedId === journey.id ? null : journey.id)}
                          className="w-9 h-9 flex items-center justify-center rounded-lg transition-all border active:scale-95"
                          style={{ background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.05)', color: expandedId === journey.id ? '#60a5fa' : '#64748b' }}
                        >
                          <ChevronRight size={16} className={`transition-transform ${expandedId === journey.id ? 'rotate-90' : ''}`} />
                        </button>
                        <button
                          onClick={() => { if (submittedJourney?.id === journey.id) setSubmittedJourney(null); handleDelete(journey.id, false); }}
                          className="w-9 h-9 flex items-center justify-center rounded-lg transition-all border active:scale-95 hover:text-red-400"
                          style={{ background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.05)', color: '#475569' }}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>

                    <AnimatePresence>
                      {expandedId === journey.id && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="p-5"
                          style={{ borderTop: '1px solid rgba(255,255,255,0.04)', background: 'rgba(2,4,15,0.2)' }}
                        >
                          <div className="flex flex-col gap-5 relative">
                            <div className="absolute left-[14px] top-3 bottom-3 w-px" style={{ background: 'linear-gradient(to bottom, #2563eb, rgba(255,255,255,0.04))' }} />
                            {journey.levels.map((level) => (
                              <div key={level.id} className="relative z-10 flex gap-4">
                                <div
                                  className="w-7 h-7 rounded-full flex items-center justify-center text-white font-black text-xs border-4 shrink-0"
                                  style={{ background: '#2563eb', borderColor: 'rgba(5,5,10,1)', boxShadow: '0 4px 12px rgba(37,99,235,0.25)' }}
                                >
                                  {level.levelNumber}
                                </div>
                                <div className="flex-1 p-4 rounded-xl transition-all hover:shadow-md" style={{ background: 'rgba(15,15,30,0.5)', border: '1px solid rgba(255,255,255,0.05)' }}>
                                  <h4 className="font-bold text-white text-sm uppercase tracking-tight mb-3">Level {level.levelNumber}</h4>
                                  <div className="flex flex-wrap gap-1.5">
                                    {level.sprints.map((s) => (
                                      <span key={s.id} className="px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-wide text-slate-400" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                                        {s.name}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                          <div className="mt-5 pt-5 flex justify-end" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                            <button
                              onClick={() => {
                                setSubmittedJourney(journey);
                                setEditingDraftId(journey.id);
                                setMode('studio');
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                              }}
                              className="flex items-center gap-2 px-5 py-2.5 text-white rounded-lg font-black text-xs uppercase tracking-widest transition-all hover:opacity-80"
                              style={{ background: '#2563eb', boxShadow: '0 4px 20px rgba(37,99,235,0.25)' }}
                            >
                              Edit in Builder
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

        {/* ── Published Journeys ── */}
        {mode === 'manage' && publishedJourneys.length > 0 && (
          <section className="pt-4 space-y-3">
            <div className="flex items-center gap-4">
              <div className="h-px flex-1" style={{ background: 'rgba(255,255,255,0.06)' }} />
              <h2 className="text-[10px] font-black uppercase tracking-[0.5em] text-slate-500 italic shrink-0 px-2">Manage Published Journeys</h2>
              <div className="h-px flex-1" style={{ background: 'rgba(255,255,255,0.06)' }} />
            </div>

            <div className="space-y-2">
              <AnimatePresence>
                {publishedJourneys.map((journey) => (
                  <motion.div
                    layout
                    key={journey.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="rounded-2xl overflow-hidden group transition-all duration-300"
                    style={glass}
                  >
                    <div
                      onClick={() => setExpandedId(expandedId === journey.id ? null : journey.id)}
                      className="p-4 px-6 flex items-center gap-5 cursor-pointer transition-colors"
                    >
                      <div className="flex items-center gap-4 flex-1">
                        <div
                          className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 transition-all duration-300 group-hover:bg-blue-600/20"
                          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
                        >
                          <Briefcase className="w-5 h-5 text-slate-500 group-hover:text-blue-400 transition-colors" />
                        </div>
                        <div>
                          <h3 className="text-base font-bold text-white uppercase tracking-tight leading-none mb-1.5">{journey.roleName}</h3>
                          <div className="flex items-center gap-3 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                            <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.05)' }}>
                              <span className="text-white">{journey.levels.length}</span> Levels
                            </div>
                            <div className="w-1 h-1 rounded-full" style={{ background: '#1e293b' }} />
                            <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.05)' }}>
                              <span className="text-white">{journey.levels.reduce((acc, l) => acc + l.sprints.length, 0)}</span> Sprints
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="px-3 py-1 font-black text-[9px] rounded-full uppercase tracking-widest italic" style={{ background: 'rgba(16,185,129,0.05)', color: '#10b981', border: '1px solid rgba(16,185,129,0.15)' }}>
                          Live on Dashboard
                        </span>
                        <ChevronRight size={16} className={`text-slate-600 transition-transform duration-300 ${expandedId === journey.id ? 'rotate-90 text-blue-400' : ''}`} />
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(journey.id, true); }}
                          className="w-9 h-9 flex items-center justify-center rounded-lg transition-all border active:scale-95 hover:text-red-400"
                          style={{ background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.05)', color: '#475569' }}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>

                    <AnimatePresence>
                      {expandedId === journey.id && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="p-5"
                          style={{ borderTop: '1px solid rgba(255,255,255,0.04)', background: 'rgba(2,4,15,0.2)' }}
                        >
                          <div className="flex flex-col gap-5 relative">
                            <div className="absolute left-[14px] top-3 bottom-3 w-px" style={{ background: 'linear-gradient(to bottom, #2563eb, rgba(255,255,255,0.04))' }} />
                            {journey.levels.map((level) => (
                              <div key={level.id} className="relative z-10 flex gap-4">
                                <div
                                  className="w-7 h-7 rounded-full flex items-center justify-center text-white font-black text-xs border-4 shrink-0"
                                  style={{ background: '#2563eb', borderColor: 'rgba(5,5,10,1)', boxShadow: '0 4px 12px rgba(37,99,235,0.25)' }}
                                >
                                  {level.levelNumber}
                                </div>
                                <div className="flex-1 p-4 rounded-xl transition-all hover:shadow-md" style={{ background: 'rgba(15,15,30,0.5)', border: '1px solid rgba(255,255,255,0.05)' }}>
                                  <h4 className="font-bold text-white text-sm uppercase tracking-tight mb-3">Level {level.levelNumber}</h4>
                                  <div className="flex flex-wrap gap-1.5">
                                    {level.sprints.map((s) => (
                                      <span key={s.id} className="px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-wide text-slate-400" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                                        {s.name}
                                      </span>
                                    ))}
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
      </main>
    </div>
  );
}