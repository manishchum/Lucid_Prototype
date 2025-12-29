"use client";

import { useEffect, useState } from "react";
import AudioPlayer from "./AudioPlayer";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import EmployeeNavigation from "@/components/employee-navigation";
import { ChevronLeft } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";

export default function ModuleContentPage({ params }: { params: { module_id: string } }) {
  const { user, loading: authLoading, logout } = useAuth()
  const moduleId = params.module_id;
  const [module, setModule] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [employee, setEmployee] = useState<any>(null);
  const [learningStyle, setLearningStyle] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const fetchModule = async () => {
      setLoading(true);
      console.log('[module] Fetching module with id:', moduleId);
      // Validate incoming module id
      if (!moduleId || moduleId === 'undefined' || moduleId === 'null') {
        console.error('[module] Invalid module id:', moduleId);
        setModule(null);
        setLoading(false);
        return;
      }
      let empObj = null;
      let style = null;
      try {
        const { data: userData } = await supabase.auth.getUser();
        const employeeEmail = userData?.user?.email || null;
        if (user?.email) {
          const { data: emp } = await supabase
            .from('users')
            .select('user_id')
            .eq('email', user?.email)
            .maybeSingle();
          if (emp?.user_id) {
            empObj = emp;
            setEmployee(emp);
            // Fetch learning style for employee
            const { data: styleData } = await supabase
              .from('employee_learning_style')
              .select('learning_style')
              .eq('user_id', emp.user_id)
              .maybeSingle();
            if (styleData?.learning_style) {
              style = styleData.learning_style;
              setLearningStyle(style);
            }
          }
        }
        console.log("User Data:", user);
        console.log(employeeEmail)
      } catch (e) {
        console.log('[module] employee fetch error', e);
      }
      // Fetch module info from processed_modules - try direct lookup first, then fallbacks
      const selectCols = "processed_module_id, title, content, audio_url, original_module_id, learning_style, user_id";
      
      let data: any = null;
      
      // First try: direct lookup by processed_module_id (this is what we pass from training plan)
      console.log('[module] Attempting direct fetch by processed_module_id:', moduleId);
      console.log(empObj);
      
      

        const { data: directData, error: directError } = await supabase
        .from('processed_modules')
        .select(selectCols)
        .eq('processed_module_id', moduleId)
        .eq('user_id',empObj?.user_id || '')
        .maybeSingle();

      if (directError) {
        console.error('[module] Error fetching by processed_module_id:', directError);
      }
      
      if (directData) {
        console.log('[module] Found module by processed_module_id:', directData.processed_module_id);
        data = directData;
      } else {
        // Fallback: try by original_module_id
        console.log('[module] No direct match, trying by original_module_id');
        const { data: origData, error: origError } = await supabase
          .from('processed_modules')
          .select(selectCols)
          .eq('original_module_id', moduleId)
          .eq('user_id',empObj?.user_id || '')
          .maybeSingle();
        
        if (origError) {
          console.error('[module] Error fetching by original_module_id:', origError);
        }
        
        if (origData) {
          console.log('[module] Found module by original_module_id:', origData.processed_module_id);
          data = origData;
        }
      }
      console.log('[module] Fetched module data:', data);
      if (data) {
        setModule(data as any);
        // Log view to module_progress using processed_module_id and module_id, and started_at
        try {
          if (empObj?.user_id) {
            console.log('[module] Logging progress for employee:', empObj.user_id, 'module:', data.processed_module_id);
            await fetch('/api/module-progress', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                user_id: empObj.user_id,
                processed_module_id: data.processed_module_id,
                module_id: data.original_module_id,
                viewed_at: new Date().toISOString(),
                started_at: new Date().toISOString(),
                audio_url: data.audio_url,
              }),
            });
          }
        } catch (e) {
          console.log('[module] progress log error', e);
        }
      } else {
        console.error('[module] No module data found for id:', moduleId);
        setModule(null);
      }
      setLoading(false);
    };
    if (moduleId) fetchModule();
  }, [moduleId]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading module content...</div>;
  }

  if (!module) {
    console.log("Inside the !module block");
    return <div className="min-h-screen flex items-center justify-center text-red-600">Module not found.</div>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-100">
      <EmployeeNavigation customBackPath="/employee/training-plan" showForward={false} />

      <div className="transition-all duration-300 ease-in-out px-12 py-8" style={{ marginLeft: 'var(--sidebar-width, 0px)' }}>
        <div className="w-full mx-auto">
          <div>
            <main className="w-full">
              <div className="bg-white rounded-lg shadow-sm border p-12 w-full min-h-screen">
                {/* Back button */}
                <div className="mb-6">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex items-center gap-2"
                    onClick={() => router.back()}
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Back
                  </Button>
                </div>
                {/* Title and audio area */}
                <div>
                  <h2 className="text-xl font-semibold">{module.title}</h2>
                  <div className="text-sm text-gray-500">Module Content</div>

                  <div className="mt-4 w-full">
                    {/* {module.audio_url ? (
                      <div>
                        <AudioPlayer
                          employeeId={employee?.user_id}
                          processedModuleId={module.processed_module_id}
                          moduleId={module.original_module_id}
                          audioUrl={module.audio_url}
                        />
                        <div className="mt-1 h-1 bg-gray-200 rounded-full" />
                      </div>
                    ) : (
                      <GenerateAudioButton moduleId={module.processed_module_id} onAudioGenerated={url => setModule((m: any) => ({ ...m, audio_url: url }))} />
                    )} */}
                  </div>
                </div>

                <div className="mt-6 grid grid-cols-1 gap-6">
                  {/* Question / prompt area */}
                  <div className="border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                    </div>

                    {/* <div>
                      <div className="text-xs text-gray-500 mb-2">Video</div>
                      {module.video_url ? (
                        <div>
                          <video controls className="w-full rounded shadow">
                            <source src={module.video_url} type="video/mp4" />
                            Your browser does not support the video tag.
                          </video>
                          <div className="text-sm text-gray-600 mt-2 break-all">
                          </div>
                        </div>
                      ) : (
                        <GenerateVideoButton moduleId={module.processed_module_id} onVideoGenerated={url => setModule((m: any) => ({ ...m, video_url: url }))} />
                      )}
                    </div> */}

                    <div className="mt-4 text-gray-700 leading-relaxed max-w-none" dangerouslySetInnerHTML={{ __html: formatContent(module.content || '') }} />
                  </div>

                  {/* Actions */}
                  {/* <div className="flex justify-end">
                    <button className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-lg shadow hover:bg-violet-700">Ask AI</button>
                  </div> */}
                </div>
              </div>
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}

// Helper to format content (markdown to HTML)
function formatContent(content: string) {
  // If content is JSON, pretty print
  try {
    const parsed = JSON.parse(content);
    if (typeof parsed === "object") {
      return `<pre class="bg-gray-100 p-4 rounded-lg overflow-x-auto"><code>${JSON.stringify(parsed, null, 2)}</code></pre>`;
    }
  } catch {}
  
  // Convert markdown-like formatting to HTML
  let formatted = content
    // Headers (### -> h3, ## -> h2, # -> h1)
    .replace(/^### (.*$)/gm, '<h3 class="text-lg font-semibold mt-6 mb-3 text-gray-800">$1</h3>')
    .replace(/^## (.*$)/gm, '<h2 class="text-xl font-bold mt-8 mb-4 text-gray-900">$1</h2>')
    .replace(/^# (.*$)/gm, '<h1 class="text-2xl font-bold mt-8 mb-6 text-gray-900">$1</h1>')
    
    // Bold text (**text** or __text__)
    .replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold text-gray-900">$1</strong>')
    .replace(/__(.*?)__/g, '<strong class="font-semibold text-gray-900">$1</strong>')
    
    // Italic text (*text* or _text_)
    .replace(/\*(.*?)\*/g, '<em class="italic text-gray-700">$1</em>')
    .replace(/_(.*?)_/g, '<em class="italic text-gray-700">$1</em>')
    
    // Code blocks (```code```)
    .replace(/```([\s\S]*?)```/g, '<pre class="bg-gray-100 p-4 rounded-lg my-4 overflow-x-auto"><code class="text-sm">$1</code></pre>')
    
    // Inline code (`code`)
    .replace(/`([^`]+)`/g, '<code class="bg-gray-100 px-2 py-1 rounded text-sm font-mono">$1</code>')
    
    // Unordered lists (- item or * item)
    .replace(/^[\*\-] (.*$)/gm, '<li class="ml-4 mb-2">$1</li>')
    
    // Numbered lists (1. item)
    .replace(/^\d+\. (.*$)/gm, '<li class="ml-4 mb-2 list-decimal">$1</li>')
    
    // Line breaks
    .replace(/\n\n/g, '</p><p class="mb-4">')
    .replace(/\n/g, '<br/>');
  
  // Wrap in paragraphs and handle lists
  formatted = '<p class="mb-4">' + formatted + '</p>';
  
  // Clean up list formatting
  formatted = formatted
    .replace(/<p class="mb-4">(<li class="ml-4 mb-2[^>]*>.*?<\/li>(?:\s*<br\/>\s*<li class="ml-4 mb-2[^>]*>.*?<\/li>)*)<\/p>/g, '<ul class="mb-4 space-y-1">$1</ul>')
    .replace(/<br\/>\s*(<li class="ml-4 mb-2[^>]*>)/g, '$1')
    .replace(/(<\/li>)\s*<br\/>/g, '$1');
  
  // Clean up empty paragraphs
  formatted = formatted.replace(/<p class="mb-4">\s*<\/p>/g, '');
  
  return formatted;
}

// Add GenerateAudioButton component
function GenerateAudioButton({ moduleId, onAudioGenerated }: { moduleId: string, onAudioGenerated: (url: string) => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tts?processed_module_id=${moduleId}`);
      const data = await res.json();
      if (res.ok && data.audioUrl) {
        onAudioGenerated(data.audioUrl);
      } else {
        setError(data.error || 'Failed to generate audio');
      }
    } catch (e: any) {
      setError(e?.message || 'Error generating audio');
    }
    setLoading(false);
  };

  return (
    <div className="flex flex-col items-center">
      <button
        className="bg-blue-600 text-white px-4 py-2 rounded shadow hover:bg-blue-700 disabled:opacity-50"
        onClick={handleGenerate}
        disabled={loading}
      >
        {loading ? 'Generating Audio...' : 'Generate Audio'}
      </button>
      {error && <div className="text-red-600 mt-2">{error}</div>}
    </div>
  );
}

// Add GenerateVideoButton component
function GenerateVideoButton({ moduleId, onVideoGenerated }: { moduleId: string, onVideoGenerated: (url: string) => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      // Use the new GPT-based video generation route. Previously we called `/api/video-generation` which
      // generated images/screenshots directly inside this page's flow. That approach is now deprecated here —
      // keep the old call commented below for reference.
      // const res = await fetch(`/api/video-generation?processed_module_id=${moduleId}`);

      const res = await fetch(`/api/gpt-video-generation?processed_module_id=${moduleId}`);
      const data = await res.json();
      if (res.ok && data.videoUrl) {
        onVideoGenerated(data.videoUrl);
      } else {
        setError(data.error || 'Failed to generate video');
      }
    } catch (e: any) {
      setError(e?.message || 'Error generating video');
    }
    setLoading(false);
  };

  return (
    <div className="flex flex-col items-center">
      <button
        className="bg-green-600 text-white px-4 py-2 rounded shadow hover:bg-green-700 disabled:opacity-50"
        onClick={handleGenerate}
        disabled={loading}
      >
        {loading ? 'Generating Video...' : 'Generate Video'}
      </button>
      {error && <div className="text-red-600 mt-2">{error}</div>}
    </div>
  );
}
