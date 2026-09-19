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

// ---------- Dashboards (Residents / Operations) & tabs ----------
// The admin panel is split into two dashboards: "res" (residents, finance, announcements)
// and "ops" (access, personnel, maintenance). Each tab-btn/section carries a data-dashboard
// attribute; switching dashboards just filters which tab buttons are visible and jumps to
// a tab inside that dashboard (remembering the last one visited per dashboard).
const ALL_TABS = ["residents", "announcements", "access", "workers", "finance", "maint"];
const DASHBOARD_TABS = {
  res: ["residents", "finance", "announcements"],
  ops: ["access", "workers", "maint"]
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
  renderOnsiteWorkerOptions();
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
  renderMaintStats();
  recomputeQueuePositions();
});

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
