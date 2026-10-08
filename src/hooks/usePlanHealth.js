import { useMemo } from "react";
import {
  PLAN_BUCKET_LABELS,
  PLAN_BUCKET_ORDER,
  PLAN_BUCKETS,
  useBudgets,
} from "../contexts/BudgetsContext";
import { monthlyCents } from "../cadence";
import { useIncomePlan } from "../contexts/IncomePlanContext";
import { useRetirement } from "../contexts/RetirementContext";
import { toSections } from "../planLayout";
import { apportion } from "../utils";

/**
 * Whether the standing configuration balances, and what it balances *into*.
 *
 *   unplanned = expected income per month − Σ category estimates per month
 *
 * Both sides are monthly figures that hold until the user changes them. Nothing
 * here is scoped to a month, and nothing here reads the books: this says what
 * the user intends, and says it the same way in January as in August.
 *
 * Note what is deliberately absent. Not assignments — assigning money is an act
 * on the books, and a configuration that balances on paper says nothing about
 * whether this month's actual income has been given a job; that question belongs
 * to "to be assigned" on the Transactions page. Not recorded income either, for
 * the same reason: a figure from one particular month has no business sitting
 * next to figures that describe every month.
 *
 * **Pretax retirement contributions are grossed onto both sides of the balance,
 * equally, so "left to plan" is unmoved by a figure that never touches a real
 * account.** `RetirementContext`'s `pretaxContributionCents` (a 401(k)
 * deduction, typically) never becomes a transaction — it leaves a paycheque
 * before the money reaches an on-budget account — so `expectedMonthlyCents`
 * here is already net of it, the same way a real paycheque is. Leaving it out
 * of this hook entirely would still balance, but it would understate both what
 * the household earns before tax and what it is actually setting aside for
 * retirement, and the whole reason the retirement bucket exists is to answer
 * that second question honestly. So it is added back to both `expectedIncomeCents`
 * and `plannedCents` — as though it were income earned and immediately spent
 * into the retirement bucket, which, functionally, it is.
 *
 * **What is left to plan counts as savings in the split, by default.** Income
 * the plan expects and has not given a job is not spent — it stays in an
 * account and accumulates, which is what saving is — so leaving it out of the
 * split would understate the savings share of every plan that is not fully
 * allocated. It is added to the savings bucket's figure only, never to
 * `plannedCents` or to "left to plan" itself, so the verdict above the split is
 * unmoved; and only while it is positive, since an over-allocated plan has
 * nothing left over to save. The split is then a share of everything expected
 * in, which is the same whole as what is planned once a plan balances.
 */
export default function usePlanHealth() {
  const { groups, budgets } = useBudgets();
  const { incomeRows, expectedMonthlyCents } = useIncomePlan();
  const { plan } = useRetirement();

  return useMemo(() => {
    const sections = toSections(groups, budgets);
    const categoryPlannedCents = budgets.reduce((sum, budget) => sum + budget.plannedCents, 0);

    const pretaxMonthlyCents = monthlyCents(plan.pretaxContributionCents ?? 0, "annually");
    const expectedIncomeCents = expectedMonthlyCents + pretaxMonthlyCents;
    const plannedCents = categoryPlannedCents + pretaxMonthlyCents;

    // Read off the sections rather than the flat list: resolving "which bucket
    // is this category actually in" needs the group beside it, and toSections
    // has already done it once.
    const totals = new Map(PLAN_BUCKET_ORDER.map((bucket) => [bucket, { cents: 0, count: 0 }]));
    for (const section of sections) {
      for (const budget of section.budgets) {
        const total = totals.get(budget.effectiveBucket);
        if (!total) continue;
        total.cents += budget.plannedCents;
        total.count += 1;
      }
    }
    // Pretax has no category of its own to be counted through the loop above —
    // it is added straight to the retirement bucket's total, the same bucket
    // `useRetirementProjection` reaches by adding it to that bucket's own sum.
    totals.get(PLAN_BUCKETS.RETIREMENT).cents += pretaxMonthlyCents;

    const unplannedCents = expectedIncomeCents - plannedCents;
    const leftToPlanCents = Math.max(0, unplannedCents);
    totals.get(PLAN_BUCKETS.SAVINGS).cents += leftToPlanCents;
    const splitCents = plannedCents + leftToPlanCents;

    // The split is a share of what the plan spends plus whatever is left over
    // as savings: it has to be readable before there is any income on file, and
    // the gap below planned is already the verdict's job.
    const percents = apportion(
      PLAN_BUCKET_ORDER.map((bucket) => totals.get(bucket).cents),
      100
    );

    const bucketRows = PLAN_BUCKET_ORDER.map((bucket, index) => ({
      bucket,
      label: PLAN_BUCKET_LABELS[bucket],
      plannedCents: totals.get(bucket).cents,
      categoryCount: totals.get(bucket).count,
      leftToPlanCents: bucket === PLAN_BUCKETS.SAVINGS ? leftToPlanCents : 0,
      // Null rather than zero when there is nothing to split at all — no share
      // exists yet, which is a different statement from a share of none.
      percent: splitCents > 0 ? percents[index] : null,
    }));

    return {
      sections,
      bucketRows,
      incomeRows,
      expectedIncomeCents,
      plannedCents,
      unplannedCents,
      splitCents,
      pretaxMonthlyCents,
      sourceCount: incomeRows.length,
      groupCount: groups.length,
      categoryCount: budgets.length,
    };
  }, [groups, budgets, incomeRows, expectedMonthlyCents, plan.pretaxContributionCents]);
}
