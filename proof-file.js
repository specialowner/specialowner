// Helpers for payment-receipt files. Receipts are stored inside the Firestore
// "paymentProofs" document (as a data URL) so no Firebase Storage bucket / Blaze plan is needed.
// Firestore documents are capped at 1 MiB, so images are downscaled + re-encoded as JPEG first.

const MAX_DATA_CHARS = 800000;        // ~800 KB, safely below the 1 MiB document limit
const MAX_PDF_BYTES = 550 * 1024;     // base64 adds ~33%

function readAsDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error("Could not read file"));
    r.readAsDataURL(blob);
  });
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not open image")); };
    img.src = url;
  });
}

// Returns { dataUrl, fileName }. Throws Error with .code = "pdf_too_large" | "too_large" | "bad_image".
export async function prepareProofFile(file) {
  if (file.type === "application/pdf") {
    if (file.size > MAX_PDF_BYTES) { const e = new Error("PDF too large"); e.code = "pdf_too_large"; throw e; }
    return { dataUrl: await readAsDataURL(file), fileName: file.name };
  }
  let img;
  try { img = await loadImage(file); }
  catch { const e = new Error("Unsupported image"); e.code = "bad_image"; throw e; }

  let maxSide = 1400, quality = 0.75;
  for (let attempt = 0; attempt < 6; attempt++) {
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";                      // flatten transparency (PNG screenshots)
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    if (dataUrl.length <= MAX_DATA_CHARS) {
      return { dataUrl, fileName: file.name.replace(/\.[^.]+$/, "") + ".jpg" };
    }
    maxSide = Math.round(maxSide * 0.75);
    quality = Math.max(0.5, quality - 0.08);
  }
  const e = new Error("Image too large"); e.code = "too_large"; throw e;
}

// Browsers block navigating to data: URLs, so convert to a blob: URL and open that.
export function openDataUrl(dataUrl) {
  const [head, b64] = dataUrl.split(",");
  const mime = (head.match(/data:([^;]+)/) || [])[1] || "application/octet-stream";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
