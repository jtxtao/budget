// The app books a single currency. Locale is pinned alongside it on purpose:
// leaving the locale undefined while hardcoding the currency meant the symbol
// was fixed while grouping and placement followed whatever machine happened to
// be viewing.
export const CURRENCY = "USD";
export const CURRENCY_LOCALE = "en-US";

/**
 * Two formatters, not one with `minimumFractionDigits: 0, maximumFractionDigits: 2`.
 *
 * That single formatter renders $7,257.70 as "$7,257.7" — one decimal place,
 * which is not a thing money does. It only shows up once figures stop being
 * round, which is the moment an account balance is a running sum rather than
 * something the user typed.
 *
 * The intent it was reaching for is worth keeping: a plan full of whole dollars
 * should not be a wall of ".00". So round amounts print whole and everything
 * else prints both cents — the choice is made per value, in `formatCents`.
 */
const wholeFormatter = new Intl.NumberFormat(CURRENCY_LOCALE, {
  currency: CURRENCY,
  style: "currency",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export const currencyFormatter = new Intl.NumberFormat(CURRENCY_LOCALE, {
  currency: CURRENCY,
  style: "currency",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * A figure as a person actually writes it, or null.
 *
 * Every amount in this app arrives as text somebody typed or pasted, and people
 * write figures the way figures are printed: "$1,234.56" off a statement,
 * "2,500" out of a spreadsheet, "7%" for a rate. `parseFloat` reads the first of
 * those as **1** — it stops at the comma and reports success — so a four-figure
 * balance would be stored as one dollar with nothing on screen to say so. The
 * punctuation has to come off before anything is parsed, which is also what lets
 * a field show `formatCents`'s own output and take it back unchanged.
 *
 * Stripping alone is not enough in the other direction: `parseFloat("12 apples")`
 * is 12, which is how a typo becomes a transaction. So whatever is left once the
 * noise is off has to be a number and nothing else, or it is junk and the caller
 * gets the same null every store already refuses input on.
 *
 * `\s` covers the no-break and narrow no-break spaces `Intl` groups with, which
 * is what a figure copied out of a rendered page carries.
 */
const MONEY_NOISE = /[$,\s]/g;
const RATE_NOISE = /[%,\s]/g;
const NUMERIC = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

function parseWritten(value, noise) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(noise, "");
  return NUMERIC.test(cleaned) ? Number(cleaned) : null;
}

/**
 * Money is stored as an integer number of cents, never as floating-point
 * dollars — summing 0.1 + 0.2 across a few hundred expenses drifts, and a
 * ledger that disagrees with itself is worse than no ledger.
 */
export function toCents(value) {
  const dollars = parseWritten(value, MONEY_NOISE);
  if (dollars == null) return null;
  // `dollars * 100` is itself lossy — 1.005 * 100 is 100.49999999999999, which
  // rounds down to the wrong cent. Settle the representation error at a
  // precision well past a cent before rounding.
  return Math.round(Number((dollars * 100).toFixed(4)));
}

export function fromCents(cents) {
  return (cents ?? 0) / 100;
}

export function formatCents(cents) {
  // `-0 % 100` is `-0`, which `=== 0`, so a negative whole amount still counts
  // as round.
  const isRound = (cents ?? 0) % 100 === 0;
  const dollars = fromCents(cents);
  // Negative zero renders as "-$0", which is not a thing money does either.
  // It arrives here from any figure reported as a magnitude by negating a sum
  // — `owedCents`, `debtCents` — so a household with no debts at all would
  // otherwise be shown owing minus nothing. Normalised here rather than at each
  // of those call sites, so a new one cannot reintroduce it. Guarded with
  // `Object.is` rather than `|| 0`, which would swallow a NaN that should be
  // visible as the bug it is.
  return (isRound ? wholeFormatter : currencyFormatter).format(
    Object.is(dollars, -0) ? 0 : dollars
  );
}

/**
 * The two faces of a field that takes money: what it shows at rest, and what it
 * shows under the caret.
 *
 * At rest it reads as money, the way the figures around it do — a column of
 * balances is read down its decimal point, and "12500" beside "$12,500" reads as
 * a different kind of thing. That is only safe because `toCents` takes the
 * formatter's own output straight back. Under the caret it goes raw: editing
 * around a currency symbol is a chore, and most edits are a select-all and a
 * retype anyway.
 *
 * Neither face is a `type="number"` input, which is why no money field in the app
 * is one: it refuses "$1,234.56" outright — the field looks filled and reads back
 * empty — and it renders $78.40 as "78.4", so a column never lines up.
 */
export const amountAtRest = (cents) => (cents == null ? "" : formatCents(cents));
export const amountEditing = (cents) => (cents == null ? "" : fromCents(cents).toFixed(2));

/**
 * Those two faces wired to the events that swap them, for a field whose value is
 * read back on **submit** — the grids of money cells: the two forms that ask for
 * account balances (which write the same records and so must not come to show
 * them differently) and the assign form, whose cells sit in a column of figures
 * the page has already formatted.
 *
 * Spread onto the input. A field that commits on **blur** owns that event and so
 * writes its own handler: what goes back in the box after a refused edit is a
 * question only that field can answer.
 */
export const amountField = {
  type: "text",
  inputMode: "decimal",
  onFocus: (event) => {
    const cents = toCents(event.target.value);
    if (cents != null) event.target.value = amountEditing(cents);
    event.target.select();
  },
  onBlur: (event) => {
    const cents = toCents(event.target.value);
    // Only a figure is restated. A blank stays blank — in these forms that is
    // what takes a month back off the record — and junk stays exactly as typed,
    // because the save is what refuses it, by account and by month.
    if (cents != null) event.target.value = amountAtRest(cents);
  },
};

/**
 * "$42.5K", "$1.2M" — money at a glance, for axis ticks and anywhere a figure is
 * a scale rather than an amount.
 *
 * Hand-rolled rather than `Intl`'s compact notation, which rounds to a different
 * number of significant digits depending on the ICU data the runtime shipped
 * with — an axis whose labels differ between the browser and the test runner is
 * an axis that cannot be asserted on. One decimal below 100 units and none above,
 * so a column of ticks never runs to five characters and the axis keeps its
 * width. Anything under a thousand is not compacted at all: at that size the
 * exact figure fits, and "$0.9K" says less than "$900".
 */
const COMPACT_UNITS = [
  [1e9, "B"],
  [1e6, "M"],
  [1e3, "K"],
];

export function formatCompactCents(cents) {
  const dollars = fromCents(cents);
  const magnitude = Math.abs(dollars);
  const unit = COMPACT_UNITS.find(([size]) => magnitude >= size);
  if (!unit) return formatCents(cents);

  const [size, suffix] = unit;
  const scaled = magnitude / size;
  const shown = scaled >= 100 ? Math.round(scaled) : Number(scaled.toFixed(1));
  return `${dollars < 0 ? "-" : ""}$${shown}${suffix}`;
}

/**
 * Rates are an integer number of basis points, always in a `…Bps` field — the
 * same discipline as cents, for the same reason.
 *
 * A rate entered as 2.5% and stored as 0.025 is a float that gets raised to the
 * power of thirty in the retirement projection, and the drift compounds along
 * with the money. A hundredth of a percent is finer than anyone states a return
 * to, so the integer is lossless for every figure a user can type, and the
 * conversion to a fraction happens once, inside the maths.
 *
 * `toBps` returns `null` for junk, exactly as `toCents` does, so the stores
 * reject a bad rate at the boundary instead of writing NaN — and it takes a
 * trailing "%" the same way `toCents` takes a leading "$", since a field asking
 * for a percentage is a field somebody will write a percent sign into.
 */
export function toBps(value) {
  const percent = parseWritten(value, RATE_NOISE);
  if (percent == null) return null;
  // The same settling step as `toCents`: `2.675 * 100` is 267.49999999999997.
  return Math.round(Number((percent * 100).toFixed(4)));
}

/** Basis points as the fraction the maths wants: 700 -> 0.07. */
export function fromBps(bps) {
  return (bps ?? 0) / 10000;
}

/** Basis points as the percentage a reader wants: 700 -> "7%", 250 -> "2.5%". */
export function formatBps(bps) {
  const percent = (bps ?? 0) / 100;
  // Trailing zeros stripped rather than padded to two places: a plan full of
  // whole percentages should not read as "7.00%", for the same reason
  // `formatCents` prints round money without the cents.
  return `${Number(percent.toFixed(2))}%`;
}

/** "2026-08" -> "Aug", for an axis where the year is carried elsewhere. */
export function formatPeriodShort(period) {
  if (toPeriod(period) == null) return "";
  const [year, month] = period.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString(CURRENCY_LOCALE, { month: "short" });
}

/**
 * Split `parts` whole units between `values` in proportion to them, exactly.
 *
 * Rounding each share independently gives percentages that add to 99 or 101 as
 * often as to 100, and a split that does not add up undermines the one thing it
 * is there to say. The leftover units go to the largest fractional parts — the
 * standard largest-remainder apportionment, which moves each figure by at most
 * one unit from its true share.
 *
 * Used for percentages (`parts` of 100) and for the ticks of a segmented meter,
 * which is the same problem at a coarser resolution.
 */
export function apportion(values, parts) {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return values.map(() => 0);

  const exact = values.map((value) => (value / total) * parts);
  const shares = exact.map(Math.floor);
  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder);

  let spare = parts - shares.reduce((sum, share) => sum + share, 0);
  for (const { index } of byRemainder) {
    if (spare <= 0) break;
    shares[index] += 1;
    spare -= 1;
  }
  return shares;
}

const pad = (n) => String(n).padStart(2, "0");

/** Local calendar date as "YYYY-MM-DD" — not toISOString(), which is UTC and
 *  silently reports yesterday for anyone west of Greenwich in the evening. */
export function todayISO(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Periods are "YYYY-MM". Derived from the date on a record, never stored
 *  alongside it, so the two can never disagree.
 *
 *  Matched strictly rather than sliced at 7 characters. A malformed legacy date
 *  like "2026-1-5" used to yield the period "2026-1-", which sorts after
 *  "2026-08" but before "2026-11" — so the record vanished from August and
 *  reappeared in November. Anything that is not a real period sorts nowhere;
 *  it has to become null and be handled as undated. */
export function toPeriod(isoDate) {
  if (typeof isoDate !== "string" || !/^\d{4}-\d{2}(?:-\d{2})?$/.test(isoDate)) return null;
  return isoDate.slice(0, 7);
}

export function currentPeriod(date = new Date()) {
  return toPeriod(todayISO(date));
}

/**
 * `period <= limit` for two periods, guarded.
 *
 * Zero-padded "YYYY-MM" compares lexicographically the same way it compares
 * chronologically, so a bare `<=` is tempting — but `null <= null` is *true* in
 * JavaScript, since both sides coerce to 0. A single undated record and a null
 * period would then land inside a cumulative sum that also counts it in the
 * undated bucket, double-counting real money with nothing on screen to show it.
 * Never write the bare comparison against a period that might be null.
 */
export function periodLTE(period, limit) {
  if (typeof period !== "string" || typeof limit !== "string") return false;
  return period <= limit;
}

/**
 * Step a period by whole months. Real Date arithmetic rather than string math,
 * which yields "2026-13" — and that sorts *before* "2027-01", so December plus
 * one month would quietly read January's data as if it were the future.
 */
export function addMonths(period, delta) {
  if (toPeriod(period) == null) return null;
  const [year, month] = period.split("-").map(Number);
  const shifted = new Date(year, month - 1 + delta, 1);
  return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}`;
}

/**
 * The last calendar day of a period, as "YYYY-MM-DD".
 *
 * Day 0 of the *following* month, which is how JavaScript's own Date spells
 * "the last day of this one" — so February knows about leap years and nothing
 * here carries a table of month lengths. Local calendar throughout, like
 * `todayISO`: `toISOString` is UTC and would hand back the 30th for a month
 * ending on the 31st anywhere west of Greenwich.
 *
 * What it is for: a record that has to fall inside a stated month without
 * claiming to have happened on a particular day — a balance correction against
 * a month-end statement being the case that wanted it.
 */
export function periodEnd(period) {
  if (toPeriod(period) == null) return null;
  const [year, month] = period.split("-").map(Number);
  return todayISO(new Date(year, month, 0));
}

/** "2026-08" -> "August 2026", for period steppers and headings. */
export function formatPeriod(period) {
  if (toPeriod(period) == null) return "Undated";
  const [year, month] = period.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString(CURRENCY_LOCALE, {
    month: "long",
    year: "numeric",
  });
}

export function isValidISODate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Step a date by whole days, on the local calendar.
 *
 * Real Date arithmetic rather than string math, for the same reason as
 * `addMonths` — and constructed field by field rather than from the ISO string,
 * which the Date constructor reads as UTC.
 */
export function addDays(isoDate, delta) {
  if (!isValidISODate(isoDate)) return null;
  const [year, month, day] = isoDate.split("-").map(Number);
  return todayISO(new Date(year, month - 1, day + delta));
}

/**
 * Whole calendar days from `from` to `to`; negative if `to` is the earlier one.
 *
 * Counted through `Date.UTC` even though both sides are local dates. A local
 * midnight-to-midnight subtraction is 23 or 25 hours across a daylight-saving
 * boundary, which floors to a day short — so a fortnightly paycheque would read
 * as 13 days away twice a year. UTC has no such boundary, and neither side of
 * the subtraction carries a time of day worth preserving.
 */
export function daysBetween(from, to) {
  if (!isValidISODate(from) || !isValidISODate(to)) return null;
  const utc = (iso) => {
    const [year, month, day] = iso.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((utc(to) - utc(from)) / 86400000);
}

// Split field by field rather than handed to the Date constructor, which reads
// a bare ISO date as UTC and so renders the previous day west of Greenwich.
function localDate(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** "2026-08-11" -> "Tuesday, August 11, 2026", for a date that is the subject. */
export function formatDateLong(isoDate) {
  if (!isValidISODate(isoDate)) return "";
  return localDate(isoDate).toLocaleDateString(CURRENCY_LOCALE, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * "2026-08-11" -> "Aug 11, 2026". The year is carried, unlike `formatDayShort`:
 * this is for dates that can be a long way from today — a reconciliation nobody
 * has done since last year has to say so.
 */
export function formatDateMedium(isoDate) {
  if (!isValidISODate(isoDate)) return "";
  return localDate(isoDate).toLocaleDateString(CURRENCY_LOCALE, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * "in 4 days", "3 days ago", "Today" — a signed day count said in words.
 *
 * Positive is the future, matching `daysBetween(today, date)`.
 */
export function formatDayDelta(days) {
  if (days == null) return "";
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

/**
 * "2026-08-07" -> "Aug 7", for listing several dates inside a month whose name
 * is already on screen.
 */
export function formatDayShort(isoDate) {
  if (!isValidISODate(isoDate)) return "";
  return localDate(isoDate).toLocaleDateString(CURRENCY_LOCALE, {
    month: "short",
    day: "numeric",
  });
}
