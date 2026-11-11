// Special Owner — resident QR wallet (browser).
// • The secret of this phone lives only as a NON-EXTRACTABLE WebCrypto key in IndexedDB: even script injected
//   into the page can ask it to sign, but can never read the secret out.
// • At activation the secret is sealed to the site's public key (ECDH + AES-256-GCM) before it is written to
//   Firestore, so nobody reading the database can generate codes.
// • The code is computed on the phone, so it keeps working with no internet at all.
import {
  doc, getDoc, setDoc, updateDoc, serverTimestamp, collection, query, where, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const Q = window.SOQR;
const DB_NAME = "so-qr", STORE = "cred";

function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "uid" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbDo(mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode), st = tx.objectStore(STORE), req = fn(st);
    tx.oncomplete = () => { db.close(); resolve(req && req.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
export const loadLocal = (uid) => idbDo("readonly", (s) => s.get(uid)).then((r) => r || null);
const saveLocal = (rec) => idbDo("readwrite", (s) => s.put(rec));
export const removeLocal = (uid) => idbDo("readwrite", (s) => s.delete(uid));

export function deviceLabel() {
  const ua = navigator.userAgent || "";
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad|iPod/i.test(ua) ? "iOS" : /Windows/i.test(ua) ? "Windows" : /Mac/i.test(ua) ? "macOS" : /Linux/i.test(ua) ? "Linux" : "Device";
  const br = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${os} · ${br}`;
}

export async function getSiteConfig(db) {
  const s = await getDoc(doc(db, "siteConfig", "qr"));
  const d = s.exists() ? s.data() : null;
  return d && d.publicJwk && d.fingerprint ? d : null;
}

// Creates this phone's credential. Throws Error("no-site-key") when management has not enabled QR access yet.
export async function activate(db, uid, label) {
  const site = await getSiteConfig(db);
  if (!site) throw new Error("no-site-key");
  const S = Q.randomBytes(32), credId = Q.randomBytes(6), id = Q.b64u(credId);
  const sealed = await Q.sealSecret(site.publicJwk, S, Q.sealContext(id, uid));
  const key = await crypto.subtle.importKey("raw", S, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  S.fill(0);                                                   // the raw secret is gone from memory from here on
  await saveLocal({ uid, id, credId, key, siteFp: site.fingerprint, label, createdAt: Date.now() });
  try {
    await setDoc(doc(db, "qrCredentials", id), { uid, label, status: "active", sealed, keyFp: site.fingerprint, createdAt: serverTimestamp() });
  } catch (e) { await removeLocal(uid); throw e; }
  return loadLocal(uid);
}

export async function deactivate(db, uid, cred) {
  if (cred) { try { await updateDoc(doc(db, "qrCredentials", cred.id), { status: "revoked", revokedAt: serverTimestamp(), revokedBy: uid }); } catch (e) { console.error(e); } }
  await removeLocal(uid);
}

export async function revokeRemote(db, uid, credId) {
  await updateDoc(doc(db, "qrCredentials", credId), { status: "revoked", revokedAt: serverTimestamp(), revokedBy: uid });
}

// Live list of this resident's credentials (all devices).
export function watchCredentials(db, uid, cb) {
  return onSnapshot(query(collection(db, "qrCredentials"), where("uid", "==", uid)),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), (e) => console.error("credentials listener:", e));
}

// offset: 0 = current code, 1 = the next one (valid as soon as the controller's clock is within its ±1 step window)
export async function currentToken(cred, nowMs, offsetSteps) {
  const kh = await Q.keyHandle(cred.key);
  return Q.makeDynamicToken(kh, cred.credId, nowMs + (offsetSteps || 0) * Q.STEP_SECONDS * 1000);
}

// ---- clock: the phone's clock may be wrong; the server's HTTP Date header is a good reference ----
const SKEW_KEY = "so_qr_skew";
export async function measureSkew() {
  try {
    const t0 = Date.now();
    const r = await fetch(location.pathname, { method: "HEAD", cache: "no-store" });
    const t1 = Date.now(), h = r.headers.get("date");
    if (h) {
      const server = new Date(h).getTime();                    // 1 s resolution → good enough for a 30 s step
      const skew = server - (t0 + (t1 - t0) / 2);
      localStorage.setItem(SKEW_KEY, String(Math.round(skew)));
      return Math.round(skew);
    }
  } catch (e) { /* offline: keep last known skew */ }
  return storedSkew();
}
export function storedSkew() { try { return Number(localStorage.getItem(SKEW_KEY)) || 0; } catch (e) { return 0; } }
