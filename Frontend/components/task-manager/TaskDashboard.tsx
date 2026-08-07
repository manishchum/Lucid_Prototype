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
import { CustomPagination } from '@/components/ui/custom-pagination';
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
  Trash2,
  LayoutGrid,
  List,
  ChevronDown,
  Type,
  ListChecks,
  ListFilter,
  BarChart2,
  Square
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
  onEditTaskRequest?: (task: AssignedTask) => void;
}

export default function TaskDashboard({ assignedTasks, onStartCreateTask, userRole, onSubmitTaskResponse, onTaskSubmitted, onTaskReassigned, onTaskDeleted, teamMembers = [], isWelcomePage = false, onEditTaskRequest }: TaskDashboardProps) {
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
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'completed'>('active');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const [sortBy, setSortBy] = useState('title');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  
  // Interactive submission tracking for employees
  const [activeSubmittingTaskId, setActiveSubmittingTaskId] = useState<string | null>(null);
  const [submittedTaskIds, setSubmittedTaskIds] = useState<Record<string, boolean>>({});
  const [submittingTaskIds, setSubmittingTaskIds] = useState<Record<string, boolean>>({});
  const [submitError, setSubmitError] = useState<Record<string, string>>({});
  const [confirmDeleteTaskId, setConfirmDeleteTaskId] = useState<string | null>(null);
  
  // Form responses
  const [textResponses, setTextResponses] = useState<Record<string, string>>({});
  const [imageFiles, setImageFiles] = useState<Record<string, string>>({});
  const [imageAnalysis, setImageAnalysis] = useState<Record<string, any>>({});
  const [analyzingImage, setAnalyzingImage] = useState<Record<string, boolean>>({});
  const [audioFiles, setAudioFiles] = useState<Record<string, string>>({});
  const [videoFiles, setVideoFiles] = useState<Record<string, string>>({});
  const [quizAnswers, setQuizAnswers] = useState<Record<string, Record<string, string | string[]>>>({});

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
      const activeTaskId = selectedReportTask.taskId || selectedReportTask.id;
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
      const taskTitleClean = (selectedReportTask.title || 'report').slice(0, 15).replace(/\s+/g, '_');
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
    // Check if search match in title, description, or target audience
    const matchesSearch = searchQuery.trim() === '' || 
      task.tasks.some(sub => 
        sub.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
        sub.description.toLowerCase().includes(searchQuery.toLowerCase())
      ) ||
      (task.targetSprints || []).some(s => String(s).toLowerCase().includes(searchQuery.toLowerCase())) ||
      (task.targetFunctions || []).some(f => String(f).toLowerCase().includes(searchQuery.toLowerCase())) ||
      (task.targetIndividuals || []).some(i => String(i).toLowerCase().includes(searchQuery.toLowerCase()));

    const isCompleted = task.status === 'Completed' || task.submitted === true || Boolean((task as any).submission) || !!submittedTaskIds[task.id];
    let matchesStatus = true;
    if (statusFilter === 'active') matchesStatus = !isCompleted;
    if (statusFilter === 'completed') matchesStatus = isCompleted;

    return matchesStatus && matchesSearch;
  });

  const sortedTasks = [...filteredTasks].sort((a, b) => {
    if (sortBy === 'title') {
      const titleA = a.title || a.tasks.map(t => t.title).join(' ');
      const titleB = b.title || b.tasks.map(t => t.title).join(' ');
      return titleA.localeCompare(titleB);
    }
    if (sortBy === 'recent') {
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    }
    if (sortBy === 'completion') {
      const compA = a.totalTargetUsersCount > 0 ? (a.completionCount || 0) / a.totalTargetUsersCount : 0;
      const compB = b.totalTargetUsersCount > 0 ? (b.completionCount || 0) / b.totalTargetUsersCount : 0;
      return compB - compA;
    }
    return 0;
  });

  const totalPages = Math.ceil(sortedTasks.length / itemsPerPage);
  const paginatedTasks = sortedTasks.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // console.log("FILTERED TASKS:", filteredTasks);

  // Calculate cumulative stats for the Progress Card
  // const totalCreatedTasks = assignedTasks.length;
  // const completedTaskCount = assignedTasks.filter(t => t.status === 'Completed' || submittedTaskIds[t.id]).length;
  // const completionPercentage = totalCreatedTasks > 0 
  //   ? Math.round((completedTaskCount / totalCreatedTasks) * 100) 
  //   : 0;

  // Handle employee interactions
  const handleAnswerQuiz = (taskId: string, questionId: string, option: string, type?: 'single' | 'multiple' | 'written') => {
    setQuizAnswers(prev => {
      const currentTaskAnswers = prev[taskId] || {};
      const currentAnswer = currentTaskAnswers[questionId];

      let newAnswer: string | string[];

      if (type === 'multiple') {
        let arr: string[] = Array.isArray(currentAnswer) ? [...currentAnswer] : (currentAnswer ? [currentAnswer as string] : []);
        if (arr.includes(option)) {
          arr = arr.filter(v => v !== option);
        } else {
          arr.push(option);
        }
        newAnswer = arr;
      } else {
        newAnswer = option;
      }

      return {
        ...prev,
        [taskId]: {
          ...currentTaskAnswers,
          [questionId]: newAnswer
        }
      };
    });
  };

  // const handleImageUploadSimulated = (taskId: string) => {
  //   // Inject a simulated image path
  //   const mockImages = [
  //     'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=400&q=85',
  //     'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=400&q=85',
  //     'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=400&q=85'
  //   ];
  //   const chosenImg = mockImages[Math.floor(Math.random() * mockImages.length)];
  //   setImageFiles(prev => ({
  //     ...prev,
  //     [taskId]: chosenImg
  //   }));
  //   // Run analysis on mock image (only for admin/testing)
  //   if (userRole === 'admin') {
  //     runPhotoAnalysis(taskId, chosenImg);
  //   }
  // };

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
      if (sub.submissionFormat === 'text' && !textResponses[sub.id]?.trim()) {
        setSubmitError(prev => ({ ...prev, [taskId]: `Oops! Please write a text response for: ${sub.title}` }));
        return;
      }
      if (sub.submissionFormat === 'image' && !imageFiles[sub.id]) {
        setSubmitError(prev => ({ ...prev, [taskId]: `Oops! Please provide a photo verification for: ${sub.title}` }));
        return;
      }
      	  if (sub.submissionFormat === 'image' && imageAnalysis[sub.id]?.passed === false) {
        setSubmitError(prev => ({ ...prev, [taskId]: `AI verification failed. Please upload correct image.` }));
        return;
      }
      if (sub.submissionFormat === 'audio' && !audioFiles[sub.id]) {
        setSubmitError(prev => ({ ...prev, [taskId]: `Oops! Please record or verify audio for: ${sub.title}` }));
        return;
      }
      if (sub.submissionFormat === 'video' && !videoFiles[sub.id]) {
        setSubmitError(prev => ({ ...prev, [taskId]: `Oops! Please record or verify video for: ${sub.title}` }));
        return;
      }
      if (sub.submissionFormat === 'multiple_choice') {
        const questionsCount = sub.questions.length;
        if (questionsCount > 0) {
          const hasUnanswered = sub.questions.some(q => {
            const ans = quizAnswers[taskId]?.[q.id];
            if (Array.isArray(ans)) return ans.length === 0;
            return !ans;
          });
          if (hasUnanswered) {
            setSubmitError(prev => ({ ...prev, [taskId]: `Oops! Please answer all multiple choice questions for: ${sub.title}` }));
            return;
          }
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
          const chosen = quizAnswers[taskId]?.[q.id];
          
          let isCorrectAnswer = false;
          let correctAnsStr = 'A';
          if (q.type === 'multiple' && q.correctAnswers) {
            const chosenArr = Array.isArray(chosen) ? chosen : [chosen].filter(Boolean);
            isCorrectAnswer = chosenArr.length === q.correctAnswers.length && 
                              chosenArr.every((ans) => q.correctAnswers?.includes(ans as string));
            correctAnsStr = q.correctAnswers.join(', ');
          } else {
            const correctAns = q.correctAnswer || q.options[0] || 'A';
            isCorrectAnswer = chosen === correctAns;
            correctAnsStr = correctAns;
          }

          if (isCorrectAnswer) earnedScore += 1;
          questionsList.push({
            question: q.question,
            submittedAnswer: Array.isArray(chosen) ? chosen.join(', ') : chosen || 'None',
            correctAnswer: correctAnsStr,
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
          submittedText = imageFiles[sub.id] ? 'Verified Image Uploaded' : 'None';
          expectedText = 'Verified Image Uploaded';
        } else if (sub.submissionFormat === 'audio') {
          submittedText = audioFiles[sub.id] ? 'Verified Audio Recorded' : 'None';
          expectedText = 'Verified Audio Recorded';
        } else if (sub.submissionFormat === 'video') {
          submittedText = videoFiles[sub.id] ? 'Verified Video Recorded' : 'None';
          expectedText = 'Verified Video Recorded';
        } else {
          submittedText = textResponses[sub.id] || 'None';
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
            task_id: taskObj.taskId, // Main task ID
            child_task_id: taskObj.tasks.length > 1 ? sub.id : undefined, // Child task ID if bundle
            assignment_id: taskObj.id,
            submission_type: normalizeSubmissionType(sub.submissionFormat),
            score: earnedScore,
            max_score: totalQuestionsCount,
          } as any;

          if (sub.submissionFormat === 'multiple_choice') {
            payload.answers = sub.questions.map((q) => {
              const chosen = quizAnswers[taskId]?.[q.id];
              let correctAnsStr = 'A';
              if (q.type === 'multiple' && q.correctAnswers) {
                correctAnsStr = q.correctAnswers.join(', ');
              } else {
                correctAnsStr = q.correctAnswer || q.options[0] || 'A';
              }
              return {
                question_id: q.id,
                question: q.question || 'Standard Question',
                selected_option: Array.isArray(chosen) ? chosen.join(', ') : chosen || '',
                correct_answer: correctAnsStr,
              };
            }) as any;
          } else if (sub.submissionFormat === 'image') {
            payload.image_url = imageFiles[sub.id];

            const ai = imageAnalysis[sub.id];

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
            payload.audio_url = audioFiles[sub.id];
          } else if (sub.submissionFormat === 'video') {
            payload.video_url = videoFiles[sub.id];
          } else {
            payload.text_response = textResponses[sub.id]?.trim();
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

     
      <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm mb-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[#0F172A] font-bold text-xl">Assigned Tasks</h2>
          
          <div className="flex gap-2 items-center">
            {userRole === 'admin' && (
              <button
                type="button"
                onClick={onStartCreateTask}
                className="px-4 py-2 text-xs font-bold text-white bg-[#2F63FF] hover:bg-blue-600 rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-sm mr-2"
              >
                <Plus size={13} />
                <span>Create Task</span>
              </button>
            )}
            {userRole !== 'admin' && (
              <>
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-2 rounded-lg transition-colors cursor-pointer ${
                    viewMode === 'grid' ? 'bg-[#EEF2FF] text-[#2F63FF]' : 'bg-gray-50 text-gray-400 border border-gray-100 hover:bg-gray-100'
                  }`}
                >
                  <LayoutGrid size={18} />
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`p-2 rounded-lg transition-colors cursor-pointer ${
                    viewMode === 'list' ? 'bg-[#EEF2FF] text-[#2F63FF]' : 'bg-gray-50 text-gray-400 border border-gray-100 hover:bg-gray-100'
                  }`}
                >
                  <List size={18} />
                </button>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <button
            onClick={() => { setStatusFilter('active'); setCurrentPage(1); }}
            className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
              statusFilter === 'active' ? 'bg-purple-50 text-purple-700' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
            }`}
          >
            Active
          </button>
          <button
            onClick={() => { setStatusFilter('completed'); setCurrentPage(1); }}
            className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
              statusFilter === 'completed' ? 'bg-purple-50 text-purple-700' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
            }`}
          >
            Completed
          </button>
          <button
            onClick={() => { setStatusFilter('all'); setCurrentPage(1); }}
            className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
              statusFilter === 'all' ? 'bg-purple-50 text-purple-700' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
            }`}
          >
            All
          </button>
          <div className="flex-1" />
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="Search Tasks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-11 pr-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-[#2F63FF]"
            />
          </div>
          <select
            value={sortBy}
            onChange={(e) => { setSortBy(e.target.value); setCurrentPage(1); }}
            className="px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm text-gray-600 outline-none w-full sm:w-48 cursor-pointer"
          >
            <option value="title">Sort by Title</option>
            <option value="recent">Recently Added</option>
            <option value="completion">Completion</option>
          </select>
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
        <div className={viewMode === 'list' ? "bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden mb-6 overflow-x-auto" : ""}>
          <div className={viewMode === 'list' ? "min-w-[900px]" : ""}>
            {viewMode === 'list' && (
              <div className={`grid ${userRole === 'admin' ? 'grid-cols-[3fr_2fr_3fr]' : 'grid-cols-[3fr_1fr_1fr_2fr_2fr]'} gap-4 px-6 py-4 border-b border-gray-100 text-[11px] font-bold text-[#64748B] uppercase tracking-wider bg-white`}>
                <div>Task Name</div>
                {userRole !== 'admin' && <div>Due Date</div>}
                <div className="text-center">Status</div>
                {userRole !== 'admin' && <div>Completion</div>}
                <div className="text-right pr-2">Actions</div>
              </div>
            )}
            <div className={viewMode === 'grid' ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" : "flex flex-col divide-y divide-gray-100 bg-white"}>
              {paginatedTasks.map((task) => {
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
                  <React.Fragment key={task.id}>
                    {viewMode === 'list' && (
                      <div className={`grid ${userRole === 'admin' ? 'grid-cols-[3fr_2fr_3fr]' : 'grid-cols-[3fr_1fr_1fr_2fr_2fr]'} gap-4 px-6 py-4 items-center hover:bg-gray-50/50 transition-colors`}>
                        <div className="font-bold text-[#0F172A] text-[14px]">
                          {task.title || task.tasks.map(t => t.title).join(' • ')}
                        </div>
                        {userRole !== 'admin' && (
                          <div className="text-[#94A3B8] text-[13px] font-bold">
                            {task.dueDate || 'N/A'}
                          </div>
                        )}
                        <div className="flex justify-center">
                          {userRole === 'admin' ? (
                            <div className="flex flex-col justify-center text-center">
                              <span className="text-[13px] font-bold text-[#2F63FF]">{task.completionCount || 0} / {task.totalTargetUsersCount || 0}</span>
                              <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wide">Users Completed</span>
                            </div>
                          ) : (
                            <span className={`inline-flex px-3 py-1 rounded-full text-[11px] font-bold tracking-wide ${
                              isCompletedByMe ? 'bg-green-100 text-green-600' :
                              task.id === activeSubmittingTaskId ? 'bg-[#EEF2FF] text-[#2F63FF]' : 'bg-gray-100 text-[#64748B]'
                            }`}>
                              {isCompletedByMe ? 'Completed' : task.id === activeSubmittingTaskId ? 'In Progress' : 'Not Started'}
                            </span>
                          )}
                        </div>
                        {userRole !== 'admin' && (
                          <div className="pr-4 pt-1">
                            <div className="h-[6px] w-full bg-gray-100 rounded-full overflow-hidden mb-1.5">
                              <div className={`h-full rounded-full transition-all ${isCompletedByMe ? 'bg-[#2F63FF] w-full' : 'bg-[#2F63FF] w-0'}`} />
                            </div>
                            <div className="flex justify-between text-[11px] font-bold">
                              <span className="text-[#64748B]">{isCompletedByMe ? task.tasks.length : 0} / {task.tasks.length}</span>
                              <span className="text-[#2F63FF]">{isCompletedByMe ? '100%' : '0%'}</span>
                            </div>
                          </div>
                        )}
                        <div className="flex items-center justify-end gap-3">
                          <div className="flex -space-x-1.5 mr-2">
                            {task.tasks.map(t => t.submissionFormat).includes('audio') && <div className="w-7 h-7 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center border-2 border-white shadow-sm z-10" title="Audio"><Mic size={12} /></div>}
                            {task.tasks.map(t => t.submissionFormat).includes('video') && <div className="w-7 h-7 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center border-2 border-white shadow-sm z-20" title="Video"><VideoIcon size={12} /></div>}
                            {task.tasks.map(t => t.submissionFormat).includes('image') && <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center border-2 border-white shadow-sm z-30" title="Image"><Camera size={12} /></div>}
                            {task.tasks.map(t => t.submissionFormat).includes('text') && <div className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center border-2 border-white shadow-sm z-40" title="Text"><Type size={12} /></div>}
                            {task.tasks.map(t => t.submissionFormat).includes('multiple_choice') && <div className="w-7 h-7 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center border-2 border-white shadow-sm z-50" title="Quiz"><ListChecks size={12} /></div>}
                          </div>
                          {userRole === 'admin' ? (
                            <div className="flex items-center justify-end space-x-4">
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
                                <>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedReportTask(task);
                                      setSelectedSubtaskId(task.tasks[0]?.id || '');
                                      setReportFeedback('');
                                      setReportDuration('30_days');
                                      setReportEmail('');
                                    }}
                                    className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-[#2F63FF]/20 bg-[#EEF2FF]/40 text-[#2F63FF] hover:bg-[#EEF2FF] hover:border-[#2F63FF]/30 transition-all flex items-center space-x-1 cursor-pointer"
                                  >
                                    <span>Report</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (onEditTaskRequest) {
                                        onEditTaskRequest(task);
                                      }
                                    }}
                                    className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:text-[#2F63FF] hover:border-[#2F63FF]/30 hover:bg-[#EEF2FF]/40 transition-all flex items-center space-x-1 cursor-pointer"
                                  >
                                    <span>Reassign</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteTaskId(task.id)}
                                    className="text-xs font-semibold p-1.5 rounded-lg border border-red-100 bg-white text-red-500 hover:text-white hover:bg-red-500 hover:border-red-500 transition-all cursor-pointer flex items-center justify-center shadow-sm"
                                    title="Delete Task"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </>
                              )}
                            </div>
                          ) : (
                            !isCompletedByMe && (
                              <button
                                type="button"
                                onClick={() => setActiveSubmittingTaskId(task.id)}
                                className="px-5 py-2 bg-[#2F63FF] hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer shadow-sm"
                              >
                                Start
                              </button>
                            )
                          )}
                        </div>
                      </div>
                    )}

                {viewMode === 'grid' && userRole === 'admin' && (
                  <div 
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
                      
                      <h3 className="font-display font-medium text-[#0F172A] leading-snug text-sm tracking-tight text-[#0F172A] font-bold">
                        {task.title || task.tasks.map(t => t.title).join(' • ')}
                      </h3>
                    </div>


                  </div>

                  {/* Task sub-items information displaying list of child tasks */}
                  <div className="my-4 bg-slate-50 rounded-xl p-3 border border-[#F1F5F9]">
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
                                <span>Report</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  if (onEditTaskRequest) {
                                    onEditTaskRequest(task);
                                  }
                                }}
                                className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:text-[#2F63FF] hover:border-[#2F63FF]/30 hover:bg-[#EEF2FF]/40 transition-all flex items-center space-x-1 cursor-pointer"
                              >
                                <span>Reassign</span>
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
                        ) : (
                          /* Initial Start CTA */
                          <button
                            type="button"
                            onClick={() => setActiveSubmittingTaskId(task.id)}
                            className="w-full flex items-center justify-center space-x-2 bg-[#2F63FF] hover:bg-blue-700 text-white text-xs font-semibold py-2.5 rounded-xl transition-all cursor-pointer shadow-sm mt-4"
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
              )}
              {viewMode === 'grid' && userRole !== 'admin' && (
                <div className="bg-white rounded-xl border border-gray-100 p-5 flex flex-col justify-between shadow-[0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[0_4px_12px_rgb(0,0,0,0.06)] transition-all space-y-6">
                  <div className="space-y-4">
                    <div className="flex justify-between items-start gap-4">
                      <h3 className="font-bold text-gray-900 text-[15px] leading-snug">
                        {task.title || task.tasks.map(t => t.title).join(' • ')}
                      </h3>
                      <span className={`shrink-0 px-3 py-1 rounded-full text-[11px] font-bold tracking-wide ${
                        isCompletedByMe ? 'bg-green-100 text-green-600' : 
                        task.id === activeSubmittingTaskId ? 'bg-blue-100 text-[#2F63FF]' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {isCompletedByMe ? 'Completed' : task.id === activeSubmittingTaskId ? 'In Progress' : 'Not Started'}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400 font-medium">
                      Due: {task.dueDate || 'N/A'}
                    </div>
                    
                    <div className="space-y-1.5 pt-2">
                      <div className="flex justify-between text-xs font-bold">
                        <span className="text-gray-500">Completion</span>
                        <span className="text-[#2F63FF]">{isCompletedByMe ? '100%' : '0%'}</span>
                      </div>
                      <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${isCompletedByMe ? 'bg-[#2F63FF] w-full' : 'bg-[#2F63FF] w-0'}`} />
                      </div>
                      <div className="text-xs text-gray-400 font-medium mt-1">
                        {isCompletedByMe ? task.tasks.length : 0} / {task.tasks.length} modules
                      </div>
                    </div>
                  </div>
                  {!isCompletedByMe && (
                    <div className="flex items-center justify-between gap-3 pt-2">
                      <div className="flex -space-x-1.5">
                        {task.tasks.map(t => t.submissionFormat).includes('audio') && <div className="w-7 h-7 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center border-2 border-white shadow-sm z-10" title="Audio"><Mic size={12} /></div>}
                        {task.tasks.map(t => t.submissionFormat).includes('video') && <div className="w-7 h-7 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center border-2 border-white shadow-sm z-20" title="Video"><VideoIcon size={12} /></div>}
                        {task.tasks.map(t => t.submissionFormat).includes('image') && <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center border-2 border-white shadow-sm z-30" title="Image"><Camera size={12} /></div>}
                        {task.tasks.map(t => t.submissionFormat).includes('text') && <div className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center border-2 border-white shadow-sm z-40" title="Text"><Type size={12} /></div>}
                        {task.tasks.map(t => t.submissionFormat).includes('multiple_choice') && <div className="w-7 h-7 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center border-2 border-white shadow-sm z-50" title="Quiz"><ListChecks size={12} /></div>}
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveSubmittingTaskId(task.id)}
                        className="flex-1 py-2.5 bg-[#2F63FF] hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer shadow-sm"
                      >
                        Start
                      </button>
                    </div>
                  )}
                </div>
              )}
              
              {/* MODAL */}
              {isSubmittingActive && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fade-in font-sans" onClick={() => setActiveSubmittingTaskId(null)}>
                  <div className="bg-white w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl p-6 shadow-2xl space-y-6 relative" onClick={e => e.stopPropagation()}>
                    <div className="flex justify-between items-start pb-4 border-b border-gray-100">
                      <div className="space-y-1">
                        <h3 className="font-bold text-lg text-slate-800">Complete Task: {task.title || task.tasks[0]?.title}</h3>
                        {task.description && <p className="text-sm text-gray-500 leading-normal">{task.description}</p>}
                      </div>
                      <button onClick={() => setActiveSubmittingTaskId(null)} className="text-gray-400 hover:text-gray-600 font-bold text-2xl cursor-pointer leading-none ml-4 mt-1">
                        &times;
                      </button>
                    </div>
                    <div className="space-y-4 pt-1">
                                {task.tasks.map((subTask, index) => (
                              <div key={subTask.id} className="p-3.5 bg-slate-50 border border-gray-100 rounded-xl space-y-3">
                                <div className="flex justify-between items-start">
                                  <div className="flex space-x-2">
                                    <span className="bg-[#2F63FF] text-white w-5 h-5 flex-shrink-0 flex items-center justify-center rounded-full text-[10px] font-bold mt-0.5">{index + 1}</span>
                                    <div>
                                      <p className="text-[12px] font-bold text-[#0F172A] leading-tight">
                                        {subTask.title}
                                      </p>
                                      {subTask.description && <p className="text-[10px] text-gray-500 mt-1 leading-normal">{subTask.description}</p>}
                                    </div>
                                  </div>
                                  <div className="flex-shrink-0 ml-4 flex items-center space-x-2">
                                    {subTask.submissionFormat === 'audio' && (
                                      <>
                                        {activeRecordingAudioTaskId === subTask.id ? (
                                          <div className="flex items-center space-x-2 bg-red-50 px-2 py-1 rounded-full border border-red-100">
                                            <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-ping"></span>
                                            <span className="text-[10px] text-red-600 font-bold">{audioTimer}s</span>
                                            <button type="button" onClick={() => stopAudioRecording()} className="w-6 h-6 rounded-full bg-red-100 hover:bg-red-200 text-red-600 flex items-center justify-center transition-colors shadow-sm cursor-pointer ml-1" title="Stop Recording">
                                              <Square size={10} fill="currentColor" />
                                            </button>
                                          </div>
                                        ) : !audioFiles[subTask.id] ? (
                                          <button type="button" onClick={() => { setAudioFiles(prev => ({ ...prev, [subTask.id]: '' })); startAudioRecording(subTask.id); }} className="w-8 h-8 rounded-full bg-sky-100 hover:bg-sky-200 text-sky-600 flex items-center justify-center transition-colors shadow-sm cursor-pointer" title="Record Audio">
                                            <Mic size={14} />
                                          </button>
                                        ) : null}
                                      </>
                                    )}
                                    {subTask.submissionFormat === 'video' && !videoFiles[subTask.id] && activeRecordingVideoTaskId !== subTask.id && (
                                      <button type="button" onClick={() => { setVideoFiles(prev => ({ ...prev, [subTask.id]: '' })); startVideoRecording(subTask.id); }} className="w-8 h-8 rounded-full bg-indigo-100 hover:bg-indigo-200 text-indigo-600 flex items-center justify-center transition-colors shadow-sm cursor-pointer" title="Start Video">
                                        <VideoIcon size={14} />
                                      </button>
                                    )}
                                    {subTask.submissionFormat === 'image' && !imageFiles[subTask.id] && activeCameraTaskId !== subTask.id && (
                                      <button type="button" onClick={() => { setImageFiles(prev => ({ ...prev, [subTask.id]: '' })); startCamera(subTask.id); }} className="w-8 h-8 rounded-full bg-emerald-100 hover:bg-emerald-200 text-emerald-600 flex items-center justify-center transition-colors shadow-sm cursor-pointer" title="Take Picture">
                                        <Camera size={14} />
                                      </button>
                                    )}
                                  </div>
                                </div>

                                {/* Form control based on format */}
                                {subTask.submissionFormat === 'text' && (
                                  <textarea
                                    rows={2}
                                    value={textResponses[subTask.id] || ''}
                                    onChange={(e) => handleTextAnswerChange(subTask.id, e.target.value)}
                                    placeholder="Write your answer here..."
                                    className="w-full text-xs text-[#0F172A] bg-white border border-[#E2E8F0] rounded-lg p-2.5 focus:outline-none focus:ring-1 focus:ring-[#2F63FF]"
                                  />
                                )}

                                {subTask.submissionFormat === 'image' && (
                                  <div className="space-y-2">
                                    {imageFiles[subTask.id] ? (
                                      <>
                                        <div className="p-1 border border-[#E2E8F0] bg-white rounded-xl relative overflow-hidden animate-fade-in">
                                          <img 
                                            src={imageFiles[subTask.id]} 
                                            alt="Captured/Simulated Content" 
                                            referrerPolicy="no-referrer"
                                            className="w-full h-40 object-cover rounded-lg" 
                                          />
                                          <button
                                            type="button"
                                            onClick={() => setImageFiles(prev => ({ ...prev, [subTask.id]: '' }))}
                                            className="absolute top-2.5 right-2.5 bg-black/70 hover:bg-black/90 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold cursor-pointer shadow-md transition-colors"
                                          >
                                            &times;
                                          </button>
                                        </div>

                                        {/* Analysis status and result */}
                                        {analyzingImage[subTask.id] && (
                                          <p className="text-[11px] text-gray-500 mt-2">Analyzing image with Gemini AI...</p>
                                        )}

                                        {imageAnalysis[subTask.id] && (userRole as string) === 'admin' && (
  <div className="mt-3 p-3 border rounded-xl bg-white space-y-3">

    {/* HEADER */}
    <div className="flex items-center justify-between">
      <h4 className="text-sm font-bold">
        🤖 AI Verification
      </h4>

      <span
        className={`text-[11px] px-2 py-1 rounded-full font-bold ${
          imageAnalysis[subTask.id].passed
            ? "bg-green-100 text-green-700"
            : "bg-red-100 text-red-700"
        }`}
      >
        {imageAnalysis[subTask.id].passed ? "PASSED" : "FAILED"}
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
            width: `${imageAnalysis[subTask.id].score}%`
          }}
        />
      </div>

      <p className="text-[11px] mt-1">
        {imageAnalysis[subTask.id].score}/100
      </p>
    </div>


    {/* FEEDBACK */}
    <div className="bg-slate-50 p-2 rounded-lg">
      <p className="text-[12px]">
        {imageAnalysis[subTask.id].feedback}
      </p>
    </div>



    {/* OBJECT DETECTION */}
    {imageAnalysis[subTask.id]?.evidence?.objects?.objects?.length > 0 && (
      <div>
        <p className="text-[11px] font-bold mb-1">
          🔍 Objects detected
        </p>

        <div className="flex flex-wrap gap-1">
          {imageAnalysis[subTask.id]
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
    {imageAnalysis[subTask.id]
      ?.evidence
      ?.ocr
      ?.detected_text
      ?.length > 0 && (

      <div>
        <p className="text-[11px] font-bold mb-1">
          📝 Text Found
        </p>

        {imageAnalysis[subTask.id]
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
                                    ) : activeCameraTaskId === subTask.id ? (
                                        <div className="relative bg-black rounded-xl overflow-hidden shadow-inner aspect-video animate-fade-in mt-3">
                                          <video
                                            ref={videoRef}
                                            autoPlay
                                            playsInline
                                            className="w-full h-full object-cover transform scale-x-[-1]"
                                          />
                                          <div className="absolute bottom-3 left-0 right-0 flex justify-center space-x-3 px-3">
                                            <button
                                              type="button"
                                              onClick={() => captureLivePicture(subTask.id)}
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
                                      ) : null}
                                  </div>
                                )}

                                {subTask.submissionFormat === 'audio' && (
                                  <div className="space-y-3">
                                    {audioFiles[subTask.id] ? (
                                      <div className="p-3 bg-white border border-[#E2E8F0] rounded-xl space-y-2 animate-fade-in shadow-sm">
                                        <div className="flex items-center justify-between">
                                          <span className="text-[10px] font-sans font-bold text-gray-500 uppercase tracking-wider flex items-center space-x-1">
                                            <VolumeIcon size={12} className="text-[#2F63FF]" />
                                            <span>Voice Capture Verified</span>
                                          </span>
                                          <button
                                            type="button"
                                            onClick={() => { setAudioFiles(prev => ({ ...prev, [subTask.id]: '' })); startAudioRecording(subTask.id); }}
                                            className="w-7 h-7 rounded-full bg-sky-50 hover:bg-sky-100 text-[#2F63FF] flex items-center justify-center transition-colors shadow-sm cursor-pointer"
                                            title="Record Again"
                                          >
                                            <Mic size={12} />
                                          </button>
                                        </div>
                                        <audio 
                                          src={audioFiles[subTask.id]} 
                                          controls 
                                          className="w-full h-11" 
                                        />
                                      </div>
                                    ) : null}
                                  </div>
                                )}

                                {subTask.submissionFormat === 'video' && (
                                  <div className="space-y-3">
                                    {videoFiles[subTask.id] ? (
                                      <div className="p-2 bg-white border border-[#E2E8F0] rounded-xl space-y-2 animate-fade-in shadow-sm">
                                        <div className="flex items-center justify-between">
                                          <span className="text-[10px] font-sans font-bold text-gray-500 uppercase tracking-wider flex items-center space-x-1">
                                            <VideoIcon size={12} className="text-[#2F63FF]" />
                                            <span>Video Capture Verified</span>
                                          </span>
                                          <button
                                            type="button"
                                            onClick={() => setVideoFiles(prev => ({ ...prev, [subTask.id]: '' }))}
                                            className="text-[10px] font-bold text-red-500 hover:text-red-700 cursor-pointer text-right bg-transparent border-0"
                                          >
                                            × Re-record
                                          </button>
                                        </div>
                                        <video 
                                          src={videoFiles[subTask.id]} 
                                          controls 
                                          className="w-full h-40 object-cover rounded-lg" 
                                        />
                                      </div>
                                    ) : activeRecordingVideoTaskId === subTask.id ? (
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
                                      <div>
                                        <button
                                          type="button"
                                          onClick={() => startVideoRecording(subTask.id)}
                                          className="w-full flex flex-col items-center justify-center text-center border border-dashed border-indigo-200 bg-indigo-50/20 hover:bg-indigo-50 hover:border-indigo-400 p-4 rounded-xl cursor-pointer transition-all duration-150 active:scale-[0.98]"
                                        >
                                          <VideoIcon className="text-indigo-600 mb-1.5 animate-pulse" size={20} />
                                          <span className="text-xs font-semibold text-indigo-950 block">Live Web Video</span>
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
                                        <p className="text-sm font-bold text-[#0F172A] leading-tight">
                                          {q.question || 'Standard question statement?'}
                                        </p>
                                        <div className="space-y-2">
                                          {q.options.map((optionText, oIndex) => {
                                            const currentAns = quizAnswers[task.id]?.[q.id];
                                            const isSelected = Array.isArray(currentAns) 
                                                ? currentAns.includes(optionText) 
                                                : currentAns === optionText;
                                            return (
                                                <button
                                                  key={oIndex}
                                                  type="button"
                                                  onClick={() => handleAnswerQuiz(task.id, q.id, optionText, q.type)}
                                                  className={`w-full text-left p-2 rounded-lg text-sm transition-all flex items-center space-x-2 border-2 cursor-pointer shadow-sm active:scale-[0.99] ${
                                                    isSelected
                                                      ? 'border-[#2F63FF] bg-[#2F63FF]/5 text-[#2F63FF] font-bold'
                                                      : 'border-gray-200 bg-white text-gray-700 hover:bg-slate-50 hover:border-gray-300 font-semibold'
                                                  }`}
                                                >
                                                  <span className={`w-4 h-4 flex-shrink-0 rounded-full border-2 flex items-center justify-center text-[10px] font-black font-sans transition-colors ${
                                                    isSelected ? 'bg-[#2F63FF] border-[#2F63FF] text-white' : 'border-gray-300 text-gray-400 bg-gray-50'
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

                            <div className="flex gap-2 justify-center">
                              <button
                                type="button"
                                onClick={() => handleSubmitVerification(task.id)}
                                disabled={isSubmittingNow}
                                className="text-center py-2.5 px-6 bg-[#2F63FF] hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg shadow-md cursor-pointer flex items-center justify-center space-x-1"
                              >
                                <Send size={11} />
                                <span>{isSubmittingNow ? 'Submitting...' : 'Submit'}</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
              </React.Fragment>
            );
          })}
        </div>
        <CustomPagination
          className={viewMode === 'list' ? "border-t border-gray-100 bg-white" : "mt-4"}
          currentPage={currentPage}
          totalPages={totalPages}
          itemsPerPage={itemsPerPage}
          setItemsPerPage={setItemsPerPage}
          setCurrentPage={setCurrentPage}
        />
      </div>
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
                <div>
                  <h3 className="text-sm font-bold text-[#0F172A]">Generate Performance Report</h3>
                  <p className="text-[11px] text-gray-500">Synthesize completed submission analysis into a PDF report.</p>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Task</label>
                <input
                  type="text"
                  value={selectedReportTask.title || selectedReportTask.id}
                  disabled
                  className="w-full bg-[#FAFBFD] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-gray-500 focus:outline-none"
                />
              </div>              <div>
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
