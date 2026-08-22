// ==========================================================
// Special Owner — simple i18n (English / Arabic) + RTL switching
// Usage: elements needing translation get a data-i18n="key" attribute
// (or data-i18n-placeholder="key" for input placeholders).
// The current language is saved in localStorage under "so_lang".
// ==========================================================

const translations = {
  en: {
    appName: "Special Owner",
    tagline: "Your residential compound, in one app",
    login: "Log in",
    signup: "Sign up",
    fullName: "Full name",
    fullNamePh: "e.g. Ahmed Salama",
    unitNumber: "Unit / Villa number",
    unitNumberPh: "e.g. B-204",
    email: "Email",
    emailPh: "you@example.com",
    password: "Password",
    passwordPh: "••••••••",
    createAccount: "Create account",
    agreePrefix: "By continuing you agree to the",
    privacyPolicy: "Privacy Policy",

    hiThere: "Hi",
    unitLabel: "Unit",
    pointsBalance: "Points balance",
    outstandingDue: "Outstanding due",
    paymentStatus: "Payment status",
    noPayments: "No payment records yet.",
    announcements: "Announcements",
    noAnnouncements: "No announcements yet.",

    tabHome: "Home",
    tabInvites: "Invites",
    tabMaint: "Maintenance",
    tabShops: "Shops",

    newInvitation: "New invitation",
    guestName: "Guest name",
    guestNamePh: "e.g. Mona Youssef",
    guestPhone: "Guest phone (optional)",
    guestPhonePh: "01xxxxxxxxx",
    visitDate: "Visit date",
    generateQr: "Generate QR invitation",
    shareQr: "Share this QR with your guest",
    myInvitations: "My invitations",
    noInvitations: "No invitations yet.",

    newMaintRequest: "New maintenance request",
    category: "Category",
    describeIssue: "Describe the issue",
    describeIssuePh: "What's going on?",
    submitRequest: "Submit request",
    myRequests: "My requests",
    noRequests: "No requests yet.",

    yourPointsBalance: "Your points balance",
    noShops: "No partner shops yet.",

    // Admin
    adminTitle: "Admin",
    adminSub: "Special Owner · Compound control",
    residents: "Residents",
    activeWorkers: "Active workers",
    pendingRequests: "Pending requests",
    overduePayments: "Overdue payments",
    postAnnouncement: "Post an announcement",
    title: "Title",
    titlePh: "e.g. Water maintenance Friday",
    details: "Details",
    detailsPh: "Details for residents",
    publish: "Publish",

    tabOverview: "Overview",
    tabAccess: "Access",
    tabWorkers: "Workers",
    tabFinance: "Finance",
    tabMaintShort: "Maint.",

    scanQr: "Scan guest / worker QR",
    cameraLoading: "Loading camera…",
    cameraUnavailable: "Camera unavailable — check browser permissions, or open this page on a phone/tablet with a camera.",
    recentAccessLog: "Recent access log",
    noEntries: "No entries yet.",

    addWorker: "Add worker",
    workerName: "Name",
    workerNamePh: "Worker full name",
    workerRole: "Role",
    workerRolePh: "e.g. Electrician",
    workerPhone: "Phone",
    workerPhonePh: "01xxxxxxxxx",
    workers: "Workers",
    noWorkers: "No workers added yet.",

    addPaymentRecord: "Add payment record",
    residentUnit: "Resident unit",
    residentEmail: "Resident email",
    residentEmailPh: "resident's account email",
    amount: "Amount (EGP)",
    dueDate: "Due date",
    description: "Description",
    descriptionPh: "e.g. Monthly maintenance fee",
    addRecord: "Add record",
    allPayments: "All payments",
    noPaymentRecords: "No payment records yet.",

    maintenanceRequests: "Maintenance requests"
  },
  ar: {
    appName: "Special Owner",
    tagline: "كمباوندك في تطبيق واحد",
    login: "تسجيل الدخول",
    signup: "إنشاء حساب",
    fullName: "الاسم بالكامل",
    fullNamePh: "مثال: أحمد سلامة",
    unitNumber: "رقم الوحدة / الفيلا",
    unitNumberPh: "مثال: B-204",
    email: "البريد الإلكتروني",
    emailPh: "you@example.com",
    password: "كلمة المرور",
    passwordPh: "••••••••",
    createAccount: "إنشاء الحساب",
    agreePrefix: "بالمتابعة أنت توافق على",
    privacyPolicy: "سياسة الخصوصية",

    hiThere: "أهلاً",
    unitLabel: "الوحدة",
    pointsBalance: "رصيد النقاط",
    outstandingDue: "المبلغ المستحق",
    paymentStatus: "حالة المدفوعات",
    noPayments: "لا توجد سجلات مدفوعات بعد.",
    announcements: "الإعلانات",
    noAnnouncements: "لا توجد إعلانات بعد.",

    tabHome: "الرئيسية",
    tabInvites: "الدعوات",
    tabMaint: "الصيانة",
    tabShops: "المتاجر",

    newInvitation: "دعوة جديدة",
    guestName: "اسم الضيف",
    guestNamePh: "مثال: منى يوسف",
    guestPhone: "رقم هاتف الضيف (اختياري)",
    guestPhonePh: "01xxxxxxxxx",
    visitDate: "تاريخ الزيارة",
    generateQr: "توليد رمز QR للدعوة",
    shareQr: "شارك رمز QR ده مع ضيفك",
    myInvitations: "دعواتي",
    noInvitations: "لا توجد دعوات بعد.",

    newMaintRequest: "طلب صيانة جديد",
    category: "النوع",
    describeIssue: "اوصف المشكلة",
    describeIssuePh: "إيه اللي حصل؟",
    submitRequest: "إرسال الطلب",
    myRequests: "طلباتي",
    noRequests: "لا توجد طلبات بعد.",

    yourPointsBalance: "رصيد نقاطك",
    noShops: "لا توجد متاجر شريكة بعد.",

    // Admin
    adminTitle: "الأدمن",
    adminSub: "Special Owner · إدارة الكمباوند",
    residents: "السكان",
    activeWorkers: "العمال النشطين",
    pendingRequests: "الطلبات المعلقة",
    overduePayments: "المدفوعات المتأخرة",
    postAnnouncement: "نشر إعلان",
    title: "العنوان",
    titlePh: "مثال: صيانة المياه يوم الجمعة",
    details: "التفاصيل",
    detailsPh: "تفاصيل للسكان",
    publish: "نشر",

    tabOverview: "نظرة عامة",
    tabAccess: "الدخول",
    tabWorkers: "العمال",
    tabFinance: "المالية",
    tabMaintShort: "الصيانة",

    scanQr: "مسح رمز QR للضيف / العامل",
    cameraLoading: "جاري تحميل الكاميرا…",
    cameraUnavailable: "الكاميرا مش متاحة — تأكد من إذن الوصول للكاميرا، أو افتح الصفحة دي من موبايل/تابلت فيه كاميرا.",
    recentAccessLog: "سجل الدخول الأخير",
    noEntries: "لا توجد سجلات بعد.",

    addWorker: "إضافة عامل",
    workerName: "الاسم",
    workerNamePh: "اسم العامل بالكامل",
    workerRole: "الوظيفة",
    workerRolePh: "مثال: كهربائي",
    workerPhone: "الهاتف",
    workerPhonePh: "01xxxxxxxxx",
    workers: "العمال",
    noWorkers: "لم تتم إضافة عمال بعد.",

    addPaymentRecord: "إضافة سجل دفع",
    residentUnit: "وحدة الساكن",
    residentEmail: "بريد الساكن الإلكتروني",
    residentEmailPh: "البريد الإلكتروني لحساب الساكن",
    amount: "المبلغ (جنيه)",
    dueDate: "تاريخ الاستحقاق",
    description: "الوصف",
    descriptionPh: "مثال: رسوم الصيانة الشهرية",
    addRecord: "إضافة السجل",
    allPayments: "كل المدفوعات",
    noPaymentRecords: "لا توجد سجلات مدفوعات بعد.",

    maintenanceRequests: "طلبات الصيانة"
  }
};

function getLang() {
  return localStorage.getItem("so_lang") || "ar";
}

function applyLang(lang) {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    if (translations[lang][key]) el.textContent = translations[lang][key];
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (translations[lang][key]) el.placeholder = translations[lang][key];
  });
  document.querySelectorAll(".lang-toggle button").forEach(b => {
    b.classList.toggle("active", b.dataset.lang === lang);
  });
  localStorage.setItem("so_lang", lang);
  window.dispatchEvent(new CustomEvent("so-lang-changed", { detail: { lang } }));
}

function initLangToggle() {
  document.querySelectorAll(".lang-toggle").forEach(toggle => {
    toggle.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      applyLang(btn.dataset.lang);
    });
  });
  applyLang(getLang());
}

window.SO_I18N = { translations, getLang, applyLang, initLangToggle };
document.addEventListener("DOMContentLoaded", initLangToggle);
