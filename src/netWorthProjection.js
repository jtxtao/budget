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
  /** A home bought: the property, the mortgage on it, the rent it ends. */
  BUY_PROPERTY: "buy-property",
  /** A property sold: the proceeds, less costs and whatever loan it carried. */
  SELL_PROPERTY: "sell-property",
};

/** The kinds `eventsAt` reads. Buying and selling change the balance sheet
 *  itself rather than a year's flows, so the walk handles them in place. */
const FLOW_KINDS = new Set([
  LIFE_EVENT_KINDS.EXPENSE,
  LIFE_EVENT_KINDS.INCOME,
  LIFE_EVENT_KINDS.INCOME_CHANGE,
]);

/**
 * The yearly payment that clears a loan in `years` at a nominal annual `rate`.
 * Annual rather than monthly, because the walk compounds yearly — a monthly
 * figure walked a year at a time would leave a remnant at the end of the term.
 */
export function loanPayment(principal, rateBps, years) {
  if (principal <= 0 || years <= 0) return 0;
  const rate = fromBps(rateBps);
  if (rate === 0) return principal / years;
  return (principal * rate) / (1 - (1 + rate) ** -years);
}

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
    if (!event.enabled || !FLOW_KINDS.has(event.kind)) continue;
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
  if (owing <= 0) return { short: 0, tax: 0, fromRetirement: 0 };
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
 * `pots` is today's cash, invested and retirement money, each a signed figure
 * as the balance sheet has it. `properties` is each property-band holding on
 * its own, `{ id, name, valueCents }`, because a sale names one; a bare
 * `pots.propertyCents` is still read, as one anonymous holding, for a caller
 * with nothing to sell. `debts` is each liability as a positive amount owed
 * with its nominal rate and monthly payment. Every flow is a yearly figure in
 * today's dollars.
 *
 * **A home is bought and sold in place, at the start of its year**, before the
 * debts are walked and before anything grows: a purchase adds the property,
 * takes the down payment and any closing costs out of cash, and opens a
 * mortgage paid off over its term; a sale takes the property out, pays its
 * costs and whatever loan it carried, and leaves the rest in cash. Sales come
 * before purchases, so a downsizing written as two events in one year can pay
 * for the second out of the first. **A mortgage opened here is paid on top of
 * the budget's spending**, unlike one already on the books — today's budget
 * cannot contain a payment that does not exist yet — and the rent it ends and
 * the costs of owning it run for as long as the walk holds the property.
 */
export function projectNetWorth({
  currentAge,
  retirementAge,
  lifeExpectancy,
  pots: startingPots = {},
  properties: startingProperties,
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
    rates,
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
  };
  const properties = (
    startingProperties ??
    (startingPots.propertyCents
      ? [{ id: "property", name: "Property", valueCents: startingPots.propertyCents }]
      : [])
  ).map((property) => ({
    id: property.id,
    name: property.name,
    value: property.valueCents ?? 0,
    ownership: 0,
    rentSaved: 0,
  }));
  const debts = startingDebts.map((debt) => ({
    id: debt.id,
    name: debt.name,
    owed: Math.max(0, debt.owedCents ?? 0),
    rate: realRate(debt.rateBps ?? 0, inflationRateBps),
    // Today's payment, a year of it. Fixed in nominal dollars from here on.
    payment: Math.max(0, debt.monthlyPaymentCents ?? 0) * 12,
    // Already on the books, so already one of the budget's categories.
    inBudget: true,
    // The year the payment was fixed in, for deflating it.
    since: 0,
  }));

  const enabled = events.filter((event) => event.enabled);
  const sales = enabled.filter((event) => event.kind === LIFE_EVENT_KINDS.SELL_PROPERTY);
  const purchases = enabled.filter((event) => event.kind === LIFE_EVENT_KINDS.BUY_PROPERTY);

  const warnings = [];
  const statedPayments = debts.reduce((sum, debt) => sum + debt.payment, 0);
  if (statedPayments > spendingCents && currentAge < retirementAge) {
    warnings.push(
      "Your debt payments come to more than your budget's spending estimates. The projection assumes the payments are part of that spending, so add them to a category on the budget plan."
    );
  }

  const propertyTotal = () => properties.reduce((sum, property) => sum + property.value, 0);
  const owedTotal = () => debts.reduce((sum, debt) => sum + debt.owed, 0);
  const liquid = () => pots.cash + pots.invested + pots.retirement;
  const assets = () => liquid() + propertyTotal();

  const snapshot = (age, phase) => ({
    age,
    phase,
    cashCents: round(pots.cash),
    investedCents: round(pots.invested),
    retirementCents: round(pots.retirement),
    propertyCents: round(propertyTotal()),
    debtCents: round(owedTotal()),
    liquidCents: round(liquid()),
    netCents: round(assets() - owedTotal()),
  });

  const series = [];
  const payoffs = [];
  // The first year each thing happened. An object rather than two `let`s, so
  // the per-year helper below closes over a constant and not a loop variable.
  const first = { shortfallAge: null, earlyWithdrawalAge: null };

  for (let age = currentAge; age < lifeExpectancy; age += 1) {
    const working = age < retirementAge;
    const elapsed = age - currentAge;
    const point = snapshot(age, working ? "saving" : "retired");
    const startNet = assets() - owedTotal();
    const startLiquid = liquid();
    const names = [];

    let incomeFlow = 0;
    let consumption = 0;
    let tax = 0;
    let growth = 0;
    let unfunded = 0;
    // Cash a purchase took or a sale returned this year — positive out —
    // which the outlook needs to tell a down payment from a living cost.
    let liquidity = 0;

    // Whatever cash cannot cover comes out of the other pots, in order.
    const cover = () => {
      if (pots.cash >= 0) return;
      const owing = -pots.cash;
      pots.cash = 0;
      const result = draw(pots, owing, retirementTax);
      tax += result.tax;
      unfunded += result.short;
      if (working && result.fromRetirement > 0 && first.earlyWithdrawalAge == null) {
        first.earlyWithdrawalAge = age;
      }
      if (result.short > SHORTFALL_TOLERANCE && first.shortfallAge == null) first.shortfallAge = age;
    };

    for (const sale of sales) {
      if (sale.startAge !== age) continue;
      const index = properties.findIndex((property) => property.id === sale.propertyRef);
      if (index < 0) continue;
      const property = properties[index];
      const cost = property.value * fromBps(sale.sellingCostBps ?? 0);
      // A home bought by an event carries the loan opened with it; one already
      // on the books names its mortgage, if it has one.
      const loan = debts.find((debt) => debt.id === (sale.debtRef ?? property.id));
      const owed = loan ? loan.owed : 0;
      const proceeds = property.value - cost - owed;
      pots.cash += proceeds;
      liquidity -= proceeds;
      consumption += cost;
      if (loan && loan.owed > 0) {
        loan.owed = 0;
        payoffs.push({ id: loan.id, name: loan.name, age, sold: true });
      }
      properties.splice(index, 1);
      names.push(sale.name);
    }

    for (const purchase of purchases) {
      if (purchase.startAge !== age) continue;
      const price = purchase.priceCents ?? 0;
      const down = Math.min(price, purchase.downPaymentCents ?? 0);
      const closing = purchase.oneTimeCents ?? 0;
      const loan = price - down;
      properties.push({
        id: purchase.id,
        name: purchase.name,
        value: price,
        ownership: purchase.annualCents ?? 0,
        rentSaved: purchase.rentSavedCents ?? 0,
      });
      if (loan > 0) {
        debts.push({
          id: purchase.id,
          name: `${purchase.name} mortgage`,
          owed: loan,
          rate: realRate(purchase.rateBps ?? 0, inflationRateBps),
          payment: loanPayment(loan, purchase.rateBps ?? 0, purchase.termYears ?? 30),
          inBudget: false,
          since: elapsed,
        });
      }
      pots.cash -= down + closing;
      liquidity += down + closing;
      consumption += closing;
      names.push(purchase.name);
    }
    cover();

    const ownership = properties.reduce((sum, property) => sum + property.ownership, 0);
    const rentSaved = properties.reduce((sum, property) => sum + property.rentSaved, 0);

    // The debts: what each charges and what it is paid this year. The payment
    // is the nominal figure fixed the year the loan began, made at the year's
    // end and deflated to today's dollars from there — the `+ 1` is what keeps
    // the real walk exactly the nominal amortisation, so a thirty-year loan
    // ends in its thirtieth year rather than being overpaid into an early one.
    let interest = 0;
    let paid = 0;
    let newPaid = 0;
    for (const debt of debts) {
      if (debt.owed <= 0) continue;
      const charged = debt.owed * debt.rate;
      const due = debt.owed + charged;
      let payment = Math.min(due, debt.payment / (1 + inflation) ** (elapsed - debt.since + 1));
      // A term's last payment can leave a fraction of a cent behind, from the
      // real rate being a float; paying it — not forgiving it — keeps the
      // payoff in the year the term says and the identity whole.
      if (payment > 0 && due - payment < 1) payment = due;
      debt.owed = due - payment;
      interest += charged;
      if (debt.inBudget) paid += payment;
      else newPaid += payment;
      // Exactly zero when the payment covered what was due — `due − due`.
      if (debt.owed === 0) payoffs.push({ id: debt.id, name: debt.name, age });
    }

    const happening = eventsAt(age, events);
    names.push(...happening.names);
    const housing = ownership - rentSaved;

    const grow = (investedRate) => {
      const propertyGrowth = propertyTotal() * rates.property;
      growth +=
        pots.cash * rates.cash +
        pots.invested * investedRate +
        pots.retirement * investedRate +
        propertyGrowth;
      pots.cash *= 1 + rates.cash;
      pots.invested *= 1 + investedRate;
      pots.retirement *= 1 + investedRate;
      for (const property of properties) property.value *= 1 + rates.property;
    };

    let drawn = null;
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
      // actually consumed is the rest of it; whatever those debts no longer
      // take comes back to cash. A mortgage opened since is paid on top.
      consumption += spendingCents - statedPayments + happening.expense + housing;
      const freed = statedPayments - paid;

      grow(rates.growth);
      pots.invested += saved;
      pots.retirement += afterTax + pretax;
      pots.cash +=
        takeHome +
        happening.income -
        spendingCents -
        happening.expense -
        housing -
        saved -
        afterTax +
        freed -
        newPaid;
      cover();
    } else {
      // Retired: the year's spending, whatever the debts still take, and the
      // costs of owning come out at the start, less any income the year
      // brings, then what is left grows. A year the income more than covers
      // leaves the rest in cash.
      incomeFlow = happening.income;
      consumption += retirementSpendingCents + happening.expense + housing;
      const needed =
        retirementSpendingCents + happening.expense + housing + paid + newPaid - happening.income;
      drawn = needed + liquidity;
      if (needed < 0) {
        pots.cash -= needed;
      } else {
        const result = draw(pots, needed, retirementTax);
        tax += result.tax;
        unfunded += result.short;
        if (result.short > SHORTFALL_TOLERANCE && first.shortfallAge == null) {
          first.shortfallAge = age;
        }
      }
      grow(rates.drawdown);
    }

    Object.assign(point, {
      events: names,
      incomeCents: round(incomeFlow),
      consumptionCents: round(consumption),
      taxCents: round(tax),
      interestCents: round(interest),
      growthCents: round(growth),
      unfundedCents: round(unfunded),
      // Unrounded, for the identity: a fifty-year walk rounded per year would
      // need a tolerance that grows with it, and a tolerance is where a real
      // leak hides. `drawn` is what a retired year asked of the liquid pots,
      // property moves included, which is what the outlook's need is made of.
      exact: {
        startNet,
        startLiquid,
        incomeFlow,
        consumption,
        tax,
        interest,
        growth,
        unfunded,
        drawn,
      },
    });
    series.push(point);
  }

  const end = snapshot(lifeExpectancy, "retired");
  end.events = [];
  end.exact = { startNet: assets() - owedTotal(), startLiquid: liquid() };
  series.push(end);

  return {
    ...base,
    ready: true,
    warnings,
    series,
    payoffs,
    shortfallAge: first.shortfallAge,
    earlyWithdrawalAge: first.earlyWithdrawalAge,
    startingLiquidCents: series[0].liquidCents,
    atRetirementCents: series.find((point) => point.age === retirementAge).netCents,
    atEndCents: end.netCents,
  };
}

/**
 * The retirement question, asked of the whole-balance-sheet walk: what the
 * household can spend from on the day work stops, against what retirement
 * will ask of it.
 *
 * **What is on course is the liquid money at the retirement age** — cash and
 * every investment, the retirement accounts among them — and never the house,
 * which is not something a year of groceries can be bought with until it is
 * sold. A sale planned for later in retirement is counted where it belongs:
 * as a year that asks the pots for less.
 *
 * **What is needed is every retired year's draw, discounted back to the first**
 * at the drawdown rate — an annuity due, `projectRetirement`'s shape, but over
 * the years the walk actually produces, so a pension, a mortgage still running
 * and a downsizing all move it. Grossed up for tax on the share of that money
 * held in pre-tax accounts, since a pre-tax dollar does not buy a dollar of
 * anything. With one pot and flat spending this is `requiredNestEgg` exactly,
 * which is what keeps the tripwire meaning what it always has: a pot of `need`
 * on the first day is a pot of zero on the last.
 *
 * `requiredContributionCents` is the yearly retirement saving that would close
 * the gap, as a total beside `currentContributionCents`, grown at the saving
 * rate over the years left to work. Null for someone retiring this year, who
 * has no years left to save in.
 */
export function retirementOutlook(projection, {
  currentAge,
  retirementAge,
  lifeExpectancy,
  retirementSpendingCents,
  retirementTaxRateBps = 0,
  currentContributionCents = 0,
}) {
  const issues = [...projection.issues];
  if (projection.ready && !(retirementSpendingCents > 0)) {
    issues.push("Say what you expect retirement to cost each year.");
  }
  const base = {
    ready: false,
    issues,
    realGrowthBps: projection.realRatesBps.growth,
    realDrawdownBps: projection.realRatesBps.drawdown,
    yearsToRetirement: null,
    yearsInRetirement: null,
    needCents: 0,
    projectedCents: 0,
    gapCents: 0,
    fundedRatio: 0,
    requiredContributionCents: null,
    depletionAge: null,
    fundedThroughAge: null,
    surplusCents: 0,
    startingCents: projection.startingLiquidCents ?? 0,
  };
  if (issues.length > 0) return base;

  const { growth: g, drawdown: d } = projection.rates;
  const retired = projection.series.filter(
    (point) => point.age >= retirementAge && point.age < lifeExpectancy
  );
  const discounted = retired.reduce(
    (sum, point, k) => sum + point.exact.drawn / (1 + d) ** k,
    0
  );

  const atRetirement = projection.series.find((point) => point.age === retirementAge);
  const projected = atRetirement.exact.startLiquid;
  const pretaxShare =
    projected > 0 ? Math.min(1, Math.max(0, atRetirement.retirementCents / projected)) : 1;
  const tax = Math.min(fromBps(retirementTaxRateBps), 0.99);
  const need = Math.max(0, discounted * (1 + pretaxShare * (tax / (1 - tax))));

  const years = retirementAge - currentAge;
  let required = null;
  if (years > 0) {
    const factor = Math.abs(g) < 1e-9 ? 1 / years : g / ((1 + g) ** years - 1);
    required = Math.max(0, currentContributionCents + (need - projected) * factor);
  }

  const end = projection.series[projection.series.length - 1];
  return {
    ...base,
    ready: true,
    yearsToRetirement: years,
    yearsInRetirement: lifeExpectancy - retirementAge,
    needCents: round(need),
    projectedCents: round(projected),
    gapCents: round(projected - need),
    fundedRatio: need > 0 ? projected / need : 1,
    requiredContributionCents: required == null ? null : round(required),
    depletionAge: projection.shortfallAge,
    fundedThroughAge: projection.shortfallAge ?? lifeExpectancy,
    surplusCents: end.liquidCents,
  };
}
