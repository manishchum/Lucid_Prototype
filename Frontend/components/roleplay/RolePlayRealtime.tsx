'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, MicOff, Phone, PhoneOff, Loader2 } from 'lucide-react';

interface RolePlayRealtimeProps {
  scenario: {
    scenario_id: string;
    title: string;
    role: string;
    difficulty: string;
    initialPrompt: string;
    tone?: string;
  };
  onEndSession: (sessionId: string, transcript: any[]) => void;
  employeeId?: string;
  moduleId?: string;
}

const API_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

export default function RolePlayRealtime({
  scenario,
  onEndSession,
  employeeId,
  moduleId,
}: RolePlayRealtimeProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState('Initializing...');
  const [audioLevel, setAudioLevel] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const audioQueueRef = useRef<Blob[]>([]);
  const isPlayingRef = useRef(false);

  // Generate session ID
  useEffect(() => {
    const newSessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    setSessionId(newSessionId);
  }, []);

  // Connect to WebSocket when session ID is ready
  useEffect(() => {
    if (!sessionId) return;

    const connectWebSocket = async () => {
      try {
        const wsProtocol = API_URL.startsWith('https') ? 'wss' : 'ws';
        const wsUrl = `${wsProtocol}://${API_URL.replace(/^https?:\/\//, '')}/roleplay/realtime/${sessionId}`;

        wsRef.current = new WebSocket(wsUrl);

        wsRef.current.onopen = async () => {
          console.log('✅ Connected to roleplay server');
          setIsConnected(true);
          setStatus('Connected. Click Start to begin.');

          // Request microphone access
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;

            // Setup audio context for level monitoring
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
            analyserRef.current = audioContextRef.current.createAnalyser();
            const source = audioContextRef.current.createMediaStreamSource(stream);
            source.connect(analyserRef.current);

            // Setup media recorder
            const recorder = new MediaRecorder(stream);
            mediaRecorderRef.current = recorder;

            recorder.ondataavailable = (e) => {
              if (e.data.size > 0 && wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(e.data);
              }
            };

            setStatus('Ready to record');
          } catch (error) {
            console.error('Microphone error:', error);
            setStatus('Microphone access denied');
          }
        };

        wsRef.current.onmessage = async (event) => {
          if (event.data instanceof Blob) {
            // Audio data from bot
            audioQueueRef.current.push(event.data);
            if (!isPlayingRef.current) {
              playNextAudio();
            }
          } else {
            // JSON message
            try {
              const message = JSON.parse(event.data);

              if (message.type === 'speech_detected') {
                setStatus('Bot speaking...');
              } else if (message.type === 'response_complete') {
                setStatus('Waiting for your response...');
              } else if (message.type === 'error') {
                setStatus(`Error: ${message.error}`);
              }
            } catch (e) {
              console.error('Error parsing message:', e);
            }
          }
        };

        wsRef.current.onerror = (error) => {
          console.error('WebSocket error:', error);
          setStatus('Connection error');
          setIsConnected(false);
        };

        wsRef.current.onclose = () => {
          console.log('Disconnected from server');
          setIsConnected(false);
          setStatus('Disconnected');
        };
      } catch (error) {
        console.error('Failed to connect:', error);
        setStatus('Failed to connect');
      }
    };

    connectWebSocket();

    return () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
    };
  }, [sessionId]);

  // Monitor audio levels
  useEffect(() => {
    if (!isRecording || !analyserRef.current) return;

    const updateLevel = () => {
      const dataArray = new Uint8Array(analyserRef.current!.frequencyBinCount);
      analyserRef.current!.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
      setAudioLevel(Math.min(100, (average / 255) * 100));
      requestAnimationFrame(updateLevel);
    };

    updateLevel();
  }, [isRecording]);

  const playNextAudio = async () => {
    if (audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      return;
    }

    isPlayingRef.current = true;
    const audioBlob = audioQueueRef.current.shift();

    if (!audioBlob) {
      isPlayingRef.current = false;
      return;
    }

    try {
      const url = URL.createObjectURL(audioBlob);
      const audio = new Audio(url);

      audio.onended = () => {
        URL.revokeObjectURL(url);
        playNextAudio();
      };

      audio.play().catch((e) => {
        console.error('Error playing audio:', e);
        playNextAudio();
      });
    } catch (error) {
      console.error('Error processing audio:', error);
      playNextAudio();
    }
  };

  const startSession = async () => {
    if (!mediaRecorderRef.current) {
      setStatus('Microphone not ready');
      return;
    }

    setIsRecording(true);
    setIsListening(true);
    setStatus('Recording... Speak now!');

    mediaRecorderRef.current.start(100); // Send data every 100ms
  };

  const stopSession = async () => {
    setIsRecording(false);

    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }

    // Get transcript from server
    if (sessionId && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ message: 'get_transcript' }));
    }

    setStatus('Session ended. Generating assessment...');

    // Clean up
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
    }

    // Call end session handler
    onEndSession(sessionId || '', []);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      {/* Main Card */}
      <div className="w-full max-w-md bg-white rounded-lg shadow-lg p-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800">{scenario.title}</h1>
          <p className="text-gray-600 mt-2">Speaking with: {scenario.role}</p>
          <p className="text-sm text-gray-500 mt-1">Difficulty: {scenario.difficulty}</p>
        </div>

        {/* Status Display */}
        <div className="bg-blue-50 border-l-4 border-blue-500 p-4 rounded mb-6">
          <p className="text-sm text-gray-700 font-medium">{status}</p>
          <p className="text-xs text-gray-600 mt-1">
            {isConnected ? '✅ Connected' : '❌ Disconnected'}
          </p>
        </div>

        {/* Audio Level Meter */}
        {isRecording && (
          <div className="mb-6">
            <div className="flex justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">Audio Level</label>
              <span className="text-sm text-gray-600">{Math.round(audioLevel)}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-green-500 h-2 rounded-full transition-all"
                style={{ width: `${audioLevel}%` }}
              />
            </div>
          </div>
        )}

        {/* Controls */}
        <div className="flex gap-4 justify-center mb-6">
          {!isRecording ? (
            <button
              onClick={startSession}
              disabled={!isConnected}
              className="flex items-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-bold rounded-lg transition"
            >
              <Mic className="w-5 h-5" />
              Start
            </button>
          ) : (
            <button
              onClick={stopSession}
              className="flex items-center gap-2 px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg transition"
            >
              <PhoneOff className="w-5 h-5" />
              End Call
            </button>
          )}
        </div>

        {/* Info */}
        <div className="bg-gray-50 rounded p-4 text-center">
          <p className="text-sm text-gray-600">
            {isRecording
              ? '🎤 Listening... Speak naturally'
              : '👂 Click Start when ready'}
          </p>
        </div>

        {/* Session ID */}
        <div className="mt-6 pt-4 border-t border-gray-200">
          <p className="text-xs text-gray-500 text-center">
            Session: {sessionId?.substring(0, 12)}...
          </p>
        </div>
      </div>

      {/* Loader */}
      {!isConnected && (
        <div className="mt-8 flex items-center gap-2 text-blue-600">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Connecting to server...</span>
        </div>
      )}
    </div>
  );
}
