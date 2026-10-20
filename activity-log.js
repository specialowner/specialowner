// ==========================================================
// Special Owner — Activity log (audit trail)
// Every payment status change and every admin promotion / removal writes one
// entry to `activityLog`. Entries are append-only (Firestore rules forbid edit
// and delete) and only the Super Admin can read them.
// ==========================================================
import { collection, doc, addDoc, writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// Builds the log document. `extra` carries the details (unit, amount, target...).
export function logEntry(user, profile, action, extra = {}) {
  return {
    action,                                   // payment_paid | proof_approved | proof_rejected | admin_promoted | admin_removed
    actorId: user.uid,
    actorName: profile.name || profile.email || "",
    actorRole: profile.role || "",
    createdAt: serverTimestamp(),
    ...extra
  };
}

// Writes one entry on its own. A failed log never blocks the real action.
export async function logActivity(db, user, profile, action, extra) {
  try { await addDoc(collection(db, "activityLog"), logEntry(user, profile, action, extra)); }
  catch (e) { console.error("activityLog write failed:", e); }
}

// Adds an entry to an existing batch, so the change and its log commit together.
export function logInBatch(batch, db, user, profile, action, extra) {
  batch.set(doc(collection(db, "activityLog")), logEntry(user, profile, action, extra));
}

// Marks a payment as paid AND logs it in one atomic commit.
// `payment` = { id, unit, amount, residentId, dueDate } (extra fields are fine, missing ones are skipped).
export async function markPaidLogged(db, user, profile, payment, source, alsoInBatch) {
  const batch = writeBatch(db);
  batch.update(doc(db, "payments", payment.id), { status: "paid", paidAt: serverTimestamp() });
  if (alsoInBatch) alsoInBatch(batch);
  logInBatch(batch, db, user, profile, source === "receipt" ? "proof_approved" : "payment_paid", {
    targetType: "payment", targetId: payment.id,
    unit: payment.unit || "", amount: Number(payment.amount) || 0,
    residentId: payment.residentId || "", dueDate: payment.dueDate || "",
    source: source || "manual"
  });
  await batch.commit();
}
