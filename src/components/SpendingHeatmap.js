import { useMemo, useState } from "react";
import { TRANSACTION_KINDS } from "../contexts/TransactionsContext";
import {
  formatCents,
  formatDateLong,
  formatDateMedium,
  formatPeriod,
  periodEnd,
  periodLTE,
  todayISO,
} from "../utils";

/**
 * The window's spending laid out on the calendar, one cell a day.
 *
 * The other charts on the page add a month up before drawing it; this is the
 * one that does not, and what it shows is the thing a monthly total hides —
 * **when** inside the month the money went. A rent day, a weekend habit, the
 * week before payday — patterns a household can recognise in its own life and
 * none of the monthly figures can draw.
 *
 * It reads `report.days`, filled in the same walk as every other figure, so a
 * month's cells add up to that month's column on the cashflow chart. Income is
 * not on it: a payday is not a day anything was spent.
 *
 * **Intensity is relative to the window, by quartile, not by the largest day.**
 * One rent payment would otherwise drown every other day to the faintest step.
 * Four steps of one hue over the surface — sequential, so lighter is less — and
 * the legend says it is relative. Every figure is also in the table twin, and a
 * cell's own label says its amount, so the colour is never the only route.
 *
 * **A day the books cannot reach is drawn as not there, not as zero**, the
 * withholding the rest of the page does at month level: the months before the
 * first record and every day after today. "Nothing spent" is a claim about a
 * day that happened.
 */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_NAMES = [
  "Sundays",
  "Mondays",
  "Tuesdays",
  "Wednesdays",
  "Thursdays",
  "Fridays",
  "Saturdays",
];

/** Fill by intensity step: nothing spent, then four quartiles of one hue. */
const LEVEL_FILL = [
  "bg-panel-raised",
  "bg-azure/25",
  "bg-azure/50",
  "bg-azure/75",
  "bg-azure",
];
/** Text on each step — chalk on the tints, panel on the two strongest. */
const LEVEL_TEXT = [
  "text-chalk-soft",
  "text-chalk",
  "text-chalk",
  "text-panel",
  "text-panel",
];

const weekdayOf = (iso) => {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day).getDay();
};

/**
 * The thresholds between the four steps — the quartiles of the days that cost
 * something. Exported for the test, which pins the rule rather than a colour.
 */
export function quartileThresholds(values) {
  const sorted = values.filter((cents) => cents > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return [at(0.25), at(0.5), at(0.75)];
}

export function levelFor(cents, thresholds) {
  if (!(cents > 0) || thresholds == null) return 0;
  if (cents < thresholds[0]) return 1;
  if (cents < thresholds[1]) return 2;
  if (cents < thresholds[2]) return 3;
  return 4;
}

function MonthGrid({ period, dayByDate, thresholds, isCovered, selectedDate, onSelect }) {
  const last = Number(periodEnd(period).slice(8));
  const lead = weekdayOf(`${period}-01`);
  const cells = [];
  for (let index = 0; index < lead; index += 1) cells.push(null);
  for (let day = 1; day <= last; day += 1) cells.push(`${period}-${String(day).padStart(2, "0")}`);

  return (
    <figure className="min-w-0">
      <figcaption className="mb-1.5 text-label uppercase text-chalk-soft">
        {formatPeriod(period)}
      </figcaption>
      <div className="grid grid-cols-7 gap-0.5" role="group" aria-label={formatPeriod(period)}>
        {WEEKDAYS.map((name) => (
          <span
            key={name}
            aria-hidden="true"
            className="pb-0.5 text-center text-[0.625rem] uppercase text-chalk-soft"
          >
            {name.charAt(0)}
          </span>
        ))}
        {cells.map((date, index) => {
          if (date == null) return <span key={`lead-${index}`} aria-hidden="true" />;
          const dayNumber = Number(date.slice(8));
          if (!isCovered(date)) {
            return (
              <span
                key={date}
                title={`${formatDateMedium(date)}: not in the books`}
                className="flex aspect-square items-center justify-center rounded-sm border border-dashed border-edge text-[0.625rem] text-chalk-soft/60"
              >
                {dayNumber}
              </span>
            );
          }
          const day = dayByDate.get(date);
          const net = day?.netSpentCents ?? 0;
          const level = levelFor(net, thresholds);
          const selected = date === selectedDate;
          const label = day
            ? `${formatDateMedium(date)}: ${formatCents(net)} spent`
            : `${formatDateMedium(date)}: nothing spent`;
          return (
            <button
              key={date}
              type="button"
              title={label}
              aria-label={label}
              aria-pressed={selected}
              disabled={!day}
              onClick={() => onSelect(selected ? null : date)}
              className={`flex aspect-square items-center justify-center rounded-sm text-[0.625rem] tabular-nums ${
                LEVEL_FILL[level]
              } ${LEVEL_TEXT[level]} ${
                selected ? "ring-2 ring-chalk ring-offset-1 ring-offset-panel" : ""
              } ${day ? "cursor-pointer hover:ring-1 hover:ring-chalk" : "cursor-default"}`}
            >
              {dayNumber}
            </button>
          );
        })}
      </div>
    </figure>
  );
}

export default function SpendingHeatmap({ report, payeeName }) {
  const [selectedDate, setSelectedDate] = useState(null);
  // Read once, so every cell agrees on where today is.
  const [today] = useState(todayISO);

  const isCovered = useMemo(() => {
    return (date) =>
      periodLTE(report.coverageStartPeriod, date.slice(0, 7)) &&
      report.coveredMonths > 0 &&
      date <= today;
  }, [report.coverageStartPeriod, report.coveredMonths, today]);

  const dayByDate = useMemo(
    () => new Map(report.days.map((day) => [day.date, day])),
    [report.days]
  );
  const thresholds = useMemo(
    () => quartileThresholds(report.days.map((day) => day.netSpentCents)),
    [report.days]
  );
  const categoryName = useMemo(
    () => new Map(report.rows.map((row) => [row.budgetId, row.name])),
    [report.rows]
  );

  // The headline: how many of the days that happened cost anything, the
  // biggest of them, and what each weekday averages over the days it occurred.
  const summary = useMemo(() => {
    let coveredDays = 0;
    let spendDays = 0;
    let biggest = null;
    const weekdayTotals = Array(7).fill(0);
    const weekdayCounts = Array(7).fill(0);
    for (const period of report.months) {
      const last = Number(periodEnd(period).slice(8));
      for (let d = 1; d <= last; d += 1) {
        const date = `${period}-${String(d).padStart(2, "0")}`;
        if (!isCovered(date)) continue;
        coveredDays += 1;
        const weekday = weekdayOf(date);
        weekdayCounts[weekday] += 1;
        const net = dayByDate.get(date)?.netSpentCents ?? 0;
        weekdayTotals[weekday] += net;
        if (net > 0) {
          spendDays += 1;
          if (!biggest || net > biggest.netSpentCents) biggest = { date, netSpentCents: net };
        }
      }
    }
    const weekdays = WEEKDAYS.map((label, index) => ({
      label,
      name: WEEKDAY_NAMES[index],
      averageCents: weekdayCounts[index]
        ? Math.round(weekdayTotals[index] / weekdayCounts[index])
        : null,
    }));
    const heaviest = weekdays.reduce(
      (best, entry) =>
        entry.averageCents != null && (best == null || entry.averageCents > best.averageCents)
          ? entry
          : best,
      null
    );
    return { coveredDays, spendDays, biggest, weekdays, heaviest };
  }, [report.months, dayByDate, isCovered]);

  // A day that has scrolled out of the window is not still open.
  const selectedDay = selectedDate ? dayByDate.get(selectedDate) ?? null : null;

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-edge px-4 py-3">
        <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">
          Spending by day
        </h2>
        <span className="text-label uppercase text-chalk-soft">
          {summary.coveredDays === 0
            ? "No days in the books yet"
            : `Spent on ${summary.spendDays} of ${summary.coveredDays} days`}
        </span>
      </div>

      {summary.biggest && (
        <dl className="grid gap-px border-b border-edge bg-edge sm:grid-cols-2">
          <div className="bg-panel px-4 py-3">
            <dt className="text-label uppercase text-chalk-soft">Biggest day</dt>
            <dd className="mt-1 font-sans text-row text-chalk">
              <span className="font-mono tabular-nums">
                {formatCents(summary.biggest.netSpentCents)}
              </span>{" "}
              on {formatDateMedium(summary.biggest.date)}
            </dd>
          </div>
          <div className="bg-panel px-4 py-3">
            <dt className="text-label uppercase text-chalk-soft">Heaviest weekday</dt>
            <dd className="mt-1 font-sans text-row text-chalk">
              {summary.heaviest.name},{" "}
              <span className="font-mono tabular-nums">
                {formatCents(summary.heaviest.averageCents)}
              </span>{" "}
              on average
            </dd>
          </div>
        </dl>
      )}

      <div className="grid max-h-[36rem] grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-4 overflow-y-auto px-4 py-4">
        {report.months.map((period) => (
          <MonthGrid
            key={period}
            period={period}
            dayByDate={dayByDate}
            thresholds={thresholds}
            isCovered={isCovered}
            selectedDate={selectedDate}
            onSelect={setSelectedDate}
          />
        ))}
      </div>

      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-edge px-4 py-2.5 text-label uppercase text-chalk-soft"
        aria-hidden="true"
      >
        <span className="flex items-center gap-1">
          Less
          {LEVEL_FILL.map((fill) => (
            <span key={fill} className={`inline-block h-3 w-3 rounded-sm ${fill}`} />
          ))}
          More
        </span>
        <span className="normal-case">Shades are quartiles of this window's spending days.</span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm border border-dashed border-edge" />
          Not in the books
        </span>
      </div>

      {selectedDay && (
        <div className="border-t border-edge" aria-live="polite">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 bg-panel-raised px-4 py-2">
            <h3 className="font-sans text-row font-semibold text-chalk">
              {formatDateLong(selectedDay.date)}
            </h3>
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-row tabular-nums text-chalk">
                {formatCents(selectedDay.netSpentCents)}
              </span>
              <button
                type="button"
                onClick={() => setSelectedDate(null)}
                className="text-label uppercase text-chalk-soft hover:text-chalk"
              >
                Close
              </button>
            </div>
          </div>
          <table className="w-full border-collapse">
            <tbody>
              {selectedDay.legs.map((leg, index) => {
                const refund = leg.kind === TRANSACTION_KINDS.INFLOW;
                return (
                  <tr
                    key={`${leg.id}-${index}`}
                    className={index % 2 === 0 ? "bg-sheet" : "bg-sheet-alt"}
                  >
                    <td className="px-4 py-2 font-sans text-row text-ink">
                      {payeeName(leg.payeeId) ?? leg.description ?? "—"}
                    </td>
                    <td className="px-3 py-2 font-sans text-row text-ink-soft">
                      {categoryName.get(leg.budgetId) ?? "Uncategorized"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right font-mono text-row tabular-nums text-ink">
                      {refund ? `−${formatCents(leg.amountCents)}` : formatCents(leg.amountCents)}
                      {refund && <span className="ml-1 font-sans text-ink-soft">refund</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* The table twin: every day the calendar shades, and each weekday's
          average, as figures. */}
      <details className="border-t border-edge">
        <summary className="cursor-pointer px-4 py-2.5 text-label uppercase text-chalk-soft transition-colors hover:text-chalk">
          Show the days as a table
        </summary>
        <div className="max-h-[30rem] overflow-auto border-t border-edge">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th
                  scope="col"
                  className="sticky top-0 z-10 bg-panel-raised px-4 py-2 text-left text-label uppercase text-chalk"
                >
                  Day
                </th>
                {["Spent", "Refunded", "Net"].map((label) => (
                  <th
                    key={label}
                    scope="col"
                    className="sticky top-0 z-10 whitespace-nowrap bg-panel-raised px-3 py-2 text-right text-label uppercase text-chalk"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...report.days].reverse().map((day, index) => (
                <tr key={day.date} className={index % 2 === 0 ? "bg-sheet" : "bg-sheet-alt"}>
                  <th
                    scope="row"
                    className="whitespace-nowrap px-4 py-2 text-left font-sans text-row font-normal text-ink"
                  >
                    {formatDateMedium(day.date)}
                  </th>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-row tabular-nums text-ink">
                    {formatCents(day.spentCents)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-row tabular-nums text-ink-soft">
                    {day.refundCents === 0 ? "—" : formatCents(day.refundCents)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-row font-medium tabular-nums text-ink">
                    {formatCents(day.netSpentCents)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {summary.weekdays.map((weekday) => (
                <tr key={weekday.label} className="bg-panel-raised">
                  <th
                    scope="row"
                    className="px-4 py-1.5 text-left text-label uppercase text-chalk"
                  >
                    {weekday.name}, on average
                  </th>
                  <td colSpan={3} className="px-3 py-1.5 text-right font-mono text-row tabular-nums text-chalk">
                    {weekday.averageCents == null ? "—" : formatCents(weekday.averageCents)}
                  </td>
                </tr>
              ))}
            </tfoot>
          </table>
        </div>
      </details>
    </>
  );
}
