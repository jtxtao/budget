import { useMemo } from "react";
import { useAccounts } from "../contexts/AccountsContext";
import { useBudgets } from "../contexts/BudgetsContext";
import { usePayees } from "../contexts/PayeesContext";
import { useRewards } from "../contexts/RewardsContext";
import { useTransactions } from "../contexts/TransactionsContext";
import {
  OFFER_KINDS,
  OFFER_STATUS,
  offerProgress,
  programById,
  resolvedValuePer100Cents,
  valueOfPointsCents,
} from "../rewards";

/** Active first, then the ones not yet open, then finished; soonest deadline first within each. */
const STATUS_ORDER = {
  [OFFER_STATUS.ACTIVE]: 0,
  [OFFER_STATUS.UPCOMING]: 1,
  [OFFER_STATUS.DONE]: 2,
  [OFFER_STATUS.ENDED]: 3,
};

const byDeadline = (a, b) => {
  const left = a.offer.endDate ?? "9999-12-31";
  const right = b.offer.endDate ?? "9999-12-31";
  if (left === right) return 0;
  return left < right ? -1 : 1;
};

/**
 * Every tracked card offer, against the ledger as of `today`.
 *
 * The join between the rewards store, which knows what an offer promises, and
 * the books, which know what was actually spent — so it is a hook, the
 * cross-store rule, and `offerProgress` in `src/rewards.js` is the arithmetic
 * it runs. **Nothing flows back**: an offer moves no envelope and no balance,
 * and a purchase is not refiled because an offer would have liked it.
 *
 * Names are resolved here rather than stored on the offer, so renaming a
 * category or a card renames it on the page too. A reference whose record has
 * gone is inert — it matches nothing — and is reported in `missing` so the
 * page can say the offer is mapped to something that no longer exists rather
 * than quietly counting less.
 *
 * A target's bonus is valued at the household's own figure for its program,
 * the same `resolvedValuePer100Cents` every other figure on the page reads.
 */
export default function useCardOffers(today) {
  const { offers, valuations } = useRewards();
  const { transactions } = useTransactions();
  const { accounts } = useAccounts();
  const { budgets } = useBudgets();
  const { payees } = usePayees();

  return useMemo(() => {
    const accountName = new Map(accounts.map((account) => [account.id, account.name]));
    const budgetName = new Map(budgets.map((budget) => [budget.id, budget.name]));
    const payeeName = new Map(payees.map((payee) => [payee.id, payee.name]));

    const rows = offers.map((offer) => {
      const progress = offerProgress(offer, transactions, today);
      const program = offer.programId ? programById(offer.programId) : null;
      const bonusValueCents =
        offer.kind === OFFER_KINDS.TARGET && program && offer.bonusPoints != null
          ? valueOfPointsCents(offer.bonusPoints, resolvedValuePer100Cents(program.id, valuations))
          : null;

      const categories = offer.budgetIds.filter((id) => budgetName.has(id)).map((id) => budgetName.get(id));
      const payeeNames = offer.payeeIds.filter((id) => payeeName.has(id)).map((id) => payeeName.get(id));
      const missing =
        offer.budgetIds.filter((id) => !budgetName.has(id)).length +
        offer.payeeIds.filter((id) => !payeeName.has(id)).length;

      return {
        ...progress,
        cardName: accountName.get(offer.accountId) ?? null,
        program,
        bonusValueCents,
        categories,
        payees: payeeNames,
        missing: offer.allSpending ? 0 : missing,
      };
    });

    rows.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || byDeadline(a, b));
    return rows;
  }, [offers, valuations, transactions, accounts, budgets, payees, today]);
}
