import { addDays, daysBetween, isValidISODate, todayISO } from "./utils";

/**
 * When the paycheques land — the calendar arithmetic behind the countdown.
 *
 * Deliberately not in `src/cadence.js`, which is the *amount* question: how much
 * a recurring figure comes to in an average month. That file says out loud that
 * nothing in it should grow a date, because Configuration describes income in
 * general. This is the opposite question and the one that needs a real calendar:
 * which day the next one lands on.
 *
 * **Two families of schedule, and they are not variations of each other.**
 *
 *   interval   — every N days from a real payday the user recorded
 *   monthdays  — on named days of every month, whatever the interval works out at
 *
 * A fortnightly wage is the first: 26 payments a year, always the same weekday,
 * and the only way to say where it falls is to name one and step. Twice-monthly
 * salary is the second: 24 payments a year on, say, the 15th and the last day,
 * which is 13 days apart in February and 16 in July. Trying to express one as
 * the other is the whole reason a day count alone could not answer this — a
 * "15.2 day" period drifts off the calendar within a quarter.
 *
 * `custom` is the interval family with the count left to the user, and it is
 * also where every schedule stored before this file existed lands.
 */

export const PAY_CADENCES = {
  weekly: { label: "Weekly", kind: "interval", days: 7 },
  biweekly: { label: "Every 2 weeks", kind: "interval", days: 14 },
  semimonthly: { label: "Twice a month", kind: "monthdays", count: 2, defaultDays: [15, 31] },
  monthly: { label: "Monthly", kind: "monthdays", count: 1, defaultDays: [15] },
  custom: { label: "Every so many days", kind: "interval", days: null },
};

/**
 * What a custom interval runs on when no count has been typed — the figure its
 * field shows in grey. **A figure shown in a field is a figure in force**: a
 * grey number the schedule then ignored would read as an answer and leave the
 * countdown blank, so an unanswered field means its default rather than
 * "not yet". Typing a figure replaces it; clearing the field puts it back.
 */
export const DEFAULT_PERIOD_DAYS = 10;

/** The day a monthdays field means while blank, by position — the same rule. */
export function defaultPayDay(cadence, index) {
  return payCadence(cadence)?.defaultDays?.[index] ?? null;
}

/** In the order the picker offers them: shortest interval first, custom last. */
export const PAY_CADENCE_KEYS = Object.keys(PAY_CADENCES);

/** The widest monthdays cadence, and so the length of the stored answer. */
export const MAX_PAY_DAYS = 2;

/**
 * The day that always means the end of the month, whatever the month is.
 *
 * Every day of the month is clamped to the month's length, so 31 in February is
 * the 28th (or the 29th) — which is exactly what a payroll paying "the last day"
 * does. Storing the sentinel as a real day number rather than a magic string
 * keeps the field a number the user can type.
 */
export const LAST_DAY = 31;

export function payCadence(cadence) {
  return PAY_CADENCES[cadence] ?? null;
}

export function payCadenceLabel(cadence) {
  return PAY_CADENCES[cadence]?.label ?? "Not set";
}

/**
 * The cadence a bare day count names on its own.
 *
 * Used twice: by the migration, to read a schedule stored before cadences
 * existed, and by the store when a period is set while no cadence has been
 * stated. Seven days is weekly however it was typed, and a count that matches
 * nothing is a custom interval rather than an error — it was a working schedule
 * before this file existed and it stays one.
 */
export function cadenceForDays(days) {
  if (days === 7) return "weekly";
  if (days === 14) return "biweekly";
  return "custom";
}

/** How many days apart, for an interval cadence. Null for the other family. */
export function intervalDaysFor(schedule) {
  const def = payCadence(schedule?.cadence);
  if (def?.kind !== "interval") return null;
  const days = def.days ?? schedule?.periodDays ?? DEFAULT_PERIOD_DAYS;
  return Number.isInteger(days) && days > 0 ? days : null;
}

/**
 * The days of the month in force, for a monthdays cadence.
 *
 * Sliced to the cadence's count rather than to what is stored: the second day is
 * *kept* when the user switches from twice-monthly to monthly, the same way the
 * retirement plan keeps the answer it is not currently using. Toggling between
 * the two to see which is right is the point, and a toggle that destroys what it
 * toggles away from can only be used once.
 */
export function payDaysFor(schedule) {
  const def = payCadence(schedule?.cadence);
  if (def?.kind !== "monthdays") return [];
  const stored = Array.isArray(schedule?.daysOfMonth) ? schedule.daysOfMonth : [];
  return Array.from({ length: def.count }, (_, index) =>
    isPayDay(stored[index]) ? stored[index] : def.defaultDays[index]
  );
}

/** Every field the cadence needs has been answered. */
export function isScheduleConfigured(schedule) {
  const def = payCadence(schedule?.cadence);
  if (!def) return false;
  if (def.kind === "interval") {
    return isValidISODate(schedule?.lastPaidOn) && intervalDaysFor(schedule) != null;
  }
  const days = payDaysFor(schedule);
  return days.length === def.count && days.every((day) => isPayDay(day));
}

export function isPayDay(day) {
  return Number.isInteger(day) && day >= 1 && day <= LAST_DAY;
}

/** "15th", "1st", and — for the sentinel — "last day". */
export function payDayLabel(day) {
  if (!isPayDay(day)) return "";
  if (day === LAST_DAY) return "last day";
  const tens = day % 100;
  if (tens >= 11 && tens <= 13) return `${day}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[day % 10] ?? "th";
  return `${day}${suffix}`;
}

/**
 * The schedule said in words, for the tile under the date and the panel's own
 * status line — lower case, so it reads as a clause after either.
 */
export function describeSchedule(schedule) {
  const def = payCadence(schedule?.cadence);
  if (!def) return "";

  if (def.kind === "monthdays") {
    const labels = payDaysFor(schedule).filter(isPayDay).map(payDayLabel);
    if (labels.length === 0) return def.label.toLowerCase();
    return `on the ${labels.join(" and the ")}`;
  }

  const days = intervalDaysFor(schedule);
  if (days == null) return def.label.toLowerCase();
  if (days === 7) return "every week";
  if (days % 7 === 0) return `every ${days / 7} weeks`;
  return `every ${days} days`;
}

// Field by field rather than from the ISO string, which the Date constructor
// reads as UTC — the same rule as `localDate` in utils.
function localDate(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/**
 * A payday that falls on a weekend is paid the Friday before.
 *
 * True of nearly every payroll that pays on a named day of the month, and the
 * direction is never forwards: employers move pay earlier, not later. Bank
 * holidays are not accounted for — that would need a calendar this app has no
 * way to know — so a payday beside one can still read a day late.
 *
 * Applied only to the monthdays family. An interval schedule is anchored on a
 * real payday the user was actually paid on, so it already falls on a weekday
 * and every step of seven or fourteen days lands on that same weekday.
 */
function offWeekend(isoDate) {
  const weekday = localDate(isoDate).getDay();
  if (weekday === 6) return addDays(isoDate, -1);
  if (weekday === 0) return addDays(isoDate, -2);
  return isoDate;
}

function daysInMonth(year, month) {
  // Day zero of the next month is the last day of this one.
  return new Date(year, month, 0).getDate();
}

/** The paydays a monthdays schedule puts in one month, clamped and shifted. */
function paydaysInMonth(days, year, month) {
  const last = daysInMonth(year, month);
  return days.map((day) => offWeekend(todayISO(new Date(year, month - 1, Math.min(day, last)))));
}

// A full year forward is enough to find the next payday of any cadence here,
// and one month back is what makes `previousDate` answerable. The window starts
// a month early for a second reason: a payday on the 1st that falls on a
// Saturday is paid in the *previous* month, so a month's paydays are not all
// inside it.
const WINDOW_MONTHS_BACK = 1;
const WINDOW_MONTHS_FORWARD = 13;

function monthdayCandidates(days, today) {
  const [year, month] = today.split("-").map(Number);
  const dates = [];
  for (let step = -WINDOW_MONTHS_BACK; step <= WINDOW_MONTHS_FORWARD; step += 1) {
    const cursor = new Date(year, month - 1 + step, 1);
    dates.push(...paydaysInMonth(days, cursor.getFullYear(), cursor.getMonth() + 1));
  }
  // Sorted and de-duplicated after shifting, not before: two days can clamp or
  // shift onto the same date (the 30th and the 31st in February, a Saturday and
  // the Sunday after it), and one payday is one payday.
  return [...new Set(dates)].sort();
}

/**
 * The next payday on or after `today`, and the one before it.
 *
 *   interval:  next = lastPaidOn + k × days,  smallest k ≥ 1 with next ≥ today
 *   monthdays: the first scheduled date ≥ today
 *
 * Two rules hold across both families.
 *
 * **The next one is never the one already recorded.** Entering today's pay as
 * "last paid on" and being told the next lands today would be a countdown that
 * never counts, so the interval form takes k ≥ 1. The monthdays form needs no
 * such rule: it counts from the calendar rather than from a recorded payday, so
 * a payday that is today is a payday that is today.
 *
 * **The answer is never in the past.** A schedule nobody has updated in months
 * still rolls forward to a real date. A payday that has arrived and not been
 * recorded reads as today: the money may not have landed yet, and until the user
 * says it has, today is still the answer.
 *
 * Nothing here is stored — the same closed-form treatment as envelope rollover,
 * for the same reason. A stored "next payday" would need advancing by something,
 * and nothing in a single-user app with no backend runs at midnight.
 */
export function nextPayday(schedule, today) {
  const def = payCadence(schedule?.cadence);
  if (!def || !isValidISODate(today) || !isScheduleConfigured(schedule)) {
    return { nextDate: null, previousDate: null };
  }

  if (def.kind === "interval") {
    const days = intervalDaysFor(schedule);
    const elapsed = daysBetween(schedule.lastPaidOn, today);
    const k = Math.max(1, Math.ceil(elapsed / days));
    return {
      nextDate: addDays(schedule.lastPaidOn, k * days),
      previousDate: addDays(schedule.lastPaidOn, (k - 1) * days),
    };
  }

  const dates = monthdayCandidates(payDaysFor(schedule), today);
  const index = dates.findIndex((date) => date >= today);
  return {
    nextDate: index === -1 ? null : dates[index],
    previousDate: index <= 0 ? null : dates[index - 1],
  };
}
