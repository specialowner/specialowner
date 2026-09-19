// Helpers for photos / videos attached to announcements.
// Unlike payment receipts (stored inline in Firestore), videos are far too big for a 1 MiB
// Firestore document, so announcement media goes to Firebase Storage and the announcement
// document only keeps the download URL (mediaUrl) + type (mediaType) + storage path (mediaPath).

// Side-effect import only: makes sure the Firebase app is initialised, without depending on
// firebase-config.js exporting anything specific (older copies of it don't export `storage`).
import "./firebase-config.js";
import { getApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getStorage, ref, uploadBytesResumable, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";

const getStore = () => getStorage(getApp());

export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;   // keep in sync with storage.rules
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;   // size of the *compressed* image (storage.rules)

const VIDEO_EXT = /\.(mp4|mov|m4v|webm|3gp|3gpp|mkv)$/i;
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|heic|heif)$/i;

function makeError(code, msg) { const e = new Error(msg || code); e.code = code; return e; }

function detectKind(file) {
  const type = (file.type || "").toLowerCase();
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("image/")) return "image";
  // Some Android devices hand over camera files with an empty MIME type.
  if (VIDEO_EXT.test(file.name || "")) return "video";
  if (IMAGE_EXT.test(file.name || "")) return "image";
  return null;
}

function videoExt(file) {
  const m = (file.name || "").match(VIDEO_EXT);
  if (m) return m[1].toLowerCase();
  const type = (file.type || "").toLowerCase();
  if (type.includes("quicktime")) return "mov";
  if (type.includes("webm")) return "webm";
  if (type.includes("3gpp")) return "3gp";
  return "mp4";
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(makeError("bad_type", "Could not open image")); };
    img.src = url;
  });
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(makeError("bad_type", "Could not encode image")), "image/jpeg", quality);
  });
}

// Returns { blob, kind, contentType, ext }.
// Throws Error with .code = "bad_type" | "too_large".
// Images are downscaled (max 1600px) and re-encoded as JPEG so residents on mobile data
// don't download 8 MB camera photos. Videos are uploaded as-is (size-checked only).
export async function prepareAnnouncementMedia(file) {
  const kind = detectKind(file);
  if (!kind) throw makeError("bad_type");

  if (kind === "video") {
    if (file.size > MAX_VIDEO_BYTES) throw makeError("too_large");
    return { blob: file, kind, contentType: (file.type || "video/mp4").split(";")[0], ext: videoExt(file) };
  }

  const img = await loadImage(file);
  let maxSide = 1600, quality = 0.82;
  for (let attempt = 0; attempt < 5; attempt++) {
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";                       // flatten transparency (PNG)
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await canvasToBlob(canvas, quality);
    if (blob.size <= MAX_IMAGE_BYTES) {
      return { blob, kind, contentType: "image/jpeg", ext: "jpg" };
    }
    maxSide = Math.round(maxSide * 0.75);
    quality = Math.max(0.5, quality - 0.08);
  }
  throw makeError("too_large");
}

// Starts the upload. Returns { promise, cancel }.
// promise resolves to { url, path } only once the file is completely uploaded.
export function uploadAnnouncementMedia(prepared, uid, onProgress) {
  const name = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${prepared.ext}`;
  const path = `announcements/${uid}/${name}`;
  const task = uploadBytesResumable(ref(getStore(), path), prepared.blob, { contentType: prepared.contentType });
  const promise = new Promise((resolve, reject) => {
    task.on(
      "state_changed",
      (s) => { if (onProgress && s.totalBytes) onProgress(s.bytesTransferred / s.totalBytes); },
      (err) => reject(err),
      async () => {
        try { resolve({ url: await getDownloadURL(task.snapshot.ref), path }); }
        catch (e) { reject(e); }
      }
    );
  });
  return { promise, cancel: () => task.cancel() };
}

// Best-effort cleanup (e.g. the file uploaded but saving the announcement failed).
export async function removeUploadedMedia(path) {
  try { await deleteObject(ref(getStore(), path)); } catch { /* ignore */ }
}

function escAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// HTML for the media attached to an announcement (used by resident + worker screens).
export function announcementMediaHtml(a) {
  if (!a || !a.mediaUrl || !/^https:\/\//.test(a.mediaUrl)) return "";
  const url = escAttr(a.mediaUrl);
  if (a.mediaType === "video") {
    return `<video class="ann-media" src="${url}" controls playsinline preload="metadata"></video>`;
  }
  return `<a href="${url}" target="_blank" rel="noopener"><img class="ann-media" src="${url}" alt="" loading="lazy"></a>`;
}
