'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/auth-context';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Users, 
  UserPlus, 
  Edit, 
  Trash2, 
  Plus, 
  BookOpen, 
  X, 
  Upload as UploadIcon,
  Filter,
  Search,
  Building2,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { toast as shadcnToast } from '@/hooks/use-toast';

// Types
interface Admin {
  user_id: string;
  email: string;
  name: string | null;
  company_id: string;
}

interface User {
  user_id: string;
  company_id: string;
  name: string;
  email: string;
  phone?: string;
  position?: string;
  hire_date: string;
  employment_status: string;
  department_id?: string;
  manager_id?: string;
  avatar_url?: string;
  last_login?: string;
  login_count?: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  department?: {
    department_name: string;
    sub_department_name?: string;
    department_id: string;
  };
  role?: {
    name: string;
    display_name: string;
    level: number;
  };
}

interface Department {
  department_id: string;
  department_name: string;
  sub_department_name?: string;
  created_at: string;
}

interface Role {
  role_id: string;
  name: string;
  display_name: string;
  level: number;
  permissions: any;
  description?: string;
  is_active: boolean;
}

interface TrainingModule {
  module_id: string;
  title: string;
  description?: string;
  content_type: string;
  created_at: string;
}

export default function EmployeesPage() {
  const { user } = useAuth();
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<User[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showBulkAssignModal, setShowBulkAssignModal] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [trainingModules, setTrainingModules] = useState<TrainingModule[]>([]);
  const [learningPlans, setLearningPlans] = useState<any[]>([]);
  const [showAssignmentsView, setShowAssignmentsView] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<User | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  
  // Filter states
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedRole, setSelectedRole] = useState<string>('all');
  const [showFilters, setShowFilters] = useState(false);
  // Add new department filtering states
  const [selectedDepartments, setSelectedDepartments] = useState<string[]>([]);
  const [selectedSubDepartments, setSelectedSubDepartments] = useState<string[]>([]);
  const [showDepartmentDropdown, setShowDepartmentDropdown] = useState(false);
  const [showSubDepartmentDropdown, setShowSubDepartmentDropdown] = useState(false);

  useEffect(() => {
    if (user?.email) {
      checkAdminAccess();
    }
  }, [user]);

  useEffect(() => {
    if (admin?.company_id) {
      loadUsers(admin.company_id);
      loadDepartments(admin.company_id);
      loadTrainingModules(admin.company_id);
      loadLearningPlans(admin.company_id);
      loadRoles();
    }
  }, [admin]);

  // Filter users when filters change
  useEffect(() => {
    filterUsers();
  }, [users, searchTerm, selectedDepartment, selectedStatus, selectedRole, selectedDepartments, selectedSubDepartments]);

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
        setError("User not found or inactive");
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
        .eq("scope_type", "COMPANY");

      if (roleError || !roleData || roleData.length === 0) {
        setError("No active roles found for user");
        return;
      }

      // Check if user has Admin role
      const hasAdminRole = roleData.some((assignment: any) => 
        ['admin', 'super_admin', 'ceo'].includes(assignment.roles?.name?.toLowerCase())
      );

      if (!hasAdminRole) {
        setError("Admin access required");
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
    } catch (error: any) {
      setError(`Authentication error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const loadUsers = async (companyId: string) => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select(`
          *,
          department:sub_department(department_name, sub_department_name, department_id)
        `)
        .eq('company_id', companyId)
        .eq('is_active', true);

      if (error) throw error;

      // Load role assignments for each user
      const usersWithRoles = await Promise.all(
        (data || []).map(async (user:any) => {
          const { data: roleAssignments } = await supabase
            .from('user_role_assignments')
            .select(`
              *,
              role:roles(name, display_name, level)
            `)
            .eq('user_id', user.user_id)
            .eq('is_active', true)
            .limit(1);

          return {
            ...user,
            role: roleAssignments?.[0]?.role
          };
        })
      );

      setUsers(usersWithRoles);
    } catch (error: any) {
      setError(`Failed to load users: ${error.message}`);
    }
  };

  const loadDepartments = async (companyId: string) => {
    try {
      // Note: Assuming departments are linked to company via users
      const { data, error } = await supabase
        .from('sub_department')
        .select('*');

      if (error) throw error;
      setDepartments(data || []);
    } catch (error: any) {
      console.error('Failed to load departments:', error.message);
    }
  };

  const loadRoles = async () => {
    try {
      const { data, error } = await supabase
        .from('roles')
        .select('*')
        .eq('is_active', true);

      if (error) throw error;
      setRoles(data || []);
    } catch (error: any) {
      console.error('Failed to load roles:', error.message);
    }
  };

  const loadTrainingModules = async (companyId: string) => {
    try {
      const { data, error } = await supabase
        .from('training_modules')
        .select('*')
        .eq('company_id', companyId);

      if (error) throw error;
      setTrainingModules(data || []);
    } catch (error: any) {
      console.error('Failed to load training modules:', error.message);
    }
  };

  const loadLearningPlans = async (companyId: string) => {
    try {
      const { data, error } = await supabase
        .from('learning_plan')
        .select(`
          *,
          training_modules(title, description),
          users(name, email)
        `)
        .eq('users.company_id', companyId);

      if (error) throw error;
      setLearningPlans(data || []);
    } catch (error: any) {
      console.error('Failed to load learning plans:', error.message);
    }
  };

  const filterUsers = () => {
    let filtered = users;

    // Search filter
    if (searchTerm) {
      filtered = filtered.filter(user => 
        user.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        user.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        user.position?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // New department filtering logic (replaces old single department filter)
    if (selectedSubDepartments.length > 0) {
      filtered = filtered.filter(user => 
        user.department_id && selectedSubDepartments.includes(user.department_id)
      );
    } else if (selectedDepartments.length > 0) {
      const selectedDeptSubDeptIds = departments
        .filter(dept => selectedDepartments.includes(dept.department_name))
        .map(dept => dept.department_id);
      
      filtered = filtered.filter(user => 
        user.department_id && selectedDeptSubDeptIds.includes(user.department_id)
      );
    }

    // Status filter
    if (selectedStatus && selectedStatus !== 'all') {
      filtered = filtered.filter(user => user.employment_status === selectedStatus);
    }

    // Role filter
    if (selectedRole && selectedRole !== 'all') {
      filtered = filtered.filter(user => user.role?.name === selectedRole);
    }

    setFilteredUsers(filtered);
  };

  // Department selection handlers
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
    const uniqueDepartments = Array.from(new Set(departments.map(dept => dept.department_name)));
    setSelectedDepartments(uniqueDepartments);
    setSelectedSubDepartments([]);
  };

  const clearDepartments = () => {
    setSelectedDepartments([]);
    setSelectedSubDepartments([]);
  };

  const selectAllSubDepartments = () => {
    const availableSubDepartments = selectedDepartments.length > 0
      ? departments.filter(dept => selectedDepartments.includes(dept.department_name))
      : departments;
    const allSubDeptIds = availableSubDepartments.map(dept => dept.department_id);
    setSelectedSubDepartments(allSubDeptIds);
  };

  const clearSubDepartments = () => {
    setSelectedSubDepartments([]);
  };

  const handleDepartmentChange = (departmentId: string) => {
    setSelectedDepartment(departmentId);
  };

  const handleSelectUser = (userId: string) => {
    setSelectedUsers(prev => 
      prev.includes(userId) 
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    );
  };

  const handleSelectAllUsers = () => {
    if (selectedUsers.length === filteredUsers.length) {
      setSelectedUsers([]);
    } else {
      setSelectedUsers(filteredUsers.map(user => user.user_id));
    }
  };

  const handleBulkAssignModules = () => {
    if (selectedUsers.length === 0) {
      setError("Please select at least one user");
      return;
    }
    setShowBulkAssignModal(true);
  };

  const clearFilters = () => {
    setSearchTerm('');
    setSelectedDepartment('all');
    setSelectedStatus('all');
    setSelectedRole('all');
    setSelectedDepartments([]);
    setSelectedSubDepartments([]);
  };

  const handleEditUser = (user: User) => {
    setSelectedEmployee(user);
    setShowUpdateModal(true);
  };

  const handleDeleteUser = (user: User) => {
    setUserToDelete(user);
    setShowDeleteConfirm(true);
  };

  const confirmDeleteUser = async () => {
    if (!userToDelete) return;

    try {
      setLoading(true);
      setError('');
      
      // Soft delete - mark user as inactive instead of hard delete
      const { error: updateError } = await supabase
        .from('users')
        .update({ is_active: false })
        .eq('user_id', userToDelete.user_id);

      if (updateError) throw updateError;

      // Also deactivate user role assignments
      await supabase
        .from('user_role_assignments')
        .update({ is_active: false })
        .eq('user_id', userToDelete.user_id);

      setSuccess(`User ${userToDelete.name} has been deactivated successfully`);
      setShowDeleteConfirm(false);
      setUserToDelete(null);
      
      // Reload users to reflect changes
      if (admin?.company_id) {
        await loadUsers(admin.company_id);
      }
      
      // Scroll to top to see updated list
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error: any) {
      setError(`Failed to delete user: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Close dropdown handlers when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      setShowDepartmentDropdown(false);
      setShowSubDepartmentDropdown(false);
    };

    if (showDepartmentDropdown || showSubDepartmentDropdown) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [showDepartmentDropdown, showSubDepartmentDropdown]);

  // Convert legacy success banners into unified Radix toasts
  useEffect(() => {
    if (!success) return;

    try {
      shadcnToast({ title: success, duration: 7000 });
    } catch (e) {
      console.warn('Toast error', e);
    }

    // Clear the transient success message so the old banner doesn't re-render
    setSuccess('');
  }, [success]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!admin) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Failed to load user data. Please try refreshing the page.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200 pb-4">
        <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
        <p className="text-gray-600 mt-1">Manage users, assign modules, and organize by departments</p>
      </div>
      
      {/* success banners are shown via unified Radix toasts now */}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Navigation Tabs */}
      <div className="flex gap-4 border-b">
        <Button
          variant={!showAssignmentsView ? "default" : "ghost"}
          onClick={() => setShowAssignmentsView(false)}
          className="border-b-2 border-transparent data-[active=true]:border-blue-500"
        >
          <Users className="w-4 h-4 mr-2" />
          User Management
        </Button>
        <Button
          variant={showAssignmentsView ? "default" : "ghost"}
          onClick={() => setShowAssignmentsView(true)}
          className="border-b-2 border-transparent data-[active=true]:border-blue-500"
        >
          <BookOpen className="w-4 h-4 mr-2" />
          Learning Plan Assignments
        </Button>
      </div>

      {!showAssignmentsView ? (
        <>
          {/* Add User Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Add Individual User */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <UserPlus className="w-5 h-5 mr-2" />
                  Add Individual User
                </CardTitle>
                <CardDescription>
                  Create a new user with complete details
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-center py-6">
                  <Users className="w-12 h-12 mx-auto mb-4 text-blue-500" />
                  <p className="text-gray-600 mb-4">Add users one by one with complete information</p>
                  <Button
                    onClick={() => setShowAddModal(true)}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add New User
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Bulk Upload Users */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <UploadIcon className="w-5 h-5 mr-2" />
                  Bulk Upload Users
                </CardTitle>
                <CardDescription>
                  Upload multiple users using CSV or Excel files
                </CardDescription>
              </CardHeader>
              <CardContent>
                <UserBulkAdd
                  companyId={admin.company_id}
                  adminId={admin.user_id}
                  onSuccess={() => {
                    loadUsers(admin.company_id);
                    setSuccess("Users uploaded successfully!");
                    // Scroll to top to see the new users
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  onError={setError}
                />
              </CardContent>
            </Card>
          </div>

          {/* Search and Filter Section */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center">
                  <Filter className="w-5 h-5 mr-2" />
                  Filter & Search Users
                </CardTitle>
                <Button
                  variant="outline"
                  onClick={() => setShowFilters(!showFilters)}
                  className="flex items-center gap-2"
                >
                  {showFilters ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  {showFilters ? 'Hide Filters' : 'Show Filters'}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Search Bar */}
              <div className="flex items-center gap-4">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <Input
                    placeholder="Search users by name, email, or position..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
                {(searchTerm || selectedDepartment !== 'all' || selectedStatus !== 'all' || selectedRole !== 'all') && (
                  <Button variant="outline" onClick={clearFilters}>
                    Clear Filters
                  </Button>
                )}
              </div>

              {/* Advanced Filters */}
              {showFilters && (
                <div className="space-y-4 pt-4 border-t">
                  {/* Department and Subdepartment Multi-Select Filters */}
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
                            <div className="p-2 grid grid-cols-1 gap-2">
                              {Array.from(new Set(departments.map(dept => dept.department_name))).map(department => (
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
                          disabled={departments.length === 0}
                        >
                          <span>
                            {selectedSubDepartments.length === 0
                              ? "Select Subdepartments"
                              : `${selectedSubDepartments.length} subdepartment${selectedSubDepartments.length === 1 ? '' : 's'} selected`}
                          </span>
                          <span className="ml-2">▼</span>
                        </Button>
                        
                        {showSubDepartmentDropdown && departments.length > 0 && (
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
                            <div className="p-2 grid grid-cols-1 gap-2">
                              {(selectedDepartments.length > 0
                                ? departments.filter(dept => selectedDepartments.includes(dept.department_name))
                                : departments
                              ).map(subDept => (
                                <label
                                  key={subDept.department_id}
                                  className="flex items-center space-x-2 p-2 hover:bg-gray-50 rounded cursor-pointer"
                                >
                                  <input
                                    type="checkbox"
                                    checked={selectedSubDepartments.includes(subDept.department_id)}
                                    onChange={() => handleSubDepartmentToggle(subDept.department_id)}
                                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                  />
                                  <span className="text-sm">{subDept.sub_department_name || subDept.department_name}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Other filters in a separate row */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Role Filter */}
                    <div>
                      <Label htmlFor="role-filter">Role</Label>
                      <Select value={selectedRole} onValueChange={setSelectedRole}>
                        <SelectTrigger>
                          <SelectValue placeholder="All Roles" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Roles</SelectItem>
                          {roles.map((role) => (
                            <SelectItem key={role.role_id} value={role.name}>
                              {role.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Status Filter */}
                    <div>
                      <Label htmlFor="status-filter">Employment Status</Label>
                      <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                        <SelectTrigger>
                          <SelectValue placeholder="All Statuses" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Statuses</SelectItem>
                          <SelectItem value="ACTIVE">Active</SelectItem>
                          <SelectItem value="INACTIVE">Inactive</SelectItem>
                          <SelectItem value="TERMINATED">Terminated</SelectItem>
                          <SelectItem value="ON_LEAVE">On Leave</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Selected Items Display */}
                  {(selectedDepartments.length > 0 || selectedSubDepartments.length > 0) && (
                    <div className="space-y-2 pt-2 border-t">
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
                              const subDept = departments.find(sd => sd.department_id === subDeptId);
                              return subDept ? (
                                <span key={subDeptId} className="bg-green-100 text-green-800 px-2 py-1 rounded text-xs">
                                  {subDept.sub_department_name || subDept.department_name}
                                </span>
                              ) : null;
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Results Summary */}
              <div className="flex items-center justify-between text-sm text-gray-600 pt-2 border-t">
                <span>
                  Showing {filteredUsers.length} of {users.length} users
                  {selectedDepartments.length > 0 && (
                    <span className="text-blue-600 ml-2">
                      • {selectedDepartments.length} department{selectedDepartments.length === 1 ? '' : 's'} selected
                    </span>
                  )}
                  {selectedSubDepartments.length > 0 && (
                    <span className="text-green-600 ml-2">
                      • {selectedSubDepartments.length} subdepartment{selectedSubDepartments.length === 1 ? '' : 's'} selected
                    </span>
                  )}
                </span>
                {filteredUsers.length !== users.length && (
                  <span className="text-blue-600">
                    {users.length - filteredUsers.length} filtered out
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Bulk Actions Bar - always visible; enable button only when selection > 0 */}
          <Card className="bg-blue-50 border-blue-200">
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <span className="text-blue-800 font-medium">
                    {selectedUsers.length} user{selectedUsers.length !== 1 ? 's' : ''} selected
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedUsers([])}
                    className="text-blue-600 border-blue-300"
                  >
                    Clear Selection
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={handleBulkAssignModules}
                    disabled={selectedUsers.length === 0}
                    className="bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:pointer-events-none"
                  >
                    <BookOpen className="w-4 h-4 mr-2" />
                    Assign Modules
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* User List */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center">
                  <Users className="w-5 h-5 mr-2" />
                  All Users ({filteredUsers.length})
                </div>
              </CardTitle>
              <CardDescription>
                Overview of all users in your organization
              </CardDescription>
            </CardHeader>
            <CardContent>
              {filteredUsers.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>{users.length === 0 ? 'No users found' : 'No users match your filters'}</p>
                  <p className="text-sm">
                    {users.length === 0 ? 'Add your first user to get started' : 'Try adjusting your search criteria'}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="border-b bg-gray-50">
                        <th className="text-center p-3 font-medium text-gray-700 w-12">
                          <input
                            type="checkbox"
                            checked={selectedUsers.length === filteredUsers.length && filteredUsers.length > 0}
                            onChange={handleSelectAllUsers}
                            className="rounded"
                          />
                        </th>
                        <th className="text-left p-3 font-medium text-gray-700">User</th>
                        <th className="text-center p-3 font-medium text-gray-700">Department</th>
                        <th className="text-center p-3 font-medium text-gray-700">Role</th>
                        <th className="text-center p-3 font-medium text-gray-700">Status</th>
                        <th className="text-center p-3 font-medium text-gray-700">Position</th>
                        <th className="text-center p-3 font-medium text-gray-700">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredUsers.map((user, index) => (
                        <tr key={user.user_id} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                          <td className="text-center p-3">
                            <input
                              type="checkbox"
                              checked={selectedUsers.includes(user.user_id)}
                              onChange={() => handleSelectUser(user.user_id)}
                              className="rounded"
                            />
                          </td>
                          <td className="p-3">
                            <div>
                              <div className="font-medium text-gray-900">{user.name || 'No Name'}</div>
                              <div className="text-sm text-gray-500">{user.email}</div>
                              {user.phone && (
                                <div className="text-xs text-gray-400">{user.phone}</div>
                              )}
                            </div>
                          </td>
                          <td className="text-center p-3">
                            <div className="text-sm">
                              {user.department?.department_name && (
                                <div className="font-medium text-gray-700 flex items-center justify-center">
                                  <Building2 className="w-3 h-3 mr-1" />
                                  {user.department.department_name}
                                </div>
                              )}
                              {user.department?.sub_department_name && (
                                <div className="text-xs text-gray-500 mt-1">
                                  {user.department.sub_department_name}
                                </div>
                              )}
                              {!user.department?.department_name && (
                                <span className="text-gray-400 text-xs">Not assigned</span>
                              )}
                            </div>
                          </td>
                          <td className="text-center p-3">
                            <Badge className={
                              user.role?.name === 'CEO' ? 'bg-purple-100 text-purple-800' :
                              user.role?.name === 'SUPER_ADMIN' ? 'bg-red-100 text-red-800' :
                              user.role?.name === 'ADMIN' ? 'bg-blue-100 text-blue-800' :
                              'bg-gray-100 text-gray-800'
                            }>
                              {user.role?.display_name || 'USER'}
                            </Badge>
                          </td>
                          <td className="text-center p-3">
                            <Badge className={
                              user.employment_status === 'ACTIVE' ? 'bg-green-100 text-green-800' :
                              user.employment_status === 'INACTIVE' ? 'bg-gray-100 text-gray-800' :
                              user.employment_status === 'TERMINATED' ? 'bg-red-100 text-red-800' :
                              'bg-yellow-100 text-yellow-800'
                            }>
                              {user.employment_status || 'ACTIVE'}
                            </Badge>
                          </td>
                          <td className="text-center p-3">
                            <span className="text-sm text-gray-600">
                              {user.position || 'Not specified'}
                            </span>
                          </td>
                          <td className="text-center p-3">
                            <div className="flex justify-center gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-green-600"
                                onClick={() => handleEditUser(user)}
                              >
                                <Edit className="w-4 h-4 mr-1" />
                              </Button>
                              <Button 
                                variant="outline" 
                                size="sm" 
                                className="text-red-600"
                                onClick={() => handleDeleteUser(user)}
                              >
                                <Trash2 className="w-4 h-4 mr-1" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        /* Learning Plan Assignments View */
        <LearningPlanAssignmentsView 
          learningPlans={learningPlans}
          users={users}
          trainingModules={trainingModules}
          companyId={admin.company_id}
          onAssignmentChange={() => loadLearningPlans(admin.company_id)}
          onSuccess={setSuccess}
          onError={setError}
        />
      )}

      {/* Add User Modal */}
      <AddUserModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        companyId={admin.company_id}
        adminId={admin.user_id}
        departments={departments}
        roles={roles}
        onSuccess={() => {
          loadUsers(admin.company_id);
          setSuccess("User added successfully!");
          setShowAddModal(false);
          // Scroll to top to see the new user
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />

      {/* Update Employee Modal */}
      {selectedEmployee && (
        <UpdateEmployeeModal
          isOpen={showUpdateModal}
          onClose={() => setShowUpdateModal(false)}
          employee={selectedEmployee}
          currentRole={selectedEmployee.role ? [selectedEmployee.role.name] : []}
          onSuccess={() => {
            loadUsers(admin.company_id);
            setSuccess("Employee updated successfully!");
            setShowUpdateModal(false);
            // Scroll to top to see the updated employee
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        />
      )}

      {/* Delete Confirmation Dialog */}
      {showDeleteConfirm && userToDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">Confirm Delete</h3>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete <strong>{userToDelete.name}</strong>? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setUserToDelete(null);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={confirmDeleteUser}
                className="bg-red-600 hover:bg-red-700"
              >
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Module Assignment Modal */}
      <BulkModuleAssignmentModal
        isOpen={showBulkAssignModal}
        onClose={() => {
          setShowBulkAssignModal(false);
          setSelectedUsers([]);
        }}
        selectedUsers={selectedUsers}
        users={users}
        trainingModules={trainingModules}
        companyId={admin.company_id}
        adminId={admin.user_id}
        onSuccess={() => {
          loadLearningPlans(admin.company_id);
          setSuccess("Modules assigned successfully!");
          setShowBulkAssignModal(false);
          setSelectedUsers([]);
        }}
        onError={setError}
      />
    </div>
  );
}

// Placeholder components that need to be implemented
function UserBulkAdd({ companyId, adminId, onSuccess, onError }: any) {
  const [mode, setMode] = useState<'manual' | 'upload' | 'detailed'>('upload');
  const [showModal, setShowModal] = useState(false);
  const [manualEmails, setManualEmails] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string[][]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);

  // Load departments and roles when component mounts
  useEffect(() => {
    loadDropdownData();
  }, []);

  const loadDropdownData = async () => {
    try {
      // Load subdepartments
      const { data: subDeptData, error: subDeptError } = await supabase
        .from('sub_department')
        .select('*')
        .order('department_name')
        .order('sub_department_name');

      if (subDeptError) throw subDeptError;
      setDepartments(subDeptData || []);

      // Load roles
      const { data: rolesData, error: rolesError } = await supabase
        .from('roles')
        .select('*')
        .order('name');
        
      if (rolesError) throw rolesError;
      setRoles(rolesData || []);

    } catch (error) {
      console.error('Failed to load dropdown data:', error);
    }
  };

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
            .from("users")
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
        // console.log(text.split(/\r?\n/).map(line => line.split(',')))
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
        // console.log(text.split(/\r?\n/).map(line => line.split(',')));
        rows = text.split(/\r?\n/).map(line => line.split(',').map(cell => cell.trim()));
      } else if (file.name.endsWith('.xlsx')) {
        // Dynamically import xlsx for processing
        const xlsx = await import("xlsx");
        const workbook = xlsx.read(arrayBuffer, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 }) as string[][];
      } else {
        onError('Unsupported file type. Only CSV or XLSX allowed.');
        return;
      }
      
      // Skip header row if present - check for common header patterns
      const isHeaderRow = (row: string[]) => {
        if (!row || row.length === 0) return false;
        // console.log(row[0]?.toLowerCase())
        const firstCell = row[0]?.toLowerCase() || '';
        
        // Check if first row contains common header keywords
        return (
          firstCell.includes('name') || 
          firstCell.includes('employee') || 
          firstCell.includes('company') ||
          firstCell.includes('email') ||
          firstCell.includes('department')
        );
      };

      const dataRows = (rows.length > 0 && isHeaderRow(rows[0])) ? rows.slice(1) : rows;
      
      const results = { added: 0, skipped: 0, errors: [] as string[] };

      // Load existing roles and departments for mapping
      const { data: rolesData } = await supabase.from('roles').select('role_id, name');
      const { data: departmentsData } = await supabase.from('sub_department').select('department_id, department_name, sub_department_name');
      const { data: companiesData } = await supabase.from('companies').select('company_id, name');
      
      const rolesMap = new Map(rolesData?.map((r: any) => [r.name.toLowerCase(), r.role_id]) || []);
      const departmentsMap = new Map(departmentsData?.map((d: any) => [`${d.department_name.toLowerCase()}-${d.sub_department_name.toLowerCase()}`, d.department_id]) || []);
      const companiesMap = new Map(companiesData?.map((c: any) => [c.name.toLowerCase(), c.company_id]) || []);

      for (const row of dataRows) {
        // Expected format from old admin: company_user_id, email, name, company_name, department, sub_department, employment_status, roles, position, phone
        if (row.length < 3 || !row[1]) continue; // Need at least company_user_id, email, name
        const [, email, name, companyName, department, subDepartment, employmentStatus, roles, position, phone] = row.map(cell => cell || '');
        
        try {
          // Validate required fields
          if (!name || !email) {
            // console.log(name)
            // console.log(email)
            results.errors.push(`Row ${dataRows.indexOf(row) + 1}: Name and email are required`);
            continue;
          }

          // Email validation
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(email)) {
            // console.log("Error because of the email")
            results.errors.push(`${email}: Invalid email format`);
            continue;
          }

          // Check if email already exists
          const { data: existingUser } = await supabase
            .from('users')
            .select('user_id')
            .eq('email', email.toLowerCase())
            .single();

          if (existingUser) {
            results.skipped++;
            // console.log("Error because of existing user")
            continue;
          }

          // Find department ID
          let departmentId = null;
          if (department && subDepartment) {
            const deptKey = `${department.toLowerCase()}-${subDepartment.toLowerCase()}`;
            departmentId = departmentsMap.get(deptKey) || null;
            
            if (!departmentId) {
              // console.log("Error because of the department ID is missing");
              results.errors.push(`${email}: Department "${department}" - "${subDepartment}" not found`);
              continue;
            }
          }

          // Find company ID
          let userCompanyId: any = companyId; // Default to admin's company
          if (companyName) {
            const foundCompanyId = companiesMap.get(companyName.toLowerCase());
            if (foundCompanyId) {
              userCompanyId = foundCompanyId;
            }
          }

          // Create user in users table
          const { data: userData, error: userError } = await supabase
            .from('users')
            .insert({
              name: name,
              email: email.toLowerCase(),
              company_id: userCompanyId,
              department_id: departmentId,
              position: position || null,
              phone: phone || null,
              hire_date: new Date().toISOString().split('T')[0],
              employment_status: employmentStatus || 'ACTIVE'
            })
            .select()
            .single();

          // console.log("User Data after creation");
          // console.log(userData)
          if (userError) {
            if (userError.code === '23505') { // Unique violation
              results.skipped++;
            } else {
              results.errors.push(`${email}: ${userError.message}`);
            }
            continue;
          }
          
          // Process roles if provided (using old admin logic)
          if (userData) {
            let roleNames = [];
            
            if (roles && roles.trim()) {
              // If roles are provided, use them
              roleNames = roles.split(',').map(role => role.trim()).filter(role => role);
            } else {
              // If no roles provided, assign default "User" role
              roleNames = ['USER'];
            }
            
            const roleAssignments = [];

            for (const roleName of roleNames) {
              const roleId = rolesMap.get(roleName.toLowerCase());
              if (roleId) {
                roleAssignments.push({
                  user_id: userData.user_id,
                  role_id: roleId,
                  scope_type: 'COMPANY',
                  scope_id: userData.company_id,
                  assigned_by: adminId,
                  is_active: true
                });
              } else {
                results.errors.push(`${email}: Role "${roleName}" not found`);
              }
            }

            if (roleAssignments.length > 0) {
              const { error: roleError } = await supabase
                .from('user_role_assignments')
                .insert(roleAssignments);

              if (roleError) {
                console.error(`Role assignment failed for ${email}:`, roleError);
                // Don't fail the entire operation if role assignment fails
              }
            }
          }

          results.added++;
        } catch (err) {
          results.errors.push(`${email}: Failed to add user`);
        }
      }

      if (results.errors.length > 0) {
        onError(`Added ${results.added}, skipped ${results.skipped}, errors: ${results.errors.slice(0, 5).join('; ')}${results.errors.length > 5 ? ` and ${results.errors.length - 5} more...` : ''}`);
      } else {
        setFile(null);
        setPreview([]);
        onSuccess();
      }
    } catch (err) {
      onError('Failed to upload employees');
      // console.log(err)
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Mode Toggle */}
      {/* <div className="flex gap-2">
        <Button
          type="button"
          variant={mode === 'detailed' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('detailed')}
        >
          <Plus className="w-4 h-4 mr-1" />
          Add Employee
        </Button>
        <Button
          type="button"
          variant={mode === 'manual' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('manual')}
        >
          Bulk Email Entry
        </Button>
        <Button
          type="button"
          variant={mode === 'upload' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('upload')}
        >
          File Upload
        </Button>
      </div> */}

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
                href="https://hyxqwqshhlebaybjpzcz.supabase.co/storage/v1/object/public/KPIs/Sample_Emplyee_No_KPI%20(1).xlsx"
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
              Expected format: company_user_id, email, name, company_name, department, sub_department, employment_status, roles, position, phone
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
                        <td className="border px-2 py-1">{row[2] || '-'}</td>
                        <td className="border px-2 py-1">{row[3] || '-'}</td>
                        <td className="border px-2 py-1">{row[4] || '-'}</td>
                        <td className="border px-2 py-1">{row[5] || '-'}</td>
                        <td className="border px-2 py-1">{row[6] || '-'}</td>
                        <td className="border px-2 py-1">{row[7] || '-'}</td>
                        <td className="border px-2 py-1">{row[8] || '-'}</td>
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
      <AddUserModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        companyId={companyId || ''}
        adminId={adminId || ''}
        departments={departments}
        roles={roles}
        onSuccess={() => {
          onSuccess();
          setShowModal(false);
        }}
      />
    </div>
  );
}

function AddUserModal({ isOpen, onClose, companyId, adminId, departments, roles, onSuccess }: any) {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    company_name: '',
    department_id: '',
    role_id: '',
    role_unique_id: '',
    employment_status: 'ACTIVE',
    phone: '',
    position: '',
    selected_roles: [] as string[]
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{[key: string]: string}>({});
  const [companies, setCompanies] = useState<any[]>([]);

  // Load dropdown data
  useEffect(() => {
    if (isOpen) {
      loadDropdownData();
    }
  }, [isOpen]);

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
      selected_roles: roles.map((role: any) => role.role_id)
    }));
  };

  const clearAllRoles = () => {
    setFormData(prev => ({
      ...prev,
      selected_roles: []
    }));
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

  const loadDropdownData = async () => {
    try {
      // Load companies
      const { data: companiesData, error: companiesError } = await supabase
        .from('companies')
        .select('company_id, name')
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
        .select('user_id')
        .eq('email', email.toLowerCase())
        .maybeSingle();
      
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
          employment_status: formData.employment_status || 'ACTIVE'
        })
        .select()
        .single();

      if (userError) throw userError;

      // If roles are selected, create multiple role assignments
      if (formData.selected_roles.length > 0) {
        const roleAssignments = formData.selected_roles.map(roleId => ({
          user_id: userData.user_id,
          role_id: roleId,
          scope_type: 'COMPANY',
          scope_id: userData.company_id,
          assigned_by: adminId,
          is_active: true
        }));

        const { error: roleError } = await supabase
          .from('user_role_assignments')
          .insert(roleAssignments);

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
        position: '',
        role_unique_id: '',
        employment_status: 'ACTIVE',
        selected_roles: []
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
  const uniqueDepartments = Array.from(new Set(departments.map((sd: any) => sd.department_name)));

  // Get subdepartments for selected department
  const selectedDepartmentName = departments.find((sd: any) => sd.department_id === formData.department_id)?.department_name;
  const availableSubDepartments = selectedDepartmentName 
    ? departments.filter((sd: any) => sd.department_name === selectedDepartmentName)
    : departments;

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
              <X className="w-5 h-5" />
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
                  <option key={company.company_id} value={company.name}>
                    {company.name}
                  </option>
                ))}
              </select>
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
                  {availableSubDepartments.map((subDept: any) => (
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
                  value={formData.employment_status || 'ACTIVE'}
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
                    {roles.map((role: any) => (
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
                          <div className="font-medium text-gray-900">{role.name}</div>
                          {role.description && (
                            <div className="text-sm text-gray-500">{role.description}</div>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div className="text-xs text-gray-500 mt-1">
                Selected: {formData.selected_roles.length} role{formData.selected_roles.length === 1 ? '' : 's'}
              </div>

              {/* Selected Roles Preview */}
              {formData.selected_roles.length > 0 && (
                <div className="mt-2">
                  <span className="text-xs text-gray-600 block mb-1">Selected Roles:</span>
                  <div className="flex flex-wrap gap-1">
                    {formData.selected_roles.map(roleId => {
                      const role = roles.find((r: any) => r.role_id === roleId);
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

function LearningPlanAssignmentsView({ learningPlans, users, trainingModules, companyId, onAssignmentChange, onSuccess, onError }: any) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Learning Plan Assignments</CardTitle>
        <CardDescription>View and manage learning plan assignments</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-gray-600 py-8 text-center">Learning plan assignments view coming soon</p>
      </CardContent>
    </Card>
  );
}

function BulkModuleAssignmentModal({ isOpen, onClose, selectedUsers, users, trainingModules, companyId, adminId, onSuccess, onError }: any) {
  const [modules, setModules] = useState<TrainingModule[]>([]);
  const [selectedModules, setSelectedModules] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingModules, setLoadingModules] = useState(true);
  const [error, setError] = useState('');
  const [moduleBaselineSettings, setModuleBaselineSettings] = useState<{[moduleId: string]: boolean}>({});
  const [dueDate, setDueDate] = useState('');
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [duplicateAssignments, setDuplicateAssignments] = useState<any[]>([]);

  // Load available modules
  useEffect(() => {
    if (isOpen && companyId) {
      loadModules();
    }
  }, [isOpen, companyId]);

  const loadModules = async () => {
    setLoadingModules(true);
    setError('');
    
    try {
      const { data, error: modulesError } = await supabase
        .from('training_modules')
        .select('*')
        .eq('company_id', companyId)
        .eq('processing_status', 'completed')
        .order('title');
        
      if (modulesError) throw modulesError;
      setModules(data || []);
      
      // Initialize baseline settings for all modules (default to true)
      const initialSettings: {[moduleId: string]: boolean} = {};
      (data || []).forEach(module => {
        initialSettings[module.module_id] = true;
      });
      setModuleBaselineSettings(initialSettings);
    } catch (error: any) {
      setError('Failed to load modules: ' + error.message);
    } finally {
      setLoadingModules(false);
    }
  };

  const handleModuleToggle = (moduleId: string) => {
    setSelectedModules(prev =>
      prev.includes(moduleId)
        ? prev.filter(id => id !== moduleId)
        : [...prev, moduleId]
    );
  };

  const handleBaselineToggle = (moduleId: string) => {
    setModuleBaselineSettings(prev => ({
      ...prev,
      [moduleId]: !prev[moduleId]
    }));
  };

  const selectAllModules = () => {
    setSelectedModules(modules.map(module => module.module_id));
  };

  const clearAllModules = () => {
    setSelectedModules([]);
  };

  // Add functions to toggle baseline for all modules
  const enableAllBaselines = () => {
    const newSettings: {[moduleId: string]: boolean} = {};
    modules.forEach(module => {
      newSettings[module.module_id] = true;
    });
    setModuleBaselineSettings(newSettings);
  };

  const disableAllBaselines = () => {
    const newSettings: {[moduleId: string]: boolean} = {};
    modules.forEach(module => {
      newSettings[module.module_id] = false;
    });
    setModuleBaselineSettings(newSettings);
  };

  const handleAssign = async () => {
    if (selectedModules.length === 0) {
      setError('Please select at least one module');
      return;
    }

    if (selectedUsers.length === 0) {
      setError('No users selected');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // First, check for existing assignments to prevent duplicates
      const { data: existingAssignments, error: checkError } = await supabase
        .from('learning_plan')
        .select('user_id, module_id, users!inner(name, email), training_modules!inner(title)')
        .in('user_id', selectedUsers)
        .in('module_id', selectedModules);

      if (checkError) {
        console.error('Error checking existing assignments:', checkError);
        setError('Failed to check existing assignments. Please try again.');
        setLoading(false);
        return;
      }

      // If there are existing assignments, show the duplicate modal
      if (existingAssignments && existingAssignments.length > 0) {
        setDuplicateAssignments(existingAssignments);
        setShowDuplicateModal(true);
        setLoading(false);
        return;
      }

      // Create learning plan entries for each user-module combination
      const learningPlans = [];
      
      for (const userId of selectedUsers) {
        for (const moduleId of selectedModules) {
          learningPlans.push({
            user_id: userId,
            module_id: moduleId,
            assigned_on: new Date().toISOString(),
            due_date: dueDate || null,
            baseline_assessment: moduleBaselineSettings[moduleId] ? 1 : 0,
            status: 'ASSIGNED'
          });
        }
      }

      // Insert learning plans into database
      const { error: insertError } = await supabase
        .from('learning_plan')
        .insert(learningPlans);

      if (insertError) {
        // Handle potential race condition duplicates
        if (insertError.code === '23505') {
          setError('Some assignments were created by another admin while you were selecting. Please refresh and try again.');
        } else {
          throw insertError;
        }
        return;
      }

      try {
        // Use the shared Radix-based toast so all toasters render the same UI
        shadcnToast({
          title: 'Modules Assigned!',
          description: `Successfully assigned ${selectedModules.length} module${selectedModules.length === 1 ? '' : 's'} to ${selectedUsers.length} employee${selectedUsers.length === 1 ? '' : 's'}.`,
          duration: 7000,
        });
      } catch (e) {
        console.warn('Toast error', e);
      }

      onSuccess();
      
    } catch (error: any) {
      console.error('Failed to assign modules:', error);
      setError('Failed to assign modules. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Get selected user details for display
  const selectedUserDetails = users.filter((user: any) => 
    selectedUsers.includes(user.user_id)
  );

  if (!isOpen) return null;
  
  return (
    <>
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
          <div className="p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-semibold text-gray-900">Assign Modules</h2>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </Button>
            </div>

            {/* Selected Users Summary */}
            <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <h3 className="font-medium text-blue-900 mb-2">
                Selected Users ({selectedUsers.length})
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 max-h-32 overflow-y-auto">
                {selectedUserDetails.map((user: any) => (
                  <div key={user.user_id} className="text-sm text-blue-800 bg-blue-100 px-2 py-1 rounded">
                    {user.name || user.email}
                  </div>
                ))}
              </div>
            </div>

            {/* Assignment Configuration */}
            <div className="grid grid-cols-1 gap-4 mb-6">
              <div>
                <Label htmlFor="dueDate">Due Date (Optional)</Label>
                <Input
                  id="dueDate"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                />
              </div>
            </div>

            {/* Module Selection */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <Label>Select Training Modules</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={selectAllModules}
                    disabled={selectedModules.length === modules.length || loadingModules}
                  >
                    Select All
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={clearAllModules}
                    disabled={selectedModules.length === 0}
                  >
                    Clear All
                  </Button>
                </div>
              </div>

              {/* Baseline Assessment Bulk Actions */}
              <div className="flex items-center gap-4 mb-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                <Label className="text-sm font-medium">Baseline Assessment Bulk Actions:</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={enableAllBaselines}
                  disabled={loadingModules}
                >
                  Enable All
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={disableAllBaselines}
                  disabled={loadingModules}
                >
                  Disable All
                </Button>
              </div>

              {loadingModules ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                  <span className="ml-2 text-gray-600">Loading modules...</span>
                </div>
              ) : modules.length === 0 ? (
                <div className="text-center py-8 text-gray-500 border border-gray-200 rounded-lg">
                  <p>No training modules available</p>
                  <p className="text-sm">Upload training content first to create modules</p>
                </div>
              ) : (
                <div className="border border-gray-300 rounded-md max-h-64 overflow-y-auto">
                  <div className="p-3 space-y-3">
                    {modules.map(module => (
                      <label
                        key={module.module_id}
                        className="submodule-card submodule-card--compact cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedModules.includes(module.module_id)}
                          onChange={() => handleModuleToggle(module.module_id)}
                          className="mt-1 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-gray-900">{module.title}</div>
                          {module.description && (
                            <p className="text-sm text-gray-600 mt-1">{module.description}</p>
                          )}
                          <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                            <span className="bg-gray-100 px-2 py-1 rounded">
                              {formatContentType(module.content_type)}
                            </span>
                            <span>
                              Created: {new Date(module.created_at).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                        {/* Individual Baseline Assessment Toggle */}
                        <div className="flex flex-col items-center gap-2 ml-4">
                          <Label className="text-xs font-medium text-gray-600">Baseline Assessment</Label>
                          <div className="flex items-center space-x-2">
                            <label className="flex items-center cursor-pointer">
                              <div className="relative">
                                <input
                                  type="checkbox"
                                  checked={moduleBaselineSettings[module.module_id] || false}
                                  onChange={(e) => {
                                    e.stopPropagation();
                                    handleBaselineToggle(module.module_id);
                                  }}
                                  className="sr-only"
                                />
                                <div className={`w-9 h-5 rounded-full transition-colors ${
                                  moduleBaselineSettings[module.module_id] ? 'bg-blue-600' : 'bg-gray-300'
                                }`}>
                                  <div className={`w-4 h-4 bg-white rounded-full shadow-md transform transition-transform ${
                                    moduleBaselineSettings[module.module_id] ? 'translate-x-4' : 'translate-x-0.5'
                                  } mt-0.5`}></div>
                                </div>
                              </div>
                            </label>
                          </div>
                          <span className="text-xs text-gray-500">
                            {moduleBaselineSettings[module.module_id] ? 'Required' : 'Optional'}
                          </span>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-2 text-xs text-gray-500">
                Selected: {selectedModules.length} module{selectedModules.length === 1 ? '' : 's'}
              </div>

              {/* Selected Modules Preview */}
              {selectedModules.length > 0 && (
                <div className="mt-3">
                  <span className="text-xs text-gray-600 block mb-2">Selected Modules:</span>
                  <div className="flex flex-wrap gap-2">
                    {selectedModules.map(moduleId => {
                      const module = modules.find(m => m.module_id === moduleId);
                      return module ? (
                        <span key={moduleId} className="bg-green-100 text-green-800 px-2 py-1 rounded text-xs flex items-center gap-1">
                          {module.title}
                          {moduleBaselineSettings[moduleId] && (
                            <span className="bg-blue-500 text-white px-1 py-0.5 rounded-full text-xs">B</span>
                          )}
                        </span>
                      ) : null;
                    })}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    B = Baseline Assessment Required
                  </div>
                </div>
              )}
            </div>

            {/* Assignment Summary */}
            {selectedModules.length > 0 && (
              <div className="mb-6 p-4 bg-gray-50 border border-gray-200 rounded-lg">
                <h3 className="font-medium text-gray-900 mb-2">Assignment Summary</h3>
                <p className="text-sm text-gray-600">
                  You are about to assign <strong>{selectedModules.length}</strong> module{selectedModules.length === 1 ? '' : 's'} 
                  to <strong>{selectedUsers.length}</strong> user{selectedUsers.length === 1 ? '' : 's'}.
                </p>
                <p className="text-sm text-gray-600 mt-1">
                  This will create <strong>{selectedModules.length * selectedUsers.length}</strong> learning plan assignments.
                </p>
                <div className="mt-2">
                  <p className="text-sm text-gray-600">
                    <strong>Modules with Baseline Assessment:</strong>
                  </p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {selectedModules.filter(moduleId => moduleBaselineSettings[moduleId]).map(moduleId => {
                      const module = modules.find(m => m.module_id === moduleId);
                      return module ? (
                        <span key={moduleId} className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs">
                          {module.title}
                        </span>
                      ) : null;
                    })}
                  </div>
                  {selectedModules.filter(moduleId => moduleBaselineSettings[moduleId]).length === 0 && (
                    <span className="text-xs text-gray-500">None</span>
                  )}
                </div>
              </div>
            )}

            {error && (
              <Alert variant="destructive" className="mb-6">
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
                onClick={handleAssign}
                disabled={loading || selectedModules.length === 0 || loadingModules}
                className="bg-green-600 hover:bg-green-700"
              >
                {loading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Assigning...
                  </>
                ) : (
                  `Assign ${selectedModules.length} Module${selectedModules.length === 1 ? '' : 's'}`
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Duplicate Assignment Modal */}
      <DuplicateAssignmentModal
        isOpen={showDuplicateModal}
        onClose={() => setShowDuplicateModal(false)}
        duplicateAssignments={duplicateAssignments}
      />
    </>
  );
}

// Duplicate Assignment Error Modal from old admin
function DuplicateAssignmentModal({ 
  isOpen, 
  onClose, 
  duplicateAssignments 
}: { 
  isOpen: boolean;
  onClose: () => void;
  duplicateAssignments: any[];
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[80vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center">
              <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center mr-3">
                <span className="text-orange-600 text-xl">⚠️</span>
              </div>
              <h2 className="text-xl font-semibold text-gray-900">Duplicate Assignments Found</h2>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
            >
              <X className="w-5 h-5" />
            </Button>
          </div>

          <div className="mb-6">
            <p className="text-gray-600 mb-4">
              The following users are already assigned to these modules. Please remove them from your selection to proceed with new assignments only.
            </p>

            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 max-h-64 overflow-y-auto">
              <h3 className="font-medium text-orange-900 mb-3">Existing Assignments:</h3>
              <div className="space-y-3">
                {duplicateAssignments.map((assignment, index) => {
                  const user = assignment.users as any;
                  const module = assignment.training_modules as any;
                  return (
                    <div key={index} className="flex items-center p-3 bg-white border border-orange-200 rounded-md">
                      <div className="w-8 h-8 bg-orange-100 rounded-full flex items-center justify-center mr-3">
                        <span className="text-orange-600 text-sm font-medium">
                          {(user.name || user.email).charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-gray-900">
                          {user.name || user.email}
                        </p>
                        <p className="text-sm text-gray-600">
                          📚 {module.title}
                        </p>
                      </div>
                      <div className="text-orange-600">
                        <span className="text-xs bg-orange-100 px-2 py-1 rounded-full">
                          Already Assigned
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <h4 className="font-medium text-blue-900 mb-2">💡 What to do next:</h4>
            <ul className="text-sm text-blue-800 space-y-1">
              <li>• Uncheck the users or modules that are already assigned</li>
              <li>• Or select different users/modules for assignment</li>
              <li>• You can still proceed with the remaining selections</li>
            </ul>
          </div>

          <div className="flex justify-end">
            <Button
              onClick={onClose}
              className="bg-blue-600 hover:bg-blue-700"
            >
              Got it, let me adjust my selection
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Update Employee Modal Component ---
function UpdateEmployeeModal({ 
  isOpen, 
  onClose, 
  employee, 
  currentRole, 
  onSuccess 
}: { 
  isOpen: boolean;
  onClose: () => void;
  employee: User;
  currentRole: string[];
  onSuccess: () => void;
}) {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    company_name: '',
    department_id: '',
    role_id: '',
    role_unique_id: '',
    employment_status: 'ACTIVE',
    phone: '',
    position: '',
    selected_roles: [] as string[]
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{[key: string]: string}>({});
  const [subDepartments, setSubDepartments] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);

  // Initialize form data when employee prop changes
  useEffect(() => {
    if (employee && isOpen) {
      setFormData({
        name: employee.name || '',
        email: employee.email || '',
        company_name: '',
        department_id: employee.department_id || '',
        role_id: '',
        role_unique_id: '',
        employment_status: employee.employment_status || 'ACTIVE',
        phone: employee.phone || '',
        position: employee.position || '',
        selected_roles: []
      });
      loadDropdownData();
    }
  }, [employee, isOpen]);

  // Load user's current roles
  useEffect(() => {
    if (employee && isOpen) {
      loadUserRoles();
    }
  }, [employee, isOpen]);

  const loadUserRoles = async () => {
    try {
      const { data: roleAssignments, error } = await supabase
        .from('user_role_assignments')
        .select(`
          role_id,
          roles!inner(role_id, name)
        `)
        .eq('user_id', employee.user_id)
        .eq('is_active', true);

      if (error) throw error;

      const currentRoleIds = roleAssignments?.map((assignment: any) => assignment.role_id) || [];
      setFormData(prev => ({
        ...prev,
        selected_roles: currentRoleIds
      }));
    } catch (error) {
      console.error('Failed to load user roles:', error);
    }
  };

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
        .select('company_id, name')
        .order('name');
      
      if (companiesError) throw companiesError;
      setCompanies(companiesData || []);

    } catch (error) {
      console.error('Failed to load dropdown data:', error);
      setError('Failed to load form data');
    }
  };

  const handleRoleToggle = (roleId: string) => {
    setFormData(prev => ({
      ...prev,
      // ensure selected_roles is an array before operating on it
      selected_roles: (Array.isArray(prev.selected_roles) ? prev.selected_roles : []).includes(roleId)
        ? (Array.isArray(prev.selected_roles) ? prev.selected_roles.filter(id => id !== roleId) : [])
        : [...(Array.isArray(prev.selected_roles) ? prev.selected_roles : []), roleId]
    }));
  };

  const selectAllRoles = () => {
    setFormData(prev => ({
      ...prev,
      selected_roles: roles.map((role: any) => role.role_id)
    }));
  };

  const clearAllRoles = () => {
    setFormData(prev => ({
      ...prev,
      selected_roles: []
    }));
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
    if (name === 'email' && value && value !== employee.email) {
      if (!validateEmail(value)) {
        setFieldErrors(prev => ({
          ...prev,
          email: 'Please enter a valid email address'
        }));
      } else {
        // Check if email already exists (but not for current user)
        const emailExists = await checkEmailExists(value, employee.user_id);
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

  // Check if email already exists in database (excluding current user)
  const checkEmailExists = async (email: string, currentUserId: string): Promise<boolean> => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('user_id')
        .eq('email', email.toLowerCase())
        .neq('user_id', currentUserId)
        .maybeSingle();
      
      if (error && error.code !== 'PGRST116') {
        console.error('Error checking email:', error);
        return false;
      }
      
      return !!data;
    } catch (error) {
      console.error('Error checking email:', error);
      return false;
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
    } else if (formData.email !== employee.email) {
      // Check if email already exists (but not for current user)
      const emailExists = await checkEmailExists(formData.email, employee.user_id);
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
      // Update user in users table
      const { error: userError } = await supabase
        .from('users')
        .update({
          name: formData.name,
          email: formData.email.toLowerCase(),
          department_id: formData.department_id || null,
          position: formData.position || null,
          phone: formData.phone || null,
          employment_status: formData.employment_status || 'ACTIVE'
        })
        .eq('user_id', employee.user_id);

      if (userError) throw userError;

      // Update role assignments
      // First, deactivate all existing role assignments
      const { error: deactivateError } = await supabase
        .from('user_role_assignments')
        .update({ is_active: false })
        .eq('user_id', employee.user_id);

      if (deactivateError) {
        console.error('Failed to deactivate old roles:', deactivateError);
      }

      // Then create new role assignments for selected roles
      if (formData.selected_roles.length > 0) {
        const roleAssignments = formData.selected_roles.map(roleId => ({
          user_id: employee.user_id,
          role_id: roleId,
          scope_type: 'COMPANY',
          scope_id: employee.company_id,
          assigned_by: employee.user_id, // In a real app, this would be the admin's ID
          is_active: true
        }));

        const { error: roleError } = await supabase
          .from('user_role_assignments')
          .insert(roleAssignments);

        if (roleError) {
          console.error('Role assignment failed:', roleError);
          // Don't fail the entire operation if role assignment fails
        }
      }

      onSuccess();
      onClose();

    } catch (error: any) {
      console.error('Failed to update user:', error);
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

  // Get available subdepartments based on current selection
  const availableSubDepartments = subDepartments;

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
              <X className="w-5 h-5" />
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
                  {availableSubDepartments.map((subDept: any) => (
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
                  value={formData.employment_status || 'ACTIVE'}
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
                    {roles.map((role: any) => (
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
                          <div className="font-medium text-gray-900">{role.name}</div>
                          {role.description && (
                            <div className="text-sm text-gray-500">{role.description}</div>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div className="text-xs text-gray-500 mt-1">
                Selected: {formData.selected_roles.length} role{formData.selected_roles.length === 1 ? '' : 's'}
              </div>

              {/* Selected Roles Preview */}
              {formData.selected_roles.length > 0 && (
                <div className="mt-2">
                  <span className="text-xs text-gray-600 block mb-1">Selected Roles:</span>
                  <div className="flex flex-wrap gap-1">
                    {formData.selected_roles.map(roleId => {
                      const role = roles.find((r: any) => r.role_id === roleId);
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
                {loading ? 'Updating...' : 'Update Employee'}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}