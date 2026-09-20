# Special Owner — Update archive

Current version: **v1.5.0**

_Generated from `version.js` — do not edit by hand. Newest first; each entry lists what changed compared to the previous version._

## v1.5.0 — 2026-09-20

**English**
- New Property section in the admin panel: register every building and its apartments, each apartment assigned to the resident who lives there (either an app account, or just a name and phone).
- Quick setup: enter how many buildings and how many apartments in total (e.g. 30 buildings, 400 apartments) and the whole structure is created with automatic numbering.
- Linking an apartment to a resident account updates that resident's unit number automatically, so payments, the call center and maintenance requests keep working as before.
- New Areas section in the Operations dashboard: register the common areas (entrance, stairs, lift, garden, pool, garage…) and put each one in the hands of a worker for routine cleaning and upkeep.
- From each area you can send a routine job or an extraordinary one to a worker; it joins the same queue the workers already use.
- Bulk assignment: hand every entrance, or every lift, to the same worker in one click.
- Worker screen: a new card listing the areas they look after, the routine task and how often.

**العربية**
- قسم جديد «المباني» في لوحة الأدمن: تسجيل كل المباني وشققها، وكل شقة متخصصة للساكن بتاعها (حساب على التطبيق أو اسم وتليفون بس).
- إنشاء سريع: تكتب عدد المباني وإجمالي الشقق (مثلاً 30 مبنى و400 شقة) والتطبيق بيعمل الهيكل كله بترقيم تلقائي.
- ربط الشقة بحساب الساكن بيحدّث رقم الوحدة في ملف الساكن تلقائيًا، فالمدفوعات والكول سنتر والطلبات بتفضل شغالة زي ما هي.
- قسم جديد «الأماكن» في لوحة التشغيل: تسجيل الأماكن المشتركة (مدخل، سلالم، أسانسير، حديقة، حمام سباحة، جراج…) وتسليم كل مكان لعامل مسؤول عن نضافته وصيانته الدورية.
- من كل مكان تقدر تبعت مهمة دورية أو مهمة استثنائية لعامل، وبتدخل نفس طابور المهام اللي العمال شايفينه.
- تكليف مجموعة أماكن مرة واحدة: كل المداخل أو كل الأسانسيرات لعامل واحد بضغطة زرار.
- شاشة العامل: كارت جديد بالأماكن اللي هو مسؤول عنها والمهمة الدورية وكل قد إيه.

## v1.4.0 — 2026-09-19

**English**
- Admin (Operations → Requests): an overview with counts (total, waiting for assignment, assigned, in progress, completed) and a chart showing how many requests each worker has been given and their status.
- Worker screen: job counters (to do / in progress / completed) and full detail for each job: who (resident name), where (unit or place) and what needs doing. Open jobs first, completed ones below.
- New requests (from residents or the call center) now store the resident's name; older requests get the name filled in automatically when the admin opens the panel.
- The resident's name is also shown in the admin's request list.

**العربية**
- لوحة الأدمن (التشغيل ← الطلبات): نظرة عامة بالأرقام (إجمالي الطلبات، في انتظار التوزيع، مسندة، جاري، منتهية) ورسم بياني يوضح كام طلب اتوزع على كل عامل وحالته.
- شاشة العامل: عدّادات للمهام (للتنفيذ / جاري / منتهية) وتفاصيل كل مهمة: لمين (اسم الساكن) وفين (الوحدة أو المكان) وإيه المطلوب. المهام المفتوحة فوق والمنتهية تحت.
- الطلبات الجديدة (من الساكن أو الكول سنتر) بتحفظ اسم الساكن، والطلبات القديمة بيتم استكمال الاسم فيها تلقائيًا لما الأدمن يفتح لوحة التشغيل.
- اسم الساكن ظاهر كمان في قائمة الطلبات عند الأدمن.

## v1.3.0 — 2026-09-19

**English**
- The version number is now shown at the bottom of every screen; tapping it opens the update archive.
- Added an update archive (CHANGELOG.md) recording what each version changed compared to the previous one.
- Removed webcam capture on laptops/desktops: the Take photo / Record video buttons now appear on phones only; desktops keep "Upload from device".
- The app cache name now follows the version number, so every release refreshes automatically.

**العربية**
- رقم الإصدار بقى ظاهر أسفل كل شاشة في التطبيق، والضغط عليه يفتح أرشيف التحديثات.
- أرشيف تحديثات (CHANGELOG.md) بيسجل اللي عملته كل نسخة مقارنة بالنسخة اللي قبلها.
- إزالة التصوير بكاميرا اللابتوب/الكمبيوتر: زرّا تصوير الصورة والفيديو بيظهروا على الموبايل فقط، وعلى الكمبيوتر يفضل «رفع من الجهاز».
- كاش التطبيق بقى مربوط برقم الإصدار، فكل تحديث بيوصل تلقائيًا.

## v1.2.0 — 2026-09-19

**English**
- Fix: the language switch covered the logout button on phones. It now sits in its own row above the header and no longer stays fixed on screen.
- Added webcam capture on desktops in a built-in capture window (removed again in 1.3.0).

**العربية**
- إصلاح: مفتاح اللغة كان بيغطي على زر تسجيل الخروج في الموبايل. بقى في صف لوحده فوق الهيدر ومش ثابت على الشاشة.
- إضافة التصوير بكاميرا الكمبيوتر داخل نافذة خاصة بالموقع (تم إلغاؤها في 1.3.0).

## v1.1.1 — 2026-09-19

**English**
- Fix: the whole site stopped responding when the media module was missing or admin.html was outdated. Now only the media feature is unavailable and everything else keeps working.
- Fix: announcement-media.js no longer depends on firebase-config.js exporting `storage`.

**العربية**
- إصلاح: الموقع كله كان بيقف ومفيش زرار بيستجيب لو ملف الوسائط ناقص أو admin.html قديم. دلوقتي بيشتغل الباقي وتقف ميزة الوسائط بس.
- إصلاح: announcement-media.js بقى ما يعتمدش على إن firebase-config.js يصدّر storage.

## v1.1.0 — 2026-09-19

**English**
- The admin can upload or capture a photo or video (up to 50 MB) with an announcement.
- The announcement is published to residents only after the file has fully uploaded, with a progress bar.
- Residents and staff see the photo/video under the announcement text.
- Photos are automatically resized and compressed before upload.
- New Firebase Storage rules (uploads restricted to the admin).
- The service worker no longer caches video files.

**العربية**
- الأدمن يقدر يرفع أو يصوّر صورة أو فيديو (حتى 50 ميجا) مع الإعلان.
- الإعلان مبيتنشر للسكان غير بعد ما الملف يخلص رفع، مع شريط تقدم.
- السكان والعمال بيشوفوا الصورة أو الفيديو تحت نص الإعلان.
- الصور بتتصغّر وتتضغط تلقائيًا قبل الرفع.
- قواعد Firebase Storage جديدة (الرفع للأدمن فقط).
- الخدمة الخلفية (service worker) ما بتخزّنش ملفات الفيديو.

## v1.0.0 — 2026-09-18

**English**
- Base version of the app: resident app, admin dashboard, workers, site manager and call center.

**العربية**
- النسخة الأساسية للتطبيق: تطبيق السكان، لوحة الأدمن، العمال، مدير الموقع، والكول سنتر.
