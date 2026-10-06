// Generic CSV export (Excel-friendly: UTF-8 BOM + CRLF). Skips huge/binary fields such as proof images.
import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

export const DATASETS = {
  residents:   { col: "users", where: ["role", "==", "resident"], file: "residents" },
  workers:     { col: "users", where: ["role", "==", "worker"], file: "workers" },
  payments:    { col: "payments", file: "payments" },
  maintenance: { col: "maintenanceRequests", file: "maintenance-requests" },
  attendance:  { col: "attendance", file: "attendance" },
  access:      { col: "accessLogs", file: "access-log" }
};
const SKIP_KEYS = new Set(["token", "proofData", "proofUrl", "photo", "photoData", "mediaUrl"]);

function cell(v) {
  if (v == null) return "";
  if (typeof v.toDate === "function") { const d = v.toDate(); return isNaN(d) ? "" : d.toISOString().replace("T", " ").slice(0, 19); }
  if (Array.isArray(v)) return v.map(cell).join("; ");
  if (typeof v === "object") return "";
  const s = String(v);
  return s.startsWith("data:") || s.length > 500 ? "" : s;
}
const esc = s => /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;

export function toCsv(rows) {
  const keys = [...new Set(rows.flatMap(r => Object.keys(r)))].filter(k => !SKIP_KEYS.has(k)).sort((a, b) => a === "id" ? -1 : b === "id" ? 1 : a.localeCompare(b));
  const lines = [keys.map(esc).join(",")].concat(rows.map(r => keys.map(k => esc(cell(r[k]))).join(",")));
  return "\uFEFF" + lines.join("\r\n");
}

export async function exportDataset(db, name) {
  const ds = DATASETS[name];
  const ref = ds.where ? query(collection(db, ds.col), where(...ds.where)) : collection(db, ds.col);
  const snap = await getDocs(ref);
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${ds.file}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return rows.length;
}
