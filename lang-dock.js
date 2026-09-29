// Puts the language switch inside the top bar (right before the guide / logout buttons)
// on every page, so it never floats above or over the logout button.
(function () {
  "use strict";
  function dock() {
    var topbar = document.querySelector(".topbar");
    var toggle = document.querySelector(".lang-toggle");
    if (!topbar || !toggle || toggle.parentNode === topbar) return;
    var logout = document.getElementById("logoutBtn");
    var ref = null;
    if (logout) {
      ref = logout;
      while (ref.parentNode && ref.parentNode !== topbar) ref = ref.parentNode;
      if (ref.parentNode !== topbar) ref = null;
    }
    topbar.insertBefore(toggle, ref);
    topbar.classList.add("has-lang");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", dock);
  else dock();
  // tour.js wraps the logout button later; keep the switch before that wrapper
  window.addEventListener("load", dock);
})();
