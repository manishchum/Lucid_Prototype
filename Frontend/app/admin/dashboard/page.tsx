interface Employee {
  id: string;
  email: string;
  name: string | null;
  joined_at: string;
}

"use client"

import { useState, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/auth-context";
import { supabase } from "@/lib/supabase";
import { Building2, Users, Plus, Trash2, LogOut } from "lucide-react";
import { ContentUpload } from "./content-upload";
import { UploadedFilesList } from "./uploaded-files-list";
import { Toaster } from "react-hot-toast";
// --- Employee Bulk Add UI Component ---
function EmployeeBulkAdd({ companyId, onSuccess, onError }: { companyId?: string; onSuccess: () => void; onError: (error: string) => void }) {
  const [mode, setMode] = useState<'manual' | 'upload'>('manual');
  const [manualEmails, setManualEmails] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string[][]>([]);

  const handleManualAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId || !manualEmails.trim()) return;

    setUploading(true);
    onError('');

    try {
      const emails = manualEmails.split(',').map(email => email.trim()).filter(email => email);
      const results = { added: 0, skipped: 0, errors: [] as string[] };

      for (const email of emails) {
        try {
          const { error } = await supabase
            .from("employees")
            .insert({
              email: email.toLowerCase(),
              company_id: companyId,
            });

          if (error) {
            if (error.code === '23505') { // Unique violation
              results.skipped++;
            } else {
              results.errors.push(`${email}: ${error.message}`);
            }
          } else {
            results.added++;
          }
        } catch (err) {
          results.errors.push(`${email}: Failed to add`);
        }
      }

      if (results.errors.length > 0) {
        onError(`Added ${results.added}, skipped ${results.skipped}, errors: ${results.errors.join('; ')}`);
      } else {
        setManualEmails('');
        onSuccess();
      }
    } catch (err) {
      onError('Failed to add employees');
    } finally {
      setUploading(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    setFile(f);
    if (!f) return setPreview([]);

    try {
      const arrayBuffer = await f.arrayBuffer();
      if (f.name.endsWith('.csv')) {
        const text = new TextDecoder().decode(arrayBuffer);
        const rows = text.split(/\r?\n/).map(line => line.split(',').map(cell => cell.trim()));
        setPreview(rows.slice(0, 10));
      }
    } catch (err) {
      onError('Failed to parse file');
    }
  };

  const handleFileUpload = async () => {
    if (!file || !companyId) return;

    setUploading(true);
    onError('');

    try {
      const arrayBuffer = await file.arrayBuffer();
      const text = new TextDecoder().decode(arrayBuffer);
      const rows = text.split(/\r?\n/).map(line => line.split(',').map(cell => cell.trim()));
      
      // Skip header row if present
      const dataRows = rows[0][0]?.toLowerCase().includes('email') ? rows.slice(1) : rows;
      
      const results = { added: 0, skipped: 0, errors: [] as string[] };

      for (const row of dataRows) {
        if (row.length < 2 || !row[1]) continue; // Need at least company_employee_id and email
        
        const [companyEmployeeId, email] = row;
        
        try {
          const { error } = await supabase
            .from("employees")
            .insert({
              email: email.toLowerCase(),
              company_id: companyId,
              company_employee_id: companyEmployeeId || null,
            });

          if (error) {
            if (error.code === '23505') { // Unique violation
              results.skipped++;
            } else {
              results.errors.push(`${email}: ${error.message}`);
            }
          } else {
            results.added++;
          }
        } catch (err) {
          results.errors.push(`${email}: Failed to add`);
        }
      }

      if (results.errors.length > 0) {
        onError(`Added ${results.added}, skipped ${results.skipped}, errors: ${results.errors.join('; ')}`);
      } else {
        setFile(null);
        setPreview([]);
        onSuccess();
      }
    } catch (err) {
      onError('Failed to upload employees');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Mode Toggle */}
      <div className="flex gap-2">
        <Button
          type="button"
          variant={mode === 'manual' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('manual')}
        >
          Manual Entry
        </Button>
        <Button
          type="button"
          variant={mode === 'upload' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('upload')}
        >
          File Upload
        </Button>
      </div>

      {mode === 'manual' ? (
        <form onSubmit={handleManualAdd} className="space-y-3">
          <div>
            <Label htmlFor="manualEmails">Employee Emails (comma-separated)</Label>
            <textarea
              id="manualEmails"
              className="w-full min-h-[100px] p-3 border border-gray-300 rounded-md resize-vertical"
              placeholder="john@company.com, jane@company.com, bob@company.com"
              value={manualEmails}
              onChange={(e) => setManualEmails(e.target.value)}
              required
            />
            <div className="text-xs text-gray-500 mt-1">
              Enter multiple email addresses separated by commas
            </div>
          </div>
          <Button type="submit" disabled={uploading || !manualEmails.trim()}>
            {uploading ? 'Adding...' : 'Add Employees'}
          </Button>
        </form>
      ) : (
        <div className="space-y-3">
          <div className="mt-4 sm:mt-0">
                <Button asChild variant="outline" size="sm">
                  <a
                    href="https://manugdmjylsvdjemwzcq.supabase.co/storage/v1/object/public/file_format/Sample_Emplyee_No_KPI.xlsx"
                    download
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Download Sample File
                  </a>
                </Button>
              </div>
          <div>
            <Label htmlFor="employeeFile">Upload CSV/XLSX File</Label>
            <Input
              id="employeeFile"
              type="file"
              accept=".csv , .xlsx"
              onChange={handleFileChange}
            />
            <div className="text-xs text-gray-500 mt-1">
              Table format: company_employee_id, email (header row optional)
            </div>
          </div>
          
          {preview.length > 0 && (
            <div>
              <div className="font-semibold mb-1 text-sm">Preview (first 10 rows):</div>
              <div className="border rounded max-h-40 overflow-auto">
                <table className="text-xs w-full">
                  <tbody>
                    {preview.map((row, i) => (
                      <tr key={i} className={i === 0 ? "bg-gray-50" : ""}>
                        <td className="border px-2 py-1">{row[0] || '-'}</td>
                        <td className="border px-2 py-1">{row[1] || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          
          <Button onClick={handleFileUpload} disabled={!file || uploading}>
            {uploading ? 'Uploading...' : 'Upload Employees'}
          </Button>
        </div>
      )}
    </div>
  );
}

// --- KPI Scores Upload UI Component ---
function KPIScoresUpload({ companyId, admin }: { companyId?: string; admin?: Admin | null }) {
  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [preview, setPreview] = useState<string[][]>([]);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ created?: number; updated?: number; skipped?: { row: number; reason: string }[]; affectedEmployees?: string[] } | null>(null);
  const [error, setError] = useState("");

  // Parse file for preview
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
        // Dynamically import xlsx for preview
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
      // For prototype, send companyId in header (never in prod)
      const res = await fetch("/api/admin/kpi/upload-scores", {
        method: "POST",
        body: formData,
        headers: {
          "x-company-id": companyId,
          ...(admin?.id ? { "x-admin-id": admin.id } : {})
        },
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Upload failed");
      } else {
        setResult(json);
        // Reset file input after successful upload
        setFile(null);
        setPreview([]);
        setFileInputKey(prev => prev + 1);
      }
    } catch (err) {
      setError("Upload failed.");
      // Reset file input after failed upload
      setFile(null);
      setPreview([]);
      setFileInputKey(prev => prev + 1);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <div className="flex gap-2 items-center mb-2">
        <Input key={fileInputKey} type="file" accept=".csv,.xlsx" onChange={handleFileChange} />
        <Button onClick={handleUpload} disabled={!file || uploading}>
          {uploading ? "Uploading..." : "Upload"}
        </Button>
      </div>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {preview.length > 0 && (
        <div className="mb-2">
          <div className="font-semibold mb-1">Preview (first 10 rows):</div>
          <table className="text-sm border">
            <tbody>
              {preview.map((row, i) => (
                <tr key={i}>{row.map((cell, j) => <td key={j} className="border px-2 py-1">{cell}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result && (
        <div className="mt-2">
          <div className="font-semibold">Upload Result:</div>
          <div>Created: {result.created || 0}, Updated: {result.updated || 0}</div>
          {result.skipped && result.skipped.length > 0 && (
            <div className="mt-1 text-xs text-gray-500">
            </div>
          )}
          {result.affectedEmployees && (
            <div className="mt-1 text-xs text-gray-500">
              Affected Employees:
              <ul>
                {result.affectedEmployees.map((id, i) => <li key={i}>{id}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface Admin {
  id: string
  email: string
  name: string | null
  company_id: string
}

interface TrainingModule {
  id: string
  title: string
  description: string | null
  content_type: string
  content_url: string
  created_at: string
  gpt_summary: string | null
  transcription: string | null
  ai_modules: string | null
  ai_topics: string | null
  ai_objectives: string | null
  processing_status: string
}

type KPIUploadResult = {
  created?: number;
  updated?: number;
  skipped?: { row: number; reason: string }[];
};

// --- KPI Definitions Upload UI Component ---
function KPIDefinitionsUpload({ companyId }: { companyId?: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string[][]>([]);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<KPIUploadResult | null>(null);
  const [error, setError] = useState("");

  // Parse file for preview
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
        // Dynamically import xlsx for preview
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
      // For prototype, send companyId in header (never in prod)
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
    <div>
      <div className="flex gap-2 items-center mb-2">
        <Input type="file" accept=".csv,.xlsx" onChange={handleFileChange} />
        <Button onClick={handleUpload} disabled={!file || uploading}>
          {uploading ? "Uploading..." : "Upload"}
        </Button>
      </div>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {preview.length > 0 && (
        <div className="mb-2">
          <div className="font-semibold mb-1">Preview (first 10 rows):</div>
          <table className="text-sm border">
            <tbody>
              {preview.map((row, i) => (
                <tr key={i}>{row.map((cell, j) => <td key={j} className="border px-2 py-1">{cell}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result && (
        <div className="mt-2">
          <div className="font-semibold">Upload Result:</div>
          <div>Created: {result.created || 0}, Updated: {result.updated || 0}</div>
          {result.skipped && result.skipped.length > 0 && (
            <div className="mt-1 text-xs text-gray-500">
              Skipped rows:
              <ul>
                {result.skipped.map((s, i) => <li key={i}>Row {s.row}: {s.reason}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AdminDashboard() {
  const { user, loading: authLoading, logout } = useAuth()
  const [admin, setAdmin] = useState<Admin | null>(null)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [trainingModules, setTrainingModules] = useState<TrainingModule[]>([])
  const [newEmployeeEmail, setNewEmployeeEmail] = useState("")
  const [loading, setLoading] = useState(true)
  const [addingEmployee, setAddingEmployee] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const router = useRouter()

  useEffect(() => {
    if (!authLoading) {
      if (!user) {
        router.push("/admin/login")
      } else {
        checkAdminAccess()
      }
    }
  }, [user, authLoading, router])

  const checkAdminAccess = async () => {
    if (!user?.email) return

    try {
      // Get admin data from Supabase
      const { data: adminData, error: adminError } = await supabase
        .from("admins")
        .select("*")
        .eq("email", user.email)
        .single()

      if (adminError || !adminData) {
        router.push("/admin/login")
        return
      }

      setAdmin(adminData)
      await loadEmployees(adminData.company_id)
      await loadTrainingModules(adminData.company_id)
    } catch (error) {
      console.error("Admin access check failed:", error)
      router.push("/admin/login")
    } finally {
      setLoading(false)
    }
  }

  const loadEmployees = async (companyId: string) => {
    try {
      const { data, error } = await supabase
        .from("employees")
        .select("*")
        .eq("company_id", companyId)
        .order("joined_at", { ascending: false })

      if (error) throw error
      setEmployees(data || [])
    } catch (error: any) {
      setError("Failed to load employees: " + error.message)
    }
  }

  const loadTrainingModules = useCallback(async (companyId: string) => {
    try {
      const { data, error } = await supabase
        .from("training_modules")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })

      if (error) throw error
      setTrainingModules(data || [])
    } catch (error: any) {
      setError("Failed to load training modules: " + error.message)
    }
  }, [])

  const addEmployee = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!admin) return

    setAddingEmployee(true)
    setError("")
    setSuccess("")

    try {
      const { data, error } = await supabase
        .from("employees")
        .insert({
          email: newEmployeeEmail,
          company_id: admin.company_id,
        })
        .select()
        .single()

      if (error) throw error

      setEmployees([data, ...employees])
      setNewEmployeeEmail("")
      setSuccess("Employee added successfully!")
    } catch (error: any) {
      setError("Failed to add employee: " + error.message)
    } finally {
      setAddingEmployee(false)
    }
  }

  const removeEmployee = async (employeeId: string) => {
    if (!confirm("Are you sure you want to remove this employee?")) return

    try {
      const { error } = await supabase.from("employees").delete().eq("id", employeeId)

      if (error) throw error

      setEmployees(employees.filter((emp) => emp.id !== employeeId))
      setSuccess("Employee removed successfully!")
    } catch (error: any) {
      setError("Failed to remove employee: " + error.message)
    }
  }

  const handleLogout = async () => {
    await logout()
    router.push("/")
  }

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading dashboard...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Toaster /> {/* Add Toaster component here */}
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center">
              <Building2 className="w-8 h-8 text-blue-600 mr-3" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
                <p className="text-sm text-gray-600">Welcome back, {admin?.name || user?.email}</p>
              </div>
            </div>
            <Button onClick={handleLogout} variant="outline">
              <LogOut className="w-4 h-4 mr-2" />
              Logout
            </Button>
          </div>
        </div>
      </div>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid gap-8">
          {/* KPI Definitions Upload Section */}
          <Card>
            <CardHeader className="sm:flex sm:items-start sm:justify-between">
              <div>
                <CardTitle className="flex items-center">KPI Definitions Upload</CardTitle>
                <CardDescription>Upload a CSV or XLSX file with KPI definitions (KPI, Description, Benchmark, Datatype)</CardDescription>
              </div>
              <div className="mt-4 sm:mt-0">
                <Button asChild variant="outline" size="sm">
                  <a
                    href="https://manugdmjylsvdjemwzcq.supabase.co/storage/v1/object/public/file_format/KPI_Description.xlsx"
                    download
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Download Sample File
                  </a>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <KPIDefinitionsUpload companyId={admin?.company_id} />
            </CardContent>
          </Card>
          {/* KPI Scores Upload Section */}
          <Card>
            <CardHeader className="sm:flex sm:items-start sm:justify-between">
              <div>
                <CardTitle className="flex items-center">KPI Scores Upload</CardTitle>
                <CardDescription>Upload a CSV or XLSX file with KPI scores (Company_Employee_ID, Email, KPI, Score)</CardDescription>
              </div>
              <div className="mt-4 sm:mt-0">
                <Button asChild variant="outline" size="sm">
                  <a
                    href="https://manugdmjylsvdjemwzcq.supabase.co/storage/v1/object/public/file_format/Sample_Emplyee.xlsx"
                    download
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Download Sample File
                  </a>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <KPIScoresUpload companyId={admin?.company_id} admin={admin} />
            </CardContent>
          </Card>
          {/* Add Employee Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                {/* <Plus className="w-5 h-5 mr-2" /> */}
                Add Employees
              </CardTitle>
              <CardDescription>Add employee emails to allow them to access the training portal (No KPIs required)</CardDescription>
            </CardHeader>
            <CardContent>
              <EmployeeBulkAdd companyId={admin?.company_id} onSuccess={() => { loadEmployees(admin?.company_id || ""); setSuccess("Employees added successfully!"); }} onError={setError} />

              {error && ( 
                <Alert variant="destructive" className="mt-4">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {success && (
                <Alert className="mt-4">
                  <AlertDescription>{success}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          {/* Employees List */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Users className="w-5 h-5 mr-2" />
                Allowed Employees ({employees.length})
              </CardTitle>
              <CardDescription>Employees who can access the training portal</CardDescription>
            </CardHeader>
            <CardContent>
              {employees.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>No employees added yet</p>
                  <p className="text-sm">Add employee emails above to get started</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {employees.map((employee) => (
                    <div key={employee.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div>
                        <p className="font-medium text-gray-900">{employee.email}</p>
                        <p className="text-sm text-gray-500">
                          Added {new Date(employee.joined_at).toLocaleDateString()}
                        </p>
                      </div>
                      <Button
                        onClick={() => removeEmployee(employee.id)}
                        variant="outline"
                        size="sm"
                        className="text-red-600 hover:text-red-800"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Content Upload Section */}
          {admin?.company_id && (
            <ContentUpload companyId={admin.company_id} onUploadSuccess={() => loadTrainingModules(admin.company_id)} />
          )}

          {/* Uploaded Files List */}
          <UploadedFilesList modules={trainingModules} onModuleDeleted={() => loadTrainingModules(admin!.company_id)} />
        </div>
      </div>
    </div>
  )
}
