import { useMemo, useState } from "react";
import AddTransactionModal from "../components/AddTransactionModal";
import AssignIncomeModal from "../components/AssignIncomeModal";
import PageHeader from "../components/PageHeader";
import PeriodStepper from "../components/PeriodStepper";
import ToBeAssignedBar from "../components/ToBeAssignedBar";
import SplitTransactionModal from "../components/SplitTransactionModal";
import TransactionRegister from "../components/TransactionRegister";
import { useAccounts } from "../contexts/AccountsContext";
import { useBudgets } from "../contexts/BudgetsContext";
import { usePayees } from "../contexts/PayeesContext";
import { useTransactions } from "../contexts/TransactionsContext";
import useEnvelopes from "../hooks/useEnvelopes";
import { orderPayeesByUse } from "../payeeSearch";
import { currentPeriod, toPeriod } from "../utils";

/**
 * The books, a month at a time, as the register they are.
 *
 * This page used to be a grid of envelope cards. What each envelope holds is a
 * question about the *plan*, and it is answered on the dashboard, where the
 * same figures sit in one table beside everything else that is true today. What
 * this page is for is the other job — going through what actually happened,
 * line by line, against a statement — and that job wants rows and columns, with
 * every field reachable where it sits.
 *
 * One figure from the envelope side stays: what is left to assign. It is the
 * reason income is worth logging promptly, it moves as the register is worked
 * through, and the flow it opens has nowhere else to be reached from.
 */
export default function TransactionsPage() {
  const [period, setPeriod] = useState(currentPeriod);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  // The row being divided, held as an **id** rather than as the record: the
  // ledger hands out fresh objects on every write, and the modal has to go on
  // pointing at the same transaction across one.
  const [splitTargetId, setSplitTargetId] = useState(null);

  const { transactions, updateTransaction, deleteTransaction } = useTransactions();
  const { accounts } = useAccounts();
  const { budgets } = useBudgets();
  const { payees, payeeById, addPayee, findPayeeByName } = usePayees();
  // Most recently used first, which is the order the register's payee cells offer
  // before a letter is typed. Built off the whole ledger rather than the month on
  // screen: which payees the household deals with is not a fact about March.
  const orderedPayees = useMemo(() => orderPayeesByUse(payees, transactions), [payees, transactions]);

  // Only the pool figures now — the per-category rows this page used to draw
  // are the dashboard's job. Read at the period on screen, so stepping back
  // reports what was unassigned then rather than what is unassigned now.
  const { toBeAssignedCents, periodIncomeCents, periodAssignedCents, emergencyReservedCents } =
    useEnvelopes(period);

  // The month's rows, newest first, plus every undated one — those belong to no
  // month, and a register that dropped them would leave money on the books with
  // nowhere to correct it. The register bands them separately.
  const rows = useMemo(() => {
    const inPeriod = transactions.filter((transaction) => {
      const at = toPeriod(transaction.date);
      return at == null || at === period;
    });
    // Stable, so entries sharing a date stay in the order they were logged.
    return [...inPeriod].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  }, [transactions, period]);

  const splitTarget = transactions.find((entry) => entry.id === splitTargetId) ?? null;

  /**
   * A payee named on a register row, created first where it is new.
   *
   * The register cannot do this itself: it is handed its rows as props and has no
   * store. **Creating on blur is the rule here and the opposite of the entry
   * form's**, which holds a typed name as a draft until submit — a cell has no
   * submit to wait for, so the moment the user leaves it is the only moment there
   * is. That does mean a mistyped name becomes a payee, which is exactly what the
   * merge on the plan page is for.
   *
   * The payee is created before the row is repointed, for `AddTransactionModal`'s
   * reason: the row has to be able to name it, and a payee with nothing filed under
   * it yet is a far better residual than a row pointing at nothing.
   */
  function handlePayeeChange(transaction, { payeeId, name }) {
    if (payeeId) return updateTransaction({ id: transaction.id, payeeId });

    const trimmed = (name ?? "").trim();
    if (!trimmed) return updateTransaction({ id: transaction.id, payeeId: null });

    // A payee added on another device since this page rendered is the same payee,
    // not a duplicate to be refused.
    const existing = findPayeeByName(trimmed);
    if (existing) return updateTransaction({ id: transaction.id, payeeId: existing.id });

    const created = addPayee({ name: trimmed });
    if (!created.ok) return created;
    return updateTransaction({ id: transaction.id, payeeId: created.id });
  }

  return (
    <>
      <PageHeader
        eyebrow="Day to day"
        title="Transactions"
        description="Every movement of money, a month at a time. Each row names the account it moved through and the category it came out of, and every cell is editable where it sits."
        // No "Add transaction" of its own: the header carries that door on every
        // page, and a second button with the same label on the same screen makes
        // a reader stop and work out whether the two do the same thing.
        actions={<PeriodStepper period={period} onChange={setPeriod} />}
      />

      <ToBeAssignedBar
        toBeAssignedCents={toBeAssignedCents}
        periodIncomeCents={periodIncomeCents}
        periodAssignedCents={periodAssignedCents}
        reservedCents={emergencyReservedCents}
        onAssignClick={() => setShowAssignModal(true)}
      />

      <TransactionRegister
        period={period}
        transactions={rows}
        budgets={budgets}
        accounts={accounts}
        payees={orderedPayees}
        payeeById={payeeById}
        onChange={updateTransaction}
        onPayeeChange={handlePayeeChange}
        onDelete={deleteTransaction}
        onAdd={() => setShowAddModal(true)}
        onSplit={(transaction) => setSplitTargetId(transaction.id)}
      />

      <AssignIncomeModal
        show={showAssignModal}
        period={period}
        handleClose={() => setShowAssignModal(false)}
      />
      <AddTransactionModal show={showAddModal} handleClose={() => setShowAddModal(false)} />
      {/* Shown off the record rather than off the id, so a row deleted while the
          editor is open closes it rather than leaving an empty dialog behind. */}
      <SplitTransactionModal
        show={splitTarget != null}
        transaction={splitTarget}
        handleClose={() => setSplitTargetId(null)}
      />
    </>
  );
}
