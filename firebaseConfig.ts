import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, Auth } from 'firebase/auth';
import { getDatabase, Database } from 'firebase/database';
import { getAnalytics } from "firebase/analytics";

// Provided configuration
const firebaseConfig = {
  apiKey: "AIzaSyA3HPePHfOxz-LLReRE7VhxhtkjGQktkYY",
  authDomain: "post-it-here-37ff2.firebaseapp.com",
  projectId: "post-it-here-37ff2",
  storageBucket: "post-it-here-37ff2.firebasestorage.app",
  messagingSenderId: "866578222388",
  appId: "1:866578222388:web:ea02d17ea1785ab90a6961",
  measurementId: "G-SNYX54FXGN"
};

// Check if the user has configured their keys (Basic check for placeholder)
// Since we have a real key now, this will likely be false, enabling real backend.
export const isDemoMode = firebaseConfig.apiKey === "YOUR_API_KEY";

let app;
let auth: Auth | null = null;
let db: Database | null = null;
let analytics;

if (!isDemoMode) {
  try {
    app = initializeApp(firebaseConfig);
    // Initialize Auth and Database first
    auth = getAuth(app);
    db = getDatabase(app);
    
    // Initialize Analytics safely (it can fail in some restricted environments)
    try {
        analytics = getAnalytics(app);
    } catch (e) {
        console.warn("Analytics failed to load", e);
    }
    
    // Auto sign-in
    signInAnonymously(auth).catch((error) => {
      console.error("Auth failed", error);
    });
  } catch (error) {
    console.error("Firebase initialization failed:", error);
    // Fallback to demo mode if crash occurs
    (window as any)._isDemoModeFallback = true;
  }
} else {
  console.log("Running in Demo Mode (Local Storage)");
}

export { auth, db };