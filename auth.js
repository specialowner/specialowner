import { auth, db } from "./firebase-config.js";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc, setDoc, getDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

let mode = "login"; // 'login' | 'register'

function t(key) {
  const lang = window.SO_I18N ? window.SO_I18N.getLang() : "en";
  return window.SO_I18N ? window.SO_I18N.translations[lang][key] : key;
}

const HOME_PAGE = { admin: "admin.html", worker: "worker.html", resident: "resident.html" };

const modeToggle = document.getElementById("modeToggle");
const accountTypeField = document.getElementById("accountTypeField");
const accountTypeSelect = document.getElementById("accountType");
const workerTypeField = document.getElementById("workerTypeField");
const nameField = document.getElementById("nameField");
const unitField = document.getElementById("unitField");
const submitBtn = document.getElementById("submitBtn");
const authForm = document.getElementById("authForm");
const authError = document.getElementById("authError");

function syncSubmitLabel() {
  submitBtn.textContent = mode === "register" ? t("createAccount") : t("login");
}
syncSubmitLabel();
window.addEventListener("so-lang-changed", syncSubmitLabel);

function syncAccountTypeFields() {
  const isRegister = mode === "register";
  const isWorker = isRegister && accountTypeSelect.value === "worker";
  accountTypeField.style.display = isRegister ? "block" : "none";
  unitField.style.display = isRegister && !isWorker ? "block" : "none";
  workerTypeField.style.display = isWorker ? "block" : "none";
}

modeToggle.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  mode = btn.dataset.mode;
  [...modeToggle.children].forEach(b => b.classList.toggle("active", b === btn));
  const isRegister = mode === "register";
  nameField.style.display = isRegister ? "block" : "none";
  syncAccountTypeFields();
  syncSubmitLabel();
});

accountTypeSelect.addEventListener("change", syncAccountTypeFields);

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  authError.style.display = "none";
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  try {
    submitBtn.disabled = true;
    if (mode === "register") {
      const fullName = document.getElementById("fullName").value.trim();
      const accountType = accountTypeSelect.value; // 'resident' | 'worker'

      if (accountType === "worker") {
        if (!fullName) throw { message: "Please fill in your name." };
        const workerType = document.getElementById("workerType").value;

        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await setDoc(doc(db, "users", cred.user.uid), {
          name: fullName,
          email,
          role: "worker",
          workerType,               // security | maintenance | cleaning | porter | garden
          accountStatus: "pending", // locked until admin approves
          createdAt: serverTimestamp()
        });
        window.location.href = "worker.html";
      } else {
        const unit = document.getElementById("unitNumber").value.trim();
        if (!fullName || !unit) throw { message: "Please fill in your name and unit number." };

        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await setDoc(doc(db, "users", cred.user.uid), {
          name: fullName,
          email,
          unit,
          role: "resident",
          accountStatus: "pending", // locked until admin approves (resident can request activation)
          points: 0,
          createdAt: serverTimestamp()
        });
        window.location.href = "resident.html";
      }
    } else {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const snap = await getDoc(doc(db, "users", cred.user.uid));
      const role = snap.exists() ? snap.data().role : "resident";
      window.location.href = HOME_PAGE[role] || "resident.html";
    }
  } catch (err) {
    authError.textContent = friendlyError(err);
    authError.style.display = "block";
  } finally {
    submitBtn.disabled = false;
  }
});

// If already logged in, skip straight to the right screen
onAuthStateChanged(auth, async (user) => {
  if (user && window.location.pathname.endsWith("index.html") === false) return;
  if (user) {
    const snap = await getDoc(doc(db, "users", user.uid));
    const role = snap.exists() ? snap.data().role : "resident";
    if (window.location.pathname === "/" || window.location.pathname.endsWith("index.html")) {
      window.location.href = HOME_PAGE[role] || "resident.html";
    }
  }
});

function friendlyError(err) {
  const code = err.code || "";
  if (code.includes("email-already-in-use")) return "This email is already registered.";
  if (code.includes("invalid-credential") || code.includes("wrong-password")) return "Incorrect email or password.";
  if (code.includes("user-not-found")) return "No account found with this email.";
  if (code.includes("weak-password")) return "Password should be at least 6 characters.";
  return err.message || "Something went wrong. Please try again.";
}
