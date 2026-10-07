import React, { useCallback, useContext, useMemo } from "react";
import { v4 as uuidV4 } from "uuid";
import useSyncedState from "../hooks/useSyncedState";
import { isSplit, readStoredLedger, TRANSACTION_KINDS } from "./TransactionsContext";
import { UNCATEGORIZED_BUDGET_ID } from "./constants";
import { currentPeriod, periodLTE, toCents, toPeriod } from "../utils";

/**
 * What the user actually put into each category, month by month.
 *
 * This is the other half of BudgetPlanContext. A plan is the *estimate* — what
 * a category is expected to need each month, carried forward so one stored
 * figure covers every future period. An assignment is the money the user
 * actually handed over when income landed, and it deliberately does **not**
 * carry forward: what accumulates instead is the envelope's balance, since
 * whatever a category did not spend in June is still sitting in it in July.
 *
 * One record per (budgetId, period). Zero-valued rows are pruned rather than
 * stored — "assigned nothing" and "never assigned" spend the same.
 */
const AssignmentsContext = React.createContext();

export function useAssignments() {
  return useContext(AssignmentsContext);
}

// The same composite key SavingsGoalAssignmentsContext builds for the same
// shape of record, and deliberately the same separator: a budget id is a uuid
// or the "Uncategorized" sentinel and a period is "YYYY-MM", so neither side can
// contain a space and the join cannot be ambiguous.
const keyOf = (budgetId, period) => `${budgetId} ${period}`;

/**
 * Every envelope figure is a running sum from the beginning of the ledger, so a
 * ledger that predates this feature has years of spend and no assignments at
 * all — which would open every single category at a negative balance equal to
 * its entire lifetime spend. Correct by the arithmetic, useless on screen.
 *
 * Seed each category with exactly what it has already spent, so every envelope
 * opens at zero. That invents no history: money the user spent was money the
 * user had. What is left over lands in "to be assigned" as cash on hand.
 *
 * This runs in the lazy default *only*, never in a migration: the `assignments`
 * key existing means it has already run, so there is nothing left to seed and
 * re-running could only invent rows.
 *
 * It reads the ledger straight out of storage rather than from
 * TransactionsContext, because a lazy default runs during this provider's own
 * initialisation — there is no rendered provider above it to read. See
 * `readStoredLedger`, which is where the "current key, else the legacy ones"
 * decision lives.
 *
 * Guarded end to end: this reads a key another store owns, and a failure must
 * not cost the user anything worse than starting from empty.
 */
function seedFromExistingSpend() {
  try {
    const period = currentPeriod();
    const spentByBudget = new Map();

    for (const transaction of readStoredLedger()) {
      if (transaction.kind !== TRANSACTION_KINDS.OUTFLOW) continue;

      const spentPeriod = toPeriod(transaction.date);
      // Undated spend already happened. Future-dated spend has not, and seeding
      // it would open that envelope in credit for money still to go out.
      if (spentPeriod != null && !periodLTE(spentPeriod, period)) continue;

      // A receipt divided between categories opens each of them at its own part,
      // for the same reason the undivided one opens its category at the whole:
      // what was spent out of a category is what that category has to have been
      // given.
      const add = (id, cents) => {
        const budgetId = id ?? UNCATEGORIZED_BUDGET_ID;
        spentByBudget.set(budgetId, (spentByBudget.get(budgetId) ?? 0) + cents);
      };
      if (isSplit(transaction)) {
        for (const part of transaction.splits) add(part.budgetId, part.amountCents);
      } else add(transaction.budgetId, transaction.amountCents);
    }

    return [...spentByBudget]
      .filter(([, cents]) => cents !== 0)
      .map(([budgetId, cents]) => ({
        id: uuidV4(),
        budgetId,
        period,
        assignedCents: cents,
      }));
  } catch {
    return [];
  }
}

function migrateAssignments(stored) {
  const assignments = Array.isArray(stored) ? stored : [];
  return assignments
    .filter((assignment) => assignment && assignment.budgetId != null)
    .map((assignment) => ({
      id: assignment.id ?? uuidV4(),
      budgetId: assignment.budgetId,
      period: assignment.period,
      assignedCents: assignment.assignedCents ?? 0,
    }));
}

/** Upsert one (budgetId, period) row, pruning it when it lands on zero. */
function upsert(assignments, budgetId, period, cents) {
  const rest = assignments.filter(
    (assignment) => !(assignment.budgetId === budgetId && assignment.period === period)
  );
  if (cents === 0) return rest;

  const existing = assignments.find(
    (assignment) => assignment.budgetId === budgetId && assignment.period === period
  );
  return [...rest, { id: existing?.id ?? uuidV4(), budgetId, period, assignedCents: cents }];
}

export const AssignmentsProvider = ({ children }) => {
  const [assignments, setAssignments] = useSyncedState(
    "assignments",
    seedFromExistingSpend,
    migrateAssignments
  );

  // One pass, so a grid of categories does not rescan the whole array per row.
  // Deliberately not shaped like getPlannedCents, which filters *and sorts*
  // every plan on every call and is already called once per budget per render.
  const assignedByKey = useMemo(() => {
    const index = new Map();
    for (const assignment of assignments) {
      index.set(keyOf(assignment.budgetId, assignment.period), assignment.assignedCents);
    }
    return index;
  }, [assignments]);

  const getAssignedCents = useCallback(
    (budgetId, period) => assignedByKey.get(keyOf(budgetId, period)) ?? 0,
    [assignedByKey]
  );

  const getPeriodAssignments = useCallback(
    (period) => assignments.filter((assignment) => assignment.period === period),
    [assignments]
  );

  /**
   * Negative amounts are allowed, and have to be. Under rollover the only way
   * to pull money back out of a category that was over-funded in an earlier
   * month is to assign a negative amount in this one; rejecting that would
   * leave the user with money they can see and cannot move.
   */
  const setAssignedAmount = useCallback(
    ({ budgetId, period, amount, amountCents }) => {
      const cents = amountCents ?? toCents(amount);
      if (cents == null) return { ok: false, error: "Enter an amount." };
      if (toPeriod(period) == null) return { ok: false, error: "Enter a valid period." };

      setAssignments((prevAssignments) => upsert(prevAssignments, budgetId, period, cents));
      return { ok: true };
    },
    [setAssignments]
  );

  /**
   * The whole batch is validated before anything is written. A form that
   * assigns eight categories and fails on the third cannot leave two of them
   * committed — the user would have no way to tell which.
   */
  const setPeriodAssignments = useCallback(
    ({ period, entries }) => {
      if (toPeriod(period) == null) return { ok: false, error: "Enter a valid period." };

      const validated = [];
      for (const entry of entries) {
        const cents = entry.amountCents ?? toCents(entry.amount);
        if (cents == null) {
          return { ok: false, error: `Enter a valid amount for ${entry.label ?? "every category"}.` };
        }
        validated.push({ budgetId: entry.budgetId, cents });
      }

      // Functional updater, not the closed-over array: index.js renders under
      // StrictMode, which invokes the updater twice.
      setAssignments((prevAssignments) =>
        // Last write wins on a duplicated budgetId, which is what a form with
        // one input per category produces anyway.
        validated.reduce(
          (next, { budgetId, cents }) => upsert(next, budgetId, period, cents),
          prevAssignments
        )
      );
      return { ok: true };
    },
    [setAssignments]
  );

  /**
   * Move money from one category to another, in one write.
   *
   * Envelope budgeting's other everyday act, beside assigning income: groceries
   * came in under and dining out went over, so the difference moves across. It
   * is expressible already — assign the source less and the destination more —
   * but only as *two* edits with the pool briefly inflated by money that was
   * never free, and the user has to hold the arithmetic in their head between
   * them. This is the one action, so there is nothing in between to see.
   *
   * **The two deltas cancel, so `toBeAssigned` is untouched by construction.**
   * That is the whole reason this is one `setAssignments` call rather than two
   * `setAssignedAmount` calls: the invariant in `dataModel.test.js` holds at
   * every commit, not merely once both halves have landed, and a failure
   * between them cannot leave money parked in the pool.
   *
   * A move is a positive amount in a stated direction, so zero and negative are
   * refused rather than quietly reversing the two selects — the direction is
   * what the form asked, and an amount is not the place to contradict it.
   *
   * Deliberately **not** refused for leaving the source overdrawn, which this
   * store could not check anyway (available is a cross-store sum over the whole
   * ledger, and this store sees only assignments). Covering one category out of
   * another that has not been funded yet is a real thing to want in the days
   * before a paycheque, and the app already has exactly one way of saying so:
   * the source goes red. `MoveMoneyModal` states what each side will be left
   * with before the write, which is where the figure is in hand.
   */
  const moveBetweenBudgets = useCallback(
    ({ fromBudgetId, toBudgetId, period, amount, amountCents }) => {
      const cents = amountCents ?? toCents(amount);
      if (cents == null) return { ok: false, error: "Enter an amount." };
      if (cents <= 0) return { ok: false, error: "Enter an amount greater than zero." };
      if (fromBudgetId == null || toBudgetId == null) {
        return { ok: false, error: "Choose a category to move from and one to move to." };
      }
      if (fromBudgetId === toBudgetId) {
        return { ok: false, error: "Choose two different categories." };
      }
      if (toPeriod(period) == null) return { ok: false, error: "Enter a valid period." };

      setAssignments((prevAssignments) => {
        // Both read off `prevAssignments` before either upsert. Safe because the
        // two ids differ — checked above — so neither upsert can disturb the row
        // the other is about.
        const assignedOn = (budgetId) =>
          prevAssignments.find(
            (assignment) => assignment.budgetId === budgetId && assignment.period === period
          )?.assignedCents ?? 0;

        return upsert(
          upsert(prevAssignments, fromBudgetId, period, assignedOn(fromBudgetId) - cents),
          toBudgetId,
          period,
          assignedOn(toBudgetId) + cents
        );
      });
      return { ok: true };
    },
    [setAssignments]
  );

  /**
   * Move a category's whole assignment history onto another category, in one
   * commit. Used when a category is deleted: its expenses are reassigned rather
   * than dropped, so its funding has to follow them. Dropping the assignments
   * instead would return them to "to be assigned" while the spend landed on
   * Uncategorized, opening that envelope deeply negative and asking the user to
   * cover money they had already funded.
   */
  const reassignBudgetAssignments = useCallback(
    ({ fromBudgetId, toBudgetId, period }) => {
      setAssignments((prevAssignments) => {
        const moved = prevAssignments
          .filter((assignment) => assignment.budgetId === fromBudgetId)
          .reduce((sum, assignment) => sum + assignment.assignedCents, 0);
        const kept = prevAssignments.filter(
          (assignment) => assignment.budgetId !== fromBudgetId
        );
        if (moved === 0) return kept;

        const existing = kept.find(
          (assignment) => assignment.budgetId === toBudgetId && assignment.period === period
        );
        return upsert(kept, toBudgetId, period, (existing?.assignedCents ?? 0) + moved);
      });
    },
    [setAssignments]
  );

  // Memoised so a change in any other store does not re-render every consumer
  // of this one.
  const value = useMemo(
    () => ({
      assignments,
      getAssignedCents,
      getPeriodAssignments,
      setAssignedAmount,
      setPeriodAssignments,
      moveBetweenBudgets,
      reassignBudgetAssignments,
    }),
    [
      assignments,
      getAssignedCents,
      getPeriodAssignments,
      setAssignedAmount,
      setPeriodAssignments,
      moveBetweenBudgets,
      reassignBudgetAssignments,
    ]
  );

  return <AssignmentsContext.Provider value={value}>{children}</AssignmentsContext.Provider>;
};
