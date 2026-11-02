import { useState } from "react";
import { Navigate } from "react-router-dom";
import AssignIncomeModal from "../components/AssignIncomeModal";
import CategoryLedgerTable from "../components/CategoryLedgerTable";
import DashboardSummary from "../components/DashboardSummary";
import EnterScheduledModal from "../components/EnterScheduledModal";
import MoveMoneyModal from "../components/MoveMoneyModal";
import PageHeader from "../components/PageHeader";
import PayOffCardModal from "../components/PayOffCardModal";
import ReconcileModal from "../components/ReconcileModal";
import ActivityFeed from "../components/ActivityFeed";
import ReconciliationList from "../components/ReconciliationList";
import SetupGuideCallout from "../components/SetupGuideCallout";
import UpcomingBills from "../components/UpcomingBills";
import { spendsThroughBudget, useAccounts } from "../contexts/AccountsContext";
import { useBudgets } from "../contexts/BudgetsContext";
import { TO_BE_ASSIGNED } from "../contexts/constants";
import { usePayees } from "../contexts/PayeesContext";
import { useSchedules } from "../contexts/SchedulesContext";
import { TRANSACTION_KINDS, useTransactions } from "../contexts/TransactionsContext";
import useAccountBalances from "../hooks/useAccountBalances";
import useDashboard from "../hooks/useDashboard";
import useHouseholdInUse from "../hooks/useHouseholdInUse";
import useNextPaycheck from "../hooks/useNextPaycheck";
import useRecordCashback from "../hooks/useRecordCashback";
import useUpcoming from "../hooks/useUpcoming";
import { useSchedulePaymentMatches } from "../hooks/useScheduleSuggestions";
import { isOccurrenceOutstanding } from "../domain/scheduleOccurrences";
import { currentPeriod, daysBetween, formatCents, formatDateLong, toCents, todayISO } from "../utils";

const DASHBOARD_BUDGET_EXPLAINER_KEY = "dashboardBudgetExplainerDismissed";

function shouldShowBudgetExplainer() {
  try {
    return window.localStorage.getItem(DASHBOARD_BUDGET_EXPLAINER_KEY) !== "true";
  } catch {
    return true;
  }
}

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

  const { accounts, reconcileAccount, reorderAccounts } = useAccounts();
  const { budgets, reorderBudgets, reorderGroups } = useBudgets();
  const { payeeById } = usePayees();
  const { addTransaction } = useTransactions();
  const recordCashback = useRecordCashback();
  const { schedules, resolveOccurrence } = useSchedules();
  const { rows: balanceRows } = useAccountBalances(period);
  const paycheck = useNextPaycheck(today);
  const dashboard = useDashboard(period);
  const upcoming = useUpcoming(today);
  const { matches, confirmMatch } = useSchedulePaymentMatches(upcoming.rows, today);
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
  const [showBudgetExplainer, setShowBudgetExplainer] = useState(shouldShowBudgetExplainer);
  // An established household never sees the guide, whatever this browser remembers.
  const householdInUse = useHouseholdInUse();

  function dismissBudgetExplainer() {
    setShowBudgetExplainer(false);
    try {
      window.localStorage.setItem(DASHBOARD_BUDGET_EXPLAINER_KEY, "true");
    } catch {
      // Dismissal still works for this visit when browser storage is unavailable.
    }
  }

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

  // A brand-new household has nothing to show — send them straight to setup.
  if (accounts.length === 0 && budgets.length === 0) {
    return <Navigate to="/plan" replace />;
  }

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
    if (schedule.isPaycheck) return { name: "Paycheck", filing: "Income" };
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

  /** Save the ledger first, then resolve only the chosen scheduled date. */
  function handleEnter({ amount, date, description }) {
    const { schedule } = entering;
    const live = schedules.find((item) => item.id === schedule.id);
    if (!live || !isOccurrenceOutstanding(live, entering.date) ||
        ["payeeId", "accountId", "budgetId", "kind", "amountCents"].some((key) => live[key] !== schedule[key])) {
      return { ok: false, error: "That reminder has changed or is already handled. Close this form and review the updated reminder." };
    }
    const result = addTransaction({
      kind: schedule.kind,
      payeeId: schedule.payeeId,
      description,
      amount,
      date,
      accountId: schedule.accountId,
      budgetId: schedule.budgetId,
      scheduled: true,
    });
    if (!result.ok) return result;

    // A bill paid on a card that pays cash back earns it like any purchase.
    const earned = recordCashback({
      kind: schedule.kind,
      amountCents: toCents(amount),
      date,
      accountId: schedule.accountId,
      budgetId: schedule.budgetId,
      splits: null,
      payeeName: payeeById.get(schedule.payeeId)?.name,
    });

    const advanced = resolveOccurrence({ id: schedule.id, date: entering.date,
      status: "recorded", transactionId: result.id });
    // Reported on the page rather than swallowed: the money landed, so the modal
    // has done its job and closing it is right — but the bill will be offered
    // again, and the user has to know why.
    setScheduleError(
      !advanced.ok
        ? "The transaction was recorded, but the schedule could not be updated — it may be offered again."
        : !earned.ok
          ? `The transaction was recorded, but its cash back was not: ${earned.error}`
          : null
    );
    return { ok: true };
  }

  /**
   * Open the move on a category, which is always the **destination**.
   *
   * Clicking an envelope's own figure is the gesture of giving it something:
   * the figure is read because the category needs money, whether it is short
   * by four hundred or just short of what the month still has to pay for. So
   * the row clicked seeds as `toBudgetId` either way, and which neighbour
   * gives it up stays the user's call — this store cannot know, and guessing
   * would re-plan a category nobody asked about.
   *
   * An overspent row is the one case with a figure worth typing in: the
   * overspend, and "to be assigned" as the source whenever the pool can cover
   * exactly that, since unassigned money is the first place a household looks.
   * Stated on each button's label, so the rule is read before the click rather
   * than discovered after it. `null` is the header button: no direction
   * assumed, both selects empty.
   */
  function handleMove(row) {
    if (row == null) {
      setMoving({});
      return;
    }
    if (row.availableCents < 0) {
      const shortCents = -row.availableCents;
      setMoving({
        fromBudgetId:
          dashboard.availableToBudgetCents >= shortCents ? TO_BE_ASSIGNED : undefined,
        toBudgetId: row.budgetId,
        amountCents: shortCents,
      });
      return;
    }
    setMoving({ toBudgetId: row.budgetId });
  }

  /**
   * Deal with an occurrence without recording anything.
   *
   * A month the gym was closed, a subscription cancelled after the schedule was
   * written, a bill paid in cash and not worth entering. Resolving only this
   * occurrence leaves older unpaid reminders visible and touches no money.
   */
  function handleSkip(row) {
    const result = resolveOccurrence({ id: row.schedule.id, date: row.date, status: "skipped" });
    setScheduleError(result.ok ? null : result.error);
  }

  function handleMatch(row, transactionId) {
    const result = confirmMatch(row, transactionId);
    setScheduleError(result.ok ? null : result.error);
  }

  return (
    <>
      <PageHeader
        title="Dashboard"
        actions={
          <div className="text-right">
            <div className="text-label uppercase text-chalk-soft">Today</div>
            <div className="mt-0.5 font-sans text-sm font-medium text-chalk">
              {formatDateLong(today)}
            </div>
          </div>
        }
      />

      <DashboardSummary
        period={period}
        availableToBudgetCents={dashboard.availableToBudgetCents}
        assignedAheadCents={dashboard.assignedAheadCents}
        monthsFundedAhead={dashboard.monthsFundedAhead}
        periodIncomeCents={dashboard.periodIncomeCents}
        budgetedCents={dashboard.periodBudgetedCents}
        plannedCents={dashboard.plannedCents}
        spentCents={netSpentCents}
        refundCents={dashboard.periodRefundCents}
        fundedCents={fundedCents}
        categoryCount={categoryCount}
        paycheck={paycheck}
      />

      {dashboard.availableToBudgetCents < 0 && (
        <section
          role="alert"
          className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-vermilion/60 bg-panel px-4 py-3"
        >
          <p className="font-sans text-row text-chalk-soft">
            <strong className="text-vermilion">
              Over-assigned by {formatCents(-dashboard.availableToBudgetCents)}.
            </strong>{" "}
            You have assigned more than your available money can cover. Reduce category assignments
            to bring Available to budget back to zero.
          </p>
          <button
            type="button"
            className="shrink-0 rounded-lg border border-vermilion/60 px-3 py-2 font-sans text-row font-medium text-chalk hover:bg-vermilion/10"
            onClick={() => setAssigning(true)}
          >
            Review assignments
          </button>
        </section>
      )}

      {showBudgetExplainer && !householdInUse && (
        <SetupGuideCallout
          targetId="dashboard-budget-summary"
          title="A quick guide to your budget"
          description={
            <>
              <strong className="text-chalk">Available to budget</strong> is money in your budget
              that has not been assigned a job yet. <strong className="text-chalk">Budgeted this month</strong>{" "}
              is the total you have assigned to categories for this month. Assigning money moves it
              from available to budget into your categories; budgeted money is planned for a job,
              while spent money has actually left an envelope.
            </>
          }
        >
            <button
              type="button"
              className="mt-3 font-sans text-row text-chalk-soft underline"
              onClick={dismissBudgetExplainer}
            >
              Got it
            </button>
        </SetupGuideCallout>
      )}

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
            plannedCents={dashboard.plannedCents}
            onMove={handleMove}
            onAssign={() => setAssigning(true)}
            onReorderRows={reorderBudgets}
            onReorderGroups={reorderGroups}
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
            matches={matches}
            onMatch={handleMatch}
          />
          <ReconciliationList
            rows={accountRows}
            onReconcile={(account) => setReconcilingId(account.id)}
            onPayOff={(account) => setPayingOffId(account.id)}
            /* The press is the whole act: the books already say what the
               account holds, so confirming it costs no figure and writes no
               row — it stamps the day they were found to agree, which is the
               same thing reconciling with the statement left blank writes.
               `today` is the page's own, read once above, so the stamp, the
               ages beside it and the countdown cannot disagree. */
            onConfirm={(account) => reconcileAccount({ id: account.id, date: today })}
            onReorder={reorderAccounts}
          />
          <ActivityFeed />
        </div>
      </div>

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
