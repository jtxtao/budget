import { useState } from "react";
import CategoryLedgerTable from "../components/CategoryLedgerTable";
import DashboardSummary from "../components/DashboardSummary";
import EnterScheduledModal from "../components/EnterScheduledModal";
import MoveMoneyModal from "../components/MoveMoneyModal";
import PageHeader from "../components/PageHeader";
import ReconciliationList from "../components/ReconciliationList";
import UpcomingBills from "../components/UpcomingBills";
import { spendsThroughBudget, useAccounts } from "../contexts/AccountsContext";
import { useBudgets } from "../contexts/BudgetsContext";
import { usePayees } from "../contexts/PayeesContext";
import { useSchedules } from "../contexts/SchedulesContext";
import { TRANSACTION_KINDS, useTransactions } from "../contexts/TransactionsContext";
import useAccountBalances from "../hooks/useAccountBalances";
import useDashboard from "../hooks/useDashboard";
import useNextPaycheck from "../hooks/useNextPaycheck";
import useUpcoming from "../hooks/useUpcoming";
import { currentPeriod, daysBetween, formatDateLong, todayISO } from "../utils";

/**
 * Where the household stands today.
 *
 * The one page with no month selector on it, deliberately. Every other screen
 * either describes a typical month (Configuration) or lets the user walk back
 * through the books (Transactions); this one answers "where am I right now",
 * and a period stepper would turn it into a second, worse copy of the
 * Transactions page. Today's date is stated at the top for the same reason —
 * every figure below is as of that day, including the countdown, the
 * reconciliation ages and what is due next.
 *
 * **Two things are entered here, and both are confirmations rather than forms.**
 * Marking an account reconciled says the books and the bank agreed on a given day,
 * which is the one fact no ledger can derive. Recording a scheduled transaction
 * says a bill the household already knew about actually went out — and the place
 * to do that is the place it is shown as due, which is also the only place it is
 * shown as *late*. Neither invents anything: a schedule holds no money until the
 * user says the money moved.
 */
export default function DashboardPage() {
  // Read once, so the date in the header, the countdown, and every "days ago" on
  // the page are all measured from the same day. Two calls either side of
  // midnight would disagree.
  const today = todayISO();
  const period = currentPeriod();

  const { reconcileAccount, accounts } = useAccounts();
  const { budgets } = useBudgets();
  const { payeeById } = usePayees();
  const { addTransaction } = useTransactions();
  const { advanceSchedule } = useSchedules();
  const { rows: balanceRows } = useAccountBalances(period);
  const paycheck = useNextPaycheck(today);
  const dashboard = useDashboard(period);
  const upcoming = useUpcoming(today);
  // Which occurrence the confirmation is open on — the whole row, since the modal
  // needs both the schedule and the date it is about.
  const [entering, setEntering] = useState(null);
  const [scheduleError, setScheduleError] = useState(null);
  // The seed the move modal opens on, and the thing that says it is open at
  // all. Held in state rather than rebuilt per render because the modal stays
  // mounted and re-seeds off this object — a fresh literal every render would
  // reset the form under the user mid-type.
  const [moving, setMoving] = useState(null);

  // What there was to spend: money assigned in an earlier month and carried in
  // is just as spendable as money assigned this month, and so is money refunded
  // back into a category. Which is exactly what is left over plus what went out.
  const fundedCents = dashboard.totals.availableCents + dashboard.periodSpentCents;
  const categoryCount = dashboard.sections.reduce(
    (count, section) => count + section.rows.length,
    0
  );

  // Off-budget holdings sit on Net worth, not here: nothing on this page is
  // assigned out of them, and the dashboard's accounts panel is about what the
  // budget can spend.
  const accountRows = balanceRows
    .filter((row) => spendsThroughBudget(row.account))
    .map((row) => ({
      ...row,
      daysSince:
        row.account.reconciledOn == null ? null : daysBetween(row.account.reconciledOn, today),
    }));

  /**
   * A schedule's names, resolved here rather than in the panel or the hook.
   *
   * The hook is about the calendar and the store holds ids, which is the split
   * `useSpendingReport` already keeps for a payee: a display string is not money,
   * so it is assembled where the stores are in hand. Every reference on a schedule
   * is inert but kept, so each of the three can name something deleted and each
   * has to say so rather than falling back to the first option and looking
   * refiled.
   */
  function describeSchedule(schedule) {
    const payee = schedule.payeeId == null ? null : payeeById.get(schedule.payeeId);
    const account = accounts.find((entry) => entry.id === schedule.accountId);
    const budget = budgets.find((entry) => entry.id === schedule.budgetId);

    const name =
      payee?.name ??
      (schedule.payeeId != null
        ? "Unknown payee"
        : schedule.description || "Scheduled transaction");

    const filing = [
      account?.name ?? "Unknown account",
      schedule.budgetId == null
        ? schedule.kind === TRANSACTION_KINDS.INFLOW
          ? "Income"
          : null
        : budget?.name ?? "Unknown category",
    ]
      .filter(Boolean)
      .join(" · ");

    return { name, filing };
  }

  /**
   * Record the occurrence, then mark it dealt with.
   *
   * **The ledger is written first**, the order `AddDonationModal` and
   * `mergePayees` both take, and chosen here for which half is survivable alone: a
   * transaction that landed while the cursor did not move leaves the bill offered
   * a second time, which the user can see and refuse, where advancing first and
   * then failing the write would quietly retire a bill that was never recorded.
   *
   * The cursor is stamped with the **scheduled** date and not the one the user
   * typed. A bill due on the 1st and paid on the 3rd has had its 1st dealt with;
   * stamping the 3rd would swallow anything else falling in between.
   */
  function handleEnter({ amount, date, description }) {
    const { schedule } = entering;
    const result = addTransaction({
      kind: schedule.kind,
      payeeId: schedule.payeeId,
      description,
      amount,
      date,
      accountId: schedule.accountId,
      budgetId: schedule.budgetId,
    });
    if (!result.ok) return result;

    const advanced = advanceSchedule({ id: schedule.id, through: entering.date });
    // Reported on the page rather than swallowed: the money landed, so the modal
    // has done its job and closing it is right — but the bill will be offered
    // again, and the user has to know why.
    setScheduleError(
      advanced.ok
        ? null
        : "The transaction was recorded, but the schedule could not be updated — it may be offered again."
    );
    return { ok: true };
  }

  /**
   * Deal with an occurrence without recording anything.
   *
   * A month the gym was closed, a subscription cancelled after the schedule was
   * written, a bill paid in cash and not worth entering. It moves the cursor and
   * touches no money at all, which is the one thing a bill reminder has to be able
   * to do without lying about the books.
   */
  /**
   * Open the move on a category, with the direction read off its own figure.
   *
   * A row in the red is one somebody wants to *cover*, so it seeds as the
   * destination with the shortfall already typed in — the figure they were
   * looking at when they clicked. Any other row is one with money to spare, so
   * it seeds as the source. Stated on each button's label, so the rule is read
   * before the click rather than discovered after it. `null` is the header
   * button: no direction assumed, both selects empty.
   */
  function handleMove(row) {
    if (row == null) {
      setMoving({});
      return;
    }
    setMoving(
      row.availableCents < 0
        ? { toBudgetId: row.budgetId, amountCents: -row.availableCents }
        : { fromBudgetId: row.budgetId }
    );
  }

  function handleSkip(row) {
    const result = advanceSchedule({ id: row.schedule.id, through: row.date });
    setScheduleError(result.ok ? null : result.error);
  }

  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="Dashboard"
        description="What is left to budget, what this month has done, what is due next, and when the next paycheck lands."
        actions={
          <div className="text-right">
            <div className="font-mono text-label uppercase text-chalk-soft">Today</div>
            <div className="mt-0.5 font-sans text-sm font-medium text-chalk">
              {formatDateLong(today)}
            </div>
          </div>
        }
      />

      <DashboardSummary
        period={period}
        availableToBudgetCents={dashboard.availableToBudgetCents}
        periodIncomeCents={dashboard.periodIncomeCents}
        budgetedCents={dashboard.periodBudgetedCents}
        spentCents={dashboard.periodSpentCents}
        refundCents={dashboard.periodRefundCents}
        fundedCents={fundedCents}
        categoryCount={categoryCount}
        paycheck={paycheck}
      />

      {scheduleError && (
        <p role="alert" className="mt-4 font-sans text-row text-vermilion">
          {scheduleError}
        </p>
      )}

      {/* The same split as the Configuration page — the wide table of categories
          beside the short list of accounts — so the two screens read as one
          layout rather than two. `items-start` so the accounts panel ends where
          its rows do instead of being stretched to the table's height. */}
      <div className="mt-4 grid items-start gap-x-5 gap-y-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <CategoryLedgerTable
            sections={dashboard.sections}
            otherRows={dashboard.otherRows}
            otherTotals={dashboard.otherTotals}
            totals={dashboard.totals}
            onMove={handleMove}
          />
        </div>
        {/* Upcoming above the accounts in the narrow column: it is the one panel
            here with something to do on it, and what is due is read more often
            than when an account was last checked. */}
        <div className="grid gap-4">
          <UpcomingBills
            rows={upcoming.rows}
            overdueCount={upcoming.overdueCount}
            dueCents={upcoming.dueCents}
            windowDays={upcoming.windowDays}
            scheduleCount={upcoming.scheduleCount}
            describe={describeSchedule}
            onEnter={(row) => {
              setScheduleError(null);
              setEntering(row);
            }}
            onSkip={handleSkip}
          />
          <ReconciliationList
            rows={accountRows}
            onReconcile={(account) => reconcileAccount({ id: account.id })}
          />
        </div>
      </div>

      {accountRows.length > 0 && (
        <p className="mt-3 font-sans text-row text-chalk-soft">
          Balances are the opening figure plus every transaction through the account, so they
          follow the ledger — reconciling records that they agreed with the bank today.
        </p>
      )}

      <MoveMoneyModal
        show={moving != null}
        period={period}
        seed={moving}
        handleClose={() => setMoving(null)}
      />

      <EnterScheduledModal
        show={entering != null}
        row={entering}
        name={entering ? describeSchedule(entering.schedule).name : ""}
        filing={entering ? describeSchedule(entering.schedule).filing : ""}
        onEnter={handleEnter}
        handleClose={() => setEntering(null)}
      />
    </>
  );
}
