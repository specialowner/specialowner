// Guardhouse screen. Two sources, same rendering:
//   • LOCAL  — served by the edge controller itself (http://<edge>:8787/#key=…): live Server-Sent Events,
//              keeps working with the internet down, photos arrive with each event.
//   • CLOUD  — signed-in security worker / manager / admin reading Firestore accessEvents in real time.
// Classic script on purpose: the local mode must not need Firebase (which is unreachable offline).
(function () {
  const $ = (id) => document.getElementById(id);
  const lang = () => window.SO_I18N.getLang();
  const T = () => window.SO_I18N.translations;
  const t = (k) => { const l = lang(); return (T()[l] && T()[l][k]) || (T().en && T().en[k]) || k; };
  const loc = () => (lang() === "ar" ? "ar-EG" : "en-GB");
  const clock = (ms) => new Date(ms).toLocaleTimeString(loc(), { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const SUBJ = { resident: "ghSubjResident", guest: "sqKind_guest", courier: "sqKind_courier", maintenance: "sqKind_maintenance", master: "ghSubjMaster", unknown: "ghSubjUnknown" };

  let events = [];                                 // newest first
  let sound = false, audio = null;
  const seen = new Set();
  const photoCache = {};

  function reasonText(r) {
    const k = "ghR_" + String(r || "").replace(/-/g, "_");
    const v = T()[lang()] && T()[lang()][k];
    return v || t("ghR_other");
  }
  function beep(ok) {
    if (!sound) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const o = audio.createOscillator(), g = audio.createGain();
      o.connect(g); g.connect(audio.destination);
      o.type = "sine"; o.frequency.value = ok ? 880 : 220; g.gain.value = 0.15;
      o.start(); o.stop(audio.currentTime + (ok ? 0.12 : 0.5));
    } catch (e) { /* no audio available */ }
  }
  function setStatus(kind, text) {
    $("ghDot").className = "gh-dot " + kind;
    $("ghStatus").textContent = text;
    $("ghStatus").removeAttribute("data-i18n");
  }
  const dirText = (e) => (e.direction === "exit" ? t("ghExit") : t("ghEntry"));

  function renderHero(e) {
    const hero = $("ghHero");
    if (!e) { hero.className = "gh-hero idle"; return; }
    const ok = e.result === "allowed";
    hero.className = "gh-hero " + (ok ? "ok" : "bad") + (e.offline ? " offline" : "");
    $("ghVerdict").textContent = (ok ? t("ghAllowed") : t("ghDenied")) + " · " + dirText(e) + " · " + (e.apName || "");
    $("ghName").textContent = e.name || (e.subjectType === "unknown" ? t("ghSubjUnknown") : "");
    const subj = t(SUBJ[e.subjectType] || "ghSubjUnknown");
    $("ghLine1").textContent = subj + (e.unit ? " · " + t("unitLabel") + " " + e.unit : "") + (e.buildingName ? " · " + e.buildingName : "");
    let l2 = "";
    if (!ok) l2 = reasonText(e.reason);
    else if (e.hostName) l2 = t("ghVisiting") + ": " + e.hostName + (e.hostPhone ? " · " + e.hostPhone : "");
    $("ghLine2").textContent = l2;
    $("ghLine3").textContent = (e.floors && e.floors.length ? t("ghFloors") + ": " + e.floors.join(", ") + " · " : "") + clock(e.ts) + (e.offline ? " · " + t("ghOfflineDecision") : "");
    const img = $("ghPhoto"), ph = $("ghPhotoPh");
    const photo = e.photo && e.photoStatus === "approved" ? e.photo : null;
    if (photo) { img.src = photo; img.style.display = "block"; ph.style.display = "none"; }
    else { img.style.display = "none"; ph.style.display = "flex"; ph.textContent = e.subjectType === "resident" ? "👤" : e.subjectType === "courier" ? "📦" : e.subjectType === "maintenance" ? "🛠️" : "🙂"; }
  }
  function renderList() {
    $("ghList").innerHTML = events.slice(0, 40).map((e) => {
      const ok = e.result === "allowed";
      return `<div class="gh-row ${ok ? "ok" : "bad"}"><span class="gh-time"></span><span class="gh-who"></span><span class="gh-ap"></span><span class="gh-res"></span></div>`;
    }).join("");
    const rows = $("ghList").children;
    events.slice(0, 40).forEach((e, i) => {
      const r = rows[i], ok = e.result === "allowed";
      r.querySelector(".gh-time").textContent = clock(e.ts);
      r.querySelector(".gh-who").textContent = (e.name || t("ghSubjUnknown")) + (e.unit ? " · " + e.unit : "");
      r.querySelector(".gh-ap").textContent = dirText(e) + " · " + (e.apName || "");
      r.querySelector(".gh-res").textContent = ok ? "✓" : "✗ " + reasonText(e.reason);
    });
  }
  function ingest(e, live) {
    if (!e || !e.id || seen.has(e.id)) return;
    seen.add(e.id);
    events.push(e); events.sort((a, b) => b.ts - a.ts);
    if (events.length > 200) events.length = 200;
    if (live) { renderHero(events[0].id === e.id ? e : events[0]); beep(e.result === "allowed"); }
    renderList();
  }

  // ---------- LOCAL (edge) ----------
  function startLocal(key) {
    const open = () => {
      const es = new EventSource("/stream?key=" + encodeURIComponent(key));
      es.onopen = () => setStatus("ok", t("ghLocalLive"));
      es.onmessage = (m) => { try { ingest(JSON.parse(m.data), true); } catch (e) { /* ignore */ } };
      es.onerror = () => { setStatus("bad", t("ghReconnecting")); es.close(); setTimeout(open, 3000); };
    };
    open();
    // first events arrive in a burst: show the newest in the hero
    setTimeout(() => { if (events[0]) renderHero(events[0]); }, 600);
  }

  // ---------- CLOUD (Firestore) ----------
  async function startCloud() {
    setStatus("warn", t("ghConnecting"));
    const [{ requireAuth }, { db }, fs] = await Promise.all([
      import("./guard.js"), import("./firebase-config.js"),
      import("https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js"),
    ]);
    await requireAuth(["worker", "manager", "admin", "superadmin"]);
    const q = fs.query(fs.collection(db, "accessEvents"), fs.orderBy("ts", "desc"), fs.limit(40));
    let first = true;
    fs.onSnapshot(q, async (snap) => {
      setStatus("ok", t("ghCloudLive"));
      const added = snap.docChanges().filter((c) => c.type === "added").map((c) => ({ id: c.doc.id, ...c.doc.data() }));
      for (const d of added.sort((a, b) => a.ts.toMillis() - b.ts.toMillis())) {
        const e = Object.assign({}, d, { ts: d.ts.toMillis() });
        if (e.uid && e.subjectType === "resident") {
          if (!(e.uid in photoCache)) {
            try { const s = await fs.getDoc(fs.doc(db, "accessIdentities", e.uid)); photoCache[e.uid] = s.exists() ? s.data() : null; } catch (x) { photoCache[e.uid] = null; }
          }
          const p = photoCache[e.uid]; if (p && p.photo) { e.photo = p.photo; e.photoStatus = p.photoStatus; }
        }
        ingest(e, !first || added.length === 1);
      }
      if (first && events[0]) renderHero(events[0]);
      first = false;
    }, (err) => { console.error(err); setStatus("bad", t("ghCloudError")); });
  }

  $("ghSoundBtn").addEventListener("click", () => {
    sound = !sound;
    $("ghSoundBtn").textContent = sound ? t("ghSoundOff") : t("ghSoundOn");
    $("ghSoundBtn").removeAttribute("data-i18n");
    if (sound) beep(true);
  });
  window.addEventListener("so-lang-changed", () => { renderList(); if (events[0]) renderHero(events[0]); });

  const hashKey = (/(?:^|[#&])key=([^&]+)/.exec(location.hash) || [])[1];
  fetch("/health").then((r) => r.json()).then((h) => {
    if (h && h.edge && hashKey) startLocal(decodeURIComponent(hashKey));
    else startCloud();
  }).catch(() => startCloud());
})();
