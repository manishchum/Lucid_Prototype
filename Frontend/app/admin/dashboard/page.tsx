"use client"
interface Employee {
  id: string;
  email: string;
  name: string | null;
  joined_at: string;
  department_id?: string | null;
}

interface SubDepartment {
  id: string;
  department_name: string;
  sub_department_name: string;
}

interface Role {
  id: string;
  name: string;
  description?: string;
}

interface Company {
  id: string;
  name: string;
}

// --- Add Employee Modal Component ---
function AddEmployeeModal({ 
  isOpen, 
  onClose, 
  companyId, 
  adminId,
  onSuccess 
}: { 
  isOpen: boolean;
  onClose: () => void;
  companyId: string;
  adminId: string;
  onSuccess: () => void;
}) {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    company_name: '',
    department_id: '',
    role_id: '',
    phone: '',
    position: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{[key: string]: string}>({});
  const [subDepartments, setSubDepartments] = useState<SubDepartment[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);

  // Load dropdown data
  useEffect(() => {
    if (isOpen) {
      loadDropdownData();
    }
  }, [isOpen]);

  const loadDropdownData = async () => {
    try {
      // Load subdepartments
      const { data: subDeptData, error: subDeptError } = await supabase
        .from('sub_department')
        .select('*')
        .order('department_name')
        .order('sub_department_name');

      if (subDeptError) throw subDeptError;
      setSubDepartments(subDeptData || []);

      // Load roles
      const { data: rolesData, error: rolesError } = await supabase
        .from('roles')
        .select('*')
        .order('name');

      if (rolesError) throw rolesError;
      setRoles(rolesData || []);

      // Load companies
      const { data: companiesData, error: companiesError } = await supabase
        .from('companies')
        .select('id, name')
        .order('name');

      if (companiesError) throw companiesError;
      setCompanies(companiesData || []);

    } catch (error) {
      console.error('Failed to load dropdown data:', error);
      setError('Failed to load form data');
    }
  };

  // Email validation function
  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  // Phone validation function  
  const validatePhone = (phone: string): boolean => {
    if (!phone) return true; // Phone is optional
    // Allow various phone formats: +1234567890, (123) 456-7890, 123-456-7890, 123.456.7890, 1234567890
    const phoneRegex = /^[\+]?[\d\s\(\)\-\.]{10,15}$/;
    const digitsOnly = phone.replace(/\D/g, '');
    return phoneRegex.test(phone) && digitsOnly.length >= 10 && digitsOnly.length <= 15;
  };

  // Check if email already exists in database
  const checkEmailExists = async (email: string): Promise<boolean> => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id')
        .eq('email', email.toLowerCase())
        .single();
      
      if (error && error.code !== 'PGRST116') { // PGRST116 is "no rows returned"
        console.error('Error checking email:', error);
        return false;
      }
      
      return !!data; // Returns true if email exists
    } catch (error) {
      console.error('Error checking email:', error);
      return false;
    }
  };

  const handleInputChange = async (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));

    // Clear previous field error
    if (fieldErrors[name]) {
      setFieldErrors(prev => ({
        ...prev,
        [name]: ''
      }));
    }

    // Real-time validation
    if (name === 'email' && value) {
      if (!validateEmail(value)) {
        setFieldErrors(prev => ({
          ...prev,
          email: 'Please enter a valid email address'
        }));
      } else {
        // Check if email already exists
        const emailExists = await checkEmailExists(value);
        if (emailExists) {
          setFieldErrors(prev => ({
            ...prev,
            email: 'An employee with this email already exists'
          }));
        }
      }
    }

    if (name === 'phone' && value) {
      if (!validatePhone(value)) {
        setFieldErrors(prev => ({
          ...prev,
          phone: 'Please enter a valid phone number (10-15 digits)'
        }));
      }
    }
  };

  const validateForm = async (): Promise<boolean> => {
    const errors: {[key: string]: string} = {};

    // Name validation
    if (!formData.name.trim()) {
      errors.name = 'Name is required';
    }

    // Email validation
    if (!formData.email.trim()) {
      errors.email = 'Email is required';
    } else if (!validateEmail(formData.email)) {
      errors.email = 'Please enter a valid email address';
    } else {
      // Check if email already exists
      const emailExists = await checkEmailExists(formData.email);
      if (emailExists) {
        errors.email = 'An employee with this email already exists';
      }
    }

    // Phone validation (optional field)
    if (formData.phone && !validatePhone(formData.phone)) {
      errors.phone = 'Please enter a valid phone number (10-15 digits)';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setFieldErrors({});

    // Validate form
    const isValid = await validateForm();
    if (!isValid) {
      setLoading(false);
      return;
    }

    try {
      // Create user in users table
      const { data: userData, error: userError } = await supabase
        .from('users')
        .insert({
          name: formData.name,
          email: formData.email.toLowerCase(),
          company_id: companyId,
          department_id: formData.department_id || null,
          position: formData.position || null,
          phone: formData.phone || null,
          hire_date: new Date().toISOString().split('T')[0], // Today's date
          employment_status: 'ACTIVE'
        })
        .select()
        .single();

      if (userError) throw userError;

      // If role is selected, create role assignment
      if (formData.role_id) {
        const { error: roleError } = await supabase
          .from('user_role_assignments')
          .insert({
            user_id: userData.id,
            role_id: formData.role_id,
            scope_type: 'COMPANY',
            scope_id: companyId,
            assigned_by: adminId,
            is_active: true
          });

        if (roleError) {
          console.error('Role assignment failed:', roleError);
          // Don't fail the entire operation if role assignment fails
        }
      }

      // Reset form
      setFormData({
        name: '',
        email: '',
        company_name: '',
        department_id: '',
        role_id: '',
        phone: '',
        position: ''
      });
      setFieldErrors({});

      onSuccess();
      onClose();

    } catch (error: any) {
      console.error('Failed to create user:', error);
      if (error.code === '23505' && error.message.includes('email')) {
        setFieldErrors(prev => ({
          ...prev,
          email: 'An employee with this email already exists'
        }));
      } else {
        setError('Failed to create employee: ' + error.message);
      }
    } finally {
      setLoading(false);
    }
  };

  // Get unique departments
  const departments = Array.from(new Set(subDepartments.map(sd => sd.department_name)));

  // Get subdepartments for selected department
  const selectedDepartmentName = subDepartments.find(sd => sd.id === formData.department_id)?.department_name;
  const availableSubDepartments = selectedDepartmentName 
    ? subDepartments.filter(sd => sd.department_name === selectedDepartmentName)
    : subDepartments;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold text-gray-900">Add New Employee</h2>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
            >
              ✕
            </Button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Name and Email */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="name">Name *</Label>
                <Input
                  id="name"
                  name="name"
                  type="text"
                  value={formData.name}
                  onChange={handleInputChange}
                  required
                  placeholder="Enter full name"
                  className={fieldErrors.name ? 'border-red-500' : ''}
                />
                {fieldErrors.name && (
                  <p className="text-red-500 text-sm mt-1">{fieldErrors.name}</p>
                )}
              </div>
              <div>
                <Label htmlFor="email">Email *</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  required
                  placeholder="employee@company.com"
                  className={fieldErrors.email ? 'border-red-500' : ''}
                />
                {fieldErrors.email && (
                  <p className="text-red-500 text-sm mt-1">{fieldErrors.email}</p>
                )}
              </div>
            </div>

            {/* Company Name */}
            <div>
              <Label htmlFor="company_name">Company Name</Label>
              <select
                id="company_name"
                name="company_name"
                value={formData.company_name}
                onChange={handleInputChange}
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Select Company</option>
                {companies.map(company => (
                  <option key={company.id} value={company.name}>
                    {company.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Department and Subdepartment */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="department_id">Department</Label>
                <select
                  id="department_id"
                  name="department_id"
                  value={formData.department_id}
                  onChange={handleInputChange}
                  className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">Select Department</option>
                  {availableSubDepartments.map(subDept => (
                    <option key={subDept.id} value={subDept.id}>
                      {subDept.department_name} - {subDept.sub_department_name}
                    </option>
                  ))}
                </select>
                <div className="text-xs text-gray-500 mt-1">
                  This will assign both department and subdepartment
                </div>
              </div>
              
              <div>
                <Label htmlFor="role_id">Role</Label>
                <select
                  id="role_id"
                  name="role_id"
                  value={formData.role_id}
                  onChange={handleInputChange}
                  className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">Select Role</option>
                  {roles.map(role => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Position and Phone */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="position">Position/Job Title</Label>
                <Input
                  id="position"
                  name="position"
                  type="text"
                  value={formData.position}
                  onChange={handleInputChange}
                  placeholder="e.g., Software Engineer, Manager"
                />
              </div>
              <div>
                <Label htmlFor="phone">Phone Number</Label>
                <Input
                  id="phone"
                  name="phone"
                  type="tel"
                  value={formData.phone}
                  onChange={handleInputChange}
                  placeholder="+1 (555) 123-4567"
                  className={fieldErrors.phone ? 'border-red-500' : ''}
                />
                {fieldErrors.phone && (
                  <p className="text-red-500 text-sm mt-1">{fieldErrors.phone}</p>
                )}
                <div className="text-xs text-gray-500 mt-1">
                  Formats: +1234567890, (123) 456-7890, 123-456-7890
                </div>
              </div>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* Form Actions */}
            <div className="flex gap-3 pt-4 border-t">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={loading || !formData.name || !formData.email || !!fieldErrors.email || !!fieldErrors.phone || !!fieldErrors.name}
              >
                {loading ? 'Creating...' : 'Create Employee'}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// --- Employee Bulk Add UI Component ---
function EmployeeBulkAdd({ companyId, adminId, onSuccess, onError }: { companyId?: string; adminId?: string; onSuccess: () => void; onError: (error: string) => void }) {
  const [mode, setMode] = useState<'manual' | 'upload' | 'detailed'>('detailed');
  const [showModal, setShowModal] = useState(false);
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
      } else if (f.name.endsWith('.xlsx')) {
        // Dynamically import xlsx for preview
        const xlsx = await import("xlsx");
        const workbook = xlsx.read(arrayBuffer, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });
        setPreview((rows as string[][]).slice(0, 10));
      } else {
        onError('Unsupported file type. Only CSV or XLSX allowed.');
        setPreview([]);
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
      let rows: string[][];
      
      if (file.name.endsWith('.csv')) {
        const text = new TextDecoder().decode(arrayBuffer);
        rows = text.split(/\r?\n/).map(line => line.split(',').map(cell => cell.trim()));
      } else if (file.name.endsWith('.xlsx')) {
        // Dynamically import xlsx for processing
        const xlsx = await import("xlsx");
        const workbook = xlsx.read(arrayBuffer, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        rows = xlsx.utils.sheet_to_json(sheet, { header: 1 }) as string[][];
      } else {
        onError('Unsupported file type. Only CSV or XLSX allowed.');
        return;
      }
      
      // Skip header row if present - check for common header patterns
      const isHeaderRow = (row: string[]) => {
        if (!row || row.length === 0) return false;
        const firstCell = row[0]?.toLowerCase().trim() || '';
        const secondCell = row[1]?.toLowerCase().trim() || '';
        
        // Check if first row contains common header keywords
        return (
          firstCell.includes('company') || 
          firstCell.includes('employee') || 
          firstCell.includes('id') ||
          secondCell.includes('email') ||
          secondCell.includes('mail') ||
          // Check if it looks like an email pattern (contains @ and .)
          !(secondCell.includes('@') && secondCell.includes('.'))
        );
      };
      
      const dataRows = (rows.length > 0 && isHeaderRow(rows[0])) ? rows.slice(1) : rows;
      
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
          variant={mode === 'detailed' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('detailed')}
        >
          <Plus className="w-4 h-4 mr-1" />
          Add Employee
        </Button>
        {/* <Button
          type="button"
          variant={mode === 'manual' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('manual')}
        >
          Bulk Email Entry
        </Button> */}
        <Button
          type="button"
          variant={mode === 'upload' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('upload')}
        >
          File Upload
        </Button>
      </div>

      {mode === 'detailed' ? (
        <div className="text-center py-8">
          <Users className="w-12 h-12 mx-auto mb-4 text-blue-500" />
          <p className="text-gray-600 mb-4">Create a new employee with complete details</p>
          <Button
            onClick={() => setShowModal(true)}
            className="bg-blue-600 hover:bg-blue-700"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add New Employee
          </Button>
        </div>
      ) : mode === 'manual' ? (
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
              accept=".csv,.xlsx"
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

      {/* Add Employee Modal */}
      <AddEmployeeModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        companyId={companyId || ''}
        adminId={adminId || ''}
        onSuccess={() => {
          onSuccess();
          setShowModal(false);
        }}
      />
    </div>
  );
}


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

// --- Department Filter Component ---
function DepartmentFilter({ employees }: { employees: Employee[] }) {
  const [subDepartments, setSubDepartments] = useState<SubDepartment[]>([]);
  const [selectedDepartments, setSelectedDepartments] = useState<string[]>([]);
  const [selectedSubDepartments, setSelectedSubDepartments] = useState<string[]>([]);
  const [filteredEmployees, setFilteredEmployees] = useState<Employee[]>([]);
  const [showDepartmentDropdown, setShowDepartmentDropdown] = useState(false);
  const [showSubDepartmentDropdown, setShowSubDepartmentDropdown] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load subdepartments from Supabase
  useEffect(() => {
    const loadSubDepartments = async () => {
      try {
        const { data, error } = await supabase
          .from('sub_department')
          .select('*')
          .order('department_name')
          .order('sub_department_name');

        if (error) throw error;
        setSubDepartments(data || []);
      } catch (error) {
        console.error('Failed to load sub departments:', error);
      } finally {
        setLoading(false);
      }
    };

    loadSubDepartments();
  }, []);

  // Get unique departments
  const departments = Array.from(new Set(subDepartments.map(sd => sd.department_name)));

  // Get filtered subdepartments based on selected departments
  const availableSubDepartments = selectedDepartments.length > 0
    ? subDepartments.filter(sd => selectedDepartments.includes(sd.department_name))
    : subDepartments;

  // Filter employees based on selections
  useEffect(() => {
    let filtered = employees;
    
    if (selectedSubDepartments.length > 0) {
      const selectedSubDeptIds = subDepartments
        .filter(sd => selectedSubDepartments.includes(sd.id))
        .map(sd => sd.id);
      
      filtered = filtered.filter(emp => 
        emp.department_id && selectedSubDeptIds.includes(emp.department_id)
      );
    } else if (selectedDepartments.length > 0) {
      const selectedDeptSubDeptIds = subDepartments
        .filter(sd => selectedDepartments.includes(sd.department_name))
        .map(sd => sd.id);
      
      filtered = filtered.filter(emp => 
        emp.department_id && selectedDeptSubDeptIds.includes(emp.department_id)
      );
    }
    console.log(filtered)
    setFilteredEmployees(filtered);
  }, [employees, selectedDepartments, selectedSubDepartments, subDepartments]);

  const handleDepartmentToggle = (department: string) => {
    setSelectedDepartments(prev => {
      const newSelection = prev.includes(department)
        ? prev.filter(d => d !== department)
        : [...prev, department];
      
      // Clear subdepartment selections when department selection changes
      if (newSelection.length !== prev.length) {
        setSelectedSubDepartments([]);
      }
      
      return newSelection;
    });
  };

  const handleSubDepartmentToggle = (subDepartmentId: string) => {
    setSelectedSubDepartments(prev =>
      prev.includes(subDepartmentId)
        ? prev.filter(id => id !== subDepartmentId)
        : [...prev, subDepartmentId]
    );
  };

  const selectAllDepartments = () => {
    setSelectedDepartments(departments);
    setSelectedSubDepartments([]);
  };

  const clearDepartments = () => {
    setSelectedDepartments([]);
    setSelectedSubDepartments([]);
  };

  const selectAllSubDepartments = () => {
    const allSubDeptIds = availableSubDepartments.map(sd => sd.id);
    setSelectedSubDepartments(allSubDeptIds);
  };

  const clearSubDepartments = () => {
    setSelectedSubDepartments([]);
  };

  const getEmployeeDepartmentInfo = (employee: Employee) => {
    if (!employee.department_id) return null;
    return subDepartments.find(sd => sd.id === employee.department_id);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-2 text-gray-600">Loading departments...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filter Controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Department Selection */}
        <div className="space-y-2">
          <Label>Departments</Label>
          <div className="relative">
            <Button
              type="button"
              variant="outline"
              className="w-full justify-between"
              onClick={() => setShowDepartmentDropdown(!showDepartmentDropdown)}
            >
              <span>
                {selectedDepartments.length === 0
                  ? "Select Departments"
                  : `${selectedDepartments.length} department${selectedDepartments.length === 1 ? '' : 's'} selected`}
              </span>
              <span className="ml-2">▼</span>
            </Button>
            
            {showDepartmentDropdown && (
              <div className="absolute top-full left-0 right-0 z-10 mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-64 overflow-y-auto">
                {/* Action buttons */}
                <div className="p-2 border-b bg-gray-50 flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={selectAllDepartments}
                    className="text-xs"
                  >
                    Select All
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={clearDepartments}
                    className="text-xs"
                  >
                    Clear All
                  </Button>
                </div>
                
                {/* Department grid */}
                <div className="p-2 grid grid-cols-2 gap-2">
                  {departments.map(department => (
                    <label
                      key={department}
                      className="flex items-center space-x-2 p-2 hover:bg-gray-50 rounded cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedDepartments.includes(department)}
                        onChange={() => handleDepartmentToggle(department)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm">{department}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Subdepartment Selection */}
        <div className="space-y-2">
          <Label>Subdepartments</Label>
          <div className="relative">
            <Button
              type="button"
              variant="outline"
              className="w-full justify-between"
              onClick={() => setShowSubDepartmentDropdown(!showSubDepartmentDropdown)}
              disabled={availableSubDepartments.length === 0}
            >
              <span>
                {selectedSubDepartments.length === 0
                  ? "Select Subdepartments"
                  : `${selectedSubDepartments.length} subdepartment${selectedSubDepartments.length === 1 ? '' : 's'} selected`}
              </span>
              <span className="ml-2">▼</span>
            </Button>
            
            {showSubDepartmentDropdown && availableSubDepartments.length > 0 && (
              <div className="absolute top-full left-0 right-0 z-10 mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-64 overflow-y-auto">
                {/* Action buttons */}
                <div className="p-2 border-b bg-gray-50 flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={selectAllSubDepartments}
                    className="text-xs"
                  >
                    Select All
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={clearSubDepartments}
                    className="text-xs"
                  >
                    Clear All
                  </Button>
                </div>
                
                {/* Subdepartment grid */}
                <div className="p-2 grid grid-cols-2 gap-2">
                  {availableSubDepartments.map(subDept => (
                    <label
                      key={subDept.id}
                      className="flex items-center space-x-2 p-2 hover:bg-gray-50 rounded cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedSubDepartments.includes(subDept.id)}
                        onChange={() => handleSubDepartmentToggle(subDept.id)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm">{subDept.sub_department_name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Results Summary */}
      <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg p-3">
        <div className="text-sm text-blue-800">
          <span className="font-medium">{filteredEmployees.length}</span> employees found
          {selectedDepartments.length > 0 && (
            <span> in <span className="font-medium">{selectedDepartments.length}</span> department{selectedDepartments.length === 1 ? '' : 's'}</span>
          )}
          {selectedSubDepartments.length > 0 && (
            <span> • <span className="font-medium">{selectedSubDepartments.length}</span> subdepartment{selectedSubDepartments.length === 1 ? '' : 's'}</span>
          )}
        </div>
        {(selectedDepartments.length > 0 || selectedSubDepartments.length > 0) && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setSelectedDepartments([]);
              setSelectedSubDepartments([]);
            }}
          >
            Clear Filters
          </Button>
        )}
      </div>

      {/* Selected Items Display */}
      {(selectedDepartments.length > 0 || selectedSubDepartments.length > 0) && (
        <div className="space-y-2">
          {selectedDepartments.length > 0 && (
            <div>
              <span className="text-sm font-medium text-gray-700">Selected Departments:</span>
              <div className="flex flex-wrap gap-2 mt-1">
                {selectedDepartments.map(dept => (
                  <span key={dept} className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs">
                    {dept}
                  </span>
                ))}
              </div>
            </div>
          )}
          {selectedSubDepartments.length > 0 && (
            <div>
              <span className="text-sm font-medium text-gray-700">Selected Subdepartments:</span>
              <div className="flex flex-wrap gap-2 mt-1">
                {selectedSubDepartments.map(subDeptId => {
                  const subDept = subDepartments.find(sd => sd.id === subDeptId);
                  return subDept ? (
                    <span key={subDeptId} className="bg-green-100 text-green-800 px-2 py-1 rounded text-xs">
                      {subDept.sub_department_name}
                    </span>
                  ) : null;
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Employee List */}
      {filteredEmployees.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>No employees found</p>
          <p className="text-sm">
            {selectedDepartments.length === 0 && selectedSubDepartments.length === 0
              ? "Select departments or subdepartments to view employees"
              : "Try adjusting your filter criteria"}
          </p>
        </div>
      ) : (
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {filteredEmployees.map((employee) => {
            const deptInfo = getEmployeeDepartmentInfo(employee);
            return (
              <div key={employee.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border">
                <div className="flex-1">
                  <p className="font-medium text-gray-900">{employee.email}</p>
                  <div className="flex gap-4 text-sm text-gray-500 mt-1">
                    <span>Added {new Date(employee.joined_at).toLocaleDateString()}</span>
                    {deptInfo && (
                      <>
                        <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs">
                          {deptInfo.department_name}
                        </span>
                        <span className="bg-green-100 text-green-800 px-2 py-1 rounded text-xs">
                          {deptInfo.sub_department_name}
                        </span>
                      </>
                    )}
                  </div>
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
            );
          })}
        </div>
      )}
      
      {/* Click outside handlers */}
      {(showDepartmentDropdown || showSubDepartmentDropdown) && (
        <div 
          className="fixed inset-0 z-0" 
          onClick={() => {
            setShowDepartmentDropdown(false);
            setShowSubDepartmentDropdown(false);
          }}
        />
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
        .from("users")
        .select("*")
        .eq("company_id", companyId)
        .order("hire_date", { ascending: false })

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
                <Users className="w-5 h-5 mr-2" />
                Manage Employees
              </CardTitle>
              <CardDescription>Add employees individually with complete details or in bulk using email lists or file uploads</CardDescription>
            </CardHeader>
            <CardContent>
              <EmployeeBulkAdd 
                companyId={admin?.company_id} 
                adminId={admin?.id}
                onSuccess={() => { 
                  loadEmployees(admin?.company_id || ""); 
                  setSuccess("Employee added successfully!"); 
                }} 
                onError={setError} 
              />

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

          {/* Department Filter Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Users className="w-5 h-5 mr-2" />
                Filter Employees by Department
              </CardTitle>
              <CardDescription>View and manage employees by department and subdepartment</CardDescription>
            </CardHeader>
            <CardContent>
              <DepartmentFilter employees={employees} />
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
