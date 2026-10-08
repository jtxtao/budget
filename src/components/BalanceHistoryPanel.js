import { useEffect, useRef, useState } from "react";
import Button from "./Button";
import {
  ACCOUNT_TYPES,
  spendsThroughBudget,
  toEnteredBalanceCents,
  toStoredBalanceCents,
  useAccounts,
} from "../contexts/AccountsContext";
import useNetWorth, { indexSnapshots, snapshotAt } from "../hooks/useNetWorth";
import {
  addMonths,
  amountAtRest,
  amountField,
  currentPeriod,
  formatCents,
  formatPeriod,
  periodLTE,
  toCents,
} from "../utils";

/**
 * A year of past months for every hand-tracked holding, in one grid.
 *
 * The Net worth page already backfills a month at a time — step back, update,
 * step forward — and for the month somebody missed that is exactly right. It is
 * the wrong shape for the other job: arriving with three years of statements and
 * wanting the chart to know about them. Twelve open-and-close cycles of a modal
 * is not a form, it is a chore, and the figures being entered are one series per
 * holding, which is a column, not twelve unrelated forms.
 *
 * So this is the same records through a different door, and it is **closed by
 * default**. Backfilling is a one-off: it happens when the books are set up and
 * then almost never again, and a grid of a hundred and forty-four fields sitting
 * open on the page every time somebody comes to rename a category would be the
 * loudest thing on a page that is not about it.
 *
 * It is on Configuration rather than beside the chart because that is where the
 * accounts themselves are set up, and because it does not break the rule that
 * gives this page no month in its corner: there is no single month here to be
 * ambiguous about. **Every row names its own**, which is what makes a grid safe
 * where a stepper-and-form would not be.
 *
 * **Every account has a column**, everyday ones included. Before the books
 * opened, the ledger has nothing to say about the current account either — its
 * derived balance is the opening figure and no more — so a year of history that
 * skipped it would draw a flat line where the household's cash used to be. What
 * a blank cell falls back to is what differs, and it is the rule the whole hook
 * is built on: an account the budget spends through falls back to **the books
 * for that month**, a hand-valued holding to **the figure above it**. Both are
 * shown in the empty cell as a hint, so the grid reads as the series it is.
 *
 * Uncontrolled, like every other form here. Each cell is keyed on its account,
 * its month, *and* the figure stored for it — so moving the window re-seeds every
 * field with the months it now covers, and a save re-seeds them with what was
 * actually written.
 */

/** How many months the grid covers, and how far a step moves it. A year, so a
 *  full statement year is one screen and one save. */
export const HISTORY_MONTHS = 12;

const FIELD_PREFIX = "history:";
const cellKey = (accountId, period) => `${accountId}:${period}`;
const fieldName = (accountId, period) => FIELD_PREFIX + cellKey(accountId, period);

const isOwed = (account) => account.type === ACCOUNT_TYPES.LIABILITY;

/** What the field asks for, said the way a screen reader will read it: a debt is
 *  asked for as the amount owed, as it is everywhere else. */
const fieldLabel = (account, period) =>
  `${isOwed(account) ? `Amount owed on ${account.name}` : `Value of ${account.name}`}, ${formatPeriod(
    period
  )}`;

const inputClass =
  "w-28 border-0 border-b-2 border-rule bg-transparent px-0 py-1 text-right font-mono text-row text-ink outline-none transition-colors placeholder:text-ink-soft/60 focus:border-azure";

export default function BalanceHistoryPanel() {
  // The window ends at the current month and reaches a year back. Held here
  // rather than on the page: it is which months are on screen, not anything the
  // rest of the page knows about.
  const [end, setEnd] = useState(currentPeriod);
  const [inForce, setInForce] = useState(() => new Map());
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);
  const formRef = useRef();

  const { accounts, balances, setBalanceHistory } = useAccounts();
  // The window's own months, straight from the hook that draws the chart — which
  // is where the per-month ledger balances come from. Deriving them here instead
  // would be a second definition of what an account holds, free to drift from the
  // figure the chart shows for the very same month.
  const { series } = useNetWorth(end, { months: HISTORY_MONTHS });

  const periods = series.map((entry) => entry.period);
  const start = periods[0];

  const derivedCents = new Map();
  for (const entry of series) {
    for (const row of entry.rows) {
      derivedCents.set(cellKey(row.account.id, entry.period), row.derivedCents);
    }
  }

  // The figures actually on record, cell by cell. Only an exact match seeds a
  // field: a blank cell means "no snapshot for this month", which is a different
  // fact from the value it inherits, and seeding the inherited one would turn a
  // save into twelve copies of last year's figure.
  const stored = new Map(
    balances.map((balance) => [cellKey(balance.accountId, balance.period), balance.amountCents])
  );

  // What each hand-valued holding was worth going into the window, which is where
  // the carried-forward figures in the empty cells start from. Read through the
  // chart's own lookup rather than a second one written here. With nothing on
  // record at all it falls back to the opening balance, which is what
  // `useNetWorth` derives for a holding the budget never spends through.
  const snapshots = indexSnapshots(balances);
  const before = addMonths(start, -1);
  const openingCents = new Map(
    accounts.map((account) => [
      account.id,
      snapshotAt(snapshots, account.id, before)?.amountCents ?? account.openingBalanceCents ?? 0,
    ])
  );

  const today = currentPeriod();
  const canGoLater = !periodLTE(today, end);

  /**
   * What every cell is worth *in force*, typed figures included — the two
   * fallback rules from `useNetWorth`, applied live to a grid that is half typed
   * in and half not:
   *
   *   spent through → the figure typed for that month, else the books' own
   *   hand-valued   → the figure typed for that month, else the last one above it
   *
   * which is what makes the placeholders and the running totals worth having: the
   * column reads as the series the chart will draw. Recomputed from FormData in
   * one form-level handler rather than held per cell, as `AssignIncomeModal` does
   * with its counter.
   */
  function recompute() {
    const form = formRef.current;
    if (!form) return;

    const data = new FormData(form);
    const next = new Map();
    for (const account of accounts) {
      const derives = spendsThroughBudget(account);
      let carried = openingCents.get(account.id) ?? 0;

      for (const period of periods) {
        const key = cellKey(account.id, period);
        const raw = String(data.get(fieldName(account.id, period)) ?? "").trim();
        const typed = raw === "" ? null : toCents(raw);
        if (typed != null) carried = toStoredBalanceCents(account, typed);

        // A statement figure never stands in for a month the books can answer,
        // so the fallback is this month's ledger balance rather than the row
        // above — the same asymmetry `useNetWorth` reads these records by.
        next.set(
          key,
          derives ? (typed != null ? carried : derivedCents.get(key) ?? 0) : carried
        );
      }
    }
    setInForce(next);
  }

  useEffect(() => {
    recompute();
    // The window moving and the stored figures changing are the two things that
    // re-seed the fields, so the totals beside them have to follow. Deliberately
    // not `accounts` or `periods`, which are rebuilt on every render — depending
    // on those would recompute the grid out from under a keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [end, balances]);

  function handleChange() {
    setDirty(true);
    setSaved(null);
    recompute();
  }

  function moveWindow(delta) {
    const next = addMonths(end, delta * HISTORY_MONTHS);
    // Never past the current month. This grid is for history; a column of months
    // that have not happened yet is a different feature, and one that would put
    // figures on the chart's right-hand edge that nobody could have read off a
    // statement.
    setEnd(periodLTE(next, today) ? next : today);
    setDirty(false);
    setError(null);
    setSaved(null);
  }

  function handleSubmit(e) {
    e.preventDefault();

    const data = new FormData(formRef.current);
    const months = [];

    // Parsed here rather than left to the store, because the sign of a debt is
    // the form's to apply — and because a rejected cell has to be named by its
    // month as well as its account for the message to point anywhere.
    for (const period of periods) {
      const entries = [];
      for (const account of accounts) {
        const raw = String(data.get(fieldName(account.id, period)) ?? "").trim();
        if (raw === "") {
          // Clears the snapshot rather than storing zero, exactly as the monthly
          // update does: the month goes back to being one nobody recorded, and
          // falls back to whichever answer that account has.
          entries.push({ accountId: account.id, amount: "", label: account.name });
          continue;
        }

        const cents = toCents(raw);
        if (cents == null) {
          setError(`Enter a valid balance for ${account.name} in ${formatPeriod(period)}.`);
          formRef.current.elements[fieldName(account.id, period)]?.focus();
          return;
        }
        entries.push({
          accountId: account.id,
          amountCents: toStoredBalanceCents(account, cents),
          label: account.name,
        });
      }
      months.push({ period, entries });
    }

    const result = setBalanceHistory({ months });
    if (!result.ok) {
      setError(result.error);
      return;
    }

    setError(null);
    setDirty(false);
    setSaved(`Saved ${formatPeriod(start)} to ${formatPeriod(end)}.`);
  }

  return (
    <section className="border border-edge bg-panel">
      <details>
        <summary className="cursor-pointer px-4 py-3 marker:text-chalk-soft">
          <span className="font-sans text-base font-semibold tracking-tight text-chalk">
            Balance history
          </span>
          <span className="ml-3 font-mono text-label uppercase text-chalk-soft">
            Optional · fill in past months
          </span>
        </summary>

        <div className="border-t border-edge">
          <p className="px-4 py-3 font-sans text-row text-chalk-soft">
            A year at a time, for every account. Enter what each was worth at the end of a month
            and the net-worth chart will draw it. A month left blank falls back to what the books
            say for an account you spend through, and to the figure above it for one you value by
            hand — either way the greyed figure in the cell is what that month will show.
          </p>

          {accounts.length === 0 ? (
            <p className="border-t border-edge px-4 py-5 font-sans text-row text-chalk-soft">
              No accounts yet. Add them in Accounts — the everyday one you spend from, then the
              401(k), the brokerage, the house, the mortgage against it — and their history can be
              entered here.
            </p>
          ) : (
            <form ref={formRef} onSubmit={handleSubmit} onChange={handleChange}>
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-edge px-4 py-3">
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    aria-label="Earlier months"
                    onClick={() => moveWindow(-1)}
                  >
                    &lsaquo; Earlier
                  </Button>
                  {/* Wide enough for two long month names and an en dash, so the
                      buttons either side do not shuffle as the window moves. */}
                  <span className="min-w-[15rem] whitespace-nowrap text-center font-mono text-row text-chalk">
                    {formatPeriod(start)} – {formatPeriod(end)}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    aria-label="Later months"
                    disabled={!canGoLater}
                    onClick={() => moveWindow(1)}
                  >
                    Later &rsaquo;
                  </Button>
                </div>

                {/* Moving the window re-seeds every field, so anything typed and
                    not saved goes with it. Said before the step rather than
                    after it, which is the only point at which it is useful. */}
                {dirty && (
                  <span className="font-mono text-label uppercase text-sulfur">
                    Unsaved changes — save before moving the window
                  </span>
                )}
              </div>

              <div className="scroll-x border-t border-edge">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-panel-raised">
                      <th
                        scope="col"
                        className="px-4 py-2 text-left font-mono text-label uppercase text-chalk"
                      >
                        Month
                      </th>
                      {accounts.map((account) => (
                        <th
                          key={account.id}
                          scope="col"
                          className="whitespace-nowrap px-3 py-2 text-right font-mono text-label uppercase text-chalk"
                        >
                          <div>
                            {account.name}
                            {isOwed(account) && (
                              <span className="ml-1.5 text-chalk-soft">owed</span>
                            )}
                          </div>
                          {/* What an empty cell in this column falls back to.
                              Per column rather than in the paragraph above,
                              because it is the difference between two columns
                              that look identical. */}
                          <div className="font-normal text-chalk-soft">
                            {spendsThroughBudget(account) ? "blank → ledger" : "blank → carried"}
                          </div>
                        </th>
                      ))}
                      <th
                        scope="col"
                        className="whitespace-nowrap px-4 py-2 text-right font-mono text-label uppercase text-chalk"
                      >
                        Net worth
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {periods.map((period, index) => (
                      <tr
                        key={period}
                        className={index % 2 === 0 ? "bg-sheet" : "bg-sheet-alt"}
                      >
                        <th
                          scope="row"
                          className="whitespace-nowrap px-4 py-2 text-left font-sans text-row font-normal text-ink"
                        >
                          {formatPeriod(period)}
                        </th>

                        {accounts.map((account) => {
                          const cents = stored.get(cellKey(account.id, period));
                          const carried = inForce.get(cellKey(account.id, period)) ?? 0;
                          return (
                            <td key={account.id} className="px-3 py-2 text-right">
                              <input
                                // Keyed on the window and on what is stored, so
                                // stepping the window and saving both re-seed the
                                // field; typing does neither, so a keystroke
                                // cannot remount the input under the cursor.
                                key={`${cellKey(account.id, period)}:${cents ?? ""}`}
                                {...amountField}
                                name={fieldName(account.id, period)}
                                aria-label={fieldLabel(account, period)}
                                // Money at rest, so a recorded month reads as
                                // the figure beside it rather than as a bare
                                // number in a column of them — and a figure
                                // written the way it is printed, "$12,500", is
                                // taken straight back.
                                defaultValue={amountAtRest(
                                  cents == null ? null : toEnteredBalanceCents(account, cents)
                                )}
                                // What the month is worth as things stand — the
                                // figure being carried into it. Shown as a hint
                                // rather than as a value, because a value here
                                // would be a record the user never made.
                                placeholder={formatCents(toEnteredBalanceCents(account, carried))}
                                className={inputClass}
                              />
                            </td>
                          );
                        })}

                        <td className="whitespace-nowrap px-4 py-2 text-right font-mono text-row font-medium tabular-nums text-ink">
                          {formatCents(
                            accounts.reduce(
                              (sum, account) =>
                                sum + (inForce.get(cellKey(account.id, period)) ?? 0),
                              0
                            )
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {error && (
                <p
                  role="alert"
                  className="border-t border-edge px-4 py-3 font-sans text-row text-vermilion"
                >
                  {error}
                </p>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-edge px-4 py-3">
                {/* A status region: it reports the user's own save rather than
                    interrupting them, and the standing note is what the column
                    means the rest of the time. */}
                <p role="status" className="max-w-[34rem] font-sans text-row text-chalk-soft">
                  {saved ??
                    "Net worth is every column added up, whichever way each of them was answered — the same figure the Net worth page draws for that month."}
                </p>
                <Button variant="primary" type="submit">
                  Save
                </Button>
              </div>
            </form>
          )}
        </div>
      </details>
    </section>
  );
}
