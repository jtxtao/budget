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
 *
 * **Where the books cover one month, that second line is not drawn at all**: the
 * amortised figure *is* the headline above it to the cent, and the same figure
 * printed twice under two different words is the one thing a reader stops to
 * check — the reason the page does not reprint the window's months beside the
 * chart either. The refund line takes its place on the spending tile wherever
 * there is one, because that is a second fact rather than the same one. It
 * follows the divisor and not the range, so a year asked for over one month of
 * records reads the same way: the figures are identical there for identical
 * reasons.
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

function Tile({ label, figure, tone = "text-chalk", note = null }) {
  return (
    <div className="bg-panel px-4 py-3">
      <dt className="font-sans text-xs font-medium text-chalk-soft">{label}</dt>
      <dd className={`mt-1 font-mono text-figure font-medium tabular-nums ${tone}`}>{figure}</dd>
      {/* Omitted rather than left empty: a tile with nothing to say under its
          figure says nothing, and an empty line still carries its own margin. */}
      {note && <dd className="mt-0.5 font-sans text-xs text-chalk-soft">{note}</dd>}
    </div>
  );
}

export default function ReportSummary({ report, peopleCount = 1, goalContributionsCents = 0 }) {
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

  const averageGoalContributionsCents =
    averagedOverMonths > 1 ? Math.round(goalContributionsCents / averagedOverMonths) : null;

  // SplitGauge draws nothing from all-zero weights and cannot read a negative
  // one, so the weights are clamped and the whole row is suppressed rather than
  // passed something it would render as a broken strip. A bucket in net refund
  // still keeps its figure in the key beside the meter — it is only the ticks
  // it cannot have.
  const weights = buckets.map((entry) => Math.max(0, entry.netSpentCents));
  const drawable = weights.reduce((sum, weight) => sum + weight, 0) > 0;
  // Whether a per-month figure is a different figure from the total beside it.
  // Over one month of books it is the same one, and the note above is why it is
  // then left off rather than printed twice.
  const amortised = averagedOverMonths > 1;

  return (
    <section
      aria-label="Report summary"
      className="overflow-hidden rounded-2xl border border-edge bg-panel"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-edge px-4 py-3">
        {/* A window of one month is named by that month, not by both of its
            ends: "October 2026 – October 2026" reads as two months a reader has
            to compare before noticing they are one, which is the same reason
            `useSpendingReport` names a one-month range by the month itself. */}
        <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">
          {startPeriod === endPeriod
            ? formatPeriod(startPeriod)
            : `${formatPeriod(startPeriod)} – ${formatPeriod(endPeriod)}`}
        </h2>
        <span className="text-label uppercase text-chalk-soft">
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
          note={amortised ? `${formatCents(averageIncomeCents)} a month` : null}
        />
        <Tile
          label="Spending"
          figure={formatCents(netSpentCents)}
          tone="text-vermilion"
          // The refund line is a second fact rather than the same one restated,
          // so it is drawn over one month exactly as over a year.
          note={
            totalRefundCents > 0
              ? `${formatCents(totalSpentCents)} out, ${formatCents(totalRefundCents)} back`
              : amortised
                ? `${formatCents(averageSpendCents)} a month`
                : null
          }
        />
        <Tile
          label="Toward goals"
          figure={goalContributionsCents > 0 ? formatCents(goalContributionsCents) : "—"}
          tone={goalContributionsCents > 0 ? "text-verdant" : "text-chalk-soft"}
          note={
            goalContributionsCents > 0 && averageGoalContributionsCents != null
              ? `${formatCents(averageGoalContributionsCents)} a month`
              : goalContributionsCents > 0
                ? null
                : "No goal contributions"
          }
        />
        {/* A dash where a rate would be a fiction: no income in the window is
            not a savings rate of nothing, it is a window with nothing to be a
            share of. The dollar figures beside it are unaffected, so refusing to
            invent one costs nothing. */}
        <Tile
          label="Post-tax savings rate"
          figure={savingsRateBps == null ? "—" : formatBps(savingsRateBps)}
          tone={savingsRateBps == null ? "text-chalk-soft" : netTone(netCents)}
          note={
            savingsRateBps == null
              ? "No income recorded"
              : `Kept of ${formatCents(totalIncomeCents)}`
          }
        />
      </dl>

      <div className="border-t border-edge px-4 py-3" aria-label="Even per-person share">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="font-sans text-sm font-semibold text-chalk">Per person</h3>
          <span className="text-label uppercase text-chalk-soft">
            Even share across {peopleCount} {peopleCount === 1 ? "person" : "people"}
          </span>
        </div>
        <dl className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Income", totalIncomeCents],
            ["Spending", netSpentCents],
            ["Toward goals", goalContributionsCents],
            ["Net", netCents],
          ].map(([label, cents]) => (
            <div key={label} className="flex items-baseline justify-between gap-2">
              <dt className="text-label uppercase text-chalk-soft">{label}</dt>
              <dd className="font-mono text-row tabular-nums text-chalk">
                {formatCents(Math.round(cents / peopleCount))}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 font-sans text-xs text-chalk-soft">
          Household totals divided evenly; expenses are not individually attributed.
        </p>
      </div>

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
            <span className="text-label uppercase text-chalk-soft">
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
                <dt className="text-label uppercase text-chalk-soft">{entry.label}</dt>
                <dd className="font-mono text-row tabular-nums text-chalk">
                  {formatCents(entry.netSpentCents)}
                </dd>
                {/* The share always; the monthly rate only where it differs
                    from the figure beside it, the tiles' own rule. */}
                <dd className="text-label uppercase text-chalk-soft">
                  {entry.shareBps == null ? "—" : formatBps(entry.shareBps)}
                  {amortised && ` · ${formatCents(entry.averageCents)}/mo`}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </section>
  );
}
