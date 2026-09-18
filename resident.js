import { db, storage } from "./firebase-config.js";
import { requireAuth, logout } from "./guard.js";
import {
  collection, addDoc, query, where, orderBy, onSnapshot, serverTimestamp, Timestamp, doc, updateDoc, getDoc
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  ref as storageRef, uploadBytesResumable, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";

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
// Proof-of-payment uploads: residents can attach a receipt/screenshot to any
// payment that isn't already marked "paid" by admin. The file goes to Storage
// and a review record is created in "paymentProofs" (residents can only create
// that doc, not edit it afterwards — admin reviews it and updates its status).
let lastPaymentRows = [];
let proofsByPayment = {}; // paymentId -> latest proof {id, status, fileURL, ...}
const uploadingPayments = new Set(); // paymentIds currently mid-upload, for a local "Uploading…" state
const uploadProgress = {}; // paymentId -> 0..100
// Fail fast instead of silently retrying for 10 minutes if Storage is unreachable / not set up.
storage.maxUploadRetryTime = 30000;
storage.maxOperationRetryTime = 30000;

const paymentsQ = query(collection(db, "payments"), where("residentId", "==", user.uid));
onSnapshot(paymentsQ, (snap) => {
  lastPaymentRows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.dueDate || "").localeCompare(a.dueDate || ""));
  renderPayments();
});

const proofsQ = query(collection(db, "paymentProofs"), where("residentId", "==", user.uid));
onSnapshot(proofsQ, (snap) => {
  const latest = {};
  snap.docs.map(d => ({ id: d.id, ...d.data() })).forEach(p => {
    const existing = latest[p.paymentId];
    const pTime = p.uploadedAt?.toMillis ? p.uploadedAt.toMillis() : 0;
    const eTime = existing?.uploadedAt?.toMillis ? existing.uploadedAt.toMillis() : -1;
    if (!existing || pTime >= eTime) latest[p.paymentId] = p;
  });
  proofsByPayment = latest;
  renderPayments();
});

function renderPayments() {
  const el = document.getElementById("paymentsList");
  if (lastPaymentRows.length === 0) { el.innerHTML = `<p class="empty-state">${t("noPayments")}</p>`; return; }
  let totalDue = 0;
  el.innerHTML = "";
  lastPaymentRows.forEach(p => {
    if (p.status !== "paid") totalDue += Number(p.amount || 0);
    el.innerHTML += `
      <div class="list-item" style="flex-direction:column;align-items:stretch">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
          <div class="meta">
            <div class="title">${p.description || "Monthly fee"}</div>
            <div class="sub">EGP ${p.amount} · due ${fmtDate(p.dueDate)}</div>
          </div>
          <span class="badge ${p.status}">${t(p.status) || p.status}</span>
        </div>
        ${p.status === "paid" ? "" : proofControlsHtml(p.id)}
      </div>`;
  });
  document.getElementById("dueNum").textContent = `EGP ${totalDue}`;
}

function proofControlsHtml(paymentId) {
  if (uploadingPayments.has(paymentId)) {
    const pct = uploadProgress[paymentId];
    return `<div class="sub" style="margin-top:8px">${t("uploadingProof")}${pct != null ? ` ${pct}%` : ""}</div>`;
  }
  const proof = proofsByPayment[paymentId];
  if (!proof) {
    return `<button type="button" class="btn btn-outline btn-sm upload-proof-btn" data-payment-id="${paymentId}" style="margin-top:8px">${t("uploadProof")}</button>`;
  }
  const statusLabel = t(`proof_${proof.status}`) || proof.status;
  const viewLink = proof.fileURL
    ? `<a href="${proof.fileURL}" target="_blank" rel="noopener" class="sub" style="color:var(--primary);font-weight:700;text-decoration:underline">${t("viewProof")}</a>`
    : "";
  const canReplace = proof.status !== "pending_review";
  return `
    <div style="margin-top:8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <span class="badge ${proof.status}">${statusLabel}</span>
      ${viewLink}
      ${canReplace ? `<button type="button" class="btn btn-outline btn-sm upload-proof-btn" data-payment-id="${paymentId}">${t("replaceProof")}</button>` : ""}
    </div>
    ${proof.status === "rejected" && proof.reviewNote ? `<div class="sub" style="margin-top:4px">${proof.reviewNote}</div>` : ""}`;
}

// Clicking any (current or future) "upload proof" button opens the shared
// hidden file input; delegation is needed since the list is re-rendered often.
let pendingProofPaymentId = null;
document.getElementById("paymentsList").addEventListener("click", (e) => {
  const btn = e.target.closest(".upload-proof-btn");
  if (!btn) return;
  pendingProofPaymentId = btn.dataset.paymentId;
  document.getElementById("proofFileInput").click();
});

document.getElementById("proofFileInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  const paymentId = pendingProofPaymentId;
  e.target.value = ""; // allow re-selecting the same file later
  if (!file || !paymentId) return;

  const MAX_BYTES = 5 * 1024 * 1024;
  if (file.size > MAX_BYTES) { alert(t("proofTooLarge")); return; }
  if (!/^image\/|^application\/pdf$/.test(file.type)) { alert(t("proofInvalidType")); return; }

  uploadingPayments.add(paymentId);
  renderPayments();
  try {
    const path = `paymentProofs/${user.uid}/${paymentId}/${Date.now()}_${file.name}`;
    const fileRef = storageRef(storage, path);
    await new Promise((resolve, reject) => {
      const task = uploadBytesResumable(fileRef, file, { contentType: file.type });
      task.on("state_changed",
        (snapshot) => {
          uploadProgress[paymentId] = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
          renderPayments();
        },
        reject,
        resolve
      );
    });
    const fileURL = await getDownloadURL(fileRef);
    await addDoc(collection(db, "paymentProofs"), {
      paymentId,
      residentId: user.uid,
      unit: profile.unit || "",
      fileURL,
      filePath: path,
      fileName: file.name,
      status: "pending_review",
      uploadedAt: serverTimestamp()
    });
  } catch (err) {
    console.error("Proof upload failed:", err);
    alert(t("proofUploadFailed") + (err.message ? ` (${err.message})` : ""));
  } finally {
    uploadingPayments.delete(paymentId);
    delete uploadProgress[paymentId];
    renderPayments();
  }
});

// ---------- Announcements ----------
const annQ = query(collection(db, "announcements"), orderBy("createdAt", "desc"));
onSnapshot(annQ, (snap) => {
  const el = document.getElementById("announcementsList");
  const rows = snap.docs.map(d => d.data())
    .filter(a => !a.audience || a.audience === "all" || a.audience === "residents")
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

// ---------- Invitations ----------
let lastInviteInfo = null;

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

    // Keep the message/guest details available for the WhatsApp share button below.
    lastInviteInfo = { guestName, visitDate: guestDate, residentUnit: profile.unit || "" };

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

// ---------- WhatsApp share ----------
document.getElementById("shareWhatsappBtn").addEventListener("click", async () => {
  if (!lastInviteInfo) return;
  const message =
    `دعوة دخول - ${lastInviteInfo.guestName}\n` +
    `${t("unitLabel")}: ${lastInviteInfo.residentUnit || "—"}\n` +
    `${t("visitDate")}: ${fmtVisitDateTime(lastInviteInfo.visitDate)}\n` +
    `يرجى إظهار رمز QR المرفق عند البوابة.`;

  const canvas = document.getElementById("qrCanvas");

  // Try the native share sheet first (works on most mobile browsers) so the
  // QR image and the message go together in one share action.
  try {
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    const file = new File([blob], "invitation-qr.png", { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], text: message });
      return;
    }
  } catch (err) {
    // If the user just cancels the native share sheet, don't fall through to the wa.me link too.
    if (err && err.name === "AbortError") return;
    console.warn("Native share unavailable, falling back to wa.me link:", err);
  }

  // Fallback: open WhatsApp with the text pre-filled; the image has to be attached manually.
  alert(t("whatsappShareUnsupported"));
  window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank");
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
    source: "resident",
    status: "pending",
    statusSeenByResident: true,
    createdAt: serverTimestamp()
  });
  document.getElementById("maintDesc").value = "";
});

const CATEGORY_I18N_KEY = {
  "Plumbing": "catPlumbing",
  "Electrical": "catElectrical",
  "AC / Cooling": "catAC",
  "Carpentry": "catCarpentry",
  "Cleaning": "catCleaning",
  "Other": "catOther"
};
function categoryLabel(cat) {
  const key = CATEGORY_I18N_KEY[cat];
  return key ? t(key) : cat; // fallback for any legacy/custom value
}

const maintQ = query(collection(db, "maintenanceRequests"), where("residentId", "==", user.uid));
let lastMaintRows = [];
onSnapshot(maintQ, (snap) => {
  const el = document.getElementById("maintList");
  lastMaintRows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  renderMaintNotifDot();
  if (snap.empty) { el.innerHTML = `<p class="empty-state">${t("noRequests")}</p>`; return; }
  el.innerHTML = "";
  lastMaintRows.forEach(m => {
    const isUnseen = m.statusSeenByResident === false;
    // Queue position is written onto the doc by the admin/manager clients (residents
    // can't read other residents' requests to count it themselves).
    const showQueue = (m.status === "pending" || m.status === "accepted") && typeof m.queueAhead === "number";
    // Waiting time is maintained on the doc alongside queueAhead: the sum of the
    // durations the workers estimated for the requests queued before this one.
    const eta = Number(m.queueEtaHours);
    const etaText = showQueue && m.queueAhead > 0 && eta > 0
      ? ` · ≈ ${eta === 0.5 ? t("estHalfHour") : `${eta} ${eta === 1 ? t("estHour") : t("estHours")}`} ${t("estWait")}`
      : "";
    const queueLine = !showQueue ? "" : (m.queueAhead === 0
      ? `<div class="sub" style="color:#3a7d5c">${t("yourTurnNow")}</div>`
      : `<div class="sub">${m.queueAhead === 1 ? t("requestsAheadSingular") : `${m.queueAhead} ${t("requestsAheadPlural")}`}${etaText}</div>`);
    el.innerHTML += `
      <div class="list-item">
        <div class="meta">
          <div class="title">${categoryLabel(m.category)}</div>
          <div class="sub">${m.description}</div>
          ${queueLine}
        </div>
        <span class="badge ${m.status}">${t(m.status) || m.status.replace("_", " ")}</span>
        ${isUnseen ? `<span class="badge" style="background:#fdeaea;color:#a63b3b;border:1px solid #f2c6c6;margin-left:4px">${t("newUpdate") || "New update"}</span>` : ""}
      </div>`;
  });
});

function renderMaintNotifDot() {
  const hasUnseen = lastMaintRows.some(m => m.statusSeenByResident === false);
  const tabBtn = document.querySelector('.tab-btn[data-tab="maint"]');
  if (!tabBtn) return;
  let dot = tabBtn.querySelector(".maint-notif-dot");
  if (hasUnseen && !dot) {
    dot = document.createElement("span");
    dot.className = "maint-notif-dot";
    dot.style.cssText = "display:inline-block;width:8px;height:8px;border-radius:50%;background:#d64545;margin-left:4px;vertical-align:top";
    tabBtn.appendChild(dot);
  } else if (!hasUnseen && dot) {
    dot.remove();
  }
}

async function markMaintSeen() {
  const unseen = lastMaintRows.filter(m => m.statusSeenByResident === false);
  if (unseen.length === 0) return;
  await Promise.all(unseen.map(m => updateDoc(doc(db, "maintenanceRequests", m.id), { statusSeenByResident: true })));
}
document.querySelector('.tab-btn[data-tab="maint"]')?.addEventListener("click", markMaintSeen);

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
