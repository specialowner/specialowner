import { db } from "./firebase-config.js";
import { requireAuth, logout } from "./guard.js";
import {
  collection, addDoc, query, where, orderBy, onSnapshot, serverTimestamp, Timestamp, doc, updateDoc, getDoc
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const { user, profile } = await requireAuth("resident");

function t(key) {
  const lang = window.SO_I18N ? window.SO_I18N.getLang() : "en";
  return window.SO_I18N ? window.SO_I18N.translations[lang][key] : key;
}

function renderGreeting() {
  document.getElementById("greetName").textContent = `${t("hiThere")}, ${profile.name?.split(" ")[0] || ""} 👋`;
  document.getElementById("greetUnit").textContent = `${t("unitLabel")} ${profile.unit || "—"}`;
}
renderGreeting();
window.addEventListener("so-lang-changed", renderGreeting);
window.addEventListener("so-lang-changed", renderAccountStatus);

document.getElementById("pointsNum").textContent = profile.points ?? 0;
document.getElementById("shopsPoints").textContent = profile.points ?? 0;
document.getElementById("logoutBtn").addEventListener("click", logout);

// ---------- Account status (pending / active / suspended) ----------
// Missing field = legacy account created before this feature = treated as active.
let currentAccountStatus = "active";
let activationRequestPending = false;

const userDocRef = doc(db, "users", user.uid);
onSnapshot(userDocRef, (snap) => {
  const data = snap.data() || {};
  currentAccountStatus = data.accountStatus || "active";
  activationRequestPending = data.activationRequestStatus === "pending";
  renderAccountStatus();
});

function renderAccountStatus() {
  const isLocked = currentAccountStatus !== "active";
  const banner = document.getElementById("statusBanner");
  if (isLocked) {
    banner.style.display = "block";
    banner.textContent = currentAccountStatus === "suspended" ? t("statusSuspendedBanner") : t("statusPendingBanner");
  } else {
    banner.style.display = "none";
  }

  ["invites", "maint"].forEach(tab => {
    const lockCard = document.getElementById(tab === "invites" ? "invitesLockCard" : "maintLockCard");
    const lockMsg = document.getElementById(tab === "invites" ? "invitesLockMsg" : "maintLockMsg");
    const unlockedArea = document.getElementById(tab === "invites" ? "invitesUnlockedArea" : "maintUnlockedArea");
    lockCard.style.display = isLocked ? "block" : "none";
    unlockedArea.style.display = isLocked ? "none" : "block";
    if (isLocked) lockMsg.textContent = currentAccountStatus === "suspended" ? t("lockedMsgSuspended") : t("lockedMsgPending");
  });
}

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
document.getElementById("requestActivationBtnInvites").addEventListener("click", requestActivation);
document.getElementById("requestActivationBtnMaint").addEventListener("click", requestActivation);

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
const paymentsQ = query(collection(db, "payments"), where("residentId", "==", user.uid));
onSnapshot(paymentsQ, (snap) => {
  const el = document.getElementById("paymentsList");
  if (snap.empty) { el.innerHTML = `<p class="empty-state">${t("noPayments")}</p>`; return; }
  let totalDue = 0;
  el.innerHTML = "";
  const rows = snap.docs.map(d => d.data()).sort((a, b) => (b.dueDate || "").localeCompare(a.dueDate || ""));
  rows.forEach(p => {
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
  if (snap.empty) { el.innerHTML = `<p class="empty-state">${t("noAnnouncements")}</p>`; return; }
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
  if (currentAccountStatus !== "active") { alert(currentAccountStatus === "suspended" ? t("lockedMsgSuspended") : t("lockedMsgPending")); return; }
  const guestName = document.getElementById("guestName").value.trim();
  const guestPhone = document.getElementById("guestPhone").value.trim();
  const guestDate = document.getElementById("guestDate").value;
  if (!guestName || !guestDate) { alert("Please fill in the guest name and visit date."); return; }

  const btn = document.getElementById("createInviteBtn");
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = "…";

  try {
    if (typeof QRCode === "undefined") {
      throw new Error("QR library did not load. Check your internet connection or ad-blocker and reload the page.");
    }

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

    const qrPayload = JSON.stringify({ inviteId: ref.id, token, ts: Date.now() });
    const canvas = document.getElementById("qrCanvas");
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height); // wipe any previously drawn QR first
    await QRCode.toCanvas(canvas, qrPayload, { width: 220, margin: 1, color: { dark: "#0f6e5f" } });
    document.getElementById("qrResultCard").style.display = "block";
    document.getElementById("guestName").value = "";
    document.getElementById("guestPhone").value = "";
    document.getElementById("guestDate").value = "";
  } catch (err) {
    console.error("Invite creation failed:", err);
    alert("Could not create the invitation: " + (err.message || err));
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
});

const invitesQ = query(collection(db, "invitations"), where("residentId", "==", user.uid));
onSnapshot(invitesQ, (snap) => {
  const el = document.getElementById("invitesList");
  if (snap.empty) { el.innerHTML = `<p class="empty-state">${t("noInvitations")}</p>`; return; }
  el.innerHTML = "";
  const rows = snap.docs.map(d => d.data()).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  rows.forEach(i => {
    el.innerHTML += `
      <div class="list-item">
        <div class="meta">
          <div class="title">${i.guestName}</div>
          <div class="sub">${t("visitDate")}: ${fmtVisitDateTime(i.visitDate)}</div>
        </div>
        <span class="badge ${i.status}">${i.status}</span>
      </div>`;
  });
});

// ---------- Maintenance ----------
document.getElementById("createMaintBtn").addEventListener("click", async () => {
  if (currentAccountStatus !== "active") { alert(currentAccountStatus === "suspended" ? t("lockedMsgSuspended") : t("lockedMsgPending")); return; }
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

const maintQ = query(collection(db, "maintenanceRequests"), where("residentId", "==", user.uid));
onSnapshot(maintQ, (snap) => {
  const el = document.getElementById("maintList");
  if (snap.empty) { el.innerHTML = `<p class="empty-state">${t("noRequests")}</p>`; return; }
  el.innerHTML = "";
  const rows = snap.docs.map(d => d.data()).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  rows.forEach(m => {
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
  if (snap.empty) { el.innerHTML = `<p class="empty-state">${t("noShops")}</p>`; return; }
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
function fmtVisitDateTime(v) {
  if (!v) return "—";
  const d = new Date(v); // v is a "datetime-local" string, e.g. 2026-08-23T14:30
  if (isNaN(d.getTime())) return v;
  return d.toLocaleString(window.SO_I18N && window.SO_I18N.getLang() === "ar" ? "ar-EG" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}
function cryptoToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, "0")).join("");
}
