'use client'

import React, { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/auth-context';
import { ArrowLeft, Eye, GitCompare, Edit3, Sparkles, ShieldAlert, Lock, RotateCcw, XCircle, AlertTriangle, CheckCircle, FileText, Upload, UserCheck, Clock, History, Image as ImageIcon, Video, Music2, Link2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import EmployeeNavigation from '@/components/employee-navigation';
import { fetchWithAuth } from '@/lib/fetch-with-auth';
import { MediaAwareHtml, buildMediaEmbedMarkup, type ModuleMediaType } from '@/lib/module-media-embeds';

interface TrainingModule {
  module_id: string;
  title: string;
  description: string;
  review_stage: string;
  created_at: string;
  reviewer_id: string;
  uploaded_by: string;
}

interface ProcessedModule {
  processed_module_id: string;
  original_module_id: string;
  title: string;
  content: string;
  section_type: string;
  order_index: number;
  created_at: string;
}

interface ContentHistory {
  content_generation_history_id: string;
  processed_module_id: string;
  original_module_id: string;
  content: string;
  status: string;
  created_at: string;
}

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL;
const DEFAULT_MAX_VIDEO_UPLOAD_MB = 50;
const MAX_VIDEO_UPLOAD_MB = Number(process.env.NEXT_PUBLIC_MODULE_MEDIA_MAX_UPLOAD_MB || DEFAULT_MAX_VIDEO_UPLOAD_MB);
const DEFAULT_MAX_IMAGE_UPLOAD_MB = 20;
const DEFAULT_MAX_AUDIO_UPLOAD_MB = 25;
const MAX_IMAGE_UPLOAD_MB = Number(process.env.NEXT_PUBLIC_MODULE_MEDIA_MAX_IMAGE_UPLOAD_MB || DEFAULT_MAX_IMAGE_UPLOAD_MB);
const MAX_AUDIO_UPLOAD_MB = Number(process.env.NEXT_PUBLIC_MODULE_MEDIA_MAX_AUDIO_UPLOAD_MB || DEFAULT_MAX_AUDIO_UPLOAD_MB);

const fetchUserByEmail = async (email: string | null) => {
  if(!email) return null;
  try{
    const res = await fetchWithAuth(`${API_BASE}/api/users/by-email/${encodeURIComponent(email)}`);
    if (!res.ok) return null;
    const payload = await res.json();
    let u = payload?.user ?? payload;
    if (Array.isArray(u)) u = u[0];
    return u || null;
  } catch(e) {
    console.error("Error fetching user by email:", e);
    return null;
  }
};

const formatFileSize = (bytes: number) => {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} bytes`;
};

export default function EditModulePage() {
  const params = useParams();
  const router = useRouter();
  const { user,loading:authLoading } = useAuth();
  const moduleId = params.id as string;

  const [module, setModule] = useState<TrainingModule | null>(null);
  const [subModules, setSubModules] = useState<ProcessedModule[]>([]);
  const [selectedSubModule, setSelectedSubModule] = useState<ProcessedModule | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeView, setActiveView] = useState<'edit' | 'diff' | 'final'>('edit');
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<'uploader' | 'reviewer' | 'both' | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState(false);

  // Version control state
  const [pendingHistoryMap, setPendingHistoryMap] = useState<Record<string, ContentHistory>>({});
  const [hasPendingReview, setHasPendingReview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [isUploadingVideo, setIsUploadingVideo] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isUploadingAudio, setIsUploadingAudio] = useState(false);
  const [activeMediaMenu, setActiveMediaMenu] = useState<ModuleMediaType | null>(null);

  const contentEditableRef = useRef<HTMLDivElement>(null);
  const videoUploadInputRef = useRef<HTMLInputElement>(null);
  const imageUploadInputRef = useRef<HTMLInputElement>(null);
  const audioUploadInputRef = useRef<HTMLInputElement>(null);
  const savedSelectionRef = useRef<Range | null>(null);
  const uploadInsertMarkerIdRef = useRef<string | null>(null);

  // Check authentication on mount
  useEffect(() => {
    checkAuth();
  }, []);

  // const {user,loading:authLoading,logout} = await useAuth();
  useEffect(() => {
    if (currentUserId && isAuthorized && moduleId) {
      fetchModuleAndSubModules();
    }
  }, [moduleId, currentUserId, isAuthorized]);

  useEffect(() => {
    if (selectedSubModule) {
      // If there's a pending review version for this sub-module, show that for reviewer
      const pending = pendingHistoryMap[selectedSubModule.processed_module_id];
      if (pending && (userRole === 'reviewer' || userRole === 'both')) {
        setEditedContent(pending.content);
      } else {
        setEditedContent(selectedSubModule.content || '');
      }
      setIsEditing(false);
      setHasUnsavedChanges(false);
    }
  }, [selectedSubModule, pendingHistoryMap, userRole]);

  useEffect(() => {
    if (activeView !== 'edit') return;
    const editor = contentEditableRef.current;
    if (!editor) return;
    if (document.activeElement === editor) return;
   
    // Sync editor content with state whenever editedContent changes
    if (editor.innerHTML !== editedContent) {
      editor.innerHTML = editedContent || '';
    }
  }, [activeView, editedContent, selectedSubModule?.processed_module_id, userRole, hasPendingReview, loading]);

  useEffect(() => {
      if (!authLoading) {
        if (!user) router.push("/login");
        else checkAuth();
       
      }
    }, [user, authLoading, router]);
  const checkAuth = async () => {
    try {
      setAuthChecking(true);

      // // Check if user session exists
      // const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      console.log(user);
      if(!user?.email)return
     

      // Verify user exists and get their details
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('user_id, email')
        .eq('email', user?.email)
        .single();

      if (userError || !userData) {
        console.error('User not found in database:', userError);
        router.push('/login');
        return;
      }

      setCurrentUserId(userData.user_id);

      // Fetch the module to check authorization
      const { data: moduleData, error: moduleError } = await supabase
        .from('training_modules')
        .select('module_id, uploaded_by, reviewer_id, title')
        .eq('module_id', moduleId)
        .single();

      if (moduleError) {
        console.error('Module not found:', moduleError);
        alert('Module not found or you do not have permission to access it.');
        router.push('/admin/dashboard/human-in-the-loop');
        return;
      }

      // Check if user is either the uploader or reviewer
      const isUploader = moduleData.uploaded_by === userData.user_id;
      const isReviewer = moduleData.reviewer_id === userData.user_id;

      console.log(userData)
      console.log(moduleData)
      console.log(isReviewer)
      console.log(isUploader)
      if (!isUploader && !isReviewer) {
        console.error('User not authorized to access this module');
        alert('You are not authorized to access this module. You must be either the uploader or assigned reviewer.');
        router.push('/admin/dashboard/human-in-the-loop');
        return;
      }

      // User is authorized
      setIsAuthorized(true);
      setAuthChecking(false);
    } catch (error) {
      console.error('Auth check error:', error);
      alert('An error occurred while verifying your access.');
      router.push('/admin/dashboard/human-in-the-loop');
    }
  };

  const getCurrentUser = async () => {
    try {
      if (!user?.email) return;

      const emp = await fetchUserByEmail(user.email);
      if (emp &&  emp.user_id) {
        setCurrentUserId(emp.user_id);
      } else {
        console.warn("Current user not found in database:", user.email);
      }
    } catch (error) {
      console.error('Error fetching current user:', error);
    }
  };

  const fetchModuleAndSubModules = async () => {
    try {
      setLoading(true);

      // Verify session is still valid before fetching
        // const { data: { session } } = await supabase.auth.getSession();
        // if (!session) {
        //   console.error('Session expired during fetch');
        //   router.push('/login');
        //   return;
        // }

      const { data: moduleData, error: moduleError } = await supabase
        .from('training_modules')
        .select('*')
        .eq('module_id', moduleId)
        .single();

      if (moduleError) {
        // Check if error is due to expired session
        if (moduleError.message.includes('JWT') || moduleError.message.includes('session') || moduleError.message.includes('expired')) {
          console.error('Session expired:', moduleError);
          router.push('/login');
          return;
        }
        throw moduleError;
      }

      if (moduleData) {
        // Double-check authorization (in case of race conditions)
        const isUploader = moduleData.uploaded_by === currentUserId;
        const isReviewer = moduleData.reviewer_id === currentUserId;

        if (!isUploader && !isReviewer) {
          console.error('Authorization check failed during fetch');
          alert('You are not authorized to access this module.');
          router.push('/admin/dashboard/human-in-the-loop');
          return;
        }

        setModule(moduleData);

        let role: 'uploader' | 'reviewer' | 'both' | null = null;
        if (isUploader && isReviewer) role = 'both';
        else if (isReviewer) role = 'reviewer';
        else if (isUploader) role = 'uploader';
        setUserRole(role);

        const { data: subModulesData, error: subModulesError } = await supabase
          .from('processed_modules')
          .select('*')
          .eq('original_module_id', moduleId)
          .order('order_index', { ascending: true });

        if (subModulesError) {
          if (subModulesError.message.includes('JWT') || subModulesError.message.includes('session') || subModulesError.message.includes('expired')) {
            console.error('Session expired:', subModulesError);
            router.push('/login');
            return;
          }
          throw subModulesError;
        }

        if (subModulesData && subModulesData.length > 0) {
          setSubModules(subModulesData);
          setSelectedSubModule(subModulesData[0]);
          setEditedContent(subModulesData[0].content || '');
          setActiveView('edit');
        }

        // Fetch pending/in_review history for all sub-modules of this module
        await fetchPendingHistory();
      }
    } catch (error) {
      console.error('Error fetching module:', error);
      alert('Failed to load module data.');
    } finally {
      setLoading(false);
    }
  };

  const fetchPendingHistory = async () => {
    try {
      if (!currentUserId) return;

      // Get the latest in_review entry per processed_module_id for this module
      const response = await fetchWithAuth(
        `${API_BASE}/api/content-generation-history/by-original-module/${moduleId}?status=in_review&limit=500`,
        {
          headers: {
            'X-User-ID': currentUserId
          }
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to fetch pending history');
      }


      console.log("Inside the pending history")
      const data = await response.json();
      const historyData = data.data.history || [];

      if (historyData && historyData.length > 0) {
        // Build a map: processed_module_id -> latest in_review history entry
        const map: Record<string, ContentHistory> = {};
        for (const entry of historyData) {
          // Only keep the latest one per processed_module_id
          if (!map[entry.processed_module_id]) {
            map[entry.processed_module_id] = entry;
          }
        }
        setPendingHistoryMap(map);
        setHasPendingReview(true);
      } else {
        setPendingHistoryMap({});
        setHasPendingReview(false);
      }
    } catch (error) {
      console.error('Error fetching pending history:', error);
    }
  };

  const handleContentEditableChange = () => {
    const latestContent = contentEditableRef.current?.innerHTML ?? '';
    if (latestContent !== editedContent) {
      setEditedContent(latestContent);
    }
    if (!hasUnsavedChanges) {
      setHasUnsavedChanges(true);
    }
  };

  const saveCurrentSelection = () => {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      savedSelectionRef.current = selection.getRangeAt(0).cloneRange();
    }
  };

  const handleToolbarMouseDown = (event: React.MouseEvent<HTMLButtonElement>) => {
    // Keep editor focus/selection intact while clicking toolbar actions.
    event.preventDefault();
    saveCurrentSelection();
  };

  const syncEditorDomToState = () => {
    if (!contentEditableRef.current) return;
    const nextContent = contentEditableRef.current.innerHTML;
    const activeProcessedModuleId = selectedSubModule?.processed_module_id;

    setEditedContent(nextContent);
    setSelectedSubModule((previous) => previous ? { ...previous, content: nextContent } : previous);
    if (activeProcessedModuleId) {
      setSubModules((previous) => previous.map((subModule) => (
        subModule.processed_module_id === activeProcessedModuleId
          ? { ...subModule, content: nextContent }
          : subModule
      )));
    }
    handleContentEditableChange();
  };

  const createTransientId = () =>
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const placeUploadInsertMarker = () => {
    if (!contentEditableRef.current) return null;
    const editor = contentEditableRef.current;
    const markerId = createTransientId();
    const marker = document.createElement('span');
    marker.setAttribute('data-upload-marker-id', markerId);
    marker.style.display = 'inline-block';
    marker.style.width = '0';
    marker.style.overflow = 'hidden';
    marker.textContent = '\u200b';

    // Try to get a valid range inside the editor
    let insertionRange: Range | null = null;

    // First, try the saved selection
    if (savedSelectionRef.current && editor.contains(savedSelectionRef.current.commonAncestorContainer)) {
      insertionRange = savedSelectionRef.current.cloneRange();
    } else {
      // If no valid saved selection, try the current selection
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const currentRange = selection.getRangeAt(0);
        if (editor.contains(currentRange.commonAncestorContainer)) {
          insertionRange = currentRange.cloneRange();
        }
      }
    }

    // If we have a valid range, insert the marker at that position
    if (insertionRange) {
      insertionRange.deleteContents();
      insertionRange.insertNode(marker);

      const selection = window.getSelection();
      const afterRange = document.createRange();
      afterRange.setStartAfter(marker);
      afterRange.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(afterRange);
      savedSelectionRef.current = afterRange.cloneRange();
    } else {
      // Fallback: if no valid cursor position, place marker at the end
      editor.appendChild(marker);
    }

    uploadInsertMarkerIdRef.current = markerId;
    return markerId;
  };

  const clearUploadInsertMarker = () => {
    const markerId = uploadInsertMarkerIdRef.current;
    const editor = contentEditableRef.current;
    if (markerId && editor) {
      const marker = editor.querySelector(`span[data-upload-marker-id="${markerId}"]`);
      marker?.remove();
    }
    uploadInsertMarkerIdRef.current = null;
  };

  const insertMarkupAtUploadMarker = (markup: string) => {
    const markerId = uploadInsertMarkerIdRef.current;
    const editor = contentEditableRef.current;
    if (!markerId || !editor || !markup) return false;

    const marker = editor.querySelector(`span[data-upload-marker-id="${markerId}"]`) as HTMLElement | null;
    uploadInsertMarkerIdRef.current = null;
    if (!marker) return false;

    const range = document.createRange();
    range.setStartBefore(marker);
    range.setEndBefore(marker);
    const fragment = range.createContextualFragment(markup);
    const lastNode = fragment.lastChild;
    marker.replaceWith(fragment);

    if (lastNode) {
      const selection = window.getSelection();
      const afterRange = document.createRange();
      afterRange.setStartAfter(lastNode);
      afterRange.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(afterRange);
      savedSelectionRef.current = afterRange.cloneRange();
    }

    syncEditorDomToState();
    return true;
  };

  const insertMarkupAtCursor = (markup: string) => {
    if (!contentEditableRef.current || !markup) return;
    const editor = contentEditableRef.current;
    editor.focus();

    const hasSavedRangeInsideEditor =
      !!savedSelectionRef.current &&
      editor.contains(savedSelectionRef.current.commonAncestorContainer);

    if (hasSavedRangeInsideEditor) {
      const range = savedSelectionRef.current!.cloneRange();
      range.deleteContents();
      const fragment = range.createContextualFragment(markup);
      const lastNode = fragment.lastChild;
      range.insertNode(fragment);

      if (lastNode) {
        const selection = window.getSelection();
        const afterRange = document.createRange();
        afterRange.setStartAfter(lastNode);
        afterRange.collapse(true);
        selection?.removeAllRanges();
        selection?.addRange(afterRange);
        savedSelectionRef.current = afterRange.cloneRange();
      }
    } else {
      editor.insertAdjacentHTML('beforeend', markup);
    }

    syncEditorDomToState();
    saveCurrentSelection();
  };

  const handleSubModuleClick = (subModule: ProcessedModule) => {
    if (hasUnsavedChanges) {
      if (!confirm('You have unsaved changes. Do you want to discard them?')) {
        return;
      }
    }
    setSelectedSubModule(subModule);
    setHasUnsavedChanges(false);
    setActiveView('edit');
  };

  const insertMediaEmbedAtCursor = (type: ModuleMediaType) => {
    if (!contentEditableRef.current) return;

    const mediaUrl = window.prompt(`Enter a public ${type} URL (https://...):`);
    if (!mediaUrl) return;

    if (!/^https?:\/\//i.test(mediaUrl.trim())) {
      alert('Please enter a valid http/https URL.');
      return;
    }

    const title = window.prompt('Optional title for this media:', `${type.toUpperCase()} embed`) || '';
    const description = window.prompt('Optional short description:') || '';

    const embedMarkup = buildMediaEmbedMarkup({
      type,
      src: mediaUrl.trim(),
      title,
      description,
    });

    if (!embedMarkup) {
      alert('Could not create media embed from the provided URL.');
      return;
    }

    insertMarkupAtCursor(embedMarkup);
  };

  const getMediaTypeLabel = (type: ModuleMediaType) => {
    if (type === 'image') return 'image';
    if (type === 'audio') return 'audio';
    return 'video';
  };

  const setMediaUploadingState = (type: ModuleMediaType, isUploading: boolean) => {
    if (type === 'image') {
      setIsUploadingImage(isUploading);
      return;
    }
    if (type === 'audio') {
      setIsUploadingAudio(isUploading);
      return;
    }
    setIsUploadingVideo(isUploading);
  };

  const updateInsertedMediaMetadata = (mediaId: string, title: string, description: string) => {
    if (!contentEditableRef.current) return;

    const editor = contentEditableRef.current;
    const targetFigure = editor.querySelector(`figure.module-media-embed[data-media-id="${mediaId}"]`) as HTMLElement | null;
    if (!targetFigure) return;

    targetFigure.setAttribute('data-media-title', title);
    targetFigure.setAttribute('data-media-description', description);

    const titleEl = targetFigure.querySelector('.module-media-title');
    if (titleEl) titleEl.textContent = title;

    const captionEl = targetFigure.querySelector('.module-media-caption');
    if (captionEl) captionEl.textContent = title;

    let descriptionEl = targetFigure.querySelector('.module-media-description') as HTMLElement | null;
    if (description) {
      if (!descriptionEl) {
        const placeholder = targetFigure.querySelector('.module-media-placeholder');
        if (placeholder) {
          descriptionEl = document.createElement('span');
          descriptionEl.className = 'module-media-description';
          descriptionEl.style.display = 'block';
          descriptionEl.style.color = '#475569';
          descriptionEl.style.fontSize = '12px';
          descriptionEl.style.marginTop = '4px';
          placeholder.appendChild(descriptionEl);
        }
      }
      if (descriptionEl) descriptionEl.textContent = description;
    } else if (descriptionEl) {
      descriptionEl.remove();
    }

    syncEditorDomToState();
  };

  const handleMediaUpload = async (mediaType: ModuleMediaType, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    const mediaLabel = getMediaTypeLabel(mediaType);

    const extensionMatchers: Record<ModuleMediaType, RegExp> = {
      video: /\.(mp4|mov|webm|m4v|avi)$/i,
      image: /\.(png|jpe?g|gif|webp|bmp|svg)$/i,
      audio: /\.(mp3|wav|m4a|aac|ogg|flac)$/i,
    };

    const mimePrefix: Record<ModuleMediaType, string> = {
      video: 'video/',
      image: 'image/',
      audio: 'audio/',
    };

    const maxUploadMbByType: Record<ModuleMediaType, number> = {
      video: MAX_VIDEO_UPLOAD_MB,
      image: MAX_IMAGE_UPLOAD_MB,
      audio: MAX_AUDIO_UPLOAD_MB,
    };

    if (!file) {
      clearUploadInsertMarker();
      return;
    }

    if (!file.type.startsWith(mimePrefix[mediaType]) && !extensionMatchers[mediaType].test(file.name)) {
      clearUploadInsertMarker();
      alert(`Please choose a valid ${mediaLabel} file.`);
      return;
    }

    const maxUploadMb = maxUploadMbByType[mediaType];
    if (Number.isFinite(maxUploadMb) && file.size > maxUploadMb * 1024 * 1024) {
      clearUploadInsertMarker();
      alert(
        `Selected file is ${formatFileSize(file.size)}. Max allowed upload size is ${maxUploadMb} MB.`
      );
      return;
    }

    setMediaUploadingState(mediaType, true);
    try {
      const signedUploadResponse = await fetch('/api/module-media/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'createSignedUploadUrl',
          moduleId,
          mediaType,
          fileName: file.name,
        }),
      });

      if (!signedUploadResponse.ok) {
        const error = await signedUploadResponse.json().catch(() => ({}));
        const message = error.error || error.detail || `${mediaLabel} upload failed`;
        if (signedUploadResponse.status === 413 || error.code === 'FILE_TOO_LARGE') {
          throw new Error(`${message} Please upload a smaller/compressed ${mediaLabel} file.`);
        }
        throw new Error(message);
      }

      const signedPayload = await signedUploadResponse.json();
      const bucket = signedPayload?.bucket as string | undefined;
      const storagePath = signedPayload?.path as string | undefined;
      const uploadToken = signedPayload?.token as string | undefined;

      if (!bucket || !storagePath || !uploadToken) {
        throw new Error(`${mediaLabel} upload failed: missing signed upload details.`);
      }

      const { error: directUploadError } = await supabase.storage
        .from(bucket)
        .uploadToSignedUrl(storagePath, uploadToken, file);

      if (directUploadError) {
        throw new Error(directUploadError.message || `${mediaLabel} upload failed`);
      }

      const { data: publicData } = supabase.storage.from(bucket).getPublicUrl(storagePath);
      const mediaUrl = publicData?.publicUrl;

      if (!mediaUrl) {
        throw new Error(`${mediaLabel} upload succeeded, but no public URL was returned.`);
      }

      const mediaId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const defaultTitle = file.name.replace(/\.[^.]+$/, '') || `${mediaLabel} embed`;

      const embedMarkup = buildMediaEmbedMarkup({
        type: mediaType,
        src: mediaUrl,
        title: defaultTitle,
        description: '',
        embedId: mediaId,
      });

      if (!embedMarkup) {
        throw new Error(`Could not build the ${mediaLabel} embed markup.`);
      }

      const insertedAtMarker = insertMarkupAtUploadMarker(embedMarkup);
      if (!insertedAtMarker) {
        insertMarkupAtCursor(embedMarkup);
      }

      const title = (window.prompt(`Optional title for this ${mediaLabel}:`, defaultTitle) || defaultTitle).trim() || defaultTitle;
      const description = (window.prompt(`Optional short description for this ${mediaLabel}:`) || '').trim();
      updateInsertedMediaMetadata(mediaId, title, description);
    } catch (error) {
      clearUploadInsertMarker();
      console.error(`${mediaLabel} upload error:`, error);
      alert(error instanceof Error ? error.message : `Failed to upload ${mediaLabel}`);
    } finally {
      setMediaUploadingState(mediaType, false);
    }
  };

  const handleVideoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    handleMediaUpload('video', event);
  };

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    handleMediaUpload('image', event);
  };

  const handleAudioUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    handleMediaUpload('audio', event);
  };

  const handleMediaUploadButtonClick = (mediaType: ModuleMediaType) => {
    // Ensure editor is focused and capture current cursor position
    const editor = contentEditableRef.current;
    if (!editor) return;
   
    editor.focus();
   
    // Capture the current selection/cursor position
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      savedSelectionRef.current = selection.getRangeAt(0).cloneRange();
    }
   
    // Place the marker at the current position
    placeUploadInsertMarker();

    if (mediaType === 'image') {
      imageUploadInputRef.current?.click();
      return;
    }
    if (mediaType === 'audio') {
      audioUploadInputRef.current?.click();
      return;
    }

    // Open file picker
    videoUploadInputRef.current?.click();
  };

  const handleVideoUploadButtonClick = () => {
    handleMediaUploadButtonClick('video');
  };

  const handleImageUploadButtonClick = () => {
    handleMediaUploadButtonClick('image');
  };

  const handleAudioUploadButtonClick = () => {
    handleMediaUploadButtonClick('audio');
  };

  const handleMediaSourceClick = (mediaType: ModuleMediaType, source: 'local' | 'link') => {
    if (source === 'local') {
      handleMediaUploadButtonClick(mediaType);
      setActiveMediaMenu(null);
      return;
    }

    const editor = contentEditableRef.current;
    if (editor) {
      editor.focus();
      saveCurrentSelection();
    }

    insertMediaEmbedAtCursor(mediaType);
    setActiveMediaMenu(null);
  };

  // ADMIN: Save edits locally (no DB write yet, just prepare for request approval)
  const handleSaveChanges = () => {
    if (!selectedSubModule || !contentEditableRef.current) return;
    const newContent = contentEditableRef.current.innerHTML;
    setEditedContent(newContent);
    setHasUnsavedChanges(false);
    alert('Changes saved locally. Click "Request Approval" to submit for review.');
  };

  // ADMIN: Request Approval - store new content in content_generation_history with status in_review
  const handleRequestApproval = async () => {
    if (!selectedSubModule || !contentEditableRef.current || !currentUserId) return;

    const newContent = contentEditableRef.current.innerHTML;

    // Check if content actually changed from live
    if (newContent === selectedSubModule.content) {
      alert('No changes detected from the live content.');
      return;
    }

    if (!confirm('Submit your changes for reviewer approval?')) return;

    setSubmitting(true);
    try {
      // Insert new history entry with status in_review
      const historyResponse = await fetchWithAuth(`${API_BASE}/api/content-generation-history/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-ID': currentUserId
        },
        body: JSON.stringify({
          processed_module_id: selectedSubModule.processed_module_id,
          original_module_id: moduleId,
          content: newContent,
          status: 'in_review'
        })
      });

      if (!historyResponse.ok) {
        const error = await historyResponse.json();
        throw new Error(error.detail || 'Failed to create history entry');
      }

      // Update the training module review_stage to in_review
      const { error: updateError } = await supabase
        .from('training_modules')
        .update({ review_stage: 'in_review' })
        .eq('module_id', moduleId);

      if (updateError) throw updateError;

      setHasUnsavedChanges(false);

      alert('Changes submitted for review! The reviewer will be notified.');

      // Refresh data
      await fetchPendingHistory();
      // Refresh module to get updated review_stage
      const { data: updatedModule } = await supabase
        .from('training_modules')
        .select('*')
        .eq('module_id', moduleId)
        .single();
      if (updatedModule) setModule(updatedModule);

     
      // Update local state with the saved content
      const updatedSubModules = subModules.map(sm =>
        sm.processed_module_id === selectedSubModule.processed_module_id
          ? { ...sm, content: newContent }
          : sm)

      setSubModules(updatedSubModules);
    } catch (error) {
      console.error('Error submitting for approval:', error);
      alert('Failed to submit for review');
    } finally {
      setSubmitting(false);
    }  };
     
  // REVIEWER: Save reviewer edits to history (overwrite the in_review entry)
  const handleReviewerSave = async () => {
    if (!selectedSubModule || !contentEditableRef.current || !currentUserId) return;

    const newContent = contentEditableRef.current.innerHTML;
    const existingPending = pendingHistoryMap[selectedSubModule.processed_module_id];

    setSubmitting(true);
    try {
      if (existingPending) {
        // Update existing in_review entry with reviewer's edits
        const response = await fetchWithAuth(
          `${API_BASE}/api/content-generation-history/${existingPending.content_generation_history_id}`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'X-User-ID': currentUserId
            },
            body: JSON.stringify({ content: newContent })
          }
        );

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.detail || 'Failed to update history');
        }
      } else {
        // Create new in_review entry with reviewer's edits
        const response = await fetchWithAuth(`${API_BASE}/api/content-generation-history/`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-User-ID': currentUserId
          },
          body: JSON.stringify({
            processed_module_id: selectedSubModule.processed_module_id,
            original_module_id: moduleId,
            content: newContent,
            status: 'in_review'
          })
        });

        console.log(response)
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.detail || 'Failed to create history entry');
        }
      }

      setHasUnsavedChanges(false);
      alert('Your edits have been saved.');
      await fetchPendingHistory();
    } catch (error) {
      console.error('Error saving reviewer edits:', error);
      alert('Failed to save edits');
    } finally {
      setSubmitting(false);
    }
  };

  // REVIEWER: Final Approval - push all in_review content to processed_modules (live)
  const handleFinalApproval = async () => {
    if (!confirm('Approve all changes and push to live? This will update the content visible to employees.')) return;

    if (!currentUserId) return;

    setSubmitting(true);
    try {
      // Get all in_review history entries for this module
      const response = await fetchWithAuth(
        `${API_BASE}/api/content-generation-history/by-original-module/${moduleId}?status=in_review&limit=500`,
        {
          headers: {
            'X-User-ID': currentUserId
          }
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to fetch pending entries');
      }

      const data = await response.json();
     
     
      console.log(data)
      const pendingEntries = data.history || data.data.history || [];

      if (!pendingEntries || pendingEntries.length === 0) {
        alert('No pending changes to approve.');
        setSubmitting(false);
        return;
      }

      // Get latest entry per processed_module_id
      const latestPerModule: Record<string, ContentHistory> = {};
      for (const entry of pendingEntries) {
        if (!latestPerModule[entry.processed_module_id]) {
          latestPerModule[entry.processed_module_id] = entry;
        }
      }

      // Push each approved content to processed_modules
      for (const [processedModuleId, historyEntry] of Object.entries(latestPerModule)) {
        const { error: updateError } = await supabase
          .from('processed_modules')
          .update({ content: historyEntry.content })
          .eq('processed_module_id', processedModuleId);

        if (updateError) {
          console.error(`Failed to update processed_module ${processedModuleId}:`, updateError);
          continue;
        }
      }

      // Mark all in_review entries for this module as approved
      for (const entry of pendingEntries) {
        const statusResponse = await fetchWithAuth(
          `${API_BASE}/api/content-generation-history/${entry.content_generation_history_id}/status`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'X-User-ID': currentUserId
            },
            body: JSON.stringify({ status: 'approved' })
          }
        );

        if (!statusResponse.ok) {
          console.error(`Failed to update status for ${entry.content_generation_history_id}`);
        }
      }

      // Update training module review_stage to approved
      const { error: moduleUpdateError } = await supabase
        .from('training_modules')
        .update({ review_stage: 'approved' })
        .eq('module_id', moduleId);

      if (moduleUpdateError) throw moduleUpdateError;

      alert('All changes approved and pushed to live!');
      router.push('/admin/dashboard/human-in-the-loop');
    } catch (error) {
      console.error('Error approving changes:', error);
      alert('Failed to approve changes');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!confirm('Reject all pending changes? This will discard the submitted edits.')) return;

    if (!currentUserId) return;

    setSubmitting(true);
    try {
      // Get all in_review entries first
      const response = await fetchWithAuth(
        `${API_BASE}/api/content-generation-history/by-original-module/${moduleId}?status=in_review&limit=500`,
        {
          headers: {
            'X-User-ID': currentUserId
          }
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to fetch pending entries');
      }

      const data = await response.json();
      const pendingEntries = data.history || [];

      // Mark all in_review entries as rejected
      for (const entry of pendingEntries) {
        const statusResponse = await fetchWithAuth(
          `${API_BASE}/api/content-generation-history/${entry.content_generation_history_id}/status`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'X-User-ID': currentUserId
            },
            body: JSON.stringify({ status: 'rejected' })
          }
        );

        if (!statusResponse.ok) {
          console.error(`Failed to reject ${entry.content_generation_history_id}`);
        }
      }

      // Update training module review_stage to rejected
      const { error: moduleUpdateError } = await supabase
        .from('training_modules')
        .update({ review_stage: 'rejected' })
        .eq('module_id', moduleId);

      if (moduleUpdateError) throw moduleUpdateError;

      alert('Changes rejected.');
      router.push('/admin/dashboard/human-in-the-loop');
    } catch (error) {
      console.error('Error rejecting:', error);
      alert('Failed to reject');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegenerate = () => {
    alert('Regenerating content...');
  };

  const handleRequestChanges = async () => {
    try {
      const { error } = await supabase
        .from('training_modules')
        .update({ review_stage: 'in_review' })
        .eq('module_id', moduleId);
      if (error) throw error;
      alert('Module moved to In Review status');
    } catch (error) {
      console.error('Error updating module:', error);
      alert('Failed to update module status');
    }
  };

  const getReviewStageColor = (stage?: string) => {
    switch (stage) {
      case 'approved': return 'bg-green-50 text-green-600';
      case 'in_review': return 'bg-blue-50 text-blue-600';
      case 'rejected': return 'bg-red-50 text-red-600';
      case 'pending': return 'bg-gray-100 text-gray-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  const getReviewStageLabel = (stage?: string) => {
    switch (stage) {
      case 'approved': return 'Approved';
      case 'in_review': return 'In Review';
      case 'rejected': return 'Rejected';
      case 'pending': return 'Awaiting Review';
      default: return 'Unknown';
    }
  };

  const getRoleBadge = () => {
    switch (userRole) {
      case 'uploader':
        return (
          <span className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200">
            <Upload size={14} className="mr-1.5" />
            You are the Uploader
          </span>
        );
      case 'reviewer':
        return (
          <span className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            <UserCheck size={14} className="mr-1.5" />
            You are the Reviewer
          </span>
        );
      case 'both':
        return (
          <div className="flex gap-2">
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200">
              <Upload size={12} className="mr-1" />
              Uploader
            </span>
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
              <UserCheck size={12} className="mr-1" />
              Reviewer
            </span>
          </div>
        );
      default:
        return null;
    }
  };

  const ContentRenderer = ({ htmlContent }: { htmlContent: string }) => {
    return (
      <MediaAwareHtml
        html={htmlContent}
        className="prose prose-sm max-w-none
          prose-headings:font-bold prose-headings:text-[#1E293B]
          prose-h1:text-3xl prose-h1:mb-6 prose-h1:mt-8
          prose-h2:text-2xl prose-h2:mb-4 prose-h2:mt-6 prose-h2:pb-2 prose-h2:border-b prose-h2:border-slate-200
          prose-h3:text-xl prose-h3:mb-3 prose-h3:mt-4
          prose-h4:text-lg prose-h4:mb-2 prose-h4:mt-3
          prose-p:text-slate-700 prose-p:leading-relaxed prose-p:mb-4
          prose-strong:text-slate-900 prose-strong:font-semibold
          prose-ul:list-disc prose-ul:ml-6 prose-ul:mb-4
          prose-ol:list-decimal prose-ol:ml-6 prose-ol:mb-4
          prose-li:text-slate-700 prose-li:mb-2
          prose-blockquote:border-l-4 prose-blockquote:border-blue-500 prose-blockquote:pl-4 prose-blockquote:italic prose-blockquote:bg-blue-50 prose-blockquote:py-2 prose-blockquote:my-4
          prose-table:w-full prose-table:border-collapse prose-table:my-6
          prose-thead:bg-slate-100
          prose-th:border prose-th:border-slate-300 prose-th:px-4 prose-th:py-3 prose-th:text-left prose-th:font-semibold prose-th:text-slate-900
          prose-td:border prose-td:border-slate-200 prose-td:px-4 prose-td:py-3 prose-td:text-slate-700
          prose-img:rounded-lg prose-img:shadow-md prose-img:my-6"
      />
    );
  };

  // Custom styles for callout boxes etc.
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      .callout { padding: 1rem; margin: 1.5rem 0; border-radius: 0.5rem; border-left: 4px solid; }
      .callout.tip { background-color: #f0f9ff; border-color: #3b82f6; }
      .callout.warning { background-color: #fef3c7; border-color: #f59e0b; }
      .callout.definition { background-color: #f3f4f6; border-color: #6b7280; }
      .callout h4 { margin-top: 0; margin-bottom: 0.5rem; font-weight: 600; }
      .key-takeaway { background-color: #ecfdf5; border-left: 4px solid #10b981; padding: 1rem; margin: 1.5rem 0; border-radius: 0.375rem; }
      .key-takeaway strong { color: #047857; }
      .learning-objectives { background-color: #f9fafb; padding: 1.5rem; border-radius: 0.5rem; margin-bottom: 2rem; }
      .learning-objectives h2 { color: #1e293b; margin-top: 0; }
      .learning-objectives ol { margin-bottom: 0; }
      .module-section { margin-bottom: 3rem; }
      .activity { background-color: #fef3c7; padding: 1.5rem; border-radius: 0.5rem; border-left: 4px solid #f59e0b; margin: 2rem 0; }
      .activity h3 { color: #92400e; margin-top: 0; }
      .module-summary { background-color: #dbeafe; padding: 1.5rem; border-radius: 0.5rem; margin-top: 3rem; }
      .module-summary h2 { color: #1e40af; margin-top: 0; }
      table caption { caption-side: top; font-weight: 600; margin-bottom: 0.5rem; color: #1e293b; }
      .diff-added { background-color: #dcfce7; }
      .diff-removed { background-color: #fee2e2; text-decoration: line-through; }
    `;
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, []);

  const isReviewer = userRole === 'reviewer' || userRole === 'both';
  const isUploader = userRole === 'uploader';

  // Get the pending content for the currently selected sub-module
  const currentPending = selectedSubModule ? pendingHistoryMap[selectedSubModule.processed_module_id] : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-10 h-10 border-4 border-[#3B66F5]/20 border-t-[#3B66F5] rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAFBFC]">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="px-8 py-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.push('/admin/dashboard/human-in-the-loop')}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <ArrowLeft size={20} />
              </button>
              <div>
                <h1 className="text-xl font-bold text-[#1E293B]">{module?.title || 'Module Review'}</h1>
                <div className="flex items-center gap-4 mt-1 text-sm text-slate-500">
                  <span>Sub-Modules: <span className="font-medium">{subModules.length}</span></span>
                  <span>•</span>
                  <span>ID: <span className="font-medium">{moduleId.slice(0, 8)}</span></span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {getRoleBadge()}
              <span className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold ${getReviewStageColor(module?.review_stage)}`}>
                {getReviewStageLabel(module?.review_stage)}
              </span>
            </div>
          </div>

          {/* Role-specific banners */}
          {isUploader && !hasPendingReview && (
            <div className="bg-purple-50 border border-purple-200 text-purple-800 px-4 py-3 rounded-lg flex items-center gap-3">
              <Upload size={18} />
              <span className="font-medium">You uploaded this module. Edit content and click "Request Approval" to submit changes for review.</span>
            </div>
          )}

          {isUploader && hasPendingReview && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-lg flex items-center gap-3">
              <Clock size={18} />
              <span className="font-medium">Your changes are pending review. The reviewer has been notified. You can view the submitted changes in the "Compare Changes" tab.</span>
            </div>
          )}

          {isReviewer && userRole === 'reviewer' && hasPendingReview && (
            <div className="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded-lg flex items-center gap-3">
              <AlertTriangle size={18} />
              <span className="font-medium">⚡ Review requested! The admin has submitted changes for your approval. Review the changes in "Compare Changes" tab, make edits if needed, then approve or reject.</span>
            </div>
          )}

          {isReviewer && userRole === 'reviewer' && !hasPendingReview && (
            <div className="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded-lg flex items-center gap-3">
              <UserCheck size={18} />
              <span className="font-medium">You are assigned to review this module. No pending changes to review at this time.</span>
            </div>
          )}

          {userRole === 'both' && hasPendingReview && (
            <div className="bg-indigo-50 border border-indigo-200 text-indigo-800 px-4 py-3 rounded-lg flex items-center gap-3">
              <AlertTriangle size={18} />
              <span className="font-medium">Changes are pending review. You have full authority to edit and approve.</span>
            </div>
          )}

          {userRole === 'both' && !hasPendingReview && (
            <div className="bg-indigo-50 border border-indigo-200 text-indigo-800 px-4 py-3 rounded-lg flex items-center gap-3">
              <Sparkles size={18} />
              <span className="font-medium">You uploaded and are reviewing this module. Edit content and submit or approve directly.</span>
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <div className="grid grid-cols-12 gap-6 p-8 pb-28">
        {/* Left Panel - Sub-Modules List */}
        <div className="col-span-3 flex flex-col">
          <Card className="flex-1 bg-white border-slate-200 overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-200">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-5 h-5 bg-blue-100 rounded flex items-center justify-center">
                  <FileText size={14} className="text-blue-600" />
                </div>
                <h3 className="font-semibold text-[#1E293B]">Sub-Modules</h3>
              </div>
              <p className="text-xs text-slate-500">Total: {subModules.length} modules</p>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {subModules.length === 0 ? (
                <div className="text-center py-8 text-slate-400">
                  <FileText size={32} className="mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No sub-modules found</p>
                </div>
              ) : (
                subModules.map((subModule, index) => {
                  const hasPending = !!pendingHistoryMap[subModule.processed_module_id];
                  return (
                    <div
                      key={subModule.processed_module_id}
                      onClick={() => handleSubModuleClick(subModule)}
                      className={`p-3 rounded-lg border transition-all cursor-pointer ${
                        selectedSubModule?.processed_module_id === subModule.processed_module_id
                          ? 'bg-blue-50 border-blue-300 shadow-sm'
                          : 'bg-slate-50 border-slate-200 hover:border-blue-200 hover:bg-slate-100'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-1">
                        <span className="text-xs font-semibold text-blue-600">#{index + 1}</span>
                        <div className="flex gap-1">
                          {hasPending && (
                            <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">
                              Pending
                            </span>
                          )}
                          {subModule.section_type && (
                            <span className="text-xs text-slate-500 bg-white px-2 py-0.5 rounded">
                              {subModule.section_type}
                            </span>
                          )}
                        </div>
                      </div>
                      <p className="text-sm font-medium text-slate-700 leading-tight line-clamp-2">
                        {subModule.title}
                      </p>
                      <p className="text-xs text-slate-500 mt-1">
                        {subModule.content.length} characters
                      </p>
                    </div>
                  );
                })
              )}
            </div>
          </Card>
        </div>

        {/* Center Panel - Content View/Edit/Diff */}
        <div className="col-span-9 flex flex-col">
          <Card className="flex-1 bg-white border-slate-200 overflow-hidden flex flex-col">
            {/* Tabs */}
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div className="flex gap-2">
                <button
                  onClick={() => { setActiveView('edit'); setIsEditing(true); }}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    activeView === 'edit' ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <Edit3 size={16} />
                  Edit Content
                </button>

                <button
                  onClick={() => setActiveView('diff')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    activeView === 'diff' ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <GitCompare size={16} />
                  Compare Changes
                  {currentPending && (
                    <span className="ml-1 w-2 h-2 bg-amber-500 rounded-full"></span>
                  )}
                </button>

                <button
                  onClick={() => setActiveView('final')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    activeView === 'final' ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <Eye size={16} />
                  Live Preview
                </button>
              </div>

              <div className="flex items-center gap-2">
                {hasUnsavedChanges && (
                  <span className="text-xs text-orange-600 font-medium">● Unsaved changes</span>
                )}
                {/* Admin save + request approval buttons */}
                {isUploader && hasUnsavedChanges && (
                  <Button size="sm" variant="outline" onClick={handleSaveChanges} className="border-slate-300">
                    Save Draft
                  </Button>
                )}
                {/* Reviewer save edits button */}
                {isReviewer && hasUnsavedChanges && activeView === 'edit' && (
                  <Button size="sm" onClick={handleReviewerSave} disabled={submitting} className="bg-blue-600 hover:bg-blue-700">
                    {submitting ? 'Saving...' : 'Save Edits'}
                  </Button>
                )}
              </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto p-6">
              {!selectedSubModule ? (
                <div className="flex items-center justify-center h-full text-slate-400">
                  <div className="text-center">
                    <FileText size={48} className="mx-auto mb-3 opacity-50" />
                    <p>Select a sub-module to view content</p>
                  </div>
                </div>
              ) : (
                <>
                  {/* ========== EDIT TAB ========== */}
                  {activeView === 'edit' && (
                    <div>
                      <div className="mb-4 pb-3 border-b border-slate-200">
                        <label className="text-sm font-semibold text-slate-700 block mb-1">
                          Editing: {selectedSubModule.title}
                        </label>
                        {isUploader && (
                          <p className="text-xs text-slate-500">
                            Make your changes below. Click "Save Draft" to hold changes, then "Request Approval" to submit for review.
                          </p>
                        )}
                        {isReviewer && (
                          <p className="text-xs text-slate-500">
                            You can make edits to the content. Click "Save Edits" to update, then "Final Approval" to push live.
                          </p>
                        )}

                        <input
                          ref={imageUploadInputRef}
                          type="file"
                          accept="image/*,.png,.jpg,.jpeg,.gif,.webp,.bmp,.svg"
                          className="hidden"
                          onChange={handleImageUpload}
                        />
                        <input
                          ref={videoUploadInputRef}
                          type="file"
                          accept="video/*,.mp4,.mov,.webm,.m4v,.avi"
                          className="hidden"
                          onChange={handleVideoUpload}
                        />
                        <input
                          ref={audioUploadInputRef}
                          type="file"
                          accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac"
                          className="hidden"
                          onChange={handleAudioUpload}
                        />
                      </div>
                      <div
                        ref={contentEditableRef}
                        contentEditable={true}
                        onMouseUp={saveCurrentSelection}
                        onKeyUp={saveCurrentSelection}
                        onInput={handleContentEditableChange}
                        onBlur={handleContentEditableChange}
                        suppressContentEditableWarning={true}
                        className="prose prose-sm max-w-none min-h-[500px] p-6 border-2 border-blue-200 rounded-lg focus:outline-none focus:border-blue-400 bg-white
                          prose-headings:font-bold prose-headings:text-[#1E293B]
                          prose-h1:text-3xl prose-h1:mb-6 prose-h1:mt-8
                          prose-h2:text-2xl prose-h2:mb-4 prose-h2:mt-6 prose-h2:pb-2 prose-h2:border-b prose-h2:border-slate-200
                          prose-h3:text-xl prose-h3:mb-3 prose-h3:mt-4
                          prose-h4:text-lg prose-h4:mb-2 prose-h4:mt-3
                          prose-p:text-slate-700 prose-p:leading-relaxed prose-p:mb-4
                          prose-strong:text-slate-900 prose-strong:font-semibold
                          prose-ul:list-disc prose-ul:ml-6 prose-ul:mb-4
                          prose-ol:list-decimal prose-ol:ml-6 prose-ol:mb-4
                          prose-li:text-slate-700 prose-li:mb-2
                          prose-blockquote:border-l-4 prose-blockquote:border-blue-500 prose-blockquote:pl-4 prose-blockquote:italic prose-blockquote:bg-blue-50 prose-blockquote:py-2 prose-blockquote:my-4
                          prose-table:w-full prose-table:border-collapse prose-table:my-6
                          prose-thead:bg-slate-100
                          prose-th:border prose-th:border-slate-300 prose-th:px-4 prose-th:py-3 prose-th:text-left prose-th:font-semibold prose-th:text-slate-900
                          prose-td:border prose-td:border-slate-200 prose-td:px-4 prose-td:py-3 prose-td:text-slate-700
                          prose-img:rounded-lg prose-img:shadow-md prose-img:my-6"
                      />
                      <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <p className="text-xs text-blue-800">
                          <strong>💡 Editing Tips:</strong> Click anywhere to start editing. Use Ctrl+B for bold and Ctrl+I for italic. Use the embed buttons to insert image, video, and audio blocks between text sections. Uploaded image, video, and audio files are saved to storage and inserted as public bucket links.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* ========== DIFF / COMPARE TAB ========== */}
                  {activeView === 'diff' && (
                    <div>
                      <div className="mb-6 pb-4 border-b border-slate-200">
                        <h2 className="text-lg font-bold text-[#1E293B] mb-1">Compare Changes: {selectedSubModule.title}</h2>
                        <p className="text-xs text-slate-500">
                          Side-by-side comparison of the current live content and the proposed changes.
                        </p>
                      </div>

                      {currentPending ? (
                        <div className="grid grid-cols-2 gap-6">
                          {/* Left: Current Live */}
                          <div>
                            <div className="flex items-center gap-2 mb-3">
                              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                                <Eye size={12} className="mr-1" />
                                Current Live Content
                              </span>
                            </div>
                            <div className="border border-slate-200 rounded-lg p-4 bg-slate-50 max-h-[600px] overflow-y-auto">
                              <ContentRenderer htmlContent={selectedSubModule.content} />
                            </div>
                          </div>

                          {/* Right: Proposed Changes */}
                          <div>
                            <div className="flex items-center gap-2 mb-3">
                              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 border border-amber-200">
                                <Edit3 size={12} className="mr-1" />
                                Proposed Changes (In Review)
                              </span>
                              <span className="text-xs text-slate-400">
                                {new Date(currentPending.created_at).toLocaleString()}
                              </span>
                            </div>
                            <div className="border-2 border-amber-300 rounded-lg p-4 bg-amber-50/30 max-h-[600px] overflow-y-auto">
                              <ContentRenderer htmlContent={currentPending.content} />
                            </div>
                          </div>

                          {/* Right: Proposed Changes */}
                          <div>
                            <div className="flex items-center gap-2 mb-3">
                              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 border border-amber-200">
                                <Edit3 size={12} className="mr-1" />
                                Proposed Changes (In Review)
                              </span>
                              <span className="text-xs text-slate-400">
                                {new Date(currentPending.created_at).toLocaleString()}
                              </span>
                            </div>
                            <div className="border-2 border-amber-300 rounded-lg p-4 bg-amber-50/30 max-h-[600px] overflow-y-auto">
                              <ContentRenderer htmlContent={currentPending.content} />
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                          <GitCompare size={48} className="mb-4 opacity-50" />
                          <p className="font-medium text-slate-600 mb-1">No pending changes to compare</p>
                          <p className="text-sm">
                            {isUploader
                              ? 'Edit the content and click "Request Approval" to create a review request.'
                              : 'No review requests have been submitted for this sub-module yet.'
                            }
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ========== LIVE PREVIEW TAB ========== */}
                  {activeView === 'final' && (
                    <div>
                      <div className="mb-6 pb-4 border-b border-slate-200">
                        <div className="flex items-center gap-3 mb-2">
                          <h2 className="text-2xl font-bold text-[#1E293B]">{selectedSubModule.title}</h2>
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-green-50 text-green-700 border border-green-200">
                            Live
                          </span>
                        </div>
                        {selectedSubModule.section_type && (
                          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">
                            {selectedSubModule.section_type}
                          </span>
                        )}
                        <p className="text-xs text-slate-500 mt-2">
                          This is the content currently visible to employees.
                        </p>
                      </div>
                      <ContentRenderer htmlContent={selectedSubModule.content} />
                    </div>
                  )}
                </>
              )}
            </div>
          </Card>
        </div>
      </div>

      {activeView === 'edit' && selectedSubModule && (
        <aside className="fixed bottom-28 right-4 z-40 lg:bottom-auto lg:top-1/2 lg:-translate-y-1/2">
          <Card className="w-[240px] border-slate-200 bg-white/95 backdrop-blur shadow-xl">
            <div className="p-3 border-b border-slate-200">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Media Tools</p>
              <p className="text-sm font-semibold text-slate-800 mt-1">Insert Module Media</p>
            </div>
            <div className="p-3 space-y-2">
              <div className="space-y-1.5">
                <button
                  type="button"
                  onMouseDown={handleToolbarMouseDown}
                  onClick={() => setActiveMediaMenu(activeMediaMenu === 'video' ? null : 'video')}
                  className="w-full flex items-center justify-between rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <span className="inline-flex items-center gap-2">
                    <Video size={14} />
                    Video
                  </span>
                  <span className="text-xs text-slate-500">Choose</span>
                </button>
                {activeMediaMenu === 'video' && (
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onMouseDown={handleToolbarMouseDown}
                      onClick={() => handleMediaSourceClick('video', 'local')}
                      disabled={isUploadingVideo}
                      className="rounded-md border border-slate-300 px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    >
                      {isUploadingVideo ? 'Uploading...' : 'Local'}
                    </button>
                    <button
                      type="button"
                      onMouseDown={handleToolbarMouseDown}
                      onClick={() => handleMediaSourceClick('video', 'link')}
                      className="inline-flex items-center justify-center gap-1 rounded-md border border-slate-300 px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <Link2 size={12} />
                      Link
                    </button>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <button
                  type="button"
                  onMouseDown={handleToolbarMouseDown}
                  onClick={() => setActiveMediaMenu(activeMediaMenu === 'audio' ? null : 'audio')}
                  className="w-full flex items-center justify-between rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <span className="inline-flex items-center gap-2">
                    <Music2 size={14} />
                    Audio
                  </span>
                  <span className="text-xs text-slate-500">Choose</span>
                </button>
                {activeMediaMenu === 'audio' && (
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onMouseDown={handleToolbarMouseDown}
                      onClick={() => handleMediaSourceClick('audio', 'local')}
                      disabled={isUploadingAudio}
                      className="rounded-md border border-slate-300 px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    >
                      {isUploadingAudio ? 'Uploading...' : 'Local'}
                    </button>
                    <button
                      type="button"
                      onMouseDown={handleToolbarMouseDown}
                      onClick={() => handleMediaSourceClick('audio', 'link')}
                      className="inline-flex items-center justify-center gap-1 rounded-md border border-slate-300 px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <Link2 size={12} />
                      Link
                    </button>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <button
                  type="button"
                  onMouseDown={handleToolbarMouseDown}
                  onClick={() => setActiveMediaMenu(activeMediaMenu === 'image' ? null : 'image')}
                  className="w-full flex items-center justify-between rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <span className="inline-flex items-center gap-2">
                    <ImageIcon size={14} />
                    Image
                  </span>
                  <span className="text-xs text-slate-500">Choose</span>
                </button>
                {activeMediaMenu === 'image' && (
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onMouseDown={handleToolbarMouseDown}
                      onClick={() => handleMediaSourceClick('image', 'local')}
                      disabled={isUploadingImage}
                      className="rounded-md border border-slate-300 px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    >
                      {isUploadingImage ? 'Uploading...' : 'Local'}
                    </button>
                    <button
                      type="button"
                      onMouseDown={handleToolbarMouseDown}
                      onClick={() => handleMediaSourceClick('image', 'link')}
                      className="inline-flex items-center justify-center gap-1 rounded-md border border-slate-300 px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <Link2 size={12} />
                      Link
                    </button>
                  </div>
                )}
              </div>
            </div>
          </Card>
        </aside>
      )}

      {/* Footer Actions */}
      <footer className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-8 py-4 z-50">
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            onClick={handleRegenerate}
            className="text-slate-600 border-slate-300"
          >
            <RotateCcw size={16} className="mr-2" />
            Regenerate
          </Button>

          <div className="flex items-center gap-3">
            {/* ADMIN: Request Approval button */}
            {isUploader && (
              <Button
                onClick={handleRequestApproval}
                disabled={submitting || hasPendingReview}
                className="bg-purple-600 hover:bg-purple-700 text-white disabled:bg-purple-300"
              >
                <Upload size={16} className="mr-2" />
                {submitting ? 'Submitting...' : hasPendingReview ? 'Approval Pending' : 'Request Approval'}
              </Button>
            )}

            {/* REVIEWER: Reject button */}
            {isReviewer && hasPendingReview && (
              <Button
                variant="outline"
                onClick={handleReject}
                disabled={submitting}
                className="text-red-600 border-red-200 hover:bg-red-50"
              >
                <XCircle size={16} className="mr-2" />
                Reject Changes
              </Button>
            )}

            {/* REVIEWER: Final Approval button */}
            {isReviewer && hasPendingReview && (
              <Button
                onClick={handleFinalApproval}
                disabled={submitting}
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                <CheckCircle size={16} className="mr-2" />
                {submitting ? 'Approving...' : 'Final Approval'}
              </Button>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}