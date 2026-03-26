import React, { useState, useEffect } from 'react';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { supabase } from "@/lib/supabase";
import { fetchWithAuth } from '@/lib/fetch-with-auth';

interface Employee {
  user_id: string;
  email: string;
  name: string | null;
  hire_date: string;
  department_id?: string | null;
  phone?: string | null;
  position?: string | null;
  employment_status?: string | null;
}

interface SubDepartment {
  department_id: string;
  department_name: string;
  sub_department_name: string;
}

interface Role {
  role_id: string;
  name: string;
  description?: string;
}

interface Company {
  company_id: string;
  name: string;
}

interface UpdateEmployeeModalProps {
  isOpen: boolean;
  onClose: () => void;
  employee: Employee;
  currentRole?: string[];
  onSuccess: () => void;
  adminId?: string; // <-- added: id of the admin performing changes (optional)
}

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL;

const UpdateEmployeeModal: React.FC<UpdateEmployeeModalProps> = ({
  isOpen,
  onClose,
  employee,
  currentRole,
  onSuccess,
  adminId
}) => {
  const [formData, setFormData] = useState({
    name: employee.name || '',
    email: employee.email || '',
    phone: employee.phone || '',
    position: employee.position || '',
    department_id: employee.department_id || '',
    employment_status: employee.employment_status || 'ACTIVE',
    selected_roles: [] as string[]
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{[key: string]: string}>({});
  const [subDepartments, setSubDepartments] = useState<SubDepartment[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [currentRoleAssignments, setCurrentRoleAssignments] = useState<string[]>([]);
  const [currentAssignments, setCurrentAssignments] = useState<any[]>([]); // holds assignment objects from backend

  // Load dropdown data when modal opens
  useEffect(() => {
    if (isOpen) {
      loadDropdownData();
      // Reset form data when employee changes
      setFormData({
        name: employee.name || '',
        email: employee.email || '',
        phone: employee.phone || '',
        position: employee.position || '',
        department_id: employee.department_id || '',
        employment_status: employee.employment_status || 'ACTIVE',
        selected_roles: []
      });
      setError('');
      setFieldErrors({});
      loadCurrentRoles();
    }
  }, [isOpen, employee]);

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
        .select('role_id, name, description')
        .order('name');

      if (rolesError) throw rolesError;
      setRoles(rolesData || []);
    } catch (error) {
      // console.error('Failed to load dropdown data:', error);
      setError('Failed to load form data');
    }
  };

  const loadCurrentRoles = async () => {
    try {
      // Use backend API to fetch role assignments (migrated off frontend DB access)
      const requesterId = (typeof (adminId as any) !== 'undefined') ? (adminId as string) : employee.user_id;
      const res = await fetchWithAuth(`${API_BASE}/api/roles/users/${encodeURIComponent(employee.user_id)}`, {
        headers: { 'X-User-ID': requesterId }
      });

      if (!res.ok) {
        // treat as no roles rather than hard failure
        setCurrentAssignments([]);
        setCurrentRoleAssignments([]);
        setFormData(prev => ({ ...prev, selected_roles: [] }));
        return;
      }

      const payload = await res.json().catch(() => ({}));
      const assignments = payload?.assignments ?? payload?.data ?? payload ?? [];
      const roleIds = (assignments || []).map((a: any) => a.role_id).filter(Boolean);
      setCurrentAssignments(assignments || []);
      setCurrentRoleAssignments(roleIds);
      setFormData(prev => ({ ...prev, selected_roles: [...roleIds] }));
    } catch (error) {
      // console.error('Failed to load current roles:', error);
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
    const phoneRegex = /^[\+]?[\d\s\(\)\-\.]{10,15}$/;
    const digitsOnly = phone.replace(/\D/g, '');
    return phoneRegex.test(phone) && digitsOnly.length >= 10 && digitsOnly.length <= 15;
  };

  // Check if email already exists (excluding current employee)
  const checkEmailExists = async (email: string): Promise<boolean> => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/users/by-email/${encodeURIComponent(email)}`);
      if (res.status === 404) return false;
      if (!res.ok) {
        console.error('Failed to check email existence:', await res.text().catch(() => res.statusText));
        return false;
      }
      const payload = await res.json();
      let found = payload?.user ?? payload;
      if (Array.isArray(found)) found = found[0];
      if (!found) return false;
      return String(found.user_id) !== String(employee.user_id);
    } catch (error) {
      console.error('Failed to check email existence:', error);
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
      } else if (value.toLowerCase() !== employee.email.toLowerCase()) {
        // Only check for duplicates if email has changed
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

  const handleRoleToggle = (roleId: string) => {
    setFormData(prev => ({
      ...prev,
      selected_roles: prev.selected_roles.includes(roleId)
        ? prev.selected_roles.filter(id => id !== roleId)
        : [...prev.selected_roles, roleId]
    }));
  };

  const selectAllRoles = () => {
    setFormData(prev => ({
      ...prev,
      selected_roles: roles.map(role => role.role_id)
    }));
  };

  const clearAllRoles = () => {
    setFormData(prev => ({
      ...prev,
      selected_roles: []
    }));
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
    } else if (formData.email.toLowerCase() !== employee.email.toLowerCase()) {
      // Check if email already exists if it has changed
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
      const updateRes = await fetchWithAuth(`${API_BASE}/api/users/${encodeURIComponent(employee.user_id)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: formData.name,
          email: formData.email.toLocaleLowerCase(),
          department_id: formData.department_id || null,
          position: formData.phone || null,
          phone: formData.position || null,
          employment_status: formData.employment_status
        })
      });

      if (!updateRes.ok) {
        const txt = await updateRes.text().catch(() => '');
        const status = updateRes.status;
        const msg = txt || updateRes.statusText || 'Failed to update user';
        if (status === 409 || (msg && msg.toLowerCase().includes('email'))) {
          setFieldErrors(prev => ({ ...prev, email: 'An employee with this email already exists' }));
          throw new Error('Email already exists');
        }
        throw new Error(msg);
      }

      // Handle role assignment changes via backend routes
      const requesterId = (typeof (adminId as any) !== 'undefined') ? (adminId as string) : employee.user_id;
      const currentRoleSet = new Set(currentRoleAssignments);
      const newRoleSet = new Set(formData.selected_roles);

      // Revoke (deactivate) assignments that are no longer selected
      const rolesToDeactivate = currentRoleAssignments.filter(roleId => !newRoleSet.has(roleId));
      if (rolesToDeactivate.length > 0) {
        // find matching assignment ids from currentAssignments
        const assignmentsToRevoke = (currentAssignments || []).filter((a: any) => rolesToDeactivate.includes(a.role_id));
        for (const a of assignmentsToRevoke) {
          try {
            await fetchWithAuth(`${API_BASE}/api/roles/assignments/${encodeURIComponent(a.user_role_assignment_id)}`, {
              method: 'DELETE',
              headers: { 'X-User-ID': requesterId }
            });
          } catch (err) {
            console.error('Failed to revoke role assignment', a, err);
          }
        }
      }

      // Add new roles that weren't previously assigned
      const rolesToAdd = formData.selected_roles.filter(roleId => !currentRoleSet.has(roleId));
      if (rolesToAdd.length > 0) {
        for (const roleId of rolesToAdd) {
          try {
            await fetchWithAuth(`${API_BASE}/api/roles/assignments`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-User-ID': requesterId
              },
              body: JSON.stringify({
                user_id: employee.user_id,
                role_id: roleId,
                scope_type: 'COMPANY',
                scope_id: employee.department_id || null,
                notes: 'Assigned via admin UI'
              })
            });
          } catch (err) {
            console.error('Failed to create role assignment for role', roleId, err);
          }
        }
      }

      onSuccess();
      onClose();

    } catch (error: any) {
      console.error('Failed to update employee:', error);
      if (error.code === '23505' && error.message.includes('email')) {
        setFieldErrors(prev => ({
          ...prev,
          email: 'An employee with this email already exists'
        }));
      } else {
        setError('Failed to update employee: ' + error.message);
      }
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold text-gray-900">Update Employee</h2>
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

            {/* Department and Employment Status */}
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
                  {subDepartments.map(subDept => (
                    <option key={subDept.department_id} value={subDept.department_id}>
                      {subDept.department_name} - {subDept.sub_department_name}
                    </option>
                  ))}
                </select>
                <div className="text-xs text-gray-500 mt-1">
                  This will assign both department and subdepartment
                </div>
              </div>
              
              <div>
                <Label htmlFor="employment_status">Employment Status</Label>
                <select
                  id="employment_status"
                  name="employment_status"
                  value={formData.employment_status}
                  onChange={handleInputChange}
                  className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="ACTIVE">Active</option>
                  <option value="INACTIVE">Inactive</option>
                  <option value="TERMINATED">Terminated</option>
                  <option value="ON_LEAVE">On Leave</option>
                </select>
              </div>
            </div>

            {/* Multiple Role Selection */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Roles (Select Multiple)</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={selectAllRoles}
                    disabled={formData.selected_roles.length === roles.length}
                  >
                    Select All
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={clearAllRoles}
                    disabled={formData.selected_roles.length === 0}
                  >
                    Clear All
                  </Button>
                </div>
              </div>

              <div className="border border-gray-300 rounded-md max-h-40 overflow-y-auto">
                {roles.length === 0 ? (
                  <div className="p-3 text-gray-500 text-center">No roles available</div>
                ) : (
                  <div className="p-2 space-y-2">
                    {roles.map(role => (
                      <label
                        key={role.role_id}
                        className="flex items-center space-x-3 p-2 hover:bg-gray-50 rounded cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={formData.selected_roles.includes(role.role_id)}
                          onChange={() => handleRoleToggle(role.role_id)}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <div className="flex-1">
                          <span className="font-medium text-gray-900">{role.name}</span>
                          {role.description && (
                            <p className="text-sm text-gray-500">{role.description}</p>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {currentRole && currentRole.length > 0 && (
                <div className="mt-2">
                  <span className="text-xs text-blue-600">
                    Current roles: {currentRole.join(', ')}
                  </span>
                </div>
              )}

              <div className="text-xs text-gray-500 mt-1">
                Selected: {formData.selected_roles.length} role{formData.selected_roles.length === 1 ? '' : 's'}
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

            {/* Employee Info Display */}
            <div className="bg-gray-50 p-4 rounded-lg">
              <h4 className="text-sm font-medium text-gray-700 mb-2">Employee Information</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-500">Employee ID:</span>
                  <span className="ml-2 font-mono">{employee.user_id}</span>
                </div>
                <div>
                  <span className="text-gray-500">Joined Date:</span>
                  <span className="ml-2">{new Date(employee.hire_date).toLocaleDateString()}</span>
                </div>
              </div>
              
              {/* Current Roles Display */}
              <div className="mt-3">
                <span className="text-gray-500 block mb-2">Current Roles:</span>
                <div className="flex flex-wrap gap-1">
                  {currentRole && currentRole.length > 0 ? (
                    currentRole.map((role, index) => (
                      <span key={index} className="bg-purple-100 text-purple-800 px-2 py-1 rounded text-xs">
                        {role}
                      </span>
                    ))
                  ) : (
                    <span className="text-gray-400 text-xs">No Roles Assigned</span>
                  )}
                </div>
              </div>

              {/* Selected Roles Preview */}
              {formData.selected_roles.length > 0 && (
                <div className="mt-3">
                  <span className="text-gray-500 block mb-2">Selected Roles ({formData.selected_roles.length}):</span>
                  <div className="flex flex-wrap gap-1">
                    {formData.selected_roles.map(roleId => {
                      const role = roles.find(r => r.role_id === roleId);
                      return role ? (
                        <span key={roleId} className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs">
                          {role.name}
                        </span>
                      ) : null;
                    })}
                  </div>
                </div>
              )}
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
                {loading ? 'Updating...' : 'Update Employee'}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default UpdateEmployeeModal;