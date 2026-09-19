// ==========================================================================
// Special Owner — version number + update archive (single source of truth)
//
// HOW TO RELEASE A NEW VERSION
//   1. Bump APP_VERSION below.
//   2. Add a NEW entry at the TOP of CHANGELOG (newest first) describing what changed
//      compared to the previous version (Arabic + English).
//   3. Run:  node build-changelog.js   (regenerates CHANGELOG.md from this file)
//
// This file is loaded as a normal <script> by every page (and imported by sw.js), so:
//   - the version number is printed at the bottom of every screen;
//   - tapping it opens the update archive;
//   - the service-worker cache name follows the version, so every release refreshes the cache.
// ==========================================================================
(function (g) {
  var APP_VERSION = "1.3.0";

  var CHANGELOG = [
    {
      version: "1.3.0", date: "2026-09-19",
      ar: [
        "رقم الإصدار بقى ظاهر أسفل كل شاشة في التطبيق، والضغط عليه يفتح أرشيف التحديثات.",
        "أرشيف تحديثات (CHANGELOG.md) بيسجل اللي عملته كل نسخة مقارنة بالنسخة اللي قبلها.",
        "إزالة التصوير بكاميرا اللابتوب/الكمبيوتر: زرّا تصوير الصورة والفيديو بيظهروا على الموبايل فقط، وعلى الكمبيوتر يفضل «رفع من الجهاز».",
        "كاش التطبيق بقى مربوط برقم الإصدار، فكل تحديث بيوصل تلقائيًا."
      ],
      en: [
        "The version number is now shown at the bottom of every screen; tapping it opens the update archive.",
        "Added an update archive (CHANGELOG.md) recording what each version changed compared to the previous one.",
        "Removed webcam capture on laptops/desktops: the Take photo / Record video buttons now appear on phones only; desktops keep \"Upload from device\".",
        "The app cache name now follows the version number, so every release refreshes automatically."
      ]
    },
    {
      version: "1.2.0", date: "2026-09-19",
      ar: [
        "إصلاح: مفتاح اللغة كان بيغطي على زر تسجيل الخروج في الموبايل. بقى في صف لوحده فوق الهيدر ومش ثابت على الشاشة.",
        "إضافة التصوير بكاميرا الكمبيوتر داخل نافذة خاصة بالموقع (تم إلغاؤها في 1.3.0)."
      ],
      en: [
        "Fix: the language switch covered the logout button on phones. It now sits in its own row above the header and no longer stays fixed on screen.",
        "Added webcam capture on desktops in a built-in capture window (removed again in 1.3.0)."
      ]
    },
    {
      version: "1.1.1", date: "2026-09-19",
      ar: [
        "إصلاح: الموقع كله كان بيقف ومفيش زرار بيستجيب لو ملف الوسائط ناقص أو admin.html قديم. دلوقتي بيشتغل الباقي وتقف ميزة الوسائط بس.",
        "إصلاح: announcement-media.js بقى ما يعتمدش على إن firebase-config.js يصدّر storage."
      ],
      en: [
        "Fix: the whole site stopped responding when the media module was missing or admin.html was outdated. Now only the media feature is unavailable and everything else keeps working.",
        "Fix: announcement-media.js no longer depends on firebase-config.js exporting `storage`."
      ]
    },
    {
      version: "1.1.0", date: "2026-09-19",
      ar: [
        "الأدمن يقدر يرفع أو يصوّر صورة أو فيديو (حتى 50 ميجا) مع الإعلان.",
        "الإعلان مبيتنشر للسكان غير بعد ما الملف يخلص رفع، مع شريط تقدم.",
        "السكان والعمال بيشوفوا الصورة أو الفيديو تحت نص الإعلان.",
        "الصور بتتصغّر وتتضغط تلقائيًا قبل الرفع.",
        "قواعد Firebase Storage جديدة (الرفع للأدمن فقط).",
        "الخدمة الخلفية (service worker) ما بتخزّنش ملفات الفيديو."
      ],
      en: [
        "The admin can upload or capture a photo or video (up to 50 MB) with an announcement.",
        "The announcement is published to residents only after the file has fully uploaded, with a progress bar.",
        "Residents and staff see the photo/video under the announcement text.",
        "Photos are automatically resized and compressed before upload.",
        "New Firebase Storage rules (uploads restricted to the admin).",
        "The service worker no longer caches video files."
      ]
    },
    {
      version: "1.0.0", date: "2026-09-18",
      ar: ["النسخة الأساسية للتطبيق: تطبيق السكان، لوحة الأدمن، العمال، مدير الموقع، والكول سنتر."],
      en: ["Base version of the app: resident app, admin dashboard, workers, site manager and call center."]
    }
  ];

  g.SO_VERSION = APP_VERSION;
  g.SO_CHANGELOG = CHANGELOG;

  // ---- everything below needs a page (skipped inside the service worker / Node) ----
  if (typeof document === "undefined") return;

  function lang() {
    return (g.SO_I18N && g.SO_I18N.getLang && g.SO_I18N.getLang()) || localStorage.getItem("so_lang") || "ar";
  }
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  function openArchive() {
    var ar = lang() === "ar";
    var old = document.getElementById("soChangelog");
    if (old) old.remove();
    var overlay = document.createElement("div");
    overlay.id = "soChangelog";
    overlay.dir = ar ? "rtl" : "ltr";
    overlay.style.cssText = "position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px";
    var items = CHANGELOG.map(function (c) {
      var lines = (ar ? c.ar : c.en).map(function (l) { return "<li style=\"margin:4px 0\">" + esc(l) + "</li>"; }).join("");
      var current = c.version === APP_VERSION ? " <span style=\"background:#0f6e5f;color:#fff;border-radius:10px;padding:1px 8px;font-size:10px\">" + (ar ? "الحالي" : "current") + "</span>" : "";
      return "<div style=\"padding:10px 0;border-bottom:1px solid #eef2f0\"><div style=\"font-weight:700;font-size:14px\">v" + esc(c.version) + current +
        " <span style=\"font-weight:400;font-size:11px;color:#6b7c76\">" + esc(c.date) + "</span></div><ul style=\"margin:6px 0 0;padding-inline-start:18px;font-size:12px;line-height:1.5\">" + lines + "</ul></div>";
    }).join("");
    overlay.innerHTML = "<div style=\"background:#fff;border-radius:16px;max-width:440px;width:100%;max-height:80vh;display:flex;flex-direction:column;overflow:hidden\">" +
      "<div style=\"display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid #eef2f0\"><b>" + (ar ? "أرشيف التحديثات" : "Update archive") +
      "</b><button type=\"button\" id=\"soChangelogClose\" style=\"font-size:20px;background:none;border:none;cursor:pointer;color:#6b7c76\">✕</button></div>" +
      "<div style=\"overflow-y:auto;padding:0 16px 12px\">" + items + "</div></div>";
    document.body.appendChild(overlay);
    overlay.addEventListener("click", function (e) { if (e.target === overlay || e.target.id === "soChangelogClose") overlay.remove(); });
  }

  function mountBadge() {
    if (document.getElementById("soVersion")) return;
    var hasTabbar = !!document.querySelector(".tabbar");
    var btn = document.createElement("button");
    btn.id = "soVersion";
    btn.type = "button";
    btn.textContent = "Special Owner · v" + APP_VERSION;
    btn.style.cssText = "display:block;margin:16px auto " + (hasTabbar ? "96px" : "16px") + ";background:none;border:none;font-size:11px;color:#6b7c76;cursor:pointer;text-decoration:underline;text-underline-offset:3px";
    btn.addEventListener("click", openArchive);
    (document.querySelector(".app-shell") || document.body).appendChild(btn);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountBadge);
  else mountBadge();
})(typeof window !== "undefined" ? window : self);
