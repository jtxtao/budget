import { Link } from "react-router-dom";
import { formatBps, formatCents } from "../utils";

/**
 * Where the money went over the window, biggest first — and what that works out
 * at per month.
 *
 * **Ranked, not arranged**, which is the one place this table deliberately
 * parts company with the dashboard's. The plan's own order is answered twice
 * already: on Configuration, where it is set, and on the dashboard, where the
 * envelopes are read in it. The question here is different — where does the
 * money actually go — and that question has an order of its own, which is the
 * whole reason a report is worth having. The heading each category is filed
 * under travels on its row, so the arrangement is still readable; it is just no
 * longer the axis.
 *
 * ## The two figures beside each other
 *
 * `Spent` is what the window cost, net of anything paid back into the category.
 * `Per month` is that same figure spread across the months the books cover —
 * **all of them, not the ones the category was active in**. That is what
 * amortising means and it is the point of the column: a $1,200 premium paid
 * once a year reads as $100 a month, which is the only form in which it can be
 * compared with the rent above it or with the estimate beside it. Dividing it by
 * the one month it was paid in would report the household as spending $1,200 a
 * month on insurance.
 *
 * Which is why the row says how many months it moved in. A category that spent
 * in one month of twelve and one that spent in all twelve can show the same
 * average and mean completely different things — one is a lump the plan has to
 * save for, the other is a rate the plan has to cover — and that distinction is
 * invisible in the figure itself.
 *
 * ## Over the estimate
 *
 * The estimate is the standing monthly figure from the plan, and where the
 * amortised average is above it the average is drawn in the expense colour.
 *
 * This is **not** a second definition of trouble contradicting the envelope
 * view's one rule. There the rule is `available < 0` and nothing else, because a
 * category carrying money forward can exceed its estimate in a single month
 * quite safely — a sinking fund spends a year of saving in one go by design.
 * That defence is exactly what an average over the whole window removes: twelve
 * months of spending above a monthly estimate cannot be explained by carry-over,
 * because there is nowhere left for it to have carried from. It says the
 * estimate is wrong, which is a statement about the plan rather than about the
 * envelope, and the plan is what this page is read against.
 *
 * ## The drill-in
 *
 * A category's name is a button, not a heading: clicking it tells the page
 * which row to open in `CategoryDetailPanel` below, and clicking the open one
 * again closes it. `selectedBudgetId` is owned by the page, not this table —
 * the same row has to stay found after the range control moves the window out
 * from under it, which a `useState` local to this component could not survive.
 */

/**
 * The bar is a picture of the share printed beside it and encodes nothing else,
 * so it is hidden from the accessibility tree rather than given a label that
 * would read out the same percentage twice.
 *
 * Scaled against the largest row rather than against the total, so the top row
 * fills its cell and the rest are read against it — a bar scaled to the total is
 * a row of stubs on any household whose spending is spread across twenty
 * categories.
 *
 * `vermilion-ink` rather than `vermilion`: this sits on the light data rows,
 * where the chrome accents are too light to hold their own.
 */
function ShareBar({ cents, maxCents }) {
  const ratio = maxCents > 0 ? Math.max(0, cents) / maxCents : 0;

  return (
    <div className="h-1.5 w-full min-w-[3rem] bg-rule" aria-hidden="true">
      <div className="h-full bg-vermilion-ink" style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}

const headCell = "whitespace-nowrap px-3 py-2 text-right font-mono text-label uppercase text-chalk";
const figureCell = "whitespace-nowrap px-3 py-2 text-right font-mono text-row tabular-nums";

// On a phone the ranking keeps the category, what it cost and what that comes
// to a month — the three that answer the question the table is opened with —
// and drops the share and the estimate to a wider screen. Every cell of those
// two columns carries this, header and footing alike, so no row can show a
// column its header has hidden. An average over the estimate is still marked
// on the figure that remains, so the one judgement the estimate supported is
// not lost with it.
const wideOnly = "hidden sm:table-cell";

function CategoryRow({ row, maxCents, months, striped, selected, onSelect }) {
  // See the note above: over the whole window an estimate can no longer be
  // exceeded by carry-over, so exceeding it says the estimate is wrong.
  const over = row.targetCents != null && row.averageCents > row.targetCents;

  return (
    <tr className={selected ? "bg-band" : striped ? "bg-sheet-alt" : "bg-sheet"}>
      <th scope="row" className="px-4 py-2 text-left font-sans text-row font-normal text-ink">
        {/* Opens the drill-in below rather than navigating away — the ranking
            is still the context the category was picked out of, so leaving the
            page would lose it. */}
        <button
          type="button"
          onClick={() => onSelect(row.budgetId)}
          aria-pressed={selected}
          aria-label={`${selected ? "Hide" : "Show"} the month-by-month detail for ${row.name}`}
          className={`text-left underline-offset-2 hover:underline ${
            selected ? "font-medium text-azure underline" : "hover:text-azure"
          }`}
        >
          {row.name}
        </button>
        <span className="mt-0.5 block font-mono text-label uppercase text-ink-soft">
          {row.groupName ?? "No group"} · {row.monthsWithSpend} of {months}{" "}
          {months === 1 ? "month" : "months"}
          {row.refundCents > 0 && ` · ${formatCents(row.refundCents)} back`}
        </span>
      </th>
      <td className={`${figureCell} font-medium text-ink`}>{formatCents(row.netSpentCents)}</td>
      {/* The share and its bar are one reading, so they are one cell under one
          heading — a bar in a column of its own needs a heading of its own, and
          the only honest one would repeat the word beside it. */}
      <td className={`w-[22%] px-3 py-2 ${wideOnly}`}>
        <div className="flex items-center gap-2">
          <span className="w-12 shrink-0 text-right font-mono text-row tabular-nums text-ink-soft">
            {row.shareBps == null ? "—" : formatBps(row.shareBps)}
          </span>
          <ShareBar cents={row.netSpentCents} maxCents={maxCents} />
        </div>
      </td>
      <td className={`${figureCell} ${over ? "font-medium text-vermilion-ink" : "text-ink"}`}>
        {formatCents(row.averageCents)}
      </td>
      {/* The plan's intent, in grey and dashed when unset: a category nobody has
          estimated is not a category estimated at zero. */}
      <td className={`${figureCell} text-ink-soft ${wideOnly}`}>
        {row.targetCents == null ? "—" : formatCents(row.targetCents)}
      </td>
    </tr>
  );
}

export default function SpendingByCategoryTable({ report, selectedBudgetId, onSelectCategory }) {
  const { rows, netSpentCents, averagedOverMonths, averageSpendCents } = report;
  const maxCents = rows.reduce((max, row) => Math.max(max, row.netSpentCents), 0);

  return (
    <section className="border border-edge bg-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-edge px-4 py-3">
        <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">
          Where the money went
        </h2>
        <span className="font-mono text-label uppercase text-chalk-soft">
          Per month is over {averagedOverMonths}{" "}
          {averagedOverMonths === 1 ? "month" : "months"} of records
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-5 font-sans text-row text-chalk-soft">
          Nothing was spent in this window.{" "}
          <Link
            to="/transactions"
            className="text-azure underline underline-offset-2 hover:text-chalk"
          >
            Record what has been happening
          </Link>{" "}
          and it will be broken down here.
        </p>
      ) : (
        <div className="scroll-x">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-panel-raised">
                <th scope="col" className="px-4 py-2 text-left font-mono text-label uppercase text-chalk">
                  Category
                </th>
                <th scope="col" className={headCell}>
                  Spent
                </th>
                <th
                  scope="col"
                  className={`px-3 py-2 text-left font-mono text-label uppercase text-chalk ${wideOnly}`}
                >
                  Share
                </th>
                <th scope="col" className={headCell}>
                  Per month
                </th>
                <th scope="col" className={`${headCell} ${wideOnly}`}>
                  Estimate
                </th>
              </tr>
            </thead>

            <tbody>
              {rows.map((row, index) => (
                <CategoryRow
                  key={row.budgetId}
                  row={row}
                  maxCents={maxCents}
                  months={averagedOverMonths}
                  striped={index % 2 === 1}
                  selected={row.budgetId === selectedBudgetId}
                  onSelect={onSelectCategory}
                />
              ))}
            </tbody>

            {/* Back on the dark chrome, bookending the header: this row is the
                window's total, not another band inside the sheet. */}
            <tfoot>
              <tr className="bg-panel-raised">
                <th scope="row" className="px-4 py-2 text-left font-mono text-label uppercase text-chalk">
                  All spending
                </th>
                <td className={`${figureCell} font-medium text-chalk`}>
                  {formatCents(netSpentCents)}
                </td>
                <td className={`px-3 py-2 ${wideOnly}`}>
                  <span className="block w-12 text-right font-mono text-row tabular-nums text-chalk-soft">
                    {netSpentCents > 0 ? formatBps(10000) : "—"}
                  </span>
                </td>
                <td className={`${figureCell} font-medium text-chalk`}>
                  {formatCents(averageSpendCents)}
                </td>
                <td className={wideOnly} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
