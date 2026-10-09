import { useEffect, useRef, useState } from "react";
import Dialog from "./Dialog";
import Button from "./Button";
import { ACCOUNT_SCOPES, useAccounts } from "../contexts/AccountsContext";
import { TRANSACTION_KINDS, useTransactions } from "../contexts/TransactionsContext";
import { amountEditing, amountField, formatCents, toCents, todayISO } from "../utils";

/**
 * "I paid it off" — the credit card's version of reconciling.
 *
 * Settling a card is the act a household actually does with one each month,
 * and what it confirms is the same thing a reconciliation does: the books and
 * the bank agree, because the balance is now zero. So this writes the payment
 * and stamps the card checked in one step.
 *
 * **The payment is a transfer**, checking → card, which is row one of the
 * transfer matrix: both sides spend through the budget, so it is not a second
 * call on any envelope — the money was budgeted on its way out through the card.
 * The amount opens on what is owed and stays editable, since a statement
 * balance paid in full is often less than what is owed today.
 *
 * **Which account it comes from is remembered on the card** (`payFromAccountId`)
 * when "Always pay from this account" is ticked — a default, nothing more. Only
 * on-budget accounts are offered: a card cannot pay a card here, and an
 * off-budget holding is not budget money.
 */
export default function PayOffCardModal({ show, row, handleClose }) {
  const formRef = useRef();
  const fromRef = useRef();
  const amountRef = useRef();
  const rememberRef = useRef();
  const [error, setError] = useState(null);
  const [openCount, setOpenCount] = useState(0);

  const { accounts, reconcileAccount, setPayFromAccount } = useAccounts();
  const { addTransaction } = useTransactions();

  const card = row?.account;
  const owedCents = Math.max(0, -(row?.balanceCents ?? 0));
  const sources = accounts.filter(
    (account) => account.scope === ACCOUNT_SCOPES.ON_BUDGET && account.id !== card?.id
  );
  const storedDefault = sources.some((account) => account.id === card?.payFromAccountId)
    ? card.payFromAccountId
    : null;

  useEffect(() => {
    if (!show) return;
    setError(null);
    setOpenCount((count) => count + 1);
    if (amountRef.current) amountRef.current.value = owedCents > 0 ? amountEditing(owedCents) : "";
    // Only on open: re-seeding when the balance moves would overwrite a
    // figure being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, card?.id]);

  function handleSubmit(event) {
    event.preventDefault();
    const fromId = fromRef.current.value || null;
    if (fromId == null) {
      setError("Choose the account you paid it from.");
      return;
    }
    const amountCents = toCents(amountRef.current.value);
    if (amountCents == null || amountCents <= 0) {
      setError("Enter how much you paid, as an amount above zero.");
      return;
    }
    const today = todayISO();

    const paid = addTransaction({
      kind: TRANSACTION_KINDS.TRANSFER,
      description: `Paid off ${card.name}`,
      amountCents,
      date: today,
      accountId: fromId,
      toAccountId: card.id,
    });
    if (!paid.ok) {
      setError(paid.error);
      return;
    }
    if (rememberRef.current?.checked && fromId !== card.payFromAccountId) {
      setPayFromAccount({ id: card.id, payFromAccountId: fromId });
    }
    reconcileAccount({ id: card.id, date: today });
    handleClose();
  }

  const labelClass = "mb-1.5 block font-mono text-label uppercase text-chalk-soft";
  const inputClass =
    "w-full border border-edge bg-panel-raised px-3 py-2 font-sans text-row text-chalk outline-none transition-colors placeholder:text-chalk-soft/60 focus:border-azure";

  return (
    <Dialog show={show} handleClose={handleClose} title={card ? `Pay off ${card.name}` : "Pay off"}>
      {card &&
        (sources.length === 0 ? (
          <p className="font-sans text-row text-chalk-soft">
            Add an on-budget account on the budget plan to pay a card from.
          </p>
        ) : (
          <form ref={formRef} onSubmit={handleSubmit}>
            <p className="mb-4 font-sans text-row text-chalk-soft">
              You owe {formatCents(owedCents)} on {card.name}. The payment is recorded as a
              transfer, so no category is charged twice, and the card is marked reconciled today.
            </p>

            <label className={labelClass} htmlFor="payoff-from">
              Paid from
            </label>
            <select
              id="payoff-from"
              key={`from-${card.id}-${openCount}`}
              ref={fromRef}
              className={inputClass}
              defaultValue={storedDefault ?? ""}
            >
              {storedDefault == null && <option value="">Choose an account</option>}
              {sources.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
            <label className="mt-2 flex items-center gap-2 font-sans text-row text-chalk">
              <input
                key={`remember-${card.id}-${openCount}`}
                ref={rememberRef}
                type="checkbox"
                defaultChecked={storedDefault == null}
              />
              Always pay {card.name} from this account
            </label>

            <label className={`${labelClass} mt-4`} htmlFor="payoff-amount">
              Amount paid
            </label>
            <input
              id="payoff-amount"
              ref={amountRef}
              {...amountField}
              className={`${inputClass} font-mono tabular-nums`}
            />

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
                Record payment
              </Button>
            </div>
          </form>
        ))}
    </Dialog>
  );
}
