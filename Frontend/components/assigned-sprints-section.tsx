"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { fetchWithAuth } from "@/lib/fetch-with-auth";
import { LayoutGrid, List, ChevronDown, Search } from "lucide-react";
import { callGemini } from "@/lib/gemini-helper";

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL;

interface Sprint {
  id: string;
  title: string;
  moduleName?: string;
  dueDate?: string;
  dueDateExpired?: boolean;
  isDueDateLocked: boolean;
  status: "Not Started" | "In Progress" | "Completed" | "Not Assigned";
  completionPercentage: number;
  completedModules: number;
  totalModules: number;
  hasBaseline: boolean;
  baselineCompleted: boolean;
  baselineScore?: number | null;
  baselineMaxScore?: number | null;
  learningPlanId?: string;
  certificateEarned?: boolean;
}

interface AssignedSprintsSectionProps {
  assignedModules: any[];
  moduleProgress: any[];
  plans: any[];
  userId: string;
  companyId: string;
  isLocked: boolean;
  onGenerateCertificate: (sprintId: string) => void;
}

export function AssignedSprintsSection({
  assignedModules,
  moduleProgress,
  plans,
  userId,
  companyId,
  isLocked,
  onGenerateCertificate,
}: AssignedSprintsSectionProps) {
  const [viewType, setViewType] = useState<"grid" | "table">("grid");
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAllModules, setShowAllModules] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"title" | "due_date" | "progress">("title");
  const router = useRouter();

  useEffect(() => {
    if (assignedModules.length > 0) {
      enrichSprintsData();
    } else {
      setLoading(false);
    }
  }, [assignedModules, moduleProgress]);

  const enrichSprintsData = async () => {
    const isDateInPast = (dateString?: string) => {
      if (!dateString) return false;
      const parsed = new Date(dateString);
      if (Number.isNaN(parsed.getTime())) return false;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const target = new Date(parsed);
      target.setHours(0, 0, 0, 0);
      return target < today;
    };

    try {
      // const headers = {
      //   "X-User-ID": userId,
      //   "X-Company-ID": companyId,
      // };

      // // Fetch learning plans to get due dates
      // const plansRes = await fetchWithAuth(
      //   `${API_BASE}/api/learning-plans/?user_id=${userId}`,
      //   { headers }
      // );
      // const plans = plansRes.ok ? await plansRes.json() : { plans: [] };
      const plansResponse = {plans: plans || []}
      const plansByModuleId: Record<string, any> = {};
      plansResponse.plans?.forEach((plan: any) => {
        plansByModuleId[plan.module_id] = plan;
      });

      // Enrich modules with learning plan data and calculate status
      const enrichedSprints: Sprint[] = await Promise.all(
        assignedModules.map(async (module) => {
          const plan = plansByModuleId[module.id];
          const dueDate = plan?.due_date;
          const dueDateExpired = isDateInPast(dueDate);

          const totalModules = module.modules.length;

          const completedProcessedModuleIds = new Set(
            moduleProgress
              .filter((entry) => Boolean(entry?.completed_at))
              .map((entry) => String(entry?.processed_module_id || "").trim())
              .filter(Boolean),
          );

          const completedModules = module.modules.filter((assignedModule: any) =>
            completedProcessedModuleIds.has(String(assignedModule.id)),
          ).length;

          // Determine status from assigned modules versus completed modules.
          let status: Sprint["status"] = "Not Started";
          if (completedModules === 0) {
            status = "Not Started";
          } else if (totalModules > 0 && completedModules === totalModules) {
            status = "Completed";
          } else {
            status = "In Progress";
          }

          // Calculate completion percentage
          const completionPercentage =
            totalModules > 0
              ? Math.round((completedModules / totalModules) * 100)
              : 0;

          // console.log(`Module: ${module.title}, Quizzes Attempted: ${quizzesAttempted}, Total Quizzes: ${totalQuizzes}, Status: ${status}, Completion: ${completionPercentage}%`);
          const isDueDateLocked = dueDateExpired && status !== "Completed";

          return {
            id: module.id,
            title: module.title,
            moduleName: module.moduleName,
            dueDate,
            dueDateExpired,
            isDueDateLocked,
            status,
            completionPercentage,
            completedModules,
            totalModules,
            hasBaseline: module.hasBaseline,
            baselineCompleted: Boolean(module.baselineCompleted),
            baselineScore: module.baselineScore ?? null,
            baselineMaxScore: module.baselineMaxScore ?? null,
            learningPlanId: plan?.learning_plan_id,
            certificateEarned: module.certificateEarned,
          };
        })
      );
      // console.log("Enriched sprints data:", enrichedSprints);
      setSprints(enrichedSprints);
    } catch (error) {
      console.error("Error enriching sprints data:", error);
      // Fallback: create sprints with basic data
      const basicSprints: Sprint[] = assignedModules.map((module) => ({
        id: module.id,
        title: module.title,
        moduleName: module.moduleName,
        dueDate: undefined,
        dueDateExpired: false,
        isDueDateLocked: false,
        status: "Not Assigned",
        completionPercentage: 0,
        completedModules: 0,
        totalModules: module.modules.length,
        hasBaseline: module.hasBaseline,
        baselineCompleted: Boolean(module.baselineCompleted),
        baselineScore: module.baselineScore ?? null,
        baselineMaxScore: module.baselineMaxScore ?? null,
        learningPlanId: undefined,
        certificateEarned: module.certificateEarned,
      }));
      // console.log("Basic sprints data:", basicSprints);
      setSprints(basicSprints);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: Sprint["status"]) => {
    switch (status) {
      case "Not Started":
        return "bg-slate-100 text-slate-700";
      case "In Progress":
        return "bg-blue-100 text-blue-700";
      case "Completed":
        return "bg-green-100 text-green-700";
      case "Not Assigned":
        return "bg-gray-100 text-gray-700";
      default:
        return "bg-slate-100 text-slate-700";
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return "N/A";
    try {
      return new Date(dateString).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return "N/A";
    }
  };

  const getFilteredAndSortedSprints = () => {
    let filtered = sprints.filter(
      (sprint) =>
        sprint.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        sprint.moduleName?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    let sorted = [...filtered];
    if (sortBy === "title") {
      sorted.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortBy === "due_date") {
      sorted.sort((a, b) => {
        if (!a.dueDate && !b.dueDate) return 0;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      });
    } else if (sortBy === "progress") {
      sorted.sort((a, b) => b.completionPercentage - a.completionPercentage);
    }

    return showAllModules ? sorted : sorted.slice(0, 3);
  };

  const filteredSprints = getFilteredAndSortedSprints();

  if (loading) {
    return (
      <Card className="rounded-2xl border-none shadow-sm bg-white overflow-hidden">
        <CardHeader className="bg-slate-50/50 border-b border-slate-50 px-4 md:px-6 py-3 md:py-4">
          <CardTitle className="text-sm md:text-base font-black text-slate-900">
            Assigned Sprints
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 md:p-6">
          <div className="flex items-center justify-center py-8">
            <div className="text-slate-500 text-sm">Loading...</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isLocked) {
    return (
      <Card className="rounded-2xl border-none shadow-sm bg-white overflow-hidden">
        <CardHeader className="bg-slate-50/50 border-b border-slate-50 px-4 md:px-6 py-3 md:py-4">
          <CardTitle className="text-sm md:text-base font-black text-slate-900">
            Assigned Sprints
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 md:p-6">
          <div className="py-8 sm:py-12 flex flex-col items-center text-center px-4">
            <div className="w-12 h-12 sm:w-14 sm:h-14 bg-slate-100 rounded-2xl flex items-center justify-center text-slate-400 mb-3">
              <List size={24} className="sm:w-7 sm:h-7" />
            </div>
            <h5 className="text-sm sm:text-base font-bold text-slate-900">
              Modules are currently locked
            </h5>
            <p className="text-xs sm:text-sm text-slate-500 max-w-xs mt-1 font-medium">
              Complete your learning preference survey to access your baseline and training plan.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (sprints.length === 0) {
    return (
      <Card className="rounded-2xl border-none shadow-sm bg-white overflow-hidden">
        <CardHeader className="bg-slate-50/50 border-b border-slate-50 px-4 md:px-6 py-3 md:py-4">
          <CardTitle className="text-sm md:text-base font-black text-slate-900">
            Assigned Sprints
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 md:p-6">
          <div className="py-8 sm:py-12 flex flex-col items-center text-center px-4">
            <p className="text-slate-500 text-xs sm:text-sm font-medium">
              No Sprints Assigned
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-2xl border-none shadow-sm bg-white overflow-hidden">
      <CardHeader className="bg-slate-50/50 border-b border-slate-50 px-4 md:px-6 py-3 md:py-4 flex flex-col gap-4">
        <div className="flex flex-row items-center justify-between">
          <CardTitle className="text-sm md:text-base font-black text-slate-900">
            Assigned Sprints
          </CardTitle>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewType("grid")}
              className={`p-2 rounded-lg transition-colors ${
                viewType === "grid"
                  ? "bg-blue-100 text-blue-600"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
              title="Grid view"
            >
              <LayoutGrid size={18} />
            </button>
            <button
              onClick={() => setViewType("table")}
              className={`p-2 rounded-lg transition-colors ${
                viewType === "table"
                  ? "bg-blue-100 text-blue-600"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
              title="Table view"
            >
              <List size={18} />
            </button>
          </div>
        </div>

        {/* Search Bar and Sort Controls */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" size={18} />
            <input
              type="text"
              placeholder="Search Sprints..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-200 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as "title" | "due_date" | "progress")}
            className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="title">Sort by Title</option>
            <option value="due_date">Sort by Due Date</option>
            <option value="progress">Sort by Progress</option>
          </select>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {viewType === "grid" ? (
          // Grid View
          <div className="p-4 md:p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredSprints.map((sprint) => (
                <div
                  key={sprint.id}
                  className="border border-slate-200 rounded-xl p-4 hover:shadow-md transition-shadow"
                >
                  {/* Header with status */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <h4 className="text-sm font-bold text-slate-900 line-clamp-2">
                        {sprint.title}
                      </h4>

                      {sprint.moduleName && (
                        <p className="text-xs text-slate-500 mt-1">
                          {sprint.moduleName}
                        </p>
                      )}

                    </div>
                    <Badge className={`ml-2 shrink-0 text-xs font-semibold ${getStatusColor(sprint.status)}`}>
                      {sprint.status}
                    </Badge>
                  </div>

                  {/* Due date */}
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="text-xs">
                      <span className="text-slate-500">Due: </span>
                      <span
                        className={
                          sprint.dueDateExpired
                            ? "text-red-600 font-semibold"
                            : sprint.dueDate
                            ? "text-slate-700 font-medium"
                            : "text-slate-400"
                        }
                      >
                        {formatDate(sprint.dueDate)}
                      </span>
                    </div>

{sprint.isDueDateLocked && (
                      <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px]">
                        Locked
                      </Badge>
                    )}

                    {sprint.hasBaseline && (
                      <Badge
                        className={
                          sprint.baselineCompleted
                            ? "bg-green-100 text-green-700 border-green-200"
                            : "bg-amber-100 text-amber-700 border-amber-200"
                        }
                      >
                        {sprint.baselineCompleted
                          ? "Baseline Completed"
                          : "Baseline Required"}
                      </Badge>
                    )}
                  </div>

                  {/* Completion info */}
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-slate-600 font-medium">Completion</span>
                      <span className="text-xs font-bold text-blue-600">
                        {sprint.completionPercentage}%
                      </span>
                    </div>
                    <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-600 transition-all"
                        style={{ width: `${sprint.completionPercentage}%` }}
                      />
                    </div>
                    <p className="text-xs text-slate-500 mt-2">
                      {sprint.completedModules} / {sprint.totalModules} modules
                    </p>
                  </div>

                                    {/* Action buttons */}
                  <div className="flex gap-2 w-full">
                    {sprint.hasBaseline && (
                      <button
                        onClick={() => {
                          if (sprint.baselineCompleted) return;
                          if (sprint.isDueDateLocked) return;
                          router.push(`/employee/assessment?moduleId=${sprint.id}`);
                        }}
                        disabled={
                          sprint.baselineCompleted || sprint.isDueDateLocked
                        }
                        className={[
                          "flex-1 px-3 py-2 rounded-lg text-xs border font-bold transition-colors",
                          sprint.baselineCompleted || sprint.isDueDateLocked
                            ? "border-slate-200 text-slate-400 bg-slate-50 cursor-not-allowed"
                            : "border-slate-200 text-slate-700 bg-white hover:bg-slate-50",
                        ].join(" ")}
                      >
                        Baseline
                      </button>
                    )}

                    <button
                      onClick={() => {
                        if (sprint.hasBaseline && !sprint.baselineCompleted) return;
                        if (sprint.isDueDateLocked) return;
                        router.push(
                          `/employee/training-plan?module_id=${sprint.id}`
                        );
                      }}
                      disabled={
                        (sprint.hasBaseline && !sprint.baselineCompleted) ||
                        sprint.isDueDateLocked
                      }
                      className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold text-white transition-colors ${
                        sprint.status === "Completed"
                          ? "bg-slate-400 hover:bg-slate-500"
                          : sprint.isDueDateLocked
                          ? "bg-blue-200 text-blue-600 cursor-not-allowed"
                          : sprint.hasBaseline && !sprint.baselineCompleted
                          ? "bg-blue-300 cursor-not-allowed"
                          : "bg-blue-600 hover:bg-blue-700"
                      }`}
                    >
                      {sprint.status === "Completed"
                        ? "Review"
                        : sprint.status === "In Progress"
                        ? "Resume"
                        : "Start"}
                    </button>

                    <button
                      onClick={() => onGenerateCertificate(sprint.id)}
                      disabled={!sprint.certificateEarned}
                      className="flex-1 px-3 py-2 rounded-lg text-xs font-bold transition-colors border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                    >
                      Certificate
                    </button>
                  </div>
                  </div>

                
              ))}
            </div>

            {/* Show More / Show Less button */}
            {sprints.length > 3 && (
              <div className="flex justify-center mt-6">
                <button
                  onClick={() => setShowAllModules(!showAllModules)}
                  className="px-6 py-2 rounded-lg bg-blue-500 text-white text-xs sm:text-sm font-semibold hover:bg-blue-600 transition-all flex items-center gap-1.5"
                >
                  {showAllModules ? (
                    <>
                      Show Less
                      <ChevronDown size={14} className="rotate-180" />
                    </>
                  ) : (
                    <>
                      Show More
                      <ChevronDown size={14} />
                    </>
                  )}
                </button>
              </div>
            )}

            {/* No results message */}
            {filteredSprints.length === 0 && searchQuery && (
              <div className="flex justify-center py-8">
                <p className="text-slate-500 text-sm font-medium">No sprints match your search.</p>
              </div>
            )}
          </div>
        ) : (
          // Table View
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/50">
                  <th className="px-4 md:px-6 py-3 text-left text-xs font-bold text-slate-700">
                    SPRINT NAME
                  </th>
                  <th className="px-4 md:px-6 py-3 text-left text-xs font-bold text-slate-700">
                    DUE DATE
                  </th>
                  <th className="px-4 md:px-6 py-3 text-left text-xs font-bold text-slate-700">
                    STATUS
                  </th>
                  <th className="px-4 md:px-6 py-3 text-left text-xs font-bold text-slate-700">
                    COMPLETION
                  </th>
                  <th className="px-4 md:px-6 py-3 text-center text-xs font-bold text-slate-700">
                    ACTIONS
                  </th>
                  <th className="px-4 md:px-6 py-3 text-center text-xs font-bold text-slate-700">
                    CERTIFICATE
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredSprints.map((sprint) => (
                  <tr key={sprint.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    <td className="px-4 md:px-6 py-4">
                      <div className="flex flex-col gap-0.5">
                        <p className="text-sm font-bold text-slate-900 line-clamp-1">
                          {sprint.title}
                        </p>
                        {sprint.moduleName && (
                          <p className="text-xs text-slate-500 line-clamp-1">
                            {sprint.moduleName}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 md:px-6 py-4">
                      <p className={`text-sm ${sprint.dueDate ? "text-slate-700 font-medium" : "text-slate-400"}`}>
                        {formatDate(sprint.dueDate)}
                      </p>
                    </td>
                    <td className="px-4 md:px-6 py-4">
                      <Badge
                        className={`text-xs font-semibold ${
                          sprint.isDueDateLocked
                            ? "bg-red-100 text-red-700"
                            : getStatusColor(sprint.status)
                        }`}
                      >
                        {sprint.isDueDateLocked
                          ? "Locked"
                          : sprint.status}
                      </Badge>
                    </td>
                    <td className="px-4 md:px-6 py-4">
                      <div className="flex flex-col gap-1.5">
                        <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-600 transition-all"
                            style={{ width: `${sprint.completionPercentage}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs text-slate-600">
                            {sprint.completedModules} / {sprint.totalModules}
                          </span>
                          <span className="text-xs font-bold text-blue-600">
                            {sprint.completionPercentage}%
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 md:px-6 py-4">
                      <div className="flex gap-2 justify-center flex-wrap">
                        
                        <button
                          onClick={() => {
                            if (sprint.hasBaseline && !sprint.baselineCompleted) return;
                            if (sprint.isDueDateLocked) return;
                            router.push(`/employee/training-plan?module_id=${sprint.id}`);
                          }}
                          disabled={
                            (sprint.hasBaseline && !sprint.baselineCompleted) ||
                            sprint.isDueDateLocked
                          }
                          className={`px-4 py-1.5 rounded text-xs font-semibold text-white transition-colors whitespace-nowrap ${
                            sprint.status === "Completed"
                              ? "bg-slate-400 hover:bg-slate-500"
                              : sprint.isDueDateLocked
                              ? "bg-blue-200 text-blue-600 cursor-not-allowed"
                              : sprint.hasBaseline && !sprint.baselineCompleted
                              ? "bg-blue-300 cursor-not-allowed"
                              : "bg-blue-600 hover:bg-blue-700"
                          }`}
                        >
                          {sprint.status === "Completed"
                            ? "Review"
                            : sprint.status === "In Progress"
                            ? "Resume"
                            : "Start"}
                        </button>
                      </div>
                    </td>
                    <td className="px-4 md:px-6 py-4 text-center">
                      <button
                        onClick={() => onGenerateCertificate(sprint.id)}
                        disabled={!sprint.certificateEarned}
                        className="px-3 py-1.5 rounded text-xs font-semibold transition-colors border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed whitespace-nowrap"
                      >
                        Certificate
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Show More / Show Less button for table */}
            {sprints.length > 3 && (
              <div className="p-4 bg-slate-50/50 flex justify-center sm:justify-end border-t border-slate-200">
                <button
                  onClick={() => setShowAllModules(!showAllModules)}
                  className="px-4 py-2 rounded-lg bg-blue-500 text-white text-xs sm:text-sm font-semibold hover:bg-blue-600 transition-all flex items-center gap-1.5 h-9"
                >
                  {showAllModules ? (
                    <>
                      Show Less
                      <ChevronDown size={14} className="rotate-180" />
                    </>
                  ) : (
                    <>
                      Show More
                      <ChevronDown size={14} />
                    </>
                  )}
                </button>
              </div>
            )}

            {/* No results message for table */}
            {filteredSprints.length === 0 && searchQuery && (
              <div className="p-8 text-center border-t border-slate-200">
                <p className="text-slate-500 text-sm font-medium">No sprints match your search.</p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
