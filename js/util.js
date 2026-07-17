export const $ = (sel, root = document) => root.querySelector(sel);

export const GRADES = [9, 10, 11, 12];
export const CONTACT_TYPES = ["phone", "email", "instagram", "discord", "other"];
export const SCHOOL_DOMAIN = "smtexas.org";

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
