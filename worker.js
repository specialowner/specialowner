import { db } from "./firebase-config.js";
import { requireAuth, logout } from "./guard.js";
import { openDataUrl, preparePhotoFile } from "./proof-file.js";
import { renderLeaveBalanceInto } from "./leave-accrual.js";
import { openPayslip } from "./payslip.js";
import { handleAccessScan } from "./access-flow.js";
import {
  collection, addDoc, doc, getDoc, getDocs, updateDoc, query, where, orderBy,
  onSnapshot, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// Optional media renderer: if announcement-media.js is missing, announcements still show (text only).
let announcementMediaHtml = () => "";
try { ({ announcementMediaHtml } = await import("./announcement-media.js")); }
catch (e) { console.error("announcement-media.js failed to load:", e); }
const { user, profile } = await requireAuth("worker");

function t(key) {
  const lang = window.SO_I18N ? window.SO_I18N.getLang() : "en";
  return window.SO_I18N ? window.SO_I18N.translations[lang][key] : key;
}

const WORKER_TYPE_I18N_KEY = {
  security: "security",
  maintenance: "maintenanceStaff",
  cleaning: "cleaningStaff",
  porter: "porterStaff",
  garden: "gardenStaff"
};

const workerType = profile.workerType || "maintenance"; // security | maintenance | cleaning | porter | garden
const isSecurity = workerType === "security";

function renderGreeting() {
  document.getElementById("greetName").textContent = `${t("hiThere")}, ${profile.name?.split(" ")[0] || ""} 👋`;
  document.getElementById("greetRole").textContent = t(WORKER_TYPE_I18N_KEY[workerType] || workerType) || workerType;
}
renderGreeting();
window.addEventListener("so-lang-changed", renderGreeting);
document.getElementById("logoutBtn").addEventListener("click", logout);

// Show only the tab relevant to this worker's category.
if (isSecurity) {
  document.getElementById("scannerTabBtn").style.display = "flex";
} else {
  document.getElementById("ordersTabBtn").style.display = "flex";
  // Orders is the actual reason non-security staff are hired, so it comes first
  // and opens by default instead of Home.
  const tabbar = document.getElementById("tabbar");
  const homeBtn = document.querySelector('.tab-btn[data-tab="home"]');
  const ordersBtn = document.getElementById("ordersTabBtn");
  tabbar.insertBefore(ordersBtn, homeBtn);
}

// ---------- Tabs ----------
const tabs = document.querySelectorAll(".tab-btn");
let scannerStarted = false;
function activateTab(tabName) {
  tabs.forEach(b => b.classList.toggle("active", b.dataset.tab === tabName));
  ["home", "scanner", "orders"].forEach(tab => {
    const section = document.getElementById(`tab-${tab}`);
    if (section) section.style.display = (tab === tabName) ? "block" : "none";
  });
  if (tabName === "scanner" && isSecurity) startScanner();
}
tabs.forEach(btn => btn.addEventListener("click", () => activateTab(btn.dataset.tab)));
activateTab(isSecurity ? "home" : "orders");

// ---------- Today's date + leave balance ----------
function renderTodayDate() {
  const lang = window.SO_I18N ? window.SO_I18N.getLang() : "en";
  const locale = lang === "ar" ? "ar-EG" : "en-US";
  document.getElementById("todayDate").textContent = new Date().toLocaleDateString(locale, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}
renderTodayDate();
window.addEventListener("so-lang-changed", renderTodayDate);

function renderLeaveBalance() {
  renderLeaveBalanceInto(document.getElementById("leaveBalanceAmount"), window.__userData || {}, window.__leaveRows || [], t);
}

// ---------- Account status (pending / active / suspended) + salary ----------
let currentAccountStatus = "active";
let activationRequestPending = false;
const userDocRef = doc(db, "users", user.uid);
onSnapshot(userDocRef, (snap) => {
  const data = snap.data() || {};
  currentAccountStatus = data.accountStatus || "active";
  activationRequestPending = data.activationRequestStatus === "pending";

  window.__userData = data;
  renderLeaveBalance();

  const basic = data.salaryBasic || 0;
  const allowances = data.salaryAllowances || 0;
  const incentives = data.salaryIncentives || 0;
  const deductions = data.salaryDeductions || 0;
  const net = basic + allowances + incentives - deductions;
  const hasBreakdown = data.salaryBasic || data.salaryAllowances || data.salaryIncentives || data.salaryDeductions;

  document.getElementById("salaryBasicVal").textContent = `EGP ${basic}`;
  document.getElementById("salaryAllowancesVal").textContent = `EGP ${allowances}`;
  document.getElementById("salaryIncentivesVal").textContent = `EGP ${incentives}`;
  document.getElementById("salaryDeductionsVal").textContent = `EGP ${deductions}`;
  // Fall back to the old flat "salary" field for accounts that haven't been switched to the new breakdown yet.
  document.getElementById("salaryAmount").textContent = hasBreakdown
    ? `EGP ${net}`
    : (data.salary ? `EGP ${data.salary}` : "—");

  renderAccountStatus();
});

async function requestActivation() {
  if (activationRequestPending) { alert(t("requestAlreadySent")); return; }
  try {
    await updateDoc(userDocRef, {
      activationRequestStatus: "pending",
      activationRequestedAt: serverTimestamp()
    });
    alert(t("requestSent"));
  } catch (err) {
    console.error("Activation request failed:", err);
    alert(err.message || err);
  }
}
document.getElementById("requestActivationBtnScanner").addEventListener("click", requestActivation);
document.getElementById("requestActivationBtnOrders").addEventListener("click", requestActivation);

function renderAccountStatus() {
  const isLocked = currentAccountStatus !== "active";
  const banner = document.getElementById("statusBanner");
  if (isLocked) {
    banner.style.display = "block";
    banner.textContent = currentAccountStatus === "suspended" ? t("statusSuspendedBanner") : t("statusPendingBanner");
  } else {
    banner.style.display = "none";
  }

  const lockMsg = isLocked ? (currentAccountStatus === "suspended" ? t("lockedMsgSuspended") : t("lockedMsgPending")) : "";

  document.getElementById("scannerLockCard").style.display = isLocked ? "block" : "none";
  document.getElementById("scannerUnlockedArea").style.display = isLocked ? "none" : "block";
  document.getElementById("scannerLockMsg").textContent = lockMsg;

  document.getElementById("ordersLockCard").style.display = isLocked ? "block" : "none";
  document.getElementById("ordersUnlockedArea").style.display = isLocked ? "none" : "block";
  document.getElementById("ordersLockMsg").textContent = lockMsg;

  document.getElementById("clockInBtn").disabled = isLocked;
  document.getElementById("startBreakBtn").disabled = isLocked;
  document.getElementById("endBreakBtn").disabled = isLocked;
  document.getElementById("submitLeaveBtn").disabled = isLocked;
  document.getElementById("submitAdvanceBtn").disabled = isLocked;
}

// ---------- Attendance (clock in / out / break) ----------
let openShiftId = null;
let onBreak = false;
let breakStart = null; // Firestore Timestamp of the currently running break, if any
const attendanceQ = query(collection(db, "attendance"), where("workerId", "==", user.uid), where("status", "==", "open"));
onSnapshot(attendanceQ, (snap) => {
  if (snap.empty) {
    openShiftId = null;
    onBreak = false;
    breakStart = null;
    document.getElementById("shiftStatusText").textContent = t("shiftClosed");
    document.getElementById("clockInBtn").style.display = "block";
    document.getElementById("clockOutBtn").style.display = "none";
    document.getElementById("startBreakBtn").style.display = "none";
    document.getElementById("endBreakBtn").style.display = "none";
  } else {
    const d = snap.docs[0];
    openShiftId = d.id;
    const data = d.data();
    onBreak = !!data.onBreak;
    breakStart = data.breakStart || null;
    const clockIn = data.clockIn;
    const timeStr = clockIn?.toDate ? clockIn.toDate().toLocaleString() : "";

    if (onBreak) {
      const bStr = breakStart?.toDate ? breakStart.toDate().toLocaleTimeString() : "";
      document.getElementById("shiftStatusText").textContent = `${t("onBreakSince")} ${bStr}`;
    } else {
      document.getElementById("shiftStatusText").textContent = `${t("shiftOpenSince")} ${timeStr}`;
    }

    document.getElementById("clockInBtn").style.display = "none";
    // Must end the break before clocking out, so the shift's total time stays accurate.
    document.getElementById("clockOutBtn").style.display = onBreak ? "none" : "block";
    document.getElementById("startBreakBtn").style.display = onBreak ? "none" : "block";
    document.getElementById("endBreakBtn").style.display = onBreak ? "block" : "none";
  }
});

document.getElementById("clockInBtn").addEventListener("click", async () => {
  if (currentAccountStatus !== "active") { alert(currentAccountStatus === "suspended" ? t("lockedMsgSuspended") : t("lockedMsgPending")); return; }
  await addDoc(collection(db, "attendance"), {
    workerId: user.uid,
    workerName: profile.name || "",
    clockIn: serverTimestamp(),
    clockOut: null,
    status: "open",
    onBreak: false,
    breakStart: null,
    totalBreakSeconds: 0,
    date: new Date().toISOString().slice(0, 10)
  });
});

document.getElementById("clockOutBtn").addEventListener("click", async () => {
  if (!openShiftId) return;
  await updateDoc(doc(db, "attendance", openShiftId), { clockOut: serverTimestamp(), status: "closed" });
});

document.getElementById("startBreakBtn").addEventListener("click", async () => {
  if (currentAccountStatus !== "active") { alert(currentAccountStatus === "suspended" ? t("lockedMsgSuspended") : t("lockedMsgPending")); return; }
  if (!openShiftId) return;
  await updateDoc(doc(db, "attendance", openShiftId), { onBreak: true, breakStart: serverTimestamp() });
});

document.getElementById("endBreakBtn").addEventListener("click", async () => {
  if (!openShiftId || !breakStart) return;
  const startMs = breakStart.toDate ? breakStart.toDate().getTime() : Date.now();
  const elapsedSeconds = Math.max(0, Math.round((Date.now() - startMs) / 1000));
  const shiftSnap = await getDoc(doc(db, "attendance", openShiftId));
  const prevTotal = shiftSnap.exists() ? (shiftSnap.data().totalBreakSeconds || 0) : 0;
  await updateDoc(doc(db, "attendance", openShiftId), {
    onBreak: false,
    breakStart: null,
    totalBreakSeconds: prevTotal + elapsedSeconds
  });
});

// ---------- Leave requests ----------
document.getElementById("submitLeaveBtn").addEventListener("click", async () => {
  if (currentAccountStatus !== "active") { alert(currentAccountStatus === "suspended" ? t("lockedMsgSuspended") : t("lockedMsgPending")); return; }
  const fromDate = document.getElementById("leaveFrom").value;
  const toDate = document.getElementById("leaveTo").value;
  const reason = document.getElementById("leaveReason").value.trim();
  if (!fromDate || !toDate) { alert(t("fillLeaveDates") || "Please fill in both dates."); return; }

  await addDoc(collection(db, "leaveRequests"), {
    workerId: user.uid,
    workerName: profile.name || "",
    fromDate, toDate, reason,
    status: "pending",
    createdAt: serverTimestamp()
  });
  document.getElementById("leaveFrom").value = "";
  document.getElementById("leaveTo").value = "";
  document.getElementById("leaveReason").value = "";
});

const leaveQ = query(collection(db, "leaveRequests"), where("workerId", "==", user.uid));
onSnapshot(leaveQ, (snap) => {
  window.__leaveRows = snap.docs.map(d => d.data());
  renderLeaveBalance();
  const el = document.getElementById("leaveList");
  if (snap.empty) { el.innerHTML = `<p class="empty-state">${t("noLeaveRequests")}</p>`; return; }
  el.innerHTML = "";
  const rows = snap.docs.map(d => d.data()).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  rows.forEach(r => {
    el.innerHTML += `
      <div class="list-item">
        <div class="meta">
          <div class="title">${r.fromDate} → ${r.toDate}</div>
          <div class="sub">${r.reason || ""}</div>
        </div>
        <span class="badge ${r.status}">${t(r.status)}</span>
      </div>`;
  });
});

// ---------- Salary history (past months, archived by admin) ----------
const salaryHistoryQ = query(collection(db, "salaryRecords"), where("workerId", "==", user.uid));
onSnapshot(salaryHistoryQ, (snap) => {
  const el = document.getElementById("salaryHistoryList");
  if (snap.empty) { el.innerHTML = `<p class="empty-state">${t("noSalaryHistory")}</p>`; return; }
  el.innerHTML = "";
  const rows = snap.docs.map(d => d.data()).sort((a, b) => (b.month || "").localeCompare(a.month || ""));
  rows.forEach((r, i) => {
    el.innerHTML += `
      <div class="list-item">
        <div class="meta">
          <div class="title">${r.month || ""}</div>
          <div class="sub">${t("netSalary")}: EGP ${r.net ?? 0}</div>
        </div>
        <button class="btn btn-sm btn-outline" data-payslip="${i}">${t("payslip")}</button>
      </div>`;
  });
  el.querySelectorAll("button[data-payslip]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const r = rows[Number(btn.dataset.payslip)];
      let att = null;
      try {
        const as = await getDocs(query(collection(db, "attendance"), where("workerId", "==", user.uid)));
        const days = new Set(); let sec = 0;
        as.docs.forEach(d => {
          const a = d.data(), ci = a.clockIn?.toDate ? a.clockIn.toDate() : null, co = a.clockOut?.toDate ? a.clockOut.toDate() : null;
          if (!ci || !co) return;
          const m = `${ci.getFullYear()}-${String(ci.getMonth() + 1).padStart(2, "0")}`;
          if (m !== r.month) return;
          days.add(ci.toDateString());
          sec += Math.max(0, (co - ci) / 1000 - (a.totalBreakSeconds || 0));
        });
        att = { days: days.size, hours: sec / 3600 };
      } catch (e) { console.error(e); }
      openPayslip(r, window.SO_I18N ? window.SO_I18N.getLang() : "ar", att);
    });
  });
});

// ---------- Advance (سلفة) requests ----------
document.getElementById("submitAdvanceBtn").addEventListener("click", async () => {
  if (currentAccountStatus !== "active") { alert(currentAccountStatus === "suspended" ? t("lockedMsgSuspended") : t("lockedMsgPending")); return; }
  const amount = Number(document.getElementById("advanceAmount").value) || 0;
  const months = Number(document.getElementById("advanceMonths").value) || 0;
  const reason = document.getElementById("advanceReason").value.trim();
  if (amount <= 0 || months <= 0) { alert(t("fillAdvanceFields") || "Please enter an amount and number of months."); return; }

  await addDoc(collection(db, "advanceRequests"), {
    workerId: user.uid,
    workerName: profile.name || "",
    amount, months,
    installment: Math.round((amount / months) * 100) / 100,
    reason,
    status: "pending",
    createdAt: serverTimestamp()
  });
  document.getElementById("advanceAmount").value = "";
  document.getElementById("advanceMonths").value = "";
  document.getElementById("advanceReason").value = "";
});

const advanceQ = query(collection(db, "advanceRequests"), where("workerId", "==", user.uid));
onSnapshot(advanceQ, (snap) => {
  const el = document.getElementById("advanceList");
  if (snap.empty) { el.innerHTML = `<p class="empty-state">${t("noAdvanceRequests")}</p>`; return; }
  el.innerHTML = "";
  const rows = snap.docs.map(d => d.data()).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  rows.forEach(r => {
    el.innerHTML += `
      <div class="list-item">
        <div class="meta">
          <div class="title">EGP ${r.amount} · ${r.months} ${t("monthsShort") || ""}</div>
          <div class="sub">${t("installmentLabel") || "Installment"}: EGP ${r.installment}/${t("monthShort") || "mo"} · ${r.reason || ""}</div>
        </div>
        <span class="badge ${r.status}">${t(r.status)}</span>
      </div>`;
  });
});

// ---------- Staff announcements (audience: all | workers) ----------
const annQ = query(collection(db, "announcements"), orderBy("createdAt", "desc"));
onSnapshot(annQ, (snap) => {
  const el = document.getElementById("announcementsList");
  const rows = snap.docs.map(d => d.data())
    .filter(a => !a.audience || a.audience === "all" || a.audience === "workers")
    .filter(a => !a.targetIds || a.targetIds.length === 0 || a.targetIds.includes(user.uid));
  if (rows.length === 0) { el.innerHTML = `<p class="empty-state">${t("noAnnouncements")}</p>`; return; }
  el.innerHTML = "";
  rows.forEach(a => {
    el.innerHTML += `
      <div class="list-item">
        <div class="meta">
          <div class="title">${a.title}</div>
          <div class="sub">${a.body || ""}</div>
          ${announcementMediaHtml(a)}
        </div>
      </div>`;
  });
});

// ---------- Work orders (maintenance / cleaning / porter / garden) ----------
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
// Where the order came from: the resident app, a call logged over the phone by the call
// center, or a task an admin/site manager sent the worker to directly (no resident at all).
function originLabel(m) {
  if (m.source === "onsite") return t("originOnsite");
  if (m.source === "call_center" || m.loggedByRole === "callcenter") return t("originCallCenter");
  if (m.source === "resident_report") return t("originReport");
  return t("originResident");
}
// On-site tasks carry a free-text location instead of a resident's unit.
function placeLabel(m) {
  if (m.source === "onsite") return m.location || "—";
  // A compound report points at a common area, so the spot the resident described is
  // what the worker needs to walk to — their unit is only context.
  if (m.source === "resident_report") return `${m.location || "—"} (${m.unit || "—"})`;
  return m.unit || "—";
}
function woEsc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
// Counters at the top of "My work orders": how many jobs are waiting, in progress and done.
function renderOrdersSummary(rows) {
  const el = document.getElementById("ordersSummary");
  if (!el) return;
  const n = (st) => rows.filter(o => o.status === st).length;
  el.innerHTML = [
    { cls: "accepted",    n: n("accepted"),    label: t("woTodo") },
    { cls: "in_progress", n: n("in_progress"), label: t("in_progress") },
    { cls: "completed",   n: n("completed"),   label: t("completed") }
  ].map(x => `<div class="ops-tile ${x.cls}"><div class="n">${x.n}</div><div class="l">${x.label}</div></div>`).join("");
}
// Duration estimates the worker can pick, in hours (0.5 = half an hour).
const ESTIMATE_CHOICES = [0.5, 1, 2, 3, 4, 6, 8];
function estimateLabel(h) {
  if (h === 0.5) return t("estHalfHour");
  return `${h} ${h === 1 ? t("estHour") : t("estHours")}`;
}
let lastOrderRows = [];
// The next job in the queue: the oldest assigned job that has not been started yet.
function nextQueuedOrder(exceptId) {
  return lastOrderRows.filter(o => o.status === "accepted" && o.id !== exceptId)
    .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0))[0] || null;
}
if (!isSecurity) {
  const ordersQ = query(collection(db, "maintenanceRequests"), where("assignedWorkerId", "==", user.uid));
  onSnapshot(ordersQ, (snap) => {
    const el = document.getElementById("ordersList");
    if (snap.empty) { renderOrdersSummary([]); el.innerHTML = `<p class="empty-state">${t("noWorkOrders")}</p>`; return; }
    el.innerHTML = "";
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    lastOrderRows = rows;
    renderOrdersSummary(rows);
    // Jobs still to do come first: the one already in progress, then the rest in the order
    // they were created (oldest first = the queue order). Finished jobs go below.
    const open = rows.filter(o => o.status !== "completed").sort((a, b) =>
      ((b.status === "in_progress") - (a.status === "in_progress")) || ((a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0)));
    const done = rows.filter(o => o.status === "completed")
      .sort((a, b) => (b.completedAt?.seconds || b.createdAt?.seconds || 0) - (a.completedAt?.seconds || a.createdAt?.seconds || 0))
      .slice(0, 20);

    const orderCard = (o) => {
      // A worker only ever moves their own order forward one step at a time —
      // accepted → in progress → completed — never sideways or backwards.
      let actionBtn = "";
      if (o.status === "accepted") actionBtn = `<button type="button" class="btn btn-sm btn-primary order-action" data-id="${o.id}" data-next="in_progress">${t("startWork")}</button>`;
      else if (o.status === "in_progress") actionBtn = `<button type="button" class="btn btn-sm btn-primary order-action" data-id="${o.id}" data-next="completed">${t("markComplete")}</button>`;
      // As soon as the worker understands the job, they pick how long they expect to
      // spend on it. The estimate feeds the waiting time shown to residents further
      // down the same craft's queue, so it's only offered while the job is still open.
      const estSelect = o.status === "completed" ? "" : `
            <select data-id="${o.id}" class="order-eta" style="border-radius:8px;border:1px solid #dfe6e3;padding:4px;font-size:11px;margin-top:6px">
              <option value="">${t("estDuration")}: ${t("estNotSet")}</option>
              ${ESTIMATE_CHOICES.map(h => `<option value="${h}" ${Number(o.estimatedHours) === h ? "selected" : ""}>${estimateLabel(h)}</option>`).join("")}
            </select>`;
      // The detail the worker needs to actually go and do the job: WHO it is for, WHERE to
      // go, and WHAT has to be done.
      const isOnsite = o.source === "onsite";
      const whoText = o.residentName || (isOnsite ? t("originOnsite") : "—");
      const whereText = isOnsite
        ? (o.location || "—")
        : (o.source === "resident_report"
            ? `${o.location || "—"} · ${t("unitLabel")} ${o.unit || "—"}`
            : `${t("unitLabel")} ${o.unit || "—"}`);
      const when = o.createdAt?.seconds
        ? new Date(o.createdAt.seconds * 1000).toLocaleString(window.SO_I18N && window.SO_I18N.getLang() === "ar" ? "ar-EG" : "en-GB",
            { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
        : "";
      // Before / after photos: proof of the job. The "before" shot can be taken until the job is
      // done, the "after" shot while it is in progress (right before marking it complete).
      const photoBtn = (field, labelKey, replaceKey, has) => `
            <label class="btn btn-sm btn-accent" style="display:inline-block;margin:6px 6px 0 0;cursor:pointer">
              📷 ${t(has ? replaceKey : labelKey)}
              <input type="file" accept="image/*" capture="environment" class="order-photo-input" data-id="${o.id}" data-field="${field}" style="display:none">
            </label>`;
      const proofThumb = (src, labelKey) => src
        ? `<div style="display:inline-block;margin:6px 8px 0 0;text-align:center"><div style="font-size:10px;color:#7b8a85">${t(labelKey)}</div><img class="photo-thumb order-photo" src="${src}" alt=""></div>` : "";
      const proofBlock = `
            <div>${proofThumb(o.beforePhoto, "woPhotoBefore")}${proofThumb(o.afterPhoto, "woPhotoAfter")}</div>
            ${o.status === "completed" ? "" : `<div>
              ${photoBtn("beforePhoto", "woPhotoBefore", "woPhotoBeforeRetake", !!o.beforePhoto)}
              ${o.status === "in_progress" ? photoBtn("afterPhoto", "woPhotoAfter", "woPhotoAfterRetake", !!o.afterPhoto) : ""}
            </div>`}`;
      return `
        <div class="list-item wo-card ${o.status}"${nextQueuedOrder() && nextQueuedOrder().id === o.id ? ' style="border:2px solid var(--primary)"' : ""}>
          <div class="meta">
            ${nextQueuedOrder() && nextQueuedOrder().id === o.id ? `<div style="font-size:11px;font-weight:700;color:var(--primary)">⏭ ${t("woNextUp")}</div>` : ""}
            <div class="wo-row"><span class="wo-k">👤 ${t("woWho")}</span><span class="wo-v">${woEsc(whoText)}</span></div>
            <div class="wo-row"><span class="wo-k">📍 ${t("woWhere")}</span><span class="wo-v">${woEsc(whereText)}</span></div>
            <div class="wo-row"><span class="wo-k">🛠 ${t("woWhat")}</span><span class="wo-v">${woEsc(categoryLabel(o.category))}${o.description ? " — " + woEsc(o.description) : ""}</span></div>
            <div class="sub" style="font-size:11px;color:#7b8a85;margin-top:4px">${originLabel(o)}${when ? " · " + when : ""}</div>
            ${o.photoData ? `<img class="photo-thumb order-photo" src="${o.photoData}" alt="">` : ""}
            ${proofBlock}
            ${estSelect}
          </div>
          <span class="badge ${o.status}">${t(o.status) || o.status}</span>
          ${actionBtn}
        </div>`;
    };
    const section = (title, list) => list.length
      ? `<h4 class="ops-subtitle">${title} (${list.length})</h4>${list.map(orderCard).join("")}` : "";
    el.innerHTML = section(t("woOpenTitle"), open) + section(t("woDoneTitle"), done)
      || `<p class="empty-state">${t("woNoOpen")}</p>`;
    if (open.length === 0 && done.length > 0) el.innerHTML = `<p class="empty-state">${t("woNoOpen")}</p>` + el.innerHTML;
    el.querySelectorAll(".order-photo").forEach(img => {
      img.addEventListener("click", () => openDataUrl(img.src));
    });
    el.querySelectorAll(".order-action").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (currentAccountStatus !== "active") { alert(t("lockedMsgSuspended")); return; }
        btn.disabled = true;
        const payload = {
          status: btn.dataset.next,
          statusSeenByResident: false,
          statusChangedAt: serverTimestamp()
        };
        if (btn.dataset.next === "completed") payload.completedAt = serverTimestamp();
        try {
          await updateDoc(doc(db, "maintenanceRequests", btn.dataset.id), payload);
          // Finished a job: offer to move straight on to the next one in the queue.
          if (btn.dataset.next === "completed") {
            const next = nextQueuedOrder(btn.dataset.id);
            const busy = lastOrderRows.some(o => o.status === "in_progress" && o.id !== btn.dataset.id);
            if (next && !busy && confirm(`${t("woStartNextAsk")}\n${categoryLabel(next.category)}`)) {
              await updateDoc(doc(db, "maintenanceRequests", next.id), {
                status: "in_progress", statusSeenByResident: false, statusChangedAt: serverTimestamp()
              });
            }
          }
        } catch (err) {
          console.error("Failed to update work order status:", err);
          btn.disabled = false;
          alert(err.code === "permission-denied"
            ? "Permission denied — ask the admin to publish the latest Firestore rules."
            : (err.message || String(err)));
        }
      });
    });
    el.querySelectorAll(".order-photo-input").forEach(inp => {
      inp.addEventListener("click", (e) => e.stopPropagation());
      inp.addEventListener("change", async () => {
        const file = inp.files && inp.files[0];
        if (!file) return;
        if (currentAccountStatus !== "active") { alert(t("lockedMsgSuspended")); inp.value = ""; return; }
        const label = inp.closest("label");
        if (label) label.style.opacity = "0.5";
        try {
          // 220 KB cap: a request can now carry the resident's photo plus a before and an after shot,
          // and the whole Firestore document must stay under 1 MiB.
          const { dataUrl } = await preparePhotoFile(file, 220000);
          const field = inp.dataset.field; // beforePhoto | afterPhoto
          await updateDoc(doc(db, "maintenanceRequests", inp.dataset.id), {
            [field]: dataUrl,
            [field + "At"]: serverTimestamp()
          });
        } catch (err) {
          console.error("Failed to save work photo:", err);
          if (label) label.style.opacity = "";
          inp.value = "";
          alert(err.code === "permission-denied"
            ? "Permission denied — ask the admin to publish the latest Firestore rules."
            : (err.code === "too_large" || err.code === "bad_image" ? t("woPhotoError") : (err.message || String(err))));
        }
      });
    });
    el.querySelectorAll(".order-eta").forEach(sel => {
      sel.addEventListener("click", (e) => e.stopPropagation());
      sel.addEventListener("change", async () => {
        if (currentAccountStatus !== "active") { alert(t("lockedMsgSuspended")); return; }
        const previous = sel.dataset.previous || "";
        sel.disabled = true;
        try {
          await updateDoc(doc(db, "maintenanceRequests", sel.dataset.id), {
            estimatedHours: sel.value === "" ? null : Number(sel.value)
          });
          sel.dataset.previous = sel.value;
        } catch (err) {
          console.error("Failed to save duration estimate:", err);
          sel.value = previous; // put the control back where it was so it isn't misleading
          alert(err.code === "permission-denied"
            ? "Permission denied — ask the admin to publish the latest Firestore rules."
            : (err.message || String(err)));
        } finally {
          sel.disabled = false;
        }
      });
      sel.dataset.previous = sel.value;
    });
  });
}

// Shifts the admin planned for me.
try { (await import("./shift-plans.js")).mountMyShiftPlans(user.uid, "myPlansList"); }
catch (e) { console.error("shift-plans.js failed to load:", e); }

// ---------- SOS / emergency (security only) ----------
if (isSecurity) {
  const sosCard = document.getElementById("sosCard");
  const sosBtn = document.getElementById("sosBtn");
  const sosStatus = document.getElementById("sosStatus");
  sosCard.style.display = "block";
  // Live status of my last alert: open until the admin or manager closes it.
  onSnapshot(query(collection(db, "sosAlerts"), where("workerId", "==", user.uid)), (snap) => {
    // Sorted here (not in the query) so no composite Firestore index is needed.
    const last = snap.docs.map(d => d.data()).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))[0];
    if (!last) { sosStatus.textContent = ""; return; }
    const open = last.status === "open";
    sosStatus.style.color = open ? "#b3261e" : "#0f6e5f";
    sosStatus.textContent = open ? t("sosSent") : t("sosHandled");
  }, (err) => console.error("SOS status listener failed:", err));
  sosBtn.addEventListener("click", async () => {
    if (currentAccountStatus !== "active") { alert(t("lockedMsgSuspended")); return; }
    if (!confirm(t("sosConfirm"))) return;
    sosBtn.disabled = true;
    // Location is best effort: the alert is sent even if the phone refuses or is slow to answer.
    const pos = await new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => resolve(null), { timeout: 4000, maximumAge: 60000 });
    });
    try {
      await addDoc(collection(db, "sosAlerts"), {
        workerId: user.uid,
        workerName: profile.name || "",
        status: "open",
        ...(pos ? { lat: pos.lat, lng: pos.lng } : {}),
        createdAt: serverTimestamp()
      });
    } catch (err) {
      console.error("Failed to send SOS:", err);
      alert(err.code === "permission-denied"
        ? "Permission denied — ask the admin to publish the latest Firestore rules."
        : (err.message || String(err)));
    } finally {
      sosBtn.disabled = false;
    }
  });
}

// ---------- Patrol round (security only): visit the checkpoints in order, tick them, add notes ----------
if (isSecurity) {
  const card = document.getElementById("patrolCard");
  const startBtn = document.getElementById("patrolStartBtn");
  const run = document.getElementById("patrolRun");
  const list = document.getElementById("patrolChecklist");
  const msg = document.getElementById("patrolMsg");
  card.style.display = "block";
  let points = [];
  let startedMs = 0;
  const showMsg = (m) => { msg.textContent = m || ""; msg.style.display = m ? "block" : "none"; };
  const pEsc = (v) => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  // My latest round, for the line under the title.
  onSnapshot(query(collection(db, "patrolRounds"), where("workerId", "==", user.uid)), (snap) => {
    const last = snap.docs.map(d => d.data()).sort((a, b) => (b.finishedAt?.seconds || 0) - (a.finishedAt?.seconds || 0))[0];
    const el = document.getElementById("patrolLast");
    if (!last) { el.textContent = t("patrolNeverDone"); return; }
    const when = last.finishedAt?.seconds ? new Date(last.finishedAt.seconds * 1000).toLocaleString(
      window.SO_I18N && window.SO_I18N.getLang() === "ar" ? "ar-EG" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
    el.textContent = `${t("patrolLastRound")}: ${when} · ${last.checked}/${last.total}`;
  }, (err) => console.error("patrol history listener failed:", err));

  startBtn.addEventListener("click", async () => {
    if (currentAccountStatus !== "active") { alert(t("lockedMsgSuspended")); return; }
    startBtn.disabled = true; showMsg("");
    try {
      const snap = await getDocs(query(collection(db, "patrolPoints")));
      points = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order || 0) - (b.order || 0));
      if (points.length === 0) { alert(t("patrolNoPointsWorker")); return; }
      startedMs = Date.now();
      list.innerHTML = points.map((p, i) => `
        <div class="list-item" style="align-items:flex-start">
          <div class="meta" style="width:100%">
            <label style="display:flex;gap:8px;align-items:center;font-weight:700"><input type="checkbox" class="patrol-chk" data-i="${i}" style="width:20px;height:20px"> ${i + 1}. ${pEsc(p.name)}</label>
            <input type="text" class="patrol-note" data-i="${i}" data-i18n-placeholder="patrolNotePh" placeholder="${pEsc(t("patrolNotePh"))}" style="width:100%;margin-top:6px">
          </div>
        </div>`).join("");
      // Remember when each checkpoint was ticked, so the log shows the actual walk.
      list.querySelectorAll(".patrol-chk").forEach(c => c.addEventListener("change", () => { c.dataset.at = c.checked ? String(Date.now()) : ""; }));
      startBtn.style.display = "none"; run.style.display = "block";
    } catch (err) {
      console.error("Failed to load checkpoints:", err);
      alert(err.code === "permission-denied" ? "Permission denied — ask the admin to publish the latest Firestore rules." : (err.message || String(err)));
    } finally { startBtn.disabled = false; }
  });
  function endRun() { run.style.display = "none"; startBtn.style.display = ""; list.innerHTML = ""; showMsg(""); }
  document.getElementById("patrolCancelBtn").addEventListener("click", () => { if (confirm(t("patrolCancelConfirm"))) endRun(); });
  document.getElementById("patrolFinishBtn").addEventListener("click", async () => {
    const checks = points.map((p, i) => {
      const chk = list.querySelector(`.patrol-chk[data-i="${i}"]`);
      const note = list.querySelector(`.patrol-note[data-i="${i}"]`).value.trim();
      return { pointId: p.id, name: p.name, ok: chk.checked, ...(chk.checked && chk.dataset.at ? { atMs: Number(chk.dataset.at) } : {}), ...(note ? { note } : {}) };
    });
    const done = checks.filter(c => c.ok).length;
    if (done < checks.length && !confirm(t("patrolIncompleteConfirm"))) return;
    const btn = document.getElementById("patrolFinishBtn");
    btn.disabled = true; showMsg("");
    try {
      await addDoc(collection(db, "patrolRounds"), {
        workerId: user.uid, workerName: profile.name || "", startedAtMs: startedMs,
        finishedAt: serverTimestamp(), total: checks.length, checked: done, checks
      });
      endRun();
    } catch (err) {
      console.error("Failed to save patrol round:", err);
      showMsg(err.code === "permission-denied" ? "Permission denied — ask the admin to publish the latest Firestore rules." : (err.message || String(err)));
    } finally { btn.disabled = false; }
  });
}

// ---------- QR scanner (security only) ----------
function startScanner() {
  if (scannerStarted || currentAccountStatus !== "active") return;
  scannerStarted = true;
  const reader = new Html5Qrcode("qrReader");
  reader.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: 220 },
    (decodedText) => handleAccessScan(db, decodedText, (document.getElementById("scanMode") || {}).value || "entry", t, document.getElementById("scanResult"), { scannedBy: user.uid }),
    () => {}
  ).catch(() => {
    document.getElementById("scanResult").textContent = t("cameraUnavailable");
  });
}

onSnapshot(query(collection(db, "accessLogs"), orderBy("timestamp", "desc")), (snap) => {
  const el = document.getElementById("accessList");
  if (!el) return;
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
          <div class="sub">${a.type === "exit" ? "🚪 " + t("accessExit") : "➡️ " + t("accessEntry")} · ${fmtTime(a.timestamp)}</div>
        </div>
      </div>`;
  });
});

function fmtTime(v) {
  if (!v) return "—";
  if (v.toDate) return v.toDate().toLocaleString();
  return v;
}

// ==========================================================================
// Areas I look after — the common parts of the compound handed to this worker.
// A standing responsibility, not a queue: the actual jobs (routine rounds and
// extraordinary ones) still arrive as normal work orders above. This card is
// there so the worker can see at a glance what is permanently theirs.
// ==========================================================================
const MY_AREA_TYPE_I18N = {
  lobby: "areaTypeLobby", stairs: "areaTypeStairs", elevator: "areaTypeElevator",
  garden: "areaTypeGarden", pool: "areaTypePool", garage: "areaTypeGarage",
  gate: "areaTypeGate", street: "areaTypeStreet", gym: "areaTypeGym",
  playground: "areaTypePlayground", roof: "areaTypeRoof", water: "areaTypeWater",
  other: "areaTypeOther"
};
const MY_AREA_FREQ_I18N = { daily: "freqDaily", weekly: "freqWeekly", biweekly: "freqBiweekly", monthly: "freqMonthly" };
let myAreaDocs = [];

if (!isSecurity) {
  onSnapshot(query(collection(db, "commonAreas"), where("workerId", "==", user.uid)), (snap) => {
    myAreaDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderMyAreas();
  }, (err) => console.error("My areas listener failed:", err));
}

function renderMyAreas() {
  const el = document.getElementById("myAreasList");
  if (!el) return;
  if (myAreaDocs.length === 0) { el.innerHTML = `<p class="empty-state">${t("noMyAreas")}</p>`; return; }
  el.innerHTML = myAreaDocs
    .slice()
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
    .map(a => {
      const where2 = a.scope === "building" && a.buildingName ? a.buildingName : t("scopeCompound");
      const last = a.lastServiceAt?.seconds
        ? new Date(a.lastServiceAt.seconds * 1000).toLocaleDateString(window.SO_I18N && window.SO_I18N.getLang() === "ar" ? "ar-EG" : "en-GB",
            { day: "numeric", month: "short" })
        : t("areaNever");
      return `
        <div class="list-item">
          <div class="meta">
            <div class="wo-row"><span class="wo-k">📍 ${t("woWhere")}</span><span class="wo-v">${woEsc(a.nameKey ? t(a.nameKey) : a.name)} · ${woEsc(where2)}</span></div>
            <div class="wo-row"><span class="wo-k">🧹 ${t("myAreaRoutine")}</span><span class="wo-v">${woEsc(a.task || t(MY_AREA_TYPE_I18N[a.type] || "areaTypeOther"))} — ${t(MY_AREA_FREQ_I18N[a.frequency] || "freqWeekly")}</span></div>
            <div class="sub" style="font-size:11px;color:#7b8a85;margin-top:4px">${t("areaLastService")}: ${last}</div>
          </div>
        </div>`;
    }).join("");
}
window.addEventListener("so-lang-changed", renderMyAreas);
