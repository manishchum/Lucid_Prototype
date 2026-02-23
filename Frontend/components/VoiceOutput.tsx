
"use client";
import { useState, useEffect, useRef } from "react";
import { Volume2, VolumeX } from "lucide-react";

interface VoiceOutputProps {
  text: string;
  disabled?: boolean;
  onTTSComplete?: () => void;
}

export default function VoiceOutput({ text, disabled = false, onTTSComplete }: VoiceOutputProps) {
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
  const lastTextRef = useRef<string>("");
  const initialDisabledRef = useRef<boolean>(disabled); // Capture initial disabled state
  const hasAutoPlayedRef = useRef<boolean>(false); // Track if this instance has auto-played

  // Play audio from text
  const playAudio = async () => {
    if (disabled) return;

    try {
      // If already playing, stop it
      if (playing && audio) {
        audio.pause();
        audio.currentTime = 0;
        setPlaying(false);
        return;
      }

      setLoading(true);
      // Call text-to-speech API
      const response = await fetch("/api/text-to-speech", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to generate speech");
      }

      const data = await response.json();
      // Convert base64 to audio blob
      const audioBlob = await fetch(`data:audio/mp3;base64,${data.audio}`).then(r => r.blob());
      const audioUrl = URL.createObjectURL(audioBlob);
      // Create and play audio
      const audioElement = new Audio(audioUrl);
      setAudio(audioElement);
      interface VoiceOutputProps {
        text: string;
        disabled?: boolean;
      }

      // (stray duplicate function removed)
      await audioElement.play();
      setPlaying(true);
      audioElement.onended = () => {
        setPlaying(false);
        if (onTTSComplete) onTTSComplete();
      };
    } catch (error: any) {
      console.error("Text-to-speech error:", error);
      alert(error.message || "Failed to generate speech");
    } finally {
      setLoading(false);
    }
  };

  // Auto-play when text changes and is non-empty
  // Only auto-play if component was initially mounted with disabled=false
  // This prevents old messages from auto-playing when disabled changes from true to false
  useEffect(() => {
    if (text && text.trim() && text !== lastTextRef.current && !disabled && !hasAutoPlayedRef.current && !initialDisabledRef.current) {
      lastTextRef.current = text;
      hasAutoPlayedRef.current = true; // Mark as auto-played
      playAudio();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, disabled]);

  // Optionally, keep the button for manual replay/stop
  return (
    <button
      onClick={playAudio}
      disabled={disabled || loading}
      style={{
        width: 32,
        height: 32,
        borderRadius: 16,
        border: "none",
        background: playing ? "#ef4444" : "#6b7280",
        color: "white",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: disabled || loading ? "not-allowed" : "pointer",
        opacity: disabled || loading ? 0.5 : 1,
        transition: "all 0.2s",
      }}
      aria-label={playing ? "Stop speech" : "Play speech"}
      title={playing ? "Stop" : "Listen"}
    >
      {loading ? (
        <div
          style={{
            width: 14,
            height: 14,
            border: "2px solid white",
            borderTopColor: "transparent",
            borderRadius: "50%",
            animation: "spin 0.6s linear infinite",
          }}
        />
      ) : playing ? (
        <VolumeX size={16} />
      ) : (
        <Volume2 size={16} />
      )}
      <style jsx>{`
        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </button>
  );
}
