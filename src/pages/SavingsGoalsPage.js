import { useState } from "react";
import AddSavingsGoalModal from "../components/AddSavingsGoalModal";
import ArchivedGoalList from "../components/ArchivedGoalList";
import CloseOutGoalModal from "../components/CloseOutGoalModal";
import SpendFromGoalModal from "../components/SpendFromGoalModal";
import Button from "../components/Button";
import PageHeader from "../components/PageHeader";
import SavingsGoalList from "../components/SavingsGoalList";
import SetupGuideCallout from "../components/SetupGuideCallout";
import { useSavingsGoalAssignments } from "../contexts/SavingsGoalAssignmentsContext";
import { useSavingsGoals } from "../contexts/SavingsGoalsContext";
import useEnvelopes from "../hooks/useEnvelopes";
import useGoalSpending from "../hooks/useGoalSpending";
import useHouseholdInUse from "../hooks/useHouseholdInUse";
import useSavingsGoalEnvelopes from "../hooks/useSavingsGoalEnvelopes";
import { currentPeriod, formatCents } from "../utils";

const SAVINGS_ADD_EXPLAINER_KEY = "savingsAddExplainerDismissed";

function shouldShowAddExplainer() {
  try {
    return window.localStorage.getItem(SAVINGS_ADD_EXPLAINER_KEY) !== "true";
  } catch {
    return true;
  }
}

/**
 * Medium-term savings: a camera, a wedding, a special event — anything
 * expected to exceed the normal monthly budget, which is what makes it a
 * goal to plan around rather than a category to estimate.
 *
 * In the envelope shape, same as a category: a goal accumulates what has
 * been assigned to it, period by period, and that assignment draws from the
 * very same "to be assigned" pool a category does — see useEnvelopes. No
 * stepper, on the same reasoning the dashboard has none: this answers where
 * each goal stands right now, not a month to walk back through.
 *
 * A goal's money does not have to be in the budget: a fund years out is often
 * invested, so a goal may name the off-budget accounts holding it and their
 * value counts towards the target beside what has been assigned — see
 * `useSavingsGoalEnvelopes`. A goal may also name the budget category it draws
 * its monthly contributions from; that link is informational and changes no sum.
 *
 * `editingGoal` picks up the same add/edit modal AddAccountModal uses:
 * absent, it adds; a row's goal, and it amends that one.
 */
export default function SavingsGoalsPage() {
  const [showModal, setShowModal] = useState(false);
  const [editingGoal, setEditingGoal] = useState(null);
  const [showAddExplainer, setShowAddExplainer] = useState(shouldShowAddExplainer);
  const householdInUse = useHouseholdInUse();
  const period = currentPeriod();

  const { toBeAssignedCents } = useEnvelopes(period);
  const { setAssignedAmount } = useSavingsGoalAssignments();
  const { goals, deleteSavingsGoal, reorderSavingsGoals } = useSavingsGoals();
  const allRows = useSavingsGoalEnvelopes(period);
  const rows = allRows.filter((row) => !row.archivedOn);
  const archivedRows = allRows.filter((row) => row.archivedOn);
  const { undoGoalSpending, restoreGoal } = useGoalSpending();
  // Ids rather than rows, so an open form reads the goal's current figures.
  const [spendingId, setSpendingId] = useState(null);
  const [closingId, setClosingId] = useState(null);
  const spendingRow = rows.find((row) => row.goalId === spendingId) ?? null;
  const closingRow = rows.find((row) => row.goalId === closingId) ?? null;

  function dismissAddExplainer() {
    setShowAddExplainer(false);
    try {
      window.localStorage.setItem(SAVINGS_ADD_EXPLAINER_KEY, "true");
    } catch {
      // Dismissal still works for this visit when browser storage is unavailable.
    }
  }

  function handleAssign(row, cents) {
    return setAssignedAmount({ goalId: row.goalId, period, amountCents: cents });
  }

  function handleAdd() {
    setEditingGoal(null);
    setShowModal(true);
  }

  function handleEdit(row) {
    // The row is the envelope join, not the stored record the modal edits —
    // look the goal itself up by id rather than reshaping the row.
    setEditingGoal(goals.find((goal) => goal.id === row.goalId) ?? null);
    setShowModal(true);
  }

  function handleDelete(row) {
    deleteSavingsGoal({ id: row.goalId });
  }

  function handleUndoSpending(row, entry) {
    return undoGoalSpending({ goalId: row.goalId, spendingId: entry.id });
  }

  return (
    <>
      <PageHeader
        title="Savings goals"
        actions={
          <Button variant="primary" onClick={handleAdd}>
            Add goal
          </Button>
        }
      />

      <div className="space-y-4">
        {/* A goal competes with every category for the same unassigned
            dollar, so that figure belongs on this page too — read-only here,
            since assigning it to a category is Transactions' "Assign
            income" flow, not this one. */}
        <p className="font-sans text-row text-chalk-soft">
          <span className="text-label uppercase text-chalk-soft">To be assigned</span>{" "}
          <span className="font-mono text-row font-medium text-chalk">
            {formatCents(toBeAssignedCents)}
          </span>{" "}
          — money not yet assigned to a category or a goal.
        </p>

        <SavingsGoalList
          rows={rows}
          onAssign={handleAssign}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onReorder={reorderSavingsGoals}
          onSpend={(row) => setSpendingId(row.goalId)}
          onArchive={(row) => setClosingId(row.goalId)}
          onUndoSpending={handleUndoSpending}
        />

        <ArchivedGoalList
          rows={archivedRows}
          onRestore={(row) => restoreGoal({ goalId: row.goalId })}
          onDelete={handleDelete}
        />
      </div>

      {showAddExplainer && !householdInUse && rows.length > 0 && !showModal && (
        <SetupGuideCallout
          targetId={`savings-goal-add-${rows[0].goalId}`}
          title="Put money toward a goal"
          description={
            <>
              Type an amount in the Add column to put money toward a goal. Use a minus —{" "}
              <span className="font-mono text-chalk">−200</span> — to pull money back out.
            </>
          }
        >
          <button
            type="button"
            className="mt-3 font-sans text-row text-chalk-soft underline"
            onClick={dismissAddExplainer}
          >
            Got it
          </button>
        </SetupGuideCallout>
      )}

      <SpendFromGoalModal
        show={spendingRow != null}
        row={spendingRow}
        handleClose={() => setSpendingId(null)}
      />

      <CloseOutGoalModal
        show={closingRow != null}
        row={closingRow}
        handleClose={() => setClosingId(null)}
      />

      <AddSavingsGoalModal
        show={showModal}
        goal={editingGoal}
        handleClose={() => setShowModal(false)}
      />
    </>
  );
}
