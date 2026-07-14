"use client";

import React, { useState, useRef, useEffect } from "react";
import { Globe, RefreshCw, Volume2, Play, Pause, ChevronRight } from "lucide-react";
import AvatarBubble from "./AvatarBubble";
import SubtitleOverlay from "./SubtitleOverlay";
import QuizGate from "./QuizGate";
import SimulationPlayer from "./SimulationPlayer";
import CourseProgress from "./CourseProgress";
import { cn } from "@/lib/utils";

interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

interface QuizQuestion {
  id: string;
  text: string;
  options: string[];
  correct: number;
  explanation: string;
}

interface Quiz {
  questions: QuizQuestion[];
  pass_threshold: number;
  max_attempts: number;
  on_fail: string;
  replay_segment_id?: string;
}

interface SimulationStep {
  screenshot_url: string;
  instruction: string;
  hotspot: { x: number; y: number; w: number; h: number };
  highlight_text?: string;
}

interface Simulation {
  title: string;
  steps: SimulationStep[];
}

interface Segment {
  id: string;
  title: string;
  type: string;
  order: number;
  duration: number;
  avatar_cue: string;
  video_url_en?: string;
  video_url_hi?: string;
  subtitles_en?: SubtitleCue[];
  subtitles_hi?: SubtitleCue[];
  quiz?: Quiz;
  simulation?: Simulation;
}

interface CourseManifest {
  course_id: string;
  processed_module_id: string;
  title: string;
  description: string;
  segments: Segment[];
  total_segments: number;
  quiz_gates: number;
  estimated_duration_minutes: number;
}

interface InteractiveVideoPlayerProps {
  manifest: CourseManifest;
}

export default function InteractiveVideoPlayer({ manifest }: InteractiveVideoPlayerProps) {
  const { segments, processed_module_id } = manifest;

  const [activeSegmentIndex, setActiveSegmentIndex] = useState(0);
  const activeSegment = segments[activeSegmentIndex];

  // Language: "en" | "hi"
  const [language, setLanguage] = useState<"en" | "hi">("en");

  // Progression States
  const [completedSegmentIds, setCompletedSegmentIds] = useState<Set<string>>(new Set());
  const [unlockedSegmentIds, setUnlockedSegmentIds] = useState<Set<string>>(
    new Set([segments[0]?.id]) // Start with the first segment unlocked
  );

  // Video State
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [avatarState, setAvatarState] = useState<"idle" | "explaining" | "thinking">("thinking");

  // Reset video player when segment changes
  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setVideoDuration(0);
    setAvatarState(activeSegment?.type === "lecture" ? "thinking" : "idle");
  }, [activeSegmentIndex, activeSegment]);

  // Unlock modules rule
  const handleSegmentCompleted = (segId: string) => {
    setCompletedSegmentIds((prev) => {
      const next = new Set(prev);
      next.add(segId);
      return next;
    });

    // Find next segment and unlock it
    const nextIdx = activeSegmentIndex + 1;
    if (nextIdx < segments.length) {
      const nextSeg = segments[nextIdx];
      setUnlockedSegmentIds((prev) => {
        const nextUnlocks = new Set(prev);
        nextUnlocks.add(nextSeg.id);
        return nextUnlocks;
      });
    }
  };

  const handleVideoLoaded = () => {
    setAvatarState("idle");
    if (videoRef.current) {
      setVideoDuration(videoRef.current.duration);
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handlePlayToggle = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
      setAvatarState("idle");
    } else {
      videoRef.current.play();
      setIsPlaying(true);
      setAvatarState("explaining");
    }
  };

  const handleVideoEnded = () => {
    setIsPlaying(false);
    setAvatarState("idle");
    handleSegmentCompleted(activeSegment.id);

    // Auto advance if it's not a quiz gate
    const nextIdx = activeSegmentIndex + 1;
    if (nextIdx < segments.length) {
      setActiveSegmentIndex(nextIdx);
    }
  };

  // Quiz Gate Actions
  const handleQuizPassed = () => {
    handleSegmentCompleted(activeSegment.id);
    const nextIdx = activeSegmentIndex + 1;
    if (nextIdx < segments.length) {
      setActiveSegmentIndex(nextIdx);
    }
  };

  const handleQuizReplayTriggered = (replayId: string) => {
    // Find segment index to replay
    const replayIdx = segments.findIndex((s) => s.id === replayId);
    if (replayIdx !== -1) {
      setActiveSegmentIndex(replayIdx);
    }
  };

  // Simulation Actions
  const handleSimulationCompleted = () => {
    handleSegmentCompleted(activeSegment.id);
    const nextIdx = activeSegmentIndex + 1;
    if (nextIdx < segments.length) {
      setActiveSegmentIndex(nextIdx);
    }
  };

  const selectSegmentById = (segmentId: string) => {
    const idx = segments.findIndex((s) => s.id === segmentId);
    if (idx !== -1 && unlockedSegmentIds.has(segmentId)) {
      setActiveSegmentIndex(idx);
    }
  };

  // Get active video url & subtitles based on active language
  const videoUrl = language === "hi" ? activeSegment?.video_url_hi : activeSegment?.video_url_en;
  const subtitleCues = language === "hi" ? activeSegment?.subtitles_hi : activeSegment?.subtitles_en;

  return (
    <div className="w-full flex flex-col xl:flex-row gap-6 max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 bg-slate-950 rounded-3xl border border-slate-800 shadow-2xl">
      {/* Main Player Screen Area */}
      <div className="flex-1 flex flex-col gap-4">
        {/* Course Header Info */}
        <div className="flex justify-between items-start border-b border-slate-800/80 pb-4">
          <div>
            <h2 className="text-xl sm:text-2xl font-extrabold text-white tracking-wide">{manifest.title}</h2>
            <p className="text-sm text-slate-400 font-semibold mt-1">Interactive Video Learning Course</p>
          </div>

          {/* Lang Selector Toggle */}
          <div className="flex items-center bg-slate-900 border border-slate-800 rounded-2xl p-1">
            <button
              onClick={() => setLanguage("en")}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all",
                language === "en" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"
              )}
            >
              <Globe className="w-3.5 h-3.5" />
              English
            </button>
            <button
              onClick={() => setLanguage("hi")}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all",
                language === "hi" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"
              )}
            >
              <Globe className="w-3.5 h-3.5" />
              Hinglish
            </button>
          </div>
        </div>

        {/* Video Player Display Container */}
        <div className="relative aspect-[16/9] w-full rounded-2xl overflow-hidden bg-slate-900 border border-slate-800 shadow-xl group">
          {activeSegment.type === "lecture" ? (
            <>
              {videoUrl ? (
                <video
                  ref={videoRef}
                  src={videoUrl}
                  onLoadedData={handleVideoLoaded}
                  onTimeUpdate={handleTimeUpdate}
                  onEnded={handleVideoEnded}
                  className="w-full h-full object-cover"
                />
              ) : (
                /* Fallback frame if video_url is null */
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-slate-950">
                  <span className="text-slate-500 font-semibold uppercase tracking-widest text-xs">
                    Rendering Lesson Slide
                  </span>
                  <p className="text-white text-lg font-bold">{activeSegment.title}</p>
                </div>
              )}

              {/* Subtitles synced to timestamp */}
              {subtitleCues && subtitleCues.length > 0 && (
                <SubtitleOverlay cues={subtitleCues} currentTime={currentTime} />
              )}

              {/* Overlay Play/Pause screen controllers */}
              <div className="absolute inset-0 bg-slate-950/20 group-hover:bg-slate-950/40 transition-colors flex items-center justify-center z-10">
                <button
                  onClick={handlePlayToggle}
                  className="w-16 h-16 rounded-full bg-slate-900/80 backdrop-blur border border-white/20 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-all scale-95 hover:scale-105"
                >
                  {isPlaying ? <Pause className="w-8 h-8 fill-white" /> : <Play className="w-8 h-8 fill-white ml-1" />}
                </button>
              </div>

              {/* Left Bottom corner floating Avatar Indicator */}
              <div className="absolute bottom-6 left-6 z-20 pointer-events-none scale-75 origin-bottom-left sm:scale-90">
                <AvatarBubble state={avatarState} />
              </div>
            </>
          ) : activeSegment.type === "quiz_gate" ? (
            /* Quiz overlay gate */
            <QuizGate
              segmentId={activeSegment.id}
              processedModuleId={processed_module_id}
              questions={activeSegment.quiz?.questions || []}
              passThreshold={activeSegment.quiz?.pass_threshold || 0.8}
              maxAttempts={activeSegment.quiz?.max_attempts || 2}
              replaySegmentId={activeSegment.quiz?.replay_segment_id || ""}
              onPass={handleQuizPassed}
              onReplayTriggered={handleQuizReplayTriggered}
            />
          ) : (
            /* Simulation overlay player */
            <SimulationPlayer
              segmentId={activeSegment.id}
              title={activeSegment.simulation?.title || ""}
              steps={activeSegment.simulation?.steps || []}
              onComplete={handleSimulationCompleted}
            />
          )}
        </div>

        {/* Video progress status slider bar */}
        {activeSegment.type === "lecture" && (
          <div className="flex items-center gap-4 bg-slate-900 border border-slate-800 rounded-2xl px-5 py-4">
            <button
              onClick={handlePlayToggle}
              className="w-10 h-10 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center shadow-lg"
            >
              {isPlaying ? <Pause className="w-5 h-5 fill-white" /> : <Play className="w-5 h-5 fill-white ml-0.5" />}
            </button>
            <div className="flex-1 flex flex-col gap-1">
              <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-indigo-500 h-full rounded-full transition-all duration-100"
                  style={{
                    width: `${videoDuration ? (currentTime / videoDuration) * 100 : 0}%`,
                  }}
                />
              </div>
              <div className="flex justify-between text-[10px] font-bold text-slate-500 uppercase mt-1">
                <span>
                  {Math.floor(currentTime / 60)}:
                  {String(Math.floor(currentTime % 60)).padStart(2, "0")}
                </span>
                <span>
                  {Math.floor(videoDuration / 60)}:
                  {String(Math.floor(videoDuration % 60)).padStart(2, "0")}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Chapters Side navigation menu */}
      <div className="w-full xl:w-80">
        <CourseProgress
          segments={segments}
          activeSegmentId={activeSegment.id}
          completedSegmentIds={completedSegmentIds}
          unlockedSegmentIds={unlockedSegmentIds}
          onSegmentSelect={selectSegmentById}
        />
      </div>
    </div>
  );
}
