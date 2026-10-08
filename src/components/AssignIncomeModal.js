import { useCallback, useEffect, useRef, useState } from "react";
import Dialog from "./Dialog";
import Button from "./Button";
import useEnvelopes from "../hooks/useEnvelopes";
import useSavingsGoalEnvelopes from "../hooks/useSavingsGoalEnvelopes";
import { useAssignments } from "../contexts/AssignmentsContext";
import { useSavingsGoalAssignments } from "../contexts/SavingsGoalAssignmentsContext";
import { amountAtRest, amountField, formatCents, formatPeriod, toCents } from "../utils";

const FIELD_PREFIX = "assign:";
const GOAL_FIELD_PREFIX = "goal:";

/**
 * Give this month's money a job, one category — or one savings goal — at a
 * time. This is the app's single door into the shared "to be assigned" pool
 * (see ToBeAssignedBar's comment), so a goal is funded here rather than
 * through a second entry point: it draws from the same dollar a category
 * does, and useEnvelopes' goalRows are what make that pool figure honest.
 *
 * Uncontrolled, like every other form here: one `name` per row, read back with
 * FormData. The live "remaining to assign" figure does not need controlled
 * inputs — one `onChange` on the form recomputes it from the same FormData on
 * every keystroke (React routes that to the native input event, so it fires per
 * character and bubbles from every row), which keeps `form.reset()` working and
 * this modal inside the pattern the rest of the suite is built around. Holding
 * a row of useState instead would only move the re-seeding hazard somewhere
 * harder to see: seeding from the derived rows would let the store echo of the
 * modal's own write clobber whatever the user was typing.
 */
export default function AssignIncomeModal({
  show,
  period,
  handleClose,
  title,
  poolCentsOverride,
}) {
  const formRef = useRef();
  const [error, setError] = useState(null);
  const [remainingCents, setRemainingCents] = useState(0);

  const { setPeriodAssignments } = useAssignments();
  const { setPeriodAssignments: setGoalPeriodAssignments } = useSavingsGoalAssignments();
  const { rows, toBeAssignedCents } = useEnvelopes(period);
  const goalRows = useSavingsGoalEnvelopes(period);
  // Onboarding's starting-balance flow reuses this same form but is not
  // funded from this month's ordinary pool — see `useStartingBalances`.
  const poolCents = poolCentsOverride ?? toBeAssignedCents;

  // Configured categories, plus Uncategorized whenever it holds a balance or
  // saw activity. Keyed on the balance and not only on this month's activity:
  // an uncovered overspend carried in from an earlier month is precisely the
  // row the user has come here to settle.
  const editable = rows.filter(
    (row) =>
      row.kind === "category" ||
      row.availableCents !== 0 ||
      row.assignedCents !== 0 ||
      row.activityCents !== 0
  );

  const storedCents =
    editable.reduce((sum, row) => sum + row.assignedCents, 0) +
    goalRows.reduce((sum, row) => sum + row.assignedCents, 0);

  const recompute = useCallback(() => {
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);
    let entered = 0;
    for (const [key, value] of data) {
      if (!key.startsWith(FIELD_PREFIX) && !key.startsWith(GOAL_FIELD_PREFIX)) continue;
      entered += toCents(value) ?? 0;
    }
    // Replacing these rows moves the pool by exactly the difference between
    // what is stored for them and what is on screen.
    setRemainingCents(poolCents + storedCents - entered);
  }, [poolCents, storedCents]);

  // The modal stays mounted, so re-seed every time it opens — and again if the
  // period steps underneath it, since every figure on it is period-scoped.
  useEffect(() => {
    if (!show) return;
    const form = formRef.current;
    form.reset();
    setError(null);
    for (const row of editable) {
      const input = form.elements[FIELD_PREFIX + row.budgetId];
      // Left blank rather than "0" so an untouched row reads as untouched, and
      // otherwise as money — the same face the estimate beside it wears.
      if (input) input.value = row.assignedCents === 0 ? "" : amountAtRest(row.assignedCents);
    }
    for (const row of goalRows) {
      const input = form.elements[GOAL_FIELD_PREFIX + row.goalId];
      if (input) input.value = row.assignedCents === 0 ? "" : amountAtRest(row.assignedCents);
    }
    recompute();
    // `editable` and `goalRows` are rebuilt every render; depending on them
    // would re-seed the form out from under the user on every keystroke
    // elsewhere in the app.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, period]);

  function setRowValue(budgetId, cents) {
    const input = formRef.current.elements[FIELD_PREFIX + budgetId];
    if (input) input.value = amountAtRest(cents);
  }

  function setGoalRowValue(goalId, cents) {
    const input = formRef.current.elements[GOAL_FIELD_PREFIX + goalId];
    if (input) input.value = amountAtRest(cents);
  }

  // Fill tops a category up to its configured monthly estimate outright, rather
  // than to the estimate minus what it carried in. That is what makes a sinking
  // fund work: $100 a month into car repairs should be $100 every month, not
  // $100 the first month and nothing after.
  function handleFill(row) {
    setRowValue(row.budgetId, row.plannedCents);
    recompute();
  }

  function handleFillAll() {
    for (const row of editable) {
      if (row.plannedCents > 0) setRowValue(row.budgetId, row.plannedCents);
    }
    recompute();
  }

  // A goal has no monthly estimate to top up to — its target is the whole
  // sum, not a per-period figure — so Fill sets this period's contribution to
  // whatever is left to reach it outright, the same "remainingCents" figure
  // the Savings goals page shows.
  function handleFillGoal(row) {
    setGoalRowValue(row.goalId, row.assignedCents + row.remainingCents);
    recompute();
  }

  function handleSubmit(e) {
    e.preventDefault();
    const data = new FormData(formRef.current);
    const entries = [];
    const goalEntries = [];

    // Validated up front: a form that assigns eight categories and fails on the
    // third must not leave two of them committed.
    for (const row of editable) {
      const raw = data.get(FIELD_PREFIX + row.budgetId);
      // An empty row means "nothing this month", not a malformed figure.
      const cents = String(raw ?? "").trim() === "" ? 0 : toCents(raw);
      if (cents == null) {
        setError(`Enter a valid amount for ${row.name}.`);
        formRef.current.elements[FIELD_PREFIX + row.budgetId]?.focus();
        return;
      }
      entries.push({ budgetId: row.budgetId, amountCents: cents, label: row.name });
    }

    for (const row of goalRows) {
      const raw = data.get(GOAL_FIELD_PREFIX + row.goalId);
      const cents = String(raw ?? "").trim() === "" ? 0 : toCents(raw);
      if (cents == null) {
        setError(`Enter a valid amount for ${row.name}.`);
        formRef.current.elements[GOAL_FIELD_PREFIX + row.goalId]?.focus();
        return;
      }
      goalEntries.push({ goalId: row.goalId, amountCents: cents, label: row.name });
    }

    // Two stores, so this cannot be one atomic write — but every figure is
    // validated above before either call runs, which is what keeps a bad
    // figure from landing in one store after the other already committed.
    const result = setPeriodAssignments({ period, entries });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const goalResult = setGoalPeriodAssignments({ period, entries: goalEntries });
    if (!goalResult.ok) {
      setError(goalResult.error);
      return;
    }
    handleClose();
  }

  const remainingTone =
    remainingCents < 0 ? "text-vermilion" : remainingCents > 0 ? "text-sulfur" : "text-verdant";

  return (
    <Dialog
      show={show}
      handleClose={handleClose}
      wide
      title={title ?? `Assign income · ${formatPeriod(period)}`}
    >
      <form ref={formRef} onSubmit={handleSubmit} onChange={recompute}>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border border-edge bg-panel-raised px-4 py-3">
          <div>
            <div className="font-mono text-label uppercase text-chalk-soft">Remaining to assign</div>
            {/* A status region, so the figure is announced as it changes
                rather than only being visible. */}
            <div role="status" className={`font-mono text-figure font-medium ${remainingTone}`}>
              {formatCents(remainingCents)}
            </div>
          </div>
          <Button variant="outline" size="sm" type="button" onClick={handleFillAll}>
            Fill all to estimate
          </Button>
        </div>

        {goalRows.length > 0 && (
          <div className="mb-2 font-mono text-label uppercase text-chalk-soft">Categories</div>
        )}
        {editable.length === 0 ? (
          <p className="mb-5 font-sans text-row text-chalk-soft">
            No categories yet. Add one on the Budget plan page, then come back to fund it.
          </p>
        ) : (
          <div className="mb-5 scroll-x">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-panel-raised">
                  <th className="px-3 py-2 text-left font-mono text-label uppercase text-chalk">
                    Category
                  </th>
                  <th className="px-3 py-2 text-right font-mono text-label uppercase text-chalk">
                    Estimate
                  </th>
                  <th className="px-3 py-2 text-right font-mono text-label uppercase text-chalk">
                    Goal
                  </th>
                  <th className="px-3 py-2 text-right font-mono text-label uppercase text-chalk">
                    Assign
                  </th>
                  <th className="w-12 px-3 py-2">
                    <span className="sr-only">Fill to estimate</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {editable.map((row, i) => (
                  <tr key={row.budgetId} className={i % 2 === 0 ? "bg-sheet" : "bg-sheet-alt"}>
                    <td className="px-3 py-2">
                      <div className="font-sans text-row text-ink">{row.name}</div>
                      <div className="font-mono text-label uppercase text-ink-soft">
                        {formatCents(row.availableCents)} available
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-row text-ink-soft">
                      {row.plannedCents ? formatCents(row.plannedCents) : "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-row text-ink-soft">
                      {row.goalCents == null ? "—" : formatCents(row.goalCents)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        {...amountField}
                        name={FIELD_PREFIX + row.budgetId}
                        aria-label={`Assign to ${row.name}`}
                        placeholder="$0"
                        className="w-24 border-0 border-b-2 border-rule bg-transparent px-0 py-1 text-right font-mono text-row text-ink outline-none transition-colors placeholder:text-ink-soft/60 focus:border-azure"
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        variant="row"
                        size="sm"
                        type="button"
                        disabled={!row.plannedCents}
                        onClick={() => handleFill(row)}
                      >
                        Fill
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {goalRows.length > 0 && (
          <>
            <div className="mb-2 font-mono text-label uppercase text-chalk-soft">
              Savings goals
            </div>
            <div className="mb-5 scroll-x">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-panel-raised">
                    <th className="px-3 py-2 text-left font-mono text-label uppercase text-chalk">
                      Goal
                    </th>
                    <th className="px-3 py-2 text-right font-mono text-label uppercase text-chalk">
                      Remaining
                    </th>
                    <th className="px-3 py-2 text-right font-mono text-label uppercase text-chalk">
                      Assign
                    </th>
                    <th className="w-12 px-3 py-2">
                      <span className="sr-only">Fill to target</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {goalRows.map((row, i) => (
                    <tr key={row.goalId} className={i % 2 === 0 ? "bg-sheet" : "bg-sheet-alt"}>
                      <td className="px-3 py-2">
                        <div className="font-sans text-row text-ink">{row.name}</div>
                        <div className="font-mono text-label uppercase text-ink-soft">
                          {formatCents(row.availableCents)} of {formatCents(row.targetCents)}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-row text-ink-soft">
                        {row.remainingCents === 0 ? "Funded" : formatCents(row.remainingCents)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          {...amountField}
                          name={GOAL_FIELD_PREFIX + row.goalId}
                          aria-label={`Assign to ${row.name} goal`}
                          placeholder="$0"
                          className="w-24 border-0 border-b-2 border-rule bg-transparent px-0 py-1 text-right font-mono text-row text-ink outline-none transition-colors placeholder:text-ink-soft/60 focus:border-azure"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          variant="row"
                          size="sm"
                          type="button"
                          disabled={row.remainingCents === 0}
                          onClick={() => handleFillGoal(row)}
                        >
                          Fill
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {error && (
          <p role="alert" className="-mt-2 mb-5 font-sans text-row text-vermilion">
            {error}
          </p>
        )}
        <div className="flex justify-end">
          <Button variant="primary" type="submit">
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
