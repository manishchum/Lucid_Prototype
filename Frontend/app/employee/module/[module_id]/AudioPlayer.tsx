import React, { useRef } from "react";

interface AudioPlayerProps {
  employeeId: string;
  processedModuleId: string;
  moduleId: string;
  audioUrl: string;
}

export default function AudioPlayer({ employeeId, processedModuleId, moduleId, audioUrl }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);

  const handlePlay = async () => {
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
      className="w-full"
      ref={audioRef}
      onPlay={handlePlay}
      onEnded={handleEnded}
    >
      Your browser does not support the audio element.
    </audio>
  );
}
