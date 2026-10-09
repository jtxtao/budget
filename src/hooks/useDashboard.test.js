import { act, renderHook } from "@testing-library/react";
import AppProviders from "../contexts/AppProviders";
import { useAccounts } from "../contexts/AccountsContext";
import { usePaySchedule } from "../contexts/PayScheduleContext";
import { TRANSACTION_KINDS } from "../contexts/TransactionsContext";
import useDashboard from "./useDashboard";
import useEnvelopes from "./useEnvelopes";
import useNextPaycheck from "./useNextPaycheck";
import { addDays, addMonths, currentPeriod, daysBetween, todayISO } from "../utils";

/**
 * The dashboard reads across every store, so these drive it through the real
 * providers with pre-migration JSON in storage — the same way the data-model
 * tests do, and for the same reason: what is under test includes the migrations
 * and the order the providers are composed in.
 */
const wrapper = ({ children }) => <AppProviders>{children}</AppProviders>;

beforeEach(() => {
  localStorage.clear();
});

const PERIOD = currentPeriod();
const LAST_PERIOD = addMonths(PERIOD, -1);
const TODAY = todayISO();

const ACCOUNT = {
  id: "acc1",
  name: "Everyday",
  type: "asset",
  scope: "on-budget",
  assetClass: "Cash",
  openingBalanceCents: 0,
  openingDate: null,
};

function seed({ accounts = [ACCOUNT], groups, budgets, transactions, assignments } = {}) {
  const write = (key, value) => value && localStorage.setItem(key, JSON.stringify(value));
  write("accounts", accounts);
  write("budgetGroups", groups);
  write("budgets", budgets);
  write("transactions", transactions);
  // Seeding the ledger fires the day-one assignment seed, so a test that wants
  // spend with no funding has to write this key too.
  write("assignments", assignments ?? []);
}

const budget = (id, name, groupId = null, plannedCents = 0, goalCents = null) => ({
  id,
  name,
  groupId,
  plannedCents,
  goalCents,
  bucket: null,
});

const spend = (fields) => ({
  id: `t-${fields.budgetId}-${fields.amountCents}`,
  kind: TRANSACTION_KINDS.OUTFLOW,
  accountId: ACCOUNT.id,
  date: `${PERIOD}-05`,
  ...fields,
});

describe("the dashboard's category table", () => {
  test("categories come back under their group, in the order the plan sets", () => {
    seed({
      groups: [
        { id: "g1", name: "Bills", bucket: "essentials" },
        { id: "g2", name: "Fun", bucket: "fun" },
      ],
      budgets: [
        budget("b1", "Rent", "g1", 150000),
        budget("b2", "Power", "g1", 12000),
        budget("b3", "Dining", "g2", 20000),
      ],
    });

    const { result } = renderHook(() => useDashboard(PERIOD), { wrapper });

    expect(result.current.sections.map((section) => section.name)).toEqual(["Bills", "Fun"]);
    expect(result.current.sections[0].rows.map((row) => row.name)).toEqual(["Rent", "Power"]);
    // The ungrouped section holds nothing, so it is not a heading over nothing.
    expect(result.current.sections.map((section) => section.groupId)).not.toContain(null);
  });

  test("the figures on a row are the envelope's, arranged", () => {
    seed({
      budgets: [budget("b1", "Groceries", null, 60000)],
      transactions: [
        spend({ budgetId: "b1", amountCents: 25000 }),
        // Last month's spend, which is carry-in this month rather than activity.
        spend({ budgetId: "b1", amountCents: 10000, date: `${LAST_PERIOD}-11` }),
      ],
      assignments: [
        { id: "a1", budgetId: "b1", period: LAST_PERIOD, assignedCents: 40000 },
        { id: "a2", budgetId: "b1", period: PERIOD, assignedCents: 30000 },
      ],
    });

    const { result } = renderHook(() => useDashboard(PERIOD), { wrapper });
    const row = result.current.sections[0].rows[0];

    expect(row.carriedInCents).toBe(30000); // 40,000 assigned − 10,000 spent
    expect(row.budgetedCents).toBe(30000);
    // Signed, so the row adds up as it reads: 30,000 + 30,000 − 25,000.
    expect(row.activityCents).toBe(-25000);
    expect(row.availableCents).toBe(35000);
    expect(row.targetCents).toBe(60000);
    // Nothing being saved for here, which is the ordinary case and is null
    // rather than zero all the way to the table.
    expect(row.goalCents).toBeNull();
  });

  test("a goal set on the plan reaches the row it belongs to", () => {
    seed({
      groups: [{ id: "g1", name: "Sinking funds", bucket: "savings" }],
      budgets: [
        budget("b1", "Car fund", "g1", 20000, 500000),
        budget("b2", "Holiday", "g1", 10000),
      ],
    });

    const { result } = renderHook(() => useDashboard(PERIOD), { wrapper });
    const [section] = result.current.sections;

    expect(section.rows.map((row) => row.goalCents)).toEqual([500000, null]);
    // The band adds up the goals under it and ignores the rows with none — the
    // heading is saving towards the car and nothing else.
    expect(section.totals.goalCents).toBe(500000);
    expect(result.current.totals.goalCents).toBe(500000);
  });

  test("a plan with no goals anywhere subtotals to nothing rather than to zero", () => {
    seed({
      groups: [{ id: "g1", name: "Bills", bucket: "essentials" }],
      budgets: [budget("b1", "Rent", "g1", 150000)],
    });

    const { result } = renderHook(() => useDashboard(PERIOD), { wrapper });

    // A heading with nothing saving towards anything has no goal at all, which
    // the table leaves blank. Zero would read as a goal already met.
    expect(result.current.sections[0].totals.goalCents).toBeNull();
    expect(result.current.totals.goalCents).toBeNull();
  });

  test("every envelope row is covered, so the totals match the headline figures", () => {
    seed({
      groups: [{ id: "g1", name: "Bills", bucket: "essentials" }],
      budgets: [budget("b1", "Rent", "g1", 150000)],
      transactions: [
        spend({ budgetId: "b1", amountCents: 100000 }),
        // No category of its own, and an id whose category was deleted. Both
        // hold real money and neither is filed under a group.
        spend({ budgetId: null, amountCents: 2500 }),
        spend({ budgetId: "gone", amountCents: 4000 }),
      ],
    });

    const { result } = renderHook(
      () => ({ dashboard: useDashboard(PERIOD), envelopes: useEnvelopes(PERIOD) }),
      { wrapper }
    );
    const { dashboard, envelopes } = result.current;

    expect(dashboard.otherRows.map((row) => row.name).sort()).toEqual([
      "Uncategorized",
      "Unknown category",
    ]);
    expect(dashboard.totals.activityCents).toBe(-envelopes.periodSpentCents);
    expect(dashboard.totals.budgetedCents).toBe(envelopes.periodAssignedCents);
    expect(dashboard.totals.availableCents).toBe(envelopes.totalAvailableCents);
  });

  test("a refund nets off the category it went back to, not the pool", () => {
    seed({
      budgets: [budget("b1", "Food")],
      transactions: [
        spend({ budgetId: "b1", amountCents: 10000 }),
        {
          id: "t-refund",
          kind: TRANSACTION_KINDS.INFLOW,
          accountId: ACCOUNT.id,
          budgetId: "b1",
          amountCents: 6000,
          date: `${PERIOD}-06`,
        },
      ],
      assignments: [{ id: "a1", budgetId: "b1", period: PERIOD, assignedCents: 10000 }],
    });

    const { result } = renderHook(() => useDashboard(PERIOD), { wrapper });
    const row = result.current.sections[0].rows[0];

    // $100 out, $60 back: the household spent $40 on food.
    expect(row.activityCents).toBe(-4000);
    expect(row.availableCents).toBe(6000);
    // The refund is not income, so it is not sitting in the pool as well.
    expect(result.current.periodIncomeCents).toBe(0);
  });

  test("untouched catch-alls are dropped, which no total notices", () => {
    seed({ budgets: [budget("b1", "Rent")] });

    const { result } = renderHook(() => useDashboard(PERIOD), { wrapper });

    expect(result.current.otherRows).toEqual([]);
    expect(result.current.totals.availableCents).toBe(0);
  });
});

describe("the next paycheck", () => {
  const setSchedule = (patch) => {
    const { result } = renderHook(
      () => ({ pay: usePaySchedule(), next: useNextPaycheck(TODAY) }),
      { wrapper }
    );
    act(() => {
      result.current.pay.setPaySchedule(patch);
    });
    return result;
  };

  test("says nothing until both halves are known", () => {
    const result = setSchedule({ lastPaidOn: TODAY });

    expect(result.current.next.configured).toBe(false);
    expect(result.current.next.nextDate).toBeNull();
    // Half a schedule is still stored — the user has not finished typing.
    expect(result.current.pay.schedule.lastPaidOn).toBe(TODAY);
  });

  test("counts forward from the last paycheck by whole pay periods", () => {
    const result = setSchedule({ lastPaidOn: addDays(TODAY, -4), periodDays: 14 });

    expect(result.current.next.nextDate).toBe(addDays(TODAY, 10));
    expect(result.current.next.daysUntil).toBe(10);
  });

  test("a schedule left un-updated for months still points at a future date", () => {
    const result = setSchedule({ lastPaidOn: addDays(TODAY, -100), periodDays: 14 });

    // 100 days is seven periods and two days, so the next one is 12 days out.
    expect(result.current.next.daysUntil).toBe(12);
    expect(daysBetween(TODAY, result.current.next.nextDate)).toBeGreaterThan(0);
  });

  test("today's pay recorded today points at the next one, not at today", () => {
    const result = setSchedule({ lastPaidOn: TODAY, periodDays: 14 });

    expect(result.current.next.daysUntil).toBe(14);
  });

  test("a payday that has arrived and not been recorded reads as today", () => {
    const result = setSchedule({ lastPaidOn: addDays(TODAY, -14), periodDays: 14 });

    expect(result.current.next.daysUntil).toBe(0);
  });

  test("a nonsense pay period is refused rather than stored", () => {
    const { result } = renderHook(() => usePaySchedule(), { wrapper });

    act(() => {
      expect(result.current.setPaySchedule({ periodDays: 0 }).ok).toBe(false);
    });
    act(() => {
      expect(result.current.setPaySchedule({ periodDays: 1.5 }).ok).toBe(false);
    });
    expect(result.current.schedule.periodDays).toBeNull();
  });

  test("a schedule saved with junk in it reads as not set up", () => {
    localStorage.setItem("paySchedule", JSON.stringify({ lastPaidOn: "5 August", periodDays: -3 }));

    const { result } = renderHook(() => useNextPaycheck(TODAY), { wrapper });

    expect(result.current.configured).toBe(false);
  });

  // A schedule stored before cadences existed was a day count and nothing else.
  // It has to keep working untouched, and it has to arrive under the name it was
  // always describing — or the picker would open on "Choose one…" for a user who
  // had already answered.
  test("a schedule stored as a bare day count reads as its own cadence", () => {
    localStorage.setItem(
      "paySchedule",
      JSON.stringify({ lastPaidOn: addDays(TODAY, -4), periodDays: 14 })
    );

    const { result } = renderHook(() => useNextPaycheck(TODAY), { wrapper });

    expect(result.current.cadence).toBe("biweekly");
    expect(result.current.summary).toBe("every 2 weeks");
    expect(result.current.nextDate).toBe(addDays(TODAY, 10));
  });

  test("an unnamed day count keeps the interval it was saved with", () => {
    localStorage.setItem(
      "paySchedule",
      JSON.stringify({ lastPaidOn: addDays(TODAY, -3), periodDays: 10 })
    );

    const { result } = renderHook(() => useNextPaycheck(TODAY), { wrapper });

    expect(result.current.cadence).toBe("custom");
    expect(result.current.daysUntil).toBe(7);
  });

  test("twice a month is placed from the calendar, with no payday to step from", () => {
    const result = setSchedule({ cadence: "semimonthly", daysOfMonth: [15, 31] });

    expect(result.current.next.configured).toBe(true);
    expect(result.current.next.lastPaidOn).toBeNull();
    expect(result.current.next.summary).toBe("on the 15th and the last day");
    expect(result.current.next.daysUntil).toBeGreaterThanOrEqual(0);
    expect(result.current.next.daysUntil).toBeLessThanOrEqual(17);
  });

  test("half of a twice-monthly schedule is stored, and the blank day means its default", () => {
    const result = setSchedule({ cadence: "semimonthly", daysOfMonth: [15] });

    // The second field shows "31" in grey, so the schedule runs on it.
    expect(result.current.next.configured).toBe(true);
    expect(result.current.pay.schedule.daysOfMonth).toEqual([15]);
  });

  test("a day of the month outside the calendar is refused rather than stored", () => {
    const { result } = renderHook(() => usePaySchedule(), { wrapper });

    act(() => {
      expect(result.current.setPaySchedule({ daysOfMonth: [0] }).ok).toBe(false);
    });
    act(() => {
      expect(result.current.setPaySchedule({ daysOfMonth: [32] }).ok).toBe(false);
    });
    act(() => {
      expect(result.current.setPaySchedule({ daysOfMonth: ["the 15th"] }).ok).toBe(false);
    });
    expect(result.current.schedule.daysOfMonth).toEqual([]);
  });

  // The two families answer different questions, so neither may quietly clear
  // the other's answer: switching between them to see which describes a new job
  // is the point of having both.
  test("switching cadence keeps the fields the new one does not use", () => {
    const { result } = renderHook(() => usePaySchedule(), { wrapper });

    act(() => {
      result.current.setPaySchedule({ cadence: "biweekly", lastPaidOn: TODAY });
    });
    act(() => {
      result.current.setPaySchedule({ cadence: "semimonthly", daysOfMonth: [15, 31] });
    });
    act(() => {
      result.current.setPaySchedule({ cadence: "biweekly" });
    });

    expect(result.current.schedule.lastPaidOn).toBe(TODAY);
    expect(result.current.schedule.daysOfMonth).toEqual([15, 31]);
  });
});

describe("reconciliation", () => {
  test("an account saved before the field existed has never been reconciled", () => {
    seed({ accounts: [{ id: "acc1", name: "Everyday", type: "asset", assetClass: "Cash" }] });

    const { result } = renderHook(() => useAccounts(), { wrapper });

    expect(result.current.accounts[0].reconciledOn).toBeNull();
  });

  test("marking one reconciled stamps today and leaves the rest alone", () => {
    seed({ accounts: [ACCOUNT, { ...ACCOUNT, id: "acc2", name: "Savings" }] });

    const { result } = renderHook(() => useAccounts(), { wrapper });
    act(() => {
      result.current.reconcileAccount({ id: "acc1" });
    });

    const [everyday, savings] = result.current.accounts;
    expect(everyday.reconciledOn).toBe(TODAY);
    expect(everyday.name).toBe("Everyday");
    expect(savings.reconciledOn).toBeNull();
  });

  test("a reconciliation entered by mistake can be taken back off", () => {
    seed({ accounts: [{ ...ACCOUNT, reconciledOn: TODAY }] });

    const { result } = renderHook(() => useAccounts(), { wrapper });
    act(() => {
      result.current.reconcileAccount({ id: "acc1", date: null });
    });

    expect(result.current.accounts[0].reconciledOn).toBeNull();
  });

  test("editing an account elsewhere does not clear its reconciliation", () => {
    seed({ accounts: [{ ...ACCOUNT, reconciledOn: TODAY }] });

    const { result } = renderHook(() => useAccounts(), { wrapper });
    act(() => {
      result.current.updateAccount({ id: "acc1", name: "Everyday checking" });
    });

    expect(result.current.accounts[0].reconciledOn).toBe(TODAY);
  });
});
