import { useMemo } from "react";
import { PLAN_BUCKETS, useBudgets } from "../contexts/BudgetsContext";
import { useIncomePlan } from "../contexts/IncomePlanContext";
import { useLifeEvents } from "../contexts/LifeEventsContext";
import {
  SPENDING_SOURCES,
  STARTING_SOURCES,
  useRetirement,
} from "../contexts/RetirementContext";
import useNetWorth, { HOLDING_CLASSES } from "./useNetWorth";
import { projectNetWorth, retirementOutlook } from "../netWorthProjection";
import { currentPeriod, fromBps } from "../utils";

/**
 * What the plan comes to: how much has to be there on the day work stops, how
 * much is on course to be, and the gap between them.
 *
 * The fourth hook that reads across stores, and the only one that reads a store
 * of guesses. It joins four of them — the plan's own assumptions, the accounts
 * ticked as retirement savings (at the value `useNetWorth` gives them, so a
 * holding valued by hand counts at the figure the user entered), the expected
 * income the spending target is a share of, and the **retirement** bucket of the
 * budget, which is half of what the contribution defaults to.
 *
 * **The default contribution has two halves, from two different places, because
 * pre-tax money and after-tax money take different paths into this app.** The
 * after-tax half is the retirement bucket, read off the budget the same way the
 * starting balance is read off the accounts — a category filed there is a
 * transaction the ledger already knows about. The pre-tax half (a 401(k)
 * deduction, most of the time) never reaches an on-budget account to become one,
 * so there is nothing for a bucket to read: `plan.pretaxContributionCents` is
 * the one figure on the whole page that has to be typed rather than derived —
 * see `RetirementContext`. The two are summed to form the default; a typed
 * override in "Saving each year" replaces the combined total, not just the
 * after-tax half. Nothing flows back either way: a scenario explored here
 * changes no envelope and no balance.
 *
 * **Everything is in today's dollars.** The spending target is a share of what
 * the household earns *now*, so the balance it is compared against has to be in
 * the same money — which means the projection does not grow at the nominal rate
 * the user typed. Both rates are deflated once, here:
 *
 *   real = (1 + nominal) / (1 + inflation) − 1
 *
 * Growing at a nominal seven percent and measuring against a target in today's
 * dollars is the single most flattering error this kind of tool makes: over
 * thirty years it overstates the balance by about half, and it does it silently.
 * The rates actually used are reported back so the page can print them beside
 * the ones that were entered.
 *
 * **Two rates, not one.** Money still being saved is a thirty-year bet and money
 * being lived on is next year's groceries, and the portfolios that hold them are
 * not the same portfolio. So the accumulation rate stops at the retirement age
 * and the drawdown rate takes over — see `DEFAULT_PLAN`.
 *
 *   need(S, n, d)  = S × (1 − (1+d)^−n) × (1+d) / d      ← an annuity due
 *   grow(b)        = b × (1+g) + C                        ← while saving
 *   spend(b)       = (b − S) × (1+d)                      ← once retired
 *
 * The withdrawal comes out at the *start* of the year and what is left grows,
 * because that is the order retirement happens in, and `need` is the closed form
 * that matches that recurrence exactly: a balance of `need` on the first day of
 * retirement is a balance of zero on the last. The tripwire in the tests asserts
 * exactly that, which is what stops the two drifting apart.
 *
 * **The series is the answer, and the figures are read off it.** The chart and
 * the headline cannot disagree about the balance at retirement, because the
 * headline *is* the series' value at that age. Only `need` and the contribution
 * required to reach it are closed forms, since neither has a simulation to read.
 */

/** Below this a rate is zero for the purposes of the closed forms, which divide
 *  by it. A hundredth of a basis point is far finer than anyone states a return
 *  to, so nothing a user can type lands in the gap. */
const FLAT = 1e-9;

/**
 * How far short a year's spending may fall before the money is called gone.
 *
 * A dollar, and the slack is not sloppiness. The walk carries fractional cents
 * so that a sixty-year projection does not accumulate sixty roundings, which
 * leaves a plan funded to exactly its target a fraction of a cent short of its
 * final withdrawal — the rounding of the starting figure to a whole cent, grown
 * for the length of the retirement. Reporting "your money runs out at 89" off
 * that would be a headline that flips on a rounding.
 *
 * A dollar is some four orders of magnitude below any shortfall a reader would
 * act on, and a real one is measured in years of spending, so nothing that
 * matters can hide under it.
 */
const SHORTFALL_TOLERANCE = 100;

/** The real rate left after inflation has taken its share. */
function realRate(nominalBps, inflationBps) {
  return (1 + fromBps(nominalBps)) / (1 + fromBps(inflationBps)) - 1;
}

/**
 * What has to be in the account on the first day of retirement to pay for `n`
 * years of `spending`, if what is left grows at `rate`.
 *
 * The present value of an annuity due — the first year's spending is not
 * discounted at all, because it is needed that morning. A flat rate degenerates
 * to the obvious answer, `n` years of spending, rather than dividing by zero.
 */
export function requiredNestEgg(spending, years, rate) {
  if (years <= 0 || spending <= 0) return 0;
  if (Math.abs(rate) < FLAT) return spending * years;
  return spending * (1 - (1 + rate) ** -years) * ((1 + rate) / rate);
}

/**
 * The yearly contribution that turns `starting` into `target` over `years`.
 *
 * The inverse of the accumulation recurrence, and `null` where there is no
 * question to answer: someone retiring this year has no years left to save in,
 * and no figure would make that plan work.
 */
function requiredContribution(target, starting, years, rate) {
  if (years <= 0) return null;
  const grown = starting * (1 + rate) ** years;
  if (Math.abs(rate) < FLAT) return Math.max(0, (target - grown) / years);
  return Math.max(0, ((target - grown) * rate) / ((1 + rate) ** years - 1));
}

const round = (value) => Math.round(value);

/**
 * The plan as a projection, from a plain object of resolved figures.
 *
 * A pure function beside its hook, as `accountBalancesAt` is: every figure here
 * is arithmetic on its arguments, and the tests drive it directly rather than
 * through six providers.
 */
export function projectRetirement({
  currentAge,
  retirementAge,
  lifeExpectancy,
  startingCents = 0,
  annualContributionCents = 0,
  annualSpendingCents = 0,
  growthRateBps,
  drawdownRateBps,
  inflationRateBps,
}) {
  const growth = realRate(growthRateBps, inflationRateBps);
  const drawdown = realRate(drawdownRateBps, inflationRateBps);

  // What the plan cannot answer yet, said as instructions rather than as
  // failures. Coherence is checked here rather than in the store because
  // refusing to save "3" on the way to "35" would make the plan uneditable —
  // see the note on `setRetirementPlan`.
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
  if (annualSpendingCents <= 0) {
    issues.push("Say what you expect retirement to cost each year.");
  }

  const base = {
    ready: false,
    issues,
    realGrowthBps: round(growth * 10000),
    realDrawdownBps: round(drawdown * 10000),
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
    series: [],
  };
  if (issues.length > 0) return base;

  const yearsToRetirement = retirementAge - currentAge;
  const yearsInRetirement = lifeExpectancy - retirementAge;

  const needCents = requiredNestEgg(annualSpendingCents, yearsInRetirement, drawdown);

  // The simulation, one point per birthday, carrying the balance at the *start*
  // of that year — before that year's contribution or withdrawal. Kept as
  // fractional cents throughout and rounded only on the way out, so a sixty-year
  // walk does not accumulate sixty roundings, and so the series and the closed
  // forms agree to the last cent.
  const series = [];
  let balance = startingCents;
  let depletionAge = null;

  for (let age = currentAge; age < retirementAge; age += 1) {
    series.push({ age, balanceCents: round(balance), phase: "saving" });
    balance = balance * (1 + growth) + annualContributionCents;
  }

  const projectedCents = balance;

  for (let age = retirementAge; age < lifeExpectancy; age += 1) {
    series.push({ age, balanceCents: round(balance), phase: "retired" });
    // The money runs out during the year it cannot pay for in full. The balance
    // is floored at zero rather than allowed to go negative: a projection that
    // draws a portfolio below the axis is drawing a debt nobody took on.
    if (balance < annualSpendingCents - SHORTFALL_TOLERANCE) {
      if (depletionAge == null) depletionAge = age;
      balance = 0;
    } else {
      // Clamped as well as floored above, because a year inside the tolerance
      // can end a cent under. Nothing real hides here — a shortfall worth
      // naming took the branch above — and the invariant is worth having whole:
      // no point on this chart is ever below the axis.
      balance = Math.max(0, (balance - annualSpendingCents) * (1 + drawdown));
    }
  }
  series.push({ age: lifeExpectancy, balanceCents: round(balance), phase: "retired" });

  return {
    ...base,
    ready: true,
    yearsToRetirement,
    yearsInRetirement,
    needCents: round(needCents),
    projectedCents: round(projectedCents),
    gapCents: round(projectedCents - needCents),
    // What share of the target the plan is on course to reach. Reported rather
    // than derived at each call site so the gauge and the sentence beside it
    // cannot round differently.
    fundedRatio: needCents > 0 ? projectedCents / needCents : 1,
    requiredContributionCents: (() => {
      const figure = requiredContribution(needCents, startingCents, yearsToRetirement, growth);
      return figure == null ? null : round(figure);
    })(),
    depletionAge,
    fundedThroughAge: depletionAge ?? lifeExpectancy,
    surplusCents: round(balance),
    series,
  };
}

/**
 * The plan, its inputs resolved from the rest of the app, and the projection
 * they come to.
 *
 * The resolution is the reason this is a hook and not four call sites: each of
 * the three seeded figures has a real answer somewhere in the books, and reading
 * them here means the page shows one figure and the maths uses the same one.
 */
export default function useRetirementProjection() {
  const { plan } = useRetirement();
  const { budgets } = useBudgets();
  const { expectedMonthlyCents } = useIncomePlan();
  const { events } = useLifeEvents();

  // One month, not the chart's twelve: all this needs is what each account is
  // worth today, and `useNetWorth` is the only definition of that.
  const { rows } = useNetWorth(currentPeriod(), { months: 1 });

  return useMemo(() => {
    const included = new Set(plan.accountIds);
    const accountRows = rows.map((row) => ({
      account: row.account,
      valueCents: row.valueCents,
      included: included.has(row.account.id),
      // Where the figure came from matters here as much as on the net-worth
      // page: an account last valued in March is being counted at March's
      // figure, and a plan built on it should say so.
      hand: row.hand,
      asOf: row.asOf,
    }));

    // Signed, so a liability someone chooses to count — a loan against the
    // portfolio — subtracts, on the one sign convention the balance sheet uses
    // everywhere else.
    const selectedCents = accountRows
      .filter((row) => row.included)
      .reduce((sum, row) => sum + row.valueCents, 0);

    const startingCents =
      plan.startingSource === STARTING_SOURCES.MANUAL
        ? plan.startingBalanceCents ?? 0
        : selectedCents;

    const incomeAnnualCents = expectedMonthlyCents * 12;
    const shareSpendingCents = Math.round(incomeAnnualCents * fromBps(plan.incomeShareBps));
    const annualSpendingCents =
      plan.spendingSource === SPENDING_SOURCES.MANUAL
        ? plan.annualSpendingCents ?? 0
        : shareSpendingCents;

    // What the budget already puts aside for retirement specifically,
    // annualised — the retirement bucket is the app's existing answer to "what
    // am I setting aside for this", so a plan that has not been told otherwise
    // uses it rather than assuming nothing is being saved. Deliberately not the
    // savings bucket: a house deposit or emergency fund sits there too, and
    // counting it here would overstate what is actually earmarked for
    // retirement. This is only the after-tax half — see the doc comment above.
    const budgetContributionCents =
      budgets
        .filter((budget) => budget.bucket === PLAN_BUCKETS.RETIREMENT)
        .reduce((sum, budget) => sum + budget.plannedCents, 0) * 12;
    // The pre-tax half: typed, never derived, and simply zero for a household
    // with no payroll retirement plan.
    const pretaxContributionCents = plan.pretaxContributionCents ?? 0;
    const plannedContributionCents = budgetContributionCents + pretaxContributionCents;
    const annualContributionCents = plan.annualContributionCents ?? plannedContributionCents;

    // ── The whole balance sheet, for `projectNetWorth` ──
    //
    // Every account lands in exactly one pot, so the projection starts from
    // the same net worth the Net worth page shows today. A liability is a debt
    // whatever the plan says about it; a ticked asset is retirement money; the
    // rest go to their band. With a typed starting figure the ticked accounts
    // are back in their bands and the figure is the retirement pot — it stands
    // for money the app does not track, so nothing it covers is counted twice.
    const byAccounts = plan.startingSource !== STARTING_SOURCES.MANUAL;
    const pots = {
      cashCents: 0,
      investedCents: 0,
      retirementCents: byAccounts ? 0 : plan.startingBalanceCents ?? 0,
    };
    // Each property on its own, because a sale names one.
    const properties = [];
    const debtRows = [];
    for (const row of rows) {
      if (row.band === HOLDING_CLASSES.DEBT) {
        const assumption = plan.debtAssumptions[row.account.id] ?? {
          rateBps: 0,
          monthlyPaymentCents: 0,
        };
        debtRows.push({
          account: row.account,
          owedCents: Math.max(0, -row.valueCents),
          ...assumption,
        });
      } else if (byAccounts && included.has(row.account.id)) {
        pots.retirementCents += row.valueCents;
      } else if (row.band === HOLDING_CLASSES.CASH) {
        pots.cashCents += row.valueCents;
      } else if (row.band === HOLDING_CLASSES.INVESTED) {
        pots.investedCents += row.valueCents;
      } else {
        properties.push({ id: row.account.id, name: row.account.name, valueCents: row.valueCents });
      }
    }

    // The budget's estimates, a year of each. Everything that is not saving is
    // spending — essentials and fun, and any category in no bucket at all.
    const bucketTotal = (bucket) =>
      budgets
        .filter((budget) => budget.bucket === bucket)
        .reduce((sum, budget) => sum + budget.plannedCents, 0) * 12;
    const savingsCents = bucketTotal(PLAN_BUCKETS.SAVINGS);
    const spendingCents =
      budgets.reduce((sum, budget) => sum + budget.plannedCents, 0) * 12 -
      savingsCents -
      budgetContributionCents;
    // The contribution is split back into its two halves, because only one of
    // them comes out of take-home pay. An override replaces the total; the
    // pretax part of it is what payroll takes, the rest comes from the budget.
    const pretaxRetirementCents = Math.min(pretaxContributionCents, annualContributionCents);
    const afterTaxRetirementCents = annualContributionCents - pretaxRetirementCents;

    const netWorth = projectNetWorth({
      currentAge: plan.currentAge,
      retirementAge: plan.retirementAge,
      lifeExpectancy: plan.lifeExpectancy,
      pots,
      properties,
      debts: debtRows.map((row) => ({
        id: row.account.id,
        name: row.account.name,
        owedCents: row.owedCents,
        rateBps: row.rateBps,
        monthlyPaymentCents: row.monthlyPaymentCents,
      })),
      income: {
        source: plan.incomeSource,
        takeHomeAnnualCents: incomeAnnualCents,
        growthRateBps: plan.incomeGrowthRateBps,
        salaries: plan.salaries,
        workingTaxRateBps: plan.workingTaxRateBps,
      },
      spendingCents,
      savingsCents,
      afterTaxRetirementCents,
      pretaxRetirementCents,
      retirementSpendingCents: annualSpendingCents,
      retirementTaxRateBps: plan.retirementTaxRateBps,
      growthRateBps: plan.growthRateBps,
      drawdownRateBps: plan.drawdownRateBps,
      inflationRateBps: plan.inflationRateBps,
      cashRateBps: plan.cashRateBps,
      propertyRateBps: plan.propertyRateBps,
      events,
    });

    return {
      plan,
      accountRows,
      // Every resolved input, reported alongside the projection so the page can
      // show its working: which figure was used, and whether it was seeded or
      // typed.
      inputs: {
        startingCents,
        selectedCents,
        incomeAnnualCents,
        shareSpendingCents,
        annualSpendingCents,
        annualContributionCents,
        budgetContributionCents,
        pretaxContributionCents,
        plannedContributionCents,
        contributionSeeded: plan.annualContributionCents == null,
        spendingCents,
        savingsCents,
        pots,
      },
      debtRows,
      netWorth,
      // What a sale or a purchase can name.
      propertyOptions: properties.map((property) => ({ id: property.id, name: property.name })),
      debtOptions: debtRows.map((row) => ({ id: row.account.id, name: row.account.name })),
      // The retirement question, asked of the whole balance sheet: see
      // `retirementOutlook`. `projectRetirement` above is no longer what the
      // page reads; it stays as the pure function the reproduction tripwire
      // in `netWorthProjection.test.js` holds the new walk to.
      projection: retirementOutlook(netWorth, {
        currentAge: plan.currentAge,
        retirementAge: plan.retirementAge,
        lifeExpectancy: plan.lifeExpectancy,
        retirementSpendingCents: annualSpendingCents,
        retirementTaxRateBps: plan.retirementTaxRateBps,
        currentContributionCents: annualContributionCents,
      }),
    };
  }, [plan, rows, budgets, expectedMonthlyCents, events]);
}
