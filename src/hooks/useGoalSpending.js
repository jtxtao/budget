import { useCallback } from "react";
import { spendsThroughBudget, useAccounts } from "../contexts/AccountsContext";
import { useAssignments } from "../contexts/AssignmentsContext";
import { useBudgets } from "../contexts/BudgetsContext";
import { useSavingsGoalAssignments } from "../contexts/SavingsGoalAssignmentsContext";
import { useSavingsGoals } from "../contexts/SavingsGoalsContext";
import { TRANSACTION_KINDS, useTransactions } from "../contexts/TransactionsContext";
import { currentPeriod, formatCents, periodLTE, toCents, toPeriod, todayISO } from "../utils";
import useRecordCashback from "./useRecordCashback";

const isDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

/**
 * The most that can come out of a goal in `period` without leaving it below
 * zero in that month or any later one it has a record for: a goal's available
 * is its cumulative assignment and nothing else (`useEnvelopes`' goalRows), so
 * a backdated release also lowers every month after it.
 */
export function spendableFromGoal(assignments, goalId, period) {
  const own = assignments.filter((assignment) => assignment.goalId === goalId);
  const through = (limit) =>
    own
      .filter((assignment) => periodLTE(assignment.period, limit))
      .reduce((sum, assignment) => sum + assignment.assignedCents, 0);
  const later = own.map((assignment) => assignment.period).filter((p) => !periodLTE(p, period));
  return Math.min(through(period), ...later.map(through));
}

/**
 * Spending a savings goal, and closing one out — the actions that span four
 * stores, so they live in a hook rather than in any one provider.
 *
 * **Spending from a goal is a move, not a new kind of money.** The amount comes
 * out of the goal and goes into the category the purchase belongs in, in the
 * purchase's month — two assignments that cancel, so "to be assigned" does not
 * move and the envelope identity is untouched. The purchase is then an
 * ordinary outflow against that category, which is what makes it count in
 * every spending figure. A goal never names a transaction and a transaction
 * never names a goal; the goal's `spending` entry is only the statement that
 * this move was spending rather than a pull-back.
 *
 * Every field is checked before anything is written. Four stores cannot be one
 * atomic write, so the purchase — the write a store can still refuse — goes
 * first, and nothing else is written if it is refused.
 */
export default function useGoalSpending() {
  const { goals, recordGoalSpending, removeGoalSpending, setGoalArchived } = useSavingsGoals();
  const {
    assignments: goalAssignments,
    getAssignedCents: getGoalAssigned,
    setAssignedAmount: setGoalAssigned,
  } = useSavingsGoalAssignments();
  const { getAssignedCents, setAssignedAmount } = useAssignments();
  const { budgets } = useBudgets();
  const { accounts } = useAccounts();
  const { transactions, addTransaction, deleteTransaction } = useTransactions();
  const recordCashback = useRecordCashback();

  const spendFromGoal = useCallback(
    ({ goalId, amount, amountCents, budgetId, date = todayISO(), note = "", accountId = null }) => {
      const goal = goals.find((entry) => entry.id === goalId);
      if (!goal) return { ok: false, error: "That savings goal no longer exists." };
      if (goal.archivedOn) return { ok: false, error: "That goal is archived. Restore it first." };

      const cents = amountCents ?? toCents(amount);
      if (cents == null || !Number.isInteger(cents) || cents <= 0) {
        return { ok: false, error: "Enter an amount greater than zero." };
      }
      if (!isDate(date)) return { ok: false, error: "Enter a valid date." };
      if (!budgets.some((budget) => budget.id === budgetId)) {
        return { ok: false, error: "Choose the category this spending belongs in." };
      }

      const period = toPeriod(date);
      const spendable = spendableFromGoal(goalAssignments, goalId, period);
      if (cents > spendable) {
        return {
          ok: false,
          error:
            spendable > 0
              ? `Only ${formatCents(spendable)} is in this goal to spend.`
              : "There is no money in this goal to spend yet.",
        };
      }

      let transactionId = null;
      if (accountId) {
        const account = accounts.find((entry) => entry.id === accountId);
        if (!account || account.archived || !spendsThroughBudget(account)) {
          return { ok: false, error: "Choose an account the budget spends through." };
        }
        const purchase = {
          kind: TRANSACTION_KINDS.OUTFLOW,
          amountCents: cents,
          date,
          accountId,
          budgetId,
          description: note.trim() || goal.name,
        };
        const added = addTransaction(purchase);
        if (!added.ok) return added;
        transactionId = added.id;
        recordCashback(purchase);
      }

      setAssignedAmount({ budgetId, period, amountCents: getAssignedCents(budgetId, period) + cents });
      setGoalAssigned({ goalId, period, amountCents: getGoalAssigned(goalId, period) - cents });
      return recordGoalSpending({ goalId, date, amountCents: cents, budgetId, note, transactionId });
    },
    [
      goals,
      goalAssignments,
      budgets,
      accounts,
      addTransaction,
      recordCashback,
      getAssignedCents,
      setAssignedAmount,
      getGoalAssigned,
      setGoalAssigned,
      recordGoalSpending,
    ]
  );

  /**
   * Take a spending entry back: the money returns to the goal from the
   * category, and the purchase recorded with it — if it was, and still exists —
   * comes out of the register.
   */
  const undoGoalSpending = useCallback(
    ({ goalId, spendingId }) => {
      const goal = goals.find((entry) => entry.id === goalId);
      const entry = goal?.spending?.find((spent) => spent.id === spendingId);
      if (!entry) return { ok: false, error: "That spending entry no longer exists." };

      const period = toPeriod(entry.date);
      if (entry.transactionId && transactions.some((t) => t.id === entry.transactionId)) {
        deleteTransaction({ id: entry.transactionId });
      }
      if (entry.budgetId) {
        setAssignedAmount({
          budgetId: entry.budgetId,
          period,
          amountCents: getAssignedCents(entry.budgetId, period) - entry.amountCents,
        });
      }
      setGoalAssigned({ goalId, period, amountCents: getGoalAssigned(goalId, period) + entry.amountCents });
      return removeGoalSpending({ goalId, spendingId });
    },
    [
      goals,
      transactions,
      deleteTransaction,
      getAssignedCents,
      setAssignedAmount,
      getGoalAssigned,
      setGoalAssigned,
      removeGoalSpending,
    ]
  );

  /**
   * Close a goal out. Whatever is still assigned to it goes back to "to be
   * assigned" this month — an archived goal is off every funding form, so money
   * left in it would be money nobody could see or reach — and a month funded
   * ahead for it is unfunded. Its spending and history stay.
   */
  const archiveGoal = useCallback(
    ({ goalId }) => {
      const goal = goals.find((entry) => entry.id === goalId);
      if (!goal) return { ok: false, error: "That savings goal no longer exists." };

      const period = currentPeriod();
      const own = goalAssignments.filter((assignment) => assignment.goalId === goalId);
      const ahead = own.filter((assignment) => !periodLTE(assignment.period, period));
      const leftCents = own
        .filter((assignment) => periodLTE(assignment.period, period))
        .reduce((sum, assignment) => sum + assignment.assignedCents, 0);

      for (const assignment of ahead) {
        setGoalAssigned({ goalId, period: assignment.period, amountCents: 0 });
      }
      if (leftCents > 0) {
        setGoalAssigned({ goalId, period, amountCents: getGoalAssigned(goalId, period) - leftCents });
      }
      const result = setGoalArchived({ id: goalId, archived: true });
      return result.ok ? { ok: true, releasedCents: Math.max(leftCents, 0) } : result;
    },
    [goals, goalAssignments, getGoalAssigned, setGoalAssigned, setGoalArchived]
  );

  const restoreGoal = useCallback(
    ({ goalId }) => setGoalArchived({ id: goalId, archived: false }),
    [setGoalArchived]
  );

  return { spendFromGoal, undoGoalSpending, archiveGoal, restoreGoal };
}

