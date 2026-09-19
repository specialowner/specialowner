import { db } from "./firebase-config.js";
import { prepareProofFile, preparePhotoFile, openDataUrl } from "./proof-file.js";
import { requireAuth, logout } from "./guard.js";
import { announcementMediaHtml } from "./announcement-media.js";
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
  ["home", "finance", "invites", "maint", "shops"].forEach(t => {
    document.getElementById(`tab-${t}`).style.display = (t === btn.dataset.tab) ? "block" : "none";
  });
}));

// ---------- Payments ----------
// Proof-of-payment uploads: residents can attach a receipt/screenshot to any
// payment that isn't already marked "paid" by admin. The file (compressed, stored inline)
// and a review record is created in "paymentProofs" (residents can only create
// that doc, not edit it afterwards — admin reviews it and updates its status).
let lastPaymentRows = [];
let proofsByPayment = {}; // paymentId -> latest proof {id, status, fileURL, ...}
const uploadingPayments = new Set(); // paymentIds currently mid-upload, for a local "Uploading…" state

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

// Currency formatting follows the reading direction: "EGP 500" in English, "500 ج.م" in Arabic.
function money(n) {
  const cur = t("currencyEgp");
  const lang = window.SO_I18N ? window.SO_I18N.getLang() : "en";
  return lang === "ar" ? `${n} ${cur}` : `${cur} ${n}`;
}
window.addEventListener("so-lang-changed", () => renderPayments());

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
            <div class="title">${p.description || t("monthlyFee")}</div>
            <div class="sub">${money(p.amount)} · ${t("dueLabel")} ${fmtDate(p.dueDate)}</div>
          </div>
          <span class="badge ${p.status}">${t(p.status) || p.status}</span>
        </div>
        ${p.status === "paid" ? "" : proofControlsHtml(p.id)}
      </div>`;
  });
  document.getElementById("dueNum").textContent = money(totalDue);
}

function proofControlsHtml(paymentId) {
  if (uploadingPayments.has(paymentId)) {
    return `<div class="sub" style="margin-top:8px">${t("uploadingProof")}</div>`;
  }
  const proof = proofsByPayment[paymentId];
  if (!proof) {
    return `<button type="button" class="btn btn-outline btn-sm upload-proof-btn" data-payment-id="${paymentId}" style="margin-top:8px">${t("uploadProof")}</button>`;
  }
  const statusLabel = t(`proof_${proof.status}`) || proof.status;
  const viewLink = proof.fileData
    ? `<a href="#" class="sub view-proof-link" data-payment-id="${paymentId}" style="color:var(--primary);font-weight:700;text-decoration:underline">${t("viewProof")}</a>`
    : proof.fileURL
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
  const link = e.target.closest(".view-proof-link");
  if (link) {
    e.preventDefault();
    const pr = proofsByPayment[link.dataset.paymentId];
    if (pr?.fileData) openDataUrl(pr.fileData);
    return;
  }
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

  if (!/^image\/|^application\/pdf$/.test(file.type)) { alert(t("proofInvalidType")); return; }
  if (file.size > 25 * 1024 * 1024) { alert(t("proofTooLarge")); return; }

  uploadingPayments.add(paymentId);
  renderPayments();
  try {
    const { dataUrl, fileName } = await prepareProofFile(file);
    const save = addDoc(collection(db, "paymentProofs"), {
      paymentId,
      residentId: user.uid,
      unit: profile.unit || "",
      fileData: dataUrl,
      fileName,
      status: "pending_review",
      uploadedAt: serverTimestamp()
    });
    // addDoc waits for the server; don't let the UI hang forever if the connection is dead.
    await Promise.race([
      save,
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout - check your connection")), 30000))
    ]);
  } catch (err) {
    console.error("Proof upload failed:", err);
    const msg = err.code === "pdf_too_large" ? t("proofPdfTooLarge")
      : err.code === "too_large" ? t("proofTooLarge")
      : err.code === "bad_image" ? t("proofInvalidType")
      : t("proofUploadFailed") + (err.message ? ` (${err.message})` : "");
    alert(msg);
  } finally {
    uploadingPayments.delete(paymentId);
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
          ${announcementMediaHtml(a)}
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

// ---------- Requests tab: three entry points ----------
// One tab, three different things a resident can send: a maintenance job inside their
// own unit, a recurring service subscription, or a report about the common areas.
const reqSwitch = document.getElementById("reqSwitch");
reqSwitch?.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  reqSwitch.querySelectorAll("button").forEach(b => b.classList.toggle("active", b === btn));
  ["maint", "subs", "report"].forEach(k => {
    document.getElementById(`req-${k}`).style.display = (k === btn.dataset.req) ? "block" : "none";
  });
  if (btn.dataset.req === "maint") markMaintSeen();
});

// ---------- Shared photo picker ----------
// Wires an "Add photo" button + hidden input + preview into a small object holding the
// compressed data URL, so both the maintenance form and the report form behave the same.
function makePhotoPicker(prefix) {
  const btn = document.getElementById(`${prefix}PhotoBtn`);
  const input = document.getElementById(`${prefix}PhotoInput`);
  const preview = document.getElementById(`${prefix}PhotoPreview`);
  const img = document.getElementById(`${prefix}PhotoImg`);
  const removeBtn = document.getElementById(`${prefix}PhotoRemove`);
  const state = { dataUrl: null, fileName: null, clear };

  function clear() {
    state.dataUrl = null;
    state.fileName = null;
    if (img) img.src = "";
    if (preview) preview.style.display = "none";
    if (btn) { btn.disabled = false; btn.textContent = t("addPhoto"); }
  }
  if (!btn || !input) return state;

  btn.addEventListener("click", () => input.click());
  removeBtn?.addEventListener("click", clear);
  input.addEventListener("change", async () => {
    const file = input.files[0];
    input.value = ""; // allow picking the same file again after removing it
    if (!file) return;
    if (!/^image\//.test(file.type)) { alert(t("photoInvalidType")); return; }
    btn.disabled = true;
    btn.textContent = t("photoProcessing");
    try {
      const { dataUrl, fileName } = await preparePhotoFile(file);
      state.dataUrl = dataUrl;
      state.fileName = fileName;
      img.src = dataUrl;
      preview.style.display = "inline-block";
      btn.textContent = t("changePhoto");
    } catch (err) {
      console.error("Photo attach failed:", err);
      alert(err.code === "bad_image" ? t("photoInvalidType") : t("photoTooLarge"));
      clear();
    } finally {
      btn.disabled = false;
    }
  });
  return state;
}
const maintPhoto = makePhotoPicker("maint");
const reportPhoto = makePhotoPicker("report");

// ---------- Maintenance (inside the unit) ----------
document.getElementById("createMaintBtn").addEventListener("click", async () => {
  if (currentAccountStatus !== "active") { alert(currentAccountStatus === "suspended" ? t("lockedMsgSuspended") : t("lockedMsgPending")); return; }
  const btn = document.getElementById("createMaintBtn");
  const category = document.getElementById("maintCategory").value;
  const description = document.getElementById("maintDesc").value.trim();
  if (!description) { alert(t("describeIssueFirst")); return; }

  btn.disabled = true;
  try {
    await addDoc(collection(db, "maintenanceRequests"), {
      residentId: user.uid,
      unit: profile.unit || "",
      category, description,
      source: "resident",
      status: "pending",
      statusSeenByResident: true,
      ...(maintPhoto.dataUrl ? { photoData: maintPhoto.dataUrl, photoName: maintPhoto.fileName } : {}),
      createdAt: serverTimestamp()
    });
    document.getElementById("maintDesc").value = "";
    maintPhoto.clear();
  } catch (err) {
    console.error("Maintenance request failed:", err);
    alert(t("requestFailed") + (err.message ? ` (${err.message})` : ""));
  } finally {
    btn.disabled = false;
  }
});

// ---------- Compound report (outside the unit) ----------
// Reports ride on the same "maintenanceRequests" collection so they land in the admin
// queue and can be assigned to a worker like anything else — they're just tagged with
// source "resident_report" and carry a free-text location instead of only a unit.
// Each report subject maps onto an existing work category so the craft routing
// (cleaning / maintenance / garden) keeps working untouched.
const REPORT_TYPE_TO_CATEGORY = {
  cleanliness: "Cleaning",
  lighting: "Electrical",
  garbage: "Cleaning",
  garden: "Garden",
  water: "Plumbing",
  elevator: "Other",
  safety: "Other",
  other: "Other"
};
const REPORT_TYPE_I18N_KEY = {
  cleanliness: "repCleanliness",
  lighting: "repLighting",
  garbage: "repGarbage",
  garden: "repGarden",
  water: "repWater",
  elevator: "repElevator",
  safety: "repSafety",
  other: "repOther"
};

document.getElementById("createReportBtn").addEventListener("click", async () => {
  if (currentAccountStatus !== "active") { alert(currentAccountStatus === "suspended" ? t("lockedMsgSuspended") : t("lockedMsgPending")); return; }
  const btn = document.getElementById("createReportBtn");
  const reportType = document.getElementById("reportType").value;
  const location = document.getElementById("reportLocation").value.trim();
  const description = document.getElementById("reportDesc").value.trim();
  if (!location) { alert(t("reportLocationFirst")); return; }
  if (!description) { alert(t("describeIssueFirst")); return; }

  btn.disabled = true;
  try {
    await addDoc(collection(db, "maintenanceRequests"), {
      residentId: user.uid,
      unit: profile.unit || "",
      category: REPORT_TYPE_TO_CATEGORY[reportType] || "Other",
      reportType,
      location,
      description,
      source: "resident_report",
      status: "pending",
      statusSeenByResident: true,
      ...(reportPhoto.dataUrl ? { photoData: reportPhoto.dataUrl, photoName: reportPhoto.fileName } : {}),
      createdAt: serverTimestamp()
    });
    document.getElementById("reportLocation").value = "";
    document.getElementById("reportDesc").value = "";
    reportPhoto.clear();
    alert(t("reportSent"));
  } catch (err) {
    console.error("Compound report failed:", err);
    alert(t("requestFailed") + (err.message ? ` (${err.message})` : ""));
  } finally {
    btn.disabled = false;
  }
});

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

const maintQ = query(collection(db, "maintenanceRequests"), where("residentId", "==", user.uid));
let lastMaintRows = [];
let lastReportRows = [];
onSnapshot(maintQ, (snap) => {
  const all = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  lastMaintRows = all.filter(m => m.source !== "resident_report");
  lastReportRows = all.filter(m => m.source === "resident_report");
  renderMaintNotifDot();
  renderReportList();
  const el = document.getElementById("maintList");
  if (lastMaintRows.length === 0) { el.innerHTML = `<p class="empty-state">${t("noRequests")}</p>`; return; }
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
          ${m.photoData ? `<img class="photo-thumb req-photo" src="${m.photoData}" data-id="${m.id}" alt="">` : ""}
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

function reportTypeLabel(m) {
  const key = REPORT_TYPE_I18N_KEY[m.reportType];
  return key ? t(key) : categoryLabel(m.category);
}

function renderReportList() {
  const el = document.getElementById("reportList");
  if (!el) return;
  if (lastReportRows.length === 0) { el.innerHTML = `<p class="empty-state">${t("noReports")}</p>`; return; }
  el.innerHTML = lastReportRows.map(m => `
    <div class="list-item">
      <div class="meta">
        <div class="title">${reportTypeLabel(m)}</div>
        <div class="sub">📍 ${m.location || "—"}</div>
        <div class="sub">${m.description}</div>
        ${m.photoData ? `<img class="photo-thumb req-photo" src="${m.photoData}" data-id="${m.id}" alt="">` : ""}
      </div>
      <span class="badge ${m.status}">${t(m.status) || m.status.replace("_", " ")}</span>
    </div>`).join("");
}

// Tapping a thumbnail opens the full-size picture in a new tab.
document.getElementById("tab-maint").addEventListener("click", (e) => {
  const img = e.target.closest(".req-photo");
  if (img) openDataUrl(img.src);
});

// ---------- Service subscriptions ----------
// Recurring services a resident can subscribe to. The subscription starts as
// "requested"; the admin confirms it (and the price) before it becomes active.
const SERVICES = [
  { id: "car_wash",      icon: "🚗", nameKey: "svcCarWash",   descKey: "svcCarWashDesc" },
  { id: "home_cleaning", icon: "🧹", nameKey: "svcHomeClean", descKey: "svcHomeCleanDesc" },
  { id: "garden_care",   icon: "🌿", nameKey: "svcGarden",    descKey: "svcGardenDesc" }
];
const FREQUENCIES = [
  { id: "weekly",   key: "freqWeekly" },
  { id: "biweekly", key: "freqBiweekly" },
  { id: "monthly",  key: "freqMonthly" },
  { id: "once",     key: "freqOnce" }
];
// A subscription still occupying a slot for that service (so we show its status
// instead of the sign-up form). Cancelled/rejected ones are history.
const LIVE_SUB_STATUSES = ["requested", "active"];

let subsByService = {};
const subsQ = query(collection(db, "serviceSubscriptions"), where("residentId", "==", user.uid));
onSnapshot(subsQ, (snap) => {
  const live = {};
  snap.docs.map(d => ({ id: d.id, ...d.data() })).forEach(s => {
    if (!LIVE_SUB_STATUSES.includes(s.status)) return;
    const existing = live[s.service];
    if (!existing || (s.requestedAt?.seconds || 0) >= (existing.requestedAt?.seconds || 0)) live[s.service] = s;
  });
  subsByService = live;
  renderServices();
}, (err) => {
  console.error("Subscriptions listener failed:", err);
});

function freqLabel(f) {
  const found = FREQUENCIES.find(x => x.id === f);
  return found ? t(found.key) : f;
}

function renderServices() {
  const el = document.getElementById("servicesList");
  if (!el) return;
  el.innerHTML = SERVICES.map(svc => {
    const sub = subsByService[svc.id];
    const body = sub
      ? `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
           <span class="badge ${sub.status}">${t(`sub_${sub.status}`) || sub.status}</span>
           <span class="sub" style="font-size:12px;color:var(--muted)">${freqLabel(sub.frequency)}</span>
         </div>
         ${sub.price ? `<div class="sub" style="font-size:12px;margin-top:6px">${t("svcPrice")}: ${sub.price}</div>` : ""}
         ${sub.status === "requested" ? `<div class="sub" style="font-size:12px;margin-top:6px">${t("svcAwaitingApproval")}</div>` : ""}
         <button type="button" class="btn btn-outline btn-sm svc-cancel" data-sub-id="${sub.id}" style="margin-top:10px">${t("svcCancel")}</button>`
      : `<div class="field" style="margin-bottom:10px">
           <label>${t("svcFrequency")}</label>
           <select class="svc-freq" data-service="${svc.id}">
             ${FREQUENCIES.map(f => `<option value="${f.id}">${t(f.key)}</option>`).join("")}
           </select>
         </div>
         <div class="field" style="margin-bottom:10px">
           <label>${t("svcNotes")}</label>
           <input type="text" class="svc-notes" data-service="${svc.id}" placeholder="${t("svcNotesPh")}">
         </div>
         <button type="button" class="btn btn-primary svc-subscribe" data-service="${svc.id}">${t("svcSubscribe")}</button>`;
    return `
      <div class="service-card">
        <div class="service-head">
          <span class="service-icon">${svc.icon}</span>
          <span class="service-name">${t(svc.nameKey)}</span>
        </div>
        <p class="service-desc">${t(svc.descKey)}</p>
        ${body}
      </div>`;
  }).join("");
}
renderServices();
window.addEventListener("so-lang-changed", renderServices);
window.addEventListener("so-lang-changed", renderReportList);

document.getElementById("servicesList").addEventListener("click", async (e) => {
  const subscribeBtn = e.target.closest(".svc-subscribe");
  const cancelBtn = e.target.closest(".svc-cancel");
  if (!subscribeBtn && !cancelBtn) return;
  if (currentAccountStatus !== "active") { alert(currentAccountStatus === "suspended" ? t("lockedMsgSuspended") : t("lockedMsgPending")); return; }

  if (subscribeBtn) {
    const service = subscribeBtn.dataset.service;
    const card = subscribeBtn.closest(".service-card");
    const frequency = card.querySelector(".svc-freq").value;
    const notes = card.querySelector(".svc-notes").value.trim();
    subscribeBtn.disabled = true;
    try {
      await addDoc(collection(db, "serviceSubscriptions"), {
        residentId: user.uid,
        unit: profile.unit || "",
        service, frequency, notes,
        status: "requested",
        requestedAt: serverTimestamp()
      });
      alert(t("svcRequestSent"));
    } catch (err) {
      console.error("Subscription failed:", err);
      alert(t("requestFailed") + (err.message ? ` (${err.message})` : ""));
      subscribeBtn.disabled = false;
    }
    return;
  }

  if (!confirm(t("svcCancelConfirm"))) return;
  cancelBtn.disabled = true;
  try {
    await updateDoc(doc(db, "serviceSubscriptions", cancelBtn.dataset.subId), {
      status: "cancelled",
      cancelledAt: serverTimestamp()
    });
  } catch (err) {
    console.error("Cancel failed:", err);
    alert(t("requestFailed") + (err.message ? ` (${err.message})` : ""));
    cancelBtn.disabled = false;
  }
});

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
