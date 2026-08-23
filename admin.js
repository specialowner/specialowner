import { db } from "./firebase-config.js";
import { requireAuth, logout } from "./guard.js";
import {
  collection, addDoc, doc, getDoc, getDocs, updateDoc, query, where, orderBy,
  onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const { user, profile } = await requireAuth("admin");
document.getElementById("logoutBtn").addEventListener("click", logout);

function t(key) {
  const lang = window.SO_I18N ? window.SO_I18N.getLang() : "en";
  return window.SO_I18N ? window.SO_I18N.translations[lang][key] : key;
}

// ---------- Tabs ----------
const tabs = document.querySelectorAll(".tab-btn");
tabs.forEach(btn => btn.addEventListener("click", () => {
  tabs.forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  ["overview", "access", "workers", "finance", "maint"].forEach(t => {
    document.getElementById(`tab-${t}`).style.display = (t === btn.dataset.tab) ? "block" : "none";
  });
  if (btn.dataset.tab === "access") startScanner();
}));

// ---------- Overview stats ----------
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
  if (snap.empty) { el.innerHTML = `<p class="empty-state">${t("noResidentsYet")}</p>`; return; }
  el.innerHTML = "";
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
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
document.getElementById("postAnnBtn").addEventListener("click", async () => {
  const title = document.getElementById("annTitle").value.trim();
  const body = document.getElementById("annBody").value.trim();
  const audience = document.getElementById("annAudience").value; // all | residents | workers
  if (!title) { alert("Please enter a title."); return; }
  await addDoc(collection(db, "announcements"), {
    title, body, audience, createdBy: user.uid, createdAt: serverTimestamp()
  });
  document.getElementById("annTitle").value = "";
  document.getElementById("annBody").value = "";
  alert("Announcement published.");
});

// ---------- Staff accounts & activation requests ----------
onSnapshot(query(collection(db, "users"), where("role", "==", "worker")), (snap) => {
  const el = document.getElementById("staffAccountsList");
  if (snap.empty) { el.innerHTML = `<p class="empty-state">${t("noStaffYet")}</p>`; return; }
  el.innerHTML = "";
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
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
          <div class="sub">${t(r.workerType) || r.workerType} · ${r.email || ""}</div>
          <div style="display:flex;align-items:center;gap:6px;margin-top:6px">
            <input type="number" class="salary-input" data-id="${r.id}" placeholder="${t("salaryPlaceholder")}" value="${r.salary || ""}" style="width:100px;border-radius:8px;border:1px solid #dfe6e3;padding:5px;font-size:12px">
            <button class="btn btn-sm btn-outline" data-save-salary="${r.id}">${t("save")}</button>
          </div>
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
  el.querySelectorAll("button[data-save-salary]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const input = el.querySelector(`.salary-input[data-id="${btn.dataset.saveSalary}"]`);
      const val = Number(input.value) || 0;
      await updateDoc(doc(db, "users", btn.dataset.saveSalary), { salary: val });
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

// ---------- Workers ----------
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
  snap.forEach(d => {
    const p = d.data();
    el.innerHTML += `
      <div class="list-item">
        <div class="meta">
          <div class="title">${p.unit || "—"} · EGP ${p.amount}</div>
          <div class="sub">${p.description} · due ${p.dueDate}</div>
        </div>
        <span class="badge ${p.status}">${p.status}</span>
      </div>`;
  });
});

// ---------- Maintenance (admin view + status update + assign worker) ----------
let workerOptionsCache = [];
let lastMaintDocs = [];

function renderMaintList() {
  const el = document.getElementById("adminMaintList");
  if (lastMaintDocs.length === 0) { el.innerHTML = `<p class="empty-state">${t("noRequests")}</p>`; return; }
  const assignableWorkers = workerOptionsCache.filter(w => w.workerType !== "security");
  el.innerHTML = "";
  lastMaintDocs.forEach(m => {
    el.innerHTML += `
      <div class="list-item">
        <div class="meta">
          <div class="title">${m.unit || "—"} · ${m.category}</div>
          <div class="sub">${m.description}</div>
          <select data-id="${m.id}" class="maint-assign" style="border-radius:8px;border:1px solid #dfe6e3;padding:4px;font-size:11px;margin-top:6px">
            <option value="">${t("unassigned")}</option>
            ${assignableWorkers.map(w => `<option value="${w.id}" ${m.assignedWorkerId === w.id ? "selected" : ""}>${w.name} (${t(w.workerType)})</option>`).join("")}
          </select>
        </div>
        <select data-id="${m.id}" class="maint-status" style="border-radius:8px;border:1px solid #dfe6e3;padding:6px;font-size:12px">
          <option value="pending" ${m.status === "pending" ? "selected" : ""}>${t("pending")}</option>
          <option value="in_progress" ${m.status === "in_progress" ? "selected" : ""}>${t("in_progress")}</option>
          <option value="completed" ${m.status === "completed" ? "selected" : ""}>${t("completed")}</option>
        </select>
      </div>`;
  });
  el.querySelectorAll(".maint-status").forEach(sel => {
    sel.addEventListener("change", async () => {
      await updateDoc(doc(db, "maintenanceRequests", sel.dataset.id), { status: sel.value });
    });
  });
  el.querySelectorAll(".maint-assign").forEach(sel => {
    sel.addEventListener("change", async () => {
      await updateDoc(doc(db, "maintenanceRequests", sel.dataset.id), { assignedWorkerId: sel.value || null });
    });
  });
}

onSnapshot(query(collection(db, "users"), where("role", "==", "worker")), (snap) => {
  workerOptionsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderMaintList();
});

onSnapshot(query(collection(db, "maintenanceRequests"), orderBy("createdAt", "desc")), (snap) => {
  lastMaintDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderMaintList();
});

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
