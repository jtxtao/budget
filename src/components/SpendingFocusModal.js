import { useEffect, useState } from "react";
import Dialog from "./Dialog";
import Button from "./Button";
import { MAX_FOCUSED_BUDGETS, useBudgets } from "../contexts/BudgetsContext";
import { toSections } from "../domain/planLayout";

/**
 * Choose which categories the dashboard's spending focus watches.
 *
 * A tick **commits on change**, like a select: there is nothing to half-type,
 * and each tick is one answer about one category. So there is no Save button
 * and no draft to abandon — Done just closes. A refused tick (the focus is
 * full, or the category went away under another device) says why and the box
 * stays as the store has it, since the boxes are controlled by the stored
 * flag rather than by what was clicked.
 *
 * Once eight are ticked the rest are disabled rather than left to fail on
 * click: the limit is stated above the list, and a box that cannot be ticked
 * should look it. The store checks again regardless.
 *
 * Hidden categories are offered too — hiding one takes it out of the plan's
 * view, not out of the household's interest — and say so beside the name.
 */
export default function SpendingFocusModal({ show, handleClose }) {
  const { groups, budgets, updateBudget } = useBudgets();
  const [error, setError] = useState(null);

  useEffect(() => {
    if (show) setError(null);
  }, [show]);

  const chosen = budgets.filter((budget) => budget.focused === true).length;
  const full = chosen >= MAX_FOCUSED_BUDGETS;
  const sections = toSections(groups, budgets).filter((section) => section.budgets.length > 0);

  function toggle(budget, focused) {
    const result = updateBudget({ id: budget.id, focused });
    setError(result.ok ? null : result.error);
  }

  return (
    <Dialog show={show} handleClose={handleClose} title="Spending focus">
      <p id="spending-focus-help" className="font-sans text-row text-chalk-soft">
        Tick up to {MAX_FOCUSED_BUDGETS} categories to watch on the dashboard.{" "}
        <span className="text-chalk">
          {chosen} of {MAX_FOCUSED_BUDGETS} chosen.
        </span>
      </p>

      {error && (
        <p role="alert" className="mt-3 font-sans text-row text-vermilion">
          {error}
        </p>
      )}

      {sections.length === 0 ? (
        <p className="mt-4 font-sans text-row text-chalk-soft">
          There are no categories yet. Add some on the plan first.
        </p>
      ) : (
        <div className="mt-4 grid gap-4">
          {sections.map((section) => (
            <fieldset key={section.groupId ?? "ungrouped"}>
              <legend className="mb-1 font-sans text-label uppercase text-chalk-soft">
                {section.name}
              </legend>
              <ul className="grid gap-1 sm:grid-cols-2">
                {section.budgets.map((budget) => {
                  const checked = budget.focused === true;
                  return (
                    <li key={budget.id}>
                      <label
                        className={`flex items-center gap-2 rounded-lg px-2 py-1.5 font-sans text-row ${
                          !checked && full ? "text-chalk-soft" : "text-chalk hover:bg-panel-raised"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!checked && full}
                          aria-describedby="spending-focus-help"
                          onChange={(event) => toggle(budget, event.target.checked)}
                        />
                        <span className="truncate">{budget.name}</span>
                        {budget.hidden === true && (
                          <span className="font-sans text-xs text-chalk-soft">(hidden)</span>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          ))}
        </div>
      )}

      <div className="mt-6 flex justify-end">
        <Button type="button" variant="primary" onClick={handleClose}>
          Done
        </Button>
      </div>
    </Dialog>
  );
}
