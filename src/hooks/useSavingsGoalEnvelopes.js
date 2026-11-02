import { useMemo } from "react";
import { ACCOUNT_TYPES, isOffBudget } from "../contexts/AccountsContext";
import { useBudgets } from "../contexts/BudgetsContext";
import { useSavingsGoals } from "../contexts/SavingsGoalsContext";
import useEnvelopes from "./useEnvelopes";
import useNetWorth from "./useNetWorth";

const ZERO_ROW = { carriedInCents: 0, assignedCents: 0, availableCents: 0 };

/**
 * What one named account contributes: the whole of it, or the part set aside,
 * never more than it actually holds. Ten thousand earmarked in an account that
 * has dipped to six is six thousand of goal, and the earmark is kept so the
 * figure comes back as the account refills.
 *
 * `useEmergencyFund` applies the same rule to its own ticked accounts and the
 * two are deliberately not one call: a buffer counts on-budget cash and is held
 * back out of the pool for it, a goal counts off-budget money that was never in
 * the pool, and a shared helper that grew a third caller would start needing to
 * know which.
 */
export function countedHoldingCents(valueCents, portionCents) {
  return portionCents == null ? valueCents : Math.min(portionCents, valueCents);
}

/**
 * Every account a goal's money could be *held* in, valued the one way the app
 * values an account — `useNetWorth`'s figure, so a brokerage last valued in
 * March counts at March's figure and one the ledger answers for counts at the
 * books' own arithmetic.
 *
 * **Off budget and nothing else.** On-budget money is already in the pool, and
 * every dollar of the pool a goal has a claim on is its assignment: counting a
 * savings-account balance here as well would promise the same dollar twice, and
 * the only honest way to allow it would be a second `reserved` term in the
 * envelope identity. Off-budget money needs none — it was never the budget's to
 * assign — which is exactly why this is where a goal is allowed to reach.
 *
 * **And an asset, never a debt.** A mortgage is off budget and so passed the
 * test above, which put it on the picker beside the brokerage — and because a
 * liability's value is signed negative all the way down the balance sheet
 * (`signedOpeningCents`), ticking one would have *subtracted* a third of a
 * million from the deposit it was supposed to be saved in. Nothing is held in a
 * debt: what is owed on the house is the reason to save, not the saving.
 */
const isHolding = (account) =>
  isOffBudget(account) && account.type !== ACCOUNT_TYPES.LIABILITY;

export function useHoldingOptions(period) {
  const { rows } = useNetWorth(period, { months: 1 });
  return useMemo(() => rows.filter((row) => isHolding(row.account)), [rows]);
}

/**
 * Every goal, joined to the money that is actually there — the same join
 * useDashboard performs for categories, and for the same reason: useEnvelopes
 * knows the budget's money, SavingsGoalsContext knows the goal, and neither
 * should read the other directly.
 *
 * ```
 * available(g) = Σ assigned(g, p ≤ P)            ← out of the pool
 * held(g)      = Σ counted over the goal's off-budget accounts
 * saved(g)     = available + held
 * spent(g)     = Σ the goal's spending entries        ← a statement, never a sum the books read
 * remaining(g) = max(0, target − saved − spent)
 * ```
 *
 * **Spent counts towards the target** because it was saved first: a wedding
 * planned at $30,000 with $8,000 already paid to the venue out of the goal is
 * $8,000 nearer, not $8,000 further away. Spending moves the money from
 * `availableCents` to `spentCents`, so progress does not drop when a bill is
 * paid. `spentCents` is read off the goal record and is on neither side of the
 * envelope identity — the money it describes is a category's activity now.
 *
 * **`availableCents` is the goal's cumulative assignment and nothing else**
 * (see useEnvelopes' goalRows), which is what makes the envelope identity's goal
 * term cancel. `heldCents` is money that was never in the pool on either side of
 * that identity, so it is reported *beside* the assignment rather than folded
 * into it — fold it in and every dollar of an invested fund would read as a
 * dollar the budget had assigned and never spent.
 *
 * **Both halves are reported, because a goal can hold both at once**: $1,200
 * earmarked in the budget and $18,500 already invested are two real piles, and
 * `savedCents` is the answer to the question a goal is read for ("do we have the
 * deposit yet?"). The one thing the household has to do itself is release the
 * earmark when it sweeps that money into the holding — the transfer out of the
 * budget comes out of a *category*, which no goal may read, so a contribution
 * left assigned here would be counted in both piles. The row states the two
 * figures apart so that is visible rather than silent; nothing is repaired,
 * `driftCents`' stance.
 *
 * `remainingCents` is floored at zero, so a goal met — or overshot, by a
 * withdrawal that has not happened yet — never reads as owing money back.
 */
export default function useSavingsGoalEnvelopes(period) {
  const { goals } = useSavingsGoals();
  const { budgets } = useBudgets();
  const { goalRows } = useEnvelopes(period);
  // At the month on screen, like every other figure the hook returns: a holding
  // carries its last real valuation forward, so stepping a month ahead leaves
  // it where it was rather than reading as unvalued.
  const holdings = useHoldingOptions(period);

  return useMemo(() => {
    const byId = new Map(goalRows.map((row) => [row.goalId, row]));
    const heldById = new Map(holdings.map((row) => [row.account.id, row]));
    const budgetById = new Map(budgets.map((b) => [b.id, b]));

    return goals.map((goal) => {
      const row = byId.get(goal.id) ?? ZERO_ROW;
      const amounts = goal.accountAmounts ?? {};

      // Resolved here rather than refused in the store: an id whose account was
      // deleted, or moved on budget where its money is in the pool, contributes
      // nothing and comes back if the account does. Inert but kept.
      const goalHoldings = (goal.accountIds ?? [])
        .map((accountId) => heldById.get(accountId))
        .filter(Boolean)
        .map((held) => ({
          accountId: held.account.id,
          name: held.account.name,
          countedCents: countedHoldingCents(held.valueCents, amounts[held.account.id] ?? null),
        }));

      const heldCents = goalHoldings.reduce((sum, held) => sum + held.countedCents, 0);
      const savedCents = row.availableCents + heldCents;
      const spending = goal.spending ?? [];
      const spentCents = spending.reduce((sum, entry) => sum + entry.amountCents, 0);

      // Inert but kept: a deleted or unknown category resolves to null here.
      const categoryName = goal.budgetId ? (budgetById.get(goal.budgetId)?.name ?? null) : null;

      return {
        goalId: goal.id,
        name: goal.name,
        targetCents: goal.targetCents,
        targetDate: goal.targetDate,
        photo: goal.photo ?? null,
        link: goal.link ?? null,
        envelopeColor: goal.envelopeColor ?? "canopy",
        categoryName,
        carriedInCents: row.carriedInCents,
        assignedCents: row.assignedCents,
        availableCents: row.availableCents,
        heldCents,
        holdings: goalHoldings,
        savedCents,
        spentCents,
        spending: spending.map((entry) => ({
          ...entry,
          categoryName: entry.budgetId ? (budgetById.get(entry.budgetId)?.name ?? null) : null,
        })),
        budgetId: goal.budgetId ?? null,
        archivedOn: goal.archivedOn ?? null,
        remainingCents: Math.max(goal.targetCents - savedCents - spentCents, 0),
      };
    });
  }, [goals, budgets, goalRows, holdings]);
}
