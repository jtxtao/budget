import { renderHook } from "@testing-library/react";
import AppProviders from "./contexts/AppProviders";
import { useBudgets } from "./contexts/BudgetsContext";
import { useAccounts } from "./contexts/AccountsContext";
import { useTransactions } from "./contexts/TransactionsContext";
import { useSavingsGoals } from "./contexts/SavingsGoalsContext";
import useEnvelopes from "./hooks/useEnvelopes";
import useDashboard from "./hooks/useDashboard";
import { FUNDING } from "./fundingStatus";
import { STORE_KEYS } from "./storage";
import { demoBooks } from "./devSeed";
import { currentPeriod } from "./utils";

/**
 * The dev server's invented household, held to the same rules a real one is.
 *
 * It is worth a suite of its own for one reason: this snapshot is hand-written
 * JSON that bypasses every mutator, so nothing but a test can catch it drifting
 * out of step with a store's record shape. The migrations are what it meets on
 * the way in, which is exactly what is exercised here — and the envelope
 * identity is what says the invented books are *coherent* rather than merely
 * well-formed.
 */

const wrapper = ({ children }) => <AppProviders>{children}</AppProviders>;

/** Seeded unscoped, which is the real key when no user is in scope. */
function seed() {
  localStorage.clear();
  for (const [key, value] of Object.entries(demoBooks())) {
    localStorage.setItem(key, JSON.stringify(value));
  }
}

beforeEach(seed);

test("every document it writes is a store the app syncs", () => {
  for (const key of Object.keys(demoBooks())) expect(STORE_KEYS).toContain(key);
});

test("the records survive the stores' own migrations unchanged in count", () => {
  const books = demoBooks();
  const { result } = renderHook(
    () => ({
      budgets: useBudgets(),
      accounts: useAccounts(),
      ledger: useTransactions(),
      goals: useSavingsGoals(),
    }),
    { wrapper }
  );

  expect(result.current.accounts.accounts).toHaveLength(books.accounts.length);
  expect(result.current.budgets.budgets).toHaveLength(books.budgets.length);
  expect(result.current.budgets.groups).toHaveLength(books.budgetGroups.length);
  expect(result.current.goals.goals).toHaveLength(books.savingsGoals.length);
  expect(result.current.ledger.transactions).toHaveLength(books.transactions.length);

  // A division dropped on the way in is the one migration that silently
  // rewrites a record, so the split receipt is the row worth naming.
  const divided = result.current.ledger.transactions.filter((row) => row.splits);
  expect(divided).toHaveLength(1);
  expect(divided[0].splits.reduce((sum, part) => sum + part.amountCents, 0)).toBe(
    divided[0].amountCents
  );
});

test("the envelope identity holds over the invented books", () => {
  const period = currentPeriod();
  const { result } = renderHook(() => useEnvelopes(period), { wrapper });
  const { rows, goalRows, toBeAssignedCents, cumIncomeCents, cumSpentCents, openingCents } =
    result.current;

  const available = rows.reduce((sum, row) => sum + row.availableCents, 0);
  const goalAvailable = goalRows.reduce((sum, row) => sum + row.availableCents, 0);

  expect(toBeAssignedCents + available + goalAvailable).toBe(
    openingCents + cumIncomeCents - cumSpentCents
  );
});

test("the pool is left holding a month's worth of unassigned pay", () => {
  const { result } = renderHook(() => useEnvelopes(currentPeriod()), { wrapper });
  // Steered deliberately: a figure in the tens of thousands reads as a bug
  // rather than as a household mid-month.
  expect(result.current.toBeAssignedCents).toBeGreaterThan(0);
  expect(result.current.toBeAssignedCents).toBeLessThan(500000);
});

test("one category sits in each of the five funding readings", () => {
  const { result } = renderHook(() => useDashboard(currentPeriod()), { wrapper });

  const byName = new Map();
  for (const section of result.current.sections) {
    for (const row of section.rows) byName.set(row.name, row);
  }
  for (const row of result.current.otherRows) byName.set(row.name, row);

  expect(byName.get("Groceries").funding.status).toBe(FUNDING.OVERSPENT);
  expect(byName.get("Dining out").funding.status).toBe(FUNDING.UNDERFUNDED);
  expect(byName.get("Rent").funding.status).toBe(FUNDING.ON_TRACK);
  expect(byName.get("Utilities").funding.status).toBe(FUNDING.WELL_FUNDED);
  expect(byName.get("Miscellaneous").funding.status).toBe(FUNDING.NO_ESTIMATE);
});
