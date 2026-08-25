import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// Resolves with { user, profile } once auth state is known and role matches.
// requiredRole: 'resident' | 'admin' | null (null = any logged-in user)
export function requireAuth(requiredRole) {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        window.location.href = "index.html";
        return;
      }
      const snap = await getDoc(doc(db, "users", user.uid));
      const profile = snap.exists() ? snap.data() : { role: "resident" };
      if (requiredRole && profile.role !== requiredRole) {
        window.location.href = profile.role === "admin" ? "admin.html" : "resident.html";
        return;
      }
      resolve({ user, profile });
    });
  });
}

export async function logout() {
  await signOut(auth);
  window.location.href = "index.html";
}
