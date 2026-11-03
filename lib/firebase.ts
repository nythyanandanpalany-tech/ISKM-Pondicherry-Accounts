import { getApp, getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { connectStorageEmulator, getStorage } from "firebase/storage";

const cfg = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "demo-key",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "demo-expenseflow.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "demo-expenseflow",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "demo-expenseflow.appspot.com",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "demo-app",
};
export const configured = !!process.env.NEXT_PUBLIC_FIREBASE_API_KEY || process.env.NEXT_PUBLIC_USE_EMULATORS === "1";

const app = getApps().length ? getApp() : initializeApp(cfg);
export const auth = getAuth(app);
export const fs = getFirestore(app);
export const storage = getStorage(app);

declare global { var __efEmu: boolean | undefined }
if (process.env.NEXT_PUBLIC_USE_EMULATORS === "1" && !globalThis.__efEmu) {
  globalThis.__efEmu = true;
  const host = process.env.NEXT_PUBLIC_EMULATOR_HOST || "127.0.0.1";
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(fs, host, 8080);
  connectStorageEmulator(storage, host, 9199);
}
