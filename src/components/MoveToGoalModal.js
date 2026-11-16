import { useEffect, useRef, useState } from "react";
import Button from "./Button";
import Dialog from "./Dialog";
import Field from "./Field";
import useGoalSpending from "../hooks/useGoalSpending";
import { currentPeriod, formatCents, toCents } from "../utils";

/**
 * Move money from a budget category into a linked savings goal.
 *
 * The reverse of SpendFromGoalModal: the category's available goes down, the
 * goal's available goes up, and "to be assigned" is unchanged — it is a
 * reassignment, not new money arriving or leaving.
 *
 * `row` is the goal's `useSavingsGoalEnvelopes` row. `categoryAvailableCents`
 * is the category's current `availableCents` from `useEnvelopes`, passed in
 * because the hook that owns it (`useEnvelopes`) is called on the page, not here.
 */
export default function MoveToGoalModal({ show, row, categoryAvailableCents = 0, handleClose }) {
  const formRef = useRef();
  const amountRef = useRef();
  const [error, setError] = useState(null);

  const { moveFromCategory } = useGoalSpending();
  const categoryName = row?.categoryName ?? "category";
  const canMove = categoryAvailableCents > 0;

  useEffect(() => {
    if (!show || !row) return;
    formRef.current.reset();
    setError(null);
    amountRef.current.value = "";
  }, [show, row?.goalId]);

  function handleSubmit(event) {
    event.preventDefault();
    const cents = toCents(amountRef.current.value);
    if (cents == null || cents <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }
    if (cents > categoryAvailableCents) {
      setError(
        `Only ${formatCents(categoryAvailableCents)} is available in ${categoryName}.`
      );
      return;
    }
    const result = moveFromCategory({
      goalId: row.goalId,
      budgetId: row.budgetId,
      amountCents: cents,
      period: currentPeriod(),
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    handleClose();
  }

  return (
    <Dialog
      show={show}
      handleClose={handleClose}
      title={row ? `Fund ${row.name}` : "Fund goal"}
    >
      {row && (
        <form ref={formRef} onSubmit={handleSubmit}>
          <p className="mb-5 font-sans text-row text-chalk-soft">
            Move money from <span className="text-chalk">{categoryName}</span> into this goal.
            {canMove ? (
              <> {formatCents(categoryAvailableCents)} is available in {categoryName}.</>
            ) : (
              <span className="block mt-1 text-sulfur">
                {categoryName} has nothing available to move right now.
              </span>
            )}
          </p>
          <Field
            label="Amount"
            inputRef={amountRef}
            type="text"
            inputMode="decimal"
            placeholder="$0.00"
            required
          />
          {error && (
            <p role="alert" className="-mt-2 mb-5 font-sans text-row text-vermilion">
              {error}
            </p>
          )}
          <div className="flex justify-end">
            <Button variant="primary" type="submit" disabled={!canMove}>
              Move to goal
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
