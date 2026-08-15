// ==========================================================
// Special Owner — Firebase configuration
// Replace the placeholders below with the values from your
// Firebase project settings (Project settings > General > Your apps > SDK setup and configuration).
// ==========================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCr1fNmevHZxVdagdJDAHBfqsvW8PQeWkY",
  authDomain: "specialowner-f3dce.firebaseapp.com",
  projectId: "specialowner-f3dce",
  storageBucket: "specialowner-f3dce.firebasestorage.app",
  messagingSenderId: "564954741060",
  appId: "1:564954741060:web:e3fc609004b1f3c5f3bf11",
  measurementId: "G-P89M3CDTPM"
};
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
