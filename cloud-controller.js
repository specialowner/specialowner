// Special Owner — "unità di controllo" that runs INSIDE the admin's browser (no server, no subscription).
// It holds the site private key (IndexedDB on this device), keeps a live copy of permissions from Firestore, verifies the codes
// scanned by the admin or by the guards' phones (scanRequests) and writes the access events.
// Limits: it only answers while an admin page with the key is open; it cannot drive gates/lifts (that needs the edge controller).
import {
  collection, doc, query, where, onSnapshot, setDoc, updateDoc, getDoc, writeBatch, runTransaction, increment, serverTimestamp, Timestamp, deleteField
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const Q = window.SOQR, E = window.SOEngine;
const IDB = "so-site", STORE = "k";
const idb = () => new Promise((res, rej) => { const r = indexedDB.open(IDB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const idbGet = async (k) => { const d = await idb(); return new Promise((res, rej) => { const q = d.transaction(STORE).objectStore(STORE).get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => rej(q.error); }); };
const idbSet = async (k, v) => { const d = await idb(); return new Promise((res, rej) => { const t = d.transaction(STORE, "readwrite"); t.objectStore(STORE).put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); }); };
const idbDel = async (k) => { const d = await idb(); return new Promise((res) => { const t = d.transaction(STORE, "readwrite"); t.objectStore(STORE).delete(k); t.oncomplete = res; }); };

export const VERSION = "cloud-1";
const BACKUP_TAG = "SO-SITEKEY-1";

export function initCloudController({ db, user, onChange }) {
  const note = () => { try { onChange && onChange(api.status()); } catch (e) { /* UI only */ } };
  const state = E.emptyState();
  const deviceId = "web-" + (localStorage.getItem("so_dev") || (() => { const v = Q.b64u(Q.randomBytes(5)); localStorage.setItem("so_dev", v); return v; })());
  let site = null;                 // { privateJwk, publicJwk, fingerprint }
  let cloudFp = undefined;         // fingerprint published in siteConfig/qr (undefined = not read yet, null = none)
  let engine = null, started = false, unsubs = [], stats = { allowed: 0, denied: 0 }, lastError = "";
  let chain = Promise.resolve();   // serialises evaluations

  const toChanges = (snap) => snap.docChanges().map((c) => ({ type: c.type, id: c.doc.id, data: c.doc.data() }));

  async function apply(kind, snap) {
    try {
      await E.applyChanges(state, kind, toChanges(snap), { site, now: Date.now, log: { warn() {}, error() {} } });
      note();
    } catch (e) { console.error("cloud-controller sync", kind, e); lastError = String(e.message || e); note(); }
  }

  function listen() {
    if (started || !site) return; started = true;
    engine = new E.AccessEngine(state, { debounceMs: 4000 });
    const on = (ref, kind) => unsubs.push(onSnapshot(ref, (s) => apply(kind, s), (e) => { console.error(kind, e); lastError = kind + ": " + (e.code || e.message); note(); }));
    on(query(collection(db, "qrCredentials"), where("status", "==", "active")), "credentials");
    on(collection(db, "users"), "users");
    on(collection(db, "units"), "units");
    on(collection(db, "accessPasses"), "passes");
    on(collection(db, "accessPoints"), "accessPoints");
    on(collection(db, "accessIdentities"), "identities");
    unsubs.push(onSnapshot(query(collection(db, "scanRequests"), where("status", "==", "pending")), (s) => {
      s.docChanges().forEach((c) => { if (c.type === "added") chain = chain.then(() => answer(c.doc.id, c.doc.data())).catch((e) => console.error("scan answer", e)); });
    }, (e) => console.error("scanRequests", e)));
    unsubs.push(setInterval(() => { if (engine) engine.prune(); beat().catch(() => {}); }, 30000));
    beat().catch(() => {});
  }
  function stop() { unsubs.forEach((u) => (typeof u === "function" ? u() : clearInterval(u))); unsubs = []; started = false; engine = null; }

  // ---------------- key management ----------------
  async function load() {
    site = await idbGet("site"); 
    onSnapshot(doc(db, "siteConfig", "qr"), (s) => { cloudFp = s.exists() ? s.data().fingerprint || null : null; note(); }, () => {});
    if (site) listen(); note();
  }
  async function publish(k) {
    await setDoc(doc(db, "siteConfig", "qr"), { publicJwk: k.publicJwk, fingerprint: k.fingerprint, stepSeconds: Q.STEP_SECONDS, version: 1, updatedAt: serverTimestamp(), updatedBy: user.uid });
  }
  async function createKey() {
    const k = await Q.generateSiteKeyPair();
    await idbSet("site", k); site = k;
    await publish(k); stop(); resetState(); listen(); note();
    return k.fingerprint;
  }
  function resetState() { const e = E.emptyState(); for (const k in state) delete state[k]; Object.assign(state, e); }
  function exportBackup() {
    if (!site) throw new Error("no-key");
    return BACKUP_TAG + "." + btoa(unescape(encodeURIComponent(JSON.stringify({ privateJwk: site.privateJwk, publicJwk: site.publicJwk, fingerprint: site.fingerprint }))));
  }
  async function importBackup(text) {
    const t = String(text || "").trim();
    if (!t.startsWith(BACKUP_TAG + ".")) throw new Error("bad-backup");
    let k; try { k = JSON.parse(decodeURIComponent(escape(atob(t.slice(BACKUP_TAG.length + 1))))); } catch (e) { throw new Error("bad-backup"); }
    if (!k || !k.privateJwk || !k.publicJwk || !k.fingerprint) throw new Error("bad-backup");
    if ((await Q.fingerprint(k.publicJwk)) !== k.fingerprint) throw new Error("bad-backup");
    if (k.privateJwk.x !== k.publicJwk.x || k.privateJwk.y !== k.publicJwk.y) throw new Error("bad-backup");
    const snap = await getDoc(doc(db, "siteConfig", "qr"));
    if (snap.exists() && snap.data().fingerprint && snap.data().fingerprint !== k.fingerprint) throw new Error("other-site-key");   // never replace the live key by import
    await idbSet("site", k); site = k;
    if (!snap.exists()) await publish(k);
    stop(); resetState(); listen(); note();
    return k.fingerprint;
  }
  async function forget() { await idbDel("site"); site = null; stop(); resetState(); note(); }

  // ---------------- verification ----------------
  // One decision, with the same engine the edge controller uses. mode: "entry" | "exit"; handheld = a person checks it, no gate loop required.
  async function verify(token, mode, meta) {
    if (!engine) throw new Error("no-key");
    if (cloudFp && site && cloudFp !== site.fingerprint) throw new Error("wrong-key");
    const ap = state.accessPoints[(meta && meta.apId) || ""] || { id: "handheld", name: (meta && meta.apName) || "Handheld", type: "gate", direction: "in", enabled: true };
    const hand = Object.assign({}, ap, { direction: mode === "exit" ? "out" : "in", loop: { required: false } });
    let d = await engine.evaluate(hand, String(token || ""));
    let claimed = false;
    if (d.allow && d.claim) {                       // finite-use pass: the cloud arbitrates (two devices can never spend the same use)
      let ok = false;
      try { ok = await claimUse(d.claim.passId, d.claim.maxUses); } catch (e) { console.error("claim failed", e); }
      if (!ok) { d.rollback(); d = Object.assign({}, d, { allow: false, reason: "pass-used" }); } else claimed = true;
    }
    if (d.allow) d.commit(); else d.rollback();
    const evt = engine.makeEvent(d, hand, { offline: !navigator.onLine, controllerId: deviceId, claimed });
    evt.handheld = true;
    if (d.allow) stats.allowed++; else stats.denied++;
    if (!d.duplicate) await record(evt, d);
    note();
    return { allow: d.allow, reason: d.reason, subjectType: evt.subjectType, name: evt.name, unit: evt.unit, hostName: evt.hostName, hostPhone: evt.hostPhone, kind: d.kind, duplicate: !!d.duplicate, answeredMs: Date.now() };
  }
  async function claimUse(passId, maxUses) {
    const ref = doc(db, "accessPasses", passId);
    return runTransaction(db, async (tx) => {
      const s = await tx.get(ref); if (!s.exists()) return false;
      if (maxUses != null && (s.data().uses || 0) >= maxUses) return false;
      tx.update(ref, { uses: increment(1), inside: true, lastUsedAt: serverTimestamp() });
      return true;
    });
  }
  async function record(e, d) {
    const { passUse, claimed, ...rest } = e;
    const b = writeBatch(db);
    b.set(doc(db, "accessEvents", e.id), Object.assign({}, rest, { ts: Timestamp.fromMillis(e.ts), receivedAt: serverTimestamp() }));
    if (e.result === "allowed") {
      b.set(doc(db, "accessLogs", e.id), { type: e.direction, personType: e.subjectType, personName: e.name || "—", invitationId: e.passId || e.credId || null, apId: e.apId, apName: e.apName, apType: e.apType, unit: e.unit || null, zones: [e.apType], timestamp: Timestamp.fromMillis(e.ts), source: "cloud-controller" });
      if (e.passId) {
        if (e.direction === "exit") b.set(doc(db, "accessPasses", e.passId), { inside: false, lastUsedAt: Timestamp.fromMillis(e.ts) }, { merge: true });
        else if (passUse && !claimed) b.set(doc(db, "accessPasses", e.passId), { uses: increment(1), inside: true, lastUsedAt: Timestamp.fromMillis(e.ts) }, { merge: true });
      }
    }
    try { await b.commit(); }
    catch (err) {                       // the decision stays valid; keep the failure visible instead of losing the event silently
      console.error("event write failed", err); lastError = "events: " + (err.code || err.message);
    }
  }
  async function answer(id, data) {
    // two admin pages may be open: the first to flip the request to "working" answers, the other one ignores it
    const ref = doc(db, "scanRequests", id);
    const won = await runTransaction(db, async (tx) => {
      const s = await tx.get(ref); if (!s.exists() || s.data().status !== "pending") return false;
      tx.update(ref, { status: "working", by: deviceId }); return true;
    });
    if (!won) return;
    let result;
    try { result = await verify(data.token, data.mode, data); }
    catch (e) { result = { allow: false, reason: e.message === "wrong-key" ? "wrong-site-key" : "controller-error", answeredMs: Date.now() }; }
    await updateDoc(ref, { status: "done", result, token: deleteField(), answeredAt: serverTimestamp() });
  }
  async function beat() {
    await setDoc(doc(db, "controllers", deviceId), {
      id: deviceId, version: VERSION, kind: "browser", queued: 0, syncedAtMs: state.syncedAt || null, siteFp: site && site.fingerprint || null,
      counts: { credentials: Object.keys(state.credentials).length, passes: Object.keys(state.passes).length, accessPoints: Object.keys(state.accessPoints).length, users: Object.keys(state.users).length },
      stats, lastSeen: serverTimestamp(),
    }, { merge: true });
  }
  function status() {
    return {
      hasKey: !!site, fingerprint: site ? site.fingerprint : null, cloudFingerprint: cloudFp, running: started,
      mismatch: !!(site && cloudFp && cloudFp !== site.fingerprint), noKeyOnThisDevice: !site && !!cloudFp,
      credentials: Object.keys(state.credentials).length, passes: Object.keys(state.passes).length, error: lastError, stats,
    };
  }
  const api = { load, createKey, exportBackup, importBackup, forget, verify, status, get ready() { return !!engine; } };
  window.SOCloudController = api;
  load().catch((e) => { console.error("cloud-controller load", e); lastError = String(e.message || e); note(); });
  return api;
}
