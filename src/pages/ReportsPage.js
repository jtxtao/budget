import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { sankeyFlows } from "../domain/cashflowSankey";
import CashflowCalendarWidget from "../components/CashflowCalendarWidget";
import CashflowChart from "../components/CashflowChart";
import CashflowLineChart from "../components/CashflowLineChart";
import CashflowSankey from "../components/CashflowSankey";
import CategoryDetailPanel from "../components/CategoryDetailPanel";
import IncomeBySourceTable from "../components/IncomeBySourceTable";
import SavingsRateChart from "../components/SavingsRateChart";
import PageHeader from "../components/PageHeader";
import PlanVsActualChart from "../components/PlanVsActualChart";
import ReportSummary from "../components/ReportSummary";
import ReportWidgetLayout, { CHART_HEIGHTS, useWidgetConfig } from "../components/ReportWidgetLayout";
import SegmentedControl from "../components/SegmentedControl";
import SpendingByCategoryTable from "../components/SpendingByCategoryTable";
import SpendingDonutChart from "../components/SpendingDonutChart";
import SpendingHeatmap from "../components/SpendingHeatmap";
import { useAccounts } from "../contexts/AccountsContext";
import { useHousehold } from "../contexts/HouseholdContext";
import { usePayees } from "../contexts/PayeesContext";
import useSpendingReport, {
  CUSTOM_REPORT_RANGE,
  DEFAULT_REPORT_RANGE,
  REPORT_RANGES,
} from "../hooks/useSpendingReport";
import { addMonths, currentPeriod, formatCents, formatPeriod, periodLTE } from "../utils";

/**
 * Reads the current widget's height tier from the WidgetConfigContext (provided
 * by ReportWidgetLayout) and calls render(chartHeight). Must be rendered inside
 * a widget section that is a child of ReportWidgetLayout.
 */
function WithWidgetHeight({ widgetId, defaultTier, render }) {
  const config = useWidgetConfig(widgetId);
  return render(CHART_HEIGHTS[config.height ?? defaultTier]);
}

/**
 * What the books have been doing — over a span, which is what makes it a report.
 *
 * Every other screen in the app answers a question about one moment: what is in
 * the envelopes now, what the accounts hold at the end of this month, what the
 * plan intends in a typical month. This one is the only place a run of months is
 * the subject, and the reason is that the questions on it cannot be answered
 * from a single month. Whether a category is overspent is a question about
 * August; whether the estimate against it is *wrong* is a question about the
 * year, and the two want different tools.
 *
 * **One control, and it sets the window.** The range picker in the header is the
 * only thing on the page that changes what is shown, and everything below moves
 * with it together — the headline figures, the columns, the ranking, and the
 * divisor under every per-month figure. Six of its seven options answer "how far
 * back" and run to the current month, which is why the last column is usually a
 * month still in progress.
 *
 * **The shortest of them is this month**, which is the window a household asks
 * for most and the limit of the same question the rest ask: where the money has
 * gone so far. Nothing on the page is special-cased for it — one column is a
 * column, and the ranking and the bucket split are the parts a single month was
 * always going to be read for. What does change is what can be *said* over one
 * month, and that follows the divisor rather than this option: a per-month
 * figure equal to the total beside it is printed once rather than twice, and an
 * average equal to a single month convicts no estimate of being wrong, because
 * carry-over is exactly what it cannot rule out. `ReportSummary` and
 * `SpendingByCategoryTable` own those two readings.
 *
 * **"Custom" is the seventh, and it is the only one that names both ends.** It
 * reveals two month fields rather than opening a second mode: everything below
 * reads the window the same way whichever option produced it. What it buys is
 * the report a preset structurally cannot give — a calendar year, a tax year, a
 * year that has already finished — and what it costs is the two things presets
 * could never do wrong: a window can now start after it ends (refused through
 * the fields' own bounds, and clamped in the hook behind them) and it can run
 * past today. The second is real rather than hypothetical, so the months that
 * have not happened are kept out of every divisor and get no verdict against the
 * plan, the same withholding the months before the first record already get.
 *
 * The pair is **kept, not cleared** when a preset is picked back up — the
 * switched-away-from rule a pay cadence and a retirement starting point both
 * follow, and for the same reason: comparing a custom window against a preset is
 * the point, and a control that forgot the window on the way past could only be
 * used once.
 *
 * **The cashflow chart and the category table cut the same books along different
 * axes and neither repeats the other.** The chart is the time axis: what came in
 * and what went out, month by month, with what was left traced across it. The
 * table is the category axis over that whole window: where the money went, in
 * order, and what that works out at per month. What the chart cannot show is
 * which categories the down-columns are made of; what the table cannot show is
 * when any of it happened.
 */

/**
 * The two figures a per-month cell is not.
 *
 * Kept here rather than in the hook because they are a caption rather than a
 * derivation: the hook already reports how many months it divided by, and this
 * is the sentence that says so where a reader will actually see it.
 */
function coverageNote(report) {
  if (report.averagedOverMonths === report.months.length) return null;

  // Which end of the window the books fall short of — both, for a custom window
  // that starts before the first record and runs past today. Each reason is said
  // in its own words, because "nobody wrote it down" and "it has not happened"
  // are different facts about an empty column and only one of them is fixable.
  if (report.coveredMonths === 0) {
    return `None of these ${report.months.length} months has happened yet, so there is nothing below but the plan.`;
  }

  const reasons = [];
  if (!periodLTE(report.coverageStartPeriod, report.startPeriod)) {
    reasons.push(`records start in ${formatPeriod(report.coverageStartPeriod)}`);
  }
  if (!periodLTE(report.endPeriod, report.coverageEndPeriod)) {
    reasons.push(`the window runs past ${formatPeriod(report.coverageEndPeriod)}`);
  }
  const why = reasons.join(" and ");

  return `${why.charAt(0).toUpperCase()}${why.slice(1)}, so per-month figures are divided by ${report.averagedOverMonths} rather than ${report.months.length}.`;
}

/**
 * One end of a custom window.
 *
 * `type="month"` because the value *is* a period — "YYYY-MM" is exactly what the
 * field reads and writes, so nothing has to be parsed, and a browser gives it a
 * month picker for free. This is not the ban on `type="number"` for money: that
 * one refuses "$1,234.56" and silently reads back empty, where this field's
 * native format and the app's own are the same string. Where a browser has no
 * month picker it falls back to a text box showing "2026-03", which is still the
 * figure it wants.
 *
 * Controlled, unlike every form in the app, for `SplitParts`' reason one step
 * down: the two ends bound each other, so each field's limits are the other
 * field's value, and nothing is being written to a store that could disagree.
 */
function MonthField({ id, label, value, min, max, onChange }) {
  return (
    <label htmlFor={id} className="flex items-center gap-1.5">
      <span className="text-label uppercase text-chalk-soft">{label}</span>
      <input
        id={id}
        type="month"
        value={value}
        min={min}
        max={max}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-lg border border-edge bg-panel-raised px-2 py-1 text-label uppercase text-chalk outline-none transition-colors focus:border-azure"
      />
    </label>
  );
}

export default function ReportsPage() {
  const [rangeKey, setRangeKey] = useState(DEFAULT_REPORT_RANGE);
  const [cashflowView, setCashflowView] = useState("bars");
  const [flowsView, setFlowsView] = useState("sankey");
  // Read once, so the window's end and every month in it come from the same
  // reading of the calendar.
  const [thisMonth] = useState(currentPeriod);
  // The custom window's two ends, seeded with the window the page opens on — so
  // picking "Custom" starts from what is already on screen rather than from an
  // empty pair — and kept afterwards whatever the strip does, the
  // switched-away-from rule.
  const [chosenStart, setChosenStart] = useState(() => addMonths(currentPeriod(), -11));
  const [chosenEnd, setChosenEnd] = useState(thisMonth);
  const custom = rangeKey === CUSTOM_REPORT_RANGE;
  // One window, never two: a preset derives both ends from the current month and
  // ignores the pair, and the pair answers for both ends when it is in force.
  const endPeriod = custom ? chosenEnd : thisMonth;
  // Which row the ranking below has open, if any. Owned here rather than by
  // the table so it survives the table re-rendering when the range changes.
  const [selectedBudgetId, setSelectedBudgetId] = useState(null);

  const report = useSpendingReport(endPeriod, rangeKey, chosenStart);
  const { accounts } = useAccounts();
  // Expenses are recorded for the shared household rather than assigned to a
  // member. The report's per-person figures are therefore an even share of
  // household totals, using the active roster (or one person for local books).
  const household = useHousehold();
  const peopleCount = Math.max(1, household?.members?.length ?? 1);
  // Names for the drill-in's payee column. Resolved here rather than in
  // `useSpendingReport`, which reads the ledger and the plan's own arrangement and
  // nothing else — a payee's name is not money, and the hook stays about money.
  const { payeeById } = usePayees();
  const payeeName = useCallback((payeeId) => payeeById.get(payeeId)?.name ?? null, [payeeById]);
  // The diagram's table twin reads the full four columns whatever width the
  // chart was drawn at, so a phone that folded the categories away still has
  // every band as a row.
  const flows = useMemo(() => sankeyFlows(report, { payeeName }), [report, payeeName]);
  // Every band as a row, led by who paid the income — the one figure the
  // diagram keeps in a read-out rather than drawing, so the table has it too.
  const flowRows = useMemo(() => {
    if (!flows) return [];
    const labelOf = new Map(flows.nodes.map((node) => [node.id, node.label]));
    const income = flows.nodes.find((node) => node.id === "income");
    return [
      ...income.payers.map((payer) => ({
        from: payer.label,
        to: income.label,
        valueCents: payer.valueCents,
      })),
      ...flows.links.map((band) => ({
        from: labelOf.get(band.source),
        to: labelOf.get(band.target),
        valueCents: band.valueCents,
      })),
    ];
  }, [flows]);
  const coverage = coverageNote(report);
  // Which buckets the plan-against-books table needs a column for: the ones
  // that moved money somewhere in the window, carrying the index they sit at in
  // every month's own fixed list. A household that files everything under two
  // buckets should not read three empty columns, and the index travels with the
  // entry so a filtered header cannot drift out of step with the cells under it.
  const bucketColumns = (report.series[0]?.buckets ?? [])
    .map((bucket, index) => ({ ...bucket, index }))
    .filter((bucket) =>
      report.series.some((month) => month.buckets[bucket.index].netSpentCents !== 0)
    );
  // A category can drop out of the ranking entirely when the range moves — it
  // simply did not spend in the new window — so the selection is resolved
  // against the current rows rather than trusted to still name one.
  const selectedRow = report.rows.find((row) => row.budgetId === selectedBudgetId) ?? null;

  function toggleCategory(budgetId) {
    setSelectedBudgetId((current) => (current === budgetId ? null : budgetId));
  }

  return (
    <>
      <PageHeader
        title="Spending reports"
        description="See income, spending, and category trends across months."
        actions={
          <div className="flex flex-col items-end gap-2">
            <SegmentedControl
              label="How far back the report reaches"
              options={REPORT_RANGES.map((range) => ({ value: range.key, label: range.label }))}
              value={rangeKey}
              onChange={setRangeKey}
            />
            {/* Revealed by the option it belongs to rather than standing beside
                it always: while a preset is in force these two fields are not
                what the page is reading, and a control showing figures nothing
                on screen depends on is worse than no control. Each bounds the
                other, so the window cannot be typed backwards. */}
            {custom && (
              <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
                <MonthField
                  id="report-from"
                  label="From"
                  value={chosenStart}
                  max={chosenEnd}
                  onChange={setChosenStart}
                />
                <MonthField
                  id="report-to"
                  label="To"
                  value={chosenEnd}
                  min={chosenStart}
                  onChange={setChosenEnd}
                />
              </div>
            )}
          </div>
        }
      />

      {!report.hasLedger ? (
        <section className="overflow-hidden rounded-2xl border border-edge bg-panel">
          <p className="px-4 py-5 font-sans text-row text-chalk-soft">
            Nothing has been recorded yet.{" "}
            <Link
              to="/transactions"
              className="text-azure underline underline-offset-2 hover:text-chalk"
            >
              Start the register
            </Link>{" "}
            — every report here is the ledger read back, so the first month of entries is the first
            month there is anything to say.
          </p>
        </section>
      ) : (
        <div className="space-y-4">
          <ReportWidgetLayout>
          <div data-widget-id="summary"><ReportSummary report={report} peopleCount={peopleCount} /></div>
          <section data-widget-id="calendar" className="overflow-hidden rounded-2xl border border-edge bg-panel">
            <CashflowCalendarWidget report={report} />
          </section>
          <section data-widget-id="scheduled" className="overflow-hidden rounded-2xl border border-edge bg-panel">
            <div className="border-b border-edge px-4 py-3">
              <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">
                Scheduled and other spending
              </h2>
            </div>
            <dl className="grid gap-px bg-edge sm:grid-cols-2">
              <div className="bg-panel px-4 py-3">
                <dt className="text-label uppercase text-chalk-soft">Recorded from a schedule</dt>
                <dd className="mt-1 font-mono text-lg tabular-nums text-chalk">{formatCents(report.scheduledNetSpentCents)}</dd>
              </div>
              <div className="bg-panel px-4 py-3">
                <dt className="text-label uppercase text-chalk-soft">Other spending</dt>
                <dd className="mt-1 font-mono text-lg tabular-nums text-chalk">{formatCents(report.otherNetSpentCents)}</dd>
              </div>
            </dl>
            <p className="border-t border-edge px-4 py-3 font-sans text-row text-chalk-soft">
              The scheduled figure counts payments recorded from a schedule reminder; other spending includes discretionary purchases and recurring charges recorded another way. Existing ledger entries are not reclassified. Schedule reminders do not debit accounts automatically.
            </p>
          </section>

          {(coverage || report.undatedCount > 0) && (
            <div className="space-y-2">
              {coverage && (
                <p className="rounded-lg border border-edge bg-panel px-4 py-3 font-sans text-row text-chalk-soft">
                  {coverage}
                </p>
              )}
              {/* Money the report cannot place. An undated record belongs to no
                  month, so putting it in one would invent the history the books
                  deliberately refuse to invent — but a figure missing from a
                  chart has to be visible as missing rather than left for the
                  reader to find against the register. */}
              {report.undatedCount > 0 && (
                <p className="rounded-lg border border-sulfur/50 bg-panel px-4 py-3 font-sans text-row text-chalk-soft">
                  <span className="font-medium text-sulfur">
                    {report.undatedCount}{" "}
                    {report.undatedCount === 1 ? "record has" : "records have"} no date
                  </span>{" "}
                  — {formatCents(report.undatedSpentCents)} of spending and{" "}
                  {formatCents(report.undatedIncomeCents)} of income — so they are in no month and
                  in nothing below.{" "}
                  <Link
                    to="/transactions"
                    className="text-azure underline underline-offset-2 hover:text-chalk"
                  >
                    Date them on the register
                  </Link>{" "}
                  and they will appear here.
                </p>
              )}
            </div>
          )}

          <section data-widget-id="month" className="overflow-hidden rounded-2xl border border-edge bg-panel">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-edge px-4 py-3">
              <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">
                Month by month
              </h2>
              <SegmentedControl
                label="Chart style for month by month"
                options={[
                  { value: "bars", label: "Bars" },
                  { value: "lines", label: "Lines" },
                ]}
                value={cashflowView}
                onChange={setCashflowView}
              />
            </div>

            <WithWidgetHeight widgetId="month" defaultTier="md" render={(chartHeight) =>
              cashflowView === "bars" ? (
                <CashflowChart
                  series={report.series}
                  coverageStartPeriod={report.coverageStartPeriod}
                  coverageEndPeriod={report.coverageEndPeriod}
                  chartHeight={chartHeight}
                />
              ) : (
                <CashflowLineChart
                  series={report.series}
                  coverageStartPeriod={report.coverageStartPeriod}
                  coverageEndPeriod={report.coverageEndPeriod}
                  chartHeight={chartHeight}
                />
              )
            } />

            {/* The chart's table twin. Every figure it draws is also readable
                here, which is what makes the colour encoding safe — and what
                stops the read-out being the only route to a value. A decade of
                rows scrolls inside the card rather than pushing the page down,
                so the header stays put and every column keeps its name. */}
            <details className="border-t border-edge">
              <summary className="cursor-pointer px-4 py-2.5 text-label uppercase text-chalk-soft transition-colors hover:text-chalk">
                Show these figures as a table
              </summary>
              <div className="max-h-[30rem] overflow-auto border-t border-edge">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th
                        scope="col"
                        className="sticky top-0 z-10 bg-panel-raised px-4 py-2 text-left text-label uppercase text-chalk"
                      >
                        Month
                      </th>
                      {["Income", "Spending", "Refunded", "Net"].map((label) => (
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
                    {report.series.map((month, index) => (
                      <tr
                        key={month.period}
                        className={index % 2 === 0 ? "bg-sheet" : "bg-sheet-alt"}
                      >
                        <th
                          scope="row"
                          className="whitespace-nowrap px-4 py-2 text-left font-sans text-row font-normal text-ink"
                        >
                          {formatPeriod(month.period)}
                        </th>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-row tabular-nums text-ink">
                          {formatCents(month.incomeCents)}
                        </td>
                        {/* Net of refunds, as the chart draws it — the gross
                            figure is the column beside it, so the row shows its
                            own arithmetic rather than asking to be trusted. */}
                        <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-row tabular-nums text-ink">
                          {formatCents(month.netSpentCents)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-row tabular-nums text-ink-soft">
                          {month.refundCents === 0 ? "—" : formatCents(month.refundCents)}
                        </td>
                        <td
                          className={`whitespace-nowrap px-3 py-2 text-right font-mono text-row font-medium tabular-nums ${
                            month.netCents < 0 ? "text-vermilion-ink" : "text-ink"
                          }`}
                        >
                          {formatCents(month.netCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-panel-raised">
                      <th
                        scope="row"
                        className="px-4 py-2 text-left text-label uppercase text-chalk"
                      >
                        {report.months.length} months
                      </th>
                      {[
                        report.totalIncomeCents,
                        report.netSpentCents,
                        report.totalRefundCents,
                        report.netCents,
                      ].map((cents, index) => (
                        <td
                          key={index}
                          className="whitespace-nowrap px-3 py-2 text-right font-mono text-row font-medium tabular-nums text-chalk"
                        >
                          {formatCents(cents)}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </details>
          </section>

          {/* The time axis one step finer than the chart above: when inside
              each month the money went, which no monthly total can show. */}
          <section data-widget-id="heatmap" className="overflow-hidden rounded-2xl border border-edge bg-panel">
            <SpendingHeatmap report={report} payeeName={payeeName} />
          </section>

          <section data-widget-id="savings-rate" className="overflow-hidden rounded-2xl border border-edge bg-panel">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-edge px-4 py-3">
              <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">
                Savings rate
              </h2>
              {report.savingsRateBps != null && (
                <span className="text-label uppercase text-chalk-soft">
                  {Math.round(report.savingsRateBps / 100)}% over the window
                </span>
              )}
            </div>
            <WithWidgetHeight widgetId="savings-rate" defaultTier="sm" render={(chartHeight) =>
              <SavingsRateChart
                series={report.series}
                coverageStartPeriod={report.coverageStartPeriod}
                coverageEndPeriod={report.coverageEndPeriod}
                averageRatePct={
                  report.savingsRateBps != null ? report.savingsRateBps / 100 : null
                }
                chartHeight={chartHeight}
              />
            } />
          </section>

          <div data-widget-id="income">
            <IncomeBySourceTable report={report} payeeName={payeeName} />
          </div>

          {/* The window collapsed to one flow: where the money came from and
              where it went, in proportion. The chart above is the time axis and
              the ranking below is the category axis; this is the one view of
              the whole window at once, and the only one that shows each answer
              as a share of everything that came in. */}
          <section data-widget-id="flows" className="overflow-hidden rounded-2xl border border-edge bg-panel">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-edge px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">
                  Where it came from, where it went
                </h2>
                {flowsView === "sankey" && flows && (
                  <span className="text-label uppercase text-chalk-soft">
                    {flows.shortfallCents > 0
                      ? `${formatCents(flows.shortfallCents)} spent beyond income`
                      : `${formatCents(flows.keptCents)} kept`}
                  </span>
                )}
              </div>
              <SegmentedControl
                label="Chart style for flows"
                options={[
                  { value: "sankey", label: "Sankey" },
                  { value: "pie", label: "Pie" },
                ]}
                value={flowsView}
                onChange={setFlowsView}
              />
            </div>

            {flowsView === "sankey" ? (
              <CashflowSankey report={report} payeeName={payeeName} />
            ) : (
              <SpendingDonutChart report={report} />
            )}

            {flowsView === "sankey" && flows && (
              <details className="border-t border-edge">
                <summary className="cursor-pointer px-4 py-2.5 text-label uppercase text-chalk-soft transition-colors hover:text-chalk">
                  Show the flows as a table
                </summary>
                <div className="max-h-[30rem] overflow-auto border-t border-edge">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr>
                        {["From", "To"].map((label) => (
                          <th
                            key={label}
                            scope="col"
                            className="sticky top-0 z-10 bg-panel-raised px-4 py-2 text-left text-label uppercase text-chalk"
                          >
                            {label}
                          </th>
                        ))}
                        {["Amount", "Of money in"].map((label) => (
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
                      {flowRows.map((band, index) => (
                        <tr
                          key={`${band.from}>${band.to}`}
                          className={index % 2 === 0 ? "bg-sheet" : "bg-sheet-alt"}
                        >
                          <td className="px-4 py-2 text-left font-sans text-row text-ink">
                            {band.from}
                          </td>
                          <th
                            scope="row"
                            className="px-4 py-2 text-left font-sans text-row font-normal text-ink"
                          >
                            {band.to}
                          </th>
                          <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-row tabular-nums text-ink">
                            {formatCents(band.valueCents)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-row tabular-nums text-ink-soft">
                            {Math.round((band.valueCents / flows.totalCents) * 100)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </section>

          {/* The second chart on the page, and it cuts the same months along a
              third axis: the first one is the household against itself (what
              came in against what went out), this one is the household against
              its own plan. Neither answers the other's question — a month can
              be comfortably in the black and still be nothing like the plan it
              was supposed to be, which is precisely the month a budget exists
              to catch. */}
          <section data-widget-id="plan" className="overflow-hidden rounded-2xl border border-edge bg-panel">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-edge px-4 py-3">
              <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">
                Against the plan
              </h2>
              <span className="text-label uppercase text-chalk-soft">
                {report.plannedCents > 0
                  ? `${formatCents(report.plannedCents)} planned a month`
                  : "No estimates set"}
              </span>
            </div>

            {/* A plan of nothing is not a plan to spend nothing — it is a plan
                nobody has written — so the chart is still worth drawing for its
                bucket split and the threshold is simply left off. The sentence
                says which, and where to go to fix it. */}
            {report.plannedCents === 0 && (
              <p className="border-b border-edge px-4 py-3 font-sans text-row text-chalk-soft">
                No category has a monthly estimate yet, so there is no plan to draw against the
                columns below.{" "}
                <Link to="/plan" className="text-azure underline underline-offset-2 hover:text-chalk">
                  Set estimates on the plan
                </Link>{" "}
                and the line appears here.
              </p>
            )}

            {/* The window can reach back further than the ledger does, and a
                custom one can run past today. Either way those columns are empty
                because nothing was written down or because the month has not
                happened — not because nothing was spent — so the chart is told
                both ends of what the books cover and withholds a verdict outside
                them rather than reporting months the household came in under. */}
            <WithWidgetHeight widgetId="plan" defaultTier="md" render={(chartHeight) =>
              <PlanVsActualChart
                series={report.series}
                plannedCents={report.plannedCents}
                coverageStartPeriod={report.coverageStartPeriod}
                coverageEndPeriod={report.coverageEndPeriod}
                chartHeight={chartHeight}
              />
            } />

            {/* The chart's table twin, as the cashflow chart has — the colour
                encoding is only safe while every figure it draws is also
                readable as a figure.

                It is named for what it holds rather than sharing the cashflow
                table's wording, because two controls reading "Show these
                figures as a table" on one page are two controls a reader
                tabbing between them cannot tell apart. */}
            <details className="border-t border-edge">
              <summary className="cursor-pointer px-4 py-2.5 text-label uppercase text-chalk-soft transition-colors hover:text-chalk">
                Show the plan comparison as a table
              </summary>
              <div className="max-h-[30rem] overflow-auto border-t border-edge">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th
                        scope="col"
                        className="sticky top-0 z-10 bg-panel-raised px-4 py-2 text-left text-label uppercase text-chalk"
                      >
                        Month
                      </th>
                      {/* The buckets that appear anywhere in the window, in the
                          plan's own order — read off the first month's list,
                          which `useSpendingReport` builds as a fixed list in a
                          fixed order precisely so it can be indexed like this. */}
                      {bucketColumns.map((bucket) => (
                        <th
                          key={bucket.key}
                          scope="col"
                          className="sticky top-0 z-10 whitespace-nowrap bg-panel-raised px-3 py-2 text-right text-label uppercase text-chalk"
                        >
                          {bucket.label}
                        </th>
                      ))}
                      {["Spent", "Vs plan"].map((label) => (
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
                    {report.series.map((month, index) => {
                      const overCents = month.netSpentCents - report.plannedCents;
                      // The same withholding the chart does: a month the books
                      // do not reach gets no verdict, here or there.
                      const measurable =
                        report.plannedCents > 0 &&
                        periodLTE(report.coverageStartPeriod, month.period) &&
                        periodLTE(month.period, report.coverageEndPeriod);
                      return (
                        <tr
                          key={month.period}
                          className={index % 2 === 0 ? "bg-sheet" : "bg-sheet-alt"}
                        >
                          <th
                            scope="row"
                            className="whitespace-nowrap px-4 py-2 text-left font-sans text-row font-normal text-ink"
                          >
                            {formatPeriod(month.period)}
                          </th>
                          {bucketColumns.map((bucket) => {
                            const cents = month.buckets[bucket.index].netSpentCents;
                            return (
                              <td
                                key={bucket.key}
                                className="whitespace-nowrap px-3 py-2 text-right font-mono text-row tabular-nums text-ink-soft"
                              >
                                {cents === 0 ? "—" : formatCents(cents)}
                              </td>
                            );
                          })}
                          <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-row font-medium tabular-nums text-ink">
                            {formatCents(month.netSpentCents)}
                          </td>
                          {/* A dash rather than a figure wherever there is
                              nothing to measure: no plan to measure against
                              ("over by everything" is a reading of an empty
                              plan, not of a month) or no records in the month
                              to measure. */}
                          <td
                            className={`whitespace-nowrap px-3 py-2 text-right font-mono text-row tabular-nums ${
                              measurable && overCents > 0
                                ? "font-medium text-vermilion-ink"
                                : "text-ink-soft"
                            }`}
                          >
                            {measurable
                              ? `${overCents > 0 ? "+" : ""}${formatCents(overCents)}`
                              : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          </section>

          <div data-widget-id="categories">
            <SpendingByCategoryTable
              report={report}
              selectedBudgetId={selectedBudgetId}
              onSelectCategory={toggleCategory}
            />

          {selectedRow && (
            <CategoryDetailPanel
              row={selectedRow}
              months={report.months}
              coverageStartPeriod={report.coverageStartPeriod}
              coverageEndPeriod={report.coverageEndPeriod}
              accounts={accounts}
              payeeById={payeeById}
              onClose={() => setSelectedBudgetId(null)}
            />
          )}
          </div>

          </ReportWidgetLayout>

        </div>
      )}
    </>
  );
}
