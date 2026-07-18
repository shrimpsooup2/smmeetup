import { auth, db } from "./firebase.js";
import { state } from "./store.js";
import { $, el, CONTACT_TYPES, cap, SCHOOL_DOMAIN, classOfFromGrade, currentGrade, generateRotatedSchedule, normalizeSchedule } from "./util.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  doc, setDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

let mode = "signin"; // or "signup"
let handlers = { onProfileSaved: () => {}, onSetupCancel: () => {} };
let scheduleEditorRoot = null;

const FRIENDLY = {
  "auth/invalid-credential": "Wrong email or password.",
  "auth/user-not-found": "No account with that email — create one below.",
  "auth/wrong-password": "Wrong email or password.",
  "auth/email-already-in-use": "There's already an account with that email — try signing in instead.",
  "auth/weak-password": "Password must be at least 6 characters.",
  "auth/invalid-email": "That doesn't look like a valid email.",
  "auth/too-many-requests": "Too many attempts — wait a minute, then try again.",
  "auth/network-request-failed": "Network problem — check your connection and try again.",
};

function showMsg(sel, err) {
  const box = $(sel);
  box.textContent = typeof err === "string" ? err : (FRIENDLY[err.code] || err.message);
  box.hidden = false;
}

function buildScheduleEditor(existingSchedule = []) {
  const root = el("div", { class: "schedule-editor" });
  const days = normalizeSchedule(existingSchedule, 8, 6);
  const inputDays = days.slice(0, 2);
  for (const day of inputDays) {
    const card = el("div", { class: "schedule-day-card" });
    card.append(
      el("div", { class: "schedule-day-head" },
        el("strong", {}, day.day),
        el("span", { class: "hint" }, "1–7")),
    );
    for (const period of day.periods) {
      const row = el("div", { class: "schedule-period-row" });
      const label = el("label", { class: "schedule-period-label" }, `P${period.period}`);
      const classInput = el("input", {
        type: "text", class: "schedule-period-input", maxlength: "40", placeholder: "Class",
      });
      const teacherInput = el("input", {
        type: "text", class: "schedule-period-input schedule-period-input-small", maxlength: "40", placeholder: "Teacher",
      });
      classInput.value = period.className || "";
      teacherInput.value = period.teacher || "";
      row.append(label, classInput, teacherInput);
      card.append(row);
    }
    root.append(card);
  }
  const preview = el("div", { class: "hint" }, "Enter Day 1 and Day 2, and we’ll fill in Days 3–8 from the rotation pattern.");
  root.append(preview);
  return root;
}

function collectScheduleData(root) {
  if (!root) return [];
  return generateRotatedSchedule(Array.from(root.querySelectorAll(".schedule-day-card")).map((card, dayIndex) => {
    const periods = Array.from(card.querySelectorAll(".schedule-period-row")).map((row, periodIndex) => {
      const inputs = row.querySelectorAll("input");
      return {
        period: periodIndex + 1,
        className: inputs[0]?.value.trim() || "",
        teacher: inputs[1]?.value.trim() || "",
      };
    });
      return { day: `Day ${dayIndex + 1}`, periods };
    }), 8, 6);
}

function renderScheduleEditor(existingSchedule) {
  const container = $("#setup-schedule-editor");
  if (!container) return null;
  scheduleEditorRoot = buildScheduleEditor(existingSchedule);
  container.replaceChildren(scheduleEditorRoot);
  return scheduleEditorRoot;
}

export function initAuthUI(h) {
  handlers = h;

  // Contact-type dropdowns
  for (const sel of [$("#setup-c1-type"), $("#setup-c2-type")]) {
    for (const t of CONTACT_TYPES) sel.append(new Option(cap(t), t));
  }
  $("#setup-c1-type").value = "phone";
  $("#setup-c2-type").value = "email";

  renderScheduleEditor([]);

  // Toggle sign in <-> create account
  $("#auth-switch").addEventListener("click", () => {
    mode = mode === "signin" ? "signup" : "signin";
    $("#auth-submit").textContent = mode === "signin" ? "Sign in" : "Create account";
    $("#auth-switch").textContent = mode === "signin"
      ? "New here? Create an account"
      : "Have an account? Sign in";
    $("#auth-password").autocomplete = mode === "signin" ? "current-password" : "new-password";
    $("#auth-error").hidden = true;
  });

  $("#auth-forgot").addEventListener("click", async () => {
    const email = $("#auth-email").value.trim();
    if (!email) return showMsg("#auth-error", "Type your email above first, then click Forgot password again.");
    try {
      await sendPasswordResetEmail(auth, email);
      showMsg("#auth-error", "Reset email sent — check your inbox (and spam).");
    } catch (err) { showMsg("#auth-error", err); }
  });

  $("#auth-form").addEventListener("submit", async e => {
    e.preventDefault();
    $("#auth-error").hidden = true;
    const email = $("#auth-email").value.trim();
    const password = $("#auth-password").value;
    if (!email) return showMsg("#auth-error", "Enter your email.");
    if (password.length < 6) return showMsg("#auth-error", "Password must be at least 6 characters.");
    if (mode === "signup" && !email.toLowerCase().endsWith("@" + SCHOOL_DOMAIN)) {
      return showMsg("#auth-error", `Use your @${SCHOOL_DOMAIN} school email — that's how we keep this school-only.`);
    }
    const btn = $("#auth-submit");
    btn.disabled = true;
    try {
      if (mode === "signup") {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        try { await sendEmailVerification(cred.user); } catch { /* resend button exists */ }
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
      // onAuthStateChanged in app.js takes over from here.
    } catch (err) {
      showMsg("#auth-error", err);
    } finally {
      btn.disabled = false;
    }
  });

  $("#setup-cancel").addEventListener("click", () => handlers.onSetupCancel());

  $("#setup-form").addEventListener("submit", async e => {
    e.preventDefault();
    $("#setup-error").hidden = true;
    const displayName = $("#setup-name").value.trim();
    const grade = Number($("#setup-grade").value);
    const c1 = { type: $("#setup-c1-type").value, value: $("#setup-c1-value").value.trim() };
    const c2 = { type: $("#setup-c2-type").value, value: $("#setup-c2-value").value.trim() };
    const schedule = collectScheduleData(scheduleEditorRoot);

    if (!displayName) return showMsg("#setup-error", "Enter a display name.");
    if (!grade) return showMsg("#setup-error", "Pick your grade.");
    if (!c1.value || !c2.value)
      return showMsg("#setup-error", "Fill in both contact methods — two ways people can actually reach you.");
    if (c1.type === c2.type && c1.value.toLowerCase() === c2.value.toLowerCase())
      return showMsg("#setup-error", "Your two contacts must be different from each other.");

    try {
      const data = {
        displayName,
        grade,
        classOf: classOfFromGrade(grade), // grade auto-bumps each school year
        contacts: [c1, c2],
        schedule,
        email: auth.currentUser.email,
        updatedAt: serverTimestamp(),
      };
      await setDoc(doc(db, "users", auth.currentUser.uid), data, { merge: true });
      state.profile = { ...(state.profile || {}), ...data };
      handlers.onProfileSaved();
    } catch (err) {
      showMsg("#setup-error", err);
    }
  });
}

// Prefill and label the setup screen. editing=true → "Edit your profile" + Cancel.
export function prepareSetupScreen(editing) {
  $("#setup-title").textContent = editing ? "Edit your profile" : "Set up your profile";
  $("#setup-cancel").hidden = !editing;
  $("#setup-error").hidden = true;
  const p = state.profile;
  $("#setup-name").value = p?.displayName || "";
  $("#setup-grade").value = (p && currentGrade(p) >= 9 && currentGrade(p) <= 12) ? currentGrade(p) : "";
  if (p?.contacts?.[0]) {
    $("#setup-c1-type").value = p.contacts[0].type;
    $("#setup-c1-value").value = p.contacts[0].value;
  }
  if (p?.contacts?.[1]) {
    $("#setup-c2-type").value = p.contacts[1].type;
    $("#setup-c2-value").value = p.contacts[1].value;
  }
  renderScheduleEditor(p?.schedule || []);
}
