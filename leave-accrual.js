// Leave balance = opening balance (set by the admin, dated) + monthly accrual - approved leave taken since.
export const ACCRUAL_PER_MONTH = 1.75;      // 21 days a year; change here to change the rule
export const LEGACY_ANCHOR = "2026-10-01";  // balances saved before this feature count from here

function fullMonths(fromISO, to) {
  const a = new Date(fromISO + "T00:00:00");
  let m = (to.getFullYear() - a.getFullYear()) * 12 + (to.getMonth() - a.getMonth());
  if (to.getDate() < a.getDate()) m--;
  return Math.max(0, m);
}
function leaveDays(r) {
  const d = Math.round((new Date(r.toDate) - new Date(r.fromDate)) / 86400000) + 1;
  return d > 0 ? d : 0;
}
export function computeLeave(user, requests, now = new Date()) {
  const opening = Number(user.leaveBalance) || 0;
  const asOf = user.leaveBalanceAsOf || LEGACY_ANCHOR;
  const accrued = fullMonths(asOf, now) * ACCRUAL_PER_MONTH;
  const used = (requests || []).filter(r => r.status === "approved" && r.fromDate >= asOf)
    .reduce((n, r) => n + leaveDays(r), 0);
  return { opening, asOf, accrued, used, available: Math.round((opening + accrued - used) * 100) / 100 };
}
