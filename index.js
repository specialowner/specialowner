// ==========================================================
// Special Owner — Cloud Functions
//
// Moves the maintenance queue math (queueAhead / queueEtaHours) that used to
// live in admin.js / manager.js onto the server. Previously it only ran when
// an admin or site manager had the Maintenance tab open in their browser —
// if nobody did, a resident's request could sit with a stale queue position
// and wait time. This function keeps it correct with no browser involved,
// triggered directly by Firestore writes.
// ==========================================================
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { setGlobalOptions } = require("firebase-functions/v2");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp();
setGlobalOptions({ region: "us-central1", maxInstances: 10 });
const db = getFirestore();

// Same mapping as the client (admin.js / manager.js CATEGORY_TO_CRAFT): which
// craft (workerType) handles which request category. Kept in sync by hand —
// if a category is ever added client-side, add it here too.
const CATEGORY_TO_CRAFT = {
  "Cleaning": "cleaning",
  "Plumbing": "maintenance",
  "Electrical": "maintenance",
  "AC / Cooling": "maintenance",
  "Carpentry": "maintenance",
  "Other": "maintenance"
};
// Fallback length for a request no worker has estimated yet (hours) — mirrors
// DEFAULT_TASK_HOURS client-side, so the number matches whichever side computed it last.
const DEFAULT_TASK_HOURS = 1;

exports.recomputeMaintenanceQueue = onDocumentWritten(
  "maintenanceRequests/{requestId}",
  async (event) => {
    const before = event.data?.before?.exists ? event.data.before.data() : null;
    const after = event.data?.after?.exists ? event.data.after.data() : null;
    const doc = after || before;
    if (!doc) return;

    // Only queueAhead/queueEtaHours changed on this very doc (our own previous
    // write) → nothing else to recompute, stop here so the trigger doesn't loop.
    if (before && after) {
      const changedKeys = Object.keys(after).filter(
        (k) => JSON.stringify(after[k]) !== JSON.stringify(before[k])
      );
      const onlyQueueFields = changedKeys.every((k) => k === "queueAhead" || k === "queueEtaHours");
      if (onlyQueueFields) return;
    }

    const craft = CATEGORY_TO_CRAFT[doc.category] || "maintenance";

    const snap = await db
      .collection("maintenanceRequests")
      .where("status", "in", ["pending", "accepted", "in_progress"])
      .get();

    const list = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((m) => (CATEGORY_TO_CRAFT[m.category] || "maintenance") === craft)
      .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));

    const batch = db.batch();
    let hoursSoFar = 0;
    let writeCount = 0;
    list.forEach((m, idx) => {
      const eta = Math.round(hoursSoFar * 2) / 2;
      if (m.queueAhead !== idx || m.queueEtaHours !== eta) {
        batch.update(db.collection("maintenanceRequests").doc(m.id), {
          queueAhead: idx,
          queueEtaHours: eta
        });
        writeCount++;
      }
      hoursSoFar += Number(m.estimatedHours) > 0 ? Number(m.estimatedHours) : DEFAULT_TASK_HOURS;
    });

    // A request that just left the active set (e.g. marked completed, or deleted)
    // doesn't need its own queue fields cleared — resident stops reading them once
    // status is "completed" — but the rest of the craft's queue above already
    // accounts for its absence since the query only pulls non-completed docs.

    if (writeCount > 0) await batch.commit();
  }
);
