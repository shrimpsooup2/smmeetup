// The default landing view: a vertical agenda of the current week, with today
// enlarged and scrolled into place. The month grid lives in its own tab.

import { state } from "./store.js";
import { el, isoDate, todayIso, fmtTime, fmtHour, weekDays } from "./util.js";
import { openActivity, openCreate, availDayClick } from "./sidebar.js";
import { dayStatusSummary, daySummary, heatTier } from "./availability.js";

const byTime = (a, b) => (a.timeStart || "99:99").localeCompare(b.timeStart || "99:99");

function dayActivities(iso) {
  return state.activities
    .filter(a =>
      (a.dates || []).includes(iso) &&
      (a.visibility === "private" ||
        (a.grades || []).some(g => state.gradeFilter.has(g))))
    .sort(byTime);
}

function actRow(a) {
  const isPrivate = a.visibility === "private";
  return el("button", {
    class: "week-row"
      + (isPrivate ? " private" : "")
      + (a.id === state.selectedActivityId ? " active" : ""),
    onclick: () => openActivity(a.id),
  },
    el("span", { class: "week-row-time" }, a.timeStart ? fmtTime(a.timeStart) : "—"),
    el("span", { class: "week-row-main" },
      el("b", {}, (isPrivate ? "🔒 " : "") + a.name),
      el("span", { class: "week-row-sub" },
        [a.location, a.hostName && "· " + a.hostName].filter(Boolean).join("  "))),
  );
}

export function renderWeek() {
  const root = document.getElementById("weekview");
  if (!root) return;
  if (state.availMode) return renderWeekAvail(root);
  if (state.heat) return renderWeekHeat(root);

  const today = todayIso();
  const list = el("div", { class: "week-list" });
  let todayEl = null;

  for (const d of weekDays(state.weekCursor)) {
    const iso = isoDate(d);
    const isToday = iso === today;
    const acts = dayActivities(iso);

    const sec = el("div", {
      class: "week-day" + (isToday ? " today" : "") + (iso < today ? " past" : ""),
    });
    sec.append(el("div", { class: "week-day-head" },
      el("span", { class: "week-dow" },
        d.toLocaleDateString(undefined, { weekday: isToday ? "long" : "short" })),
      el("span", { class: "week-date" },
        d.toLocaleDateString(undefined, { month: "short", day: "numeric" })),
      isToday ? el("span", { class: "today-tag" }, "Today") : null,
    ));

    const body = el("div", { class: "week-acts" });
    if (acts.length === 0) {
      body.append(el("button", { class: "week-empty", onclick: () => openCreate(iso) },
        isToday ? "Nothing planned today — tap to create something" : "Nothing yet — tap to add"));
    } else {
      for (const a of acts) body.append(actRow(a));
      body.append(el("button", { class: "week-add", onclick: () => openCreate(iso) }, "+ Add activity"));
    }
    sec.append(body);

    if (isToday) todayEl = sec;
    list.append(sec);
  }

  root.replaceChildren(list);

  // Land on today with the previous day peeking above (hints you can scroll up).
  if (todayEl) {
    requestAnimationFrame(() => { root.scrollTop = Math.max(0, todayEl.offsetTop - 40); });
  }
}

// Availability mode: the week's days become tappable free/busy tiles.
function renderWeekAvail(root) {
  const today = todayIso();
  const grid = el("div", { class: "week-avail" });
  for (const d of weekDays(state.weekCursor)) {
    const iso = isoDate(d);
    const isPast = iso < today;
    const st = dayStatusSummary(state.profile, iso);
    const tile = el("button", {
      class: "wa-tile avl-" + st
        + (iso === today ? " today" : "")
        + (iso === state.availFocusDay ? " focus" : "")
        + (isPast ? " past" : ""),
      disabled: isPast || undefined,
      onclick: () => { if (!isPast) availDayClick(iso); },
    },
      el("span", { class: "wa-dow" }, d.toLocaleDateString(undefined, { weekday: "short" })),
      el("span", { class: "wa-date" }, d.toLocaleDateString(undefined, { month: "short", day: "numeric" })),
      el("span", { class: "wa-status" },
        st === "free" ? "Free" : st === "busy" ? "Busy" : st === "mixed" ? "Partly" : "Maybe"),
    );
    grid.append(tile);
  }
  root.replaceChildren(el("div", { class: "week-avail-wrap" },
    el("p", { class: "hint week-avail-hint" }, "Tap a day to set free / busy. Use the panel below to set specific hours."),
    grid));
}

// Group-availability heat while planning a private activity (week version).
function renderWeekHeat(root) {
  const heat = state.heat, today = todayIso();
  const grid = el("div", { class: "week-avail" });
  for (const d of weekDays(state.weekCursor)) {
    const iso = isoDate(d);
    const isPast = iso < today;
    const best = daySummary(heat.members.map(x => x.data), iso);
    const tile = el("button", {
      class: "wa-tile heat-" + (isPast ? 0 : heatTier(best.free, heat.size)) + (isPast ? " past" : ""),
      disabled: isPast || undefined,
      onclick: () => { if (!isPast) heat.onPickDay?.(iso); },
    },
      el("span", { class: "wa-dow" }, d.toLocaleDateString(undefined, { weekday: "short" })),
      el("span", { class: "wa-date" }, d.toLocaleDateString(undefined, { month: "short", day: "numeric" })),
      el("span", { class: "wa-status" },
        isPast ? "—" : `${best.free}/${heat.size} free${best.hour != null ? " · " + fmtHour(best.hour) : ""}`),
    );
    grid.append(tile);
  }
  root.replaceChildren(el("div", { class: "week-avail-wrap" },
    el("p", { class: "hint week-avail-hint" }, "Greener = more of your group is free. Tap a day to use it."),
    grid));
}
