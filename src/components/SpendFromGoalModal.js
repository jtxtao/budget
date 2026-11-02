import { useEffect, useRef, useState } from "react";
import Button from "./Button";
import Dialog from "./Dialog";
import Field, { SelectField } from "./Field";
import { spendsThroughBudget, useAccounts } from "../contexts/AccountsContext";
import { useBudgets } from "../contexts/BudgetsContext";
import useGoalSpending from "../hooks/useGoalSpending";
import { amountEditing, formatCents, todayISO } from "../utils";

const NO_PURCHASE = "";

/**
 * Spend money a savings goal has put aside. The amount moves out of the goal
 * into the category the purchase belongs in, and — unless the purchase is
 * already in the register — the purchase is recorded against that category, so
 * it counts as spending everywhere spending is read. `useGoalSpending` makes
 * the writes and says why.
 *
 * `row` is the goal's `useSavingsGoalEnvelopes` row. Uncontrolled and re-seeded
 * on open, the contract every modal in the app keeps.
 */
export default function SpendFromGoalModal({ show, row, handleClose }) {
  const formRef = useRef();
  const amountRef = useRef();
  const noteRef = useRef();
  const budgetRef = useRef();
  const dateRef = useRef();
  const accountRef = useRef();
  const [error, setError] = useState(null);

  const { spendFromGoal } = useGoalSpending();
  const { budgets } = useBudgets();
  const { accounts } = useAccounts();
  const spendable = accounts.filter((account) => !account.archived && spendsThroughBudget(account));
  const categories = budgets.filter((budget) => !budget.hidden || budget.id === row?.budgetId);

  useEffect(() => {
    if (!show || !row) return;
    formRef.current.reset();
    setError(null);
    amountRef.current.value = row.availableCents > 0 ? amountEditing(row.availableCents) : "";
    noteRef.current.value = "";
    budgetRef.current.value = categories.some((budget) => budget.id === row.budgetId) ? row.budgetId : "";
    dateRef.current.value = todayISO();
    accountRef.current.value = spendable[0]?.id ?? NO_PURCHASE;
    // Seeded once per open: the lists are rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, row?.goalId]);

  function handleSubmit(event) {
    event.preventDefault();
    const result = spendFromGoal({
      goalId: row.goalId,
      amount: amountRef.current.value,
      note: noteRef.current.value,
      budgetId: budgetRef.current.value,
      date: dateRef.current.value,
      accountId: accountRef.current.value || null,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    handleClose();
  }

  return (
    <Dialog show={show} handleClose={handleClose} title={row ? `Spend from ${row.name}` : "Spend from goal"}>
      {row && (
        <form ref={formRef} onSubmit={handleSubmit}>
          <p className="mb-5 font-sans text-row text-chalk-soft">
            {formatCents(row.availableCents)} is in this goal to spend. The amount moves into the
            category you choose, so the purchase counts as spending there and in your reports.
            {row.heldCents > 0 &&
              ` The ${formatCents(row.heldCents)} held in off-budget accounts has to be moved into the budget first.`}
          </p>
          <Field label="Amount" inputRef={amountRef} type="text" inputMode="decimal" placeholder="$0.00" required />
          <Field label="What it was for" inputRef={noteRef} type="text" placeholder="Venue deposit" />
          <SelectField label="Category it counts in" selectRef={budgetRef} required>
            <option value="">Choose a category</option>
            {categories.map((budget) => (
              <option key={budget.id} value={budget.id}>
                {budget.name}
              </option>
            ))}
          </SelectField>
          <Field label="Date" inputRef={dateRef} type="date" required />
          <SelectField label="Paid from" selectRef={accountRef}>
            {spendable.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
            <option value={NO_PURCHASE}>Already in the register — don’t add it again</option>
          </SelectField>
          {error && (
            <p role="alert" className="-mt-2 mb-5 font-sans text-row text-vermilion">
              {error}
            </p>
          )}
          <div className="flex justify-end">
            <Button variant="primary" type="submit">
              Spend from goal
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
