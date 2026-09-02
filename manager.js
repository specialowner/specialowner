import { db } from "./firebase-config.js";
import { requireAuth, logout } from "./guard.js";
import { createStaffAccount, friendlyStaffCreateError } from "./create-staff-account.js";
import {
  collection, addDoc, doc, getDoc, updateDoc, query, where, orderBy,
  onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const { user, profile } = await requireAuth("manager");
document.getElementById("logoutBtn").addEventListener("click", logout);

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
function workerTypeLabel(wt) {
  if (!wt) return "";
  return t(WORKER_TYPE_I18N_KEY[wt] || wt) || wt;
}

function renderGreeting() {
  document.getElementById("greetName").textContent = `${t("hiThere")}, ${profile.name?.split(" ")[0] || ""} 👋`;
  document.getElementById("greetRole").textContent = t("siteManager");
}
renderGreeting();
window.addEventListener("so-lang-changed", renderGreeting);

// ---------- Tabs ----------
const tabs = document.querySelectorAll(".tab-btn");
tabs.forEach(btn => btn.addEventListener("click", () => {
  tabs.forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  ["home", "workers", "security", "visits", "leaves", "announcements"].forEach(tab => {
    document.getElementById(`tab-${tab}`).style.display = (tab === btn.dataset.tab) ? "block" : "none";
  });
}));

// ---------- Today's date, in the app's current language ----------
function renderTodayDate() {
  const lang = window.SO_I18N ? window.SO_I18N.getLang() : "en";
  const locale = lang === "ar" ? "ar-EG" : "en-US";
  document.getElementById("todayDate").textContent = new Date().toLocaleDateString(locale, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}
renderTodayDate();
window.addEventListener("so-lang-changed", renderTodayDate);

// ---------- Account status (pending / active / suspended) + own salary ----------
let currentAccountStatus = "active";
let activationRequestPending = false;
const userDocRef = doc(db, "users", user.uid);
onSnapshot(userDocRef, (snap) => {
  const data = snap.data() || {};
  currentAccountStatus = data.accountStatus || "active";
  activationRequestPending = data.activationRequestStatus === "pending";

  document.getElementById("leaveBalanceAmount").textContent =
    (data.leaveBalance || data.leaveBalance === 0) ? `${data.leaveBalance} ${t("daysShort") || ""}` : "—";

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
document.getElementById("requestActivationBtn").addEventListener("click", requestActivation);

function renderAccountStatus() {
  const isLocked = currentAccountStatus !== "active";
  const banner = document.getElementById("statusBanner");
  banner.style.display = isLocked ? "block" : "none";
  document.getElementById("statusBannerText").textContent = isLocked
    ? (currentAccountStatus === "suspended" ? t("statusSuspendedBanner") : t("statusPendingBanner"))
    : "";
  document.getElementById("submitLeaveBtn").disabled = isLocked;
  document.getElementById("postAnnBtn").disabled = isLocked;
}

// ---------- My leave requests (approved by the compound owner, not by the manager himself) ----------
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

const myLeaveQ = query(collection(db, "leaveRequests"), where("workerId", "==", user.uid));
onSnapshot(myLeaveQ, (snap) => {
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

// ---------- My salary history ----------
const salaryHistoryQ = query(collection(db, "salaryRecords"), where("workerId", "==", user.uid));
onSnapshot(salaryHistoryQ, (snap) => {
  const el = document.getElementById("salaryHistoryList");
  if (snap.empty) { el.innerHTML = `<p class="empty-state">${t("noSalaryHistory")}</p>`; return; }
  el.innerHTML = "";
  const rows = snap.docs.map(d => d.data()).sort((a, b) => (b.month || "").localeCompare(a.month || ""));
  rows.forEach(r => {
    el.innerHTML += `
      <div class="list-item">
        <div class="meta">
          <div class="title">${r.month || ""}</div>
          <div class="sub">${t("netSalary")}: EGP ${r.net ?? 0}</div>
        </div>
      </div>`;
  });
});

// ---------- Add worker account (site manager — workers only, never managers) ----------
document.getElementById("mgrAddWorkerAccBtn").addEventListener("click", async () => {
  const btn = document.getElementById("mgrAddWorkerAccBtn");
  const errEl = document.getElementById("mgrWorkerAccError");
  errEl.style.display = "none";
  if (currentAccountStatus !== "active") {
    errEl.textContent = currentAccountStatus === "suspended" ? t("lockedMsgSuspended") : t("lockedMsgPending");
    errEl.style.display = "block";
    return;
  }
  const name = document.getElementById("mgrWorkerAccName").value.trim();
  const workerType = document.getElementById("mgrWorkerAccType").value;
  const email = document.getElementById("mgrWorkerAccEmail").value.trim();
  const password = document.getElementById("mgrWorkerAccPassword").value;
  if (!name || !email || !password) {
    errEl.textContent = "Please fill in the name, email and password.";
    errEl.style.display = "block";
    return;
  }
  btn.disabled = true;
  try {
    await createStaffAccount({ name, email, password, role: "worker", createdBy: user.uid, extra: { workerType } });
    document.getElementById("mgrWorkerAccName").value = "";
    document.getElementById("mgrWorkerAccEmail").value = "";
    document.getElementById("mgrWorkerAccPassword").value = "";
    alert(t("accountCreated") || "Account created.");
  } catch (err) {
    errEl.textContent = friendlyStaffCreateError(err);
    errEl.style.display = "block";
  } finally {
    btn.disabled = false;
  }
});

// ---------- Workers roster (read-only) ----------
let workersCache = [];
onSnapshot(query(collection(db, "users"), where("role", "==", "worker")), (snap) => {
  workersCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const el = document.getElementById("mgrWorkersList");
  if (snap.empty) { el.innerHTML = `<p class="empty-state">${t("noWorkers2")}</p>`; return; }
  el.innerHTML = "";
  workersCache.forEach(w => {
    const status = w.accountStatus || "active";
    el.innerHTML += `
      <div class="list-item">
        <div class="meta">
          <div class="title">${w.name || w.email}</div>
          <div class="sub">${workerTypeLabel(w.workerType)} · ${w.email || ""}</div>
        </div>
        <span class="badge ${status === "active" ? "active" : status === "suspended" ? "overdue" : "pending"}">${status}</span>
      </div>`;
  });
  renderAnnTargetList();
});

// ---------- Workers' movements (attendance, everyone) ----------
onSnapshot(query(collection(db, "attendance"), orderBy("clockIn", "desc")), (snap) => {
  const el = document.getElementById("mgrShiftsList");
  if (snap.empty) { el.innerHTML = `<p class="empty-state">${t("noMovements")}</p>`; return; }
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

// ---------- Security log (read-only) ----------
onSnapshot(query(collection(db, "accessLogs"), orderBy("timestamp", "desc")), (snap) => {
  const el = document.getElementById("mgrAccessList");
  if (snap.empty) { el.innerHTML = `<p class="empty-state">${t("noEntries")}</p>`; return; }
  el.innerHTML = "";
  snap.docs.slice(0, 50).forEach(d => {
    const a = d.data();
    const timeStr = a.timestamp?.toDate ? a.timestamp.toDate().toLocaleString() : "—";
    el.innerHTML += `
      <div class="list-item">
        <div class="meta">
          <div class="title">${a.personName || ""} (${a.personType || ""})</div>
          <div class="sub">${timeStr}</div>
        </div>
      </div>`;
  });
});

// ---------- Guest visits (read-only) ----------
onSnapshot(query(collection(db, "invitations"), where("type", "==", "guest")), (snap) => {
  const el = document.getElementById("mgrVisitsList");
  if (snap.empty) { el.innerHTML = `<p class="empty-state">${t("noVisits")}</p>`; return; }
  el.innerHTML = "";
  const rows = snap.docs.map(d => d.data()).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  rows.slice(0, 50).forEach(i => {
    el.innerHTML += `
      <div class="list-item">
        <div class="meta">
          <div class="title">${i.guestName || ""} · ${t("unitLabel") || ""} ${i.residentUnit || "—"}</div>
          <div class="sub">${t("visitDate")}: ${i.visitDate || "—"}</div>
        </div>
        <span class="badge ${i.status}">${i.status}</span>
      </div>`;
  });
});

// ---------- Workers' leave requests (approve/reject — never your own) ----------
onSnapshot(query(collection(db, "leaveRequests"), orderBy("createdAt", "desc")), (snap) => {
  const el = document.getElementById("mgrLeaveRequestsList");
  const rows = snap.docs.filter(d => d.data().workerId !== user.uid);
  if (rows.length === 0) { el.innerHTML = `<p class="empty-state">${t("noLeaveRequests")}</p>`; return; }
  el.innerHTML = "";
  rows.forEach(d => {
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

// ---------- Announcements to residents ----------
// Same multi-select pattern used in admin.html: every resident is listed with a checkbox,
// "select all" toggles them together, and you can also uncheck individuals to target 1, 50,
// or 399 out of 400 — whatever subset you want.
let residentsCache = [];
onSnapshot(query(collection(db, "users"), where("role", "==", "resident")), (snap) => {
  residentsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderAnnTargetList();
});

function renderAnnTargetList() {
  const list = document.getElementById("annTargetList");
  if (residentsCache.length === 0) {
    list.innerHTML = `<p class="empty-state">${t("noResidentsYet")}</p>`;
    return;
  }
  list.innerHTML = residentsCache.map(r => `
    <label style="display:flex;align-items:center;gap:6px;padding:4px 0;font-size:12px">
      <input type="checkbox" class="annTargetCheck" value="${r.id}" checked>
      <span>${r.name || r.email || r.id} · ${t("unitLabel")} ${r.unit || "—"}</span>
    </label>`).join("");
}

document.getElementById("annSelectAll").addEventListener("change", (e) => {
  document.querySelectorAll(".annTargetCheck").forEach(cb => cb.checked = e.target.checked);
});
document.getElementById("annTargetList").addEventListener("change", (e) => {
  if (!e.target.classList.contains("annTargetCheck")) return;
  const all = document.querySelectorAll(".annTargetCheck");
  const checked = document.querySelectorAll(".annTargetCheck:checked");
  document.getElementById("annSelectAll").checked = all.length > 0 && all.length === checked.length;
});

document.getElementById("postAnnBtn").addEventListener("click", async () => {
  if (currentAccountStatus !== "active") { alert(currentAccountStatus === "suspended" ? t("lockedMsgSuspended") : t("lockedMsgPending")); return; }
  const title = document.getElementById("annTitle").value.trim();
  const body = document.getElementById("annBody").value.trim();
  if (!title) { alert(t("enterTitleAlert") || "Please enter a title."); return; }

  const targetIds = [...document.querySelectorAll(".annTargetCheck:checked")].map(cb => cb.value);
  if (targetIds.length === 0) { alert(t("chooseAtLeastOne") || "Please choose at least one recipient."); return; }

  const payload = { title, body, audience: "residents", createdBy: user.uid, createdAt: serverTimestamp() };
  // Only attach targetIds when it's a subset — leaving it off when everyone is selected matches
  // how admin.js posts to "all residents" and keeps the announcement visible to future residents too.
  if (targetIds.length < residentsCache.length) payload.targetIds = targetIds;

  await addDoc(collection(db, "announcements"), payload);
  document.getElementById("annTitle").value = "";
  document.getElementById("annBody").value = "";
  alert(t("announcementPublished") || "Announcement published.");
});

onSnapshot(query(collection(db, "announcements"), where("audience", "==", "residents")), (snap) => {
  const el = document.getElementById("mgrAnnList");
  if (snap.empty) { el.innerHTML = `<p class="empty-state">${t("noAnnouncements")}</p>`; return; }
  el.innerHTML = "";
  const rows = snap.docs.map(d => d.data()).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  rows.forEach(a => {
    el.innerHTML += `
      <div class="list-item">
        <div class="meta">
          <div class="title">${a.title}</div>
          <div class="sub">${a.body || ""}</div>
        </div>
      </div>`;
  });
});
