import { useMemo, useState } from "react";
import { useSchedules } from "../contexts/SchedulesContext";
import { TRANSACTION_KINDS, useTransactions } from "../contexts/TransactionsContext";
import { PLAN_BUCKETS, useBudgets } from "../contexts/BudgetsContext";
import { occurrencesBetween } from "../domain/recurrence";
import useAccountBalances from "../hooks/useAccountBalances";
import {
  addMonths,
  addDays,
  currentPeriod,
  daysBetween,
  formatCents,
  formatDateMedium,
  formatPeriod,
  periodEnd,
  todayISO,
} from "../utils";

/**
 * Forward-looking cashflow projection built entirely from schedules.
 *
 * The rest of the reports page looks backward — what the books have recorded.
 * This widget looks forward: given what is already scheduled, what will each
 * of the next twelve months bring in and send out, and how does today's
 * on-budget balance evolve through it?
 *
 * **Schedules only, not predictions.** The running balance is pure accounting
 * of what is already on the books as expected — rent, salary, subscriptions —
 * not a forecast of discretionary spending. That distinction is stated in the
 * footer so a household does not read the running figure as a promise. The
 * historical average from the report is carried separately as a runway figure
 * that accounts for spending filed under categories marked Essentials.
 *
 * **Starts from next month.** Today's on-budget balance already includes every
 * transaction recorded in the current month. Projecting scheduled items for the
 * current month on top of that balance would count them twice — once through
 * the actual transactions that may already be in the ledger, and again through
 * the schedule. Starting from next month avoids that entirely.
 */

/** Months of scheduled cashflow to show ahead of today. */
const PROJECTION_MONTHS = 12;
const WEEK_COUNT = 8;

function historicalEssentialCents(transactions, essentialBudgetIds, period, excludedIds = new Set()) {
  let total = 0;
  for (const transaction of transactions) {
    if (transaction.kind !== TRANSACTION_KINDS.OUTFLOW || transaction.date?.slice(0, 7) !== period || excludedIds.has(transaction.id)) continue;
    const cents = Array.isArray(transaction.splits) && transaction.splits.length
      ? transaction.splits.reduce((sum, part) => sum + (essentialBudgetIds.has(part.budgetId) ? part.amountCents : 0), 0)
      : essentialBudgetIds.has(transaction.budgetId) ? transaction.amountCents : 0;
    total += cents;
  }
  return total;
}

export default function CashflowCalendarWidget({ report }) {
  const { schedules } = useSchedules();
  const { transactions } = useTransactions();
  const { budgets } = useBudgets();
  // Read once so today and all derived figures stay in agreement throughout.
  const [today] = useState(currentPeriod);
  const [currentDate] = useState(todayISO);
  const [view, setView] = useState("weeks");
  // On-budget balance as of the current period — the figure the running
  // balance projection starts from, and the same one the dashboard shows.
  const accountBalances = useAccountBalances(today);

  // Estimate ordinary spending from the six most recent complete months.
  // Partial activity in the current month is excluded.
  const history = useMemo(() => {
    const periods = Array.from({ length: 6 }, (_, index) => addMonths(today, -(index + 1)));
    const sums = new Map(periods.map((period) => [period, 0]));
    const essentialBudgetIds = new Set(budgets
      .filter((budget) => budget.bucket === PLAN_BUCKETS.ESSENTIALS)
      .map((budget) => budget.id));
    const scheduledTransactionIds = new Set(schedules.flatMap((schedule) =>
      Object.values(schedule.occurrenceDecisions ?? {})
        .map((decision) => decision.transactionId)
        .filter(Boolean)
    ));
    for (const transaction of transactions) {
      if (transaction.kind !== TRANSACTION_KINDS.OUTFLOW || !transaction.date || scheduledTransactionIds.has(transaction.id)) continue;
      const period = transaction.date.slice(0, 7);
      if (!sums.has(period)) continue;
      const essentialCents = Array.isArray(transaction.splits) && transaction.splits.length
        ? transaction.splits.reduce((sum, part) => sum + (essentialBudgetIds.has(part.budgetId) ? part.amountCents : 0), 0)
        : essentialBudgetIds.has(transaction.budgetId) ? transaction.amountCents : 0;
      if (essentialCents > 0) sums.set(period, sums.get(period) + essentialCents);
    }
    return {
      monthlyCents: Math.round([...sums.values()].reduce((sum, amount) => sum + amount, 0) / periods.length),
      months: [...sums.values()].filter((amount) => amount > 0).length,
      essentialBudgetIds,
      sums,
    };
  }, [transactions, schedules, budgets, today]);

  // Repeated annual purchases are known irregular costs: they have no schedule,
  // but two similar payments about a year apart are enough to place a cautious
  // estimate on the next anniversary.
  const irregulars = useMemo(() => {
    const linkedIds = new Set(schedules.flatMap((schedule) =>
      Object.values(schedule.occurrenceDecisions ?? {}).map((decision) => decision.transactionId).filter(Boolean)));
    const byPayee = new Map();
    for (const transaction of transactions) {
      if (transaction.kind !== TRANSACTION_KINDS.OUTFLOW || !transaction.payeeId || !transaction.date ||
          transaction.date > currentDate || linkedIds.has(transaction.id)) continue;
      const list = byPayee.get(transaction.payeeId) ?? [];
      list.push(transaction);
      byPayee.set(transaction.payeeId, list);
    }
    const found = [];
    for (const history of byPayee.values()) {
      history.sort((a, b) => a.date.localeCompare(b.date));
      const last = history[history.length - 1];
      const previous = history[history.length - 2];
      if (!previous || daysBetween(previous.date, last.date) < 300 || daysBetween(previous.date, last.date) > 430) continue;
      const cents = Math.round((last.amountCents + previous.amountCents) / 2);
      if (Math.abs(last.amountCents - previous.amountCents) > cents * 0.25) continue;
      let anniversaryPeriod = addMonths(last.date.slice(0, 7), 12);
      let day = Math.min(Number(last.date.slice(8)), Number(periodEnd(anniversaryPeriod).slice(8)));
      let date = `${anniversaryPeriod}-${String(day).padStart(2, "0")}`;
      while (date <= currentDate) {
        anniversaryPeriod = addMonths(anniversaryPeriod, 12);
        day = Math.min(Number(last.date.slice(8)), Number(periodEnd(anniversaryPeriod).slice(8)));
        date = `${anniversaryPeriod}-${String(day).padStart(2, "0")}`;
      }
      found.push({ date, amountCents: cents, payeeId: last.payeeId, description: last.description || "Annual expense" });
    }
    return found;
  }, [transactions, schedules, currentDate]);

  // Backtest each complete month against the preceding six-month average. This
  // gives the reader a concrete measure of how well the essential estimate has
  // tracked their own spending.
  const accuracy = useMemo(() => {
    const errors = [];
    const linkedIds = new Set(schedules.flatMap((schedule) =>
      Object.values(schedule.occurrenceDecisions ?? {}).map((decision) => decision.transactionId).filter(Boolean)));
    for (let offset = 1; offset <= 6; offset += 1) {
      const target = addMonths(today, -offset);
      const prior = Array.from({ length: 6 }, (_, index) => addMonths(target, -(index + 1)));
      const priorAmounts = prior.map((period) => historicalEssentialCents(transactions, history.essentialBudgetIds, period, linkedIds));
      if (priorAmounts.filter((amount) => amount > 0).length < 2) continue;
      const estimate = Math.round(priorAmounts.reduce((sum, amount) => sum + amount, 0) / 6);
      const actual = historicalEssentialCents(transactions, history.essentialBudgetIds, target, linkedIds);
      errors.push(Math.abs(actual - estimate));
    }
    return errors.length ? {
      averageErrorCents: Math.round(errors.reduce((sum, value) => sum + value, 0) / errors.length),
      samples: errors.length,
    } : null;
  }, [today, history, transactions, schedules]);

  const projection = useMemo(() => {
    const startBalance = accountBalances.onBudgetCents;
    let runningBalance = startBalance;
    const months = [];

    for (let i = 1; i <= PROJECTION_MONTHS; i++) {
      const period = addMonths(today, i);
      const from = `${period}-01`;
      const to = periodEnd(period);

      let scheduledIncomeCents = 0;
      let scheduledExpenseCents = 0;
      const irregularExpenseCents = irregulars
        .filter((expense) => expense.date.startsWith(period))
        .reduce((sum, expense) => sum + expense.amountCents, 0);

      for (const schedule of schedules) {
        const occurrences = occurrencesBetween(schedule, from, to);
        for (let occurrenceIndex = 0; occurrenceIndex < occurrences.length; occurrenceIndex += 1) {
          if (schedule.kind === TRANSACTION_KINDS.INFLOW) {
            scheduledIncomeCents += schedule.amountCents;
          } else {
            scheduledExpenseCents += schedule.amountCents;
          }
        }
      }

      const scheduledNetCents = scheduledIncomeCents - scheduledExpenseCents;
      const estimatedEssentialExpenseCents = history.months >= 2 ? history.monthlyCents : 0;
      runningBalance += scheduledNetCents - estimatedEssentialExpenseCents - irregularExpenseCents;

      months.push({
        period,
        scheduledIncomeCents,
        scheduledExpenseCents,
        estimatedEssentialExpenseCents,
        irregularExpenseCents,
        scheduledNetCents,
        runningBalanceCents: runningBalance,
      });
    }

    const daily = [];
    let dailyBalance = startBalance;
    const fromDate = addDays(currentDate, 1);
    const throughDate = addDays(fromDate, PROJECTION_MONTHS * 31);
    for (let date = fromDate; date <= throughDate; date = addDays(date, 1)) {
      let income = 0;
      let expense = 0;
      for (const schedule of schedules) {
        if (!occurrencesBetween(schedule, date, date).length) continue;
        if (schedule.kind === TRANSACTION_KINDS.INFLOW) income += schedule.amountCents;
        else expense += schedule.amountCents;
      }
      const irregular = irregulars.filter((item) => item.date === date).reduce((sum, item) => sum + item.amountCents, 0);
      const essentials = history.months >= 2 ? Math.round(history.monthlyCents / 30.4375) : 0;
      dailyBalance += income - expense - irregular - essentials;
      daily.push({ date, balanceCents: dailyBalance, incomeCents: income, expenseCents: expense,
        essentialsCents: essentials, irregularCents: irregular });
    }
    const lowBalanceDate = startBalance < 0
      ? currentDate
      : daily.find((day) => day.balanceCents < 0)?.date ?? null;
    const weeks = Array.from({ length: WEEK_COUNT }, (_, index) => {
      const start = addDays(fromDate, index * 7);
      const end = addDays(start, 6);
      const slice = daily.filter((day) => day.date >= start && day.date <= end);
      return {
        start, end,
        scheduledIncomeCents: slice.reduce((sum, day) => sum + day.incomeCents, 0),
        scheduledExpenseCents: slice.reduce((sum, day) => sum + day.expenseCents, 0),
        estimatedEssentialExpenseCents: slice.reduce((sum, day) => sum + day.essentialsCents, 0),
        irregularExpenseCents: slice.reduce((sum, day) => sum + day.irregularCents, 0),
        runningBalanceCents: slice[slice.length - 1]?.balanceCents ?? dailyBalance,
      };
    });
    return { startBalance, months, weeks, lowBalanceDate };
  }, [schedules, accountBalances.onBudgetCents, today, currentDate, history, irregulars]);

  // Runway from the historical average monthly net. Null until there are at
  // least two covered months — a single month's net is too volatile to divide
  // by, and dividing by one is the one case where "per month" reads as the
  // period itself rather than a rate.
  const runway = useMemo(() => {
    if (!report || report.averagedOverMonths < 2) return null;
    const avgNetCents = report.averageNetCents;
    if (avgNetCents >= 0) return { sustainable: true };
    if (projection.startBalance <= 0) return { sustainable: false, months: 0 };
    return {
      sustainable: false,
      months: Math.floor(projection.startBalance / Math.abs(avgNetCents)),
    };
  }, [report, projection.startBalance]);

  const hasSchedules = schedules.length > 0;

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-edge px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">
            Cashflow calendar
          </h2>
          <span className="text-label uppercase text-chalk-soft">
            {formatCents(projection.startBalance)} on-budget today
          </span>
        </div>
        {runway != null && (
          <span
            className={`text-label uppercase ${
              runway.sustainable ? "text-chalk-soft" : "text-sulfur"
            }`}
          >
            {runway.sustainable
              ? "Positive cashflow trajectory"
              : runway.months === 0
              ? "Balance already depleted at historical rate"
              : `~${runway.months} month${runway.months === 1 ? "" : "s"} runway at historical rate`}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-edge px-4 py-2">
        <div className={`text-row ${projection.lowBalanceDate ? "text-vermilion-ink" : "text-chalk-soft"}`}>
          {projection.lowBalanceDate
            ? projection.lowBalanceDate === currentDate
              ? "On-budget balance is already below $0 today."
              : `Projected balance first falls below $0 on ${formatDateMedium(projection.lowBalanceDate)}.`
            : "Projected balance stays above $0 over the next 12 months."}
        </div>
        <div className="inline-flex rounded-lg border border-edge p-0.5" role="group" aria-label="Cashflow calendar view">
          {[{ id: "weeks", label: "Next 8 weeks" }, { id: "months", label: "12 months" }].map((option) => (
            <button key={option.id} type="button" aria-pressed={view === option.id}
              onClick={() => setView(option.id)}
              className={`rounded-md px-3 py-1 text-label uppercase ${view === option.id ? "bg-panel-raised text-chalk" : "text-chalk-soft hover:text-chalk"}`}>
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {!hasSchedules && irregulars.length === 0 && history.months < 2 ? (
        <p className="px-4 py-5 font-sans text-row text-chalk-soft">
          No schedules have been set up yet. Add recurring income and expense schedules on the plan
          page and they will be projected here month by month.
        </p>
      ) : (
        <div className="overflow-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th
                  scope="col"
                  className="bg-panel-raised px-4 py-2 text-left text-label uppercase text-chalk"
                >
                  {view === "weeks" ? "Week" : "Month"}
                </th>
                {(view === "weeks"
                  ? ["Scheduled in", "Scheduled out", "Est. essentials", "Known irregulars", "Projected balance"]
                  : ["Scheduled in", "Scheduled out", "Est. essentials", "Known irregulars", "Scheduled net", "Running balance"]
                ).map((label) => (
                  <th
                    key={label}
                    scope="col"
                    className="whitespace-nowrap bg-panel-raised px-3 py-2 text-right text-label uppercase text-chalk"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(view === "weeks" ? projection.weeks : projection.months).map((month, index) => (
                <tr key={view === "weeks" ? month.start : month.period} className={index % 2 === 0 ? "bg-sheet" : "bg-sheet-alt"}>
                  <th
                    scope="row"
                    className="whitespace-nowrap px-4 py-2 text-left font-sans text-row font-normal text-ink"
                  >
                    {view === "weeks" ? `${formatDateMedium(month.start)} – ${formatDateMedium(month.end)}` : formatPeriod(month.period)}
                  </th>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-row tabular-nums text-ink">
                    {view === "weeks" ? (month.scheduledIncomeCents ? formatCents(month.scheduledIncomeCents) : "—") : (month.scheduledIncomeCents === 0 ? "—" : formatCents(month.scheduledIncomeCents))}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-row tabular-nums text-ink">
                    {month.scheduledExpenseCents === 0
                      ? "—"
                      : formatCents(month.scheduledExpenseCents)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-row tabular-nums text-ink-soft">
                    {month.estimatedEssentialExpenseCents === 0 ? "—" : formatCents(month.estimatedEssentialExpenseCents)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-row tabular-nums text-ink-soft">
                    {month.irregularExpenseCents ? formatCents(month.irregularExpenseCents) : "—"}
                  </td>
                  {view === "months" && <td
                    className={`whitespace-nowrap px-3 py-2 text-right font-mono text-row font-medium tabular-nums ${
                      month.scheduledNetCents < 0
                        ? "text-vermilion-ink"
                        : month.scheduledNetCents > 0
                        ? "text-ink"
                        : "text-ink-soft"
                    }`}
                  >
                    {month.scheduledNetCents === 0 ? "—" : formatCents(month.scheduledNetCents)}
                  </td>}
                  <td
                    className={`whitespace-nowrap px-3 py-2 text-right font-mono text-row font-medium tabular-nums ${
                      month.runningBalanceCents < 0 ? "text-vermilion-ink" : "text-ink"
                    }`}
                  >
                    {formatCents(month.runningBalanceCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="border-t border-edge px-4 py-3 font-sans text-row text-chalk-soft">
        Running balance starts from today&apos;s on-budget total and applies scheduled income and
        expenses plus estimated essential spending from categories marked Essentials, based on the
        average of the six prior complete months. Scheduled payments linked to a recorded occurrence
        are excluded from that estimate.
        {history.months < 2 && " There is not enough essential spending history to estimate it yet."}
        {accuracy != null && <> Recent estimate accuracy: average error of {formatCents(accuracy.averageErrorCents)} per month across {accuracy.samples} backtested months.</>}
        {irregulars.length > 0 && <> Identified {irregulars.length} likely annual expense{irregulars.length === 1 ? "" : "s"} from similar past payments roughly a year apart; projections use their average amount.</>}
        {runway != null && !runway.sustainable && report && (
          <>
            {" "}
            The runway figure uses the historical average of{" "}
            {formatCents(Math.abs(report.averageNetCents))} per month over{" "}
            {report.averagedOverMonths} months and includes all spending.
          </>
        )}
      </p>
    </>
  );
}
