import { useState } from "react";
import { Link } from "react-router-dom";
import CashflowChart from "../components/CashflowChart";
import CategoryDetailPanel from "../components/CategoryDetailPanel";
import PageHeader from "../components/PageHeader";
import Placeholder from "../components/Placeholder";
import PlanVsActualChart from "../components/PlanVsActualChart";
import ReportSummary from "../components/ReportSummary";
import SegmentedControl from "../components/SegmentedControl";
import SpendingByCategoryTable from "../components/SpendingByCategoryTable";
import { useAccounts } from "../contexts/AccountsContext";
import { usePayees } from "../contexts/PayeesContext";
import useSpendingReport, {
  CUSTOM_REPORT_RANGE,
  DEFAULT_REPORT_RANGE,
  REPORT_RANGES,
} from "../hooks/useSpendingReport";
import { addMonths, currentPeriod, formatCents, formatPeriod, periodLTE } from "../utils";

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
 * divisor under every per-month figure. Five of its six options answer "how far
 * back" and run to the current month, which is why the last column is usually a
 * month still in progress.
 *
 * **"Custom" is the sixth, and it is the only one that names both ends.** It
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
      <span className="font-mono text-label uppercase text-chalk-soft">{label}</span>
      <input
        id={id}
        type="month"
        value={value}
        min={min}
        max={max}
        onChange={(event) => onChange(event.target.value)}
        className="border border-edge bg-panel-raised px-2 py-1 font-mono text-label uppercase text-chalk outline-none transition-colors focus:border-azure"
      />
    </label>
  );
}

export default function ReportsPage() {
  const [rangeKey, setRangeKey] = useState(DEFAULT_REPORT_RANGE);
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
  // Names for the drill-in's payee column. Resolved here rather than in
  // `useSpendingReport`, which reads the ledger and the plan's own arrangement and
  // nothing else — a payee's name is not money, and the hook stays about money.
  const { payeeById } = usePayees();
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
        eyebrow="Analysis"
        title="Spending reports"
        description="What came in, what went out, and where it went — read over a run of months rather than one. Per-month figures spread the whole window evenly, so a premium paid once a year sits beside the rent as the monthly rate it really is."
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
        <section className="border border-edge bg-panel">
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
          <ReportSummary report={report} />

          {(coverage || report.undatedCount > 0) && (
            <div className="space-y-2">
              {coverage && (
                <p className="border border-edge bg-panel px-4 py-3 font-sans text-row text-chalk-soft">
                  {coverage}
                </p>
              )}
              {/* Money the report cannot place. An undated record belongs to no
                  month, so putting it in one would invent the history the books
                  deliberately refuse to invent — but a figure missing from a
                  chart has to be visible as missing rather than left for the
                  reader to find against the register. */}
              {report.undatedCount > 0 && (
                <p className="border border-sulfur/50 bg-panel px-4 py-3 font-sans text-row text-chalk-soft">
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

          <section className="border border-edge bg-panel">
            {/* No span of months in the corner, unlike the net-worth chart's
                header: there the summary above is one month and the chart is a
                window, so the window has to be named. Here the summary *is* the
                window, and printing the same two months a second time on the
                same screen makes a reader stop and check whether they differ. */}
            <div className="border-b border-edge px-4 py-3">
              <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">
                Month by month
              </h2>
            </div>

            {/* Told the same two ends the plan chart below is told, and for the
                one thing a line can get wrong that a column cannot: a column of
                zero is a sum, while a *line* through a month nobody recorded —
                or has not lived — claims the household broke even in it. */}
            <CashflowChart
              series={report.series}
              coverageStartPeriod={report.coverageStartPeriod}
              coverageEndPeriod={report.coverageEndPeriod}
            />

            {/* The chart's table twin. Every figure it draws is also readable
                here, which is what makes the colour encoding safe — and what
                stops the read-out being the only route to a value. A decade of
                rows scrolls inside the card rather than pushing the page down,
                so the header stays put and every column keeps its name. */}
            <details className="border-t border-edge">
              <summary className="cursor-pointer px-4 py-2.5 font-mono text-label uppercase text-chalk-soft transition-colors hover:text-chalk">
                Show these figures as a table
              </summary>
              <div className="max-h-[30rem] overflow-auto border-t border-edge">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th
                        scope="col"
                        className="sticky top-0 z-10 bg-panel-raised px-4 py-2 text-left font-mono text-label uppercase text-chalk"
                      >
                        Month
                      </th>
                      {["Income", "Spending", "Refunded", "Net"].map((label) => (
                        <th
                          key={label}
                          scope="col"
                          className="sticky top-0 z-10 whitespace-nowrap bg-panel-raised px-3 py-2 text-right font-mono text-label uppercase text-chalk"
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
                        className="px-4 py-2 text-left font-mono text-label uppercase text-chalk"
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

          {/* The second chart on the page, and it cuts the same months along a
              third axis: the first one is the household against itself (what
              came in against what went out), this one is the household against
              its own plan. Neither answers the other's question — a month can
              be comfortably in the black and still be nothing like the plan it
              was supposed to be, which is precisely the month a budget exists
              to catch. */}
          <section className="border border-edge bg-panel">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-edge px-4 py-3">
              <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">
                Against the plan
              </h2>
              <span className="font-mono text-label uppercase text-chalk-soft">
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
            <PlanVsActualChart
              series={report.series}
              plannedCents={report.plannedCents}
              coverageStartPeriod={report.coverageStartPeriod}
              coverageEndPeriod={report.coverageEndPeriod}
            />

            {/* The chart's table twin, as the cashflow chart has — the colour
                encoding is only safe while every figure it draws is also
                readable as a figure.

                It is named for what it holds rather than sharing the cashflow
                table's wording, because two controls reading "Show these
                figures as a table" on one page are two controls a reader
                tabbing between them cannot tell apart. */}
            <details className="border-t border-edge">
              <summary className="cursor-pointer px-4 py-2.5 font-mono text-label uppercase text-chalk-soft transition-colors hover:text-chalk">
                Show the plan comparison as a table
              </summary>
              <div className="max-h-[30rem] overflow-auto border-t border-edge">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th
                        scope="col"
                        className="sticky top-0 z-10 bg-panel-raised px-4 py-2 text-left font-mono text-label uppercase text-chalk"
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
                          className="sticky top-0 z-10 whitespace-nowrap bg-panel-raised px-3 py-2 text-right font-mono text-label uppercase text-chalk"
                        >
                          {bucket.label}
                        </th>
                      ))}
                      {["Spent", "Vs plan"].map((label) => (
                        <th
                          key={label}
                          scope="col"
                          className="sticky top-0 z-10 whitespace-nowrap bg-panel-raised px-3 py-2 text-right font-mono text-label uppercase text-chalk"
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

          <Placeholder
            title="Still to come"
            items={[
              "Filter by whether a transaction is recurring",
              "Export the underlying rows as CSV",
            ]}
          />
        </div>
      )}
    </>
  );
}
