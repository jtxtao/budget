import { useCallback, useEffect, useRef, useState } from "react";
import Dialog from "./Dialog";
import Button from "./Button";
import {
  ACCOUNT_TYPES,
  isOffBudget,
  scopeLabel,
  toEnteredBalanceCents,
  toStoredBalanceCents,
  useAccounts,
} from "../contexts/AccountsContext";
import { describeSource } from "../hooks/useNetWorth";
import { amountAtRest, amountField, formatCents, formatPeriod, toCents } from "../utils";

const FIELD_PREFIX = "balance:";

/**
 * The first-of-the-month pass: every account, one figure each.
 *
 * The workflow this page is built around. Once a month the user sits down with
 * their statements and records what everything was worth — and this asks for all
 * of it in one form rather than one account at a time, because that is how the
 * task is actually done.
 *
 * **It writes to whichever month the page is on**, which is also the backfill
 * mechanism: step the page back to March, open this, enter March's figures.
 * There is no separate "backfill" mode, because there is no difference — a month
 * entered late is the same record as a month entered on time. The month is in
 * the title in full for exactly that reason: this is the one form in the app
 * whose target the user changes from outside it, and "March 2026" in the heading
 * is what stops a backfill being written into today.
 *
 * **A blank field means two different things, and each row says which.** For a
 * hand-valued holding it means "no figure for this month", so the account keeps
 * the one it was last given. For an account the budget spends through it means
 * "ask the books", which is the right answer almost always — so those fields
 * start empty, with the ledger's figure as the hint beside them, and only a
 * figure the user actually types becomes a record. That is what stops a monthly
 * pass done on the 12th from freezing the account halfway through the month.
 *
 * Uncontrolled, like every form here: one `name` per row read back with
 * FormData, and a live net-worth counter recomputed from that same FormData in
 * one form-level `onChange` rather than a row of `useState`. Because the modal
 * never unmounts it re-seeds on open — and on the period, since every figure in
 * it is period-scoped.
 */

/** A debt is entered as the amount owed, positive, and stored signed. The
 *  conversion itself lives with the store that owns the convention, so this form
 *  and the backfill grid on Configuration cannot come to apply it differently. */
const isOwed = (account) => account.type === ACCOUNT_TYPES.LIABILITY;
const entered = toStoredBalanceCents;
const shown = toEnteredBalanceCents;

export default function UpdateBalancesModal({ show, period, tracked, handleClose }) {
  const formRef = useRef();
  const [error, setError] = useState(null);
  const [netCents, setNetCents] = useState(0);

  const { setPeriodBalances } = useAccounts();

  const recompute = useCallback(() => {
    const form = formRef.current;
    if (!form) return;

    const data = new FormData(form);
    let total = 0;
    for (const row of tracked) {
      const raw = data.get(FIELD_PREFIX + row.account.id);
      // A blank row is not zero — it is "nothing to say about this month", so
      // whatever would answer instead is what counts towards the total on
      // screen: the books for an everyday account, the last figure entered for a
      // holding. `valueCents` is already that fallback.
      const cents =
        String(raw ?? "").trim() === ""
          ? row.valueCents
          : entered(row.account, toCents(raw) ?? 0);
      total += cents;
    }
    setNetCents(total);
  }, [tracked]);

  useEffect(() => {
    if (!show) return;
    const form = formRef.current;
    if (!form) return;

    form.reset();
    setError(null);
    for (const row of tracked) {
      const input = form.elements[FIELD_PREFIX + row.account.id];
      if (!input) continue;
      // A hand-valued holding is seeded with the figure in force — usually last
      // month's, which is the right starting point for something that barely
      // moves and a harmless one for something that does. Blank would make the
      // common case ("the house is still worth the same") a retype.
      //
      // An account the budget spends through starts empty unless this month
      // already has a figure, so saving the form does not quietly turn the
      // ledger's answer into a record that supersedes it. Its figure is beside
      // the field to be read off, and typing is what makes it a statement.
      input.value =
        row.hand || isOffBudget(row.account) ? amountAtRest(shown(row.account, row.valueCents)) : "";
    }
    recompute();
    // `tracked` is rebuilt every render; depending on it would re-seed the form
    // out from under the user on every keystroke. The period is a real
    // dependency — every figure here is scoped to it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, period]);

  function handleSubmit(e) {
    e.preventDefault();

    const data = new FormData(formRef.current);
    const entries = [];

    // Validated up front, so a form covering six holdings cannot fail on the
    // fourth and leave three of them committed.
    for (const row of tracked) {
      const raw = String(data.get(FIELD_PREFIX + row.account.id) ?? "").trim();
      if (raw === "") {
        // Clears this month's snapshot rather than storing zero: the account
        // goes back to carrying its previous figure forward, which is what an
        // emptied field means. Zero is a real balance and needs a typed 0.
        entries.push({ accountId: row.account.id, amount: "", label: row.account.name });
        continue;
      }

      const cents = toCents(raw);
      if (cents == null) {
        setError(`Enter a valid balance for ${row.account.name}.`);
        formRef.current.elements[FIELD_PREFIX + row.account.id]?.focus();
        return;
      }
      entries.push({
        accountId: row.account.id,
        amountCents: entered(row.account, cents),
        label: row.account.name,
      });
    }

    const result = setPeriodBalances({ period, entries });
    // Keep the modal open on a rejection, so the typed figures are still there
    // to correct.
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
      wide
      title={`Update balances · ${formatPeriod(period)}`}
    >
      <form ref={formRef} onSubmit={handleSubmit} onChange={recompute}>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border border-edge bg-panel-raised px-4 py-3">
          <div>
            <div className="font-mono text-label uppercase text-chalk-soft">
              Net worth, as entered
            </div>
            {/* A status region, so the figure is announced as it changes rather
                than only being visible. */}
            <div role="status" className="font-mono text-figure font-medium text-chalk">
              {formatCents(netCents)}
            </div>
          </div>
          <p className="max-w-[18rem] font-sans text-row text-chalk-soft">
            Everything you hold, as it stood at the end of {formatPeriod(period)}. Leave a field
            empty and the figure beside it stands.
          </p>
        </div>

        {tracked.length === 0 ? (
          <p className="mb-5 font-sans text-row text-chalk-soft">
            Nothing to update. Add an account on the budget plan — the everyday one you spend
            from, then the 401(k), the brokerage, the house — and it will appear here to be
            recorded each month.
          </p>
        ) : (
          <div className="mb-5 overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-panel-raised">
                  <th className="px-3 py-2 text-left font-mono text-label uppercase text-chalk">
                    Account
                  </th>
                  <th className="px-3 py-2 text-right font-mono text-label uppercase text-chalk">
                    In force
                  </th>
                  <th className="px-3 py-2 text-right font-mono text-label uppercase text-chalk">
                    {formatPeriod(period)}
                  </th>
                </tr>
              </thead>
              <tbody>
                {tracked.map((row, index) => {
                  const source = describeSource(row, period);
                  return (
                    <tr
                      key={row.account.id}
                      className={index % 2 === 0 ? "bg-sheet" : "bg-sheet-alt"}
                    >
                      <td className="px-3 py-2">
                        <div className="font-sans text-row text-ink">{row.account.name}</div>
                        <div className="font-mono text-label uppercase text-ink-soft">
                          {isOwed(row.account) ? "Amount owed" : scopeLabel(row.account)}
                        </div>
                      </td>
                      {/* What the month is worth as things stand, and which of
                          the two answers that is. A user typing over the ledger's
                          figure is making a claim about it, and has to be able to
                          see the claim they are contradicting. */}
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        <div className="font-mono text-row tabular-nums text-ink">
                          {formatCents(shown(row.account, row.valueCents))}
                        </div>
                        <div
                          className={`font-mono text-label uppercase ${
                            source.stale ? "text-vermilion-ink" : "text-ink-soft"
                          }`}
                        >
                          {source.text}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          {...amountField}
                          name={FIELD_PREFIX + row.account.id}
                          aria-label={`${isOwed(row.account) ? "Amount owed on" : "Value of"} ${
                            row.account.name
                          }`}
                          placeholder={formatCents(shown(row.account, row.valueCents))}
                          className="w-32 border-0 border-b-2 border-rule bg-transparent px-0 py-1 text-right font-mono text-row text-ink outline-none transition-colors placeholder:text-ink-soft/60 focus:border-azure"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {error && (
          <p role="alert" className="-mt-2 mb-5 font-sans text-row text-vermilion">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-[30rem] font-sans text-row text-chalk-soft">
            Clearing a field leaves {formatPeriod(period)} unrecorded: a hand-valued holding keeps
            the figure it was last given, and an everyday account goes back to what the ledger
            says.
          </p>
          <Button variant="primary" type="submit" disabled={tracked.length === 0}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
