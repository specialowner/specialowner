// ==========================================================
// Special Owner — Super Admin: payments dashboard (read-only)
// Roadmap Phase 1: who paid, who didn't, who is late, who has a
// receipt waiting for review. Filters: month, status, building, unit/name.
// Nothing here writes to Firestore.
// ==========================================================
import { db } from "./firebase-config.js";
import { requireAuth, logout } from "./guard.js";
import { downloadCsv } from "./csv-export.js";
import { collection, onSnapshot, query, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const { profile } = await requireAuth("superadmin");
document.getElementById("logoutBtn").addEventListener("click", logout);

function t(key) {
  const lang = window.SO_I18N ? window.SO_I18N.getLang() : "en";
  const tr = window.SO_I18N && window.SO_I18N.translations[lang];
  return (tr && tr[key]) || key;
}
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => Math.round(n).toLocaleString();

function renderGreeting() {
  $("greetName").textContent = `${t("hiThere")}, ${(profile.name || "").split(" ")[0]}`;
}
renderGreeting();

// ---------- Data ----------
let payments = [], residents = {}, reviewIds = new Set(), phones = {}, logs = [];
const loaded = new Set();
const fail = (e) => { console.error(e); $("saList").innerHTML = `<p class="empty-state">${t("saLoadFailed")}</p>`; };

onSnapshot(collection(db, "payments"), (snap) => {
  payments = snap.docs.map(d => ({ id: d.id, ...d.data() })); loaded.add("p"); refresh();
}, fail);
onSnapshot(collection(db, "users"), (snap) => {
  residents = {};
  snap.docs.forEach(d => { const u = d.data(); if (u.role === "resident") residents[d.id] = u; });
  loaded.add("u"); refresh();
}, fail);
onSnapshot(collection(db, "paymentProofs"), (snap) => {
  reviewIds = new Set(snap.docs.filter(d => d.data().status === "pending_review").map(d => d.data().paymentId));
  loaded.add("r"); refresh();
}, fail);

// Phone numbers live on the apartment register (units), linked by residentId.
onSnapshot(collection(db, "units"), (snap) => {
  phones = {};
  snap.docs.forEach(d => { const u = d.data(); if (u.residentId && u.residentPhone && !phones[u.residentId]) phones[u.residentId] = u.residentPhone; });
  loaded.add("n"); refresh();
}, (e) => { console.error(e); loaded.add("n"); refresh(); }); // phones are optional: never block the page

// Activity log: latest 100 entries, newest first (Super Admin only, enforced by Firestore rules).
onSnapshot(query(collection(db, "activityLog"), orderBy("createdAt", "desc"), limit(100)), (snap) => {
  logs = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderLog();
}, (e) => { console.error(e); $("saLogList").innerHTML = `<p class="empty-state">${t("saLoadFailed")}</p>`; });

// ---------- Status (derived on the client; no writes) ----------
const todayISO = () => new Date().toISOString().slice(0, 10);
// paid | late | review | pending(not yet due)
function stateOf(p) {
  if (p.status === "paid") return "paid";
  if (reviewIds.has(p.id)) return "review";
  if (p.status === "overdue" || (p.dueDate && p.dueDate < todayISO())) return "late";
  return "pending";
}
const monthOf = (p) => String(p.dueDate || "").slice(0, 7);
const buildingOf = (p) => (residents[p.residentId] && residents[p.residentId].buildingName) || "";

// ---------- Filters ----------
function fillSelect(sel, first, values) {
  const keep = sel.value;
  sel.innerHTML = `<option value="">${esc(first)}</option>` + values.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
  if (values.includes(keep)) sel.value = keep;
}
function refreshFilterOptions() {
  const months = [...new Set(payments.map(monthOf).filter(Boolean))].sort().reverse();
  const buildings = [...new Set(payments.map(buildingOf).filter(Boolean))].sort();
  const firstTime = !$("saMonth").dataset.init;
  fillSelect($("saMonth"), t("saAllMonths"), months);
  fillSelect($("saBuilding"), t("saAllBuildings"), buildings);
  if (firstTime && months.length) {
    $("saMonth").dataset.init = "1";
    const cur = todayISO().slice(0, 7);
    $("saMonth").value = months.includes(cur) ? cur : months[0]; // default: current month (or latest)
  }
}

// ---------- Render ----------
function refresh() {
  if (!loaded.has("p") || !loaded.has("u") || !loaded.has("r") || !loaded.has("n")) return;
  refreshFilterOptions();
  renderOverdue();

  const fMonth = $("saMonth").value, fStatus = $("saStatus").value,
        fBuilding = $("saBuilding").value, q = $("saSearch").value.trim().toLowerCase();

  const rows = payments.filter(p => {
    const st = stateOf(p);
    if (fMonth && monthOf(p) !== fMonth) return false;
    if (fBuilding && buildingOf(p) !== fBuilding) return false;
    if (fStatus === "paid" && st !== "paid") return false;
    if (fStatus === "unpaid" && st === "paid") return false;
    if (fStatus === "late" && st !== "late") return false;
    if (fStatus === "review" && st !== "review") return false;
    if (q) {
      const r = residents[p.residentId] || {};
      if (!`${p.unit || ""} ${r.name || ""} ${r.email || ""}`.toLowerCase().includes(q)) return false;
    }
    return true;
  }).sort((a, b) => String(a.dueDate || "").localeCompare(String(b.dueDate || "")));

  // Totals follow the filters. Receipt-awaiting-review counts as not collected yet.
  let collected = 0, late = 0, pend = 0;
  rows.forEach(p => {
    const amt = Number(p.amount) || 0, st = stateOf(p);
    if (st === "paid") collected += amt;
    else if (st === "late") late += amt;
    else pend += amt;            // pending + review
  });
  const due = collected + late + pend;
  $("saTotCollected").textContent = money(collected);
  $("saTotLate").textContent = money(late);
  $("saTotPending").textContent = money(pend);
  $("saTotRate").textContent = (due ? Math.round(collected / due * 100) : 0) + "%";
  $("saCount").textContent = `${t("saShowing")} ${rows.length} ${t("saOf")} ${payments.length}`;

  if (!rows.length) { $("saList").innerHTML = `<p class="empty-state">${t("saNoResults")}</p>`; return; }
  $("saList").innerHTML = rows.map(p => {
    const st = stateOf(p), r = residents[p.residentId] || {};
    const badgeCls = st === "paid" ? "paid" : st === "late" ? "overdue" : "pending";
    const label = st === "paid" ? t("saStPaid") : st === "late" ? t("saStLate") : st === "review" ? t("saStReview") : t("pending");
    const where = [buildingOf(p), p.unit].filter(Boolean).join(" · ");
    return `
      <div class="list-item">
        <div class="meta">
          <div class="title">${esc(r.name || r.email || "—")} · ${esc(where)}</div>
          <div class="sub">${t("saTotalLabel")} ${money(Number(p.amount) || 0)} · ${t("saDue")} ${esc(p.dueDate || "—")}${p.description ? " · " + esc(p.description) : ""}</div>
        </div>
        <span class="badge ${badgeCls}">${esc(label)}</span>
      </div>`;
  }).join("");
}

["saMonth", "saStatus", "saBuilding"].forEach(id => $(id).addEventListener("change", refresh));
$("saSearch").addEventListener("input", refresh);
window.addEventListener("so-lang-changed", () => { renderGreeting(); refresh(); renderLog(); });

// ---------- Overdue residents (for phone follow-up) ----------
// One row per resident with at least one overdue installment. Receipts awaiting review are NOT
// counted as overdue (the resident already paid and is waiting on us). Month filter is ignored on purpose:
// a resident who is late from last month must still show up. Building and search filters do apply.
function overdueRows() {
  const fBuilding = $("saBuilding").value, q = $("saSearch").value.trim().toLowerCase();
  const today = new Date(todayISO()).getTime();
  const by = {};
  payments.forEach(p => {
    if (stateOf(p) !== "late") return;
    if (fBuilding && buildingOf(p) !== fBuilding) return;
    const key = p.residentId || `unit:${p.unit || ""}`;
    const r = residents[p.residentId] || {};
    if (q && !`${p.unit || ""} ${r.name || ""} ${r.email || ""}`.toLowerCase().includes(q)) return;
    const g = by[key] || (by[key] = {
      name: r.name || r.email || "", building: buildingOf(p), unit: p.unit || "",
      phone: phones[p.residentId] || r.phone || "", count: 0, total: 0, oldest: ""
    });
    g.count += 1; g.total += Number(p.amount) || 0;
    if (p.dueDate && (!g.oldest || p.dueDate < g.oldest)) g.oldest = p.dueDate;
  });
  return Object.values(by).map(g => ({
    ...g, days: g.oldest ? Math.max(0, Math.floor((today - new Date(g.oldest).getTime()) / 86400000)) : 0
  })).sort((a, b) => b.total - a.total);
}

function renderOverdue() {
  const rows = overdueRows();
  const sum = rows.reduce((n, r) => n + r.total, 0);
  $("saOverdueCount").textContent = rows.length ? `${rows.length} ${t("saResidents")} · ${t("saTotalLabel")} ${money(sum)}` : "";
  if (!rows.length) { $("saOverdueList").innerHTML = `<p class="empty-state">${t("saNoOverdue")}</p>`; return; }
  $("saOverdueList").innerHTML = rows.map(r => {
    const where = [r.building, r.unit].filter(Boolean).join(" · ");
    const phone = r.phone ? `<a href="tel:${esc(r.phone)}" dir="ltr">${esc(r.phone)}</a>` : t("saNoPhone");
    return `
      <div class="list-item">
        <div class="meta">
          <div class="title">${esc(r.name || "—")} · ${esc(where)}</div>
          <div class="sub">${phone} · ${r.count} ${t("saInstallments")} · ${t("saOldest")} ${esc(r.oldest || "—")} (${r.days} ${t("saDays")})</div>
        </div>
        <span class="badge overdue">${t("saTotalLabel")} ${money(r.total)}</span>
      </div>`;
  }).join("");
}

$("saOverdueCsv").addEventListener("click", () => {
  const rows = overdueRows();
  if (!rows.length) { alert(t("saNoOverdue")); return; }
  downloadCsv("overdue-residents",
    [t("saCsvName"), t("saBuilding"), t("saCsvUnit"), t("saCsvPhone"), t("saInstallments"), t("saCsvTotal"), t("saOldest"), t("saDays")],
    rows.map(r => [r.name, r.building, r.unit, r.phone, r.count, Math.round(r.total), r.oldest, r.days]));
});

// ---------- Activity log ----------
const LOG_LABEL = { payment_paid: "saLogPaid", proof_approved: "saLogReceipt", proof_rejected: "saLogRejected", admin_promoted: "saLogPromoted", admin_removed: "saLogRemoved" };
function renderLog() {
  if (!logs.length) { $("saLogList").innerHTML = `<p class="empty-state">${t("saNoLog")}</p>`; return; }
  $("saLogList").innerHTML = logs.map(l => {
    const when = l.createdAt && l.createdAt.toDate ? l.createdAt.toDate().toLocaleString() : "…";
    const isPay = l.targetType === "payment";
    const detail = isPay
      ? [l.unit, l.amount ? `${t("saTotalLabel")} ${money(l.amount)}` : "", l.dueDate ? `${t("saDue")} ${l.dueDate}` : "", l.note || ""].filter(Boolean).join(" · ")
      : (l.targetName || "");
    return `
      <div class="list-item">
        <div class="meta">
          <div class="title">${esc(t(LOG_LABEL[l.action] || "saLogOther"))}${detail ? " — " + esc(detail) : ""}</div>
          <div class="sub">${esc(l.actorName || "—")} · ${esc(when)}</div>
        </div>
      </div>`;
  }).join("");
}
