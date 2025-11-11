"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/auth-context";
import { supabase } from "@/lib/supabase";
import { ArrowLeft, User, Mail, Calendar, Building, Save, Edit3 } from "lucide-react";
import EmployeeNavigation from "@/components/employee-navigation";

interface Employee {
  employee_id: string;
  email: string;
  name: string | null;
  joined_at: string;
  company_id: string | null;
  // department: string | null; // Commented out as requested
  position: string | null;
  phone: string | null;
}

interface Company {
  company_id: string;
  name: string;
}

export default function AccountPage() {
  const { user, loading: authLoading } = useAuth();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    // department: "", // Commented out as requested
    position: "",
    phone: "",
  });
  const router = useRouter();

  useEffect(() => {
    if (!authLoading) {
      if (!user) {
        router.push("/employee/login");
      } else {
        fetchEmployeeData();
      }
    }
  }, [user, authLoading, router]);

  const fetchEmployeeData = async () => {
    if (!user?.email) return;

    try {
      // Fetch employee data
      const { data: employeeData, error: employeeError } = await supabase
        .from("employees")
        .select("*")
        .eq("email", user.email)
        .single();

      if (employeeError || !employeeData) {
        console.error("Employee fetch error:", employeeError);
        router.push("/employee/login");
        return;
      }

      setEmployee(employeeData);
      setFormData({
        name: employeeData.name || "",
        // department: employeeData.department || "", // Commented out as requested
        position: employeeData.position || "",
        phone: employeeData.phone || "",
      });

      // Fetch company data if available
      if (employeeData.company_id) {
        const { data: companyData, error: companyError } = await supabase
          .from("companies")
          .select("company_id, name")
          .eq("company_id", employeeData.company_id)
          .single();

        if (!companyError && companyData) {
          setCompany(companyData);
        }
      }
    } catch (error) {
      console.error("Failed to fetch employee data:", error);
      router.push("/employee/login");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!employee) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from("employees")
        .update({
          name: formData.name || null,
          // department: formData.department || null, // Commented out as requested
          position: formData.position || null,
          phone: formData.phone || null,
        })
        .eq("employee_id", employee.employee_id);

      if (error) {
        console.error("Failed to update employee:", error);
        alert("Failed to save changes. Please try again.");
      } else {
        // Update local state
        setEmployee({
          ...employee,
          name: formData.name || null,
          // department: formData.department || null, // Commented out as requested
          position: formData.position || null,
          phone: formData.phone || null,
        });
        setEditing(false);
        alert("Profile updated successfully!");
      }
    } catch (error) {
      console.error("Update error:", error);
      alert("Failed to save changes. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setFormData({
      name: employee?.name || "",
      // department: employee?.department || "", // Commented out as requested
      position: employee?.position || "",
      phone: employee?.phone || "",
    });
    setEditing(false);
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading your profile...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-100">
      <EmployeeNavigation showBack={true} showForward={false} />
      
      {/* Main content area that adapts to sidebar */}
      <div 
        className="transition-all duration-300 ease-in-out"
        style={{ 
          marginLeft: 'var(--sidebar-width, 0px)',
        }}
      >
        {/* Header */}
        <div className="bg-white shadow-sm border-b">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center py-4">
              {/* <Button
                variant="ghost"
                onClick={() => router.push("/employee/welcome")}
                className="mr-4"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Dashboard
              </Button> */}
              <div className="flex items-center">
                <User className="w-8 h-8 text-green-600 mr-3" />
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">Account Settings</h1>
                  <p className="text-sm text-gray-600">Manage your personal information</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Page content */}
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        <div className="grid gap-8">
          {/* Profile Card */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <User className="w-5 h-5" />
                  Personal Information
                </CardTitle>
                <CardDescription>
                  Update your personal details and contact information
                </CardDescription>
              </div>
              {!editing ? (
                <Button onClick={() => setEditing(true)} variant="outline">
                  <Edit3 className="w-4 h-4 mr-2" />
                  Edit Profile
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button onClick={handleCancel} variant="outline" disabled={saving}>
                    Cancel
                  </Button>
                  <Button onClick={handleSave} disabled={saving}>
                    <Save className="w-4 h-4 mr-2" />
                    {saving ? "Saving..." : "Save Changes"}
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid md:grid-cols-2 gap-6">
                {/* Name */}
                <div className="space-y-2">
                  <Label htmlFor="name">Full Name</Label>
                  {editing ? (
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="Enter your full name"
                    />
                  ) : (
                    <div className="p-3 bg-gray-50 rounded-md">
                      {employee?.name || "Not set"}
                    </div>
                  )}
                </div>

                {/* Email (Read-only) */}
                <div className="space-y-2">
                  <Label htmlFor="email">Email Address</Label>
                  <div className="p-3 bg-gray-100 rounded-md text-gray-600 flex items-center gap-2">
                    <Mail className="w-4 h-4" />
                    {employee?.email}
                  </div>
                  <p className="text-xs text-gray-500">Email cannot be changed</p>
                </div>

                {/* Department */}
                {/* <div className="space-y-2">
                  <Label htmlFor="department">Department</Label>
                  {editing ? (
                    <Input
                      id="department"
                      value={formData.department}
                      onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                      placeholder="Enter your department"
                    />
                  ) : (
                    <div className="p-3 bg-gray-50 rounded-md">
                      {employee?.department || "Not set"}
                    </div>
                  )}
                </div> */}

                {/* Position */}
                <div className="space-y-2">
                  <Label htmlFor="position">Position/Title</Label>
                  {editing ? (
                    <Input
                      id="position"
                      value={formData.position}
                      onChange={(e) => setFormData({ ...formData, position: e.target.value })}
                      placeholder="Enter your position"
                    />
                  ) : (
                    <div className="p-3 bg-gray-50 rounded-md">
                      {employee?.position || "Not set"}
                    </div>
                  )}
                </div>

                {/* Phone */}
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone Number</Label>
                  {editing ? (
                    <Input
                      id="phone"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      placeholder="Enter your phone number"
                    />
                  ) : (
                    <div className="p-3 bg-gray-50 rounded-md">
                      {employee?.phone || "Not set"}
                    </div>
                  )}
                </div>

                {/* Company (Read-only) */}
                <div className="space-y-2">
                  <Label>Company</Label>
                  <div className="p-3 bg-gray-100 rounded-md text-gray-600 flex items-center gap-2">
                    <Building className="w-4 h-4" />
                    {company?.name || "Not assigned"}
                  </div>
                </div>
              </div>

              {/* Member Since */}
              <div className="pt-4 border-t">
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Calendar className="w-4 h-4" />
                  <span>Member since {new Date(employee?.joined_at || "").toLocaleDateString()}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Additional Settings Card */}
          <Card>
            <CardHeader>
              <CardTitle>Account Information</CardTitle>
              <CardDescription>
                Additional account details and settings
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-blue-50 rounded-lg">
                  <div>
                    <h3 className="font-medium">Account Status</h3>
                    <p className="text-sm text-gray-600">Your account is active and in good standing</p>
                  </div>
                  <div className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium">
                    Active
                  </div>
                </div>
                
                <div className="p-4 bg-yellow-50 rounded-lg">
                  <h3 className="font-medium text-yellow-800">Need Help?</h3>
                  <p className="text-sm text-yellow-700 mt-1">
                    Contact your administrator if you need to update your email address or company information.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
        </div>
      </div>
    </div>
  );
}
