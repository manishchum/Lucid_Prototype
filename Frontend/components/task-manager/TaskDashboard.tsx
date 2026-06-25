/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { analyzePhoto } from '@/lib/photoAnalysisApi';
import AIFeedbackModal from '../AIFeedbackModal';
import { useAuth } from '@/contexts/auth-context';
import { fetchWithAuth } from '@/lib/fetch-with-auth';
import { useToast } from "@/hooks/use-toast";
import { 
  Plus, 
  Search, 
  Layers, 
  User, 
  Calendar, 
  CheckCircle, 
  Clock, 
  ExternalLink, 
  FileText, 
  ImageIcon, 
  ListTodo as QuizIcon,
  Play,
  Pause,
  ArrowRight,
  TrendingUp,
  Award,
  Users,
  Check,
  Send,
  Sparkles,
  Camera,
  CameraOff,
  Mic,
  Volume2 as VolumeIcon,
  Video as VideoIcon,
  VideoOff as VideoOffIcon,
  Circle as CircleIcon,
  Trash2
} from 'lucide-react';
import { AssignedTask, SubmissionFormat, TeamMember } from '@/types/task';
import type { SubmitTaskPayload } from '@/lib/taskApi';

interface TaskDashboardProps {
  assignedTasks: AssignedTask[];
  onStartCreateTask: () => void;
  userRole: 'admin' | 'employee';
  onSubmitTaskResponse?: (payload: Omit<SubmitTaskPayload, 'user_id'>) => Promise<{ submission_id: string; submission?: any }>;
  onTaskSubmitted?: (taskId: string, title: string, score: number, totalQ: number, questionsList: any[], submission?: any) => void;
  onTaskReassigned?: (originalTaskId: string, updatedTask: AssignedTask, mode: 'modify' | 'copy') => void;
  onTaskDeleted?: (assignmentId: string) => void;
  teamMembers?: TeamMember[];
  isWelcomePage?: boolean;
}

export default function TaskDashboard({ assignedTasks, onStartCreateTask, userRole, onSubmitTaskResponse, onTaskSubmitted, onTaskReassigned, onTaskDeleted, teamMembers = [], isWelcomePage = false }: TaskDashboardProps) {
  const { toast } = useToast();
  const { employeeData } = useAuth();
  // Debug: print a compact summary (id, status, submitted, submission) for easier inspection
  try {
    // console.log(
    //   "TASK DASHBOARD RECEIVED:",
    //   assignedTasks.map((t) => ({ id: t.id, status: t.status, submitted: (t as any).submitted, submission: (t as any).submission }))
    // );
  } catch (e) {
    // fallback to full object if mapping fails
    // console.log("TASK DASHBOARD RECEIVED:", assignedTasks);
  }
  const [searchQuery, setSearchQuery] = useState('');
  const [levelFilter, setLevelFilter] = useState<'all' | 'sprint' | 'individual'>('all');
  
  // Interactive submission tracking for employees
  const [activeSubmittingTaskId, setActiveSubmittingTaskId] = useState<string | null>(null);
  const [submittedTaskIds, setSubmittedTaskIds] = useState<Record<string, boolean>>({});
  const [submittingTaskIds, setSubmittingTaskIds] = useState<Record<string, boolean>>({});
  const [submitError, setSubmitError] = useState<Record<string, string>>({});
  const [pingedTaskIds, setPingedTaskIds] = useState<Record<string, boolean>>({});
  const [confirmDeleteTaskId, setConfirmDeleteTaskId] = useState<string | null>(null);
  
  // Form responses
  const [textResponses, setTextResponses] = useState<Record<string, string>>({});
  const [imageFiles, setImageFiles] = useState<Record<string, string>>({});
  const [imageAnalysis, setImageAnalysis] = useState<Record<string, any>>({});
  const [analyzingImage, setAnalyzingImage] = useState<Record<string, boolean>>({});
  const [audioFiles, setAudioFiles] = useState<Record<string, string>>({});
  const [videoFiles, setVideoFiles] = useState<Record<string, string>>({});
  const [quizAnswers, setQuizAnswers] = useState<Record<string, Record<string, string>>>({});

  // AI Feedback Modal State
  const [selectedFeedbackSubmission, setSelectedFeedbackSubmission] = useState<any>(null);

  // AI Report Generation Modal State
  const [selectedReportTask, setSelectedReportTask] = useState<AssignedTask | null>(null);
  const [selectedSubtaskId, setSelectedSubtaskId] = useState<string>('');
  const [reportDuration, setReportDuration] = useState('30_days');
  const [reportEmail, setReportEmail] = useState('');
  const [generatingReport, setGeneratingReport] = useState(false);
  const [reportFeedback, setReportFeedback] = useState('');

  const handleGenerateAIReport = async () => {
    if (!selectedReportTask) return;
    setGeneratingReport(true);
    setReportFeedback('');
    try {
      const activeTaskId = selectedSubtaskId || selectedReportTask.tasks[0]?.id || selectedReportTask.id;
      const url = `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'}/api/reports/generate`;
      const response = await fetchWithAuth(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(employeeData?.company_id ? { 'X-Company-ID': employeeData.company_id } : {}),
        },
        body: JSON.stringify({
          task_id: activeTaskId,
          duration: reportDuration,
          email: reportEmail || undefined,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to generate report');
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      const activeSubtask = selectedReportTask.tasks.find(t => t.id === activeTaskId);
      const taskTitleClean = (activeSubtask?.title || 'report').slice(0, 15).replace(/\s+/g, '_');
      link.setAttribute('download', `AI_Report_${taskTitleClean}_${Date.now()}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.parentNode?.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);
      
      toast({
        description: "Report generated successfully",
      });
      setSelectedReportTask(null);
    } catch (err: any) {
      console.error(err);
      setReportFeedback(`Generation failed: ${err.message}`);
    } finally {
      setGeneratingReport(false);
    }
  };

  // Reassignment Form State
  const [reassigningTaskId, setReassigningTaskId] = useState<string | null>(null);
  const [reassignLevel, setReassignLevel] = useState<'sprint' | 'individual'>('sprint');
  const [reassignSprints, setReassignSprints] = useState<string[]>([]);
  const [reassignOrgs, setReassignOrgs] = useState<string[]>([]);
  const [reassignFunctions, setReassignFunctions] = useState<string[]>([]);
  const [reassignSubFunctions, setReassignSubFunctions] = useState<string[]>([]);
  const [reassignIndividuals, setReassignIndividuals] = useState<string[]>([]);
  const [reassignDueDate, setReassignDueDate] = useState<string>('');
  const [reassignRecurrence, setReassignRecurrence] = useState<'none' | 'every_2_days' | 'weekly' | 'monthly'>('none');
  const [reassignMode, setReassignMode] = useState<'modify' | 'copy'>('copy');

  const startReassigning = (taskObj: AssignedTask) => {
    setReassigningTaskId(taskObj.id);
    setReassignLevel(taskObj.level === 'sprint' ? 'sprint' : 'individual');
    setReassignSprints(taskObj.targetSprints || []);
    setReassignOrgs(taskObj.targetOrgs || []);
    setReassignFunctions(taskObj.targetFunctions || []);
    setReassignSubFunctions(taskObj.targetSubFunctions || []);
    setReassignIndividuals(taskObj.targetIndividuals || []);
    setReassignDueDate(taskObj.dueDate || '');
    setReassignRecurrence(taskObj.recurrence || 'none');
    setReassignMode('copy');
  };

  const handleConfirmReassign = (originalTask: AssignedTask) => {
    const calculatedLevel = reassignLevel === 'sprint' ? 'sprint' : 'individual';
    const usersCount = calculatedLevel === 'sprint'
      ? Math.max(reassignSprints.length, 1) * 5
      : reassignIndividuals.length > 0
        ? reassignIndividuals.length
        : Math.max(reassignFunctions.length, 1) * 4;

    const updatedTask: AssignedTask = {
      ...originalTask,
      id: reassignMode === 'copy' ? `task-assigned-${Date.now()}` : originalTask.id,
      level: calculatedLevel,
      targetSprints: calculatedLevel === 'sprint' ? reassignSprints : [],
      targetOrgs: calculatedLevel !== 'sprint' ? reassignOrgs : [],
      targetFunctions: calculatedLevel !== 'sprint' ? reassignFunctions : [],
      targetSubFunctions: calculatedLevel !== 'sprint' ? reassignSubFunctions : [],
      targetIndividuals: calculatedLevel !== 'sprint' ? reassignIndividuals : [],
      dueDate: reassignDueDate || new Date().toISOString().split('T')[0],
      recurrence: reassignRecurrence,
      createdAt: reassignMode === 'copy' ? new Date().toISOString().split('T')[0] : originalTask.createdAt,
      totalTargetUsersCount: usersCount,
      completionCount: reassignMode === 'copy' ? 0 : originalTask.completionCount,
    };

    if (onTaskReassigned) {
      onTaskReassigned(originalTask.id, updatedTask, reassignMode);
    }
    setReassigningTaskId(null);
  };

  // Camera capture states
  const [activeCameraTaskId, setActiveCameraTaskId] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);

  // Audio recording states
  const [activeRecordingAudioTaskId, setActiveRecordingAudioTaskId] = useState<string | null>(null);
  const [isAudioRecording, setIsAudioRecording] = useState(false);
  const [audioTimer, setAudioTimer] = useState(0);
  const audioIntervalRef = React.useRef<any>(null);
  const audioStreamRef = React.useRef<MediaStream | null>(null);
  const audioRecorderRef = React.useRef<MediaRecorder | null>(null);
  const audioChunksRef = React.useRef<Blob[]>([]);

  // Video recording states
  const [activeRecordingVideoTaskId, setActiveRecordingVideoTaskId] = useState<string | null>(null);
  const [isVideoRecording, setIsVideoRecording] = useState(false);
  const [videoTimer, setVideoTimer] = useState(0);
  const videoIntervalRef = React.useRef<any>(null);
  const videoStreamRef = React.useRef<MediaStream | null>(null);
  const videoRecorderRef = React.useRef<MediaRecorder | null>(null);
  const videoChunksRef = React.useRef<Blob[]>([]);
  const liveVideoPlaybackRef = React.useRef<HTMLVideoElement | null>(null);

  React.useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (videoStreamRef.current) {
        videoStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (audioIntervalRef.current) {
        clearInterval(audioIntervalRef.current);
      }
      if (videoIntervalRef.current) {
        clearInterval(videoIntervalRef.current);
      }
    };
  }, [stream]);

  // Filter tasks based on Search bar and Select controls
  const filteredTasks = (assignedTasks || []).filter(task => {
    const matchesLevel = levelFilter === 'all' || task.level === levelFilter || (levelFilter === 'individual' && task.level !== 'sprint');
    
    // Check if search match in title, description, or target audience
    const matchesSearch = searchQuery.trim() === '' || 
      task.tasks.some(sub => 
        sub.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
        sub.description.toLowerCase().includes(searchQuery.toLowerCase())
      ) ||
      (task.targetSprints || []).some(s => String(s).toLowerCase().includes(searchQuery.toLowerCase())) ||
      (task.targetFunctions || []).some(f => String(f).toLowerCase().includes(searchQuery.toLowerCase())) ||
      (task.targetIndividuals || []).some(i => String(i).toLowerCase().includes(searchQuery.toLowerCase()));

    return matchesLevel && matchesSearch;
  });

  // console.log("FILTERED TASKS:", filteredTasks);

  // Calculate cumulative stats for the Progress Card
  const totalCreatedTasks = assignedTasks.length;
  const completedTaskCount = assignedTasks.filter(t => t.status === 'Completed' || submittedTaskIds[t.id]).length;
  const completionPercentage = totalCreatedTasks > 0 
    ? Math.round((completedTaskCount / totalCreatedTasks) * 100) 
    : 0;

  // Handle employee interactions
  const handleAnswerQuiz = (taskId: string, questionId: string, option: string) => {
    setQuizAnswers(prev => ({
      ...prev,
      [taskId]: {
        ...(prev[taskId] || {}),
        [questionId]: option
      }
    }));
  };

  const handleImageUploadSimulated = (taskId: string) => {
    // Inject a simulated image path
    const mockImages = [
      'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=400&q=85',
      'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=400&q=85',
      'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=400&q=85'
    ];
    const chosenImg = mockImages[Math.floor(Math.random() * mockImages.length)];
    setImageFiles(prev => ({
      ...prev,
      [taskId]: chosenImg
    }));
    // Run analysis on mock image (only for admin/testing)
    if (userRole === 'admin') {
      runPhotoAnalysis(taskId, chosenImg);
    }
  };

  const startCamera = async (taskId: string) => {
    try {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      const mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      setStream(mediaStream);
      setActiveCameraTaskId(taskId);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
      }, 150);
    } catch (err) {
      console.error("Error starting camera:", err);
      alert("Could not access camera. Please check camera permissions or use the Mock Upload option instead!");
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
    setStream(null);
    setActiveCameraTaskId(null);
  };

  const captureLivePicture = (taskId: string) => {
    if (!videoRef.current) return;
    try {
      const video = videoRef.current;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg');
        setImageFiles(prev => ({
          ...prev,
          [taskId]: dataUrl
        }));
        // Start analysis after capturing (only for admin/testing)
        if (userRole === 'admin') {
          runPhotoAnalysis(taskId, dataUrl);
        }
        stopCamera();
      }
    } catch (err) {
      console.error("Error capturing picture:", err);
    }
  };


  const runPhotoAnalysis = async (taskId: string, image: string) => {
    const taskObj = assignedTasks.find(t => t.id === taskId);
    if (!taskObj) return;

    setAnalyzingImage(prev => ({ ...prev, [taskId]: true }));
    try {
      const result = await analyzePhoto(image, taskObj.tasks[0].description);
      setImageAnalysis(prev => ({ ...prev, [taskId]: result }));
    } catch (e) {
      console.error('Photo analysis error', e);
    } finally {
      setAnalyzingImage(prev => ({ ...prev, [taskId]: false }));
    }
  };

  const blobToDataUrl = (blob: Blob): Promise<string> => (
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    })
  );

  // Audio recording helpers
  const startAudioRecording = async (taskId: string) => {
    try {
      audioChunksRef.current = [];
      const userStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = userStream;
      
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(userStream);
      } catch (e) {
        recorder = new MediaRecorder(userStream, { mimeType: 'audio/webm' });
      }
      
      audioRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      
      recorder.onstop = async () => {
        const mimeType = recorder.mimeType || 'audio/webm';
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        const audioUrl = await blobToDataUrl(audioBlob);
        setAudioFiles(prev => ({ ...prev, [taskId]: audioUrl }));
      };

      recorder.start();
      setIsAudioRecording(true);
      setActiveRecordingAudioTaskId(taskId);
      setAudioTimer(0);
      audioIntervalRef.current = setInterval(() => {
        setAudioTimer(prev => prev + 1);
      }, 1000);
    } catch (err) {
      console.error("Audio recording failed:", err);
      alert("Microphone access unavailable in this sandbox. Simulating a live digital microphone input...");
      simulateMockAudio(taskId);
    }
  };

  const simulateMockAudio = (taskId: string) => {
    setAudioTimer(0);
    setIsAudioRecording(true);
    setActiveRecordingAudioTaskId(taskId);
    audioIntervalRef.current = setInterval(() => {
      setAudioTimer(prev => {
        if (prev >= 5) {
          clearInterval(audioIntervalRef.current!);
          setIsAudioRecording(false);
          setActiveRecordingAudioTaskId(null);
          setAudioFiles(prevFiles => ({
            ...prevFiles,
            [taskId]: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3'
          }));
          return 0;
        }
        return prev + 1;
      });
    }, 1000);
  };

  const stopAudioRecording = () => {
    if (audioRecorderRef.current && audioRecorderRef.current.state !== 'inactive') {
      audioRecorderRef.current.stop();
    }
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach(track => track.stop());
    }
    if (audioIntervalRef.current) {
      clearInterval(audioIntervalRef.current);
    }
    setIsAudioRecording(false);
    setActiveRecordingAudioTaskId(null);
  };

  // Video recording helpers
  const startVideoRecording = async (taskId: string) => {
    try {
      videoChunksRef.current = [];
      const userStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      videoStreamRef.current = userStream;
      
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(userStream, { mimeType: 'video/webm;codecs=vp8,opus' });
      } catch (e) {
        recorder = new MediaRecorder(userStream);
      }
      
      videoRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          videoChunksRef.current.push(event.data);
        }
      };
      
      recorder.onstop = () => {
        const videoBlob = new Blob(videoChunksRef.current, { type: 'video/webm' });
        const videoUrl = URL.createObjectURL(videoBlob);
        setVideoFiles(prev => ({ ...prev, [taskId]: videoUrl }));
      };

      recorder.start();
      setIsVideoRecording(true);
      setActiveRecordingVideoTaskId(taskId);
      setVideoTimer(0);
      videoIntervalRef.current = setInterval(() => {
        setVideoTimer(prev => prev + 1);
      }, 1000);

      // Playback active stream
      setTimeout(() => {
        if (liveVideoPlaybackRef.current) {
          liveVideoPlaybackRef.current.srcObject = userStream;
        }
      }, 200);

    } catch (err) {
      console.error("Video recording failed:", err);
      alert("Camera/microphone access unavailable in this sandbox. Simulating high-fidelity live video capture...");
      simulateMockVideo(taskId);
    }
  };

  const simulateMockVideo = (taskId: string) => {
    setVideoTimer(0);
    setIsVideoRecording(true);
    setActiveRecordingVideoTaskId(taskId);
    videoIntervalRef.current = setInterval(() => {
      setVideoTimer(prev => {
        if (prev >= 6) {
          clearInterval(videoIntervalRef.current!);
          setIsVideoRecording(false);
          setActiveRecordingVideoTaskId(null);
          setVideoFiles(prevFiles => ({
            ...prevFiles,
            [taskId]: 'https://assets.mixkit.co/videos/preview/mixkit-forest-stream-in-the-sunlight-529-large.mp4'
          }));
          return 0;
        }
        return prev + 1;
      });
    }, 1000);
  };

  const stopVideoRecording = () => {
    if (videoRecorderRef.current && videoRecorderRef.current.state !== 'inactive') {
      videoRecorderRef.current.stop();
    }
    if (videoStreamRef.current) {
      videoStreamRef.current.getTracks().forEach(track => track.stop());
    }
    if (videoIntervalRef.current) {
      clearInterval(videoIntervalRef.current);
    }
    setIsVideoRecording(false);
    setActiveRecordingVideoTaskId(null);
  };

  const handleTextAnswerChange = (taskId: string, val: string) => {
    setTextResponses(prev => ({
      ...prev,
      [taskId]: val
    }));
  };

  const handleSubmitVerification = async (taskId: string) => {
    // Validate response exists
    const taskObj = assignedTasks.find(t => t.id === taskId);
    if (!taskObj) return;

    // Clear previous error
    setSubmitError(prev => ({ ...prev, [taskId]: '' }));

    for (const sub of taskObj.tasks) {
      if (sub.submissionFormat === 'text' && !textResponses[taskId]?.trim()) {
        setSubmitError(prev => ({ ...prev, [taskId]: `Oops! Please write a text response for: ${sub.title}` }));
        return;
      }
      if (sub.submissionFormat === 'image' && !imageFiles[taskId]) {
        setSubmitError(prev => ({ ...prev, [taskId]: `Oops! Please provide a photo verification for: ${sub.title}` }));
        return;
      }
      	  if (sub.submissionFormat === 'image' && imageAnalysis[taskId]?.passed === false) {
        setSubmitError(prev => ({ ...prev, [taskId]: `AI verification failed. Please upload correct image.` }));
        return;
      }
      if (sub.submissionFormat === 'audio' && !audioFiles[taskId]) {
        setSubmitError(prev => ({ ...prev, [taskId]: `Oops! Please record or verify audio for: ${sub.title}` }));
        return;
      }
      if (sub.submissionFormat === 'video' && !videoFiles[taskId]) {
        setSubmitError(prev => ({ ...prev, [taskId]: `Oops! Please record or verify video for: ${sub.title}` }));
        return;
      }
      if (sub.submissionFormat === 'multiple_choice') {
        const questionsCount = sub.questions.length;
        const answersCount = Object.keys(quizAnswers[taskId] || {}).length;
        if (questionsCount > 0 && answersCount < questionsCount) {
          setSubmitError(prev => ({ ...prev, [taskId]: `Oops! Please answer all multiple choice questions for: ${sub.title}` }));
          return;
        }
      }
    }

    // Build reports details
    let totalQuestionsCount = 0;
    let earnedScore = 0;
    const questionsList: any[] = [];

    taskObj.tasks.forEach(sub => {
      if (sub.submissionFormat === 'multiple_choice') {
        sub.questions.forEach(q => {
          totalQuestionsCount += 1;
          const chosen = quizAnswers[taskId]?.[q.id] || 'None';
          // Assume option [0] is correct, or make it dynamic
          const correctAns = q.options[0] || 'A';
          const isCorrectAnswer = chosen === correctAns;
          if (isCorrectAnswer) earnedScore += 1;
          questionsList.push({
            question: q.question,
            submittedAnswer: chosen,
            correctAnswer: correctAns,
            isCorrect: isCorrectAnswer,
            points: isCorrectAnswer ? 1 : 0
          });
        });
      } else {
        totalQuestionsCount += 1;
        earnedScore += 1; // standard text/image uploads get full points upon submission
        let submittedText = 'None';
        let expectedText = 'Standard Response Delivered';
        
        if (sub.submissionFormat === 'image') {
          submittedText = imageFiles[taskId] ? 'Verified Image Uploaded' : 'None';
          expectedText = 'Verified Image Uploaded';
        } else if (sub.submissionFormat === 'audio') {
          submittedText = audioFiles[taskId] ? 'Verified Audio Recorded' : 'None';
          expectedText = 'Verified Audio Recorded';
        } else if (sub.submissionFormat === 'video') {
          submittedText = videoFiles[taskId] ? 'Verified Video Recorded' : 'None';
          expectedText = 'Verified Video Recorded';
        } else {
          submittedText = textResponses[taskId] || 'None';
        }

        questionsList.push({
          question: sub.title + ' Verification Requirement',
          submittedAnswer: submittedText,
          correctAnswer: expectedText,
          isCorrect: true,
          points: 1
        });
      }
    });

    try {
      setSubmittingTaskIds(prev => ({ ...prev, [taskId]: true }));

      let firstSubmissionResponse: any = null;
      if (onSubmitTaskResponse) {
        await Promise.all(taskObj.tasks.map(async (sub) => {
          const normalizeSubmissionType = (val: any): string => {
            if (Array.isArray(val)) return String(val[0] || 'text');
            return String(val || 'text');
          };

          const payload: Omit<SubmitTaskPayload, 'user_id'> = {
            task_id: sub.id,
            assignment_id: taskObj.id,
            submission_type: normalizeSubmissionType(sub.submissionFormat),
            score: earnedScore,
            max_score: totalQuestionsCount,
          };

          if (sub.submissionFormat === 'multiple_choice') {
            payload.answers = sub.questions.map((q) => ({
              question_id: q.id,
              question: q.question || 'Standard Question',
              selected_option: quizAnswers[taskId]?.[q.id] || '',
              correct_answer: q.options[0] || 'A',
            })) as any;
          } else if (sub.submissionFormat === 'image') {
            payload.image_url = imageFiles[taskId];

            const ai = imageAnalysis[taskId];

            if (ai) {
              payload.ai_validation_pass = ai.passed;

              payload.ai_validation_verdict =
                ai.passed ? "PASS" : "FAIL";

              payload.ai_validation_reason =
                ai.feedback || "";

              payload.ai_validation_suggestion =
                ai.passed
                  ? "Image successfully matched task requirement"
                  : ai.feedback || "Please submit correct image";


              payload.ai_validation_confidence =
                ai.score >= 80
                  ? "high"
                  : ai.score >= 50
                    ? "medium"
                    : "low";


              payload.ai_status =
                "completed";


              // console.log(
              //   "IMAGE AI SAVING PAYLOAD:",
              //   {
              //     pass: payload.ai_validation_pass,
              //     verdict: payload.ai_validation_verdict,
              //     reason: payload.ai_validation_reason,
              //     suggestion: payload.ai_validation_suggestion,
              //     confidence: payload.ai_validation_confidence,
              //     status: payload.ai_status
              //   }
              // );
            }
          } else if (sub.submissionFormat === 'audio') {
            payload.audio_url = audioFiles[taskId];
          } else if (sub.submissionFormat === 'video') {
            payload.text_response = videoFiles[taskId];
          } else {
            payload.text_response = textResponses[taskId]?.trim();
          }

          const response = await onSubmitTaskResponse(payload);
          if (!firstSubmissionResponse) firstSubmissionResponse = response;
          return response;
        }));
      }

      if (onTaskSubmitted) {
        const primaryTitle = taskObj.tasks[0]?.title || 'Module Assessment';
        onTaskSubmitted(taskId, primaryTitle, earnedScore, totalQuestionsCount, questionsList, firstSubmissionResponse);
      }

      // Accept submission
      setSubmittedTaskIds(prev => ({
        ...prev,
        [taskId]: true
      }));
      setActiveSubmittingTaskId(null);
    } catch (err: any) {
      setSubmitError(prev => ({
        ...prev,
        [taskId]: err?.message || 'Unable to submit this response. Please try again.',
      }));
    } finally {
      setSubmittingTaskIds(prev => ({ ...prev, [taskId]: false }));
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">

      {/* 2. Your Progress Banner Card, exact visual match to image progress circle */}
      {/* <div className="bg-white rounded-3xl p-6 border border-[#E2E8F0] shadow-sm flex flex-col md:flex-row items-center justify-between gap-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-[#2F63FF]/5 rounded-bl-full pointer-events-none"></div>
        
        <div className="flex items-center space-x-4 flex-1">
          <div className="w-12 h-12 bg-blue-50 text-[#2F63FF] rounded-2xl flex items-center justify-center">
            <TrendingUp size={22} className="stroke-[2.5]" />
          </div>
          <div>
            <h3 className="font-display font-bold text-lg text-[#0F172A]">Task Metrics Overview</h3>
            <p className="text-xs text-gray-400 font-sans mt-0.5">
              Monitor real-time task fulfilment, sprint completion ratios, and employee compliance logs.
            </p>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 bg-emerald-50 border border-emerald-150 px-2.5 py-0.5 rounded-full font-sans">
                {completedTaskCount} COMPLETED
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#2F63FF] font-sans bg-[#EEF2FF] px-2.5 py-0.5 rounded-full">
                {totalCreatedTasks} TOTAL TASKS
              </span>
            </div>
          </div>
         </div> */}

        {/* Circular gauge mimicking design */}
        {/* <div className="flex items-center space-x-4 pr-4">
          <div className="text-right">
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block font-sans">COMPLETION RATE</span>
            <span className="text-xs font-bold text-[#0F172A]">{completedTaskCount} of {totalCreatedTasks} tasks</span>
          </div> */}
{/*           
          <div className="relative flex items-center justify-center w-20 h-20">
            <svg className="w-20 h-20 transform -rotate-90">
              <circle
                cx="40"
                cy="40"
                r="34"
                stroke="#F1F5F9"
                strokeWidth="7"
                fill="transparent"
              />
              <circle
                cx="40"
                cy="40"
                r="34"
                stroke="#2F63FF"
                strokeWidth="7"
                fill="transparent"
                strokeDasharray={2 * Math.PI * 34}
                strokeDashoffset={2 * Math.PI * 34 * (1 - (completionPercentage / 100))}
                className="transition-all duration-1000 ease-out"
              />
            </svg>
            <div className="absolute font-display font-bold text-[#0F172A] text-lg">
              {completionPercentage}%
            </div>
          </div>
        </div>
      </div> */}

      {/* 3. Filter Grid and Controller Header */}
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between border-b border-[#E2E8F0] pb-4">
        <h2 className="text-[#0F172A] font-display font-medium text-sm flex items-center space-x-2">
          <span>Assigned Tasks & Sprints</span>
          <span className="bg-[#2F63FF]/10 text-[#2F63FF] font-sans text-[10px] px-2.5 py-0.5 rounded-full font-bold">
            {filteredTasks.length} Active
          </span>
        </h2>

        <div className="flex flex-col sm:flex-row gap-3 items-center w-full sm:w-auto">
          {userRole === 'admin' && (
            <button
              type="button"
              onClick={onStartCreateTask}
              className="w-full sm:w-auto px-4 py-2.5 text-xs font-bold text-white bg-[#2F63FF] hover:bg-blue-600 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-sm shrink-0"
            >
              <Plus size={13} />
              <span>Create Task</span>
            </button>
          )}
          {/* Search bar */}
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-3.5 text-gray-400" size={14} />
            <input
              type="text"
              placeholder="Search tasks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full text-xs border border-[#E2E8F0] bg-white rounded-xl pl-9 pr-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#2F63FF]"
            />
          </div>

          {/* Level Filter Switch */}
          <div className="flex bg-[#E2E8F0] p-1 rounded-xl w-full sm:w-auto">
            <button
              onClick={() => setLevelFilter('all')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer w-full sm:w-auto text-center ${
                levelFilter === 'all' ? 'bg-white text-[#0F172A] shadow-sm' : 'text-[#64748B]'
              }`}
            >
              All Tasks
            </button>
            <button
              onClick={() => setLevelFilter('sprint')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer w-full sm:w-auto text-center ${
                levelFilter === 'sprint' ? 'bg-white text-[#2F63FF] shadow-sm' : 'text-[#64748B]'
              }`}
            >
              Sprint Slices
            </button>
            <button
              onClick={() => setLevelFilter('individual')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer w-full sm:w-auto text-center ${
                levelFilter === 'individual' ? 'bg-white text-[#2F63FF] shadow-sm' : 'text-[#64748B]'
              }`}
            >
              Individual Sprints
            </button>
          </div>
        </div>
      </div>

      {/* 4. Real Interactive Grid matching pixel colors from image */}
      {filteredTasks.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-3xl border border-[#E2E8F0] shadow-sm max-w-xl mx-auto">
          <Clock className="mx-auto text-gray-300 mb-3" size={48} />
          <h3 className="font-display font-medium text-[#0F172A] text-sm">No tasks assigned at this time</h3>
          <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto font-sans">
            Specify alternative search criteria or launch a new task flow from the administrator console.
          </p>
          {userRole === 'admin' && (
            <button
              type="button"
              onClick={onStartCreateTask}
              className="text-xs font-semibold text-[#2F63FF] border border-gray-100 hover:bg-slate-50 bg-white px-4 py-2 rounded-xl mt-4 inline-flex items-center space-x-1 cursor-pointer"
            >
              <Plus size={14} /> <span>Create Task Flow</span>
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredTasks.map((task) => {
            // treat backend-provided submission (attached to the assignment) as completed by this user
            const isCompletedByMe =
              task.status === 'Completed' ||
              task.submitted === true ||
              Boolean((task as any).submission) ||
              !!submittedTaskIds[task.id];
            const isSubmittingActive = activeSubmittingTaskId === task.id;
            const isSubmittingNow = !!submittingTaskIds[task.id];
            const latestSubmission = (task as any).submission || null;

            return (
              <div 
                key={task.id} 
                className={`bg-white rounded-2xl border transition-all flex flex-col justify-between overflow-hidden relative shadow-sm hover:shadow-md ${
                  isCompletedByMe 
                    ? 'border-emerald-300 ring-2 ring-emerald-50/50' 
                    : isSubmittingActive
                      ? 'border-[#2F63FF] ring-4 ring-indigo-50'
                      : 'border-[#E2E8F0]'
                }`}
              >
                {/* 1. Card Top Accent Color bar */}
                <div className={`h-1.5 w-full ${isCompletedByMe ? 'bg-[#10B981]' : 'bg-[#2F63FF]'}`} />

                <div className="p-5 flex-1 flex flex-col justify-between">
                  <div>
                    {/* Header meta */}
                    <div className="flex items-center justify-between mb-3.5">
                      <div className="flex flex-wrap gap-1.5 items-center">
                        <span className={`text-[10px] font-sans font-bold tracking-wide uppercase px-2.5 py-0.5 rounded-full ${
                          task.level === 'sprint'
                            ? 'bg-[#EEF2FF] text-[#2F63FF]'
                            : 'bg-amber-50 text-amber-600'
                        }`}>
                          {task.level === 'sprint' ? '🚀 Sprint Level' : '👥 User Group'}
                        </span>
                        {task.recurrence && task.recurrence !== 'none' && (
                          <span className="inline-flex items-center space-x-1 text-[9px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full font-sans">
                            <span>🔁</span>
                            <span className="capitalize">{task.recurrence.replace(/_/g, ' ')}</span>
                          </span>
                        )}
                      </div>
                      
                      <span className={`text-[10px] font-medium flex items-center space-x-1 ${
                        isCompletedByMe ? 'text-[#10B981]' : 'text-gray-500 font-sans'
                      }`}>
                        {isCompletedByMe ? (
                          <>
                            <CheckCircle size={12} />
                            <span>Completed & Verified</span>
                          </>
                        ) : (
                          <>
                            <Clock size={12} />
                            <span>Due Date: {task.dueDate}</span>
                          </>
                        )}
                      </span>
                    </div>

                    {/* Task Title Payload info */}
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold text-gray-400 font-sans block">ASSIGNED WORKFLOW</span>
                      <h3 className="font-display font-medium text-[#0F172A] leading-snug text-sm tracking-tight text-[#0F172A] font-bold">
                        {task.tasks.map(t => t.title).join(' • ')}
                      </h3>
                    </div>


                  </div>

                  {/* Task sub-items information displaying list of child tasks */}
                  <div className="my-4 bg-slate-50 rounded-xl p-3 border border-[#F1F5F9]">
                    <span className="text-[9px] font-bold text-gray-400 font-sans block uppercase mb-1.5">Requirements Checklist</span>
                    <div className="space-y-2">
                      {task.tasks.map((sub, sIdx) => {
                        return (
                           <div key={sub.id} className="flex items-start space-x-2">
                            <span className="text-[9px] bg-white border font-sans font-bold w-4.5 h-4.5 rounded-md flex items-center justify-center text-[#2F63FF]">
                              {sIdx + 1}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="text-[11px] font-semibold text-[#0F172A] truncate">{sub.title}</p>
                              <div className="flex items-center space-x-1 text-[9px] text-[#64748B] mt-0.5">
                                {sub.submissionFormat === 'image' && <ImageIcon size={9} className="text-[#2F63FF]" />}
                                {sub.submissionFormat === 'text' && <FileText size={9} className="text-[#2F63FF]" />}
                                {sub.submissionFormat === 'multiple_choice' && <QuizIcon size={9} className="text-[#2F63FF]" />}
                                {sub.submissionFormat === 'audio' && <Mic size={9} className="text-[#2F63FF]" />}
                                {sub.submissionFormat === 'video' && <VideoIcon size={9} className="text-[#2F63FF]" />}
                                <span className="capitalize">
                                  {sub.submissionFormat === 'multiple_choice' 
                                    ? 'Quiz form' 
                                    : `${sub.submissionFormat} submission`}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Interactive area - based on role */}
                  <div className="mt-4 pt-4 border-t border-[#F1F5F9]">
                    {userRole === 'admin' ? (
                      /* Admin details view */
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <div className="text-left">
                            <span className="text-[8px] font-sans text-gray-400 block uppercase">COMPLETION LOGS</span>
                            <span className="text-xs font-bold text-[#2F63FF] font-sans">
                              {task.completionCount} / {task.totalTargetUsersCount} users completed
                            </span>
                          </div>
                          
                          {confirmDeleteTaskId === task.id ? (
                            <div className="flex items-center space-x-2 animate-fade-in">
                              <button
                                type="button"
                                onClick={() => {
                                  if (onTaskDeleted) {
                                    onTaskDeleted(task.id);
                                  }
                                  setConfirmDeleteTaskId(null);
                                }}
                                className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-red-200 bg-red-50 text-red-650 hover:bg-red-100 hover:border-red-300 transition-all cursor-pointer"
                              >
                                Confirm Delete
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteTaskId(null)}
                                className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-all cursor-pointer"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center space-x-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedReportTask(task);
                                  setSelectedSubtaskId(task.tasks[0]?.id || '');
                                  setReportFeedback('');
                                  setReportDuration('30_days');
                                  setReportEmail('');
                                }}
                                className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-[#2F63FF]/20 bg-[#EEF2FF]/40 text-[#2F63FF] hover:bg-[#EEF2FF] hover:border-[#2F63FF]/30 transition-all flex items-center space-x-1 cursor-pointer"
                              >
                                <span>Generate AI Report 📊</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => startReassigning(task)}
                                className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:text-[#2F63FF] hover:border-[#2F63FF]/30 hover:bg-[#EEF2FF]/40 transition-all flex items-center space-x-1 cursor-pointer"
                              >
                                <span>Reassign 🔄</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => setPingedTaskIds(prev => ({ ...prev, [task.id]: true }))}
                                className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-all cursor-pointer ${
                                  pingedTaskIds[task.id]
                                    ? 'bg-emerald-50 text-emerald-600 border-emerald-200'
                                    : 'text-gray-500 hover:text-indigo-600 border-gray-200 bg-white shadow-sm'
                                }`}
                              >
                                {pingedTaskIds[task.id] ? 'Sent! ' : 'Send Reminder 🔔'}
                              </button>

                              <button
                                type="button"
                                onClick={() => setConfirmDeleteTaskId(task.id)}
                                className="text-xs font-semibold p-1.5 rounded-lg border border-red-100 bg-white text-red-500 hover:text-white hover:bg-red-500 hover:border-red-500 transition-all cursor-pointer flex items-center justify-center shadow-sm"
                                title="Delete Task"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Inline Reassign Section */}
                        {reassigningTaskId === task.id && (
                          <div className="mt-4 p-4 border border-[#2F63FF]/20 bg-slate-50/50 rounded-xl space-y-4 animate-fade-in text-left">
                            <div className="flex items-center justify-between border-b border-gray-150 pb-2">
                              <span className="text-xs font-bold font-sans text-[#0F172A] flex items-center space-x-1">
                                <span>Reassign / Re-target Task</span>
                              </span>
                              <button
                                type="button"
                                onClick={() => setReassigningTaskId(null)}
                                className="text-xs font-bold text-gray-450 hover:text-gray-600 cursor-pointer bg-transparent border-none p-0"
                              >
                                &times; Close
                              </button>
                            </div>

                            {/* Mode Selection */}
                            <div className="grid grid-cols-2 gap-2 p-1 bg-gray-100/70 rounded-lg">
                              <button
                                type="button"
                                onClick={() => setReassignMode('copy')}
                                className={`text-[10px] font-bold py-1.5 rounded-md transition-all cursor-pointer ${
                                  reassignMode === 'copy' 
                                    ? 'bg-white text-[#2F63FF] shadow-xs' 
                                    : 'text-gray-500 hover:text-gray-700'
                                }`}
                              >
                                Clone as New Task
                              </button>
                              <button
                                type="button"
                                onClick={() => setReassignMode('modify')}
                                className={`text-[10px] font-bold py-1.5 rounded-md transition-all cursor-pointer ${
                                  reassignMode === 'modify' 
                                    ? 'bg-white text-amber-600 shadow-xs' 
                                    : 'text-gray-500 hover:text-gray-700'
                                }`}
                              >
                                Modify Target In-Place
                              </button>
                            </div>

                            {/* Level Switch */}
                            <div className="space-y-1">
                              <label className="text-[9px] font-sans font-bold text-gray-400 uppercase tracking-widest block">Assignment Type</label>
                              <div className="grid grid-cols-2 gap-2">
                                <button
                                  type="button"
                                  onClick={() => setReassignLevel('sprint')}
                                  className={`text-xs py-1 rounded-md border text-center font-medium transition-all cursor-pointer ${
                                    reassignLevel === 'sprint'
                                      ? 'border-[#2F63FF] bg-[#2F63FF]/5 text-[#2F63FF]'
                                      : 'border-slate-200 bg-white text-gray-600'
                                  }`}
                                >
                                  Sprint Level
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setReassignLevel('individual')}
                                  className={`text-xs py-1 rounded-md border text-center font-medium transition-all cursor-pointer ${
                                    reassignLevel === 'individual'
                                      ? 'border-[#2F63FF] bg-[#2F63FF]/5 text-[#2F63FF]'
                                      : 'border-slate-200 bg-white text-gray-600'
                                  }`}
                                >
                                  Custom Cohort
                                </button>
                              </div>
                            </div>

                            {/* Audience Chooser */}
                            {reassignLevel === 'sprint' ? (
                              <div className="space-y-1">
                                <label className="text-[9px] font-sans font-bold text-gray-400 uppercase block">Select Sprints</label>
                                <div className="space-y-1 max-h-32 overflow-y-auto border border-gray-150 rounded-lg p-1.5 bg-white">
                                  {['Brewing Tools Fundamentals', 'Detailing_Orientation_Sprint', 'Grayscale image colourization', 'Core System Diagnostics Hub'].map((title) => {
                                    const isSel = reassignSprints.includes(title);
                                    return (
                                      <button
                                        type="button"
                                        key={title}
                                        onClick={() => {
                                          if (isSel) {
                                            setReassignSprints(reassignSprints.filter(s => s !== title));
                                          } else {
                                            setReassignSprints([...reassignSprints, title]);
                                          }
                                        }}
                                        className={`w-full flex items-center justify-between px-2 py-1 rounded text-[11px] font-medium text-left cursor-pointer transition-colors ${
                                          isSel ? 'bg-[#EEF2FF] text-[#2F63FF]' : 'hover:bg-slate-50 text-gray-600'
                                        }`}
                                      >
                                        <span>{title}</span>
                                        {isSel && <Check size={11} className="text-[#2F63FF]" />}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            ) : (
                              <div className="space-y-2">
                                {/* Branches / Orgs */}
                                <div className="space-y-1">
                                  <label className="text-[9px] font-sans font-bold text-gray-400 uppercase block">Branch / Org</label>
                                  <div className="flex gap-1.5">
                                    {['Workfloww HQ', 'Workfloww Global'].map(org => {
                                      const isSel = reassignOrgs.includes(org);
                                      return (
                                        <button
                                          type="button"
                                          key={org}
                                          onClick={() => {
                                            if (isSel) {
                                              setReassignOrgs(reassignOrgs.filter(o => o !== org));
                                            } else {
                                              setReassignOrgs([...reassignOrgs, org]);
                                            }
                                          }}
                                          className={`px-2 py-1 rounded text-[10px] border font-semibold cursor-pointer transition-colors ${
                                            isSel ? 'border-[#2F63FF] bg-[#2F63FF]/5 text-[#2F63FF]' : 'border-slate-200 bg-white text-gray-600'
                                          }`}
                                        >
                                          {org}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>

                                {/* Departments / Functions */}
                                <div className="space-y-1">
                                  <label className="text-[9px] font-sans font-bold text-gray-400 uppercase block">Department</label>
                                  <div className="flex flex-wrap gap-1">
                                    {['Engineering', 'Operations', 'Product Management', 'Sales & Growth', 'Design'].map(dept => {
                                      const isSel = reassignFunctions.includes(dept);
                                      return (
                                        <button
                                          type="button"
                                          key={dept}
                                          onClick={() => {
                                            if (isSel) {
                                              setReassignFunctions(reassignFunctions.filter(d => d !== dept));
                                            } else {
                                              setReassignFunctions([...reassignFunctions, dept]);
                                            }
                                          }}
                                          className={`px-2 py-0.5 rounded text-[10px] border font-semibold cursor-pointer transition-colors ${
                                            isSel ? 'border-[#2F63FF] bg-[#2F63FF]/5 text-[#2F63FF]' : 'border-slate-200 bg-white text-gray-600'
                                          }`}
                                        >
                                          {dept}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>

                                {/* Individuals */}
                                <div className="space-y-1">
                                  <label className="text-[9px] font-sans font-bold text-gray-400 uppercase block">Individuals</label>
                                  <div className="space-y-1 max-h-24 overflow-y-auto border border-gray-150 rounded-lg p-1.5 bg-white">
                                    {teamMembers.map(member => {
                                      const isSel = reassignIndividuals.includes(member.name);
                                      return (
                                        <button
                                          type="button"
                                          key={member.id}
                                          onClick={() => {
                                            if (isSel) {
                                              setReassignIndividuals(reassignIndividuals.filter(n => n !== member.name));
                                            } else {
                                              setReassignIndividuals([...reassignIndividuals, member.name]);
                                            }
                                          }}
                                          className={`w-full flex items-center justify-between px-2 py-0.5 rounded text-[10px] font-semibold text-left cursor-pointer transition-colors ${
                                            isSel ? 'bg-[#EEF2FF] text-[#2F63FF]' : 'hover:bg-slate-100/50 text-gray-600'
                                          }`}
                                        >
                                          <span>{member.name} ({member.function})</span>
                                          {isSel && <Check size={10} className="text-[#2F63FF]" />}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Schedule Details */}
                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-1">
                                <label className="text-[9px] font-sans font-bold text-gray-400 uppercase block">Due Date</label>
                                <input
                                  type="date"
                                  value={reassignDueDate}
                                  onChange={(e) => setReassignDueDate(e.target.value)}
                                  className="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:ring-1 focus:ring-[#2F63FF] outline-none"
                                />
                              </div>

                              <div className="space-y-1">
                                <label className="text-[9px] font-sans font-bold text-gray-400 uppercase block">Frequency</label>
                                <select
                                  value={reassignRecurrence}
                                  onChange={(e: any) => setReassignRecurrence(e.target.value)}
                                  className="w-full text-xs border border-gray-200 rounded px-1.5 py-1 focus:ring-1 focus:ring-[#2F63FF] outline-none bg-white font-sans text-slate-700"
                                >
                                  <option value="none">One-time Task</option>
                                  <option value="every_2_days">Every 2 Days</option>
                                  <option value="weekly">Every Week</option>
                                  <option value="monthly">Every Month</option>
                                </select>
                              </div>
                            </div>

                            {/* Submit Reassignment Action Buttons */}
                            <div className="flex justify-end space-x-2 pt-2 border-t border-gray-150">
                              <button
                                type="button"
                                onClick={() => setReassigningTaskId(null)}
                                className="text-xs font-semibold px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-slate-50 cursor-pointer bg-white"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => handleConfirmReassign(task)}
                                className="text-xs font-semibold px-3.5 py-1.5 bg-[#2F63FF] hover:bg-blue-700 text-white rounded-lg transition-colors cursor-pointer"
                              >
                                {reassignMode === 'copy' ? 'Clone & Assign' : 'Save Changes'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      /* Employee Submission Interactive View */
                      <div className="space-y-4">
                        {isCompletedByMe ? (
                          <div className="space-y-3">
                            {userRole === 'employee' ? (
                              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                                <div className="flex items-center gap-2 text-emerald-700 font-semibold text-sm">
                                  <CheckCircle size={16} />
                                  <span>Completed</span>
                                </div>
                                <p className="text-xs text-emerald-600 mt-1">Task submitted successfully</p>
                              </div>
                            ) : (
                              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-3">
                                <div className="flex items-center gap-2 text-emerald-700 font-semibold text-sm">
                                  <CheckCircle size={16} />
                                  <span>Verified & Complete</span>
                                </div>
                                
                                {!isWelcomePage && (
                                  <>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                                      <div className="rounded-lg bg-white border border-emerald-100 p-3">
                                        <div className="text-[10px] uppercase text-gray-400 font-bold">AI Score</div>
                                        <div className="mt-1 font-semibold text-gray-900">
                                          {latestSubmission?.score ?? latestSubmission?.ai_validation?.scores?.overall ?? 'N/A'} / 100
                                        </div>
                                      </div>
                                      <div className="rounded-lg bg-white border border-emerald-100 p-3">
                                        <div className="text-[10px] uppercase text-gray-400 font-bold">Completed</div>
                                        <div className="mt-1 font-semibold text-gray-900">
                                          {latestSubmission?.submitted_at ? new Date(latestSubmission.submitted_at).toLocaleDateString() : 'Already submitted'}
                                        </div>
                                      </div>
                                    </div>
                                    {latestSubmission?.ai_validation ? (
                                      <div className="grid grid-cols-1 gap-2 text-xs">
                                        <div className="rounded-lg bg-white border border-emerald-100 p-3">
                                          <div className="text-[10px] uppercase text-gray-400 font-bold">AI Remark</div>
                                          <div className="mt-1 text-gray-700">
                                            {latestSubmission.ai_validation.reason || latestSubmission.ai_validation.feedback || 'Good work'}
                                          </div>
                                        </div>
                                        {task.tasks[0]?.submissionFormat === 'audio' && latestSubmission.ai_validation.scores ? (
                                          <div className="rounded-lg bg-white border border-emerald-100 p-3">
                                            <div className="text-[10px] uppercase text-gray-400 font-bold">Audio Scores</div>
                                            <div className="mt-1 grid grid-cols-2 gap-1 text-gray-700">
                                              <span>Clarity: {latestSubmission.ai_validation.scores.clarity ?? 'N/A'}</span>
                                              <span>Confidence: {latestSubmission.ai_validation.scores.confidence ?? 'N/A'}</span>
                                              <span>Fluency: {latestSubmission.ai_validation.scores.fluency ?? 'N/A'}</span>
                                              <span>Pronunciation: {latestSubmission.ai_validation.scores.pronunciation ?? 'N/A'}</span>
                                            </div>
                                          </div>
                                        ) : null}
                                      </div>
                                    ) : null}
                                  </>
                                )}

                                {/* View AI Feedback Button */}
                                {latestSubmission && (
                                  <button
                                    type="button"
                                    onClick={() => setSelectedFeedbackSubmission({
                                      ...latestSubmission,
                                      ...(latestSubmission.ai_validation || {})
                                    })}
                                    className="w-full text-center py-2 bg-[#2F63FF] hover:bg-blue-700 text-white text-xs font-semibold rounded-xl transition-all cursor-pointer shadow-md mt-2 flex items-center justify-center space-x-1"
                                  >
                                    <span>{isWelcomePage ? 'View Feedback' : 'View AI Feedback ✨'}</span>
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        ) : isSubmittingActive ? (
                          /* Active interactive form inputs */
                           <div className="space-y-4 pt-1">
                                {task.tasks.map((subTask) => (
                              <div key={subTask.id} className="p-3.5 bg-slate-50 border border-gray-100 rounded-xl space-y-3">
                                  {(() => { console.log("Submission Format:", subTask.submissionFormat); return null; })()}
                                <p className="text-[11px] font-semibold text-[#0F172A] leading-tight flex items-center space-x-1.5">
                                  <span>🚀</span>
                                  <span>{subTask.title}</span>
                                </p>
                                <p className="text-[10px] text-gray-500 leading-normal">{subTask.description}</p>

                                {/* Form control based on format */}
                                {subTask.submissionFormat === 'text' && (
                                  <textarea
                                    rows={2}
                                    value={textResponses[task.id] || ''}
                                    onChange={(e) => handleTextAnswerChange(task.id, e.target.value)}
                                    placeholder="Write your answer here..."
                                    className="w-full text-xs text-[#0F172A] bg-white border border-[#E2E8F0] rounded-lg p-2.5 focus:outline-none focus:ring-1 focus:ring-[#2F63FF]"
                                  />
                                )}

                                {subTask.submissionFormat === 'image' && (
                                  <div className="space-y-2">
                                    {imageFiles[task.id] ? (
                                      <>
                                        <div className="p-1 border border-[#E2E8F0] bg-white rounded-xl relative overflow-hidden animate-fade-in">
                                          <img 
                                            src={imageFiles[task.id]} 
                                            alt="Captured/Simulated Content" 
                                            referrerPolicy="no-referrer"
                                            className="w-full h-40 object-cover rounded-lg" 
                                          />
                                          <button
                                            type="button"
                                            onClick={() => setImageFiles(prev => ({ ...prev, [task.id]: '' }))}
                                            className="absolute top-2.5 right-2.5 bg-black/70 hover:bg-black/90 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold cursor-pointer shadow-md transition-colors"
                                          >
                                            &times;
                                          </button>
                                        </div>

                                        {/* Analysis status and result */}
                                        {analyzingImage[task.id] && (
                                          <p className="text-[11px] text-gray-500 mt-2">Analyzing image with Gemini AI...</p>
                                        )}

                                        {imageAnalysis[task.id] && (userRole as string) === 'admin' && (
  <div className="mt-3 p-3 border rounded-xl bg-white space-y-3">

    {/* HEADER */}
    <div className="flex items-center justify-between">
      <h4 className="text-sm font-bold">
        🤖 AI Verification
      </h4>

      <span
        className={`text-[11px] px-2 py-1 rounded-full font-bold ${
          imageAnalysis[task.id].passed
            ? "bg-green-100 text-green-700"
            : "bg-red-100 text-red-700"
        }`}
      >
        {imageAnalysis[task.id].passed ? "PASSED" : "FAILED"}
      </span>
    </div>


    {/* SCORE */}
    <div>
      <p className="text-xs font-semibold">
        Confidence Score
      </p>

      <div className="w-full bg-gray-200 rounded-full h-2 mt-1">
        <div
          className="bg-[#2F63FF] h-2 rounded-full"
          style={{
            width: `${imageAnalysis[task.id].score}%`
          }}
        />
      </div>

      <p className="text-[11px] mt-1">
        {imageAnalysis[task.id].score}/100
      </p>
    </div>


    {/* FEEDBACK */}
    <div className="bg-slate-50 p-2 rounded-lg">
      <p className="text-[12px]">
        {imageAnalysis[task.id].feedback}
      </p>
    </div>



    {/* OBJECT DETECTION */}
    {imageAnalysis[task.id]?.evidence?.objects?.objects?.length > 0 && (
      <div>
        <p className="text-[11px] font-bold mb-1">
          🔍 Objects detected
        </p>

        <div className="flex flex-wrap gap-1">
          {imageAnalysis[task.id]
            .evidence.objects.objects.map(
            (obj:any,index:number)=>(
              <span
                key={index}
                className="text-[10px] bg-blue-50 text-blue-700 px-2 py-1 rounded-full"
              >
                {obj.label}
                {" "}
                {Math.round(obj.confidence*100)}%
              </span>
          ))}
        </div>
      </div>
    )}



    {/* OCR */}
    {imageAnalysis[task.id]
      ?.evidence
      ?.ocr
      ?.detected_text
      ?.length > 0 && (

      <div>
        <p className="text-[11px] font-bold mb-1">
          📝 Text Found
        </p>

        {imageAnalysis[task.id]
          .evidence
          .ocr
          .detected_text
          .map(
          (txt:any,index:number)=>(
            <p
              key={index}
              className="text-[10px] text-gray-600"
            >
              "{txt.text}"
              {" "}
              ({Math.round(txt.confidence*100)}%)
            </p>
        ))}

      </div>
    )}

  </div>
)}
                                      </>
                                    ) : activeCameraTaskId === task.id ? (
                                      <div className="relative bg-black rounded-xl overflow-hidden shadow-inner aspect-video animate-fade-in">
                                        <video
                                          ref={videoRef}
                                          autoPlay
                                          playsInline
                                          className="w-full h-full object-cover transform scale-x-[-1]"
                                        />
                                        <div className="absolute bottom-3 left-0 right-0 flex justify-center space-x-3 px-3">
                                          <button
                                            type="button"
                                            onClick={() => captureLivePicture(task.id)}
                                            className="bg-red-500 hover:bg-red-600 active:scale-95 text-white font-semibold text-[10px] uppercase tracking-wider px-3.5 py-2 rounded-full cursor-pointer transition-all flex items-center space-x-1.5 shadow-md font-sans"
                                          >
                                            <Camera size={13} />
                                            <span>Capture Picture</span>
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => stopCamera()}
                                            className="bg-black/60 hover:bg-black/80 text-white font-semibold text-[10px] uppercase tracking-wider px-3.5 py-2 rounded-full cursor-pointer transition-all flex items-center space-x-1.5 font-sans"
                                          >
                                            <CameraOff size={13} />
                                            <span>Cancel</span>
                                          </button>
                                        </div>
                                      </div>
                                    ) : (
                                      <div>
                                        <button
                                          type="button"
                                          onClick={() => startCamera(task.id)}
                                          className="w-full flex flex-col items-center justify-center text-center border border-dashed border-indigo-200 bg-indigo-50/20 hover:bg-indigo-50 hover:border-indigo-400 p-4 rounded-xl cursor-pointer transition-all duration-150 active:scale-[0.98]"
                                        >
                                          <Camera className="text-indigo-600 mb-1.5 animate-pulse" size={20} />
                                          <span className="text-xs font-semibold text-indigo-950 block">Live Camera Snap</span>
                                          <span className="text-[9px] text-indigo-400 mt-1 max-w-[130px] leading-snug">Take live web camera picture</span>
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                )}

                                {subTask.submissionFormat === 'audio' && (
                                  <div className="space-y-3">
                                    {audioFiles[task.id] ? (
                                      <div className="p-3 bg-white border border-[#E2E8F0] rounded-xl space-y-2 animate-fade-in shadow-sm">
                                        <div className="flex items-center justify-between">
                                          <span className="text-[10px] font-sans font-bold text-gray-500 uppercase tracking-wider flex items-center space-x-1">
                                            <VolumeIcon size={12} className="text-[#2F63FF]" />
                                            <span>Voice Capture Verified</span>
                                          </span>
                                          <button
                                            type="button"
                                            onClick={() => setAudioFiles(prev => ({ ...prev, [task.id]: '' }))}
                                            className="text-[10px] font-bold text-red-500 hover:text-red-700 cursor-pointer text-right bg-transparent border-0"
                                          >
                                            × Re-record
                                          </button>
                                        </div>
                                        <audio 
                                          src={audioFiles[task.id]} 
                                          controls 
                                          className="w-full h-11" 
                                        />
                                      </div>
                                    ) : activeRecordingAudioTaskId === task.id ? (
                                      <div className="bg-white border border-red-200 p-4 rounded-xl text-center space-y-3 animate-pulse shadow-sm">
                                        <div className="flex items-center justify-center space-x-2">
                                          <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-ping"></span>
                                          <span className="text-xs font-bold text-red-700 font-sans uppercase">Audio Live Recording...</span>
                                        </div>
                                        
                                        {/* Dynamic waveform representation */}
                                        <div className="flex justify-center items-end space-x-1.5 h-12 py-1">
                                          <span className="w-1 bg-[#2F63FF] rounded h-4 animate-bounce [animation-delay:0.1s]"></span>
                                          <span className="w-1 bg-[#2F63FF] rounded h-8 animate-bounce [animation-delay:0.3s]"></span>
                                          <span className="w-1 bg-[#2F63FF] rounded h-11 animate-bounce [animation-delay:0.2s]"></span>
                                          <span className="w-1 bg-[#2F63FF] rounded h-5 animate-bounce [animation-delay:0s]"></span>
                                          <span className="w-1 bg-[#2F63FF] rounded h-9 animate-bounce [animation-delay:0.4s]"></span>
                                          <span className="w-1 bg-[#2F63FF] rounded h-3 animate-bounce [animation-delay:0.25s]"></span>
                                          <span className="w-1 bg-[#2F63FF] rounded h-7 animate-bounce [animation-delay:0.15s]"></span>
                                        </div>

                                        <p className="text-[11px] font-medium text-gray-500">Duration: {audioTimer} seconds</p>
                                        
                                        <button
                                          type="button"
                                          onClick={() => stopAudioRecording()}
                                          className="w-full py-2.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg cursor-pointer transition-colors shadow-md text-center"
                                        >
                                          Save Recording
                                        </button>
                                      </div>
                                    ) : (
                                      <div className="flex justify-center w-full">
  

                                        <button
  type="button"
  onClick={() => startAudioRecording(task.id)}
  className="flex flex-col items-center justify-center text-center 
  border border-dashed border-sky-200 bg-sky-50/20 
  hover:bg-sky-50 hover:border-sky-400 
  p-4 w-64 rounded-xl cursor-pointer 
  transition-all duration-150 active:scale-[0.98]"
>
  <Mic className="text-sky-600 mb-1.5 animate-pulse" size={20} />

  <span className="text-xs font-semibold text-sky-955 block">
    Live Microphone
  </span>

  <span className="text-[9px] text-sky-400 mt-1 max-w-[200px] leading-snug">
    Record live audio speech verification
  </span>
</button>
                                      </div>
                                    )}
                                  </div>
                                )}

                                {subTask.submissionFormat === 'video' && (
                                  <div className="space-y-3">
                                    {videoFiles[task.id] ? (
                                      <div className="p-2 bg-white border border-[#E2E8F0] rounded-xl space-y-2 animate-fade-in shadow-sm">
                                        <div className="flex items-center justify-between">
                                          <span className="text-[10px] font-sans font-bold text-gray-500 uppercase tracking-wider flex items-center space-x-1">
                                            <VideoIcon size={12} className="text-[#2F63FF]" />
                                            <span>Video Capture Verified</span>
                                          </span>
                                          <button
                                            type="button"
                                            onClick={() => setVideoFiles(prev => ({ ...prev, [task.id]: '' }))}
                                            className="text-[10px] font-bold text-red-500 hover:text-red-700 cursor-pointer text-right bg-transparent border-0"
                                          >
                                            × Re-record
                                          </button>
                                        </div>
                                        <video 
                                          src={videoFiles[task.id]} 
                                          controls 
                                          className="w-full h-40 object-cover rounded-lg" 
                                        />
                                      </div>
                                    ) : activeRecordingVideoTaskId === task.id ? (
                                      <div className="bg-black rounded-xl overflow-hidden relative aspect-video flex flex-col justify-end p-3 animate-fade-in shadow-inner">
                                        <video
                                          ref={liveVideoPlaybackRef}
                                          autoPlay
                                          muted
                                          playsInline
                                          className="absolute inset-0 w-full h-full object-cover transform scale-x-[-1]"
                                        />
                                        <div className="absolute top-2.5 left-2.5 bg-red-600 text-white font-sans text-[9px] font-bold tracking-widest px-2 py-0.5 rounded-full flex items-center space-x-1.5 shadow-md">
                                          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
                                          <span>REC - {videoTimer}s</span>
                                        </div>

                                        <button
                                          type="button"
                                          onClick={() => stopVideoRecording()}
                                          className="relative z-10 w-full py-2 bg-red-600 hover:bg-red-700 text-white text-[10px] font-bold font-sans uppercase rounded-lg cursor-pointer transition-colors mt-auto text-center"
                                        >
                                          Stop Video Recording
                                        </button>
                                      </div>
                                    ) : (
                                      <div className="grid grid-cols-2 gap-3">
                                        <button
                                          type="button"
                                          onClick={() => simulateMockVideo(task.id)}
                                          className="flex flex-col items-center justify-center text-center border border-dashed border-[#CBD5E1] bg-white hover:bg-[#EEF2FF] hover:border-[#2F63FF] p-4 rounded-xl cursor-pointer transition-all duration-150 active:scale-[0.98]"
                                        >
                                          <VideoIcon className="text-[#2F63FF] mb-1.5" size={20} />
                                          <span className="text-xs font-semibold text-gray-755 block">Preset Video</span>
                                          <span className="text-[9px] text-gray-400 mt-1 max-w-[130px] leading-snug">Simulate high quality camera recording</span>
                                        </button>

                                        <button
                                          type="button"
                                          onClick={() => startVideoRecording(task.id)}
                                          className="flex flex-col items-center justify-center text-center border border-dashed border-indigo-200 bg-indigo-50/20 hover:bg-indigo-50 hover:border-indigo-400 p-4 rounded-xl cursor-pointer transition-all duration-150 active:scale-[0.98]"
                                        >
                                          <VideoIcon className="text-indigo-600 mb-1.5 animate-pulse" size={20} />
                                          <span className="text-xs font-semibold text-indigo-955 block">Live Web Video</span>
                                          <span className="text-[9px] text-indigo-400 mt-1 max-w-[130px] leading-snug">Record live webcam capture feed</span>
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                )}

                                {subTask.submissionFormat === 'multiple_choice' && (
                                  <div className="space-y-4">
                                    {subTask.questions.map((q) => (
                                      <div key={q.id} className="space-y-2">
                                        <p className="text-[10px] font-bold text-gray-600 leading-tight">
                                          Question: {q.question || 'Standard question statement?'}
                                        </p>
                                        <div className="space-y-1.5">
                                          {q.options.map((optionText, oIndex) => {
                                            const isSelected = quizAnswers[task.id]?.[q.id] === optionText;
                                            return (
                                              <button
                                                key={oIndex}
                                                type="button"
                                                onClick={() => handleAnswerQuiz(task.id, q.id, optionText)}
                                                className={`w-full text-left p-2 rounded-lg text-xs transition-all flex items-center space-x-2 border cursor-pointer ${
                                                  isSelected
                                                    ? 'border-[#2F63FF] bg-[#2F63FF]/5 text-[#2F63FF] font-medium'
                                                    : 'border-gray-200 bg-white text-gray-600 hover:bg-slate-50'
                                                }`}
                                              >
                                                <span className={`w-4.5 h-4.5 rounded-full border flex items-center justify-center text-[8px] font-bold font-sans ${
                                                  isSelected ? 'bg-[#2F63FF] border-[#2F63FF] text-white' : 'border-gray-300 text-gray-400'
                                                }`}>
                                                  {String.fromCharCode(65 + oIndex)}
                                                </span>
                                                <span className="truncate">{optionText || `Option Choice Statement ${oIndex + 1}`}</span>
                                              </button>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}

                            {/* State-based custom visual error display instead of blocked alert popups */}
                            {submitError[task.id] && (
                              <div className="p-2.5 border border-red-200 bg-red-50 text-red-700 text-[11px] rounded-xl font-medium">
                                {submitError[task.id]}
                              </div>
                            )}

                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => setActiveSubmittingTaskId(null)}
                                className="flex-1 text-center py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold rounded-xl transition-all cursor-pointer"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSubmitVerification(task.id)}
                                disabled={isSubmittingNow}
                                className="flex-1 text-center py-2.5 bg-[#2F63FF] hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-xl shadow-md cursor-pointer flex items-center justify-center space-x-1"
                              >
                                <Send size={12} />
                                <span>{isSubmittingNow ? 'Submitting...' : 'Submit Verification'}</span>
                              </button>
                            </div>
                          </div>
                        ) : (
                          /* Initial Start CTA */
                          <button
                            type="button"
                            onClick={() => setActiveSubmittingTaskId(task.id)}
                            className="w-full flex items-center justify-center space-x-2 bg-[#2F63FF] hover:bg-blue-700 text-white text-xs font-semibold py-2.5 rounded-xl transition-all cursor-pointer shadow-sm"
                          >
                            <Play size={12} fill="currentColor" />
                            <span>Begin Verification</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectedFeedbackSubmission && (
        <AIFeedbackModal
          open={!!selectedFeedbackSubmission}
          onClose={() => setSelectedFeedbackSubmission(null)}
          data={selectedFeedbackSubmission}
          simplified={isWelcomePage}
        />
      )}

      {selectedReportTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-fade-in font-sans">
          <div className="bg-white w-full max-w-md rounded-3xl p-6 border border-[#E2E8F0] shadow-xl space-y-6 relative animate-scale-in">
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-xl">📊</span>
                <div>
                  <h3 className="text-sm font-bold text-[#0F172A]">Generate AI Performance Report</h3>
                  <p className="text-[11px] text-gray-500">Synthesize completed submission analysis into a PDF report.</p>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              {selectedReportTask.tasks.length > 1 ? (
                <div>
                  <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Select Subtask</label>
                  <select
                    value={selectedSubtaskId}
                    onChange={(e) => setSelectedSubtaskId(e.target.value)}
                    className="w-full bg-[#FAFBFD] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-[#2F63FF] text-[#0F172A] cursor-pointer"
                  >
                    {selectedReportTask.tasks.map((sub) => (
                      <option key={sub.id} value={sub.id}>
                        {sub.title} ({sub.submissionFormat})
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Selected Task</label>
                  <input
                    type="text"
                    value={selectedReportTask.tasks[0]?.title || selectedReportTask.id}
                    disabled
                    className="w-full bg-[#FAFBFD] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-gray-500 focus:outline-none"
                  />
                </div>
              )}

              <div>
                <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Duration</label>
                <select
                  value={reportDuration}
                  onChange={(e) => setReportDuration(e.target.value)}
                  className="w-full bg-[#FAFBFD] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-[#2F63FF] text-[#0F172A] cursor-pointer"
                >
                  <option value="7_days">Last 7 days</option>
                  <option value="30_days">Last 30 days</option>
                  <option value="90_days">Last 90 days</option>
                  <option value="all">All Time</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Send Email Copy (Optional)</label>
                <input
                  type="email"
                  placeholder="admin@company.com"
                  value={reportEmail}
                  onChange={(e) => setReportEmail(e.target.value)}
                  className="w-full bg-[#FAFBFD] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-[#2F63FF] text-[#0F172A] placeholder-gray-400"
                />
              </div>
            </div>

            {reportFeedback && (
              <div className={`p-2.5 border rounded-xl text-[11px] font-semibold text-center ${
                reportFeedback.includes('failed') || reportFeedback.includes('No submissions')
                  ? 'border-red-200 bg-red-50 text-red-650'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-700'
              }`}>
                {reportFeedback}
              </div>
            )}

            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-[#F1F5F9]">
              <button
                type="button"
                onClick={() => {
                  setSelectedReportTask(null);
                  setReportFeedback('');
                }}
                className="bg-white border border-gray-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold px-4 py-2.5 rounded-xl cursor-pointer transition-all shadow-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleGenerateAIReport}
                disabled={generatingReport}
                className="bg-[#2F63FF] hover:bg-blue-700 disabled:bg-gray-300 text-white text-xs font-semibold px-5 py-2.5 rounded-xl transition-all cursor-pointer shadow-sm flex items-center space-x-1.5"
              >
                <span>{generatingReport ? 'Generating...' : 'Generate Report'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
