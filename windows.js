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

  // Tile button in the taskbar
  var tileBtn = document.createElement("button");
  tileBtn.type = "button";
  tileBtn.className = "tb-tile";
  tileBtn.textContent = "\u229E";
  tileBtn.addEventListener("click", function () { tile(true); });
  taskbar.appendChild(tileBtn);

  function refreshTitles() {
    TABS.forEach(function (name) {
      var w = wins[name], b = taskBtn(name);
      if (!w || !b) return;
      w.el.querySelector(".win-ico").textContent = (b.querySelector(".tab-icon") || {}).textContent || "";
      var label = b.querySelector("[data-i18n]") || b.lastElementChild;
      w.el.querySelector(".win-name").textContent = label ? label.textContent : name;
    });
    tileBtn.title = TILE_TITLE[lang()];
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
