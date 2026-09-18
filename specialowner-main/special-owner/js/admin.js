import { db } from "./firebase-config.js";
import { requireAuth, logout } from "./guard.js";
import {
  collection, addDoc, doc, getDoc, getDocs, updateDoc, query, where, orderBy,
  onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const { user, profile } = await requireAuth("admin");
document.getElementById("logoutBtn").addEventListener("click", logout);

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

// ---------- Announcements ----------
document.getElementById("postAnnBtn").addEventListener("click", async () => {
  const title = document.getElementById("annTitle").value.trim();
  const body = document.getElementById("annBody").value.trim();
  if (!title) { alert("Please enter a title."); return; }
  await addDoc(collection(db, "announcements"), {
    title, body, createdBy: user.uid, createdAt: serverTimestamp()
  });
  document.getElementById("annTitle").value = "";
  document.getElementById("annBody").value = "";
  alert("Announcement published.");
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
  if (snap.empty) { el.innerHTML = `<p class="empty-state">No workers added yet.</p>`; return; }
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
  if (snap.empty) { el.innerHTML = `<p class="empty-state">No payment records yet.</p>`; return; }
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

// ---------- Maintenance (admin view + status update) ----------
onSnapshot(query(collection(db, "maintenanceRequests"), orderBy("createdAt", "desc")), (snap) => {
  const el = document.getElementById("adminMaintList");
  if (snap.empty) { el.innerHTML = `<p class="empty-state">No requests yet.</p>`; return; }
  el.innerHTML = "";
  snap.forEach(d => {
    const m = d.data();
    el.innerHTML += `
      <div class="list-item">
        <div class="meta">
          <div class="title">${m.unit || "—"} · ${m.category}</div>
          <div class="sub">${m.description}</div>
        </div>
        <select data-id="${d.id}" class="maint-status" style="border-radius:8px;border:1px solid #dfe6e3;padding:6px;font-size:12px">
          <option value="pending" ${m.status === "pending" ? "selected" : ""}>Pending</option>
          <option value="in_progress" ${m.status === "in_progress" ? "selected" : ""}>In progress</option>
          <option value="completed" ${m.status === "completed" ? "selected" : ""}>Completed</option>
        </select>
      </div>`;
  });
  el.querySelectorAll(".maint-status").forEach(sel => {
    sel.addEventListener("change", async () => {
      await updateDoc(doc(db, "maintenanceRequests", sel.dataset.id), { status: sel.value });
    });
  });
});

// ---------- Access log ----------
onSnapshot(query(collection(db, "accessLogs"), orderBy("timestamp", "desc")), (snap) => {
  const el = document.getElementById("accessList");
  if (snap.empty) { el.innerHTML = `<p class="empty-state">No entries yet.</p>`; return; }
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
        if (invite.status === "used") {
          resultEl.textContent = `⚠️ This invitation was already used (${invite.guestName}).`;
          return;
        }
        await updateDoc(inviteRef, { status: "used" });
        await addDoc(collection(db, "accessLogs"), {
          type: "entry",
          personType: invite.type || "guest",
          personName: invite.guestName,
          invitationId: payload.inviteId,
          timestamp: serverTimestamp()
        });
        resultEl.textContent = `✅ Access granted: ${invite.guestName} (unit ${invite.residentUnit || "—"})`;
      } catch (e) {
        document.getElementById("scanResult").textContent = "❌ Could not read this QR code.";
      }
    },
    () => {} // ignore per-frame scan failures
  ).catch(() => {
    document.getElementById("scanResult").textContent = "Camera unavailable — check browser permissions.";
  });
}

function fmtTime(v) {
  if (!v) return "—";
  if (v.toDate) return v.toDate().toLocaleString();
  return v;
}
