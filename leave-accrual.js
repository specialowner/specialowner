// Leave balance = opening balance (set by the admin, dated) + monthly accrual - approved leave taken since.
export const ACCRUAL_PER_MONTH = 1.75;      // 21 days a year; change here to change the rule
export const LEGACY_ANCHOR = "2026-10-01";  // balances saved before this feature count from here

function fullMonths(fromISO, to) {
  const a = new Date(fromISO + "T00:00:00");
  let m = (to.getFullYear() - a.getFullYear()) * 12 + (to.getMonth() - a.getMonth());
  if (to.getDate() < a.getDate()) m--;
  return Math.max(0, m);
}
export const WEEKEND_DAYS = [5, 6];         // Friday, Saturday (JS getDay); edit here if your week differs
export function leaveDays(r) {              // working days only; public holidays are not excluded
  const a = new Date(r.fromDate + "T00:00:00"), b = new Date(r.toDate + "T00:00:00");
  if (isNaN(a) || isNaN(b) || b < a) return 0;
  let n = 0;
  for (let d = new Date(a), i = 0; d <= b && i < 366; d.setDate(d.getDate() + 1), i++) {
    if (!WEEKEND_DAYS.includes(d.getDay())) n++;
  }
  return n;
}
export function computeLeave(user, requests, now = new Date()) {
  const opening = Number(user.leaveBalance) || 0;
  const asOf = user.leaveBalanceAsOf || LEGACY_ANCHOR;
  const accrued = fullMonths(asOf, now) * ACCRUAL_PER_MONTH;
  const used = (requests || []).filter(r => r.status === "approved" && r.fromDate >= asOf)
    .reduce((n, r) => n + leaveDays(r), 0);
  return { opening, asOf, accrued, used, available: Math.round((opening + accrued - used) * 100) / 100 };
}

// Shows the current balance in `amountEl` and a small breakdown line right under it.
export function renderLeaveBalanceInto(amountEl, user, requests, t) {
  let det = document.getElementById("leaveBalanceDetail");
  if (!det) {
    det = document.createElement("div");
    det.id = "leaveBalanceDetail";
    det.style.cssText = "font-size:11px;color:var(--muted);margin-top:2px;font-weight:400";
    amountEl.insertAdjacentElement("afterend", det);
  }
  if (!(user.leaveBalance || user.leaveBalance === 0)) { amountEl.textContent = "—"; det.textContent = ""; return; }
  const c = computeLeave(user, requests);
  amountEl.textContent = `${c.available} ${t("daysShort") || ""}`;
  det.textContent = `${t("leaveOpening")}: ${c.opening} · ${t("leaveAccrued")}: +${c.accrued} · ${t("leaveUsed")}: -${c.used}`;
}
