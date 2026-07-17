import { state } from "./store.js";
import { el, isoDate, fmtTime, fmtHour, todayIso, timeRange } from "./util.js";
import { openActivity, openCreate, openDay, availDayClick } from "./sidebar.js";
import { daySummary, heatTier, dayStatusSummary } from "./availability.js";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_CHIPS = 4; // beyond this a day shows 3 chips + "+N more"

export function renderCalendar() {
  const root = document.getElementById("calendar");
  const label = document.getElementById("month-label");
  if (!root) return;

  const y = state.monthCursor.getFullYear();
  const m = state.monthCursor.getMonth();
  label.textContent = state.monthCursor.toLocaleDateString(undefined, {
    month: "long", year: "numeric",
  });

  const heat = state.heat;
  const avail = state.availMode;
  const grid = el("div", {
    class: `cal-grid${heat ? " heat-mode" : ""}${avail ? " avail-mode" : ""}`,
  });
  for (const wd of WEEKDAYS) grid.append(el("div", { class: "cal-wd" }, wd));

  // Start on the Sunday on/before the 1st; always draw 6 weeks.
  const start = new Date(y, m, 1 - new Date(y, m, 1).getDay());
  const today = todayIso();

  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const iso = isoDate(d);
    const inMonth = d.getMonth() === m;
    const isPastDay = iso < today;

    let cls = `cal-cell${inMonth ? "" : " out"}${iso === today ? " today" : ""}`;
    let title = "Click an empty spot to create an activity on this day";
    if (heat) {
      title = isPastDay ? "" : "Click to use this day for your activity";
    } else if (avail) {
      // show my own status as the cell tint while marking availability
      if (!isPastDay) cls += ` avl-${dayStatusSummary(state.profile, iso)}`;
      title = isPastDay ? "" : "Click to cycle: Free → Busy → back to default";
    }

    const cell = el("div", {
      class: cls,
      title,
      onclick: e => {
        if (heat) {
          // planning mode: any click on the cell picks the day
          if (!isPastDay) heat.onPickDay?.(iso);
          return;
        }
        if (avail) {
          if (!isPastDay) availDayClick(iso);
          return;
        }
        // Only clicks on the cell background / day number start a new activity
        if (e.target === cell || e.target.classList.contains("cal-daynum")) openCreate(iso);
      },
    }, el("div", { class: "cal-daynum" }, d.getDate()));

    // group-availability heat while planning a private activity
    if (heat && !isPastDay) {
      const best = daySummary(heat.members.map(x => x.data), iso);
      cell.classList.add(`heat-${heatTier(best.free, heat.size)}`);
      cell.append(el("div", { class: "heat-label" },
        `${best.free}/${heat.size} free${best.hour != null ? " @ " + fmtHour(best.hour) : ""}`));
    }

    const acts = state.activities
      .filter(a =>
        (a.dates || []).includes(iso) &&
        (a.visibility === "private" ||
          (a.grades || []).some(g => state.gradeFilter.has(g))))
      .sort((a, b) => (a.timeStart || "99:99").localeCompare(b.timeStart || "99:99"));

    // Detail level scales with how crowded the day is:
    //   1 activity  → name, time range, location + headcount
    //   2           → time + name, location
    //   3+          → one line each; 5+ shows 3 chips + "+N more"
    const level = acts.length <= 1 ? "full" : acts.length === 2 ? "mid" : "min";
    const shown = acts.length > MAX_CHIPS ? acts.slice(0, MAX_CHIPS - 1) : acts;

    for (const a of shown) cell.append(chipEl(a, level, isPastDay));
    if (shown.length < acts.length) {
      cell.append(el("button", {
        class: "chip-more",
        title: "See everything on this day",
        onclick: e => { e.stopPropagation(); openDay(iso); },
      }, `+${acts.length - shown.length} more`));
    }
    grid.append(cell);
  }

  root.replaceChildren(grid);
}

function chipEl(a, level, isPastDay) {
  const myUid = state.user?.uid;
  const isPrivate = a.visibility === "private";
  const isInvite = isPrivate && (a.invited || []).includes(myUid);
  const name = (isPrivate ? "🔒 " : "") + a.name;

  const kids = [];
  if (level === "full") {
    kids.push(el("span", { class: "chip-name" }, name));
    if (a.timeStart) kids.push(el("span", { class: "chip-sub chip-mono" }, timeRange(a)));
    const going = (a.participants || []).length;
    const extras = [
      a.location || "",
      a.maxParticipants ? `${going}/${a.maxParticipants} going` : (going ? `${going} going` : ""),
    ].filter(Boolean).join(" · ");
    if (extras) kids.push(el("span", { class: "chip-sub chip-sub2" }, extras));
  } else if (level === "mid") {
    kids.push(el("span", { class: "chip-line" },
      a.timeStart ? el("span", { class: "chip-time" }, fmtTime(a.timeStart)) : null,
      el("span", { class: "chip-name" }, name)));
    if (a.location) kids.push(el("span", { class: "chip-sub" }, a.location));
  } else {
    kids.push(el("span", { class: "chip-line" },
      a.timeStart ? el("span", { class: "chip-time" }, fmtTime(a.timeStart)) : null,
      el("span", { class: "chip-name" }, name)));
  }

  return el("button", {
    class: `chip detail-${level}`
      + (a.id === state.selectedActivityId ? " active" : "")
      + (isPastDay ? " past" : "")
      + (isPrivate ? " private" : "")
      + (isInvite ? " invite" : ""),
    title: a.name + (isInvite ? " — you're invited!" : ""),
    onclick: e => { e.stopPropagation(); openActivity(a.id); },
  }, kids);
}
