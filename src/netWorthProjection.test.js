import {
  INCOME_SOURCES,
  LIFE_EVENT_KINDS,
  eventsAt,
  loanPayment,
  projectNetWorth,
  retirementOutlook,
  takeHomeAt,
} from "./netWorthProjection";
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

describe("life events", () => {
  const event = (fields) => ({
    id: fields.name,
    enabled: true,
    years: null,
    oneTimeCents: null,
    annualCents: null,
    keptShareBps: 0,
    ...fields,
  });
  const wedding = event({ name: "Wedding", kind: LIFE_EVENT_KINDS.EXPENSE, startAge: 42, years: 1, oneTimeCents: 30_000_00 });
  const childcare = event({ name: "Childcare", kind: LIFE_EVENT_KINDS.EXPENSE, startAge: 43, years: 5, annualCents: 18_000_00 });
  const sabbatical = event({ name: "Sabbatical", kind: LIFE_EVENT_KINDS.INCOME_CHANGE, startAge: 50, years: 1, keptShareBps: 0 });
  const pension = event({ name: "Social Security", kind: LIFE_EVENT_KINDS.INCOME, startAge: 67, annualCents: 24_000_00 });

  const plan = {
    currentAge: 40,
    retirementAge: 65,
    lifeExpectancy: 90,
    pots: { cashCents: 20_000_00, investedCents: 50_000_00, retirementCents: 200_000_00 },
    income: { source: INCOME_SOURCES.GROWTH, takeHomeAnnualCents: 100_000_00 },
    spendingCents: 60_000_00,
    savingsCents: 10_000_00,
    pretaxRetirementCents: 15_000_00,
    retirementSpendingCents: 70_000_00,
    retirementTaxRateBps: 1500,
    growthRateBps: 900,
    drawdownRateBps: 500,
    inflationRateBps: 250,
    cashRateBps: 250,
  };

  test("an event runs for its years, its one-time figure lands in the first", () => {
    expect(eventsAt(42, [wedding]).expense).toBe(30_000_00);
    expect(eventsAt(43, [wedding]).expense).toBe(0);
    expect(eventsAt(42, [childcare]).expense).toBe(0);
    expect(eventsAt(43, [childcare]).expense).toBe(18_000_00);
    expect(eventsAt(47, [childcare]).expense).toBe(18_000_00);
    expect(eventsAt(48, [childcare]).expense).toBe(0);
    // No number of years: for the rest of the plan.
    expect(eventsAt(89, [pension]).income).toBe(24_000_00);
  });

  test("a disabled event is kept and does nothing", () => {
    expect(eventsAt(42, [{ ...wedding, enabled: false }])).toEqual({
      expense: 0,
      income: 0,
      keptShare: 1,
      names: [],
    });
  });

  test("two income changes in one year multiply", () => {
    const halfTime = event({ name: "Half time", kind: LIFE_EVENT_KINDS.INCOME_CHANGE, startAge: 50, years: 1, keptShareBps: 5000 });
    expect(eventsAt(50, [halfTime, { ...halfTime, id: "again" }]).keptShare).toBeCloseTo(0.25, 10);
  });

  test("a wedding comes out of cash the year it happens", () => {
    const without = projectNetWorth(plan);
    const withIt = projectNetWorth({ ...plan, events: [wedding] });
    const cashAt = (projection, age) => projection.series.find((point) => point.age === age).cashCents;

    expect(cashAt(withIt, 42)).toBe(cashAt(without, 42));
    expect(cashAt(without, 43) - cashAt(withIt, 43)).toBe(30_000_00);
    expect(withIt.series.find((point) => point.age === 42).events).toEqual(["Wedding"]);
    expectIdentity(withIt);
  });

  test("a sabbatical stops pay and the saving that came out of it, not the spending", () => {
    const projection = projectNetWorth({ ...plan, events: [sabbatical] });
    const year = projection.series.find((point) => point.age === 50);
    expect(year.incomeCents).toBe(0);
    expect(year.consumptionCents).toBe(60_000_00);
    const at = (age) => projection.series.find((point) => point.age === age);
    // Nothing was added to the retirement pot that year beyond its growth.
    const grown = at(50).retirementCents * ((1.09 / 1.025));
    expect(at(51).retirementCents).toBeCloseTo(grown, -1);
    expectIdentity(projection);
  });

  test("income in retirement is spent before savings are", () => {
    const without = projectNetWorth(plan);
    const withIt = projectNetWorth({ ...plan, events: [pension] });
    const at = (projection, age) => projection.series.find((point) => point.age === age);
    expect(at(withIt, 70).netCents).toBeGreaterThan(at(without, 70).netCents);
    expect(at(withIt, 67).incomeCents).toBe(24_000_00);
    expectIdentity(withIt);
  });

  test("income larger than the year's spending is left in cash", () => {
    const windfall = event({ name: "Inheritance", kind: LIFE_EVENT_KINDS.INCOME, startAge: 70, years: 1, oneTimeCents: 500_000_00 });
    const projection = projectNetWorth({ ...plan, events: [windfall] });
    const at = (age) => projection.series.find((point) => point.age === age);
    expect(at(71).cashCents).toBeGreaterThan(at(70).cashCents);
    expectIdentity(projection);
  });

  test("every kind together still balances, year by year", () => {
    expectIdentity(projectNetWorth({ ...plan, events: [wedding, childcare, sabbatical, pension] }));
  });
});

describe("buying and selling a home", () => {
  const plan = {
    currentAge: 30,
    retirementAge: 65,
    lifeExpectancy: 90,
    pots: { cashCents: 120_000_00, investedCents: 50_000_00, retirementCents: 60_000_00 },
    income: { source: INCOME_SOURCES.GROWTH, takeHomeAnnualCents: 110_000_00 },
    spendingCents: 60_000_00,
    savingsCents: 6_000_00,
    pretaxRetirementCents: 12_000_00,
    retirementSpendingCents: 60_000_00,
    retirementTaxRateBps: 1500,
    growthRateBps: 900,
    drawdownRateBps: 550,
    inflationRateBps: 0,
    cashRateBps: 0,
    propertyRateBps: 0,
  };
  const home = {
    id: "home",
    name: "First home",
    kind: LIFE_EVENT_KINDS.BUY_PROPERTY,
    enabled: true,
    startAge: 32,
    priceCents: 500_000_00,
    downPaymentCents: 100_000_00,
    rateBps: 600,
    termYears: 30,
    oneTimeCents: 10_000_00,
    annualCents: 8_000_00,
    rentSavedCents: 24_000_00,
  };
  const at = (projection, age) => projection.series.find((point) => point.age === age);

  test("a loan payment clears the loan in its term", () => {
    let owed = 400_000_00;
    const payment = loanPayment(owed, 600, 30);
    for (let year = 0; year < 30; year += 1) owed = owed * 1.06 - payment;
    expect(Math.abs(owed)).toBeLessThan(1);
    expect(loanPayment(30_000_00, 0, 3)).toBe(10_000_00);
  });

  test("a purchase moves the down payment into a house and opens the mortgage", () => {
    const projection = projectNetWorth({ ...plan, events: [home] });
    const year = at(projection, 33);
    expect(year.propertyCents).toBe(500_000_00);
    expect(year.debtCents).toBeLessThan(400_000_00);
    expect(year.debtCents).toBeGreaterThan(390_000_00);
    expect(at(projection, 32).events).toContain("First home");
    // Buying costs only the closing costs that year; the rest is a swap.
    expect(at(projection, 32).consumptionCents).toBe(60_000_00 + 10_000_00 + 8_000_00 - 24_000_00);
    expectIdentity(projection);
  });

  test("the mortgage is paid off at the end of its term", () => {
    const projection = projectNetWorth({ ...plan, events: [home] });
    const payoff = projection.payoffs.find((entry) => entry.id === "home");
    expect(payoff.age).toBe(32 + 29);
    expect(at(projection, 62).debtCents).toBe(0);
  });

  test("a down payment larger than the cash draws on investments", () => {
    const projection = projectNetWorth({
      ...plan,
      events: [{ ...home, startAge: 30, downPaymentCents: 150_000_00 }],
    });
    expect(at(projection, 31).investedCents).toBeLessThan(50_000_00);
    expectIdentity(projection);
  });

  test("selling pays off the loan and leaves the rest in cash", () => {
    const sale = {
      id: "sale",
      name: "Downsize",
      kind: LIFE_EVENT_KINDS.SELL_PROPERTY,
      enabled: true,
      startAge: 40,
      propertyRef: "home",
      sellingCostBps: 600,
    };
    const projection = projectNetWorth({ ...plan, events: [home, sale] });
    const before = at(projection, 40);
    const after = at(projection, 41);
    expect(after.propertyCents).toBe(0);
    expect(after.debtCents).toBe(0);
    expect(projection.payoffs).toContainEqual(expect.objectContaining({ id: "home", age: 40, sold: true }));
    // Rent and ownership costs stop with the house.
    expect(after.consumptionCents).toBe(60_000_00);
    expect(after.cashCents - before.cashCents).toBeGreaterThan(0);
    expectIdentity(projection);
  });

  test("a property on the books is sold with the mortgage it names", () => {
    const projection = projectNetWorth({
      ...plan,
      properties: [{ id: "acc-home", name: "Home", valueCents: 300_000_00 }],
      debts: [{ id: "acc-mortgage", name: "Mortgage", owedCents: 200_000_00, rateBps: 0, monthlyPaymentCents: 0 }],
      events: [
        { id: "s", name: "Sell", kind: LIFE_EVENT_KINDS.SELL_PROPERTY, enabled: true, startAge: 31, propertyRef: "acc-home", debtRef: "acc-mortgage", sellingCostBps: 0 },
      ],
    });
    const before = at(projection, 31);
    const after = at(projection, 32);
    expect(after.propertyCents).toBe(0);
    expect(after.debtCents).toBe(0);
    // $300,000 less $200,000 owed, plus the year's ordinary saving.
    expect(after.cashCents - before.cashCents).toBe(100_000_00 + 110_000_00 - 60_000_00 - 6_000_00);
    expectIdentity(projection);
  });

  test("a sale naming a property that does not exist does nothing", () => {
    const projection = projectNetWorth({
      ...plan,
      events: [{ id: "s", name: "Sell", kind: LIFE_EVENT_KINDS.SELL_PROPERTY, enabled: true, startAge: 40, propertyRef: "gone" }],
    });
    expect(projection.series.every((point) => !point.events?.includes("Sell"))).toBe(true);
  });
});

describe("the outlook, read off the walk", () => {
  const options = { currentAge: 65, retirementAge: 65, lifeExpectancy: 90, retirementSpendingCents: 40_000_00 };

  test("a pot of need on the first day is a pot of zero on the last", () => {
    const spending = 40_000_00;
    const needCents = Math.round(requiredNestEgg(spending, 25, 0.03));
    const projection = projectNetWorth({
      currentAge: 65,
      retirementAge: 65,
      lifeExpectancy: 90,
      pots: { retirementCents: needCents },
      retirementSpendingCents: spending,
      drawdownRateBps: 300,
    });
    const outlook = retirementOutlook(projection, options);
    expect(outlook.needCents).toBe(needCents);
    expect(Math.abs(outlook.gapCents)).toBeLessThanOrEqual(1);
    expect(Math.abs(outlook.surplusCents)).toBeLessThanOrEqual(5);
  });

  test("a pre-tax pot needs grossing up for the tax on the way out", () => {
    const projection = projectNetWorth({
      currentAge: 65,
      retirementAge: 65,
      lifeExpectancy: 90,
      pots: { retirementCents: 1_000_000_00 },
      retirementSpendingCents: 40_000_00,
      retirementTaxRateBps: 2000,
      drawdownRateBps: 300,
    });
    const outlook = retirementOutlook(projection, { ...options, retirementTaxRateBps: 2000 });
    expect(outlook.needCents).toBe(Math.round(requiredNestEgg(40_000_00, 25, 0.03) / 0.8));
  });

  test("a pension lowers what has to be there", () => {
    const pension = { id: "p", name: "Pension", kind: LIFE_EVENT_KINDS.INCOME, enabled: true, startAge: 65, years: null, annualCents: 20_000_00 };
    const plain = { currentAge: 65, retirementAge: 65, lifeExpectancy: 90, retirementSpendingCents: 40_000_00, drawdownRateBps: 300 };
    const without = retirementOutlook(projectNetWorth(plain), options);
    const withIt = retirementOutlook(projectNetWorth({ ...plain, events: [pension] }), options);
    expect(withIt.needCents).toBe(Math.round(without.needCents / 2));
  });

  test("the house is not money to spend, but selling it is", () => {
    const plain = {
      currentAge: 65,
      retirementAge: 65,
      lifeExpectancy: 90,
      properties: [{ id: "h", name: "Home", valueCents: 500_000_00 }],
      pots: { cashCents: 100_000_00 },
      retirementSpendingCents: 40_000_00,
      drawdownRateBps: 300,
    };
    const keep = retirementOutlook(projectNetWorth(plain), options);
    expect(keep.projectedCents).toBe(100_000_00);
    const sell = retirementOutlook(
      projectNetWorth({
        ...plain,
        events: [{ id: "s", name: "Sell", kind: LIFE_EVENT_KINDS.SELL_PROPERTY, enabled: true, startAge: 70, propertyRef: "h", sellingCostBps: 0 }],
      }),
      options
    );
    expect(sell.needCents).toBeLessThan(keep.needCents);
  });

  test("the contribution that closes the gap lands on the target exactly", () => {
    const plan = {
      currentAge: 40,
      retirementAge: 65,
      lifeExpectancy: 90,
      pots: { retirementCents: 50_000_00 },
      pretaxRetirementCents: 5_000_00,
      retirementSpendingCents: 50_000_00,
      growthRateBps: 700,
      drawdownRateBps: 300,
    };
    const outlookOptions = { currentAge: 40, retirementAge: 65, lifeExpectancy: 90, retirementSpendingCents: 50_000_00, currentContributionCents: 5_000_00 };
    const outlook = retirementOutlook(projectNetWorth(plan), outlookOptions);
    expect(outlook.gapCents).toBeLessThan(0);
    const fixed = retirementOutlook(
      projectNetWorth({ ...plan, pretaxRetirementCents: outlook.requiredContributionCents }),
      outlookOptions
    );
    expect(Math.abs(fixed.gapCents)).toBeLessThan(100);
  });

  test("no spending figure is a question, not a zero target", () => {
    const outlook = retirementOutlook(projectNetWorth({ currentAge: 40, retirementAge: 65, lifeExpectancy: 90 }), {
      currentAge: 40,
      retirementAge: 65,
      lifeExpectancy: 90,
      retirementSpendingCents: 0,
    });
    expect(outlook.ready).toBe(false);
    expect(outlook.issues).toContain("Say what you expect retirement to cost each year.");
  });
});

test("a loan bought into with inflation running still ends in its term", () => {
  const projection = projectNetWorth({
    currentAge: 30,
    retirementAge: 65,
    lifeExpectancy: 90,
    pots: { cashCents: 200_000_00 },
    income: { source: INCOME_SOURCES.GROWTH, takeHomeAnnualCents: 120_000_00 },
    spendingCents: 50_000_00,
    retirementSpendingCents: 40_000_00,
    inflationRateBps: 250,
    events: [
      {
        id: "home",
        name: "Home",
        kind: LIFE_EVENT_KINDS.BUY_PROPERTY,
        enabled: true,
        startAge: 35,
        priceCents: 550_000_00,
        downPaymentCents: 110_000_00,
        rateBps: 650,
        termYears: 30,
      },
    ],
  });
  expect(projection.payoffs.find((payoff) => payoff.id === "home").age).toBe(35 + 29);
  expectIdentity(projection);
});
