import { Link } from "react-router-dom";
import { isOffBudget, scopeLabel } from "../contexts/AccountsContext";
import { formatCents, formatPeriod } from "../utils";

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

function AccountRow({ row, striped, onToggle }) {
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
      <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-label uppercase text-ink-soft">
        {scopeLabel(row.account)} · {sourceNote(row)}
      </td>
      <td
        className={`whitespace-nowrap px-3 py-2 text-right font-mono text-row tabular-nums ${
          row.included ? "font-medium text-ink" : "text-ink-soft"
        }`}
      >
        {formatCents(row.valueCents)}
      </td>
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
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
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
          </tr>
        </thead>
        <tbody>
          {ordered.map((row, index) => (
            <AccountRow
              key={row.account.id}
              row={row}
              striped={index % 2 === 1}
              onToggle={onToggle}
            />
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-panel-raised">
            <th scope="row" className="px-4 py-2 text-left font-mono text-label uppercase text-chalk">
              {totalLabel}
            </th>
            <td />
            <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-row font-medium tabular-nums text-chalk">
              {formatCents(totalCents)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
