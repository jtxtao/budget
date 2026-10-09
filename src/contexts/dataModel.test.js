import { act, renderHook } from "@testing-library/react";
import AppProviders from "./AppProviders";
import {
  DEFAULT_BUCKET,
  PLAN_BUCKETS,
  useBudgets,
  UNCATEGORIZED_BUDGET_ID,
  UNGROUPED_ID,
} from "./BudgetsContext";
import { useIncomePlan } from "./IncomePlanContext";
import { TRANSACTION_KINDS, useTransactions } from "./TransactionsContext";
import { useAccounts } from "./AccountsContext";
import { usePayees } from "./PayeesContext";
import { useAssignments } from "./AssignmentsContext";
import { TO_BE_ASSIGNED } from "./constants";
import { useRetirement } from "./RetirementContext";
import { useSavingsGoals } from "./SavingsGoalsContext";
import { useSavingsGoalAssignments } from "./SavingsGoalAssignmentsContext";
import useAccountBalances from "../hooks/useAccountBalances";
import useEnvelopes from "../hooks/useEnvelopes";
import usePlanHealth from "../hooks/usePlanHealth";
import { monthlyCents } from "../cadence";
import { toSections } from "../planLayout";
import {
  addMonths,
  currentPeriod,
  formatCents,
  periodLTE,
  toBps,
  toCents,
  todayISO,
  toPeriod,
} from "../utils";

const wrapper = ({ children }) => <AppProviders>{children}</AppProviders>;

beforeEach(() => {
  localStorage.clear();
});

function stored(key) {
  return JSON.parse(localStorage.getItem(key));
}

/** The one on-budget account every new transaction has to name. */
const ACCOUNT = {
  id: "acc1",
  name: "Everyday",
  type: "asset",
  scope: "on-budget",
  assetClass: "Cash",
  openingBalanceCents: 0,
  openingDate: null,
};

function seedAccounts(accounts = [ACCOUNT]) {
  localStorage.setItem("accounts", JSON.stringify(accounts));
}

const spend = (fields) => ({ kind: TRANSACTION_KINDS.OUTFLOW, accountId: ACCOUNT.id, ...fields });
const earn = (fields) => ({ kind: TRANSACTION_KINDS.INFLOW, accountId: ACCOUNT.id, ...fields });

describe("money helpers", () => {
  test("dollars convert to integer cents, including the awkward ones", () => {
    expect(toCents("4.50")).toBe(450);
    expect(toCents(0.1)).toBe(10);
    expect(toCents(1.005)).toBe(101);
    expect(toCents(0)).toBe(0);
  });

  test("a figure written the way figures are written is read as one", () => {
    // What a person types off a statement, and what `formatCents` itself writes
    // — the fields show their figures as money, so the parser has to take its
    // own output back. `parseFloat` reads "1,234.56" as 1: it stops at the comma
    // and reports success, which is a four-figure balance stored as one dollar.
    expect(toCents("$1,234.56")).toBe(123456);
    expect(toCents("1,234.56")).toBe(123456);
    expect(toCents(formatCents(725770))).toBe(725770);
    expect(toCents(" $2,500 ")).toBe(250000);
    expect(toCents("-$1,000")).toBe(-100000);
    // The grouping a locale actually uses is a no-break space in some of them,
    // which is what a figure copied out of a rendered page carries.
    expect(toCents("1 234.50")).toBe(123450);
  });

  test("unparseable amounts are rejected rather than becoming NaN", () => {
    expect(toCents("")).toBeNull();
    expect(toCents("abc")).toBeNull();
    expect(toCents(undefined)).toBeNull();
    expect(toCents(NaN)).toBeNull();
    expect(toCents(Infinity)).toBeNull();
    // Tolerating punctuation is not tolerating junk: `parseFloat("12 apples")`
    // is 12, which is how a typo becomes a transaction.
    expect(toCents("12 apples")).toBeNull();
    expect(toCents("1.2.3")).toBeNull();
    expect(toCents("$")).toBeNull();
  });

  test("a rate takes the percent sign the same way an amount takes the dollar", () => {
    expect(toBps("7%")).toBe(700);
    expect(toBps("2.5")).toBe(250);
    expect(toBps("7 %")).toBe(700);
    expect(toBps("%")).toBeNull();
    expect(toBps("seven percent")).toBeNull();
  });

  test("cents sum exactly where floating-point dollars would drift", () => {
    const dollars = [0.1, 0.2, 0.3];
    expect(dollars.reduce((a, b) => a + b, 0)).not.toBe(0.6);
    expect(dollars.map(toCents).reduce((a, b) => a + b, 0)).toBe(60);
  });

  test("money renders whole or to the cent, never to one decimal place", () => {
    // A single formatter with min 0 / max 2 fraction digits printed $7,257.70
    // as "$7,257.7". Round figures still print whole, so a plan of estimates is
    // not a wall of ".00".
    expect(formatCents(725770)).toBe("$7,257.70");
    expect(formatCents(725700)).toBe("$7,257");
    expect(formatCents(-86045)).toBe("-$860.45");
    expect(formatCents(-86000)).toBe("-$860");
    expect(formatCents(0)).toBe("$0");
    expect(formatCents(5)).toBe("$0.05");
  });

  test("dates use the local calendar, not UTC", () => {
    // toISOString() would report the previous day for anyone west of Greenwich
    // in the evening.
    const evening = new Date(2026, 0, 31, 23, 30);
    expect(todayISO(evening)).toBe("2026-01-31");
    expect(toPeriod(todayISO(evening))).toBe("2026-01");
  });
});

describe("migrating records written before the schema changed", () => {
  test("the two old ledgers fold into one, keeping which way the money went", () => {
    localStorage.setItem(
      "expenses",
      JSON.stringify([{ id: "e1", description: "Coffee", amount: 4.5, budgetId: "b1" }])
    );
    localStorage.setItem(
      "income",
      JSON.stringify([{ id: "i1", description: "Salary", amount: 3000 }])
    );

    const { result } = renderHook(() => useTransactions(), { wrapper });

    expect(result.current.transactions).toEqual([
      {
        id: "e1",
        kind: "outflow",
        // Neither old store had payees, so the text it did hold stays where it is
        // — as the row's note. Minting a payee out of free text would invent a
        // decision the household never made.
        payeeId: null,
        description: "Coffee",
        amountCents: 450,
        date: null,
        // Nothing recorded which account the money moved through, and there is
        // no way to work it out after the fact.
        accountId: null,
        // Neither old store had a kind that could name a second account.
        toAccountId: null,
        // Nor could either have been divided between categories.
        splits: null,
        budgetId: "b1",
      },
      {
        id: "i1",
        kind: "inflow",
        payeeId: null,
        description: "Salary",
        amountCents: 300000,
        date: null,
        accountId: null,
        toAccountId: null,
        splits: null,
        budgetId: null,
      },
    ]);
  });

  test("the fold runs once — a second mount does not duplicate the ledger", () => {
    localStorage.setItem(
      "expenses",
      JSON.stringify([{ id: "e1", description: "Coffee", amount: 4.5, budgetId: "b1" }])
    );

    renderHook(() => useTransactions(), { wrapper }).unmount();
    const { result } = renderHook(() => useTransactions(), { wrapper });

    // The old keys are left in storage rather than deleted, so the guard has to
    // be the new key existing, not the old ones being gone.
    expect(result.current.transactions).toHaveLength(1);
  });

  test("a hand-edited record with no direction is kept as spend rather than dropped", () => {
    localStorage.setItem(
      "transactions",
      JSON.stringify([{ id: "t1", description: "Mystery", amountCents: 500, budgetId: "b1" }])
    );

    const { result } = renderHook(() => useTransactions(), { wrapper });

    // Money vanishing from the books is worse than money on the wrong side of
    // them, and almost every row in any ledger is spending.
    expect(result.current.transactions[0].kind).toBe("outflow");
  });

  test("a legacy budget's floating-point max becomes its standing estimate in cents", () => {
    localStorage.setItem("budgets", JSON.stringify([{ id: "b1", name: "Groceries", max: 400 }]));

    const { result } = renderHook(() => useBudgets(), { wrapper });

    expect(result.current.budgets).toEqual([
      {
        id: "b1",
        name: "Groceries",
        plannedCents: 40000,
        groupId: UNGROUPED_ID,
        // Nothing stated, and no group to take a default from, so it lands on
        // the app default rather than on a state that means "ask someone else".
        bucket: DEFAULT_BUCKET,
        // A record saved before goals existed was saving towards nothing.
        goalCents: null,
      },
    ]);
  });

  test("the last per-period plan folds into the estimate on the budget", () => {
    // The schema in between filed an estimate against each month. The standing
    // figure is the most recent one the user stated, not the earliest.
    localStorage.setItem("budgets", JSON.stringify([{ id: "b1", name: "Groceries" }]));
    localStorage.setItem(
      "budgetPlans",
      JSON.stringify([
        { id: "p1", budgetId: "b1", period: "2026-01", plannedCents: 40000 },
        { id: "p2", budgetId: "b1", period: "2026-04", plannedCents: 50000 },
        { id: "p3", budgetId: "b1", period: "2026-02", plannedCents: 45000 },
      ])
    );

    const { result } = renderHook(() => useBudgets(), { wrapper });

    expect(result.current.budgets[0].plannedCents).toBe(50000);
  });

  test("a broken budgetPlans key costs the estimates, not the categories", () => {
    localStorage.setItem("budgets", JSON.stringify([{ id: "b1", name: "Groceries" }]));
    localStorage.setItem("budgetPlans", "{ not json");

    const { result } = renderHook(() => useBudgets(), { wrapper });

    expect(result.current.budgets).toEqual([
      {
        id: "b1",
        name: "Groceries",
        plannedCents: 0,
        groupId: UNGROUPED_ID,
        bucket: DEFAULT_BUCKET,
        goalCents: null,
      },
    ]);
  });

  test("migration is idempotent — a second mount does not re-read the old key", () => {
    localStorage.setItem("budgets", JSON.stringify([{ id: "b1", name: "Groceries" }]));
    localStorage.setItem(
      "budgetPlans",
      JSON.stringify([{ id: "p1", budgetId: "b1", period: "2026-01", plannedCents: 40000 }])
    );

    renderHook(() => useBudgets(), { wrapper }).unmount();
    // The estimate is on the record now, so the legacy key is not consulted
    // again — and editing it down to zero must not be undone by a remount.
    const { result } = renderHook(() => useBudgets(), { wrapper });
    act(() => {
      result.current.updateBudget({ id: "b1", plannedCents: 0 });
    });

    renderHook(() => useBudgets(), { wrapper }).unmount();
    const { result: remounted } = renderHook(() => useBudgets(), { wrapper });

    expect(remounted.current.budgets[0].plannedCents).toBe(0);
  });

  test("a legacy income source loses its anchor date and keeps its cadence", () => {
    localStorage.setItem(
      "incomeSources",
      JSON.stringify([
        {
          id: "s1",
          name: "Salary",
          amount: 1500,
          cadence: "biweekly",
          anchorDate: "2026-01-02",
          endDate: null,
        },
      ])
    );

    const { result } = renderHook(() => useIncomePlan(), { wrapper });

    expect(result.current.sources).toEqual([
      { id: "s1", name: "Salary", amountCents: 150000, cadence: "biweekly" },
    ]);
  });

  test("an account saved before opening balances existed opens at zero, undated", () => {
    localStorage.setItem(
      "accounts",
      JSON.stringify([
        { id: "a1", name: "Everyday", type: "asset", assetClass: "Cash", institution: "" },
      ])
    );

    const { result } = renderHook(() => useAccounts(), { wrapper });

    expect(result.current.accounts[0]).toMatchObject({
      scope: "on-budget",
      openingBalanceCents: 0,
      openingDate: null,
    });
  });

  test("garbage in storage does not take the app down", () => {
    localStorage.setItem("transactions", "{ not json");
    localStorage.setItem("budgets", JSON.stringify("not even an array"));

    const { result } = renderHook(
      () => ({ budgets: useBudgets(), ledger: useTransactions() }),
      { wrapper }
    );

    expect(result.current.ledger.transactions).toEqual([]);
    expect(result.current.budgets.budgets).toEqual([]);
  });
});

describe("amounts are validated at the context boundary", () => {
  beforeEach(seedAccounts);

  test("a non-numeric amount is rejected, not stored as null", () => {
    const { result } = renderHook(() => useTransactions(), { wrapper });

    let outcome;
    act(() => {
      outcome = result.current.addTransaction(
        spend({ description: "Bad", amount: "abc", budgetId: "x" })
      );
    });

    expect(outcome.ok).toBe(false);
    expect(result.current.transactions).toHaveLength(0);
  });

  test("an invalid date is rejected", () => {
    const { result } = renderHook(() => useTransactions(), { wrapper });

    let outcome;
    act(() => {
      outcome = result.current.addTransaction(
        spend({ description: "Bad", amount: "5", budgetId: "x", date: "last tuesday" })
      );
    });

    expect(outcome.ok).toBe(false);
    expect(result.current.transactions).toHaveLength(0);
  });

  test("a valid expense stores integer cents and today's date by default", () => {
    const { result } = renderHook(() => useTransactions(), { wrapper });

    act(() => {
      result.current.addTransaction(spend({ description: "Coffee", amount: "4.50", budgetId: "x" }));
    });

    expect(result.current.transactions[0]).toMatchObject({
      kind: "outflow",
      description: "Coffee",
      amountCents: 450,
      date: todayISO(),
      accountId: ACCOUNT.id,
      budgetId: "x",
    });
    expect(stored("transactions")[0].amountCents).toBe(450);
  });
});

describe("a transaction is finished when it is saved", () => {
  beforeEach(seedAccounts);

  test("spend with no category is refused, not filed under Uncategorized", () => {
    const { result } = renderHook(() => useTransactions(), { wrapper });

    let outcome;
    act(() => {
      outcome = result.current.addTransaction(spend({ description: "Coffee", amount: "4.50" }));
    });

    // The alternative is a ledger that grows a backlog of half-finished rows,
    // and every figure derived from it being provisional until they are cleared.
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/category/i);
    expect(result.current.transactions).toHaveLength(0);
  });

  test("money with no account is refused, in either direction", () => {
    const { result } = renderHook(() => useTransactions(), { wrapper });

    let out;
    let inn;
    act(() => {
      out = result.current.addTransaction({
        kind: TRANSACTION_KINDS.OUTFLOW,
        description: "Coffee",
        amount: "4.50",
        budgetId: "x",
      });
      inn = result.current.addTransaction({
        kind: TRANSACTION_KINDS.INFLOW,
        description: "Pay",
        amount: "3000",
      });
    });

    // Without an account there is no balance for the money to come out of, and
    // an account balance that ignores half the ledger is worse than none.
    expect(out.ok).toBe(false);
    expect(inn.ok).toBe(false);
    expect(result.current.transactions).toHaveLength(0);
  });

  test("an inflow with no category is income; one with a category is a refund", () => {
    const { result } = renderHook(() => useTransactions(), { wrapper });

    act(() => {
      result.current.addTransaction(earn({ description: "Pay", amount: "3000" }));
      result.current.addTransaction(
        earn({ description: "Dinner, split", amount: "60", budgetId: "food" })
      );
    });

    const [pay, refund] = result.current.transactions;
    expect(pay.budgetId).toBeNull();
    // Not stripped: money paid back into a category was assigned on its way out
    // and belongs back in that envelope, not in the pool a second time.
    expect(refund.budgetId).toBe("food");
  });

  test("an empty category on an inflow is income, not a refund against nothing", () => {
    const { result } = renderHook(() => useTransactions(), { wrapper });

    // "" is what an unpicked select is worth in the DOM.
    act(() => {
      result.current.addTransaction(earn({ description: "Pay", amount: "3000", budgetId: "" }));
    });

    expect(result.current.transactions[0].budgetId).toBeNull();
  });
});

describe("a record can be corrected in place", () => {
  beforeEach(seedAccounts);

  function withSpend() {
    const { result } = renderHook(() => useTransactions(), { wrapper });
    act(() => {
      result.current.addTransaction(
        spend({ description: "Coffee", amount: "4.50", budgetId: "b1", date: "2026-08-04" })
      );
    });
    return result;
  }

  test("a patch writes the fields it names and leaves the rest alone", () => {
    const result = withSpend();
    const { id } = result.current.transactions[0];

    act(() => {
      result.current.updateTransaction({ id, description: "  Coffee, twice  ", amount: "9" });
    });

    // Dollars as typed, exactly as on the way in, and the untouched fields are
    // still what they were — a mutator that took a whole row would have every
    // cell resubmitting the five it did not change.
    expect(result.current.transactions[0]).toEqual({
      id,
      kind: TRANSACTION_KINDS.OUTFLOW,
      payeeId: null,
      description: "Coffee, twice",
      amountCents: 900,
      date: "2026-08-04",
      accountId: ACCOUNT.id,
      toAccountId: null,
      splits: null,
      budgetId: "b1",
    });
  });

  test("the direction is an ordinary field, so a misfiled row is one edit from right", () => {
    const result = withSpend();
    const { id } = result.current.transactions[0];

    act(() => {
      result.current.updateTransaction({ id, kind: TRANSACTION_KINDS.INFLOW });
    });

    // An inflow filed against a category is a refund back into that envelope,
    // and everything else typed on the row survives the correction.
    expect(result.current.transactions[0]).toMatchObject({
      kind: TRANSACTION_KINDS.INFLOW,
      budgetId: "b1",
      amountCents: 450,
    });
  });

  test("an outflow cannot be left without a category, whichever side moves", () => {
    const result = withSpend();
    const { id } = result.current.transactions[0];

    let cleared;
    act(() => {
      cleared = result.current.updateTransaction({ id, budgetId: "" });
    });
    expect(cleared.ok).toBe(false);
    expect(cleared.error).toMatch(/category/i);

    // The other side of the same rule: income has no category, so turning one
    // into an expense breaks it just as clearing the category would.
    act(() => {
      result.current.addTransaction(earn({ description: "Pay", amount: "3000" }));
    });
    const income = result.current.transactions[1];

    let flipped;
    act(() => {
      flipped = result.current.updateTransaction({
        id: income.id,
        kind: TRANSACTION_KINDS.OUTFLOW,
      });
    });
    expect(flipped.ok).toBe(false);
    expect(result.current.transactions[1].kind).toBe(TRANSACTION_KINDS.INFLOW);
  });

  test("a date or an account can be corrected but never taken off", () => {
    const result = withSpend();
    const { id } = result.current.transactions[0];

    let blanked;
    act(() => {
      blanked = result.current.updateTransaction({ id, date: "" });
    });
    expect(blanked.ok).toBe(false);

    act(() => {
      blanked = result.current.updateTransaction({ id, accountId: "" });
    });
    expect(blanked.ok).toBe(false);
    expect(result.current.transactions[0].accountId).toBe(ACCOUNT.id);
  });

  test("a legacy row accepts a correction to what it has, without inventing the rest", () => {
    // Folded in from the old store: no date, no account, and no way to work
    // either of them out after the fact.
    localStorage.setItem(
      "expenses",
      JSON.stringify([{ id: "e0", description: "Old", amount: 20, budgetId: "b1" }])
    );
    const { result } = renderHook(() => useTransactions(), { wrapper });

    let outcome;
    act(() => {
      outcome = result.current.updateTransaction({ id: "e0", description: "Parking, 2019" });
    });

    // An update checks what it changes. Refusing to fix a typo until the user
    // invents a date for a 2019 receipt would be a worse ledger, not a
    // stricter one — and the gaps still cannot be re-opened once filled.
    expect(outcome.ok).toBe(true);
    expect(result.current.transactions[0]).toMatchObject({
      description: "Parking, 2019",
      date: null,
      accountId: null,
    });
  });

  test("a row already deleted is reported, not written back into the ledger", () => {
    const result = withSpend();

    let outcome;
    act(() => {
      outcome = result.current.updateTransaction({ id: "gone", description: "Anything" });
    });

    expect(outcome.ok).toBe(false);
    expect(result.current.transactions).toHaveLength(1);
  });

  test("a value the store already holds is not written again", () => {
    const result = withSpend();
    const before = result.current.transactions;

    act(() => {
      result.current.updateTransaction({
        id: before[0].id,
        description: "Coffee",
        amountCents: 450,
      });
    });

    // Same array, so nothing downstream re-rendered. In a grid whose cells
    // commit on blur, tabbing across one row would otherwise do that per column.
    expect(result.current.transactions).toBe(before);
  });
});

describe("a refund goes back to the category it came out of", () => {
  const period = currentPeriod();

  function seedFoodSpend() {
    seedAccounts();
    localStorage.setItem("assignments", JSON.stringify([]));
    localStorage.setItem(
      "budgets",
      JSON.stringify([{ id: "food", name: "Food", groupId: null, plannedCents: 0, bucket: null }])
    );
  }

  test("$100 spent and $60 paid back is $40 of activity", () => {
    seedFoodSpend();
    const useAll = () => ({ tx: useTransactions(), env: useEnvelopes(period) });
    const { result } = renderHook(useAll, { wrapper });

    act(() => {
      result.current.tx.addTransaction(
        spend({ description: "Dinner", amountCents: 10000, budgetId: "food" })
      );
    });
    act(() => {
      result.current.tx.addTransaction(
        earn({ description: "Their half", amountCents: 6000, budgetId: "food" })
      );
    });

    const row = envelopeFor(result.current.env, "food");
    expect(row.activityCents).toBe(-4000);
    // The gross figures survive alongside it, for anything that has to say
    // "spent" as a quantity rather than as a movement.
    expect(row.spentCents).toBe(10000);
    expect(row.refundCents).toBe(6000);
    expect(row.availableCents).toBe(-4000);
  });

  test("the refund never reaches the pool, so the money is not assignable twice", () => {
    seedFoodSpend();
    const useAll = () => ({ tx: useTransactions(), env: useEnvelopes(period) });
    const { result } = renderHook(useAll, { wrapper });

    act(() => {
      result.current.tx.addTransaction(earn({ description: "Pay", amountCents: 300000 }));
    });
    act(() => {
      result.current.tx.addTransaction(
        earn({ description: "Their half", amountCents: 6000, budgetId: "food" })
      );
    });

    // Only the paycheque. The refund went back into the envelope instead.
    expect(result.current.env.periodIncomeCents).toBe(300000);
    expect(result.current.env.toBeAssignedCents).toBe(300000);
    // Cash on hand still counts both, which is what keeps the identity true.
    expect(result.current.env.cumIncomeCents).toBe(306000);
  });

  test("deleting the category takes the refund with the spend it offsets", () => {
    seedFoodSpend();
    const useAll = () => ({
      tx: useTransactions(),
      budgets: useBudgets(),
      env: useEnvelopes(period),
    });
    const { result } = renderHook(useAll, { wrapper });

    act(() => {
      result.current.tx.addTransaction(
        spend({ description: "Dinner", amountCents: 10000, budgetId: "food" })
      );
    });
    act(() => {
      result.current.tx.addTransaction(
        earn({ description: "Their half", amountCents: 6000, budgetId: "food" })
      );
    });
    act(() => {
      result.current.budgets.deleteBudget({ id: "food" });
    });

    // Leaving the refund behind would show $100 spent on a dinner that cost $40.
    const row = envelopeFor(result.current.env, UNCATEGORIZED_BUDGET_ID);
    expect(row.activityCents).toBe(-4000);
    expect(
      result.current.tx.transactions.every(
        (transaction) => transaction.budgetId === UNCATEGORIZED_BUDGET_ID
      )
    ).toBe(true);
  });
});

describe("the estimate is one standing figure on the category", () => {
  test("it reads the same in every period, past and future alike", () => {
    const useAll = () => ({
      budgets: useBudgets(),
      past: useEnvelopes("2020-01"),
      later: useEnvelopes("2030-12"),
    });
    const { result } = renderHook(useAll, { wrapper });

    let id;
    act(() => {
      id = result.current.budgets.addBudget({ name: "Groceries", planned: "400" }).id;
    });

    // No carry-forward rule to get wrong: there is one figure, and it describes
    // the category rather than a month.
    expect(envelopeFor(result.current.past, id).plannedCents).toBe(40000);
    expect(envelopeFor(result.current.later, id).plannedCents).toBe(40000);
  });

  test("editing it restates the plan rather than adding a record", () => {
    const { result } = renderHook(() => useBudgets(), { wrapper });

    let id;
    act(() => {
      id = result.current.addBudget({ name: "Groceries", planned: "400" }).id;
    });
    act(() => {
      result.current.updateBudget({ id, planned: "500" });
    });

    expect(result.current.budgets).toHaveLength(1);
    expect(result.current.getPlannedCents(id)).toBe(50000);
    expect(result.current.totalPlannedCents).toBe(50000);
  });

  test("a category with no estimate stated reads as zero, and junk is refused", () => {
    const { result } = renderHook(() => useBudgets(), { wrapper });

    let blank;
    let junk;
    act(() => {
      blank = result.current.addBudget({ name: "Undecided" });
      junk = result.current.addBudget({ name: "Nonsense", planned: "abc" });
    });

    expect(blank.ok).toBe(true);
    expect(result.current.getPlannedCents(blank.id)).toBe(0);
    expect(junk.ok).toBe(false);
    expect(result.current.budgets).toHaveLength(1);
  });

  test("renaming does not blank the estimate it was not asked about", () => {
    const { result } = renderHook(() => useBudgets(), { wrapper });

    let id;
    act(() => {
      id = result.current.addBudget({ name: "Groceries", planned: "400" }).id;
    });
    act(() => {
      result.current.updateBudget({ id, name: "Food" });
    });

    expect(result.current.budgets[0]).toMatchObject({ name: "Food", plannedCents: 40000 });
  });
});

/**
 * The goal is the second figure on a category and the only optional one, so what
 * these pin down is the blank: it has to stay tellable from a zero on the way
 * in, on the way out, and on the way back off again. The estimate beside it
 * takes a blank as zero, which is why the two are worth checking together.
 */
describe("the goal a category is saving towards", () => {
  const add = (result, fields) => {
    let outcome;
    act(() => {
      outcome = result.current.addBudget({ name: "Car fund", ...fields });
    });
    return outcome;
  };

  test("a category with no goal stated is saving towards nothing", () => {
    const { result } = renderHook(() => useBudgets(), { wrapper });

    const unstated = add(result, { planned: "200" });
    const blank = add(result, { name: "Holiday", planned: "100", goal: "" });

    expect(unstated.ok).toBe(true);
    expect(blank.ok).toBe(true);
    // Null, not zero: the dashboard draws one as a dash and the other as $0.
    expect(result.current.budgets.map((budget) => budget.goalCents)).toEqual([null, null]);
  });

  test("a stated goal is stored in cents beside the estimate", () => {
    const { result } = renderHook(() => useBudgets(), { wrapper });

    const { id } = add(result, { planned: "200", goal: "5000" });

    expect(result.current.budgets[0]).toMatchObject({
      id,
      plannedCents: 20000,
      goalCents: 500000,
    });
  });

  test("clearing the field takes the goal off, and says so rather than storing zero", () => {
    const { result } = renderHook(() => useBudgets(), { wrapper });

    const { id } = add(result, { planned: "200", goal: "5000" });
    act(() => {
      result.current.updateBudget({ id, goal: "" });
    });

    expect(result.current.budgets[0].goalCents).toBeNull();
  });

  test("zero is refused, since a goal of nothing is how no goal is already said", () => {
    const { result } = renderHook(() => useBudgets(), { wrapper });

    const { id } = add(result, { planned: "200", goal: "5000" });

    let zero;
    let negative;
    let junk;
    act(() => {
      zero = result.current.updateBudget({ id, goal: "0" });
      negative = result.current.updateBudget({ id, goal: "-5" });
      junk = result.current.updateBudget({ id, goal: "soon" });
    });

    expect([zero.ok, negative.ok, junk.ok]).toEqual([false, false, false]);
    // A refused figure changes nothing — in particular it does not clear the
    // goal that was there, which is what a bad parse read as null would do.
    expect(result.current.budgets[0].goalCents).toBe(500000);
  });

  test("editing one figure leaves the other alone in both directions", () => {
    const { result } = renderHook(() => useBudgets(), { wrapper });

    const { id } = add(result, { planned: "200", goal: "5000" });
    act(() => {
      result.current.updateBudget({ id, planned: "250" });
    });
    act(() => {
      result.current.updateBudget({ id, goal: "6000" });
    });

    expect(result.current.budgets[0]).toMatchObject({
      plannedCents: 25000,
      goalCents: 600000,
    });
  });

  test("a goal survives a delete of the group it was filed under", () => {
    const { result } = renderHook(() => useBudgets(), { wrapper });

    let groupId;
    act(() => {
      groupId = result.current.addGroup({ name: "Sinking funds" }).id;
    });
    add(result, { planned: "200", goal: "5000", groupId });
    act(() => {
      result.current.deleteGroup({ id: groupId });
    });

    expect(result.current.budgets[0]).toMatchObject({ groupId: UNGROUPED_ID, goalCents: 500000 });
  });
});

describe("expected income is an average, never a month", () => {
  test("a cadence contributes its yearly total spread over twelve months", () => {
    // 26 fortnightly payments is 2.1667 a month, not two. Taking two would
    // leave the plan short by a month's pay every year.
    expect(monthlyCents(150000, "biweekly")).toBe(325000);
    expect(monthlyCents(150000, "semimonthly")).toBe(300000);
    expect(monthlyCents(150000, "monthly")).toBe(150000);
    expect(monthlyCents(120000, "annually")).toBe(10000);
  });

  test("an unknown cadence expects nothing rather than guessing", () => {
    expect(monthlyCents(150000, "fortnightly-ish")).toBe(0);
    expect(monthlyCents(150000, undefined)).toBe(0);
  });

  test("a source without a cadence is refused at the boundary", () => {
    const { result } = renderHook(() => useIncomePlan(), { wrapper });

    let outcome;
    act(() => {
      outcome = result.current.addIncomeSource({ name: "Salary", amount: "1500" });
    });

    expect(outcome.ok).toBe(false);
    expect(result.current.sources).toHaveLength(0);
  });

  test("the expected total is the sum of the monthly averages", () => {
    const { result } = renderHook(() => useIncomePlan(), { wrapper });

    act(() => {
      result.current.addIncomeSource({ name: "Salary", amount: "1500", cadence: "biweekly" });
      result.current.addIncomeSource({ name: "Rent", amount: "800", cadence: "monthly" });
    });

    expect(result.current.expectedMonthlyCents).toBe(325000 + 80000);
  });
});

describe("groups are headings, not owners", () => {
  test("deleting one hands its categories back rather than taking them with it", () => {
    const { result } = renderHook(() => useBudgets(), { wrapper });

    let groupId;
    let budgetId;
    act(() => {
      groupId = result.current.addGroup({ name: "Fixed" }).id;
    });
    act(() => {
      budgetId = result.current.addBudget({ name: "Rent", planned: "1200", groupId }).id;
    });

    expect(result.current.budgets[0].groupId).toBe(groupId);

    act(() => {
      result.current.deleteGroup({ id: groupId });
    });

    expect(result.current.groups).toHaveLength(0);
    expect(result.current.budgets).toHaveLength(1);
    expect(result.current.budgets[0]).toMatchObject({
      id: budgetId,
      plannedCents: 120000,
      groupId: UNGROUPED_ID,
    });
  });

  test("a category filed under a group that never existed is not stranded", () => {
    const { result } = renderHook(() => useBudgets(), { wrapper });

    act(() => {
      result.current.addBudget({ name: "Rent", planned: "1200", groupId: "no-such-group" });
    });

    expect(result.current.budgets[0].groupId).toBe(UNGROUPED_ID);
  });

  test("clashing group names are refused, case-insensitively", () => {
    const { result } = renderHook(() => useBudgets(), { wrapper });

    let outcome;
    act(() => {
      result.current.addGroup({ name: "Fixed" });
    });
    act(() => {
      outcome = result.current.addGroup({ name: "  fixed  " });
    });

    expect(outcome.ok).toBe(false);
    expect(result.current.groups).toHaveLength(1);
  });
});

describe("rearranging the categories", () => {
  function seedThree(result) {
    const ids = {};
    act(() => {
      ids.fixed = result.current.addGroup({ name: "Fixed" }).id;
    });
    act(() => {
      ids.rent = result.current.addBudget({ name: "Rent", planned: "1200" }).id;
      ids.food = result.current.addBudget({ name: "Food", planned: "400" }).id;
      ids.fuel = result.current.addBudget({ name: "Fuel", planned: "120" }).id;
    });
    return ids;
  }

  test("one commit changes both the group and the order", () => {
    const { result } = renderHook(() => useBudgets(), { wrapper });
    const ids = seedThree(result);

    act(() => {
      result.current.setCategoryLayout([
        { groupId: ids.fixed, budgetIds: [ids.rent] },
        { groupId: null, budgetIds: [ids.fuel, ids.food] },
      ]);
    });

    expect(result.current.budgets.map((budget) => budget.name)).toEqual(["Rent", "Fuel", "Food"]);
    expect(result.current.budgets[0].groupId).toBe(ids.fixed);
    expect(result.current.budgets[1].groupId).toBe(UNGROUPED_ID);
  });

  test("a rearrangement never deletes a category it was not told about", () => {
    const { result } = renderHook(() => useBudgets(), { wrapper });
    const ids = seedThree(result);

    act(() => {
      // Fuel is missing, and one id is not a category at all.
      result.current.setCategoryLayout([
        { groupId: ids.fixed, budgetIds: [ids.food, "not-a-budget"] },
      ]);
    });

    expect(result.current.budgets).toHaveLength(3);
    expect(result.current.budgets.map((budget) => budget.name)).toEqual(["Food", "Rent", "Fuel"]);
  });

  test("the same category listed twice lands once", () => {
    const { result } = renderHook(() => useBudgets(), { wrapper });
    const ids = seedThree(result);

    act(() => {
      result.current.setCategoryLayout([
        { groupId: ids.fixed, budgetIds: [ids.rent] },
        { groupId: null, budgetIds: [ids.rent, ids.food, ids.fuel] },
      ]);
    });

    expect(result.current.budgets).toHaveLength(3);
    expect(result.current.budgets[0].groupId).toBe(ids.fixed);
  });

  test("sections fold the two flat lists back into headings, ungrouped last", () => {
    const { result } = renderHook(() => useBudgets(), { wrapper });
    const ids = seedThree(result);

    act(() => {
      result.current.setCategoryLayout([
        { groupId: ids.fixed, budgetIds: [ids.rent, ids.food] },
        { groupId: null, budgetIds: [ids.fuel] },
      ]);
    });

    const sections = toSections(result.current.groups, result.current.budgets);

    expect(sections).toHaveLength(2);
    expect(sections[0]).toMatchObject({ groupId: ids.fixed, name: "Fixed", plannedCents: 160000 });
    expect(sections[0].budgets.map((budget) => budget.name)).toEqual(["Rent", "Food"]);
    // Always present, even when empty — it is the only place a category can be
    // dragged out to.
    expect(sections[1]).toMatchObject({ groupId: UNGROUPED_ID, plannedCents: 12000 });
  });
});

describe("what a category is for", () => {
  // usePlanHealth is where the split is worked out, and it reads three stores,
  // so the plan and the verdict on it are driven through one hook.
  function renderPlan() {
    return renderHook(
      () => ({ ...useBudgets(), ...useRetirement(), health: usePlanHealth() }),
      { wrapper }
    );
  }

  test("a category with nothing stated starts on its group's bucket, on its own record", () => {
    const { result } = renderPlan();

    let groupId;
    act(() => {
      groupId = result.current.addGroup({ name: "Leisure", bucket: PLAN_BUCKETS.FUN }).id;
    });
    act(() => {
      result.current.addBudget({ name: "Cinema", planned: "40", groupId });
    });

    // Resolved once, when the category is created — not left as a null for
    // every reader to resolve differently later.
    expect(result.current.budgets[0].bucket).toBe(PLAN_BUCKETS.FUN);
    expect(result.current.health.sections[0].budgets[0].effectiveBucket).toBe(PLAN_BUCKETS.FUN);
  });

  test("a category that states its own keeps it, and cannot be handed back", () => {
    const { result } = renderPlan();

    let groupId;
    let budgetId;
    act(() => {
      groupId = result.current.addGroup({ name: "Leisure", bucket: PLAN_BUCKETS.FUN }).id;
    });
    act(() => {
      budgetId = result.current.addBudget({
        name: "Holiday fund",
        planned: "200",
        groupId,
        bucket: PLAN_BUCKETS.SAVINGS,
      }).id;
    });

    expect(result.current.health.sections[0].budgets[0].effectiveBucket).toBe(
      PLAN_BUCKETS.SAVINGS
    );

    // Deferring is not a state any more, so null is junk like any other
    // non-bucket — refused, with the category left as it was.
    let outcome;
    act(() => {
      outcome = result.current.updateBudget({ id: budgetId, bucket: null });
    });

    expect(outcome.ok).toBe(false);
    expect(result.current.budgets[0].bucket).toBe(PLAN_BUCKETS.SAVINGS);
  });

  test("an ungrouped category with nothing stated falls back to the app default", () => {
    const { result } = renderPlan();

    act(() => {
      result.current.addBudget({ name: "Rent", planned: "1200" });
    });

    const [ungrouped] = result.current.health.sections;
    expect(ungrouped.budgets[0].effectiveBucket).toBe(DEFAULT_BUCKET);
  });

  test("dragging a category into another group moves it without re-labelling it", () => {
    // A rearrangement is a rearrangement. Money moving between the shares of the
    // split because a row was dragged under a different heading is exactly the
    // silent edit that dropping the deferring state was meant to end.
    const { result } = renderPlan();

    const ids = {};
    act(() => {
      ids.fun = result.current.addGroup({ name: "Leisure", bucket: PLAN_BUCKETS.FUN }).id;
      ids.saving = result.current.addGroup({ name: "Future", bucket: PLAN_BUCKETS.SAVINGS }).id;
    });
    act(() => {
      ids.trips = result.current.addBudget({ name: "Trips", planned: "100", groupId: ids.fun }).id;
    });

    act(() => {
      result.current.setCategoryLayout([{ groupId: ids.saving, budgetIds: [ids.trips] }]);
    });

    expect(result.current.budgets[0].groupId).toBe(ids.saving);
    expect(result.current.budgets[0].bucket).toBe(PLAN_BUCKETS.FUN);
    expect(result.current.health.bucketRows).toMatchObject([
      { bucket: PLAN_BUCKETS.ESSENTIALS, percent: 0 },
      { bucket: PLAN_BUCKETS.FUN, percent: 100 },
      { bucket: PLAN_BUCKETS.SAVINGS, percent: 0 },
      { bucket: PLAN_BUCKETS.RETIREMENT, percent: 0 },
    ]);
  });

  test("deleting a group leaves its categories counting as they did", () => {
    // The heading goes; what the user said the money was for does not. Falling
    // back to the app default here would move money between the shares of the
    // split with nothing on screen to explain it.
    const { result } = renderPlan();

    let groupId;
    act(() => {
      groupId = result.current.addGroup({ name: "Leisure", bucket: PLAN_BUCKETS.FUN }).id;
    });
    act(() => {
      result.current.addBudget({ name: "Cinema", planned: "40", groupId });
      result.current.addBudget({
        name: "Holiday fund",
        planned: "60",
        groupId,
        bucket: PLAN_BUCKETS.SAVINGS,
      });
    });

    act(() => {
      result.current.deleteGroup({ id: groupId });
    });

    // Both already said what they were for — one from the group's default, one
    // stated outright — and losing the heading changes neither.
    expect(result.current.budgets.map((budget) => budget.bucket)).toEqual([
      PLAN_BUCKETS.FUN,
      PLAN_BUCKETS.SAVINGS,
    ]);
  });

  test("the split is a share of what is planned, and adds up to 100", () => {
    const { result } = renderPlan();

    act(() => {
      result.current.addBudget({ name: "Rent", planned: "100", bucket: PLAN_BUCKETS.ESSENTIALS });
      result.current.addBudget({ name: "Cinema", planned: "100", bucket: PLAN_BUCKETS.FUN });
      result.current.addBudget({ name: "Pension", planned: "100", bucket: PLAN_BUCKETS.SAVINGS });
    });

    const { bucketRows } = result.current.health;

    // A third apiece rounds to 33 three times over, which is not a whole split;
    // the untouched retirement bucket carries the fourth slot at zero.
    expect(bucketRows.map((row) => row.percent)).toEqual([34, 33, 33, 0]);
    expect(bucketRows.reduce((sum, row) => sum + row.percent, 0)).toBe(100);
    expect(bucketRows.map((row) => row.categoryCount)).toEqual([1, 1, 1, 0]);
  });

  test("what is left to plan counts as savings in the split, and only while there is some", () => {
    localStorage.setItem(
      "incomeSources",
      JSON.stringify([{ id: "s1", name: "Salary", amountCents: 100000, cadence: "monthly" }])
    );
    const { result } = renderPlan();

    act(() => {
      result.current.addBudget({ name: "Rent", planned: "500", bucket: PLAN_BUCKETS.ESSENTIALS });
      result.current.addBudget({ name: "Cinema", planned: "100", bucket: PLAN_BUCKETS.FUN });
      result.current.addBudget({ name: "Holiday", planned: "100", bucket: PLAN_BUCKETS.SAVINGS });
    });

    // $1,000 in against $700 planned leaves $300, and money not given a job is
    // money kept — so savings is $400 of the $1,000, while the verdict and the
    // planned figure above the split are exactly what they were.
    const health = result.current.health;
    expect(health.plannedCents).toBe(70000);
    expect(health.unplannedCents).toBe(30000);
    expect(health.splitCents).toBe(100000);
    const savings = health.bucketRows.find((row) => row.bucket === PLAN_BUCKETS.SAVINGS);
    expect(savings).toMatchObject({ plannedCents: 40000, leftToPlanCents: 30000, categoryCount: 1 });
    expect(health.bucketRows.map((row) => row.percent)).toEqual([50, 10, 40, 0]);

    // Over-allocated: nothing is left over to save, so the split is the plan's.
    act(() => {
      result.current.addBudget({ name: "Car", planned: "500", bucket: PLAN_BUCKETS.ESSENTIALS });
    });
    const over = result.current.health;
    expect(over.unplannedCents).toBe(-20000);
    expect(over.splitCents).toBe(120000);
    expect(over.bucketRows.find((row) => row.bucket === PLAN_BUCKETS.SAVINGS)).toMatchObject({
      plannedCents: 10000,
      leftToPlanCents: 0,
    });
  });

  test("a pretax retirement contribution is grossed onto both income and the retirement bucket", () => {
    const { result } = renderPlan();

    act(() => {
      result.current.addBudget({ name: "Rent", planned: "100", bucket: PLAN_BUCKETS.ESSENTIALS });
      result.current.addBudget({
        name: "Roth IRA",
        planned: "50",
        bucket: PLAN_BUCKETS.RETIREMENT,
      });
    });

    const before = result.current.health;
    expect(before.pretaxMonthlyCents).toBe(0);

    // $1,200 a year of payroll deduction is $100 a month. `setRetirementPlan`
    // takes the figure the way a user types it, like every other amount field.
    act(() => {
      result.current.setRetirementPlan({ pretaxContributionCents: "1200" });
    });

    const after = result.current.health;
    expect(after.pretaxMonthlyCents).toBe(10000);
    // Added to both sides equally, so the gap between them is untouched by a
    // figure that never reaches a real account.
    expect(after.expectedIncomeCents).toBe(before.expectedIncomeCents + 10000);
    expect(after.plannedCents).toBe(before.plannedCents + 10000);
    expect(after.unplannedCents).toBe(before.unplannedCents);

    // The pretax figure has no category of its own, so it lands in the
    // retirement bucket's total without adding to its category count.
    const retirementRow = after.bucketRows.find((row) => row.bucket === PLAN_BUCKETS.RETIREMENT);
    expect(retirementRow.plannedCents).toBe(5000 + 10000);
    expect(retirementRow.categoryCount).toBe(1);
  });

  test("with nothing planned there is no split to state", () => {
    const { result } = renderPlan();

    act(() => {
      result.current.addBudget({ name: "Rent", planned: "" });
    });

    expect(result.current.health.plannedCents).toBe(0);
    expect(result.current.health.bucketRows.every((row) => row.percent === null)).toBe(true);
  });

  test("a bucket the app does not have is refused rather than stored", () => {
    const { result } = renderPlan();

    let outcome;
    act(() => {
      outcome = result.current.addBudget({ name: "Rent", planned: "100", bucket: "luxuries" });
    });

    expect(outcome.ok).toBe(false);
    expect(result.current.budgets).toHaveLength(0);
  });

  test("hand-edited storage lands on real buckets rather than propagating junk", () => {
    localStorage.setItem(
      "budgetGroups",
      JSON.stringify([{ id: "g1", name: "Leisure", bucket: "whatever" }])
    );
    localStorage.setItem(
      "budgets",
      JSON.stringify([{ id: "b1", name: "Cinema", plannedCents: 4000, groupId: "g1", bucket: 7 }])
    );

    const { result } = renderPlan();

    // Both sides must land on something real, and on the same something: the
    // group's junk bucket reads as the app default, so its categories do too.
    expect(result.current.groups[0].bucket).toBe(DEFAULT_BUCKET);
    expect(result.current.budgets[0].bucket).toBe(DEFAULT_BUCKET);
  });

  test("a category stored as deferring is stamped with what it was already counting as", () => {
    // The shape before buckets became a field on every category: null meant
    // "ask my group". Migrating it to the group's bucket is the one answer that
    // leaves every figure on screen where it was.
    localStorage.setItem(
      "budgetGroups",
      JSON.stringify([{ id: "g1", name: "Leisure", bucket: PLAN_BUCKETS.FUN }])
    );
    localStorage.setItem(
      "budgets",
      JSON.stringify([
        { id: "b1", name: "Cinema", plannedCents: 4000, groupId: "g1", bucket: null },
        { id: "b2", name: "Rent", plannedCents: 120000, groupId: null },
      ])
    );

    const { result } = renderPlan();

    expect(result.current.budgets.map((budget) => budget.bucket)).toEqual([
      PLAN_BUCKETS.FUN,
      DEFAULT_BUCKET,
    ]);
  });
});

describe("deleting a budget", () => {
  beforeEach(seedAccounts);

  const useBooks = () => ({ budgets: useBudgets(), ledger: useTransactions() });

  test("reassigns its spend and takes its estimate with it", () => {
    const { result } = renderHook(useBooks, { wrapper });

    let id;
    act(() => {
      id = result.current.budgets.addBudget({ name: "Groceries", planned: "400" }).id;
    });
    act(() => {
      result.current.ledger.addTransaction(
        spend({ description: "Coffee", amount: "4.50", budgetId: id })
      );
    });

    expect(result.current.budgets.totalPlannedCents).toBe(40000);

    act(() => {
      result.current.budgets.deleteBudget({ id });
    });

    // The estimate goes with the record — there is nothing left for it to
    // describe.
    expect(result.current.budgets.budgets).toHaveLength(0);
    expect(result.current.budgets.totalPlannedCents).toBe(0);
    // the spend survives — it is what actually happened
    expect(result.current.ledger.transactions).toHaveLength(1);
    expect(result.current.ledger.transactions[0].budgetId).toBe(UNCATEGORIZED_BUDGET_ID);
  });

  test("its funding follows its spend onto Uncategorized", () => {
    const { result } = renderHook(
      () => ({
        budgets: useBudgets(),
        ledger: useTransactions(),
        assignments: useAssignments(),
        env: useEnvelopes(currentPeriod()),
      }),
      { wrapper }
    );

    let id;
    act(() => {
      id = result.current.budgets.addBudget({ name: "Groceries" }).id;
    });
    act(() => {
      result.current.assignments.setAssignedAmount({
        budgetId: id,
        period: currentPeriod(),
        amountCents: 50000,
      });
      result.current.ledger.addTransaction(
        spend({ description: "Shop", amount: "200", budgetId: id })
      );
    });

    const before = result.current.env.toBeAssignedCents;
    expect(envelopeFor(result.current.env, id).availableCents).toBe(30000);

    act(() => {
      result.current.budgets.deleteBudget({ id });
    });

    // The balance moves rather than evaporating: dropping the assignment would
    // hand the money back to the pool while the spend landed on Uncategorized,
    // asking the user to fund the same purchase twice.
    expect(envelopeFor(result.current.env, UNCATEGORIZED_BUDGET_ID).availableCents).toBe(30000);
    expect(result.current.env.toBeAssignedCents).toBe(before);
  });
});

describe("accounts hold the money the ledger moves", () => {
  const useBooks = () => ({
    accounts: useAccounts(),
    ledger: useTransactions(),
    balances: useAccountBalances(currentPeriod()),
    env: useEnvelopes(currentPeriod()),
  });

  test("an on-budget opening balance is money that can be assigned", () => {
    const { result } = renderHook(useBooks, { wrapper });

    act(() => {
      result.current.accounts.addAccount({ name: "Everyday", opening: "1000" });
    });

    // Without this a household could not spend a cent until a paycheque landed,
    // however much was already in the bank.
    expect(result.current.env.openingCents).toBe(100000);
    expect(result.current.env.toBeAssignedCents).toBe(100000);
  });

  test("an off-budget holding is net worth, not money to assign", () => {
    const { result } = renderHook(useBooks, { wrapper });

    act(() => {
      result.current.accounts.addAccount({
        name: "401(k)",
        scope: "off-budget",
        assetClass: "Stocks",
        opening: "50000",
      });
    });

    // A retirement account is not grocery money.
    expect(result.current.env.toBeAssignedCents).toBe(0);
    expect(result.current.balances.offBudgetCents).toBe(5000000);
  });

  test("a dated off-budget opening balance also lands in accountBalances, as a real snapshot", () => {
    const { result } = renderHook(useBooks, { wrapper });

    let id;
    act(() => {
      id = result.current.accounts.addAccount({
        name: "401(k)",
        scope: "off-budget",
        assetClass: "Stocks",
        opening: "50000",
        openingDate: "2026-01-15",
      }).id;
    });

    // Stating the opening balance writes the same kind of record "Update
    // balances" would, so it shows up on the balance-history grid and takes
    // its place among any other snapshots by date, rather than being a fact
    // only the opening-balance fallback can see.
    const written = result.current.accounts.getAccountBalances(id);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ accountId: id, period: "2026-01", amountCents: 5000000 });
  });

  test("an undated off-budget opening writes no snapshot — there is no month to anchor it to", () => {
    const { result } = renderHook(useBooks, { wrapper });

    let id;
    act(() => {
      id = result.current.accounts.addAccount({
        name: "401(k)",
        scope: "off-budget",
        assetClass: "Stocks",
        opening: "50000",
      }).id;
    });

    expect(result.current.accounts.getAccountBalances(id)).toHaveLength(0);
  });

  test("an on-budget opening balance writes no snapshot — its balance is the ledger's, never hand-entered", () => {
    const { result } = renderHook(useBooks, { wrapper });

    let id;
    act(() => {
      id = result.current.accounts.addAccount({
        name: "Everyday",
        opening: "1000",
        openingDate: "2026-01-15",
      }).id;
    });

    expect(result.current.accounts.getAccountBalances(id)).toHaveLength(0);
  });

  test("restating an off-budget account's opening balance, dated later, replaces what an old snapshot said", () => {
    const { result } = renderHook(useBooks, { wrapper });

    let id;
    act(() => {
      id = result.current.accounts.addAccount({
        name: "401(k)",
        scope: "off-budget",
        assetClass: "Stocks",
        opening: "9000",
        openingDate: "2026-01-15",
      }).id;
    });

    // Restated in August at the real current figure — exactly what editing
    // the account's starting balance on Configuration does.
    act(() => {
      result.current.accounts.updateAccount({
        id,
        opening: "14000",
        openingDate: "2026-08-01",
      });
    });

    // The January figure stays on file as its own real snapshot — restating
    // later adds a new fact rather than rewriting history — but August now
    // has its own, more recent one.
    const written = result.current.accounts.getAccountBalances(id);
    expect(written).toHaveLength(2);
    expect(written).toContainEqual(
      expect.objectContaining({ accountId: id, period: "2026-01", amountCents: 900000 })
    );
    expect(written).toContainEqual(
      expect.objectContaining({ accountId: id, period: "2026-08", amountCents: 1400000 })
    );
  });

  test("restating an account added before real snapshots existed still preserves its old date", () => {
    // A record with no `accountBalances` entry behind it at all — exactly what
    // an account created before this write-through existed looks like on disk.
    seedAccounts([
      ACCOUNT,
      {
        id: "acc-401k",
        name: "401(k)",
        type: "asset",
        scope: "off-budget",
        assetClass: "Stocks",
        openingBalanceCents: 900000,
        openingDate: "2026-01-15",
      },
    ]);
    const { result } = renderHook(useBooks, { wrapper });
    expect(result.current.accounts.getAccountBalances("acc-401k")).toHaveLength(0);

    // Restated in August, as editing the account's starting balance on
    // Configuration does. Without backing January's old fact up first, moving
    // the account's own opening date to August would leave January (and every
    // month before August) with nothing behind it at all.
    act(() => {
      result.current.accounts.updateAccount({
        id: "acc-401k",
        opening: "14000",
        openingDate: "2026-08-01",
      });
    });

    const written = result.current.accounts.getAccountBalances("acc-401k");
    expect(written).toHaveLength(2);
    expect(written).toContainEqual(
      expect.objectContaining({ accountId: "acc-401k", period: "2026-01", amountCents: 900000 })
    );
    expect(written).toContainEqual(
      expect.objectContaining({ accountId: "acc-401k", period: "2026-08", amountCents: 1400000 })
    );
  });

  test("a debt is entered as what is owed and counts against the pool", () => {
    const { result } = renderHook(useBooks, { wrapper });

    act(() => {
      result.current.accounts.addAccount({ name: "Visa", type: "liability", opening: "450" });
    });

    expect(result.current.accounts.accounts[0].openingBalanceCents).toBe(-45000);
    expect(result.current.env.toBeAssignedCents).toBe(-45000);
    expect(result.current.balances.owedCents).toBe(45000);
  });

  test("a credit card is spent through like any on-budget account", () => {
    const { result } = renderHook(useBooks, { wrapper });

    let cardId;
    act(() => {
      cardId = result.current.accounts.addAccount({
        name: "Visa",
        type: "liability",
        scope: "credit-card",
        opening: "450",
      }).id;
    });
    act(() => {
      result.current.ledger.addTransaction({
        kind: TRANSACTION_KINDS.OUTFLOW,
        description: "Shop",
        amount: "50",
        budgetId: "b1",
        accountId: cardId,
      });
    });

    // A scope of its own on the page, and the same money everywhere else: what
    // is owed on the card reduces what there is to assign, and spending on it
    // moves the balance exactly as spending from a bank account does.
    expect(result.current.env.toBeAssignedCents).toBe(-45000);
    expect(result.current.balances.onBudgetCents).toBe(-50000);
    expect(result.current.balances.owedCents).toBe(50000);
    expect(result.current.env.rows.find((row) => row.budgetId === "b1").activityCents).toBe(-5000);
  });

  test("a credit card filed as an asset is refused rather than stored", () => {
    const { result } = renderHook(useBooks, { wrapper });

    let outcome;
    act(() => {
      outcome = result.current.accounts.addAccount({
        name: "Visa",
        type: "asset",
        scope: "credit-card",
        opening: "450",
      });
    });

    // The one combination that would add a debt to net worth instead of
    // subtracting it.
    expect(outcome.ok).toBe(false);
    expect(result.current.accounts.accounts).toHaveLength(0);
  });

  test("spending moves the account balance, not just the envelope", () => {
    const { result } = renderHook(useBooks, { wrapper });

    let accountId;
    act(() => {
      accountId = result.current.accounts.addAccount({ name: "Everyday", opening: "1000" }).id;
    });
    act(() => {
      result.current.ledger.addTransaction({
        kind: TRANSACTION_KINDS.OUTFLOW,
        description: "Shop",
        amount: "200",
        budgetId: "b1",
        accountId,
      });
      result.current.ledger.addTransaction({
        kind: TRANSACTION_KINDS.INFLOW,
        description: "Pay",
        amount: "50",
        accountId,
      });
    });

    const [row] = result.current.balances.rows;
    expect(row.balanceCents).toBe(100000 - 20000 + 5000);
  });

  test("an opening balance dated ahead is not spendable yet", () => {
    const { result } = renderHook(
      () => ({ accounts: useAccounts(), past: useEnvelopes("2020-01"), now: useEnvelopes("2999-01") }),
      { wrapper }
    );

    act(() => {
      result.current.accounts.addAccount({
        name: "Everyday",
        opening: "1000",
        openingDate: "2030-06-01",
      });
    });

    expect(result.current.past.toBeAssignedCents).toBe(0);
    expect(result.current.now.toBeAssignedCents).toBe(100000);
  });

  test("deleting an account keeps the ledger and cuts it loose", () => {
    const { result } = renderHook(useBooks, { wrapper });

    let accountId;
    act(() => {
      accountId = result.current.accounts.addAccount({ name: "Everyday", opening: "1000" }).id;
    });
    act(() => {
      result.current.ledger.addTransaction({
        kind: TRANSACTION_KINDS.OUTFLOW,
        description: "Shop",
        amount: "200",
        budgetId: "b1",
        accountId,
      });
    });
    act(() => {
      result.current.accounts.deleteAccount({ id: accountId });
    });

    // Deleting the spend as well would rewrite every envelope balance because
    // the user tidied up their account list.
    expect(result.current.ledger.transactions).toHaveLength(1);
    expect(result.current.ledger.transactions[0].accountId).toBeNull();
    expect(result.current.balances.rows).toHaveLength(0);
  });

  test("a window of months is backfilled in one commit, or not at all", () => {
    const { result } = renderHook(useBooks, { wrapper });

    let accountId;
    act(() => {
      accountId = result.current.accounts.addAccount({
        name: "401(k)",
        scope: "off-budget",
        assetClass: "Stocks",
        opening: "10000",
      }).id;
    });

    // The third month is junk. Nothing before it may be written: a year of
    // history half committed is worse than none, because nothing on screen says
    // which half took.
    let outcome;
    act(() => {
      outcome = result.current.accounts.setBalanceHistory({
        months: [
          { period: "2025-01", entries: [{ accountId, amount: "11000", label: "401(k)" }] },
          { period: "2025-02", entries: [{ accountId, amount: "12000", label: "401(k)" }] },
          { period: "2025-03", entries: [{ accountId, amount: "lots", label: "401(k)" }] },
        ],
      });
    });

    expect(outcome.ok).toBe(false);
    // Named by month as well as by account: the field to go back to is a cell.
    expect(outcome.error).toBe("March 2025: Enter a valid balance for 401(k).");
    expect(result.current.accounts.balances).toHaveLength(0);

    act(() => {
      outcome = result.current.accounts.setBalanceHistory({
        months: [
          { period: "2025-01", entries: [{ accountId, amount: "11000", label: "401(k)" }] },
          // Blank clears rather than storing zero, as it does for a single month
          // — which is how a figure entered by mistake is taken back out.
          { period: "2025-02", entries: [{ accountId, amount: "", label: "401(k)" }] },
          { period: "2025-03", entries: [{ accountId, amountCents: 1300000, label: "401(k)" }] },
        ],
      });
    });

    expect(outcome.ok).toBe(true);
    expect(result.current.accounts.balances).toEqual([
      { id: expect.any(String), accountId, period: "2025-01", amountCents: 1100000 },
      { id: expect.any(String), accountId, period: "2025-03", amountCents: 1300000 },
    ]);
  });
});

describe("period arithmetic", () => {
  test("stepping a month crosses the year boundary in both directions", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-08", 0)).toBe("2026-08");
    expect(addMonths("2026-01", 25)).toBe("2028-02");
  });

  test("a malformed date has no period rather than an arbitrary one", () => {
    // "2026-1-5" used to slice to "2026-1-", which sorts after "2026-08" but
    // before "2026-11" — so the record vanished, then reappeared months later.
    expect(toPeriod("2026-1-5")).toBeNull();
    expect(toPeriod("not a date")).toBeNull();
    expect(toPeriod("2026-08")).toBe("2026-08");
    expect(toPeriod("2026-08-10")).toBe("2026-08");
  });

  test("comparing periods does not fall for the null coercion", () => {
    // `null <= null` is true in JavaScript: both sides coerce to 0. Undated
    // records are counted deliberately elsewhere, never by accident here.
    expect(periodLTE(null, null)).toBe(false);
    expect(periodLTE(null, "2026-08")).toBe(false);
    expect(periodLTE("2026-08", null)).toBe(false);
    expect(periodLTE("2026-07", "2026-08")).toBe(true);
    expect(periodLTE("2026-08", "2026-08")).toBe(true);
    expect(periodLTE("2026-09", "2026-08")).toBe(false);
  });
});

describe("assignments", () => {
  test("one row per category per period, upserted", () => {
    const { result } = renderHook(() => useAssignments(), { wrapper });

    act(() => {
      result.current.setAssignedAmount({ budgetId: "b1", period: "2026-01", amountCents: 40000 });
    });
    act(() => {
      result.current.setAssignedAmount({ budgetId: "b1", period: "2026-01", amountCents: 55000 });
    });
    act(() => {
      result.current.setAssignedAmount({ budgetId: "b1", period: "2026-02", amountCents: 10000 });
    });

    expect(result.current.assignments).toHaveLength(2);
    expect(result.current.getAssignedCents("b1", "2026-01")).toBe(55000);
    expect(result.current.getAssignedCents("b1", "2026-02")).toBe(10000);
  });

  test("a negative assignment is allowed — it is how money comes back out", () => {
    const { result } = renderHook(() => useAssignments(), { wrapper });

    let outcome;
    act(() => {
      outcome = result.current.setAssignedAmount({
        budgetId: "b1",
        period: "2026-02",
        amountCents: -5000,
      });
    });

    expect(outcome.ok).toBe(true);
    expect(result.current.getAssignedCents("b1", "2026-02")).toBe(-5000);
  });

  test("zero is pruned rather than stored", () => {
    const { result } = renderHook(() => useAssignments(), { wrapper });

    act(() => {
      result.current.setAssignedAmount({ budgetId: "b1", period: "2026-01", amountCents: 40000 });
    });
    act(() => {
      result.current.setAssignedAmount({ budgetId: "b1", period: "2026-01", amountCents: 0 });
    });

    expect(result.current.assignments).toHaveLength(0);
    expect(stored("assignments")).toEqual([]);
  });

  test("an unparseable amount is rejected, not stored as null", () => {
    const { result } = renderHook(() => useAssignments(), { wrapper });

    let outcome;
    act(() => {
      outcome = result.current.setAssignedAmount({
        budgetId: "b1",
        period: "2026-01",
        amount: "abc",
      });
    });

    expect(outcome.ok).toBe(false);
    expect(result.current.assignments).toHaveLength(0);
  });

  test("a batch is all or nothing", () => {
    const { result } = renderHook(() => useAssignments(), { wrapper });

    let outcome;
    act(() => {
      outcome = result.current.setPeriodAssignments({
        period: "2026-01",
        entries: [
          { budgetId: "b1", amountCents: 10000 },
          { budgetId: "b2", amount: "nonsense" },
          { budgetId: "b3", amountCents: 30000 },
        ],
      });
    });

    // A form that funds eight categories and fails on the third must not leave
    // two of them committed — the user has no way to tell which.
    expect(outcome.ok).toBe(false);
    expect(result.current.assignments).toHaveLength(0);
  });

  test("a valid batch lands in one commit", () => {
    const { result } = renderHook(() => useAssignments(), { wrapper });

    act(() => {
      result.current.setPeriodAssignments({
        period: "2026-01",
        entries: [
          { budgetId: "b1", amountCents: 10000 },
          { budgetId: "b2", amountCents: 20000 },
        ],
      });
    });

    expect(result.current.assignments).toHaveLength(2);
    expect(stored("assignments")).toHaveLength(2);
  });
});

describe("moving money between two categories", () => {
  function funded() {
    const { result } = renderHook(() => useAssignments(), { wrapper });
    act(() => {
      result.current.setPeriodAssignments({
        period: "2026-01",
        entries: [
          { budgetId: "b1", amountCents: 20000 },
          { budgetId: "b2", amountCents: 5000 },
        ],
      });
    });
    return result;
  }

  test("one side loses exactly what the other gains", () => {
    const result = funded();

    let outcome;
    act(() => {
      outcome = result.current.moveBetweenBudgets({
        fromBudgetId: "b1",
        toBudgetId: "b2",
        period: "2026-01",
        amountCents: 7500,
      });
    });

    expect(outcome.ok).toBe(true);
    expect(result.current.getAssignedCents("b1", "2026-01")).toBe(12500);
    expect(result.current.getAssignedCents("b2", "2026-01")).toBe(12500);
  });

  test("it is one write, so no intermediate state is ever stored", () => {
    const result = funded();

    act(() => {
      result.current.moveBetweenBudgets({
        fromBudgetId: "b1",
        toBudgetId: "b2",
        period: "2026-01",
        amountCents: 7500,
      });
    });

    // The whole reason this is a mutator rather than two calls to
    // setAssignedAmount: the sum across the two rows is unchanged at every
    // point a reader of storage could look, so the pool is never briefly
    // inflated by money that was never free.
    const total = stored("assignments").reduce((sum, row) => sum + row.assignedCents, 0);
    expect(total).toBe(25000);
  });

  test("a destination with no row yet gets one", () => {
    const result = funded();

    act(() => {
      result.current.moveBetweenBudgets({
        fromBudgetId: "b1",
        toBudgetId: "b3",
        period: "2026-01",
        amountCents: 5000,
      });
    });

    expect(result.current.getAssignedCents("b3", "2026-01")).toBe(5000);
    expect(result.current.getAssignedCents("b1", "2026-01")).toBe(15000);
  });

  test("a source emptied back to zero is pruned, not stored as a zero row", () => {
    const result = funded();

    act(() => {
      result.current.moveBetweenBudgets({
        fromBudgetId: "b1",
        toBudgetId: "b2",
        period: "2026-01",
        amountCents: 20000,
      });
    });

    expect(stored("assignments")).toHaveLength(1);
    expect(result.current.getAssignedCents("b1", "2026-01")).toBe(0);
  });

  test("moving more than the source was assigned is allowed", () => {
    const result = funded();

    let outcome;
    act(() => {
      outcome = result.current.moveBetweenBudgets({
        fromBudgetId: "b2",
        toBudgetId: "b1",
        period: "2026-01",
        amountCents: 9000,
      });
    });

    // Covering one category out of another that has not been funded yet is a
    // real thing to want before a paycheque lands, and the app says so the one
    // way it ever does — the figure goes red. Refusing it here would leave the
    // user with a shortfall they can see and cannot settle.
    expect(outcome.ok).toBe(true);
    expect(result.current.getAssignedCents("b2", "2026-01")).toBe(-4000);
  });

  test("the pool can be either side, and only the category side is written", () => {
    const result = funded();

    act(() => {
      result.current.moveBetweenBudgets({
        fromBudgetId: TO_BE_ASSIGNED,
        toBudgetId: "b2",
        period: "2026-01",
        amountCents: 3000,
      });
    });
    // From the pool is assigning more: b2 gains, b1 is untouched, and no row
    // is ever written for the pool itself.
    expect(result.current.getAssignedCents("b2", "2026-01")).toBe(8000);
    expect(result.current.getAssignedCents("b1", "2026-01")).toBe(20000);

    act(() => {
      result.current.moveBetweenBudgets({
        fromBudgetId: "b1",
        toBudgetId: TO_BE_ASSIGNED,
        period: "2026-01",
        amountCents: 20000,
      });
    });
    // Back to the pool is assigning less — all the way to zero, which prunes.
    expect(result.current.getAssignedCents("b1", "2026-01")).toBe(0);
    expect(result.current.assignments.map((entry) => entry.budgetId)).toEqual(["b2"]);

    let outcome;
    act(() => {
      outcome = result.current.moveBetweenBudgets({
        fromBudgetId: TO_BE_ASSIGNED,
        toBudgetId: TO_BE_ASSIGNED,
        period: "2026-01",
        amountCents: 1000,
      });
    });
    expect(outcome.ok).toBe(false);
  });

  test("zero, a negative, a missing side and a self-move are all refused", () => {
    const result = funded();
    const move = (patch) => {
      let outcome;
      act(() => {
        outcome = result.current.moveBetweenBudgets({
          fromBudgetId: "b1",
          toBudgetId: "b2",
          period: "2026-01",
          amountCents: 1000,
          ...patch,
        });
      });
      return outcome;
    };

    // A move is a positive amount in a stated direction; an amount is not the
    // place to contradict the two selects.
    expect(move({ amountCents: 0 }).ok).toBe(false);
    expect(move({ amountCents: -1000 }).ok).toBe(false);
    // `amountCents` is what the mutator prefers, so a junk string only reaches
    // `toCents` once the cents figure is out of the way.
    expect(move({ amountCents: undefined, amount: "twelve apples" }).ok).toBe(false);
    expect(move({ toBudgetId: null }).ok).toBe(false);
    expect(move({ toBudgetId: "b1" }).ok).toBe(false);
    expect(move({ period: "nonsense" }).ok).toBe(false);

    // Nothing landed through any of them.
    expect(result.current.getAssignedCents("b1", "2026-01")).toBe(20000);
    expect(result.current.getAssignedCents("b2", "2026-01")).toBe(5000);
  });
});

describe("the day-one seed", () => {
  const LEGACY = [
    { id: "e1", description: "Shop", amount: 20, budgetId: "b1", date: "2026-01-04" },
    { id: "e2", description: "Fuel", amount: 30, budgetId: "b2", date: null },
  ];

  test("every envelope opens at zero rather than at its lifetime spend", () => {
    localStorage.setItem("expenses", JSON.stringify(LEGACY));
    localStorage.setItem(
      "budgets",
      JSON.stringify([
        { id: "b1", name: "Groceries" },
        { id: "b2", name: "Fuel" },
      ])
    );
    localStorage.setItem(
      "income",
      JSON.stringify([{ id: "i1", description: "Pay", amount: 100, date: "2026-01-02" }])
    );

    const { result } = renderHook(() => useEnvelopes(currentPeriod()), { wrapper });

    // Seeding what was already spent invents no history: money the user spent
    // was money the user had.
    for (const row of result.current.rows) {
      expect(row.availableCents).toBe(0);
    }
    // What is left over is cash on hand, waiting to be given a job.
    expect(result.current.toBeAssignedCents).toBe(10000 - 5000);
  });

  test("a second mount does not seed again", () => {
    localStorage.setItem("expenses", JSON.stringify(LEGACY));

    renderHook(() => useAssignments(), { wrapper }).unmount();
    const { result } = renderHook(() => useAssignments(), { wrapper });

    expect(result.current.assignments).toHaveLength(2);
  });

  test("it reads the merged ledger, not only the key it was written against", () => {
    // The seed runs in a lazy default, before any provider has persisted
    // anything, so it reads storage directly — and storage may hold either
    // schema.
    localStorage.setItem(
      "transactions",
      JSON.stringify([
        spend({ id: "t1", description: "Shop", amountCents: 2000, budgetId: "b1", date: "2026-01-04" }),
        earn({ id: "t2", description: "Pay", amountCents: 9900, date: "2026-01-02" }),
      ])
    );

    const { result } = renderHook(() => useAssignments(), { wrapper });

    // One row, for the spend. Income funds nothing on its own.
    expect(result.current.assignments).toHaveLength(1);
    expect(result.current.assignments[0]).toMatchObject({ budgetId: "b1", assignedCents: 2000 });
  });

  test("nothing is seeded for a ledger that has never logged an expense", () => {
    const { result } = renderHook(() => useAssignments(), { wrapper });
    expect(result.current.assignments).toHaveLength(0);
  });
});

/**
 * The tripwire.
 *
 *   toBeAssigned + Σ available === opening + cumulative income − cumulative spend
 *
 * Money is either sitting in an envelope or waiting to be put in one; it is
 * never in both places and never in neither. The assignment terms cancel, so
 * this does not check the arithmetic — what it catches is a row set that stops
 * covering every budgetId, or a cascade that drops one side of a delete. Those
 * are the failures nothing else in the suite would notice.
 *
 * `opening` joins income on the right: an on-budget account's starting balance
 * is money the household already had, and it has to land somewhere on the left
 * too or the books stop balancing the moment an account is added.
 */
function expectBalanced(env) {
  const available = env.rows.reduce((sum, row) => sum + row.availableCents, 0);
  // A goal's cumulative assignment came out of the same pool a budget's did,
  // so it has to land back on this side of the identity the same way — see
  // the comment on goalRows in useEnvelopes.
  const goalAvailable = env.goalRows.reduce((sum, row) => sum + row.availableCents, 0);
  // Money held back for the emergency fund is still there, just not free.
  expect(env.toBeAssignedCents + env.emergencyReservedCents + available + goalAvailable).toBe(
    env.openingCents + env.cumIncomeCents - env.cumSpentCents
  );
}

function envelopeFor(env, budgetId) {
  return env.rows.find((row) => row.budgetId === budgetId);
}

function goalEnvelopeFor(env, goalId) {
  return env.goalRows.find((row) => row.goalId === goalId);
}

describe("the books balance after every mutation", () => {
  const useLedger = () => ({
    accounts: useAccounts(),
    budgets: useBudgets(),
    ledger: useTransactions(),
    assignments: useAssignments(),
    goals: useSavingsGoals(),
    goalAssignments: useSavingsGoalAssignments(),
    past: useEnvelopes("2026-01"),
    now: useEnvelopes("2026-08"),
    later: useEnvelopes("2030-12"),
  });

  function expectAllBalanced(current) {
    expectBalanced(current.past);
    expectBalanced(current.now);
    expectBalanced(current.later);
  }

  test("through creation, funding, spending and every kind of delete", () => {
    // Undated records, from before dates existed, on both sides of the books.
    localStorage.setItem(
      "income",
      JSON.stringify([{ id: "i0", description: "Old", amount: 100 }])
    );
    localStorage.setItem(
      "expenses",
      JSON.stringify([{ id: "e0", description: "Old", amount: 20, budgetId: "b1" }])
    );
    localStorage.setItem("budgets", JSON.stringify([{ id: "b1", name: "Groceries" }]));
    seedAccounts();

    const { result } = renderHook(useLedger, { wrapper });
    expectAllBalanced(result.current);

    let fuelId;
    act(() => {
      fuelId = result.current.budgets.addBudget({ name: "Fuel" }).id;
    });
    expectAllBalanced(result.current);

    // A second account, opened mid-ledger with money already in it. The
    // opening balance has to reach the pool and the identity at once.
    let savingsId;
    act(() => {
      savingsId = result.current.accounts.addAccount({
        name: "Savings",
        opening: "1500",
        openingDate: "2026-05-01",
      }).id;
    });
    expectAllBalanced(result.current);
    expect(result.current.past.openingCents).toBe(0);
    expect(result.current.now.openingCents).toBe(150000);

    act(() => {
      result.current.ledger.addTransaction(
        earn({ description: "June", amount: "500", date: "2026-06-15" })
      );
      result.current.ledger.addTransaction(
        earn({ description: "Aug", amount: "700", date: "2026-08-05" })
      );
      // Dated ahead: real, but not spendable until its month comes round.
      result.current.ledger.addTransaction(
        earn({ description: "Sep", amount: "900", date: "2026-09-20" })
      );
    });
    expectAllBalanced(result.current);

    // A future-dated paycheck stays out of the pool until its month arrives.
    expect(result.current.now.toBeAssignedCents).toBeLessThan(
      result.current.later.toBeAssignedCents
    );

    act(() => {
      result.current.assignments.setPeriodAssignments({
        period: "2026-08",
        entries: [
          { budgetId: "b1", amountCents: 40000 },
          { budgetId: fuelId, amountCents: 20000 },
        ],
      });
    });
    expectAllBalanced(result.current);

    act(() => {
      result.current.ledger.addTransaction(
        spend({ description: "Shop", amount: "150", budgetId: "b1", date: "2026-08-09" })
      );
      result.current.ledger.addTransaction(
        spend({ description: "Older shop", amount: "60", budgetId: "b1", date: "2026-06-02" })
      );
      // An id with money against it and no category record. It still holds real
      // money, so every total has to keep covering it.
      result.current.ledger.addTransaction(
        spend({
          description: "Ghost",
          amount: "99",
          budgetId: "never-a-budget",
          date: "2026-08-01",
        })
      );
    });
    expectAllBalanced(result.current);
    expect(envelopeFor(result.current.now, "never-a-budget").kind).toBe("orphan");

    // A refund: an inflow naming a category, which goes back to that envelope
    // instead of to the pool. It is the one movement counted on both sides of
    // the identity by two different routes, so it is the one most able to break
    // it — as cash it is an inflow, as budget it is negative spend.
    const poolBefore = result.current.now.toBeAssignedCents;
    act(() => {
      result.current.ledger.addTransaction(
        earn({ description: "Refund", amount: "50", budgetId: "b1", date: "2026-08-11" })
      );
    });
    expectAllBalanced(result.current);
    expect(result.current.now.toBeAssignedCents).toBe(poolBefore);
    expect(envelopeFor(result.current.now, "b1").refundCents).toBe(5000);
    expect(envelopeFor(result.current.now, "b1").activityCents).toBe(-10000);

    // Correcting a record moves money between the two sides of the identity
    // without any of it being created or destroyed. Flipping the orphan's
    // direction takes it out of gross spend and into cumulative inflow at once;
    // re-dating a shop moves it between the periods each side is summed over.
    act(() => {
      const ghost = result.current.ledger.outflows.find((t) => t.budgetId === "never-a-budget");
      result.current.ledger.updateTransaction({ id: ghost.id, kind: TRANSACTION_KINDS.INFLOW });
    });
    expectAllBalanced(result.current);

    act(() => {
      const shop = result.current.ledger.outflows.find((t) => t.description === "Shop");
      result.current.ledger.updateTransaction({ id: shop.id, date: "2026-01-09" });
    });
    expectAllBalanced(result.current);
    // Moved into January, so it now sits behind August rather than inside it.
    expect(envelopeFor(result.current.past, "b1").spentCents).toBe(15000);

    // And moving one *between* categories has to leave both rows covered.
    act(() => {
      const shop = result.current.ledger.outflows.find((t) => t.description === "Shop");
      result.current.ledger.updateTransaction({ id: shop.id, budgetId: fuelId });
    });
    expectAllBalanced(result.current);

    act(() => {
      result.current.budgets.deleteBudget({ id: fuelId });
    });
    expectAllBalanced(result.current);

    act(() => {
      const [first] = result.current.ledger.inflows;
      result.current.ledger.deleteTransaction({ id: first.id });
    });
    expectAllBalanced(result.current);

    act(() => {
      const past = result.current.ledger.outflows.find((t) => t.date === "2026-06-02");
      result.current.ledger.deleteTransaction({ id: past.id });
    });
    expectAllBalanced(result.current);

    // Deleting the account the money sat in must not disturb the envelopes —
    // only the opening balance leaves with it, on both sides of the identity.
    act(() => {
      result.current.accounts.deleteAccount({ id: savingsId });
    });
    expectAllBalanced(result.current);
    expect(result.current.now.openingCents).toBe(0);

    act(() => {
      result.current.assignments.setAssignedAmount({
        budgetId: "b1",
        period: "2026-09",
        amountCents: -15000,
      });
    });
    expectAllBalanced(result.current);
  });

  test("undated money is counted once, in every period", () => {
    localStorage.setItem(
      "expenses",
      JSON.stringify([{ id: "e0", description: "Old", amount: 20, budgetId: "b1" }])
    );
    localStorage.setItem("budgets", JSON.stringify([{ id: "b1", name: "Groceries" }]));

    const { result } = renderHook(useLedger, { wrapper });

    // Undated spend sits behind every period rather than inside one, so the
    // balance moves between months only by that month's dated activity.
    expect(result.current.past.cumSpentCents).toBe(2000);
    expect(result.current.later.cumSpentCents).toBe(2000);
    expect(envelopeFor(result.current.past, "b1").spentCents).toBe(0);
    expect(envelopeFor(result.current.past, "b1").carriedInCents).toBe(-2000);
    expectAllBalanced(result.current);
  });

  test("a savings goal draws from the same pool a category does", () => {
    seedAccounts();
    const { result } = renderHook(useLedger, { wrapper });

    act(() => {
      result.current.ledger.addTransaction(
        earn({ description: "Aug", amount: "1000", date: "2026-08-05" })
      );
    });
    expectAllBalanced(result.current);

    let goalId;
    act(() => {
      goalId = result.current.goals.addSavingsGoal({ name: "Camera", target: "500" }).id;
    });
    expectAllBalanced(result.current);

    const poolBefore = result.current.now.toBeAssignedCents;
    act(() => {
      result.current.goalAssignments.setAssignedAmount({
        goalId,
        period: "2026-08",
        amountCents: 20000,
      });
    });
    expectAllBalanced(result.current);
    // The pool moved by exactly what the goal took, the same as funding a
    // category would — it is the same dollar, spoken for either way.
    expect(result.current.now.toBeAssignedCents).toBe(poolBefore - 20000);
    expect(goalEnvelopeFor(result.current.now, goalId).availableCents).toBe(20000);

    // Carries forward into a later period, on the same rule an envelope's
    // balance does — and has not accrued yet in one further back.
    expect(goalEnvelopeFor(result.current.later, goalId).availableCents).toBe(20000);
    expect(goalEnvelopeFor(result.current.past, goalId)).toBeUndefined();

    // Pulling money back out is allowed, the same as it is for a category
    // that was over-funded under rollover.
    act(() => {
      result.current.goalAssignments.setAssignedAmount({
        goalId,
        period: "2026-09",
        amountCents: -5000,
      });
    });
    expectAllBalanced(result.current);
    expect(goalEnvelopeFor(result.current.later, goalId).availableCents).toBe(15000);
  });

  test("updating a goal that is not on file is refused, not silently dropped", () => {
    const { result } = renderHook(useLedger, { wrapper });

    let goalId;
    act(() => {
      goalId = result.current.goals.addSavingsGoal({ name: "Camera", target: "500" }).id;
    });

    // A goal deleted in another tab syncs in through the `storage` event, so
    // the edit modal can be sitting on a record the store no longer has. The
    // write matches nothing, and reporting that as success would close the
    // modal as though it had landed.
    act(() => {
      result.current.goals.deleteSavingsGoal({ id: goalId });
    });

    let gone;
    act(() => {
      gone = result.current.goals.updateSavingsGoal({
        id: goalId,
        name: "Camera",
        target: "600",
      });
    });
    expect(gone.ok).toBe(false);
    expect(gone.error).toMatch(/no longer exists/);
    expect(result.current.goals.goals).toHaveLength(0);

    // An id that was never on file is refused the same way.
    let never;
    act(() => {
      never = result.current.goals.updateSavingsGoal({ id: "nope", name: "Ring", target: "900" });
    });
    expect(never.ok).toBe(false);
    expect(result.current.goals.goals).toHaveLength(0);
  });

  test("setAssignedAmount on a goal validates like a category's does", () => {
    const { result } = renderHook(useLedger, { wrapper });

    let bad;
    act(() => {
      bad = result.current.goalAssignments.setAssignedAmount({
        goalId: "g1",
        period: "2026-08",
        amount: "not a number",
      });
    });
    expect(bad.ok).toBe(false);

    act(() => {
      bad = result.current.goalAssignments.setAssignedAmount({
        goalId: "g1",
        period: "not a period",
        amountCents: 100,
      });
    });
    expect(bad.ok).toBe(false);
  });

  test("moving money between categories leaves the pool exactly where it was", () => {
    localStorage.setItem(
      "budgets",
      JSON.stringify([
        { id: "b1", name: "Groceries" },
        { id: "b2", name: "Dining out" },
      ])
    );
    seedAccounts();

    const { result } = renderHook(useLedger, { wrapper });
    act(() => {
      result.current.ledger.addTransaction({
        kind: "inflow",
        description: "Pay",
        amountCents: 300000,
        date: "2026-08-01",
        accountId: ACCOUNT.id,
      });
    });
    act(() => {
      result.current.assignments.setPeriodAssignments({
        period: "2026-08",
        entries: [
          { budgetId: "b1", amountCents: 60000 },
          { budgetId: "b2", amountCents: 20000 },
        ],
      });
    });
    expectAllBalanced(result.current);

    const poolBefore = result.current.now.toBeAssignedCents;

    act(() => {
      result.current.assignments.moveBetweenBudgets({
        fromBudgetId: "b1",
        toBudgetId: "b2",
        period: "2026-08",
        amountCents: 15000,
      });
    });

    // The two deltas cancel, so this is the one mutation that moves money
    // between envelopes and cannot touch what is left to assign. If a future
    // change makes a move route through the pool, this is what catches it.
    expectAllBalanced(result.current);
    expect(result.current.now.toBeAssignedCents).toBe(poolBefore);
    expect(envelopeFor(result.current.now, "b1").availableCents).toBe(45000);
    expect(envelopeFor(result.current.now, "b2").availableCents).toBe(35000);
  });
});

describe("transfers", () => {
  // The four accounts the matrix needs: two the budget spends through (one of
  // them a card, since paying one off is the case that had no correct shape at
  // all before transfers existed) and two it does not.
  const CHECKING = ACCOUNT;
  const CARD = {
    id: "card1",
    name: "Visa",
    type: "liability",
    scope: "credit-card",
    assetClass: "Other",
    // The form asks a debt for what is owed as a positive figure and the store
    // negates it, so $200 owed is −$200 held.
    openingBalanceCents: -20000,
    openingDate: null,
  };
  const HOLDING = {
    id: "acc401k",
    name: "401(k)",
    type: "asset",
    scope: "off-budget",
    assetClass: "Stocks",
    openingBalanceCents: 500000,
    openingDate: null,
  };
  const BROKERAGE = {
    id: "accbrk",
    name: "Brokerage",
    type: "asset",
    scope: "off-budget",
    assetClass: "Stocks",
    openingBalanceCents: 100000,
    openingDate: null,
  };

  const useLedger = () => ({
    accounts: useAccounts(),
    ledger: useTransactions(),
    assignments: useAssignments(),
    balances: useAccountBalances("2026-08"),
    past: useEnvelopes("2026-01"),
    now: useEnvelopes("2026-08"),
    later: useEnvelopes("2030-12"),
  });

  function setUp() {
    localStorage.setItem("budgets", JSON.stringify([{ id: "b1", name: "Retirement" }]));
    localStorage.setItem("assignments", JSON.stringify([]));
    seedAccounts([CHECKING, CARD, HOLDING, BROKERAGE]);
    return renderHook(useLedger, { wrapper });
  }

  const transfer = (fields) => ({
    kind: TRANSACTION_KINDS.TRANSFER,
    date: "2026-08-10",
    amountCents: 20000,
    ...fields,
  });

  const balanceOf = (current, id) =>
    current.balances.rows.find((row) => row.account.id === id).balanceCents;

  function expectAllBalanced(current) {
    expectBalanced(current.past);
    expectBalanced(current.now);
    expectBalanced(current.later);
  }

  test("a record has to name a second account, and a different one", () => {
    const { result } = setUp();

    let missing;
    act(() => {
      missing = result.current.ledger.addTransaction(
        transfer({ accountId: CHECKING.id, description: "Nowhere" })
      );
    });
    expect(missing).toEqual({ ok: false, error: "Choose the account this moved to." });

    let itself;
    act(() => {
      itself = result.current.ledger.addTransaction(
        transfer({ accountId: CHECKING.id, toAccountId: CHECKING.id })
      );
    });
    expect(itself.ok).toBe(false);
    expect(itself.error).toMatch(/two different accounts/);

    // Neither reached the ledger, so nothing has to be cleaned up after a refusal.
    expect(result.current.ledger.transactions).toEqual([]);
  });

  test("the rules run on a patch too, so a transfer cannot be half-unmade", () => {
    const { result } = setUp();
    let id;
    act(() => {
      id = result.current.ledger.addTransaction(
        transfer({ accountId: CHECKING.id, toAccountId: CARD.id, description: "Card payment" })
      ).id;
    });

    let cleared;
    act(() => {
      cleared = result.current.ledger.updateTransaction({ id, toAccountId: "" });
    });
    expect(cleared.ok).toBe(false);
    expect(result.current.ledger.transactions[0].toAccountId).toBe(CARD.id);

    let collided;
    act(() => {
      collided = result.current.ledger.updateTransaction({ id, accountId: CARD.id });
    });
    expect(collided.ok).toBe(false);
  });

  test("paying a card off moves both balances and no envelope at all", () => {
    const { result } = setUp();

    const before = result.current.now.toBeAssignedCents;
    expect(balanceOf(result.current, CARD.id)).toBe(-20000);

    act(() => {
      result.current.ledger.addTransaction(
        transfer({ accountId: CHECKING.id, toAccountId: CARD.id, description: "Card payment" })
      );
    });

    // The card is square and checking is down by what it paid.
    expect(balanceOf(result.current, CARD.id)).toBe(0);
    expect(balanceOf(result.current, CHECKING.id)).toBe(-20000);
    // And the plan has not moved: the money was budgeted on its way out through
    // the card, so the payment is not a second call on any envelope.
    expect(result.current.now.toBeAssignedCents).toBe(before);
    expect(result.current.now.periodSpentCents).toBe(0);
    expect(result.current.now.periodActivityCents).toBe(0);
    expectAllBalanced(result.current);
  });

  test("a contribution to a holding is spending, and the holding is credited for it", () => {
    const { result } = setUp();
    const before = result.current.now.toBeAssignedCents;

    act(() => {
      result.current.ledger.addTransaction(
        transfer({
          accountId: CHECKING.id,
          toAccountId: HOLDING.id,
          budgetId: "b1",
          description: "Contribution",
        })
      );
    });

    // Out of the envelope it was assigned to, exactly as the categorised outflow
    // this replaces was.
    expect(envelopeFor(result.current.now, "b1").activityCents).toBe(-20000);
    expect(envelopeFor(result.current.now, "b1").spentCents).toBe(20000);
    expect(result.current.now.toBeAssignedCents).toBe(before);
    // And on the balance sheet the money is simply somewhere else.
    expect(balanceOf(result.current, CHECKING.id)).toBe(-20000);
    expect(balanceOf(result.current, HOLDING.id)).toBe(520000);
    expectAllBalanced(result.current);
  });

  test("a crossing transfer with no category lands on Uncategorized and still balances", () => {
    const { result } = setUp();

    // The store cannot check this — it is mounted above the accounts and cannot
    // see a scope — so the form is what refuses it. What matters here is that a
    // record which reaches storage without one has somewhere to land.
    act(() => {
      result.current.ledger.addTransaction(
        transfer({ accountId: CHECKING.id, toAccountId: HOLDING.id })
      );
    });

    expect(envelopeFor(result.current.now, UNCATEGORIZED_BUDGET_ID).spentCents).toBe(20000);
    expectAllBalanced(result.current);
  });

  test("money drawn out of a holding is income to assign", () => {
    const { result } = setUp();
    const before = result.current.now.toBeAssignedCents;

    act(() => {
      result.current.ledger.addTransaction(
        transfer({ accountId: HOLDING.id, toAccountId: CHECKING.id, description: "Withdrawal" })
      );
    });

    expect(result.current.now.toBeAssignedCents).toBe(before + 20000);
    expect(result.current.now.periodIncomeCents).toBe(20000);
    // Income, not a refund: no envelope was given anything.
    expect(result.current.now.periodActivityCents).toBe(0);
    expect(balanceOf(result.current, HOLDING.id)).toBe(480000);
    expect(balanceOf(result.current, CHECKING.id)).toBe(20000);
    expectAllBalanced(result.current);
  });

  test("a rollover between two holdings touches the plan nowhere", () => {
    const { result } = setUp();
    const before = result.current.now.toBeAssignedCents;

    act(() => {
      result.current.ledger.addTransaction(
        transfer({ accountId: HOLDING.id, toAccountId: BROKERAGE.id, description: "Rollover" })
      );
    });

    expect(result.current.now.toBeAssignedCents).toBe(before);
    expect(result.current.now.cumIncomeCents).toBe(0);
    expect(result.current.now.cumSpentCents).toBe(0);
    expect(balanceOf(result.current, BROKERAGE.id)).toBe(120000);
    expectAllBalanced(result.current);
  });

  test("all four quadrants at once, and the books still balance", () => {
    const { result } = setUp();

    act(() => {
      result.current.assignments.setAssignedAmount({
        budgetId: "b1",
        period: "2026-08",
        amountCents: 30000,
      });
    });
    act(() => {
      result.current.ledger.addTransaction(earn({ date: "2026-08-01", amountCents: 100000 }));
    });
    act(() => {
      result.current.ledger.addTransaction(
        transfer({ accountId: CHECKING.id, toAccountId: CARD.id })
      );
      result.current.ledger.addTransaction(
        transfer({ accountId: CHECKING.id, toAccountId: HOLDING.id, budgetId: "b1" })
      );
      result.current.ledger.addTransaction(
        transfer({ accountId: BROKERAGE.id, toAccountId: CHECKING.id })
      );
      result.current.ledger.addTransaction(
        transfer({ accountId: HOLDING.id, toAccountId: BROKERAGE.id })
      );
    });

    expectAllBalanced(result.current);

    // Every dollar still accounted for on the balance sheet as well: the four
    // transfers net to nothing across the accounts they touched, so the household
    // holds its openings plus the paycheque.
    expect(result.current.balances.netCents).toBe(-20000 + 500000 + 100000 + 100000);
  });

  test("a date or an amount can be corrected on a transfer like any other row", () => {
    const { result } = setUp();
    let id;
    act(() => {
      id = result.current.ledger.addTransaction(
        transfer({ accountId: CHECKING.id, toAccountId: CARD.id })
      ).id;
    });

    act(() => {
      result.current.ledger.updateTransaction({ id, amount: "150", date: "2026-08-12" });
    });

    expect(result.current.ledger.transactions[0]).toMatchObject({
      kind: TRANSACTION_KINDS.TRANSFER,
      amountCents: 15000,
      date: "2026-08-12",
      accountId: CHECKING.id,
      toAccountId: CARD.id,
    });
    expect(balanceOf(result.current, CARD.id)).toBe(-5000);
    expectAllBalanced(result.current);
  });

  test("deleting the destination cuts that side loose and keeps the books balanced", () => {
    const { result } = setUp();
    act(() => {
      result.current.ledger.addTransaction(
        transfer({ accountId: CHECKING.id, toAccountId: HOLDING.id, budgetId: "b1" })
      );
    });
    expect(envelopeFor(result.current.now, "b1").spentCents).toBe(20000);

    act(() => {
      result.current.accounts.deleteAccount({ id: HOLDING.id });
    });

    // The record survives, minus the account that no longer exists.
    expect(result.current.ledger.transactions[0]).toMatchObject({
      accountId: CHECKING.id,
      toAccountId: null,
    });
    // A detached side reads as inside the budget — the same stance a detached
    // ordinary record takes — so the money is back in its envelope rather than
    // spent out of a holding nothing can show. It is a restatement of history,
    // which is what deleting an account always is here, and the identity holds
    // either way.
    expect(envelopeFor(result.current.now, "b1").spentCents).toBe(0);
    expectAllBalanced(result.current);
  });

  test("deleting a transfer is a delete, with no second leg left behind", () => {
    const { result } = setUp();
    let id;
    act(() => {
      id = result.current.ledger.addTransaction(
        transfer({ accountId: CHECKING.id, toAccountId: CARD.id })
      ).id;
    });

    act(() => {
      result.current.ledger.deleteTransaction({ id });
    });

    expect(result.current.ledger.transactions).toEqual([]);
    expect(balanceOf(result.current, CARD.id)).toBe(-20000);
    expectAllBalanced(result.current);
  });

  test("a category is kept rather than cleared when a transfer stops needing one", () => {
    const { result } = setUp();
    let id;
    act(() => {
      id = result.current.ledger.addTransaction(
        transfer({ accountId: CHECKING.id, toAccountId: HOLDING.id, budgetId: "b1" })
      ).id;
    });

    // Re-pointed at an account inside the budget: the transfer stops spending,
    // but the answer it was given is still on the record, so pointing it back is
    // one edit rather than two.
    act(() => {
      result.current.ledger.updateTransaction({ id, toAccountId: CARD.id });
    });
    expect(result.current.ledger.transactions[0].budgetId).toBe("b1");
    expect(envelopeFor(result.current.now, "b1").spentCents).toBe(0);
    expectAllBalanced(result.current);

    act(() => {
      result.current.ledger.updateTransaction({ id, toAccountId: HOLDING.id });
    });
    expect(envelopeFor(result.current.now, "b1").spentCents).toBe(20000);
    expectAllBalanced(result.current);
  });

  test("an account's own list holds the transfers into it as well as out", () => {
    const { result } = setUp();
    act(() => {
      result.current.ledger.addTransaction(
        transfer({ accountId: CHECKING.id, toAccountId: HOLDING.id, budgetId: "b1" })
      );
    });

    expect(result.current.ledger.getAccountTransactions(HOLDING.id)).toHaveLength(1);
    expect(result.current.ledger.getAccountTransactions(CHECKING.id)).toHaveLength(1);
  });
});

describe("payees as records rather than typed text", () => {
  /** The payee store and the ledger together, which is what a cascade needs. */
  function withPayees(seed = []) {
    seedAccounts();
    if (seed.length > 0) localStorage.setItem("payees", JSON.stringify(seed));
    return renderHook(() => ({ payees: usePayees(), ledger: useTransactions() }), { wrapper });
  }

  const nameOf = (result, id) => result.current.payees.payeeById.get(id)?.name;

  test("a payee is a name and, optionally, where it is usually filed", () => {
    const { result } = withPayees();

    let id;
    act(() => {
      id = result.current.payees.addPayee({ name: "  Costco  " }).id;
    });

    // Trimmed on the way in, and no default: most payees are not always filed the
    // same way, so null is the ordinary answer rather than a gap.
    expect(stored("payees")).toEqual([{ id, name: "Costco", defaultBudgetId: null }]);
  });

  test("two payees cannot share a name, however it is capitalised", () => {
    const { result } = withPayees();

    act(() => {
      result.current.payees.addPayee({ name: "Costco" });
    });

    let second;
    act(() => {
      second = result.current.payees.addPayee({ name: "  costco " });
    });

    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/already exists/i);
    expect(result.current.payees.payees).toHaveLength(1);
  });

  test("punctuation is not identity — two real payees may differ only by it", () => {
    const { result } = withPayees();

    // The search folds "&" away so that typing "att" finds "AT&T"; identity does
    // not, because these may genuinely be two different payees and refusing the
    // second would be the app deciding otherwise.
    act(() => {
      expect(result.current.payees.addPayee({ name: "AT&T" }).ok).toBe(true);
    });
    act(() => {
      expect(result.current.payees.addPayee({ name: "ATT" }).ok).toBe(true);
    });
    expect(result.current.payees.payees).toHaveLength(2);
  });

  test("a name is required, and a blank one is refused", () => {
    const { result } = withPayees();

    act(() => {
      expect(result.current.payees.addPayee({ name: "   " }).ok).toBe(false);
    });
    expect(result.current.payees.payees).toHaveLength(0);
  });

  test("renaming is one write, and every transaction follows it", () => {
    const { result } = withPayees([{ id: "p1", name: "Costcko", defaultBudgetId: null }]);

    act(() => {
      result.current.ledger.addTransaction(
        spend({ payeeId: "p1", amountCents: 7840, budgetId: "b1", date: todayISO() })
      );
    });

    act(() => {
      expect(result.current.payees.updatePayee({ id: "p1", name: "Costco" }).ok).toBe(true);
    });

    // The row was never holding the name, which is the whole reason the entity
    // exists: nothing in the ledger changed and the row says the new name.
    expect(result.current.ledger.transactions[0].payeeId).toBe("p1");
    expect(nameOf(result, "p1")).toBe("Costco");
  });

  test("a rename onto another payee's name is refused, and says to merge", () => {
    const { result } = withPayees([
      { id: "p1", name: "Costco", defaultBudgetId: null },
      { id: "p2", name: "Costco Wholesale", defaultBudgetId: null },
    ]);

    let outcome;
    act(() => {
      outcome = result.current.payees.updatePayee({ id: "p2", name: "costco" });
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/merge/i);
    expect(nameOf(result, "p2")).toBe("Costco Wholesale");
  });

  test("an id the store does not have is refused rather than reported as written", () => {
    const { result } = withPayees();

    // `useSyncedState` syncs a delete from another device, so the panel can be
    // open on a row that is gone — a `map` matching nothing would report success.
    act(() => {
      expect(result.current.payees.updatePayee({ id: "nope", name: "Costco" }).ok).toBe(false);
    });
  });

  test("the default category is set, cleared, and left alone by an unrelated patch", () => {
    const { result } = withPayees([{ id: "p1", name: "Costco", defaultBudgetId: null }]);

    act(() => {
      result.current.payees.updatePayee({ id: "p1", defaultBudgetId: "b1" });
    });
    expect(stored("payees")[0].defaultBudgetId).toBe("b1");

    // A patch that names only the name leaves the default where it was.
    act(() => {
      result.current.payees.updatePayee({ id: "p1", name: "Costco Wholesale" });
    });
    expect(stored("payees")[0].defaultBudgetId).toBe("b1");

    // Null is how it comes off, and "" — an unpicked select — means the same.
    act(() => {
      result.current.payees.updatePayee({ id: "p1", defaultBudgetId: "" });
    });
    expect(stored("payees")[0].defaultBudgetId).toBeNull();
  });

  test("removing a payee keeps its transactions and detaches them", () => {
    const { result } = withPayees([{ id: "p1", name: "Costco", defaultBudgetId: null }]);

    act(() => {
      result.current.ledger.addTransaction(
        spend({ payeeId: "p1", amountCents: 7840, budgetId: "b1", date: todayISO() })
      );
    });

    act(() => {
      result.current.payees.deletePayee({ id: "p1" });
    });

    // The money moved; what is gone is only the record of who it went to. Deleting
    // the row instead would rewrite an envelope balance because a list was tidied.
    expect(result.current.ledger.transactions).toHaveLength(1);
    expect(result.current.ledger.transactions[0]).toMatchObject({
      payeeId: null,
      amountCents: 7840,
      budgetId: "b1",
    });
  });

  test("merging repoints every transaction and drops the merged payees, in one commit", () => {
    const { result } = withPayees([
      { id: "p1", name: "Costco", defaultBudgetId: null },
      { id: "p2", name: "COSTCO", defaultBudgetId: null },
      { id: "p3", name: "Costco Wholesale", defaultBudgetId: null },
    ]);

    act(() => {
      result.current.ledger.addTransaction(
        spend({ payeeId: "p2", amountCents: 1000, budgetId: "b1", date: todayISO() })
      );
      result.current.ledger.addTransaction(
        spend({ payeeId: "p3", amountCents: 2000, budgetId: "b1", date: todayISO() })
      );
    });

    act(() => {
      expect(
        result.current.payees.mergePayees({ fromIds: ["p2", "p3"], intoId: "p1" }).ok
      ).toBe(true);
    });

    expect(result.current.payees.payees).toEqual([
      { id: "p1", name: "Costco", defaultBudgetId: null },
    ]);
    expect(result.current.ledger.transactions.map((entry) => entry.payeeId)).toEqual(["p1", "p1"]);
    // And nothing about the money moved: a merge is about names.
    expect(result.current.ledger.transactions.map((entry) => entry.amountCents)).toEqual([
      1000, 2000,
    ]);
  });

  test("a merge adopts a default only where the survivor has none", () => {
    const { result } = withPayees([
      { id: "p1", name: "Costco", defaultBudgetId: null },
      { id: "p2", name: "COSTCO", defaultBudgetId: "b1" },
    ]);

    act(() => {
      result.current.payees.mergePayees({ fromIds: ["p2"], intoId: "p1" });
    });
    // The only answer either of them had is kept.
    expect(stored("payees")).toEqual([{ id: "p1", name: "Costco", defaultBudgetId: "b1" }]);
  });

  test("a merge never overwrites an answer the survivor already gave", () => {
    const { result } = withPayees([
      { id: "p1", name: "Costco", defaultBudgetId: "b1" },
      { id: "p2", name: "COSTCO", defaultBudgetId: "b2" },
    ]);

    act(() => {
      result.current.payees.mergePayees({ fromIds: ["p2"], intoId: "p1" });
    });
    expect(stored("payees")[0].defaultBudgetId).toBe("b1");
  });

  test("a merge into itself, or of a payee that is gone, is refused whole", () => {
    const { result } = withPayees([
      { id: "p1", name: "Costco", defaultBudgetId: null },
      { id: "p2", name: "COSTCO", defaultBudgetId: null },
    ]);

    act(() => {
      expect(result.current.payees.mergePayees({ fromIds: ["p1"], intoId: "p1" }).ok).toBe(false);
    });
    act(() => {
      expect(result.current.payees.mergePayees({ fromIds: [], intoId: "p1" }).ok).toBe(false);
    });
    // The whole batch is validated before anything is written, so one unknown id
    // leaves the good one alone rather than half-merging.
    act(() => {
      expect(result.current.payees.mergePayees({ fromIds: ["p2", "gone"], intoId: "p1" }).ok).toBe(
        false
      );
    });
    expect(result.current.payees.payees).toHaveLength(2);
  });

  test("a stored record from before the field existed reads as having no default", () => {
    const { result } = withPayees([{ id: "p1", name: "Costco" }]);
    expect(result.current.payees.payees).toEqual([
      { id: "p1", name: "Costco", defaultBudgetId: null },
    ]);
  });

  test("the ledger takes a payee but never requires one", () => {
    const { result } = withPayees();

    // A cash withdrawal names nobody, and a row folded in from before payees
    // existed names nobody either — refusing those would make rows unfinishable
    // that were complete before.
    act(() => {
      expect(
        result.current.ledger.addTransaction(
          spend({ amountCents: 2000, budgetId: "b1", date: todayISO() })
        ).ok
      ).toBe(true);
    });
    expect(result.current.ledger.transactions[0].payeeId).toBeNull();
  });

  test("a payee can be put on a row, and taken off again, one patch at a time", () => {
    const { result } = withPayees([{ id: "p1", name: "Costco", defaultBudgetId: null }]);

    let id;
    act(() => {
      id = result.current.ledger.addTransaction(
        spend({ amountCents: 2000, budgetId: "b1", date: todayISO() })
      ).id;
    });

    act(() => {
      result.current.ledger.updateTransaction({ id, payeeId: "p1" });
    });
    expect(result.current.ledger.transactions[0].payeeId).toBe("p1");

    // Clearing it is a real answer, unlike clearing a date or an amount: a row
    // that names nobody is an ordinary row.
    act(() => {
      expect(result.current.ledger.updateTransaction({ id, payeeId: "" }).ok).toBe(true);
    });
    expect(result.current.ledger.transactions[0].payeeId).toBeNull();
  });
});

describe("one transaction divided between categories", () => {
  const CHECKING = { ...ACCOUNT, openingBalanceCents: 500000 };
  const HOLDING = {
    id: "acc-401k",
    name: "401(k)",
    type: "asset",
    scope: "off-budget",
    assetClass: "Stocks",
    openingBalanceCents: 1000000,
    openingDate: null,
  };

  const useLedger = () => ({
    budgets: useBudgets(),
    ledger: useTransactions(),
    assignments: useAssignments(),
    balances: useAccountBalances("2026-08"),
    past: useEnvelopes("2026-01"),
    now: useEnvelopes("2026-08"),
    later: useEnvelopes("2030-12"),
  });

  function setUp({ transactions, assignments = [] } = {}) {
    localStorage.setItem(
      "budgets",
      JSON.stringify([
        { id: "b1", name: "Groceries" },
        { id: "b2", name: "Household" },
        { id: "b3", name: "Gifts" },
      ])
    );
    if (assignments) localStorage.setItem("assignments", JSON.stringify(assignments));
    if (transactions) localStorage.setItem("transactions", JSON.stringify(transactions));
    seedAccounts([CHECKING, HOLDING]);
    return renderHook(useLedger, { wrapper });
  }

  // $120 of groceries and household, on one receipt, the way a supermarket run
  // actually happens.
  const receipt = (fields) => ({
    kind: TRANSACTION_KINDS.OUTFLOW,
    accountId: CHECKING.id,
    date: "2026-08-12",
    description: "Costco",
    amountCents: 12000,
    splits: [
      { budgetId: "b1", amountCents: 8000 },
      { budgetId: "b2", amountCents: 4000 },
    ],
    ...fields,
  });

  const balanceOf = (current, id) =>
    current.balances.rows.find((row) => row.account.id === id).balanceCents;

  function expectAllBalanced(current) {
    expectBalanced(current.past);
    expectBalanced(current.now);
    expectBalanced(current.later);
  }

  /**
   * The envelope view against a reading of the ledger that has no notion of
   * parts in it at all.
   *
   * `expectBalanced` is self-consistent by construction — both of its sides come
   * out of the same hook — so it would stay green if a division and its whole
   * drifted apart together. This is the check that cannot: it adds up the
   * `amountCents` the register shows and the balance sheet spends, and insists
   * the envelopes cover exactly that. Split the parts wrong and it is the first
   * thing to go red.
   */
  function expectCoversLedger(current) {
    const gross = current.ledger.transactions
      .filter((transaction) => transaction.kind === TRANSACTION_KINDS.OUTFLOW)
      .reduce((sum, transaction) => sum + transaction.amountCents, 0);
    expect(current.later.cumSpentCents).toBe(gross);
  }

  test("each part lands in its own envelope while the account loses the whole", () => {
    const { result } = setUp({ transactions: [receipt({ id: "t1" })] });

    expect(envelopeFor(result.current.now, "b1").spentCents).toBe(8000);
    expect(envelopeFor(result.current.now, "b2").spentCents).toBe(4000);
    expect(envelopeFor(result.current.now, "b3").spentCents).toBe(0);
    // The two cuts of the same ledger, reading the same money two ways: the
    // envelopes read the parts, the balance sheet reads the whole, and the sum
    // rule is the only reason they can both be right.
    expect(balanceOf(result.current, CHECKING.id)).toBe(500000 - 12000);
    expectAllBalanced(result.current);
    expectCoversLedger(result.current);
  });

  test("parts that do not add up to the whole are refused, and nothing lands", () => {
    const { result } = setUp();

    let short;
    act(() => {
      short = result.current.ledger.addTransaction(
        receipt({
          splits: [
            { budgetId: "b1", amountCents: 8000 },
            { budgetId: "b2", amountCents: 3000 },
          ],
        })
      );
    });
    expect(short.ok).toBe(false);
    expect(short.error).toMatch(/add up/);
    expect(result.current.ledger.transactions).toEqual([]);
  });

  test("a part needs a category and an amount, and one part is not a division", () => {
    const { result } = setUp();

    let lone;
    act(() => {
      lone = result.current.ledger.addTransaction(
        receipt({ splits: [{ budgetId: "b1", amountCents: 12000 }] })
      );
    });
    expect(lone.ok).toBe(false);
    expect(lone.error).toMatch(/two or more parts/);

    let unfiled;
    act(() => {
      unfiled = result.current.ledger.addTransaction(
        receipt({
          splits: [
            { budgetId: "b1", amountCents: 8000 },
            { budgetId: "", amountCents: 4000 },
          ],
        })
      );
    });
    expect(unfiled.ok).toBe(false);

    // A negative part would be a refund hiding inside an expense, which is the
    // one thing the two kinds exist to keep apart.
    let negative;
    act(() => {
      negative = result.current.ledger.addTransaction(
        receipt({
          splits: [
            { budgetId: "b1", amountCents: 16000 },
            { budgetId: "b2", amountCents: -4000 },
          ],
        })
      );
    });
    expect(negative.ok).toBe(false);
    expect(result.current.ledger.transactions).toEqual([]);
  });

  test("the total cannot be retyped on its own, but moves with the parts in one patch", () => {
    const { result } = setUp({ transactions: [receipt({ id: "t1" })] });

    // The sum rule names `amountCents` as well as `splits`, so it runs when
    // either side of it moves — which is exactly why the register sends a split
    // row's figure to the editor instead of taking it in the cell.
    let alone;
    act(() => {
      alone = result.current.ledger.updateTransaction({ id: "t1", amountCents: 13000 });
    });
    expect(alone.ok).toBe(false);
    expect(alone.error).toMatch(/add up/);
    expect(result.current.ledger.transactions[0].amountCents).toBe(12000);

    let together;
    act(() => {
      together = result.current.ledger.updateTransaction({
        id: "t1",
        amountCents: 13000,
        splits: [
          { budgetId: "b1", amountCents: 9000 },
          { budgetId: "b2", amountCents: 4000 },
        ],
      });
    });
    expect(together.ok).toBe(true);
    expect(envelopeFor(result.current.now, "b1").spentCents).toBe(9000);
    expectAllBalanced(result.current);
    expectCoversLedger(result.current);
  });

  test("undoing a division files the whole under one category", () => {
    const { result } = setUp({ transactions: [receipt({ id: "t1" })] });

    act(() => {
      result.current.ledger.updateTransaction({ id: "t1", budgetId: "b1", splits: null });
    });

    expect(result.current.ledger.transactions[0].splits).toBeNull();
    expect(envelopeFor(result.current.now, "b1").spentCents).toBe(12000);
    expect(envelopeFor(result.current.now, "b2").spentCents).toBe(0);
    expectAllBalanced(result.current);
    expectCoversLedger(result.current);
  });

  test("deleting a category moves the part that names it, and the rest stay put", () => {
    const { result } = setUp({ transactions: [receipt({ id: "t1" })] });

    act(() => {
      result.current.budgets.deleteBudget({ id: "b1" });
    });

    expect(result.current.ledger.transactions[0].splits).toEqual([
      { id: expect.any(String), budgetId: UNCATEGORIZED_BUDGET_ID, amountCents: 8000 },
      { id: expect.any(String), budgetId: "b2", amountCents: 4000 },
    ]);
    expect(envelopeFor(result.current.now, UNCATEGORIZED_BUDGET_ID).spentCents).toBe(8000);
    expectAllBalanced(result.current);
    expectCoversLedger(result.current);
  });

  test("two parts landing on one category merge, and a division of one is no division", () => {
    const { result } = setUp({ transactions: [receipt({ id: "t1" })] });

    act(() => {
      result.current.budgets.deleteBudget({ id: "b1" });
    });
    act(() => {
      result.current.budgets.deleteBudget({ id: "b2" });
    });

    // Both halves are now Uncategorized, which is one answer and not two — and
    // one part is the record it already was, so the division goes away rather
    // than being left in a shape the store would refuse from any other caller.
    const record = result.current.ledger.transactions[0];
    expect(record.splits).toBeNull();
    expect(record.budgetId).toBe(UNCATEGORIZED_BUDGET_ID);
    expect(record.amountCents).toBe(12000);
    expect(envelopeFor(result.current.now, UNCATEGORIZED_BUDGET_ID).spentCents).toBe(12000);
    expectAllBalanced(result.current);
    expectCoversLedger(result.current);
  });

  test("a divided refund goes back to its envelopes and never to the pool", () => {
    const { result } = setUp({
      transactions: [
        receipt({ id: "t1" }),
        receipt({
          id: "t2",
          kind: TRANSACTION_KINDS.INFLOW,
          description: "Returned",
          amountCents: 3000,
          splits: [
            { budgetId: "b1", amountCents: 2000 },
            { budgetId: "b2", amountCents: 1000 },
          ],
        }),
      ],
    });

    // Money already assigned on its way out comes back where it came from, part
    // by part — the store's refund rule, applied to each leg of the division.
    expect(envelopeFor(result.current.now, "b1").refundCents).toBe(2000);
    expect(envelopeFor(result.current.now, "b2").refundCents).toBe(1000);
    expect(result.current.now.periodIncomeCents).toBe(0);
    expect(result.current.now.toBeAssignedCents).toBe(500000);
    expectAllBalanced(result.current);
  });

  test("a contribution divided between savings categories still crosses out whole", () => {
    const { result } = setUp({
      transactions: [
        receipt({
          id: "t1",
          kind: TRANSACTION_KINDS.TRANSFER,
          description: "Contribution",
          toAccountId: HOLDING.id,
          amountCents: 50000,
          splits: [
            { budgetId: "b1", amountCents: 30000 },
            { budgetId: "b3", amountCents: 20000 },
          ],
        }),
      ],
    });

    // The matrix decides whether it is spending at all; the division decides
    // which envelopes it is spending out of. Neither answer reaches into the
    // other.
    expect(envelopeFor(result.current.now, "b1").spentCents).toBe(30000);
    expect(envelopeFor(result.current.now, "b3").spentCents).toBe(20000);
    expect(balanceOf(result.current, HOLDING.id)).toBe(1050000);
    expect(balanceOf(result.current, CHECKING.id)).toBe(450000);
    expectAllBalanced(result.current);
  });

  test("money arriving from outside the budget ignores a division left on it", () => {
    const { result } = setUp({
      transactions: [
        receipt({
          id: "t1",
          kind: TRANSACTION_KINDS.TRANSFER,
          description: "Withdrawal",
          accountId: HOLDING.id,
          toAccountId: CHECKING.id,
          amountCents: 50000,
          splits: [
            { budgetId: "b1", amountCents: 30000 },
            { budgetId: "b3", amountCents: 20000 },
          ],
        }),
      ],
    });

    // All of it is money to assign, and none of it has been spent out of
    // anything: a split says where money went, and this money has not been
    // anywhere yet. Inert rather than refused, so re-pointing the transfer
    // brings the division back.
    expect(result.current.now.toBeAssignedCents).toBe(550000);
    expect(envelopeFor(result.current.now, "b1").spentCents).toBe(0);
    expectAllBalanced(result.current);
  });

  test("a division that does not add up is dropped on the way in, and the money is not", () => {
    // A hand-edited file, or one written by some other shape of this app. No
    // repair is attempted: scaling the parts would invent a decision nobody
    // made, and leaving it would be the one state in which the envelopes and the
    // balance sheet disagree about how much money moved.
    const { result } = setUp({
      transactions: [
        receipt({
          id: "t1",
          budgetId: "b3",
          splits: [
            { budgetId: "b1", amountCents: 8000 },
            { budgetId: "b2", amountCents: 1000 },
          ],
        }),
      ],
    });

    expect(result.current.ledger.transactions[0].splits).toBeNull();
    expect(result.current.ledger.transactions[0].amountCents).toBe(12000);
    expect(envelopeFor(result.current.now, "b3").spentCents).toBe(12000);
    expectAllBalanced(result.current);
    expectCoversLedger(result.current);
  });

  test("the day-one seed opens each part's category at its own part", () => {
    // No `assignments` key at all, which is what makes the seed run.
    const { result } = setUp({ transactions: [receipt({ id: "t1" })], assignments: null });

    const period = currentPeriod();
    const seeded = result.current.assignments.assignments.filter(
      (assignment) => assignment.period === period
    );
    expect(seeded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ budgetId: "b1", assignedCents: 8000 }),
        expect.objectContaining({ budgetId: "b2", assignedCents: 4000 }),
      ])
    );
  });

  test("a category lists a divided receipt once, and only the categories it names", () => {
    const { result } = setUp({ transactions: [receipt({ id: "t1" })] });

    expect(result.current.ledger.getBudgetTransactions("b1").map((entry) => entry.id)).toEqual([
      "t1",
    ]);
    expect(result.current.ledger.getBudgetTransactions("b2").map((entry) => entry.id)).toEqual([
      "t1",
    ]);
    expect(result.current.ledger.getBudgetTransactions("b3")).toEqual([]);
  });
});
