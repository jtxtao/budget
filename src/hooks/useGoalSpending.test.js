import { act, renderHook } from "@testing-library/react";
import AppProviders from "../contexts/AppProviders";
import { useSavingsGoals } from "../contexts/SavingsGoalsContext";
import { useSavingsGoalAssignments } from "../contexts/SavingsGoalAssignmentsContext";
import { useTransactions } from "../contexts/TransactionsContext";
import useEnvelopes from "./useEnvelopes";
import useGoalSpending, { spendableFromGoal } from "./useGoalSpending";
import useSavingsGoalEnvelopes from "./useSavingsGoalEnvelopes";
import useSpendingReport from "./useSpendingReport";
import { addMonths, currentPeriod, todayISO } from "../utils";

/**
 * Spending a goal and closing one out, through the real providers. What is
 * pinned down is the claim the design rests on: spending from a goal is a move
 * of money the pool already counted, so the envelope identity holds and "to be
 * assigned" does not move — while the purchase lands in the category, where
 * every spending figure reads it — and the goal reports planned, saved and
 * spent apart, with spent still counting as progress.
 */
const wrapper = ({ children }) => <AppProviders>{children}</AppProviders>;

const PERIOD = currentPeriod();
const TODAY = todayISO();

const CHECKING = {
  id: "acc-cash",
  name: "Checking",
  type: "asset",
  scope: "on-budget",
  assetClass: "Cash",
  openingBalanceCents: 5_000_000,
  openingDate: null,
  reconciledOn: null,
};

const WEDDING = {
  id: "g-wedding",
  name: "Wedding",
  targetCents: 3_000_000,
  targetDate: null,
  budgetId: "b-wedding",
  accountIds: [],
  accountAmounts: {},
};

function seed({ goalAssignments = [{ id: "ga1", goalId: "g-wedding", period: PERIOD, assignedCents: 1_200_000 }] } = {}) {
  const file = {
    accounts: [CHECKING],
    budgets: [
      { id: "b-wedding", name: "Wedding costs", plannedCents: 0 },
      { id: "b-food", name: "Food", plannedCents: 0 },
    ],
    assignments: [],
    transactions: [],
    savingsGoals: [WEDDING],
    savingsGoalAssignments: goalAssignments,
  };
  for (const [key, value] of Object.entries(file)) localStorage.setItem(key, JSON.stringify(value));
}

function setup() {
  const { result } = renderHook(
    () => ({
      actions: useGoalSpending(),
      goals: useSavingsGoals(),
      goalAssignments: useSavingsGoalAssignments(),
      ledger: useTransactions(),
      env: useEnvelopes(PERIOD),
      rows: useSavingsGoalEnvelopes(PERIOD),
      report: useSpendingReport(PERIOD),
    }),
    { wrapper }
  );
  return result;
}

function expectBalanced(env) {
  const available = env.rows.reduce((sum, row) => sum + row.availableCents, 0);
  const goalAvailable = env.goalRows.reduce((sum, row) => sum + row.availableCents, 0);
  expect(
    env.toBeAssignedCents + env.emergencyReservedCents + env.assignedAheadCents + available + goalAvailable
  ).toBe(env.openingCents + env.cumIncomeCents - env.cumSpentCents);
}

const wedding = (result) => result.current.rows.find((row) => row.goalId === "g-wedding");
const category = (result, budgetId) => result.current.env.rows.find((row) => row.budgetId === budgetId);

beforeEach(() => {
  localStorage.clear();
});

test("spending from a goal moves the money to the category and records the purchase there", () => {
  seed();
  const result = setup();
  const poolBefore = result.current.env.toBeAssignedCents;
  expectBalanced(result.current.env);

  let outcome;
  act(() => {
    outcome = result.current.actions.spendFromGoal({
      goalId: "g-wedding",
      amount: "8,000",
      budgetId: "b-wedding",
      date: TODAY,
      note: "Venue deposit",
      accountId: "acc-cash",
    });
  });
  expect(outcome.ok).toBe(true);

  // The pool is untouched: the money was already assigned, it only moved.
  expect(result.current.env.toBeAssignedCents).toBe(poolBefore);
  expectBalanced(result.current.env);

  // The category was funded and spent the same amount, so it nets to zero and
  // shows the spending as its activity.
  expect(category(result, "b-wedding")).toMatchObject({ availableCents: 0, activityCents: -800_000 });

  const [purchase] = result.current.ledger.transactions;
  expect(purchase).toMatchObject({
    kind: "outflow",
    amountCents: 800_000,
    budgetId: "b-wedding",
    accountId: "acc-cash",
    description: "Venue deposit",
    date: TODAY,
  });

  // Planned, saved, spent apart — and spending did not move the goal backwards.
  expect(wedding(result)).toMatchObject({
    targetCents: 3_000_000,
    availableCents: 400_000,
    savedCents: 400_000,
    spentCents: 800_000,
    remainingCents: 1_800_000,
  });
  expect(wedding(result).spending).toEqual([
    expect.objectContaining({
      amountCents: 800_000,
      budgetId: "b-wedding",
      note: "Venue deposit",
      transactionId: purchase.id,
      categoryName: "Wedding costs",
    }),
  ]);
});

test("the spending counts in the spending report under its category", () => {
  seed();
  const result = setup();
  act(() => {
    result.current.actions.spendFromGoal({ goalId: "g-wedding", amountCents: 250_000, budgetId: "b-wedding", accountId: "acc-cash" });
  });
  expect(result.current.report.totalSpentCents).toBe(250_000);
  expect(result.current.report.rows.find((row) => row.budgetId === "b-wedding")).toMatchObject({ spentCents: 250_000 });
});

test("a purchase already in the register is not added again; only the money moves", () => {
  seed();
  const result = setup();
  act(() => {
    result.current.actions.spendFromGoal({ goalId: "g-wedding", amountCents: 300_000, budgetId: "b-food", accountId: null });
  });
  expect(result.current.ledger.transactions).toHaveLength(0);
  expect(category(result, "b-food").availableCents).toBe(300_000);
  expect(wedding(result).spentCents).toBe(300_000);
  expect(wedding(result).spending[0].transactionId).toBeNull();
  expectBalanced(result.current.env);
});

test("more than the goal holds, no category, or a bad amount is refused and nothing is written", () => {
  seed();
  const result = setup();
  const refuse = (fields) => {
    let outcome;
    act(() => {
      outcome = result.current.actions.spendFromGoal({ goalId: "g-wedding", budgetId: "b-wedding", accountId: "acc-cash", ...fields });
    });
    expect(outcome.ok).toBe(false);
    return outcome.error;
  };

  expect(refuse({ amountCents: 1_200_001 })).toMatch(/Only \$12,000 is in this goal/);
  expect(refuse({ amountCents: 100, budgetId: "" })).toMatch(/category/);
  expect(refuse({ amount: "lots" })).toMatch(/greater than zero/);
  expect(result.current.ledger.transactions).toHaveLength(0);
  expect(wedding(result).spentCents).toBe(0);
  expect(wedding(result).availableCents).toBe(1_200_000);
});

test("a backdated spend cannot leave a later month of the goal below zero", () => {
  const earlier = addMonths(PERIOD, -1);
  const assignments = [
    { id: "a1", goalId: "g", period: earlier, assignedCents: 500 },
    { id: "a2", goalId: "g", period: PERIOD, assignedCents: -400 },
  ];
  expect(spendableFromGoal(assignments, "g", earlier)).toBe(100);
  expect(spendableFromGoal(assignments, "g", PERIOD)).toBe(100);
});

test("undo puts the money back in the goal and takes the purchase out of the register", () => {
  seed();
  const result = setup();
  act(() => {
    result.current.actions.spendFromGoal({ goalId: "g-wedding", amountCents: 800_000, budgetId: "b-wedding", accountId: "acc-cash" });
  });
  const entry = wedding(result).spending[0];
  act(() => {
    result.current.actions.undoGoalSpending({ goalId: "g-wedding", spendingId: entry.id });
  });

  expect(result.current.ledger.transactions).toHaveLength(0);
  expect(wedding(result)).toMatchObject({ availableCents: 1_200_000, spentCents: 0, spending: [] });
  expect(category(result, "b-wedding")?.availableCents ?? 0).toBe(0);
  expectBalanced(result.current.env);
});

test("closing out a goal returns what is left to the pool, unfunds months ahead, and keeps its spending", () => {
  const ahead = addMonths(PERIOD, 1);
  seed({
    goalAssignments: [
      { id: "ga1", goalId: "g-wedding", period: PERIOD, assignedCents: 1_200_000 },
      { id: "ga2", goalId: "g-wedding", period: ahead, assignedCents: 50_000 },
    ],
  });
  const result = setup();
  act(() => {
    result.current.actions.spendFromGoal({ goalId: "g-wedding", amountCents: 1_000_000, budgetId: "b-wedding", accountId: "acc-cash" });
  });
  const poolBefore = result.current.env.toBeAssignedCents;
  const aheadBefore = result.current.env.assignedAheadCents;

  let outcome;
  act(() => {
    outcome = result.current.actions.archiveGoal({ goalId: "g-wedding" });
  });
  expect(outcome).toEqual({ ok: true, releasedCents: 200_000 });

  expect(result.current.env.toBeAssignedCents).toBe(poolBefore + 200_000 + 50_000);
  expect(result.current.env.assignedAheadCents).toBe(aheadBefore - 50_000);
  expectBalanced(result.current.env);

  expect(wedding(result)).toMatchObject({ archivedOn: TODAY, availableCents: 0, spentCents: 1_000_000 });
  expect(
    result.current.goalAssignments.assignments.filter((a) => a.goalId === "g-wedding" && a.period === ahead)
  ).toHaveLength(0);

  // An archived goal cannot be spent from until it is restored.
  let refused;
  act(() => {
    refused = result.current.actions.spendFromGoal({ goalId: "g-wedding", amountCents: 1, budgetId: "b-wedding" });
  });
  expect(refused.ok).toBe(false);

  act(() => {
    result.current.actions.restoreGoal({ goalId: "g-wedding" });
  });
  expect(wedding(result).archivedOn).toBeNull();
  expect(wedding(result).spentCents).toBe(1_000_000);
});

test("goals saved before spending or archiving existed read as never spent and open", () => {
  seed();
  const result = setup();
  expect(result.current.goals.goals[0]).toMatchObject({ spending: [], archivedOn: null });
});
