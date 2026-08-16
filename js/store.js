import { GRADES } from "./util.js";

// Single shared app state. Modules mutate it and call the relevant render fns.
export const state = {
  user: null,       // Firebase Auth user (null = signed out)
  profile: null,    // users/{uid} doc data (displayName, grade, contacts, weekly, dates, …)

  calView: "week",                   // "week" (default vertical view) | "month" grid tab
  monthCursor: (() => { const d = new Date(); d.setDate(1); return d; })(),
  weekCursor: new Date(),            // any date within the displayed week
  publicActs: [],                    // public activities for the displayed month(s) (live)
  privateActs: [],                   // all private activities I'm part of (live)
  hostedActs: [],                    // all activities I host (live) — for join-request notifications
  activities: [],                    // merged view of the above
  gradeFilter: new Set(GRADES),      // grades currently shown on the calendar

  selectedActivityId: null,
  messages: [],                      // chat messages for the selected activity (live)

  // sidebar.view: "empty" | "activity" | "create" | "profile" | "person" | "friends"
  sidebar: { view: "empty" },

  // friends & requests (live)
  social: { friends: [], incoming: [], outgoing: [] },

  // group-availability heatmap while planning a private activity:
  // null, or { members: [{uid, name, data:{weekly,dates}}], size, onPickDay }
  heat: null,

  // availability-marking mode: calendar days become paintable
  availMode: false,
  availCollapsed: false, // mobile: collapse the sheet to see the whole month
  availFocusDay: null, // day whose hours show in the sidebar fine-tune list
};
