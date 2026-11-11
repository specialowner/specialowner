// Special Owner — administration of the QR access system (loaded by admin.js).
//   master passes · access points (gates, barriers, lobbies, lifts + floor map) · controllers · phone credentials
//   · resident photos for the guardhouse · live event feed
import {
  collection, doc, query, where, orderBy, limit, onSnapshot, addDoc, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const Q = window.SOQR;
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const ms = (v) => (v && v.toMillis ? v.toMillis() : v && v.seconds ? v.seconds * 1000 : 0);

export function initAdminQr({ db, user, t, adminErr, stLabel }) {
  const $ = (id) => document.getElementById(id);
  const lang = () => window.SO_I18N.getLang();
  const loc = () => (lang() === "ar" ? "ar-EG" : "en-GB");
  const fmt = (n) => (n ? new Date(n).toLocaleString(loc(), { dateStyle: "medium", timeStyle: "short" }) : "—");

  // ================================================== master passes
  let masterRows = [], legacyMasters = [], lastMasterId = null;
  const qrOpts = { width: 236, margin: 2, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } };

  $("generateMasterBtn").addEventListener("click", async () => {
    const label = $("masterLabel").value.trim();
    const expiryVal = $("masterExpiry").value;
    const zones = [...document.querySelectorAll(".zoneCheck:checked")].map((cb) => cb.value);
    if (!label) { alert(t("adminNeedCodeLabel")); return; }
    if (zones.length === 0) { alert(t("adminNeedZone")); return; }
    if (typeof QRCode === "undefined") { alert(t("adminQrLibMissing")); return; }
    const btn = $("generateMasterBtn"); btn.disabled = true;
    try {
      const pass = await Q.newPass();
      await setDoc(doc(db, "accessPasses", pass.id), {
        kind: "master", label, zones, mode: "window", validFrom: Timestamp.now(),
        validUntil: expiryVal ? Timestamp.fromDate(new Date(expiryVal)) : null,
        maxUses: null, uses: 0, vehicle: true, inside: false, secretHash: pass.secretHash, status: "active",
        createdBy: user.uid, createdAt: serverTimestamp(),
      });
      await window.QRCode.toCanvas($("masterQrCanvas"), pass.token, qrOpts);
      $("masterQrResultCard").style.display = "block";
      $("revokeMasterBtn").dataset.id = pass.id;
      $("masterLabel").value = ""; $("masterExpiry").value = "";
    } catch (err) { console.error("Master pass failed:", err); alert(adminErr(err)); }
    finally { btn.disabled = false; }
  });
  $("revokeMasterBtn").addEventListener("click", async () => {
    const id = $("revokeMasterBtn").dataset.id; if (!id) return;
    await updateDoc(doc(db, "accessPasses", id), { status: "revoked" });
    $("masterQrResultCard").style.display = "none";
  });
  onSnapshot(query(collection(db, "accessPasses"), where("kind", "==", "master")), (s) => { masterRows = s.docs.map((d) => ({ id: d.id, ...d.data() })); renderMasters(); }, (e) => console.error(e));
  onSnapshot(query(collection(db, "invitations"), where("type", "==", "master")), (s) => { legacyMasters = s.docs.map((d) => ({ id: d.id, ...d.data() })); renderMasters(); }, (e) => console.error(e));

  function renderMasters() {
    const el = $("masterCodesList");
    const rows = [
      ...masterRows.map((m) => ({ legacy: false, at: ms(m.createdAt), m, until: m.validUntil ? ms(m.validUntil) : null, zones: m.zones || [] })),
      ...legacyMasters.map((m) => ({ legacy: true, at: ms(m.createdAt), m, until: m.expiresAt ? ms(m.expiresAt) : null, zones: m.accessZones || [] })),
    ].sort((a, b) => b.at - a.at);
    if (!rows.length) { el.innerHTML = `<p class="empty-state">${t("noMasterCodes")}</p>`; return; }
    el.innerHTML = rows.map(({ legacy, m, until, zones }) => {
      const expired = until && until < Date.now();
      const st = m.status === "revoked" ? "revoked" : expired ? "expired" : "active";
      return `<div class="list-item">
        <div class="meta"><div class="title">${esc(m.label)} ${legacy ? `<span class="badge cancelled">${t("sqLegacy")}</span>` : ""}</div>
        <div class="sub">${zones.map((z) => esc(t(z))).join("، ")}${until ? " · " + fmt(until) : ""}</div></div>
        <span class="badge ${st}">${stLabel(st)}</span>
        ${st === "active" ? `<button class="btn btn-sm btn-danger" data-mrev="${esc(m.id)}" data-legacy="${legacy ? 1 : 0}" style="margin-inline-start:6px">${t("revoke")}</button>` : ""}
      </div>`;
    }).join("");
    el.querySelectorAll("[data-mrev]").forEach((b) => b.addEventListener("click", async () => {
      b.disabled = true;
      try { await updateDoc(doc(db, b.dataset.legacy === "1" ? "invitations" : "accessPasses", b.dataset.mrev), { status: "revoked" }); }
      catch (e) { console.error(e); alert(adminErr(e)); b.disabled = false; }
    }));
  }

  // ================================================== site key
  onSnapshot(doc(db, "siteConfig", "qr"), (s) => {
    const d = s.exists() ? s.data() : null;
    $("sqSiteFp").textContent = d && d.fingerprint ? d.fingerprint : t("sqSiteNoKey");
    $("sqSiteFp").className = "badge " + (d && d.fingerprint ? "active" : "pending");
  }, (e) => console.error(e));

  // ================================================== access points
  let aps = [], buildings = [];
  onSnapshot(collection(db, "buildings"), (s) => { buildings = s.docs.map((d) => ({ id: d.id, ...d.data() })); renderApBuildings(); renderAps(); });
  onSnapshot(collection(db, "accessPoints"), (s) => { aps = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.id.localeCompare(b.id)); renderAps(); }, (e) => console.error(e));
  const bName = (id) => { const b = buildings.find((x) => x.id === id); return b ? b.name || b.code || id : ""; };
  function renderApBuildings() {
    const sel = $("apBuilding"); if (!sel) return; const cur = sel.value;
    sel.innerHTML = `<option value="">—</option>` + buildings.map((b) => `<option value="${esc(b.id)}">${esc(b.name || b.code || b.id)}</option>`).join("");
    sel.value = cur;
  }
  function toggleApFields() {
    const type = $("apType").value;
    $("apStopsField").style.display = type === "elevator" ? "block" : "none";
    $("apLoopField").style.display = type === "vehicle" ? "flex" : "none";
  }
  $("apType").addEventListener("change", toggleApFields); toggleApFields();

  // elevator stops: one per line  "label ; floor ; common(0/1) ; relay"   e.g.  "Garage ; -1 ; 1 ; 0"
  function parseStops(txt) {
    const out = [];
    for (const raw of String(txt || "").split("\n")) {
      const line = raw.trim(); if (!line) continue;
      const p = line.split(";").map((x) => x.trim());
      if (p.length < 4) throw new Error(t("sqStopsBad") + ": " + line);
      const relay = Number(p[3]), floor = p[1] === "" ? null : Number(p[1]);
      if (!Number.isInteger(relay) || relay < 0 || (floor != null && !Number.isFinite(floor))) throw new Error(t("sqStopsBad") + ": " + line);
      out.push({ label: p[0].slice(0, 30), floor, common: p[2] === "1" || /^(y|yes|true|common)$/i.test(p[2]), relay });
    }
    return out;
  }
  const stopsText = (ap) => (ap.stops || []).map((s) => `${s.label} ; ${s.floor == null ? "" : s.floor} ; ${s.common ? 1 : 0} ; ${s.relay}`).join("\n");

  $("apSaveBtn").addEventListener("click", async () => {
    const id = $("apId").value.trim().toLowerCase(), name = $("apName").value.trim();
    if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(id) || !name) { alert(t("sqApNeedIdName")); return; }
    const type = $("apType").value;
    const data = {
      name, type, direction: $("apDir").value, buildingId: $("apBuilding").value || null, enabled: $("apEnabled").checked,
      requireEntry: $("apRequireEntry").checked, updatedAt: serverTimestamp(),
    };
    if (type === "vehicle") data.loop = { required: $("apLoopRequired").checked };
    try {
      if (type === "elevator") { data.stops = parseStops($("apStops").value); if (!data.stops.length) { alert(t("sqStopsBad")); return; } }
      $("apSaveBtn").disabled = true;
      await setDoc(doc(db, "accessPoints", id), data);
      ["apId", "apName", "apStops"].forEach((x) => { $(x).value = ""; });
    } catch (e) { console.error(e); alert(e && e.message && e.message.startsWith(t("sqStopsBad")) ? e.message : adminErr(e)); }
    finally { $("apSaveBtn").disabled = false; }
  });
  function renderAps() {
    const el = $("apList"); if (!el) return;
    if (!aps.length) { el.innerHTML = `<p class="empty-state">${t("sqApNone")}</p>`; return; }
    el.innerHTML = aps.map((a) => `<div class="list-item">
      <div class="meta"><div class="title">${esc(a.name)} <span class="sq-kind">${esc(a.id)}</span></div>
      <div class="sub">${esc(t("sqApType_" + a.type))} · ${a.direction === "out" ? t("ghExit") : t("ghEntry")}${a.buildingId ? " · " + esc(bName(a.buildingId)) : ""}${a.type === "elevator" ? " · " + (a.stops || []).length + " " + t("sqApStops") : ""}</div></div>
      <span class="badge ${a.enabled === false ? "cancelled" : "active"}">${a.enabled === false ? t("sqApOff") : t("sqApOn")}</span>
      <button class="btn btn-sm btn-outline" data-apedit="${esc(a.id)}" style="margin-inline-start:6px">${t("sqApEdit")}</button>
      <button class="btn btn-sm btn-danger" data-apdel="${esc(a.id)}" style="margin-inline-start:6px">${t("sqApDelete")}</button></div>`).join("");
    el.querySelectorAll("[data-apedit]").forEach((b) => b.addEventListener("click", () => {
      const a = aps.find((x) => x.id === b.dataset.apedit); if (!a) return;
      $("apId").value = a.id; $("apName").value = a.name || ""; $("apType").value = a.type || "gate"; $("apDir").value = a.direction || "in";
      $("apBuilding").value = a.buildingId || ""; $("apEnabled").checked = a.enabled !== false; $("apRequireEntry").checked = !!a.requireEntry;
      $("apLoopRequired").checked = !(a.loop && a.loop.required === false); $("apStops").value = stopsText(a); toggleApFields();
      $("apName").scrollIntoView({ behavior: "smooth", block: "center" });
    }));
    el.querySelectorAll("[data-apdel]").forEach((b) => b.addEventListener("click", async () => {
      if (!confirm(t("sqApDeleteConfirm"))) return;
      try { await deleteDoc(doc(db, "accessPoints", b.dataset.apdel)); } catch (e) { console.error(e); alert(adminErr(e)); }
    }));
  }

  // ================================================== controllers
  onSnapshot(collection(db, "controllers"), (s) => {
    const el = $("ctrlList");
    if (s.empty) { el.innerHTML = `<p class="empty-state">${t("sqCtrlNone")}</p>`; return; }
    const now = Date.now();
    el.innerHTML = s.docs.map((d) => {
      const c = d.data(), last = ms(c.lastSeen), age = last ? (now - last) / 1000 : Infinity;
      const live = age < 120;
      return `<div class="list-item"><div class="meta"><div class="title">${esc(d.id)} <span class="sq-kind">v${esc(c.version || "?")}</span></div>
        <div class="sub">${t("sqCtrlSeen")}: ${fmt(last)} · ${t("sqCtrlQueue")}: ${Number(c.queued) || 0}${c.syncedAtMs ? " · " + t("sqCtrlCache") + ": " + (Math.round((now - c.syncedAtMs) / 360000) / 10) + " h" : ""}</div></div>
        <span class="badge ${live ? "active" : "expired"}">${live ? t("sqCtrlOnline") : t("sqCtrlOffline")}</span></div>`;
    }).join("");
  }, (e) => console.error(e));

  // ================================================== phone credentials
  let users = {};
  onSnapshot(query(collection(db, "users"), where("role", "==", "resident")), (s) => { users = {}; s.docs.forEach((d) => { users[d.id] = d.data(); }); renderCreds(); renderPhotos(); }, (e) => console.error(e));
  let creds = [];
  onSnapshot(query(collection(db, "qrCredentials"), where("status", "==", "active")), (s) => { creds = s.docs.map((d) => ({ id: d.id, ...d.data() })); renderCreds(); }, (e) => console.error(e));
  function renderCreds() {
    const el = $("credList"); if (!el) return;
    $("credCount").textContent = String(creds.length);
    if (!creds.length) { el.innerHTML = `<p class="empty-state">${t("sqCredNone")}</p>`; return; }
    el.innerHTML = creds.sort((a, b) => ms(b.createdAt) - ms(a.createdAt)).slice(0, 60).map((c) => `<div class="list-item">
      <div class="meta"><div class="title">${esc((users[c.uid] || {}).name || c.uid)}</div><div class="sub">${esc(c.label || "")} · ${fmt(ms(c.createdAt))}</div></div>
      <button class="btn btn-sm btn-danger" data-credoff="${esc(c.id)}">${t("sqSwitchOff")}</button></div>`).join("");
    el.querySelectorAll("[data-credoff]").forEach((b) => b.addEventListener("click", async () => {
      if (!confirm(t("sqSwitchOffConfirm"))) return;
      try { await updateDoc(doc(db, "qrCredentials", b.dataset.credoff), { status: "revoked", revokedAt: serverTimestamp(), revokedBy: user.uid }); }
      catch (e) { console.error(e); alert(adminErr(e)); }
    }));
  }

  // ================================================== photo approval
  let idents = [];
  onSnapshot(collection(db, "accessIdentities"), (s) => { idents = s.docs.map((d) => ({ id: d.id, ...d.data() })); renderPhotos(); }, (e) => console.error(e));
  function renderPhotos() {
    const el = $("photoList"); if (!el) return;
    const pend = idents.filter((i) => i.photo && i.photoStatus !== "approved");
    if (!pend.length) { el.innerHTML = `<p class="empty-state">${t("sqPhotoNonePending")}</p>`; return; }
    el.innerHTML = pend.map((i) => `<div class="list-item">
      <img src="${esc(i.photo)}" alt="" width="56" height="56" style="border-radius:50%;object-fit:cover;margin-inline-end:10px">
      <div class="meta"><div class="title">${esc((users[i.id] || {}).name || i.id)}</div><div class="sub">${esc((users[i.id] || {}).unit || "")}</div></div>
      <button class="btn btn-sm btn-primary" data-ph-ok="${esc(i.id)}">${t("approve")}</button>
      <button class="btn btn-sm btn-danger" data-ph-no="${esc(i.id)}" style="margin-inline-start:6px">${t("sqPhotoReject")}</button></div>`).join("");
    el.querySelectorAll("[data-ph-ok]").forEach((b) => b.addEventListener("click", async () => {
      try { await updateDoc(doc(db, "accessIdentities", b.dataset.phOk), { photoStatus: "approved" }); } catch (e) { console.error(e); alert(adminErr(e)); }
    }));
    el.querySelectorAll("[data-ph-no]").forEach((b) => b.addEventListener("click", async () => {
      try { await deleteDoc(doc(db, "accessIdentities", b.dataset.phNo)); } catch (e) { console.error(e); alert(adminErr(e)); }
    }));
  }

  // ================================================== live events
  onSnapshot(query(collection(db, "accessEvents"), orderBy("ts", "desc"), limit(25)), (s) => {
    const el = $("evList");
    if (s.empty) { el.innerHTML = `<p class="empty-state">${t("noEntries")}</p>`; return; }
    const R = (r) => (window.SO_I18N.translations[lang()] || {})["ghR_" + String(r || "").replace(/-/g, "_")] || t("ghR_other");
    el.innerHTML = s.docs.map((d) => {
      const e = d.data(), ok = e.result === "allowed";
      return `<div class="list-item"><div class="meta"><div class="title">${esc(e.name || t("ghSubjUnknown"))}${e.unit ? " · " + esc(e.unit) : ""}</div>
        <div class="sub">${fmt(ms(e.ts))} · ${e.direction === "exit" ? t("ghExit") : t("ghEntry")} · ${esc(e.apName || e.apId)}${ok ? "" : " · " + esc(R(e.reason))}${e.offline ? " · " + t("ghOfflineDecision") : ""}</div></div>
        <span class="badge ${ok ? "active" : "revoked"}">${ok ? t("ghAllowed") : t("ghDenied")}</span></div>`;
    }).join("");
  }, (e) => console.error(e));

  window.addEventListener("so-lang-changed", () => { renderMasters(); renderAps(); renderCreds(); renderPhotos(); });
}
