import { db } from "./firebase.js";
import { state } from "./store.js";
import {
  el, fmtDateHuman, fmtHour, fmtTime, timeRange, gradesLabel, GRADES, monthKeyOf, cap,
  todayIso, dateFromIso, currentGrade, gradeLabel,
} from "./util.js";
import { renderCalendar } from "./calendar.js";
import { subscribeMonth, editProfile } from "./app.js";
import {
  hourBreakdown, resolveStatus, cycleDay, cycleHour, HOURS,
  flushPendingSave, openAvailabilityEditor,
} from "./availability.js";
import { friendsView, friendActionEl, openFriends } from "./friends.js";
import {
  doc, getDoc, addDoc, updateDoc, deleteDoc, collection,
  serverTimestamp, arrayUnion, arrayRemove, deleteField,
  onSnapshot, query, orderBy, limit,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

let unsubMessages = null;

/* ─── opening the different sidebar views ─────────────────────────────── */

// Leaving availability-marking mode: save any pending edits, clear the tints.
export function leaveAvailMode() {
  if (state.availMode) {
    state.availMode = false;
    flushPendingSave();
    renderCalendar();
  }
}

export function openActivity(id) {
  if (state.selectedActivityId !== id) subscribeMessages(id);
  leaveAvailMode();
  state.selectedActivityId = id;
  state.sidebar = { view: "activity" };
  state.heat = null;
  renderSidebar();
  renderCalendar();
}

export function openCreate(prefillDate) {
  stopMessages();
  leaveAvailMode();
  state.selectedActivityId = null;
  state.heat = null;
  state.sidebar = { view: "create", prefillDate: prefillDate || null };
  renderSidebar();
  renderCalendar();
}

export function openProfile() {
  stopMessages();
  leaveAvailMode();
  state.selectedActivityId = null;
  state.heat = null;
  state.sidebar = { view: "profile" };
  renderSidebar();
  renderCalendar();
}

export function openPerson(uid, backTo) {
  // backTo: an activity id, "@friends", or null
  state.sidebar = { view: "person", uid, backTo: backTo || null };
  renderSidebar();
}

export function closeSidebar() {
  stopMessages();
  leaveAvailMode();
  state.selectedActivityId = null;
  state.heat = null;
  state.sidebar = { view: "empty" };
  renderSidebar();
  renderCalendar();
}

/* ─── availability-marking mode ───────────────────────────────────────── */

export function openAvailability() {
  stopMessages();
  state.selectedActivityId = null;
  state.heat = null;
  state.availMode = true;
  state.availFocusDay = todayIso();
  state.sidebar = { view: "availability" };
  renderSidebar();
  renderCalendar();
}

// A day was clicked on the calendar while marking availability.
export function availDayClick(iso) {
  cycleDay(iso);
  state.availFocusDay = iso;
  renderSidebar();
  renderCalendar();
}

// Everything happening on one day (opened from a crowded day's "+N more").
export function openDay(iso) {
  stopMessages();
  leaveAvailMode();
  state.selectedActivityId = null;
  state.heat = null;
  state.sidebar = { view: "day", iso };
  renderSidebar();
  renderCalendar();
}

/* ─── live chat subscription ──────────────────────────────────────────── */

function stopMessages() {
  if (unsubMessages) { unsubMessages(); unsubMessages = null; }
  state.messages = [];
}

function subscribeMessages(activityId) {
  stopMessages();
  unsubMessages = onSnapshot(
    query(
      collection(db, "activities", activityId, "messages"),
      orderBy("createdAt", "asc"),
      limit(200),
    ),
    snap => {
      state.messages = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderMessages();
    },
    err => console.error("messages:", err),
  );
}

/* ─── main render ─────────────────────────────────────────────────────── */

export function renderSidebar() {
  const root = document.getElementById("sidebar");
  if (!root) return;
  // Keep whatever the user was typing in the chat box across live re-renders
  const draft = root.querySelector("#chat-input")?.value;
  root.replaceChildren();

  const v = state.sidebar.view;
  if (v === "empty") {
    root.append(el("div", { class: "side-empty" },
      el("p", {}, "Click an activity on the calendar to see its details."),
      el("p", {}, "Or click an empty day (or “+ Create activity”) to host your own."),
    ));
  } else if (v === "activity") {
    const a = state.activities.find(x => x.id === state.selectedActivityId);
    if (!a) {
      root.append(el("div", { class: "side-empty" }, el("p", {}, "Loading activity…")));
    } else {
      root.append(activityView(a));
      if (draft != null) {
        const inp = root.querySelector("#chat-input");
        if (inp) inp.value = draft;
      }
      renderMessages();
    }
  } else if (v === "create") {
    root.append(createView(state.sidebar.prefillDate));
  } else if (v === "profile") {
    root.append(profileView());
  } else if (v === "person") {
    root.append(personView(state.sidebar.uid, state.sidebar.backTo));
  } else if (v === "friends") {
    root.append(friendsView());
  } else if (v === "availability") {
    root.append(availabilityView());
  } else if (v === "day") {
    root.append(dayView(state.sidebar.iso));
  }
}

/* ─── one day's full activity list ────────────────────────────────────── */

function dayView(iso) {
  const box = el("div", { class: "side-panel" });
  box.append(el("div", { class: "side-head" },
    el("h2", {}, fmtDateHuman(iso)),
    el("button", { class: "btn icon", title: "Close", onclick: closeSidebar }, "×"),
  ));
  const acts = state.activities
    .filter(a =>
      (a.dates || []).includes(iso) &&
      (a.visibility === "private" ||
        (a.grades || []).some(g => state.gradeFilter.has(g))))
    .sort((a, b) => (a.timeStart || "99:99").localeCompare(b.timeStart || "99:99"));

  if (acts.length === 0) {
    box.append(el("p", { class: "hint" }, "Nothing on this day (with your current grade filters)."));
  }
  const list = el("div", { class: "day-list" });
  for (const a of acts) {
    list.append(el("button", {
      class: "day-row" + (a.visibility === "private" ? " private" : ""),
      onclick: () => openActivity(a.id),
    },
      el("span", { class: "day-row-time" }, a.timeStart ? fmtTime(a.timeStart) : "—"),
      el("span", { class: "day-row-main" },
        el("b", {}, (a.visibility === "private" ? "🔒 " : "") + a.name),
        el("span", { class: "day-row-sub" },
          [a.location, "host: " + a.hostName].filter(Boolean).join("  ·  "))),
    ));
  }
  box.append(list);
  box.append(el("div", { class: "btn-row" },
    el("button", { class: "btn", onclick: () => openCreate(iso) }, "+ Create on this day")));
  return box;
}

/* ─── availability sidebar panel ──────────────────────────────────────── */

function availabilityView() {
  const iso = state.availFocusDay || todayIso();
  const box = el("div", { class: "side-panel" });
  box.append(el("div", { class: "side-head" },
    el("h2", {}, "Your availability"),
    el("button", { class: "btn icon", title: "Done", onclick: closeSidebar }, "×"),
  ));
  box.append(el("p", { class: "hint" },
    "Click any day on the calendar to cycle it: ",
    el("b", {}, "free"), " → ", el("b", {}, "busy"), " → back to default. ",
    "Unmarked time counts as “maybe”. Friends see this when planning private meetups with you."));
  box.append(el("div", { class: "avail-legend hint" },
    el("span", { class: "avail-cell st-free demo" }), " free   ",
    el("span", { class: "avail-cell st-busy demo" }), " busy   ",
    el("span", { class: "avail-cell st-mixed demo" }), " partly   ",
    el("span", { class: "avail-cell st-maybe demo" }), " maybe",
  ));
  box.append(el("p", { id: "avail-save", class: "hint" }, "Changes save automatically."));

  // hour fine-tune for the day last clicked
  const sec = el("section", {}, el("h3", {}, "Fine-tune " + fmtDateHuman(iso)));
  sec.append(el("p", { class: "hint" }, "Click an hour to cycle just that hour."));
  const list = el("div", { class: "hour-list" });
  const redraw = () => {
    list.replaceChildren();
    for (const h of HOURS) {
      const st = resolveStatus(state.profile, iso, h);
      const overridden = !!state.profile.dates?.[iso]?.[String(h)];
      list.append(el("button", {
        class: `hour-row st-${st}${overridden ? "" : " inherit"}`,
        onclick: () => { cycleHour(iso, h); redraw(); renderCalendar(); },
      },
        el("span", {}, fmtHour(h)),
        el("span", { class: "hour-status" }, st === "free" ? "Free" : st === "busy" ? "Busy" : "Maybe"),
      ));
    }
  };
  redraw();
  sec.append(list);
  box.append(sec);

  box.append(el("section", {},
    el("h3", {}, "Repeats every week"),
    el("p", { class: "hint" }, "Practice, work, clubs — set it once and it applies to every week. Day clicks above override it for single days."),
    el("button", { class: "btn", onclick: openAvailabilityEditor }, "Edit weekly schedule"),
  ));

  box.append(el("div", { class: "btn-row" },
    el("button", { class: "btn primary", onclick: closeSidebar }, "Done")));
  return box;
}

/* ─── activity details ────────────────────────────────────────────────── */

function activityView(a) {
  const uid = state.user.uid;
  const isPrivate = a.visibility === "private";
  const participants = a.participants || [];
  const isHost = a.hostUid === uid;
  const isParticipant = participants.includes(uid);
  const isPending = (a.pending || []).includes(uid);
  const isInvited = (a.invited || []).includes(uid);
  const eligible = isPrivate
    ? (isHost || isParticipant || isInvited)
    : (a.grades || []).includes(currentGrade(state.profile));
  const full = a.maxParticipants ? participants.length >= a.maxParticipants : false;
  const canChat = isHost || (a.allowChat && isParticipant);
  const lastDate = (a.dates || []).slice(-1)[0] || "";
  const ended = lastDate < todayIso();

  const box = el("div", { class: "side-panel" });

  box.append(el("div", { class: "side-head" },
    el("h2", {}, (isPrivate ? "🔒 " : "") + a.name),
    el("button", { class: "btn icon", title: "Close", onclick: closeSidebar }, "×"),
  ));

  if (ended) {
    box.append(el("div", { class: "ended-banner" },
      "This activity has ended. It disappears for everyone ~2 months after its last day"
      + (isHost ? ", or you can delete it now with the button below." : ".")));
  }

  const meta = el("div", { class: "meta" },
    metaRow("Host", el("button", { class: "linklike", onclick: () => openPerson(a.hostUid, a.id) }, a.hostName)),
    metaRow((a.dates || []).length > 1 ? "Dates" : "Date", (a.dates || []).map(fmtDateHuman).join("  ·  ")),
    metaRow("Time", timeRange(a)),
    metaRow("Location", a.location || "TBD"),
    isPrivate
      ? metaRow("Type", "Private — invite only")
      : metaRow("Open to", gradesLabel(a.grades) + " grade" + ((a.grades || []).length > 1 ? "s" : "")),
    isPrivate ? null : metaRow("Joining", a.openJoin ? "Open — join instantly" : "Host approves requests"),
  );
  if (a.requirements) meta.append(metaRow("Requirements", a.requirements));
  box.append(meta);

  if (a.description) box.append(el("p", { class: "desc" }, a.description));

  if (!ended) box.append(joinBlock(a, { isHost, isParticipant, isPending, isInvited, eligible, full, isPrivate }));
  box.append(peopleSection(a, isHost, isPrivate));
  if (isHost) box.append(hostPanel(a, isPrivate));
  box.append(chatSection(a, canChat, isParticipant));
  return box;
}

function metaRow(label, value) {
  return el("div", { class: "meta-row" },
    el("span", { class: "meta-label" }, label),
    el("span", { class: "meta-value" }, value),
  );
}

function joinBlock(a, { isHost, isParticipant, isPending, isInvited, eligible, full, isPrivate }) {
  const wrap = el("div", { class: "join-block" });
  if (isHost) {
    wrap.append(el("p", { class: "hint" }, "You're hosting this activity."));
  } else if (isParticipant) {
    wrap.append(
      el("p", { class: "ok" }, "You're in ✔"),
      el("button", { class: "btn danger", onclick: () => act(() => leaveActivity(a)) }, "Leave activity"),
    );
  } else if (isInvited) {
    wrap.append(
      el("p", { class: "ok" }, `${a.hostName} invited you!`),
      el("div", { class: "btn-row" },
        el("button", { class: "btn primary", onclick: () => act(() => acceptInvite(a)) }, "Join"),
        el("button", { class: "btn", onclick: () => act(() => declineInvite(a)) }, "Decline"),
      ),
    );
  } else if (isPending) {
    wrap.append(
      el("p", { class: "hint" }, "Request sent — waiting for the host to approve."),
      el("button", { class: "btn", onclick: () => act(() => cancelRequest(a)) }, "Cancel request"),
    );
  } else if (isPrivate) {
    wrap.append(el("p", { class: "hint" }, "Private activity — the host adds people."));
  } else if (!eligible) {
    wrap.append(el("p", { class: "hint" },
      `This activity is only open to ${gradesLabel(a.grades)} graders, so you can't join it.`));
  } else if (full) {
    wrap.append(el("p", { class: "hint" }, "This activity is full."));
  } else if (a.openJoin) {
    wrap.append(el("button", { class: "btn primary", onclick: () => act(() => joinActivity(a)) }, "Join activity"));
  } else {
    wrap.append(el("button", { class: "btn primary", onclick: () => act(() => requestJoin(a)) }, "Request to join"));
  }
  return wrap;
}

function peopleSection(a, isHost, isPrivate) {
  const participants = a.participants || [];
  const countLabel = a.maxParticipants
    ? `${participants.length} / ${a.maxParticipants} joined`
    : `${participants.length} joined`;

  const list = el("div", { class: "people" });
  list.append(el("div", { class: "person-row" },
    el("button", { class: "linklike", onclick: () => openPerson(a.hostUid, a.id) }, a.hostName),
    el("span", { class: "badge" }, "HOST"),
  ));
  for (const uid of participants) {
    const row = el("div", { class: "person-row" },
      el("button", { class: "linklike", onclick: () => openPerson(uid, a.id) },
        a.participantNames?.[uid] || "Student"),
    );
    if (isHost) {
      row.append(el("button", {
        class: "linklike danger", title: "Remove from activity",
        onclick: () => act(() => removePerson(a, uid)),
      }, "remove"));
    }
    list.append(row);
  }
  // invited-but-not-joined (private activities)
  if (isPrivate) {
    for (const uid of a.invited || []) {
      list.append(el("div", { class: "person-row" },
        el("button", { class: "linklike", onclick: () => openPerson(uid, a.id) },
          a.invitedNames?.[uid] || "Student"),
        el("span", { class: "hint" }, "invited"),
        isHost ? el("button", {
          class: "linklike danger", title: "Take back invite",
          onclick: () => act(() => uninvite(a, uid)),
        }, "uninvite") : null,
      ));
    }
  }
  return el("section", {}, el("h3", {}, `Participants · ${countLabel}`), list);
}

function hostPanel(a, isPrivate) {
  const sec = el("section", { class: "host-panel" }, el("h3", {}, "Host tools"));

  if (!isPrivate && !a.openJoin) {
    const pending = a.pending || [];
    if (pending.length === 0) {
      sec.append(el("p", { class: "hint" }, "No join requests right now."));
    }
    for (const uid of pending) {
      sec.append(el("div", { class: "request-row" },
        el("button", { class: "linklike", onclick: () => openPerson(uid, a.id) },
          a.pendingNames?.[uid] || "Student"),
        el("button", { class: "btn small primary", onclick: () => act(() => approve(a, uid)) }, "Approve"),
        el("button", { class: "btn small", onclick: () => act(() => decline(a, uid)) }, "Decline"),
      ));
    }
  }

  // invite more friends to a private activity
  if (isPrivate) {
    const involved = new Set([a.hostUid, ...(a.participants || []), ...(a.invited || [])]);
    const candidates = state.social.friends.filter(f => !involved.has(f.uid));
    if (candidates.length > 0) {
      const inv = el("div", { class: "people" });
      for (const f of candidates) {
        inv.append(el("div", { class: "person-row" },
          el("span", {}, f.name),
          el("button", { class: "btn small", onclick: () => act(() => invite(a, f.uid, f.name)) }, "Invite"),
        ));
      }
      sec.append(el("p", { class: "hint" }, "Invite more friends:"), inv);
    }
  }

  sec.append(el("button", {
    class: "btn danger",
    onclick: () => {
      if (confirm(`Delete "${a.name}"? This can't be undone.`)) {
        act(async () => { await deleteDoc(aref(a.id)); closeSidebar(); });
      }
    },
  }, "Delete activity"));
  return sec;
}

/* ─── chat / host updates ─────────────────────────────────────────────── */

function chatSection(a, canChat, isParticipant) {
  const sec = el("section", { class: "chat" },
    el("h3", {}, a.allowChat ? "Updates & chat" : "Host updates"),
    el("div", { id: "chat-log", class: "chat-log" }),
  );

  if (canChat) {
    const input = el("input", {
      id: "chat-input", maxlength: "500", autocomplete: "off",
      placeholder: a.allowChat ? "Message the group…" : "Post an update…",
    });
    sec.append(el("form", {
      class: "chat-input-row",
      onsubmit: e => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        input.value = "";
        act(() => addDoc(collection(db, "activities", a.id, "messages"), {
          uid: state.user.uid,
          name: state.profile.displayName,
          text,
          createdAt: serverTimestamp(),
        }));
      },
    }, input, el("button", { class: "btn primary small", type: "submit" }, "Send")));
  } else if (isParticipant) {
    sec.append(el("p", { class: "hint" }, "The host turned off participant chat — only they can post here."));
  } else {
    sec.append(el("p", { class: "hint" },
      a.allowChat ? "Join the activity to chat with the group." : "Only the host posts updates here."));
  }
  return sec;
}

export function renderMessages() {
  const log = document.getElementById("chat-log");
  if (!log) return;
  const a = state.activities.find(x => x.id === state.selectedActivityId);
  log.replaceChildren();

  if (state.messages.length === 0) {
    log.append(el("p", { class: "hint" }, "Nothing posted yet."));
  }
  for (const m of state.messages) {
    const mine = m.uid === state.user?.uid;
    const fromHost = a && m.uid === a.hostUid;
    const when = m.createdAt?.toDate
      ? m.createdAt.toDate().toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
      : "sending…";
    log.append(el("div", { class: `msg${mine ? " mine" : ""}${fromHost ? " host" : ""}` },
      el("div", { class: "msg-head" },
        el("span", { class: "msg-name" }, m.name || "Student"),
        fromHost ? el("span", { class: "badge" }, "HOST") : null,
        el("span", { class: "msg-time" }, when),
      ),
      el("div", { class: "msg-text" }, m.text),
    ));
  }
  log.scrollTop = log.scrollHeight;
}

/* ─── create-activity form ────────────────────────────────────────────── */

function createView(prefillDate) {
  const dates = new Set(prefillDate ? [prefillDate] : []);
  const availCache = new Map(); // uid -> {weekly, dates} fetched once per person

  const box = el("div", { class: "side-panel" });
  box.append(el("div", { class: "side-head" },
    el("h2", {}, "Create an activity"),
    el("button", { class: "btn icon", title: "Close", onclick: closeSidebar }, "×"),
  ));

  const err = el("div", { class: "error", hidden: true });
  const name = el("input", { maxlength: "60", placeholder: "e.g. Pickup basketball" });
  const description = el("textarea", { rows: "3", maxlength: "1000", placeholder: "What are you doing? What should people know?" });
  const location = el("input", { maxlength: "80", placeholder: "e.g. School gym" });

  /* public / private toggle */
  const pubRadio = el("input", { type: "radio", name: "vis", checked: true });
  const privRadio = el("input", { type: "radio", name: "vis" });

  const dateInput = el("input", { type: "date" });
  const dateList = el("div", { class: "date-list" });
  const redrawDates = () => {
    dateList.replaceChildren();
    if (dates.size === 0) {
      dateList.append(el("span", { class: "hint" }, "No dates added yet."));
      return;
    }
    for (const d of [...dates].sort()) {
      dateList.append(el("span", { class: "date-pill" }, fmtDateHuman(d),
        el("button", {
          type: "button", class: "linklike", title: "Remove date",
          onclick: () => { dates.delete(d); redrawDates(); },
        }, "×")));
    }
  };
  redrawDates();

  const timeStart = el("input", { type: "time" });
  const timeEnd = el("input", { type: "time" });

  const gradeBoxes = GRADES.map(g => {
    const cb = el("input", { type: "checkbox" });
    if (g === currentGrade(state.profile)) cb.checked = true;
    return { g, cb };
  });

  const requirements = el("textarea", { rows: "2", maxlength: "500", placeholder: "e.g. Bring your own racket. Beginners welcome." });
  const openJoin = el("input", { type: "radio", name: "joinmode", checked: true });
  const reqJoin = el("input", { type: "radio", name: "joinmode" });
  const allowChat = el("input", { type: "checkbox", checked: true });
  const maxP = el("input", { type: "number", min: "1", max: "500", placeholder: "No limit" });

  /* friend picker (private mode) + group-availability heat */
  const friendChecks = state.social.friends.map(f => ({
    f, cb: el("input", { type: "checkbox" }),
  }));
  const breakdownBox = el("div", { class: "breakdown" });

  const selectedFriends = () => friendChecks.filter(x => x.cb.checked).map(x => x.f);

  async function refreshHeat() {
    const sel = selectedFriends();
    if (!privRadio.checked || sel.length === 0) {
      state.heat = null;
      breakdownBox.replaceChildren();
      renderCalendar();
      return;
    }
    const members = [{ uid: state.user.uid, name: "You", data: { weekly: state.profile.weekly, dates: state.profile.dates } }];
    for (const f of sel) {
      if (!availCache.has(f.uid)) {
        try {
          const snap = await getDoc(doc(db, "users", f.uid));
          const d = snap.exists() ? snap.data() : {};
          availCache.set(f.uid, { weekly: d.weekly, dates: d.dates });
        } catch { availCache.set(f.uid, {}); }
      }
      members.push({ uid: f.uid, name: f.name, data: availCache.get(f.uid) });
    }
    state.heat = {
      members,
      size: members.length,
      onPickDay: iso => {
        dates.add(iso);
        redrawDates();
        renderBreakdown(iso);
        renderCalendar();
      },
    };
    renderCalendar();
  }

  function renderBreakdown(iso) {
    breakdownBox.replaceChildren();
    if (!state.heat) return;
    const n = state.heat.size;
    breakdownBox.append(el("div", { class: "field-label" }, `Who's free on ${fmtDateHuman(iso)} — click a time to use it`));
    for (const row of hourBreakdown(state.heat.members.map(x => x.data), iso)) {
      breakdownBox.append(el("button", {
        type: "button", class: "slot-row",
        onclick: () => {
          timeStart.value = `${String(row.hour).padStart(2, "0")}:00`;
          timeEnd.value = `${String(Math.min(row.hour + 1, 23)).padStart(2, "0")}:00`;
        },
      },
        el("span", { class: "slot-time" }, fmtHour(row.hour)),
        el("span", { class: "slot-bar" },
          el("span", { class: "bar-free", style: `width:${row.free / n * 100}%` }),
          el("span", { class: "bar-maybe", style: `width:${row.maybe / n * 100}%` }),
          el("span", { class: "bar-busy", style: `width:${row.busy / n * 100}%` }),
        ),
        el("span", { class: "slot-count" }, `${row.free}/${n} free`),
      ));
    }
  }

  const friendPicker = el("div", { class: "friend-picker" });
  if (friendChecks.length === 0) {
    friendPicker.append(el("p", { class: "hint" },
      "You don't have friends on here yet — add some from the ",
      el("button", { type: "button", class: "linklike", onclick: openFriends }, "Friends"),
      " panel first."));
  } else {
    for (const { f, cb } of friendChecks) {
      cb.addEventListener("change", refreshHeat);
      friendPicker.append(el("label", { class: "check" }, cb, ` ${f.name}`));
    }
    friendPicker.append(el("p", { class: "hint" },
      "Pick friends and the calendar turns into a group-availability map — greener days = more of you are free. Click a day to see hours."));
  }

  const publicOnly = [];
  const privateOnly = [];
  const updateVisibility = () => {
    const priv = privRadio.checked;
    for (const n2 of publicOnly) n2.hidden = priv;
    for (const n2 of privateOnly) n2.hidden = !priv;
    refreshHeat();
  };
  pubRadio.addEventListener("change", updateVisibility);
  privRadio.addEventListener("change", updateVisibility);

  const gradeField = field("Open to grades *", el("div", { class: "check-row" },
    gradeBoxes.map(x => el("label", { class: "check" }, x.cb, ` ${x.g}th`))));
  const joinField = field("How people join", el("div", { class: "radio-col" },
    el("label", { class: "check" }, openJoin, " Anyone eligible joins instantly"),
    el("label", { class: "check" }, reqJoin, " I approve each join request")));
  publicOnly.push(gradeField, joinField);

  const friendField = field("Invite friends", friendPicker, breakdownBox);
  privateOnly.push(friendField);
  friendField.hidden = true;

  const form = el("form", {
    class: "create-form",
    onsubmit: e => { e.preventDefault(); submit(); },
  },
    err,
    field("Activity name *", name),
    field("Who can see it", el("div", { class: "radio-col" },
      el("label", { class: "check" }, pubRadio, " Public — on the school calendar"),
      el("label", { class: "check" }, privRadio, " Private — just friends I invite"))),
    field("Description", description),
    field("Location *", location),
    friendField,
    field("Date(s) *",
      el("div", { class: "date-add-row" }, dateInput,
        el("button", {
          type: "button", class: "btn small",
          onclick: () => {
            if (dateInput.value) { dates.add(dateInput.value); dateInput.value = ""; redrawDates(); }
          },
        }, "Add date")),
      dateList),
    field("Time", el("div", { class: "time-row" }, timeStart, el("span", { class: "hint" }, "to"), timeEnd)),
    gradeField,
    field("Requirements to join", requirements),
    joinField,
    field("Chat", el("label", { class: "check" }, allowChat,
      " Let participants chat (otherwise only you can post updates)")),
    field("Max participants (optional)", maxP),
    el("div", { class: "btn-row" },
      el("button", { class: "btn primary", type: "submit" }, "Create activity"),
      el("button", { class: "btn", type: "button", onclick: closeSidebar }, "Cancel"),
    ),
  );

  async function submit() {
    err.hidden = true;
    const priv = privRadio.checked;
    const grades = priv ? [...GRADES] : gradeBoxes.filter(x => x.cb.checked).map(x => x.g);
    const missing = [];
    if (!name.value.trim()) missing.push("give it a name");
    if (!location.value.trim()) missing.push("say where it is");
    if (dates.size === 0) missing.push("add at least one date");
    if (grades.length === 0) missing.push("pick at least one grade");
    if (missing.length) {
      err.textContent = "Before creating: " + missing.join(", ") + ".";
      err.hidden = false;
      return;
    }

    const sorted = [...dates].sort();
    const sel = priv ? selectedFriends() : [];
    const data = {
      name: name.value.trim(),
      description: description.value.trim(),
      location: location.value.trim(),
      visibility: priv ? "private" : "public",
      dates: sorted,
      monthKeys: [...new Set(sorted.map(monthKeyOf))],
      timeStart: timeStart.value || "",
      timeEnd: timeEnd.value || "",
      grades,
      requirements: requirements.value.trim(),
      openJoin: priv ? true : openJoin.checked,
      allowChat: allowChat.checked,
      maxParticipants: maxP.value ? Number(maxP.value) : null,
      hostUid: state.user.uid,
      hostName: state.profile.displayName,
      participants: [],
      participantNames: {},
      pending: [],
      pendingNames: {},
      invited: sel.map(f => f.uid),
      invitedNames: Object.fromEntries(sel.map(f => [f.uid, f.name])),
      visibleTo: [state.user.uid, ...sel.map(f => f.uid)],
      // auto-cleanup: ~2 months after the last day
      expiresAt: new Date(dateFromIso(sorted[sorted.length - 1]).getTime() + 60 * 86400000),
      createdAt: serverTimestamp(),
    };

    try {
      const ref = await addDoc(collection(db, "activities"), data);
      // jump the calendar to the first date's month so the new activity is visible
      const [y, m] = sorted[0].split("-").map(Number);
      if (state.monthCursor.getFullYear() !== y || state.monthCursor.getMonth() !== m - 1) {
        state.monthCursor = new Date(y, m - 1, 1);
        subscribeMonth();
      }
      openActivity(ref.id);
    } catch (e2) {
      err.textContent = e2.message;
      err.hidden = false;
    }
  }

  box.append(form);
  return box;
}

function field(label, ...controls) {
  return el("div", { class: "field" },
    el("label", { class: "field-label" }, label), ...controls);
}

/* ─── profiles ────────────────────────────────────────────────────────── */

function profileView() {
  const p = state.profile;
  const box = el("div", { class: "side-panel" });
  box.append(el("div", { class: "side-head" },
    el("h2", {}, "Your profile"),
    el("button", { class: "btn icon", title: "Close", onclick: closeSidebar }, "×"),
  ));
  box.append(el("div", { class: "meta" },
    metaRow("Name", p.displayName),
    metaRow("Grade", gradeLabel(currentGrade(p)) + " — moves up automatically each school year"),
    metaRow("Account", p.email || state.user.email),
  ));
  const sec = el("section", {}, el("h3", {}, "Contact info"));
  for (const c of p.contacts || []) {
    sec.append(el("p", { class: "contact-line" }, el("b", {}, cap(c.type) + ": "), c.value));
  }
  box.append(sec);
  box.append(el("p", { class: "hint" },
    "Anyone signed in at school can see your contact info — that's how hosts and participants coordinate."));
  box.append(el("div", { class: "btn-row" },
    el("button", { class: "btn", onclick: editProfile }, "Edit profile")));
  return box;
}

function personView(uid, backTo) {
  const box = el("div", { class: "side-panel" });
  const back = () => {
    if (backTo === "@friends") openFriends();
    else if (backTo) openActivity(backTo);
    else closeSidebar();
  };
  box.append(el("div", { class: "side-head" },
    el("button", { class: "linklike", onclick: back }, "‹ Back"),
    el("button", { class: "btn icon", title: "Close", onclick: closeSidebar }, "×"),
  ));
  const body = el("div", {}, el("p", { class: "hint" }, "Loading…"));
  box.append(body);

  getDoc(doc(db, "users", uid)).then(snap => {
    body.replaceChildren();
    if (!snap.exists()) {
      body.append(el("p", { class: "hint" }, "This student hasn't finished setting up their profile."));
      return;
    }
    const p = snap.data();
    body.append(
      el("h2", {}, p.displayName),
      el("div", { class: "meta" }, metaRow("Grade", gradeLabel(currentGrade(p)))),
      el("div", { class: "person-tools" }, friendActionEl(uid, p.displayName)),
    );
    const sec = el("section", {}, el("h3", {}, "Contact"));
    for (const c of p.contacts || []) {
      sec.append(el("p", { class: "contact-line" }, el("b", {}, cap(c.type) + ": "), c.value));
    }
    body.append(sec);
  }).catch(e => body.replaceChildren(el("p", { class: "error" }, e.message)));

  return box;
}

/* ─── Firestore writes ────────────────────────────────────────────────── */

const aref = id => doc(db, "activities", id);
const me = () => state.user.uid;

function joinActivity(a) {
  return updateDoc(aref(a.id), {
    participants: arrayUnion(me()),
    [`participantNames.${me()}`]: state.profile.displayName,
  });
}
function requestJoin(a) {
  return updateDoc(aref(a.id), {
    pending: arrayUnion(me()),
    [`pendingNames.${me()}`]: state.profile.displayName,
  });
}
function cancelRequest(a) {
  return updateDoc(aref(a.id), {
    pending: arrayRemove(me()),
    [`pendingNames.${me()}`]: deleteField(),
  });
}
function leaveActivity(a) {
  return updateDoc(aref(a.id), {
    participants: arrayRemove(me()),
    [`participantNames.${me()}`]: deleteField(),
  });
}
function approve(a, uid) {
  return updateDoc(aref(a.id), {
    pending: arrayRemove(uid),
    [`pendingNames.${uid}`]: deleteField(),
    participants: arrayUnion(uid),
    [`participantNames.${uid}`]: a.pendingNames?.[uid] || "Student",
  });
}
function decline(a, uid) {
  return updateDoc(aref(a.id), {
    pending: arrayRemove(uid),
    [`pendingNames.${uid}`]: deleteField(),
  });
}
function removePerson(a, uid) {
  return updateDoc(aref(a.id), {
    participants: arrayRemove(uid),
    [`participantNames.${uid}`]: deleteField(),
  });
}
// private activities: invitee accepts / declines; host invites / uninvites
function acceptInvite(a) {
  return updateDoc(aref(a.id), {
    invited: arrayRemove(me()),
    [`invitedNames.${me()}`]: deleteField(),
    participants: arrayUnion(me()),
    [`participantNames.${me()}`]: state.profile.displayName,
  });
}
function declineInvite(a) {
  return updateDoc(aref(a.id), {
    invited: arrayRemove(me()),
    [`invitedNames.${me()}`]: deleteField(),
    visibleTo: arrayRemove(me()),
  });
}
function invite(a, uid, name) {
  return updateDoc(aref(a.id), {
    invited: arrayUnion(uid),
    [`invitedNames.${uid}`]: name,
    visibleTo: arrayUnion(uid),
  });
}
function uninvite(a, uid) {
  return updateDoc(aref(a.id), {
    invited: arrayRemove(uid),
    [`invitedNames.${uid}`]: deleteField(),
    visibleTo: arrayRemove(uid),
  });
}

// Run a Firestore write; surface any error (usually a security-rules denial)
async function act(fn) {
  try {
    await fn();
  } catch (err) {
    console.error(err);
    alert("That didn't go through: " + err.message);
  }
}
