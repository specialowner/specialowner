// Live emergency banner for the admin and the site manager.
// Listens to open SOS alerts raised by security staff, shows a red bar at the top of the
// screen with the worker's name, time and a map link, beeps when a new one arrives, and lets
// the admin / manager close it. No push notifications (those need Firebase Blaze), so the
// banner only works while the panel is open.
import { db } from "./firebase-config.js";
import {
  collection, doc, updateDoc, query, where, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

function t(key) {
  const lang = window.SO_I18N ? window.SO_I18N.getLang() : "en";
  return window.SO_I18N ? window.SO_I18N.translations[lang][key] : key;
}
function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    [0, 0.35, 0.7].forEach((delay) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "square"; o.frequency.value = 880;
      g.gain.value = 0.15;
      o.connect(g); g.connect(ctx.destination);
      o.start(ctx.currentTime + delay); o.stop(ctx.currentTime + delay + 0.2);
    });
  } catch (e) { /* browsers may block audio before the first tap — the banner still shows */ }
}

export function mountSosBanner(user) {
  const bar = document.createElement("div");
  bar.id = "sosBanner";
  bar.style.cssText = "display:none;position:fixed;top:0;left:0;right:0;z-index:1500;background:#b3261e;color:#fff;padding:10px 12px;font-size:13px;box-shadow:0 2px 10px rgba(0,0,0,.35);max-height:40vh;overflow:auto";
  document.body.appendChild(bar);

  let rows = [];
  const seen = new Set();
  let firstLoad = true;

  function render() {
    if (rows.length === 0) { bar.style.display = "none"; bar.innerHTML = ""; return; }
    const locale = window.SO_I18N && window.SO_I18N.getLang() === "ar" ? "ar-EG" : "en-GB";
    bar.style.display = "block";
    bar.innerHTML = rows.map(a => {
      const when = a.createdAt?.seconds
        ? new Date(a.createdAt.seconds * 1000).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
      const map = (a.lat != null && a.lng != null)
        ? ` · <a href="https://www.google.com/maps?q=${a.lat},${a.lng}" target="_blank" rel="noopener" style="color:#fff;text-decoration:underline">${t("sosMap")}</a>` : "";
      return `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:4px 0">
        <div>🚨 <b>${t("sosAlertTitle")}</b> — ${esc(a.workerName || "—")} · ${esc(when)}${map}</div>
        <button type="button" class="sos-close" data-id="${a.id}" style="background:#fff;color:#b3261e;border:none;border-radius:8px;padding:6px 10px;font-weight:700;cursor:pointer;white-space:nowrap">${t("sosClose")}</button>
      </div>`;
    }).join("");
    bar.querySelectorAll(".sos-close").forEach(btn => btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await updateDoc(doc(db, "sosAlerts", btn.dataset.id), {
          status: "handled", handledBy: user.uid, handledAt: serverTimestamp()
        });
      } catch (err) {
        console.error("Failed to close SOS alert:", err);
        btn.disabled = false;
        alert(err.code === "permission-denied"
          ? "Permission denied — ask the admin to publish the latest Firestore rules."
          : (err.message || String(err)));
      }
    }));
  }

  onSnapshot(query(collection(db, "sosAlerts"), where("status", "==", "open")), (snap) => {
    rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    // Beep only for alerts that arrive while the panel is open, not for ones already waiting at load.
    const fresh = rows.filter(a => !seen.has(a.id));
    rows.forEach(a => seen.add(a.id));
    if (!firstLoad && fresh.length) beep();
    firstLoad = false;
    render();
  }, (err) => console.error("SOS listener failed:", err));
  window.addEventListener("so-lang-changed", render);
}
