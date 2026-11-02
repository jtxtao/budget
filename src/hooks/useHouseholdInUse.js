import { useAssignments } from "../contexts/AssignmentsContext";
import { useSavingsGoalAssignments } from "../contexts/SavingsGoalAssignmentsContext";
import { useTransactions } from "../contexts/TransactionsContext";

/**
 * Whether this household has started keeping its books — any transaction, or
 * any money assigned to a category or a goal.
 *
 * **What the getting-started coachmarks are gated on**, and it has to be read
 * from the books rather than from a "dismissed" flag alone. Those flags sit in
 * this browser's own storage and never reach the account, so a second device,
 * a cleared cache, or a browser that evicts storage after a quiet week would
 * otherwise walk someone with years of ledger back through setup. The books
 * are synced; the flags are not.
 *
 * None of the setup steps writes either store — accounts carry their opening
 * balance as a field, not a transaction, and assigning starting balances is the
 * walk-through's last step — so finishing setup is never mistaken for skipping it.
 */
export default function useHouseholdInUse() {
  const { transactions } = useTransactions();
  const { assignments } = useAssignments();
  const { assignments: goalAssignments } = useSavingsGoalAssignments();
  return transactions.length > 0 || assignments.length > 0 || goalAssignments.length > 0;
}
