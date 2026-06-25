// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app"
import { getAuth, GoogleAuthProvider } from "firebase/auth"
import { getAnalytics } from "firebase/analytics"

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
}

// Initialize Firebase - will error if credentials are missing. Guard so missing
// NEXT_PUBLIC_* env vars in development don't cause runtime crashes.
let app: any = null;
let auth: any = null;
let googleProvider: any = null;
let firebaseInitialized = false;

// Basic heuristic: require apiKey and projectId to initialize.
const hasRequiredConfig = !!firebaseConfig.apiKey && !!firebaseConfig.projectId;

if (!hasRequiredConfig) {
  // eslint-disable-next-line no-console
  console.warn(
    "Firebase not initialized: missing NEXT_PUBLIC_FIREBASE_* environment variables.\n" +
      "Set NEXT_PUBLIC_FIREBASE_API_KEY and NEXT_PUBLIC_FIREBASE_PROJECT_ID in your .env for local dev."
  );
} else {
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    auth.useDeviceLanguage();
    googleProvider = new GoogleAuthProvider();
    googleProvider.addScope("email");
    googleProvider.addScope("profile");
    // Always show account chooser — prevents silent COOP-related popup failures
    googleProvider.setCustomParameters({ prompt: "select_account" });

    // Initialize Analytics only outside localhost to reduce local dev noise
    const isLocalhost = typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname);
    if (typeof window !== "undefined" && !isLocalhost && firebaseConfig.measurementId) {
      try {
        getAnalytics(app);
      } catch (e) {
        // Analytics may not be available
      }
    }

    firebaseInitialized = true;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Firebase initialization error:", error);
  }
}

export { auth, googleProvider, firebaseInitialized };
export default app;