import { GRADES } from "./util.js";

// Single shared app state. Modules mutate it and call the relevant render fns.
export const state = {
  user: null,       // Firebase Auth user (null = signed out)
  profile: null,    // users/{uid} doc data (displayName, grade, contacts, weekly, dates, …)

  monthCursor: (() => { const d = new Date(); d.setDate(1); return d; })(),
  publicActs: [],                    // public activities for the displayed month (live)
  privateActs: [],                   // all private activities I'm part of (live)
  activities: [],                    // merged view of the two above
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
  availFocusDay: null, // day whose hours show in the sidebar fine-tune list
};
