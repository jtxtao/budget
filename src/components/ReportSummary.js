import SplitGauge from "./SplitGauge";
import { bucketTone } from "../bucketTones";
import { formatBps, formatCents, formatPeriod } from "../utils";

/**
 * The four figures a window of books comes down to, and what the spending in it
 * divided into.
 *
 * Income, spending, what was left, and what share of earnings that was. The
 * first three are the same three facts in different arrangements, which is the
 * point: a household that earned $60,000 and spent $58,000 has a different
 * problem from one that earned $30,000 and spent $28,000, and only the fourth
 * figure separates them.
 *
 * **Spending is net of refunds and income is not the refunds.** Money paid back
 * into a category returns to that category; counting it as earnings would
 * inflate both halves at once and leave the difference — the only figure here
 * that matters — looking untouched. The gross figure is carried on the tile's
 * second line wherever a refund makes the two differ, so the netting is stated
 * rather than assumed. See `useSpendingReport`.
 *
 * **"Savings rate" means what was left in the on-budget accounts**, which is
 * income less every dollar that actually left them. Money moved between
 * envelopes is an assignment rather than a transaction and never appears here —
 * so a household that funds its car envelope every month is not credited with
 * saving until the money leaves, and is not charged with spending either. That
 * is the honest reading of a ledger with no transfers in it.
 *
 * The per-month figure under each headline is the same total amortised over the
 * window, which is what makes a year comparable with a quarter — and it is
 * divided by the months the books actually cover rather than by the months
 * asked for, so three months of records read as a monthly rate rather than as a
 * quarter of one. The page states which.
 */

/** Up is good for what is kept and down is good for what is spent, so the tone
 *  is decided per figure rather than per sign. */
function netTone(cents) {
  if (cents > 0) return "text-verdant";
  if (cents < 0) return "text-vermilion";
  return "text-chalk";
}

// The four bucket colours — and the grey for spending that could not be filed
// under one — come from `src/bucketTones.js`, which is also what the plan's own
// split on Configuration and the stacked columns of the plan-against-books
// chart read. The whole value of those three drawing the same four shares is
// that a reader carries the colours between them, which a second copy of the
// map here would eventually break without anything looking wrong in review.

function Tile({ label, figure, tone = "text-chalk", note }) {
  return (
    <div className="bg-panel px-4 py-3">
      <dt className="font-mono text-label uppercase text-chalk-soft">{label}</dt>
      <dd className={`mt-1 font-mono text-figure font-medium tabular-nums ${tone}`}>{figure}</dd>
      <dd className="mt-0.5 font-mono text-label uppercase text-chalk-soft">{note}</dd>
    </div>
  );
}

export default function ReportSummary({ report }) {
  const {
    range,
    startPeriod,
    endPeriod,
    months,
    totalIncomeCents,
    totalSpentCents,
    totalRefundCents,
    netSpentCents,
    netCents,
    savingsRateBps,
    averagedOverMonths,
    averageIncomeCents,
    averageSpendCents,
    averageNetCents,
    buckets,
  } = report;

  // SplitGauge draws nothing from all-zero weights and cannot read a negative
  // one, so the weights are clamped and the whole row is suppressed rather than
  // passed something it would render as a broken strip. A bucket in net refund
  // still keeps its figure in the key beside the meter — it is only the ticks
  // it cannot have.
  const weights = buckets.map((entry) => Math.max(0, entry.netSpentCents));
  const drawable = weights.reduce((sum, weight) => sum + weight, 0) > 0;

  return (
    <section aria-label="Report summary" className="border border-edge bg-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-edge px-4 py-3">
        <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">
          {formatPeriod(startPeriod)} – {formatPeriod(endPeriod)}
        </h2>
        <span className="font-mono text-label uppercase text-chalk-soft">
          {months.length} {months.length === 1 ? "month" : "months"} · {range.name}
        </span>
      </div>

      {/* Hairline dividers drawn by the grid gap showing the edge colour
          through, as on the dashboard, so they stay 1px on every display. */}
      <dl className="grid gap-px bg-edge sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          label="Income"
          figure={formatCents(totalIncomeCents)}
          tone="text-verdant"
          note={`${formatCents(averageIncomeCents)} a month`}
        />
        <Tile
          label="Spending"
          figure={formatCents(netSpentCents)}
          tone="text-vermilion"
          note={
            totalRefundCents > 0
              ? `${formatCents(totalSpentCents)} out, ${formatCents(totalRefundCents)} back`
              : `${formatCents(averageSpendCents)} a month`
          }
        />
        <Tile
          label="Net"
          figure={formatCents(netCents)}
          tone={netTone(netCents)}
          note={`${formatCents(averageNetCents)} a month`}
        />
        {/* A dash where a rate would be a fiction: no income in the window is
            not a savings rate of nothing, it is a window with nothing to be a
            share of. The dollar figures beside it are unaffected, so refusing to
            invent one costs nothing. */}
        <Tile
          label="Savings rate"
          figure={savingsRateBps == null ? "—" : formatBps(savingsRateBps)}
          tone={savingsRateBps == null ? "text-chalk-soft" : netTone(netCents)}
          note={
            savingsRateBps == null
              ? "No income recorded"
              : `Kept of ${formatCents(totalIncomeCents)}`
          }
        />
      </dl>

      {buckets.length > 0 && (
        <div className="border-t border-edge px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {drawable && (
              <SplitGauge
                label={`How ${formatCents(netSpentCents)} of spending divided between ${buckets
                  .map((entry) => entry.label)
                  .join(", ")}`}
                segments={buckets.map((entry, index) => ({
                  key: entry.bucket ?? "unfiled",
                  weight: weights[index],
                  tone: bucketTone(entry.bucket).swatch,
                }))}
              />
            )}
            <span className="font-mono text-label uppercase text-chalk-soft">
              Where it went, over {averagedOverMonths}{" "}
              {averagedOverMonths === 1 ? "month" : "months"}
            </span>
          </div>

          {/* Every segment the meter draws, printed — the meter is a picture of
              this list rather than the only place the split is stated. The
              swatches are centred rather than baseline-aligned: a 2px square has
              no baseline of its own, so it would sit on the text's and read as a
              full step low against the label beside it. */}
          <dl className="mt-2.5 flex flex-wrap gap-x-6 gap-y-1.5">
            {buckets.map((entry) => (
              <div key={entry.bucket ?? "unfiled"} className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 shrink-0 ${bucketTone(entry.bucket).swatch}`}
                  aria-hidden="true"
                />
                <dt className="font-mono text-label uppercase text-chalk-soft">{entry.label}</dt>
                <dd className="font-mono text-row tabular-nums text-chalk">
                  {formatCents(entry.netSpentCents)}
                </dd>
                <dd className="font-mono text-label uppercase text-chalk-soft">
                  {entry.shareBps == null ? "—" : formatBps(entry.shareBps)} ·{" "}
                  {formatCents(entry.averageCents)}/mo
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </section>
  );
}
