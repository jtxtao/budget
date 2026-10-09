import { act, renderHook } from "@testing-library/react";
import AppProviders from "../contexts/AppProviders";
import { useDonations } from "../contexts/DonationsContext";
import { TRANSACTION_KINDS, useTransactions } from "../contexts/TransactionsContext";
import useGiving from "./useGiving";

/**
 * Giving joins a store of statements to the ledger those statements are about,
 * so these drive it through the real providers with JSON in storage — the same
 * way every cross-store hook here is tested, and for the same reason: the
 * migrations, the provider order and the delete cascade are part of what is
 * under test.
 *
 * Every date is written out rather than derived from today. The subject is a
 * particular year, and a fixture that slid with the calendar could not say which
 * year it meant.
 */
const wrapper = ({ children }) => <AppProviders>{children}</AppProviders>;

const YEAR = "2026";

const ACCOUNT = {
  id: "acc1",
  name: "Everyday",
  type: "asset",
  scope: "on-budget",
  assetClass: "Cash",
  openingBalanceCents: 0,
  openingDate: null,
  reconciledOn: null,
};

const BUDGET = {
  id: "b1",
  name: "Giving",
  groupId: null,
  plannedCents: 50000,
  goalCents: null,
  bucket: "fun",
};

let sequence = 0;
const ledger = (kind) => (date, amountCents) => ({
  id: `t${(sequence += 1)}`,
  kind,
  description: "gift",
  accountId: ACCOUNT.id,
  budgetId: BUDGET.id,
  amountCents,
  date,
});
const out = ledger(TRANSACTION_KINDS.OUTFLOW);
const inn = ledger(TRANSACTION_KINDS.INFLOW);

/** Income is an inflow naming no category — the same definition the spending
 *  report uses, and what a share-of-income goal is a share of. */
const income = (date, amountCents) => ({
  id: `t${(sequence += 1)}`,
  kind: TRANSACTION_KINDS.INFLOW,
  description: "pay",
  accountId: ACCOUNT.id,
  budgetId: null,
  amountCents,
  date,
});

const RED_CROSS = { id: "r1", name: "Red Cross", deductible: true };
const RAFFLE = { id: "r2", name: "School raffle", deductible: false };

const tag = (transactionId, recipientId, deductibleCents, acknowledged = false) => ({
  transactionId,
  recipientId,
  deductibleCents,
  acknowledged,
});

function seed({
  accounts = [ACCOUNT],
  budgets = [BUDGET],
  transactions = [],
  recipients = [RED_CROSS],
  donations = [],
  goals,
  // No giving categories unless a test asks for them: most of this suite is
  // about the tag, and the fixture's one category is named "Giving", which
  // would otherwise be read as a gift without one.
  givingSettings = { budgetIds: [], excludedIds: [] },
} = {}) {
  const write = (key, value) => value && localStorage.setItem(key, JSON.stringify(value));
  write("accounts", accounts);
  write("budgets", budgets);
  write("transactions", transactions);
  write("donationRecipients", recipients);
  write("donations", donations);
  write("donationGoals", goals);
  write("givingSettings", givingSettings);
  // Seeding the ledger fires the day-one assignment seed; an empty assignments
  // key keeps that out of the way of what these tests are about.
  write("assignments", []);
}

const read = (year = YEAR) => renderHook(() => useGiving(year), { wrapper }).result.current;

/** The hook and the two stores that write to it, in one render, so a mutation
 *  and the figures it moves can be read in the same act. */
const live = (year = YEAR) =>
  renderHook(
    () => ({ giving: useGiving(year), donations: useDonations(), ledger: useTransactions() }),
    { wrapper }
  ).result;

beforeEach(() => {
  localStorage.clear();
});

describe("the join between a tag and the money it describes", () => {
  test("an untagged outflow is not giving, however it is filed", () => {
    const gift = out("2026-03-04", 20000);
    const groceries = out("2026-03-05", 8000);
    seed({ transactions: [gift, groceries], donations: [tag(gift.id, RED_CROSS.id, 20000)] });

    const giving = read();
    expect(giving.giftCount).toBe(1);
    expect(giving.totalCents).toBe(20000);
  });

  test("the row carries the ledger's figures, not a second copy of them", () => {
    const gift = out("2026-03-04", 20000);
    seed({ transactions: [gift], donations: [tag(gift.id, RED_CROSS.id, 20000)] });

    const [row] = read().rows;
    expect(row).toMatchObject({
      transactionId: gift.id,
      date: "2026-03-04",
      description: "gift",
      amountCents: 20000,
      deductibleCents: 20000,
      recipientName: "Red Cross",
    });
  });

  test("a tag whose transaction is gone counts towards nothing", () => {
    seed({ transactions: [], donations: [tag("missing", RED_CROSS.id, 20000)] });

    const giving = read();
    expect(giving.giftCount).toBe(0);
    expect(giving.totalCents).toBe(0);
  });

  test("deleting the transaction takes the tag with it", () => {
    const gift = out("2026-03-04", 20000);
    seed({ transactions: [gift], donations: [tag(gift.id, RED_CROSS.id, 20000)] });

    const result = live();
    expect(result.current.giving.giftCount).toBe(1);

    act(() => {
      result.current.ledger.deleteTransaction({ id: gift.id });
    });

    expect(result.current.giving.giftCount).toBe(0);
    // Not merely hidden by the join: the record itself is gone, so a
    // transaction id can never be described by a statement about another one.
    expect(result.current.donations.donations).toHaveLength(0);
  });

  test("untagging leaves the money on the register", () => {
    const gift = out("2026-03-04", 20000);
    seed({ transactions: [gift], donations: [tag(gift.id, RED_CROSS.id, 20000)] });

    const result = live();
    act(() => {
      result.current.donations.removeDonation({ transactionId: gift.id });
    });

    expect(result.current.giving.giftCount).toBe(0);
    // The gift was still an expense. Removing the statement about it must not
    // rewrite what left the account.
    expect(result.current.ledger.transactions).toHaveLength(1);
  });
});

describe("what can be claimed", () => {
  test("the deductible part is its own figure, not the amount given", () => {
    const gala = out("2026-05-01", 20000);
    const raffle = out("2026-05-02", 5000);
    seed({
      recipients: [RED_CROSS, RAFFLE],
      transactions: [gala, raffle],
      donations: [tag(gala.id, RED_CROSS.id, 12000), tag(raffle.id, RAFFLE.id, 0)],
    });

    const giving = read();
    expect(giving.totalCents).toBe(25000);
    // The $80 dinner inside the gala ticket, and a raffle ticket that buys a
    // chance rather than gives anything away.
    expect(giving.deductibleCents).toBe(12000);
    expect(giving.nonDeductibleCents).toBe(13000);
  });

  test("a deduction larger than the gift is clamped to it, and says so", () => {
    // The figure was right when it was entered and the amount was edited down on
    // the register afterwards. The claim follows the money; the row reports the
    // gap rather than the storage being quietly repaired.
    const gift = out("2026-05-01", 5000);
    seed({ transactions: [gift], donations: [tag(gift.id, RED_CROSS.id, 20000)] });

    const [row] = read().rows;
    expect(row.deductibleCents).toBe(5000);
    expect(row.statedDeductibleCents).toBe(20000);
    expect(row.clamped).toBe(true);
    expect(read().deductibleCents).toBe(5000);
  });

  test("a returned gift subtracts from both figures", () => {
    // Money coming back from the organization in the same year cannot be
    // claimed in it — the ledger's own refund rule, applied to the one thing a
    // refunded donation changes here.
    const gift = out("2026-05-01", 20000);
    const back = inn("2026-06-01", 5000);
    seed({
      transactions: [gift, back],
      donations: [tag(gift.id, RED_CROSS.id, 20000), tag(back.id, RED_CROSS.id, 5000)],
    });

    const giving = read();
    expect(giving.totalCents).toBe(15000);
    expect(giving.deductibleCents).toBe(15000);
    expect(giving.rows.find((row) => row.transactionId === back.id).returned).toBe(true);
  });

  test("a gift at the acknowledgment threshold with nothing noted is called out", () => {
    const big = out("2026-05-01", 25000);
    const bigger = out("2026-05-02", 40000);
    const small = out("2026-05-03", 24999);
    seed({
      transactions: [big, bigger, small],
      donations: [
        tag(big.id, RED_CROSS.id, 25000),
        // Already in hand, so not waiting on anything.
        tag(bigger.id, RED_CROSS.id, 40000, true),
        tag(small.id, RED_CROSS.id, 24999),
      ],
    });

    const giving = read();
    expect(giving.awaitingCount).toBe(1);
    expect(giving.awaitingCents).toBe(25000);
  });

  test("a gift claiming nothing is never waiting on a receipt", () => {
    const raffle = out("2026-05-01", 50000);
    seed({
      recipients: [RAFFLE],
      transactions: [raffle],
      donations: [tag(raffle.id, RAFFLE.id, 0)],
    });

    expect(read().awaitingCount).toBe(0);
  });
});

describe("the year as the axis", () => {
  test("another year's giving is in another year", () => {
    const last = out("2025-12-31", 10000);
    const this_ = out("2026-01-01", 20000);
    seed({
      transactions: [last, this_],
      donations: [tag(last.id, RED_CROSS.id, 10000), tag(this_.id, RED_CROSS.id, 20000)],
    });

    expect(read("2026").totalCents).toBe(20000);
    expect(read("2025").totalCents).toBe(10000);
    // Which year the books start in, whichever year is on screen.
    expect(read("2026").firstYear).toBe("2025");
  });

  test("an undated gift is in no year, and is counted rather than dropped", () => {
    const dated = out("2026-05-01", 20000);
    const undated = out(null, 7000);
    seed({
      transactions: [dated, undated],
      donations: [tag(dated.id, RED_CROSS.id, 20000), tag(undated.id, RED_CROSS.id, 7000)],
    });

    const giving = read();
    expect(giving.totalCents).toBe(20000);
    expect(giving.undatedCount).toBe(1);
    expect(giving.undatedTotalCents).toBe(7000);
  });
});

describe("organizations", () => {
  test("every organization is listed, including the ones given nothing this year", () => {
    const gift = out("2026-05-01", 20000);
    seed({
      recipients: [RED_CROSS, RAFFLE],
      transactions: [gift],
      donations: [tag(gift.id, RED_CROSS.id, 20000)],
    });

    const rows = read().byRecipient;
    expect(rows.map((row) => row.name)).toEqual(["Red Cross", "School raffle"]);
    expect(rows[0]).toMatchObject({ totalCents: 20000, deductibleCents: 20000, giftCount: 1 });
    expect(rows[1]).toMatchObject({ totalCents: 0, giftCount: 0 });
  });

  test("removing an organization keeps its gifts, in a bucket of their own", () => {
    const gift = out("2026-05-01", 20000);
    seed({ transactions: [gift], donations: [tag(gift.id, RED_CROSS.id, 20000)] });

    const result = live();
    act(() => {
      result.current.donations.deleteRecipient({ id: RED_CROSS.id });
    });

    // The giving happened, and what was given and claimed is the whole point of
    // keeping it. Only the name is gone.
    expect(result.current.giving.totalCents).toBe(20000);
    expect(result.current.giving.rows[0].recipientName).toBeNull();
    const unfiled = result.current.giving.byRecipient.find((row) => row.recipientId == null);
    expect(unfiled).toMatchObject({ totalCents: 20000, giftCount: 1 });
  });
});

describe("the goal", () => {
  test("a year with no goal has none, rather than a goal of nothing", () => {
    seed();
    expect(read().goal).toMatchObject({ stated: false, targetCents: null, progressBps: null });
  });

  test("a figure for the year is the target, and the distance to it is reported", () => {
    const gift = out("2026-05-01", 200000);
    seed({
      transactions: [gift],
      donations: [tag(gift.id, RED_CROSS.id, 200000)],
      goals: [{ year: YEAR, source: "amount", amountCents: 600000, shareBps: null }],
    });

    const { goal } = read();
    expect(goal).toMatchObject({
      stated: true,
      targetCents: 600000,
      remainingCents: 400000,
      // A third of the way there.
      progressBps: 3333,
    });
  });

  test("a share is a share of income recorded, so the target grows with the year", () => {
    const gift = out("2026-05-01", 200000);
    seed({
      transactions: [income("2026-01-31", 3000000), income("2026-02-28", 3000000), gift],
      donations: [tag(gift.id, RED_CROSS.id, 200000)],
      goals: [{ year: YEAR, source: "income-share", amountCents: 600000, shareBps: 1000 }],
    });

    const { goal, incomeCents, shareOfIncomeBps } = read();
    expect(incomeCents).toBe(6000000);
    // A tenth of what has actually come in — not of the figure typed against the
    // other source, which is kept and unused.
    expect(goal.targetCents).toBe(600000);
    expect(goal.amountCents).toBe(600000);
    expect(goal.remainingCents).toBe(400000);
    // What the year gave as a share of what it earned, which needs no goal at
    // all: $2,000 of $60,000.
    expect(shareOfIncomeBps).toBe(333);
  });

  test("a refund is not income, so it is not part of what a tenth is a tenth of", () => {
    seed({
      transactions: [income("2026-01-31", 3000000), inn("2026-02-01", 500000)],
      goals: [{ year: YEAR, source: "income-share", amountCents: null, shareBps: 1000 }],
    });

    // The inflow naming a category went back to that category. Giving a tenth of
    // a returned jacket is not what anybody means by a tenth of their income.
    expect(read().incomeCents).toBe(3000000);
    expect(read().goal.targetCents).toBe(300000);
  });

  test("switching between the two answers keeps the one switched away from", () => {
    seed({ goals: [{ year: YEAR, source: "amount", amountCents: 600000, shareBps: null }] });

    const result = live();
    act(() => {
      result.current.donations.setGivingGoal({ year: YEAR, share: "10%" });
    });
    act(() => {
      result.current.donations.setGivingGoal({ year: YEAR, source: "income-share" });
    });

    // Comparing the two is the whole point of the control, and a switch that
    // destroyed what it switched away from could only be used once.
    expect(result.current.giving.goal.amountCents).toBe(600000);
    expect(result.current.giving.goal.shareBps).toBe(1000);
  });

  test("a goal is refused rather than stored as junk, and blank takes it off", () => {
    seed();
    const result = live();

    let refused;
    act(() => {
      refused = result.current.donations.setGivingGoal({ year: YEAR, amount: "six thousand" });
    });
    expect(refused.ok).toBe(false);
    expect(result.current.giving.goal.stated).toBe(false);

    act(() => {
      result.current.donations.setGivingGoal({ year: YEAR, amount: "$6,000" });
    });
    expect(result.current.giving.goal.targetCents).toBe(600000);

    act(() => {
      result.current.donations.setGivingGoal({ year: YEAR, amount: "" });
    });
    expect(result.current.giving.goal.stated).toBe(false);
  });

  test("each year keeps its own goal", () => {
    seed({
      goals: [
        { year: "2025", source: "amount", amountCents: 400000, shareBps: null },
        { year: "2026", source: "amount", amountCents: 600000, shareBps: null },
      ],
    });

    expect(read("2025").goal.targetCents).toBe(400000);
    expect(read("2026").goal.targetCents).toBe(600000);
  });
});

describe("the store's own boundary", () => {
  test("a gift must name an organization and a deductible figure it can read", () => {
    const gift = out("2026-05-01", 20000);
    seed({ transactions: [gift], donations: [] });
    const result = live();

    let attempt;
    act(() => {
      attempt = result.current.donations.recordDonation({
        transactionId: gift.id,
        recipientId: "",
        deductibleCents: 20000,
      });
    });
    expect(attempt.ok).toBe(false);

    act(() => {
      attempt = result.current.donations.recordDonation({
        transactionId: gift.id,
        recipientId: RED_CROSS.id,
        deductible: "twenty dollars",
      });
    });
    expect(attempt.ok).toBe(false);
    expect(result.current.giving.giftCount).toBe(0);

    act(() => {
      attempt = result.current.donations.recordDonation({
        transactionId: gift.id,
        recipientId: RED_CROSS.id,
        deductible: "$200.00",
      });
    });
    expect(attempt.ok).toBe(true);
    expect(result.current.giving.deductibleCents).toBe(20000);
  });

  test("recording against a transaction already tagged replaces the statement", () => {
    const gift = out("2026-05-01", 20000);
    seed({
      recipients: [RED_CROSS, RAFFLE],
      transactions: [gift],
      donations: [tag(gift.id, RED_CROSS.id, 20000)],
    });
    const result = live();

    act(() => {
      result.current.donations.recordDonation({
        transactionId: gift.id,
        recipientId: RAFFLE.id,
        deductibleCents: 0,
      });
    });

    // One movement of money is one gift, so the second statement is the same
    // gift restated rather than a second one beside it.
    expect(result.current.giving.giftCount).toBe(1);
    expect(result.current.giving.totalCents).toBe(20000);
    expect(result.current.giving.rows[0].recipientName).toBe("School raffle");
  });

  test("two organizations may not share a name", () => {
    seed();
    const result = live();

    let attempt;
    act(() => {
      attempt = result.current.donations.addRecipient({ name: "  red cross " });
    });
    expect(attempt.ok).toBe(false);
    expect(result.current.donations.recipients).toHaveLength(1);
  });
});

describe("gifts read off a giving category", () => {
  const GUESS = { budgetIds: null, excludedIds: [] };

  test("spending under a category named like giving is a gift without a tag", () => {
    const gift = out("2026-03-04", 20000);
    seed({ transactions: [gift], givingSettings: GUESS });

    const giving = read();
    expect(giving.giftCount).toBe(1);
    expect(giving.totalCents).toBe(20000);
    expect(giving.deductibleCents).toBe(20000);
    expect(giving.rows[0]).toMatchObject({ transactionId: gift.id, auto: true, recipientId: null });
  });

  test("a category not named like giving needs choosing, and choosing it is enough", () => {
    const groceries = { ...BUDGET, id: "b2", name: "Groceries" };
    const shop = { ...out("2026-03-05", 8000), budgetId: "b2" };
    seed({ budgets: [BUDGET, groceries], transactions: [shop], givingSettings: GUESS });
    expect(read().giftCount).toBe(0);

    seed({
      budgets: [BUDGET, groceries],
      transactions: [shop],
      givingSettings: { budgetIds: ["b2"], excludedIds: [] },
    });
    expect(read().giftCount).toBe(1);
  });

  test("the organization is the one named like the payee, and its default applies", () => {
    const gift = { ...out("2026-03-04", 5000), payeeId: "p1" };
    seed({ transactions: [gift], recipients: [RED_CROSS, RAFFLE], givingSettings: GUESS });
    localStorage.setItem(
      "payees",
      JSON.stringify([{ id: "p1", name: "school raffle", defaultBudgetId: null }])
    );

    const [row] = read().rows;
    expect(row.recipientId).toBe(RAFFLE.id);
    expect(row.deductibleCents).toBe(0);
  });

  test("only the giving part of a divided receipt counts", () => {
    const groceries = { ...BUDGET, id: "b2", name: "Groceries" };
    const shop = {
      ...out("2026-03-05", 10000),
      budgetId: "b2",
      splits: [
        { id: "s1", budgetId: "b2", amountCents: 7000 },
        { id: "s2", budgetId: "b1", amountCents: 3000 },
      ],
    };
    seed({ budgets: [BUDGET, groceries], transactions: [shop], givingSettings: GUESS });

    expect(read().totalCents).toBe(3000);
  });

  test("a tag wins, and untagging one that was never tagged keeps it off", () => {
    const gift = out("2026-03-04", 20000);
    seed({
      transactions: [gift],
      donations: [tag(gift.id, RED_CROSS.id, 15000)],
      givingSettings: GUESS,
    });

    const result = live();
    expect(result.current.giving.giftCount).toBe(1);
    expect(result.current.giving.deductibleCents).toBe(15000);

    act(() => {
      result.current.donations.removeDonation({ transactionId: gift.id });
      result.current.donations.setGiftExcluded({ transactionId: gift.id, excluded: true });
    });
    expect(result.current.giving.giftCount).toBe(0);
    expect(result.current.ledger.transactions).toHaveLength(1);
  });
});
