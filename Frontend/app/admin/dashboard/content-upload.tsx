// "use client"

// import type React from "react"

// import { useState, useCallback, useRef } from "react"
// import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
// import { Input } from "@/components/ui/input"
// import { Label } from "@/components/ui/label"
// import { Button } from "@/components/ui/button"
// import { Textarea } from "@/components/ui/textarea"
// import { Alert, AlertDescription } from "@/components/ui/alert"
// import { FileText, Video, Music, File, UploadCloud, XCircle, CheckCircle, Table, Presentation } from "lucide-react"
// import { supabase } from "@/lib/supabase"
// import { formatBytes } from "@/lib/utils"
// import { toast } from "react-hot-toast"

// interface ContentUploadProps {
//   companyId: string
//   onUploadSuccess: () => void
// }

// const MAX_FILE_SIZE_MB = 50
// const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024

// const getFileIcon = (fileType: string) => {
//   if (fileType.includes("pdf")) return <FileText className="w-6 h-6 text-red-500" />
//   if (fileType.includes("word") || fileType.includes("document")) return <FileText className="w-6 h-6 text-blue-500" />
//   if (fileType.includes("presentation") || fileType.includes("powerpoint") || fileType.includes("ppt")) return <Presentation className="w-6 h-6 text-orange-500" />
//   if (fileType.includes("spreadsheet") || fileType.includes("excel") || fileType.includes("csv") || fileType.includes("xls")) return <Table className="w-6 h-6 text-green-500" />
//   if (fileType.includes("video")) return <Video className="w-6 h-6 text-purple-500" />
//   if (fileType.includes("audio")) return <Music className="w-6 h-6 text-green-500" />
//   return <File className="w-6 h-6 text-gray-500" />
// }

// // Helper to upload file to OpenAI Assistants API
// async function uploadToOpenAIAssistant(file: File, moduleId: string) {
//   const formData = new FormData();
//   formData.append("file", file);
//     if (moduleId) {
//     formData.append("moduleId", moduleId)
//   } else {
//     throw new Error("Module ID is missing")
//   }
//   const res = await fetch("/api/openai-upload", {
//     method: "POST",
//     body: formData,
//   });
//   const data = await res.json();
//   return data;
// }

// // Helper to upload transcribed text to OpenAI (for video/audio files)
// async function uploadTextToOpenAI(extractedText: string, moduleId: string) {
//   const res = await fetch("/api/openai-upload", {
//     method: "POST",
//     headers: {
//       "Content-Type": "application/json"
//     },
//     body: JSON.stringify({
//       text: extractedText,
//       moduleId: moduleId
//     }),
//   });
//   const data = await res.json();
//   return data;
// }

// // Helper function to check if file type is video or audio
// function isVideoOrAudioFile(fileType: string): boolean {
//   return fileType.includes("video/") || fileType.includes("audio/");
// }

// // Helper function to send email notifications to employees
// async function sendEmailNotifications(moduleId: string, moduleTitle: string, companyId: string) {
//   try {
//     const res = await fetch("/api/send-module-notifications", {
//       method: "POST",
//       headers: {
//         "Content-Type": "application/json"
//       },
//       body: JSON.stringify({
//         moduleId: moduleId,
//         moduleTitle: moduleTitle,
//         companyId: companyId
//       }),
//     });

//     if (!res.ok) {
//       const errorText = await res.text();
//       throw new Error(`Email notification failed: ${res.statusText}`);
//     }

//     const data = await res.json();
//     return data;
//   } catch (error) {
//     throw error;
//   }
// }

// export function ContentUpload({ companyId, onUploadSuccess }: ContentUploadProps) {
//   const [file, setFile] = useState<File | null>(null)
//   const [title, setTitle] = useState("")
//   const [description, setDescription] = useState("")
//   const [uploading, setUploading] = useState(false)
//   const [uploadProgress, setUploadProgress] = useState(0)
//   const [error, setError] = useState("")
//   const fileInputRef = useRef<HTMLInputElement>(null)
//   const [openaiUploading, setOpenaiUploading] = useState(false);
//   const [openaiResult, setOpenaiResult] = useState<any>(null);

//   const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
//     if (e.target.files && e.target.files[0]) {
//       const selectedFile = e.target.files[0]
//       validateFile(selectedFile)
//     }
//   }

//   const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
//     e.preventDefault()
//     e.stopPropagation()
//     if (e.dataTransfer.files && e.dataTransfer.files[0]) {
//       const droppedFile = e.dataTransfer.files[0]
//       validateFile(droppedFile)
//     }
//   }, [])

//   const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
//     e.preventDefault()
//     e.stopPropagation()
//   }, [])

//   const validateFile = (selectedFile: File) => {
//     setError("")
//     setFile(null)
//     setTitle("")
//     setDescription("")
//     setUploadProgress(0)

//     if (selectedFile.size > MAX_FILE_SIZE_BYTES) {
//       setError(`File size exceeds ${MAX_FILE_SIZE_MB}MB limit.`)
//       return
//     }

//     const allowedTypes = [
//       // Documents
//       "application/pdf",
//       "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
//       "application/msword", // .doc
//       "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
//       "application/vnd.ms-powerpoint", // .ppt
//       "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
//       "application/vnd.ms-excel", // .xls
//       "text/csv", // .csv
//       // Media
//       "video/mp4",
//       "video/avi",
//       "video/mov",
//       "video/wmv",
//       "video/flv",
//       "video/webm",
//       "audio/mpeg", // .mp3
//       "audio/wav",
//       "audio/ogg",
//       "audio/mp4",
//       "audio/aac",
//       // Images (optional - add if you want to support images)
//       "image/jpeg",
//       "image/png",
//       "image/gif",
//       "image/webp",
//       // Text files
//       "text/plain",
//       "text/markdown",
//       "application/json",
//       "application/xml",
//     ]

//     if (!allowedTypes.includes(selectedFile.type)) {
//       setError("Unsupported file type. Please upload PDF, DOCX, PPT, XLSX, CSV, MP4, MP3, or other supported formats.")
//       return
//     }

//     setFile(selectedFile)
//     setTitle(selectedFile.name.split(".").slice(0, -1).join(".")) // Pre-fill title from filename
//   }

//   const handleUpload = async () => {
//     if (!file) return

//     // Basic validation: require title and description (and file already present)
//     const missing: string[] = []
//     if (!title.trim()) missing.push('title')
//     if (!description.trim()) missing.push('description')
//     if (missing.length > 0) {
//       const msg = 'Fill all the details first'
//       setError(msg)
//       // send a non-blocking log about the validation failure so we capture admin attempts
//       try {
//         const ua = typeof navigator !== 'undefined' ? navigator.userAgent : null
//         const platform = typeof navigator !== 'undefined' ? (navigator as any).platform || null : null
//         const payload = JSON.stringify({
//           email_id: (typeof window !== 'undefined' && window.localStorage) ? localStorage.getItem('__CURRENT_USER_EMAIL__') : null,
//           error: msg,
//           error_type: 'ValidationError',
//           action: 'AdminModuleUpload',
//           page_url: typeof window !== 'undefined' ? window.location.href : null,
//           browser: ua,
//           os: platform,
//           device: platform,
//           stack_trace: new Error().stack || null,
//           meta: { missingFields: missing }
//         })
//         if (typeof navigator !== 'undefined' && (navigator as any).sendBeacon) {
//           const blob = new Blob([payload], { type: 'application/json' })
//           try { (navigator as any).sendBeacon('/api/logs', blob) } catch (e) { /* swallow */ }
//         } else {
//           fetch('/api/logs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(() => {})
//         }
//       } catch (e) {
//         // ignore logging errors
//       }
//       return
//     }

//     setUploading(true)
//     setError("")
//     setUploadProgress(0)

//     try {
      
//       // 1. Upload to Supabase Storage
//       const { data, error: uploadError } = await supabase.storage
//         .from("training-content")
//         .upload(`uploads/${Date.now()}_${file.name}`, file)

//       if (uploadError) {
//         console.error("🔍 DEBUG: Upload error:", uploadError);
//         setError(uploadError.message)
//         setUploading(false)
//         return
//       }
      

//       // 2. Get public URL
//       const { data: signedUrlData, error: signedUrlError } = await supabase
//         .storage
//         .from("training-content")
//         .createSignedUrl(data?.path || "", 60 * 60); // 1 hour expiry

//       if (signedUrlError) {
//         console.error("🔍 DEBUG: Signed URL error:", signedUrlError);
//         setError(signedUrlError.message);
//         setUploading(false);
//         return;
//       }

//       const fileUrl = signedUrlData?.signedUrl;

//       // 3. Save metadata to DB (with all required fields)
//       const fileType = file.type || file.name.split('.').pop()
//       const { data: moduleData, error: dbError } = await supabase
//         .from("training_modules")
//         .insert({
//           title: title.trim() || file.name,
//           content_type: fileType,
//           content_url: fileUrl,
//           company_id: companyId,
//           description: description.trim() || null,
//           gpt_summary: null,
//           transcription: null,
//           ai_modules: null,
//           ai_topics: null,
//           ai_objectives: null,
//           processing_status: 'pending',
//         })
//         .select()
//         .single()

//       if (dbError) {
//         console.error("Database error:", dbError)
//         setError(dbError.message)
//       } else {
//         toast.success("File uploaded successfully! Starting content extraction...")
        
//         // 4. Trigger content extraction via API
        
//         // try {
//         //     fileUrl: fileUrl,
//         //     fileType: fileType || 'application/octet-stream',
//         //     moduleId: moduleData.module_id
//         //   }
//         //   catch (error) {
//         //     console.log(error);}
          
//           let res;
//           try {
//             res = await fetch("/api/extract-and-analyze", {
//               method: "POST",
//               headers: {
//                 "Content-Type": "application/json"
//               },
//               body: JSON.stringify({
//                 fileUrl: fileUrl,
//                 fileType: fileType || 'application/octet-stream',
//                 moduleId: moduleData.module_id,
//               }),
//             });
//           } catch (fetchError) {
//             console.error("🔍 DEBUG: Fetch error:", fetchError);
//             throw fetchError;
//           }


//           if (!res.ok) {
//             const errorText = await res.text();
//             console.error("🔍 DEBUG: API error response:", errorText);
//             throw new Error(`Extraction failed: ${res.statusText} - ${errorText}`);
//           }

//           const responseData = await res.json();
          
//           const { extractedText } = responseData;
          
//           toast.success("Content extraction completed!")
          
//           // Send email notifications to allowed employees
//           try {
//             await sendEmailNotifications(moduleData.module_id, title.trim() || file.name, companyId);
//             toast.success("Email notifications sent to employees!");
//           } catch (emailError) {
//             // console.error("📧 DEBUG: Email notification error:", emailError);
//             toast.error("Content uploaded successfully, but failed to send email notifications.");
//           }
          
//           onUploadSuccess?.()

//           // --- Process content with OpenAI ---
//           setOpenaiUploading(true);
//           try {
//             let result;
            
//             // For video/audio files, send the transcribed text to openai-upload
//             if (isVideoOrAudioFile(file.type)) {
//               result = await uploadTextToOpenAI(extractedText, moduleData.module_id);
//             } else {
//               // For other file types (PDF, DOCX, etc.), upload the file directly
//               result = await uploadToOpenAIAssistant(file, moduleData.module_id);
//             }
            
//             setOpenaiResult(result);
//             toast.success("OpenAI processing complete!");
            
//             // The backend worker will automatically handle subsequent processing
//           } catch (err) {
//             // console.error("🤖 DEBUG: OpenAI processing error:", err);
//             toast.error("OpenAI processing failed. See console for details.");
//           } finally {
//             setOpenaiUploading(false);
//           }
//         } catch (error) {
//           // console.error("🔍 DEBUG: Content extraction failed:", error)
//           toast.error("Content extraction failed. Content uploaded but analysis incomplete.")
//           onUploadSuccess?.()
//         }

//         setFile(null)
//         setTitle("")
//         setDescription("")
//       }
//     } catch (error: any) {
//       console.error("Upload error:", error)
//       setError(error.message)
//     } finally {
//       setUploading(false)
//     }
//   }

//   return (
//     <Card>
//       <CardHeader>
//         <CardTitle className="flex items-center">
//           <UploadCloud className="w-5 h-5 mr-2" />
//           Upload Training Content
//         </CardTitle>
//         <CardDescription>
//           Upload documents (PDF, DOCX, PPT, XLSX, CSV), media (MP4, MP3), and other training materials.
//         </CardDescription>
//       </CardHeader>
//       <CardContent>
//         <div
//           onDrop={handleDrop}
//           onDragOver={handleDragOver}
//           onClick={() => fileInputRef.current?.click()}
//           className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-blue-500 transition-colors"
//         >
//           <UploadCloud className="w-12 h-12 text-gray-400 mb-3" />
//           <p className="text-gray-600 text-center">Drag & drop your file here, or click to browse</p>
//           <p className="text-sm text-gray-500 mt-1">Max file size: {MAX_FILE_SIZE_MB}MB</p>
//           <input
//             type="file"
//             ref={fileInputRef}
//             onChange={handleFileChange}
//             className="hidden"
//             accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.mp4,.mp3,.wav,.avi,.mov,.txt,.md,.json,.xml,.jpg,.jpeg,.png,.gif,.webp"
//           />
//         </div>

//         {file && (
//           <div className="mt-4 p-4 border rounded-lg bg-gray-50">
//             <div className="flex items-center justify-between">
//               <div className="flex items-center gap-3">
//                 {getFileIcon(file.type)}
//                 <div>
//                   <p className="font-medium text-gray-900">{file.name}</p>
//                   <p className="text-sm text-gray-500">{formatBytes(file.size)}</p>
//                 </div>
//               </div>
//               {uploading ? (
//                 <div className="text-sm text-blue-600">{uploadProgress}%</div>
//               ) : error ? (
//                 <XCircle className="w-5 h-5 text-red-500" />
//               ) : (
//                 <CheckCircle className="w-5 h-5 text-green-500" />
//               )}
//             </div>
//             {uploading && (
//               <div className="w-full bg-gray-200 rounded-full h-2.5 mt-2">
//                 <div className="bg-blue-600 h-2.5 rounded-full" style={{ width: `${uploadProgress}%` }}></div>
//               </div>
//             )}
//           </div>
//         )}

//         {error && (
//           <Alert variant="destructive" className="mt-4">
//             <AlertDescription>{error}</AlertDescription>
//           </Alert>
//         )}

//         {file && (
//           <div className="mt-4 space-y-4">
//             <div className="space-y-2">
//               <Label htmlFor="moduleTitle">Module Title <span className="text-red-500">*</span></Label>
//               <Input
//                 id="moduleTitle"
//                 type="text"
//                 value={title}
//                 onChange={(e) => setTitle(e.target.value)}
//                 placeholder="e.g., Company Culture Basics"
//               />
//             </div>
//             <div className="space-y-2">
//               <Label htmlFor="moduleDescription">Description <span className="text-red-500">*</span></Label>
//               <Textarea
//                 id="moduleDescription"
//                 value={description}
//                 onChange={(e) => setDescription(e.target.value)}
//                 placeholder="Briefly describe the content of this module."
//                 rows={3}
//               />
//             </div>
//             <Button onClick={handleUpload} className="w-full" disabled={uploading || !file}>
//               {uploading ? `Uploading (${uploadProgress}%)` : "Upload Module"}
//             </Button>
//           </div>
//         )}

//         {/* Temporary button for manual OpenAI upload testing
//         {file && (
//           <Button
//             type="button"
//             variant="secondary"
//             className="mt-4"
//             disabled={openaiUploading}
//             onClick={async () => {
//               setOpenaiUploading(true);
//               try {
//                 const result = await uploadToOpenAIAssistant(file,        {/* Temporary button for manual OpenAI upload testing
//         {file && (
//           <Button
//             type="button"
//             variant="secondary"
//             className="mt-4"
//             disabled={openaiUploading}
//             onClick={async () => {
//               setOpenaiUploading(true);
//               try {
//                 const result = await uploadToOpenAIAssistant(file, moduleId);
//                 setOpenaiResult(result);
//                 toast.success("OpenAI Assistants API processing complete!");
//               } catch (err) {
//                 toast.error("OpenAI Assistants API failed. See console for details.");
//               } finally {
//                 setOpenaiUploading(false);
//               }
//             }}
//           >
//             {openaiUploading ? "Processing with OpenAI..." : "Test OpenAI Assistants API"}
//           </Button>
//         )} */}
//         {/* Success message after upload and processing */}
//         {openaiResult && (
//           <Alert className="mt-4 border-green-200 bg-green-50">
//             <CheckCircle className="h-4 w-4 text-green-600" />
//             <AlertDescription className="text-green-800">Training content uploaded and processed successfully!</AlertDescription>
//           </Alert>
//         )}

//         <div className="mt-4 text-xs text-gray-500">
//           <p className="font-medium mb-1">Supported formats:</p>
//           <div className="grid grid-cols-2 gap-1">
//             <span>• Documents: PDF, DOC, DOCX, PPT, PPTX</span>
//             <span>• Spreadsheets: XLS, XLSX, CSV</span>
//             <span>• Media: MP4, MP3, WAV, AVI, MOV</span>
//             <span>• Text: TXT, MD, JSON, XML</span>
//             <span>• Images: JPG, PNG, GIF, WebP</span>
//           </div>
//         </div>
//       </CardContent>
//     </Card>
//   )
// }
