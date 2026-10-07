import { fromBps } from "./utils";

/**
 * The whole balance sheet walked forward a year at a time, from today to the
 * end of the plan — the projection life events will be written against.
 *
 * A pure module like `paySchedule.js` and `chartAxis.js`: arithmetic on plain
 * figures, no React, no stores. `useRetirementProjection` resolves the figures
 * out of the books and the plan and hands them here, and the tests drive this
 * directly.
 *
 * **Five pots, because the four net-worth bands are not enough to answer a
 * retirement question.** Cash, property and debt are the bands as `useNetWorth`
 * cuts them; invested is split in two — the accounts the plan counts as
 * retirement money, and everything else — because only one of them is taxed on
 * the way out and only one of them is a warning when touched before retirement.
 * Each debt is walked on its own, since each has its own rate and payment and
 * is paid off in its own year.
 *
 * **Everything is in today's dollars**, the rule `projectRetirement` keeps and
 * for the same reason: every rate is deflated once, and every figure handed in
 * is read as today's money. Debts are the one place that takes care. A loan's
 * payment is fixed in *nominal* dollars, so in today's dollars it shrinks every
 * year, and the debt's own balance is eroded by inflation as well — so a debt
 * runs on its real rate (which is negative for a loan cheaper than inflation)
 * and a payment deflated by the years elapsed. Walking a mortgage at a flat
 * real payment would overstate its weight in every year but the first.
 *
 * **One year, in the order it happens:**
 *
 *   working:  every pot grows, then the year's money lands
 *               cash       += take-home − spending − saving − after-tax
 *                             retirement saving + whatever the debts freed
 *               invested   += the savings bucket
 *               retirement += after-tax + pretax retirement saving
 *   retired:  the year's withdrawal comes out at the start, then what is
 *             left grows — the order `projectRetirement` uses and for its
 *             reason
 *
 * **A debt payment is already inside the budget's spending while working**, so
 * it is not subtracted twice: it pays the debt down, and whatever of the
 * stated payment the debt no longer takes — all of it, the year the loan is
 * gone, and the inflation-eroded part of it before then — comes back to cash.
 * **Once retired it is paid on top of the retirement spending figure**,
 * because that figure is defined the other way: "a share of what I earn now"
 * is the rule of thumb for a household whose mortgage is paid off, and a loan
 * still running then is a real cost the share does not cover.
 *
 * **A shortfall is drawn in order — cash, then invested, then retirement** —
 * and money taken out of the retirement pot is grossed up for tax, since a
 * pre-tax dollar does not buy a dollar of groceries. Reaching the retirement pot
 * before the retirement age is reported, not prevented: it is the most
 * important thing this projection can tell a household planning a wedding at
 * thirty-two. What cannot be covered at all is reported as unfunded and the
 * pots are floored at zero, the stance `projectRetirement` takes — a projection
 * that drew a portfolio below the axis would be drawing a loan nobody took.
 *
 * **The identity**, asserted for every year by the tests:
 *
 *   net(next) = net + income − consumption − tax − interest + growth + unfunded
 *
 * Saving, withdrawals and debt payments are all money moving between pots, so
 * they cancel; what is left is everything that enters or leaves the household.
 * Every pot and every flow is reported on each point, so the identity can be
 * checked from the outside without trusting the walk that produced it.
 */

/** Below this a shortfall is rounding, not news — see `projectRetirement`. */
const SHORTFALL_TOLERANCE = 100;

/** Where today's income comes from in the years still to be worked. */
export const INCOME_SOURCES = {
  /** Today's take-home pay, grown by a rate each year. */
  GROWTH: "growth",
  /** Gross salaries entered by age, taxed down to take-home. */
  SALARIES: "salaries",
};

/**
 * What a life event does to the year it falls in. The direction is the kind,
 * never a sign — the ledger's rule — and every figure is a magnitude in today's
 * dollars. See `LifeEventsContext` for the record.
 */
export const LIFE_EVENT_KINDS = {
  /** Money out: a one-time figure at the start age, a yearly one, or both. */
  EXPENSE: "expense",
  /** Money in, the same shape: Social Security, a pension, an inheritance. */
  INCOME: "income",
  /** A share of normal pay kept while it runs: 0 for a sabbatical. */
  INCOME_CHANGE: "income-change",
};

/**
 * Everything the enabled events do to one year.
 *
 * An event runs from `startAge` for `years` years (`null` is for the rest of
 * the plan); its one-time figure lands in the first of them. Two income
 * changes in one year multiply — half pay during a year that is itself half
 * time is a quarter — and only reach working years, since there is no pay
 * left to change once retired.
 */
export function eventsAt(age, events = []) {
  let expense = 0;
  let income = 0;
  let keptShare = 1;
  const names = [];

  for (const event of events) {
    if (!event.enabled) continue;
    const active =
      age >= event.startAge && (event.years == null || age < event.startAge + event.years);
    if (!active) continue;

    const first = age === event.startAge;
    const amount = (first ? event.oneTimeCents ?? 0 : 0) + (event.annualCents ?? 0);
    if (event.kind === LIFE_EVENT_KINDS.EXPENSE) {
      expense += amount;
      if (amount > 0) names.push(event.name);
    } else if (event.kind === LIFE_EVENT_KINDS.INCOME) {
      income += amount;
      if (amount > 0) names.push(event.name);
    } else if (event.kind === LIFE_EVENT_KINDS.INCOME_CHANGE) {
      keptShare *= fromBps(event.keptShareBps ?? 0);
      names.push(event.name);
    }
  }

  return { expense, income, keptShare, names };
}

/** The real rate left after inflation has taken its share. */
export function realRate(nominalBps, inflationBps) {
  return (1 + fromBps(nominalBps)) / (1 + fromBps(inflationBps)) - 1;
}

/**
 * Take-home pay in a working year.
 *
 * Growth: today's take-home compounded at the real rate. Salaries: the gross
 * figure in force at that age — the latest one starting at or before it — less
 * the pretax deduction, which leaves before tax does, and then less tax. Before
 * the first salary takes effect, today's take-home stands, so a household can
 * enter "a raise to $140,000 at 38" without restating what they earn now.
 */
export function takeHomeAt(age, { currentAge, income, pretaxCents, inflationRateBps }) {
  const today = income.takeHomeAnnualCents ?? 0;

  if (income.source === INCOME_SOURCES.SALARIES) {
    const inForce = [...(income.salaries ?? [])]
      .filter((salary) => salary.fromAge <= age)
      .sort((a, b) => a.fromAge - b.fromAge)
      .pop();
    if (!inForce) return today;
    const taxable = Math.max(0, inForce.grossCents - pretaxCents);
    return taxable * (1 - fromBps(income.workingTaxRateBps));
  }

  const growth = realRate(income.growthRateBps, inflationRateBps);
  return today * (1 + growth) ** (age - currentAge);
}

/** What the plan cannot answer yet, said as instructions. Only the ages are
 *  required here: every figure has a defensible zero. */
function issuesFor({ currentAge, retirementAge, lifeExpectancy }) {
  const issues = [];
  if (currentAge == null) issues.push("Enter your age today.");
  if (retirementAge == null) issues.push("Enter the age you want to retire.");
  if (currentAge != null && retirementAge != null && retirementAge < currentAge) {
    issues.push("Your retirement age is in the past — set it to today's age or later.");
  }
  if (lifeExpectancy == null) {
    issues.push("Enter how long the money has to last.");
  } else if (retirementAge != null && lifeExpectancy <= retirementAge) {
    issues.push("Set how long the money has to last to a year after you retire.");
  }
  return issues;
}

const round = (value) => Math.round(value);

/**
 * Take `amount` out of the pots, in order, and say what it cost.
 *
 * Cash and the non-retirement investments give a dollar for a dollar; the
 * retirement pot gives `1 − tax` of one, so drawing a net dollar from it costs
 * `1 / (1 − tax)` and the difference is tax. Returns what could not be found.
 */
function draw(pots, amount, retirementTax) {
  let owing = amount;
  for (const pot of ["cash", "invested"]) {
    const taken = Math.min(Math.max(0, pots[pot]), owing);
    pots[pot] -= taken;
    owing -= taken;
  }

  let tax = 0;
  let fromRetirement = 0;
  if (owing > 0 && pots.retirement > 0) {
    const keep = 1 - retirementTax;
    const gross = Math.min(pots.retirement, keep > 0 ? owing / keep : pots.retirement);
    const net = gross * keep;
    pots.retirement -= gross;
    tax = gross - net;
    fromRetirement = gross;
    owing -= net;
  }

  return { short: Math.max(0, owing), tax, fromRetirement };
}

/**
 * The projection, from resolved figures.
 *
 * `pots` is today's cash, invested, retirement and property, each a signed
 * figure as the balance sheet has it; `debts` is each liability as a positive
 * amount owed with its nominal rate and monthly payment. Every flow is a yearly
 * figure in today's dollars.
 */
export function projectNetWorth({
  currentAge,
  retirementAge,
  lifeExpectancy,
  pots: startingPots = {},
  debts: startingDebts = [],
  income = {},
  spendingCents = 0,
  savingsCents = 0,
  afterTaxRetirementCents = 0,
  pretaxRetirementCents = 0,
  retirementSpendingCents = 0,
  retirementTaxRateBps = 0,
  growthRateBps = 0,
  drawdownRateBps = 0,
  inflationRateBps = 0,
  cashRateBps = 0,
  propertyRateBps = 0,
  events = [],
}) {
  const issues = issuesFor({ currentAge, retirementAge, lifeExpectancy });
  const rates = {
    cash: realRate(cashRateBps, inflationRateBps),
    property: realRate(propertyRateBps, inflationRateBps),
    growth: realRate(growthRateBps, inflationRateBps),
    drawdown: realRate(drawdownRateBps, inflationRateBps),
  };
  const base = {
    ready: false,
    issues,
    warnings: [],
    realRatesBps: Object.fromEntries(
      Object.entries(rates).map(([key, rate]) => [key, round(rate * 10000)])
    ),
    series: [],
    payoffs: [],
    shortfallAge: null,
    earlyWithdrawalAge: null,
    atRetirementCents: 0,
    atEndCents: 0,
  };
  if (issues.length > 0) return base;

  const inflation = fromBps(inflationRateBps);
  const retirementTax = fromBps(retirementTaxRateBps);

  const pots = {
    cash: startingPots.cashCents ?? 0,
    invested: startingPots.investedCents ?? 0,
    retirement: startingPots.retirementCents ?? 0,
    property: startingPots.propertyCents ?? 0,
  };
  const debts = startingDebts.map((debt) => ({
    id: debt.id,
    name: debt.name,
    owed: Math.max(0, debt.owedCents ?? 0),
    rate: realRate(debt.rateBps ?? 0, inflationRateBps),
    // Today's payment, a year of it. Fixed in nominal dollars from here on.
    payment: Math.max(0, debt.monthlyPaymentCents ?? 0) * 12,
  }));

  const warnings = [];
  const statedPayments = debts.reduce((sum, debt) => sum + debt.payment, 0);
  if (statedPayments > spendingCents && currentAge < retirementAge) {
    warnings.push(
      "Your debt payments come to more than your budget's spending estimates. The projection assumes the payments are part of that spending, so add them to a category on the budget plan."
    );
  }

  const owedTotal = () => debts.reduce((sum, debt) => sum + debt.owed, 0);
  const assets = () => pots.cash + pots.invested + pots.retirement + pots.property;

  const series = [];
  const payoffs = [];
  let shortfallAge = null;
  let earlyWithdrawalAge = null;

  for (let age = currentAge; age < lifeExpectancy; age += 1) {
    const working = age < retirementAge;
    const elapsed = age - currentAge;

    const point = {
      age,
      phase: working ? "saving" : "retired",
      cashCents: round(pots.cash),
      investedCents: round(pots.invested),
      retirementCents: round(pots.retirement),
      propertyCents: round(pots.property),
      debtCents: round(owedTotal()),
      netCents: round(assets() - owedTotal()),
    };
    const startNet = assets() - owedTotal();

    // The debts, first: what each charges and what it is paid this year. The
    // payment is today's nominal figure deflated by the years since.
    let interest = 0;
    let paid = 0;
    const deflator = (1 + inflation) ** elapsed;
    for (const debt of debts) {
      if (debt.owed <= 0) continue;
      const charged = debt.owed * debt.rate;
      const due = debt.owed + charged;
      const payment = Math.min(due, debt.payment / deflator);
      debt.owed = due - payment;
      interest += charged;
      paid += payment;
      // Exactly zero when the payment covered what was due — `due − due` —
      // so no tolerance is needed and none can forgive a real balance.
      if (debt.owed === 0) payoffs.push({ id: debt.id, name: debt.name, age });
    }

    const happening = eventsAt(age, events);
    point.events = happening.names;

    let incomeFlow = 0;
    let consumption = 0;
    let tax = 0;
    let growth = 0;
    let unfunded = 0;

    if (working) {
      // An income change scales the whole of what work brings in — the pay,
      // the payroll deduction, and the saving the budget does out of the pay —
      // because a year at half pay is a year that saves half. Spending does
      // not scale: the rent is the same on a sabbatical.
      const share = happening.keptShare;
      const takeHome =
        takeHomeAt(age, {
          currentAge,
          income,
          pretaxCents: pretaxRetirementCents,
          inflationRateBps,
        }) * share;
      const pretax = pretaxRetirementCents * share;
      const saved = savingsCents * share;
      const afterTax = afterTaxRetirementCents * share;
      incomeFlow = takeHome + pretax + happening.income;
      // The budget's spending includes today's debt payments, so what was
      // actually consumed is the rest of it; whatever the debts no longer
      // take comes back to cash.
      consumption = spendingCents - statedPayments + happening.expense;
      const freed = statedPayments - paid;

      growth =
        pots.cash * rates.cash +
        pots.invested * rates.growth +
        pots.retirement * rates.growth +
        pots.property * rates.property;
      pots.cash *= 1 + rates.cash;
      pots.invested = pots.invested * (1 + rates.growth) + saved;
      pots.retirement = pots.retirement * (1 + rates.growth) + afterTax + pretax;
      pots.property *= 1 + rates.property;

      pots.cash +=
        takeHome +
        happening.income -
        spendingCents -
        happening.expense -
        saved -
        afterTax +
        freed;

      if (pots.cash < 0) {
        const owing = -pots.cash;
        pots.cash = 0;
        const result = draw(pots, owing, retirementTax);
        tax = result.tax;
        if (result.fromRetirement > 0 && earlyWithdrawalAge == null) earlyWithdrawalAge = age;
        if (result.short > SHORTFALL_TOLERANCE && shortfallAge == null) shortfallAge = age;
        unfunded = result.short;
      }
    } else {
      // Retired: the year's spending and whatever the debts still take come
      // out at the start, then what is left grows.
      // An event's income is set against the year's withdrawal — a pension
      // is spent before savings are — and a year it more than covers leaves
      // the rest in cash.
      incomeFlow = happening.income;
      consumption = retirementSpendingCents + happening.expense;
      const needed = retirementSpendingCents + happening.expense + paid - happening.income;
      if (needed < 0) {
        pots.cash -= needed;
      } else {
        const result = draw(pots, needed, retirementTax);
        tax = result.tax;
        if (result.short > SHORTFALL_TOLERANCE && shortfallAge == null) shortfallAge = age;
        unfunded = result.short;
      }

      growth =
        pots.cash * rates.cash +
        pots.invested * rates.drawdown +
        pots.retirement * rates.drawdown +
        pots.property * rates.property;
      pots.cash *= 1 + rates.cash;
      pots.invested *= 1 + rates.drawdown;
      pots.retirement *= 1 + rates.drawdown;
      pots.property *= 1 + rates.property;
    }

    Object.assign(point, {
      incomeCents: round(incomeFlow),
      consumptionCents: round(consumption),
      taxCents: round(tax),
      interestCents: round(interest),
      growthCents: round(growth),
      unfundedCents: round(unfunded),
      // Unrounded, for the identity: a fifty-year walk rounded per year would
      // need a tolerance that grows with it, and a tolerance is where a real
      // leak hides.
      exact: { startNet, incomeFlow, consumption, tax, interest, growth, unfunded },
    });
    series.push(point);
  }

  const endNet = assets() - owedTotal();
  series.push({
    age: lifeExpectancy,
    phase: "retired",
    cashCents: round(pots.cash),
    investedCents: round(pots.invested),
    retirementCents: round(pots.retirement),
    propertyCents: round(pots.property),
    debtCents: round(owedTotal()),
    netCents: round(endNet),
    exact: { startNet: endNet },
  });

  return {
    ...base,
    ready: true,
    warnings,
    series,
    payoffs,
    shortfallAge,
    earlyWithdrawalAge,
    atRetirementCents: series.find((point) => point.age === retirementAge).netCents,
    atEndCents: round(endNet),
  };
}
