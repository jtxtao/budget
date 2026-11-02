import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Button from "../components/Button";
import SegmentedControl from "../components/SegmentedControl";
import AddTransactionModal from "../components/AddTransactionModal";
import AssignIncomeModal from "../components/AssignIncomeModal";
import PageHeader from "../components/PageHeader";
import PeriodStepper from "../components/PeriodStepper";
import ToBeAssignedBar from "../components/ToBeAssignedBar";
import SplitTransactionModal from "../components/SplitTransactionModal";
import TransactionRegister from "../components/TransactionRegister";
import { ACCOUNT_SCOPES, insideBudget, useAccounts } from "../contexts/AccountsContext";
import { useBudgets } from "../contexts/BudgetsContext";
import { usePayees } from "../contexts/PayeesContext";
import {
  budgetLegs,
  isTransfer,
  TRANSACTION_KINDS,
  useTransactions,
} from "../contexts/TransactionsContext";
import { UNCATEGORIZED_BUDGET_ID } from "../contexts/constants";
import useEnvelopes from "../hooks/useEnvelopes";
import { orderPayeesByUse } from "../domain/payeeSearch";
import { currentPeriod, toPeriod } from "../utils";

/**
 * The books, by month or across all dates, with shareable account/category views.
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
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedPeriod = searchParams.get("month");
  const period = /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedPeriod ?? "")
    ? requestedPeriod
    : currentPeriod();
  const allDates = searchParams.get("dates") === "all";
  const accountId = searchParams.get("account") ?? "";
  const categoryId = searchParams.get("category") ?? "";
  const [query, setQuery] = useState("");
  const [reviewOnly, setReviewOnly] = useState(false);
  const [selected, setSelected] = useState([]);
  const [bulkCategory, setBulkCategory] = useState("");
  const [reviewError, setReviewError] = useState("");
  const filtered = Boolean(accountId || categoryId || query || reviewOnly);

  function setFilter(key, value) {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  }

  function clearFilters() {
    setQuery("");
    setReviewOnly(false);
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.delete("account");
      next.delete("category");
      return next;
    });
  }
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  // The row being divided, held as an **id** rather than as the record: the
  // ledger hands out fresh objects on every write, and the modal has to go on
  // pointing at the same transaction across one.
  const [splitTargetId, setSplitTargetId] = useState(null);

  const { transactions, updateTransaction, deleteTransaction, updateTransactionsBulk } = useTransactions();
  const { accounts } = useAccounts();
  const orderedAccounts = [...accounts].sort((a, b) => {
    const rank = (account) =>
      account.scope === ACCOUNT_SCOPES.OFF_BUDGET ? 1 : 0;
    return rank(a) - rank(b);
  });
  const { budgets } = useBudgets();
  const { payees, payeeById, addPayee, findPayeeByName } = usePayees();
  // Most recently used first, which is the order the register's payee cells offer
  // before a letter is typed. Built off the whole ledger rather than the month on
  // screen: which payees the household deals with is not a fact about March.
  const orderedPayees = useMemo(() => orderPayeesByUse(payees, transactions), [payees, transactions]);

  // Only the pool figures now — the per-category rows this page used to draw
  // are the dashboard's job. Read at the period on screen, so stepping back
  // reports what was unassigned then rather than what is unassigned now.
  const {
    toBeAssignedCents,
    periodIncomeCents,
    periodAssignedCents,
    emergencyReservedCents,
    assignedAheadCents,
    monthsFundedAhead,
  } = useEnvelopes(period);

  // Use effective budget legs so splits and crossing transfers match the
  // category they actually affect, never an inert category left on the record.
  const rows = useMemo(() => {
    const inside = insideBudget(accounts);
    const matching = transactions.filter((transaction) => {
      if (reviewOnly && transaction.reviewed !== false) return false;
      if (query.trim()) {
        const payee = payees.find((item) => item.id === transaction.payeeId);
        const haystack = `${transaction.description} ${payee?.name ?? ""} ${transaction.amountCents}`.toLowerCase();
        if (!haystack.includes(query.trim().toLowerCase())) return false;
      }
      const at = toPeriod(transaction.date);
      if (!allDates && at != null && at !== period) return false;
      if (
        accountId && transaction.accountId !== accountId &&
        !(isTransfer(transaction) && transaction.toAccountId === accountId)
      ) return false;
      if (categoryId && !budgetLegs(transaction, inside).some((leg) => {
        const effectiveCategory = leg.budgetId ??
          (leg.kind === TRANSACTION_KINDS.OUTFLOW ? UNCATEGORIZED_BUDGET_ID : null);
        return effectiveCategory === categoryId;
      })) return false;
      return true;
    });
    // Stable, so entries sharing a date stay in the order they were logged.
    return matching.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  }, [transactions, accounts, period, allDates, accountId, categoryId, reviewOnly, query, payees]);

  function bulk(patch, applyRules = false) {
    const result = updateTransactionsBulk({ ids: selected, patch, applyRules });
    if (!result.ok) { setReviewError(result.error); return; }
    setSelected([]);
    setReviewError("");
  }

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
        title="Transactions"
        // No "Add transaction" of its own: the header carries that door on every
        // page, and a second button with the same label on the same screen makes
        // a reader stop and work out whether the two do the same thing.
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <SegmentedControl
              label="Transaction dates"
              options={[{ value: "month", label: "By month" }, { value: "all", label: "All dates" }]}
              value={allDates ? "all" : "month"}
              onChange={(value) => setFilter("dates", value === "all" ? "all" : "")}
            />
            {!allDates && <PeriodStepper period={period} onChange={(value) => setFilter("month", value)} />}
          </div>
        }
      />

      {!allDates && (
        <ToBeAssignedBar
          toBeAssignedCents={toBeAssignedCents}
          periodIncomeCents={periodIncomeCents}
          periodAssignedCents={periodAssignedCents}
          reservedCents={emergencyReservedCents}
          assignedAheadCents={assignedAheadCents}
          monthsFundedAhead={monthsFundedAhead}
          onAssignClick={() => setShowAssignModal(true)}
        />
      )}

      <section aria-label="Filter transactions" className="mb-3 rounded-2xl border border-edge bg-panel p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-0 flex-1 basis-48 font-sans text-row text-chalk">Search payee, note, or cents<input type="search" className="mt-1 block w-full rounded-lg border border-edge bg-panel px-3 py-2 text-chalk" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
          <label className="flex items-center gap-2 text-chalk"><input type="checkbox" checked={reviewOnly} onChange={(e) => setReviewOnly(e.target.checked)} />Needs review ({transactions.filter((row) => row.reviewed === false).length})</label>
          <label className="min-w-0 flex-1 basis-48 font-sans text-row text-chalk">
            Account
            <select
              className="mt-1 block w-full rounded-lg border border-edge bg-panel px-3 py-2 text-chalk"
              value={accountId}
              onChange={(event) => setFilter("account", event.target.value)}
            >
              <option value="">All accounts</option>
              {orderedAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}{account.archived ? " (archived)" : ""}
                </option>
              ))}
              {accountId && !accounts.some((account) => account.id === accountId) && (
                <option value={accountId}>Unknown account</option>
              )}
            </select>
          </label>
          <label className="min-w-0 flex-1 basis-48 font-sans text-row text-chalk">
            Category
            <select
              className="mt-1 block w-full rounded-lg border border-edge bg-panel px-3 py-2 text-chalk"
              value={categoryId}
              onChange={(event) => setFilter("category", event.target.value)}
            >
              <option value="">All categories</option>
              {budgets.map((budget) => (
                <option key={budget.id} value={budget.id}>{budget.name}</option>
              ))}
              <option value={UNCATEGORIZED_BUDGET_ID}>Uncategorized</option>
              {categoryId && categoryId !== UNCATEGORIZED_BUDGET_ID &&
                !budgets.some((budget) => budget.id === categoryId) && (
                  <option value={categoryId}>Unknown category</option>
                )}
            </select>
          </label>
          {filtered && <Button variant="outline" size="sm" onClick={clearFilters}>Clear filters</Button>}
        </div>
        {categoryId && (
          <p role="status" className="mt-2 font-sans text-row text-chalk-soft">
            Matching split transactions show their full amount.
          </p>
        )}
      </section>

      <section aria-label="Review transactions" className="mb-3 rounded-2xl border border-edge bg-panel p-4 text-chalk">
        <div className="flex flex-wrap items-center gap-2"><label><input type="checkbox" checked={rows.length > 0 && rows.every((row) => selected.includes(row.id))} onChange={(e) => setSelected(e.target.checked ? rows.map((row) => row.id) : [])} /> Select visible</label><span>{selected.length} selected</span><Button type="button" size="sm" variant="outline" onClick={() => bulk({ reviewed: true })} disabled={!selected.length}>Mark reviewed</Button><Button type="button" size="sm" variant="outline" onClick={() => bulk({ reviewed: false })} disabled={!selected.length}>Needs review</Button><Button type="button" size="sm" variant="outline" onClick={() => bulk({}, true)} disabled={!selected.length}>Apply rules</Button><select aria-label="Bulk category" className="rounded-lg border border-edge bg-panel p-2" value={bulkCategory} onChange={(e) => setBulkCategory(e.target.value)}><option value="">Choose category</option>{budgets.map((budget) => <option key={budget.id} value={budget.id}>{budget.name}</option>)}</select><Button type="button" size="sm" variant="outline" onClick={() => bulk({ budgetId: bulkCategory, splits: null })} disabled={!selected.length || !bulkCategory}>Set category</Button></div>
        {reviewError && <p role="alert" className="text-vermilion">{reviewError}</p>}
        {rows.length > 0 && <div className="mt-2 max-h-36 overflow-auto">{rows.map((row) => <label key={row.id} className="mr-4 inline-flex items-center gap-1 text-sm"><input type="checkbox" checked={selected.includes(row.id)} onChange={(e) => setSelected((previous) => e.target.checked ? [...previous, row.id] : previous.filter((id) => id !== row.id))} />{row.date ?? "Undated"} {(payees.find((p) => p.id === row.payeeId)?.name || row.description || "Transaction")}</label>)}</div>}
      </section>

      <TransactionRegister
        period={allDates ? null : period}
        filtered={filtered}
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
