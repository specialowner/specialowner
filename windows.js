// ==========================================================================
// Special Owner — Window manager (Windows-style desktop) for the admin and manager panels
//
// Every section (#tab-xxx) of the admin and site-manager panels lives inside its own window. Up to MAX_WINDOWS
// windows can be open at the same time, so the admin can consult one list while
// filling in another form. The taskbar buttons (.tab-btn) open / focus / minimize.
//
// Loaded as a classic script BEFORE admin.js / manager.js; admin.js talks to it through
// window.soWindows (open, isFocused, minimize, isDesktop).
// ==========================================================================
(function () {
  "use strict";

  var MAX_WINDOWS = 4;
  // The sections are whatever the taskbar lists, so every panel can reuse this file.
  var TABS = Array.prototype.map.call(
    document.querySelectorAll(".tabbar .tab-btn[data-tab]"), function (b) { return b.dataset.tab; });
  var PAGE = (location.pathname.split("/").pop() || "").replace(/\.html$/, "") || "panel";
  var STORE_KEY = "so_windows_" + PAGE;
  var GAP = 6;

  var desk = document.querySelector(".content");
  var taskbar = document.querySelector(".tabbar");
  if (!desk || !taskbar) return;

  // The language switch normally floats over the top corner, on top of the logout / guide
  // buttons. Put it inside the top bar instead, right before those buttons.
  var topbar = document.querySelector(".topbar");
  var langToggle = document.querySelector(".lang-toggle");
  if (topbar && langToggle) {
    var logout = document.getElementById("logoutBtn");
    topbar.insertBefore(langToggle, logout && logout.parentNode === topbar ? logout : null);
  }

  var mq = window.matchMedia("(min-width: 768px)");
  var wins = {};        // name -> { el, open, min, max, free }
  var order = [];       // names of open windows, in opening order
  var zTop = 10;
  var focused = null;

  var MSG = {
    ar: "الحد الأقصى ٤ نوافذ مفتوحة معًا — أغلق نافذة أولًا.",
    en: "Maximum 4 windows open at once — close one first."
  };
  var TILE_TITLE = { ar: "ترتيب النوافذ", en: "Tile windows" };
  var isRtl = function () { return document.documentElement.dir === "rtl"; };
  var lang = function () { return isRtl() ? "ar" : "en"; };

  function taskBtn(name) { return taskbar.querySelector('.tab-btn[data-tab="' + name + '"]'); }

  // ---------- Build one window per section ----------
  TABS.forEach(function (name) {
    var sec = document.getElementById("tab-" + name);
    if (!sec) return;
    var el = document.createElement("div");
    el.className = "win";
    el.dataset.win = name;
    el.innerHTML =
      '<div class="win-title">' +
        '<span class="win-ico"></span><span class="win-name"></span>' +
        '<span class="win-btns">' +
          '<button type="button" class="wb-min" aria-label="Minimize">&#8211;</button>' +
          '<button type="button" class="wb-max" aria-label="Maximize">&#9633;</button>' +
          '<button type="button" class="wb-close" aria-label="Close">&#10005;</button>' +
        '</span>' +
      '</div>' +
      '<div class="win-body"></div>' +
      '<div class="win-grip"></div>';
    el.querySelector(".win-body").appendChild(sec);
    sec.style.display = "block";
    desk.appendChild(el);
    wins[name] = { el: el, open: false, min: false, max: false, free: false };
    wire(name);
  });

  // ---------- Bottom bar: Start menu + the open windows ----------
  // Desktop layout: the section buttons (.tabbar) become a side rail, and this bar lists
  // only the windows that are open (click = focus / minimize), with a Start menu, a
  // "windows open" counter, a Show-desktop button and the tile button.
  var BAR = {
    ar: {
      start: "\u0627\u0628\u062F\u0623",
      desktop: "\u0633\u0637\u062D \u0627\u0644\u0645\u0643\u062A\u0628",
      count: function (n) {
        return n === 0 ? "\u0644\u0627 \u0646\u0648\u0627\u0641\u0630 \u0645\u0641\u062A\u0648\u062D\u0629"
          : n === 1 ? "\u0646\u0627\u0641\u0630\u0629 \u0648\u0627\u062D\u062F\u0629 \u0645\u0641\u062A\u0648\u062D\u0629"
          : n === 2 ? "\u0646\u0627\u0641\u0630\u062A\u0627\u0646 \u0645\u0641\u062A\u0648\u062D\u062A\u0627\u0646"
          : n + " \u0646\u0648\u0627\u0641\u0630 \u0645\u0641\u062A\u0648\u062D\u0629";
      }
    },
    en: {
      start: "Start",
      desktop: "Desktop",
      count: function (n) { return n === 0 ? "No windows open" : n + (n === 1 ? " window open" : " windows open"); }
    }
  };

  var winbar = document.createElement("div");
  winbar.className = "winbar";
  winbar.innerHTML =
    '<button type="button" class="bar-start" aria-haspopup="true"><span class="bar-start-ico">\u229E</span><span class="bar-start-txt"></span></button>' +
    '<div class="bar-chips"></div>' +
    '<button type="button" class="bar-ver"></button>' +
    '<span class="bar-count"></span>' +
    '<button type="button" class="bar-desktop"></button>' +
    '<button type="button" class="bar-tile">\u25A6</button>' +
    '<div class="bar-menu" hidden></div>';
  taskbar.parentNode.insertBefore(winbar, taskbar.nextSibling);
  var startBtn = winbar.querySelector(".bar-start");
  var startTxt = winbar.querySelector(".bar-start-txt");
  var chipsEl = winbar.querySelector(".bar-chips");
  var countEl = winbar.querySelector(".bar-count");
  var deskBtn = winbar.querySelector(".bar-desktop");
  var tileBtn = winbar.querySelector(".bar-tile");
  var menuEl = winbar.querySelector(".bar-menu");
  var hiddenByDesktop = [];
  var verBtn = winbar.querySelector(".bar-ver");
  verBtn.textContent = "v" + (window.SO_VERSION || "");
  verBtn.addEventListener("click", function () { if (window.SO_OPEN_ARCHIVE) window.SO_OPEN_ARCHIVE(); });

  function iconOf(name) { var b = taskBtn(name); return (b && b.querySelector(".tab-icon") || {}).textContent || ""; }
  function labelOf(name) { return wins[name] ? wins[name].el.querySelector(".win-name").textContent : name; }

  function buildMenu() {
    menuEl.innerHTML = "";
    TABS.forEach(function (name) {
      if (!wins[name]) return;
      var it = document.createElement("button");
      it.type = "button";
      it.dataset.win = name;
      var ic = document.createElement("span"); ic.className = "bar-ico"; ic.textContent = iconOf(name);
      var tx = document.createElement("span"); tx.textContent = labelOf(name);
      it.appendChild(ic); it.appendChild(tx);
      menuEl.appendChild(it);
    });
  }

  function renderBar() {
    var L = BAR[lang()];
    startTxt.textContent = L.start;
    deskBtn.textContent = L.desktop;
    countEl.textContent = L.count(order.length);
    chipsEl.innerHTML = "";
    order.forEach(function (name) {
      var w = wins[name];
      if (!w) return;
      var chip = document.createElement("button");
      chip.type = "button";
      chip.dataset.win = name;
      chip.className = "bar-chip" + (w.min ? " min" : "") + (focused === name && !w.min ? " on" : "");
      var ic = document.createElement("span"); ic.className = "bar-ico"; ic.textContent = iconOf(name);
      var tx = document.createElement("span"); tx.className = "bar-name"; tx.textContent = labelOf(name);
      var dash = document.createElement("span"); dash.className = "bar-dash";
      chip.appendChild(ic); chip.appendChild(tx); chip.appendChild(dash);
      chipsEl.appendChild(chip);
    });
  }

  function openFromBar(name) {
    // Go through the section's own button so any per-section start-up work (e.g. the access
    // scanner) still runs; skip it when that window is already in front.
    var b = taskBtn(name);
    if (b && !(focused === name && wins[name].open && !wins[name].min)) b.click();
    else if (!b) open(name);
  }

  chipsEl.addEventListener("click", function (e) {
    var chip = e.target.closest(".bar-chip");
    if (!chip) return;
    var name = chip.dataset.win, w = wins[name];
    if (w && focused === name && !w.min) minimize(name);
    else openFromBar(name);
  });

  startBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    if (menuEl.hidden) buildMenu();
    menuEl.hidden = !menuEl.hidden;
    startBtn.classList.toggle("on", !menuEl.hidden);
  });
  menuEl.addEventListener("click", function (e) {
    var it = e.target.closest("button[data-win]");
    if (!it) return;
    menuEl.hidden = true;
    startBtn.classList.remove("on");
    openFromBar(it.dataset.win);
  });
  function closeMenu() { menuEl.hidden = true; startBtn.classList.remove("on"); }
  document.addEventListener("click", function (e) { if (!menuEl.hidden && !winbar.contains(e.target)) closeMenu(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeMenu(); });

  // Show desktop: minimize everything; press again to bring the same windows back.
  deskBtn.addEventListener("click", function () {
    var visible = order.filter(function (n) { return !wins[n].min; });
    if (visible.length) {
      hiddenByDesktop = visible;
      visible.forEach(function (n) { wins[n].min = true; render(n); });
    } else {
      var back = hiddenByDesktop.filter(function (n) { return wins[n] && wins[n].open; });
      (back.length ? back : order).forEach(function (n) { wins[n].min = false; render(n); });
      hiddenByDesktop = [];
    }
    tile();
    focusTopmost();
  });
  tileBtn.addEventListener("click", function () { tile(true); });
  window.addEventListener("so-lang-changed", function () { refreshTitles(); });

  function refreshTitles() {
    TABS.forEach(function (name) {
      var w = wins[name], b = taskBtn(name);
      if (!w || !b) return;
      w.el.querySelector(".win-ico").textContent = (b.querySelector(".tab-icon") || {}).textContent || "";
      var label = b.querySelector("[data-i18n]") || b.lastElementChild;
      w.el.querySelector(".win-name").textContent = label ? label.textContent : name;
    });
    tileBtn.title = TILE_TITLE[lang()];
    deskBtn.title = BAR[lang()].desktop;
    if (!menuEl.hidden) buildMenu();
    renderBar();
  }
  refreshTitles();
  new MutationObserver(refreshTitles).observe(taskbar, { childList: true, characterData: true, subtree: true });

  // ---------- Layout ----------
  function place(w, x, y, ww, hh) {
    var W = desk.clientWidth;
    if (isRtl()) x = W - x - ww;              // mirror the tiling for Arabic
    w.el.style.left = Math.round(x) + "px";
    w.el.style.top = Math.round(y) + "px";
    w.el.style.width = Math.round(ww) + "px";
    w.el.style.height = Math.round(hh) + "px";
  }

  function tile(force) {
    if (!mq.matches) return;
    var list = order.filter(function (n) {
      var w = wins[n];
      if (!w.open || w.min || w.max) return false;
      if (force) w.free = false;
      return !w.free;
    });
    var W = desk.clientWidth, H = desk.clientHeight, n = list.length, g = GAP;
    if (!n) return;
    var halfW = (W - g * 3) / 2, halfH = (H - g * 3) / 2;
    var rects;
    if (n === 1) rects = [[g, g, W - 2 * g, H - 2 * g]];
    else if (n === 2) rects = [[g, g, halfW, H - 2 * g], [halfW + 2 * g, g, halfW, H - 2 * g]];
    else if (n === 3) rects = [
      [g, g, halfW, H - 2 * g],
      [halfW + 2 * g, g, halfW, halfH],
      [halfW + 2 * g, halfH + 2 * g, halfW, halfH]];
    else rects = [
      [g, g, halfW, halfH], [halfW + 2 * g, g, halfW, halfH],
      [g, halfH + 2 * g, halfW, halfH], [halfW + 2 * g, halfH + 2 * g, halfW, halfH]];
    list.forEach(function (name, i) { var r = rects[i]; place(wins[name], r[0], r[1], r[2], r[3]); });
  }

  // ---------- State ----------
  function persist() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(order)); } catch (e) { /* ignore */ }
  }

  function syncTaskbar() {
    TABS.forEach(function (name) {
      var b = taskBtn(name), w = wins[name];
      if (!b || !w) return;
      b.classList.toggle("is-open", w.open);
      b.classList.toggle("active", w.open && !w.min && focused === name);
    });
    renderBar();
  }

  function render(name) {
    var w = wins[name];
    w.el.style.display = (w.open && !w.min) ? "flex" : "none";
    w.el.classList.toggle("max", w.max);
  }

  function focus(name) {
    var w = wins[name];
    if (!w || !w.open) return;
    focused = name;
    w.el.style.zIndex = ++zTop;
    TABS.forEach(function (n) { if (wins[n]) wins[n].el.classList.toggle("focused", n === name); });
    syncTaskbar();
  }

  function focusTopmost() {
    var best = null, bz = -1;
    order.forEach(function (n) {
      var w = wins[n];
      if (w.open && !w.min) {
        var z = parseInt(w.el.style.zIndex || 0, 10);
        if (z > bz) { bz = z; best = n; }
      }
    });
    focused = best;
    if (best) focus(best);
    else { TABS.forEach(function (n) { if (wins[n]) wins[n].el.classList.remove("focused"); }); syncTaskbar(); }
  }

  function toast(text) {
    var old = desk.querySelector(".win-toast");
    if (old) old.remove();
    var t = document.createElement("div");
    t.className = "win-toast";
    t.textContent = text;
    desk.appendChild(t);
    setTimeout(function () { t.remove(); }, 2600);
  }

  // ---------- Public actions ----------
  function open(name) {
    var w = wins[name];
    if (!w) return false;
    if (!w.open) {
      if (order.length >= MAX_WINDOWS) {
        toast(MSG[lang()]);
        return false;
      }
      w.open = true; w.min = false; w.max = false; w.free = false;
      order.push(name);
      render(name);
      tile();
      persist();
    } else if (w.min) {
      w.min = false;
      render(name);
      tile();
    }
    focus(name);
    return true;
  }

  function close(name) {
    var w = wins[name];
    if (!w || !w.open) return;
    w.open = false; w.min = false; w.max = false; w.free = false;
    order = order.filter(function (n) { return n !== name; });
    render(name);
    tile();
    persist();
    focusTopmost();
  }

  function minimize(name) {
    var w = wins[name];
    if (!w || !w.open) return;
    w.min = true;
    render(name);
    tile();
    focusTopmost();
  }

  function toggleMax(name) {
    var w = wins[name];
    if (!w) return;
    w.max = !w.max;
    render(name);
    if (!w.max) { w.free = false; tile(); }
    focus(name);
  }

  // ---------- Window interactions ----------
  function wire(name) {
    var w = wins[name], el = w.el;
    var title = el.querySelector(".win-title");
    var grip = el.querySelector(".win-grip");

    el.addEventListener("pointerdown", function () { focus(name); }, true);
    el.querySelector(".wb-close").addEventListener("click", function () { close(name); });
    el.querySelector(".wb-min").addEventListener("click", function () { minimize(name); });
    el.querySelector(".wb-max").addEventListener("click", function () { toggleMax(name); });
    title.addEventListener("dblclick", function (e) {
      if (!e.target.closest("button") && mq.matches) toggleMax(name);
    });

    // Drag by the title bar
    title.addEventListener("pointerdown", function (e) {
      if (!mq.matches || w.max || e.target.closest("button")) return;
      var sx = e.clientX, sy = e.clientY, ox = el.offsetLeft, oy = el.offsetTop;
      title.setPointerCapture(e.pointerId);
      function move(ev) {
        var x = ox + ev.clientX - sx, y = oy + ev.clientY - sy;
        x = Math.max(-el.offsetWidth + 90, Math.min(desk.clientWidth - 90, x));
        y = Math.max(0, Math.min(desk.clientHeight - 34, y));
        el.style.left = x + "px";
        el.style.top = y + "px";
        w.free = true;
      }
      function up() {
        title.removeEventListener("pointermove", move);
        title.removeEventListener("pointerup", up);
        title.removeEventListener("pointercancel", up);
      }
      title.addEventListener("pointermove", move);
      title.addEventListener("pointerup", up);
      title.addEventListener("pointercancel", up);
    });

    // Resize from the corner grip
    grip.addEventListener("pointerdown", function (e) {
      if (!mq.matches || w.max) return;
      e.preventDefault();
      var sx = e.clientX, sy = e.clientY, ow = el.offsetWidth, oh = el.offsetHeight, ol = el.offsetLeft;
      var rtl = isRtl();
      grip.setPointerCapture(e.pointerId);
      function move(ev) {
        var dx = ev.clientX - sx, dy = ev.clientY - sy;
        var nw = Math.max(280, rtl ? ow - dx : ow + dx);
        var nh = Math.max(200, oh + dy);
        if (rtl) el.style.left = (ol + ow - nw) + "px";
        el.style.width = nw + "px";
        el.style.height = nh + "px";
        w.free = true;
      }
      function up() {
        grip.removeEventListener("pointermove", move);
        grip.removeEventListener("pointerup", up);
        grip.removeEventListener("pointercancel", up);
      }
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", up);
      grip.addEventListener("pointercancel", up);
    });
  }

  // Re-tile on resize / breakpoint change
  window.addEventListener("resize", function () { tile(); });
  if (mq.addEventListener) mq.addEventListener("change", function () { tile(true); });

  // ---------- Restore the windows that were open last time ----------
  var saved = [];
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || "[]"); } catch (e) { saved = []; }
  if (Array.isArray(saved)) {
    saved.filter(function (n) { return wins[n]; }).slice(0, MAX_WINDOWS).forEach(open);
  }

  window.soWindows = {
    max: MAX_WINDOWS,
    open: open,
    close: close,
    minimize: minimize,
    isFocused: function (name) { return focused === name && wins[name] && wins[name].open && !wins[name].min; },
    count: function () { return order.length; },
    isDesktop: function () { return mq.matches; }
  };
})();
