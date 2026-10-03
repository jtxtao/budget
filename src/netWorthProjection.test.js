import { INCOME_SOURCES, projectNetWorth, takeHomeAt } from "./netWorthProjection";
import { projectRetirement, requiredNestEgg } from "./hooks/useRetirementProjection";

/**
 * The whole-balance-sheet projection as the pure function it is.
 *
 * Three tripwires, and they guard different things. The identity says no money
 * appears or disappears in any year, whatever the walk does; the reproduction
 * says the new walk still means what the old retirement projection meant; and
 * the funded-to-the-cent plan says `need` and the walk still agree once the
 * retirement pot is one pot among five.
 */

const AGES = { currentAge: 40, retirementAge: 65, lifeExpectancy: 90 };

/**
 * Every year, the change in net worth is exactly what entered or left the
 * household. Saving, withdrawals and debt payments are money moving between
 * pots, so they are not in it — which is the point: if one of them were
 * mis-booked, this is the line that would stop balancing.
 */
function expectIdentity(projection) {
  const { series } = projection;
  expect(series.length).toBeGreaterThan(1);
  for (let index = 0; index < series.length - 1; index += 1) {
    const { startNet, incomeFlow, consumption, tax, interest, growth, unfunded } =
      series[index].exact;
    const expected = startNet + incomeFlow - consumption - tax - interest + growth + unfunded;
    const actual = series[index + 1].exact.startNet;
    // Relative to the size of the figures, since a fifty-year walk of floats
    // carries a few ulps; nothing a real leak could hide in.
    expect(Math.abs(actual - expected)).toBeLessThan(1e-6 * Math.max(1, Math.abs(actual)));
  }
}

describe("the identity", () => {
  test("holds every year of a busy plan — debts, a raise, a shortfall and taxes", () => {
    const projection = projectNetWorth({
      currentAge: 30,
      retirementAge: 60,
      lifeExpectancy: 92,
      pots: {
        cashCents: 15_000_00,
        investedCents: 40_000_00,
        retirementCents: 80_000_00,
        propertyCents: 450_000_00,
      },
      debts: [
        { id: "m", name: "Mortgage", owedCents: 360_000_00, rateBps: 550, monthlyPaymentCents: 2_400_00 },
        { id: "c", name: "Car", owedCents: 18_000_00, rateBps: 700, monthlyPaymentCents: 450_00 },
        // A debt with no payment stated: held at its nominal figure, eroded in
        // today's dollars, and never paid off.
        { id: "f", name: "Family loan", owedCents: 5_000_00, rateBps: 0, monthlyPaymentCents: 0 },
      ],
      income: {
        source: INCOME_SOURCES.SALARIES,
        takeHomeAnnualCents: 90_000_00,
        workingTaxRateBps: 2400,
        salaries: [
          { fromAge: 33, grossCents: 140_000_00 },
          // A sabbatical year with nothing coming in, then back to work.
          { fromAge: 45, grossCents: 0 },
          { fromAge: 46, grossCents: 150_000_00 },
        ],
      },
      spendingCents: 70_000_00,
      savingsCents: 6_000_00,
      afterTaxRetirementCents: 3_000_00,
      pretaxRetirementCents: 12_000_00,
      retirementSpendingCents: 85_000_00,
      retirementTaxRateBps: 1500,
      growthRateBps: 900,
      drawdownRateBps: 550,
      inflationRateBps: 300,
      cashRateBps: 200,
      propertyRateBps: 350,
    });

    expect(projection.ready).toBe(true);
    // The sabbatical has to be paid for out of something.
    expect(projection.series.find((point) => point.age === 45).incomeCents).toBe(12_000_00);
    expect(projection.payoffs.map((payoff) => payoff.id)).toEqual(expect.arrayContaining(["c", "m"]));
    expectIdentity(projection);
  });

  test("holds through a plan that runs out, where the pots are floored", () => {
    const projection = projectNetWorth({
      ...AGES,
      pots: { cashCents: 5_000_00, retirementCents: 50_000_00 },
      income: { source: INCOME_SOURCES.GROWTH, takeHomeAnnualCents: 40_000_00 },
      spendingCents: 45_000_00,
      retirementSpendingCents: 30_000_00,
      retirementTaxRateBps: 2000,
      growthRateBps: 700,
      drawdownRateBps: 400,
      inflationRateBps: 250,
    });

    expect(projection.shortfallAge).not.toBeNull();
    expect(projection.series.every((point) => point.retirementCents >= 0)).toBe(true);
    expectIdentity(projection);
  });
});

/**
 * The second tripwire: with nothing on the balance sheet but the retirement
 * pot, no take-home and no spending, this walk *is* `projectRetirement`'s, to
 * the cent, every year. That is what keeps the new projection meaning what the
 * page already said while it is rebuilt around it.
 */
describe("reproduces the retirement projection", () => {
  const plans = [
    {
      name: "a plan that lasts",
      currentAge: 40,
      retirementAge: 65,
      lifeExpectancy: 90,
      startingCents: 150_000_00,
      annualContributionCents: 20_000_00,
      annualSpendingCents: 50_000_00,
      growthRateBps: 1000,
      drawdownRateBps: 550,
      inflationRateBps: 250,
    },
    {
      name: "a plan that runs out",
      currentAge: 50,
      retirementAge: 60,
      lifeExpectancy: 95,
      startingCents: 100_000_00,
      annualContributionCents: 5_000_00,
      annualSpendingCents: 60_000_00,
      growthRateBps: 800,
      drawdownRateBps: 500,
      inflationRateBps: 300,
    },
  ];

  test.each(plans)("$name", (plan) => {
    const old = projectRetirement(plan);
    const next = projectNetWorth({
      currentAge: plan.currentAge,
      retirementAge: plan.retirementAge,
      lifeExpectancy: plan.lifeExpectancy,
      pots: { retirementCents: plan.startingCents },
      pretaxRetirementCents: plan.annualContributionCents,
      retirementSpendingCents: plan.annualSpendingCents,
      growthRateBps: plan.growthRateBps,
      drawdownRateBps: plan.drawdownRateBps,
      inflationRateBps: plan.inflationRateBps,
    });

    expect(next.series.map((point) => point.age)).toEqual(old.series.map((point) => point.age));
    expect(next.series.map((point) => point.retirementCents)).toEqual(
      old.series.map((point) => point.balanceCents)
    );
    expect(next.atRetirementCents).toBe(old.projectedCents);
    expect(next.shortfallAge).toBe(old.depletionAge);
  });
});

test("a retirement pot funded to the cent runs out to the cent", () => {
  const spending = 40_000_00;
  const years = 25;
  const needCents = Math.round(requiredNestEgg(spending, years, 0.03));

  const projection = projectNetWorth({
    currentAge: 65,
    retirementAge: 65,
    lifeExpectancy: 65 + years,
    pots: { retirementCents: needCents },
    retirementSpendingCents: spending,
    drawdownRateBps: 300,
  });

  expect(projection.shortfallAge).toBeNull();
  expect(Math.abs(projection.atEndCents)).toBeLessThanOrEqual(5);
});

describe("income while working", () => {
  const context = { currentAge: 40, pretaxCents: 10_000_00, inflationRateBps: 0 };

  test("grows today's take-home by the rate, after inflation", () => {
    const income = {
      source: INCOME_SOURCES.GROWTH,
      takeHomeAnnualCents: 80_000_00,
      growthRateBps: 300,
    };
    expect(takeHomeAt(40, { ...context, income })).toBeCloseTo(80_000_00, 6);
    expect(takeHomeAt(50, { ...context, income })).toBeCloseTo(80_000_00 * 1.03 ** 10, 4);
    // A raise that only keeps up with inflation is no raise in today's dollars.
    expect(
      takeHomeAt(50, { ...context, inflationRateBps: 300, income })
    ).toBeCloseTo(80_000_00, 4);
  });

  test("taxes a gross salary after the pretax deduction has left it", () => {
    const income = {
      source: INCOME_SOURCES.SALARIES,
      takeHomeAnnualCents: 70_000_00,
      workingTaxRateBps: 2500,
      salaries: [{ fromAge: 42, grossCents: 130_000_00 }],
    };
    // (130,000 − 10,000) × 0.75
    expect(takeHomeAt(42, { ...context, income })).toBeCloseTo(90_000_00, 6);
    expect(takeHomeAt(55, { ...context, income })).toBeCloseTo(90_000_00, 6);
  });

  test("before the first salary, today's take-home stands", () => {
    const income = {
      source: INCOME_SOURCES.SALARIES,
      takeHomeAnnualCents: 70_000_00,
      salaries: [{ fromAge: 45, grossCents: 130_000_00 }],
    };
    expect(takeHomeAt(41, { ...context, income })).toBe(70_000_00);
  });

  test("a later salary replaces an earlier one, whatever order they were entered in", () => {
    const income = {
      source: INCOME_SOURCES.SALARIES,
      salaries: [
        { fromAge: 50, grossCents: 60_000_00 },
        { fromAge: 41, grossCents: 110_000_00 },
      ],
    };
    expect(takeHomeAt(45, { ...context, pretaxCents: 0, income })).toBe(110_000_00);
    expect(takeHomeAt(52, { ...context, pretaxCents: 0, income })).toBe(60_000_00);
  });
});

describe("debts", () => {
  const plain = {
    ...AGES,
    income: { source: INCOME_SOURCES.GROWTH, takeHomeAnnualCents: 60_000_00 },
    spendingCents: 50_000_00,
    retirementSpendingCents: 30_000_00,
  };

  test("are paid off out of the budget, and the payment comes back to cash", () => {
    const projection = projectNetWorth({
      ...plain,
      debts: [{ id: "l", name: "Loan", owedCents: 30_000_00, rateBps: 0, monthlyPaymentCents: 1_000_00 }],
    });

    // $12,000 a year against $30,000: paid off in the third year.
    expect(projection.payoffs).toEqual([{ id: "l", name: "Loan", age: 42 }]);
    const cashAt = (age) => projection.series.find((point) => point.age === age).cashCents;
    // $10,000 a year saved while the loan runs; the year it ends, the $6,000
    // of payment it no longer needed is back, and $22,000 a year after that.
    expect(cashAt(41) - cashAt(40)).toBe(10_000_00);
    expect(cashAt(43) - cashAt(42)).toBe(16_000_00);
    expect(cashAt(44) - cashAt(43)).toBe(22_000_00);
    expectIdentity(projection);
  });

  test("a fixed payment and the balance it pays both shrink in today's dollars", () => {
    const loan = { id: "l", name: "Loan", owedCents: 30_000_00, rateBps: 0, monthlyPaymentCents: 1_000_00 };
    const nominal = projectNetWorth({ ...plain, debts: [loan] });
    const inflated = projectNetWorth({ ...plain, inflationRateBps: 1000, debts: [loan] });

    // Inflation erodes the balance as fast as the payment, so the loan still
    // ends in the same year — the identity of a nominal loan seen in real money.
    expect(inflated.payoffs[0].age).toBe(nominal.payoffs[0].age);
    // But the debt is lighter in today's dollars every year after the first.
    const owedAt = (projection, age) => projection.series.find((point) => point.age === age).debtCents;
    expect(owedAt(inflated, 41)).toBeLessThan(owedAt(nominal, 41));
  });

  test("a debt with no payment stated is held at its nominal figure", () => {
    const projection = projectNetWorth({
      ...plain,
      inflationRateBps: 250,
      debts: [{ id: "f", name: "Family", owedCents: 10_000_00, rateBps: 0, monthlyPaymentCents: 0 }],
    });
    const at50 = projection.series.find((point) => point.age === 50).debtCents;
    expect(at50).toBe(Math.round(10_000_00 / 1.025 ** 10));
    expect(projection.payoffs).toEqual([]);
  });

  test("once retired, a payment still running is paid on top of retirement spending", () => {
    const loan = { id: "m", name: "Mortgage", owedCents: 100_000_00, rateBps: 0, monthlyPaymentCents: 1_000_00 };
    const retired = {
      currentAge: 65,
      retirementAge: 65,
      lifeExpectancy: 70,
      pots: { cashCents: 500_000_00 },
      retirementSpendingCents: 30_000_00,
    };
    const projection = projectNetWorth({ ...retired, debts: [loan] });
    const cashAt = (age) => projection.series.find((point) => point.age === age).cashCents;
    expect(cashAt(65) - cashAt(66)).toBe(42_000_00);
    expectIdentity(projection);
  });

  test("warns when the payments cannot be inside the budget's spending", () => {
    const projection = projectNetWorth({
      ...plain,
      spendingCents: 10_000_00,
      debts: [{ id: "m", name: "Mortgage", owedCents: 300_000_00, rateBps: 500, monthlyPaymentCents: 2_000_00 }],
    });
    expect(projection.warnings).toHaveLength(1);
  });
});

describe("a year that cannot be paid for", () => {
  test("draws on cash, then investments, then the retirement pot — and says so", () => {
    const projection = projectNetWorth({
      currentAge: 40,
      retirementAge: 65,
      lifeExpectancy: 70,
      pots: { cashCents: 5_000_00, investedCents: 5_000_00, retirementCents: 100_000_00 },
      income: { source: INCOME_SOURCES.GROWTH, takeHomeAnnualCents: 40_000_00 },
      spendingCents: 52_000_00,
      retirementTaxRateBps: 2000,
    });

    const at41 = projection.series.find((point) => point.age === 41);
    expect(at41.cashCents).toBe(0);
    expect(at41.investedCents).toBe(0);
    // $2,000 net from the retirement pot costs $2,500 at a 20% rate.
    expect(at41.retirementCents).toBe(97_500_00);
    expect(projection.series.find((point) => point.age === 40).taxCents).toBe(500_00);
    expect(projection.earlyWithdrawalAge).toBe(40);
    expectIdentity(projection);
  });

  test("a plan that cannot be answered says what is missing", () => {
    const projection = projectNetWorth({ currentAge: null, retirementAge: 65, lifeExpectancy: 90 });
    expect(projection.ready).toBe(false);
    expect(projection.issues).toContain("Enter your age today.");
    expect(projection.series).toEqual([]);
  });
});
