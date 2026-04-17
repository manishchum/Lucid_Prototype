"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { useAuth } from "@/contexts/auth-context";
import { useTenant } from "@/contexts/tenant-context";
import CompanySelector from "@/components/company-selector";
import { createCacheKey, sharedDataClient } from "@/lib/data-client";
import { fetchWithAuth } from "@/lib/fetch-with-auth";
import {
  Users, BookOpen, Clock, User, ChevronDown,
  Trophy, Target, TrendingUp, Zap, LayoutGrid,
  ShieldCheck, ArrowRight, CheckCircle2, LogOut, Award,
  Download, Linkedin, X
} from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL;
const DEFAULT_QUIZ_THRESHOLD = 80;

type SprintStatus = "not_started" | "in_progress" | "completed";

// --- Types ---
interface Employee {
  user_id: string
  email: string
  name: string | null
  joined_at: string
  company_id?: string
}

interface ModuleAssessmentStatus {
  moduleId: string
  hasBaseline: boolean
  baselineCompleted: boolean
  baselineScore?: number
  baselineMaxScore?: number
}

interface SprintModule {
  id: string;
  name: string;
  completed: boolean;
  quizScore: number | null;
  passStatus?: boolean;
  completedAt: string | null;
}

interface SprintItem {
  id: string;
  title: string;
  moduleName: string | null;
  hasBaseline: boolean;
  status: SprintStatus;
  certificateEarned: boolean;
  completedDate: string | null;
  modules: SprintModule[];
  quizThreshold: number;
  sprintTopic: string;
}

interface AssessmentEvidence {
  scorePercent: number | null;
  completedAt: string | null;
}

export default function EmployeeWelcome() {
  const { user, loading: authLoading, logout } = useAuth();
  const { activeCompanyId, isDeveloperMode } = useTenant();
  const router = useRouter();

  // --- Logic State (Preserved from your code) ---
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [scoreHistory, setScoreHistory] = useState<any[]>([]);
  const [moduleProgress, setModuleProgress] = useState<any[]>([]);
  const [assignedModules, setAssignedModules] = useState<SprintItem[]>([]);
  const [learningStyle, setLearningStyle] = useState<string | null>(null);
  const [baselineScore, setBaselineScore] = useState<number | null>(null);
  const [baselineMaxScore, setBaselineMaxScore] = useState<number | null>(null);
  const [allAssignedCompleted, setAllAssignedCompleted] = useState<boolean>(false);
  const [baselineRequired, setBaselineRequired] = useState<boolean>(true);
  const [companyStats, setCompanyStats] = useState({
    totalEmployees: 0,
    completedEmployees: 0,
    userRank: null as number | null,
    topPercentile: null as number | null,
  });
  const [nudgeMessage, setNudgeMessage] = useState<string>("");
  const [progressPercentage, setProgressPercentage] = useState<number>(0);
  const [showLoginToast, setShowLoginToast] = useState<boolean>(false);
  const [isNavOverlay, setIsNavOverlay] = useState<boolean>(false);
  const [showAllModules, setShowAllModules] = useState<boolean>(false);
  const [companyLearningStyleEnabled, setCompanyLearningStyleEnabled] = useState<boolean>(false);
  const [selectedCertificateSprint, setSelectedCertificateSprint] = useState<SprintItem | null>(null);
  const [linkedinExpanded, setLinkedinExpanded] = useState<boolean>(false);
  const [linkedinProfileUrl, setLinkedinProfileUrl] = useState<string>("");
  const [linkedinError, setLinkedinError] = useState<string>("");
  const [isExportingCertificate, setIsExportingCertificate] = useState<boolean>(false);
  const { progress: loadingProgress, show: showLoadingProgress } = useIllusionProgress(authLoading || loading);
 
  const toastShownRef = useRef(false);
  const prevUserRef = useRef<any>(null);
  const certificateRef = useRef<HTMLDivElement | null>(null);

  const sanitizeFileNameChunk = (value: string) =>
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 60) || "certificate";

  const toIso = (value: unknown) => {
    if (!value || typeof value !== "string") return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  };

  const toNumberOrNull = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };

  const normalizeStatus = (value: unknown) => String(value || "").trim().toUpperCase();

  const normalizeProcessedModuleIds = (value: unknown): string[] => {
    if (Array.isArray(value)) {
      return value.map((id) => String(id)).filter(Boolean);
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return [];

      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map((id) => String(id)).filter(Boolean);
        }
      } catch {
        return [trimmed];
      }
    }

    return [];
  };

  const computePercentScore = (entry: any): number | null => {
    const score = toNumberOrNull(entry?.quiz_score ?? entry?.quizScore ?? entry?.score);
    if (score === null) return null;

    const maxScore = toNumberOrNull(entry?.max_score ?? entry?.maxScore);
    if (maxScore && maxScore > 0) {
      return Number(((score / maxScore) * 100).toFixed(2));
    }

    if (score > 0 && score <= 1) {
      return Number((score * 100).toFixed(2));
    }

    return score;
  };

  const formatCertificateDate = (isoDate: string | null) => {
    if (!isoDate) return "--";
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) return "--";
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const buildSprintsFromPlans = (
    plans: any[],
    modules: any[],
    progress: any[],
    assessmentEvidenceByModuleId?: Record<string, AssessmentEvidence[]>,
  ): SprintItem[] => {
    const assignedPlans = plans.filter((p: any) => {
      const status = normalizeStatus(p?.status);
      return status === "ASSIGNED" || status === "IN_PROGRESS" || status === "COMPLETED";
    });
    const moduleTitleById: Record<string, string> = {};
    for (const m of modules) {
      if (m?.module_id) {
        moduleTitleById[String(m.module_id)] = m.title || `Module ${m.module_id}`;
      }
    }

    const moduleProgressByModuleId = new Map<string, any[]>();
    for (const progressEntry of progress) {
      const processedModules = Array.isArray(progressEntry?.processed_modules)
        ? progressEntry.processed_modules
        : progressEntry?.processed_modules
          ? [progressEntry.processed_modules]
          : [];

      const nestedOriginalIds = processedModules
        .map((pm: any) => pm?.original_module_id)
        .filter(Boolean);

      const possibleKeys = [
        progressEntry?.module_id,
        progressEntry?.original_module_id,
        progressEntry?.processed_module_id,
        progressEntry?.processed_modules?.original_module_id,
        ...nestedOriginalIds,
      ]
        .filter(Boolean)
        .map((key) => String(key));

      if (possibleKeys.length === 0) continue;

      for (const key of possibleKeys) {
        const existing = moduleProgressByModuleId.get(key) || [];
        existing.push(progressEntry);
        moduleProgressByModuleId.set(key, existing);
      }
    }

    return assignedPlans.map((p: any) => {
      const sprintId = String(p.module_id ?? p.id ?? "");
  const threshold = toNumberOrNull(p.quiz_threshold ?? p.quizThreshold) ?? DEFAULT_QUIZ_THRESHOLD;
      const processedModuleIds = normalizeProcessedModuleIds(p?.processed_module_ids);

      const relatedProgressFromSprintId = moduleProgressByModuleId.get(sprintId) || [];
  const relatedProgressFromProcessedIds = processedModuleIds.flatMap((pmId: string) => moduleProgressByModuleId.get(pmId) || []);
      const relatedProgress = Array.from(new Map(
        [...relatedProgressFromSprintId, ...relatedProgressFromProcessedIds].map((entry: any) => {
          const key = String(entry?.module_progress_id ?? `${entry?.processed_module_id || ""}-${entry?.user_id || ""}-${entry?.started_at || ""}`);
          return [key, entry];
        })
      ).values());
      const modulesInPlan = Array.isArray(p.modules) ? p.modules : [];

      let sprintModules: SprintModule[] = [];

      if (modulesInPlan.length > 0) {
        sprintModules = modulesInPlan.map((mod: any, index: number) => {
          const modProgress = relatedProgress.find(
            (pr) => String(pr?.module_id ?? pr?.processed_module_id ?? "") === String(mod?.id ?? mod?.module_id ?? index),
          );
          const modProgressStatus = normalizeStatus(modProgress?.status);
          const completed = Boolean(
            mod?.completed ||
            modProgress?.completed_at ||
            modProgressStatus === "COMPLETED" ||
            modProgress?.pass_status,
          );
          const quizScore = toNumberOrNull(mod?.quizScore) ?? computePercentScore(modProgress);
          return {
            id: String(mod?.id ?? mod?.module_id ?? `${sprintId}-${index + 1}`),
            name: String(mod?.name ?? mod?.title ?? `Module ${index + 1}`),
            completed,
            quizScore,
            passStatus: Boolean(modProgress?.pass_status),
            completedAt: toIso(mod?.completedAt ?? modProgress?.completed_at),
          };
        });
      } else if (processedModuleIds.length > 0) {
        sprintModules = processedModuleIds.map((pmId: string, index: number) => {
          const pr = relatedProgress.find(
            (p_entry) => String(p_entry?.processed_module_id ?? p_entry?.module_id ?? "") === pmId
          );
          const completed = Boolean(pr?.completed_at || normalizeStatus(pr?.status) === "COMPLETED" || pr?.pass_status);
          return {
            id: pmId,
            name: String(pr?.processed_modules?.title ?? pr?.module_title ?? `Module ${index + 1}`),
            completed,
            quizScore: computePercentScore(pr),
            passStatus: Boolean(pr?.pass_status),
            completedAt: toIso(pr?.completed_at),
          };
        });
      } else if (relatedProgress.length > 0) {
        sprintModules = relatedProgress.map((pr: any, index: number) => ({
          id: String(pr?.module_id ?? pr?.processed_module_id ?? `${sprintId}-${index + 1}`),
          name: String(pr?.processed_modules?.title ?? pr?.module_title ?? `Module ${index + 1}`),
          completed: Boolean(pr?.completed_at || normalizeStatus(pr?.status) === "COMPLETED" || pr?.pass_status),
          quizScore: computePercentScore(pr),
          passStatus: Boolean(pr?.pass_status),
          completedAt: toIso(pr?.completed_at),
        }));
      } else {
        const fallbackAssessments = assessmentEvidenceByModuleId?.[sprintId] || [];

        sprintModules = [{
          id: sprintId || "unknown",
          name: moduleTitleById[sprintId] || p.module_name || p.module_title || p.title || `Module ${sprintId || ""}`,
          completed:
            normalizeStatus(p?.status) === "COMPLETED" ||
            Boolean(p?.completed_at) ||
            fallbackAssessments.some((ev) => ev.scorePercent !== null),
          quizScore:
            fallbackAssessments.length > 0
              ? Math.max(...fallbackAssessments.map((ev) => ev.scorePercent ?? -1))
              : computePercentScore(p),
          passStatus: Boolean(p?.pass_status),
          completedAt:
            fallbackAssessments
              .map((ev) => ev.completedAt)
              .filter((value): value is string => Boolean(value))
              .sort()
              .at(-1) || toIso(p.completed_at),
        }];
      }

      const expectedModuleCount = modulesInPlan.length > 0
        ? modulesInPlan.length
        : processedModuleIds.length;

      const allModulesCompleted =
        sprintModules.length > 0 &&
        (expectedModuleCount === 0 || sprintModules.length >= expectedModuleCount) &&
        sprintModules.every((mod) => mod.completed);

      const allQuizScoresEligible =
        sprintModules.length > 0 &&
        (expectedModuleCount === 0 || sprintModules.length >= expectedModuleCount) &&
        sprintModules.every(
        (mod) => mod.passStatus || (mod.quizScore !== null && mod.quizScore >= threshold)
      );

      const isOverallStatusTrue = Boolean(p.overall_status === true || p.overall_status === 1 || p.overall_status === "true");

      // Strict rule: certificate only when every sprint module is completed and passed.
      const certificateEarned = expectedModuleCount > 0
        ? (allModulesCompleted && allQuizScoresEligible)
        : isOverallStatusTrue;

      const completedDate = certificateEarned
        ? [...sprintModules]
            .map((mod) => mod.completedAt)
            .filter((value): value is string => Boolean(value))
            .sort()
            .at(-1) || toIso(p.completed_at) || new Date().toISOString()
        : null;

      const hasAnyProgress = sprintModules.some((mod) => mod.completed || mod.quizScore !== null);
      const planStatus = normalizeStatus(p?.status);
      const status: SprintStatus = allModulesCompleted
        ? "completed"
        : (hasAnyProgress || planStatus === "IN_PROGRESS")
          ? "in_progress"
          : "not_started";

      return {
        id: sprintId,
        title: moduleTitleById[sprintId] || p.module_name || p.module_title || p.title || `Module ${sprintId}`,
        moduleName: p.module_name || p.module_title || p.title || null,
        hasBaseline: p.baseline_assessment === 1 || p.baseline_assessment === true,
        status,
        certificateEarned,
        completedDate,
        modules: sprintModules,
        quizThreshold: threshold,
        sprintTopic: p.topic || p.module_topic || p.module_name || p.title || "professional development",
      };
    });
  };

  const openCertificateModal = (sprint: SprintItem) => {
    setSelectedCertificateSprint(sprint);
    setLinkedinExpanded(false);
    setLinkedinProfileUrl("");
    setLinkedinError("");
  };

  const closeCertificateModal = () => {
    setSelectedCertificateSprint(null);
    setLinkedinExpanded(false);
    setLinkedinProfileUrl("");
    setLinkedinError("");
  };

  const downloadCertificatePdf = async () => {
    if (!selectedCertificateSprint || !certificateRef.current || isExportingCertificate) return;

    try {
      setIsExportingCertificate(true);
      const canvas = await html2canvas(certificateRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
      });

      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("landscape", "pt", "a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      const imgWidth = canvas.width;
      const imgHeight = canvas.height;
      const ratio = Math.min((pageWidth - 40) / imgWidth, (pageHeight - 40) / imgHeight);
      const renderWidth = imgWidth * ratio;
      const renderHeight = imgHeight * ratio;
      const x = (pageWidth - renderWidth) / 2;
      const y = (pageHeight - renderHeight) / 2;

      pdf.addImage(imgData, "PNG", x, y, renderWidth, renderHeight);

      const sprintSlug = sanitizeFileNameChunk(selectedCertificateSprint.title || "sprint");
      const userSlug = sanitizeFileNameChunk(employee?.name || employee?.email || user?.email || "user");
      pdf.save(`lucid-certificate-${sprintSlug}-${userSlug}.pdf`);
    } catch (error) {
      console.error("[Certificate] Failed to download PDF:", error);
    } finally {
      setIsExportingCertificate(false);
    }
  };

  const shareOnLinkedIn = () => {
    if (!selectedCertificateSprint) return;
    setLinkedinError("");

    const profileUrl = linkedinProfileUrl.trim();
    if (!profileUrl) {
      setLinkedinError("Please paste your LinkedIn profile URL.");
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(profileUrl);
    } catch {
      setLinkedinError("Please enter a valid URL (including https://).");
      return;
    }

    if (!parsed.hostname.toLowerCase().includes("linkedin.com")) {
      setLinkedinError("Please provide a valid LinkedIn profile URL.");
      return;
    }

    const message = `🎉 Excited to share that I've successfully completed the '${selectedCertificateSprint.title}' sprint on Lucid!\n\nThis sprint deepened my understanding of ${selectedCertificateSprint.sprintTopic} and helped me grow professionally through hands-on learning and collaboration.\n\nA huge thank you to the entire team and the Lucid platform for making this learning journey possible. Looking forward to the next sprint! 🚀\n\n#Lucid #LearningAndDevelopment #SprintComplete #ProfessionalGrowth`;

    const shareUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(profileUrl)}&summary=${encodeURIComponent(message)}`;
    window.open(shareUrl, "_blank", "noopener,noreferrer");
  };

  const fetchUserByEmail = async (email: string) => {
    try {
      const res = await fetchWithAuth(
        `${API_BASE}/api/users/by-email/${encodeURIComponent(email)}`,
      );
      if (!res.ok) return null;
      const payload = await res.json();
      let u = payload?.user ?? payload;
      if (Array.isArray(u)) u = u[0];
      return u || null;
    } catch {
      return null;
    }
  };

  // --- Login Toast System (only show when a login/signup flow sets a flag) ---
  // Behavior: login/signup pages should set sessionStorage.setItem('show_login_toast_next', '1')
  // right before redirecting to the home/welcome page. This component will read that flag,
  // show the toast once, then remove the flag so subsequent navigations won't re-show it.
  const fetchDashboardData = async (employeeData: any, effectiveCompanyId: string) => {
    const result = await sharedDataClient.query(
      createCacheKey({
        namespace: "dashboard",
        tenantId: effectiveCompanyId,
        userId: employeeData.user_id,
        path: "/employee/dashboard"
      }),
      async () => {
        const headers = {
          'X-User-ID': employeeData.user_id,
          'X-Company-ID': effectiveCompanyId,
        };

        const [plansRes, modulesRes, progressRes, usersRes, companyRes, learningStyleRes, employeeAssessmentsRes] = await Promise.all([
          fetchWithAuth(`${API_BASE}/api/learning-plans/?user_id=${employeeData.user_id}`, { headers }).then((r) => r.ok ? r.json() : ({} as any)),
          fetchWithAuth(`${API_BASE}/api/training-modules/company/${employeeData.company_id}`, { headers }).then((r) => r.ok ? r.json() : ({} as any)),
          fetchWithAuth(`${API_BASE}/api/module-progress/user/${employeeData.user_id}`, { headers }).then((r) => r.ok ? r.json() : ({} as any)),
          fetchWithAuth(`${API_BASE}/api/users/company/${employeeData.company_id}`, { headers }).then((r) => r.ok ? r.json() : ({} as any)),
          fetchWithAuth(`${API_BASE}/api/companies/${encodeURIComponent(employeeData.company_id)}`, { headers }).then((r) => r.ok ? r.json() : ({} as any)),
          fetchWithAuth(`${API_BASE}/api/learning-style?user_id=${encodeURIComponent(employeeData.user_id)}`, { headers }).then((r) => r.ok ? r.json() : ({} as any)),
          fetchWithAuth(`${API_BASE}/api/employee-assessments/user/${encodeURIComponent(employeeData.user_id)}`, { headers }).then((r) => r.ok ? r.json() : ({} as any)),
        ]);

        const employeeAssessments =
          employeeAssessmentsRes?.data?.assessments || employeeAssessmentsRes?.assessments || [];

        const assessmentIds = Array.from(
          new Set(
            (Array.isArray(employeeAssessments) ? employeeAssessments : [])
              .map((ea: any) => ea?.assessment_id)
              .filter(Boolean)
              .map((id: any) => String(id)),
          ),
        );

        const assessmentDetailsPayload = await Promise.all(
          assessmentIds.map((id) =>
            fetchWithAuth(`${API_BASE}/api/assessments/${encodeURIComponent(id)}`, { headers })
              .then((r) => (r.ok ? r.json() : null))
              .catch(() => null),
          ),
        );

        const assessmentDetailById = new Map<string, any>();
        (Array.isArray(assessmentDetailsPayload) ? assessmentDetailsPayload : []).forEach((payload: any) => {
          const detail = payload?.data?.assessment || payload?.data || payload?.assessment || payload;
          if (detail?.assessment_id) {
            assessmentDetailById.set(String(detail.assessment_id), detail);
          }
        });

        const processedModuleIds = Array.from(
          new Set(
            Array.from(assessmentDetailById.values())
              .map((d: any) => d?.processed_module_id)
              .filter(Boolean)
              .map((id: any) => String(id)),
          ),
        );

        let processedModulesById = new Map<string, any>();
        if (processedModuleIds.length > 0) {
          const processedModulesPayload = await fetchWithAuth(`${API_BASE}/api/processed-modules/batch`, {
            method: "POST",
            headers: {
              ...headers,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ processed_module_ids: processedModuleIds }),
          })
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null);

          const processedModules =
            processedModulesPayload?.data?.modules ||
            processedModulesPayload?.data ||
            processedModulesPayload?.modules ||
            [];

          processedModulesById = new Map(
            (Array.isArray(processedModules) ? processedModules : [])
              .filter((pm: any) => pm?.processed_module_id)
              .map((pm: any) => [String(pm.processed_module_id), pm]),
          );
        }

        const assessmentEvidenceByModuleId: Record<string, AssessmentEvidence[]> = {};
        (Array.isArray(employeeAssessments) ? employeeAssessments : []).forEach((ea: any) => {
          const detail = assessmentDetailById.get(String(ea?.assessment_id || ""));
          if (!detail || detail?.type !== "module") return;

          const processedModule = processedModulesById.get(String(detail?.processed_module_id || ""));
          const originalModuleId = String(
            detail?.original_module_id ||
            processedModule?.original_module_id ||
            "",
          );
          if (!originalModuleId) return;

          const score = typeof ea?.score === "number" ? ea.score : null;
          const maxScore = typeof ea?.max_score === "number" ? ea.max_score : null;
          const scorePercent =
            score !== null
              ? maxScore && maxScore > 0
                ? Number(((score / maxScore) * 100).toFixed(2))
                : score
              : null;

          const bucket = assessmentEvidenceByModuleId[originalModuleId] || [];
          bucket.push({
            scorePercent,
            completedAt: toIso(ea?.completed_at),
          });
          assessmentEvidenceByModuleId[originalModuleId] = bucket;
        });

        return {
          plans: plansRes?.plans || [],
          modules: modulesRes?.modules || [],
          progress: progressRes?.progress || [],
          users: usersRes?.users || [],
          company: companyRes?.company || companyRes || null,
          learningStyle: learningStyleRes?.data?.learning_style || null,
          assessmentEvidenceByModuleId,
        };
      },
      {
        ttlMs: 5 * 1000, // Short fallback TTL because assignments/progress change externally
        swr: true,
        swrMs: 30 * 1000,
      }
    );

    return result.data;
  };

  const loadDashboard = async () => {
    if (!user?.email) return;

    try {
      setLoading(true);
      const emp = await fetchUserByEmail(user.email);
      if (!emp) {
        router.push("/login");
        return;
      }

      setEmployee(emp);

      const selectedCompanyId = isDeveloperMode && activeCompanyId
        ? activeCompanyId
        : emp.company_id;

      if (!selectedCompanyId) {
        setLoading(false);
        return;
      }

      const data = await fetchDashboardData(emp, selectedCompanyId);
      const plans = data?.plans || [];
      const modules = data?.modules || [];
      const progress = Array.isArray(data?.progress) ? data.progress : [];
  const assessmentEvidenceByModuleId = data?.assessmentEvidenceByModuleId || {};

  const mappedAssigned = buildSprintsFromPlans(plans, modules, progress, assessmentEvidenceByModuleId);

      setAssignedModules(mappedAssigned);
      setModuleProgress(progress);
      setLearningStyle(data?.learningStyle || null);
      setCompanyLearningStyleEnabled(Boolean(data?.company?.learning_style_enabled));

      const baselineNeeded = plans.some((plan: any) => plan.baseline_assessment === 1 || plan.baseline_assessment === true);
      setBaselineRequired(baselineNeeded);

      const totalUsers = Array.isArray(data?.users) ? data.users.length : 0;
    const completedCount = mappedAssigned.filter((p) => p.status === "completed").length;
      const progressValue = mappedAssigned.length > 0 ? Math.round((completedCount / mappedAssigned.length) * 100) : 0;
      setProgressPercentage(progressValue);
      setCompanyStats({ totalEmployees: totalUsers, completedEmployees: 5, userRank: 1, topPercentile: 10 });
      generateNudgeMessage(progressValue, 1, totalUsers, 10, 5);
    } catch (e) {
      console.error("[Welcome] loadDashboard failed:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && user) {
      loadDashboard();
    }

    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [user, authLoading, activeCompanyId, isDeveloperMode]);

   const generateNudgeMessage = (progress: number, rank: number | null, total: number, percentile: number, completed: number) => {
     if (progress === 100) setNudgeMessage("🎉 Congratulations! You've completed your Performance Sprint and earned the SME tag!");
     else setNudgeMessage(`💪 One step in! Complete your sprints and stand among the top 5%.`);
   };

   if (showLoadingProgress) {
     return <LoadingProgress label="Preparing your dashboard" progress={loadingProgress} />;
   }

   return (
     <div className="min-h-screen">
       {/* Login Success Toast */}
       {showLoginToast && (
         <div className="fixed top-6 right-6 z-[100] animate-in slide-in-from-right fade-in duration-500">
           <div className="max-w-md w-full bg-white rounded-2xl shadow-2xl border border-slate-100 p-4 flex items-center gap-4">
             <div className="w-12 h-12 rounded-full bg-green-500 flex items-center justify-center text-white shadow-lg">
               <CheckCircle2 size={24} />
             </div>
             <div>
               <div className="text-lg font-extrabold text-slate-900">Successfully logged in!</div>
               <div className="text-sm text-slate-500 font-medium">Your learning dashboard is ready.</div>
             </div>
             <button onClick={() => setShowLoginToast(false)} className="ml-auto text-slate-300 hover:text-slate-500">✕</button>
           </div>
         </div>
       )}

       <main className="min-h-screen pt-4 md:pt-8 pb-8 md:pb-12 px-4 sm:px-6 lg:px-8">
          <div className="max-w-6xl mx-auto w-full">
         
           {/* Dashboard Header */}
           <div className="mb-6 md:mb-10 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
             <div className="flex items-center gap-3 sm:gap-4 min-w-0">
               <div className="w-10 h-10 sm:w-12 sm:h-12 bg-white rounded-2xl shadow-sm flex items-center justify-center border border-slate-100 shrink-0">
                 <Users className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" />
               </div>
               <div className="min-w-0 flex-1">
                 <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight break-words">
                   {employee?.name ? `Welcome, ${employee.name.split(" ")[0]}` : "Learner Dashboard"}
                 </h1>
                 <p className="text-xs sm:text-sm text-slate-500 font-medium break-all sm:break-normal">
                   {employee?.email || "Personalized learning hub"}
                 </p>
               </div>
             </div>
             <div className="w-full md:w-[320px]">
               <CompanySelector showLabel />
             </div>
           </div>

           <div className="grid gap-4 md:gap-8">
             {/* Progress Nudge Card (Premium Circular Design) */}
             {nudgeMessage && (
              <Card className="rounded-3xl border-none shadow-[0_8px_30px_rgb(0,0,0,0.04)] bg-white overflow-hidden">
                <CardContent className="p-4 sm:p-6">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="flex items-start gap-4 flex-1 min-w-0">
                      <div className="w-10 h-10 sm:w-14 sm:h-14 bg-blue-50 rounded-xl flex items-center justify-center shrink-0">
                        {progressPercentage === 100 ? (
                          <Trophy className="text-blue-600 w-5 h-5 sm:w-6 sm:h-6" />
                        ) : (
                          <Zap className="text-blue-600 w-5 h-5 sm:w-6 sm:h-6" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <h3 className="text-base sm:text-lg font-black text-slate-900">
                          Your Progress
                        </h3>
                        <p className="text-slate-500 mt-1 font-medium leading-relaxed text-xs sm:text-sm">
                          {nudgeMessage}
                        </p>

                        <div className="flex flex-wrap gap-2 mt-3">
                          <Badge
                            variant="secondary"
                            className="bg-slate-100 text-slate-600 border-none font-bold text-[10px] sm:text-xs"
                          >
                            63 COMPLETED
                          </Badge>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col items-center justify-center self-center sm:self-auto">
                      <div
                        className={`relative w-20 h-20 sm:w-24 sm:h-24 rounded-full flex items-center justify-center bg-white border-4 ${
                          progressPercentage >= 100 ? "border-green-100" : "border-blue-50"
                        }`}
                      >
                        <span
                          className={`text-lg sm:text-2xl font-black ${
                            progressPercentage >= 100 ? "text-green-600" : "text-blue-600"
                          }`}
                        >
                          27.6%
                        </span>
                      </div>

                      <div className="mt-2 text-[10px] sm:text-xs font-black uppercase tracking-[0.05em] text-slate-400 text-center">
                        96 of 348
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
             {/* {nudgeMessage && (
               <Card className="rounded-3xl border-none shadow-[0_8px_30px_rgb(0,0,0,0.04)] bg-white overflow-hidden relative">
                 <CardContent className="py-4 sm:py-6 md:py-8 px-4 sm:px-6 md:px-8">
                   <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
                     <div className="flex flex-col gap-3 w-full md:w-auto md:flex-1">
                       <div className="flex items-start gap-3">
                         <div className="w-12 md:w-14 h-12 md:h-14 bg-blue-50 rounded-xl md:rounded-2xl flex items-center justify-center shrink-0">
                           {progressPercentage === 100 ? <Trophy className="text-blue-600 w-5 md:w-6 h-5 md:h-6" /> : <Zap className="text-blue-600 w-5 md:w-6 h-5 md:h-6" />}
                         </div>
                         <div className="min-w-0 flex-1">
                           <h3 className="text-base sm:text-lg md:text-lg font-black text-slate-900">Your Progress</h3>
                           <p className="text-slate-500 mt-1 font-medium leading-relaxed text-xs sm:text-sm md:text-sm line-clamp-3">{nudgeMessage}</p>
                         </div>
                       </div>
                       <div className="flex gap-1.5 md:gap-2 flex-wrap">
                         <Badge variant="secondary" className="bg-slate-100 text-slate-600 border-none font-bold text-[8px] sm:text-[9px] md:text-xs whitespace-nowrap">
                           63 COMPLETED
                         </Badge>
                       </div>
                     </div>

                     <div className="flex flex-col items-center w-full md:w-auto md:ml-auto">
                       <div className={`relative w-16 md:w-20 h-16 md:h-20 rounded-full flex items-center justify-center bg-white border-4 md:border-6 ${progressPercentage >= 100 ? 'border-green-100' : 'border-blue-50'}`}>
                         <span className={`text-lg md:text-xl font-black ${progressPercentage >= 100 ? 'text-green-600' : 'text-blue-600'}`}>
                           27.6%
                         </span>
                       </div>
                       <div className="mt-1 md:mt-2 text-[7px] md:text-[8px] font-black uppercase tracking-[0.05em] text-slate-400 text-center">
                         96 of 348
                       </div>
                     </div>
                   </div>
                 </CardContent>
               </Card>
             )} */}

             {/* Learning Style Card (Sequential Logic) */}
             {companyLearningStyleEnabled && (
               <Card className="rounded-2xl border-none shadow-sm bg-white overflow-visible">
                 <CardContent className="p-4 sm:p-6">
                   {learningStyle ? (
                     <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 text-center sm:text-left">
                      <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-blue-600 text-white flex items-center justify-center text-xl sm:text-2xl font-black shadow-xl shadow-blue-100 shrink-0">
                        {learningStyle}
                      </div>

                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm sm:text-base font-extrabold text-slate-900">
                          Your Learning Style
                        </h4>
                        <div className="mt-2 text-xs sm:text-sm text-slate-500">
                          <LearningStyleBlurb styleCode={learningStyle} />
                        </div>
                        <Button
                          variant="link"
                          className="text-blue-600 font-bold p-0 h-auto mt-3 text-xs sm:text-sm"
                          onClick={() => router.push("/employee/score-history")}
                        >
                          Get full report <ArrowRight size={14} className="ml-1" />
                        </Button>
                      </div>
                    </div>
                   ) : (
                     <div className="flex flex-col sm:flex-row items-center justify-center sm:justify-between gap-4">
                       <div className="w-full sm:max-w-md text-center sm:text-left">
                         <h4 className="text-base md:text-lg font-black text-slate-900 mb-1">Discover Your Learning Style</h4>
                         <p className="text-xs md:text-sm text-slate-500 font-medium">Take our 5-minute survey to unlock your personalized path.</p>
                       </div>
                     
                       <div className="relative mt-2 sm:mt-0">
                         {/* Profile Dropdown - Commented Out */}
                         {/*
                         <button
                           onClick={() => setShowProfileDropdown(!showProfileDropdown)}
                           className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors"
                     >
                           <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center text-white">
                             <User className="w-5 h-5" />
                           </div>
                           <span className="text-sm font-medium text-gray-700">
                             {employee?.name || user?.displayName || "Profile"}
                   </span>
                   <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${showProfileDropdown ? 'rotate-180' : ''}`} />
                 </button>
                 
                 {showProfileDropdown && (
                   <div className="absolute right-0 top-full mt-2 w-64 bg-white rounded-lg shadow-lg border border-gray-200 py-2 z-50">
                     <div className="px-4 py-3 border-b border-gray-100">
                       <div className="font-medium text-gray-900">
                         {employee?.name || user?.displayName || "User"}
                       </div>
                       <div className="text-sm text-gray-500">{user?.email}</div>
                     </div>
                     
                     <div className="py-1">
                       <button
                         onClick={() => {
                           setShowProfileDropdown(false)
                           router.push("/employee/account")
                         }}
                         className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                       >
                         <User className="w-4 h-4" />
                         Account Settings
                       </button>
                       
                       <button
                         onClick={() => {
                           setShowProfileDropdown(false)
                           handleLogout()
                         }}
                         className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                       >
                         <LogOut className="w-4 h-4" />
                         Logout
                       </button>
                     </div>
                   </div>
                 )}
                 */}
                         {/* Callout Bubble from Ref Code */}
                         <div className="hidden sm:block absolute -top-20 sm:-top-24 right-0 z-10 w-64 sm:w-72 animate-bounce">
                           <div className="bg-blue-600 text-white rounded-2xl px-4 sm:px-5 py-2 sm:py-3 shadow-xl text-xs sm:text-sm">
                             <p className="font-black text-xs sm:text-sm">Step 1: Start Here!</p>
                             <p className="text-blue-100 text-[10px] sm:text-xs">Complete survey to unlock modules.</p>
                             <div className="absolute right-8 -bottom-2 w-4 h-4 bg-blue-600 rotate-45"></div>
                           </div>
                         </div>
                         <Button onClick={() => router.push('/employee/learning-style')} className="bg-slate-900 hover:bg-black text-white px-6 sm:px-8 py-2 sm:py-3 rounded-xl font-bold h-10 sm:h-11 text-xs sm:text-sm">
                           Take Survey
                         </Button>
                       </div>
                     </div>
                   )}
                 </CardContent>
               </Card>
             )}

             {/* Assigned Modules (Locked State preserved) */}
             <Card className="rounded-2xl border-none shadow-sm bg-white overflow-hidden">
               <CardHeader className="bg-slate-50/50 border-b border-slate-50 px-4 md:px-6 py-3 md:py-4">
                 <CardTitle className="text-sm md:text-base font-black text-slate-900">Assigned Sprints</CardTitle>
               </CardHeader>
               <CardContent className="p-0">
                 {/* Only lock modules if learning style is enabled AND user hasn't completed survey */}
                 {companyLearningStyleEnabled && !learningStyle ? (
                   <div className="py-8 sm:py-12 flex flex-col items-center text-center px-4">
                     <div className="w-12 h-12 sm:w-14 sm:h-14 bg-slate-100 rounded-2xl flex items-center justify-center text-slate-400 mb-3">
                       <ShieldCheck size={24} className="sm:w-7 sm:h-7" />
                     </div>
                     <h5 className="text-sm sm:text-base font-bold text-slate-900">Modules are currently locked</h5>
                     <p className="text-xs sm:text-sm text-slate-500 max-w-xs mt-1 font-medium">Complete your learning preference survey to access your baseline and training plan.</p>
                   </div>
                 ) : assignedModules.length === 0 ? (
                   <div className="py-8 sm:py-12 flex flex-col items-center text-center px-4">
                     <p className="text-slate-500 text-xs sm:text-sm font-medium">No Sprints Assigned</p>
                   </div>
                 ) : (
                   <div>
                     <div className={`divide-y divide-slate-50 ${showAllModules ? 'max-h-[500px] overflow-y-auto' : ''}`}>
                       {(showAllModules ? assignedModules : assignedModules.slice(0, 3)).map((m, idx) => (
                         <div key={m.id} className="flex flex-col items-start gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:p-4 md:p-6 bg-white">
                           <div className="flex-1 min-w-0 w-full sm:w-auto">
                             <p className="text-sm sm:text-base font-extrabold text-slate-900 break-words">{m.title || `Module ${m.id}`}</p>
                             {m.moduleName && (
                               <div className="text-xs text-slate-500 break-words mt-0.5">{m.moduleName}</div>
                             )}
                             {/* <div className="mt-2 flex flex-wrap items-center gap-2">
                               {m.certificateEarned ? (
                                 <Badge className="bg-green-50 text-green-700 border border-green-200 font-bold">Completed</Badge>
                               ) : m.status === "in_progress" ? (
                                 <Badge variant="secondary" className="bg-blue-50 text-blue-700 border border-blue-100 font-bold">In Progress</Badge>
                               ) : (
                                 <Badge variant="secondary" className="bg-slate-100 text-slate-600 border border-slate-200 font-bold">Not Started</Badge>
                               )}
                               <Badge variant="secondary" className="bg-slate-100 text-slate-600 border border-slate-200 font-semibold">
                                 Quiz threshold: {m.quizThreshold}%
                               </Badge>
                             </div> */}
                             {/* TEMP DEBUG BADGE - REMOVE WHEN FIXED */}
                             {/* <div className="mt-2">
                               <span className="inline-block bg-yellow-100 text-yellow-800 text-xs rounded px-2 py-1 font-mono font-bold mr-2">DEBUG</span>
                               <span className="text-xs text-slate-700 font-mono">Score(s): [
                                 {m.modules.map((mod, i) => `${mod.quizScore ?? "-"}`).join(", ")}
                               ] | Threshold: {m.quizThreshold}% | Cert: {m.certificateEarned ? "Y" : "N"}</span>
                             </div> */}
                           </div>

                           <div className="flex gap-2 w-full sm:w-auto flex-shrink-0">
                             {m.hasBaseline && !m.certificateEarned ? (
                               <button onClick={() => router.push(`/employee/assessment?moduleId=${m.id}`)} className="px-3 py-2 rounded-lg text-xs border border-slate-200 font-bold text-slate-700 bg-white hover:bg-slate-50 flex-1 sm:flex-none h-10">
                                 Baseline
                               </button>
                             ) : null}

                             {m.certificateEarned && (
                               <button
                                 onClick={() => openCertificateModal(m)}
                                 className="px-4 sm:px-5 py-1.5 sm:py-2 rounded-xl text-xs border border-blue-600 text-blue-700 font-bold hover:bg-blue-50 flex-1 sm:flex-none h-9 sm:h-10 transition-all duration-200 inline-flex items-center justify-center gap-1.5"
                               >
                                 <Award size={16} />
                                 View Certificate
                               </button>
                             )}

                             <button
                               onClick={() => router.push(`/employee/training-plan?module_id=${m.id}`)}
                               className={
                                 m.certificateEarned
                                   ? "px-4 sm:px-5 py-1.5 sm:py-2 rounded-xl text-xs bg-slate-100 text-slate-700 font-bold hover:bg-slate-200 flex-1 sm:flex-none h-9 sm:h-10 transition-all duration-200"
                                   : m.status === "in_progress"
                                   ? "px-4 sm:px-5 py-1.5 sm:py-2 rounded-xl text-xs border border-blue-600 text-blue-700 font-bold hover:bg-blue-50 flex-1 sm:flex-none h-9 sm:h-10 transition-all duration-200"
                                   : "px-4 sm:px-5 py-1.5 sm:py-2 rounded-xl text-xs bg-blue-600 text-white font-bold hover:bg-blue-700 flex-1 sm:flex-none h-9 sm:h-10 transition-all duration-200"
                               }
                             >
                               {m.certificateEarned ? "Review Sprint" : m.status === "in_progress" ? "Continue Sprint" : "Start Your Sprint"}
                             </button>
                           </div>
                         </div>
                       ))}
                     </div>
                     
                     {/* Show More / Show Less button */}
                     {assignedModules.length > 3 && (
                       <div className="p-3 sm:p-4 bg-slate-50/50 flex justify-center sm:justify-end">
                         <button
                           onClick={() => setShowAllModules(!showAllModules)}
                           className="px-4 py-2 rounded-lg bg-blue-500 text-white text-xs sm:text-sm font-semibold hover:bg-blue-600 transition-all flex items-center gap-1.5 h-9 w-full sm:w-auto justify-center"
                         >
                           {showAllModules ? (
                             <>
                               Show Less
                               <ChevronDown size={14} className="rotate-180 transition-transform" />
                             </>
                           ) : (
                             <>
                               Show More
                               <ChevronDown size={14} className="transition-transform" />
                             </>
                           )}
                         </button>
                       </div>
                     )}
                   </div>
                 )}
               </CardContent>
             </Card>

             {/* Progress History */}
             {/* <Card className="rounded-2xl border-none shadow-sm bg-white overflow-hidden">
               <CardHeader className="px-8 py-6">
                 <CardTitle className="text-lg font-black text-slate-900">Recent Activity</CardTitle>
               </CardHeader>
               <CardContent className="px-8 pb-8">
                 <div className="space-y-4">
                   {moduleProgress.length === 0 ? (
                     <p className="text-slate-400 font-medium text-center py-4">No activity yet.</p>
                   ) : (
                     moduleProgress.map((mod) => (
                       <div key={mod.processed_module_id} className="flex items-center gap-4 p-4 rounded-xl bg-slate-50/50 border border-slate-100/50">
                         <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${mod.completed_at ? 'bg-green-100 text-green-600' : 'bg-blue-50 text-blue-600'}`}>
                           {mod.completed_at ? <CheckCircle2 size={20} /> : <Clock size={20} />}
                         </div>
                         <div className="flex-1 overflow-hidden">
                           <p className="font-bold text-slate-900 truncate">{mod.processed_modules?.title || `Module ${mod.processed_module_id}`}</p>
                           <p className="text-xs text-slate-500 font-medium">{mod.completed_at ? 'Finished' : 'In Progress'}</p>
                         </div>
                         {mod.quiz_score !== null && (
                           <Badge className="bg-white border-slate-200 text-slate-600 font-bold">Score: {mod.quiz_score}%</Badge>
                         )}
                       </div>
                     ))
                   )}
                 </div>
               </CardContent>
             </Card> */}
           </div>
         </div>
       </main>

        {selectedCertificateSprint && (
          <div className="fixed inset-0 z-[120] bg-slate-900/65 backdrop-blur-sm p-3 sm:p-6 overflow-y-auto">
            <div className="max-w-5xl mx-auto bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
              <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-slate-100">
                <div>
                  <h3 className="text-base sm:text-lg font-black text-slate-900">Sprint Completion Certificate</h3>
                  <p className="text-xs sm:text-sm text-slate-500 font-medium">Preview, download, or share your accomplishment.</p>
                </div>
                <button
                  onClick={closeCertificateModal}
                  className="w-9 h-9 rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50 inline-flex items-center justify-center"
                  aria-label="Close certificate preview"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="p-4 sm:p-6">
                <CertificateTemplate
                  ref={certificateRef}
                  recipientName={employee?.name || user?.displayName || "Lucid Learner"}
                  sprintName={selectedCertificateSprint.title}
                  completionDate={formatCertificateDate(selectedCertificateSprint.completedDate)}
                />

                <div className="mt-5 flex flex-col gap-3">
                  <div className="flex flex-col sm:flex-row gap-3">
                    <Button
                      variant="outline"
                      className="border-blue-600 text-blue-700 hover:bg-blue-50 font-bold"
                      onClick={downloadCertificatePdf}
                      disabled={isExportingCertificate}
                    >
                      <Download size={16} className="mr-2" />
                      {isExportingCertificate ? "Preparing PDF..." : "Download PDF"}
                    </Button>

                    <Button
                      variant="outline"
                      className="border-[#0A66C2] text-[#0A66C2] hover:bg-[#EEF5FD] font-bold"
                      onClick={() => {
                        setLinkedinExpanded((prev) => !prev);
                        setLinkedinError("");
                      }}
                    >
                      <Linkedin size={16} className="mr-2" />
                      Share on LinkedIn
                    </Button>
                  </div>

                  {linkedinExpanded && (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                      <label className="block text-xs sm:text-sm font-semibold text-slate-700">Paste your LinkedIn Profile URL</label>
                      <input
                        type="url"
                        value={linkedinProfileUrl}
                        onChange={(e) => setLinkedinProfileUrl(e.target.value)}
                        placeholder="https://www.linkedin.com/in/yourprofile"
                        className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-200"
                      />
                      {linkedinError ? <p className="text-xs text-red-600 font-medium">{linkedinError}</p> : null}
                      <Button onClick={shareOnLinkedIn} className="bg-[#0A66C2] hover:bg-[#0058B1] text-white font-semibold">
                        Post to LinkedIn
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
     </div>
   );
}

  const CertificateTemplate = React.forwardRef<HTMLDivElement, {
    recipientName: string;
    sprintName: string;
    completionDate: string;
  }>(({ recipientName, sprintName, completionDate }, ref) => {
    return (
      <div
        ref={ref}
        className="relative bg-gradient-to-br from-white via-sky-50/40 to-blue-50/70 rounded-xl p-4 sm:p-8 border-4 border-sky-100"
      >
        <div className="absolute inset-4 border-2 border-blue-100 rounded-lg pointer-events-none" />

        <div className="absolute inset-0 pointer-events-none opacity-40 rounded-xl overflow-hidden">
          <div className="absolute -top-10 -left-16 w-64 h-64 border border-blue-100 rounded-full" />
          <div className="absolute top-20 -right-16 w-56 h-56 border border-sky-100 rounded-full" />
          <div className="absolute bottom-6 left-1/3 w-40 h-40 border border-indigo-100 rounded-full" />
        </div>

        <div className="relative z-10">
          <div className="relative">
            <div className="text-center">
              
              <h2 className="text-2xl sm:text-4xl font-black text-slate-900 mt-2 tracking-wide">CERTIFICATE OF SPRINT COMPLETION</h2>
            </div>

            <div className="absolute top-0 right-0 flex items-center gap-0 shrink-0">
              <svg
                viewBox="0 0 64 64"
                className="w-8 h-8"
                aria-hidden="true"
                focusable="false"
              >
                <defs>
                  <linearGradient id="lucidPurple" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#5B2DE1" />
                    <stop offset="100%" stopColor="#6F45EE" />
                  </linearGradient>
                </defs>
                <rect x="24" y="8" width="24" height="24" fill="url(#lucidPurple)" />
                <rect x="8" y="24" width="24" height="24" fill="url(#lucidPurple)" />
                <rect x="24" y="24" width="8" height="8" fill="#FFFFFF" />
                <rect x="34" y="48" width="12" height="12" fill="#8FAAE6" />
              </svg>
              <span className="text-lg sm:text-xl font-black text-black leading-none">Lucid</span>
            </div>
          </div>

          <div className="mt-8 sm:mt-10 text-center px-2">
            <p className="text-sm sm:text-base text-slate-600 font-medium">This Certificate is Proudly Awarded to</p>
            <h3 className="mt-3 text-2xl sm:text-4xl font-black text-blue-700 tracking-wide">{recipientName}</h3>

            <p className="mt-6 text-sm sm:text-base text-slate-700 leading-relaxed max-w-3xl mx-auto">
              In Recognition of Successfully Completing the
            </p>

            <p className="mt-2 text-lg sm:text-2xl font-bold text-slate-900">“{sprintName}”</p>

            <p className="mt-5 text-sm sm:text-base text-slate-700 leading-relaxed max-w-3xl mx-auto">
              Demonstrating Readiness, Focus and Commitment to Doing The Job Better Every Day.
            </p>
          </div>

          <div className="mt-8 sm:mt-10 flex items-end justify-between gap-6 border-t border-blue-100 pt-5">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500 font-bold">Date</p>
              <p className="text-base sm:text-lg font-black text-slate-900 mt-1">{completionDate}</p>
            </div>

            <div className="text-right">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500 font-bold">Awarded by</p>
              <p className="text-base sm:text-lg font-black text-blue-700 mt-1">Lucid</p>
            </div>
          </div>
        </div>
      </div>
    );
  });

  CertificateTemplate.displayName = "CertificateTemplate";

function LearningStyleBlurb({ styleCode }: { styleCode: string }) {
  const meta: Record<string, { label: string; blurb: string }> = {
    CS: { label: "Concrete Sequential", blurb: "You prefer structure and clear steps. Your plan emphasizes checklists and measurable milestones." },
    AS: { label: "Abstract Sequential", blurb: "You think analytically and value logic. Your plan focuses on evidence-based frameworks." },
    AR: { label: "Abstract Random", blurb: "You learn through connections and stories. Your plan highlights collaboration and reflection." },
    CR: { label: "Concrete Random", blurb: "You enjoy experimentation and iteration. Your plan leans into creative problem solving." },
  };
  const info = meta[styleCode as keyof typeof meta] || { label: "Cognitive Learner", blurb: "Your plan is being personalized to your unique learning style." };
  return (
    <div className="text-xs sm:text-sm font-medium leading-relaxed">
      <span className="font-black text-slate-900 block mb-1">{info.label}</span>
      {info.blurb}
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
        if (shouldHold) return prev; // create a brief stall so progress looks more natural
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
        <p className="text-xs text-slate-500 font-medium">We are personalizing your experience. This will only take a moment.</p>
      </div>
    </div>
  );
}