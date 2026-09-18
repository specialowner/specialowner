// ==========================================================
// Special Owner — create a staff account on someone else's behalf
//
// Firebase's client SDK automatically signs you into whatever account
// you just called createUserWithEmailAndPassword() with — which would log
// the admin/manager out of their own session the moment they tried to add
// a worker. To avoid that, we spin up a second, throwaway Firebase App
// instance just for that one signup call, then tear it down immediately.
// The Firestore profile document is written through the PRIMARY app (the
// admin/manager's own signed-in session), so Firestore security rules see
// the real request.auth.uid and can check who is allowed to create what.
// ==========================================================
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { firebaseConfig, db as primaryDb } from "./firebase-config.js";

/**
 * @param {Object} params
 * @param {string} params.name
 * @param {string} params.email
 * @param {string} params.password
 * @param {"worker"|"manager"} params.role
 * @param {string} params.createdBy   uid of the admin/manager creating this account
 * @param {Object} [params.extra]     extra fields to store (e.g. workerType)
 * @returns {Promise<string>} the new user's uid
 */
export async function createStaffAccount({ name, email, password, role, createdBy, extra = {} }) {
  const tempAppName = `staff-create-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tempApp = initializeApp(firebaseConfig, tempAppName);
  const tempAuth = getAuth(tempApp);
  try {
    const cred = await createUserWithEmailAndPassword(tempAuth, email, password);
    const uid = cred.user.uid;
    // Created directly by an admin/manager, so it's active immediately —
    // no self-registration / approval step for these roles anymore.
    await setDoc(doc(primaryDb, "users", uid), {
      name,
      email,
      role,
      accountStatus: "active",
      createdBy,
      createdAt: serverTimestamp(),
      ...extra
    });
    return uid;
  } finally {
    // Clean up the throwaway app/session no matter what happened above.
    try { await signOut(tempAuth); } catch (_) {}
    try { await deleteApp(tempApp); } catch (_) {}
  }
}

export function friendlyStaffCreateError(err) {
  const code = err && err.code || "";
  if (code.includes("email-already-in-use")) return "This email is already registered.";
  if (code.includes("weak-password")) return "Password should be at least 6 characters.";
  if (code.includes("invalid-email")) return "Please enter a valid email address.";
  return (err && err.message) || "Something went wrong. Please try again.";
}
