// Special Owner — resident side of the QR access system (loaded by resident.js).
//   1. "My access QR": dynamic code (TOTP + AES-256), refreshed every 30 s on the phone, works offline
//   2. Guest / courier / maintenance passes: single entry or time window, shared as a link (chat, e-mail)
//   3. Photo for the guardhouse screen
// Also keeps listing the old-style invitations that were issued before v1.26, so they can still be cancelled.
import {
  collection, doc, query, where, onSnapshot, writeBatch, updateDoc, getDoc, setDoc, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import * as wallet from "./qr-wallet.js";

const Q = window.SOQR;
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function initResidentQr({ db, user, profile, t, failMsg, getStatus }) {
  const $ = (id) => document.getElementById(id);
  const lang = () => (window.SO_I18N ? window.SO_I18N.getLang() : "en");
  const locale = () => (lang() === "ar" ? "ar-EG" : "en-GB");
  const fmt = (ms) => (ms ? new Date(ms).toLocaleString(locale(), { dateStyle: "medium", timeStyle: "short" }) : "—");
  const qrOpts = (w) => ({ width: w, margin: 2, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } });   // max contrast for glare/IR readers
  const isActive = () => getStatus() === "active";

  // =========================================================== data
  let myUnits = [];
  onSnapshot(query(collection(db, "units"), where("residentId", "==", user.uid)), (snap) => {
    myUnits = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderUnitPicker();
  }, (e) => console.error("units listener:", e));

  // =========================================================== 1. dynamic QR
  let site;                    // undefined = unknown yet, null = management has not enabled QR access, object = enabled
  let local = null;            // this phone's credential (IndexedDB)
  let remote = [];             // all my credentials in Firestore
  let remoteLoaded = false;
  let skew = wallet.storedSkew();
  let offset = 0, lastKey = "", wake = null, lastNote = "";

  async function loadLocal() { try { local = await wallet.loadLocal(user.uid); } catch (e) { console.error("wallet:", e); local = null; } renderQr(); }
  async function loadSite() { try { site = await wallet.getSiteConfig(db); } catch (e) { if (site === undefined) site = undefined; } renderQr(); }

  wallet.watchCredentials(db, user.uid, (list) => { remote = list; remoteLoaded = true; checkLocalStillValid(); renderQr(); renderDevices(); });

  function checkLocalStillValid() {
    if (!local || !remoteLoaded) return;
    const r = remote.find((c) => c.id === local.id);
    if (!r || r.status !== "active") {                 // switched off from another phone / by management
      lastNote = "sqRevokedNote";
      wallet.removeLocal(user.uid).then(() => { local = null; renderQr(); });
    }
  }

  function renderQr() {
    const off = $("sqOff"), on = $("sqOn"), chip = $("sqChip");
    if (!off || !on) return;
    const sitePending = site === undefined;
    if (!local) {
      off.style.display = "block"; on.style.display = "none";
      const rotated = false;
      chip.textContent = t("sqChipOff"); chip.className = "sq-chip off";
      let msg = t("sqOffMsg");
      if (lastNote) msg = t(lastNote);
      if (site === null) msg = t("sqNotEnabled");
      $("sqOffMsg").textContent = msg;
      $("sqActivateBtn").disabled = site === null || sitePending;
      $("sqActivateBtn").style.display = site === null ? "none" : "";
      return;
    }
    if (site && local.siteFp && site.fingerprint !== local.siteFp) {          // management replaced the site key → old credential is dead
      lastNote = "sqRotatedNote";
      wallet.deactivate(db, user.uid, local).then(() => { local = null; renderQr(); });
      return;
    }
    off.style.display = "none"; on.style.display = "block";
    chip.textContent = t("sqChipLive"); chip.className = "sq-chip live";
    lastKey = "";                                                              // force a redraw (language change etc.)
  }

  $("sqActivateBtn")?.addEventListener("click", async () => {
    if (!isActive()) { alert(getStatus() === "suspended" ? t("lockedMsgSuspended") : t("lockedMsgPending")); return; }
    const btn = $("sqActivateBtn"); btn.disabled = true;
    try {
      const mine = remote.filter((c) => c.status === "active");
      if (mine.length >= 3 && !confirm(t("sqTooManyDevices"))) return;
      if (local) await wallet.deactivate(db, user.uid, local);
      local = await wallet.activate(db, user.uid, wallet.deviceLabel());
      lastNote = ""; renderQr();
    } catch (e) {
      console.error("QR activation failed:", e);
      alert(e && e.message === "no-site-key" ? t("sqNotEnabled") : failMsg(t("sqActivateFailed"), e));
    } finally { btn.disabled = false; }
  });

  $("sqNextBtn")?.addEventListener("click", () => { offset = offset === 0 ? 1 : 0; lastKey = ""; tick(); });

  async function tick() {
    const sec = $("tab-invites");
    const visible = !!local && sec && sec.style.display !== "none" && !document.hidden;
    manageWakeLock(visible);
    if (!visible) return;
    const now = Date.now() + (Math.abs(skew) > 3000 ? skew : 0);
    const step = Q.stepOf(now), span = Q.STEP_SECONDS * 1000, left = span - (now % span);
    const key = step + ":" + offset;
    if (key !== lastKey) {
      if (lastKey && lastKey.split(":")[0] !== String(step)) offset = 0;      // the "next" code has become the current one
      lastKey = step + ":" + offset;
      try {
        const tok = await wallet.currentToken(local, now, offset);
        await window.QRCode.toCanvas($("sqCanvas"), tok, qrOpts(236));
      } catch (e) { console.error("QR draw failed:", e); }
    }
    const pct = Math.max(0, Math.min(100, (left / span) * 100));
    const fill = $("sqBarFill"); fill.style.width = pct + "%";
    fill.className = "sq-bar-fill" + (left < 5000 ? " danger" : left < 10000 ? " warn" : "");
    $("sqSecs").textContent = String(Math.ceil(left / 1000));
    $("sqNextBtn").textContent = offset ? t("sqBackToCurrent") : t("sqNextCode");
  }
  setInterval(() => { tick().catch(() => {}); }, 250);
  document.addEventListener("visibilitychange", () => tick().catch(() => {}));

  async function manageWakeLock(want) {
    try {
      if (want && !wake && navigator.wakeLock) { wake = await navigator.wakeLock.request("screen"); wake.addEventListener("release", () => { wake = null; }); }
      else if (!want && wake) { await wake.release(); wake = null; }
    } catch (e) { /* not supported or not allowed: harmless */ }
  }

  async function refreshSkew() {
    skew = await wallet.measureSkew();
    const w = $("sqSkewWarn");
    if (!w) return;
    if (Math.abs(skew) > 20000) { w.style.display = "block"; w.textContent = t("sqClockWarn").replace("{s}", String(Math.round(Math.abs(skew) / 1000))); }
    else w.style.display = "none";
  }
  refreshSkew(); setInterval(refreshSkew, 10 * 60 * 1000);

  function renderDevices() {
    const box = $("sqDevices"), list = $("sqDevicesList");
    if (!box || !list) return;
    const active = remote.filter((c) => c.status === "active").sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    box.style.display = active.length ? "block" : "none";
    list.innerHTML = active.map((c) => `
      <div class="list-item">
        <div class="meta">
          <div class="title">${esc(c.label || "—")} ${local && local.id === c.id ? `<span class="badge active">${t("sqThisPhone")}</span>` : ""}</div>
          <div class="sub">${t("sqActivatedOn")}: ${fmt((c.createdAt?.seconds || 0) * 1000)}</div>
        </div>
        <button class="btn btn-sm btn-danger" data-sq-revoke="${esc(c.id)}">${t("sqSwitchOff")}</button>
      </div>`).join("");
    list.querySelectorAll("[data-sq-revoke]").forEach((b) => b.addEventListener("click", async () => {
      if (!confirm(t("sqSwitchOffConfirm"))) return;
      b.disabled = true;
      try {
        if (local && local.id === b.dataset.sqRevoke) { await wallet.deactivate(db, user.uid, local); local = null; lastNote = ""; renderQr(); }
        else await wallet.revokeRemote(db, user.uid, b.dataset.sqRevoke);
      } catch (e) { console.error(e); alert(failMsg(t("sqActionFailed"), e)); b.disabled = false; }
    }));
  }

  // =========================================================== 2. guest passes
  const HOURS = { 1: 1, 2: 2, 4: 4, 8: 8, 12: 12, 24: 24, 48: 48, 72: 72 };
  let last = null;                       // { token, link, label, unit, from, until, kind, mode }

  function renderUnitPicker() {
    const f = $("passUnitField"), sel = $("passUnit");
    if (!f || !sel) return;
    f.style.display = myUnits.length > 1 ? "block" : "none";
    const cur = sel.value;
    sel.innerHTML = myUnits.map((u) => `<option value="${esc(u.id)}">${esc(u.code || u.number || u.id)}</option>`).join("");
    if (cur && myUnits.some((u) => u.id === cur)) sel.value = cur;
  }
  function pickedUnit() {
    if (!myUnits.length) return null;
    const sel = $("passUnit");
    return myUnits.find((u) => u.id === (sel && sel.value)) || myUnits[0];
  }
  function localInputToDate(v) { if (!v) return new Date(); const d = new Date(v); return isNaN(d) ? new Date() : d; }

  function passLink(token, p) {
    const base = new URL("pass.html", location.href);
    const qs = new URLSearchParams({ n: p.label, u: p.unit || "", f: String(p.from), t: String(p.until), k: p.kind, m: p.mode, v: p.vehicle ? "1" : "0" });
    return `${base.origin}${base.pathname}?${qs.toString()}#${token}`;
  }
  function shareText(p, link) {
    const kindWord = t("sqKind_" + p.kind);
    return `${t("sqShareHello")} ${p.label}\n${kindWord} · ${t("unitLabel")}: ${p.unit || "—"}\n${t("sqValidFrom")}: ${fmt(p.from)}\n${t("sqValidUntil")}: ${fmt(p.until)}\n${t("sqShareHow")}\n${link}`;
  }

  async function showResult(p) {
    last = p;
    $("qrResultCard").style.display = "block";
    await window.QRCode.toCanvas($("qrCanvas"), p.token, qrOpts(236));
    $("sqPassSummary").textContent = `${p.label} · ${t("sqKind_" + p.kind)} · ${fmt(p.from)} → ${fmt(p.until)}`;
    $("sqPassMode").textContent = (p.mode === "single" ? t("sqModeSingleShort") : t("sqModeWindowShort")) + (p.vehicle ? " · 🚗" : "");
    $("qrResultCard").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  $("createInviteBtn")?.addEventListener("click", async () => {
    if (!isActive()) { alert(getStatus() === "suspended" ? t("lockedMsgSuspended") : t("lockedMsgPending")); return; }
    const label = $("guestName").value.trim();
    if (!label) { alert(t("inviteFillFirst")); return; }
    const phone = $("guestPhone").value.trim();
    const kind = $("passKind").value, mode = $("passMode").value, vehicle = $("passVehicle").checked;
    const hours = HOURS[$("passDuration").value] || 2;
    const from = localInputToDate($("guestDate").value);
    const until = new Date(from.getTime() + hours * 3600 * 1000);
    if (until.getTime() <= Date.now()) { alert(t("sqPassInPast")); return; }
    const btn = $("createInviteBtn"), original = btn.textContent;
    btn.disabled = true; btn.textContent = "…";
    try {
      if (typeof window.QRCode === "undefined") throw new Error("QR library did not load. Check your internet connection or ad-blocker and reload the page.");
      const pass = await Q.newPass();
      const u = pickedUnit();
      const data = {
        residentId: user.uid, residentName: profile.name || "", residentPhone: (u && u.residentPhone) || "",
        unit: (u && (u.code || String(u.number || ""))) || profile.unit || "", unitId: u ? u.id : null, buildingId: (u && u.buildingId) || null, floor: u ? Number(u.floor) || 0 : 0,
        kind, label, guestPhone: phone, mode,
        validFrom: Timestamp.fromDate(from), validUntil: Timestamp.fromDate(until),
        maxUses: mode === "single" ? 1 : null, uses: 0, vehicle, zones: [],
        secretHash: pass.secretHash, status: "active", inside: false, createdAt: serverTimestamp(),
      };
      const batch = writeBatch(db);
      batch.set(doc(db, "accessPasses", pass.id), data);
      batch.set(doc(db, "users", user.uid, "passKeys", pass.id), { secret: pass.secret, createdAt: serverTimestamp() });
      await batch.commit();
      const p = { token: pass.token, label, unit: data.unit, from: from.getTime(), until: until.getTime(), kind, mode, vehicle };
      p.link = passLink(pass.token, p);
      await showResult(p);
      $("guestName").value = ""; $("guestPhone").value = ""; $("guestDate").value = "";
    } catch (err) {
      console.error("Pass creation failed:", err);
      alert(failMsg(t("inviteFailed"), err));
    } finally { btn.disabled = false; btn.textContent = original; }
  });

  // ----- sharing: a link (works in any chat / e-mail) + the image -----
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) { const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand("copy"); } catch (e2) {} ta.remove(); return ok; }
  }
  $("shareWhatsappBtn")?.addEventListener("click", () => { if (last) window.open(`https://wa.me/?text=${encodeURIComponent(shareText(last, last.link))}`, "_blank"); });
  $("shareEmailBtn")?.addEventListener("click", () => {
    if (!last) return;
    const subject = `${t("sqEmailSubject")} · ${last.label}`;
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(shareText(last, last.link))}`;
  });
  $("shareLinkBtn")?.addEventListener("click", async () => {
    if (!last) return;
    if (navigator.share) { try { await navigator.share({ title: t("sqEmailSubject"), text: shareText(last, last.link) }); return; } catch (e) { if (e && e.name === "AbortError") return; } }
    const ok = await copy(shareText(last, last.link));
    alert(ok ? t("sqLinkCopied") : last.link);
  });
  $("copyLinkBtn")?.addEventListener("click", async () => { if (last) alert((await copy(last.link)) ? t("sqLinkCopied") : last.link); });
  $("shareImageBtn")?.addEventListener("click", async () => {
    if (!last) return;
    try {
      const blob = await new Promise((r) => $("qrCanvas").toBlob(r, "image/png"));
      const file = new File([blob], "access-pass.png", { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text: shareText(last, last.link) }); return; }
    } catch (e) { if (e && e.name === "AbortError") return; }
    alert(t("whatsappShareUnsupported"));
  });

  // ----- my passes (new) + invitations issued before v1.26 (legacy) -----
  let passRows = [], legacyRows = [];
  onSnapshot(query(collection(db, "accessPasses"), where("residentId", "==", user.uid)), (snap) => {
    passRows = snap.docs.map((d) => ({ id: d.id, ...d.data() })); renderPasses();
  }, (e) => console.error("passes listener:", e));
  onSnapshot(query(collection(db, "invitations"), where("residentId", "==", user.uid)), (snap) => {
    legacyRows = snap.docs.map((d) => ({ id: d.id, ...d.data() })); renderPasses();
  }, (e) => console.error("legacy invitations listener:", e));
  setInterval(() => { if ($("tab-invites")?.style.display !== "none") renderPasses(); }, 30000);   // statuses depend on the clock

  const ms = (v) => (v && v.toMillis ? v.toMillis() : v && v.seconds ? v.seconds * 1000 : 0);
  function passStatus(p, now) {
    if (p.status === "revoked") return "revoked";
    if (ms(p.validUntil) < now && !p.inside) return "expired";
    if (p.maxUses != null && (p.uses || 0) >= p.maxUses) return p.inside ? "inside" : "used";
    if (ms(p.validFrom) > now) return "scheduled";
    return p.inside ? "inside" : "active";
  }
  const STATUS_CLASS = { active: "active", scheduled: "pending", used: "used", inside: "inside", expired: "expired", revoked: "revoked" };

  function renderPasses() {
    const el = $("invitesList"); if (!el) return;
    const now = Date.now();
    const rows = [
      ...passRows.map((p) => ({ kind: "pass", at: ms(p.createdAt), p })),
      ...legacyRows.map((p) => ({ kind: "legacy", at: ms(p.createdAt), p })),
    ].sort((a, b) => b.at - a.at);
    if (!rows.length) { el.innerHTML = `<p class="empty-state">${t("noInvitations")}</p>`; return; }
    el.innerHTML = rows.map(({ kind, p }) => {
      if (kind === "legacy") {
        const st = p.status === "pending" && p.expiresAt && ms(p.expiresAt) < now ? "expired" : p.status;
        const LK = { pending: "pending", used: "statusUsed", revoked: "revoked", expired: "expired" };
        return `
          <div class="list-item">
            <div class="meta"><div class="title">${esc(p.guestName)} <span class="badge cancelled">${t("sqLegacy")}</span></div>
            <div class="sub">${t("visitDate")}: ${esc(p.visitDate || "—")}</div></div>
            <div style="display:flex;gap:6px;align-items:center"><span class="badge ${esc(st)}">${(LK[st] && t(LK[st])) || esc(st)}</span>
            ${p.status === "pending" ? `<button class="btn btn-sm btn-danger" data-cancel-legacy="${esc(p.id)}" data-name="${esc(p.guestName)}">${t("cancelInvite")}</button>` : ""}</div>
          </div>`;
      }
      const st = passStatus(p, now);
      const live = st === "active" || st === "scheduled" || st === "inside";
      return `
        <div class="list-item">
          <div class="meta">
            <div class="title">${esc(p.label)} <span class="sq-kind">${t("sqKind_" + (p.kind || "guest"))}</span>${p.vehicle ? " 🚗" : ""}</div>
            <div class="sub">${fmt(ms(p.validFrom))} → ${fmt(ms(p.validUntil))}</div>
            <div class="sub">${p.mode === "single" ? t("sqModeSingleShort") : t("sqModeWindowShort")} · ${t("sqEntries")}: ${p.uses || 0}${p.maxUses != null ? "/" + p.maxUses : ""}</div>
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
            <span class="badge ${STATUS_CLASS[st]}">${t("sqSt_" + st)}</span>
            ${live ? `<div style="display:flex;gap:6px"><button class="btn btn-sm btn-outline" data-reshare="${esc(p.id)}">${t("sqShareAgain")}</button><button class="btn btn-sm btn-danger" data-revoke-pass="${esc(p.id)}" data-name="${esc(p.label)}">${t("cancelInvite")}</button></div>` : ""}
          </div>
        </div>`;
    }).join("");

    el.querySelectorAll("[data-revoke-pass]").forEach((b) => b.addEventListener("click", async () => {
      if (!confirm(`${t("cancelInviteConfirm")}: ${b.dataset.name}`)) return;
      b.disabled = true;
      try { await updateDoc(doc(db, "accessPasses", b.dataset.revokePass), { status: "revoked", revokedAt: serverTimestamp(), revokedBy: user.uid }); }
      catch (e) { console.error(e); alert(t("cancelInviteFailed")); b.disabled = false; }
    }));
    el.querySelectorAll("[data-cancel-legacy]").forEach((b) => b.addEventListener("click", async () => {
      if (!confirm(`${t("cancelInviteConfirm")}: ${b.dataset.name}`)) return;
      b.disabled = true;
      try { await updateDoc(doc(db, "invitations", b.dataset.cancelLegacy), { status: "revoked", revokedAt: serverTimestamp(), revokedBy: user.uid }); }
      catch (e) { console.error(e); alert(t("cancelInviteFailed")); b.disabled = false; }
    }));
    el.querySelectorAll("[data-reshare]").forEach((b) => b.addEventListener("click", async () => {
      b.disabled = true;
      try {
        const p = passRows.find((x) => x.id === b.dataset.reshare);
        const k = await getDoc(doc(db, "users", user.uid, "passKeys", p.id));
        if (!k.exists()) { alert(t("sqNoSecretCopy")); return; }
        const token = Q.passToken(p.id, k.data().secret);
        const info = { token, label: p.label, unit: p.unit, from: ms(p.validFrom), until: ms(p.validUntil), kind: p.kind || "guest", mode: p.mode, vehicle: !!p.vehicle };
        info.link = passLink(token, info);
        await showResult(info);
      } catch (e) { console.error(e); alert(failMsg(t("sqActionFailed"), e)); }
      finally { b.disabled = false; }
    }));
  }
  window.addEventListener("so-lang-changed", () => { renderPasses(); renderDevices(); renderQr(); renderPhoto(); });

  // =========================================================== 3. photo for the guardhouse
  let photo = null;
  onSnapshot(doc(db, "accessIdentities", user.uid), (s) => { photo = s.exists() ? s.data() : null; renderPhoto(); }, (e) => console.error("identity listener:", e));
  function renderPhoto() {
    const img = $("sqPhotoImg"), st = $("sqPhotoState"); if (!img || !st) return;
    img.style.display = photo && photo.photo ? "block" : "none";
    if (photo && photo.photo) img.src = photo.photo;
    $("sqPhotoPh").style.display = photo && photo.photo ? "none" : "flex";
    st.textContent = !photo || !photo.photo ? t("sqPhotoNone") : photo.photoStatus === "approved" ? t("sqPhotoApproved") : t("sqPhotoPending");
    st.className = "badge " + (photo && photo.photoStatus === "approved" ? "active" : "pending");
    st.style.display = photo && photo.photo ? "inline-block" : "none";
  }
  async function squareThumb(file, size) {
    const bmp = await createImageBitmap(file);
    const s = Math.min(bmp.width, bmp.height), c = document.createElement("canvas");
    c.width = c.height = size;
    c.getContext("2d").drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size);
    for (const q of [0.72, 0.6, 0.5, 0.4]) { const u = c.toDataURL("image/jpeg", q); if (u.length < 55000) return u; }
    throw new Error("photo too large");
  }
  $("sqPhotoBtn")?.addEventListener("click", () => $("sqPhotoInput").click());
  $("sqPhotoInput")?.addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0]; e.target.value = "";
    if (!f) return;
    try {
      const url = await squareThumb(f, 256);
      await setDoc(doc(db, "accessIdentities", user.uid), { photo: url, photoStatus: "pending", updatedAt: serverTimestamp() });
    } catch (err) { console.error(err); alert(failMsg(t("sqPhotoFailed"), err)); }
  });

  // =========================================================== boot
  loadSite(); loadLocal(); renderQr(); renderPasses(); renderPhoto();
  const dt = $("guestDate");
  if (dt && !dt.value) dt.placeholder = "";
  return { tick, get local() { return local; } };
}
