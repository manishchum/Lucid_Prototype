"use client"

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/auth-context";
import { supabase } from "@/lib/supabase";
import { Upload, FileText, BarChart3, Plus, Trash2, Eye, Download } from "lucide-react";
import { formatContentType } from '@/lib/contentType';

interface Admin {
  user_id: string
  email: string
  name: string | null
  company_id: string
}

const API_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

type KPIUploadResult = {
  created?: number;
  updated?: number;
  skipped?: { row: number; reason: string }[];
  affectedEmployees?: string[];
};

// Placeholder ContentUpload Component
function ContentUpload({
  companyId,
  adminId,
  onUploadComplete
}: {
  companyId: string;
  adminId: string;
  onUploadComplete: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<any>(null);
  const [thresholdValue, setThresholdValue] = useState<number>(70);
  const [reviewerEmail, setReviewerEmail] = useState('');
  const [retrievedReviewerId, setRetrievedReviewerId] = useState<string | null>(null);
  const [emailValidationMessage, setEmailValidationMessage] = useState<string>('');
  const [isValidatingEmail, setIsValidatingEmail] = useState(false);
  const [additionalLinks, setAdditionalLinks] = useState<Array<{ title: string; url: string }>>([]);
  const [linkTitle, setLinkTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');

  // Debounce timer for email validation
  useEffect(() => {
    if (!reviewerEmail.trim()) {
      setEmailValidationMessage('');
      setRetrievedReviewerId(null);
      return;
    }

    setIsValidatingEmail(true);
    const timer = setTimeout(async () => {
      await validateReviewerEmail(reviewerEmail.trim());
      setIsValidatingEmail(false);
    }, 500); // Wait 500ms after user stops typing

    return () => clearTimeout(timer);
  }, [reviewerEmail]);

  const validateReviewerEmail = async (email: string) => {
    try {
      const res = await fetch(`${API_URL}/api/users/by-email/${encodeURIComponent(email)}`);
      if (!res.ok) {
        setEmailValidationMessage('User with this email does not exist.');
        setRetrievedReviewerId(null);
        return;
      }
      const payload = await res.json();
      let user = payload?.user ?? payload;
      if (Array.isArray(user)) user = user[0];
      if (!user || !user.user_id || user.company_id !== companyId) {
        setEmailValidationMessage('User with this email does not exist.');
        setRetrievedReviewerId(null);
        return;
      }
      setEmailValidationMessage(`Reviewer found: ${user.name || user.email}`);
      setRetrievedReviewerId(user.user_id);
    } catch (error) {
      setEmailValidationMessage('Error validating email');
      setRetrievedReviewerId(null);
    }
  };

  const handleAddLink = () => {
    if (linkTitle.trim() && linkUrl.trim()) {
      setAdditionalLinks([...additionalLinks, { title: linkTitle.trim(), url: linkUrl.trim() }]);
      setLinkTitle('');
      setLinkUrl('');
    }
  };

  const handleRemoveLink = (index: number) => {
    setAdditionalLinks(additionalLinks.filter((_, i) => i !== index));
  };

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  
  const isMediaFile = (type: string) => type.includes('video/') || type.includes('audio/') || type.match(/\.(mp4|mp3|wav|mov|avi|m4a)$/i);

  const triggerAIProcessing = async (file: File, moduleId: string, fileUrl: string) => {
    try {
      console.log(`[AI] Starting processing for module: ${moduleId}`);

      // Update status to transcribing/summarizing immediately
      const initialStatus = isMediaFile(file.type) ? 'transcribing' : 'summarizing';
      await supabase.from('training_modules').update({ processing_status: initialStatus }).eq('module_id', moduleId);
      onUploadComplete(); // Refresh UI to show status change

      if (isMediaFile(file.type)) {
        // Step 1: Extract/Transcribe
        const extractRes = await fetch('/api/extract-and-analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileUrl, fileType: file.type, moduleId })
        });

        if (!extractRes.ok) throw new Error('Transcription failed');
        const { extractedText } = await extractRes.json();

        // Step 2: Process text with GPT - Now calling backend API
        const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';
        await fetch(`${backendUrl}/api/openai-upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: extractedText, moduleId })
        });
      } else {
        // Direct file upload for documents/spreadsheets
        const formData = new FormData();
        formData.append('file', file);
        formData.append('moduleId', moduleId);

        const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';
        await fetch(`${backendUrl}/api/openai-upload`, {
          method: 'POST',
          body: formData
        });
      }

      console.log(`[AI] Processing triggered successfully for module: ${moduleId}`);
      onUploadComplete(); // Final refresh
    } catch (err) {
      console.error('[AI] Pipeline failed:', err);
      await supabase.from('training_modules').update({ processing_status: 'failed' }).eq('module_id', moduleId);
      onUploadComplete();
    }
  };

  const handleUpload = async () => {
    if (!file || !title) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('title', title);
      formData.append('description', description);

      const response = await fetch('/api/content-library/upload', {
        method: 'POST',
        headers: {
          'x-company-id': companyId,
          'x-admin-id': adminId
        },
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Upload failed');
      }

      const result = await response.json();
      console.log('Upload successful:', result);

      const uploadedFile = (result.inserted?.[0]?.module).replace("/object/sign","/object/public");
      console.log(uploadedFile)
      if (uploadedFile) {
        const { data: moduleData, error: tmError } = await supabase
          .from('training_modules')
          .insert({
            company_id: companyId,
            title: title,
            description: description,
            content_url: uploadedFile,
            content_type: file.type,
            processing_status: 'pending',
            uploaded_by:adminId,
            threshold_value:thresholdValue,
            reviewer_id:retrievedReviewerId,
            additional_readings: additionalLinks.length > 0 ? additionalLinks : null
          })
          .select()
          .single();

        if (tmError) {
          console.error('Failed to create training module entry:', tmError);
        } else if (moduleData) {
          // Trigger AI background processing
          triggerAIProcessing(file, moduleData.module_id, uploadedFile.module);
        }
      }

      setFile(null);
      setTitle('');
      setDescription('');
      setAdditionalLinks([]);
      setLinkTitle('');
      setLinkUrl('');
      onUploadComplete();
      alert('Content uploaded! AI analysis is running in the background.');
    } catch (error: any) {
      console.error('Upload failed:', error);
      alert(`Upload failed: ${error.message}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="title">Title *</Label>
        <Input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Enter training module title"
        />
      </div>

      <div>
        <Label htmlFor="description">Description</Label>
        <Input
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Enter description"
        />
      </div>

      {/* Threshold Value Input */}
      <div>
        <Label htmlFor="threshold">Threshold Value (%)</Label>
        <Input
          id="threshold"
          type="number"
          min="0"
          max="100"
          value={thresholdValue}
          onChange={(e) => setThresholdValue(parseInt(e.target.value) || 70)}
          placeholder="Enter threshold value (default: 70)"
          className="border-slate-200 focus:border-[#3B66F5] focus:ring-[#3B66F5]"
        />
        <p className="mt-1 text-xs text-slate-500">
          Set the minimum passing score percentage (0-100). Default is 70%.
        </p>
      </div>

      {/* Reviewer Email Input */}
      <div>
        <Label htmlFor="reviewerEmail">Reviewer Email (Optional)</Label>
        <div className="relative">
          <Input
            id="reviewerEmail"
            type="email"
            value={reviewerEmail}
            onChange={(e) => setReviewerEmail(e.target.value)}
            placeholder="Enter reviewer's email address"
            className={`border-slate-200 focus:border-[#3B66F5] focus:ring-[#3B66F5] ${
              emailValidationMessage.includes('❌') ? 'border-red-300 focus:border-red-500' : 
              emailValidationMessage.includes('✅') ? 'border-green-300 focus:border-green-500' : ''
            }`}
          />
          {isValidatingEmail && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            </div>
          )}
        </div>
        {emailValidationMessage && (
          <p className={`mt-1 text-xs font-medium ${
            emailValidationMessage.includes('❌') ? 'text-red-600' : 'text-green-600'
          }`}>
            {emailValidationMessage}
          </p>
        )}
        <p className="mt-1 text-xs text-slate-500">
          Assign a reviewer who will approve this content before it goes live.
        </p>
      </div>

      {/* Additional Links Input */}
      <div>
        <Label>Additional Reference Links</Label>
        <div className="space-y-2">
          {additionalLinks.map((link, index) => (
            <div key={index} className="flex items-center space-x-2">
              <span className="flex-1 truncate">{link.title} - {link.url}</span>
              <Button variant="outline" size="sm" onClick={() => handleRemoveLink(index)}>
                Remove
              </Button>
            </div>
          ))}
        </div>
        <div className="flex space-x-2 mt-2">
          <Input
            placeholder="Link Title"
            value={linkTitle}
            onChange={(e) => setLinkTitle(e.target.value)}
          />
          <Input
            placeholder="Link URL"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
          />
          <Button onClick={handleAddLink}>Add</Button>
        </div>
      </div>

      <div>
        <Label htmlFor="file">Upload File</Label>
        <Input
          id="file"
          type="file"
          accept=".pdf,.mp4,.docx,.pptx"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
      </div>

      <Button onClick={handleUpload} disabled={!file || !title || uploading}>
        {uploading ? 'Uploading...' : 'Upload Content'}
      </Button>
    </div>
  );
}

// Placeholder UploadedFilesList Component
function UploadedFilesList({ companyId }: { companyId: string }) {
  const [files, setFiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchFiles = async () => {
      try {
        const { data, error } = await supabase
          .storage
          .from('content library')
          .list('uploads/', {
            limit: 100,
            offset: 0,
            sortBy: { column: 'created_at', order: 'desc' },
          });

        if (error) throw error;
        setFiles(data || []);
      } catch (error) {
        console.error('Error fetching files:', error);
      } finally {
        setLoading(false);
      }
    };

    if (companyId) {
      fetchFiles();
    }
  }, [companyId]);

  if (loading) {
    return <div className="text-gray-500 italic">Loading files...</div>;
  }

  return (
    <div>
      <h3 className="text-lg font-semibold mb-4">Uploaded Files in Storage</h3>
      {files.length === 0 ? (
        <p className="text-gray-400 italic">No storage files found</p>
      ) : (
        <div className="grid gap-2">
          {files.map((file, idx) => (
            <div key={idx} className="flex justify-between items-center p-2 bg-gray-50 rounded border text-sm">
              <span className="truncate flex-1 mr-4">{file.name}</span>
              <span className="text-gray-400 text-xs">{(file.metadata?.size / 1024 / 1024).toFixed(2)} MB</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// KPI Scores Upload Component
function KPIScoresUpload({ companyId, admin }: { companyId?: string; admin?: Admin | null }) {
  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [preview, setPreview] = useState<string[][]>([]);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ created?: number; updated?: number; skipped?: { row: number; reason: string }[]; affectedEmployees?: string[] } | null>(null);
  const [error, setError] = useState("");

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setResult(null);
    setError("");
    const f = e.target.files?.[0] || null;
    setFile(f);
    if (!f) return setPreview([]);
    try {
      const arrayBuffer = await f.arrayBuffer();
      if (f.name.endsWith(".csv")) {
        const text = new TextDecoder().decode(arrayBuffer);
        const rows = text.split(/\r?\n/).map(line => line.split(",").map(cell => cell.trim()));
        setPreview(rows.slice(0, 10));
      } else if (f.name.endsWith(".xlsx")) {
        const xlsx = await import("xlsx");
        const workbook = xlsx.read(arrayBuffer, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });
        setPreview((rows as string[][]).slice(0, 10));
      } else {
        setError("Unsupported file type. Only CSV or XLSX allowed.");
        setPreview([]);
      }
    } catch (err) {
      setError("Failed to parse file for preview.");
      setPreview([]);
    }
  };

  const handleUpload = async () => {
    if (!file || !companyId) return;
    setUploading(true);
    setResult(null);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/admin/kpi/upload-scores", {
        method: "POST",
        body: formData,
        headers: {
          "x-company-id": companyId,
          ...(admin?.user_id ? { "x-admin-id": admin.user_id } : {})
        },
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Upload failed");
      } else {
        setResult(json);
        setFile(null);
        setPreview([]);
        setFileInputKey(prev => prev + 1);
      }
    } catch (err) {
      setError("Upload failed.");
      setFile(null);
      setPreview([]);
      setFileInputKey(prev => prev + 1);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center mb-2">
        <Input key={fileInputKey} type="file" accept=".csv,.xlsx" onChange={handleFileChange} />
        <Button onClick={handleUpload} disabled={!file || uploading}>
          {uploading ? "Uploading..." : "Upload"}
        </Button>
      </div>

      <div className="text-xs text-gray-500">
        Expected format: employee_id, kpi_name, score, period, notes
      </div>

      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

      {preview.length > 0 && (
        <div className="mb-2">
          <div className="font-semibold mb-1">Preview (first 10 rows):</div>
          <div className="border rounded max-h-40 overflow-auto">
            <table className="text-sm border-collapse w-full">
              <tbody>
                {preview.map((row, i) => (
                  <tr key={i} className={i === 0 ? "bg-gray-50" : ""}>
                    {row.map((cell, j) => (
                      <td key={j} className="border px-2 py-1 text-xs">{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {result && (
        <div className="mt-2 p-3 bg-green-50 border border-green-200 rounded">
          <div className="font-semibold text-green-800">Upload Result:</div>
          <div className="text-sm text-green-700">
            Created: {result.created || 0}, Updated: {result.updated || 0}
          </div>
          {result.skipped && result.skipped.length > 0 && (
            <div className="mt-1 text-xs text-gray-600">
              Skipped {result.skipped.length} rows due to errors
            </div>
          )}
          {result.affectedEmployees && (
            <div className="mt-1 text-xs text-gray-600">
              Affected {result.affectedEmployees.length} employees
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Training Content Management Component
function TrainingContentManagement({ companyId, adminId }: { companyId: string; adminId: string }) {
  const [trainingModules, setTrainingModules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (companyId) {
      loadTrainingModules();
    }
  }, [companyId]);

  const loadTrainingModules = async () => {
    try {
      const { data, error } = await supabase
        .from('training_modules')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // For each module, check content_jobs status
      const modulesWithStatus = await Promise.all(
        (data || []).map(async (module) => {
          // Check if module exists in content_jobs
          const { data: jobData, error: jobError } = await supabase
            .from('content_jobs')
            .select('status')
            .eq('module_id', module.module_id)
            .single();

          let finalStatus = module.processing_status;

          if (jobError || !jobData) {
            // Module not in content_jobs yet - keep as "processing"
            if (finalStatus?.toLowerCase() !== 'processing') {
              finalStatus = 'processing';
            }
          } else {
            // Module exists in content_jobs
            if (jobData.status === 'completed') {
              finalStatus = 'completed';
            } else if (jobData.status === 'failed') {
              finalStatus = 'failed';
            } else {
              // Job exists but not completed - set to "pending"
              finalStatus = 'pending';
            }
          }

          // Update module status in database if it changed
          if (finalStatus !== module.processing_status) {
            await supabase
              .from('training_modules')
              .update({ processing_status: finalStatus })
              .eq('module_id', module.module_id);
          }

          return {
            ...module,
            processing_status: finalStatus
          };
        })
      );

      setTrainingModules(modulesWithStatus);
    } catch (error: any) {
      console.error('Failed to load training modules:', error);
      setError('Failed to load training modules');
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'completed':
        return <Badge className="bg-green-100 text-green-800">Ready</Badge>;
      case 'pending':
        return <Badge className="bg-orange-100 text-orange-800">Pending</Badge>;
      case 'transcribing':
      case 'summarizing':
      case 'processing':
        return <Badge className="bg-blue-100 text-blue-800 animate-pulse">Processing</Badge>;
      case 'failed':
        return <Badge className="bg-red-100 text-red-800">Failed</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const getReviewStageColor = (stage?: string) => {
    switch (stage) {
      case 'approved': return 'bg-green-100 text-green-700 border-green-200';
      case 'in_review': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'rejected': return 'bg-red-100 text-red-700 border-red-200';
      case 'pending': return 'bg-yellow-100 text-yellow-700 border-yellow-200';
      default: return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  const getReviewStageLabel = (stage?: string) => {
    switch (stage) {
      case 'approved': return 'Approved';
      case 'in_review': return 'In Review';
      case 'rejected': return 'Rejected';
      case 'pending': return 'Pending Review';
      default: return 'Unknown';
    }
  };

  const handleViewModule = async (module: any) => {
    try {
      if (module.content_url) {
        // Extract the storage path from the content_url
        // The URL format is like: https://...storage.../training-content/file-path?token=...
        // We need to extract the file path and create a fresh signed URL

        const url = new URL(module.content_url);
        const pathSegments = url.pathname.split('/');

        // Find the index where 'training-content' is and get everything after it
        const trainingContentIndex = pathSegments.indexOf('training-content');
        if (trainingContentIndex === -1) {
          // If we can't extract the path, try opening the stored URL directly
          window.open(module.content_url, '_blank');
          return;
        }

        const storagePath = pathSegments.slice(trainingContentIndex + 1).join('/');

        // Generate a fresh signed URL with longer expiry (24 hours)
        const { data, error } = await supabase
          .storage
          .from('training-content')
          .createSignedUrl(storagePath, 24 * 60 * 60); // 24 hours expiry

        if (error) {
          // If signed URL generation fails (for example due to an expired/invalid JWT),
          // fallback to opening the stored content_url directly so the admin can still
          // access the file while we investigate auth/token issues.
          console.warn('Failed to generate signed URL:', error);

          try {
            // Try opening the original URL as a best-effort fallback.
            window.open(module.content_url, '_blank');
            return;
          } catch (openErr) {
            console.error('Failed to open fallback content URL:', openErr);
            setError('Failed to open training module');
            return;
          }
        }

        // Open the fresh signed URL in a new tab
        window.open(data.signedUrl, '_blank');
      } else {
        console.error('No content URL found for module');
        setError('Training module file not found');
      }
    } catch (error: any) {
      console.error('Failed to view module:', error);
      setError('Failed to open training module');
    }
  };

  const handleDeleteModule = async (moduleId: string) => {
    if (!confirm("Are you sure you want to delete this training module?")) return;

    try {
      const { error } = await supabase
        .from('training_modules')
        .delete()
        .eq('module_id', moduleId);

      if (error) throw error;

      // Reload modules
      loadTrainingModules();
    } catch (error: any) {
      console.error('Failed to delete module:', error);
      setError('Failed to delete training module');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-2 text-gray-600">Loading training modules...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Content Upload Section */}
      <div className="border-b pb-4">
        <h3 className="text-lg font-semibold mb-2">Upload New Training Content</h3>
        <ContentUpload
          companyId={companyId}
          adminId={adminId}
          onUploadComplete={loadTrainingModules}
        />
      </div>

      {/* Training Modules List */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Training Modules ({trainingModules.length})</h3>

        {trainingModules.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <Upload className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>No training modules found</p>
            <p className="text-sm">Upload your first training content to get started</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {trainingModules.map((module) => (
              <Card key={module.module_id}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h4 className="font-medium text-gray-900">{module.title}</h4>
                        {getStatusBadge(module.processing_status)}
                        <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border ${getReviewStageColor(module.review_stage)}`}>
                          {getReviewStageLabel(module.review_stage)}
                        </span>
                      </div>

                      {module.description && (
                        <p className="text-sm text-gray-600 mb-2">{module.description}</p>
                      )}

                      <div className="flex items-center gap-4 text-xs text-gray-500">
                        <span>Type: {formatContentType(module.content_type)}</span>
                        <span>Created: {new Date(module.created_at).toLocaleDateString()}</span>
                        {module.ai_modules && (
                          <span>AI Processed: Yes</span>
                        )}
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleViewModule(module)}
                      >
                        <Eye className="w-4 h-4 mr-1" />
                        View
                      </Button>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDeleteModule(module.module_id)}
                        className="text-red-600 hover:text-red-800"
                      >
                        <Trash2 className="w-4 h-4 mr-1" />
                        Delete
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function UploadsPage() {
  const { user } = useAuth();
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user?.email) {
      checkAdminAccess();
    }
  }, [user]);

  const checkAdminAccess = async () => {
    if (!user?.email) return;

    try {
      // Get user data from users table via backend API
      const userRes = await fetch(`${API_URL}/api/users/by-email/${encodeURIComponent(user.email)}`);

      if (!userRes.ok) {
        console.error("User not found or inactive");
        return;
      }

      const responseData = await userRes.json();
      
      // Handle both wrapped and unwrapped responses
      const userData = responseData.user || responseData;
      
      // Validate response
      if (!userData || !userData.user_id) {
        console.error("Invalid user data returned from backend:", responseData);
        return;
      }

      // Check if user has admin role through user_role_assignments
      const { data: roleData, error: roleError } = await supabase
        .from("user_role_assignments")
        .select(`
          role_id,
          roles!inner(name)
        `)
        .eq("user_id", userData.user_id)
        .eq("is_active", true)
        .eq("scope_type", "COMPANY")

      if (roleError || !roleData || roleData.length === 0) {
        console.error("No active roles found for user:", roleError);
        return;
      }

      // Check if user has Admin role
      const hasAdminRole = roleData.some((assignment: any) =>
        assignment.roles?.name?.toLowerCase() === 'admin' ||
        assignment.roles?.name?.toLowerCase() === 'super_admin'
      );

      if (!hasAdminRole) {
        console.error("User does not have admin role");
        return;
      }

      // Set admin data using user data
      const adminData: Admin = {
        user_id: userData.user_id,
        email: userData.email,
        name: userData.name,
        company_id: userData.company_id
      };

      setAdmin(adminData);
    } catch (error) {
      console.error("Admin access check failed:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-2 text-gray-600">Loading...</span>
      </div>
    );
  }

  if (!admin) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600">Access denied. Admin privileges required.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200 pb-4">
        <h1 className="text-2xl font-bold text-gray-900">Content Uploads</h1>
        <p className="text-gray-600 mt-1">Upload training content for your organization</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Upload className="w-5 h-5 mr-2" />
            Training Content Management
          </CardTitle>
          <CardDescription>
            Upload and manage training materials for your organization
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TrainingContentManagement
            companyId={admin.company_id}
            adminId={admin.user_id}
          />
        </CardContent>
      </Card>
    </div>
  );
}