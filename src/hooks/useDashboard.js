import { useMemo } from "react";
import { useBudgets } from "../contexts/BudgetsContext";
import { toSections } from "../planLayout";
import useEnvelopes from "./useEnvelopes";

/**
 * The envelope figures for one period, arranged the way the plan is arranged.
 *
 * `useEnvelopes` answers what every category has; `toSections` says which
 * heading each category is filed under. This is the join, and it lives in a hook
 * for the same reason both of those do — it reads across stores, which no
 * provider may.
 *
 * Five figures per category, and they are not five independent facts:
 *
 *   activity  = the month's net movement, negative when money left
 *   budgeted  = what was assigned to it this month
 *   available = carried in + budgeted + activity, what is actually in it now
 *   target    = the standing monthly estimate from the budget plan
 *   goal      = the balance it is saving towards, or null for most of them
 *
 * **Activity is signed, and it is the net.** Spend $100 on food and be paid back
 * $60 by the friends who ate it and the row shows $40 — the refund is an inflow
 * naming that category, which returns to the envelope rather than to the pool.
 * See `useEnvelopes`. The sign is the information: it turns the row into the sum
 * it actually is — carried in, plus what was put in, plus what moved — so a
 * reader can add it up rather than being told to subtract one column from
 * another. The headline figures below keep the store's convention, because
 * "spent this month" is a quantity rather than a movement.
 *
 * **Every row `useEnvelopes` returns appears somewhere here.** The category rows
 * land under their group; whatever is left — the Uncategorized sentinel, and ids
 * with money against them but no category record — lands in `otherRows`, which
 * is why `totals` can be compared against the page's headline figures at all. A
 * row is dropped only when it is empty in all three of the figures being summed,
 * so the totals are untouched by the filtering.
 */

/** Nothing carried, nothing assigned, nothing moved: nothing to show. */
const isEmpty = (row) => !row.availableCents && !row.assignedCents && !row.activityCents;

function toRow(row, extra) {
  return {
    budgetId: row.budgetId,
    name: row.name,
    carriedInCents: row.carriedInCents,
    availableCents: row.availableCents,
    budgetedCents: row.assignedCents,
    activityCents: row.activityCents,
    targetCents: row.plannedCents,
    // The balance this category is saving towards — $2,000 in the car fund —
    // set on Configuration and optional there. **Null for a category that is
    // not saving towards anything**, which is most of them and all of the
    // catch-alls: no goal is not a goal of nothing, and the table draws the
    // difference as a dash rather than as $0.
    goalCents: row.goalCents,
    ...extra,
  };
}

const ZERO = {
  availableCents: 0,
  budgetedCents: 0,
  activityCents: 0,
  targetCents: 0,
};

/**
 * The four figures that always exist, plus the one that need not.
 *
 * A subtotal of goals is the goals under it added up — and **null when there are
 * none**, because a heading with nothing saving towards anything is not a
 * heading with a goal of zero dollars. Rows without a goal are simply not in the
 * sum; a group where one category is saving for a car and three are not has the
 * car's figure as its goal, which is the true answer to what is being saved for
 * under that heading.
 */
function sumRows(rows) {
  const totals = rows.reduce(
    (total, row) => ({
      availableCents: total.availableCents + row.availableCents,
      budgetedCents: total.budgetedCents + row.budgetedCents,
      activityCents: total.activityCents + row.activityCents,
      targetCents: total.targetCents + row.targetCents,
    }),
    ZERO
  );

  const goals = rows.filter((row) => row.goalCents != null);

  return {
    ...totals,
    goalCents: goals.length ? goals.reduce((sum, row) => sum + row.goalCents, 0) : null,
  };
}

export default function useDashboard(period) {
  const { groups, budgets } = useBudgets();
  const envelopes = useEnvelopes(period);

  return useMemo(() => {
    const byId = new Map(envelopes.rows.map((row) => [row.budgetId, row]));
    const claimed = new Set();

    const sections = toSections(groups, budgets)
      .map((section) => {
        const rows = section.budgets
          .filter((budget) => byId.has(budget.id))
          .map((budget) => {
            claimed.add(budget.id);
            return toRow(byId.get(budget.id), { bucket: budget.effectiveBucket });
          });

        return { groupId: section.groupId, name: section.name, rows, totals: sumRows(rows) };
      })
      // An empty heading is worth showing on the page that arranges headings.
      // Here it is a row of dashes.
      .filter((section) => section.rows.length > 0);

    // The catch-alls, after the plan. Kept out of the sections rather than given
    // one of their own, because they are not filed under anything — and dropped
    // when untouched, which no total notices.
    const otherRows = envelopes.rows
      .filter((row) => !claimed.has(row.budgetId) && !isEmpty(row))
      .map((row) => toRow(row));

    return {
      period,
      sections,
      otherRows,
      otherTotals: sumRows(otherRows),
      totals: sumRows([...sections.flatMap((section) => section.rows), ...otherRows]),
      availableToBudgetCents: envelopes.toBeAssignedCents,
      periodIncomeCents: envelopes.periodIncomeCents,
      periodBudgetedCents: envelopes.periodAssignedCents,
      // A magnitude, unlike the rows' signed `activityCents`: this one is
      // labelled "spent this month", which is a quantity rather than a movement.
      // Gross here, with the refunds beside it: the page nets one off the other
      // for the tile, and keeps both so the note can say how much came back.
      periodSpentCents: envelopes.periodSpentCents,
      periodRefundCents: envelopes.periodRefundCents,
      totalAvailableCents: envelopes.totalAvailableCents,
    };
  }, [groups, budgets, envelopes, period]);
}
