import { Link } from "react-router-dom";
import { isOffBudget, scopeLabel } from "../contexts/AccountsContext";
import { amountAtRest, amountEditing, formatCents, formatPeriod, toCents } from "../utils";

/**
 * Which accounts count towards something, ticked off a list with their values
 * beside them.
 *
 * Shared by the two panels that ask that question — the retirement plan's
 * starting point and the emergency fund's balance — because it is the same
 * question twice and the answer has to be read the same way both times. What a
 * row says about *where its figure came from* is the part worth not duplicating:
 * a holding last valued in March is being counted at March's figure, and two
 * panels that worded that differently would be two panels a reader could not
 * check against each other.
 *
 * Nothing here is editable beyond the tick. The values are `useNetWorth`'s, and
 * an account is corrected where it is owned — on the balance sheet.
 *
 * **`onPortionChange` adds a column for counting part of an account.** The
 * emergency fund passes it, because a buffer is usually a slice of an ordinary
 * savings account rather than an account of its own; the retirement picker does
 * not, since retirement money is an account's whole balance by nature. A blank
 * field is the whole account, it commits on blur like every panel outside a
 * modal, and it is keyed on the stored figure so a refused edit re-seeds it.
 *
 * `holdingsFirst` is the one thing the two callers disagree about, and it is a
 * question about which accounts the panel is *usually* about rather than about
 * the data: retirement money is off budget, so burying it under the current
 * account would be wrong, while a buffer is most often an ordinary savings
 * account. Stable within each half either way, so nothing moves when a box is
 * ticked.
 */

/** The month a hand-valued holding was last given a figure, or where a derived
 *  one comes from. The same distinction `HoldingsTable` draws, said shorter —
 *  this is a picker, not the balance sheet. */
function sourceNote(row) {
  if (!row.hand) return isOffBudget(row.account) ? "Never valued" : "From the ledger";
  return `Valued ${formatPeriod(row.asOf)}`;
}

/**
 * The part of a ticked account that counts. Formatted at rest and raw under the
 * caret, the two faces every money field wears.
 */
function PortionField({ row, onPortionChange }) {
  const stored = row.portionCents;
  return (
    <input
      key={`portion-${row.account.id}-${stored ?? ""}`}
      type="text"
      inputMode="decimal"
      aria-label={`Amount of ${row.account.name} counted`}
      placeholder="All of it"
      disabled={!row.included}
      defaultValue={stored == null ? "" : amountAtRest(stored)}
      onFocus={(event) => {
        const cents = toCents(event.target.value);
        if (cents != null) event.target.value = amountEditing(cents);
        event.target.select();
      }}
      onBlur={(event) => {
        const typed = event.target.value;
        const result = onPortionChange({ accountId: row.account.id, amount: typed });
        // Refused figures stay to be corrected; a taken one is shown formatted.
        if (result?.ok) {
          const cents = toCents(typed);
          event.target.value = typed.trim() === "" || cents == null ? "" : amountAtRest(cents);
        }
      }}
      className="w-28 border-0 border-b border-transparent bg-transparent px-0 py-0.5 text-right font-mono text-row tabular-nums text-ink outline-none placeholder:text-ink-soft/70 hover:border-rule focus:border-azure disabled:opacity-40"
    />
  );
}

function AccountRow({ row, striped, onToggle, onPortionChange }) {
  return (
    <tr className={striped ? "bg-sheet-alt" : "bg-sheet"}>
      <th scope="row" className="px-4 py-2 text-left font-sans text-row font-normal text-ink">
        <label className="flex cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            checked={row.included}
            onChange={(event) =>
              onToggle({ accountId: row.account.id, included: event.target.checked })
            }
            className="h-3.5 w-3.5 shrink-0 accent-ink-soft"
          />
          <span>{row.account.name}</span>
        </label>
      </th>
      <td
        data-label="Source"
        className="whitespace-nowrap px-3 py-2 text-right font-mono text-label uppercase text-ink-soft"
      >
        {scopeLabel(row.account)} · {sourceNote(row)}
      </td>
      <td
        data-label="Value"
        className={`whitespace-nowrap px-3 py-2 text-right font-mono text-row tabular-nums ${
          row.included ? "font-medium text-ink" : "text-ink-soft"
        }`}
      >
        {formatCents(row.valueCents)}
      </td>
      {onPortionChange && (
        <td data-label="Counted" className="whitespace-nowrap px-3 py-2 text-right">
          <PortionField row={row} onPortionChange={onPortionChange} />
        </td>
      )}
    </tr>
  );
}

export default function AccountPicker({
  rows,
  totalLabel,
  totalCents,
  emptyNote,
  holdingsFirst = false,
  onToggle,
  onPortionChange,
}) {
  const ordered = holdingsFirst
    ? [...rows.filter((row) => isOffBudget(row.account)), ...rows.filter((row) => !isOffBudget(row.account))]
    : rows;

  if (ordered.length === 0) {
    return (
      <p className="px-4 py-5 font-sans text-row text-chalk-soft">
        No accounts yet.{" "}
        <Link to="/plan" className="text-azure underline underline-offset-2 hover:text-chalk">
          Add them on the budget plan
        </Link>{" "}
        — {emptyNote}
      </p>
    );
  }

  return (
    <div className="scroll-x">
      <table className="stack w-full border-collapse">
        <thead>
          <tr className="bg-panel-raised">
            <th scope="col" className="px-4 py-2 text-left font-mono text-label uppercase text-chalk">
              Account
            </th>
            <th scope="col" className="px-3 py-2 text-right font-mono text-label uppercase text-chalk">
              Where the figure comes from
            </th>
            <th scope="col" className="px-3 py-2 text-right font-mono text-label uppercase text-chalk">
              Value
            </th>
            {onPortionChange && (
              <th scope="col" className="px-3 py-2 text-right font-mono text-label uppercase text-chalk">
                Counted
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {ordered.map((row, index) => (
            <AccountRow
              key={row.account.id}
              row={row}
              striped={index % 2 === 1}
              onToggle={onToggle}
              onPortionChange={onPortionChange}
            />
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-panel-raised">
            <th scope="row" className="px-4 py-2 text-left font-mono text-label uppercase text-chalk">
              {totalLabel}
            </th>
            <td />
            {onPortionChange && <td />}
            <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-row font-medium tabular-nums text-chalk">
              {formatCents(totalCents)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
