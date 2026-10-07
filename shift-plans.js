// "My upcoming shifts": the shifts the admin planned for this worker / site manager.
// Used by both the worker and the site manager home screens.
import { db } from "./firebase-config.js";
import { collection, query, where, onSnapshot } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

function t(key) {
  const lang = window.SO_I18N ? window.SO_I18N.getLang() : "en";
  return window.SO_I18N ? window.SO_I18N.translations[lang][key] : key;
}
function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function mountMyShiftPlans(uid, elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  let rows = [];
  function render() {
    const today = new Date().toISOString().slice(0, 10);
    const lang = window.SO_I18N && window.SO_I18N.getLang() === "ar" ? "ar-EG" : "en-GB";
    const upcoming = rows.filter(p => p.date >= today)
      .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)).slice(0, 14);
    if (upcoming.length === 0) { el.innerHTML = `<p class="empty-state">${t("planNone")}</p>`; return; }
    el.innerHTML = upcoming.map(p => {
      const day = new Date(p.date + "T00:00:00").toLocaleDateString(lang, { weekday: "long", day: "numeric", month: "short" });
      return `<div class="sub-row"><span>${esc(day)}${p.date === today ? " · <b>" + t("planToday") + "</b>" : ""}${p.note ? " · " + esc(p.note) : ""}</span><span>${esc(p.start)} – ${esc(p.end)}</span></div>`;
    }).join("");
  }
  onSnapshot(query(collection(db, "shiftPlans"), where("workerId", "==", uid)), (snap) => {
    rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  }, (err) => console.error("shiftPlans listener failed:", err));
  window.addEventListener("so-lang-changed", render);
}
