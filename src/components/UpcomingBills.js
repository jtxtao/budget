import { Link } from "react-router-dom";
import Button from "./Button";
import { TRANSACTION_KINDS } from "../contexts/TransactionsContext";
import { formatCents, formatDateMedium, formatDayDelta } from "../utils";

/**
 * What is due next, and what was due already.
 *
 * The dashboard's subject is "where am I right now", and a bill falling on
 * Thursday is exactly that — it is the same question the paycheque countdown in
 * the summary above already answers from the other side. The two belong on one
 * page for that reason: what is coming in, and what is going out before it does.
 *
 * **Overdue leads, and it is a word before it is a colour.** A row nobody has
 * entered is the whole reason this panel exists, so it sorts first (the hook's
 * doing) and says "3 days ago" in `vermilion-ink` — the one warning tone that
 * carries text on this light surface. `ReconciliationList` states the same rule
 * for a stale reconciliation, and for the same reason: colour is never the only
 * channel.
 *
 * **Two actions, and neither of them writes silently.** Enter opens a small form
 * seeded from the schedule, because the two things that actually vary about a
 * recurring bill are the amount and the day it went out — a panel that wrote
 * $180.00 the moment a button was pressed would be a ledger asserting a figure
 * nobody read off a statement. Skip records that the occurrence was decided about
 * without writing anything, which is what a month the gym was closed looks like.
 *
 * Prop-driven, `ReconciliationList`'s call: the page resolves the payee, the
 * account and the category, because a name is not money and this panel is worth
 * being able to test without three stores behind it.
 */

/** How the due date reads, and whether it needs attention. */
function due(row) {
  if (row.overdue) {
    return { tone: "text-vermilion-ink", note: formatDayDelta(row.dueInDays) };
  }
  return {
    tone: row.dueInDays === 0 ? "text-sulfur" : "text-ink-soft",
    note: formatDayDelta(row.dueInDays),
  };
}

function UpcomingRow({ row, striped, describe, onEnter, onSkip }) {
  const status = due(row);
  const isInflow = row.schedule.kind === TRANSACTION_KINDS.INFLOW;
  const { name, filing } = describe(row.schedule);
  // The occurrence, not the schedule: two rows of one schedule are two different
  // things to say out loud, and a label naming only the payee would be ambiguous
  // on a weekly bill.
  const label = `${name} due ${formatDateMedium(row.date)}`;

  return (
    /**
     * **Two lines, at every width**, and that is not a mobile concession: this
     * panel is a third of the dashboard's grid even on a wide screen, and
     * everything on the row but the name has an irreducible width — a date, an
     * amount and two buttons cannot be truncated and still mean anything. Put
     * all four on one line and the only thing that can give is the payee, which
     * is the one part a reader is scanning for; it came back as "Gr…" and
     * "Riverl…" against a perfectly readable "4 DAYS AGO" beside it.
     *
     * So the name takes a line of its own and the rest share the next. What was
     * a one-line row is now two, and two lines that say something beat one that
     * does not.
     */
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 ${
        striped ? "bg-sheet-alt" : "bg-sheet"
      }`}
    >
      <div className="min-w-0 flex-1 basis-full">
        <div className="truncate font-sans text-row text-ink">{name}</div>
        <div className="truncate font-mono text-label uppercase text-ink-soft">{filing}</div>
      </div>

      <div className="shrink-0 text-right">
        <div className="font-mono text-row font-medium tabular-nums text-ink">
          {/* Money in is signed here, where the register gives each direction a
              column of its own: there is one column on this panel, and the sign is
              the channel because the accents that mean income and expense are
              tuned for the dark chrome and cannot carry text on this surface. */}
          {isInflow ? "+" : ""}
          {formatCents(row.schedule.amountCents)}
        </div>
        <div className={`whitespace-nowrap font-mono text-label uppercase ${status.tone}`}>
          {formatDateMedium(row.date)} · {status.note}
        </div>
      </div>

      <span className="ml-auto inline-flex shrink-0 items-center gap-1">
        {/* Enter before Skip, and drawn as a button where Skip is bare text: the
            quiet one is the one that throws an occurrence away. */}
        <Button
          variant="row-action"
          size="sm"
          aria-label={`Enter ${label}`}
          onClick={() => onEnter(row)}
        >
          Enter
        </Button>
        <Button variant="row" size="sm" aria-label={`Skip ${label}`} onClick={() => onSkip(row)}>
          Skip
        </Button>
      </span>
    </div>
  );
}

export default function UpcomingBills({
  rows,
  overdueCount,
  dueCents,
  windowDays,
  scheduleCount,
  describe,
  onEnter,
  onSkip,
}) {
  return (
    <section className="border border-edge bg-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-edge px-4 py-3">
        <div className="min-w-0">
          <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">Upcoming</h2>
          <p className="mt-0.5 font-sans text-row text-chalk-soft">
            {/* The total is money *out* only, and says so: netting an expected
                paycheque off it would report a smaller bill than has to be paid. */}
            {rows.length === 0
              ? "Bills and other transactions you have scheduled."
              : `${formatCents(dueCents)} going out in the next ${windowDays} days.`}
          </p>
        </div>
        {rows.length > 0 && (
          <span
            className={`font-mono text-label uppercase ${
              overdueCount > 0 ? "text-vermilion" : "text-verdant"
            }`}
          >
            {overdueCount > 0
              ? `${overdueCount} ${overdueCount === 1 ? "is" : "are"} overdue`
              : "Nothing overdue"}
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-5 font-sans text-row text-chalk-soft">
          {scheduleCount === 0 ? (
            <>
              Nothing scheduled yet.{" "}
              <Link to="/plan" className="text-azure underline underline-offset-2 hover:text-chalk">
                Add a scheduled transaction
              </Link>{" "}
              and what is due will appear here — nothing is ever recorded until you say so.
            </>
          ) : (
            // Everything is dealt with, which is a different fact from having no
            // schedules at all and has to read as one.
            <>Nothing due in the next {windowDays} days. Everything scheduled is up to date.</>
          )}
        </p>
      ) : (
        rows.map((row, index) => (
          <UpcomingRow
            key={row.key}
            row={row}
            striped={index % 2 === 1}
            describe={describe}
            onEnter={onEnter}
            onSkip={onSkip}
          />
        ))
      )}
    </section>
  );
}
