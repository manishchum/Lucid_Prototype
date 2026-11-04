/**
 * Utility to manage and resolve a persistent, unique client device identifier.
 * Stored in localStorage so multiple tabs in the same browser share the same device_id.
 */

export function getDeviceId(): string {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    let deviceId = window.localStorage.getItem("device_id");

    if (!deviceId || deviceId.trim() === "" || deviceId === "undefined" || deviceId === "null") {
      deviceId = (typeof crypto !== "undefined" && crypto.randomUUID) 
        ? crypto.randomUUID() 
        : `dev-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      window.localStorage.setItem("device_id", deviceId);
    }

    return deviceId;
  } catch {
    return "ephemeral-client-device";
  }
}

