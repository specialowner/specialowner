// Public page opened by a guest from the link shared by the resident.
// The secret travels in the URL fragment (#SO1P.…), which browsers never send to any server.
// Name / dates in the query string are only for display: the gate trusts the database record, not this page.
(function () {
  const $ = (id) => document.getElementById(id);
  const t = (k) => { const l = window.SO_I18N.getLang(); const T = window.SO_I18N.translations; return (T[l] && T[l][k]) || (T.en && T.en[k]) || k; };
  const esc = (s) => String(s == null ? "" : s);
  const token = decodeURIComponent((location.hash || "").replace(/^#/, ""));
  const qs = new URLSearchParams(location.search);
  let valid = false;
  try { valid = window.SOQR && window.SOQR.classify(token) === "pass" && !!window.SOQR.parsePassToken(token); } catch (e) { valid = false; }

  function fmt(ms) {
    const n = Number(ms); if (!n) return "—";
    return new Date(n).toLocaleString(window.SO_I18N.getLang() === "ar" ? "ar-EG" : "en-GB", { dateStyle: "medium", timeStyle: "short" });
  }
  function render() {
    $("passCard").style.display = valid ? "block" : "none";
    $("passBad").style.display = valid ? "none" : "block";
    if (!valid) return;
    const kind = ["guest", "courier", "maintenance"].includes(qs.get("k")) ? qs.get("k") : "guest";
    $("passWho").textContent = esc(qs.get("n")).slice(0, 60) + " · " + t("sqKind_" + kind);
    $("passWhen").textContent = fmt(qs.get("f")) + "  →  " + fmt(qs.get("t"));
    $("passMode").textContent = (qs.get("m") === "single" ? t("sqModeSingleShort") : t("sqModeWindowShort")) + (qs.get("v") === "1" ? " · 🚗" : "") + (qs.get("u") ? " · " + t("unitLabel") + " " + esc(qs.get("u")).slice(0, 12) : "");
    const f = Number(qs.get("f")), u = Number(qs.get("t")), now = Date.now(), st = $("passState");
    if (f && u) {
      st.style.display = "inline-block";
      if (now > u) { st.className = "badge expired"; st.textContent = t("sqSt_expired"); }
      else if (now < f) { st.className = "badge pending"; st.textContent = t("sqSt_scheduled"); }
      else { st.className = "badge active"; st.textContent = t("sqSt_active"); }
    }
  }
  async function draw() {
    if (!valid) return;
    await window.QRCode.toCanvas($("passCanvas"), token, { width: 236, margin: 2, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } });
    try { await navigator.wakeLock.request("screen"); } catch (e) { /* optional */ }
  }
  render(); draw().catch((e) => console.error(e));
  window.addEventListener("so-lang-changed", render);
  setInterval(render, 30000);
})();
