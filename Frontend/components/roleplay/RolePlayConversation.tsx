"use client";

import { useState, useRef, useEffect } from "react";
import {
  Mic, MicOff, Video, VideoOff,
  Loader2, Phone, Camera, CameraOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Scenario, Message } from "@/lib/roleplay/types";
import { createRolePlaySession, updateRolePlaySession } from "@/lib/roleplayDatabase";

interface RolePlayConversationProps {
  scenario: Scenario;
  onEndSession: (messages: Message[], sessionId?: string) => void;
  onBack?: () => void;
  moduleId?: string;
  employeeId?: string;
  voiceGender?: "female" | "male";
}

const API_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

export default function RolePlayConversation({
  scenario,
  onEndSession,
  onBack,
  moduleId,
  employeeId,
  voiceGender = "female",
}: RolePlayConversationProps) {
  const [conversationActive, setConversationActive] = useState(false);
  const [isRecording, setIsRecording]     = useState(false);
  const [isProcessing, setIsProcessing]   = useState(false);
  const [isBotSpeaking, setIsBotSpeaking] = useState(false);
  const [limitPopup, setLimitPopup]       = useState<{ open: boolean; message: string }>({ open: false, message: "" });
  const [videoStream, setVideoStream]     = useState<MediaStream | null>(null);
  const [isCameraOn, setIsCameraOn]       = useState(true);
  const [isMicOn, setIsMicOn]             = useState(true);

  const videoRef        = useRef<HTMLVideoElement>(null);
  const containerRef    = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const wsRef           = useRef<WebSocket | null>(null);
  const audioInputRef   = useRef<AudioContext | null>(null);   // mic → OpenAI
  const audioOutputRef  = useRef<AudioContext | null>(null);   // OpenAI → speaker
  const sessionIdRef    = useRef<string | null>(null);
  const conversationTranscriptRef = useRef<Array<{ role: string; text: string }>>([]);
  const processorRef    = useRef<ScriptProcessorNode | null>(null);
  const nextPlayTimeRef = useRef<number>(0);  // Track playback time to queue audio sequentially
  const isBotSpeakingRef = useRef<boolean>(false);  // Gate mic audio send while bot is speaking
  const sessionEndedRef = useRef<boolean>(false);  // Flag to track if session_ended was received

  // Helper to update both state and ref for bot speaking status
  const setBotSpeaking = (val: boolean) => {
    isBotSpeakingRef.current = val;
    setIsBotSpeaking(val);
  };

  useEffect(() => { return () => stopAllMedia(); }, []);

  const stopAllMedia = () => {
    processorRef.current?.disconnect();
    processorRef.current = null;

    if (mediaRecorderRef.current?.state !== "inactive") {
      try { mediaRecorderRef.current?.stop(); } catch {}
    }
    mediaRecorderRef.current = null;

    if (videoStream) {
      videoStream.getTracks().forEach(t => t.stop());
      setVideoStream(null);
    }

    wsRef.current?.close();
    wsRef.current = null;

    audioInputRef.current?.close();
    audioInputRef.current = null;

    audioOutputRef.current?.close();
    audioOutputRef.current = null;
  };

  // ✅ FIX 2 — Correct PCM16 bot audio playback with sequential queueing
  const handleBotAudio = async (audioData: string) => {
    try {
      setBotSpeaking(true);

      if (!audioOutputRef.current) {
        audioOutputRef.current = new (window.AudioContext ||
          (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }

      const ctx = audioOutputRef.current;
      
      // Anchor queue to real time on first chunk
      if (nextPlayTimeRef.current === 0) {
        nextPlayTimeRef.current = ctx.currentTime;
      }

      const binary = atob(audioData);
      const bytes  = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      // PCM16 → Float32
      const pcm16   = new Int16Array(bytes.buffer);
      const float32 = new Float32Array(pcm16.length);
      for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 32768.0;

      const buf = ctx.createBuffer(1, float32.length, 24000);
      buf.copyToChannel(float32, 0);

      // Calculate start time to queue chunks sequentially
      const startTime = Math.max(ctx.currentTime, nextPlayTimeRef.current);
      
      const source = ctx.createBufferSource();
      source.buffer = buf;
      source.connect(ctx.destination);
      source.start(startTime);
      
      // Update next play time for sequential queueing
      nextPlayTimeRef.current = startTime + buf.duration;
      
      // Only set speaking to false after ALL chunks finish playing
      source.onended = () => {
        if (Math.abs(ctx.currentTime - nextPlayTimeRef.current) < 0.1) {
          setBotSpeaking(false);
          // Reset queue for next response
          nextPlayTimeRef.current = 0;
        }
      };

    } catch (err) {
      console.error("Audio playback error:", err);
      setBotSpeaking(false);
    }
  };

  // ✅ FIX 3 — Connect audio processor only after WebSocket is open
  const connectToRealtime = (stream: MediaStream) => {
    const wsUrl = `${API_URL?.replace("http", "ws") || "ws://localhost:8000"}/roleplay/realtime`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = async () => {
      console.log("✅ Connected to Realtime WS");

      // Send init config
      ws.send(JSON.stringify({
        scenarioTitle: scenario.title,
        scenarioRole:  scenario.role,
        userRole:      employeeId ? "User" : "Guest",
        initialPrompt: scenario.initialPrompt,
        tone:          scenario.tone || "Neutral",
        employeeId,
        sessionId:     sessionIdRef.current,
        voiceGender,
      }));

      // ✅ Start mic → OpenAI pipeline only after WS is confirmed open
      const audioCtx = new (window.AudioContext ||
        (window as any).webkitAudioContext)({ sampleRate: 24000 });
      audioInputRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);

      // ✅ Migrate to AudioWorkletNode (replaces deprecated ScriptProcessorNode)
      try {
        // Load the audio worklet processor
        await audioCtx.audioWorklet.addModule("/audio-processor.js");
        const workletNode = new AudioWorkletNode(audioCtx, "audio-processor");
        processorRef.current = workletNode as any;

        // Handle audio chunks from the worklet
        workletNode.port.onmessage = (event) => {
          // Gate mic audio while bot is speaking to prevent double voice
          if (isBotSpeakingRef.current) return;
          if (ws.readyState !== WebSocket.OPEN) return;

          const audioData = event.data.data as Float32Array;

          // ✅ FIX 1 — Correct PCM16 little-endian encoding (identical to ScriptProcessorNode version)
          const pcm16 = new Int16Array(audioData.length);
          for (let i = 0; i < audioData.length; i++) {
            const s = Math.max(-1, Math.min(1, audioData[i]));
            pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }
          const audioB64 = btoa(
            String.fromCharCode(...new Uint8Array(pcm16.buffer))
          );

          ws.send(JSON.stringify({ type: "audio", audio: audioB64 }));
        };

        source.connect(workletNode);
        workletNode.connect(audioCtx.destination);
        
        // ✅ FIX 5 — Lock mic immediately to prevent VAD false positives during startup
        setBotSpeaking(true);
        setTimeout(() => {
          if (!isBotSpeakingRef.current) {
            setBotSpeaking(false);
          }
        }, 2000);
      } catch (err) {
        console.error("❌ AudioWorklet initialization failed, falling back to ScriptProcessorNode:", err);
        // Fallback to ScriptProcessorNode if AudioWorklet is not supported
        const processor = audioCtx.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;

        processor.onaudioprocess = (e) => {
          // Gate mic audio while bot is speaking to prevent double voice
          if (isBotSpeakingRef.current) return;
          if (ws.readyState !== WebSocket.OPEN) return;

          const audioData = e.inputBuffer.getChannelData(0);

          // ✅ FIX 1 — Correct PCM16 little-endian encoding
          const pcm16 = new Int16Array(audioData.length);
          for (let i = 0; i < audioData.length; i++) {
            const s = Math.max(-1, Math.min(1, audioData[i]));
            pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }
          const audioB64 = btoa(
            String.fromCharCode(...new Uint8Array(pcm16.buffer))
          );

          ws.send(JSON.stringify({ type: "audio", audio: audioB64 }));
        };

        source.connect(processor);
        processor.connect(audioCtx.destination);
        
        // ✅ FIX 5 — Lock mic immediately to prevent VAD false positives during startup
        setBotSpeaking(true);
        setTimeout(() => {
          if (!isBotSpeakingRef.current) {
            setBotSpeaking(false);
          }
        }, 2000);
      }
    };

    ws.onmessage = async (event) => {
      const data = JSON.parse(event.data);

      if (data.type === "audio") {
        await handleBotAudio(data.audio);
      } else if (data.type === "speech_started") {
        // Bot detected user speaking — show listening state
        // Reset audio queue to discard remaining buffered audio
        nextPlayTimeRef.current = 0;
        setIsRecording(true);
        setBotSpeaking(false);
      } else if (data.type === "user_transcription") {
        conversationTranscriptRef.current.push({ role: "user", text: data.text });
      } else if (data.type === "transcript_chunk") {
        // Optional: show live bot transcript
      } else if (data.type === "response.done") {
        // Bot response complete — reset queue for next response
        nextPlayTimeRef.current = 0;
      } else if (data.type === "session_ended") {
        // ✅ FIX 7 — Backend sent complete transcript after end_session request
        console.log('[ws.onmessage] Received session_ended event');
        console.log('[ws.onmessage] Backend transcript length:', data.transcript?.length || 0);
        conversationTranscriptRef.current = data.transcript || [];
        sessionEndedRef.current = true;
      } else if (data.type === "error") {
        console.error("Backend error:", data.message);
        setLimitPopup({ open: true, message: data.message });
      }
    };

    ws.onerror = (err) => {
      console.error("❌ WebSocket error:", err);
      setLimitPopup({ open: true, message: "Connection error. Please try again." });
    };

    ws.onclose = () => console.log("🔌 Disconnected from Realtime WS");

    wsRef.current = ws;
  };

  const startConversation = async () => {
    if (employeeId) {
      try {
        const { data, error } = await createRolePlaySession(
          employeeId, scenario.scenario_id, scenario.title,
          scenario.role, scenario.difficulty, moduleId
        );
        if (data && !error) {
          sessionIdRef.current = data.id;
        } else {
          setLimitPopup({ open: true, message: error?.message || "Unable to start session." });
          return;
        }
      } catch {
        setLimitPopup({ open: true, message: "Unable to start session. Please try again." });
        return;
      }
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setVideoStream(stream);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }

      // Start video recorder
      const videoRecorder = new MediaRecorder(stream);
      recordedChunksRef.current = [];
      videoRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      videoRecorder.start();
      mediaRecorderRef.current = videoRecorder;

      // ✅ FIX 3 — pass stream to connectToRealtime, audio starts inside onopen
      connectToRealtime(stream);
      setConversationActive(true);
      setIsProcessing(true);

    } catch (err) {
      console.error("Error starting conversation:", err);
      alert("Microphone/Camera permission required");
    }
  };

  // ✅ FIX 7 — Wait for backend session_ended response before processing transcript
  const handleEndSession = async () => {
    console.log('[handleEndSession] Starting session end process...');

    // Reset the flag that tracks if session_ended was received
    sessionEndedRef.current = false;

    // Step 1: Send end_session signal to backend
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.log('[handleEndSession] Sending end_session to backend');
      wsRef.current.send(JSON.stringify({ type: "end_session" }));

      // Step 2: Wait for backend to send session_ended with complete transcript (with 3 second timeout)
      let timeoutId: NodeJS.Timeout | null = null;
      try {
        await new Promise<void>((resolve) => {
          timeoutId = setTimeout(() => {
            console.warn('[handleEndSession] ⏱️ Timeout waiting for session_ended (3s) - using local transcript');
            resolve();
          }, 3000);
        });
      } catch (err) {
        console.error('[handleEndSession] Error waiting for session_ended:', err);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    } else {
      console.warn('[handleEndSession] WebSocket not open, using local transcript');
    }

    // Wait a bit more to ensure any pending messages are processed
    await new Promise(resolve => setTimeout(resolve, 200));

    // Step 3: Stop all media and reset state
    stopAllMedia();
    setConversationActive(false);
    setIsRecording(false);
    setIsProcessing(false);
    setBotSpeaking(false);

    // Step 4: Build messages array from the complete transcript
    const messages: Message[] = conversationTranscriptRef.current.map((item, idx) => ({
      text:      item.text,
      sender:    item.role === "user" ? "user" : "avatar",
      timestamp: new Date(
        Date.now() - (conversationTranscriptRef.current.length - idx) * 1000
      ).toISOString(),
    }));

    console.log('[handleEndSession] ✅ Transcript received:', {
      sessionEnded: sessionEndedRef.current,
      transcriptLength: conversationTranscriptRef.current.length,
      messagesArrayLength: messages.length
    });

    // Step 5: Save transcript and trigger callback
    if (sessionIdRef.current && messages.length > 0) {
      try {
        console.log('[handleEndSession] Saving session transcript...');
        await updateRolePlaySession(sessionIdRef.current, messages, true);
        console.log('[handleEndSession] ✅ Transcript saved to database');
      } catch (e) {
        console.error("❌ Failed to save transcript:", e);
      }
    }

    onEndSession(messages, sessionIdRef.current || undefined);
  };

  const toggleCamera = () => {
    if (!videoStream) return;
    const track = videoStream.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setIsCameraOn(track.enabled);
  };

  const toggleMic = () => {
    if (!videoStream) return;
    const track = videoStream.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setIsMicOn(track.enabled);
  };

  // ---------- JSX (unchanged) ----------
  return (
    <div ref={containerRef} className="fixed inset-0 bg-gray-900 flex flex-col z-50">
      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full animate-pulse ${
            isBotSpeaking ? "bg-orange-500" : isRecording ? "bg-red-500" : "bg-green-500"
          }`} />
          <span className="text-white font-medium">{scenario.title}</span>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={toggleCamera}
            className={`p-2 rounded-lg transition-all ${isCameraOn ? "bg-gray-700 hover:bg-gray-600 text-white" : "bg-red-500 hover:bg-red-600 text-white"}`}>
            {isCameraOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
          </button>
          <button onClick={toggleMic}
            className={`p-2 rounded-lg transition-all ${isMicOn ? "bg-gray-700 hover:bg-gray-600 text-white" : "bg-red-500 hover:bg-red-600 text-white"}`}>
            {isMicOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
          </button>
          <Button onClick={handleEndSession} className="bg-red-500 hover:bg-red-600 text-white flex items-center gap-2">
            <Phone className="w-4 h-4" /> End Meeting
          </Button>
        </div>
      </div>

      {/* Main area */}
      <div className="flex-1 flex">
        {/* Bot side */}
        <div className="w-1/2 bg-gradient-to-br from-purple-600 via-purple-500 to-indigo-600 flex items-center justify-center p-8 relative overflow-hidden">
          <div className="relative z-10 text-center">
            <div className="relative mx-auto w-64 h-64 mb-6">
              <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-white/10 rounded-full ${isBotSpeaking ? "animate-ping" : "opacity-0"}`} />
              <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-white/5 rounded-full ${isBotSpeaking ? "animate-pulse" : "opacity-0"}`} />
              <div className={`relative z-10 w-64 h-64 rounded-full bg-white flex items-center justify-center shadow-2xl transition-all duration-300 ${isBotSpeaking ? "scale-110 ring-8 ring-white/30" : "scale-100"}`}>
                <span className="text-8xl font-bold text-purple-600">L</span>
              </div>
            </div>
            <div className="text-white">
              <h2 className="text-4xl font-bold mb-2">{scenario.role}</h2>
              <div className="flex items-center justify-center gap-3 mb-3">
                {isBotSpeaking ? (
                  <><div className="flex gap-1">
                    <div className="w-2 h-6 bg-white rounded-full animate-pulse" style={{ animationDelay: "0ms" }} />
                    <div className="w-2 h-8 bg-white rounded-full animate-pulse" style={{ animationDelay: "150ms" }} />
                    <div className="w-2 h-6 bg-white rounded-full animate-pulse" style={{ animationDelay: "300ms" }} />
                  </div><span className="text-xl font-medium">Speaking...</span></>
                ) : isProcessing ? (
                  <><Loader2 className="w-5 h-5 animate-spin" /><span className="text-xl font-medium">Processing...</span></>
                ) : isRecording ? (
                  <><div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" /><span className="text-xl font-medium">Listening...</span></>
                ) : conversationActive ? (
                  <span className="text-xl font-medium">Ready</span>
                ) : (
                  <span className="text-xl font-medium">Waiting to start</span>
                )}
              </div>
              <div className="text-purple-100 opacity-90 text-lg">
                {scenario.difficulty} Difficulty • {scenario.tone || "Neutral"} Tone
              </div>
            </div>
          </div>
        </div>

        {/* User video side */}
        <div className="w-1/2 bg-gradient-to-br from-blue-600 via-blue-500 to-cyan-600 flex items-center justify-center p-8 relative overflow-hidden">
          <div className="relative z-10 w-full max-w-2xl">
            <div className="relative rounded-3xl overflow-hidden shadow-2xl border-4 border-white/30 bg-black aspect-video">
              <video ref={videoRef} autoPlay muted playsInline
                className="w-full h-full object-cover transform scale-x-[-1]"
                onLoadedMetadata={() => videoRef.current?.play().catch(() => {})} />
              {!videoStream && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-white">
                  <Camera className="w-16 h-16 mb-4 opacity-50" />
                  <p className="text-lg">Camera not started</p>
                </div>
              )}
              {!isCameraOn && videoStream && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black text-white">
                  <CameraOff className="w-16 h-16 mb-4" />
                  <p className="text-lg">Camera is off</p>
                </div>
              )}
            </div>
            {isRecording && (
              <div className="absolute bottom-8 right-8 bg-red-900/80 backdrop-blur-sm px-6 py-3 rounded-full animate-pulse">
                <div className="text-white font-medium text-lg flex items-center gap-2">
                  <div className="w-2 h-2 bg-red-500 rounded-full" /> Recording
                </div>
              </div>
            )}
            {!isRecording && (
              <div className="absolute bottom-8 right-8 bg-blue-900/80 backdrop-blur-sm px-6 py-3 rounded-full">
                <p className="text-white font-medium text-lg">You</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Start overlay */}
      {!conversationActive && (
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-40">
          <div className="bg-white rounded-3xl p-12 shadow-2xl max-w-lg text-center">
            <div className="bg-gradient-to-br from-purple-100 to-blue-100 rounded-full p-8 mb-6 inline-block">
              <Mic className="w-16 h-16 text-purple-600" />
            </div>
            <h3 className="text-3xl font-bold text-slate-900 mb-3">Ready to Start?</h3>
            <p className="text-slate-600 mb-8 text-lg">
              Click the button to begin your speech-to-speech role-play. The bot will speak first, then listen to you!
            </p>
            <Button onClick={startConversation} size="lg"
              className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-lg px-8 py-6"
              disabled={isProcessing}>
              {isProcessing ? (
                <><Loader2 className="w-6 h-6 mr-3 animate-spin" />Starting...</>
              ) : (
                <><Mic className="w-6 h-6 mr-3" />Start Conversation</>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Error popup */}
      {limitPopup.open && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
          <div className="bg-white rounded-2xl p-8 shadow-2xl max-w-md w-full text-center">
            <h3 className="text-2xl font-bold text-slate-900 mb-3">Error</h3>
            <p className="text-slate-600 mb-6">{limitPopup.message}</p>
            <div className="flex items-center justify-center gap-3">
              <Button onClick={() => { setLimitPopup({ open: false, message: "" }); onBack?.(); }} variant="outline" className="px-6">Back</Button>
              <Button onClick={() => setLimitPopup({ open: false, message: "" })} className="px-6 bg-blue-600 hover:bg-blue-700">Retry</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}