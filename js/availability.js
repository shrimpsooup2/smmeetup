// Availability: each user marks hour slots free / busy on
//  (a) a repeating weekly grid (rare setup — big overlay editor), and
//  (b) specific dates — painted directly on the main calendar in
//      "availability mode" (the everyday action). Changes auto-save.
// Anything unmarked counts as "maybe".
//
// Stored on users/{uid}:
//   weekly: { "0".."6" (weekday) : { "6".."22" (hour) : "free"|"busy" } }
//   dates:  { "YYYY-MM-DD"       : { "6".."22"        : "free"|"busy" } }

import { db } from "./firebase.js";
import { state } from "./store.js";
import { $, el, todayIso, fmtHour, dateFromIso } from "./util.js";
import {
  doc, updateDoc,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

export const HOURS = Array.from({ length: 17 }, (_, i) => i + 6); // 6am–10pm

/* ─── resolution & group math (used by the calendar heatmap) ──────────── */

// data = {weekly, dates} → "free" | "busy" | "maybe" for one date+hour
export function resolveStatus(data, iso, hour) {
  const h = String(hour);
  const override = data?.dates?.[iso]?.[h];
  if (override) return override;
  const wd = String(dateFromIso(iso).getDay());
  return data?.weekly?.[wd]?.[h] || "maybe";
}

// One person's whole-day summary: "free" | "busy" | "mixed" | "maybe"
export function dayStatusSummary(data, iso) {
  let free = 0, busy = 0;
  for (const h of HOURS) {
    const s = resolveStatus(data, iso, h);
    if (s === "free") free++;
    else if (s === "busy") busy++;
  }
  if (free === 0 && busy === 0) return "maybe";
  if (busy === 0) return "free";
  if (free === 0) return "busy";
  return "mixed";
}

// Best hour of a day for a group: {free, maybe, hour}
export function daySummary(datas, iso) {
  let best = { free: -1, maybe: -1, hour: null };
  for (const h of HOURS) {
    let free = 0, maybe = 0;
    for (const d of datas) {
      const s = resolveStatus(d, iso, h);
      if (s === "free") free++;
      else if (s === "maybe") maybe++;
    }
    if (free > best.free || (free === best.free && maybe > best.maybe)) {
      best = { free, maybe, hour: h };
    }
  }
  if (best.free === 0) best.hour = null;
  return best;
}

// 0–4 color tier from how much of the group is free
export function heatTier(free, size) {
  if (!size || free <= 0) return 0;
  const r = free / size;
  if (r >= 0.999) return 4;
  if (r >= 0.75) return 3;
  if (r >= 0.5) return 2;
  return 1;
}

// Per-hour counts for one day: [{hour, free, maybe, busy}, ...]
export function hourBreakdown(datas, iso) {
  return HOURS.map(h => {
    let free = 0, maybe = 0, busy = 0;
    for (const d of datas) {
      const s = resolveStatus(d, iso, h);
      if (s === "free") free++;
      else if (s === "busy") busy++;
      else maybe++;
    }
    return { hour: h, free, maybe, busy };
  });
}

/* ─── marking specific dates (calendar availability mode) ─────────────── */

// Click a day → cycle its override: none → all-free → all-busy → cleared
// (cleared falls back to the weekly schedule / maybe).
export function cycleDay(iso) {
  const p = state.profile;
  p.dates ||= {};
  const ov = p.dates[iso];
  const ovState = !ov ? "none"
    : HOURS.every(h => ov[String(h)] === "free") ? "free"
    : HOURS.every(h => ov[String(h)] === "busy") ? "busy"
    : "mixed";
  if (ovState === "none" || ovState === "mixed") setWholeDay(iso, "free");
  else if (ovState === "free") setWholeDay(iso, "busy");
  else delete p.dates[iso];
  scheduleSave();
}

function setWholeDay(iso, st) {
  const day = {};
  for (const h of HOURS) day[String(h)] = st;
  state.profile.dates[iso] = day;
}

// Click an hour row → cycle just that hour: default → free → busy → default
export function cycleHour(iso, hour) {
  const p = state.profile;
  p.dates ||= {};
  const day = (p.dates[iso] ||= {});
  const h = String(hour);
  if (!day[h]) day[h] = "free";
  else if (day[h] === "free") day[h] = "busy";
  else {
    delete day[h];
    if (Object.keys(day).length === 0) delete p.dates[iso];
  }
  scheduleSave();
}

/* ─── debounced auto-save ─────────────────────────────────────────────── */

let saveTimer = null;

function scheduleSave() {
  setSaveIndicator("Saving…", false);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 800);
}

// Save immediately if edits are waiting (called when leaving avail mode).
export function flushPendingSave() {
  if (saveTimer) flushSave();
}

async function flushSave() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!state.user || !state.profile) return;
  // prune old date overrides so the doc doesn't grow forever
  const today = todayIso();
  for (const k of Object.keys(state.profile.dates || {})) {
    if (k < today) delete state.profile.dates[k];
  }
  try {
    await updateDoc(doc(db, "users", state.user.uid), {
      dates: state.profile.dates || {},
      weekly: state.profile.weekly || {},
    });
    setSaveIndicator("Saved ✓", false);
  } catch (err) {
    console.error("availability save:", err);
    setSaveIndicator("Couldn't save — check your connection and click a day again.", true);
  }
  document.dispatchEvent(new CustomEvent("avail-changed"));
}

function setSaveIndicator(text, isError) {
  const box = document.getElementById("avail-save");
  if (!box) return;
  box.textContent = text;
  box.classList.toggle("error-text", !!isError);
}

/* ─── weekly-schedule overlay editor ──────────────────────────────────── */
// The repeating week (practices, jobs, …) still uses the big paint grid —
// it's set up once and rarely touched, unlike day-to-day marking.

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
let ed = null; // working copy while the editor is open

export function openAvailabilityEditor() {
  ed = {
    brush: "free", // "free" | "busy" | "erase"
    painting: false,
    weekly: structuredClone(state.profile.weekly || {}),
  };
  renderEditor();
  $("#avail-overlay").hidden = false;
}

function closeEditor() {
  ed = null;
  $("#avail-overlay").hidden = true;
}

async function saveEditor() {
  try {
    await updateDoc(doc(db, "users", state.user.uid), { weekly: ed.weekly });
    state.profile.weekly = ed.weekly;
    closeEditor();
    document.dispatchEvent(new CustomEvent("avail-changed"));
  } catch (err) {
    alert("Couldn't save your weekly schedule: " + err.message);
  }
}

function applyBrush(wd, hour) {
  const h = String(hour);
  if (ed.brush === "erase") {
    if (ed.weekly[wd]) {
      delete ed.weekly[wd][h];
      if (Object.keys(ed.weekly[wd]).length === 0) delete ed.weekly[wd];
    }
  } else {
    (ed.weekly[wd] ||= {})[h] = ed.brush;
  }
}

function paintCell(cellEl, wd, hour) {
  applyBrush(wd, hour);
  const st = ed.weekly[wd]?.[String(hour)] || "maybe";
  cellEl.className = `avail-cell st-${st}`;
}

function renderEditor() {
  const overlay = $("#avail-overlay");

  const grid = el("div", {
    class: "avail-grid",
    onmouseup: () => { ed.painting = false; },
    onmouseleave: () => { ed.painting = false; },
  });
  grid.append(el("div"));
  for (const wd of WEEKDAYS) grid.append(el("div", { class: "hd" }, wd));
  for (const hour of HOURS) {
    grid.append(el("div", { class: "hr" }, fmtHour(hour)));
    for (let i = 0; i < 7; i++) {
      const wd = String(i);
      const st = ed.weekly[wd]?.[String(hour)] || "maybe";
      const cell = el("div", { class: `avail-cell st-${st}` });
      cell.addEventListener("mousedown", e => {
        e.preventDefault();
        ed.painting = true;
        paintCell(cell, wd, hour);
      });
      cell.addEventListener("mouseover", () => {
        if (ed.painting) paintCell(cell, wd, hour);
      });
      grid.append(cell);
    }
  }

  const brushBtn = (label, brush, cls) => el("button", {
    class: `btn small brush ${cls}${ed.brush === brush ? " selected" : ""}`,
    onclick: () => { ed.brush = brush; renderEditor(); },
  }, label);

  overlay.replaceChildren(el("div", { class: "overlay-panel" },
    el("div", { class: "side-head" },
      el("h2", {}, "Your weekly schedule"),
      el("button", { class: "btn icon", title: "Close without saving", onclick: closeEditor }, "×"),
    ),
    el("p", { class: "hint" },
      "Paint the times you're regularly free or busy — practice, work, clubs. ",
      "This repeats every week; you can override any single day right on the calendar. ",
      "Anything unmarked counts as “maybe”."),
    el("div", { class: "avail-toolbar" },
      el("span", { class: "hint" }, "Paint:"),
      brushBtn("Free", "free", "b-free"),
      brushBtn("Busy", "busy", "b-busy"),
      brushBtn("Erase", "erase", "b-erase"),
    ),
    grid,
    el("div", { class: "avail-legend hint" },
      el("span", { class: "avail-cell st-free demo" }), " free   ",
      el("span", { class: "avail-cell st-busy demo" }), " busy   ",
      el("span", { class: "avail-cell st-maybe demo" }), " maybe (unmarked)",
    ),
    el("div", { class: "btn-row" },
      el("button", { class: "btn primary", onclick: saveEditor }, "Save weekly schedule"),
      el("button", { class: "btn", onclick: closeEditor }, "Cancel"),
    ),
  ));
}
