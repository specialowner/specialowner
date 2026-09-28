// ==========================================================================
// Special Owner — guided tour ("Guide") shown on every role's home screen
//
//  • Shown automatically ONCE per user (per device) the first time they open the app
//    after this tour was introduced. Bump TOUR_REV only when the tour content changes
//    enough to be worth showing again to everybody.
//  • Can be exited at any moment: ✕ button, "Skip tour", the Esc key.
//  • Can be reopened at any moment from the "?" button added next to Logout in the topbar.
//  • Spotlights the real tab / button being explained. It never clicks anything in the app,
//    so it can't start the camera, load data or change the user's screen.
//  • Arabic (Egyptian) + English, follows the app language and can be switched inside the tour.
// ==========================================================================
import { auth } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

const TOUR_REV = "1.6.0";
const SEEN_PREFIX = "so_tour_seen_";

const PAGE_ROLE = {
  "resident.html": "resident",
  "admin.html": "admin",
  "worker.html": "worker",
  "manager.html": "manager",
  "call-center.html": "callcenter"
};
const ROLE = PAGE_ROLE[location.pathname.split("/").pop()];

/* ------------------------------------------------------------------ */
/*  Content                                                            */
/* ------------------------------------------------------------------ */

const tab = (name) => `.tab-btn[data-tab="${name}"]`;
const GUIDE_BTN = "#soTourBtn";
const dash = (d) => `.dash-btn[data-dash="${d}"]`;
// Admin: spotlight the real tab when its dashboard is open, otherwise the dashboard switch.
const adminTab = (name, d) => [tab(name), dash(d)];

// s(icon, target, [arTitle, arBody, arList?], [enTitle, enBody, enList?])
function s(icon, target, ar, en) {
  return { icon, target, ar: { t: ar[0], b: ar[1], l: ar[2] || [] }, en: { t: en[0], b: en[1], l: en[2] || [] } };
}

const guideStep = s("❓", GUIDE_BTN,
  ["الجولة دايمًا معاك", "لو حبيت تشوف الشرح ده تاني في أي وقت، اضغط على زرار ؟ اللي فوق جنب تسجيل الخروج. ولتغيير اللغة استخدم زرار عربي / EN.", []],
  ["The tour is always here", "To see this walkthrough again at any time, tap the ? button at the top, next to Logout. Use the AR / EN switch to change the language.", []]
);

function getSteps(role, opts) {
  switch (role) {
    case "resident": return [
      s("👋", null,
        ["أهلاً بيك في Special Owner", "جولة سريعة على كل اللي تقدر تعمله في تطبيق كمبوندك. تقدر تقفلها في أي وقت.", []],
        ["Welcome to Special Owner", "A quick tour of everything you can do in your compound's app. You can close it at any time.", []]),
      s("🏠", tab("home"),
        ["الرئيسية", "هنا بتوصلك إعلانات الإدارة أول بأول: نصوص وصور وفيديوهات.", []],
        ["Home", "Announcements from the management reach you here as soon as they're posted: text, photos and videos.", []]),
      s("💰", tab("finance"),
        ["المدفوعات", "شوف المبلغ المستحق عليك وحالة كل دفعة، وارفع إثبات الدفع (صورة أو ملف PDF).", ["مستحقة", "مدفوعة", "متأخرة"]],
        ["Payments", "See what you owe and the status of every payment, and upload your proof of payment (a photo or a PDF).", ["Pending", "Paid", "Overdue"]]),
      s("🎫", tab("invites"),
        ["الدعوات", "اعمل دعوة لضيفك بكود QR: اكتب اسمه وتليفونه وتاريخ الزيارة، وابعتها له على واتساب. الأمن بيمسح الكود عند البوابة.", ["الخدمة دي بتشتغل بعد ما الإدارة تفعّل حسابك"]],
        ["Invitations", "Create a QR-code invitation for your guest: enter their name, phone and visit date, then send it on WhatsApp. Security scans the code at the gate.", ["This works once the management has activated your account"]]),
      s("🛠️", tab("maint"),
        ["الطلبات ← الصيانة", "بلّغ عن أي عطل جوه شقتك: كهرباء، سباكة، تكييف، نجارة، نضافة… وضيف صورة لو حابب، وتابع حالة الطلب لحد ما يخلص.", []],
        ["Requests → Maintenance", "Report any issue inside your apartment: electrical, plumbing, A/C, carpentry, cleaning… Add a photo if you like and follow the request until it's done.", []]),
      s("🔁", tab("maint"),
        ["الطلبات ← الخدمات", "اشترك في خدمات دورية: غسيل العربية، نضافة الشقة، أو العناية بالجنينة الخاصة، وتقدر تلغي الاشتراك وقت ما تحب.", []],
        ["Requests → Services", "Subscribe to regular services: car cleaning, home cleaning or private garden care. You can cancel any time.", []]),
      s("📣", tab("maint"),
        ["الطلبات ← بلاغ", "بلّغ عن مشكلة في الأماكن المشتركة بالكمبوند: إنارة، زبالة، مياه، أسانسير، أمان، نضافة أو جنينة.", []],
        ["Requests → Report", "Report a problem in the compound's common areas: lighting, garbage, water, elevator, safety, cleanliness or garden.", []]),
      guideStep
    ];

    case "manager": return [
      s("👋", null,
        ["أهلاً بيك يا مدير الموقع", "جولة سريعة على أدواتك في الإدارة اليومية للكمبوند. تقدر تقفلها في أي وقت.", []],
        ["Welcome, Site Manager", "A quick tour of your tools for running the compound day to day. You can close it at any time.", []]),
      s("🏠", tab("home"),
        ["الرئيسية", "بياناتك الشخصية: رصيد إجازاتك، مرتبك الحالي وتاريخه، وتقدر تقدّم طلب إجازة.", []],
        ["Home", "Your own details: leave balance, current salary and history, and you can request leave.", []]),
      s("👷", tab("workers"),
        ["العمال", "ضيف حسابات عمال جديدة حسب الفئة، وشوف كل العمال وحركتهم.", ["أمن", "صيانة", "نضافة", "بواب", "جنينة"]],
        ["Workers", "Add new worker accounts by category, and see all workers and their movements.", ["Security", "Maintenance", "Cleaning", "Porter", "Garden"]]),
      s("🔑", tab("security"),
        ["الأمن", "سجل الدخول والخروج اللي بيسجله الأمن عند البوابة.", []],
        ["Security", "The entry and exit log recorded by security at the gate.", []]),
      s("🚪", tab("visits"),
        ["الزيارات", "كل زيارات الضيوف اللي السكان عملولها دعوات.", []],
        ["Visits", "Every guest visit that residents have created invitations for.", []]),
      s("🗓️", tab("leaves"),
        ["الإجازات", "راجع طلبات إجازة العمال ووافق عليها أو ارفضها.", []],
        ["Leaves", "Review the workers' leave requests and approve or reject them.", []]),
      s("🛠️", tab("maint"),
        ["الصيانة", "شوف طلبات الصيانة ووزّعها على العمال يدوي أو بالتوزيع التلقائي، واعمل مهام ميدانية لعامل بنفسك.", []],
        ["Maintenance", "See the maintenance requests and hand them to workers manually or with auto-assign, and create on-site tasks yourself.", []]),
      s("📣", tab("announcements"),
        ["الإعلانات", "انشر إعلان للسكان بعنوان وتفاصيل.", []],
        ["Announcements", "Post an announcement to the residents with a title and details.", []]),
      guideStep
    ];

    case "callcenter": return [
      s("👋", null,
        ["أهلاً بيك في الكول سنتر", "جولة سريعة على شغلك اليومي. تقدر تقفلها في أي وقت.", []],
        ["Welcome to the Call Center", "A quick tour of your daily work. You can close it at any time.", []]),
      s("📞", tab("home"),
        ["تسجيل مكالمة", "دوّر على الساكن برقم الوحدة، اختاره، اختار نوع المشكلة واكتب اللي قاله. الطلب بيتسجل باسمه ويدخل طابور الصيانة عادي.", ["ابحث برقم الوحدة", "اختار الساكن", "اكتب المشكلة"]],
        ["Log a call", "Search the resident by unit number, pick them, choose the category and write what they said. The request is created on their behalf and joins the normal maintenance queue.", ["Search by unit number", "Pick the resident", "Describe the issue"]]),
      s("🗒️", tab("history"),
        ["مكالماتي", "بتشوف الطلبات اللي أنت سجلتها بس، مع حالتها لحظة بلحظة.", []],
        ["My calls", "You see only the requests you logged yourself, with their live status.", []]),
      guideStep
    ];

    case "worker": {
      const security = opts && opts.security;
      const first = security
        ? s("🔑", "#scannerTabBtn",
            ["الدخول", "امسح كود QR بتاع الضيوف والعمال بكاميرا التليفون عشان تسمح بالدخول، وشوف آخر عمليات الدخول والخروج.", ["الشاشة دي بتتفتح بعد موافقة الإدارة على حسابك"]],
            ["Access", "Scan guests' and workers' QR codes with your phone camera to let them in, and see the latest entries and exits.", ["This screen opens once the management approves your account"]])
        : s("🛠️", "#ordersTabBtn",
            ["مهامي", "هنا مهام الشغل المطلوبة منك: لمين، وفين، وإيه المطلوب. المهام المفتوحة فوق والمنتهية تحت. كمان بتلاقي الأماكن المشتركة اللي انت مسؤول عنها والمهمة الدورية وكل قد إيه.", ["الشاشة دي بتتفتح بعد موافقة الإدارة على حسابك"]],
            ["My work orders", "Your assigned jobs are here: for whom, where and what needs doing. Open jobs are on top, completed ones below. You also see the common areas you look after, with the routine task and how often.", ["This screen opens once the management approves your account"]]);
      return [
        s("👋", null,
          ["أهلاً بيك في Special Owner", "جولة سريعة على كل اللي تقدر تعمله. تقدر تقفلها في أي وقت.", []],
          ["Welcome to Special Owner", "A quick tour of everything you can do. You can close it at any time.", []]),
        first,
        s("⏱️", tab("home"),
          ["الرئيسية ← ورديتي", "سجّل حضورك وانصرافك، وابدأ واقفل الاستراحة، وشوف رصيد إجازاتك.", ["حضور", "استراحة", "انصراف"]],
          ["Home → My shift", "Clock in and out, start and end your break, and check your leave balance.", ["Clock in", "Break", "Clock out"]]),
        s("💵", tab("home"),
          ["الرئيسية ← مرتبي وسلفة", "شوف مرتبك بالتفصيل (الأساسي، البدلات، الحوافز، الخصومات، الصافي) وتاريخ الشهور اللي فاتت، وقدّم طلب سلفة.", []],
          ["Home → Salary & advance", "See your salary in detail (basic, allowances, incentives, deductions, net), past months, and request an advance.", []]),
        s("🗓️", tab("home"),
          ["الرئيسية ← الإجازات والإعلانات", "قدّم طلب إجازة وتابع حالته، واقرأ إعلانات الإدارة الخاصة بالعاملين.", []],
          ["Home → Leave & announcements", "Request leave and follow its status, and read the management's staff announcements.", []]),
        guideStep
      ];
    }

    case "admin": return [
      s("👋", null,
        ["أهلاً بيك في لوحة الأدمن", "اللوحة مقسومة لجزئين: «السكان» و«التشغيل». الجولة دي بتعدّي على كل قسم. تقدر تقفلها في أي وقت.", []],
        ["Welcome to the Admin panel", "The panel has two dashboards: Residents and Operations. This tour goes through every section. You can close it at any time.", []]),
      s("🔀", ".dash-switch",
        ["التبديل بين اللوحتين", "الزرارين اللي فوق بيبدّلوا بين لوحة «السكان» ولوحة «التشغيل». كل لوحة ليها تبويباتها في الشريط اللي تحت.", []],
        ["Switching dashboards", "The two buttons at the top switch between the Residents and the Operations dashboards. Each one has its own tabs in the bottom bar.", []]),
      s("👥", adminTab("residents", "res"),
        ["السكان", "أرقام سريعة (السكان، العمال النشطين، الطلبات المعلقة، المدفوعات المتأخرة)، وقائمة السكان مع طلبات تفعيل الحسابات، وإضافة حساب ساكن جديد.", []],
        ["Residents", "Quick numbers (residents, active workers, pending requests, overdue payments), the residents list with account activation requests, and adding a new resident account.", []]),
      s("🏢", adminTab("property", "res"),
        ["المباني", "سجّل كل المباني وشققها، وكل شقة لساكنها (حساب على التطبيق أو اسم وتليفون بس). الإنشاء السريع بيعمل الهيكل كله بترقيم تلقائي، مثلاً 30 مبنى و400 شقة.", []],
        ["Property", "Register every building and its apartments, each one assigned to its resident (an app account, or just a name and phone). Quick setup creates the whole structure with automatic numbering, e.g. 30 buildings and 400 apartments.", []]),
      s("💰", adminTab("finance", "res"),
        ["المالية", "سجّل مدفوعات لكل ساكن بالوحدة والإيميل، وشوف كل المدفوعات، وراجع إيصالات الدفع اللي السكان رفعوها.", []],
        ["Finance", "Add payment records per resident by unit and email, see all payments, and review the payment receipts residents uploaded.", []]),
      s("📢", adminTab("announcements", "res"),
        ["الإعلانات", "انشر إعلان للكل أو للسكان أو للعمال أو لناس محددين، وممكن تضيف صورة أو فيديو.", []],
        ["Announcements", "Post an announcement to everyone, to residents, to workers or to chosen people, with an optional photo or video.", []]),
      s("🔑", adminTab("access", "ops"),
        ["التشغيل ← الدخول", "من لوحة «التشغيل»: ماسح QR بالكاميرا للتحقق من دعوات الضيوف وتسجيل الدخول والخروج، وأكواد QR رئيسية بتاريخ انتهاء، وسجل الدخول.", []],
        ["Operations → Access", "In the Operations dashboard: a live camera QR scanner to validate guest invitations and log entries and exits, master QR codes with an optional expiry, and the access log.", []]),
      s("👷", adminTab("workers", "ops"),
        ["التشغيل ← العمال", "أنشئ حسابات العمال (أمن، صيانة، نضافة، بواب، جنينة) وحسابات مديري الموقع والكول سنتر، وأدر المرتبات، وراجع طلبات السلف والإجازات.", []],
        ["Operations → Workers", "Create worker accounts (security, maintenance, cleaning, porter, garden) plus site-manager and call-center accounts, manage salaries, and review advance and leave requests.", []]),
      s("🛠️", adminTab("maint", "ops"),
        ["التشغيل ← الصيانة", "نظرة عامة بالأرقام ورسم بياني لتوزيع الطلبات على العمال، وتغيير حالة أي طلب، ومهام ميدانية، واشتراكات السكان في الخدمات.", []],
        ["Operations → Maintenance", "An overview with counts and a chart of requests per worker, changing any request's status, on-site tasks, and residents' service subscriptions.", []]),
      s("🌳", adminTab("areas", "ops"),
        ["التشغيل ← الأماكن", "سجّل الأماكن المشتركة (مدخل، سلالم، أسانسير، حديقة، حمام سباحة، جراج…) وسلّم كل مكان لعامل، وابعت مهمة دورية أو استثنائية، وكلّف مجموعة أماكن لعامل واحد بضغطة.", []],
        ["Operations → Areas", "Register the common areas (entrance, stairs, lift, garden, pool, garage…), give each one to a worker, send a routine or extraordinary job, and hand a whole group of areas to one worker in one click.", []]),
      guideStep
    ];
  }
  return [guideStep];
}

/* ------------------------------------------------------------------ */
/*  UI text                                                            */
/* ------------------------------------------------------------------ */

const UI = {
  ar: { step: "خطوة", of: "من", next: "التالي", prev: "السابق", skip: "تخطي الجولة", done: "ابدأ الاستخدام", close: "إغلاق", guide: "دليل الاستخدام" },
  en: { step: "Step", of: "of", next: "Next", prev: "Back", skip: "Skip tour", done: "Get started", close: "Close", guide: "Guide" }
};

function lang() {
  return (window.SO_I18N && window.SO_I18N.getLang && window.SO_I18N.getLang()) || localStorage.getItem("so_lang") || "ar";
}
function esc(v) { return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode: tour may show again, harmless */ } }

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

function injectStyles() {
  if (document.getElementById("soTourStyle")) return;
  const st = document.createElement("style");
  st.id = "soTourStyle";
  st.textContent = `
  #soTour{position:fixed;inset:0;z-index:3000;touch-action:none;font-family:inherit}
  #soTour.nospot{background:rgba(10,20,18,.72)}
  #soTour .so-spot{position:fixed;border-radius:12px;pointer-events:none;box-shadow:0 0 0 9999px rgba(10,20,18,.72);outline:3px solid #d4a537;outline-offset:2px;transition:all .25s ease;animation:soPulse 1.6s ease-in-out infinite}
  @keyframes soPulse{0%,100%{outline-color:#d4a537}50%{outline-color:#fff3c4}}
  #soTour .so-card{position:fixed;left:50%;width:calc(100% - 32px);max-width:400px;background:#fff;color:#1c2523;border-radius:18px;box-shadow:0 12px 40px rgba(0,0,0,.35);padding:16px 16px 14px;overflow-y:auto;transform:translateX(-50%);touch-action:pan-y}
  #soTour .so-card.center{top:50%;transform:translate(-50%,-50%)}
  #soTour .so-head{display:flex;align-items:center;gap:8px;margin-bottom:10px}
  #soTour .so-count{font-size:11px;font-weight:700;color:#6b7a76;flex:1}
  #soTour .so-langs{display:flex;background:#eef2f0;border-radius:16px;padding:2px;gap:2px}
  #soTour .so-langs button{padding:4px 10px;border-radius:14px;font-size:11px;font-weight:700;color:#6b7a76;background:none}
  #soTour .so-langs button.active{background:#0f6e5f;color:#fff}
  #soTour .so-x{width:30px;height:30px;border-radius:9px;background:#eef2f0;color:#1c2523;font-size:15px;display:flex;align-items:center;justify-content:center}
  #soTour .so-icon{font-size:34px;line-height:1;margin-bottom:6px}
  #soTour h3{font-size:17px;margin:0 0 6px;color:#0f6e5f}
  #soTour p{font-size:13.5px;line-height:1.65;margin:0}
  #soTour ul{margin:8px 0 0;padding-inline-start:0;list-style:none;display:flex;flex-wrap:wrap;gap:6px}
  #soTour li{background:#eaf5f1;color:#0a4f45;border-radius:14px;padding:3px 10px;font-size:11.5px;font-weight:700}
  #soTour .so-dots{display:flex;justify-content:center;gap:5px;margin:14px 0 12px}
  #soTour .so-dots i{width:7px;height:7px;border-radius:50%;background:#dfe6e3}
  #soTour .so-dots i.on{background:#0f6e5f;width:18px;border-radius:5px}
  #soTour .so-foot{display:flex;align-items:center;justify-content:space-between;gap:8px}
  #soTour .so-skip{background:none;color:#6b7a76;font-size:12px;font-weight:600;text-decoration:underline;text-underline-offset:3px;padding:8px 4px}
  #soTour .so-nav{display:flex;gap:8px;margin-inline-start:auto}
  #soTour .so-btn{padding:10px 16px;border-radius:10px;font-weight:700;font-size:13px}
  #soTour .so-btn.pri{background:#0f6e5f;color:#fff}
  #soTour .so-btn.sec{background:#eef2f0;color:#1c2523}
  #soTourBtn{font-weight:800;font-size:17px}
  .so-topbar-actions{display:flex;align-items:center;gap:8px}
  `;
  document.head.appendChild(st);
}

/* ------------------------------------------------------------------ */
/*  Guide button (always available, next to Logout)                    */
/* ------------------------------------------------------------------ */

function mountGuideButton() {
  if (document.getElementById("soTourBtn")) return;
  const logout = document.getElementById("logoutBtn");
  if (!logout || !logout.parentNode) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "soTourBtn";
  btn.className = "icon-btn";
  btn.textContent = "?";
  const wrap = document.createElement("div");
  wrap.className = "so-topbar-actions";
  logout.parentNode.insertBefore(wrap, logout);
  wrap.appendChild(btn);
  wrap.appendChild(logout); // moved, not cloned: existing click handlers stay attached
  const label = () => { const l = UI[lang()].guide; btn.title = l; btn.setAttribute("aria-label", l); };
  label();
  window.addEventListener("so-lang-changed", label);
  btn.addEventListener("click", () => startTour(true));
}

/* ------------------------------------------------------------------ */
/*  Tour engine                                                        */
/* ------------------------------------------------------------------ */

let currentUid = null;
let active = null; // { root, steps, i, onKey, onResize }

function isVisible(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && el.getClientRects().length > 0;
}

function workerSteps() {
  const sec = document.getElementById("scannerTabBtn");
  return getSteps("worker", { security: isVisible(sec) });
}

function waitForWorkerTabs(cb) {
  let tries = 0;
  const iv = setInterval(() => {
    tries++;
    if (isVisible(document.getElementById("scannerTabBtn")) || isVisible(document.getElementById("ordersTabBtn")) || tries > 25) {
      clearInterval(iv);
      cb();
    }
  }, 150);
}

function markSeen() {
  if (currentUid) safeSet(SEEN_PREFIX + currentUid, TOUR_REV);
}

function startTour(manual) {
  if (active) return;
  const launch = () => {
    const steps = ROLE === "worker" ? workerSteps() : getSteps(ROLE);
    openTour(steps);
  };
  if (ROLE === "worker") waitForWorkerTabs(launch); else launch();
}

function openTour(steps) {
  injectStyles();
  const root = document.createElement("div");
  root.id = "soTour";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  document.body.appendChild(root);
  const prevOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = "hidden";

  active = { root, steps, i: 0, prevOverflow };

  active.onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); closeTour(); return; }
    const rtl = lang() === "ar";
    const fwd = rtl ? "ArrowLeft" : "ArrowRight";
    const back = rtl ? "ArrowRight" : "ArrowLeft";
    if (e.key === fwd) { e.preventDefault(); go(1); }
    else if (e.key === back) { e.preventDefault(); go(-1); }
  };
  active.onResize = () => render();
  active.onLang = () => render();
  document.addEventListener("keydown", active.onKey);
  window.addEventListener("resize", active.onResize);
  window.addEventListener("so-lang-changed", active.onLang);

  render();
}

function go(delta) {
  if (!active) return;
  const n = active.i + delta;
  if (n < 0) return;
  if (n >= active.steps.length) { closeTour(); return; }
  active.i = n;
  render();
}

function closeTour() {
  if (!active) return;
  markSeen(); // leaving early counts as "seen" — the user made a choice, don't nag again
  document.removeEventListener("keydown", active.onKey);
  window.removeEventListener("resize", active.onResize);
  window.removeEventListener("so-lang-changed", active.onLang);
  document.documentElement.style.overflow = active.prevOverflow || "";
  active.root.remove();
  active = null;
}

function render() {
  if (!active) return;
  const L = lang();
  const ui = UI[L] || UI.en;
  const { root, steps, i } = active;
  const step = steps[i];
  const c = step[L] || step.en;
  const last = i === steps.length - 1;

  root.dir = L === "ar" ? "rtl" : "ltr";

  // Resolve the spotlight target (skipped silently when it isn't on screen).
  const sels = [].concat(step.target || []);
  let target = null;
  for (const sel of sels) {
    const el = document.querySelector(sel);
    if (isVisible(el)) { target = el; break; }
  }
  if (target) {
    const r0 = target.getBoundingClientRect();
    if (r0.top < 0 || r0.bottom > window.innerHeight) target.scrollIntoView({ block: "center" });
  }
  const rect = target ? target.getBoundingClientRect() : null;

  root.className = rect ? "" : "nospot";
  root.innerHTML =
    (rect ? '<div class="so-spot"></div>' : "") +
    '<div class="so-card' + (rect ? "" : " center") + '">' +
      '<div class="so-head">' +
        '<span class="so-count">' + ui.step + " " + (i + 1) + " " + ui.of + " " + steps.length + "</span>" +
        '<div class="so-langs"><button type="button" data-l="ar"' + (L === "ar" ? ' class="active"' : "") + ">عربي</button>" +
        '<button type="button" data-l="en"' + (L === "en" ? ' class="active"' : "") + ">EN</button></div>" +
        '<button type="button" class="so-x" data-act="close" aria-label="' + ui.close + '">✕</button>' +
      "</div>" +
      '<div class="so-icon">' + step.icon + "</div>" +
      "<h3>" + esc(c.t) + "</h3>" +
      "<p>" + esc(c.b) + "</p>" +
      (c.l && c.l.length ? "<ul>" + c.l.map((x) => "<li>" + esc(x) + "</li>").join("") + "</ul>" : "") +
      '<div class="so-dots">' + steps.map((_, k) => "<i" + (k === i ? ' class="on"' : "") + "></i>").join("") + "</div>" +
      '<div class="so-foot">' +
        (last ? "" : '<button type="button" class="so-skip" data-act="close">' + ui.skip + "</button>") +
        '<div class="so-nav">' +
          (i > 0 ? '<button type="button" class="so-btn sec" data-act="prev">' + ui.prev + "</button>" : "") +
          '<button type="button" class="so-btn pri" data-act="next">' + (last ? ui.done : ui.next) + "</button>" +
        "</div>" +
      "</div>" +
    "</div>";

  const card = root.querySelector(".so-card");

  if (rect) {
    const pad = 4;
    const spot = root.querySelector(".so-spot");
    spot.style.top = rect.top - pad + "px";
    spot.style.left = rect.left - pad + "px";
    spot.style.width = rect.width + pad * 2 + "px";
    spot.style.height = rect.height + pad * 2 + "px";

    const vh = window.innerHeight;
    const spotInLowerHalf = rect.top + rect.height / 2 > vh / 2;
    if (spotInLowerHalf) {
      card.style.top = "16px";
      card.style.bottom = "auto";
      card.style.maxHeight = Math.max(180, rect.top - 16 - 16) + "px";
    } else {
      card.style.bottom = "16px";
      card.style.top = "auto";
      card.style.maxHeight = Math.max(180, vh - rect.bottom - 16 - 16) + "px";
    }
  } else {
    card.style.maxHeight = window.innerHeight - 32 + "px";
  }

  root.querySelectorAll("[data-act]").forEach((b) => {
    b.addEventListener("click", () => {
      const act = b.dataset.act;
      if (act === "close") closeTour();
      else if (act === "next") go(1);
      else if (act === "prev") go(-1);
    });
  });
  root.querySelectorAll(".so-langs [data-l]").forEach((b) => {
    b.addEventListener("click", () => {
      if (window.SO_I18N && window.SO_I18N.applyLang) window.SO_I18N.applyLang(b.dataset.l); // re-renders through so-lang-changed
      else { safeSet("so_lang", b.dataset.l); render(); }
    });
  });

  const nextBtn = root.querySelector('[data-act="next"]');
  if (nextBtn) nextBtn.focus({ preventScroll: true });
}

/* ------------------------------------------------------------------ */
/*  Boot                                                               */
/* ------------------------------------------------------------------ */

function init() {
  const boot = () => {
    injectStyles();
    mountGuideButton();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  let started = false;
  onAuthStateChanged(auth, (user) => {
    if (!user || started) return;
    started = true;
    currentUid = user.uid;
    if (safeGet(SEEN_PREFIX + user.uid) === TOUR_REV) return;
    const begin = () => setTimeout(() => { if (!safeGet(SEEN_PREFIX + user.uid) || safeGet(SEEN_PREFIX + user.uid) !== TOUR_REV) startTour(false); }, 900);
    if (document.readyState === "complete") begin();
    else window.addEventListener("load", begin, { once: true });
  });
}

if (ROLE) init(); // keep last: init() uses constants declared above
