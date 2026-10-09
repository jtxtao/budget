import { useState } from "react";
import AssignIncomeModal from "../components/AssignIncomeModal";
import CategoryLedgerTable from "../components/CategoryLedgerTable";
import DashboardSummary from "../components/DashboardSummary";
import EnterScheduledModal from "../components/EnterScheduledModal";
import MoveMoneyModal from "../components/MoveMoneyModal";
import PageHeader from "../components/PageHeader";
import PayOffCardModal from "../components/PayOffCardModal";
import ReconcileModal from "../components/ReconcileModal";
import ReconciliationList from "../components/ReconciliationList";
import UpcomingBills from "../components/UpcomingBills";
import { spendsThroughBudget, useAccounts } from "../contexts/AccountsContext";
import { useBudgets } from "../contexts/BudgetsContext";
import { TO_BE_ASSIGNED } from "../contexts/constants";
import { usePayees } from "../contexts/PayeesContext";
import { useSchedules } from "../contexts/SchedulesContext";
import { TRANSACTION_KINDS, useTransactions } from "../contexts/TransactionsContext";
import { FUNDING } from "../fundingStatus";
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

  const { accounts } = useAccounts();
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
  const [assigning, setAssigning] = useState(false);
  // The account id each dialog is open on, resolved against the live rows so
  // the balance it shows follows the ledger.
  const [reconcilingId, setReconcilingId] = useState(null);
  const [payingOffId, setPayingOffId] = useState(null);

  // What went out this month, less what came back into a category: a refund
  // undoes that much of the spending it answers, the way each category's own
  // activity figure already reads it.
  const netSpentCents = dashboard.periodSpentCents - dashboard.periodRefundCents;
  // What there was to spend: money assigned in an earlier month and carried in
  // is just as spendable as money assigned this month. Which is exactly what is
  // left over plus what the month cost — net, since a refund already sits in
  // what is left over.
  const fundedCents = dashboard.totals.availableCents + netSpentCents;
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
   * Open the move on a category, with the direction read off its funding.
   *
   * A row that is short — overspent, or underfunded against its estimate — is
   * one somebody wants to *fund*, so it seeds as the destination with the
   * shortfall already typed in. The source is "to be assigned" whenever the
   * pool can cover that figure, since unassigned money is the first place a
   * household looks; otherwise it is left for them to pick, because which
   * neighbour gives something up is not the app's call. Any other row has
   * money to spare and seeds as the source. Stated on each button's label, so
   * the rule is read before the click rather than discovered after it. `null`
   * is the header button: no direction assumed, both selects empty.
   */
  function handleMove(row) {
    if (row == null) {
      setMoving({});
      return;
    }
    const { status, shortCents } = row.funding;
    if (status === FUNDING.OVERSPENT || status === FUNDING.UNDERFUNDED) {
      setMoving({
        fromBudgetId:
          dashboard.availableToBudgetCents >= shortCents ? TO_BE_ASSIGNED : undefined,
        toBudgetId: row.budgetId,
        amountCents: shortCents,
      });
      return;
    }
    setMoving({ fromBudgetId: row.budgetId });
  }

  /**
   * Deal with an occurrence without recording anything.
   *
   * A month the gym was closed, a subscription cancelled after the schedule was
   * written, a bill paid in cash and not worth entering. It moves the cursor and
   * touches no money at all, which is the one thing a bill reminder has to be able
   * to do without lying about the books.
   */
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
        spentCents={netSpentCents}
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
        {/* `min-w-0` for the reason spelled out on the column beside it: a grid
            track will not shrink below its content's min-content width, and a
            five-column table of figures is wider than a phone. Without it the
            table's own `overflow-x-auto` can never engage — the track simply
            grows and the whole page scrolls sideways instead. */}
        <div className="min-w-0 xl:col-span-2">
          <CategoryLedgerTable
            sections={dashboard.sections}
            otherRows={dashboard.otherRows}
            otherTotals={dashboard.otherTotals}
            totals={dashboard.totals}
            shortfall={dashboard.shortfall}
            onMove={handleMove}
            onAssign={() => setAssigning(true)}
          />
        </div>
        {/* Upcoming above the accounts in the narrow column: it is the one panel
            here with something to do on it, and what is due is read more often
            than when an account was last checked.

            `min-w-0` is load-bearing, not tidying. A grid track is `auto` by
            default, which means it will not shrink below its content's
            min-content width — and a row here is a truncating name beside a
            `whitespace-nowrap` due date, an amount and two buttons, so its
            min-content is wider than the third of the grid it is meant to sit
            in. Without this the column simply grows, pushing the panel past the
            page and putting a horizontal scrollbar under the whole dashboard.
            The panel's own rows already truncate; this is what lets them. */}
        <div className="grid min-w-0 gap-4">
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
            onReconcile={(account) => setReconcilingId(account.id)}
            onPayOff={(account) => setPayingOffId(account.id)}
          />
        </div>
      </div>

      {accountRows.length > 0 && (
        <p className="mt-3 font-sans text-row text-chalk-soft">
          Balances are the opening figure plus every transaction through the account, so they
          follow the ledger — reconciling records that they agreed with the bank today, and adjusts
          the books where the statement says otherwise.
        </p>
      )}

      <ReconcileModal
        show={reconcilingId != null}
        row={accountRows.find((row) => row.account.id === reconcilingId) ?? null}
        handleClose={() => setReconcilingId(null)}
      />
      <PayOffCardModal
        show={payingOffId != null}
        row={accountRows.find((row) => row.account.id === payingOffId) ?? null}
        handleClose={() => setPayingOffId(null)}
      />

      <MoveMoneyModal
        show={moving != null}
        period={period}
        seed={moving}
        handleClose={() => setMoving(null)}
      />

      <AssignIncomeModal
        show={assigning}
        period={period}
        handleClose={() => setAssigning(false)}
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
