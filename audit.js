// ==========================================================
// Special Owner — Audit layer (everything that happens in the app)
//
// Drop-in replacements for Firestore's addDoc / setDoc / updateDoc / deleteDoc /
// writeBatch / runTransaction. Every file imports them from here instead of from the
// Firestore SDK, so every write by every role (resident, worker, site manager, security,
// call center, admin) leaves one entry in `activityLog` without touching the call sites.
//
// Rules of the road:
//  - The real write happens first. A failed log NEVER blocks or fails the real action.
//  - Only a short whitelist of fields is copied into the entry (unit, status, amount...),
//    never phone numbers, emails, passwords, photos or other personal data.
//  - Automatic housekeeping writes (queue positions, "seen" flags, name back-fills) are
//    skipped so the log shows what PEOPLE did, not what the clients do by themselves.
//  - Entries written by activity-log.js (payment paid, receipt approved/rejected, admin
//    promoted/removed) already carry their own meaning; they are not logged a second time.
// ==========================================================
import { auth, db } from "./firebase-config.js";
import {
  addDoc as fsAddDoc, setDoc as fsSetDoc, updateDoc as fsUpdateDoc, deleteDoc as fsDeleteDoc,
  writeBatch as fsWriteBatch, runTransaction as fsRunTransaction,
  collection, doc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

let actor = null; // { uid, name, role }
export function setAuditActor(user, profile) {
  actor = { uid: user.uid, name: (profile && (profile.name || profile.email)) || user.email || "", role: (profile && profile.role) || "" };
}
export function clearAuditActor() { actor = null; }

const LOG = "activityLog";
// Fields whose values are safe and useful to show. Everything else is recorded by NAME only.
const SAFE = ["unit", "status", "category", "title", "name", "residentName", "amount", "role", "accountStatus",
  "workerType", "label", "source", "type", "dueDate", "guestName", "frequency", "date", "from", "to", "days", "points", "cost"];
const TEXT = ["description", "text", "body", "note", "message", "location", "reason"]; // free text: first 100 chars only
// Writes the clients make on their own (not a person's decision).
const NOISE_KEYS = new Set(["queueAhead", "queueEtaHours", "statusSeenByResident", "residentName"]);

function isNoise(path, keys, data) {
  if (!keys.length) return true;
  if (keys.every(k => NOISE_KEYS.has(k))) return true;
  if (path.startsWith("payments/") && data && data.status === "overdue" && keys.length === 1) return true; // automatic overdue flag
  return false;
}

function collectionOf(path) { return String(path || "").split("/")[0]; }

function snapshotOf(data) {
  const out = {};
  if (!data || typeof data !== "object") return out;
  SAFE.forEach(k => { const v = data[k]; if (v !== undefined && v !== null && typeof v !== "object" && String(v) !== "") out[k] = typeof v === "number" ? v : String(v).slice(0, 80); });
  for (const k of TEXT) {
    const v = data[k];
    if (typeof v === "string" && v.trim()) { out.summary = v.trim().slice(0, 100); break; }
  }
  return out;
}

function entry(op, path, data, keys) {
  const who = actor || (auth.currentUser ? { uid: auth.currentUser.uid, name: auth.currentUser.email || "", role: "" } : null);
  if (!who) return null;
  const col = collectionOf(path);
  const parts = String(path).split("/");
  return {
    action: `${op}:${col}`,                 // e.g. update:maintenanceRequests, create:payments
    op, collection: col, targetPath: path, targetId: parts[parts.length - 1] || "",
    fields: (keys || []).slice(0, 25),
    generic: true,
    actorId: who.uid, actorName: who.name, actorRole: who.role,
    page: (location.pathname.split("/").pop() || "index.html"),
    createdAt: serverTimestamp(),
    ...snapshotOf(data)
  };
}

async function writeEntries(list) {
  const rows = list.filter(Boolean);
  if (!rows.length) return;
  try {
    if (rows.length === 1) { await fsAddDoc(collection(db, LOG), rows[0]); return; }
    const b = fsWriteBatch(db);
    rows.slice(0, 400).forEach(r => b.set(doc(collection(db, LOG)), r));
    await b.commit();
  } catch (e) { console.warn("audit log write failed:", e && e.code ? e.code : e); }
}

// A one-off event that is not a Firestore write (login, logout...).
export async function logEvent(action, extra = {}) {
  const who = actor || (auth.currentUser ? { uid: auth.currentUser.uid, name: auth.currentUser.email || "", role: "" } : null);
  if (!who) return;
  try {
    await fsAddDoc(collection(db, LOG), {
      action, op: "event", generic: true, actorId: who.uid, actorName: who.name, actorRole: who.role,
      page: (location.pathname.split("/").pop() || "index.html"), createdAt: serverTimestamp(), ...extra
    });
  } catch (e) { console.warn("audit event failed:", e && e.code ? e.code : e); }
}

const pathOf = (ref) => (ref && ref.path) || "";

// ---------- single writes ----------
export async function addDoc(colRef, data) {
  const ref = await fsAddDoc(colRef, data);
  if (collectionOf(pathOf(colRef)) !== LOG) writeEntries([entry("create", pathOf(ref), data, Object.keys(data || {}))]);
  return ref;
}
export async function setDoc(ref, data, options) {
  const res = await fsSetDoc(ref, data, options);
  const path = pathOf(ref);
  if (collectionOf(path) !== LOG) {
    const e = entry(options && options.merge ? "update" : "create", path, data, Object.keys(data || {}));
    // A brand-new account: nobody is "set up" yet, so take the identity from the profile just written.
    if (e && !actor && collectionOf(path) === "users" && auth.currentUser && auth.currentUser.uid === pathOf(ref).split("/")[1]) {
      e.actorName = (data && (data.name || data.email)) || e.actorName; e.actorRole = (data && data.role) || "";
    }
    writeEntries([e]);
  }
  return res;
}
export async function updateDoc(ref, ...args) {
  const res = await fsUpdateDoc(ref, ...args);
  const data = (args.length === 1 && typeof args[0] === "object") ? args[0] : null;
  const keys = data ? Object.keys(data) : args.filter((_, i) => i % 2 === 0).map(String);
  const path = pathOf(ref);
  if (collectionOf(path) !== LOG && !isNoise(path, keys, data)) writeEntries([entry("update", path, data, keys)]);
  return res;
}
export async function deleteDoc(ref) {
  const res = await fsDeleteDoc(ref);
  if (collectionOf(pathOf(ref)) !== LOG) writeEntries([entry("delete", pathOf(ref), null, [])]);
  return res;
}

// ---------- batches ----------
export function writeBatch(dbArg) {
  const real = fsWriteBatch(dbArg);
  const ops = [];
  const proxy = {
    set(ref, data, options) { real.set(ref, data, options); ops.push(["set", ref, data, options]); return proxy; },
    update(ref, ...args) { real.update(ref, ...args); ops.push(["update", ref, args.length === 1 ? args[0] : null, args]); return proxy; },
    delete(ref) { real.delete(ref); ops.push(["delete", ref, null]); return proxy; },
    async commit() {
      await real.commit();
      // A batch that already carries its own activityLog entry (payment paid, admin promoted...) is described by it.
      if (ops.some(o => collectionOf(pathOf(o[1])) === LOG)) return;
      writeEntries(ops.map(([op, ref, data, extra]) => {
        const path = pathOf(ref);
        if (collectionOf(path) === LOG) return null;
        if (op === "delete") return entry("delete", path, null, []);
        const keys = data ? Object.keys(data) : [];
        if (op === "update") return isNoise(path, keys, data) ? null : entry("update", path, data, keys);
        return entry(extra && extra.merge ? "update" : "create", path, data, keys);
      }));
    }
  };
  return proxy;
}

// ---------- transactions ----------
export async function runTransaction(dbArg, fn, options) {
  let ops = [];
  const result = await fsRunTransaction(dbArg, async (tx) => {
    ops = []; // a retried transaction starts over
    const proxy = {
      get: (...a) => tx.get(...a),
      set(ref, data, o) { tx.set(ref, data, o); ops.push(["set", ref, data, o]); return proxy; },
      update(ref, ...args) { tx.update(ref, ...args); ops.push(["update", ref, args.length === 1 ? args[0] : null]); return proxy; },
      delete(ref) { tx.delete(ref); ops.push(["delete", ref, null]); return proxy; }
    };
    return fn(proxy);
  }, options);
  writeEntries(ops.map(([op, ref, data, o]) => {
    const path = pathOf(ref);
    if (collectionOf(path) === LOG) return null;
    if (op === "delete") return entry("delete", path, null, []);
    const keys = data ? Object.keys(data) : [];
    return entry(op === "set" && !(o && o.merge) ? "create" : "update", path, data, keys);
  }));
  return result;
}
