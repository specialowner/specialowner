// Short, friendly hints instead of raw Firebase error text.
// Usage: const { friendlyError, failMsg } = makeErrorHelpers(t);
//   alert(failMsg(t("requestFailed"), err));  // "Could not send... Check your internet connection..."
export function makeErrorHelpers(t) {
  function friendlyError(err) {
    const code = (err && err.code) || "";
    const msg = (err && err.message) || "";
    if (code === "permission-denied") return t("errPermission");
    if (code === "unavailable" || code === "deadline-exceeded" || /network|timeout|offline/i.test(msg)) return t("errNetwork");
    return "";
  }
  function failMsg(base, err) {
    const hint = friendlyError(err);
    return hint ? `${base} ${hint}` : base;
  }
  return { friendlyError, failMsg };
}
