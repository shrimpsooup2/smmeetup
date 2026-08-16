// Client-side notification feed. It surfaces the things the app can already
// see live from its subscriptions: friend requests, invites to private
// activities, and join requests on activities you host. "Seen" state lives in
// localStorage so the bell badge only counts what you haven't looked at.
//
// (Live "new message / someone joined" alerts and off-device push need the
// Cloud Functions backend from the mobile roadmap — this is the front end
// that system will later feed.)

import { state } from "./store.js";
import { fmtDateHuman } from "./util.js";

const SEEN_KEY = "smm:notifSeen";

function seenSet() {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || "[]")); }
  catch { return new Set(); }
}
function saveSeen(set) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...set])); } catch { /* ignore */ }
}

// Build the current feed from live state. Each item has a stable id so we can
// tell which are new. Kind drives the accent colour.
export function computeNotifications() {
  const me = state.user?.uid;
  if (!me) return [];
  const items = [];

  for (const r of state.social.incoming) {
    items.push({
      id: "fr:" + r.id, kind: "friend",
      text: `${r.fromName || "Someone"} sent you a friend request`,
      go: "friends",
    });
  }

  for (const a of state.activities) {
    if ((a.invited || []).includes(me)) {
      items.push({
        id: "inv:" + a.id, kind: "invite",
        text: `${a.hostName || "A friend"} invited you to “${a.name}”`,
        sub: (a.dates || [])[0] ? fmtDateHuman(a.dates[0]) : "",
        go: "activity", activityId: a.id,
      });
    }
    if (a.hostUid === me && !a.openJoin) {
      for (const uid of a.pending || []) {
        items.push({
          id: `jr:${a.id}:${uid}`, kind: "request",
          text: `${a.pendingNames?.[uid] || "Someone"} asked to join “${a.name}”`,
          go: "activity", activityId: a.id,
        });
      }
    }
  }
  return items;
}

export function unreadCount() {
  const seen = seenSet();
  return computeNotifications().filter(i => !seen.has(i.id)).length;
}

// Mark everything currently in the feed as seen (also prunes stale ids).
export function markAllSeen() {
  saveSeen(new Set(computeNotifications().map(i => i.id)));
}

export function updateNotifBadge() {
  const b = document.getElementById("notif-badge");
  if (!b) return;
  const n = unreadCount();
  b.hidden = n === 0;
  b.textContent = n > 9 ? "9+" : String(n);
  const btn = document.getElementById("notif-btn");
  if (btn) btn.classList.toggle("has-unread", n > 0);
}
