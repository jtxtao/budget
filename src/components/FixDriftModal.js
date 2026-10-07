import { useEffect, useRef, useState } from "react";
import Dialog from "./Dialog";
import Button from "./Button";
import { useBudgets } from "../contexts/BudgetsContext";
import { TRANSACTION_KINDS, useTransactions } from "../contexts/TransactionsContext";
import {
  currentPeriod,
  formatCents,
  formatDateMedium,
  formatPeriod,
  periodEnd,
  todayISO,
} from "../utils";

/**
 * Settle the difference between what a statement says an account holds and what
 * the books make of it.
 *
 * `useNetWorth` has always **reported** that gap and deliberately never resolved
 * it — a disagreement between two honest records is information, and quietly
 * picking a winner would destroy it. What was missing was the other half: a way
 * for the user to say which one is right. That is this, and it is a decision
 * they make rather than one the app makes for them.
 *
 * **The correction is an ordinary transaction, not a fourth kind of record.**
 * A statement higher than the books means money arrived that nobody wrote down,
 * which is income the household can now assign; a statement lower means money
 * left that nobody wrote down, which is spending and has to come out of a
 * category like any other. Those are the two kinds the ledger already has, and
 * using them is what keeps every figure downstream true by construction — the
 * envelope identity, the account balance, the spending report and the net-worth
 * drift itself all move exactly as they would have if the row had been entered
 * at the time. A dedicated "adjustment" kind would need a rule in every one of
 * them, and the first consumer to forget it would break the invariant.
 *
 * **It is dated inside the month the statement is for**, which is the whole
 * point — the gap is a disagreement about *that* month, and a correction landing
 * in this one would leave it standing. Month-end, except in the current month,
 * where today is the same period and does not read as a future date on the
 * register.
 *
 * Nothing is reconciled here. Stamping the account checked is its own act on the
 * dashboard, and a second door to it on this screen would make a reader stop and
 * work out whether the two do the same thing — `HoldingsTable`'s rule about the
 * update button, one row lower.
 */
export default function FixDriftModal({ show, row, period, handleClose }) {
  const formRef = useRef();
  const [error, setError] = useState(null);

  const { addTransaction } = useTransactions();
  const { budgets } = useBudgets();

  const driftCents = row?.driftCents ?? 0;
  // Positive drift is a statement above the books: money the ledger never saw
  // arrive. Negative is the reverse.
  const found = driftCents > 0;
  const magnitudeCents = Math.abs(driftCents);

  useEffect(() => {
    if (!show) return;
    const form = formRef.current;
    if (!form) return;
    form.reset();
    setError(null);
  }, [show, row]);

  function handleSubmit(e) {
    e.preventDefault();
    const data = new FormData(formRef.current);
    const budgetId = found ? null : data.get("budgetId") || null;

    // The category is the store's own rule for an outflow, checked here too so
    // the message names the account rather than the field.
    if (!found && budgetId == null) {
      setError("Choose the category this money came out of.");
      return;
    }

    const result = addTransaction({
      kind: found ? TRANSACTION_KINDS.INFLOW : TRANSACTION_KINDS.OUTFLOW,
      description: data.get("description") || defaultDescription(period),
      amountCents: magnitudeCents,
      date: correctionDate(period),
      accountId: row.account.id,
      budgetId,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    handleClose();
  }

  const labelClass = "mb-1.5 block font-mono text-label uppercase text-chalk-soft";
  const inputClass =
    "w-full border border-edge bg-panel-raised px-3 py-2 font-sans text-row text-chalk outline-none transition-colors placeholder:text-chalk-soft/60 focus:border-azure";

  return (
    <Dialog show={show} handleClose={handleClose} title="Settle the difference">
      {row == null || driftCents === 0 ? (
        <p className="font-sans text-row text-chalk-soft">
          Nothing to settle — the statement and the books agree.
        </p>
      ) : (
        <form ref={formRef} onSubmit={handleSubmit}>
          <dl className="border border-edge bg-panel-raised px-4 py-3">
            <Line label={`${row.account.name}, as entered`} cents={row.valueCents} />
            <Line label="What the books make it" cents={row.derivedCents} />
            <div className="mt-2 flex items-baseline justify-between gap-4 border-t border-edge pt-2">
              <dt className="font-mono text-label uppercase text-chalk">Difference</dt>
              <dd className="whitespace-nowrap font-mono text-row font-medium tabular-nums text-chalk">
                {formatCents(driftCents)}
              </dd>
            </div>
          </dl>

          <p className="mt-4 font-sans text-row text-chalk-soft">
            {found ? (
              <>
                The statement is {formatCents(magnitudeCents)} above the books, so money arrived
                that was never written down. Recording it as income on {row.account.name} puts the
                two back in step and leaves that {formatCents(magnitudeCents)} waiting to be
                assigned.
              </>
            ) : (
              <>
                The books are {formatCents(magnitudeCents)} above the statement, so money left that
                was never written down. Recording it as spending on {row.account.name} puts the two
                back in step — it has to come out of a category, like any other money spent.
              </>
            )}
          </p>

          {!found && (
            <div className="mt-4">
              <label className={labelClass} htmlFor="drift-budget">
                Category
              </label>
              <select id="drift-budget" name="budgetId" className={inputClass} defaultValue="">
                <option value="">Choose a category</option>
                {budgets.map((budget) => (
                  <option key={budget.id} value={budget.id}>
                    {budget.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="mt-4">
            <label className={labelClass} htmlFor="drift-description">
              Note
            </label>
            <input
              id="drift-description"
              name="description"
              type="text"
              className={inputClass}
              placeholder={defaultDescription(period)}
            />
          </div>

          {/* A sentence, so it is set as one. `text-label uppercase` is for the
              short names above fields; a line of prose in it reads as shouting
              and wraps badly. */}
          <p className="mt-3 font-sans text-row text-chalk-soft">
            Dated {formatDateMedium(correctionDate(period))}, inside {formatPeriod(period)} — the
            month the statement is for.
          </p>

          {error && (
            <p role="alert" className="mt-4 font-sans text-row text-vermilion">
              {error}
            </p>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={handleClose}>
              Cancel
            </Button>
            <Button variant="primary" type="submit">
              Record it
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

/** Inside the statement's own month, so the gap it closes is the one that was
 *  reported. Today when that is the current month, purely so the register does
 *  not show a date that has not happened yet — the period is the same either
 *  way, and the period is what every figure here is filtered on. */
function correctionDate(period) {
  return period === currentPeriod() ? todayISO() : periodEnd(period);
}

function defaultDescription(period) {
  return `Balance correction · ${formatPeriod(period)}`;
}

function Line({ label, cents }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="font-sans text-row text-chalk-soft">{label}</dt>
      <dd className="whitespace-nowrap font-mono text-row tabular-nums text-chalk">
        {formatCents(cents)}
      </dd>
    </div>
  );
}
