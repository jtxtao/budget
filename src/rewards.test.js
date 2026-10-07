import {
  CATALOG,
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
