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

interface Admin {
  user_id: string
  email: string
  name: string | null
  company_id: string
}

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
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const handleUpload = async () => {
    if (!file || !title) return;
    
    setUploading(true);
    try {
      // Simple file upload placeholder
      console.log('Uploading content:', { title, description, file });
      // In a real implementation, this would upload to storage and create training module
      onUploadComplete();
    } catch (error) {
      console.error('Upload failed:', error);
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
    // Placeholder - in real implementation would load files from storage
    setFiles([]);
    setLoading(false);
  }, [companyId]);

  if (loading) {
    return <div>Loading files...</div>;
  }

  return (
    <div>
      <h3 className="text-lg font-semibold mb-4">Uploaded Files</h3>
      {files.length === 0 ? (
        <p className="text-gray-500">No uploaded files found</p>
      ) : (
        <div>
          {/* File list would go here */}
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

// KPI Definitions Upload Component
function KPIDefinitionsUpload({ companyId }: { companyId?: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string[][]>([]);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<KPIUploadResult | null>(null);
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
      const res = await fetch("/api/admin/kpi/upload-definitions", {
        method: "POST",
        body: formData,
        headers: { "x-company-id": companyId },
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Upload failed");
      } else {
        setResult(json);
      }
    } catch (err) {
      setError("Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center mb-2">
        <Input type="file" accept=".csv,.xlsx" onChange={handleFileChange} />
        <Button onClick={handleUpload} disabled={!file || uploading}>
          {uploading ? "Uploading..." : "Upload"}
        </Button>
      </div>
      
      <div className="text-xs text-gray-500">
        Expected format: kpi_name, description, category, target_value, unit
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
              Skipped rows:
              <ul className="ml-4">
                {result.skipped.map((s, i) => (
                  <li key={i}>Row {s.row}: {s.reason}</li>
                ))}
              </ul>
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
      setTrainingModules(data || []);
    } catch (error: any) {
      console.error('Failed to load training modules:', error);
      setError('Failed to load training modules');
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return <Badge className="bg-green-100 text-green-800">Ready</Badge>;
      case 'PROCESSING':
        return <Badge className="bg-blue-100 text-blue-800">Processing</Badge>;
      case 'FAILED':
        return <Badge className="bg-red-100 text-red-800">Failed</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
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
          console.error('Failed to generate signed URL:', error);
          setError('Failed to open training module');
          return;
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
                      </div>
                      
                      {module.description && (
                        <p className="text-sm text-gray-600 mb-2">{module.description}</p>
                      )}
                      
                      <div className="flex items-center gap-4 text-xs text-gray-500">
                        <span>Type: {module.content_type}</span>
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

      {/* Uploaded Files List */}
      <div className="border-t pt-4">
        <UploadedFilesList companyId={companyId} />
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
      // Get user data from users table
      const { data: userData, error: userError } = await supabase
        .from("users")
        .select("user_id, email, name, company_id")
        .eq("email", user.email)
        .eq("is_active", true)
        .single();

      if (userError || !userData) {
        console.error("User not found or inactive:", userError);
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
        <h1 className="text-2xl font-bold text-gray-900">KPI & Content Uploads</h1>
        <p className="text-gray-600 mt-1">Upload KPI data and training content for your organization</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* KPI Scores Upload */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <BarChart3 className="w-5 h-5 mr-2" />
              KPI Scores Upload
            </CardTitle>
            <CardDescription>
              Upload employee KPI scores and performance data
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4">
              <Button asChild variant="outline" size="sm">
                <a
                  href="https://hyxqwqshhlebaybjpzcz.supabase.co/storage/v1/object/public/KPIs/Sample_KPI_Scores.xlsx"
                  download
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download Sample File
                </a>
              </Button>
            </div>
            <KPIScoresUpload companyId={admin.company_id} admin={admin} />
          </CardContent>
        </Card>

        {/* KPI Definitions Upload */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <FileText className="w-5 h-5 mr-2" />
              KPI Definitions Upload
            </CardTitle>
            <CardDescription>
              Define KPI metrics and their target values
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4">
              <Button asChild variant="outline" size="sm">
                <a
                  href="https://hyxqwqshhlebaybjpzcz.supabase.co/storage/v1/object/public/KPIs/Sample_KPI_Definitions.xlsx"
                  download
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download Sample File
                </a>
              </Button>
            </div>
            <KPIDefinitionsUpload companyId={admin.company_id} />
          </CardContent>
        </Card>
      </div>

      {/* Training Content Management */}
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