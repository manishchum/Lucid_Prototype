'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { sharedDataClient } from '@/lib/data-client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
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
import { formatContentType } from '@/lib/contentType';
import { useRouter } from 'next/navigation';
import { fetchWithAuth } from '@/lib/fetch-with-auth';
import { supabase } from '@/lib/supabase';

// Types
interface Admin {
  user_id: string;
  email: string;
  name: string | null;
  company_id: string;
  company_name?: string;
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

interface CustomFunctionEntry {
  function_name: string;
  sub_function_name: string;
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


const API_URL = process.env.NEXT_PUBLIC_BACKEND_URL; 
export default function EmployeesPage() {
  const router  = useRouter();
  const { user, loading: authLoading, isAdmin, isSuperAdmin, userRoles } = useAuth();
  const isDeveloper = (userRoles || []).some((r: string) => (r || '').toUpperCase() === 'DEVELOPER');
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
  
  const { progress: loadingProgress, show: showLoadingProgress } = useIllusionProgress(authLoading || loading);

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
  const currentUserId = admin?.user_id || null;
  
  const bootstrapStarted = useRef(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.push("/login");
      return;
    }

    if (bootstrapStarted.current) return;
    bootstrapStarted.current = true;

    checkAdminAccess();
  }, [authLoading, user?.email]);

  useEffect(() => {
    if (!admin?.company_id) return;

    loadBootstrap(admin.company_id);
  }, [admin?.company_id]);

  // Filter users when filters change
  useEffect(() => {
    filterUsers();
  }, [users, searchTerm, selectedDepartment, selectedStatus, selectedRole, selectedDepartments, selectedSubDepartments]);

  const checkAdminAccess = async () => {
    if (!user?.email) return;

    try {
      setLoading(true);
      setError('');

      const userRes = await fetchWithAuth(
        `${API_URL}/api/users/by-email/${encodeURIComponent(user.email)}`
      );

      if (!userRes.ok) {
        throw new Error(`User lookup failed (${userRes.status})`);
      }

      const { user: userData } = await userRes.json();

      sessionStorage.setItem(
        'lucid_admin_user_id',
        userData.user_id
      );

      const [rolesRes, companyRes] = await Promise.all([
        fetchWithAuth(
          `${API_URL}/api/roles/users/${userData.user_id}`,
          {
            headers: {
              'X-User-ID': userData.user_id
            }
          }
        ),

        fetchWithAuth(
          `${API_URL}/api/companies/${userData.company_id}`,
          {
            headers: {
              'X-User-ID': userData.user_id
            }
          }
        )
      ]);

      if (!rolesRes.ok) {
        throw new Error(`Roles API failed (${rolesRes.status})`);
      }

      const rolesPayload = await rolesRes.json();

      const assignments =
        rolesPayload.assignments || [];

      if (!assignments.length) {
        throw new Error('No active roles found');
      }

      const hasAdminRole = assignments.some(
        (assignment: any) =>
          assignment.role &&
          (
            assignment.role.level >= 3 ||
            ['admin', 'super_admin', 'ceo']
              .includes(
                assignment.role.name?.toLowerCase()
              )
          )
      );

      if (!hasAdminRole) {
        throw new Error('Console access required');
      }

      let companyName = '';

      if (companyRes.ok) {
        const companyPayload = await companyRes.json();

        companyName =
          companyPayload?.data?.name ||
          companyPayload?.company?.name ||
          companyPayload?.name ||
          '';
      }

      setAdmin({
        user_id: userData.user_id,
        email: userData.email,
        name: userData.name,
        company_id: userData.company_id,
        company_name: companyName
      });

    } catch (err: any) {
      console.error(
        'CHECK ADMIN ACCESS FAILED',
        err
      );

      setError(
        err?.message ||
        'Failed to load user data'
      );
    } finally {
      setLoading(false);
    }
  };
  
  const loadUsers = async (companyId: string) => {
    try {
      
      const res = await fetchWithAuth(`${API_URL}/api/users/company/${companyId}`, {
        headers: {'X-User-ID':admin?.user_id || ''}
      });
      if (!res.ok) throw await res.json();
      const payload = await res.json();
      const users = payload.data?.users || payload.users || [];

      setUsers(users);
      // console.log("payload:", payload)
    } catch (error: any) {
      setError(`Failed to load users: ${error.message}`);
    }
  };

  const loadBootstrap = async (companyId: string) => {
    try {
      setLoading(true);
      setError('');

      const res = await fetchWithAuth(
        `${API_URL}/api/employees/bootstrap/${companyId}`,
        {
          headers: {
            'X-User-ID': admin?.user_id || ''
          }
        }
      );

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Failed to load employees bootstrap data');
      }

      const payload = await res.json();

      setUsers(payload.users || []);
      setDepartments(payload.departments || []);
      setRoles(payload.roles || []);
      setTrainingModules(payload.training_modules || []);
      setLearningPlans(payload.learning_plans || []);
    } catch (error: any) {
      console.error('Employee bootstrap failed', error);
      setError(`Failed to load employee bootstrap: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const loadDepartments = async (companyId: string) => {
    try {
      const res = await fetchWithAuth(`${API_URL}/api/sub-departments/`);
      if (res.ok) {
        const payload = await res.json();
        setDepartments(payload.data || []);
      } else {
        console.warn('Failed to load departments: bad response');
        setDepartments([]);
      }
    } catch (error: any) {
      console.error('Failed to load departments:', error.message || error);
    }
  };

  const loadRoles = async () => {
    try {
      const res = await fetchWithAuth(`${API_URL}/api/roles/`);
      if (res.ok) {
        const payload = await res.json();
        setRoles(payload.data || []);
      } else {
        console.warn('Failed to load roles: bad response');
        setRoles([]);
      }
    } catch (error: any) {
      console.error('Failed to load roles:', error.message || error);
    }
  };

  const loadTrainingModules = async (companyId: string) => {
    try {
      const adminId = admin?.user_id || sessionStorage.getItem('lucid_admin_user_id') ||'';
      const res = await fetchWithAuth(`${API_URL}/api/training-modules/company/${encodeURIComponent(companyId)}`, {
        headers: { 'X-User-ID': adminId || ''}
      });
      if (!res.ok) {
        console.warn('[loadTrainingModules] Failed to fetch training modules:', res.status);
        setTrainingModules([]);
        return;
      }
      const payload = await res.json().catch(()=>({}));
      setTrainingModules(payload.modules || []);
    } catch (error: any) {
      console.error('Failed to load training modules:', error.message);
    }
  };

  const loadLearningPlans = async (companyId: string) => {
    try {
      // Fetch learning plans via backend API (will be filtered by company automatically)
      const adminId =
        admin?.user_id ||
        sessionStorage.getItem(
          'lucid_admin_user_id'
        );

      if (!adminId) {
        return;
      }

      const lpRes = await fetchWithAuth(
        `${API_URL}/api/learning-plans/?limit=250`,
        { headers: { 'X-User-ID': adminId } }
      );

      if (!lpRes.ok) {
        const errorData = await lpRes.json();
        throw new Error(errorData.detail || 'Failed to fetch learning plans');
      }

      const lpData = await lpRes.json();
      setLearningPlans(lpData?.plans || []);
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
    const uniqueDepartments = Array.from(new Set(departments.map(dept => dept.department_name))).sort();
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
    const sortedSubDepartments = availableSubDepartments.sort((a, b) => {
      const deptSort = (a.department_name || '').localeCompare(b.department_name || '');
      if (deptSort !== 0) return deptSort;
      return (a.sub_department_name || '').localeCompare(b.sub_department_name || '');
    });
    const allSubDeptIds = sortedSubDepartments.map(dept => dept.department_id);
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
    if (!userToDelete || !currentUserId) return;

    try {
      setLoading(true);
      setError('');
      
      // Use API to delete user (soft delete)
      const res = await fetchWithAuth(`${API_URL}/api/users/${userToDelete.user_id}`, {
        method: 'DELETE',
        headers: { 'X-User-ID': currentUserId },
      });
      
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.detail || 'Failed to delete user');
      }

      setSuccess(`User ${userToDelete.name} has been deactivated successfully`);
      setShowDeleteConfirm(false);
      setUserToDelete(null);
      
      // Reload users to reflect changes
      if (admin?.company_id) {
        await loadBootstrap(admin.company_id);
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

  const createUser = async (data: any) => {
    if (!currentUserId) throw new Error('User not authenticated');
    const res = await fetchWithAuth(`${API_URL}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-ID': currentUserId },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw await res.json();
    return await res.json();
  };

  const updateUser = async (id: string, updates: any) => {

    if (!currentUserId) throw new Error('User not authenticated');
    const res = await fetchWithAuth(`${API_URL}/api/users/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-User-ID': currentUserId },
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw await res.json();
    return await res.json();
  };

  const deleteUser = async (id: string) => {
    if (!currentUserId) throw new Error('User not authenticated');
    const res = await fetchWithAuth(`${API_URL}/api/users/${id}`, {
      method: 'DELETE',
      headers: { 'X-User-ID': currentUserId },
    });
    if (!res.ok) throw await res.json();
    return await res.json();
  };

  if (loading) {
    return (
      showLoadingProgress
        ? <LoadingProgress label="Loading employees..." progress={loadingProgress} />
        : (
          <div className="flex items-center justify-center min-h-screen">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        )
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
      {/* Header Card */}
      <div className="bg-white rounded-xl shadow-sm p-8 border border-slate-200 mb-8">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">User Management</h1>
        <p className="text-slate-600">Manage users, assign sprints, and organize by departments</p>
      </div>
      
      {/* success banners are shown via unified Radix toasts now */}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Navigation Tabs */}
      {/* <div className="flex gap-4 border-b"> */}
        {/* <Button
          variant={!showAssignmentsView ? "default" : "ghost"}
          onClick={() => setShowAssignmentsView(false)}
          className="border-b-2 border-transparent data-[active=true]:border-blue-500"
        >
          <Users className="w-4 h-4 mr-2" />
          User Management
        </Button> */}
        {/* <Button
          variant={showAssignmentsView ? "default" : "ghost"}
          onClick={() => setShowAssignmentsView(true)}
          className="border-b-2 border-transparent data-[active=true]:border-blue-500"
        >
          <BookOpen className="w-4 h-4 mr-2" />
          Performance Sprint Assignments
        </Button> */}
      {/* </div> */}

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
                  departments={departments}
                  roles={roles}
                  onSuccess={() => {
                    loadBootstrap(admin.company_id);
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
                    Assign Sprints
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                {/* <CardTitle className="flex items-center">
                  <Filter className="w-5 h-5 mr-2" />
                  Filter & Search Users
                </CardTitle>
                 */}
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
                <Button
                  variant="outline"
                  onClick={() => setShowFilters(!showFilters)}
                  className="flex items-center gap-2"
                >
                  {showFilters ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  {showFilters ? 'Hide Filters' : 'Show Filters'}
                </Button>
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
                              {[...departments]
                                .sort((a, b) => {
                                  const fullNameA = `${a.department_name} - ${a.sub_department_name}`;
                                  const fullNameB = `${b.department_name} - ${b.sub_department_name}`;
                                  return fullNameA.localeCompare(fullNameB);
                                })
                                .map(dept => ({
                                  id: dept.department_id,
                                  name: dept.department_name,
                                  fullName: `${dept.department_name} - ${dept.sub_department_name}`
                                }))
                                .filter((value, index, self) => self.findIndex(v => v.id === value.id) === index)
                                .map(dept => (
                                  <label
                                    key={dept.id}
                                    className="flex items-center space-x-2 p-2 hover:bg-gray-50 rounded cursor-pointer"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={selectedDepartments.includes(dept.name)}
                                      onChange={() => handleDepartmentToggle(dept.name)}
                                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                    />
                                    <span className="text-sm">{dept.fullName}</span>
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
          

          {/* Bulk Actions Bar - always visible; enable button only when selection > 0 */}
          

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
                <>
                  {/* Desktop Table View */}
                  <div className="overflow-x-auto hidden md:block">
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

                  {/* Mobile Card View */}
                  <div className="grid grid-cols-1 gap-4 md:hidden">
                    {filteredUsers.map(user => (
                      <div key={user.user_id} className="bg-white rounded-lg border p-4 space-y-3">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-3">
                            <input
                              type="checkbox"
                              checked={selectedUsers.includes(user.user_id)}
                              onChange={() => handleSelectUser(user.user_id)}
                              className="rounded mt-1"
                            />
                            <div>
                              <p className="font-semibold text-gray-800">{user.name || 'No Name'}</p>
                              <p className="text-sm text-gray-500">{user.email}</p>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => handleEditUser(user)}
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => handleDeleteUser(user)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4 text-sm pt-3 border-t">
                          <div>
                            <p className="text-xs text-gray-500 uppercase font-semibold">Status</p>
                            <Badge variant="outline" className={
                                user.employment_status === 'ACTIVE' ? 'text-green-800 border-green-300' :
                                user.employment_status === 'TERMINATED' ? 'text-red-800 border-red-300' :
                                'text-gray-700 border-gray-300'
                              }>
                                {user.employment_status || 'ACTIVE'}
                              </Badge>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500 uppercase font-semibold">Role</p>
                            <p className="font-medium text-gray-700">{user.role?.display_name || 'USER'}</p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500 uppercase font-semibold">Position</p>
                            <p className="font-medium text-gray-700">{user.position || 'Not specified'}</p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500 uppercase font-semibold">Department</p>
                            <p className="font-medium text-gray-700">{user.department?.department_name || 'N/A'}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
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
        companyName={admin.company_name || ''}
        adminId={admin.user_id}
        departments={departments}
        roles={roles}
        isAdmin={isAdmin}
        isSuperAdmin={isSuperAdmin}
        isDeveloper={isDeveloper}
        onSuccess={() => {
          loadBootstrap(admin.company_id);
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
          adminId={admin.user_id}
          companyName={admin.company_name || ''}
          isAdmin={isAdmin}
          isSuperAdmin={isSuperAdmin}
          isDeveloper={isDeveloper}
          currentRole={selectedEmployee.role ? [selectedEmployee.role.name] : []}
          departments={departments}
          roles={roles}
          onSuccess={() => {
            loadBootstrap(admin.company_id);
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
                onClick={onAssignNewUsers}
                className="bg-green-600 hover:bg-green-700"
              >
                Assign Only to New Users
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
function UserBulkAdd({ companyId, adminId, departments, roles, onSuccess, onError }: any) {
  const [mode, setMode] = useState<'manual' | 'upload' | 'detailed'>('upload');
  const [showModal, setShowModal] = useState(false);
  const [manualEmails, setManualEmails] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string[][]>([]);
  // const [departments, setDepartments] = useState<Department[]>([]);
  // const [roles, setRoles] = useState<Role[]>([]);

  // Add checkEmailExists function here
  const checkEmailExists = async (email: string): Promise<boolean> => {
    try {
      if (!companyId || !adminId) return false;
      const res = await fetchWithAuth(`${API_URL}/api/users/company/${companyId}`, {
        headers: { 'X-User-ID': adminId }
      });
      
      if (!res.ok) return false;
      
      const { users } = await res.json();
      return users?.some((u: any) => 
        u.email?.toLowerCase() === email.toLowerCase()
      ) || false;
    } catch (error) {
      console.error('Error checking email:', error);
      return false;
    }
  };

  // Load departments and roles when component mounts
  // useEffect(() => {
  //   loadDropdownData();
  // }, []);

  // const loadDropdownData = async () => {
  //   try {
  //     const dRes = await fetchWithAuth(`${API_URL || ''}/api/sub-departments/`);
  //     if (dRes.ok) {
  //       const dPayload = await dRes.json();
  //       setDepartments(dPayload.data || []);
  //     }

  //     const rRes = await fetchWithAuth(`${API_URL || ''}/api/roles/`);
  //     if (rRes.ok) {
  //       const rPayload = await rRes.json();
  //       setRoles(rPayload.data || []);
  //     }
  //   } catch (error){
  //     console.error('Error loading dropdown data:', error);
  //   }
  // };

  const handleManualAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId || !manualEmails.trim()) return;

    setUploading(true);
    onError('');

    try {
      const emails = manualEmails.split(',').map(email => email.trim()).filter(email => email);
      const results = { added: 0, skipped: 0, errors: [] as string[] };
      
      const existingUsersRes = await fetchWithAuth(
        `${API_URL}/api/users/company/${companyId}`,
        {
          headers: { 'X-User-ID': adminId }
        }
      );

      let existingEmails = new Set<string>();

      if (existingUsersRes.ok) {
        const existingData = await existingUsersRes.json();

        existingEmails = new Set(
          (existingData.users || [])
            .map((u: any) => u.email?.toLowerCase())
            .filter(Boolean)
        );
      }

      for (const email of emails) {
        try {
          // Check if email already exists via API
          // const checkRes = await fetchWithAuth(`${API_URL}/api/users/company/${companyId}`, {
          //   headers: { 'X-User-ID': adminId }
          // });
          // let exists = false;
          // if (checkRes.ok) {
          //   const checkData = await checkRes.json();
          //   exists = checkData.users?.some((u: any) => u.email.toLowerCase() === email.toLowerCase());
          // }
          const exists = existingEmails.has(email.toLowerCase());
          if (exists) {
            results.skipped++;
            continue;
          }
          // Create user via backend API
          const createRes = await fetchWithAuth(`${API_URL}/api/users/`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-User-ID': adminId
            },
            body: JSON.stringify({
              email: email.toLowerCase(),
              company_id: companyId,
              hire_date: new Date().toISOString().split('T')[0]
            })
          });
          if (!createRes.ok) {
            const errorData = await createRes.json();
            results.errors.push(`${email}: ${errorData.detail || 'Failed to create user'}`);
            continue;
          }
          results.added++;
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
        // console.log(text.split(/\r?\n/).map(line => line.split(',')))
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
      let rolesData = [];
      let departmentsData = [];
      try {
        const [rRes, dRes] = await Promise.all([
          fetchWithAuth(`${API_URL || ''}/api/roles/`),
          fetchWithAuth(`${API_URL || ''}/api/sub-departments/`)
        ]);
        if (rRes.ok) {
          const rPayload = await rRes.json();
          rolesData = rPayload.data || [];
        }
        if (dRes.ok) {
          const dPayload = await dRes.json();
          departmentsData = dPayload.data || [];
        }
      } catch (err) {
        console.warn('Error fetching roles/departments for upload:', err);
      }
      
      let companiesData: any[] = [];
      try{
        const compRes = await fetchWithAuth(`${API_URL}/api/companies/`, {
          headers: { 'X-User-ID': adminId }
        });
        if (compRes.ok) {
          const compPayload = await compRes.json().catch(() => null);
          companiesData = compPayload?.data?.companies ?? compPayload?.companies ?? (Array.isArray(compPayload?.data) ? compPayload.data : []) ?? [];
      }else{
        console.warn('Failed to fetch companies for bulk upload mapping');
      }
    } catch (err) {
      console.warn('Error during file upload processing:', err);
    }
      
      const rolesMap = new Map(rolesData?.map((r: any) => [r.name.toLowerCase(), r.role_id]) || []);
      const departmentsMap = new Map(departmentsData?.map((d: any) => [`${d.department_name.toLowerCase()}-${d.sub_department_name.toLowerCase()}`, d.department_id]) || []);
      const companiesMap = new Map(companiesData?.map((c: any) => [c.name.toLowerCase(), c.company_id]) || []);
      let temp = false;
      // for (const row of dataRows) {
      //   // Expected format from old admin: company_user_id, email, name, company_name, department, sub_department, employment_status, roles, position, phone
      //   if (row.length < 3 || !row[1]) continue; // Need at least company_user_id, email, name
      //   const [, email, name, companyName, department, subDepartment, employmentStatus, roles, position, phone] = row.map(cell => cell || '');
        
      //   try {
      //     // Validate required fields
      //     if (!name || !email) {
      //       // console.log(name)
      //       // console.log(email)
      //       results.errors.push(`Row ${dataRows.indexOf(row) + 1}: Name and email are required`);
      //       continue;
      //     }

      //     // Email validation
      //     const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      //     if (!emailRegex.test(email)) {
      //       // console.log("Error because of the email")
      //       results.errors.push(`${email}: Invalid email format`);
      //       continue;
      //     }

      //     // Check if email already exists (but not for current user)
      //     const emailExists = await checkEmailExists(email);
      //     if (emailExists) {
      //       results.errors.push('An employee with this email already exists');
      //     }

      //     // Find department ID
      //     let departmentId = null;
      //     if (department && subDepartment) {
      //       const deptKey = `${department.toLowerCase()}-${subDepartment.toLowerCase()}`;
      //       departmentId = departmentsMap.get(deptKey) || null;
            
      //       if (!departmentId) {
      //         // console.log("Error because of the department ID is missing")
      //         results.errors.push(`${email}: Department "${department}" - "${subDepartment}" not found`);
      //         continue;
      //       }
      //     }

      //     // Find company ID
      //     let userCompanyId: any = companyId; // Default to admin's company
      //     if (companyName) {
      //       const foundCompanyId = companiesMap.get(companyName.toLowerCase());
      //       if (foundCompanyId) {
      //         userCompanyId = foundCompanyId;
      //       }
      //     }

      //     // Create user via API
      //     try {
      //       const createRes = await fetchWithAuth(`${API_URL}/api/users/`, {
      //         method: 'POST',
      //         headers: {
      //           'Content-Type': 'application/json',
      //           'X-User-ID': adminId
      //         },
      //         body: JSON.stringify({
      //           name: name,
      //           email: email.toLowerCase(),
      //           company_id: userCompanyId,
      //           department_id: departmentId,
      //           position: position || null,
      //           phone: phone ? String(phone) : null,
      //           hire_date: new Date().toISOString().split('T')[0]
      //         })
      //       });

      //       if (!createRes.ok) {
      //         const errorData = await createRes.json();
      //         results.errors.push(`${email}: ${errorData.detail || 'Failed to create user'}`);
      //         continue;
      //       }

      //       const { user: userData } = await createRes.json();
            
            
      //       // Learning-style records are initialized via backend routes to avoid browser-side RLS failures.

      //       results.added++;
      //     } catch (createError: any) {
      //       results.errors.push(`${email}: ${createError.message || 'Failed to create user'}`);
      //     }
      //   } catch (e){
      //     console.warn(e);
      //   }
      // }

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
                href="https://fmkikkebrxyzjsffqgex.supabase.co/storage/v1/object/public/KPIs/Sample_Emplyee_No_KPI%20(1).xlsx"
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

function AddUserModal({ isOpen, onClose, companyId, companyName, adminId, departments, roles, isAdmin, isSuperAdmin, isDeveloper, onSuccess }: any) {
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
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [newCompanyName, setNewCompanyName] = useState('');
  const [newCompanyDomain, setNewCompanyDomain] = useState('');
  const [newCompanyLogoFile, setNewCompanyLogoFile] = useState<File | null>(null);
  const [newCompanyLogoPreview, setNewCompanyLogoPreview] = useState('');
  const [creatingCompany, setCreatingCompany] = useState(false);
  const [showProvisionModal, setShowProvisionModal] = useState(false);
  const [provisioningCompany, setProvisioningCompany] = useState<any | null>(null);
  const [templateDepartments, setTemplateDepartments] = useState<Department[]>([]);
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([]);
  const [customFunctionEntries, setCustomFunctionEntries] = useState<CustomFunctionEntry[]>([
    { function_name: '', sub_function_name: '' },
  ]);
  const [provisioningFunctions, setProvisioningFunctions] = useState(false);
  const [provisioningError, setProvisioningError] = useState('');
  let temp = false;

  const canManageCompanySelection = isDeveloper || isSuperAdmin;

  // Filter roles based on current user's role level
  // Admin can only assign 'user' role
  // Super Admin can assign 'user' and 'admin' roles
  const filteredRoles = roles.filter((role: any) => {
    const roleName = (role.name || '').toLowerCase().replace(/[-_\s]/g, '');
    const roleLevel = role.level || 0;

    if (isDeveloper) {
      return true;
    }
    
    if (isSuperAdmin) {
      // Super admin can assign user and admin roles (not super_admin)
      return roleLevel < 4 && !['superadmin', 'super_admin', 'ceo'].includes(roleName);
    } else if (isAdmin) {
      // Admin can only assign user role
      return roleLevel < 3 && !['admin', 'superadmin', 'super_admin', 'ceo'].includes(roleName);
    }
    return false;
  });

  const loadCompanies = async () => {
    try {
      const res = await fetchWithAuth(
        `${API_URL}/api/companies/`,
        {
          headers: {
            'X-User-ID': adminId
          }
        }
      );

      if (!res.ok) {
        console.error(
          'Failed to load companies'
        );
        return;
      }

      const payload =
        await res.json();

      setCompanies(
        payload?.data?.companies ||
        payload?.companies ||
        payload?.data ||
        []
      );
    } catch (err) {
      console.error(
        'Company load failed',
        err
      );
    }
  };

  // Load dropdown data
  useEffect(() => {
    if (!isOpen) return;

    setSelectedCompanyId(companyId || '');

    setFormData(prev => ({
      ...prev,
      company_name: companyName || ''
    }));
  }, [isOpen, companyId, companyName]);

  useEffect(() => {
    if (!isOpen) return;
    if(!(isDeveloper || isSuperAdmin)){ return; }
    loadCompanies();
  }, [isOpen, isDeveloper, isSuperAdmin]);

  const loadDepartmentTemplatesForProvisioning = async () => {
    const response = await fetchWithAuth(`${API_URL}/api/companies/org-templates`, {
      headers: {
        'X-User-ID': adminId,
      },  
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.detail || payload?.error || 'Failed to load department templates');
    }

    const rows: Department[] = payload?.data || [];
    setTemplateDepartments(rows);
    setSelectedTemplateIds(rows.map((row) => row.department_id));
  };

  const updateCustomFunctionEntry = (index: number, field: 'function_name' | 'sub_function_name', value: string) => {
    setCustomFunctionEntries((prev) =>
      prev.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, [field]: value } : entry
      )
    );
  };

  const addCustomFunctionEntry = () => {
    setCustomFunctionEntries((prev) => [...prev, { function_name: '', sub_function_name: '' }]);
  };

  const removeCustomFunctionEntry = (index: number) => {
    setCustomFunctionEntries((prev) => {
      if (prev.length === 1) {
        return [{ function_name: '', sub_function_name: '' }];
      }
      return prev.filter((_, entryIndex) => entryIndex !== index);
    });
  };

  const handleProvisionFunctions = async () => {
    if (!provisioningCompany?.company_id) {
      setProvisioningError('Missing company id for provisioning');
      return;
    }

    const validCustomEntries = customFunctionEntries
      .map((entry) => ({
        function_name: (entry.function_name || '').trim(),
        sub_function_name: (entry.sub_function_name || '').trim(),
      }))
      .filter((entry) => !!entry.function_name)
      .map((entry) => ({
        function_name: entry.function_name,
        sub_function_name: entry.sub_function_name || null,
      }));

    if (selectedTemplateIds.length === 0 && validCustomEntries.length === 0) {
      setProvisioningError('Select at least one template or add one custom function');
      return;
    }

    setProvisioningFunctions(true);
    setProvisioningError('');

    try {
      const response = await fetchWithAuth(
        `${API_URL}/api/companies/${encodeURIComponent(provisioningCompany.company_id)}/provision-functions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-User-ID': adminId,
          },
          body: JSON.stringify({
            selected_department_ids: selectedTemplateIds,
            custom_entries: validCustomEntries,
          }),
        }
      );

      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.error) {
        throw new Error(payload?.detail || payload?.error || 'Failed to provision functions');
      }

      shadcnToast({
        title: 'Company structure provisioned',
        description: 'Functions and sub-functions were added for the new company.',
      });
      setShowProvisionModal(false);
      setProvisioningCompany(null);
    } catch (provisionError: any) {
      setProvisioningError(provisionError?.message || 'Failed to provision functions');
    } finally {
      setProvisioningFunctions(false);
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
      selected_roles: filteredRoles.map((role: any) => role.role_id)
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
        const emailExists = await checkEmailExists(value, '');
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

  // const loadDropdownData = async () => {
  //   try {
  //     try{
  //       const companiesUrl = `${(API_URL || '').replace(/\/$/, '')}/api/companies/`;
  //       const compRes = await fetchWithAuth(companiesUrl, {
  //         headers: { 'X-User-ID': adminId }
  //       });
  //         if (!compRes.ok) {
  //           console.warn("Failed to load companies");
  //           setCompanies([]);
  //         } else {
  //           const compPayload = await compRes.json().catch(()=> null);
  //           const companiesData = compPayload?.data?.companies ?? compPayload?.companies ?? (Array.isArray(compPayload?.data) ? compPayload.data : []) ?? [];
  //           setCompanies(companiesData || []);
  //         }
  //     } catch (e) {
  //       console.error('Error loading companies:', e);
  //       setCompanies([]);
  //   }
  //   } catch (error) {
  //     console.error('Failed to load dropdown data:', error);
  //     setError('Failed to load form data');
  //   }
  // };

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
      const activeCompanyId = companyId;
      const targetCompanyId = canManageCompanySelection ? selectedCompanyId : activeCompanyId;
      if (!targetCompanyId || targetCompanyId === '__create_new__' || !adminId) return false;
      const res = await fetchWithAuth(`${API_URL}/api/users/company/${targetCompanyId}`, {
        headers: { 'X-User-ID': adminId }
      });
      
      if (!res.ok) {
        console.error('Failed to check email');
        return false;
      }
      
      const { users } = await res.json();
      return users?.some((u: any) => 
        u.email?.toLowerCase() === email.toLowerCase() && 
        u.user_id !== currentUserId
      ) || false;
    } catch (error) {
      console.error('Error checking email:', error);
      return false;
    }
  };

  const validateForm = async (): Promise<boolean> => {
    const errors: {[key: string]: string} = {};

    if (canManageCompanySelection && (!selectedCompanyId || selectedCompanyId === '__create_new__')) {
      errors.company_name = 'Please select a company';
    }

    // Name validation
    if (!formData.name.trim()) {
      errors.name = 'Name is required';
    }

    // Email validation
    if (!formData.email.trim()) {
      errors.email = 'Email is required';
    } else if (!validateEmail(formData.email)) {
      errors.email = 'Please enter a valid email address';
    } else{
      const emailExists = await checkEmailExists(formData.email, '');
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

  const handleCreateCompany = async () => {
    setError('');
    if (!newCompanyName.trim() || !newCompanyDomain.trim() || !newCompanyLogoFile) {
      setError('Company name, domain, and logo are required');
      return;
    }

    setCreatingCompany(true);
    try {
      const originalName = newCompanyLogoFile.name || 'logo';
      const ext = originalName.includes('.') ? originalName.split('.').pop()?.toLowerCase() : 'png';
      const safeExt = ext || 'png';
      const safeName = newCompanyName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
      const logoPath = `companies/${safeName || 'company'}-${Date.now()}.${safeExt}`;

      if (!supabase?.storage?.from) {
        throw new Error('Storage client is not configured');
      }
      // console.log("THis is the file path",logoPath)

      const { data: logoUploadData, error: logoUploadError } = await supabase.storage
        .from('logos')
        .upload(logoPath, newCompanyLogoFile, {
          contentType: newCompanyLogoFile.type || undefined,
          upsert: true,
        });


      // console.log("Upload successfull")
      if (logoUploadError || !logoUploadData?.path) {
        throw new Error(logoUploadError?.message || 'Failed to upload company logo');
      }

      const { data: publicLogo } = supabase.storage.from('logos').getPublicUrl(logoUploadData.path);
      const logoUrl = publicLogo?.publicUrl;
      if (!logoUrl) {
        throw new Error('Failed to resolve company logo URL');
      }

      const res = await fetchWithAuth(`${API_URL}/api/companies/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-ID': adminId
        },
        body: JSON.stringify({
          name: newCompanyName.trim(),
          domain: newCompanyDomain.trim().toLowerCase(),
          company_logo: logoUrl,
          learning_style: false
        })
      });

      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.detail || 'Failed to create company');
      }

      // console.log(payload)
      const createdCompany = Array.isArray(payload?.company)
        ? payload.company[0]
        : payload?.company || payload.data?.company || payload?.data[0];
      // console.log(createdCompany);
      if (!createdCompany?.company_id) {
        throw new Error('Company created but missing company_id');
      }

      setCompanies((prev) => {
        const next = [createdCompany, ...prev.filter((c: any) => c.company_id !== createdCompany.company_id)];
        return next;
      });
      setSelectedCompanyId(createdCompany.company_id);
      setFormData(prev => ({ ...prev, company_name: createdCompany.name || prev.company_name }));
      setNewCompanyName('');
      setNewCompanyDomain('');
      setNewCompanyLogoFile(null);
      setNewCompanyLogoPreview('');

      await loadDepartmentTemplatesForProvisioning();
      setProvisioningCompany(createdCompany);
      setShowProvisionModal(true);
    } catch (e: any) {
      setError(e?.message || 'Failed to create company');
    } finally {
      setCreatingCompany(false);
    }
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
      const targetCompanyId = canManageCompanySelection ? selectedCompanyId : companyId;
      if (!targetCompanyId || targetCompanyId === '__create_new__') {
        throw new Error('Company is required');
      }

      // Fetch company's learning style setting
      let learningStyleEnabled: boolean | null = null;
      try {
        const companyRes = await fetchWithAuth(`${API_URL}/api/companies/${encodeURIComponent(targetCompanyId)}`);
        if (companyRes.ok) {
          const compPayload = await companyRes.json().catch(() => null);
          const companyData = compPayload?.company ?? compPayload;
          learningStyleEnabled = companyData?.learning_style ?? null;
        } else {
          console.error('Failed to fetch company data:', companyRes.status);
        }
      } catch (compErr) {
        console.error('Failed to fetch company data:', compErr);
      }
      // Create user via API
      const createRes = await fetchWithAuth(`${API_URL}/api/users/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-ID': adminId
        },
        body: JSON.stringify({
          name: formData.name,
          email: formData.email.toLowerCase(),
          company_id: targetCompanyId,
          department_id: formData.department_id || null,
          position: formData.position || null,
          phone: formData.phone || null,
          hire_date: new Date().toISOString().split('T')[0]
        })
      });

      if (!createRes.ok) {
        const errorData = await createRes.json();
        throw new Error(errorData.detail || 'Failed to create user');
      }

      const responseData = await createRes.json();
      // console.log(responseData);
      // Handle both array and object responses from backend
      const userPayload = responseData?.data?.user || responseData?.user;
      const userData = Array.isArray(userPayload) ? userPayload[0] : userPayload;
      
      // Validate that we received a valid user with user_id
      if (!userData || !userData.user_id) {
        setError('Failed to create user: No user ID returned from server');
        setLoading(false);
        return;
      }
      
      // Learning-style records are initialized via backend routes to avoid browser-side RLS failures.

      // If roles are selected, create multiple role assignments
      if (formData.selected_roles.length > 0) {
        for (const roleId of formData.selected_roles) {
          try {
            await fetchWithAuth(`${API_URL}/api/roles/assignments`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-User-ID': adminId
              },
              body: JSON.stringify({
                user_id: userData.user_id,
                role_id: roleId,
                scope_type: 'COMPANY',
                scope_id: targetCompanyId,
                notes: 'Assigned during user creation'
              })
            });
          } catch (err) {
            console.error('Role assignment failed for role', roleId, err);
          }
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
      if (error.message.includes('users_email_key') || (error.code === '23505' && error.message.includes('email'))) {
        setError('Oops! This email already exists.');
      } else if (error.message.includes('users_phone_key') || error.message.includes('phone')) {
        setError('Oops! This number already exists.');
      } else {
        setError('Failed to create employee: ' + error.message);
      }
    } finally {
      setLoading(false);
    }
  };

  // Get unique departments
  const uniqueDepartments = Array.from(
    new Set((departments || []).map((sd: any) => sd.department_name))
  ).sort();

  // Get subdepartments for selected department
  const selectedDepartmentName = departments.find((sd: any) => sd.department_id === formData.department_id)?.department_name;
  const availableSubDepartments = (selectedDepartmentName
  ? departments.filter((sd: any) => sd.department_name === selectedDepartmentName)
  : departments
).sort((a: any, b: any) => {
  const deptSort = (a.department_name || '').localeCompare(b.department_name || '');
  if (deptSort !== 0) return deptSort;
  return (a.sub_department_name || '').localeCompare(b.sub_department_name || '');
});

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

            {/* Company Name - Read-only for admin/super_admin */}
            <div>
              <Label htmlFor="company_name">Company Name</Label>
              {canManageCompanySelection ? (
                <>
                  <select
                    id="company_name"
                    name="company_name"
                    value={selectedCompanyId || ''}
                    onChange={(e) => {
                      setSelectedCompanyId(e.target.value);
                      if (fieldErrors.company_name) {
                        setFieldErrors(prev => ({ ...prev, company_name: '' }));
                      }
                    }}
                    className={`w-full p-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${fieldErrors.company_name ? 'border-red-500' : 'border-gray-300'}`}
                  >
                    <option value="">Select Company</option>
                    {companies.map((company: any) => (
                      <option key={company.company_id} value={company.company_id}>
                        {company.name}
                      </option>
                    ))}
                    <option value="__create_new__">+ Create New Company</option>
                  </select>
                  {fieldErrors.company_name && (
                    <p className="text-red-500 text-sm mt-1">{fieldErrors.company_name}</p>
                  )}

                  {selectedCompanyId === '__create_new__' && (
                    <div className="mt-3 space-y-2 border border-gray-200 rounded-md p-3 bg-gray-50">
                      <Input
                        placeholder="New company name"
                        value={newCompanyName}
                        onChange={(e) => setNewCompanyName(e.target.value)}
                      />
                      <Input
                        placeholder="Company domain (e.g. acme.com)"
                        value={newCompanyDomain}
                        onChange={(e) => setNewCompanyDomain(e.target.value)}
                      />
                      <Input
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0] || null;
                          setNewCompanyLogoFile(file);
                          if (!file) {
                            setNewCompanyLogoPreview('');
                            return;
                          }
                          const reader = new FileReader();
                          reader.onload = () => setNewCompanyLogoPreview(String(reader.result || ''));
                          reader.readAsDataURL(file);
                        }}
                      />
                      {newCompanyLogoPreview && (
                        <div className="rounded-md border border-gray-200 bg-white p-2 w-fit">
                          <img
                            src={newCompanyLogoPreview}
                            alt="Company logo preview"
                            className="h-12 w-auto object-contain"
                          />
                        </div>
                      )}
                      <p className="text-xs text-gray-500">Upload company logo (stored in logos bucket).</p>
                      <Button type="button" variant="outline" onClick={handleCreateCompany} disabled={creatingCompany}>
                        {creatingCompany ? 'Creating company...' : 'Create Company'}
                      </Button>
                    </div>
                  )}
                  <p className="text-xs text-gray-500 mt-1">Developers and Super Admins can create users in any company.</p>
                </>
              ) : (
                <>
                  <Input
                    id="company_name"
                    name="company_name"
                    type="text"
                    value={companyName || formData.company_name}
                    readOnly
                    disabled
                    className="w-full p-2 border border-gray-300 rounded-md bg-gray-50 text-gray-700"
                  />
                  <p className="text-xs text-gray-500 mt-1">Company is automatically set based on your account</p>
                </>
              )}
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
                    disabled={formData.selected_roles.length === filteredRoles.length}
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
                {filteredRoles.length === 0 ? (
                  <div className="p-3 text-gray-500 text-center">No roles available for assignment</div>
                ) : (
                  <div className="p-2 space-y-2">
                    {filteredRoles.map((role: any) => (
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
                {isDeveloper && <span className="ml-2 text-emerald-600">(Developers can assign all roles)</span>}
                {isAdmin && !isSuperAdmin && !isDeveloper && <span className="ml-2 text-amber-600">(Admins can only assign User role)</span>}
                {isSuperAdmin && !isDeveloper && <span className="ml-2 text-blue-600">(Super Admins can assign User and Admin roles)</span>}
              </div>

              {/* Selected Roles Preview */}
              {formData.selected_roles.length > 0 && (
                <div className="mt-2">
                  <span className="text-xs text-gray-600 block mb-1">Selected Roles:</span>
                  <div className="flex flex-wrap gap-1">
                    {formData.selected_roles.map(roleId => {
                      const role = filteredRoles.find((r: any) => r.role_id === roleId);
                      return role ? (
                        <span key={roleId} className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs">
                          {role.name}
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
            <div className="flex  gap-3 pt-4 border-t">
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
                
                    className="bg-blue-600 hover:bg-blue-700"
                disabled={loading || !formData.name || !formData.email || !!fieldErrors.email || !!fieldErrors.phone || !!fieldErrors.name}
              >
                {loading ? 'Creating...' : 'Create Employee'}
              </Button>
            </div>
          </form>

          {showProvisionModal && provisioningCompany && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
              <div className="bg-white rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto">
                <div className="p-6 border-b border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900">Provision Company Functions</h3>
                  <p className="text-sm text-gray-600 mt-1">
                    Select default department templates and optionally add custom function/sub-function pairs for {provisioningCompany?.name}.
                  </p>
                </div>

                <div className="p-6 space-y-6">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label>Default Templates From sub_department</Label>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedTemplateIds(templateDepartments.map((row) => row.department_id))}
                        >
                          Select All
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedTemplateIds([])}
                        >
                          Clear
                        </Button>
                      </div>
                    </div>

                    <div className="border border-gray-300 rounded-md max-h-56 overflow-y-auto">
                      {templateDepartments.length === 0 ? (
                        <div className="p-3 text-gray-500 text-center">No department templates found</div>
                      ) : (
                        <div className="p-2 space-y-1">
                          {templateDepartments.map((row) => (
                            <label key={row.department_id} className="flex items-start space-x-3 p-2 hover:bg-gray-50 rounded cursor-pointer">
                              <input
                                type="checkbox"
                                checked={selectedTemplateIds.includes(row.department_id)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedTemplateIds((prev) => [...prev, row.department_id]);
                                  } else {
                                    setSelectedTemplateIds((prev) => prev.filter((id) => id !== row.department_id));
                                  }
                                }}
                                className="mt-1 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              />
                              <div className="text-sm text-gray-800">
                                <span className="font-medium">{row.department_name}</span>
                                <span className="text-gray-500">{' -> '}{row.sub_department_name || 'No sub-function'}</span>
                              </div>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label>Custom Function/Sub-Function</Label>
                      <Button type="button" variant="outline" size="sm" onClick={addCustomFunctionEntry}>
                        + Add Row
                      </Button>
                    </div>
                    <div className="space-y-2">
                      {customFunctionEntries.map((entry, index) => (
                        <div key={index} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2 items-center">
                          <Input
                            placeholder="Function name"
                            value={entry.function_name}
                            onChange={(e) => updateCustomFunctionEntry(index, 'function_name', e.target.value)}
                          />
                          <Input
                            placeholder="Sub-function name (optional)"
                            value={entry.sub_function_name}
                            onChange={(e) => updateCustomFunctionEntry(index, 'sub_function_name', e.target.value)}
                          />
                          <Button type="button" variant="outline" onClick={() => removeCustomFunctionEntry(index)}>
                            Remove
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {provisioningError && (
                    <Alert variant="destructive">
                      <AlertDescription>{provisioningError}</AlertDescription>
                    </Alert>
                  )}
                </div>

                <div className="p-6 border-t border-gray-200 flex justify-end gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowProvisionModal(false);
                      setProvisioningCompany(null);
                    }}
                    disabled={provisioningFunctions}
                  >
                    Skip for now
                  </Button>
                  <Button
                    type="button"
                    onClick={handleProvisionFunctions}
                    disabled={provisioningFunctions}
                  >
                    {provisioningFunctions ? 'Provisioning...' : 'Provision Functions'}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LearningPlanAssignmentsView({ learningPlans, users, trainingModules, companyId, onAssignmentChange, onSuccess, onError }: any) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Performance Sprint Assignments</CardTitle>
        <CardDescription>View and manage Performance Sprint assignments</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-gray-600 py-8 text-center">Performance Sprint assignments view coming soon</p>
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
  const [dueDate, setDueDate] = useState('');
  const [assignableUsers, setAssignableUsers] = useState<string[]>([]);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [duplicateAssignments, setDuplicateAssignments] = useState<any[]>([]);
  const [moduleSearchTerm, setModuleSearchTerm] = useState('');
  const [moduleSortOrder, setModuleSortOrder] = useState<'asc' | 'desc'>('asc');

  // Load available modules
  useEffect(() => {
    if (isOpen && companyId) {
      loadModules();
    }
  }, [isOpen, companyId]);

  const handleAssignOnlyNewUsers = async () => {

    setShowDuplicateModal(false);

    const learningPlans = [];

    for (const userId of assignableUsers) {
      for (const moduleId of selectedModules) {
        learningPlans.push({
          user_id: userId,
          module_id: moduleId,
          assigned_on: new Date().toISOString(),
          due_date: dueDate || null,
          baseline_assessment: false,
          status: 'ASSIGNED'
        });
      }
    }

    // Existing createRes loop can be reused here
      let successCount = 0;
      let failCount = 0;

      for (const plan of learningPlans) {
        try {
          const createRes = await fetchWithAuth(
            `${API_URL}/api/learning-plans/`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-User-ID': adminId
              },
              body: JSON.stringify(plan)
            }
          );

          if (createRes.ok) {
            successCount++;
          } else {
            const errorData = await createRes.json();

            if (
              errorData.detail?.includes('23505') ||
              errorData.detail?.includes('duplicate')
            ) {
              // duplicate skip
            } else {
              failCount++;
              console.error('Failed to create assignment:', errorData);
            }
          }
        } catch (e) {
          failCount++;
          console.error('Error creating assignment:', e);
        }
      }

      // ADD THIS BLOCK HERE
      sharedDataClient.invalidateByPrefix("v1|dashboard");
      sharedDataClient.invalidateByPrefix("v1|training-plan");

      try {
        shadcnToast({
          title: 'Modules Assigned!',
          description: `Successfully assigned modules to new users.`,
          duration: 7000,
        });
      } catch (e) {
        console.warn('Toast error', e);
      }

      onSuccess();
      setLoading(false);

      // CLOSE THE FUNCTION HERE
      };


  const loadModules = async () => {
    setLoadingModules(true);
    setError('');

    try {
      let completedModuleIds: string[] = [];

      try {
        const jobsRes = await fetchWithAuth(
          `${API_URL}/api/content-jobs/?status=completed&limit=1000`,
          {
            headers: { 'X-User-ID': adminId }
          }
        );

        if (!jobsRes.ok) {
          completedModuleIds = [];
        } else {
          const jobsPayload = await jobsRes.json().catch(() => null);
          const completeJobs = jobsPayload?.jobs ?? jobsPayload?.data ?? [];
          completedModuleIds = (completeJobs || [])
            .map((job: any) => job.module_id)
            .filter(Boolean);
        }
      } catch (e) {
        console.warn("Error fetching content jobs:", e);
        completedModuleIds = [];
      }

      if (completedModuleIds.length === 0) {
        setModules([]);
        return;
      }

      const tmRes = await fetchWithAuth(
        `${API_URL}/api/training-modules/company/${encodeURIComponent(companyId)}`,
        {
          headers: { 'X-User-ID': adminId }
        }
      );

      if (!tmRes.ok) {
        console.warn('[Bulk-assign] Failed to fetch training modules:', tmRes.status);
        setModules([]);
        return;
      }

      const payload = await tmRes.json().catch(() => ({}));
      const allModules = payload.modules || [];

      const filtered = allModules.filter((m: any) =>
        completedModuleIds.includes(m.module_id)
      );

      filtered.sort((a: any, b: any) =>
        (a.title || '').localeCompare(b.title || '')
      );

      setModules(filtered || []);

    } catch (error: any) {
      setError('Failed to load modules: ' + error.message);
    } finally {
      setLoadingModules(false);
    }
  };

  // const loadModules = async () => {
  //   setLoadingModules(true);
  //   setError('');
    
  //   try {
  //     let completedModuleIds: string[] = [];
  //     try {
  //       const jobsRes = await fetchWithAuth(`${API_URL}/api/content-jobs/?status=completed&limit=1000`, {
  //         headers: { 'X-User-ID': adminId }
  //       });
  //       if (!jobsRes.ok) {
  //         const errorText = await jobsRes.text().catch(() => '');
  //         // console.error('[bulk-assign] Failed to fetch content jobs:', jobsRes.status, errorText);
  //         // console.error('[bulk-assign] Using adminId:', adminId);
  //         completedModuleIds = [];
  //       } else {
  //         const jobsPayload = await jobsRes.json().catch(() => null);
  //         const completeJobs = jobsPayload?.jobs ?? jobsPayload?.data ?? [];
  //         completedModuleIds = (completeJobs || []).map((job: any) => job.module_id).filter(Boolean);
  //         // console.log(`[bulk-assign] Found ${completedModuleIds.length} completed modules`);
  //       }
  //     } catch (e) {
  //       console.warn("Error fetching content jobs:", e);
  //       completedModuleIds = [];
  //     }
      
  //     if (completedModuleIds.length === 0) {
  //       setModules([]);
  //       setModuleBaselineSettings({});
  //       return;
  //     }
      
  //     try{
  //       const tmRes = await fetchWithAuth(`${API_URL}/api/training-modules/company/${encodeURIComponent(companyId)}`, {
  //         headers: { 'X-User-ID': adminId }
  //       });
  //       if(!tmRes.ok) {
  //         console.warn('[Bulk-assign] Failed to fetch training modules:', tmRes.status);
  //         setModules([]);
  //         setModuleBaselineSettings({});
  //         return;
  //     }
  //     const payload = await tmRes.json().catch(() => ({}));
  //     const allModules = payload.modules || [];
  //     const filtered = allModules.filter((m: any) =>
  //       completedModuleIds.includes(m.module_id)
  //     );

  //     filtered.sort((a: any, b: any) =>
  //       (a.title || '').localeCompare(b.title || '')
  //     );

  //     setModules(filtered || []);

  //     const initialSettings: { [moduleId: string]: boolean } = {};
  //     filtered.forEach((module: any) => {
  //       initialSettings[module.module_id] = false;
  //     });

  //     setModuleBaselineSettings(initialSettings);
  //     } catch (error: any) {
  //       setError('Failed to load modules: ' + error.message);
  //     } finally {
  //       setLoadingModules(false);
  //     }
  //   };

  const handleModuleToggle = (moduleId: string) => {
    setSelectedModules(prev =>
      prev.includes(moduleId)
        ? prev.filter(id => id !== moduleId)
        : [...prev, moduleId]
    );
  };

  const selectAllModules = () => {
    setSelectedModules((prev) => {
      const visibleIds = filteredAndSortedModules.map((module) => module.module_id);
      const merged = Array.from(new Set([...prev, ...visibleIds]));
      return merged;
    });
  };

  const clearAllModules = () => {
    setSelectedModules([]);
  };

  // Add functions to toggle baseline for all modules
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
      // First, check for existing assignments to prevent duplicates via backend API
      if (!adminId) {
        setError('Admin user ID not found');
        setLoading(false);
        return;
      }

      const lpRes = await fetchWithAuth(
        `${API_URL}/api/learning-plans/?limit=5000`,
        { headers: { 'X-User-ID': adminId } }
      );

      if (!lpRes.ok) {
        console.error('Error checking existing assignments');
        setError('Failed to check existing assignments. Please try again.');
        setLoading(false);
        return;
      }

      const lpData = await lpRes.json();
      const allPlans = lpData?.plans || [];
      
      // Filter to find existing assignments
      const existingAssignments = allPlans.filter((lp: any) =>
        selectedUsers.includes(lp.user_id) && selectedModules.includes(lp.module_id)
      );

      // If there are existing assignments, show the duplicate modal
      if (existingAssignments.length > 0) {

        const duplicateUserIds = [
          ...new Set(existingAssignments.map(a => a.user_id))
        ];

        const newUserIds = selectedUsers.filter(
          userId => !duplicateUserIds.includes(userId)
        );
        if (newUserIds.length === 0) {
          setDuplicateAssignments(existingAssignments);
          setAssignableUsers([]);
          setShowDuplicateModal(true);
          setLoading(false);
          return;
        }

        setAssignableUsers(newUserIds);
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
            baseline_assessment: false,
            status: 'ASSIGNED'
          });
        }
      }

      // Create learning plans via backend API
      if (!adminId) {
        setError('Admin user ID not found');
        setLoading(false);
        return;
      }

      let successCount = 0;
      let failCount = 0;

      for (const plan of learningPlans) {
        try {
          const createRes = await fetchWithAuth(`${API_URL}/api/learning-plans/`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-User-ID': adminId
            },
            body: JSON.stringify(plan)
          });

          if (createRes.ok) {
            successCount++;
          } else {
            const errorData = await createRes.json();
            if (errorData.detail?.includes('23505') || errorData.detail?.includes('duplicate')) {
              // Handle duplicates silently or log
              // console.log('Duplicate assignment skipped:', plan);
            } else {
              failCount++;
              console.error('Failed to create assignment:', errorData);
            }
          }
        } catch (e) {
          failCount++;
          console.error('Error creating assignment:', e);
        }
      }
      
      // Invalidate the cache for user dashboards globally when assignments change
      sharedDataClient.invalidateByPrefix("v1|dashboard");
      sharedDataClient.invalidateByPrefix("v1|training-plan");
    

      if (failCount > 0) {
        setError(`Created ${successCount} assignments, ${failCount} failed`);
        setLoading(false);
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
      console.error('Failed to assign sprints:', error);
      setError('Failed to assign sprints. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const filteredAndSortedModules = [...modules]
  .filter((module) =>
    module.title?.toLowerCase().includes(moduleSearchTerm.toLowerCase())
  )
  .sort((a, b) => {
    const titleA = a.title?.toLowerCase() || '';
    const titleB = b.title?.toLowerCase() || '';

    return moduleSortOrder === 'asc'
      ? titleA.localeCompare(titleB)
      : titleB.localeCompare(titleA);
  });

  // Get selected user details for display
  const selectedUserDetails = users.filter((user: any) => 
    selectedUsers.includes(user.user_id)
  );

  if (!isOpen) return null;

  const visibleModuleIds = filteredAndSortedModules.map(
    (module) => module.module_id
  );

  const allVisibleSelected =
    visibleModuleIds.length > 0 &&
    visibleModuleIds.every((id) => selectedModules.includes(id));
  
  return (
    <>
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
          <div className="p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-semibold text-gray-900">Assign Sprints</h2>
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
              <div className="flex flex-col gap-3 mb-3">
                <div className="flex items-center justify-between">
                  <Label>Select Training Modules</Label>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative w-[220px]">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                      <Input
                        placeholder="Search sprints..."
                        value={moduleSearchTerm}
                        onChange={(e) => setModuleSearchTerm(e.target.value)}
                        className="pl-9 h-9"
                      />
                    </div>

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setModuleSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
                      }
                    >
                      {moduleSortOrder === 'asc' ? 'A to Z' : 'Z to A'}
                    </Button>

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={selectAllModules}
                      disabled={
                        allVisibleSelected ||
                        loadingModules ||
                        filteredAndSortedModules.length === 0
                      }
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
              ) : filteredAndSortedModules.length === 0 ? (
                <div className="text-center py-8 text-gray-500 border border-gray-200 rounded-lg">
                  <p>No matching sprints found</p>
                  <p className="text-sm">Try a different search term</p>
                </div>
              ) : (
                <div className="border border-gray-300 rounded-md max-h-64 overflow-y-auto">
                  <div className="p-3 space-y-3">
                    {filteredAndSortedModules.map(module => (
                      <div
                        key={module.module_id}
                        className="submodule-card submodule-card--compact grid grid-cols-[1fr_auto_1fr] items-center gap-4"
                      >
                        <label className="flex items-center gap-4 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedModules.includes(module.module_id)}
                            onChange={() => handleModuleToggle(module.module_id)}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 flex-shrink-0"
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
                        </label>
                        <div></div>
                      </div>
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
                        <span key={moduleId} className="bg-green-100 text-green-800 px-2 py-1 rounded text-xs">
                          {module.title}
                        </span>
                      ) : null;
                    })}
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
                  This will create <strong>{selectedModules.length * selectedUsers.length}</strong> Performance Sprint assignments.
                </p>
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
        assignableUsers={assignableUsers}
        onAssignNewUsers={handleAssignOnlyNewUsers}
      />
    </>
  );
}

// Duplicate Assignment Error Modal from old admin
function DuplicateAssignmentModal({ 
  isOpen, 
  onClose, 
  duplicateAssignments,
  assignableUsers,
  onAssignNewUsers
}: { 
  isOpen: boolean;
  onClose: () => void;
  duplicateAssignments: any[];
  assignableUsers: string[];
  onAssignNewUsers: () => void;

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
              {assignableUsers.length > 0 ? (
                  <>
                    <li>• Some selected users already have these sprint assignments.</li>
                    <li>• You can assign the sprint only to users who do not already have it.</li>
                  </>
                ) : (
                  <>
                    <li>• All selected users already have these sprint assignments.</li>
                    <li>• No new assignments can be created.</li>
                  </>
                )}
              
            </ul>
          </div>

          <div className="flex justify-end">
            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={onClose}
              >
                Cancel
              </Button>

              {assignableUsers.length > 0 ? (
                <Button
                  onClick={onAssignNewUsers}
                  className="bg-green-600 hover:bg-green-700"
                >
                  Assign Only New Users
                </Button>
              ) : (
                <Button
                  disabled
                  className="bg-gray-400 cursor-not-allowed"
                >
                  Already Assigned To All Users
                </Button>
              )}
            </div>
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
  adminId,
  companyName,
  isAdmin,
  isSuperAdmin,
  isDeveloper,
  departments,
  roles,
  currentRole, 
  onSuccess 
}: { 
  isOpen: boolean;
  onClose: () => void;
  employee: User;
  adminId: string;
  companyName: string;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  isDeveloper: boolean;
  departments: Department[];
  roles: Role[];
  currentRole?: string[];
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
  const [companies, setCompanies] = useState<any[]>([]);
  const API_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

  // Filter roles based on current user's role level
  // Admin can only assign 'user' role
  // Super Admin can assign 'user' and 'admin' roles
  const filteredRoles = roles.filter((role: any) => {
    const roleName = (role.name || '').toLowerCase().replace(/[-_\s]/g, '');
    const roleLevel = role.level || 0;

    if (isDeveloper) {
      return true;
    }
    
    if (isSuperAdmin) {
      // Super admin can assign user and admin roles (not super_admin)
      return roleLevel < 4 && !['superadmin', 'super_admin', 'ceo'].includes(roleName);
    } else if (isAdmin) {
      // Admin can only assign user role
      return roleLevel < 3 && !['admin', 'superadmin', 'super_admin', 'ceo'].includes(roleName);
    }
    return false;
  });

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
      // Get user roles via backend API instead of direct Supabase call
      const rolesRes = await fetchWithAuth(`${API_URL}/api/roles/users/${employee.user_id}`, {
        headers: { 'X-User-ID': adminId }
      });

      if (!rolesRes.ok) {
        console.error('Failed to load user roles from backend');
        return;
      }

      const rolesPayload = await rolesRes.json();
      const assignments = rolesPayload.assignments || rolesPayload.data || rolesPayload || [];

      const currentRoleIds = assignments.map((assignment: any) => assignment.role_id).filter(Boolean);
      setFormData(prev => ({
        ...prev,
        selected_roles: currentRoleIds
      }));
    } catch (error) {
      console.error('Failed to load user roles:', error);
    }
  };

  const loadCompanies = async () => {
    try{
      const compRes = await fetchWithAuth(`${API_URL}/api/companies/`, {
        headers: { 'X-User-ID': adminId }
      });
      if (!compRes.ok) {
        console.warn("Failed to load companies from backend");
        setCompanies([]);
      } else {
        const compPayload = await compRes.json().catch(() => null);
        const companiesData = compPayload?.data?.companies ?? compPayload?.companies ?? (Array.isArray(compPayload?.data) ? compPayload.data : []) ?? [];
        setCompanies(companiesData || []);
      }
    } catch (e) {
      console.error('Error loading companies:', e);
      setCompanies([]);
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
      selected_roles: filteredRoles.map((role: any) => role.role_id)
    }));
  };

  const clearAllRoles = () => {
    setFormData(prev => ({
      ...prev,
      selected_roles: []
    }));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev: any) => ({ ...prev, [name]: value }));
    // only run email check when email field changes
    if (name === 'email') {
      checkEmailExists(value).then((exists) => {
        setFieldErrors((prev: any) => ({ ...prev, email: exists ? 'Email already exists' : '' }));
      });
    }
  };

  const checkEmailExists = async (email: string, currentUserId?: string): Promise<boolean> => {
    try {
      const selectedCompanyId = employee.company_id ?? '';
      const targetCompanyId = selectedCompanyId;
      if (!targetCompanyId || !adminId) return false;
      const res = await fetchWithAuth(`${API_URL}/api/users/company/${targetCompanyId}`, {
        headers: { 'X-User-ID': adminId }
      });
      if (!res.ok) return false;
      const { users } = await res.json();
      return users?.some((u: any) =>
        u.email?.toLowerCase() === email.toLowerCase() &&
        (currentUserId ? u.user_id !== currentUserId : true)
      ) || false;
    } catch (err) {
      console.error('Error checking email:', err);
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
      // Update user via API
      const updateRes = await fetchWithAuth(`${API_URL}/api/users/${employee.user_id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-User-ID': adminId
        },
        body: JSON.stringify({
          name: formData.name,
          email: formData.email.toLowerCase(),
          department_id: formData.department_id || null,
          position: formData.position || null,
          phone: formData.phone || null,
          employment_status: formData.employment_status || 'ACTIVE'
        })
      });

      if (!updateRes.ok) {
        const errorData = await updateRes.json();
        throw new Error(errorData.detail || 'Failed to update user');
      }

      // Update role assignments via backend API
      // First, get current role assignments
      const currentRolesRes = await fetchWithAuth(`${API_URL}/api/roles/users/${employee.user_id}`, {
        headers: { 'X-User-ID': adminId }
      });

      if (currentRolesRes.ok) {
        const currentRolesPayload = await currentRolesRes.json();
        const currentAssignments = currentRolesPayload.assignments || currentRolesPayload.data || [];

        // Diff: only revoke roles that were removed, only add roles that are new
        const currentRoleIds = new Set(currentAssignments.map((a: any) => a.role_id));
        const newRoleIds = new Set(formData.selected_roles);
        const rolesToRevoke = currentAssignments.filter((a: any) => !newRoleIds.has(a.role_id));
        const rolesToAdd = formData.selected_roles.filter((roleId: string) => !currentRoleIds.has(roleId));

        for (const assignment of rolesToRevoke) {
          try {
            await fetchWithAuth(`${API_URL}/api/roles/assignments/${assignment.user_role_assignment_id}`, {
              method: 'DELETE',
              headers: { 'X-User-ID': adminId }
            });
          } catch (err) {
            console.error('Failed to revoke role assignment:', assignment.user_role_assignment_id, err);
          }
        }

        for (const roleId of rolesToAdd) {
          try {
            await fetchWithAuth(`${API_URL}/api/roles/assignments`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-User-ID': adminId
              },
              body: JSON.stringify({
                user_id: employee.user_id,
                role_id: roleId,
                scope_type: 'COMPANY',
                scope_id: employee.company_id,
                notes: 'Updated role assignment'
              })
            });
          } catch (err) {
            console.error('Role assignment failed for role', roleId, err);
          }
        }
      } else if (formData.selected_roles.length > 0) {
        // Fallback: couldn't load current roles, assign all selected
        for (const roleId of formData.selected_roles) {
          try {
            await fetchWithAuth(`${API_URL}/api/roles/assignments`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-User-ID': adminId
              },
              body: JSON.stringify({
                user_id: employee.user_id,
                role_id: roleId,
                scope_type: 'COMPANY',
                scope_id: employee.company_id,
                notes: 'Updated role assignment'
              })
            });
          } catch (err) {
            console.error('Role assignment failed for role', roleId, err);
          }
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

  useEffect(() => {
    if (isOpen) {
      loadCompanies();
    }
  }, [isOpen]);

  // Get available subdepartments based on current selection
  const availableSubDepartments = [...departments].sort((a: any, b: any) => {
    const deptSort = (a.department_name || '').localeCompare(b.department_name || '');
    if (deptSort !== 0) return deptSort;
    return (a.sub_department_name || '').localeCompare(b.sub_department_name || '');
  });

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
                    disabled={formData.selected_roles.length === filteredRoles.length}
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
                {filteredRoles.length === 0 ? (
                  <div className="p-3 text-gray-500 text-center">No roles available for assignment</div>
                ) : (
                  <div className="p-2 space-y-2">
                    {filteredRoles.map((role: any) => (
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
                {isDeveloper && <span className="ml-2 text-emerald-600">(Developers can assign all roles)</span>}
                {isAdmin && !isSuperAdmin && !isDeveloper && <span className="ml-2 text-amber-600">(Admins can only assign User role)</span>}
                {isSuperAdmin && !isDeveloper && <span className="ml-2 text-blue-600">(Super Admins can assign User and Admin roles)</span>}
              </div>

              {/* Selected Roles Preview */}
              {formData.selected_roles.length > 0 && (
                <div className="mt-2">
                  <span className="text-xs text-gray-600 block mb-1">Selected Roles:</span>
                  <div className="flex flex-wrap gap-1">
                    {formData.selected_roles.map(roleId => {
                      const role = filteredRoles.find((r: any) => r.role_id === roleId);
                      return role ? (
                        <span key={roleId} className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs">
                          {role.name}
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
        <p className="text-xs text-slate-500 font-medium">Preparing employees data. This may take a moment.</p>
      </div>
    </div>
  );
}
