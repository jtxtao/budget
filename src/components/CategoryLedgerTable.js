import { Link } from "react-router-dom";
import Button from "./Button";
import { SortableList, useSortableItem } from "./Sortable";
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
 * **A row is coloured by the sign of what it holds and nothing else** — green
 * with money in it, grey at zero, red below — the way Actual reads a balance.
 * There is no per-category reading against the estimate: the household budgets
 * to an overall figure and does not mind how it is split, so a category holding
 * less than its own estimate is not a warning. The one funding question the
 * page asks is about the whole month, and it is the footing's Budgeted figure,
 * yellow while the month is budgeted below the plan's total estimate.
 *
 * An overspent row still says by how much beside its name, in words, so red is
 * never the only thing saying it.
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

/**
 * `wide` marks a column that only appears from `sm` up. A phone has room for the
 * name and two figures, so it keeps the two a household acts on in the moment —
 * what is left, and what this month has done to it — and leaves what was put in
 * and what the category is saving towards to a wider screen, where they were
 * always the supporting half of the row. The class rides on every cell of the
 * column, header, bands and footing alike, off this one list, so no row can
 * show a column its header has hidden.
 */
const COLUMNS = [
  { key: "availableCents", label: "Available" },
  { key: "budgetedCents", label: "Budgeted", wide: true },
  { key: "activityCents", label: "Activity" },
  { key: "goalCents", label: "Goal", wide: true },
];

/** Whole class names, never interpolated — see `bucketTones.js`. */
const visibility = (column) => (column.wide ? "hidden sm:table-cell" : "");

const headCell = "whitespace-nowrap px-3 py-2 text-right font-mono text-label uppercase text-chalk";

/**
 * What a row holds, as a tone — whole class names, never interpolated (see
 * `bucketTones.js`). Red is the app's one definition of trouble; grey is an
 * empty envelope, which is not trouble; green is money in it.
 */
function availableTone(cents) {
  if (cents < 0) return "font-medium text-vermilion-ink";
  if (cents === 0) return "text-ink-soft";
  return "font-medium text-verdant";
}

/**
 * The category's name, and — only where the envelope is overdrawn — by how
 * much, so the red figure beside it is never the only thing saying so.
 */
function NameCell({ row }) {
  const over = row.availableCents < 0;
  return (
    <th scope="row" className="px-4 py-2 text-left font-sans text-row font-normal text-ink">
      <span className={over ? "font-medium text-vermilion-ink" : undefined}>{row.name}</span>
      {over && (
        // Its own line on a phone, where the name and two figures already fill
        // the width; beside the name wherever there is room for it.
        <span className="block whitespace-nowrap font-mono text-label tabular-nums text-vermilion-ink sm:ml-2 sm:inline">
          {formatCents(-row.availableCents)} over
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
function Figure({ cents, tone = "text-ink", onClick, label, className = "" }) {
  const text = cents == null ? "—" : formatCents(cents);
  // The type treatment is the cell's whatever carries it; only the padding
  // moves onto the button, so the hit area fills the cell.
  const type = `whitespace-nowrap text-right font-mono text-row tabular-nums ${
    cents == null ? "text-ink-soft" : tone
  } ${className}`;

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
    return { cents: row.availableCents, tone: availableTone(row.availableCents) };
  }
  if (key === "goalCents") return { cents: row.goalCents, tone: "text-ink-soft" };
  return { cents: row[key], tone: "text-ink" };
}

/** What clicking a row's Available figure will do, said before the click. */
function moveLabel(row) {
  if (row.availableCents < 0) return `Cover ${row.name}`;
  return `Move money out of ${row.name}`;
}

/**
 * A category's row. Picked up whole to reorder it inside its group, when the
 * table is given somewhere to send the order (`sortable`); the catch-alls at
 * the foot are not categories anybody arranged and stay put.
 */
function CategoryRow({ row, striped, onMove, sortable = false }) {
  const item = useSortableItem(row.budgetId, { disabled: !sortable });
  return (
    <tr
      ref={item.ref}
      style={item.style}
      {...item.handle}
      className={striped ? "bg-sheet-alt" : "bg-sheet"}
    >
      <NameCell row={row} />
      {COLUMNS.map((column) => {
        const { cents, tone } = cellFor(row, column.key);
        const movable = onMove && column.key === "availableCents";
        return (
          <Figure
            key={column.key}
            cents={cents}
            tone={tone}
            className={visibility(column)}
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

function GroupBand({ name, totals, handle }) {
  return (
    <tr className="bg-band" {...handle}>
      <th scope="colgroup" className="px-4 py-1.5 text-left font-mono text-label uppercase text-ink">
        {name}
      </th>
      {COLUMNS.map((column) => (
        <td
          key={column.key}
          className={`whitespace-nowrap px-3 py-1.5 text-right font-mono text-label tabular-nums text-ink ${visibility(column)}`}
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

/**
 * One group's rows. The whole `<tbody>` is what travels when the group is
 * dragged by its band, so its categories go with it; the rows inside are a
 * list of their own, reordered without leaving the group — which group a
 * category belongs to is the plan's question, answered on `/plan`.
 */
function SectionBody({ section, nextStripe, onMove, onReorderRows, onReorderGroups }) {
  const item = useSortableItem(section.groupId ?? "ungrouped", {
    disabled: !onReorderGroups || section.groupId == null,
  });
  const rows = section.rows.map((row) => (
    <CategoryRow
      key={row.budgetId}
      row={row}
      striped={nextStripe()}
      onMove={onMove}
      sortable={onReorderRows != null}
    />
  ));
  return (
    <tbody ref={item.ref} style={item.style}>
      <GroupBand name={section.name} totals={section.totals} handle={item.handle} />
      {onReorderRows ? (
        <SortableList
          ids={section.rows.map((row) => row.budgetId)}
          onReorder={onReorderRows}
        >
          {rows}
        </SortableList>
      ) : (
        rows
      )}
    </tbody>
  );
}

export default function CategoryLedgerTable({
  sections,
  otherRows,
  otherTotals,
  totals,
  plannedCents = 0,
  onMove,
  onAssign,
  onReorderRows,
  onReorderGroups,
}) {
  const empty = sections.length === 0 && otherRows.length === 0;

  // The zebra runs across the whole table rather than restarting under each
  // band, so two rows of the same shade never end up either side of a heading.
  let stripe = 0;

  // The month budgeted below the plan's total estimate — the one funding
  // reading on the page, and on the whole rather than on any one category.
  const underPlanCents =
    plannedCents > 0 && totals.budgetedCents < plannedCents ? plannedCents - totals.budgetedCents : 0;

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
                  <th key={column.key} scope="col" className={`${headCell} ${visibility(column)}`}>
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>

            {/* Groups are dragged by their band; the ungrouped section has
                no band of its own to arrange and keeps its place. */}
            <SortableList
              ids={sections.filter((section) => section.groupId != null).map((s) => s.groupId)}
              onReorder={onReorderGroups ?? (() => {})}
            >
              {sections.map((section) => (
                <SectionBody
                  key={section.groupId ?? "ungrouped"}
                  section={section}
                  nextStripe={() => stripe++ % 2 === 1}
                  onMove={onMove}
                  onReorderRows={onReorderRows}
                  onReorderGroups={onReorderGroups}
                />
              ))}
            </SortableList>

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
                {COLUMNS.map((column) => {
                  const short = column.key === "budgetedCents" && underPlanCents > 0;
                  return (
                    <td
                      key={column.key}
                      className={`whitespace-nowrap px-3 py-2 text-right font-mono text-row font-medium tabular-nums ${
                        short ? "text-sulfur" : "text-chalk"
                      } ${visibility(column)}`}
                    >
                      {totals[column.key] == null ? "" : formatCents(totals[column.key])}
                      {short && (
                        <span className="sr-only">
                          , {formatCents(underPlanCents)} below the {formatCents(plannedCents)} plan
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
