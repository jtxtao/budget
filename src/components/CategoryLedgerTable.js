import { Link } from "react-router-dom";
import Button from "./Button";
import { FUNDING, FUNDING_LABELS } from "../fundingStatus";
import { formatCents } from "../utils";

/**
 * Every category, under the group it is filed under, with what it has and what
 * it did this month.
 *
 *   activity  = the month's net movement, negative when money left
 *   budgeted  = what was assigned to it this month
 *   available = carried in + budgeted + activity
 *   goal      = the balance it is saving towards, set on the budget plan too
 *
 * Available leads because it is the figure the user acts on. Budgeted and
 * activity follow as the two things that moved it this month, and because
 * activity carries its own sign the row adds up as it is read rather than
 * needing one column subtracted from another. The goal — what this category
 * is saving towards — sits at the end, away from the figures that come from
 * the books. The standing monthly estimate (target) is plan-level detail that
 * belongs on the budget plan, not the at-a-glance dashboard.
 *
 * The arrangement is the plan's, not this table's: the sections arrive in the
 * order set on the Configuration page, so a household that has spent time
 * arranging their categories sees the same order everywhere.
 *
 * One definition of trouble, and only one: `available < 0`. Not a second rule
 * about the goal, for a category short of what it is saving towards is a
 * category part-way through saving, which is what every goal looks like
 * until the day it is met.
 *
 * **Funding is a reading against the plan, not a second definition of trouble**,
 * and it is carried by **the category's own name** — red for short (overspent,
 * or underfunded), yellow for on track, green for a month ahead or a goal
 * reached. `src/fundingStatus.js` is the rule; this file only maps it to tones.
 *
 * It was a column of its own, and the column was the wrong shape for it: a
 * reading that applies to the whole row does not need a cell, and spending a
 * sixth of the table's width restating five words down a list is width taken
 * from the figures the page exists to show — on a third of the dashboard's
 * grid, it was enough to push the panel beside it off the page. The name is
 * the row's subject, so colouring it says "this category" rather than "this
 * cell", and the stripe down the left edge was already repeating the colour
 * for a reader running an eye down the list.
 *
 * **Colour is still not the only channel.** The gap is named in words beside
 * any row that has one, which is the only reading a household can act on; the
 * other three are announced to a screen reader from the same cell, so the row
 * reads "Rent, on track" however it is reached; and the key above the table
 * says what the colours mean. A category with no estimate keeps the ordinary
 * ink and gets no stripe, because there is nothing for it to be short of —
 * greying it would read as a category switched off rather than unplanned.
 *
 * **The Available figure is also the control that moves it.** Noticing that a
 * category is short and doing something about it are one thought, so they are
 * one click: the figure a reader is already looking at opens `MoveMoneyModal`
 * on that category. It is the figure rather than the row's name because the
 * name is not the subject here — the money is — and the drill-in idiom that
 * does put a button on the name belongs to the reports page, where the name
 * really is what is being opened. No new column either way: the figures on this
 * table are the plan's arrangement, and an actions column would widen every
 * row to carry a control used on one of them.
 */

const COLUMNS = [
  { key: "availableCents", label: "Available" },
  { key: "budgetedCents", label: "Budgeted" },
  { key: "activityCents", label: "Activity" },
  { key: "goalCents", label: "Goal" },
];

const headCell = "whitespace-nowrap px-3 py-2 text-right font-mono text-label uppercase text-chalk";

/**
 * The dashboard's three colours for a funding reading, in whole class names so
 * Tailwind's scanner finds them (see `bucketTones.js`). Overspent and
 * underfunded share red — both are envelopes that will not see the month out —
 * and are told apart by their word and by the Available figure, which only an
 * overspent row draws in red.
 */
export const FUNDING_TONES = {
  [FUNDING.OVERSPENT]: { stripe: "border-l-vermilion", dot: "bg-vermilion", text: "text-vermilion" },
  [FUNDING.UNDERFUNDED]: { stripe: "border-l-vermilion", dot: "bg-vermilion", text: "text-vermilion" },
  [FUNDING.ON_TRACK]: { stripe: "border-l-sulfur", dot: "bg-sulfur", text: "text-sulfur" },
  [FUNDING.WELL_FUNDED]: { stripe: "border-l-verdant", dot: "bg-verdant", text: "text-verdant" },
  // The ordinary ink, not a grey: a category nobody has written an estimate for
  // is unplanned, and a greyed-out name reads as one that has been switched off.
  [FUNDING.NO_ESTIMATE]: { stripe: "border-l-transparent", dot: "bg-rule", text: "text-ink" },
};

/** The legend's three, in the order a reader is asked to care about them. */
const LEGEND = [
  { tone: FUNDING_TONES[FUNDING.UNDERFUNDED], label: "Short" },
  { tone: FUNDING_TONES[FUNDING.ON_TRACK], label: "On track" },
  { tone: FUNDING_TONES[FUNDING.WELL_FUNDED], label: "Well funded" },
];

/**
 * The category's name, carrying its funding reading.
 *
 * The name is the row's subject, so the tone belongs on it. The word itself is
 * only *spoken* — a screen reader gets "Rent, on track" — except where there is
 * a gap, which is printed, because a figure is the one reading a household can
 * do something about and "$600 short" says more than "underfunded" does.
 */
function NameCell({ row }) {
  const tone = FUNDING_TONES[row.funding.status];
  const short = row.funding.shortCents > 0;
  return (
    <th
      scope="row"
      className={`border-l-4 ${tone.stripe} px-4 py-2 text-left font-sans text-row font-normal`}
    >
      <span className={short ? `font-medium ${tone.text}` : tone.text}>{row.name}</span>
      <span className="sr-only">, {FUNDING_LABELS[row.funding.status].toLowerCase()}</span>
      {short && (
        <span className={`ml-2 whitespace-nowrap font-mono text-label tabular-nums ${tone.text}`}>
          {formatCents(row.funding.shortCents)}{" "}
          {row.funding.status === FUNDING.OVERSPENT ? "over" : "short"}
        </span>
      )}
    </th>
  );
}

/**
 * A figure on the light sheet. Null reads as a dash — no figure exists, which
 * is a different statement from a figure of zero.
 *
 * Given an `onClick` it becomes a button wearing the register's own cell
 * styling — no rule at rest, a rule under the pointer — so it reads as the way
 * that figure is changed rather than as a link to somewhere else.
 */
function Figure({ cents, tone = "text-ink", onClick, label }) {
  const text = cents == null ? "—" : formatCents(cents);
  // The type treatment is the cell's whatever carries it; only the padding
  // moves onto the button, so the hit area fills the cell.
  const type = `whitespace-nowrap text-right font-mono text-row tabular-nums ${
    cents == null ? "text-ink-soft" : tone
  }`;

  if (!onClick) return <td className={`${type} px-3 py-2`}>{text}</td>;

  return (
    <td className={type}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className="w-full border-b-2 border-transparent px-3 py-2 text-right transition-colors hover:border-rule"
      >
        {text}
      </button>
    </td>
  );
}

/**
 * How each column reads on a row. Driven off `COLUMNS` rather than written out
 * cell by cell, so the header and the body cannot disagree about how many
 * columns there are — which is exactly what happened when a column was dropped
 * from one and left in the other.
 *
 * The goal column is grey and dashes when unset: it describes intent, and a
 * category nobody has set one on is not a category saving towards zero.
 */
function cellFor(row, key) {
  if (key === "availableCents") {
    // The one definition of trouble: the envelope is empty and still paying
    // out.
    const tone = row.availableCents < 0 ? "font-medium text-vermilion-ink" : "font-medium text-ink";
    return { cents: row.availableCents, tone };
  }
  if (key === "goalCents") return { cents: row.goalCents, tone: "text-ink-soft" };
  return { cents: row[key], tone: "text-ink" };
}

/** What clicking a row's Available figure will do, said before the click. */
function moveLabel(row) {
  if (row.funding.status === FUNDING.OVERSPENT) return `Cover ${row.name}`;
  if (row.funding.status === FUNDING.UNDERFUNDED) return `Fund ${row.name}`;
  return `Move money out of ${row.name}`;
}

function CategoryRow({ row, striped, onMove }) {
  return (
    <tr className={striped ? "bg-sheet-alt" : "bg-sheet"}>
      <NameCell row={row} />
      {COLUMNS.map((column) => {
        const { cents, tone } = cellFor(row, column.key);
        const movable = onMove && column.key === "availableCents";
        return (
          <Figure
            key={column.key}
            cents={cents}
            tone={tone}
            onClick={movable ? () => onMove(row) : undefined}
            // Which way the move goes is decided from the figure, so the label
            // says which rather than leaving the reader to find out by clicking.
            label={movable ? moveLabel(row) : undefined}
          />
        );
      })}
    </tr>
  );
}

function GroupBand({ name, totals }) {
  return (
    <tr className="bg-band">
      <th scope="colgroup" className="px-4 py-1.5 text-left font-mono text-label uppercase text-ink">
        {name}
      </th>
      {COLUMNS.map((column) => (
        <td
          key={column.key}
          className="whitespace-nowrap px-3 py-1.5 text-right font-mono text-label tabular-nums text-ink"
        >
          {/* A band with nothing saving towards anything leaves the goal column
              blank rather than subtotalling it to zero — the sum arrives null
              from `useDashboard` for exactly that case. */}
          {totals[column.key] == null ? "" : formatCents(totals[column.key])}
        </td>
      ))}
    </tr>
  );
}

export default function CategoryLedgerTable({
  sections,
  otherRows,
  otherTotals,
  totals,
  shortfall,
  onMove,
  onAssign,
}) {
  const empty = sections.length === 0 && otherRows.length === 0;

  // The zebra runs across the whole table rather than restarting under each
  // band, so two rows of the same shade never end up either side of a heading.
  let stripe = 0;

  return (
    <section className="overflow-hidden rounded-2xl border border-edge bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-edge px-4 py-3">
        <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">Categories</h2>
        {!empty && (
          <div className="flex flex-wrap items-center gap-2">
            {/* Funding a category out of the pool is the act this panel most
                often prompts, so its door is here and not only on the
                Transactions page. */}
            {onAssign && (
              <Button variant="primary" size="sm" type="button" onClick={onAssign}>
                Assign income
              </Button>
            )}
            {/* The discoverable door to the same modal each Available figure
                opens. Without it the only way in is a figure that does not look
                like a control until the pointer is on it. */}
            {onMove && (
              <Button variant="outline" size="sm" type="button" onClick={() => onMove(null)}>
                Move money
              </Button>
            )}
          </div>
        )}
      </div>

      {!empty && (
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-edge px-4 py-2">
          {/* What the colours mean, said once where they are first seen. */}
          <ul aria-label="Funding key" className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {LEGEND.map(({ tone, label }) => (
              <li
                key={label}
                className="flex items-center gap-1.5 font-mono text-label uppercase text-chalk-soft"
              >
                <span aria-hidden="true" className={`h-2 w-2 rounded-full ${tone.dot}`} />
                {label}
              </li>
            ))}
            <li className="font-sans text-row text-chalk-soft">against each monthly estimate</li>
          </ul>
          {shortfall && (
            <p className="font-sans text-row text-chalk-soft">
              {shortfall.count === 0 ? (
                "Every planned category can see the month out."
              ) : (
                <>
                  <span className="font-medium text-vermilion">
                    {shortfall.count} {shortfall.count === 1 ? "category" : "categories"} short
                  </span>{" "}
                  by {formatCents(shortfall.cents)} in all. Click a short category’s Available
                  figure to fund it.
                </>
              )}
            </p>
          )}
        </div>
      )}

      {empty ? (
        <p className="px-4 py-5 font-sans text-row text-chalk-soft">
          No categories yet.{" "}
          <Link to="/plan" className="text-azure underline underline-offset-2 hover:text-chalk">
            Add one on the budget plan
          </Link>{" "}
          and it will appear here with everything it holds.
        </p>
      ) : (
        <div className="scroll-x">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-panel-raised">
                <th
                  scope="col"
                  className="px-4 py-2 text-left font-mono text-label uppercase text-chalk"
                >
                  Category
                </th>
                {COLUMNS.map((column) => (
                  <th key={column.key} scope="col" className={headCell}>
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>

            {sections.map((section) => (
              <tbody key={section.groupId ?? "ungrouped"}>
                <GroupBand name={section.name} totals={section.totals} />
                {section.rows.map((row) => (
                  <CategoryRow
                    key={row.budgetId}
                    row={row}
                    striped={stripe++ % 2 === 1}
                    onMove={onMove}
                  />
                ))}
              </tbody>
            ))}

            {/* Spend and funding with no category of their own. They count in
                every total on the page, so they have to be visible somewhere
                too. */}
            {otherRows.length > 0 && (
              <tbody>
                {/* Never a goal on these: a goal belongs to a category the user
                    set one on, and the catch-alls are what is left over. */}
                <GroupBand name="No category" totals={otherTotals} />
                {otherRows.map((row) => (
                  <CategoryRow
                    key={row.budgetId}
                    row={row}
                    striped={stripe++ % 2 === 1}
                    onMove={onMove}
                  />
                ))}
              </tbody>
            )}

            {/* Back on the dark chrome, bookending the header: this row is the
                page's total, not another band inside the sheet. */}
            <tfoot>
              <tr className="bg-panel-raised">
                <th
                  scope="row"
                  className="px-4 py-2 text-left font-mono text-label uppercase text-chalk"
                >
                  All categories
                </th>
                {COLUMNS.map((column) => (
                  <td
                    key={column.key}
                    className="whitespace-nowrap px-3 py-2 text-right font-mono text-row font-medium tabular-nums text-chalk"
                  >
                    {totals[column.key] == null ? "" : formatCents(totals[column.key])}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
