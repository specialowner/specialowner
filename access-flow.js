// QR scan handling shared by the admin and security-worker scanners (entry and exit).
import {
  collection, addDoc, doc, getDoc, getDocs, updateDoc, query, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

let lastText = "", lastAt = 0;   // the camera re-reads the same QR ~10x/s; ignore repeats for 5 s

export async function handleAccessScan(db, decodedText, mode, t, resultEl, extra = {}) {
  const now = Date.now();
  const key = mode + "|" + decodedText;   // switching mode is not a repeat
  if (key === lastText && now - lastAt < 5000) return;
  lastText = key; lastAt = now;
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
