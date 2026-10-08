import { useMemo } from "react";
import { ACCOUNT_SCOPES } from "../contexts/AccountsContext";
import { PLAN_BUCKETS } from "../contexts/BudgetsContext";
import { TARGET_SOURCES, useEmergencyFundPlan } from "../contexts/EmergencyFundContext";
import useNetWorth from "./useNetWorth";
import usePlanHealth from "./usePlanHealth";
import { currentPeriod } from "../utils";

/**
 * How much the household would need to carry itself with no income, and how much
 * of it is actually there.
 *
 * The **eighth** hook that reads across stores, and the join it owns is between
 * the two halves of the app that have never met: the plan says what a necessary
 * month costs, the balance sheet says what is in the savings account, and an
 * emergency fund is a statement about both at once. Neither store can hold the
 * answer — `EmergencyFundContext` keeps the *question* (how many months, which
 * accounts) and nothing else.
 *
 * ```
 * monthlyEssentials = Σ plannedCents of every category counting as essentials
 * derivedTarget     = monthlyEssentials × monthsCovered
 * target            = derivedTarget, or the typed figure when that is in force
 * counted(a)        = valueCents(a), or min(part set aside, valueCents(a))
 * held              = Σ counted over the ticked accounts, at useNetWorth's figures
 * remaining         = max(0, target − held)
 * ```
 *
 * **The essentials figure is `usePlanHealth`'s, not a second sum of its own.**
 * That hook already resolves which bucket each category actually counts as — the
 * question needs the group beside the category, and `toSections` has done it
 * once — and the whole value of deriving the target from the plan is that the
 * figure here is the same one the plan's own split reports. Two sums over the
 * same records would eventually disagree about a category whose group moved, and
 * the page would show an emergency fund that did not match the share of the plan
 * printed above it.
 *
 * **Pre-tax retirement money is not part of it, and that is a property of the
 * bucket rather than a rule here.** `usePlanHealth` grosses
 * `pretaxContributionCents` onto the *retirement* bucket; essentials never sees
 * it, which is right — a 401(k) deduction is not a bill that has to be paid out
 * of savings when the income stops.
 *
 * **What is held is `useNetWorth`'s valuation, never a second reading of the
 * accounts** — the rule `useRetirementProjection` already keeps for the ticked
 * retirement accounts. A savings account the household reconciles by hand counts
 * at the figure they entered; one the ledger answers for counts at the books'
 * own arithmetic. One month of window, because all this needs is what each
 * account is worth today.
 *
 * **Only on-budget accounts are offered or counted.** A buffer is cash the
 * household can reach the week the income stops: a card is a debt rather than
 * somewhere money is kept, and an off-budget holding is a brokerage or a
 * retirement account, which is the retirement page's question. An id ticked
 * before this narrowing is inert but kept, the store's rule for an account it
 * cannot see — it counts nothing and comes back if the account is moved on
 * budget. Signed all the same, on the balance sheet's one sign convention.
 *
 * Nothing here writes anything. The fund moves when the plan moves or when a
 * statement is entered, which is the entire reason it is derived rather than
 * typed.
 */
export default function useEmergencyFund() {
  const { fund } = useEmergencyFundPlan();
  const { bucketRows } = usePlanHealth();
  // One month, not the chart's twelve, and `useNetWorth` rather than
  // `useAccountBalances`: a savings account reconciled by hand counts at the
  // figure entered for it, which the ledger alone cannot know.
  const { rows: allRows } = useNetWorth(currentPeriod(), { months: 1 });
  const rows = useMemo(
    () => allRows.filter((row) => row.account.scope === ACCOUNT_SCOPES.ON_BUDGET),
    [allRows]
  );

  return useMemo(() => {
    const essentials = bucketRows.find((row) => row.bucket === PLAN_BUCKETS.ESSENTIALS);
    const monthlyEssentialsCents = essentials?.plannedCents ?? 0;
    const essentialsCount = essentials?.categoryCount ?? 0;

    const included = new Set(fund.accountIds);
    const amounts = fund.accountAmounts ?? {};
    const accountRows = rows.map((row) => {
      const portionCents = amounts[row.account.id] ?? null;
      return {
        account: row.account,
        valueCents: row.valueCents,
        included: included.has(row.account.id),
        // The part of the account set aside as the fund, or null for all of it.
        portionCents,
        // Never more than the account actually holds: ten thousand earmarked in
        // an account that has dipped to six is six thousand of buffer, and the
        // earmark is kept so the figure comes back as the account refills.
        countedCents:
          portionCents == null ? row.valueCents : Math.min(portionCents, row.valueCents),
        // Where the figure came from, for the same reason the retirement picker
        // carries it: a fund last valued in March is being counted at March's
        // figure, and a household deciding whether it is covered should know.
        hand: row.hand,
        asOf: row.asOf,
      };
    });

    const heldCents = accountRows
      .filter((row) => row.included)
      .reduce((sum, row) => sum + row.countedCents, 0);

    const derivedTargetCents = monthlyEssentialsCents * fund.monthsCovered;
    const typed = fund.targetSource === TARGET_SOURCES.AMOUNT;
    // A typed source with nothing typed in it yet is a target of zero rather than
    // a silent fall back to the derivation: the household has said they want to
    // state the figure, and quietly answering with the one they switched away
    // from would hide that the field is still empty.
    const targetCents = typed ? (fund.targetCents ?? 0) : derivedTargetCents;

    return {
      fund,

      // What a necessary month costs, and how many categories say so — the
      // second figure is what makes the first checkable. A household with two
      // categories filed as essentials is being told its fund is small because
      // its plan is incomplete, not because its spending is.
      monthlyEssentialsCents,
      essentialsCount,

      derivedTargetCents,
      targetCents,
      // Both answers reported, whichever is in force, so the panel can show the
      // one not chosen beside the one that is — the point of keeping it.
      typedTargetCents: fund.targetCents,

      accountRows,
      heldCents,
      // Floored at zero, the `useSavingsGoalEnvelopes` rule: a fund that is over
      // its target does not owe money back.
      remainingCents: Math.max(0, targetCents - heldCents),

      // Null where there is nothing to be a share of, the discipline
      // `percentChangeBps` and `shareBps` keep — the page prints a dash rather
      // than inventing a ratio. A negative target cannot happen (both paths
      // refuse one) but a zero one is the ordinary state of a plan nobody has
      // written yet.
      fundedBps: targetCents > 0 ? Math.round((heldCents / targetCents) * 10000) : null,
      // The reading most households actually want: not "62% funded" but "you
      // could cover three and a half months". Independent of the target, which
      // is why it survives a target of zero.
      monthsHeldBps:
        monthlyEssentialsCents > 0
          ? Math.round((heldCents / monthlyEssentialsCents) * 10000)
          : null,

      hasEssentials: monthlyEssentialsCents > 0,
    };
  }, [fund, bucketRows, rows]);
}
