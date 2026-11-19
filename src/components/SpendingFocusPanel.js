import { addMonths, formatCents, periodLTE } from "../utils";
import { MAX_FOCUSED_BUDGETS } from "../contexts/BudgetsContext";
import TallyGauge from "./TallyGauge";

/** How many months of history each widget draws, this month included. */
export const FOCUS_HISTORY_MONTHS = 6;

/** How many finished months the "usual" figure is averaged over. */
const AVERAGE_MONTHS = 3;

/**
 * One widget per focused category, assembled from figures other hooks already
 * own — nothing here is new arithmetic over the ledger.
 *
 *   spent     = −activity this month (net of refunds, `useEnvelopes`' figure)
 *   available = what is in the envelope now
 *   funded    = available + spent — what there was to spend this month,
 *               carried in or assigned, the dashboard summary's meter reading
 *               one category at a time
 *   months    = the last six months of net spending, `useSpendingReport`'s
 *               own per-category `monthly`
 *   usual     = the mean of the finished months among the last three, and
 *               only those the books cover — a month before the first record
 *               is not a month of spending nothing. Null when there are none.
 *
 * Plan order, first `MAX_FOCUSED_BUDGETS`: a ninth that reached storage from a
 * second device is still a choice somebody made, so it is not dropped from the
 * store — it is just not drawn until a place frees up.
 *
 * @param budgets             `useBudgets().budgets`, in plan order
 * @param envelopeRows        envelope rows for `period` (`useDashboard`'s)
 * @param reportRows          `useSpendingReport(period, "6m").rows`
 * @param period              this month
 * @param coverageStartPeriod the report's first month the books reach
 */
export function focusWidgets(budgets, envelopeRows, reportRows, period, coverageStartPeriod) {
  const envelopes = new Map(envelopeRows.map((row) => [row.budgetId, row]));
  const reports = new Map(reportRows.map((row) => [row.budgetId, row]));
  const months = Array.from({ length: FOCUS_HISTORY_MONTHS }, (_, i) =>
    addMonths(period, i - (FOCUS_HISTORY_MONTHS - 1))
  );

  return budgets
    .filter((budget) => budget.focused === true)
    .slice(0, MAX_FOCUSED_BUDGETS)
    .map((budget) => {
      const envelope = envelopes.get(budget.id);
      const monthly = new Map(
        (reports.get(budget.id)?.monthly ?? []).map((entry) => [entry.period, entry.netCents])
      );
      const spentCents = -(envelope?.activityCents ?? 0);
      const availableCents = envelope?.availableCents ?? 0;

      const finished = months
        .slice(-1 - AVERAGE_MONTHS, -1)
        .filter((month) => coverageStartPeriod == null || periodLTE(coverageStartPeriod, month));
      const usualCents = finished.length
        ? Math.round(finished.reduce((sum, month) => sum + (monthly.get(month) ?? 0), 0) / finished.length)
        : null;

      return {
        budgetId: budget.id,
        name: budget.name,
        spentCents,
        availableCents,
        fundedCents: availableCents + spentCents,
        usualCents,
        usualMonths: finished.length,
        months: months.map((month) => ({ period: month, netCents: monthly.get(month) ?? 0 })),
      };
    });
}

function availableTone(cents) {
  if (cents < 0) return "text-vermilion";
  if (cents > 0) return "text-verdant";
  return "text-chalk-soft";
}

/**
 * Six months as six columns, this month in azure. A column is a sum, so a
 * month of nothing draws at zero; a month of net refunds draws nothing rather
 * than below an axis there is no room for. `aria-hidden`: the figures it
 * carries are the ones stated in words beside it.
 */
function MonthColumns({ months }) {
  const peak = Math.max(1, ...months.map((month) => month.netCents));
  const width = 8;
  const gap = 4;
  const height = 28;
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${months.length * (width + gap) - gap} ${height}`}
      className="h-8 w-20 shrink-0"
    >
      {months.map((month, i) => {
        const h = month.netCents > 0 ? Math.max(1.5, (month.netCents / peak) * height) : 0;
        const last = i === months.length - 1;
        return (
          <g key={month.period}>
            <rect x={i * (width + gap)} y={height - 1} width={width} height={1} className="fill-chalk/5" />
            <rect
              x={i * (width + gap)}
              y={height - h}
              width={width}
              height={h}
              rx={1.5}
              className={last ? "fill-azure" : "fill-chalk-soft"}
              fillOpacity={last ? 1 : 0.45}
            />
          </g>
        );
      })}
    </svg>
  );
}

function usualNote(widget) {
  if (widget.usualCents == null) return "No earlier months to compare yet";
  const months = widget.usualMonths === 1 ? "last month" : `the last ${widget.usualMonths} months`;
  return `Usually ${formatCents(widget.usualCents)} a month over ${months}`;
}

function FocusWidget({ widget }) {
  const headingId = `focus-${widget.budgetId}`;
  return (
    <li>
      <article
        aria-labelledby={headingId}
        className="flex h-full flex-col gap-2 rounded-xl border border-edge bg-panel px-4 py-3"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 id={headingId} className="truncate font-sans text-sm font-semibold text-chalk">
              {widget.name}
            </h3>
            <div className="mt-1 font-mono text-figure font-medium text-chalk">
              {formatCents(widget.spentCents)}
            </div>
            <div className="font-sans text-xs text-chalk-soft">
              {widget.fundedCents > 0
                ? `spent of ${formatCents(widget.fundedCents)} this month`
                : "spent this month, nothing funded"}
            </div>
          </div>
          <MonthColumns months={widget.months} />
        </div>

        {/* TallyGauge reads a non-positive max as zero, so it is suppressed
            rather than handed one. */}
        {widget.fundedCents > 0 && (
          <TallyGauge
            amount={Math.max(0, widget.spentCents)}
            max={widget.fundedCents}
            overOnly
            label={`${widget.name}: ${formatCents(widget.spentCents)} spent of ${formatCents(widget.fundedCents)}`}
          />
        )}

        <div className="mt-auto flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 font-sans text-xs">
          <span className={availableTone(widget.availableCents)}>
            {widget.availableCents < 0
              ? `Overspent by ${formatCents(-widget.availableCents)}`
              : `${formatCents(widget.availableCents)} left`}
          </span>
          <span className="text-chalk-soft">{usualNote(widget)}</span>
        </div>
      </article>
    </li>
  );
}

/**
 * The categories the household has chosen to keep an eye on, up to eight,
 * each as a small widget: this month's spending against what there was to
 * spend, what is left, and how that compares with an ordinary month.
 *
 * Read-only by design. Moving money is `CategoryLedgerTable`'s door below it,
 * and choosing what is watched is the picker behind "Choose categories" — so
 * nothing on a widget is a second way of doing either.
 */
export default function SpendingFocusPanel({ widgets, onChoose }) {
  return (
    <section
      aria-labelledby="spending-focus-heading"
      className="mt-4 rounded-2xl border border-edge bg-panel"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-edge px-4 py-3">
        <h2
          id="spending-focus-heading"
          className="font-sans text-base font-semibold tracking-tight text-chalk"
        >
          Spending focus
        </h2>
        <div className="flex items-baseline gap-3">
          {widgets.length > 0 && (
            <span className="font-sans text-xs text-chalk-soft">
              {widgets.length} of {MAX_FOCUSED_BUDGETS}
            </span>
          )}
          <button
            type="button"
            onClick={onChoose}
            className="font-sans text-row font-medium text-azure underline underline-offset-2 hover:text-chalk"
          >
            Choose categories
          </button>
        </div>
      </div>

      {widgets.length === 0 ? (
        <p className="px-4 py-4 font-sans text-row text-chalk-soft">
          Pick up to {MAX_FOCUSED_BUDGETS} categories that matter most to you — dining out,
          groceries, anything you want to keep an eye on — and see this month's spending on each
          at a glance.
        </p>
      ) : (
        <ul className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-4">
          {widgets.map((widget) => (
            <FocusWidget key={widget.budgetId} widget={widget} />
          ))}
        </ul>
      )}
    </section>
  );
}
