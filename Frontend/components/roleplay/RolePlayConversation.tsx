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

// ✅ Safe base64 encoding for large buffers (avoids stack overflow from spread operator)
function encodePcmToBase64(pcm16: Int16Array): string {
  const bytes = new Uint8Array(pcm16.buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

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

  const videoRef                  = useRef<HTMLVideoElement>(null);
  const containerRef              = useRef<HTMLDivElement>(null);
  const mediaRecorderRef          = useRef<MediaRecorder | null>(null);
  const recordedChunksRef         = useRef<Blob[]>([]);
  const wsRef                     = useRef<WebSocket | null>(null);
  const audioInputRef             = useRef<AudioContext | null>(null);
  const audioOutputRef            = useRef<AudioContext | null>(null);
  const sessionIdRef              = useRef<string | null>(null);
  const conversationTranscriptRef = useRef<Array<{ role: string; text: string }>>([]);
  const processorRef              = useRef<ScriptProcessorNode | AudioWorkletNode | null>(null);
  const nextPlayTimeRef           = useRef<number>(0);
  const isBotSpeakingRef          = useRef<boolean>(false);
  const sessionEndedRef           = useRef<boolean>(false);
  const sessionEndedResolverRef   = useRef<(() => void) | null>(null);

  const setBotSpeaking = (val: boolean) => {
    isBotSpeakingRef.current = val;
    setIsBotSpeaking(val);
  };

  useEffect(() => { return () => stopAllMedia(); }, []);

  const stopAllMedia = () => {
    if (processorRef.current) {
      try { (processorRef.current as any).disconnect(); } catch {}
      processorRef.current = null;
    }

    if (mediaRecorderRef.current?.state !== "inactive") {
      try { mediaRecorderRef.current?.stop(); } catch {}
    }
    mediaRecorderRef.current = null;

    setVideoStream((prev) => {
      if (prev) prev.getTracks().forEach(t => t.stop());
      return null;
    });

    if (wsRef.current) {
      try { wsRef.current.close(); } catch {}
      wsRef.current = null;
    }

    if (audioInputRef.current) {
      try { audioInputRef.current.close(); } catch {}
      audioInputRef.current = null;
    }

    if (audioOutputRef.current) {
      try { audioOutputRef.current.close(); } catch {}
      audioOutputRef.current = null;
    }
  };

  // ✅ Reset audio output context cleanly when bot is interrupted
  const resetAudioOutput = () => {
    if (audioOutputRef.current) {
      try { audioOutputRef.current.close(); } catch {}
      audioOutputRef.current = null;
    }
    nextPlayTimeRef.current = 0;
  };

  const handleBotAudio = async (audioData: string) => {
    try {
      setBotSpeaking(true);

      if (!audioOutputRef.current) {
        audioOutputRef.current = new (window.AudioContext ||
          (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }

      const ctx = audioOutputRef.current;

      // Resume context if suspended by browser autoplay policy
      if (ctx.state === "suspended") {
        await ctx.resume();
      }

      // Anchor queue to real time on first chunk
      if (nextPlayTimeRef.current === 0) {
        nextPlayTimeRef.current = ctx.currentTime;
      }

      const binary = atob(audioData);
      const bytes  = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      const pcm16   = new Int16Array(bytes.buffer);
      const float32 = new Float32Array(pcm16.length);
      for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 32768.0;

      const buf = ctx.createBuffer(1, float32.length, 24000);
      buf.copyToChannel(float32, 0);

      const startTime = Math.max(ctx.currentTime, nextPlayTimeRef.current);

      const source = ctx.createBufferSource();
      source.buffer = buf;
      source.connect(ctx.destination);
      source.start(startTime);

      nextPlayTimeRef.current = startTime + buf.duration;

      source.onended = () => {
        if (ctx.currentTime >= nextPlayTimeRef.current - 0.1) {
          setBotSpeaking(false);
          nextPlayTimeRef.current = 0;
        }
      };

    } catch (err) {
      console.error("Audio playback error:", err);
      setBotSpeaking(false);
    }
  };

  const connectToRealtime = (stream: MediaStream) => {
    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const apiHost    = API_URL?.replace(/^https?:\/\//, "").replace(/\/$/, "") || "localhost:8000";
    const wsUrl      = `${wsProtocol}//${apiHost}/roleplay/realtime`;

    console.log("[RolePlay] Connecting to WebSocket:", wsUrl);

    const ws = new WebSocket(wsUrl);

    ws.onopen = async () => {
      console.log("[RolePlay] ✅ WebSocket connected");
      console.log("[RolePlay] Starting roles:", {
        aiRole: scenario.role,
        learnerRole: scenario.userRole || "Learner",
        title: scenario.title,
      });

      ws.send(JSON.stringify({
        scenarioTitle: scenario.title,
        scenarioRole:  scenario.role,
        userRole:      scenario.userRole || "Learner",
        initialPrompt: scenario.initialPrompt,
        aiPersonality: scenario.aiPersonality,
        aiObjectives:  scenario.aiObjectives,
        learnerBrief:  scenario.learnerBrief,
        tone:          scenario.tone || "Neutral",
        employeeId,
        sessionId:     sessionIdRef.current,
        voiceGender,
      }));

      const audioCtx = new (window.AudioContext ||
        (window as any).webkitAudioContext)({ sampleRate: 24000 });
      audioInputRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);

      // ✅ Shared PCM16 encoding with safe base64 (no spread on large arrays)
      const sendPcm16Audio = (audioData: Float32Array) => {
        if (isBotSpeakingRef.current) return;
        if (ws.readyState !== WebSocket.OPEN) return;

        const pcm16 = new Int16Array(audioData.length);
        for (let i = 0; i < audioData.length; i++) {
          const s = Math.max(-1, Math.min(1, audioData[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }

        const audioB64 = encodePcmToBase64(pcm16);
        ws.send(JSON.stringify({ type: "audio", audio: audioB64 }));
      };

      try {
        await audioCtx.audioWorklet.addModule("/audio-processor.js");
        const workletNode = new AudioWorkletNode(audioCtx, "audio-processor");
        processorRef.current = workletNode as any;

        workletNode.port.onmessage = (event) => {
          sendPcm16Audio(event.data.data as Float32Array);
        };

        source.connect(workletNode);
        workletNode.connect(audioCtx.destination);
        console.log("[RolePlay] ✅ AudioWorklet initialized");

      } catch (err) {
        console.warn("[RolePlay] AudioWorklet failed, falling back to ScriptProcessorNode:", err);

        // ✅ 2048 buffer size (was 4096) — smoother streaming at 24000hz
        const processor = audioCtx.createScriptProcessor(2048, 1, 1);
        processorRef.current = processor;

        processor.onaudioprocess = (e) => {
          sendPcm16Audio(e.inputBuffer.getChannelData(0));
        };

        source.connect(processor);
        processor.connect(audioCtx.destination);
        console.log("[RolePlay] ✅ ScriptProcessorNode initialized (fallback)");
      }

      // Lock mic on startup to prevent VAD false positives during greeting
      setBotSpeaking(true);
      setTimeout(() => {
        if (isBotSpeakingRef.current) {
          setBotSpeaking(false);
        }
      }, 2000);
    };

    ws.onmessage = async (event) => {
      let data: any;
      try {
        data = JSON.parse(event.data);
      } catch {
        console.error("[RolePlay] Failed to parse WS message:", event.data);
        return;
      }

      switch (data.type) {
        case "audio":
          await handleBotAudio(data.audio);
          break;

        case "speech_started":
          // ✅ Reset output context fully — clears buffered/interrupted bot audio
          resetAudioOutput();
          setIsRecording(true);
          setBotSpeaking(false);
          break;

        case "user_transcription":
          if (data.text) {
            conversationTranscriptRef.current.push({ role: "user", text: data.text });
          }
          break;

        case "transcript_chunk":
          break;

        case "response.done":
          nextPlayTimeRef.current = 0;
          setIsRecording(false);
          break;

        case "session_ended":
          console.log("[RolePlay] session_ended received, transcript length:", data.transcript?.length ?? 0);
          console.log("[RolePlay] Current transcript before merge:", conversationTranscriptRef.current.length);
          
          // ✅ MERGE transcripts instead of replacing - backend might have updated transcripts
          if (data.transcript && Array.isArray(data.transcript) && data.transcript.length > 0) {
            console.log("[RolePlay] Using backend transcript with", data.transcript.length, "messages");
            conversationTranscriptRef.current = data.transcript;
          } else {
            console.log("[RolePlay] Backend transcript empty, keeping local transcript with", conversationTranscriptRef.current.length, "messages");
          }
          
          sessionEndedRef.current = true;
          sessionEndedResolverRef.current?.();
          sessionEndedResolverRef.current = null;
          break;

        case "error":
          console.error("[RolePlay] Backend error:", data.message);
          setLimitPopup({ open: true, message: data.message || "An error occurred." });
          break;

        default:
          break;
      }
    };

    ws.onerror = (err) => {
      console.error("[RolePlay] ❌ WebSocket error:", err);
      setLimitPopup({ open: true, message: "Connection error. Please try again." });
    };

    ws.onclose = (event) => {
      console.log(`[RolePlay] 🔌 WebSocket closed — code: ${event.code}, reason: ${event.reason}, clean: ${event.wasClean}`);
      sessionEndedResolverRef.current?.();
      sessionEndedResolverRef.current = null;
    };

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

      const videoRecorder = new MediaRecorder(stream);
      recordedChunksRef.current = [];
      videoRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      videoRecorder.start();
      mediaRecorderRef.current = videoRecorder;

      connectToRealtime(stream);
      setConversationActive(true);
      setIsProcessing(true);

    } catch (err) {
      console.error("[RolePlay] Error starting conversation:", err);
      alert("Microphone/Camera permission is required to start.");
    }
  };

  const handleEndSession = async () => {
    console.log("[handleEndSession] Ending session...");
    sessionEndedRef.current = false;

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "end_session" }));
      console.log("[handleEndSession] Sent end_session, waiting for session_ended...");

      await new Promise<void>((resolve) => {
        sessionEndedResolverRef.current = resolve;
        setTimeout(() => {
          if (sessionEndedResolverRef.current) {
            console.warn("[handleEndSession] ⏱️ Timeout — using local transcript");
            sessionEndedResolverRef.current = null;
            resolve();
          }
        }, 3000);
      });
    } else {
      console.warn("[handleEndSession] WebSocket not open, using local transcript");
    }

    await new Promise(resolve => setTimeout(resolve, 200));

    stopAllMedia();
    setConversationActive(false);
    setIsRecording(false);
    setIsProcessing(false);
    setBotSpeaking(false);

    const transcript = conversationTranscriptRef.current;
    console.log("[handleEndSession] 📝 Transcript ready:", {
      count: transcript.length,
      items: transcript.map(t => `${t.role}: ${t.text.substring(0, 30)}...`)
    });

    const messages: Message[] = transcript.map((item, idx) => ({
      text:      item.text,
      sender:    item.role === "user" ? "user" : "avatar",
      timestamp: new Date(
        Date.now() - (transcript.length - idx) * 1000
      ).toISOString(),
    }));

    console.log("[handleEndSession] ✅ Final transcript:", {
      sessionEndedReceived: sessionEndedRef.current,
      transcriptLength:     transcript.length,
      messagesCount:        messages.length,
    });

    // ✅ SAVE TRANSCRIPT FIRST - before generating assessment
    if (sessionIdRef.current && messages.length > 0) {
      try {
        console.log("[handleEndSession] 💾 Saving transcript to DB...");
        await updateRolePlaySession(sessionIdRef.current, messages, true);
        console.log("[handleEndSession] ✅ Transcript saved to DB");
      } catch (e) {
        console.error("[handleEndSession] ❌ Failed to save transcript:", e);
        // Continue anyway - assessment generation is still important
      }
    } else {
      console.warn("[handleEndSession] ⚠️ Cannot save transcript:", {
        hasSessionId: !!sessionIdRef.current,
        messagesCount: messages.length
      });
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

  return (
    <div ref={containerRef} className="fixed inset-0 bg-gray-900 flex flex-col z-50">
      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 px-3 sm:px-6 py-2 sm:py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-0">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className={`w-2 h-2 rounded-full animate-pulse ${
            isBotSpeaking ? "bg-orange-500" : isRecording ? "bg-red-500" : "bg-green-500"
          }`} />
          <span className="text-white font-medium text-xs sm:text-sm truncate">{scenario.title}</span>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto flex-wrap">
          <button onClick={toggleCamera}
            className={`p-1.5 sm:p-2 rounded-lg transition-all ${isCameraOn ? "bg-gray-700 hover:bg-gray-600 text-white" : "bg-red-500 hover:bg-red-600 text-white"}`}>
            {isCameraOn ? <Video className="w-4 sm:w-5 h-4 sm:h-5" /> : <VideoOff className="w-4 sm:w-5 h-4 sm:h-5" />}
          </button>
          <button onClick={toggleMic}
            className={`p-1.5 sm:p-2 rounded-lg transition-all ${isMicOn ? "bg-gray-700 hover:bg-gray-600 text-white" : "bg-red-500 hover:bg-red-600 text-white"}`}>
            {isMicOn ? <Mic className="w-4 sm:w-5 h-4 sm:h-5" /> : <MicOff className="w-4 sm:w-5 h-4 sm:h-5" />}
          </button>
          <Button
            onClick={handleEndSession}
            className="bg-red-500 hover:bg-red-600 text-white flex items-center gap-1 sm:gap-2 text-xs sm:text-sm px-2 sm:px-4 py-1 sm:py-2 h-auto"
          >
            <Phone className="w-3 sm:w-4 h-3 sm:h-4 flex-shrink-0" />
            <span className="hidden sm:inline">End Meeting</span>
          </Button>
        </div>
      </div>

      {/* Main area */}
      <div className="flex-1 flex flex-col md:flex-row gap-0">
        {/* Bot side */}
        <div className="flex-1 bg-gradient-to-br from-purple-600 via-purple-500 to-indigo-600 flex items-center justify-center p-4 sm:p-6 md:p-8 relative overflow-hidden">
          <div className="relative z-10 text-center">
            <div className="relative mx-auto w-24 sm:w-32 md:w-48 lg:w-64 h-24 sm:h-32 md:h-48 lg:h-64 mb-2 sm:mb-3 md:mb-6">
              <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-24 sm:w-32 md:w-48 lg:w-64 h-24 sm:h-32 md:h-48 lg:h-64 bg-white/10 rounded-full ${isBotSpeaking ? "animate-ping" : "opacity-0"}`} />
              <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 sm:w-40 md:w-56 lg:w-80 h-32 sm:h-40 md:h-56 lg:h-80 bg-white/5 rounded-full ${isBotSpeaking ? "animate-pulse" : "opacity-0"}`} />
              <div className={`relative z-10 w-24 sm:w-32 md:w-48 lg:w-64 h-24 sm:h-32 md:h-48 lg:h-64 rounded-full bg-white flex items-center justify-center shadow-2xl transition-all duration-300 ${isBotSpeaking ? "scale-110 ring-8 ring-white/30" : "scale-100"}`}>
                <span className="text-3xl sm:text-4xl md:text-6xl lg:text-8xl font-bold text-purple-600">L</span>
              </div>
            </div>
            <div className="text-white">
              <h2 className="text-base sm:text-lg md:text-2xl lg:text-4xl font-bold mb-1 sm:mb-2">{scenario.role}</h2>
              <div className="flex items-center justify-center gap-1 sm:gap-2 md:gap-3 mb-1 sm:mb-2 md:mb-3 flex-wrap">
                {isBotSpeaking ? (
                  <>
                    <div className="flex gap-1">
                      <div className="w-1 sm:w-1.5 md:w-2 h-3 sm:h-4 md:h-6 bg-white rounded-full animate-pulse" style={{ animationDelay: "0ms" }} />
                      <div className="w-1 sm:w-1.5 md:w-2 h-4 sm:h-6 md:h-8 bg-white rounded-full animate-pulse" style={{ animationDelay: "150ms" }} />
                      <div className="w-1 sm:w-1.5 md:w-2 h-3 sm:h-4 md:h-6 bg-white rounded-full animate-pulse" style={{ animationDelay: "300ms" }} />
                    </div>
                    <span className="text-xs sm:text-sm md:text-lg lg:text-xl font-medium">Speaking...</span>
                  </>
                ) : isProcessing ? (
                  <>
                    <Loader2 className="w-3 sm:w-4 md:w-5 h-3 sm:h-4 md:h-5 animate-spin" />
                    <span className="text-xs sm:text-sm md:text-lg lg:text-xl font-medium">Processing...</span>
                  </>
                ) : isRecording ? (
                  <>
                    <div className="w-1.5 sm:w-2 md:w-3 h-1.5 sm:h-2 md:h-3 bg-red-500 rounded-full animate-pulse" />
                    <span className="text-xs sm:text-sm md:text-lg lg:text-xl font-medium">Listening...</span>
                  </>
                ) : conversationActive ? (
                  <span className="text-xs sm:text-sm md:text-lg lg:text-xl font-medium">Ready</span>
                ) : (
                  <span className="text-xs sm:text-sm md:text-lg lg:text-xl font-medium">Waiting to start</span>
                )}
              </div>
              <div className="text-purple-100 opacity-90 text-xs sm:text-xs md:text-sm lg:text-lg">
                {scenario.difficulty} Difficulty • {scenario.tone || "Neutral"} Tone
              </div>
            </div>
          </div>
        </div>

        {/* User video side */}
        <div className="flex-1 bg-gradient-to-br from-blue-600 via-blue-500 to-cyan-600 flex items-center justify-center p-4 sm:p-6 md:p-8 relative overflow-hidden">
          <div className="relative z-10 w-full h-full max-w-full">
            <div className="relative w-full h-full overflow-hidden shadow-2xl border-2 sm:border-4 border-white/30 bg-black">
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className="w-full h-full object-cover transform scale-x-[-1]"
                onLoadedMetadata={() => videoRef.current?.play().catch(() => {})}
              />
              {!videoStream && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-white">
                  <Camera className="w-8 sm:w-10 md:w-14 lg:w-16 h-8 sm:h-10 md:h-14 lg:h-16 mb-2 sm:mb-3 md:mb-4 opacity-50" />
                  <p className="text-xs sm:text-sm md:text-base lg:text-lg">Camera not started</p>
                </div>
              )}
              {!isCameraOn && videoStream && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black text-white">
                  <CameraOff className="w-8 sm:w-10 md:w-14 lg:w-16 h-8 sm:h-10 md:h-14 lg:h-16 mb-2 sm:mb-3 md:mb-4" />
                  <p className="text-xs sm:text-sm md:text-base lg:text-lg">Camera is off</p>
                </div>
              )}
            </div>
            {isRecording && (
              <div className="absolute bottom-2 sm:bottom-3 md:bottom-6 lg:bottom-8 right-2 sm:right-3 md:right-6 lg:right-8 bg-red-900/80 backdrop-blur-sm px-2 sm:px-3 md:px-6 py-1 sm:py-2 md:py-3 rounded-full animate-pulse">
                <div className="text-white font-medium text-xs sm:text-xs md:text-base lg:text-lg flex items-center gap-1 sm:gap-1 md:gap-2">
                  <div className="w-1 sm:w-1.5 md:w-2 h-1 sm:h-1.5 md:h-2 bg-red-500 rounded-full" />
                  <span className="hidden sm:inline">Recording</span>
                </div>
              </div>
            )}
            {!isRecording && (
              <div className="absolute bottom-2 sm:bottom-3 md:bottom-6 lg:bottom-8 right-2 sm:right-3 md:right-6 lg:right-8 bg-blue-900/80 backdrop-blur-sm px-2 sm:px-3 md:px-6 py-1 sm:py-2 md:py-3 rounded-full">
                <p className="text-white font-medium text-xs sm:text-xs md:text-base lg:text-lg">You</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Start overlay */}
      {!conversationActive && (
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-40 p-4">
          <div className="bg-white rounded-2xl sm:rounded-3xl p-6 sm:p-8 lg:p-12 shadow-2xl max-w-sm sm:max-w-lg w-full text-center">
            <div className="bg-gradient-to-br from-purple-100 to-blue-100 rounded-full p-4 sm:p-6 lg:p-8 mb-4 sm:mb-6 inline-block">
              <Mic className="w-8 sm:w-12 lg:w-16 h-8 sm:h-12 lg:h-16 text-purple-600" />
            </div>
            <h3 className="text-xl sm:text-2xl lg:text-3xl font-bold text-slate-900 mb-2 sm:mb-3">Ready to Start?</h3>
            <p className="text-slate-600 mb-6 sm:mb-8 text-sm sm:text-base lg:text-lg">
              Click the button to begin your speech-to-speech role-play. The bot will speak first, then listen to you!
            </p>
            <Button
              onClick={startConversation}
              className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-sm sm:text-base lg:text-lg px-6 sm:px-8 py-4 sm:py-3 lg:py-6 w-full sm:w-auto h-auto flex items-center justify-center gap-2 mx-auto"
              disabled={isProcessing}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 sm:w-5 lg:w-6 h-4 sm:h-5 lg:h-6 mr-0 animate-spin" />
                  <span className="hidden sm:inline">Starting...</span>
                </>
              ) : (
                <>
                  <Mic className="w-4 sm:w-5 lg:w-6 h-4 sm:h-5 lg:h-6 mr-0" />
                  <span className="hidden sm:inline">Start Conversation</span>
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Error popup */}
      {limitPopup.open && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
          <div className="bg-white rounded-2xl p-6 sm:p-8 shadow-2xl max-w-sm w-full text-center">
            <h3 className="text-lg sm:text-xl lg:text-2xl font-bold text-slate-900 mb-2 sm:mb-3">Error</h3>
            <p className="text-slate-600 mb-4 sm:mb-6 text-sm sm:text-base">{limitPopup.message}</p>
            <div className="flex items-center justify-center gap-2 sm:gap-3 flex-col sm:flex-row">
              <Button
                onClick={() => { setLimitPopup({ open: false, message: "" }); onBack?.(); }}
                variant="outline"
                className="px-4 sm:px-6 w-full sm:w-auto text-sm sm:text-base h-auto py-2 sm:py-2"
              >
                Back
              </Button>
              <Button
                onClick={() => setLimitPopup({ open: false, message: "" })}
                className="px-4 sm:px-6 bg-blue-600 hover:bg-blue-700 w-full sm:w-auto text-sm sm:text-base h-auto py-2 sm:py-2"
              >
                Retry
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
