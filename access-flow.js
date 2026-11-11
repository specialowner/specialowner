// QR scan handling shared by the admin and security-worker scanners (entry and exit).
import {
  collection, addDoc, doc, getDoc, getDocs, updateDoc, query, where, serverTimestamp, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { auth } from "./firebase-config.js";

// New-style codes (dynamic phone QR "SO1D.…" and guest/master passes "SO1P.…") are verified by an edge controller:
// the phone only forwards the text, the controller answers on the same scanRequest document.
async function handleControllerScan(db, text, mode, t, resultEl) {
  resultEl.textContent = "⏳ " + t("sqScanChecking");
  let ref;
  try {
    ref = await addDoc(collection(db, "scanRequests"), {
      requestedBy: auth.currentUser.uid, status: "pending", token: text, mode: mode === "exit" ? "exit" : "entry", createdAt: serverTimestamp()
    });
  } catch (e) { console.error(e); resultEl.textContent = "❌ " + t("qrUnreadable"); return; }
  await new Promise((resolve) => {
    const timer = setTimeout(() => { off(); resultEl.textContent = "⚠️ " + t("sqScanNoController"); resolve(); }, 10000);
    const off = onSnapshot(doc(db, "scanRequests", ref.id), (s) => {
      const d = s.data();
      if (!d || d.status !== "done" || !d.result) return;
      clearTimeout(timer); off();
      const r = d.result, k = "ghR_" + String(r.reason || "").replace(/-/g, "_");
      const who = [r.name, r.unit ? t("unitLabel") + " " + r.unit : ""].filter(Boolean).join(" · ");
      if (r.allow) resultEl.textContent = "✅ " + t("sqScanAllowed") + (who ? ": " + who : "") + (r.hostName ? " → " + r.hostName + (r.hostPhone ? " " + r.hostPhone : "") : "");
      else resultEl.textContent = "⛔ " + t("sqScanDenied") + ": " + ((window.SO_I18N.translations[window.SO_I18N.getLang()] || {})[k] || t("ghR_other")) + (who ? " (" + who + ")" : "");
      resolve();
    }, () => { clearTimeout(timer); resultEl.textContent = "❌ " + t("qrUnreadable"); resolve(); });
  });
}

let lastText = "", lastAt = 0;   // the camera re-reads the same QR ~10x/s; ignore repeats for 5 s

export async function handleAccessScan(db, decodedText, mode, t, resultEl, extra = {}) {
  const now = Date.now();
  const key = mode + "|" + decodedText;   // switching mode is not a repeat
  if (key === lastText && now - lastAt < 5000) return;
  lastText = key; lastAt = now;
  if (/^SO1[DP]\./.test(decodedText.trim())) { await handleControllerScan(db, decodedText.trim(), mode, t, resultEl); return; }
  try {
    const payload = JSON.parse(decodedText);
    const inviteRef = doc(db, "invitations", payload.inviteId);
    const inviteSnap = await getDoc(inviteRef);
    if (!inviteSnap.exists() || inviteSnap.data().token !== payload.token) {
      resultEl.textContent = "❌ " + t("invalidInvite"); return;
    }
    const invite = inviteSnap.data();
    const isMaster = invite.type === "master";
    const name = isMaster ? (invite.label || t("masterAccessGranted")) : invite.guestName;
    const log = (type) => addDoc(collection(db, "accessLogs"), {
      type, personType: invite.type || "guest", personName: name, invitationId: payload.inviteId,
      zones: invite.accessZones || null, ...extra, timestamp: serverTimestamp()
    });

    if (mode === "exit") {
      // Leaving is never blocked by expiry/revocation: someone already inside must be able to go out.
      const logs = await getDocs(query(collection(db, "accessLogs"), where("invitationId", "==", payload.inviteId)));
      const last = logs.docs.map(d => d.data()).filter(a => a.timestamp?.toMillis)
        .sort((a, b) => b.timestamp.toMillis() - a.timestamp.toMillis())[0];
      if (!last || last.type !== "entry") { resultEl.textContent = `⚠️ ${t("noOpenEntry")}: ${name}`; return; }
      await log("exit");
      resultEl.textContent = `🚪 ${t("exitRecorded")}: ${name}`;
      return;
    }

    if (invite.expiresAt && invite.expiresAt.toDate() < new Date()) { resultEl.textContent = `⛔ ${t("expired")}: ${name}`; return; }
    if (invite.status === "revoked") { resultEl.textContent = `⛔ ${t("revoked")}: ${name}`; return; }
    if (!isMaster) {
      if (invite.status === "used") { resultEl.textContent = `⚠️ ${t("inviteAlreadyUsed")} (${invite.guestName})`; return; }
      await updateDoc(inviteRef, { status: "used" });
    }
    await log("entry");
    resultEl.textContent = isMaster
      ? `✅ ${t("masterAccessGranted")}: ${name} — ${(invite.accessZones || []).map(z => t(z)).join("، ")}`
      : `✅ ${t("accessGranted")}: ${invite.guestName} (${invite.residentUnit || "—"})`;
  } catch (e) {
    console.error(e);
    resultEl.textContent = "❌ " + t("qrUnreadable");
  }
}
