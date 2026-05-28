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
import { Upload, FileText, BarChart3, Plus, Trash2, Eye, Download, ExternalLink, X, Paperclip } from "lucide-react";
import { formatContentType } from '@/lib/contentType';
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { fetchWithAuth } from "@/lib/fetch-with-auth";

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
  onUploadComplete,
  onFilesUploaded,
}: {
  companyId: string;
  adminId: string;
  onUploadComplete: () => void;
  onFilesUploaded?: (moduleId: string, fileNames: string[]) => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
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
      const res = await fetchWithAuth(`${API_URL}/api/users/by-email/${encodeURIComponent(email)}`);
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


  const triggerAIProcessing = async (moduleId: string, uploadFiles: File[], contentUrl?: string) => {
    if (!moduleId || moduleId === "undefined") {
      console.error("[AI] Invalid moduleId:", moduleId);
      alert("Cannot process Sprint: Invalid Sprint ID");
      return;
    }

    if (!uploadFiles || uploadFiles.length === 0) {
      console.error("[AI] No files passed to triggerAIProcessing");
      alert("Cannot process Sprint: No files selected");
      return;
    }

    try {
      // console.log(`[AI] Starting processing for Sprint: ${moduleId}`);

      const firstFile = uploadFiles[0];
      const initialStatus = isMediaFile(firstFile?.type || "") ? "transcribing" : "summarizing";

      const statusRes = await fetchWithAuth(
        `${API_URL}/api/training-modules/${encodeURIComponent(moduleId)}/processing-status`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "X-User-ID": adminId,
          },
          body: JSON.stringify({ processing_status: initialStatus }),
        }
      );

      if (!statusRes.ok) {
        const errorText = await statusRes.text().catch(() => "");
        console.error("Failed to update processing status:", errorText);
      }

      onUploadComplete();

      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

      // MEDIA: only if you enable media uploads later
      if (isMediaFile(firstFile?.type || "")) {
        if (!contentUrl) {
          throw new Error("Missing contentUrl for media extraction");
        }

        const extractRes = await fetchWithAuth("/api/extract-and-analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileUrl: contentUrl, fileType: firstFile?.type, moduleId }),
        });

        if (!extractRes.ok) throw new Error("Transcription failed");
        const { extractedText } = await extractRes.json();

        await fetchWithAuth(`${backendUrl}/api/openai-upload/text`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: extractedText, moduleId }),
        });

      } else {
        // DOC/PDF: send actual File objects
        const formData = new FormData();
        uploadFiles.forEach((f) => formData.append("files", f));
        if (!moduleId || moduleId === "undefined") {
          throw new Error("Invalid moduleId passed to AI processing");
        }
        formData.append("moduleId", String(moduleId));

        const aiRes = await fetchWithAuth(`${backendUrl}/api/openai-upload/file`, {
          method: "POST",
          body: formData,
        });

        // IMPORTANT: surface backend error text instead of silently failing
        if (!aiRes.ok) {
          const errText = await aiRes.text().catch(() => "");
          throw new Error(errText || "AI processing failed");
        }
      }

      // console.log(`[AI] Processing triggered successfully for Sprint: ${moduleId}`);
      onUploadComplete();
    } catch (err) {
      console.error("[AI] Pipeline failed:", err);

      const failRes = await fetchWithAuth(
        `${API_URL}/api/training-modules/${encodeURIComponent(moduleId)}/processing-status`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "X-User-ID": adminId,
          },
          body: JSON.stringify({ processing_status: "failed" }),
        }
      );

      if (!failRes.ok) {
        console.error("Failed to update failed status:", await failRes.text().catch(() => ""));
      }

      onUploadComplete();
      console.warn(`AI processing pending: ${(err as any)?.message || err}`);
    }
  };

  const handleUpload = async () => {
    if (files.length === 0  || !title){
      alert("Data is not sufficient");
      return;
    } 

    setUploading(true);
    const uploadFiles = [...files];
    try {
      
      // We no longer rely on the frontend `/api/content-library/upload`. We just post directly
      // to the backend to create a skeleton training module, then ai trigger will upload the files!
      
      const response = await fetchWithAuth(`${API_URL}/api/training-modules/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-ID': adminId
        },
        body: JSON.stringify({
          company_id: companyId,
          title: title,
          description: description,
          content_url: "", // Content will be populated by AI processing
          content_type: files[0]?.type || "application/pdf",
          processing_status: 'pending',
          threshold_value: thresholdValue,
          reviewer_id: retrievedReviewerId,
          additional_readings: additionalLinks.length > 0 ? additionalLinks : null,
          source_files: files.map((f: File) => f.name) // Initial filenames, will be updated by AI Upload
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Creation failed');
      }

      const result = await response.json();
      // console.log('Creation successful:', result);

      const uploadedFileRaw = result.inserted?.[0]?.module;

      if (!uploadedFileRaw) {
        throw new Error("Creation succeeded but no file URL returned from API");
      }

      const uploadedFile = uploadedFileRaw.replace("/object/sign","/object/public");
      
      // Extract individual file info from the API response
      const individualFileUrls = (result.inserted || []).map((item: any) => {
        const moduleUrl = item.module || '';
        // Extract storage path from the URL (just the path after the bucket name)
        let storagePath = '';
        try {
          const url = new URL(moduleUrl);
          const pathname = decodeURIComponent(url.pathname);
          
          // Pattern 1: /object/public/content library/uploads/...
          // Pattern 2: /object/sign/content library/uploads/...
          // We want just "uploads/..." part
          const pathMatch = pathname.match(/\/object\/(?:public|sign)\/content library\/(.+)$/) ||
                           pathname.match(/content library\/(.+)$/);
          
          if (pathMatch && pathMatch[1]) {
            storagePath = pathMatch[1];
            // console.log('[Upload] Extracted storage path:', storagePath, 'from URL:', moduleUrl);
          } else {
            let moduleData = result.module;
          }
        }catch (err) {
          console.warn('Failed to parse URL for storage path extraction:', moduleUrl, err);
        }
        
        return {
          name: item.title || 'Unknown',
          url: moduleUrl.replace("/object/sign", "/object/public") || '',
          path: storagePath
        };
      });
      
      // console.log('[Upload] Individual file URLs extracted:', individualFileUrls);
      
      if (uploadedFile) {
        // Create training module via backend API
        const createRes = await fetchWithAuth(`${API_URL}/api/training-modules/`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-User-ID': adminId
          },
          body: JSON.stringify({
            company_id: companyId,
            title: title,
            description: description,
            content_url: uploadedFile,
            content_type: files[0]?.type || "application/pdf",
            processing_status: 'pending',
            threshold_value: thresholdValue,
            reviewer_id: retrievedReviewerId,
            additional_readings: additionalLinks.length > 0 ? additionalLinks : null,
            source_files: individualFileUrls.map((f: { path: string }) => f.path)
          })
        });

        if (!createRes.ok) {
          const errorText = await createRes.text().catch(() => '');
          console.error('Failed to create training module entry:', errorText);
          alert('Failed to create training module: ' + errorText);
        } else {
          const createPayload = await createRes.json().catch(() => ({}));
          // console.log('[Upload] Backend response:', createPayload);
          
          // Backend returns {message: "...", module: [{...}]}
          // The module is an array from Supabase insert
          let moduleData = null;
          if (createPayload.module) {
            if (Array.isArray(createPayload.module)) {
              moduleData = createPayload.module[0];
            } else {
              moduleData = createPayload.module;
            }
          }
          
          // console.log('[Upload] Extracted moduleData:', moduleData);
          
          if (moduleData && moduleData.module_id) {
            // console.log('[Upload] Created module with ID:', moduleData.module_id);
            
            // Store source file names and URLs in localStorage (frontend-only solution)
            const sourceFilesMap = JSON.parse(localStorage.getItem('moduleSourceFiles') || '{}');
            sourceFilesMap[moduleData.module_id] = individualFileUrls.length > 0 
              ? individualFileUrls 
              : files.map(f => ({ name: f.name, url: '' }));
            localStorage.setItem('moduleSourceFiles', JSON.stringify(sourceFilesMap));
            // console.log('[Upload] Stored source files in localStorage:', sourceFilesMap[moduleData.module_id]);
            
            // Refresh UI immediately to show the new module card
            onUploadComplete();
            
            // Trigger AI background processing
            await triggerAIProcessing( moduleData.module_id, uploadFiles, uploadedFile);
            // console.log("Triggering AI with:");
            // console.log("moduleId:", moduleData.module_id);
            // console.log("files count:", uploadFiles.length);
            // console.log("file names:", uploadFiles.map(f => f.name));
          } else {
            console.error('[Upload] No module_id in response. Full payload:', createPayload);
            alert('Module created but ID not found in response');
          }
        }
      }

      setFiles([]);
      setTitle('');
      setDescription('');
      setAdditionalLinks([]);
      setLinkTitle('');
      setLinkUrl('');
      
      // Final refresh and notification
      onUploadComplete();
      alert('Sprint material uploaded. AI processing has started!');
    } catch (error: any) {
      console.error('Upload failed:', error);
      // alert(`Upload failed: ${error.message}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    // Upload section
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="md:col-span-2">
        <Label className="mb-2 block">Sprint Documents </Label>

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const droppedFiles = Array.from(e.dataTransfer.files);
            setFiles((prev) => [...prev, ...droppedFiles]);
          }}
          className="border-2 border-dashed border-gray-300 rounded-xl p-10 text-center bg-gray-50 hover:bg-gray-100 transition cursor-pointer"
          onClick={() => document.getElementById("file-upload")?.click()}
        >
          <Upload className="mx-auto mb-3 w-10 h-10 text-gray-400" />

          <p className="text-sm font-medium text-gray-700">
            Add Sprint Resources or drag and drop
          </p>

          <p className="text-xs text-gray-500 mt-1">
            Maximum file size 4MB. PDF, PPTx and DOCX only.
          </p>
          <p className="text-xs text-gray-500 mt-1">
            For a more robust and insightful Sprint, we recommend using detailed, text-rich documents (ideally 8+ pages)
          </p>

          <input
            id="file-upload"
            type="file"
            multiple
            accept=".pdf,.pptx,.docx"
            className="hidden"
            onChange={(e) => {
              if (!e.target.files) return;
              const newFiles = Array.from(e.target.files);
              setFiles((prev) => [...prev, ...newFiles]);
            }}
          />
        </div>
      </div>

            {/* Selected Files List */}

      {files.length > 0 && (
        <div className="mt-4 md:col-span-2">

          <p className="text-xs font-semibold text-gray-500 mb-3 uppercase">
            Selected Files ({files.length})
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">

            {files.map((file, index) => {

              const fileSize = (file.size / 1024 / 1024).toFixed(2);

              return (
                <div
                  key={index}
                  className="flex items-center justify-between bg-gray-50 border rounded-xl p-4 shadow-sm hover:shadow-md transition group"
                  title={file.name} // Add native tooltip on hover
                >

                  <div className="flex items-center gap-3 flex-1 min-w-0">

                    <div className="w-10 h-10 flex items-center justify-center bg-red-100 rounded-lg flex-shrink-0">
                      <FileText className="w-5 h-5 text-red-500"/>
                    </div>

                    <div className="flex-1 min-w-0">

                      <p className="text-sm font-medium text-gray-900 truncate" title={file.name}>
                        {file.name}
                      </p>

                      <p className="text-xs text-gray-500">
                        {fileSize} MB • PDF
                      </p>

                    </div>

                  </div>


                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      setFiles(files.filter((_, i) => i !== index))
                    }
                    className="text-red-500 hover:text-red-600 flex-shrink-0 ml-2"
                  >
                    <Trash2 className="w-4 h-4"/>
                  </Button>

                </div>
              );

            })}

          </div>

        </div>
      )}





      <div>
        <Label htmlFor="title">Title *</Label>
        <Input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Enter Sprint Title"
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
        <Label htmlFor="reviewerEmail">Reviewer Email </Label>
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
          Assign a reviewer who will approve this Sprint Content before it goes live.
        </p>
      </div>

      {/* Additional Links Input */}
      <div className="md:col-span-2">
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
            className="border-slate-200 focus:border-[#3B66F5] focus:ring-[#3B66F5]"
          />
          <Input
            placeholder="Link URL"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
          />
          <Button onClick={handleAddLink} className="bg-blue-600 text-white hover:bg-blue-700">Add</Button>
        </div>
      </div>
      <div className="md:col-span-2 flex justify-end">
      <Button onClick={handleUpload} className = "bg-blue-600 text-white hover:bg-blue-700" disabled={files.length === 0 || !title || uploading}>
        {uploading ? 'Creating...' : 'Add Sprint Content'}
      </Button>
      </div>
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
      <h3 className="text-lg font-semibold mb-4">Sprint Content Library</h3>
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
      formData.append("files", file);
      const res = await fetchWithAuth("/api/admin/kpi/upload-scores", {
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
          <div className="font-semibold text-green-800">Sprint Content Status:</div>
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
  const [selectedModule, setSelectedModule] = useState<any | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1.25);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);

  const files = (() => {
    if (!selectedModule) return [];

    const sourceFiles: any[] = [];
    const raw = selectedModule?.source_files;

    // console.log("RAW SOURCE FILES:", raw);

    // Handle array format
    if (Array.isArray(raw)) {
      raw.forEach((path: string) => {
        sourceFiles.push({
          name: path.split("/").pop() || path,
          path: path,
          type: "source"
        });
      });
    }

    // Handle JSON string format
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw);
        parsed.forEach((path: string) => {
          sourceFiles.push({
            name: path.split("/").pop() || path,
            path: path,
            type: "source"
          });
        });
      } catch {
        console.warn("Failed to parse source_files");
      }
    }

    // Add combined AI document at the top
    if (selectedModule.content_url) {
      sourceFiles.unshift({
        name: "Combined Sprint's Document",
        url: selectedModule.content_url,
        type: "combined"
      });
    }

    return sourceFiles;
  })();
  
  // Get source files - first check localStorage (frontend storage), then fall back to backend data
  // const files = (() => {
  //   if (!selectedModule) return [];
    
  //   // Try localStorage first (frontend-only storage)
  //   try {
  //     const sourceFilesMap = JSON.parse(localStorage.getItem('moduleSourceFiles') || '{}');
  //     if (sourceFilesMap[selectedModule.module_id] && sourceFilesMap[selectedModule.module_id].length > 0) {
  //       const stored = sourceFilesMap[selectedModule.module_id];
  //       // Check if it's the new format with {name, url, path} objects
  //       if (Array.isArray(stored) && stored.length > 0 && typeof stored[0] === 'object' && 'name' in stored[0]) {
  //         return stored;
  //       }
  //       // Old format - just strings (file names)
  //       return stored.map((name: string) => ({ name, url: '', path: '' }));
  //     }
  //   } catch (e) {
  //     console.warn('Failed to read source files from localStorage:', e);
  //   }
    
  //   // Fall back to backend data
  //   const raw = selectedModule?.source_files;
  //   if (!raw) return [];
  //   if (Array.isArray(raw)) {
  //     // Check if array contains objects or strings
  //     if (raw.length > 0 && typeof raw[0] === 'object') return raw;
  //     return raw.map((name: string) => ({ name, url: '', path: '' }));
  //   }
  //   if (typeof raw === "string") {
  //     try {
  //       const parsed = JSON.parse(raw);
  //       if (Array.isArray(parsed)) {
  //         if (parsed.length > 0 && typeof parsed[0] === 'object') return parsed;
  //         return parsed.map((name: string) => ({ name, url: '', path: '' }));
  //       }
  //     } catch {
  //       return raw.split(",").map((s: string) => ({ name: s.trim(), url: '', path: '' })).filter((f: any) => f.name);
  //     }
  //   }
  //   return [];
  // })();


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
      // Fetch training modules via backend API
      const modulesRes = await fetchWithAuth(`${API_URL}/api/training-modules/company/${encodeURIComponent(companyId)}`, {
        headers: { 'X-User-ID': adminId }
      });

      if (!modulesRes.ok) {
        const errorText = await modulesRes.text().catch(() => '');
        throw new Error(`Failed to fetch modules: ${modulesRes.status} ${errorText}`);
      }

      const modulesPayload = await modulesRes.json().catch(() => ({}));
      // console.log("Backend response");
      // console.log(modulesPayload);

      const data = modulesPayload.modules || [];

      // Fetch ALL content jobs in ONE batch call (much faster than per-module)
      let jobsMap = new Map<string, any>();
      try {
        const jobsRes = await fetchWithAuth(`${API_URL}/api/content-jobs/?limit=1000`, {
          headers: { 'X-User-ID': adminId }
        });
        
        if (jobsRes.ok) {
          const jobsPayload = await jobsRes.json().catch(() => null);
          const jobs = jobsPayload?.jobs ?? jobsPayload?.data ?? jobsPayload.data.data ?? jobsPayload ?? [];
          
          // Create a map of module_id -> job for fast lookup
          (jobs || []).forEach((job: any) => {
            if (job.module_id) {
              jobsMap.set(job.module_id, job);
            }
          });
          // console.log(`[uploads] Loaded ${jobsMap.size} content jobs in batch`);
        } else {
          const errorText = await jobsRes.text().catch(() => '');
          console.error('[uploads] Failed to fetch content jobs batch:', jobsRes.status, errorText);
          console.error('[uploads] Using adminId:', adminId);
        }
      } catch (e) {
        console.error('[uploads] Error fetching content jobs batch:', e);
      }

      // Map modules with their job status (no async operations, just lookups)
      const modulesWithStatus = (data || []).map((module: any) => {

        // console.log("Logging each module source file");
        // console.log("MODULE ID:",module.module_id);
        // console.log("Source files:", module.source_files);
        // console.log("Type:", typeof module.source_files);


        let finalStatus = module.processing_status;
        
        const job = jobsMap.get(module.module_id);
        if (job) {
          // Map backend job status to frontend status
          if (job.status === 'completed') finalStatus = 'completed';
          else if (job.status === 'failed') finalStatus = 'failed';
          else if (job.status === 'in_progress' || job.status === 'in-progress') finalStatus = 'processing';
          else finalStatus = 'pending';
        } else {
          // No job found, keep existing status or default
          finalStatus = finalStatus || 'processing';
        }

        // Update module status in database if it changed (fire and forget via backend API)
        if (finalStatus !== module.processing_status) {
          fetchWithAuth(`${API_URL}/api/training-modules/${encodeURIComponent(module.module_id)}/processing-status`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'X-User-ID': adminId
            },
            body: JSON.stringify({ processing_status: finalStatus })
          })
            .then(() => {})
            .catch((err) => console.warn('[uploads] Failed to update module status:', err));
        }

        return {
          ...module,
          processing_status: finalStatus
        };
      });

      setTrainingModules(modulesWithStatus);
    } catch (error: any) {
      console.error('Failed to load training modules:', error);
      setError('Failed to load Sprints');
    } finally {
      setLoading(false);
    }
  };

  const paginatedModules = trainingModules.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const totalPages = Math.ceil(trainingModules.length / itemsPerPage);

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
            setError('Failed to open Sprint Document');
            return;
          }
        }

        // Open the fresh signed URL in a new tab
        window.open(data.signedUrl, '_blank');
      } else {
        console.error('No content URL found for module');
        setError('Sprint Content File not found');
      }
    } catch (error: any) {
      console.error('Failed to view module:', error);
      setError('Failed to open Sprint Document');
    }
  };

  const handleDeleteModule = async (moduleId: string) => {
    if (!confirm("Are you sure you want to delete this Sprint?")) return;

    try {
      // Delete module via backend API
      const deleteRes = await fetchWithAuth(`${API_URL}/api/training-modules/${encodeURIComponent(moduleId)}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'X-User-ID': adminId
        }
      });

      if (!deleteRes.ok) {
        const errorText = await deleteRes.text().catch(() => '');
        throw new Error(`Failed to delete module: ${deleteRes.status} ${errorText}`);
      }

      // Reload modules
      loadTrainingModules();
    } catch (error: any) {
      console.error('Failed to delete module:', error);
      setError('Failed to delete Sprint');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-2 text-gray-600">Loading Sprints...</span>
      </div>
    );
  }

  const getModuleStatus = (module: any) =>
    (module.processing_status || "").toLowerCase();

  const isModuleReady = (module: any) =>
    getModuleStatus(module) === "completed";

  const isViewDisabled = (module: any) => !isModuleReady(module);


  return (
    <div className="space-y-4">
      <Dialog open={!!selectedModule} onOpenChange={() => {
  setSelectedModule(null);
  setPreviewUrl(null);
}}>
  <DialogContent className="max-w-5xl w-[90vw] max-h-[90vh] p-0 overflow-hidden rounded-2xl" onInteractOutside={(e) => e.preventDefault()}>

    {/* Header */}
    <div className="px-6 py-5 border-b bg-white flex items-start justify-between">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center">
          <FileText className="w-6 h-6 text-blue-600"/>
        </div>
        <div>
          <DialogTitle className="text-xl font-semibold text-gray-900">
            {selectedModule?.title}
          </DialogTitle>
          <p className="text-sm text-gray-500 mt-0.5">
            Module Details & Source Files
          </p>
        </div>
      </div>
    </div>

    {/* Content Area */}
    <div className="p-6 bg-gray-50 overflow-hidden" style={{ maxHeight: 'calc(90vh - 100px)' }}>
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* LEFT — DOCUMENT PREVIEW */}
        <div className="lg:col-span-3 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              DOCUMENT
            </h4>
            {previewUrl && (
              <button
                onClick={() => window.open(previewUrl, "_blank")}
                className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium"
              >
                <ExternalLink className="w-4 h-4"/>
                Open in Viewer
              </button>
            )}
          </div>

          <div className="relative bg-white border border-gray-200 rounded-xl flex items-center justify-center min-h-[450px] shadow-sm">
            {previewUrl ? (
              <>
                <div className="absolute inset-0 overflow-hidden flex items-start justify-center p-4">
                  <div className="w-full h-full">
                    <iframe
                      key={`${previewUrl}-${zoom}`}
                      src={`${previewUrl}#toolbar=0&navpanes=0&zoom=${Math.round(zoom * 100)}`}
                      className="w-full h-[75vh] rounded-lg border border-gray-100"
                    />
                  </div>
                </div>
                <div className="absolute bottom-4 left-4 flex gap-2 z-20">
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-white/90 backdrop-blur"
                    onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
                  >
                    -
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-white/90 backdrop-blur"
                    onClick={() => setZoom((z) => Math.min(4, z+0.25))}
                  >
                    +
                  </Button>
                </div>
              </>
            ) : (
              <div className="text-center text-gray-400 py-12">
                <FileText className="w-16 h-16 mx-auto mb-4 opacity-30"/>
                <p className="font-medium text-gray-500">PDF Preview Placeholder</p>
                <p className="text-sm text-gray-400 mt-1">Combined document for RAG processing</p>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT — SOURCE FILES + AI INFO */}
        <div className="lg:col-span-2 flex flex-col space-y-5">
          
          {/* Source Files Section */}
          <div>
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              SOURCE FILES ({files.length})
            </h4>
            <div className="space-y-2">
              {files.length > 0 ? (
                files.map((file: { name: string; path: string; type?: string; url?: string }, i: number) => {

                  const fileSizeDisplay = "PDF";

                  return (
                    <div
                      key={i}
                      onClick={async () => {
                        try {
                          // Combined AI document
                          if (file.type === "combined") {
                            setPreviewUrl(file.url ?? null);
                            return;
                          }

                          if (!file.path) {
                            console.error("Missing file path");
                            return;
                          }

                          // console.log("Requesting preview for:", file.path);

                          const res = await fetchWithAuth(`${API_URL}/api/preview-file`, {
                            method: "POST",
                            headers: {
                              "Content-Type": "application/json"
                            },
                            body: JSON.stringify({
                              filePath: file.path
                            })
                          });

                          if (!res.ok) {
                            throw new Error("Preview generation failed");
                          }

                          const data = await res.json();

                          if (data.previewUrl) {
                            setPreviewUrl(data.previewUrl);
                          } else {
                            console.error("Preview URL missing");
                          }

                        } catch (err) {
                          console.error("Preview error:", err);
                        }
                      }}
                      className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-4 py-3 hover:shadow-md hover:border-blue-300 transition cursor-pointer group"
                    >

                      <div className="w-10 h-10 bg-blue-50 group-hover:bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0 transition">
                        <FileText className="w-5 h-5 text-blue-500 group-hover:text-blue-600"/>
                      </div>

                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="font-medium text-gray-900 text-sm truncate group-hover:text-blue-600 transition">
                          {file.name}
                        </span>
                        <span className="text-xs text-gray-400">{fileSizeDisplay}</span>
                      </div>

                      <Eye className="w-4 h-4 text-gray-400 group-hover:text-blue-500 opacity-0 group-hover:opacity-100 transition" />
                    </div>
                  );
                })
              ) : (
                <div className="text-center py-6 bg-white border border-gray-200 rounded-xl">
                  <Paperclip className="w-8 h-8 mx-auto mb-2 text-gray-300"/>
                  <p className="text-sm text-gray-500">No source files available</p>
                </div>
              )}
            </div>
            
          </div>

        </div>

      </div>
    </div>

  </DialogContent>
</Dialog>
      

      
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Content Upload Section */}
      <div className="border-b pb-4">
        <h3 className="text-lg font-semibold mb-2">Create New Sprint</h3>
        <ContentUpload
          companyId={companyId}
          adminId={adminId}
          onUploadComplete={loadTrainingModules}
        />
      </div>

      {/* Training Modules List */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Sprints({trainingModules.length})</h3>

        {trainingModules.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <Upload className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>No Sprints found</p>
            <p className="text-sm">Create your first Sprint to get started</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {paginatedModules.map((module) => (
              <Card key={module.module_id}>
              <CardContent className="p-4">

              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between">

              <div className="flex-1">

              <div className="flex items-center gap-3 mb-2">

              <h4 className="font-medium text-gray-900">
              {module.title}
              </h4>

              {getStatusBadge(module.processing_status)}

              <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border ${getReviewStageColor(module.review_stage)}`}>
              {getReviewStageLabel(module.review_stage)}
              </span>

              </div>

              {module.description && (
              <p className="text-sm text-gray-600 mb-2">
              {module.description}
              </p>
              )}

              <div className="flex items-center gap-4 text-xs text-gray-500">
              <span>{formatContentType(module.content_type)}</span>
              <span>Created: {new Date(module.created_at).toLocaleDateString()}</span>
              </div>

              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isViewDisabled(module)}
                  className={isViewDisabled(module) ? "opacity-50 cursor-not-allowed" : ""}
                  onClick={async () => {
                    if (isViewDisabled(module)) return;
                    setPreviewUrl(null);
                    setSelectedModule(module);

                    try {
                      // console.log('[View Button] Loading module:', module.title);
                      // console.log('[View Button] Content URL:', module.content_url);

                      const url = new URL(module.content_url);
                      const pathname = decodeURIComponent(url.pathname);
                      // console.log('[View Button] Decoded pathname:', pathname);

                      let pathMatch = pathname.match(/\/(?:storage\/v1\/)?object\/(?:public|sign)\/training-content\/(.+)$/);
                      let bucketName = 'training-content';

                      if (!pathMatch) {
                        pathMatch = pathname.match(/\/(?:storage\/v1\/)?object\/(?:public|sign)\/content library\/(.+)$/);
                        bucketName = 'content library';
                      }

                      if (!pathMatch) {
                        pathMatch = pathname.match(/training-content\/(.+)$/);
                        bucketName = 'training-content';
                      }

                      if (!pathMatch) {
                        pathMatch = pathname.match(/content library\/(.+)$/);
                        bucketName = 'content library';
                      }

                      if (!pathMatch || !pathMatch[1]) {
                        // console.log('[View Button] No bucket/path pattern found, using URL as-is');
                        setPreviewUrl(module.content_url);
                        return;
                      }

                      const storagePath = pathMatch[1];
                      // console.log('[View Button] Bucket:', bucketName, 'Path:', storagePath);

                      const { data, error } = await supabase
                        .storage
                        .from(bucketName)
                        .getPublicUrl(storagePath);

                      if (error) {
                        console.warn("[View Button] Signed URL failed:", error);
                        setPreviewUrl(module.content_url);
                        return;
                      }

                      // console.log('[View Button] Generated signed URL successfully');
                      setPreviewUrl(data.publicUrl);
                    } catch (err) {
                      console.error("[View Button] Preview error:", err);
                      setPreviewUrl(module.content_url);
                    }
                  }}
                >
                  <Eye className="w-4 h-4 mr-1" />
                  {isModuleReady(module) ? "View" : "Preparing..."}
                </Button>

                {isModuleReady(module) && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDeleteModule(module.module_id)}
                    className="text-red-600"
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    Delete
                  </Button>
                )}
              </div>

              </div>

              </CardContent>
              </Card>
                
              
            ))}
          </div>
        )}
         {totalPages > 1 && (
          <div className="flex justify-between items-center mt-4">
            <div>
              <span className="text-sm text-gray-600">
                Page {currentPage} of {totalPages}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setCurrentPage((prev) => Math.min(prev + 1, totalPages))
                }
                disabled={currentPage === totalPages}
              >
                Next
              </Button>
            </div>
            <div>
              <select
                value={itemsPerPage}
                onChange={(e) => {
                  setItemsPerPage(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="border-gray-300 rounded-md shadow-sm"
              >
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
              </select>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function UploadsPage() {
  const { user,loading:authLoading } = useAuth();
  const router = useRouter();
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [loading, setLoading] = useState(true);
  const { progress: loadingProgress, show: showLoadingProgress } = useIllusionProgress(authLoading || loading);

  useEffect(() => {
        if (!authLoading) {
          if (!user) router.push("/login");
          else checkAdminAccess();
          
        }
      }, [user, authLoading, router]);

  const checkAdminAccess = async () => {
    if (!user?.email) return;

    try {
      // Get user data from users table via backend API
      const userRes = await fetchWithAuth(`${API_URL}/api/users/by-email/${encodeURIComponent(user.email)}`);

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
      const roleRes = await fetchWithAuth(`${API_URL}/api/roles/users/${userData.user_id}`, {
        headers: { 'X-User-ID': userData.user_id }
      });

      if (!roleRes.ok) {
        console.error("Failed to fetch user roles");
        return;
      }

      const rolesPayload = await roleRes.json();
      const assignments = rolesPayload.assignments || rolesPayload.data || rolesPayload.data.data ||rolesPayload || [];

      if (!assignments || assignments.length === 0) {
        console.error("No active role for user.");
        return;
      }
      // Check if user has Admin role
      const hasAdminRole = assignments.some((assignment: any) => {
        const roleObj = assignment.role || assignment.roles || assignment;
        const name = (roleObj?.name || '').toString().toLowerCase();
        const level = Number(roleObj?.level ?? -1);
        return level >= 3 || ['admin', 'super-admin', 'ceo'].includes(name);
    });

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
      showLoadingProgress
        ? <LoadingProgress label="Loading Creations..." progress={loadingProgress} />
        : (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <span className="ml-2 text-gray-600">Loading...</span>
          </div>
        )
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
      {/* Header Card */}
      <div className="bg-white rounded-xl shadow-sm p-8 border border-slate-200 mb-8">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">Sprint Studio</h1>
        <p className="text-slate-600">Create New Sprint for your Organization</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Upload className="w-5 h-5 mr-2" />
            Sprint Content Manager
          </CardTitle>
          <CardDescription>
            Create and Manage Sprints for your Organization
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

function useIllusionProgress(active: boolean) {
  const [progress, setProgress] = useState(12);
  const [show, setShow] = useState(active);

  useEffect(() => {
    if (!active) {
      setProgress(100);
      const timeout = setTimeout(() => setShow(false), 180);
      return () => clearTimeout(timeout);
    }

    setShow(true);
    setProgress(Math.min(25, 10 + Math.round(Math.random() * 12)));

    const id = setInterval(() => {
      setProgress((prev) => {
        const shouldHold = prev > 70 ? Math.random() < 0.45 : Math.random() < 0.25;
        if (shouldHold) return prev;
        const increment = Math.max(1, Math.round(Math.random() * 7));
        return Math.min(prev + increment, 93);
      });
    }, 420 + Math.round(Math.random() * 240));

    return () => clearInterval(id);
  }, [active]);

  return { progress: Math.min(progress, 100), show };
}

function LoadingProgress({ label, progress }: { label: string; progress: number }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-lg border border-slate-100 p-6 space-y-4">
        <div className="flex items-center justify-between text-sm font-semibold text-slate-700">
          <span>{label}</span>
          <span className="text-slate-900 text-base font-black">{progress}%</span>
        </div>
        <div className="relative h-3 rounded-full bg-slate-100 overflow-hidden">
          <div
            className="absolute left-0 top-0 h-full bg-gradient-to-r from-blue-500 via-indigo-500 to-cyan-400 transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-xs text-slate-500 font-medium">Preparing Sprints. This may take a moment.</p>
      </div>
    </div>
  );
}