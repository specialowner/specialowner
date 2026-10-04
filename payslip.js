// Printable payslip. "Save as PDF" in the print dialog gives the PDF; no library needed.
const L = {
  ar: { title: "قسيمة مرتب", name: "الاسم", month: "الشهر", basic: "الأساسي", allowances: "البدلات", incentives: "الحوافز",
        deductions: "الخصومات", net: "صافي المرتب", days: "أيام الحضور", hours: "صافي ساعات العمل", cur: "جنيه", print: "طباعة / حفظ PDF", att: "الحضور" },
  en: { title: "Payslip", name: "Name", month: "Month", basic: "Basic", allowances: "Allowances", incentives: "Incentives",
        deductions: "Deductions", net: "Net salary", days: "Days attended", hours: "Net working hours", cur: "EGP", print: "Print / Save as PDF", att: "Attendance" }
};
const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");

export function openPayslip(r, lang, att) {
  const x = L[lang === "ar" ? "ar" : "en"], rtl = lang === "ar";
  const row = (k, v, b) => `<tr${b ? ' class="tot"' : ""}><td>${x[k]}</td><td>${v}</td></tr>`;
  const money = n => `${Number(n || 0).toLocaleString()} ${x.cur}`;
  const html = `<!doctype html><html dir="${rtl ? "rtl" : "ltr"}" lang="${lang}"><head><meta charset="utf-8"><title>${x.title} ${esc(r.month)}</title>
<style>body{font-family:system-ui,Segoe UI,Tahoma,Arial,sans-serif;max-width:520px;margin:24px auto;padding:0 16px;color:#1c2523}
h1{font-size:20px;color:#0a4f45;margin:0 0 4px}.sub{color:#6b7a76;font-size:13px;margin-bottom:16px}
table{width:100%;border-collapse:collapse;margin-bottom:14px}td{padding:9px 6px;border-bottom:1px solid #e3e9e6;font-size:14px}
td:last-child{text-align:${rtl ? "left" : "right"};font-weight:600}.tot td{border-top:2px solid #0f6e5f;font-size:16px;color:#0f6e5f}
h2{font-size:13px;color:#6b7a76;margin:18px 0 0}button{padding:10px 18px;border:0;border-radius:10px;background:#0f6e5f;color:#fff;font-size:14px;cursor:pointer}
@media print{button{display:none}}</style></head><body>
<h1>Special Owner — ${x.title}</h1><div class="sub">${x.name}: ${esc(r.workerName)} · ${x.month}: ${esc(r.month)}</div>
<table>${row("basic", money(r.basic))}${row("allowances", money(r.allowances))}${row("incentives", money(r.incentives))}${row("deductions", "− " + money(r.deductions))}${row("net", money(r.net), 1)}</table>
${att ? `<h2>${x.att}</h2><table>${row("days", att.days)}${row("hours", att.hours.toFixed(1))}</table>` : ""}
<button onclick="window.print()">${x.print}</button></body></html>`;
  const w = window.open("", "_blank");
  if (!w) { alert(rtl ? "اسمح بالنوافذ المنبثقة لطباعة القسيمة." : "Allow pop-ups to print the payslip."); return; }
  w.document.write(html); w.document.close();
}
