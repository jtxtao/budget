import {
  CATALOG,
  OFFER_KINDS,
  OFFER_STATUS,
  nextOfferWindow,
  offerProgress,
  achievedValuePer100Cents,
  formatPointValue,
  pointsAfterTransfer,
  programById,
  resolvedValuePer100Cents,
  summariseRewards,
  toPoints,
  toValuePer100Cents,
  transferSources,
  valueOfPointsCents,
} from "./rewards";

const balance = (id, programId, points, holder = null) => ({ id, programId, points, holder, asOf: null });
const trip = (id, programId, points, extra = {}) => ({
  id,
  name: id,
  date: null,
  programId,
  points,
  taxesCents: 0,
  cashPriceCents: null,
  ...extra,
});

describe("the catalog", () => {
  test("every transfer names a program the catalog has", () => {
    for (const program of CATALOG) {
      for (const transfer of program.transfers) {
        expect(programById(transfer.to)).not.toBeNull();
        expect(transfer.ratio.every((part) => Number.isInteger(part) && part > 0)).toBe(true);
      }
    }
  });

  test("ids are unique and every value is whole cents per hundred points", () => {
    expect(new Set(CATALOG.map((p) => p.id)).size).toBe(CATALOG.length);
    for (const program of CATALOG) expect(Number.isInteger(program.valuePer100Cents)).toBe(true);
  });
});

describe("valuation", () => {
  test("a typed value beats the catalog's, and blank falls back to it", () => {
    expect(resolvedValuePer100Cents("united", {})).toBe(130);
    expect(resolvedValuePer100Cents("united", { united: 115 })).toBe(115);
    // Zero is a real answer: points somebody never intends to use.
    expect(resolvedValuePer100Cents("united", { united: 0 })).toBe(0);
  });

  test("a balance is valued in whole cents, rounded once", () => {
    expect(valueOfPointsCents(100000, 130)).toBe(130000);
    expect(valueOfPointsCents(333, 45)).toBe(150);
  });

  test("values are typed the way they are said", () => {
    expect(toValuePer100Cents("1.3")).toBe(130);
    expect(toValuePer100Cents("1.35¢")).toBe(135);
    expect(toValuePer100Cents("0.6 cents")).toBe(60);
    expect(toValuePer100Cents("lots")).toBeNull();
    expect(toValuePer100Cents("-1")).toBeNull();
    expect(formatPointValue(135)).toBe("1.35¢");
  });

  test("points take commas, and nothing that is not a whole number", () => {
    expect(toPoints("125,000")).toBe(125000);
    expect(toPoints("1.5")).toBeNull();
    expect(toPoints("twelve")).toBeNull();
  });
});

describe("redemptions", () => {
  test("value per point is the fare saved, net of the cash still paid, over the points", () => {
    // $1,200 fare, $80 of taxes, 60,000 miles: $1,120 / 60,000 = 1.87¢.
    expect(achievedValuePer100Cents({ points: 60000, cashPriceCents: 120000, taxesCents: 8000 })).toBe(187);
    expect(achievedValuePer100Cents({ points: 60000, cashPriceCents: null, taxesCents: 0 })).toBeNull();
  });

  test("a transfer never pays out a fraction", () => {
    expect(pointsAfterTransfer(1001, [250, 200])).toBe(800);
    expect(pointsAfterTransfer(1000, [1, 2])).toBe(2000);
  });

  test("transfer sources are the bank currencies that list the program", () => {
    const sources = transferSources("hyatt").map((s) => s.programId).sort();
    expect(sources).toEqual(["bilt", "chase-ur"]);
  });

  test("a trip is paid from the program first, then by the largest transferable balance", () => {
    const summary = summariseRewards({
      balances: [
        balance("b1", "aeroplan", 20000),
        balance("b2", "chase-ur", 30000),
        balance("b3", "amex-mr", 50000),
      ],
      trips: [trip("tokyo", "aeroplan", 60000, { cashPriceCents: 150000, taxesCents: 10000 })],
    });
    const [plan] = summary.trips;

    expect(plan.fromProgram).toBe(20000);
    expect(plan.transfers).toEqual([{ programId: "amex-mr", ratio: [1, 1], sent: 40000, arrives: 40000 }]);
    expect(plan.covered).toBe(true);
    // $1,400 saved over 60,000 = 2.33¢, against Aeroplan's catalog 1.50¢.
    expect(plan.achievedPer100Cents).toBe(233);
    expect(plan.goodValue).toBe(true);
  });

  test("points promised to an earlier trip are not counted twice", () => {
    const summary = summariseRewards({
      balances: [balance("b1", "united", 50000)],
      trips: [
        trip("later", "united", 40000, { date: "2027-06-01" }),
        trip("sooner", "united", 30000, { date: "2027-03-01" }),
      ],
    });
    const [later, sooner] = summary.trips;

    expect(sooner.covered).toBe(true);
    expect(later.fromProgram).toBe(20000);
    expect(later.shortfall).toBe(20000);
  });

  test("a ratio is rounded up on the way out so the trip is really covered", () => {
    const summary = summariseRewards({
      balances: [balance("b1", "amex-mr", 100000)],
      trips: [trip("jfk", "jetblue", 1001)],
    });
    const [{ transfers, covered }] = summary.trips;
    expect(transfers[0].sent).toBe(1252);
    expect(transfers[0].arrives).toBeGreaterThanOrEqual(1001);
    expect(covered).toBe(true);
  });

  test("totals add every holder, at each program's resolved value", () => {
    const summary = summariseRewards({
      balances: [balance("b1", "united", 50000, "Alex"), balance("b2", "united", 25000, "Sam"), balance("b3", "hilton", 100000)],
      valuations: { united: 140 },
    });
    expect(summary.programs.map((row) => [row.program.id, row.points, row.valueCents])).toEqual([
      ["united", 75000, 105000],
      ["hilton", 100000, 50000],
    ]);
    expect(summary.totalValueCents).toBe(155000);
    expect(summary.valueByKind).toEqual({ bank: 0, airline: 105000, hotel: 50000 });
  });
});

describe("card offers", () => {
  const CARD = "card";
  const CHECKING = "checking";
  const dining = {
    id: "o1",
    name: "9% on dining",
    kind: OFFER_KINDS.CAP,
    accountId: CARD,
    startDate: "2026-09-01",
    endDate: "2026-10-31",
    limitCents: 100000,
    allSpending: false,
    budgetIds: ["dining"],
    payeeIds: [],
    rateBps: 900,
    bonusPoints: null,
    programId: null,
  };
  const out = (id, date, amountCents, budgetId, accountId = CARD, extra = {}) => ({
    id,
    kind: "outflow",
    date,
    amountCents,
    budgetId,
    accountId,
    payeeId: null,
    splits: null,
    ...extra,
  });

  test("counts the card's spending in the mapped categories, inside the window, up to today", () => {
    const progress = offerProgress(
      dining,
      [
        out("a", "2026-09-05", 30000, "dining"),
        out("b", "2026-09-06", 50000, "groceries"), // not mapped
        out("c", "2026-08-31", 40000, "dining"), // before the window
        out("d", "2026-10-20", 10000, "dining"), // after today
        out("e", null, 10000, "dining"), // undated
        { id: "f", kind: "transfer", date: "2026-09-10", amountCents: 90000, accountId: CHECKING, toAccountId: CARD },
      ],
      "2026-10-08"
    );
    expect(progress.status).toBe(OFFER_STATUS.ACTIVE);
    expect(progress.qualifyingCents).toBe(30000);
    expect(progress.remainingCents).toBe(70000);
    expect(progress.earnedCents).toBe(2700);
    expect(progress.daysLeft).toBe(23);
    expect(progress.purchaseCount).toBe(1);
  });

  test("a refund in the category comes back off, a payee match counts, and a split counts only its part", () => {
    const offer = { ...dining, payeeIds: ["cafe"] };
    const progress = offerProgress(
      offer,
      [
        out("a", "2026-09-05", 30000, "dining"),
        { ...out("b", "2026-09-07", 5000, "dining"), kind: "inflow" },
        // Filed as groceries, but paid to the mapped payee.
        out("c", "2026-09-08", 2000, "groceries", CARD, { payeeId: "cafe" }),
        out("d", "2026-09-09", 12000, "dining", CARD, {
          splits: [
            { id: "p1", budgetId: "dining", amountCents: 4000 },
            { id: "p2", budgetId: "household", amountCents: 8000 },
          ],
        }),
        // Income on the card — a statement credit — is not a refund.
        { ...out("e", "2026-09-10", 7000, null), kind: "inflow" },
      ],
      "2026-10-08"
    );
    expect(progress.qualifyingCents).toBe(30000 - 5000 + 2000 + 4000);
  });

  test("past the cap is reported apart, and the offer says it is done", () => {
    const progress = offerProgress(dining, [out("a", "2026-09-05", 125000, "dining")], "2026-10-08");
    expect(progress.status).toBe(OFFER_STATUS.DONE);
    expect(progress.remainingCents).toBe(0);
    expect(progress.overCents).toBe(25000);
    // The bonus only applies up to the cap.
    expect(progress.earnedCents).toBe(9000);
  });

  test("spending elsewhere counts as missed only while the cap still had room", () => {
    const progress = offerProgress(
      dining,
      [
        out("a", "2026-09-01", 80000, "dining"),
        out("b", "2026-09-02", 30000, "dining", CHECKING), // $200 of room left: $200 missed
        out("c", "2026-09-03", 20000, "dining"), // fills the cap
        out("d", "2026-09-04", 40000, "dining", CHECKING), // after: rightly elsewhere
      ],
      "2026-10-08"
    );
    expect(progress.elsewhereCents).toBe(20000);
  });

  test("a spending target counts all spending and says what a week it takes", () => {
    const target = {
      ...dining,
      kind: OFFER_KINDS.TARGET,
      allSpending: true,
      budgetIds: [],
      startDate: "2026-09-01",
      endDate: "2026-11-30",
      limitCents: 400000,
      rateBps: null,
    };
    const progress = offerProgress(
      target,
      [out("a", "2026-09-05", 100000, "rent"), out("b", "2026-09-06", 50000, "dining")],
      "2026-10-08"
    );
    expect(progress.qualifyingCents).toBe(150000);
    expect(progress.remainingCents).toBe(250000);
    // 53 days left, today included: 54 days, $2,500 × 7 / 54.
    expect(progress.daysLeft).toBe(53);
    expect(progress.perWeekCents).toBe(Math.ceil((250000 * 7) / 54));
    expect(progress.earnedCents).toBeNull();
  });

  test("an offer not yet open and one already over say so", () => {
    expect(offerProgress({ ...dining, startDate: "2026-11-01", endDate: "2026-12-31" }, [], "2026-10-08").status).toBe(
      OFFER_STATUS.UPCOMING
    );
    const ended = offerProgress(
      { ...dining, startDate: "2026-07-01", endDate: "2026-09-30" },
      [out("a", "2026-09-30", 10000, "dining"), out("b", "2026-10-01", 10000, "dining")],
      "2026-10-08"
    );
    expect(ended.status).toBe(OFFER_STATUS.ENDED);
    expect(ended.qualifyingCents).toBe(10000);
    expect(ended.daysLeft).toBeNull();
  });

  test("the next round of a calendar quarter is the next calendar quarter", () => {
    expect(nextOfferWindow({ startDate: "2026-01-01", endDate: "2026-03-31" })).toEqual({
      startDate: "2026-04-01",
      endDate: "2026-06-30",
    });
    expect(nextOfferWindow({ startDate: "2026-10-01", endDate: "2026-12-31" })).toEqual({
      startDate: "2027-01-01",
      endDate: "2027-03-31",
    });
    // Not month-aligned: stepped by its own length.
    expect(nextOfferWindow({ startDate: "2026-09-15", endDate: "2026-10-14" })).toEqual({
      startDate: "2026-10-15",
      endDate: "2026-11-13",
    });
    expect(nextOfferWindow({ startDate: "2026-09-15", endDate: null })).toBeNull();
  });
});
