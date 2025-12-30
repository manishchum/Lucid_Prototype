import React, { useRef } from "react";

interface AudioPlayerProps {
  employeeId: string;
  processedModuleId: string;
  moduleId: string;
  audioUrl: string;
  onTimeUpdate?: (current: number, duration: number) => void;
  onPlayExtra?: () => void;
  className?: string;
}

export default function AudioPlayer({ employeeId, processedModuleId, moduleId, audioUrl, onTimeUpdate, onPlayExtra, className }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);

  const handlePlay = async () => {
    if (onPlayExtra) onPlayExtra();
    await fetch('/api/module-progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: employeeId,
        processed_module_id: processedModuleId,
        module_id: moduleId,
        audio_listen_duration: 0,
      }),
    });
  };

  const handleEnded = async () => {
    const duration = audioRef.current?.duration || 0;
    await fetch('/api/module-progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: employeeId,
        processed_module_id: processedModuleId,
        module_id: moduleId,
        audio_listen_duration: Math.round(duration),
      }),
    });
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
        onTimeUpdate?.(audioRef.current.currentTime, audioRef.current.duration || 0);
      }}
      onEnded={handleEnded}
    >
      Your browser does not support the audio element.
    </audio>
  );
}
