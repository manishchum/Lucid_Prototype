import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatBytes(bytes: number, decimals = 2) {
  if (bytes === 0) return "0 Bytes"

  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"]

  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return Number.parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i]
}

// Helper function to notify admins when a module is completed
export async function notifyAdminOfCompletion(employeeId: string, moduleId: string) {
  try {
    console.log("📧 DEBUG: Triggering admin notification for module completion");
    const res = await fetch("/api/notify-admin-completion", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        employeeId: employeeId,
        moduleId: moduleId,
        completionDate: new Date().toISOString()
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error("📧 DEBUG: Admin notification failed:", errorText);
      throw new Error(`Admin notification failed: ${res.statusText}`);
    }

    const data = await res.json();
    console.log("📧 DEBUG: Admin notification sent successfully:", data);
    return data;
  } catch (error) {
    console.error("📧 DEBUG: Error sending admin notification:", error);
    throw error;
  }
}
