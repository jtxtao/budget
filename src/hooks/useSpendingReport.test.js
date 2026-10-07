import { renderHook } from "@testing-library/react";
import AppProviders from "../contexts/AppProviders";
import { TRANSACTION_KINDS } from "../contexts/TransactionsContext";
import useSpendingReport from "./useSpendingReport";
import { addMonths, currentPeriod, toPeriod } from "../utils";

/**
 * The report reads across the ledger and the plan, so these drive it through the
 * real providers with JSON in storage — the same way the rest of the cross-store
 * hooks are tested, and for the same reason: the migrations and the provider
 * order are part of what is under test.
 *
 * Every period here is written out rather than derived from today, because a
 * report is a statement about particular months and a test whose window slides
 * with the calendar cannot say which months it meant. The two exceptions are the
 * custom window's coverage pair, where what is under test *is* the line between
 * months that have happened and months that have not — a fact about now, which a
 * fixed date cannot express.
 */
const wrapper = ({ children }) => <AppProviders>{children}</AppProviders>;

beforeEach(() => {
  localStorage.clear();
});

const END = "2026-08";

const ACCOUNT = {
  id: "acc1",
  name: "Everyday",
  type: "asset",
  scope: "on-budget",
  assetClass: "Cash",
  openingBalanceCents: 0,
  openingDate: null,
};

function seed({ accounts = [ACCOUNT], groups, budgets, transactions } = {}) {
  const write = (key, value) => value && localStorage.setItem(key, JSON.stringify(value));
  write("accounts", accounts);
  write("budgetGroups", groups);
  write("budgets", budgets);
  write("transactions", transactions);
}

const budget = (id, name, groupId = null, plannedCents = 0) => ({
  id,
  name,
  groupId,
  plannedCents,
  goalCents: null,
  bucket: null,
});

let sequence = 0;
const ledger = (kind) => (date, amountCents, budgetId = null) => ({
  id: `t${(sequence += 1)}`,
  kind,
  accountId: ACCOUNT.id,
  budgetId,
  amountCents,
  date,
});
const out = ledger(TRANSACTION_KINDS.OUTFLOW);
const inn = ledger(TRANSACTION_KINDS.INFLOW);

const read = (range = "12m", period = END, chosenStart = null) =>
  renderHook(() => useSpendingReport(period, range, chosenStart), { wrapper }).result.current;

/** The identity's right-hand side, computed straight off the seed: cash that
 *  actually moved in the window, with no notion of income or refunds in it.
 *
 *  A transfer is not cash moving in or out of the household, so it is not on this
 *  side either — with the one exception the report itself makes, money leaving the
 *  budget for a holding, which the plan allocates and the report counts as
 *  spending. `offBudgetIds` is what tells the two apart, and it is spelled out
 *  here rather than read off `budgetLegs` so the tripwire is not checking the code
 *  under test against itself. */
const cashMoved = (transactions, months, offBudgetIds = []) => {
  const off = new Set(offBudgetIds);
  return transactions
    .filter((transaction) => months.includes(toPeriod(transaction.date)))
    .reduce((sum, transaction) => {
      if (transaction.kind === TRANSACTION_KINDS.TRANSFER) {
        const leaves = !off.has(transaction.accountId) && off.has(transaction.toAccountId);
        return leaves ? sum - transaction.amountCents : sum;
      }
      return (
        sum +
        (transaction.kind === TRANSACTION_KINDS.INFLOW
          ? transaction.amountCents
          : -transaction.amountCents)
      );
    }, 0);
};

describe("the window", () => {
  test("a range resolves to whole months, oldest first, ending at the month asked for", () => {
    seed({ budgets: [budget("b1", "Rent")] });

    expect(read("3m").months).toEqual(["2026-06", "2026-07", "2026-08"]);
    expect(read("12m").months).toHaveLength(12);
    expect(read("12m").months[0]).toBe("2025-09");
    // The year so far, not the last twelve months — which is the range beside
    // it, and the reason both exist.
    expect(read("ytd").months[0]).toBe("2026-01");
    expect(read("ytd").months).toHaveLength(8);
  });

  test("all time starts at the first record on the books, not at the first category", () => {
    seed({
      budgets: [budget("b1", "Rent")],
      transactions: [out("2024-11-03", 100000, "b1"), out("2026-08-01", 50000, "b1")],
    });

    const report = read("all");

    expect(report.startPeriod).toBe("2024-11");
    expect(report.months).toHaveLength(22);
  });

  test("a ledger with nothing datable still gives a window rather than an empty one", () => {
    // "All time" over a ledger of undated records has no first month to reach
    // back to. An empty month list would divide every per-month figure by
    // nothing, so the window falls back to the end month itself.
    seed({ budgets: [budget("b1", "Rent")], transactions: [out(null, 100000, "b1")] });

    const report = read("all");

    expect(report.months).toEqual([END]);
    expect(report.averagedOverMonths).toBe(1);
  });

  test("a custom window is the two months it names, both ends included", () => {
    seed({
      budgets: [budget("b1", "Rent")],
      transactions: [
        out("2025-12-01", 100000, "b1"), // the month before the window
        out("2026-01-04", 70000, "b1"),
        out("2026-02-09", 30000, "b1"),
        out("2026-03-01", 900000, "b1"), // the month after it
      ],
    });

    const report = read("custom", "2026-02", "2026-01");

    expect(report.months).toEqual(["2026-01", "2026-02"]);
    expect(report.netSpentCents).toBe(100000);
    // Named by the months themselves: "Custom" says nothing about which window
    // it is, and this string is what the summary prints.
    expect(report.range.name).toBe("January 2026 to February 2026");
  });

  test("a custom window of one month names itself rather than repeating the month", () => {
    seed({ budgets: [budget("b1", "Rent")] });

    const report = read("custom", "2026-02", "2026-02");

    expect(report.months).toEqual(["2026-02"]);
    expect(report.range.name).toBe("February 2026");
  });

  test("a custom window typed backwards falls back to its end month rather than inverting", () => {
    seed({ budgets: [budget("b1", "Rent")] });

    // The fields on the page bound each other, so this is the backstop rather
    // than the path — but an empty month list would divide every per-month
    // figure by nothing.
    expect(read("custom", "2026-02", "2026-06").months).toEqual(["2026-02"]);
  });

  test("months that have not happened are in the window and out of the divisor", () => {
    // The one window in this file that has to be relative to the clock: what is
    // under test *is* the boundary between months that have happened and months
    // that have not, which a fixed date cannot express.
    const now = currentPeriod();
    seed({
      budgets: [budget("b1", "Rent")],
      transactions: [out(`${now}-02`, 30000, "b1")],
    });

    const report = read("custom", addMonths(now, 2), now);

    expect(report.months).toHaveLength(3);
    // Three columns drawn, one month of books. Dividing the $300 by three would
    // report $100 a month on a household that has spent $300 this month, and a
    // report nobody can check against a bank statement is worse than no report.
    expect(report.averagedOverMonths).toBe(1);
    expect(report.coveredMonths).toBe(1);
    expect(report.coverageStartPeriod).toBe(now);
    expect(report.coverageEndPeriod).toBe(now);
    expect(report.averageSpendCents).toBe(30000);
  });

  test("a window made entirely of months to come covers nothing, and says so as zero", () => {
    const ahead = addMonths(currentPeriod(), 3);
    seed({ budgets: [budget("b1", "Rent")] });

    const report = read("custom", addMonths(ahead, 1), ahead);

    expect(report.months).toHaveLength(2);
    // Zero is the honest count and the divisor still cannot be it — the page
    // reads the two apart, printing "none of these months has happened yet"
    // rather than a division nobody performed.
    expect(report.coveredMonths).toBe(0);
    expect(report.averagedOverMonths).toBe(1);
  });

  test("months outside the window contribute nothing to it", () => {
    seed({
      budgets: [budget("b1", "Rent")],
      transactions: [
        out("2026-02-01", 100000, "b1"), // before a 3-month window
        out("2026-07-01", 50000, "b1"), // inside it
        out("2026-11-01", 900000, "b1"), // dated past the end of the books
      ],
    });

    const report = read("3m");

    expect(report.netSpentCents).toBe(50000);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].netSpentCents).toBe(50000);
  });
});

describe("income, spending and what was left", () => {
  const transactions = [
    inn("2026-07-01", 500000),
    inn("2026-08-01", 500000),
    out("2026-07-05", 120000, "b1"),
    out("2026-08-06", 80000, "b1"),
    out("2026-08-07", 30000, "b2"),
    // A refund: money coming back to the category it left.
    inn("2026-08-09", 12000, "b2"),
  ];

  const setup = () =>
    seed({
      groups: [{ id: "g1", name: "Bills", bucket: "essentials" }],
      budgets: [budget("b1", "Rent", "g1", 100000), budget("b2", "Dining", null, 20000)],
      transactions,
    });

  test("the identity holds: net is every inflow less every outflow in the window", () => {
    setup();
    const report = read("3m");

    // The tripwire. Both sides count the refund exactly once and by different
    // routes — the left through the category it went back to, the right as the
    // cash it plainly is. Netting it off spending *and* adding it to income
    // would create money; doing neither would lose it.
    expect(report.netCents).toBe(cashMoved(transactions, report.months));
    expect(report.netCents).toBe(report.totalIncomeCents - report.netSpentCents);
  });

  test("a refund nets off its category and is not counted as income", () => {
    setup();
    const report = read("3m");

    expect(report.totalIncomeCents).toBe(1000000);
    // $300 out on dining, $120 back: dining cost $180.
    const dining = report.rows.find((row) => row.name === "Dining");
    expect(dining.spentCents).toBe(30000);
    expect(dining.refundCents).toBe(12000);
    expect(dining.netSpentCents).toBe(18000);
    // Gross and net are both reported, and the totals keep them apart.
    expect(report.totalSpentCents).toBe(230000);
    expect(report.totalRefundCents).toBe(12000);
    expect(report.netSpentCents).toBe(218000);
  });

  test("the savings rate is a share of income, and a dash where there is none", () => {
    setup();
    // $1,000,000 in, $218,000 out: $782,000 kept, which is 78.2%.
    expect(read("3m").savingsRateBps).toBe(7820);

    localStorage.clear();
    seed({
      budgets: [budget("b1", "Rent")],
      transactions: [out("2026-08-01", 50000, "b1")],
    });
    // Spending with no recorded income is not a savings rate of minus
    // infinity — it is a window with nothing to be a share of.
    expect(read("3m").savingsRateBps).toBeNull();
  });

  test("a month is a row of its own, and the months add up to the totals", () => {
    setup();
    const report = read("3m");

    expect(report.series.map((month) => month.period)).toEqual(report.months);
    const july = report.series.find((month) => month.period === "2026-07");
    expect(july).toMatchObject({
      incomeCents: 500000,
      spentCents: 120000,
      refundCents: 0,
      netSpentCents: 120000,
      netCents: 380000,
    });
    expect(report.series.reduce((sum, month) => sum + month.netCents, 0)).toBe(report.netCents);
  });
});

describe("undated records", () => {
  test("are in no month, and are counted so the page can say so", () => {
    const transactions = [
      out("2026-08-01", 50000, "b1"),
      out(null, 70000, "b1"),
      inn(null, 30000),
    ];
    seed({ budgets: [budget("b1", "Rent")], transactions });

    const report = read("3m");

    // Placing an undated record in a month would invent the history the books
    // deliberately refuse to invent, so it is left out and reported.
    expect(report.netSpentCents).toBe(50000);
    expect(report.totalIncomeCents).toBe(0);
    expect(report.undatedCount).toBe(2);
    expect(report.undatedSpentCents).toBe(70000);
    expect(report.undatedIncomeCents).toBe(30000);
    // Which keeps the identity true of what is on screen: it is an identity
    // about the window, and an undated record is not in it.
    expect(report.netCents).toBe(cashMoved(transactions, report.months));
  });
});

describe("the per-month average", () => {
  test("spreads a once-a-year cost across the whole window, not across the month it fell in", () => {
    seed({
      budgets: [budget("b1", "Insurance", null, 10000)],
      transactions: [
        out("2025-09-01", 1200, "b1"), // opens the books a year back
        out("2026-03-11", 120000, "b1"),
      ],
    });

    const report = read("12m");
    const row = report.rows[0];

    expect(report.averagedOverMonths).toBe(12);
    expect(row.netSpentCents).toBe(121200);
    expect(row.averageCents).toBe(10100);
    // The count is what tells a reader the average is a lump rather than a
    // rate — the same figure means different things at 2 of 12 and at 12 of 12.
    expect(row.monthsWithSpend).toBe(2);
  });

  test("divides by the months the books cover, not by the months asked for", () => {
    seed({
      budgets: [budget("b1", "Rent")],
      transactions: [out("2026-07-01", 100000, "b1"), out("2026-08-01", 100000, "b1")],
    });

    const report = read("12m");

    // Two months of records over a twelve-month window. Dividing by twelve
    // would report $16,667 a month on a household spending $100,000, and would
    // do it silently.
    expect(report.averagedOverMonths).toBe(2);
    expect(report.coverageStartPeriod).toBe("2026-07");
    expect(report.rows[0].averageCents).toBe(100000);
    expect(report.averageSpendCents).toBe(100000);
  });
});

describe("the category ranking", () => {
  test("is by what was spent, biggest first, with each row's heading on it", () => {
    seed({
      groups: [{ id: "g1", name: "Bills", bucket: "essentials" }],
      budgets: [
        // Deliberately arranged smallest-first on the plan, so the ranking
        // cannot be the plan's order by accident.
        budget("b1", "Dining", null, 20000),
        budget("b2", "Rent", "g1", 100000),
      ],
      transactions: [
        out("2026-08-01", 30000, "b1"),
        out("2026-08-02", 150000, "b2"),
        out("2026-08-03", 4000, null), // no category at all
        out("2026-08-04", 9000, "gone"), // a category since deleted
      ],
    });

    const report = read("3m");

    expect(report.rows.map((row) => row.name)).toEqual([
      "Rent",
      "Dining",
      "Unknown category",
      "Uncategorized",
    ]);
    expect(report.rows[0]).toMatchObject({
      groupName: "Bills",
      bucket: "essentials",
      targetCents: 100000,
      shareBps: 7772, // 150,000 of 193,000
    });
    // A category filed under nothing says so rather than being given a heading
    // it does not have.
    expect(report.rows[2].groupName).toBeNull();
    // No estimate set is not an estimate of zero.
    expect(report.rows[1].targetCents).toBe(20000);
    expect(report.rows[3].targetCents).toBeNull();
  });

  test("a category with nothing against it is not a row", () => {
    seed({
      budgets: [budget("b1", "Rent", null, 100000), budget("b2", "Unused", null, 5000)],
      transactions: [out("2026-08-01", 30000, "b1")],
    });

    expect(read("3m").rows.map((row) => row.name)).toEqual(["Rent"]);
  });

  test("the buckets add up to the spending above them, catch-alls included", () => {
    seed({
      groups: [
        { id: "g1", name: "Bills", bucket: "essentials" },
        { id: "g2", name: "Treats", bucket: "fun" },
      ],
      budgets: [budget("b1", "Rent", "g1"), budget("b2", "Dining", "g2")],
      transactions: [
        out("2026-08-01", 150000, "b1"),
        out("2026-08-02", 50000, "b2"),
        out("2026-08-03", 10000, null),
      ],
    });

    const report = read("3m");

    expect(report.buckets.map((entry) => [entry.label, entry.netSpentCents])).toEqual([
      ["Essentials", 150000],
      ["Fun", 50000],
      ["No category", 10000],
    ]);
    // The split describes the same household as the headline does, or it is
    // describing a smaller one.
    expect(report.buckets.reduce((sum, entry) => sum + entry.netSpentCents, 0)).toBe(
      report.netSpentCents
    );
    // Savings had nothing in it, so it is not a segment of nothing.
    expect(report.buckets.map((entry) => entry.label)).not.toContain("Savings");
  });
});

describe("the plan, drawn against the books", () => {
  const groups = [
    { id: "g1", name: "Bills", bucket: "essentials" },
    { id: "g2", name: "Treats", bucket: "fun" },
  ];

  test("every month carries the same fixed list of buckets, including the empty ones", () => {
    // A stacked column colours a segment by its position, so a list that
    // dropped its empty entries would hand the same index to different buckets
    // in different months.
    seed({
      groups,
      budgets: [budget("b1", "Rent", "g1"), budget("b2", "Dining", "g2")],
      transactions: [out("2026-08-01", 150000, "b1"), out("2026-07-02", 50000, "b2")],
    });

    const report = read("3m");
    const keys = ["essentials", "fun", "savings", "retirement", "unfiled"];

    for (const month of report.series) {
      expect(month.buckets.map((entry) => entry.key)).toEqual(keys);
    }

    const [june, july, august] = report.series;
    expect(june.buckets.map((entry) => entry.netSpentCents)).toEqual([0, 0, 0, 0, 0]);
    expect(july.buckets[1].netSpentCents).toBe(50000);
    expect(august.buckets[0].netSpentCents).toBe(150000);
  });

  test("a month's buckets add up to that month's spending, which is what the column is drawn as", () => {
    seed({
      groups,
      budgets: [budget("b1", "Rent", "g1"), budget("b2", "Dining", "g2")],
      transactions: [
        out("2026-08-01", 150000, "b1"),
        out("2026-08-02", 50000, "b2"),
        out("2026-08-03", 10000, null),
      ],
    });

    const august = read("3m").series.at(-1);

    expect(august.buckets.reduce((sum, entry) => sum + entry.netSpentCents, 0)).toBe(
      august.netSpentCents
    );
  });

  test("a refund comes back off the bucket it was filed under, not off another one", () => {
    seed({
      groups,
      budgets: [budget("b1", "Rent", "g1"), budget("b2", "Dining", "g2")],
      transactions: [
        out("2026-08-01", 150000, "b1"),
        out("2026-08-02", 50000, "b2"),
        inn("2026-08-03", 20000, "b2"),
      ],
    });

    const august = read("3m").series.at(-1);

    expect(august.buckets[0].netSpentCents).toBe(150000);
    expect(august.buckets[1].netSpentCents).toBe(30000);
  });

  test("a bucket refunded more than it spent is negative, not clamped to zero", () => {
    // The household genuinely got money back out of it, and the chart draws a
    // figure on the side its own sign puts it.
    seed({
      groups,
      budgets: [budget("b1", "Rent", "g1"), budget("b2", "Dining", "g2")],
      transactions: [out("2026-08-01", 150000, "b1"), inn("2026-08-02", 20000, "b2")],
    });

    const august = read("3m").series.at(-1);

    expect(august.buckets[1].netSpentCents).toBe(-20000);
    expect(august.netSpentCents).toBe(130000);
  });

  test("the plan is every category's estimate, including the ones that spent nothing", () => {
    // An estimate for a category that was quiet all year is still part of what
    // the plan set aside; dropping it would make the plan appear to shrink in
    // exactly the months the household underspent.
    seed({
      groups,
      budgets: [
        budget("b1", "Rent", "g1", 150000),
        budget("b2", "Dining", "g2", 40000),
        budget("b3", "Vet", "g1", 10000),
      ],
      transactions: [out("2026-08-01", 150000, "b1")],
    });

    const report = read("3m");

    expect(report.plannedCents).toBe(200000);
    // Standing, so the same figure answers for every month in the window —
    // which is what makes it a threshold rather than a second series.
    for (const month of report.series) expect(month.plannedCents).toBe(200000);
  });

  test("the window's plan is the standing figure times the months the books cover", () => {
    // Not times the months asked for: a twelve-month window over three months
    // of records would otherwise be held against a year of plan. Same divisor
    // the per-month average uses.
    seed({
      groups,
      budgets: [budget("b1", "Rent", "g1", 100000)],
      transactions: [out("2026-07-01", 90000, "b1"), out("2026-08-01", 95000, "b1")],
    });

    const report = read("12m");

    expect(report.averagedOverMonths).toBe(2);
    expect(report.plannedWindowCents).toBe(200000);
  });

  test("a bucket carries what the plan sets aside for it, and the unfiled segment carries none", () => {
    seed({
      groups,
      budgets: [budget("b1", "Rent", "g1", 150000), budget("b2", "Dining", "g2", 40000)],
      transactions: [out("2026-08-01", 150000, "b1"), out("2026-08-02", 10000, null)],
    });

    const report = read("3m");
    const byLabel = new Map(report.buckets.map((entry) => [entry.label, entry]));

    expect(byLabel.get("Essentials").plannedCents).toBe(150000);
    // Nothing was spent on Fun, so it is not a segment — but the estimate
    // against it is still in the plan's total above.
    expect(byLabel.has("Fun")).toBe(false);
    expect(report.plannedCents).toBe(190000);
    // Null rather than zero: there is no estimate for "no category", and a zero
    // would read as a plan to spend nothing on it.
    expect(byLabel.get("No category").plannedCents).toBeNull();
  });

  test("no estimates anywhere is a plan of zero, which the chart reads as no plan at all", () => {
    seed({
      groups,
      budgets: [budget("b1", "Rent", "g1")],
      transactions: [out("2026-08-01", 150000, "b1")],
    });

    expect(read("3m").plannedCents).toBe(0);
  });
});

describe("transfers", () => {
  const CARD = {
    id: "card1",
    name: "Visa",
    type: "liability",
    scope: "credit-card",
    assetClass: "Other",
    openingBalanceCents: 0,
    openingDate: null,
  };
  const HOLDING = {
    id: "acc401k",
    name: "401(k)",
    type: "asset",
    scope: "off-budget",
    assetClass: "Stocks",
    openingBalanceCents: 0,
    openingDate: null,
  };

  const move = (date, amountCents, accountId, toAccountId, budgetId = null) => ({
    id: `x${(sequence += 1)}`,
    kind: TRANSACTION_KINDS.TRANSFER,
    accountId,
    toAccountId,
    budgetId,
    amountCents,
    date,
  });

  test("a transfer between two accounts the budget spends through is in no report", () => {
    const transactions = [
      out("2026-08-02", 5000, "b1"),
      move("2026-08-10", 20000, ACCOUNT.id, CARD.id),
    ];
    seed({ accounts: [ACCOUNT, CARD], budgets: [budget("b1", "Groceries")], transactions });

    const report = read("3m");

    // Paying a card off is not spending. Counted anywhere here it would report
    // the household as having spent that money twice — once on the card and once
    // to settle it.
    expect(report.totalSpentCents).toBe(5000);
    expect(report.totalIncomeCents).toBe(0);
    expect(report.rows).toHaveLength(1);
    expect(report.undatedCount).toBe(0);
    const august = report.series.find((month) => month.period === "2026-08");
    expect(august.spentCents).toBe(5000);
  });

  test("a transfer out of the budget is spending against its category", () => {
    const transactions = [move("2026-08-10", 20000, ACCOUNT.id, HOLDING.id, "b1")];
    seed({
      accounts: [ACCOUNT, HOLDING],
      budgets: [budget("b1", "Retirement")],
      transactions,
    });

    const report = read("3m");

    // The same reading the categorised outflow it replaces got, which is what
    // keeps the bucket split comparable with the plan's own.
    expect(report.totalSpentCents).toBe(20000);
    expect(report.netSpentCents).toBe(20000);
    const row = report.rows.find((entry) => entry.budgetId === "b1");
    expect(row.netSpentCents).toBe(20000);
    // And it is on the drill-in list, so the figure can be traced to the record
    // that made it, the same as any other row.
    expect(row.transactions).toHaveLength(1);
    expect(row.transactions[0].kind).toBe(TRANSACTION_KINDS.TRANSFER);
  });

  test("a transfer into the budget is not income the household earned", () => {
    const transactions = [
      move("2026-08-10", 500000, HOLDING.id, ACCOUNT.id),
      out("2026-08-12", 500000, "b1"),
      inn("2026-08-01", 400000),
    ];
    seed({ accounts: [ACCOUNT, HOLDING], budgets: [budget("b1", "Home")], transactions });

    const report = read("3m");

    // `useEnvelopes` puts the withdrawal in "to be assigned", because it is money
    // that can now be spent. A report of what the household earned is a different
    // question, and the answer this one gives is the month the household really
    // had: $4,000 earned against $5,000 spent on the roof, so a thousand down —
    // which is what its net worth did. Counted as income it would read as four
    // thousand up in the month it got poorer.
    expect(report.totalIncomeCents).toBe(400000);
    expect(report.totalSpentCents).toBe(500000);
    expect(report.netCents).toBe(-100000);
    expect(report.netCents).toBe(cashMoved(transactions, report.months, [HOLDING.id]));
  });

  test("the identity holds with transfers in the window", () => {
    const transactions = [
      inn("2026-07-01", 300000),
      out("2026-07-04", 40000, "b1"),
      // Inside the budget: on neither side of the identity.
      move("2026-07-10", 20000, ACCOUNT.id, CARD.id),
      // Out of the budget: spending, on both sides.
      move("2026-08-10", 50000, ACCOUNT.id, HOLDING.id, "b1"),
      // Into the budget: on neither side, which is what keeps the two halves of
      // this test agreeing about a month that was not a month of earnings.
      move("2026-08-20", 90000, HOLDING.id, ACCOUNT.id),
    ];
    seed({
      accounts: [ACCOUNT, CARD, HOLDING],
      budgets: [budget("b1", "Retirement")],
      transactions,
    });

    const report = read("3m");
    expect(report.netCents).toBe(cashMoved(transactions, report.months, [HOLDING.id]));
  });

  test("an undated transfer inside the budget is not even counted as missing", () => {
    const transactions = [
      { ...move("2026-08-10", 20000, ACCOUNT.id, CARD.id), date: null },
      { ...out("2026-08-02", 5000, "b1"), date: null },
    ];
    seed({ accounts: [ACCOUNT, CARD], budgets: [budget("b1", "Groceries")], transactions });

    const report = read("3m");

    // Only the outflow is money the report is missing a month for. A transfer that
    // moves no budget money would not have been in the chart even with a date, so
    // saying it is missing from one would be saying nothing.
    expect(report.undatedCount).toBe(1);
    expect(report.undatedSpentCents).toBe(5000);
  });
});

describe("a receipt divided between categories", () => {
  // $124 at the supermarket: groceries, a light bulb and a birthday card. One
  // movement of money, three places it went.
  const divided = (date, amountCents, parts, fields = {}) => ({
    id: `d${(sequence += 1)}`,
    kind: TRANSACTION_KINDS.OUTFLOW,
    accountId: ACCOUNT.id,
    budgetId: null,
    amountCents,
    date,
    splits: parts.map(([budgetId, cents], index) => ({
      id: `p${index}`,
      budgetId,
      amountCents: cents,
    })),
    ...fields,
  });

  const BUDGETS = [
    budget("b1", "Groceries"),
    budget("b2", "Household"),
    budget("b3", "Gifts"),
  ];

  test("the ranking is by where the money went, not by which receipt it arrived on", () => {
    const transactions = [
      divided("2026-08-04", 12400, [
        ["b1", 9000],
        ["b2", 2000],
        ["b3", 1400],
      ]),
      out("2026-08-06", 3000, "b3"),
    ];
    seed({ budgets: BUDGETS, transactions });

    const report = read("3m");
    const rowFor = (id) => report.rows.find((row) => row.budgetId === id);

    expect(rowFor("b1").netSpentCents).toBe(9000);
    expect(rowFor("b2").netSpentCents).toBe(2000);
    // Its own part plus the outflow beside it — the point of dividing a receipt
    // is that the categories add up across every record that touched them.
    expect(rowFor("b3").netSpentCents).toBe(4400);
    expect(report.totalSpentCents).toBe(15400);
    // And the whole is still what the household spent: the identity is computed
    // off the seed with no notion of parts in it.
    expect(report.netCents).toBe(cashMoved(transactions, report.months));
  });

  test("the drill-in shows the part and names the whole it came out of", () => {
    seed({
      budgets: BUDGETS,
      transactions: [
        divided("2026-08-04", 12400, [
          ["b1", 9000],
          ["b2", 3400],
        ]),
        out("2026-08-06", 3000, "b1"),
      ],
    });

    const report = read("3m");
    const rows = report.rows.find((row) => row.budgetId === "b1").transactions;

    // The figure has to be the part or the rows would not add up to the total
    // above them; the whole travels beside it so the line does not read as a
    // disagreement with the register.
    expect(rows.map((row) => [row.amountCents, row.wholeAmountCents])).toEqual([
      [3000, null],
      [9000, 12400],
    ]);
  });

  test("an undated division is one record the report could not place, not three", () => {
    seed({
      budgets: BUDGETS,
      transactions: [
        divided(null, 12400, [
          ["b1", 9000],
          ["b2", 3400],
        ]),
      ],
    });

    const report = read("3m");

    // Counted once — it is one row on the register — but every cent of it is
    // reported as missing, or the figure the page prints would understate what
    // the chart is leaving out.
    expect(report.undatedCount).toBe(1);
    expect(report.undatedSpentCents).toBe(12400);
    expect(report.totalSpentCents).toBe(0);
  });

  test("the parts are filed into their own buckets, not the receipt's", () => {
    seed({
      budgets: [
        { ...budget("b1", "Groceries"), bucket: "essentials" },
        { ...budget("b3", "Gifts"), bucket: "fun" },
      ],
      transactions: [
        divided("2026-08-04", 10000, [
          ["b1", 7000],
          ["b3", 3000],
        ]),
      ],
    });

    const report = read("3m");
    const share = (bucket) => report.buckets.find((entry) => entry.bucket === bucket);

    // This is the comparison the split exists for: a household that files the
    // whole shop under essentials cannot see what it actually spends on wants.
    expect(share("essentials").netSpentCents).toBe(7000);
    expect(share("fun").netSpentCents).toBe(3000);
  });
});
