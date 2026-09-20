import { db } from "./firebase-config.js";
import { requireAuth, logout } from "./guard.js";
import { openDataUrl } from "./proof-file.js";
import { createStaffAccount, friendlyStaffCreateError } from "./create-staff-account.js";
import {
  collection, addDoc, doc, getDoc, getDocs, updateDoc, setDoc, query, where, orderBy,
  onSnapshot, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const { user, profile } = await requireAuth("admin");
document.getElementById("logoutBtn").addEventListener("click", logout);

function t(key) {
  const lang = window.SO_I18N ? window.SO_I18N.getLang() : "en";
  return window.SO_I18N ? window.SO_I18N.translations[lang][key] : key;
}

// workerType values stored in Firestore (security | maintenance | cleaning | porter | garden)
// don't match the i18n keys (security | maintenanceStaff | cleaningStaff | porterStaff | gardenStaff).
// This maps a raw workerType to its translated label in the current language.
const WORKER_TYPE_I18N_KEY = {
  security: "security",
  maintenance: "maintenanceStaff",
  cleaning: "cleaningStaff",
  porter: "porterStaff",
  garden: "gardenStaff"
};
function workerTypeLabel(wt) {
  if (!wt) return "";
  return t(WORKER_TYPE_I18N_KEY[wt] || wt) || wt;
}

// ---------- Live state for the Property and Areas tabs ----------
// Declared up here on purpose. Module evaluation pauses further down at
// `await import("./announcement-media.js")`, and the Firestore listeners
// registered above that point can fire during the pause — if these lived next
// to the code that uses them (at the bottom of the file), a snapshot arriving
// in that window would hit them before they were initialised and throw.
let propBuildings = [];
let propUnits = [];
let propOpenBuildingId = null;   // which building's apartments are open
let propEditUnitId = null;       // which apartment row is expanded for editing
let areaDocs = [];
let areaExtraOpenId = null;      // which area has its "extraordinary job" panel open
let areaEditId = null;           // which area row is expanded

// ---------- Dashboards (Residents / Operations) & tabs ----------
// The admin panel is split into two dashboards: "res" (residents, finance, announcements)
// and "ops" (access, personnel, maintenance). Each tab-btn/section carries a data-dashboard
// attribute; switching dashboards just filters which tab buttons are visible and jumps to
// a tab inside that dashboard (remembering the last one visited per dashboard).
const ALL_TABS = ["residents", "property", "announcements", "access", "workers", "finance", "maint", "areas"];
const DASHBOARD_TABS = {
  res: ["residents", "property", "finance", "announcements"],
  ops: ["access", "workers", "maint", "areas"]
};
const DASH_STORAGE_KEY = "so_admin_dashboard";
const tabStorageKey = (dash) => `so_admin_tab_${dash}`;

const tabs = document.querySelectorAll(".tab-btn");
const dashButtons = document.querySelectorAll(".dash-switch [data-dash]");

function showTab(tabName) {
  tabs.forEach(b => b.classList.toggle("active", b.dataset.tab === tabName));
  ALL_TABS.forEach(t => {
    document.getElementById(`tab-${t}`).style.display = (t === tabName) ? "block" : "none";
  });
  if (tabName === "access") startScanner();
}

function activateDashboard(dash) {
  if (!DASHBOARD_TABS[dash]) dash = "res";
  dashButtons.forEach(b => b.classList.toggle("active", b.dataset.dash === dash));
  tabs.forEach(b => {
    b.style.display = DASHBOARD_TABS[dash].includes(b.dataset.tab) ? "" : "none";
  });
  localStorage.setItem(DASH_STORAGE_KEY, dash);
  const remembered = localStorage.getItem(tabStorageKey(dash));
  const targetTab = DASHBOARD_TABS[dash].includes(remembered) ? remembered : DASHBOARD_TABS[dash][0];
  showTab(targetTab);
}

dashButtons.forEach(btn => btn.addEventListener("click", () => activateDashboard(btn.dataset.dash)));

tabs.forEach(btn => btn.addEventListener("click", () => {
  showTab(btn.dataset.tab);
  if (btn.dataset.dashboard) localStorage.setItem(tabStorageKey(btn.dataset.dashboard), btn.dataset.tab);
}));

// Restore whichever dashboard the admin was last on (defaults to "res", matching the
// panel's previous single-dashboard behavior for anyone who hasn't used the switch yet).
activateDashboard(localStorage.getItem(DASH_STORAGE_KEY) || "res");

// ---------- Stats (shown at the top of the Residents tab) ----------
onSnapshot(query(collection(db, "users"), where("role", "==", "resident")), (snap) => {
  document.getElementById("statResidents").textContent = snap.size;
});
onSnapshot(query(collection(db, "workers"), where("status", "==", "active")), (snap) => {
  document.getElementById("statWorkers").textContent = snap.size;
});
onSnapshot(query(collection(db, "maintenanceRequests"), where("status", "==", "pending")), (snap) => {
  document.getElementById("statPending").textContent = snap.size;
});
onSnapshot(query(collection(db, "payments"), where("status", "==", "overdue")), (snap) => {
  document.getElementById("statOverdue").textContent = snap.size;
});

// ---------- Residents & activation requests ----------
onSnapshot(query(collection(db, "users"), where("role", "==", "resident")), (snap) => {
  const el = document.getElementById("residentsList");
  residentsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  backfillResidentNames();
  renderUnitsList(); // the apartment rows carry a "link a resident account" dropdown
  if (document.getElementById("annAudience").value === "residents") renderAnnTargetList();
  if (snap.empty) { el.innerHTML = `<p class="empty-state">${t("noResidentsYet")}</p>`; return; }
  el.innerHTML = "";
  const rows = residentsCache.slice();
  // Show pending activation requests first, then the rest
  rows.sort((a, b) => {
    const aPending = a.activationRequestStatus === "pending" ? 0 : 1;
    const bPending = b.activationRequestStatus === "pending" ? 0 : 1;
    return aPending - bPending;
  });
  rows.forEach(r => {
    const status = r.accountStatus || "active";
    const hasRequest = r.activationRequestStatus === "pending";
    el.innerHTML += `
      <div class="list-item">
        <div class="meta">
          <div class="title">${r.name || r.email} ${hasRequest ? "🔔" : ""}</div>
          <div class="sub">${t("unitLabel")} ${r.unit || "—"} · ${r.email || ""}</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <span class="badge ${status === "active" ? "active" : status === "suspended" ? "overdue" : "pending"}">${status}</span>
          ${status === "active"
            ? `<button class="btn btn-sm btn-danger" data-action="suspend" data-id="${r.id}">${t("suspend")}</button>`
            : `<button class="btn btn-sm btn-primary" data-action="approve" data-id="${r.id}">${t("approve")}</button>`
          }
        </div>
      </div>`;
  });
  el.querySelectorAll("button[data-action]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const uid = btn.dataset.id;
      const action = btn.dataset.action;
      await updateDoc(doc(db, "users", uid), {
        accountStatus: action === "approve" ? "active" : "suspended",
        activationRequestStatus: "none"
      });
    });
  });
});

// ---------- Announcements ----------
let residentsCache = [];
let workersCache = [];
let managersCache = [];

function renderAnnTargetList() {
  const audience = document.getElementById("annAudience").value;
  const field = document.getElementById("annTargetField");
  const list = document.getElementById("annTargetList");
  if (audience === "all") { field.style.display = "none"; return; }
  field.style.display = "block";

  if (audience === "residents") {
    if (residentsCache.length === 0) {
      list.innerHTML = `<p class="empty-state">${t("noResidentsYet")}</p>`;
      return;
    }
    list.innerHTML = residentsCache.map(r => `
      <label style="display:flex;align-items:center;gap:6px;padding:4px 0;font-size:12px">
        <input type="checkbox" class="annTargetCheck" value="${r.id}" checked>
        <span>${r.name || r.email || r.id} · ${t("unitLabel")} ${r.unit || "—"}</span>
      </label>`).join("");
  } else if (audience === "workers") {
    if (workersCache.length === 0) {
      list.innerHTML = `<p class="empty-state">${t("noStaffYet")}</p>`;
      return;
    }
    // Quick filter chips per worker craft/type (e.g. select all electricians / security).
    const types = [...new Set(workersCache.map(w => w.workerType).filter(Boolean))];
    const chips = types.map(wt => `<button type="button" class="btn btn-sm btn-outline ann-craft-chip" data-craft="${wt}" style="margin:0 4px 8px 0">${workerTypeLabel(wt)}</button>`).join("");
    list.innerHTML = (chips ? `<div style="margin-bottom:6px">${chips}</div>` : "") + workersCache.map(w => `
      <label style="display:flex;align-items:center;gap:6px;padding:4px 0;font-size:12px" data-craft="${w.workerType || ""}">
        <input type="checkbox" class="annTargetCheck" value="${w.id}" checked>
        <span>${w.name || w.email || w.id} · ${workerTypeLabel(w.workerType)}</span>
      </label>`).join("");
    list.querySelectorAll(".ann-craft-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        const craft = chip.dataset.craft;
        list.querySelectorAll(`label[data-craft="${craft}"] .annTargetCheck`).forEach(cb => cb.checked = true);
        list.querySelectorAll(".annTargetCheck").forEach(cb => {
          if (cb.closest("label").dataset.craft !== craft) cb.checked = false;
        });
        document.getElementById("annSelectAll").checked = false;
      });
    });
  }
}

document.getElementById("annAudience").addEventListener("change", renderAnnTargetList);
document.getElementById("annSelectAll").addEventListener("change", (e) => {
  document.querySelectorAll(".annTargetCheck").forEach(cb => cb.checked = e.target.checked);
});
// Keep "Select all" in sync when the admin manually checks/unchecks individual recipients
document.getElementById("annTargetList").addEventListener("change", (e) => {
  if (!e.target.classList.contains("annTargetCheck")) return;
  const all = document.querySelectorAll(".annTargetCheck");
  const checked = document.querySelectorAll(".annTargetCheck:checked");
  document.getElementById("annSelectAll").checked = all.length > 0 && all.length === checked.length;
});

// The media helper is loaded defensively: if announcement-media.js is missing on the server,
// the rest of the admin panel must keep working (only the photo/video feature is unavailable).
let mediaLib = null;
try { mediaLib = await import("./announcement-media.js"); }
catch (e) { console.error("announcement-media.js failed to load:", e); }
// Null-safe element lookup: an outdated admin.html without the media fields must not crash the page.
const el = (id) => document.getElementById(id) || document.createElement("div");

// ----- Announcement photo / video (camera or gallery) -----
let annFile = null;          // the File the admin picked or recorded
let annPreviewUrl = null;
let annUploading = false;
let annUploadTask = null;

const annPreview = el("annMediaPreview");
const annPreviewBox = el("annMediaPreviewBox");
const annMediaInputs = ["annPhotoCapture", "annVideoCapture", "annGalleryInput"].map(id => el(id));

function annClearMedia() {
  annFile = null;
  if (annPreviewUrl) { URL.revokeObjectURL(annPreviewUrl); annPreviewUrl = null; }
  annPreviewBox.innerHTML = "";
  annPreview.style.display = "none";
  annMediaInputs.forEach(inp => { inp.value = ""; });
}

function annSetMedia(file) {
  if (!file) return;
  const isVideo = (file.type || "").startsWith("video/") || /\.(mp4|mov|m4v|webm|3gp|3gpp|mkv)$/i.test(file.name || "");
  if (annPreviewUrl) URL.revokeObjectURL(annPreviewUrl);
  annFile = file;
  annPreviewUrl = URL.createObjectURL(file);
  annPreviewBox.innerHTML = isVideo
    ? `<video class="ann-media" src="${annPreviewUrl}" controls playsinline preload="metadata"></video>`
    : `<img class="ann-media" src="${annPreviewUrl}" alt="">`;
  annPreview.style.display = "block";
}

// Take photo / Record video open the phone's native camera app (<input capture>), so they are
// shown on phones/tablets only. On laptops/desktops only "Upload from device" is offered.
const annIsPhone = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
if (!annIsPhone) {
  el("annCamPhotoBtn").style.display = "none";
  el("annCamVideoBtn").style.display = "none";
}
el("annCamPhotoBtn").addEventListener("click", () => el("annPhotoCapture").click());
el("annCamVideoBtn").addEventListener("click", () => el("annVideoCapture").click());
el("annGalleryBtn").addEventListener("click", () => el("annGalleryInput").click());
annMediaInputs.forEach(inp => inp.addEventListener("change", () => {
  const f = inp.files && inp.files[0];
  annMediaInputs.forEach(o => { if (o !== inp) o.value = ""; });
  if (f) annSetMedia(f);
}));
el("annMediaRemoveBtn").addEventListener("click", () => { if (!annUploading) annClearMedia(); });

function annSetBusy(busy) {
  annUploading = busy;
  ["postAnnBtn", "annCamPhotoBtn", "annCamVideoBtn", "annGalleryBtn", "annMediaRemoveBtn"]
    .forEach(id => { el(id).disabled = busy; });
}
function annShowProgress(text, fraction) {
  el("annUploadProgress").style.display = "block";
  el("annUploadText").textContent = text;
  el("annUploadBar").style.width = Math.round((fraction || 0) * 100) + "%";
}
function annHideProgress() {
  el("annUploadProgress").style.display = "none";
  el("annUploadBar").style.width = "0";
}
// Warn before closing the tab while a video is still uploading.
window.addEventListener("beforeunload", (e) => { if (annUploading) { e.preventDefault(); e.returnValue = ""; } });

el("postAnnBtn").addEventListener("click", async () => {
  if (annUploading) return;
  const title = el("annTitle").value.trim();
  const body = el("annBody").value.trim();
  const audience = el("annAudience").value; // all | residents | workers
  if (!title) { alert(t("enterTitleAlert") || "Please enter a title."); return; }

  const payload = { title, body, audience, createdBy: user.uid, createdAt: serverTimestamp() };

  if (audience !== "all") {
    const targetIds = [...document.querySelectorAll(".annTargetCheck:checked")].map(cb => cb.value);
    if (targetIds.length === 0) { alert(t("chooseAtLeastOne") || "Please choose at least one recipient."); return; }
    payload.targetIds = targetIds;
  }

  const postBtn = el("postAnnBtn");
  const originalLabel = postBtn.textContent;
  let uploadedPath = null;
  annSetBusy(true);

  try {
    // 1) If there is a photo/video, finish uploading it FIRST. The announcement is only
    //    published (and therefore only reaches residents) once the file is fully uploaded.
    if (annFile) {
      if (!mediaLib) throw new Error("media module not loaded");
      annShowProgress(t("annPreparing"), 0);
      const prepared = await mediaLib.prepareAnnouncementMedia(annFile);
      const { promise, cancel } = mediaLib.uploadAnnouncementMedia(prepared, user.uid, (frac) => {
        annShowProgress(`${t("annUploading")} ${Math.round(frac * 100)}%`, frac);
      });
      annUploadTask = { cancel };
      const { url, path } = await promise;
      uploadedPath = path;
      payload.mediaUrl = url;
      payload.mediaPath = path;
      payload.mediaType = prepared.kind; // "image" | "video"
    }

    // 2) Publish the announcement (text + media link) in one document.
    postBtn.textContent = "…";
    await addDoc(collection(db, "announcements"), payload);

    el("annTitle").value = "";
    el("annBody").value = "";
    annClearMedia();
    alert(t("announcementPublished") || "Announcement published.");
  } catch (err) {
    console.error("Publish announcement failed:", err);
    if (uploadedPath) mediaLib && mediaLib.removeUploadedMedia(uploadedPath); // don't leave an orphan file behind
    const code = err && (err.code || "");
    let msg;
    if (code === "too_large") msg = t("annMediaTooLarge");
    else if (code === "bad_type") msg = t("annMediaBadType");
    else if (code === "storage/canceled") msg = t("annUploadCanceled");
    else if (code === "storage/unauthorized") msg = t("annStorageDenied");
    else msg = (t("annUploadFailed") || "Upload failed.") + (err && err.message ? ` (${err.message})` : "");
    alert(msg);
  } finally {
    annUploadTask = null;
    annHideProgress();
    postBtn.textContent = originalLabel;
    annSetBusy(false);
  }
});

// ---------- Staff accounts & activation requests ----------
onSnapshot(query(collection(db, "users"), where("role", "==", "worker")), (snap) => {
  const el = document.getElementById("staffAccountsList");
  workersCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (document.getElementById("annAudience").value === "workers") renderAnnTargetList();
  if (snap.empty) { el.innerHTML = `<p class="empty-state">${t("noStaffYet")}</p>`; return; }
  el.innerHTML = "";
  const rows = workersCache.slice();
  rows.sort((a, b) => {
    const aPending = a.activationRequestStatus === "pending" ? 0 : 1;
    const bPending = b.activationRequestStatus === "pending" ? 0 : 1;
    return aPending - bPending;
  });
  rows.forEach(r => {
    const status = r.accountStatus || "active";
    const hasRequest = r.activationRequestStatus === "pending";
    el.innerHTML += `
      <div class="list-item">
        <div class="meta">
          <div class="title">${r.name || r.email} ${hasRequest ? "🔔" : ""}</div>
          <div class="sub">${workerTypeLabel(r.workerType)} · ${r.email || ""}</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <span class="badge ${status === "active" ? "active" : status === "suspended" ? "overdue" : "pending"}">${status}</span>
          ${status === "active"
            ? `<button class="btn btn-sm btn-danger" data-action="suspend" data-id="${r.id}">${t("suspend")}</button>`
            : `<button class="btn btn-sm btn-primary" data-action="approve" data-id="${r.id}">${t("approve")}</button>`
          }
        </div>
      </div>`;
  });
  el.querySelectorAll("button[data-action]").forEach(btn => {
    btn.addEventListener("click", async () => {
      await updateDoc(doc(db, "users", btn.dataset.id), {
        accountStatus: btn.dataset.action === "approve" ? "active" : "suspended",
        activationRequestStatus: "none"
      });
    });
  });
  renderSalaryManageList();
});

// ---------- Site manager accounts & activation requests ----------
onSnapshot(query(collection(db, "users"), where("role", "==", "manager")), (snap) => {
  const el = document.getElementById("managerAccountsList");
  managersCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderSalaryManageList();
  if (snap.empty) { el.innerHTML = `<p class="empty-state">${t("noManagersYet")}</p>`; return; }
  el.innerHTML = "";
  const rows = managersCache.slice();
  rows.sort((a, b) => {
    const aPending = a.activationRequestStatus === "pending" ? 0 : 1;
    const bPending = b.activationRequestStatus === "pending" ? 0 : 1;
    return aPending - bPending;
  });
  rows.forEach(r => {
    const status = r.accountStatus || "active";
    const hasRequest = r.activationRequestStatus === "pending";
    el.innerHTML += `
      <div class="list-item">
        <div class="meta">
          <div class="title">${r.name || r.email} ${hasRequest ? "🔔" : ""}</div>
          <div class="sub">${r.email || ""}</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <span class="badge ${status === "active" ? "active" : status === "suspended" ? "overdue" : "pending"}">${status}</span>
          ${status === "active"
            ? `<button class="btn btn-sm btn-danger" data-mgr-action="suspend" data-id="${r.id}">${t("suspend")}</button>`
            : `<button class="btn btn-sm btn-primary" data-mgr-action="approve" data-id="${r.id}">${t("approve")}</button>`
          }
        </div>
      </div>`;
  });
  el.querySelectorAll("button[data-mgr-action]").forEach(btn => {
    btn.addEventListener("click", async () => {
      await updateDoc(doc(db, "users", btn.dataset.id), {
        accountStatus: btn.dataset.mgrAction === "approve" ? "active" : "suspended",
        activationRequestStatus: "none"
      });
    });
  });
});

// ---------- Call center accounts ----------
onSnapshot(query(collection(db, "users"), where("role", "==", "callcenter")), (snap) => {
  const el = document.getElementById("callCenterAccountsList");
  if (snap.empty) { el.innerHTML = `<p class="empty-state">${t("noCallCenterYet")}</p>`; return; }
  el.innerHTML = "";
  snap.docs.forEach(d => {
    const r = { id: d.id, ...d.data() };
    const status = r.accountStatus || "active";
    el.innerHTML += `
      <div class="list-item">
        <div class="meta">
          <div class="title">${r.name || r.email}</div>
          <div class="sub">${r.email || ""}</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <span class="badge ${status === "active" ? "active" : "overdue"}">${status}</span>
          <button class="btn btn-sm ${status === "active" ? "btn-danger" : "btn-primary"}" data-cc-action="${status === "active" ? "suspend" : "approve"}" data-id="${r.id}">
            ${status === "active" ? t("suspend") : t("approve")}
          </button>
        </div>
      </div>`;
  });
  el.querySelectorAll("button[data-cc-action]").forEach(btn => {
    btn.addEventListener("click", async () => {
      await updateDoc(doc(db, "users", btn.dataset.id), {
        accountStatus: btn.dataset.ccAction === "approve" ? "active" : "suspended"
      });
    });
  });
});

// ---------- Salary breakdown & leave balance management ----------
function renderSalaryManageList() {
  const el = document.getElementById("salaryManageList");
  if (!el) return;
  // Site managers are on the payroll too — same breakdown fields, so they share this list with workers.
  const payrollCache = [...workersCache, ...managersCache];
  if (payrollCache.length === 0) { el.innerHTML = `<p class="empty-state">${t("noWorkers")}</p>`; return; }
  const monthNow = new Date().toISOString().slice(0, 7); // YYYY-MM
  el.innerHTML = payrollCache.map(w => `
    <div class="list-item" style="flex-direction:column;align-items:stretch;gap:8px">
      <div class="meta">
        <div class="title">${w.name || w.email}</div>
        <div class="sub">${w.workerType ? workerTypeLabel(w.workerType) : t("siteManager")}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
        <div><label style="font-size:11px;color:var(--muted)" data-i18n="salaryBasic">Basic</label>
          <input type="number" class="wm-basic" data-id="${w.id}" value="${w.salaryBasic || 0}" style="width:100%;border-radius:8px;border:1px solid #dfe6e3;padding:5px;font-size:12px"></div>
        <div><label style="font-size:11px;color:var(--muted)" data-i18n="salaryAllowances">Allowances</label>
          <input type="number" class="wm-allowances" data-id="${w.id}" value="${w.salaryAllowances || 0}" style="width:100%;border-radius:8px;border:1px solid #dfe6e3;padding:5px;font-size:12px"></div>
        <div><label style="font-size:11px;color:var(--muted)" data-i18n="salaryIncentives">Incentives</label>
          <input type="number" class="wm-incentives" data-id="${w.id}" value="${w.salaryIncentives || 0}" style="width:100%;border-radius:8px;border:1px solid #dfe6e3;padding:5px;font-size:12px"></div>
        <div><label style="font-size:11px;color:var(--muted)" data-i18n="salaryDeductions">Deductions</label>
          <input type="number" class="wm-deductions" data-id="${w.id}" value="${w.salaryDeductions || 0}" style="width:100%;border-radius:8px;border:1px solid #dfe6e3;padding:5px;font-size:12px"></div>
        <div><label style="font-size:11px;color:var(--muted)" data-i18n="leaveBalance">Leave balance</label>
          <input type="number" class="wm-leave" data-id="${w.id}" value="${w.leaveBalance ?? 0}" style="width:100%;border-radius:8px;border:1px solid #dfe6e3;padding:5px;font-size:12px"></div>
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-sm btn-outline" data-save-worker="${w.id}">${t("save")}</button>
        <button class="btn btn-sm btn-primary" data-archive-worker="${w.id}">${t("archiveMonth") || "Archive this month"}</button>
      </div>
    </div>`).join("");

  el.querySelectorAll("button[data-save-worker]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.saveWorker;
      await updateDoc(doc(db, "users", id), {
        salaryBasic: Number(el.querySelector(`.wm-basic[data-id="${id}"]`).value) || 0,
        salaryAllowances: Number(el.querySelector(`.wm-allowances[data-id="${id}"]`).value) || 0,
        salaryIncentives: Number(el.querySelector(`.wm-incentives[data-id="${id}"]`).value) || 0,
        salaryDeductions: Number(el.querySelector(`.wm-deductions[data-id="${id}"]`).value) || 0,
        leaveBalance: Number(el.querySelector(`.wm-leave[data-id="${id}"]`).value) || 0
      });
      alert(t("saved") || "Saved.");
    });
  });

  el.querySelectorAll("button[data-archive-worker]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.archiveWorker;
      const worker = [...workersCache, ...managersCache].find(w => w.id === id) || {};
      const basic = Number(el.querySelector(`.wm-basic[data-id="${id}"]`).value) || 0;
      const allowances = Number(el.querySelector(`.wm-allowances[data-id="${id}"]`).value) || 0;
      const incentives = Number(el.querySelector(`.wm-incentives[data-id="${id}"]`).value) || 0;
      const deductions = Number(el.querySelector(`.wm-deductions[data-id="${id}"]`).value) || 0;
      const net = basic + allowances + incentives - deductions;
      // One record per worker per calendar month — re-archiving the same month overwrites it.
      await setDoc(doc(db, "salaryRecords", `${id}_${monthNow}`), {
        workerId: id,
        workerName: worker.name || "",
        month: monthNow,
        basic, allowances, incentives, deductions, net,
        createdAt: serverTimestamp()
      });
      await updateDoc(doc(db, "users", id), {
        salaryBasic: basic, salaryAllowances: allowances, salaryIncentives: incentives, salaryDeductions: deductions
      });
      alert(t("monthArchived") || "Month archived to salary history.");
    });
  });
}

// ---------- Advance requests review ----------
onSnapshot(query(collection(db, "advanceRequests"), orderBy("createdAt", "desc")), (snap) => {
  const el = document.getElementById("advanceRequestsList");
  if (snap.empty) { el.innerHTML = `<p class="empty-state">${t("noAdvanceRequests")}</p>`; return; }
  el.innerHTML = "";
  snap.forEach(d => {
    const r = d.data();
    el.innerHTML += `
      <div class="list-item">
        <div class="meta">
          <div class="title">${r.workerName || ""} · EGP ${r.amount}</div>
          <div class="sub">${r.months} ${t("monthsShort") || "mo"} · EGP ${r.installment}/${t("monthShort") || "mo"} · ${r.reason || ""}</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <span class="badge ${r.status}">${t(r.status)}</span>
          ${r.status === "pending" ? `
            <button class="btn btn-sm btn-primary" data-adv-action="approved" data-id="${d.id}">${t("approve")}</button>
            <button class="btn btn-sm btn-danger" data-adv-action="rejected" data-id="${d.id}">${t("reject")}</button>` : ""}
        </div>
      </div>`;
  });
  el.querySelectorAll("button[data-adv-action]").forEach(btn => {
    btn.addEventListener("click", async () => {
      await updateDoc(doc(db, "advanceRequests", btn.dataset.id), { status: btn.dataset.advAction });
    });
  });
});

// ---------- Worker shifts (attendance) ----------
onSnapshot(query(collection(db, "attendance"), orderBy("clockIn", "desc")), (snap) => {
  const el = document.getElementById("shiftsList");
  if (snap.empty) { el.innerHTML = `<p class="empty-state">${t("noShiftsYet")}</p>`; return; }
  el.innerHTML = "";
  snap.docs.slice(0, 50).forEach(d => {
    const s = d.data();
    const inTime = s.clockIn?.toDate ? s.clockIn.toDate().toLocaleString() : "—";
    const outTime = s.clockOut?.toDate ? s.clockOut.toDate().toLocaleTimeString() : t("shiftOngoing");
    const totalBreakMin = s.totalBreakSeconds ? Math.round(s.totalBreakSeconds / 60) : 0;
    const breakInfo = totalBreakMin > 0 ? ` · ${t("totalBreak")}: ${totalBreakMin} ${t("minutesShort")}` : "";
    const badge = s.status === "open"
      ? (s.onBreak ? `<span class="badge pending">${t("onBreakBadge")}</span>` : `<span class="badge pending">${t("shiftOngoing")}</span>`)
      : "";
    el.innerHTML += `
      <div class="list-item">
        <div class="meta">
          <div class="title">${s.workerName || ""}</div>
          <div class="sub">${inTime} → ${outTime}${breakInfo}</div>
        </div>
        ${badge}
      </div>`;
  });
});

// ---------- Leave requests review ----------
onSnapshot(query(collection(db, "leaveRequests"), orderBy("createdAt", "desc")), (snap) => {
  const el = document.getElementById("leaveRequestsList");
  if (snap.empty) { el.innerHTML = `<p class="empty-state">${t("noLeaveRequests")}</p>`; return; }
  el.innerHTML = "";
  snap.forEach(d => {
    const r = d.data();
    el.innerHTML += `
      <div class="list-item">
        <div class="meta">
          <div class="title">${r.workerName} · ${r.fromDate} → ${r.toDate}</div>
          <div class="sub">${r.reason || ""}</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <span class="badge ${r.status}">${t(r.status)}</span>
          ${r.status === "pending" ? `
            <button class="btn btn-sm btn-primary" data-leave-approve="${d.id}">${t("approve")}</button>
            <button class="btn btn-sm btn-danger" data-leave-reject="${d.id}">${t("reject")}</button>
          ` : ""}
        </div>
      </div>`;
  });
  el.querySelectorAll("button[data-leave-approve]").forEach(btn => {
    btn.addEventListener("click", async () => {
      await updateDoc(doc(db, "leaveRequests", btn.dataset.leaveApprove), { status: "approved" });
    });
  });
  el.querySelectorAll("button[data-leave-reject]").forEach(btn => {
    btn.addEventListener("click", async () => {
      await updateDoc(doc(db, "leaveRequests", btn.dataset.leaveReject), { status: "rejected" });
    });
  });
});

// ---------- Add resident account (admin can create directly, on top of self-signup) ----------
document.getElementById("addResidentAccBtn").addEventListener("click", async () => {
  const btn = document.getElementById("addResidentAccBtn");
  const errEl = document.getElementById("residentAccError");
  errEl.style.display = "none";
  const name = document.getElementById("residentAccName").value.trim();
  const unit = document.getElementById("residentAccUnit").value.trim();
  const email = document.getElementById("residentAccEmail").value.trim();
  const password = document.getElementById("residentAccPassword").value;
  if (!name || !unit || !email || !password) {
    errEl.textContent = "Please fill in the name, unit, email and password.";
    errEl.style.display = "block";
    return;
  }
  btn.disabled = true;
  try {
    await createStaffAccount({ name, email, password, role: "resident", createdBy: user.uid, extra: { unit, points: 0 } });
    document.getElementById("residentAccName").value = "";
    document.getElementById("residentAccUnit").value = "";
    document.getElementById("residentAccEmail").value = "";
    document.getElementById("residentAccPassword").value = "";
    alert(t("accountCreated") || "Account created.");
  } catch (err) {
    errEl.textContent = friendlyStaffCreateError(err);
    errEl.style.display = "block";
  } finally {
    btn.disabled = false;
  }
});

// ---------- Add site manager account (admin only) ----------
document.getElementById("addManagerAccBtn").addEventListener("click", async () => {
  const btn = document.getElementById("addManagerAccBtn");
  const errEl = document.getElementById("mgrAccError");
  errEl.style.display = "none";
  const name = document.getElementById("mgrAccName").value.trim();
  const email = document.getElementById("mgrAccEmail").value.trim();
  const password = document.getElementById("mgrAccPassword").value;
  if (!name || !email || !password) {
    errEl.textContent = "Please fill in the name, email and password.";
    errEl.style.display = "block";
    return;
  }
  btn.disabled = true;
  try {
    await createStaffAccount({ name, email, password, role: "manager", createdBy: user.uid });
    document.getElementById("mgrAccName").value = "";
    document.getElementById("mgrAccEmail").value = "";
    document.getElementById("mgrAccPassword").value = "";
    alert(t("accountCreated") || "Account created.");
  } catch (err) {
    errEl.textContent = friendlyStaffCreateError(err);
    errEl.style.display = "block";
  } finally {
    btn.disabled = false;
  }
});

// ---------- Add call center account (admin) ----------
document.getElementById("addCallCenterAccBtn").addEventListener("click", async () => {
  const btn = document.getElementById("addCallCenterAccBtn");
  const errEl = document.getElementById("ccAccError");
  errEl.style.display = "none";
  const name = document.getElementById("ccAccName").value.trim();
  const email = document.getElementById("ccAccEmail").value.trim();
  const password = document.getElementById("ccAccPassword").value;
  if (!name || !email || !password) {
    errEl.textContent = "Please fill in the name, email and password.";
    errEl.style.display = "block";
    return;
  }
  btn.disabled = true;
  try {
    await createStaffAccount({ name, email, password, role: "callcenter", createdBy: user.uid });
    document.getElementById("ccAccName").value = "";
    document.getElementById("ccAccEmail").value = "";
    document.getElementById("ccAccPassword").value = "";
    alert(t("accountCreated") || "Account created.");
  } catch (err) {
    errEl.textContent = friendlyStaffCreateError(err);
    errEl.style.display = "block";
  } finally {
    btn.disabled = false;
  }
});

// ---------- Add worker account (admin) ----------
document.getElementById("addWorkerAccBtn").addEventListener("click", async () => {
  const btn = document.getElementById("addWorkerAccBtn");
  const errEl = document.getElementById("workerAccError");
  errEl.style.display = "none";
  const name = document.getElementById("workerAccName").value.trim();
  const workerType = document.getElementById("workerAccType").value;
  const email = document.getElementById("workerAccEmail").value.trim();
  const password = document.getElementById("workerAccPassword").value;
  if (!name || !email || !password) {
    errEl.textContent = "Please fill in the name, email and password.";
    errEl.style.display = "block";
    return;
  }
  btn.disabled = true;
  try {
    await createStaffAccount({ name, email, password, role: "worker", createdBy: user.uid, extra: { workerType } });
    document.getElementById("workerAccName").value = "";
    document.getElementById("workerAccEmail").value = "";
    document.getElementById("workerAccPassword").value = "";
    alert(t("accountCreated") || "Account created.");
  } catch (err) {
    errEl.textContent = friendlyStaffCreateError(err);
    errEl.style.display = "block";
  } finally {
    btn.disabled = false;
  }
});

// ---------- Workers (legacy roster entry, no login) ----------
document.getElementById("addWorkerBtn").addEventListener("click", async () => {
  const name = document.getElementById("workerName").value.trim();
  const role = document.getElementById("workerRole").value.trim();
  const phone = document.getElementById("workerPhone").value.trim();
  if (!name || !role) { alert("Please enter the worker's name and role."); return; }
  await addDoc(collection(db, "workers"), {
    name, role, phone, status: "active", createdAt: serverTimestamp()
  });
  document.getElementById("workerName").value = "";
  document.getElementById("workerRole").value = "";
  document.getElementById("workerPhone").value = "";
});

onSnapshot(query(collection(db, "workers"), orderBy("createdAt", "desc")), (snap) => {
  const el = document.getElementById("workersList");
  if (snap.empty) { el.innerHTML = `<p class="empty-state">${t("noWorkers")}</p>`; return; }
  el.innerHTML = "";
  snap.forEach(d => {
    const w = d.data();
    el.innerHTML += `
      <div class="list-item">
        <div class="meta">
          <div class="title">${w.name}</div>
          <div class="sub">${w.role} · ${w.phone || "no phone"}</div>
        </div>
        <span class="badge ${w.status}">${w.status}</span>
      </div>`;
  });
});

// ---------- Finance ----------
document.getElementById("addPayBtn").addEventListener("click", async () => {
  const unit = document.getElementById("payUnit").value.trim();
  const email = document.getElementById("payEmail").value.trim();
  const amount = Number(document.getElementById("payAmount").value);
  const due = document.getElementById("payDue").value;
  const description = document.getElementById("payDesc").value.trim();
  if (!email || !amount || !due) { alert("Please fill in email, amount and due date."); return; }

  const usersSnap = await getDocs(query(collection(db, "users"), where("email", "==", email)));
  if (usersSnap.empty) { alert("No resident found with that email."); return; }
  const residentId = usersSnap.docs[0].id;

  await addDoc(collection(db, "payments"), {
    residentId, unit, amount, dueDate: due, description: description || "Monthly fee",
    status: "pending", createdAt: serverTimestamp()
  });
  document.getElementById("payUnit").value = "";
  document.getElementById("payEmail").value = "";
  document.getElementById("payAmount").value = "";
  document.getElementById("payDue").value = "";
  document.getElementById("payDesc").value = "";
});

onSnapshot(query(collection(db, "payments"), orderBy("createdAt", "desc")), (snap) => {
  const el = document.getElementById("financeList");
  if (snap.empty) { el.innerHTML = `<p class="empty-state">${t("noPaymentRecords")}</p>`; return; }
  el.innerHTML = "";
  const todayISO = new Date().toISOString().slice(0, 10);
  snap.forEach(d => {
    const p = d.data();
    // Best-effort auto-overdue: no scheduled Cloud Function yet, so whichever admin
    // has this panel open is the one that flips stale "pending" rows to "overdue".
    // This only runs while an admin is actively viewing Finanza — see roadmap backlog.
    if (p.status === "pending" && p.dueDate && p.dueDate < todayISO) {
      updateDoc(doc(db, "payments", d.id), { status: "overdue" })
        .catch(err => console.error("Auto-overdue update failed for", d.id, err));
      p.status = "overdue"; // reflect immediately in this render pass, don't wait for the round-trip
    }
    const canMarkPaid = p.status !== "paid";
    el.innerHTML += `
      <div class="list-item">
        <div class="meta">
          <div class="title">${p.unit || "—"} · EGP ${p.amount}</div>
          <div class="sub">${p.description} · due ${p.dueDate}</div>
        </div>
        <span class="badge ${p.status}">${t(p.status) || p.status}</span>
        ${canMarkPaid ? `<button class="btn btn-sm btn-outline pay-mark-paid" data-id="${d.id}">${t("markAsPaid") || "Mark as paid"}</button>` : ""}
      </div>`;
  });
  el.querySelectorAll(".pay-mark-paid").forEach(btn => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await updateDoc(doc(db, "payments", btn.dataset.id), {
          status: "paid",
          paidAt: serverTimestamp()
        });
      } catch (err) {
        console.error(err);
        alert("Could not update payment. Please try again.");
        btn.disabled = false;
      }
    });
  });
});

// ---------- Payment receipts (proof of payment review) ----------
function escHtml(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function safeUrl(u) { return /^https:\/\//.test(u || "") ? u : "#"; }
const proofData = {}; // proofId -> data URL, for opening in a new tab

onSnapshot(query(collection(db, "paymentProofs"), orderBy("uploadedAt", "desc")), (snap) => {
  const el = document.getElementById("proofsList");
  if (snap.empty) { el.innerHTML = `<p class="empty-state">${t("noReceipts")}</p>`; return; }
  el.innerHTML = "";
  snap.forEach(d => {
    const p = d.data();
    const when = p.uploadedAt?.toDate ? p.uploadedAt.toDate().toLocaleString() : "";
    const src = p.fileData || p.fileURL || "";
    if (p.fileData) proofData[d.id] = p.fileData;
    const isImage = /^data:image\//.test(src) || /\.(png|jpe?g|gif|webp|heic)$/i.test(p.fileName || "");
    const imgSrc = /^data:image\/[a-z+]+;base64,/.test(src) ? src : safeUrl(p.fileURL);
    const preview = isImage && src
      ? `<img src="${imgSrc}" alt="" class="proof-open" data-id="${d.id}" style="width:64px;height:64px;object-fit:cover;border-radius:8px;flex-shrink:0;cursor:pointer">`
      : "";
    const viewLink = p.fileData
      ? `<a href="#" class="sub proof-open" data-id="${d.id}" style="color:var(--primary);font-weight:700;text-decoration:underline">${t("viewProof")}</a>`
      : `<a href="${safeUrl(p.fileURL)}" target="_blank" rel="noopener" class="sub" style="color:var(--primary);font-weight:700;text-decoration:underline">${t("viewProof")}</a>`;
    const pending = p.status === "pending_review";
    el.innerHTML += `
      <div class="list-item" style="flex-direction:column;align-items:stretch">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
          <div style="display:flex;align-items:center;gap:10px">
            ${preview}
            <div class="meta">
              <div class="title">${escHtml(p.unit || "—")} · ${escHtml(p.fileName || "")}</div>
              <div class="sub">${escHtml(when)}</div>
              ${viewLink}
            </div>
          </div>
          <span class="badge ${escHtml(p.status)}">${t("proof_" + p.status) || escHtml(p.status)}</span>
        </div>
        ${pending ? `<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-sm btn-primary proof-approve" data-id="${d.id}" data-payment="${escHtml(p.paymentId)}">${t("approveProof")}</button>
          <button class="btn btn-sm btn-outline proof-reject" data-id="${d.id}">${t("rejectProof")}</button>
        </div>` : ""}
        ${p.status === "rejected" && p.reviewNote ? `<div class="sub" style="margin-top:4px">${escHtml(p.reviewNote)}</div>` : ""}
      </div>`;
  });
  el.querySelectorAll(".proof-open").forEach(x => x.addEventListener("click", (e) => {
    e.preventDefault();
    if (proofData[x.dataset.id]) openDataUrl(proofData[x.dataset.id]);
  }));
  el.querySelectorAll(".proof-approve").forEach(btn => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        // One atomic commit: the receipt is approved AND the payment is paid, or neither.
        const batch = writeBatch(db);
        batch.update(doc(db, "paymentProofs", btn.dataset.id), {
          status: "approved", reviewedBy: user.uid, reviewedAt: serverTimestamp()
        });
        batch.update(doc(db, "payments", btn.dataset.payment), {
          status: "paid", paidAt: serverTimestamp()
        });
        await batch.commit();
      } catch (err) {
        console.error(err);
        alert(t("proofActionFailed"));
        btn.disabled = false;
      }
    });
  });
  el.querySelectorAll(".proof-reject").forEach(btn => {
    btn.addEventListener("click", async () => {
      const note = prompt(t("rejectReasonPrompt"));
      if (note === null) return;
      btn.disabled = true;
      try {
        await updateDoc(doc(db, "paymentProofs", btn.dataset.id), {
          status: "rejected", reviewNote: note.trim(), reviewedBy: user.uid, reviewedAt: serverTimestamp()
        });
      } catch (err) {
        console.error(err);
        alert(t("proofActionFailed"));
        btn.disabled = false;
      }
    });
  });
});

// ---------- Maintenance (admin view + status update + assign worker) ----------
const CATEGORY_I18N_KEY = {
  "Plumbing": "catPlumbing",
  "Electrical": "catElectrical",
  "AC / Cooling": "catAC",
  "Carpentry": "catCarpentry",
  "Cleaning": "catCleaning",
  "Garden": "catGarden",
  "Other": "catOther"
};
function categoryLabel(cat) {
  const key = CATEGORY_I18N_KEY[cat];
  return key ? t(key) : cat; // fallback for any legacy/custom value
}
// Which craft (workerType) can take which request category. "Cleaning" goes to cleaning
// staff; everything else (plumbing/electrical/AC/carpentry/other) goes to the general
// maintenance craft — the data model doesn't split those into separate worker types yet.
const CATEGORY_TO_CRAFT = {
  "Cleaning": "cleaning",
  "Garden": "garden",
  "Plumbing": "maintenance",
  "Electrical": "maintenance",
  "AC / Cooling": "maintenance",
  "Carpentry": "maintenance",
  "Other": "maintenance"
};
// A request is "active" for load-balancing purposes once a worker has it and hasn't
// finished — i.e. assigned-but-not-started or in progress.
const ACTIVE_STATUSES = ["accepted", "in_progress"];
// Fallback length for a request no worker has estimated yet (hours).
const DEFAULT_TASK_HOURS = 1;

let workerOptionsCache = [];
let lastMaintDocs = [];

// Where a queue entry came from: the resident app, a call logged over the phone, or a
// task an admin/site manager sent a worker to directly (no resident involved at all).
function originLabel(m) {
  if (m.source === "onsite") return t("originOnsite");
  if (m.source === "resident_report") return t("originReport");
  if (m.source === "call_center" || m.loggedByRole === "callcenter") return t("originCallCenter");
  return t("originResident");
}
// On-site tasks have no unit to show (there's no resident) — they carry a free-text
// location instead, entered by whoever created the task.
function placeLabel(m) {
  if (m.source === "onsite") return m.location || "—";
  // A compound report is about a common area, so the spot the resident typed matters
  // more than their unit — both are shown, the location first.
  if (m.source === "resident_report") return `${m.location || "—"} (${m.unit || "—"})`;
  return m.unit || "—";
}

// Picks the least-busy active worker of the matching craft (equal distribution across
// workers doing the same kind of job), per the site's request.
function pickWorkerForCategory(category) {
  const craft = CATEGORY_TO_CRAFT[category] || "maintenance";
  const candidates = workerOptionsCache.filter(w => w.workerType === craft && (w.accountStatus || "active") === "active");
  if (candidates.length === 0) return null;
  const load = {};
  candidates.forEach(w => { load[w.id] = 0; });
  lastMaintDocs.forEach(m => {
    if (ACTIVE_STATUSES.includes(m.status) && m.assignedWorkerId && load[m.assignedWorkerId] !== undefined) {
      load[m.assignedWorkerId]++;
    }
  });
  return candidates.sort((a, b) => load[a.id] - load[b.id])[0];
}

// Queue position: how many other non-completed requests of the same craft were created
// earlier than this one. Written back onto each doc so the resident view (which can't
// read other residents' requests) can show "N requests ahead of yours" from its own doc.
async function recomputeQueuePositions() {
  const byCraft = {};
  lastMaintDocs.forEach(m => {
    if (m.status === "completed") return;
    const craft = CATEGORY_TO_CRAFT[m.category] || "maintenance";
    (byCraft[craft] ||= []).push(m);
  });
  const writes = [];
  Object.values(byCraft).forEach(list => {
    list.sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
    let hoursSoFar = 0;
    list.forEach((m, idx) => {
      // Waiting time = the durations the workers estimated for everything queued before
      // this request. Items nobody has estimated yet count as DEFAULT_TASK_HOURS so the
      // number never silently under-reports; it's shown to the resident as approximate.
      const eta = Math.round(hoursSoFar * 2) / 2;
      const patch = {};
      if (m.queueAhead !== idx) patch.queueAhead = idx;
      if (m.queueEtaHours !== eta) patch.queueEtaHours = eta;
      if (Object.keys(patch).length) writes.push(updateDoc(doc(db, "maintenanceRequests", m.id), patch));
      hoursSoFar += Number(m.estimatedHours) > 0 ? Number(m.estimatedHours) : DEFAULT_TASK_HOURS;
    });
  });
  if (writes.length) await Promise.all(writes).catch(() => {});
}

function renderMaintList() {
  const el = document.getElementById("adminMaintList");
  if (lastMaintDocs.length === 0) { el.innerHTML = `<p class="empty-state">${t("noRequests")}</p>`; return; }
  el.innerHTML = "";
  lastMaintDocs.forEach(m => {
    const craft = CATEGORY_TO_CRAFT[m.category] || "maintenance";
    const assignableWorkers = workerOptionsCache.filter(w => w.workerType === craft);
    el.innerHTML += `
      <div class="list-item">
        <div class="meta">
          <div class="title">${placeLabel(m)} · ${categoryLabel(m.category)}</div>
          <div class="sub" style="font-size:11px;color:#7b8a85">${originLabel(m)}</div>
          ${m.residentName ? `<div class="sub">👤 ${opsEsc(m.residentName)}</div>` : ""}
          <div class="sub">${m.description}</div>
          ${m.photoData ? `<img class="photo-thumb maint-photo" src="${m.photoData}" data-id="${m.id}" alt="">` : ""}
          <div class="sub" style="font-size:11px;color:#7b8a85">${t("estDuration")}: ${Number(m.estimatedHours) > 0 ? (Number(m.estimatedHours) === 0.5 ? t("estHalfHour") : `${m.estimatedHours} ${Number(m.estimatedHours) === 1 ? t("estHour") : t("estHours")}`) : t("estNotSet")}</div>
          <select data-id="${m.id}" class="maint-assign" style="border-radius:8px;border:1px solid #dfe6e3;padding:4px;font-size:11px;margin-top:6px">
            <option value="">${t("unassigned")}</option>
            ${assignableWorkers.map(w => `<option value="${w.id}" ${m.assignedWorkerId === w.id ? "selected" : ""}>${w.name} (${workerTypeLabel(w.workerType)})</option>`).join("")}
          </select>
          ${!m.assignedWorkerId ? `<button type="button" class="btn btn-sm btn-outline maint-auto" data-id="${m.id}" style="margin-top:6px">${t("autoAssign")}</button>` : ""}
        </div>
        <select data-id="${m.id}" class="maint-status" style="border-radius:8px;border:1px solid #dfe6e3;padding:6px;font-size:12px">
          <option value="pending" ${m.status === "pending" ? "selected" : ""} disabled>${t("pending")}</option>
          <option value="accepted" ${m.status === "accepted" ? "selected" : ""} disabled>${t("accepted")}</option>
          <option value="in_progress" ${m.status === "in_progress" ? "selected" : ""}>${t("in_progress")}</option>
          <option value="completed" ${m.status === "completed" ? "selected" : ""}>${t("completed")}</option>
        </select>
      </div>`;
  });
  el.querySelectorAll(".maint-status").forEach(sel => {
    sel.addEventListener("change", async () => {
      const payload = {
        status: sel.value,
        statusSeenByResident: false,
        statusChangedAt: serverTimestamp()
      };
      if (sel.value === "completed") payload.completedAt = serverTimestamp();
      try {
        await updateDoc(doc(db, "maintenanceRequests", sel.dataset.id), payload);
      } catch (err) {
        console.error("Failed to update request status:", err);
        alert(err.message || String(err));
      }
    });
  });
  el.querySelectorAll(".maint-assign").forEach(sel => {
    sel.addEventListener("change", async () => {
      const m = lastMaintDocs.find(x => x.id === sel.dataset.id);
      const payload = { assignedWorkerId: sel.value || null };
      // Assigning someone bumps a still-pending request straight to "accepted" so it
      // shows up in that worker's queue; clearing the assignment on an accepted-but-
      // not-started request drops it back to pending.
      if (sel.value && m?.status === "pending") payload.status = "accepted";
      if (!sel.value && m?.status === "accepted") payload.status = "pending";
      try {
        await updateDoc(doc(db, "maintenanceRequests", sel.dataset.id), payload);
      } catch (err) {
        console.error("Failed to assign worker:", err);
        alert(err.message || String(err));
      }
    });
  });
  el.querySelectorAll(".maint-auto").forEach(btn => {
    btn.addEventListener("click", async () => {
      const m = lastMaintDocs.find(x => x.id === btn.dataset.id);
      const worker = pickWorkerForCategory(m.category);
      if (!worker) { alert(t("noAssignableWorkers")); return; }
      try {
        await updateDoc(doc(db, "maintenanceRequests", btn.dataset.id), { assignedWorkerId: worker.id, status: "accepted" });
      } catch (err) {
        console.error("Failed to auto-assign worker:", err);
        alert(err.message || String(err));
      }
    });
  });
  el.querySelectorAll(".maint-photo").forEach(img => {
    img.addEventListener("click", () => openDataUrl(img.src));
  });
}

// ---------- Service subscriptions (car wash / home cleaning / garden care) ----------
const SERVICE_I18N_KEY = {
  car_wash: "svcCarWash",
  home_cleaning: "svcHomeClean",
  garden_care: "svcGarden"
};
const FREQ_I18N_KEY = {
  weekly: "freqWeekly",
  biweekly: "freqBiweekly",
  monthly: "freqMonthly",
  once: "freqOnce"
};
let lastSubDocs = [];

onSnapshot(query(collection(db, "serviceSubscriptions"), orderBy("requestedAt", "desc")), (snap) => {
  lastSubDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderSubsList();
}, (err) => console.error("Subscriptions listener failed:", err));

function renderSubsList() {
  const el = document.getElementById("adminSubsList");
  if (!el) return;
  if (lastSubDocs.length === 0) { el.innerHTML = `<p class="empty-state">${t("noSubscriptions")}</p>`; return; }
  el.innerHTML = lastSubDocs.map(s => `
    <div class="list-item">
      <div class="meta">
        <div class="title">${s.unit || "—"} · ${t(SERVICE_I18N_KEY[s.service]) || s.service}</div>
        <div class="sub">${t(FREQ_I18N_KEY[s.frequency]) || s.frequency || ""}${s.price ? ` · ${s.price}` : ""}</div>
        ${s.notes ? `<div class="sub">${s.notes}</div>` : ""}
        ${s.status === "requested" ? `
          <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
            <input type="text" class="sub-price" data-id="${s.id}" placeholder="${t("svcPricePh")}" style="width:120px;padding:6px 8px;border:1px solid #dfe6e3;border-radius:8px;font-size:12px">
            <button type="button" class="btn btn-sm btn-primary sub-approve" data-id="${s.id}">${t("svcApprove")}</button>
            <button type="button" class="btn btn-sm btn-outline sub-reject" data-id="${s.id}">${t("svcReject")}</button>
          </div>` : ""}
        ${s.status === "active" ? `<button type="button" class="btn btn-sm btn-outline sub-stop" data-id="${s.id}" style="margin-top:6px">${t("svcStop")}</button>` : ""}
      </div>
      <span class="badge ${s.status}">${t(`sub_${s.status}`) || s.status}</span>
    </div>`).join("");

  el.querySelectorAll(".sub-approve").forEach(btn => btn.addEventListener("click", async () => {
    const price = el.querySelector(`.sub-price[data-id="${btn.dataset.id}"]`)?.value.trim() || "";
    await updateSub(btn, { status: "active", price, approvedBy: user.uid, approvedAt: serverTimestamp() });
  }));
  el.querySelectorAll(".sub-reject").forEach(btn => btn.addEventListener("click", async () => {
    await updateSub(btn, { status: "rejected", reviewedAt: serverTimestamp() });
  }));
  el.querySelectorAll(".sub-stop").forEach(btn => btn.addEventListener("click", async () => {
    if (!confirm(t("svcStopConfirm"))) return;
    await updateSub(btn, { status: "cancelled", cancelledAt: serverTimestamp() });
  }));
}

async function updateSub(btn, payload) {
  btn.disabled = true;
  try {
    await updateDoc(doc(db, "serviceSubscriptions", btn.dataset.id), payload);
  } catch (err) {
    console.error("Failed to update subscription:", err);
    alert(err.message || String(err));
    btn.disabled = false;
  }
}
window.addEventListener("so-lang-changed", renderSubsList);

onSnapshot(query(collection(db, "users"), where("role", "==", "worker")), (snap) => {
  workerOptionsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderMaintList();
  renderOpsOverview();
  renderOnsiteWorkerOptions();
  renderAreaWorkerOptions(); // the "add area" form picks the worker in charge from the same list
  renderAreasList();
});

// ---------- Direct on-site task: admin sends a worker straight to a job, no resident involved ----------
// The worker list depends on which craft the chosen category maps to (same mapping used
// for auto-assign), so it's rebuilt whenever the category or the worker list changes.
function renderOnsiteWorkerOptions() {
  const categorySel = document.getElementById("onsiteCategory");
  const workerSel = document.getElementById("onsiteWorkerSelect");
  if (!categorySel || !workerSel) return;
  const craft = CATEGORY_TO_CRAFT[categorySel.value] || "maintenance";
  const candidates = workerOptionsCache.filter(w => w.workerType === craft && (w.accountStatus || "active") === "active");
  const previous = workerSel.value;
  workerSel.innerHTML = `<option value="">${t("selectWorkerOption")}</option>` +
    candidates.map(w => `<option value="${w.id}">${w.name} (${workerTypeLabel(w.workerType)})</option>`).join("");
  if (candidates.some(w => w.id === previous)) workerSel.value = previous;
}
document.getElementById("onsiteCategory")?.addEventListener("change", renderOnsiteWorkerOptions);
renderOnsiteWorkerOptions();

document.getElementById("createOnsiteTaskBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("createOnsiteTaskBtn");
  const errEl = document.getElementById("onsiteTaskError");
  errEl.style.display = "none";
  const category = document.getElementById("onsiteCategory").value;
  const workerId = document.getElementById("onsiteWorkerSelect").value;
  const location = document.getElementById("onsiteLocationInput").value.trim();
  const description = document.getElementById("onsiteDescInput").value.trim();
  if (!category || !workerId || !description) {
    errEl.textContent = t("fillOnsiteFields");
    errEl.style.display = "block";
    return;
  }
  btn.disabled = true;
  try {
    // Created already "accepted" — the worker is chosen up front, unlike a resident/call
    // center request which starts "pending" until someone assigns it. It still joins the
    // same craft queue (recomputeQueuePositions groups by category, not by source), so it
    // occupies the worker's time exactly like any other request ahead of it.
    await addDoc(collection(db, "maintenanceRequests"), {
      source: "onsite",
      category, description, location,
      assignedWorkerId: workerId,
      status: "accepted",
      statusSeenByResident: true,
      createdBy: user.uid,
      createdAt: serverTimestamp()
    });
    document.getElementById("onsiteLocationInput").value = "";
    document.getElementById("onsiteDescInput").value = "";
    alert(t("onsiteTaskCreated"));
  } catch (err) {
    console.error("Failed to create on-site task:", err);
    errEl.textContent = err.message || String(err);
    errEl.style.display = "block";
  } finally {
    btn.disabled = false;
  }
});

onSnapshot(query(collection(db, "maintenanceRequests"), orderBy("createdAt", "desc")), (snap) => {
  lastMaintDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderMaintList();
  renderOpsOverview();
  renderMaintStats();
  recomputeQueuePositions();
  backfillResidentNames();
  renderAreasList(); // each area shows how many of its jobs are still open
});

// ---------- Operations overview: request counts + how many each worker has been given ----------
function opsEsc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderOpsOverview() {
  const tilesEl = document.getElementById("opsTiles");
  const chartEl = document.getElementById("opsWorkerChart");
  if (!tilesEl || !chartEl) return; // markup not present in an older admin.html
  const docs = lastMaintDocs;
  const count = (st) => docs.filter(m => m.status === st).length;

  const tiles = [
    { cls: "total",       n: docs.length,          label: t("opsTotal") },
    { cls: "pending",     n: count("pending"),     label: t("opsWaiting") },
    { cls: "accepted",    n: count("accepted"),    label: t("opsToDo") },
    { cls: "in_progress", n: count("in_progress"), label: t("in_progress") },
    { cls: "completed",   n: count("completed"),   label: t("completed") }
  ];
  tilesEl.innerHTML = tiles.map(x =>
    `<div class="ops-tile ${x.cls}"><div class="n">${x.n}</div><div class="l">${x.label}</div></div>`).join("");

  // Per-worker workload: everything currently or previously assigned to each worker.
  const per = {};
  docs.forEach(m => {
    if (!m.assignedWorkerId) return;
    const w = (per[m.assignedWorkerId] ||= { accepted: 0, in_progress: 0, completed: 0 });
    if (w[m.status] !== undefined) w[m.status]++;
  });
  // Security guards don't take requests, so they only show up if they somehow have some.
  const rows = workerOptionsCache
    .filter(w => w.workerType !== "security" || per[w.id])
    .map(w => {
      const c = per[w.id] || { accepted: 0, in_progress: 0, completed: 0 };
      return { w, c, open: c.accepted + c.in_progress, total: c.accepted + c.in_progress + c.completed };
    })
    .sort((a, b) => (b.open - a.open) || (b.total - a.total) || String(a.w.name || "").localeCompare(String(b.w.name || "")));

  if (rows.length === 0) { chartEl.innerHTML = `<p class="empty-state">${t("opsNoWorkers")}</p>`; return; }

  const maxTotal = Math.max(1, ...rows.map(r => r.total));
  const seg = (n, cls, label) => n
    ? `<div class="ops-seg ${cls}" style="width:${(n / maxTotal * 100).toFixed(1)}%" title="${opsEsc(label)}: ${n}">${n}</div>` : "";
  chartEl.innerHTML = rows.map(r => `
    <div class="ops-row">
      <div class="ops-head">
        <span class="ops-name">${opsEsc(r.w.name || r.w.email || r.w.id)} <small>· ${opsEsc(workerTypeLabel(r.w.workerType))}</small></span>
        <span class="ops-count">${r.total}</span>
      </div>
      <div class="ops-track">
        ${seg(r.c.accepted, "accepted", t("opsToDo"))}${seg(r.c.in_progress, "in_progress", t("in_progress"))}${seg(r.c.completed, "completed", t("completed"))}
      </div>
    </div>`).join("");
}
window.addEventListener("so-lang-changed", renderOpsOverview);

// Requests created before names were stored on them: the admin can read resident profiles
// (workers can't), so copy the resident's name onto the request so the assigned worker can
// see who the job is for.
function backfillResidentNames() {
  try {
    if (!residentsCache.length || !lastMaintDocs.length) return;
    const inFlight = (window.__soNameBackfill ||= new Set());
    lastMaintDocs.forEach(m => {
      if (!m.residentId || m.residentName || inFlight.has(m.id)) return;
      const r = residentsCache.find(x => x.id === m.residentId);
      const name = r && (r.name || r.email);
      if (!name) return;
      inFlight.add(m.id);
      updateDoc(doc(db, "maintenanceRequests", m.id), { residentName: name }).catch(() => inFlight.delete(m.id));
    });
  } catch { /* caches not ready yet */ }
}


// ---------- Maintenance stats: average resolution time per category ----------
function renderMaintStats() {
  const el = document.getElementById("maintStats");
  if (!el) return; // markup not added to this admin.html copy yet
  const byCategory = {};
  lastMaintDocs.forEach(m => {
    if (m.status !== "completed" || !m.createdAt?.seconds || !m.completedAt?.seconds) return;
    const hours = (m.completedAt.seconds - m.createdAt.seconds) / 3600;
    if (hours < 0) return;
    (byCategory[m.category] ||= []).push(hours);
  });
  const cats = Object.keys(byCategory);
  if (cats.length === 0) {
    el.innerHTML = `<p class="empty-state">${t("noMaintStats") || "No resolved requests with timing yet."}</p>`;
    return;
  }
  el.innerHTML = cats.map(cat => {
    const arr = byCategory[cat];
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    const avgLabel = avg < 1 ? `${Math.round(avg * 60)} min` : `${avg.toFixed(1)} h`;
    return `
      <div class="list-item">
        <div class="meta">
          <div class="title">${categoryLabel(cat)}</div>
          <div class="sub">${arr.length} ${t("resolved") || "resolved"}</div>
        </div>
        <span class="badge completed">${t("avgTime") || "avg"} ${avgLabel}</span>
      </div>`;
  }).join("");
}

// ---------- Access log ----------
onSnapshot(query(collection(db, "accessLogs"), orderBy("timestamp", "desc")), (snap) => {
  const el = document.getElementById("accessList");
  if (snap.empty) { el.innerHTML = `<p class="empty-state">${t("noEntries")}</p>`; return; }
  el.innerHTML = "";
  let count = 0;
  snap.forEach(d => {
    if (count++ >= 25) return;
    const a = d.data();
    el.innerHTML += `
      <div class="list-item">
        <div class="meta">
          <div class="title">${a.personName} (${a.personType})</div>
          <div class="sub">${a.type === "entry" ? "Entered" : "Exited"} · ${fmtTime(a.timestamp)}</div>
        </div>
      </div>`;
  });
});

// ---------- QR scanner ----------
// ---------- Master access QR ----------
function cryptoToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, "0")).join("");
}

document.getElementById("generateMasterBtn").addEventListener("click", async () => {
  const label = document.getElementById("masterLabel").value.trim();
  const expiryVal = document.getElementById("masterExpiry").value;
  const zones = [...document.querySelectorAll(".zoneCheck:checked")].map(cb => cb.value);
  if (!label) { alert("Please enter a label for this code."); return; }
  if (zones.length === 0) { alert("Select at least one access zone."); return; }
  if (typeof QRCode === "undefined") { alert("QR library did not load. Reload the page and try again."); return; }

  const btn = document.getElementById("generateMasterBtn");
  btn.disabled = true;
  try {
    const token = cryptoToken();
    const ref = await addDoc(collection(db, "invitations"), {
      type: "master",
      label,
      accessZones: zones,
      token,
      status: "active",
      createdBy: user.uid,
      createdAt: serverTimestamp(),
      expiresAt: expiryVal ? new Date(expiryVal) : null
    });

    const qrPayload = JSON.stringify({ inviteId: ref.id, token, ts: Date.now() });
    const canvas = document.getElementById("masterQrCanvas");
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    await QRCode.toCanvas(canvas, qrPayload, { width: 220, margin: 1, color: { dark: "#0a4f45" } });
    document.getElementById("masterQrResultCard").style.display = "block";
    document.getElementById("revokeMasterBtn").dataset.id = ref.id;
    document.getElementById("masterLabel").value = "";
    document.getElementById("masterExpiry").value = "";
  } catch (err) {
    console.error("Master QR generation failed:", err);
    alert(err.message || err);
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("revokeMasterBtn").addEventListener("click", async () => {
  const id = document.getElementById("revokeMasterBtn").dataset.id;
  if (!id) return;
  await updateDoc(doc(db, "invitations", id), { status: "revoked" });
  document.getElementById("masterQrResultCard").style.display = "none";
});

onSnapshot(query(collection(db, "invitations"), where("type", "==", "master")), (snap) => {
  const el = document.getElementById("masterCodesList");
  if (snap.empty) { el.innerHTML = `<p class="empty-state">${t("noMasterCodes")}</p>`; return; }
  el.innerHTML = "";
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  rows.forEach(m => {
    const expired = m.expiresAt && m.expiresAt.toDate() < new Date();
    const status = m.status === "revoked" ? "revoked" : expired ? "expired" : "active";
    el.innerHTML += `
      <div class="list-item">
        <div class="meta">
          <div class="title">${m.label}</div>
          <div class="sub">${(m.accessZones || []).map(z => t(z)).join("، ")}</div>
        </div>
        <span class="badge ${status}">${status}</span>
        ${status === "active" ? `<button class="btn btn-sm btn-danger" data-revoke-id="${m.id}" style="margin-inline-start:6px">${t("revoke")}</button>` : ""}
      </div>`;
  });
  el.querySelectorAll("button[data-revoke-id]").forEach(btn => {
    btn.addEventListener("click", async () => {
      await updateDoc(doc(db, "invitations", btn.dataset.revokeId), { status: "revoked" });
    });
  });
});

let scannerStarted = false;
function startScanner() {
  if (scannerStarted) return;
  scannerStarted = true;
  const reader = new Html5Qrcode("qrReader");
  reader.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: 220 },
    async (decodedText) => {
      try {
        const payload = JSON.parse(decodedText);
        const inviteRef = doc(db, "invitations", payload.inviteId);
        const inviteSnap = await getDoc(inviteRef);
        const resultEl = document.getElementById("scanResult");
        if (!inviteSnap.exists() || inviteSnap.data().token !== payload.token) {
          resultEl.textContent = "❌ Invalid or unknown invitation.";
          return;
        }
        const invite = inviteSnap.data();
        const isMaster = invite.type === "master";
        const displayName = isMaster ? (invite.label || "Master access") : invite.guestName;

        if (invite.expiresAt && invite.expiresAt.toDate() < new Date()) {
          resultEl.textContent = `⛔ ${t("expired")}: ${displayName}`;
          return;
        }
        if (invite.status === "revoked") {
          resultEl.textContent = `⛔ ${t("revoked")}: ${displayName}`;
          return;
        }
        // Guest invitations are single-use; master access codes stay valid until expiry/revocation.
        if (!isMaster) {
          if (invite.status === "used") {
            resultEl.textContent = `⚠️ This invitation was already used (${invite.guestName}).`;
            return;
          }
          await updateDoc(inviteRef, { status: "used" });
        }
        await addDoc(collection(db, "accessLogs"), {
          type: "entry",
          personType: invite.type || "guest",
          personName: displayName,
          invitationId: payload.inviteId,
          zones: invite.accessZones || null,
          timestamp: serverTimestamp()
        });
        resultEl.textContent = isMaster
          ? `✅ ${t("masterAccessGranted")}: ${displayName} — ${(invite.accessZones || []).map(z => t(z)).join("، ")}`
          : `✅ Access granted: ${invite.guestName} (unit ${invite.residentUnit || "—"})`;
      } catch (e) {
        document.getElementById("scanResult").textContent = "❌ Could not read this QR code.";
      }
    },
    () => {} // ignore per-frame scan failures
  ).catch(() => {
    document.getElementById("scanResult").textContent = "❌ " + t("cameraUnavailable");
  });
}

function fmtTime(v) {
  if (!v) return "—";
  if (v.toDate) return v.toDate().toLocaleString();
  return v;
}

// ==========================================================================
// PROPERTY — buildings & apartments (Residents dashboard → Property tab)
//
// Data model added here:
//   buildings/{id}  name, code, floors, unitsPerFloor, order, createdAt
//   units/{id}      buildingId, buildingCode, buildingName, code, floor, number,
//                   residentId|null, residentName, residentPhone,
//                   status(occupied|vacant), createdAt, updatedAt
//
// An apartment can be filled in two ways: linked to a real app account
// (residentId → the resident's own login), or just a name + phone for someone
// who doesn't use the app yet. Linking an account also writes the apartment code
// back onto users/{uid}.unit, so everything that already works by unit number
// (payments, call center lookup, maintenance requests) keeps working unchanged.
// ==========================================================================
const PROP_UNITS_PAGE = 60; // how many apartment rows are drawn at once

function propEsc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function propIsEditing(container) {
  const a = document.activeElement;
  return !!(a && container.contains(a) && ["INPUT", "SELECT", "TEXTAREA"].includes(a.tagName));
}

function propPad(n, width) { return String(n).padStart(width, "0"); }
function propBuildingById(id) { return propBuildings.find(b => b.id === id) || null; }
function propUnitsOf(buildingId) {
  return propUnits.filter(u => u.buildingId === buildingId)
    .sort((a, b) => (a.floor - b.floor) || (a.number - b.number) || String(a.code).localeCompare(String(b.code)));
}
function propIsOccupied(u) { return !!(u.residentId || (u.residentName || "").trim()); }

onSnapshot(collection(db, "buildings"), (snap) => {
  propBuildings = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999) || String(a.code || "").localeCompare(String(b.code || "")));
  renderBuildingsList();
  renderPropStats();
  renderAreaBuildingOptions();
  renderAreasList();
}, (err) => console.error("Buildings listener failed:", err));

onSnapshot(collection(db, "units"), (snap) => {
  propUnits = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderBuildingsList();
  renderUnitsList();
  renderPropStats();
}, (err) => console.error("Units listener failed:", err));

function renderPropStats() {
  const occupied = propUnits.filter(propIsOccupied).length;
  const set = (id, v) => { const node = document.getElementById(id); if (node) node.textContent = v; };
  set("statBuildings", propBuildings.length);
  set("statUnits", propUnits.length);
  set("statUnitsAssigned", occupied);
  set("statUnitsVacant", propUnits.length - occupied);
}

// ---------- Quick setup: the whole compound in one go ----------
// Spreads the total number of apartments over the buildings as evenly as possible
// (e.g. 400 over 30 → 10 buildings of 14 and 20 of 13), so the totals the owner
// gave are respected exactly instead of being rounded off.
function propDistribute(totalUnits, nBuildings) {
  const base = Math.floor(totalUnits / nBuildings);
  const extra = totalUnits % nBuildings;
  return Array.from({ length: nBuildings }, (_, i) => base + (i < extra ? 1 : 0));
}

function renderQsPreview() {
  const out = document.getElementById("qsPreview");
  if (!out) return;
  const n = Number(document.getElementById("qsBuildings").value);
  const total = Number(document.getElementById("qsUnitsTotal").value);
  if (!(n > 0) || !(total > 0)) { out.textContent = ""; return; }
  const split = propDistribute(total, n);
  const min = Math.min(...split), max = Math.max(...split);
  const per = min === max ? `${min}` : `${min}–${max}`;
  out.textContent = `${t("qsPreviewLabel")}: ${n} × ${t("buildingUnitsCount")} ${per} = ${total}`;
}
["qsBuildings", "qsUnitsTotal"].forEach(id => document.getElementById(id)?.addEventListener("input", renderQsPreview));
renderQsPreview();
window.addEventListener("so-lang-changed", renderQsPreview);

// Firestore caps a batch at 500 writes, so anything bigger is committed in chunks.
async function propCommitOps(ops) {
  const CHUNK = 400;
  for (let i = 0; i < ops.length; i += CHUNK) {
    const batch = writeBatch(db);
    ops.slice(i, i + CHUNK).forEach(op => op(batch));
    await batch.commit();
  }
}

function propNewUnitOps(building, buildingId, startNumber, count, floors, perFloor) {
  const ops = [];
  for (let i = 0; i < count; i++) {
    const seq = startNumber + i;
    // With floors/apartments-per-floor the number reads like a real address
    // (floor 3, apartment 2 → 302); without them it's a plain running number.
    let floor = 0, number = seq, code;
    if (floors > 0 && perFloor > 0) {
      floor = Math.floor((seq - 1) / perFloor) + 1;
      number = ((seq - 1) % perFloor) + 1;
      code = `${building.code}-${floor}${propPad(number, 2)}`;
    } else {
      code = `${building.code}-${propPad(seq, 2)}`;
    }
    const ref = doc(collection(db, "units"));
    ops.push((batch) => batch.set(ref, {
      buildingId,
      buildingCode: building.code,
      buildingName: building.name,
      code, floor, number,
      residentId: null,
      residentName: "",
      residentPhone: "",
      status: "vacant",
      createdAt: serverTimestamp()
    }));
  }
  return ops;
}

document.getElementById("qsGenerateBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("qsGenerateBtn");
  const errEl = document.getElementById("qsError");
  errEl.style.display = "none";
  const n = Number(document.getElementById("qsBuildings").value);
  const total = Number(document.getElementById("qsUnitsTotal").value);
  const prefix = (document.getElementById("qsPrefix").value || "P").trim();
  if (!(n > 0) || !(total > 0)) {
    errEl.textContent = t("qsInvalid");
    errEl.style.display = "block";
    return;
  }
  if (!confirm(`${document.getElementById("qsPreview").textContent}\n\n${t("qsConfirmText")}`)) return;
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = t("qsWorking");
  try {
    const split = propDistribute(total, n);
    const offset = propBuildings.length; // new buildings are appended after existing ones
    const ops = [];
    split.forEach((count, i) => {
      const index = offset + i + 1;
      const code = `${prefix}${propPad(index, 2)}`;
      // The name stays language-independent (just the code), so it reads the same
      // in Arabic and English; it can be renamed per building afterwards.
      const building = { name: code, code };
      const bRef = doc(collection(db, "buildings"));
      ops.push((batch) => batch.set(bRef, {
        name: building.name, code, floors: 0, unitsPerFloor: 0,
        order: index, createdAt: serverTimestamp()
      }));
      ops.push(...propNewUnitOps(building, bRef.id, 1, count, 0, 0));
    });
    await propCommitOps(ops);
    alert(t("qsDone"));
  } catch (err) {
    console.error("Quick setup failed:", err);
    errEl.textContent = err.message || String(err);
    errEl.style.display = "block";
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
});

// ---------- Add one building by hand ----------
document.getElementById("addBuildingBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("addBuildingBtn");
  const errEl = document.getElementById("bldError");
  errEl.style.display = "none";
  const name = document.getElementById("bldName").value.trim();
  const code = document.getElementById("bldCode").value.trim();
  const floors = Number(document.getElementById("bldFloors").value) || 0;
  const perFloor = Number(document.getElementById("bldPerFloor").value) || 0;
  if (!name || !code) {
    errEl.textContent = t("fillBuildingFields");
    errEl.style.display = "block";
    return;
  }
  btn.disabled = true;
  try {
    const bRef = doc(collection(db, "buildings"));
    const ops = [(batch) => batch.set(bRef, {
      name, code, floors, unitsPerFloor: perFloor,
      order: propBuildings.length + 1, createdAt: serverTimestamp()
    })];
    // Floors × apartments per floor is enough to lay the building out straight away.
    if (floors > 0 && perFloor > 0) {
      ops.push(...propNewUnitOps({ name, code }, bRef.id, 1, floors * perFloor, floors, perFloor));
    }
    await propCommitOps(ops);
    ["bldName", "bldCode", "bldFloors", "bldPerFloor"].forEach(id => { document.getElementById(id).value = ""; });
    alert(t("buildingAdded"));
  } catch (err) {
    console.error("Failed to add building:", err);
    errEl.textContent = err.message || String(err);
    errEl.style.display = "block";
  } finally {
    btn.disabled = false;
  }
});

// ---------- Buildings list ----------
document.getElementById("buildingSearch")?.addEventListener("input", renderBuildingsList);

function renderBuildingsList() {
  const el = document.getElementById("buildingsList");
  if (!el) return;
  const term = (document.getElementById("buildingSearch")?.value || "").trim().toLowerCase();
  const rows = propBuildings.filter(b =>
    !term || `${b.name || ""} ${b.code || ""}`.toLowerCase().includes(term));
  if (rows.length === 0) { el.innerHTML = `<p class="empty-state">${t("noBuildingsYet")}</p>`; return; }
  el.innerHTML = rows.map(b => {
    const units = propUnitsOf(b.id);
    const occupied = units.filter(propIsOccupied).length;
    const isOpen = propOpenBuildingId === b.id;
    return `
      <div class="list-item">
        <div class="meta">
          <div class="title">${propEsc(b.name || b.code)} <span style="font-size:11px;color:var(--muted)">${propEsc(b.code || "")}</span></div>
          <div class="sub">${units.length} ${t("buildingUnitsCount")} · ${occupied} ${t("buildingOccupiedCount")}</div>
          <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
            <button type="button" class="btn btn-sm ${isOpen ? "btn-primary" : "btn-outline"} bld-open" data-id="${b.id}">${isOpen ? t("closeBuilding") : t("openBuilding")}</button>
            <button type="button" class="btn btn-sm btn-outline bld-add-units" data-id="${b.id}">${t("addUnitsToBuilding")}</button>
            <button type="button" class="btn btn-sm btn-danger bld-del" data-id="${b.id}">${t("deleteBuilding")}</button>
          </div>
        </div>
      </div>`;
  }).join("");

  el.querySelectorAll(".bld-open").forEach(btn => btn.addEventListener("click", () => {
    propOpenBuildingId = propOpenBuildingId === btn.dataset.id ? null : btn.dataset.id;
    const search = document.getElementById("unitSearch");
    if (search) search.value = "";
    renderBuildingsList();
    renderUnitsList();
    if (propOpenBuildingId) document.getElementById("unitsCard")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }));

  el.querySelectorAll(".bld-add-units").forEach(btn => btn.addEventListener("click", async () => {
    const b = propBuildingById(btn.dataset.id);
    if (!b) return;
    const answer = prompt(t("addUnitsCount"), "10");
    const count = Number(answer);
    if (!(count > 0)) return;
    btn.disabled = true;
    try {
      const existing = propUnitsOf(b.id);
      const start = existing.length + 1;
      await propCommitOps(propNewUnitOps(b, b.id, start, count, b.floors || 0, b.unitsPerFloor || 0));
      alert(t("unitsGenerated"));
    } catch (err) {
      console.error("Failed to add apartments:", err);
      alert(err.message || String(err));
    } finally {
      btn.disabled = false;
    }
  }));

  el.querySelectorAll(".bld-del").forEach(btn => btn.addEventListener("click", async () => {
    if (!confirm(t("deleteBuildingConfirm"))) return;
    btn.disabled = true;
    try {
      const units = propUnitsOf(btn.dataset.id);
      const ops = units.map(u => (batch) => batch.delete(doc(db, "units", u.id)));
      ops.push((batch) => batch.delete(doc(db, "buildings", btn.dataset.id)));
      await propCommitOps(ops);
      if (propOpenBuildingId === btn.dataset.id) propOpenBuildingId = null;
      renderUnitsList();
    } catch (err) {
      console.error("Failed to delete building:", err);
      alert(err.message || String(err));
      btn.disabled = false;
    }
  }));
}

// ---------- Apartments of the open building ----------
document.getElementById("unitSearch")?.addEventListener("input", renderUnitsList);

function renderUnitsList() {
  const card = document.getElementById("unitsCard");
  const el = document.getElementById("unitsList");
  if (!card || !el) return;
  const b = propOpenBuildingId ? propBuildingById(propOpenBuildingId) : null;
  if (!b) { card.style.display = "none"; return; }
  card.style.display = "block";
  // These rows are redrawn by live listeners (a resident signing up, another admin
  // saving). Redrawing while someone is typing a name into one of them would wipe
  // what they wrote, so the redraw waits until the field loses focus. Buttons don't
  // count — a click has to be allowed to redraw the list it came from.
  if (propIsEditing(el)) return;

  const term = (document.getElementById("unitSearch")?.value || "").trim().toLowerCase();
  const all = propUnitsOf(b.id);
  const filtered = all.filter(u =>
    !term || `${u.code || ""} ${u.residentName || ""} ${u.residentPhone || ""}`.toLowerCase().includes(term));
  const shown = filtered.slice(0, PROP_UNITS_PAGE);

  const title = document.getElementById("unitsCardTitle");
  if (title) {
    title.textContent = `${t("unitsTitle")} · ${b.name || b.code} (${t("unitsShowing")} ${shown.length}/${all.length})`;
  }
  if (all.length === 0) { el.innerHTML = `<p class="empty-state">${t("noUnitsInBuilding")}</p>`; return; }

  // Residents who already hold another apartment are still listed (moving one is
  // allowed, with a confirmation) — hiding them would make a move impossible.
  const residentOptions = (selectedId) => `
    <option value="">${t("unitNoAccount")}</option>` +
    residentsCache
      .slice()
      .sort((a, b2) => String(a.name || a.email || "").localeCompare(String(b2.name || b2.email || "")))
      .map(r => `<option value="${r.id}" ${selectedId === r.id ? "selected" : ""}>${propEsc(r.name || r.email || r.id)}${r.unit ? ` · ${propEsc(r.unit)}` : ""}</option>`)
      .join("");

  // With hundreds of apartments the list has to stay scannable, so a row is just
  // "number · status · who lives there" until the admin opens it for editing.
  el.innerHTML = shown.map(u => {
    const occupied = propIsOccupied(u);
    const editing = propEditUnitId === u.id;
    const who = (u.residentName || "").trim();
    const form = !editing ? "" : `
          <div class="field" style="margin:6px 0 0">
            <label>${t("unitResidentAccount")}</label>
            <select class="unit-acc">${residentOptions(u.residentId || "")}</select>
          </div>
          <div class="field" style="margin:6px 0 0">
            <label>${t("unitResidentNameLabel")}</label>
            <input type="text" class="unit-name" value="${propEsc(u.residentName || "")}" placeholder="${t("unitResidentNamePh")}">
          </div>
          <div class="field" style="margin:6px 0 0">
            <label>${t("unitPhoneLabel")}</label>
            <input type="text" class="unit-phone" value="${propEsc(u.residentPhone || "")}" placeholder="${t("unitPhonePh")}">
          </div>
          <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
            <button type="button" class="btn btn-sm btn-primary unit-save">${t("unitSave")}</button>
            ${occupied ? `<button type="button" class="btn btn-sm btn-outline unit-clear">${t("unitClear")}</button>` : ""}
          </div>`;
    return `
      <div class="list-item unit-row" data-id="${u.id}">
        <div class="meta">
          <div class="title">${propEsc(u.code)} <span class="badge ${occupied ? "active" : "pending"}">${occupied ? t("unitOccupied") : t("unitVacant")}</span></div>
          <div class="sub">${u.floor ? `${t("unitFloorLabel")} ${u.floor} · ` : ""}${who ? `👤 ${propEsc(who)}` : "—"}${u.residentPhone ? ` · ${propEsc(u.residentPhone)}` : ""}</div>
          ${form}
        </div>
        <button type="button" class="btn btn-sm ${editing ? "btn-primary" : "btn-outline"} unit-edit">${editing ? t("areaCancel") : t("unitEdit")}</button>
      </div>`;
  }).join("");

  el.querySelectorAll(".unit-edit").forEach(btn => btn.addEventListener("click", () => {
    const id = btn.closest(".unit-row").dataset.id;
    propEditUnitId = propEditUnitId === id ? null : id;
    renderUnitsList();
  }));

  // Picking an account fills the name box automatically, so the apartment always
  // carries a readable name even when the list is read by someone else later.
  el.querySelectorAll(".unit-acc").forEach(sel => sel.addEventListener("change", () => {
    const row = sel.closest(".unit-row");
    const r = residentsCache.find(x => x.id === sel.value);
    if (r) row.querySelector(".unit-name").value = r.name || r.email || "";
  }));

  el.querySelectorAll(".unit-save").forEach(btn => btn.addEventListener("click", async () => {
    const row = btn.closest(".unit-row");
    const saved = await propSaveUnit(row.dataset.id, {
      residentId: row.querySelector(".unit-acc").value || null,
      residentName: row.querySelector(".unit-name").value.trim(),
      residentPhone: row.querySelector(".unit-phone").value.trim()
    }, btn);
    if (saved) { propEditUnitId = null; renderUnitsList(); }
  }));

  el.querySelectorAll(".unit-clear").forEach(btn => btn.addEventListener("click", async () => {
    const row = btn.closest(".unit-row");
    const cleared = await propSaveUnit(row.dataset.id, { residentId: null, residentName: "", residentPhone: "" }, btn);
    if (cleared) { propEditUnitId = null; renderUnitsList(); }
  }));
}

// Returns true when the apartment was actually written, so the caller knows
// whether to close the row (a cancelled move or a failed write keeps it open).
async function propSaveUnit(unitId, data, btn) {
  const u = propUnits.find(x => x.id === unitId);
  if (!u) return false;
  const previousResidentId = u.residentId || null;
  // One account can only live in one apartment: if it already sits somewhere else,
  // the admin is asked, and the old apartment is emptied rather than duplicated.
  const clash = data.residentId ? propUnits.find(x => x.id !== unitId && x.residentId === data.residentId) : null;
  if (clash && !confirm(`${t("unitMoveConfirm")}\n${clash.code}`)) return false;
  btn.disabled = true;
  try {
    const ops = [];
    ops.push((batch) => batch.update(doc(db, "units", unitId), {
      residentId: data.residentId,
      residentName: data.residentName,
      residentPhone: data.residentPhone,
      status: (data.residentId || data.residentName) ? "occupied" : "vacant",
      updatedAt: serverTimestamp()
    }));
    if (clash) {
      ops.push((batch) => batch.update(doc(db, "units", clash.id), {
        residentId: null, residentName: "", residentPhone: "", status: "vacant", updatedAt: serverTimestamp()
      }));
    }
    // Keep the resident's own profile in step: everything else in the app (payments,
    // call center lookup, maintenance requests) is keyed on users/{uid}.unit.
    if (data.residentId) {
      ops.push((batch) => batch.update(doc(db, "users", data.residentId), {
        unit: u.code, buildingId: u.buildingId, buildingName: u.buildingName || ""
      }));
    }
    if (previousResidentId && previousResidentId !== data.residentId) {
      const old = residentsCache.find(r => r.id === previousResidentId);
      if (old && old.unit === u.code) {
        ops.push((batch) => batch.update(doc(db, "users", previousResidentId), { unit: "", buildingId: null, buildingName: "" }));
      }
    }
    await propCommitOps(ops);
    return true;
  } catch (err) {
    console.error("Failed to save apartment:", err);
    alert(err.message || t("propSaveFailed"));
    return false;
  } finally {
    btn.disabled = false;
  }
}

window.addEventListener("so-lang-changed", () => { renderBuildingsList(); renderUnitsList(); renderPropStats(); });

// ==========================================================================
// COMMON AREAS — the shared parts of the compound (Operations → Areas tab)
//
// Data model added here:
//   commonAreas/{id}  name, type, scope(compound|building), buildingId, buildingName,
//                     workerId|null, workerName, category, frequency(daily|weekly|biweekly|monthly),
//                     task, lastServiceAt, lastServiceType(ordinary|extraordinary), createdAt
//
// An area is a *standing responsibility*: one worker keeps it clean and in order.
// The actual work still travels through the existing queue — both the routine round
// and a one-off extraordinary job create a normal maintenanceRequests document with
// source "onsite", so the worker sees it on their own screen, the estimate/queue math
// applies to it, and nothing about the worker app had to change.
// ==========================================================================
const AREA_TYPE_I18N = {
  lobby: "areaTypeLobby", stairs: "areaTypeStairs", elevator: "areaTypeElevator",
  garden: "areaTypeGarden", pool: "areaTypePool", garage: "areaTypeGarage",
  gate: "areaTypeGate", street: "areaTypeStreet", gym: "areaTypeGym",
  playground: "areaTypePlayground", roof: "areaTypeRoof", water: "areaTypeWater",
  other: "areaTypeOther"
};
const AREA_FREQ_I18N = { daily: "freqDaily", weekly: "freqWeekly", biweekly: "freqBiweekly", monthly: "freqMonthly" };
// Security staff guard the gates; they're never the ones assigned to clean or repair an area.
const AREA_WORKER_TYPES = ["cleaning", "maintenance", "garden", "porter"];

function areaTypeLabel(type) { return t(AREA_TYPE_I18N[type] || "areaTypeOther"); }
function areaFreqLabel(f) { return t(AREA_FREQ_I18N[f] || "freqWeekly"); }
function areaEligibleWorkers() {
  return workerOptionsCache.filter(w =>
    AREA_WORKER_TYPES.includes(w.workerType) && (w.accountStatus || "active") === "active");
}
function areaWorkerOptionsHtml(selectedId) {
  return `<option value="">${t("selectWorkerOption")}</option>` +
    areaEligibleWorkers().map(w =>
      `<option value="${w.id}" ${selectedId === w.id ? "selected" : ""}>${opsEsc(w.name || w.email || w.id)} (${workerTypeLabel(w.workerType)})</option>`).join("");
}
function areaDisplayName(a) {
  return a.nameKey ? t(a.nameKey) : a.name;
}
function areaPlaceLabel(a) {
  const n = areaDisplayName(a);
  return a.scope === "building" && a.buildingName ? `${n} · ${a.buildingName}` : n;
}
function areaOpenJobs(areaId) {
  return lastMaintDocs.filter(m => m.areaId === areaId && m.status !== "completed").length;
}

onSnapshot(collection(db, "commonAreas"), (snap) => {
  areaDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(areaPlaceLabel(a)).localeCompare(String(areaPlaceLabel(b))));
  renderAreasList();
}, (err) => console.error("Common areas listener failed:", err));

// ---------- "Add a common area" form ----------
function renderAreaWorkerOptions() {
  const sel = document.getElementById("areaWorker");
  if (!sel) return;
  const previous = sel.value;
  sel.innerHTML = areaWorkerOptionsHtml(previous);
  if (areaEligibleWorkers().some(w => w.id === previous)) sel.value = previous;
}

// The bulk selector lists the area kinds actually in use, so it never offers a
// choice that would match nothing.
function renderAreaBulkOptions() {
  const typeSel = document.getElementById("bulkAreaType");
  const workerSel = document.getElementById("bulkAreaWorker");
  if (!typeSel || !workerSel) return;
  const prevType = typeSel.value, prevWorker = workerSel.value;
  const used = [...new Set(areaDocs.map(a => a.type))];
  typeSel.innerHTML = `<option value="__unassigned">${t("areaBulkAll")}</option>` +
    used.map(ty => `<option value="${ty}">${areaTypeLabel(ty)}</option>`).join("");
  if ([...typeSel.options].some(o => o.value === prevType)) typeSel.value = prevType;
  workerSel.innerHTML = areaWorkerOptionsHtml(prevWorker);
  if (areaEligibleWorkers().some(w => w.id === prevWorker)) workerSel.value = prevWorker;
}

document.getElementById("bulkAreaBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("bulkAreaBtn");
  const type = document.getElementById("bulkAreaType").value;
  const workerId = document.getElementById("bulkAreaWorker").value;
  if (!workerId) { alert(t("areaPickWorker")); return; }
  const targets = areaDocs.filter(a => type === "__unassigned" ? !a.workerId : a.type === type);
  if (targets.length === 0) { alert(t("areaBulkNone")); return; }
  if (!confirm(`${t("areaBulkConfirm")} (${targets.length})`)) return;
  const w = workerOptionsCache.find(x => x.id === workerId);
  btn.disabled = true;
  try {
    await propCommitOps(targets.map(a => (batch) => batch.update(doc(db, "commonAreas", a.id), {
      workerId, workerName: w ? (w.name || w.email || "") : ""
    })));
    alert(`${t("areaBulkDone")} (${targets.length})`);
  } catch (err) {
    console.error("Bulk area assignment failed:", err);
    alert(err.message || String(err));
  } finally {
    btn.disabled = false;
  }
});

function renderAreaBuildingOptions() {
  const sel = document.getElementById("areaBuilding");
  if (!sel) return;
  const previous = sel.value;
  sel.innerHTML = propBuildings.map(b => `<option value="${b.id}">${propEsc(b.name || b.code)}</option>`).join("");
  if (propBuildings.some(b => b.id === previous)) sel.value = previous;
}

document.getElementById("areaScope")?.addEventListener("change", () => {
  const isBuilding = document.getElementById("areaScope").value === "building";
  document.getElementById("areaBuildingField").style.display = isBuilding ? "block" : "none";
});

document.getElementById("addAreaBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("addAreaBtn");
  const errEl = document.getElementById("areaError");
  errEl.style.display = "none";
  const name = document.getElementById("areaName").value.trim();
  if (!name) {
    errEl.textContent = t("fillAreaFields");
    errEl.style.display = "block";
    return;
  }
  const scope = document.getElementById("areaScope").value;
  const buildingId = scope === "building" ? (document.getElementById("areaBuilding").value || null) : null;
  const building = buildingId ? propBuildingById(buildingId) : null;
  const workerId = document.getElementById("areaWorker").value || null;
  const worker = workerId ? workerOptionsCache.find(w => w.id === workerId) : null;
  btn.disabled = true;
  try {
    await addDoc(collection(db, "commonAreas"), {
      name,
      type: document.getElementById("areaType").value,
      scope,
      buildingId,
      buildingName: building ? (building.name || building.code) : "",
      workerId,
      workerName: worker ? (worker.name || worker.email || "") : "",
      category: document.getElementById("areaCategory").value,
      frequency: document.getElementById("areaFrequency").value,
      task: document.getElementById("areaTask").value.trim(),
      lastServiceAt: null,
      createdBy: user.uid,
      createdAt: serverTimestamp()
    });
    document.getElementById("areaName").value = "";
    document.getElementById("areaTask").value = "";
    alert(t("areaAdded"));
  } catch (err) {
    console.error("Failed to add common area:", err);
    errEl.textContent = err.message || String(err);
    errEl.style.display = "block";
  } finally {
    btn.disabled = false;
  }
});

// ---------- Standard areas for every building ----------
// Saves the owner from typing the same three entries 30 times over.
const AREA_STANDARD_SET = [
  { key: "lobby",    type: "lobby",    category: "Cleaning", frequency: "daily" },
  { key: "stairs",   type: "stairs",   category: "Cleaning", frequency: "daily" },
  { key: "elevator", type: "elevator", category: "Other",    frequency: "monthly" }
];

document.getElementById("areaStandardBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("areaStandardBtn");
  if (propBuildings.length === 0) { alert(t("areaNoBuildings")); return; }
  if (!confirm(t("areaStandardConfirm"))) return;
  btn.disabled = true;
  try {
    const ops = [];
    propBuildings.forEach(b => {
      AREA_STANDARD_SET.forEach(std => {
        // Skip anything already registered for this building, so the button is safe
        // to press twice (after adding new buildings, for instance).
        const exists = areaDocs.some(a => a.buildingId === b.id && a.type === std.type);
        if (exists) return;
        const ref = doc(collection(db, "commonAreas"));
        ops.push((batch) => batch.set(ref, {
          name: t(AREA_TYPE_I18N[std.type]),
          // Auto-created areas keep the key they were named from, so their label
          // follows the language switch instead of freezing in whichever language
          // the admin happened to be using when the button was pressed.
          nameKey: AREA_TYPE_I18N[std.type],
          type: std.type,
          scope: "building",
          buildingId: b.id,
          buildingName: b.name || b.code,
          workerId: null,
          workerName: "",
          category: std.category,
          frequency: std.frequency,
          task: "",
          lastServiceAt: null,
          createdBy: user.uid,
          createdAt: serverTimestamp()
        }));
      });
    });
    if (ops.length === 0) { alert(t("areaStandardDone")); return; }
    await propCommitOps(ops);
    alert(t("areaStandardDone"));
  } catch (err) {
    console.error("Failed to create standard areas:", err);
    alert(err.message || String(err));
  } finally {
    btn.disabled = false;
  }
});

// ---------- Areas list ----------
document.getElementById("areaSearch")?.addEventListener("input", renderAreasList);

function renderAreaStats() {
  const withWorker = areaDocs.filter(a => a.workerId).length;
  const openJobs = lastMaintDocs.filter(m => m.areaId && m.status !== "completed").length;
  const set = (id, v) => { const node = document.getElementById(id); if (node) node.textContent = v; };
  set("statAreas", areaDocs.length);
  set("statAreasAssigned", withWorker);
  set("statAreasFree", areaDocs.length - withWorker);
  set("statAreaJobs", openJobs);
}

function renderAreasList() {
  renderAreaStats();
  renderAreaBulkOptions();
  const el = document.getElementById("areasList");
  if (!el) return;
  // Same reason as the apartment rows: never redraw under someone's fingers while
  // they are typing an extraordinary job into the panel.
  if (propIsEditing(el)) return;
  const term = (document.getElementById("areaSearch")?.value || "").trim().toLowerCase();
  const rows = areaDocs.filter(a =>
    !term || `${areaDisplayName(a) || ""} ${a.buildingName || ""} ${a.workerName || ""}`.toLowerCase().includes(term));
  if (rows.length === 0) { el.innerHTML = `<p class="empty-state">${t("noAreasYet")}</p>`; return; }

  // 30 buildings × their standard areas is a long list, so a row stays compact —
  // name, where it is, who has it — until the admin opens it to act on it.
  el.innerHTML = rows.map(a => {
    const open = areaOpenJobs(a.id);
    const editing = areaEditId === a.id;
    const name = areaDisplayName(a);
    const typeText = areaTypeLabel(a.type);
    const place = a.scope === "building" && a.buildingName ? a.buildingName : t("scopeCompound");
    const last = a.lastServiceAt?.seconds
      ? new Date(a.lastServiceAt.seconds * 1000).toLocaleDateString(window.SO_I18N && window.SO_I18N.getLang() === "ar" ? "ar-EG" : "en-GB",
          { day: "numeric", month: "short", year: "numeric" })
      : t("areaNever");
    const extraPanel = areaExtraOpenId === a.id ? `
      <div class="area-extra" style="margin-top:10px;padding:10px;border:1px dashed #cfdbd6;border-radius:10px">
        <div style="font-size:12px;font-weight:700;margin-bottom:8px">${t("areaExtraTitle")}</div>
        <div class="field" style="margin-bottom:8px">
          <label>${t("areaCategoryLabel")}</label>
          <select class="area-ex-cat">
            ${Object.keys(CATEGORY_I18N_KEY).map(c => `<option value="${c}" ${a.category === c ? "selected" : ""}>${categoryLabel(c)}</option>`).join("")}
          </select>
        </div>
        <div class="field" style="margin-bottom:8px">
          <label>${t("areaAssignTo")}</label>
          <select class="area-ex-worker">${areaWorkerOptionsHtml(a.workerId || "")}</select>
        </div>
        <div class="field" style="margin-bottom:8px">
          <textarea class="area-ex-desc" placeholder="${t("areaExtraDescPh")}"></textarea>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button type="button" class="btn btn-sm btn-primary area-ex-send" data-id="${a.id}">${t("areaCreateJob")}</button>
          <button type="button" class="btn btn-sm btn-outline area-ex-cancel">${t("areaCancel")}</button>
        </div>
      </div>` : "";
    const panel = !editing ? "" : `
          ${a.task ? `<div class="sub" style="margin-top:6px">🧹 ${opsEsc(a.task)}</div>` : ""}
          <div class="field" style="margin:8px 0 0">
            <label>${t("areaWorkerLabel")}</label>
            <select class="area-worker">${areaWorkerOptionsHtml(a.workerId || "")}</select>
          </div>
          <div class="field" style="margin:6px 0 0">
            <label>${t("areaFrequencyLabel")}</label>
            <select class="area-freq">
              ${Object.keys(AREA_FREQ_I18N).map(f => `<option value="${f}" ${a.frequency === f ? "selected" : ""}>${areaFreqLabel(f)}</option>`).join("")}
            </select>
          </div>
          <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
            <button type="button" class="btn btn-sm btn-primary area-ordinary" data-id="${a.id}">${t("areaSendOrdinary")}</button>
            <button type="button" class="btn btn-sm btn-accent area-extra-open" data-id="${a.id}">${t("areaSendExtra")}</button>
            <button type="button" class="btn btn-sm btn-danger area-del" data-id="${a.id}">${t("areaDelete")}</button>
          </div>
          ${extraPanel}`;
    return `
      <div class="list-item area-row" data-id="${a.id}">
        <div class="meta">
          <div class="title">${opsEsc(name)} <span style="font-size:11px;font-weight:400;color:var(--muted)">${opsEsc(place)}</span></div>
          <div class="sub">${a.workerId ? `👷 ${opsEsc(a.workerName || "")}` : `<span class="badge pending">${t("areaUnassigned")}</span>`} · ${areaFreqLabel(a.frequency)}</div>
          <div class="sub" style="font-size:11px;color:#7b8a85">${name === typeText ? "" : typeText + " · "}${t("areaLastService")}: ${last}${open ? ` · ${open} ${t("statAreaJobs").toLowerCase()}` : ""}</div>
          ${panel}
        </div>
        <button type="button" class="btn btn-sm ${editing ? "btn-primary" : "btn-outline"} area-edit">${editing ? t("areaCancel") : t("unitEdit")}</button>
      </div>`;
  }).join("");

  el.querySelectorAll(".area-edit").forEach(btn => btn.addEventListener("click", () => {
    const id = btn.closest(".area-row").dataset.id;
    areaEditId = areaEditId === id ? null : id;
    if (areaEditId !== id) areaExtraOpenId = null;
    renderAreasList();
  }));

  // Changing the worker or the frequency saves straight away — it's a standing
  // responsibility, not a form the admin has to remember to submit.
  el.querySelectorAll(".area-worker").forEach(sel => sel.addEventListener("change", async () => {
    const id = sel.closest(".area-row").dataset.id;
    const w = workerOptionsCache.find(x => x.id === sel.value);
    try {
      await updateDoc(doc(db, "commonAreas", id), {
        workerId: sel.value || null,
        workerName: w ? (w.name || w.email || "") : ""
      });
    } catch (err) {
      console.error("Failed to assign area worker:", err);
      alert(err.message || String(err));
    }
  }));

  el.querySelectorAll(".area-freq").forEach(sel => sel.addEventListener("change", async () => {
    const id = sel.closest(".area-row").dataset.id;
    try {
      await updateDoc(doc(db, "commonAreas", id), { frequency: sel.value });
    } catch (err) {
      console.error("Failed to change area frequency:", err);
      alert(err.message || String(err));
    }
  }));

  el.querySelectorAll(".area-ordinary").forEach(btn => btn.addEventListener("click", async () => {
    const a = areaDocs.find(x => x.id === btn.dataset.id);
    if (!a) return;
    if (!a.workerId) { alert(t("areaPickWorker")); return; }
    btn.disabled = true;
    try {
      await areaCreateJob(a, {
        taskType: "ordinary",
        category: a.category || "Cleaning",
        workerId: a.workerId,
        description: a.task || `${t("areaOrdinaryTag")} · ${areaFreqLabel(a.frequency)}`
      });
      alert(t("areaJobCreated"));
    } catch (err) {
      console.error("Failed to send routine job:", err);
      alert(err.message || String(err));
    } finally {
      btn.disabled = false;
    }
  }));

  el.querySelectorAll(".area-extra-open").forEach(btn => btn.addEventListener("click", () => {
    areaExtraOpenId = areaExtraOpenId === btn.dataset.id ? null : btn.dataset.id;
    renderAreasList();
  }));
  el.querySelectorAll(".area-ex-cancel").forEach(btn => btn.addEventListener("click", () => {
    areaExtraOpenId = null;
    renderAreasList();
  }));

  el.querySelectorAll(".area-ex-send").forEach(btn => btn.addEventListener("click", async () => {
    const row = btn.closest(".area-row");
    const a = areaDocs.find(x => x.id === btn.dataset.id);
    if (!a) return;
    const workerId = row.querySelector(".area-ex-worker").value;
    const description = row.querySelector(".area-ex-desc").value.trim();
    if (!workerId) { alert(t("areaPickWorker")); return; }
    if (!description) { alert(t("areaDescribeJob")); return; }
    btn.disabled = true;
    try {
      await areaCreateJob(a, {
        taskType: "extraordinary",
        category: row.querySelector(".area-ex-cat").value,
        workerId,
        description
      });
      areaExtraOpenId = null;
      renderAreasList();
      alert(t("areaJobCreated"));
    } catch (err) {
      console.error("Failed to send extraordinary job:", err);
      alert(err.message || String(err));
      btn.disabled = false;
    }
  }));

  el.querySelectorAll(".area-del").forEach(btn => btn.addEventListener("click", async () => {
    if (!confirm(t("areaDeleteConfirm"))) return;
    btn.disabled = true;
    try {
      // Jobs already sent for this area stay in the request history — they carry
      // their own copy of the area name, so deleting the area doesn't blank them.
      await propCommitOps([(batch) => batch.delete(doc(db, "commonAreas", btn.dataset.id))]);
    } catch (err) {
      console.error("Failed to delete area:", err);
      alert(err.message || String(err));
      btn.disabled = false;
    }
  }));
}

// Both kinds of job land in the same queue the workers already use.
async function areaCreateJob(area, { taskType, category, workerId, description }) {
  await addDoc(collection(db, "maintenanceRequests"), {
    source: "onsite",              // required by the Firestore rule for admin-created jobs
    taskType,                      // ordinary | extraordinary
    areaId: area.id,
    areaName: areaDisplayName(area),
    category,
    description,
    location: areaPlaceLabel(area),
    assignedWorkerId: workerId,
    status: "accepted",
    statusSeenByResident: true,
    createdBy: user.uid,
    createdAt: serverTimestamp()
  });
  await updateDoc(doc(db, "commonAreas", area.id), {
    lastServiceAt: serverTimestamp(),
    lastServiceType: taskType
  });
}

window.addEventListener("so-lang-changed", () => { renderAreasList(); renderAreaWorkerOptions(); renderAreaBulkOptions(); });
