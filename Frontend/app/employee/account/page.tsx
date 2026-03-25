"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/auth-context";
import { createCacheKey, sharedDataClient } from "@/lib/data-client";
import { fetchWithAuth } from "@/lib/fetch-with-auth";
import { ArrowLeft, User, Mail, Calendar, Building, Save, Edit3, Lock, Eye, EyeOff, X, CheckCircle } from "lucide-react";

interface Employee {
  user_id: string;
  email: string;
  name: string | null;
  created_at: string;
  company_id: string | null;
  position: string | null;
  phone: string | null;
}

interface Company {
  company_id: string;
  name: string;
}

interface Admin {
  user_id: string;
  email: string;
  name: string | null;
  company_id: string;
}

const API_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

export default function AccountPage() {
  const { user, loading: authLoading, employeeData, refreshProfile } = useAuth();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordStep, setPasswordStep] = useState<"current" | "new" | "success">("current");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    position: "",
    phone: "",
  });
  const router = useRouter();

  const fetchCompany = async (companyId: string) => {
    try {
      const result = await sharedDataClient.query(
        createCacheKey({
          namespace: "companies",
          tenantId: companyId,
          path: `/api/companies/${companyId}`,
        }),
        async () => {
          const res = await fetchWithAuth(`${API_URL}/api/companies/${companyId}`);
          if (!res.ok) {
            throw new Error(`Company fetch failed: ${res.status}`);
          }
          return res.json();
        },
        {
          ttlMs: 10 * 60 * 1000,
        },
      );

      const payload = result.data;
      setCompany(payload?.company ?? payload);
    } catch (error) {
      console.error("Failed to fetch company:", error);
      setCompany(null);
    }
  };

  useEffect(() => {
    if (!authLoading) {
      if (!user) {
        router.push("/login");
      } else if (employeeData) {
        setEmployee(employeeData);

        setFormData({
          name: employeeData.name || "",
          position: employeeData.position || "",
          phone: employeeData.phone || "",
        });

        if (employeeData.company_id) {
          fetchCompany(employeeData.company_id);
        } else {
          setCompany(null);
        }

        setLoading(false);
      }
    }
  }, [user, authLoading, employeeData]);

  const handleSave = async () => {
    if (!employee) return;

    setSaving(true);
    try {
      const updRes = await fetchWithAuth(`${API_URL}/api/users/${encodeURIComponent(employee.user_id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json",
          "X-User-ID": employee.user_id,
         },
         body: JSON.stringify({
          name: formData.name,
          position: formData.position,
          phone: formData.phone,
         }),
      });
      if (!updRes.ok) {
        const err = await updRes.text().catch(() => ({detail: updRes.text().catch(()=> "")}));
        console.error("Update failed:", updRes.status, err);
        alert("Failed to save changes. Please try again.");
      } else {
        await refreshProfile();
        setEmployee({
          ...employee,
          name: formData.name,
          position: formData.position,
          phone: formData.phone,
        });
        setEditing(false);
        alert("Changes saved successfully!");
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
      position: employee?.position || "",
      phone: employee?.phone || "",
    });
    setEditing(false);
  };

  const openPasswordModal = () => {
    setShowPasswordModal(true);
    setPasswordStep("current");
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPasswordError("");
    setShowCurrentPassword(false);
    setShowNewPassword(false);
    setShowConfirmPassword(false);
  };

  const closePasswordModal = () => {
    setShowPasswordModal(false);
    setPasswordStep("current");
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPasswordError("");
  };

  const handleValidateCurrentPassword = async () => {
    if (!currentPassword.trim()) {
      setPasswordError("Please enter your current password");
      return;
    }
    setPasswordLoading(true);
    setPasswordError("");
    try {
      const res = await fetchWithAuth(`${API_URL}/api/change-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: employee?.user_id,
          current_password: currentPassword,
          new_password: "", // Empty for validation step
        }),
      });
      const data = await res.json();
      if (res.ok) {
        // Current password is correct
        setPasswordStep("new");
        setPasswordError("");
      } else if (res.status === 401) {
        setPasswordError("Current password is incorrect");
      } else {
        setPasswordError(data.error || "Failed to validate password");
      }
    } catch {
      setPasswordError("Something went wrong. Please try again.");
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleChangePassword = async () => {
    if (!newPassword.trim()) {
      setPasswordError("Please enter a new password");
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError("Password must be at least 6 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords do not match");
      return;
    }
    setPasswordLoading(true);
    setPasswordError("");
    try {
      const res = await fetchWithAuth(`${API_URL}/api/change-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: employee?.user_id,
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setPasswordStep("success");
      } else {
        setPasswordError(data.error || "Failed to change password");
      }
    } catch {
      setPasswordError("Something went wrong. Please try again.");
    } finally {
      setPasswordLoading(false);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading your profile...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-100">
        <div className="bg-white shadow-sm border-b">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center py-4">
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

        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        <div className="grid gap-8">
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

                <div className="space-y-2">
                  <Label htmlFor="email">Email Address</Label>
                  <div className="p-3 bg-gray-100 rounded-md text-gray-600 flex items-center gap-2">
                    <Mail className="w-4 h-4" />
                    {employee?.email}
                  </div>
                  <p className="text-xs text-gray-500">Email cannot be changed</p>
                </div>

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

                <div className="space-y-2">
                  <Label>Company</Label>
                  <div className="p-3 bg-gray-100 rounded-md text-gray-600 flex items-center gap-2">
                    <Building className="w-4 h-4" />
                    {company?.name || "Not assigned"}
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t">
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Calendar className="w-4 h-4" />
                  <span>Member since {new Date(employee?.created_at || "").toLocaleDateString()}</span>
                </div>
              </div>
            </CardContent>
          </Card>

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

                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                  <div>
                    <h3 className="font-medium flex items-center gap-2">
                      <Lock className="w-4 h-4" />
                      Password
                    </h3>
                    <p className="text-sm text-gray-600">Change your account password</p>
                  </div>
                  <Button onClick={openPasswordModal} variant="outline">
                    Change Password
                  </Button>
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

      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Lock className="w-5 h-5" />
                Change Password
              </h2>
              <button onClick={closePasswordModal} className="text-gray-400 hover:text-gray-600 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-6">
              {passwordStep === "current" && (
                <div className="space-y-4">
                  <p className="text-sm text-gray-600">Enter your current password to continue.</p>
                  <div className="space-y-2">
                    <Label htmlFor="current-password">Current Password</Label>
                    <div className="relative">
                      <Input
                        id="current-password"
                        type={showCurrentPassword ? "text" : "password"}
                        value={currentPassword}
                        onChange={(e) => { setCurrentPassword(e.target.value); setPasswordError(""); }}
                        placeholder="Enter current password"
                        onKeyDown={(e) => e.key === "Enter" && handleValidateCurrentPassword()}
                      />
                      <button
                        type="button"
                        onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  {passwordError && <p className="text-sm text-red-600">{passwordError}</p>}
                  <Button onClick={handleValidateCurrentPassword} disabled={passwordLoading} className="w-full">
                    {passwordLoading ? "Verifying..." : "Continue"}
                  </Button>
                </div>
              )}

              {passwordStep === "new" && (
                <div className="space-y-4">
                  <p className="text-sm text-gray-600">Enter your new password.</p>
                  <div className="space-y-2">
                    <Label htmlFor="new-password">New Password</Label>
                    <div className="relative">
                      <Input
                        id="new-password"
                        type={showNewPassword ? "text" : "password"}
                        value={newPassword}
                        onChange={(e) => { setNewPassword(e.target.value); setPasswordError(""); }}
                        placeholder="Enter new password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPassword(!showNewPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirm-password">Confirm New Password</Label>
                    <div className="relative">
                      <Input
                        id="confirm-password"
                        type={showConfirmPassword ? "text" : "password"}
                        value={confirmPassword}
                        onChange={(e) => { setConfirmPassword(e.target.value); setPasswordError(""); }}
                        placeholder="Re-enter new password"
                        onKeyDown={(e) => e.key === "Enter" && handleChangePassword()}
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  {passwordError && <p className="text-sm text-red-600">{passwordError}</p>}
                  <Button onClick={handleChangePassword} disabled={passwordLoading} className="w-full">
                    {passwordLoading ? "Changing Password..." : "Change Password"}
                  </Button>
                </div>
              )}

              {passwordStep === "success" && (
                <div className="text-center space-y-4 py-4">
                  <CheckCircle className="w-16 h-16 text-green-500 mx-auto" />
                  <h3 className="text-lg font-semibold text-gray-900">Password Changed!</h3>
                  <p className="text-sm text-gray-600">Your password has been successfully updated.</p>
                  <Button onClick={closePasswordModal} className="w-full">
                    Done
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
