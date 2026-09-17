import { db } from "./firebase-config.js";
import { requireAuth, logout } from "./guard.js";
import {
  collection, addDoc, doc, query, where, orderBy,
  onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const { user, profile } = await requireAuth("callcenter");
document.getElementById("logoutBtn").addEventListener("click", logout);

function t(key) {
  const lang = window.SO_I18N ? window.SO_I18N.getLang() : "en";
  return window.SO_I18N ? window.SO_I18N.translations[lang][key] : key;
}

function renderGreeting() {
  document.getElementById("greetName").textContent = `${t("hiThere")}, ${profile.name?.split(" ")[0] || ""} 👋`;
  document.getElementById("greetRole").textContent = t("callCenter");
}
renderGreeting();
window.addEventListener("so-lang-changed", renderGreeting);

// ---------- Tabs ----------
const tabs = document.querySelectorAll(".tab-btn");
tabs.forEach(btn => btn.addEventListener("click", () => {
  tabs.forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  ["home", "history"].forEach(tab => {
    document.getElementById(`tab-${tab}`).style.display = (tab === btn.dataset.tab) ? "block" : "none";
  });
}));

// ---------- Account status (suspended by the admin locks the log-call action) ----------
let currentAccountStatus = "active";
onSnapshot(doc(db, "users", user.uid), (snap) => {
  const data = snap.data() || {};
  currentAccountStatus = data.accountStatus || "active";
  const banner = document.getElementById("statusBanner");
  if (currentAccountStatus === "suspended") {
    banner.style.display = "block";
    banner.textContent = t("lockedMsgSuspended");
  } else {
    banner.style.display = "none";
  }
});

// ---------- Resident lookup by unit ----------
// Loaded once and filtered client-side — the rules only let this role read
// resident profiles at all, so a live per-keystroke query isn't worth it for
// what's realistically a few dozen to a few hundred units.
let residentsCache = [];
let selectedResident = null;
onSnapshot(query(collection(db, "users"), where("role", "==", "resident")), (snap) => {
  residentsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderSearchResults();
});

const unitSearchInput = document.getElementById("unitSearchInput");
unitSearchInput.addEventListener("input", renderSearchResults);

function renderSearchResults() {
  const el = document.getElementById("unitSearchResults");
  const q = unitSearchInput.value.trim().toLowerCase();
  if (!q) { el.innerHTML = ""; return; }
  const matches = residentsCache.filter(r => (r.unit || "").toLowerCase().includes(q)).slice(0, 8);
  if (matches.length === 0) {
    el.innerHTML = `<p class="empty-state" style="margin-top:8px">${t("noResidentFound")}</p>`;
    return;
  }
  el.innerHTML = matches.map(r => `
    <div class="list-item" data-pick-resident="${r.id}" style="cursor:pointer">
      <div class="meta">
        <div class="title">${r.unit || "—"}</div>
        <div class="sub">${r.name || r.email || ""}</div>
      </div>
    </div>`).join("");
  el.querySelectorAll("[data-pick-resident]").forEach(row => {
    row.addEventListener("click", () => {
      selectedResident = residentsCache.find(r => r.id === row.dataset.pickResident) || null;
      renderSelectedResident();
    });
  });
}

function renderSelectedResident() {
  const card = document.getElementById("logCallCard");
  const box = document.getElementById("selectedResidentBox");
  if (!selectedResident) { card.style.display = "none"; return; }
  box.textContent = `${selectedResident.unit || "—"} · ${selectedResident.name || selectedResident.email || ""}`;
  card.style.display = "block";
  document.getElementById("unitSearchResults").innerHTML = "";
  unitSearchInput.value = "";
}

// ---------- Log the call ----------
document.getElementById("submitCallBtn").addEventListener("click", async () => {
  const btn = document.getElementById("submitCallBtn");
  const errEl = document.getElementById("logCallError");
  errEl.style.display = "none";
  if (currentAccountStatus !== "active") { alert(t("lockedMsgSuspended")); return; }

  const category = document.getElementById("callCategory").value;
  const description = document.getElementById("callDesc").value.trim();
  if (!selectedResident || !description) {
    errEl.textContent = t("fillResidentAndDescription");
    errEl.style.display = "block";
    return;
  }

  btn.disabled = true;
  try {
    await addDoc(collection(db, "maintenanceRequests"), {
      residentId: selectedResident.id,
      unit: selectedResident.unit || "",
      category, description,
      source: "call_center",
      status: "pending",
      statusSeenByResident: true,
      loggedBy: user.uid,
      loggedByRole: "callcenter",
      createdAt: serverTimestamp()
    });
    document.getElementById("callDesc").value = "";
    selectedResident = null;
    renderSelectedResident();
    alert(t("callLoggedSuccess"));
  } catch (err) {
    errEl.textContent = err.message || String(err);
    errEl.style.display = "block";
  } finally {
    btn.disabled = false;
  }
});

// ---------- My logged calls ----------
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
  return key ? t(key) : cat;
}
const STATUS_I18N_KEY = { pending: "pending", accepted: "accepted", in_progress: "in_progress", completed: "completed" };
function statusLabel(s) { return t(STATUS_I18N_KEY[s] || s) || s; }

onSnapshot(
  query(collection(db, "maintenanceRequests"), where("loggedBy", "==", user.uid), orderBy("createdAt", "desc")),
  (snap) => {
    const el = document.getElementById("loggedCallsList");
    if (snap.empty) { el.innerHTML = `<p class="empty-state">${t("noCallsLogged")}</p>`; return; }
    el.innerHTML = "";
    snap.docs.forEach(d => {
      const m = { id: d.id, ...d.data() };
      el.innerHTML += `
        <div class="list-item">
          <div class="meta">
            <div class="title">${m.unit || "—"} · ${categoryLabel(m.category)}</div>
            <div class="sub">${m.description}</div>
          </div>
          <span class="badge ${m.status === "completed" ? "active" : "pending"}">${statusLabel(m.status)}</span>
        </div>`;
    });
  }
);
