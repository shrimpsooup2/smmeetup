export const $ = (sel, root = document) => root.querySelector(sel);

export const GRADES = [9, 10, 11, 12];
export const CONTACT_TYPES = ["phone", "email", "instagram", "discord", "other"];
export const SCHOOL_DOMAIN = "smtexas.org";

export function normalizeSchedule(schedule, totalDays = 8, periodsPerDay = 6) {
  const baseDays = Array.from({ length: totalDays }, (_, dayIndex) => ({
    day: `Day ${dayIndex + 1}`,
    periods: Array.from({ length: periodsPerDay }, (_, periodIndex) => ({
      period: periodIndex + 1,
      className: "",
      teacher: "",
    })),
  }));
  const source = Array.isArray(schedule) ? schedule : [];
  return baseDays.map((baseDay, dayIndex) => {
    const sourceDay = source[dayIndex] || {};
    const sourcePeriods = Array.isArray(sourceDay.periods) ? sourceDay.periods : [];
    return {
      ...baseDay,
      day: sourceDay.day || baseDay.day,
      periods: Array.from({ length: periodsPerDay }, (_, periodIndex) => {
        const sourcePeriod = sourcePeriods[periodIndex] || {};
        return {
          period: periodIndex + 1,
          className: sourcePeriod.className || "",
          teacher: sourcePeriod.teacher || "",
        };
      }),
    };
  });
}

export function generateRotatedSchedule(seedDays, totalDays = 8, periodsPerDay = 6) {
  const seed = normalizeSchedule(seedDays, totalDays, periodsPerDay);
  const generated = Array.from({ length: totalDays }, (_, dayIndex) => ({
    day: `Day ${dayIndex + 1}`,
    periods: Array.from({ length: periodsPerDay }, (_, periodIndex) => ({
      period: periodIndex + 1,
      className: "",
      teacher: "",
    })),
  }));

  // Pattern derived from the image: each row is the indices (0..7) of the
  // canonical 8-class set placed into the 6 periods for that day.
  const pattern = [
    [0, 1, 2, 3, 4, 5], // day 1: a b c d e f
    [5, 0, 3, 6, 2, 7], // day 2: f a d g c h
    [7, 5, 6, 1, 3, 4], // day 3: h f g b d e
    [4, 7, 1, 0, 6, 2], // day 4: e h b a g c
    [2, 4, 0, 5, 1, 3], // day 5: c e a f b d
    [3, 2, 5, 7, 0, 6], // day 6: d c f h a g
    [6, 3, 7, 4, 5, 1], // day 7: g d h e f b
    [1, 6, 4, 2, 7, 0], // day 8: b g e c h a
  ];

  // Collect explicit class entries from the seed (keeps all unique classes
  // and their start day/period). We'll place each class across days by
  // finding where its canonical index appears in later pattern rows.
  const classes = [];
  for (let d = 0; d < Math.min(seed.length, totalDays); d++) {
    const day = seed[d] || {};
    for (let p = 0; p < Math.min(periodsPerDay, (day.periods || []).length); p++) {
      const sp = day.periods[p] || {};
      if (!sp.className && !sp.teacher) continue;
      classes.push({ className: sp.className, teacher: sp.teacher, startDay: d, startPeriod: p + 1 });
    }
  }

  // Helper to write into generated only if empty
  const placeIfEmpty = (dayIndex, periodIndex, className, teacher) => {
    const day = generated[dayIndex];
    if (!day) return false;
    const slot = day.periods[periodIndex - 1];
    if (!slot) return false;
    if (slot.className || slot.teacher) return false;
    slot.className = className;
    slot.teacher = teacher;
    return true;
  };

  // Reserve seed slots first (ensure user-provided seed days are preserved)
  for (const entry of classes) {
    const _ = placeIfEmpty(entry.startDay, entry.startPeriod, entry.className, entry.teacher);
  }

  // For each canonical index, gather slots (day,period) and assign remaining
  // occurrences to seed classes that map to that index without clobbering.
  for (let idx = 0; idx < 8; idx++) {
    const slots = [];
    for (let d = 0; d < totalDays; d++) {
      const row = pattern[d % pattern.length] || [];
      const pos = row.indexOf(idx);
      if (pos !== -1) slots.push({ day: d, period: pos + 1 });
    }

    const entriesForIdx = classes.filter(e => {
      const row = pattern[e.startDay % pattern.length] || [];
      return row[e.startPeriod - 1] === idx;
    }).sort((a, b) => b.startDay - a.startDay);

    for (const entry of entriesForIdx) {
      // find the slot index corresponding to the seed occurrence (or first
      // slot on/after its startDay)
      let si = slots.findIndex(s => s.day >= entry.startDay);
      if (si === -1) continue;
      // If the exact seed slot exists (day==startDay && period==startPeriod),
      // advance to the next occurrence for future placements.
      if (slots[si] && slots[si].day === entry.startDay && slots[si].period === entry.startPeriod) si++;
      for (let k = si; k < slots.length; k++) {
        const s = slots[k];
        placeIfEmpty(s.day, s.period, entry.className, entry.teacher);
      }
    }
  }

  return generated;
}

// el("div", { class: "x", onclick: fn }, child, "text", [more, children])
// Children are appended as text nodes unless they're already elements,
// so user-entered strings are always rendered safely (no innerHTML).
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") {
      node.addEventListener(k.slice(2), v);
    } else if (v === true) {
      node.setAttribute(k, "");
    } else {
      node.setAttribute(k, v);
    }
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

// Date -> "YYYY-MM-DD" (local time, not UTC)
export function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// "YYYY-MM-DD" -> "YYYY-MM" (used to query a whole month of activities)
export const monthKeyOf = iso => iso.slice(0, 7);

// "15:30" -> "3:30 PM"
export function fmtTime(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}

// "2026-07-15" -> "Wed, Jul 15"
export function fmtDateHuman(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric",
  });
}

export function timeRange(a) {
  if (!a.timeStart) return "Time TBD";
  return a.timeEnd ? `${fmtTime(a.timeStart)} – ${fmtTime(a.timeEnd)}` : fmtTime(a.timeStart);
}

export function gradesLabel(grades) {
  return [...(grades || [])].sort((x, y) => x - y).map(g => g + "th").join(", ") || "—";
}

export const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;

// "YYYY-MM-DD" -> local Date (avoids UTC off-by-one from new Date(iso))
export function dateFromIso(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export const todayIso = () => isoDate(new Date());

// 15 -> "3 PM"
export function fmtHour(h) {
  return `${h % 12 || 12} ${h >= 12 ? "PM" : "AM"}`;
}

// When an activity auto-expires (ms since epoch): last date + ~2 months.
// Falls back to computing from dates for docs created before expiresAt existed.
export function expiryMs(a) {
  if (a.expiresAt?.toMillis) return a.expiresAt.toMillis();
  const last = (a.dates || []).slice(-1)[0];
  return last ? dateFromIso(last).getTime() + 60 * 86400000 : null;
}

// ── school-year grade rollover ────────────────────────────────────────────
// Profiles store `classOf` (graduation year); the current grade is derived
// from the date and bumps automatically when the school year starts on
// Aug 20. Seniors become "Graduated" after their final rollover.

// The calendar year in which the CURRENT school year's seniors graduate.
export function schoolYearEnd(d = new Date()) {
  const rolled = d.getMonth() > 7 || (d.getMonth() === 7 && d.getDate() >= 20);
  return d.getFullYear() + (rolled ? 1 : 0);
}
export const classOfFromGrade = grade => schoolYearEnd() + (12 - grade);
export const gradeFromClassOf = classOf => 12 - (classOf - schoolYearEnd());

// Today's grade for a profile (falls back to the stored grade for old docs).
export function currentGrade(profile) {
  if (profile?.classOf) return gradeFromClassOf(profile.classOf);
  return profile?.grade ?? null;
}
export function gradeLabel(g) {
  if (g == null) return "—";
  if (g > 12) return "Graduated";
  return `${g}th`;
}
