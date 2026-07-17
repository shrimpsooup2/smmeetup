// Friends: requests live in friendRequests/{fromUid}_{toUid};
// accepted pairs live in friendships/{uidA}_{uidB} (ids sorted).
// app.js keeps state.social live via onSnapshot.

import { db } from "./firebase.js";
import { state } from "./store.js";
import { el, currentGrade, gradeLabel } from "./util.js";
import { renderSidebar, openPerson, closeSidebar, leaveAvailMode } from "./sidebar.js";
import {
  collection, doc, setDoc, deleteDoc, getDocs,
  query, orderBy, startAt, endAt, limit, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const me = () => state.user.uid;
const myName = () => state.profile.displayName;

export function openFriends() {
  leaveAvailMode();
  state.heat = null;
  state.selectedActivityId = null;
  state.sidebar = { view: "friends" };
  renderSidebar();
}

/* ─── relationship lookup + ops ───────────────────────────────────────── */

// "self" | "friend" | "outgoing" | "incoming" | "none"
export function relationTo(uid) {
  if (uid === me()) return { kind: "self" };
  const f = state.social.friends.find(x => x.uid === uid);
  if (f) return { kind: "friend", id: f.id };
  const out = state.social.outgoing.find(r => r.to === uid);
  if (out) return { kind: "outgoing", id: out.id };
  const inc = state.social.incoming.find(r => r.from === uid);
  if (inc) return { kind: "incoming", req: inc };
  return { kind: "none" };
}

export function sendRequest(uid, name) {
  return setDoc(doc(db, "friendRequests", `${me()}_${uid}`), {
    from: me(), fromName: myName(),
    to: uid, toName: name,
    createdAt: serverTimestamp(),
  });
}

export function removeRequest(id) {
  return deleteDoc(doc(db, "friendRequests", id)); // cancel or decline
}

export async function acceptRequest(req) {
  const [a, b] = [req.from, req.to].sort();
  await setDoc(doc(db, "friendships", `${a}_${b}`), {
    users: [a, b],
    names: { [req.from]: req.fromName, [req.to]: req.toName },
    createdAt: serverTimestamp(),
  });
  await deleteDoc(doc(db, "friendRequests", req.id));
}

export function unfriend(friendshipId) {
  return deleteDoc(doc(db, "friendships", friendshipId));
}

async function act(fn) {
  try { await fn(); } catch (err) {
    console.error(err);
    alert("That didn't go through: " + err.message);
  }
}

// The right action button(s) for a person, based on the current relationship.
// Used in the person profile view, search results, and the friends list.
export function friendActionEl(uid, name) {
  const rel = relationTo(uid);
  const wrap = el("span", { class: "friend-action" });
  if (rel.kind === "self") return wrap;
  if (rel.kind === "friend") {
    wrap.append(el("span", { class: "ok small-note" }, "Friends ✔"),
      el("button", { class: "linklike danger", onclick: () => { if (confirm(`Remove ${name} as a friend?`)) act(() => unfriend(rel.id)); } }, "unfriend"));
  } else if (rel.kind === "outgoing") {
    wrap.append(el("span", { class: "hint" }, "Request sent"),
      el("button", { class: "linklike danger", onclick: () => act(() => removeRequest(rel.id)) }, "cancel"));
  } else if (rel.kind === "incoming") {
    wrap.append(
      el("button", { class: "btn small primary", onclick: () => act(() => acceptRequest(rel.req)) }, "Accept"),
      el("button", { class: "btn small", onclick: () => act(() => removeRequest(rel.req.id)) }, "Decline"));
  } else {
    wrap.append(el("button", { class: "btn small primary", onclick: () => act(() => sendRequest(uid, name)) }, "Add friend"));
  }
  return wrap;
}

/* ─── the Friends sidebar view ────────────────────────────────────────── */

export function friendsView() {
  const box = el("div", { class: "side-panel" });
  box.append(el("div", { class: "side-head" },
    el("h2", {}, "Friends"),
    el("button", { class: "btn icon", title: "Close", onclick: closeSidebar }, "×"),
  ));

  // search students by name
  const input = el("input", { placeholder: "Search students by name…", maxlength: "40" });
  const results = el("div", { class: "people search-results" });
  const searchForm = el("form", {
    class: "chat-input-row",
    onsubmit: async e => {
      e.preventDefault();
      const q = input.value.trim();
      results.replaceChildren();
      if (!q) return;
      results.append(el("p", { class: "hint" }, "Searching…"));
      try {
        const snap = await getDocs(query(
          collection(db, "users"),
          orderBy("displayName"), startAt(q), endAt(q + "\uf8ff"), limit(8),
        ));
        results.replaceChildren();
        const rows = snap.docs.filter(d => d.id !== me());
        if (rows.length === 0) {
          results.append(el("p", { class: "hint" }, "No one found — names are matched from the start, with exact capitalization."));
        }
        for (const d of rows) {
          const p = d.data();
          results.append(el("div", { class: "person-row" },
            el("button", { class: "linklike", onclick: () => openPerson(d.id, "@friends") },
              `${p.displayName} (${gradeLabel(currentGrade(p))})`),
            friendActionEl(d.id, p.displayName),
          ));
        }
      } catch (err) {
        results.replaceChildren(el("p", { class: "error" }, err.message));
      }
    },
  }, input, el("button", { class: "btn small", type: "submit" }, "Search"));
  box.append(el("section", {}, el("h3", {}, "Find people"), searchForm, results));

  // incoming requests
  const inc = el("section", {}, el("h3", {}, `Requests for you · ${state.social.incoming.length}`));
  if (state.social.incoming.length === 0) inc.append(el("p", { class: "hint" }, "No pending requests."));
  for (const r of state.social.incoming) {
    inc.append(el("div", { class: "person-row" },
      el("button", { class: "linklike", onclick: () => openPerson(r.from, "@friends") }, r.fromName || "Student"),
      el("button", { class: "btn small primary", onclick: () => act(() => acceptRequest(r)) }, "Accept"),
      el("button", { class: "btn small", onclick: () => act(() => removeRequest(r.id)) }, "Decline"),
    ));
  }
  box.append(inc);

  // outgoing requests
  if (state.social.outgoing.length > 0) {
    const out = el("section", {}, el("h3", {}, "Sent by you"));
    for (const r of state.social.outgoing) {
      out.append(el("div", { class: "person-row" },
        el("button", { class: "linklike", onclick: () => openPerson(r.to, "@friends") }, r.toName || "Student"),
        el("span", { class: "hint" }, "pending"),
        el("button", { class: "linklike danger", onclick: () => act(() => removeRequest(r.id)) }, "cancel"),
      ));
    }
    box.append(out);
  }

  // friends list
  const fl = el("section", {}, el("h3", {}, `Your friends · ${state.social.friends.length}`));
  if (state.social.friends.length === 0) {
    fl.append(el("p", { class: "hint" }, "No friends yet — search above, or open someone's profile from any activity and hit “Add friend”."));
  }
  for (const f of state.social.friends) {
    fl.append(el("div", { class: "person-row" },
      el("button", { class: "linklike", onclick: () => openPerson(f.uid, "@friends") }, f.name || "Student"),
      el("button", { class: "linklike danger", onclick: () => { if (confirm(`Remove ${f.name} as a friend?`)) act(() => unfriend(f.id)); } }, "unfriend"),
    ));
  }
  box.append(fl);

  box.append(el("p", { class: "hint" },
    "Friends can invite you to private activities and see your availability when planning them."));
  return box;
}
