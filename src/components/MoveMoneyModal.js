import { useCallback, useEffect, useRef, useState } from "react";
import Dialog from "./Dialog";
import Button from "./Button";
import useEnvelopes from "../hooks/useEnvelopes";
import { useAssignments } from "../contexts/AssignmentsContext";
import { TO_BE_ASSIGNED } from "../contexts/constants";
import { amountAtRest, amountField, formatCents, formatPeriod, toCents } from "../utils";

/**
 * Move money from one envelope to another.
 *
 * The second of the two everyday acts of envelope budgeting, beside assigning
 * income — and until now the only one with no door of its own. Covering an
 * overspent category out of one that came in under was expressible as two trips
 * through `AssignIncomeModal`, subtracting here and adding there, with the user
 * holding the arithmetic in their head in between and the pool briefly showing
 * money that was never free. **One action, one write, and nothing in between to
 * see** — `moveBetweenBudgets` is where that is guaranteed.
 *
 * It is a modal and not a row of cells for `AddAccountModal`'s reason: a move is
 * three interlocking answers that are only valid together, and the figure it is
 * checked against (what the source actually has) is not on any one row.
 *
 * Uncontrolled like every other form here, with the live before-and-after read
 * off `FormData` in one form-level `onChange` — `AssignIncomeModal`'s idiom, and
 * for its reason: it keeps `form.reset()` working, and seeding from derived rows
 * would let this modal's own write echo back and clobber what is being typed.
 *
 * **It states what each side will be left with and refuses nothing for it.** A
 * move that leaves the source overdrawn is a real thing to want in the days
 * before a paycheque, and the app has exactly one way of saying so — the figure
 * goes red, here before the write and on the row after it. See
 * `moveBetweenBudgets`, which could not check it in any case.
 *
 * **"To be assigned" is offered on both sides**, first in each list. Funding a
 * short category is usually a matter of giving it unassigned money rather than
 * taking it from a neighbour, and sending what a category no longer needs back
 * to the pool is the same act reversed — so one door covers all three, and the
 * dashboard can open it on a short category with the pool already picked and
 * the shortfall already typed. The pool is not a row, so its before-and-after
 * is the pool figure itself, held to the same red rule as everything else.
 */
export default function MoveMoneyModal({ show, period, seed, handleClose }) {
  const formRef = useRef();
  const [error, setError] = useState(null);
  // A mirror of the three fields, for the read-out only. The form is still what
  // submit reads, so there is only ever one answer.
  const [preview, setPreview] = useState({ fromId: "", toId: "", cents: 0 });

  const { moveBetweenBudgets } = useAssignments();
  const { rows, toBeAssignedCents } = useEnvelopes(period);

  // The same rule `AssignIncomeModal` uses for which rows are editable:
  // configured categories, plus the catch-alls whenever they hold a balance or
  // saw activity. An uncovered overspend sitting on Uncategorized is precisely
  // the row somebody opens this to settle.
  const movable = rows.filter(
    (row) =>
      row.kind === "category" ||
      row.availableCents !== 0 ||
      row.assignedCents !== 0 ||
      row.activityCents !== 0
  );

  // The pool, shaped like a row so the read-out can treat both sides alike.
  const pool = { budgetId: TO_BE_ASSIGNED, name: "To be assigned", availableCents: toBeAssignedCents };
  const choices = [pool, ...movable];

  const rowFor = (budgetId) => choices.find((row) => row.budgetId === budgetId) ?? null;

  const recompute = useCallback(() => {
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);
    setPreview({
      fromId: String(data.get("fromBudgetId") ?? ""),
      toId: String(data.get("toBudgetId") ?? ""),
      cents: toCents(data.get("amount")) ?? 0,
    });
  }, []);

  // Stays mounted, so re-seed on every open — and again if the period steps
  // underneath it, since every figure here is period-scoped. Keyed on the seed
  // too: the page opens this same modal from a different row without closing it
  // in between, which is `AddSavingsGoalModal`'s case.
  useEffect(() => {
    if (!show) return;
    const form = formRef.current;
    if (!form) return;
    form.reset();
    setError(null);
    form.elements.fromBudgetId.value = seed?.fromBudgetId ?? "";
    form.elements.toBudgetId.value = seed?.toBudgetId ?? "";
    form.elements.amount.value =
      seed?.amountCents > 0 ? amountAtRest(seed.amountCents) : "";
    recompute();
  }, [show, period, seed, recompute]);

  function handleSubmit(e) {
    e.preventDefault();
    const data = new FormData(formRef.current);
    const result = moveBetweenBudgets({
      fromBudgetId: data.get("fromBudgetId") || null,
      toBudgetId: data.get("toBudgetId") || null,
      period,
      amount: data.get("amount"),
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    handleClose();
  }

  const fromRow = rowFor(preview.fromId);
  const toRow = rowFor(preview.toId);
  // Only once there is a real direction and a real figure is there anything to
  // say — a half-filled form should not be predicting an outcome.
  const showPreview =
    fromRow != null && toRow != null && fromRow !== toRow && preview.cents > 0;

  const fromPool = preview.fromId === TO_BE_ASSIGNED;
  const toPool = preview.toId === TO_BE_ASSIGNED;
  const submitLabel = fromPool ? "Assign it" : toPool ? "Return it" : "Move it";

  const selectClass =
    "w-full border border-edge bg-panel-raised px-3 py-2 font-sans text-row text-chalk outline-none transition-colors focus:border-azure";
  const labelClass = "mb-1.5 block font-mono text-label uppercase text-chalk-soft";

  return (
    <Dialog show={show} handleClose={handleClose} title={`Move money · ${formatPeriod(period)}`}>
      {movable.length < 1 ? (
        <p className="font-sans text-row text-chalk-soft">
          Moving money needs a category to move it into. Add one on the budget plan and this will
          have somewhere to go.
        </p>
      ) : (
        <form ref={formRef} onSubmit={handleSubmit} onChange={recompute}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="move-from">
                Move from
              </label>
              <select id="move-from" name="fromBudgetId" className={selectClass}>
                <option value="">Choose a category</option>
                {choices.map((row) => (
                  <option key={row.budgetId} value={row.budgetId}>
                    {row.name} — {formatCents(row.availableCents)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="move-to">
                Move to
              </label>
              <select id="move-to" name="toBudgetId" className={selectClass}>
                <option value="">Choose a category</option>
                {choices.map((row) => (
                  <option key={row.budgetId} value={row.budgetId}>
                    {row.name} — {formatCents(row.availableCents)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-4">
            {/* "Amount to move" rather than "Amount": this modal is mounted
                alongside the dashboard's other one, and two controls a reader
                tabbing between cannot tell apart is the same problem two
                identically-worded <details> summaries were. */}
            <label className={labelClass} htmlFor="move-amount">
              Amount to move
            </label>
            <input
              {...amountField}
              id="move-amount"
              name="amount"
              placeholder="$0.00"
              className="w-40 border border-edge bg-panel-raised px-3 py-2 font-mono text-row text-chalk outline-none transition-colors placeholder:text-chalk-soft/60 focus:border-azure"
            />
          </div>

          {/* A status region, so the outcome is announced as it is typed rather
              than only being visible. Both sides, because the question somebody
              opens this with is whether the source can spare it. */}
          <div
            role="status"
            className="mt-5 min-h-[4.5rem] border border-edge bg-panel-raised px-4 py-3"
          >
            {showPreview ? (
              <>
                <div className="font-mono text-label uppercase text-chalk-soft">After the move</div>
                <dl className="mt-1.5 grid gap-1">
                  <Outcome
                    name={fromRow.name}
                    fromCents={fromRow.availableCents}
                    toCents={fromRow.availableCents - preview.cents}
                  />
                  <Outcome
                    name={toRow.name}
                    fromCents={toRow.availableCents}
                    toCents={toRow.availableCents + preview.cents}
                  />
                </dl>
              </>
            ) : (
              <p className="font-sans text-row text-chalk-soft">
                Pick where the money comes from, where it goes and how much, and what each will be
                left with appears here. “To be assigned” is your unassigned money.
              </p>
            )}
          </div>

          {error && (
            <p role="alert" className="mt-4 font-sans text-row text-vermilion">
              {error}
            </p>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={handleClose}>
              Cancel
            </Button>
            {/* Not "Move money", which is what the button that *opens* this
                says — `EnterScheduledModal`'s "Record it" for the same reason. */}
            <Button variant="primary" type="submit">
              {submitLabel}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

/** One side of the move, before and after. The app's one definition of trouble
 *  applies to the figure it would land on, which is the whole point of showing
 *  it before the write rather than after. */
function Outcome({ name, fromCents, toCents }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="font-sans text-row text-chalk">{name}</dt>
      <dd className="whitespace-nowrap font-mono text-row tabular-nums">
        <span className="text-chalk-soft">{formatCents(fromCents)}</span>
        <span aria-hidden="true" className="px-2 text-chalk-soft">
          →
        </span>
        <span className={toCents < 0 ? "font-medium text-vermilion" : "font-medium text-chalk"}>
          {formatCents(toCents)}
        </span>
      </dd>
    </div>
  );
}
