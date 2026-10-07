import React, { useCallback, useContext, useMemo } from "react";
import { v4 as uuidV4 } from "uuid";
import useSyncedState from "../hooks/useSyncedState";
import { INCOME_SOURCES } from "../netWorthProjection";
import { toBps, toCents } from "../utils";

/**
 * The retirement plan: when the user intends to stop working, what they intend
 * to live on, and what they are counting on to pay for it.
 *
 * A store of its own, outside the books, and the separation is the point. Every
 * other figure in the app is a record of something that happened or a standing
 * fact about the household; this is a set of *guesses*, and a scenario explored
 * here must never write back to the ledger. The projection reads across the
 * stores — see `src/hooks/useRetirementProjection.js` — but nothing flows the
 * other way.
 *
 * **Two questions here have two legitimate answers each, and both are stored.**
 * The starting point is either a set of accounts the user counts as retirement
 * money or a figure they type; retirement spending is either a share of what
 * they earn now or a figure they type. A `source` field says which answer is in
 * force, and the other one is kept rather than cleared — toggling back and forth
 * to compare is the whole point of a planning screen, and a toggle that destroys
 * the answer it toggles away from can only be used once.
 *
 * A single record with a `null`-means-unstated convention, like
 * `PayScheduleContext`, and validated the same way: each field on its own, so
 * half a plan is a real intermediate state. Coherence between fields — retiring
 * before you were born — is *not* checked here. It is reported by the projection
 * as something it cannot answer yet, because refusing the field the user just
 * typed is the one response that makes the plan impossible to edit into shape.
 *
 * **`pretaxContributionCents` is the one figure here with no bucket to fall
 * back on.** Everything else the projection reads either comes from an account
 * (`useNetWorth`), an income source, or the budget's own retirement bucket
 * (`PLAN_BUCKETS.RETIREMENT`) — but a 401(k) deduction leaves a paycheque
 * before it ever reaches an on-budget account, so it never becomes a
 * transaction and never gets categorised. This field is where that half of the
 * contribution enters the plan; `useRetirementProjection` adds it to the
 * retirement bucket's total to form the default `annualContributionCents`.
 */
const RetirementContext = React.createContext();

/** Where the money at the start of the projection comes from. */
export const STARTING_SOURCES = {
  /** The accounts the user has ticked as retirement savings, at today's value. */
  ACCOUNTS: "accounts",
  /** A figure typed in, for money the app does not track. */
  MANUAL: "manual",
};

/** How the retirement spending figure is arrived at. */
export const SPENDING_SOURCES = {
  /** A share of what the household earns now — the usual rule of thumb. */
  INCOME_SHARE: "income-share",
  /** A figure typed in, for a retirement that looks nothing like today. */
  MANUAL: "manual",
};

// Owned by the projection module, which cannot import a context; re-exported
// here so the page reads every source enum from the store that keeps the answer.
export { INCOME_SOURCES };

const STARTING_SOURCE_VALUES = Object.values(STARTING_SOURCES);
const INCOME_SOURCE_VALUES = Object.values(INCOME_SOURCES);
const SPENDING_SOURCE_VALUES = Object.values(SPENDING_SOURCES);

// An age has to be a whole number of years on a human scale. The bounds only
// have to exclude nonsense — a life expectancy of 130 is a plan nobody is
// making, and 0 as a retirement age would divide the projection by no years.
export const MIN_AGE = 0;
export const MAX_AGE = 120;

// Rates are bounded at zero and at fifty percent. Below zero is not a plan, it
// is a prediction of ruin dressed as an assumption; above fifty is not a rate
// anyone sustains, and the compounding would run the chart off its axis.
export const MAX_RATE_BPS = 5000;

// A retirement that costs twice today's income is a real answer — a mortgage
// paid off and a lot of travel — but ten times over is a typo.
export const MAX_SHARE_BPS = 20000;

/**
 * What the plan is before anyone touches it.
 *
 * The rates carry real defaults rather than nulls, because unlike an age they
 * have a defensible standing answer and a blank one would leave the page with
 * nothing to draw. Ten percent while the money is still working and five and a
 * half once it is being lived on: the same portfolio is usually moved out of
 * equities as it stops being a thirty-year bet and starts being next year's
 * groceries, and a projection that grows a retiree's savings at the accumulation
 * rate is the single most flattering mistake this kind of tool makes.
 *
 * **These three are nominal — the figures before inflation takes its share** —
 * which is why the first is ten and not the seven a saver usually quotes. Seven
 * is the long-run *real* return of a stock market, already net of inflation, and
 * this projection deflates what it is given rather than assuming it has been
 * deflated already. Entering seven here would take the haircut twice. The pair
 * is set so that what comes out the other side is the seven and three a planner
 * actually means: roughly seven percent real while saving and three real once
 * retired. The panel says so at the head of the block and prints the real rate
 * under each field, because a rate that means one thing to the reader and
 * another to the maths is the whole error this design exists to avoid.
 *
 * Inflation is here for the same reason. Every figure this app shows is in
 * today's dollars, and the spending target — a share of today's income — is
 * emphatically in today's dollars; growing the balance at a nominal rate and
 * comparing it against that target would overstate a thirty-year plan by about
 * half. So the projection deflates both rates by this one, and reports what it
 * used.
 *
 * `lifeExpectancy` gets a default and the other two ages do not, because it is
 * the one age here the user is not stating a fact about: it is an assumption,
 * and ninety is the conventional conservative one. Their current age and the age
 * they want to stop working are theirs to say.
 */
export const DEFAULT_PLAN = {
  currentAge: null,
  retirementAge: null,
  lifeExpectancy: 90,

  startingSource: STARTING_SOURCES.ACCOUNTS,
  // Empty rather than "everything off budget": which accounts are retirement
  // money is a judgement — a brokerage may be a house deposit — and guessing it
  // would put a figure on screen the user never agreed to.
  accountIds: [],
  startingBalanceCents: null,

  spendingSource: SPENDING_SOURCES.INCOME_SHARE,
  incomeShareBps: 7000,
  annualSpendingCents: null,

  // Pre-tax payroll deductions — a 401(k) match, most of them — never reach an
  // on-budget account, so there is no category and no bucket for the projection
  // to read this off of the way it reads the after-tax half. It is the one
  // contribution figure on this page that has to be typed rather than derived,
  // and `null` means none rather than "not yet known": most years it really is
  // zero for a household with no payroll plan, and treating a blank as unstated
  // would understate every projection until the user found this field.
  pretaxContributionCents: null,

  // `null` means "whatever the plan already sets aside" — the retirement
  // bucket plus `pretaxContributionCents` above, read by the projection. A
  // typed figure overrides the **combined** total, not just the after-tax half.
  // Same convention as the two `source` fields, expressed with a null because
  // there is no second answer worth keeping: the plan's own figure is always
  // available.
  annualContributionCents: null,

  growthRateBps: 1000,
  drawdownRateBps: 550,
  inflationRateBps: 250,

  // ── The whole-balance-sheet projection (`src/netWorthProjection.js`) ──
  //
  // **What the working years earn has two legitimate answers, and both are
  // kept**, the starting point's rule: today's take-home grown by a rate, or
  // gross salaries stated by age. Comparing "three percent a year" against
  // "the promotion at 38" is the point, and a switch that cleared the salaries
  // could only be used once. Growth is the default because it needs nothing
  // typed — today's take-home is already on the budget plan.
  incomeSource: INCOME_SOURCES.GROWTH,
  // Nominal, like every rate here, and deflated by the projection — three
  // percent is a raise of about half a point a year in today's dollars.
  incomeGrowthRateBps: 300,
  // `{ id, fromAge, grossCents }`, a salary in force from that age until the
  // next one starts or work stops. **In today's dollars**, like every figure on
  // the page: "$150,000 at 45" means what $150,000 buys now.
  salaries: [],
  // What a gross salary loses to tax on its way to take-home, as one effective
  // rate — not a bracket table, the line `useGiving` draws at a tax calculation.
  // Read only when salaries are in force; take-home is already net of it.
  workingTaxRateBps: 2200,
  // What a dollar out of the retirement accounts loses to tax. Without it a
  // pre-tax 401(k) would read as buying a dollar of groceries per dollar held.
  retirementTaxRateBps: 1200,
  // Cash at the inflation rate holds its value and earns nothing real, which is
  // close to what a savings account does over a decade.
  cashRateBps: 250,
  // Property a point above inflation: the long-run real appreciation of a home,
  // before upkeep.
  propertyRateBps: 350,
  // Per liability: `{ rateBps, monthlyPaymentCents }`, keyed by account id. A
  // guess about the future, so it lives here rather than on the account, which
  // is a statement of fact. **Inert but kept** for a deleted account — the
  // projection only asks about the liabilities that exist.
  debtAssumptions: {},
};

export function useRetirement() {
  return useContext(RetirementContext);
}

const isAge = (value) => Number.isInteger(value) && value >= MIN_AGE && value <= MAX_AGE;
const isRate = (value) => Number.isInteger(value) && value >= 0 && value <= MAX_RATE_BPS;
const isShare = (value) => Number.isInteger(value) && value >= 0 && value <= MAX_SHARE_BPS;
const isAmount = (value) => Number.isInteger(value) && value >= 0;

const isSalary = (salary) =>
  salary &&
  typeof salary === "object" &&
  typeof salary.id === "string" &&
  isAge(salary.fromAge) &&
  isAmount(salary.grossCents);

const isDebtAssumption = (entry) =>
  entry && typeof entry === "object" && isRate(entry.rateBps) && isAmount(entry.monthlyPaymentCents);

/** One salary per starting age: two that start together would leave which one
 *  is in force to the order they happen to be stored in. */
function sortSalaries(salaries) {
  return [...salaries].sort((a, b) => a.fromAge - b.fromAge);
}

/**
 * A whole-value guard rather than a field-presence migration.
 *
 * The same choice as `PayScheduleContext`, for the same reason — this is one
 * record, not a list of them. Anything unreadable reads as "not set up yet",
 * which is the only safe reading of a projection's inputs: a rate that arrived
 * as the string "7" rather than 700 basis points would otherwise compound at
 * seven hundredths of a percent and quietly halve a thirty-year answer.
 *
 * The key is `retirementPlan` rather than the scaffold's `retirementAssumptions`,
 * which held a different shape entirely — rates as fractions, one portfolio
 * figure, a withdrawal rate this plan has no use for. Nothing ever wrote to it,
 * so there is no history to carry; it is left in storage rather than deleted, as
 * the `income` and `expenses` keys are, because a migration that destroys data
 * has no way to undo itself.
 */
export function migratePlan(stored) {
  const plan = stored && typeof stored === "object" ? stored : {};
  const take = (value, ok, fallback) => (ok(value) ? value : fallback);

  return {
    currentAge: take(plan.currentAge, isAge, null),
    retirementAge: take(plan.retirementAge, isAge, null),
    lifeExpectancy: take(plan.lifeExpectancy, isAge, DEFAULT_PLAN.lifeExpectancy),

    startingSource: STARTING_SOURCE_VALUES.includes(plan.startingSource)
      ? plan.startingSource
      : DEFAULT_PLAN.startingSource,
    accountIds: Array.isArray(plan.accountIds)
      ? [...new Set(plan.accountIds.filter((id) => typeof id === "string"))]
      : [],
    startingBalanceCents: take(plan.startingBalanceCents, isAmount, null),

    spendingSource: SPENDING_SOURCE_VALUES.includes(plan.spendingSource)
      ? plan.spendingSource
      : DEFAULT_PLAN.spendingSource,
    incomeShareBps: take(plan.incomeShareBps, isShare, DEFAULT_PLAN.incomeShareBps),
    annualSpendingCents: take(plan.annualSpendingCents, isAmount, null),

    pretaxContributionCents: take(plan.pretaxContributionCents, isAmount, null),
    annualContributionCents: take(plan.annualContributionCents, isAmount, null),

    growthRateBps: take(plan.growthRateBps, isRate, DEFAULT_PLAN.growthRateBps),
    drawdownRateBps: take(plan.drawdownRateBps, isRate, DEFAULT_PLAN.drawdownRateBps),
    inflationRateBps: take(plan.inflationRateBps, isRate, DEFAULT_PLAN.inflationRateBps),

    incomeSource: INCOME_SOURCE_VALUES.includes(plan.incomeSource)
      ? plan.incomeSource
      : DEFAULT_PLAN.incomeSource,
    incomeGrowthRateBps: take(plan.incomeGrowthRateBps, isRate, DEFAULT_PLAN.incomeGrowthRateBps),
    salaries: Array.isArray(plan.salaries) ? sortSalaries(plan.salaries.filter(isSalary)) : [],
    workingTaxRateBps: take(plan.workingTaxRateBps, isRate, DEFAULT_PLAN.workingTaxRateBps),
    retirementTaxRateBps: take(plan.retirementTaxRateBps, isRate, DEFAULT_PLAN.retirementTaxRateBps),
    cashRateBps: take(plan.cashRateBps, isRate, DEFAULT_PLAN.cashRateBps),
    propertyRateBps: take(plan.propertyRateBps, isRate, DEFAULT_PLAN.propertyRateBps),
    debtAssumptions:
      plan.debtAssumptions && typeof plan.debtAssumptions === "object"
        ? Object.fromEntries(
            Object.entries(plan.debtAssumptions).filter(([, entry]) => isDebtAssumption(entry))
          )
        : {},
  };
}

/** Blank means "not stated", which is a real answer for every nullable field
 *  here — and distinct from zero, which is a plan to save nothing. */
const isBlank = (value) => value === null || value === undefined || String(value).trim() === "";

/**
 * Read one salary from what a form sent: an age and a gross figure, both
 * required. A salary with no age is not "from now" — it is a row half filled
 * in, and storing it would put a figure in force from an age nobody stated.
 */
const readSalary = (fromAge, gross) => {
  if (isBlank(fromAge) || !isAge(Number(fromAge))) {
    return { error: `Enter the age a salary starts as a whole number, ${MIN_AGE} to ${MAX_AGE}.` };
  }
  const grossCents = isBlank(gross) ? null : toCents(gross);
  if (grossCents == null || grossCents < 0) {
    return { error: "Enter the salary as a yearly amount of zero or more." };
  }
  return { fromAge: Number(fromAge), grossCents };
};

/** Two salaries starting at one age is refused — see `sortSalaries`. */
const clashMessage = (age) => `There is already a salary starting at ${age}.`;

export const RetirementProvider = ({ children }) => {
  const [plan, setPlan] = useSyncedState("retirementPlan", DEFAULT_PLAN, migratePlan);

  /**
   * Patch the plan. Fields left `undefined` are left alone, so each input on the
   * page can commit on its own blur without the rest having been filled in.
   *
   * Every field is checked in isolation and the first failure stops the write —
   * a patch lands whole or not at all, so a form that sends two fields cannot
   * store one of them and report an error about the other.
   */
  const setRetirementPlan = useCallback(
    (changes) => {
      const patch = {};

      const age = (field, label) => {
        const value = changes[field];
        if (value === undefined) return null;
        if (isBlank(value)) {
          patch[field] = null;
          return null;
        }
        const years = Number(value);
        if (!isAge(years)) {
          return `Enter ${label} as a whole number of years, ${MIN_AGE} to ${MAX_AGE}.`;
        }
        patch[field] = years;
        return null;
      };

      const rate = (field, label) => {
        const value = changes[field];
        if (value === undefined) return null;
        // A rate has no "unstated" state — the projection has to grow the money
        // at something — so a cleared field reads as zero rather than as null.
        const bps = isBlank(value) ? 0 : toBps(value);
        if (bps == null || !isRate(bps)) {
          return `Enter ${label} as a percentage between 0 and ${MAX_RATE_BPS / 100}.`;
        }
        patch[field] = bps;
        return null;
      };

      const amount = (field, label) => {
        const value = changes[field];
        if (value === undefined) return null;
        if (isBlank(value)) {
          patch[field] = null;
          return null;
        }
        const cents = toCents(value);
        if (cents == null || cents < 0) return `Enter ${label} as an amount of zero or more.`;
        patch[field] = cents;
        return null;
      };

      const error =
        age("currentAge", "your age today") ??
        age("retirementAge", "the age you want to retire") ??
        age("lifeExpectancy", "how long you want the money to last") ??
        rate("growthRateBps", "the return while you are saving") ??
        rate("drawdownRateBps", "the return once you have retired") ??
        rate("inflationRateBps", "inflation") ??
        rate("incomeGrowthRateBps", "how fast your pay grows") ??
        rate("workingTaxRateBps", "the tax on your salary") ??
        rate("retirementTaxRateBps", "the tax on retirement withdrawals") ??
        rate("cashRateBps", "the return on cash") ??
        rate("propertyRateBps", "how fast property appreciates") ??
        amount("startingBalanceCents", "your starting balance") ??
        amount("annualSpendingCents", "yearly spending in retirement") ??
        amount("pretaxContributionCents", "your pretax retirement contributions") ??
        amount("annualContributionCents", "what you put away each year");
      if (error) return { ok: false, error };

      if (changes.incomeShareBps !== undefined) {
        const bps = isBlank(changes.incomeShareBps) ? 0 : toBps(changes.incomeShareBps);
        if (bps == null || !isShare(bps)) {
          return {
            ok: false,
            error: `Enter a share of your income between 0 and ${MAX_SHARE_BPS / 100} percent.`,
          };
        }
        patch.incomeShareBps = bps;
      }

      if (changes.startingSource !== undefined) {
        if (!STARTING_SOURCE_VALUES.includes(changes.startingSource)) {
          return { ok: false, error: "Choose where your starting balance comes from." };
        }
        patch.startingSource = changes.startingSource;
      }

      if (changes.incomeSource !== undefined) {
        if (!INCOME_SOURCE_VALUES.includes(changes.incomeSource)) {
          return { ok: false, error: "Choose how your future income is worked out." };
        }
        patch.incomeSource = changes.incomeSource;
      }

      if (changes.spendingSource !== undefined) {
        if (!SPENDING_SOURCE_VALUES.includes(changes.spendingSource)) {
          return { ok: false, error: "Choose how your retirement spending is worked out." };
        }
        patch.spendingSource = changes.spendingSource;
      }

      if (changes.accountIds !== undefined) {
        if (!Array.isArray(changes.accountIds)) {
          return { ok: false, error: "Choose which accounts are retirement savings." };
        }
        // Deduped, and never checked against the account list: an account may be
        // deleted and the id left behind, which the projection reads as an
        // account contributing nothing. Refusing an unknown id here would mean
        // this store reaching into another one, which is the dependency the
        // provider order exists to keep out.
        patch.accountIds = [...new Set(changes.accountIds.filter((id) => typeof id === "string"))];
      }

      // Functional updater, not the closed-over record: index.js renders under
      // StrictMode, which invokes the updater twice.
      setPlan((previous) => ({ ...previous, ...patch }));
      return { ok: true };
    },
    [setPlan]
  );

  /** Tick or untick one account as retirement money. A mutator of its own so a
   *  row does not have to know the whole list to change its own state. */
  const toggleRetirementAccount = useCallback(
    ({ accountId, included }) => {
      setPlan((previous) => {
        const rest = previous.accountIds.filter((id) => id !== accountId);
        return { ...previous, accountIds: included ? [...rest, accountId] : rest };
      });
      return { ok: true };
    },
    [setPlan]
  );

  const addSalary = useCallback(
    ({ fromAge, gross }) => {
      const salary = readSalary(fromAge, gross);
      if (salary.error) return { ok: false, error: salary.error };
      if (plan.salaries.some((entry) => entry.fromAge === salary.fromAge)) {
        return { ok: false, error: clashMessage(salary.fromAge) };
      }
      setPlan((previous) => ({
        ...previous,
        salaries: sortSalaries([...previous.salaries, { id: uuidV4(), ...salary }]),
      }));
      return { ok: true };
    },
    [plan.salaries, setPlan]
  );

  /** Patch one salary. Both fields are re-read, so a row sends what it shows. */
  const updateSalary = useCallback(
    ({ id, fromAge, gross }) => {
      const existing = plan.salaries.find((entry) => entry.id === id);
      // Refused rather than reported as landed: a salary removed on another
      // device can still be on screen here.
      if (!existing) return { ok: false, error: "That salary is no longer in the plan." };
      const salary = readSalary(
        fromAge ?? existing.fromAge,
        gross ?? (existing.grossCents / 100).toFixed(2)
      );
      if (salary.error) return { ok: false, error: salary.error };
      if (plan.salaries.some((entry) => entry.id !== id && entry.fromAge === salary.fromAge)) {
        return { ok: false, error: clashMessage(salary.fromAge) };
      }
      setPlan((previous) => ({
        ...previous,
        salaries: sortSalaries(
          previous.salaries.map((entry) => (entry.id === id ? { ...entry, ...salary } : entry))
        ),
      }));
      return { ok: true };
    },
    [plan.salaries, setPlan]
  );

  const removeSalary = useCallback(
    (id) => {
      setPlan((previous) => ({
        ...previous,
        salaries: previous.salaries.filter((entry) => entry.id !== id),
      }));
      return { ok: true };
    },
    [setPlan]
  );

  /**
   * What one liability is expected to charge and be paid. A blank rate or
   * payment reads as zero — a debt has to be walked at *something*, and zero
   * is the honest reading of "not stated": it is held at its nominal figure.
   */
  const setDebtAssumption = useCallback(
    ({ accountId, rate, monthlyPayment }) => {
      if (typeof accountId !== "string") return { ok: false, error: "Choose a debt." };
      const current = plan.debtAssumptions[accountId] ?? { rateBps: 0, monthlyPaymentCents: 0 };
      const next = { ...current };

      if (rate !== undefined) {
        const bps = isBlank(rate) ? 0 : toBps(rate);
        if (bps == null || !isRate(bps)) {
          return { ok: false, error: `Enter the interest rate as a percentage between 0 and ${MAX_RATE_BPS / 100}.` };
        }
        next.rateBps = bps;
      }
      if (monthlyPayment !== undefined) {
        const cents = isBlank(monthlyPayment) ? 0 : toCents(monthlyPayment);
        if (cents == null || cents < 0) {
          return { ok: false, error: "Enter the monthly payment as an amount of zero or more." };
        }
        next.monthlyPaymentCents = cents;
      }

      setPlan((previous) => ({
        ...previous,
        debtAssumptions: { ...previous.debtAssumptions, [accountId]: next },
      }));
      return { ok: true };
    },
    [plan.debtAssumptions, setPlan]
  );

  const resetRetirementPlan = useCallback(() => setPlan(DEFAULT_PLAN), [setPlan]);

  /**
   * Put a whole plan in force — a saved scenario being used. Read through the
   * same guard as storage, so a scenario saved by an older build gains the
   * fields it predates rather than writing holes into the plan.
   */
  const replaceRetirementPlan = useCallback(
    (next) => {
      setPlan(migratePlan(next));
      return { ok: true };
    },
    [setPlan]
  );

  // Memoised so a change in any other store does not re-render every consumer
  // of this one.
  const value = useMemo(
    () => ({
      plan,
      setRetirementPlan,
      toggleRetirementAccount,
      addSalary,
      updateSalary,
      removeSalary,
      setDebtAssumption,
      resetRetirementPlan,
      replaceRetirementPlan,
    }),
    [
      plan,
      setRetirementPlan,
      toggleRetirementAccount,
      addSalary,
      updateSalary,
      removeSalary,
      setDebtAssumption,
      resetRetirementPlan,
      replaceRetirementPlan,
    ]
  );

  return <RetirementContext.Provider value={value}>{children}</RetirementContext.Provider>;
};
