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
  var APP_VERSION = "1.14.0";

  var CHANGELOG = [
    {
      version: "1.14.0", date: "2026-10-05",
      ar: [
        "قسم الدخول: فوق الماسح اختيار «وضع المسح: دخول / خروج» (للأدمن وعامل الأمن). في وضع الخروج بيتسجل خروج الزائر أو صاحب الكود الرئيسي.",
        "الخروج مش بيتمنع لو الدعوة انتهت أو اتلغت (اللي جوه لازم يعرف يخرج)، لكن بيترفض لو التصريح ما دخلش أصلًا أو خرج بالفعل.",
        "سجل الحركات عند الأدمن بقى فيه فلتر بنوع الحركة (دخول/خروج) ونوع الشخص، ويعرض لحد 100 حركة. نفس توضيح دخل/خرج اتضاف في سجل عامل الأمن ومدير الموقع.",
        "نفس الكود لو الكاميرا قرأته مرتين في أقل من 5 ثواني بيتتجاهل، فالكود الرئيسي مابقاش بيتسجل دخول مكرر."
      ],
      en: [
        "Access section: a \"Scan mode: Entry / Exit\" selector above the scanner (admin and security worker). In exit mode a guest's or master-code holder's exit is recorded.",
        "Exit is never blocked by an expired or revoked invitation (someone inside must be able to leave), but it is rejected if the pass never entered or already exited.",
        "The admin's movements log now filters by movement type (entry/exit) and person type and shows up to 100 movements. The same entered/exited label was added to the security worker's and site manager's logs.",
        "Scanning the same code twice within 5 seconds is ignored, so a master code no longer logs duplicate entries."
      ]
    },
    {
      version: "1.13.1", date: "2026-10-05",
      ar: [
        "رصيد الإجازات: تفاصيل الرصيد (الافتتاحي، المستحق، المأخوذ) بقت سطر ظاهر تحت الرقم على الموبايل والكمبيوتر، مش بس بالمرور بالماوس.",
        "مدير الموقع بقى رصيده بيتحسب تلقائيًا زي العامل.",
        "الأدمن بيشوف تحت خانة الرصيد الافتتاحي سطر «الرصيد الحالي» بيتحدّث لحظيًا مع الموافقة على الإجازات.",
        "أيام الإجازة بتتحسب أيام عمل بس: الجمعة والسبت مش بيتخصموا (العطلات الرسمية لسه بتتحسب)."
      ],
      en: [
        "Leave balance: the breakdown (opening, accrued, taken) is now a visible line under the number on phones and desktop, not only on mouse hover.",
        "The site manager's balance is now calculated automatically like the workers'.",
        "Under the opening-balance field the admin now sees a \"Current balance\" line that updates live as leave is approved.",
        "Leave days now count working days only: Friday and Saturday are not deducted (public holidays still count)."
      ]
    },
    {
      version: "1.13.0", date: "2026-10-05",
      ar: [
        "شاشة العامل: في تاريخ المرتبات، زرار «قسيمة المرتب (PDF)» لكل شهر بيفتح قسيمة جاهزة للطباعة أو الحفظ كـ PDF (من نافذة الطباعة).",
        "القسيمة فيها الأساسي والبدلات والحوافز والخصومات وصافي المرتب، وأيام الحضور وصافي ساعات العمل لنفس الشهر من سجل الحضور."
      ],
      en: [
        "Worker screen: each month in the salary history has a \"Payslip (PDF)\" button that opens a printable payslip, which can be saved as PDF from the print dialog.",
        "The payslip shows basic, allowances, incentives, deductions and net salary, plus days attended and net working hours for that month from the attendance log."
      ]
    },
    {
      version: "1.12.1", date: "2026-10-05",
      ar: [
        "إصلاح: عناوين خانات المرتب ورصيد الإجازات (الأساسي، البدلات، الحوافز، الخصومات، رصيد الإجازات) كانت بتظهر بالإنجليزي في الواجهة العربية. دلوقتي بتتترجم."
      ],
      en: [
        "Fix: the labels of the salary and leave-balance fields (Basic, Allowances, Incentives, Deductions, Leave balance) showed in English in the Arabic interface. They are now translated."
      ]
    },
    {
      version: "1.12.0", date: "2026-10-05",
      ar: [
        "رصيد إجازات العامل بقى بيتحسب تلقائيًا: الرصيد الافتتاحي اللي الأدمن بيكتبه + 1.75 يوم عن كل شهر كامل (21 يوم في السنة) − أيام الإجازات الموافق عليها.",
        "الأدمن لما يغيّر رقم الرصيد بيتسجل تاريخ التغيير، والاستحقاق الشهري بيبدأ منه. الأرصدة القديمة بتبدأ من 2026-10-01 عشان ما تزيدش فجأة.",
        "العامل بيشوف الرصيد الحالي، وبالمرور بالماوس على الرقم (على الكمبيوتر) بيظهر الافتتاحي والمستحق والمأخوذ."
      ],
      en: [
        "A worker's leave balance is now calculated automatically: the opening balance the admin enters + 1.75 days per full month (21 days a year) − approved leave days.",
        "When the admin changes the balance, the change date is recorded and accrual starts from it. Existing balances start from 2026-10-01 so they do not jump.",
        "The worker sees the current balance; hovering over it with a mouse (desktop) shows opening, accrued and taken."
      ]
    },
    {
      version: "1.11.1", date: "2026-10-05",
      ar: [
        "إصلاح: رقم النسخة ماكانش واضح في لوحة الأدمن ومدير الموقع على الكمبيوتر (شريط صغير غامق تحت الشريط السفلي). دلوقتي ظاهر في الشريط السفلي جنب عدّاد النوافذ، والضغط عليه يفتح أرشيف التحديثات."
      ],
      en: [
        "Fix: the version number was hard to see in the admin and site manager panels on desktop (a tiny dark strip under the bottom bar). It now sits in the bottom bar next to the windows counter, and clicking it opens the update archive."
      ]
    },
    {
      version: "1.11.0", date: "2026-10-05",
      ar: [
        "قسم الموظفين: إحصائيات الحضور للشهر الحالي لكل عامل: عدد الشيفتات، صافي ساعات العمل (بعد خصم الاستراحات)، إجمالي الاستراحات، وأيام التأخير.",
        "التأخير بيتحسب لو الدخول بعد ساعة تقدر تحددها (الافتراضي 09:00) وبتتحفظ على الجهاز."
      ],
      en: [
        "Workers section: attendance stats for the current month per worker: number of shifts, net working hours (breaks deducted), total break time, and late days.",
        "A day counts as late when the clock-in is after a time you set (default 09:00), remembered on the device."
      ]
    },
    {
      version: "1.10.0", date: "2026-09-30",
      ar: [
        "على الكمبيوتر: أقسام لوحة الأدمن ولوحة مدير الموقع بقت في شريط جانبي (أيقونة فوق الاسم)، والنوافذ المفتوحة بس ظاهرة في الشريط السفلي.",
        "الشريط السفلي فيه: زرار «ابدأ» (قايمة بكل الأقسام)، زرار لكل نافذة مفتوحة (ضغطة تفتحها أو تصغّرها)، عدّاد «N نوافذ مفتوحة»، زرار «سطح المكتب» يصغّر كل النوافذ وضغطة تانية ترجّعها، وزرار ترتيب النوافذ.",
        "على الموبايل مفيش تغيير: الأقسام لسه تبويبات تحت."
      ],
      en: [
        "On desktop, the admin and site manager sections now live in a side rail (icon above the name), and only the open windows appear in the bottom bar.",
        "The bottom bar has: a Start button (menu with every section), one button per open window (click to focus or minimize), an \"N windows open\" counter, a Desktop button that minimizes every window (press again to bring them back), and the tile button.",
        "Phones are unchanged: the sections are still bottom tabs."
      ]
    },
    {
      version: "1.9.0", date: "2026-09-30",
      ar: [
        "في نافذة السكان، الأرقام الأربعة في الأعلى (السكان، العمال النشطين، الطلبات المعلقة، المدفوعات المتأخرة) بقت بتتضغط، وكل رقم بيفتح شاشة فيها قايمة النتايج.",
        "كل عنصر في القايمة بيتضغط: الضغط على اسم الساكن بيفتح ملفه (بياناته، شقته، مدفوعاته وطلبات الصيانة بتاعته) ومنه تقدر توقف الحساب أو توافق عليه.",
        "الطلب المعلق بيفتح تفاصيله (المكان، التصنيف، الوصف، الصورة، العامل) واسم الساكن فيه رابط لملفه، وزرار للانتقال لإدارة الطلب في الصيانة.",
        "الدفعة المتأخرة بتفتح تفاصيلها مع رابط للساكن وزرار «تحديد كمدفوع». العامل النشط بيفتح ملفه.",
        "زرار «رجوع» بيرجعك خطوة، وزرار ⌂ بيرجعك للرئيسية، والقوايم بتتحدّث لحظيًا لو فيه تغيير."
      ],
      en: [
        "In the Residents window the four counters at the top (Residents, Active workers, Pending requests, Overdue payments) are now clickable; each opens a screen listing the records behind the number.",
        "Every item in those lists is clickable too: tapping a resident opens their profile (details, apartment, payments and maintenance requests) with Suspend / Approve right there.",
        "A pending request opens its details (place, category, description, photo, worker); the resident's name links to their profile, and a button jumps to managing the request in Maintenance.",
        "An overdue payment opens its details with a link to the resident and a \"Mark as paid\" button. An active worker opens their profile.",
        "\"Back\" goes one step back, the \u2302 button returns to the overview, and the lists update live when data changes."
      ]
    },
    {
      version: "1.8.1", date: "2026-09-29",
      ar: [
        "زرار اللغة بقى جوه الشريط العلوي جنب زرار الخروج في كل الصفحات (ساكن، عامل، كول سنتر، أدمن، مدير موقع)، ومبقاش فوق الخروج."
      ],
      en: [
        "The language switch now sits inside the top bar next to the logout button on every page (resident, worker, call center, admin, site manager) instead of floating above it."
      ]
    },
    {
      version: "1.8.0", date: "2026-09-29",
      ar: [
        "لوحة الأدمن ولوحة مدير الموقع بقوا بشكل نوافذ زي ويندوز: كل قسم بيتفتح في نافذته الخاصة.",
        "تقدر تفتح لحد ٤ نوافذ مع بعض للاطلاع والإدخال، وتشوف قايمة وتكتب في نموذج في نفس الوقت.",
        "النوافذ بتترتب لوحدها جنب بعض، وتقدر تسحبها من العنوان وتكبّرها أو تصغّرها أو تقفلها.",
        "شريط المهام تحت فيه كل الأقسام، وزرار ⊞ بيرتب النوافذ من جديد. النوافذ المفتوحة بتتفتح تاني في الزيارة الجاية.",
        "على الموبايل النافذة بتملى الشاشة وشريط المهام بيشتغل كتبويبات."
      ],
      en: [
        "The admin panel and the site manager panel are now a Windows-style desktop: every section opens in its own window.",
        "Up to 4 windows can be open at the same time, for consultation and data entry side by side.",
        "Windows tile automatically; drag them by the title bar, resize, maximize, minimize or close them.",
        "A taskbar at the bottom lists every section, and the \u229E button re-tiles the windows. Open windows are restored on the next visit.",
        "On phones a window fills the screen and the taskbar works like tabs."
      ]
    },
    {
      version: "1.7.0", date: "2026-09-29",
      ar: [
        "طلبات الإجازة والسلف: زرار «تراجع» بيرجّع أي طلب اتقبل أو اتفض لحالة الانتظار، عند الأدمن وعند مدير الموقع.",
        "الاشتراكات في الخدمات: الأدمن يقدر يعيد فتح أي طلب مرفوض أو ملغي.",
        "إثباتات الدفع: الأدمن يقدر يعيد فتح الإثبات المرفوض للمراجعة من جديد.",
        "أكواد الدخول الرئيسية: زرار «إعادة تفعيل» للكود الملغي لو لسه ما انتهتش مدته.",
        "طلبات الصيانة: تقدر ترجّع الطلب اللي جاري تنفيذه للطابور، وفتح طلب مكتمل تاني بيمسح وقت الإنجاز القديم.",
        "مدير الموقع: قائمة جديدة لتغيير حالة طلبات الصيانة (جاري / مكتمل / رجوع للطابور) زي الأدمن.",
        "إصلاح: قواعد الأمان كانت ناقصة لاشتراكات الخدمات وإثباتات الدفع، وتمت إضافتها عشان الاشتراك ورفع الإيصال والمراجعة يشتغلوا."
      ],
      en: [
        "Leave and advance requests: an \"Undo\" button puts any approved or rejected request back to pending, for the admin and the site manager.",
        "Service subscriptions: the admin can reopen any rejected or cancelled request.",
        "Payment receipts: the admin can reopen a rejected receipt for review again.",
        "Master access codes: a \"Reactivate\" button for a revoked code that has not expired yet.",
        "Maintenance requests: a job in progress can be put back in the queue, and reopening a completed one clears the old completion time.",
        "Site manager: new status menu for maintenance requests (in progress / completed / back to queue), same as the admin.",
        "Fix: security rules were missing for service subscriptions and payment receipts; they were added so subscribing, uploading a receipt and reviewing them work."
      ]
    },
    {
      version: "1.6.0", date: "2026-09-28",
      ar: [
        "جولة تعريفية جديدة بتظهر مرة واحدة أول ما تفتح التطبيق بعد التحديث، وبتشرح كل وظائف التطبيق حسب دورك (ساكن، أدمن، مدير موقع، عامل، كول سنتر).",
        "تقدر تخرج من الجولة في أي وقت: زرار ✕ أو «تخطي الجولة» أو مفتاح Esc.",
        "زرار جديد «؟» في أعلى كل شاشة جنب تسجيل الخروج لإعادة الجولة في أي وقت.",
        "الجولة بتنوّر على التبويب أو الزرار اللي بتشرحه، وبتشتغل بالعربي والإنجليزي وتقدر تبدّل اللغة من جواها."
      ],
      en: [
        "New walkthrough shown once, the first time you open the app after this update, explaining every function for your role (resident, admin, site manager, worker, call center).",
        "You can leave the walkthrough at any time: the ✕ button, \"Skip tour\" or the Esc key.",
        "New \"?\" button at the top of every screen, next to Logout, to replay the walkthrough whenever you want.",
        "The walkthrough highlights the tab or button it is explaining, works in Arabic and English, and lets you switch the language from inside."
      ]
    },
    {
      version: "1.5.0", date: "2026-09-20",
      ar: [
        "قسم جديد «المباني» في لوحة الأدمن: تسجيل كل المباني وشققها، وكل شقة متخصصة للساكن بتاعها (حساب على التطبيق أو اسم وتليفون بس).",
        "إنشاء سريع: تكتب عدد المباني وإجمالي الشقق (مثلاً 30 مبنى و400 شقة) والتطبيق بيعمل الهيكل كله بترقيم تلقائي.",
        "ربط الشقة بحساب الساكن بيحدّث رقم الوحدة في ملف الساكن تلقائيًا، فالمدفوعات والكول سنتر والطلبات بتفضل شغالة زي ما هي.",
        "قسم جديد «الأماكن» في لوحة التشغيل: تسجيل الأماكن المشتركة (مدخل، سلالم، أسانسير، حديقة، حمام سباحة، جراج…) وتسليم كل مكان لعامل مسؤول عن نضافته وصيانته الدورية.",
        "من كل مكان تقدر تبعت مهمة دورية أو مهمة استثنائية لعامل، وبتدخل نفس طابور المهام اللي العمال شايفينه.",
        "تكليف مجموعة أماكن مرة واحدة: كل المداخل أو كل الأسانسيرات لعامل واحد بضغطة زرار.",
        "شاشة العامل: كارت جديد بالأماكن اللي هو مسؤول عنها والمهمة الدورية وكل قد إيه."
      ],
      en: [
        "New Property section in the admin panel: register every building and its apartments, each apartment assigned to the resident who lives there (either an app account, or just a name and phone).",
        "Quick setup: enter how many buildings and how many apartments in total (e.g. 30 buildings, 400 apartments) and the whole structure is created with automatic numbering.",
        "Linking an apartment to a resident account updates that resident's unit number automatically, so payments, the call center and maintenance requests keep working as before.",
        "New Areas section in the Operations dashboard: register the common areas (entrance, stairs, lift, garden, pool, garage…) and put each one in the hands of a worker for routine cleaning and upkeep.",
        "From each area you can send a routine job or an extraordinary one to a worker; it joins the same queue the workers already use.",
        "Bulk assignment: hand every entrance, or every lift, to the same worker in one click.",
        "Worker screen: a new card listing the areas they look after, the routine task and how often."
      ]
    },
    {
      version: "1.4.0", date: "2026-09-19",
      ar: [
        "لوحة الأدمن (التشغيل ← الطلبات): نظرة عامة بالأرقام (إجمالي الطلبات، في انتظار التوزيع، مسندة، جاري، منتهية) ورسم بياني يوضح كام طلب اتوزع على كل عامل وحالته.",
        "شاشة العامل: عدّادات للمهام (للتنفيذ / جاري / منتهية) وتفاصيل كل مهمة: لمين (اسم الساكن) وفين (الوحدة أو المكان) وإيه المطلوب. المهام المفتوحة فوق والمنتهية تحت.",
        "الطلبات الجديدة (من الساكن أو الكول سنتر) بتحفظ اسم الساكن، والطلبات القديمة بيتم استكمال الاسم فيها تلقائيًا لما الأدمن يفتح لوحة التشغيل.",
        "اسم الساكن ظاهر كمان في قائمة الطلبات عند الأدمن."
      ],
      en: [
        "Admin (Operations → Requests): an overview with counts (total, waiting for assignment, assigned, in progress, completed) and a chart showing how many requests each worker has been given and their status.",
        "Worker screen: job counters (to do / in progress / completed) and full detail for each job: who (resident name), where (unit or place) and what needs doing. Open jobs first, completed ones below.",
        "New requests (from residents or the call center) now store the resident's name; older requests get the name filled in automatically when the admin opens the panel.",
        "The resident's name is also shown in the admin's request list."
      ]
    },
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

  g.SO_OPEN_ARCHIVE = openArchive;

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
