import { db } from "./firebase-config.js";
import { requireAuth, logout } from "./guard.js";
import {
  collection, addDoc, query, where, orderBy, onSnapshot, serverTimestamp, Timestamp, doc
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const { user, profile } = await requireAuth("resident");

document.getElementById("greetName").textContent = `Hi, ${profile.name?.split(" ")[0] || "there"} 👋`;
document.getElementById("greetUnit").textContent = `Unit ${profile.unit || "—"}`;
document.getElementById("pointsNum").textContent = profile.points ?? 0;
document.getElementById("shopsPoints").textContent = profile.points ?? 0;
document.getElementById("logoutBtn").addEventListener("click", logout);

// ---------- Tabs ----------
const tabs = document.querySelectorAll(".tab-btn");
tabs.forEach(btn => btn.addEventListener("click", () => {
  tabs.forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  ["home", "invites", "maint", "shops"].forEach(t => {
    document.getElementById(`tab-${t}`).style.display = (t === btn.dataset.tab) ? "block" : "none";
  });
}));

// ---------- Payments ----------
const paymentsQ = query(collection(db, "payments"), where("residentId", "==", user.uid), orderBy("dueDate", "desc"));
onSnapshot(paymentsQ, (snap) => {
  const el = document.getElementById("paymentsList");
  if (snap.empty) { el.innerHTML = `<p class="empty-state">No payment records yet.</p>`; return; }
  let totalDue = 0;
  el.innerHTML = "";
  snap.forEach(d => {
    const p = d.data();
    if (p.status !== "paid") totalDue += Number(p.amount || 0);
    el.innerHTML += `
      <div class="list-item">
        <div class="meta">
          <div class="title">${p.description || "Monthly fee"}</div>
          <div class="sub">EGP ${p.amount} · due ${fmtDate(p.dueDate)}</div>
        </div>
        <span class="badge ${p.status}">${p.status}</span>
      </div>`;
  });
  document.getElementById("dueNum").textContent = `EGP ${totalDue}`;
});

// ---------- Announcements ----------
const annQ = query(collection(db, "announcements"), orderBy("createdAt", "desc"));
onSnapshot(annQ, (snap) => {
  const el = document.getElementById("announcementsList");
  if (snap.empty) { el.innerHTML = `<p class="empty-state">No announcements yet.</p>`; return; }
  el.innerHTML = "";
  snap.forEach(d => {
    const a = d.data();
    el.innerHTML += `
      <div class="list-item">
        <div class="meta">
          <div class="title">${a.title}</div>
          <div class="sub">${a.body || ""}</div>
        </div>
      </div>`;
  });
});

// ---------- Invitations ----------
document.getElementById("createInviteBtn").addEventListener("click", async () => {
  const guestName = document.getElementById("guestName").value.trim();
  const guestPhone = document.getElementById("guestPhone").value.trim();
  const guestDate = document.getElementById("guestDate").value;
  if (!guestName || !guestDate) { alert("Please fill in the guest name and visit date."); return; }

  const token = cryptoToken();
  const ref = await addDoc(collection(db, "invitations"), {
    residentId: user.uid,
    residentUnit: profile.unit || "",
    guestName, guestPhone,
    visitDate: guestDate,
    token,
    status: "pending",
    type: "guest",
    createdAt: serverTimestamp()
  });

  const qrPayload = JSON.stringify({ inviteId: ref.id, token });
  const canvas = document.getElementById("qrCanvas");
  await QRCode.toCanvas(canvas, qrPayload, { width: 220, margin: 1, color: { dark: "#0f6e5f" } });
  document.getElementById("qrResultCard").style.display = "block";
  document.getElementById("guestName").value = "";
  document.getElementById("guestPhone").value = "";
  document.getElementById("guestDate").value = "";
});

const invitesQ = query(collection(db, "invitations"), where("residentId", "==", user.uid), orderBy("createdAt", "desc"));
onSnapshot(invitesQ, (snap) => {
  const el = document.getElementById("invitesList");
  if (snap.empty) { el.innerHTML = `<p class="empty-state">No invitations yet.</p>`; return; }
  el.innerHTML = "";
  snap.forEach(d => {
    const i = d.data();
    el.innerHTML += `
      <div class="list-item">
        <div class="meta">
          <div class="title">${i.guestName}</div>
          <div class="sub">Visit: ${i.visitDate}</div>
        </div>
        <span class="badge ${i.status}">${i.status}</span>
      </div>`;
  });
});

// ---------- Maintenance ----------
document.getElementById("createMaintBtn").addEventListener("click", async () => {
  const category = document.getElementById("maintCategory").value;
  const description = document.getElementById("maintDesc").value.trim();
  if (!description) { alert("Please describe the issue."); return; }

  await addDoc(collection(db, "maintenanceRequests"), {
    residentId: user.uid,
    unit: profile.unit || "",
    category, description,
    status: "pending",
    createdAt: serverTimestamp()
  });
  document.getElementById("maintDesc").value = "";
});

const maintQ = query(collection(db, "maintenanceRequests"), where("residentId", "==", user.uid), orderBy("createdAt", "desc"));
onSnapshot(maintQ, (snap) => {
  const el = document.getElementById("maintList");
  if (snap.empty) { el.innerHTML = `<p class="empty-state">No requests yet.</p>`; return; }
  el.innerHTML = "";
  snap.forEach(d => {
    const m = d.data();
    el.innerHTML += `
      <div class="list-item">
        <div class="meta">
          <div class="title">${m.category}</div>
          <div class="sub">${m.description}</div>
        </div>
        <span class="badge ${m.status}">${m.status.replace("_", " ")}</span>
      </div>`;
  });
});

// ---------- Shops ----------
const shopsQ = query(collection(db, "shops"), orderBy("name", "asc"));
onSnapshot(shopsQ, (snap) => {
  const el = document.getElementById("shopsList");
  if (snap.empty) { el.innerHTML = `<p class="empty-state">No partner shops yet.</p>`; return; }
  el.innerHTML = "";
  snap.forEach(d => {
    const s = d.data();
    el.innerHTML += `
      <div class="card" style="margin-bottom:10px">
        <h3>${s.name}</h3>
        <p class="label">${s.category || ""}</p>
        <p style="font-size:13px;margin-top:6px">${s.description || ""}</p>
        ${s.offer ? `<p style="font-size:12px;color:var(--accent);margin-top:6px;font-weight:700">🏷️ ${s.offer}</p>` : ""}
      </div>`;
  });
});

// ---------- Helpers ----------
function fmtDate(v) {
  if (!v) return "—";
  if (v.toDate) return v.toDate().toLocaleDateString();
  return v;
}
function cryptoToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(8))).map(b => b.toString(16).padStart(2, "0")).join("");
}
