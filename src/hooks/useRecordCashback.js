import { useCallback } from "react";
import { useAccounts } from "../contexts/AccountsContext";
import { useTransactions } from "../contexts/TransactionsContext";
import { cashbackFor } from "../cashback";

/**
 * Write the cash back a purchase earns on its account, if any — the second
 * write of the two every entry point that records spending makes (the entry
 * form, and a scheduled bill entered from the dashboard).
 *
 * A hook rather than a store mutator because it reads two stores: the rate is
 * on the account and the row goes in the ledger, and `TransactionsProvider` is
 * mounted above `AccountsProvider`, so the ledger cannot see a rate. The caller
 * writes the purchase first and calls this only once that landed.
 *
 * Returns `{ ok: true }` when there was nothing to write, so callers need not
 * ask whether the account earns anything.
 */
export default function useRecordCashback() {
  const { accounts } = useAccounts();
  const { addTransaction } = useTransactions();

  return useCallback(
    ({ payeeName, ...purchase }) => {
      const account = accounts.find((entry) => entry.id === purchase.accountId);
      const refund = cashbackFor(account, purchase, payeeName);
      if (!refund) return { ok: true, written: false };
      const result = addTransaction(refund);
      return result.ok ? { ok: true, written: true } : result;
    },
    [accounts, addTransaction]
  );
}
