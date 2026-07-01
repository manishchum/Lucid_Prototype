'use client';

import { useState, useRef, useEffect } from 'react';
import { Mic, Square } from 'lucide-react';
// import { splitAudioIntoChunks } from '@/lib/audio-chunker';

interface VoiceInputProps {
  onTranscription: (text: string) => void;
  disabled?: boolean;
  autoStart?: boolean;
  onManualStop?: () => void;
}

const API_URL = process.env.NEXT_PUBLIC_BACKEND_URL;
import { fetchWithAuth } from "@/lib/fetch-with-auth"

export default function VoiceInput({
  onTranscription,
  disabled,
  autoStart = false,
  onManualStop
}: VoiceInputProps) {

  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const recordingStartRef = useRef<number>(0);
  const hasAutoStartedRef = useRef(false);
  const isRecordingRef = useRef(false);

  /* ================= AUTO START ================= */

  useEffect(() => {
    if (
      autoStart &&
      !isRecording &&
      !isProcessing &&
      !disabled &&
      !hasAutoStartedRef.current
    ) {
      hasAutoStartedRef.current = true;
      startRecording();
    }
  }, [autoStart]);

  /* ================= TIMER DISPLAY ================= */

  useEffect(() => {
    if (!isRecording) return;

    const id = setInterval(() => {
      setRecordingDuration(Date.now() - recordingStartRef.current);
    }, 100);

    return () => clearInterval(id);
  }, [isRecording]);

  /* ================= CLEANUP ================= */

  useEffect(() => {
    return () => {
      stopAllTracks();
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (audioContextRef.current) audioContextRef.current.close().catch(() => {});
    };
  }, []);

  const stopAllTracks = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  };

  /* ================= SILENCE DETECTION ================= */

  const detectSilence = (stream: MediaStream) => {
    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(stream);

    analyser.fftSize = 2048;
    source.connect(analyser);

    audioContextRef.current = audioContext;

    const data = new Uint8Array(analyser.fftSize);
    let lastSpeech = Date.now();
    let hasSpeech = false;

    const SILENCE_DURATION = 3000;
    const RMS_THRESHOLD = 0.02;

    const loop = () => {
      if (!isRecordingRef.current) return;

      analyser.getByteTimeDomainData(data);

      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const val = (data[i] - 128) / 128;
        sum += val * val;
      }

      const rms = Math.sqrt(sum / data.length);

      if (rms > RMS_THRESHOLD) {
        hasSpeech = true;
        lastSpeech = Date.now();
      } else {
        if (hasSpeech && Date.now() - lastSpeech > SILENCE_DURATION) {
          stopRecording();
          return;
        }
      }

      animationFrameRef.current = requestAnimationFrame(loop);
    };

    loop();
  };

  /* ================= START RECORDING ================= */

  const startRecording = async () => {
    if (isRecordingRef.current || mediaRecorderRef.current) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
        const recorder = new MediaRecorder(stream, {
          mimeType: 'audio/webm;codecs=opus',
          audioBitsPerSecond: 48000
        });

      audioChunksRef.current = [];
      recordingStartRef.current = Date.now();
      isRecordingRef.current = true;
      setIsRecording(true);

      recorder.ondataavailable = e => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        // Build blob AFTER all ondataavailable chunks have been collected
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm;codecs=opus" });
        console.log(`[VoiceInput] Recording stopped. Chunks: ${audioChunksRef.current.length}, Size: ${(blob.size / 1024).toFixed(2)} KB`);

        stopAllTracks();
        if (audioContextRef.current) audioContextRef.current.close().catch(() => {});
        mediaRecorderRef.current = null;
        isRecordingRef.current = false;

        if (blob.size > 3000) {
          await transcribe(blob);
        } else {
          console.warn('[VoiceInput] Audio blob too small, skipping transcription');
        }

        setRecordingDuration(0);
      };

      mediaRecorderRef.current = recorder;
      // Use 250ms timeslice so ondataavailable fires regularly
      // This ensures all audio data is collected before onstop fires
      recorder.start(250);
      detectSilence(stream);

    } catch {
      alert('Microphone permission required');
    }
  };

  /* ================= STOP RECORDING ================= */

  const stopRecording = () => {
    if (!isRecordingRef.current) return;

    setIsRecording(false);
    isRecordingRef.current = false;

    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }

    hasAutoStartedRef.current = false;
  };

  /* ================= TRANSCRIPTION ================= */

  const transcribe = async (blob: Blob) => {
    setIsProcessing(true);
    console.log(`[VoiceInput] Sending audio to Whisper: ${(blob.size / 1024).toFixed(2)} KB, type: ${blob.type}`);

    try {
      const fd = new FormData();
      // Whisper requires a proper filename with extension — send as audio.webm directly
      fd.append("audio", new File([blob], "audio.webm", { type: "audio/webm;codecs=opus" }));

      const res = await fetchWithAuth(`${API_URL}/api/speech-to-text`, {
        method: "POST",
        body: fd,
      });

      // const res = await fetchWithAuth(`/api/speech-to-text-async`, {
      //   method: "POST",
      //   body: fd,
      // });

      const data = await res.json();

      if (res.ok && data.text && data.text.trim()) {
        console.log('[VoiceInput] Transcription:', data.text);
        onTranscription(data.text.trim());
      } else if (!res.ok) {
        console.error('[VoiceInput] Transcription error:', data.error);
      } else {
        console.warn('[VoiceInput] Empty transcript returned');
      }

    } catch (err: any) {
      console.error('[VoiceInput] Fetch error:', err.message);
    } finally {
      setIsProcessing(false);
    }
  };
  /* ================= UI ================= */

  const formatDuration = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
  };

  const handleClick = () => {
    if (isRecording) {
      if (onManualStop) onManualStop();
      stopRecording();
    } else {
      startRecording();
    }
  };

  return (
    <div className="relative inline-flex items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || isProcessing}
        className={`p-2 rounded-full transition-all ${
          isRecording
            ? 'bg-red-500 hover:bg-red-600 text-white animate-pulse'
            : isProcessing
            ? 'bg-gray-400 text-white cursor-not-allowed'
            : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        {isRecording ? <Square className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
      </button>

      {isRecording && (
        <span className="text-sm font-mono text-red-600 animate-pulse">
          {formatDuration(recordingDuration)}
        </span>
      )}
    </div>
  );
}