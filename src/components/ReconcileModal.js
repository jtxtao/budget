import { useEffect, useRef, useState } from "react";
import Dialog from "./Dialog";
import Button from "./Button";
import {
  ACCOUNT_TYPES,
  toEnteredBalanceCents,
  toStoredBalanceCents,
  useAccounts,
} from "../contexts/AccountsContext";
import { useBudgets } from "../contexts/BudgetsContext";
import { TRANSACTION_KINDS, useTransactions } from "../contexts/TransactionsContext";
import { amountField, formatCents, formatDateMedium, toCents, todayISO } from "../utils";

/**
 * Check an account against its statement, and settle it when the two do not
 * agree.
 *
 * Marking an account reconciled used to be one click that said "the books are
 * right". That left nothing to do on the day they were not and nobody could
 * find out why — so this asks for the statement's figure, **blank meaning the
 * books' own figure** (it is shown in the field in grey, and a figure shown in
 * a field is a figure in force), and where the two differ it writes the
 * difference as an ordinary transaction before stamping the account checked.
 *
 * The adjustment is `FixDriftModal`'s, for its reasons: a statement above the
 * books is money that arrived unrecorded, so an **inflow** waiting to be
 * assigned; one below is money that left unrecorded, so an **outflow** that has
 * to come out of a category like any other spending. Two kinds the ledger
 * already has rather than a fourth, so every figure downstream moves exactly as
 * though the row had been entered at the time. Dated today, because today is
 * the day the statement and the books are being made to agree.
 *
 * A liability is entered the way its statement prints it — what is owed, as a
 * positive figure — and turned round through `toStoredBalanceCents`, the pair
 * every other balance field uses.
 */
export default function ReconcileModal({ show, row, handleClose }) {
  const formRef = useRef();
  const [error, setError] = useState(null);
  const [typed, setTyped] = useState("");

  const { reconcileAccount } = useAccounts();
  const { addTransaction } = useTransactions();
  const { budgets } = useBudgets();

  const account = row?.account;
  const booksCents = row?.balanceCents ?? 0;

  useEffect(() => {
    if (!show) return;
    formRef.current?.reset();
    setTyped("");
    setError(null);
  }, [show, account?.id]);

  // What the statement says, signed the way the books are. Blank is the books'
  // own figure; junk is held as null so the read-out can say so.
  const statementCents =
    typed.trim() === ""
      ? booksCents
      : (() => {
          const cents = toCents(typed);
          return cents == null || account == null ? null : toStoredBalanceCents(account, cents);
        })();
  const differenceCents = statementCents == null ? null : statementCents - booksCents;
  const found = differenceCents != null && differenceCents > 0;

  function handleSubmit(event) {
    event.preventDefault();
    if (statementCents == null) {
      setError("Enter the statement balance as an amount, or leave it blank if it matches.");
      return;
    }
    const today = todayISO();

    if (differenceCents !== 0) {
      const data = new FormData(formRef.current);
      const budgetId = found ? null : data.get("budgetId") || null;
      if (!found && budgetId == null) {
        setError("Choose the category this money came out of.");
        return;
      }
      const result = addTransaction({
        kind: found ? TRANSACTION_KINDS.INFLOW : TRANSACTION_KINDS.OUTFLOW,
        description: "Reconciliation adjustment",
        amountCents: Math.abs(differenceCents),
        date: today,
        accountId: account.id,
        budgetId,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
    }

    const result = reconcileAccount({ id: account.id, date: today });
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
    <Dialog show={show} handleClose={handleClose} title={account ? `Reconcile ${account.name}` : "Reconcile"}>
      {account && (
        <form ref={formRef} onSubmit={handleSubmit}>
          <label className={labelClass} htmlFor="reconcile-statement">
            {account.type === ACCOUNT_TYPES.LIABILITY ? "Statement says you owe" : "Statement balance"}
          </label>
          <input
            id="reconcile-statement"
            name="statement"
            type="text"
            inputMode="decimal"
            className={`${inputClass} font-mono tabular-nums`}
            placeholder={formatCents(toEnteredBalanceCents(account, booksCents))}
            aria-describedby="reconcile-statement-note"
            onFocus={amountField.onFocus}
            onChange={(event) => setTyped(event.target.value)}
          />
          <p id="reconcile-statement-note" className="mt-1.5 font-sans text-row text-chalk-soft">
            Leave it blank if it matches the books.
          </p>

          {differenceCents != null && differenceCents !== 0 && (
            <>
              <p className="mt-4 font-sans text-row text-chalk-soft">
                {found ? (
                  <>
                    The statement is {formatCents(Math.abs(differenceCents))} above the books. It
                    will be recorded as income on {account.name}, waiting to be assigned.
                  </>
                ) : (
                  <>
                    The books are {formatCents(Math.abs(differenceCents))} above the statement. It
                    will be recorded as spending on {account.name}, out of the category you choose.
                  </>
                )}
              </p>
              {!found && (
                <div className="mt-4">
                  <label className={labelClass} htmlFor="reconcile-budget">
                    Category
                  </label>
                  <select id="reconcile-budget" name="budgetId" className={inputClass} defaultValue="">
                    <option value="">Choose a category</option>
                    {budgets.map((budget) => (
                      <option key={budget.id} value={budget.id}>
                        {budget.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}

          <p className="mt-3 font-sans text-row text-chalk-soft">
            Marked reconciled on {formatDateMedium(todayISO())}.
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
              {differenceCents ? "Adjust and reconcile" : "Reconcile"}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
