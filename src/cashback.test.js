import { cashbackCents, cashbackFor } from "./cashback";

const CARD = { id: "card", cashbackBps: 100 };
const purchase = (fields) => ({
  kind: "outflow",
  amountCents: 10000,
  date: "2026-10-08",
  accountId: "card",
  budgetId: "food",
  splits: null,
  ...fields,
});

describe("cash back", () => {
  test("rounds to the nearest cent per purchase", () => {
    expect(cashbackCents(10000, 100)).toBe(100);
    expect(cashbackCents(1250, 100)).toBe(13);
    expect(cashbackCents(1249, 100)).toBe(12);
    expect(cashbackCents(10000, null)).toBe(0);
  });

  test("is a refund to the purchase's category, on the same account and day", () => {
    expect(cashbackFor(CARD, purchase(), "Safeway")).toEqual({
      kind: "inflow",
      payeeId: null,
      description: "1% cash back on $100 at Safeway",
      amountCents: 100,
      date: "2026-10-08",
      accountId: "card",
      budgetId: "food",
      splits: null,
    });
  });

  test("is nothing on an account with no rate, on money in, and under a cent", () => {
    expect(cashbackFor({ id: "card" }, purchase())).toBeNull();
    expect(cashbackFor(CARD, purchase({ kind: "inflow" }))).toBeNull();
    expect(cashbackFor(CARD, purchase({ kind: "transfer" }))).toBeNull();
    expect(cashbackFor(CARD, purchase({ amountCents: 40 }))).toBeNull();
  });

  test("divides like the receipt, adding up exactly", () => {
    const refund = cashbackFor(
      CARD,
      purchase({
        amountCents: 10050,
        budgetId: null,
        splits: [
          { budgetId: "food", amountCents: 3350 },
          { budgetId: "home", amountCents: 3350 },
          { budgetId: "fun", amountCents: 3350 },
        ],
      })
    );
    expect(refund.amountCents).toBe(101);
    expect(refund.splits.reduce((sum, part) => sum + part.amountCents, 0)).toBe(101);
  });

  test("a division left with one earning part is that part's category", () => {
    const refund = cashbackFor(
      CARD,
      purchase({
        amountCents: 10040,
        budgetId: null,
        splits: [
          { budgetId: "food", amountCents: 10000 },
          { budgetId: "gum", amountCents: 40 },
        ],
      })
    );
    expect(refund).toMatchObject({ amountCents: 100, budgetId: "food", splits: null });
  });
});
