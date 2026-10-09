import { act, renderHook } from "@testing-library/react";
import AppProviders from "./AppProviders";
import { useAccounts } from "./AccountsContext";
import { useBudgets } from "./BudgetsContext";
import { useIncomePlan } from "./IncomePlanContext";
import { useSavingsGoals } from "./SavingsGoalsContext";

/**
 * The stores' half of drag to reorder: each list takes a new order for the
 * records a view showed, and nothing about any record changes but its place.
 */

const wrapper = ({ children }) => <AppProviders>{children}</AppProviders>;

beforeEach(() => {
  localStorage.clear();
});

const stored = (key) => JSON.parse(localStorage.getItem(key));
const ids = (records) => records.map((record) => record.id);

function account(id, scope = "on-budget") {
  return {
    id,
    name: `Account ${id}`,
    type: "asset",
    scope,
    assetClass: "Cash",
    openingBalanceCents: 0,
    openingDate: null,
  };
}

describe("reordering", () => {
  it("puts the accounts a view showed in a new order and leaves the rest in place", () => {
    localStorage.setItem(
      "accounts",
      JSON.stringify([account("a"), account("x", "off-budget"), account("b"), account("c")])
    );
    const { result } = renderHook(() => useAccounts(), { wrapper });
    const before = result.current.accounts.find((entry) => entry.id === "b");

    act(() => {
      expect(result.current.reorderAccounts(["c", "a", "b"])).toEqual({ ok: true });
    });

    expect(ids(result.current.accounts)).toEqual(["c", "x", "a", "b"]);
    expect(ids(stored("accounts"))).toEqual(["c", "x", "a", "b"]);
    // Moved, not rewritten.
    expect(result.current.accounts.find((entry) => entry.id === "b")).toEqual(before);
  });

  it("reorders categories without regrouping them, and groups on their own", () => {
    localStorage.setItem(
      "budgetGroups",
      JSON.stringify([
        { id: "g1", name: "Bills", bucket: "essentials" },
        { id: "g2", name: "Fun", bucket: "fun" },
      ])
    );
    localStorage.setItem(
      "budgets",
      JSON.stringify([
        { id: "rent", name: "Rent", plannedCents: 0, groupId: "g1", bucket: "essentials" },
        { id: "power", name: "Power", plannedCents: 0, groupId: "g1", bucket: "essentials" },
        { id: "games", name: "Games", plannedCents: 0, groupId: "g2", bucket: "fun" },
      ])
    );
    const { result } = renderHook(() => useBudgets(), { wrapper });

    act(() => {
      result.current.reorderBudgets(["power", "rent"]);
      result.current.reorderGroups(["g2", "g1"]);
    });

    expect(ids(result.current.budgets)).toEqual(["power", "rent", "games"]);
    expect(result.current.budgets.map((budget) => budget.groupId)).toEqual(["g1", "g1", "g2"]);
    expect(ids(result.current.groups)).toEqual(["g2", "g1"]);
  });

  it("reorders income sources and savings goals", () => {
    localStorage.setItem(
      "incomeSources",
      JSON.stringify([
        { id: "s1", name: "Salary", amountCents: 100000, cadence: "monthly" },
        { id: "s2", name: "Rental", amountCents: 50000, cadence: "monthly" },
      ])
    );
    localStorage.setItem(
      "savingsGoals",
      JSON.stringify([
        { id: "camera", name: "Camera", targetCents: 100000, targetDate: null },
        { id: "wedding", name: "Wedding", targetCents: 900000, targetDate: null },
      ])
    );
    const { result } = renderHook(
      () => ({ income: useIncomePlan(), goals: useSavingsGoals() }),
      { wrapper }
    );

    act(() => {
      result.current.income.reorderIncomeSources(["s2", "s1"]);
      result.current.goals.reorderSavingsGoals(["wedding", "camera"]);
    });

    expect(ids(result.current.income.sources)).toEqual(["s2", "s1"]);
    expect(ids(result.current.goals.goals)).toEqual(["wedding", "camera"]);
  });
});
