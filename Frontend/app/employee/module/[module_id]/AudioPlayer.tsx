import React, { useRef } from "react";
import { sharedDataClient } from "@/lib/data-client";

interface AudioPlayerProps {
  employeeId: string;
  processedModuleId: string;
  moduleId: string;
  audioUrl: string;
  onTimeUpdate?: (current: number, duration: number, playbackRate: number) => void;
  onPlayExtra?: () => void;
  className?: string;
}

const API_URL = process.env.NEXT_PUBLIC_BACKEND_URL;


export default function AudioPlayer({ employeeId, processedModuleId, moduleId, audioUrl, onTimeUpdate, onPlayExtra, className }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);

  const handlePlay = async () => {
    if (onPlayExtra) onPlayExtra();
    await fetch(`${API_URL}/api/module-progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: employeeId,
        processed_module_id: processedModuleId,
        module_id: moduleId,
        audio_listen_duration: 0,
      }),
    });
    sharedDataClient.invalidateByPrefix("v1|dashboard");
    sharedDataClient.invalidateByPrefix("v1|training-plan");
  };

  const handleEnded = async () => {
    const duration = audioRef.current?.duration || 0;
    await fetch(`${API_URL}/api/module-progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: employeeId,
        processed_module_id: processedModuleId,
        module_id: moduleId,
        audio_listen_duration: Math.round(duration),
      }),
    });
    sharedDataClient.invalidateByPrefix("v1|dashboard");
    sharedDataClient.invalidateByPrefix("v1|training-plan");
  };

  return (
    <audio
      controls
      src={audioUrl}
      className={className || "w-full"}
      ref={audioRef}
      onPlay={handlePlay}
      onTimeUpdate={() => {
        if (!audioRef.current) return;
        const playbackRate = audioRef.current.playbackRate || 1.0;
        onTimeUpdate?.(audioRef.current.currentTime, audioRef.current.duration || 0, playbackRate);
      }}
      onEnded={handleEnded}
    >
      Your browser does not support the audio element.
    </audio>
  );
}
