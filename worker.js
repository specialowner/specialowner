import { db } from "./firebase-config.js";
import { requireAuth, logout } from "./guard.js";
import {
  collection, addDoc, doc, getDoc, getDocs, updateDoc, query, where, orderBy,
  onSnapshot, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const { user, profile } = await requireAuth("worker");

function t(key) {
  const lang = window.SO_I18N ? window.SO_I18N.getLang() : "en";
  return window.SO_I18N ? window.SO_I18N.translations[lang][key] : key;
}

const workerType = profile.workerType || "maintenance"; // security | maintenance | cleaning | porter | garden
const isSecurity = workerType === "security";

function renderGreeting() {
  document.getElementById("greetName").textContent = `${t("hiThere")}, ${profile.name?.split(" ")[0] || ""} 👋`;
  document.getElementById("greetRole").textContent = t(workerType) || workerType;
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
document.getElementById("todayDate").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });

// ---------- Account status (pending / active / suspended) + salary ----------
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
        </div>
      </div>`;
  });
});

// ---------- Work orders (maintenance / cleaning / porter / garden) ----------
if (!isSecurity) {
  const ordersQ = query(collection(db, "maintenanceRequests"), where("assignedWorkerId", "==", user.uid));
  onSnapshot(ordersQ, (snap) => {
    const el = document.getElementById("ordersList");
    if (snap.empty) { el.innerHTML = `<p class="empty-state">${t("noWorkOrders")}</p>`; return; }
    el.innerHTML = "";
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    rows.forEach(o => {
      el.innerHTML += `
        <div class="list-item">
          <div class="meta">
            <div class="title">${o.category} · ${o.unit || "—"}</div>
            <div class="sub">${o.description}</div>
          </div>
          <select data-id="${o.id}" class="order-status" style="border-radius:8px;border:1px solid #dfe6e3;padding:6px;font-size:12px">
            <option value="pending" ${o.status === "pending" ? "selected" : ""}>${t("pending")}</option>
            <option value="in_progress" ${o.status === "in_progress" ? "selected" : ""}>${t("in_progress")}</option>
            <option value="completed" ${o.status === "completed" ? "selected" : ""}>${t("completed")}</option>
          </select>
        </div>`;
    });
    el.querySelectorAll(".order-status").forEach(sel => {
      sel.addEventListener("change", async () => {
        if (currentAccountStatus !== "active") { alert(t("lockedMsgSuspended")); return; }
        await updateDoc(doc(db, "maintenanceRequests", sel.dataset.id), { status: sel.value });
      });
    });
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
          scannedBy: user.uid,
          zones: invite.accessZones || null,
          timestamp: serverTimestamp()
        });
        resultEl.textContent = isMaster
          ? `✅ ${t("masterAccessGranted")}: ${displayName}`
          : `✅ Access granted: ${invite.guestName} (unit ${invite.residentUnit || "—"})`;
      } catch (e) {
        document.getElementById("scanResult").textContent = "❌ Could not read this QR code.";
      }
    },
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
          <div class="sub">${fmtTime(a.timestamp)}</div>
        </div>
      </div>`;
  });
});

function fmtTime(v) {
  if (!v) return "—";
  if (v.toDate) return v.toDate().toLocaleString();
  return v;
}
