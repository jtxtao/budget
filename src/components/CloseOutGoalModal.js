import { useEffect, useState } from "react";
import Button from "./Button";
import Dialog from "./Dialog";
import useGoalSpending from "../hooks/useGoalSpending";
import { formatCents } from "../utils";

/**
 * Close a savings goal out. It moves to the archived list with its spending
 * kept; whatever is still in it goes back to "to be assigned" (see
 * `useGoalSpending`'s `archiveGoal`), which is said here before it happens.
 */
export default function CloseOutGoalModal({ show, row, handleClose }) {
  const [error, setError] = useState(null);
  const { archiveGoal } = useGoalSpending();

  useEffect(() => {
    if (show) setError(null);
  }, [show]);

  function handleConfirm() {
    const result = archiveGoal({ goalId: row.goalId });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    handleClose();
  }

  return (
    <Dialog show={show} handleClose={handleClose} title={row ? `Close out ${row.name}?` : "Close out goal?"}>
      {row && (
        <div className="space-y-4 font-sans text-row text-chalk-soft">
          <p>
            The goal moves to Archived goals. What was planned, saved and spent stays on record, and
            you can restore it later.
          </p>
          {row.availableCents > 0 && (
            <p>
              <span className="font-mono text-chalk">{formatCents(row.availableCents)}</span> still in
              this goal goes back to To be assigned.
            </p>
          )}
          {row.heldCents > 0 && (
            <p>
              The <span className="font-mono text-chalk">{formatCents(row.heldCents)}</span> held in
              off-budget accounts is not touched.
            </p>
          )}
          {error && <p role="alert" className="text-vermilion">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={handleClose}>
              Cancel
            </Button>
            <Button variant="primary" type="button" onClick={handleConfirm}>
              Close out goal
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
