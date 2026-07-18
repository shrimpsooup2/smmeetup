import { configured, auth, db } from "./firebase.js";

import { state } from "./store.js";

import {
  $, el, GRADES, SCHOOL_DOMAIN, expiryMs, isoDate,
  classOfFromGrade, gradeFromClassOf,
} from "./util.js";

import { initAuthUI, prepareSetupScreen } from "./auth-ui.js";
import { renderCalendar } from "./calendar.js";

import {
  renderSidebar, openCreate, openProfile, closeSidebar, openAvailability,
} from "./sidebar.js";

import { openFriends } from "./friends.js";
import { dayStatusSummary } from "./availability.js";

import {
  onAuthStateChanged, signOut, sendEmailVerification,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

import {
  doc, getDoc, getDocs, deleteDoc, updateDoc, collection, query, where, onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const SCREENS = ["config", "auth", "verify", "setup", "main"];
function showScreen(name) {
  for (const s of SCREENS) $(`#${s}-screen`).hidden = s !== name;
}

function showNotice(text) {
  const b = $("#notice-banner");
  b.textContent = text;
  b.hidden = !text;
}

/* ─── live activity subscriptions ─────────────────────────────────────── */
// Two live queries merge into state.activities:
//  - public activities for the displayed month
//  - every private activity I host / joined / am invited to

let unsubPublic = null;
let unsubPrivate = null;

export function subscribeMonth() {
  if (unsubPublic) unsubPublic();
  const y = state.monthCursor.getFullYear();
  const m = String(state.monthCursor.getMonth() + 1).padStart(2, "0");
  const q = query(
    collection(db, "activities"),
    where("visibility", "==", "public"),
    where("monthKeys", "array-contains", `${y}-${m}`),
  );
  unsubPublic = onSnapshot(q, snap => {
    state.publicActs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    mergeActivities();
  }, err => {
    console.error("activities:", err);
    if (err.code === "failed-precondition") {
      showNotice("One-time setup needed: Firestore wants an index for the calendar query. "
        + "Open the browser console (F12), click the long firebase link in the error, hit Create, wait a minute, then reload.");
    }
  });
}

function subscribePrivate() {
  if (unsubPrivate) unsubPrivate();
  const q = query(
    collection(db, "activities"),
    where("visibleTo", "array-contains", state.user.uid),
  );
  unsubPrivate = onSnapshot(q, snap => {
    state.privateActs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    mergeActivities();
  }, err => console.error("private activities:", err));
}

const sweptIds = new Set();

function mergeActivities() {
  const map = new Map();
  for (const a of [...state.publicActs, ...state.privateActs]) map.set(a.id, a);
  state.activities = [...map.values()];
  renderCalendar();
  if (state.sidebar.view === "activity") renderSidebar();

  // opportunistic cleanup of expired activities we can see
  const now = Date.now();
  for (const a of state.activities) {
    const exp = expiryMs(a);
    const canDelete = a.hostUid === state.user?.uid || a.expiresAt; // rules allow anyone once expiresAt passed
    if (exp && exp < now && canDelete && !sweptIds.has(a.id)) {
      sweptIds.add(a.id);
      deleteDoc(doc(db, "activities", a.id)).catch(() => {});
    }
  }
}

// On sign-in, clean up my own long-past activities even if they're not on screen.
async function sweepMyExpired() {
  try {
    const snap = await getDocs(query(
      collection(db, "activities"),
      where("hostUid", "==", state.user.uid),
    ));
    const now = Date.now();
    for (const d of snap.docs) {
      const exp = expiryMs(d.data());
      if (exp && exp < now) await deleteDoc(d.ref).catch(() => {});
    }
  } catch (err) {
    console.warn("expiry sweep:", err);
  }
}

/* ─── friends / requests subscriptions ────────────────────────────────── */

let unsubSocial = [];

function subscribeSocial() {
  stopSocial();
  const uid = state.user.uid;
  const refresh = () => {
    const badge = $("#friends-badge");
    const n = state.social.incoming.length;
    badge.hidden = n === 0;
    badge.textContent = n;
    if (state.sidebar.view === "friends" || state.sidebar.view === "person") renderSidebar();
  };
  unsubSocial = [
    onSnapshot(query(collection(db, "friendships"), where("users", "array-contains", uid)),
      snap => {
        state.social.friends = snap.docs.map(d => {
          const data = d.data();
          const other = data.users.find(u => u !== uid);
          return { id: d.id, uid: other, name: data.names?.[other] || "Student" };
        }).sort((a, b) => a.name.localeCompare(b.name));
        refresh();
      }, err => console.error("friendships:", err)),
    onSnapshot(query(collection(db, "friendRequests"), where("to", "==", uid)),
      snap => {
        state.social.incoming = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        refresh();
      }, err => console.error("requests in:", err)),
    onSnapshot(query(collection(db, "friendRequests"), where("from", "==", uid)),
      snap => {
        state.social.outgoing = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        refresh();
      }, err => console.error("requests out:", err)),
  ];
}

function stopSocial() {
  for (const u of unsubSocial) u();
  unsubSocial = [];
  state.social = { friends: [], incoming: [], outgoing: [] };
}

/* ─── month nav / profile editing ─────────────────────────────────────── */

function setMonth(d) {
  state.monthCursor = d;
  subscribeMonth();
  renderCalendar();
}

export function editProfile() {
  prepareSetupScreen(true);
  showScreen("setup");
}

function wireHeader() {
  const cur = () => state.monthCursor;
  $("#prev-month").addEventListener("click", () =>
    setMonth(new Date(cur().getFullYear(), cur().getMonth() - 1, 1)));
  $("#next-month").addEventListener("click", () =>
    setMonth(new Date(cur().getFullYear(), cur().getMonth() + 1, 1)));
  $("#today-btn").addEventListener("click", () => {
    const d = new Date(); d.setDate(1); setMonth(d);
  });

  $("#create-btn").addEventListener("click", () => openCreate());
  $("#avail-btn").addEventListener("click", () =>
    state.availMode ? closeSidebar() : openAvailability());
  $("#friends-btn").addEventListener("click", openFriends);
  $("#profile-btn").addEventListener("click", () => openProfile());
  $("#signout-btn").addEventListener("click", () => signOut(auth));

  const gf = $("#grade-filter");
  gf.append(el("span", { class: "hint" }, "Grades:"));
  for (const g of GRADES) {
    const cb = el("input", { type: "checkbox", checked: true });
    cb.addEventListener("change", () => {
      if (cb.checked) state.gradeFilter.add(g);
      else state.gradeFilter.delete(g);
      renderCalendar();
    });
    gf.append(el("label", { class: "check pill" }, cb, ` ${g}`));
  }
}

/* ─── "mark your availability" nudge ──────────────────────────────────── */
// Pulsing dot on the Availability button when the next 7 days are all
// unmarked — a gentle reminder to keep it up to date.

function updateAvailNudge() {
  const btn = $("#avail-btn");
  if (!btn) return;
  if (!state.profile) { btn.classList.remove("nudge"); return; }
  const t = new Date();
  let marked = false;
  for (let i = 0; i < 7 && !marked; i++) {
    const iso = isoDate(new Date(t.getFullYear(), t.getMonth(), t.getDate() + i));
    if (dayStatusSummary(state.profile, iso) !== "maybe") marked = true;
  }
  btn.classList.toggle("nudge", !marked);
  btn.title = marked
    ? "Mark when you're free or busy"
    : "Mark your availability for this week!";
}
document.addEventListener("avail-changed", updateAvailNudge);

/* ─── email verification screen ───────────────────────────────────────── */

function wireVerifyScreen() {
  $("#verify-resend").addEventListener("click", async () => {
    try {
      await sendEmailVerification(auth.currentUser);
      $("#verify-error").textContent = "Sent — check your inbox (and spam).";
      $("#verify-error").hidden = false;
    } catch (err) {
      $("#verify-error").textContent = err.message;
      $("#verify-error").hidden = false;
    }
  });
  $("#verify-continue").addEventListener("click", async () => {
    await auth.currentUser.reload();
    if (auth.currentUser.emailVerified) {
      await auth.currentUser.getIdToken(true); // refresh token so rules see email_verified
      onUser(auth.currentUser);
    } else {
      $("#verify-error").textContent = "Not verified yet — click the link in the email first.";
      $("#verify-error").hidden = false;
    }
  });
  $("#verify-signout").addEventListener("click", () => signOut(auth));
}

/* ─── auth flow ───────────────────────────────────────────────────────── */

function profileComplete(p) {
  const scheduleOk = Array.isArray(p?.schedule) && p.schedule.length === 8
    && p.schedule.every(day => Array.isArray(day.periods) && day.periods.length === 7);
  return p && p.displayName && p.grade &&
    Array.isArray(p.contacts) && p.contacts.length >= 2 &&
    p.contacts[0]?.value && p.contacts[1]?.value && scheduleOk;
}

let verifyPoll = null;
function stopVerifyPoll() {
  if (verifyPoll) { clearInterval(verifyPoll); verifyPoll = null; }
}

async function onUser(user) {
  stopVerifyPoll();
  state.user = user;
  if (!user) {
    state.profile = null;
    if (unsubPublic) { unsubPublic(); unsubPublic = null; }
    if (unsubPrivate) { unsubPrivate(); unsubPrivate = null; }
    stopSocial();
    state.publicActs = []; state.privateActs = []; state.activities = [];
    sweptIds.clear();
    closeSidebar();
    showScreen("auth");
    return;
  }

  // 1) must be a school account
  const email = (user.email || "").toLowerCase();
  if (!email.endsWith("@" + SCHOOL_DOMAIN)) {
    $("#verify-title").textContent = "School accounts only";
    $("#verify-msg").textContent =
      `SM Meetup is only for @${SCHOOL_DOMAIN} accounts. "${user.email}" can't be used — `
      + "sign out and create an account with your school email.";
    $("#verify-continue").hidden = true;
    $("#verify-resend").hidden = true;
    $("#verify-error").hidden = true;
    showScreen("verify");
    return;
  }

  // 2) must prove they own it
  if (!user.emailVerified) {
    $("#verify-title").textContent = "Verify your email";
    $("#verify-msg").textContent =
      `We sent a verification link to ${user.email}. Click it — `
      + "this page will notice on its own within a few seconds.";
    $("#verify-continue").hidden = false;
    $("#verify-resend").hidden = false;
    $("#verify-error").hidden = true;
    showScreen("verify");
    // auto-advance once verification lands
    verifyPoll = setInterval(async () => {
      try {
        await user.reload();
        if (user.emailVerified) {
          stopVerifyPoll();
          await user.getIdToken(true); // refresh token so rules see email_verified
          onUser(user);
        }
      } catch { /* offline or throttled — try again next tick */ }
    }, 4000);
    return;
  }

  // 3) must finish their profile (name, grade, 2 contacts)
  const snap = await getDoc(doc(db, "users", user.uid));
  state.profile = snap.exists() ? snap.data() : null;
  if (!profileComplete(state.profile)) {
    prepareSetupScreen(false);
    showScreen("setup");
    return;
  }
  await syncGrade();
  enterMain();
}

// Keep the stored grade in step with the school year (rolls over Aug 20).
async function syncGrade() {
  const p = state.profile;
  try {
    if (!p.classOf && p.grade) {
      // migrate old profiles created before classOf existed
      p.classOf = classOfFromGrade(p.grade);
      await updateDoc(doc(db, "users", state.user.uid), { classOf: p.classOf });
    } else if (p.classOf) {
      const g = gradeFromClassOf(p.classOf);
      if (g !== p.grade) {
        p.grade = g;
        // only persist real grades; "graduated" (13+) stays derived
        if (g >= 9 && g <= 12) {
          await updateDoc(doc(db, "users", state.user.uid), { grade: g });
        }
      }
    }
  } catch (err) {
    console.warn("grade sync:", err);
  }
}

function enterMain() {
  showScreen("main");
  $("#profile-btn").textContent = state.profile.displayName;
  subscribeMonth();
  subscribePrivate();
  subscribeSocial();
  sweepMyExpired();
  renderCalendar();
  renderSidebar();
  updateAvailNudge();
}

/* ─── boot ────────────────────────────────────────────────────────────── */

function main() {
  if (!configured) {
    showScreen("config");
    return;
  }
  initAuthUI({
    onProfileSaved: enterMain,
    onSetupCancel: enterMain, // Cancel only exists when editing an existing profile
  });
  wireHeader();
  wireVerifyScreen();
  onAuthStateChanged(auth, user => {
    onUser(user).catch(err => {
      console.error(err);
      alert("Something went wrong loading your account: " + err.message);
    });
  });
}

main();
