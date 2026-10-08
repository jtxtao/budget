import { cadenceLabel, paymentsPerYear } from "../cadence";
import { formatCents } from "../utils";
import Button from "./Button";

/**
 * The paycheques the plan is built on, and what each comes to in a typical
 * month.
 *
 * Every row shows its per-payment amount beside its monthly figure, because for
 * anything but a monthly source the two differ and the monthly one is derived.
 * A fortnightly $1,500 reads as $3,250 a month — 26 payments over 12 — and a
 * figure the user never typed has to show its working or it reads as a bug.
 *
 * There is no month on this table. It describes income in general, which is the
 * only thing the standing configuration knows; what actually landed in August
 * belongs to the Transactions page, on the other side of the app.
 */

/** "26 a year", the working behind a monthly figure the user did not type. */
function cadenceNote(cadence) {
  const perYear = paymentsPerYear(cadence);
  if (!perYear) return "Cadence unknown";
  if (perYear === 12) return null;
  return `${perYear} a year`;
}

export default function ExpectedIncomeTable({
  rows,
  expectedIncomeCents,
  pretaxMonthlyCents = 0,
  onDelete,
  actions,
}) {
  return (
    <section className="border border-edge bg-panel">
      {/* Centred rather than baseline-aligned: the actions are buttons with a
          border of their own, and a border sitting on a text baseline reads as
          a misalignment. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-edge px-4 py-3">
        <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">
          Expected income
        </h2>
        <div className="flex flex-wrap items-center gap-4">
          <span className="font-mono text-label uppercase text-chalk-soft">Per month</span>
          {actions}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-5 font-sans text-row text-chalk-soft">
          No income sources yet. Add the paycheques and other money you expect — the plan uses them
          to work out whether your estimates fit inside what you earn.
        </p>
      ) : (
        <div className="scroll-x">
          <table className="stack w-full border-collapse">
            <thead>
              <tr className="bg-panel-raised">
                <th scope="col" className="px-4 py-2 text-left font-mono text-label uppercase text-chalk">
                  Source
                </th>
                <th scope="col" className="px-4 py-2 text-left font-mono text-label uppercase text-chalk">
                  Cadence
                </th>
                <th scope="col" className="px-4 py-2 text-right font-mono text-label uppercase text-chalk">
                  Per payment
                </th>
                <th scope="col" className="px-4 py-2 text-right font-mono text-label uppercase text-chalk">
                  Per month
                </th>
                <th className="w-16 px-4 py-2">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const note = cadenceNote(row.cadence);

                return (
                  <tr key={row.id} className={i % 2 === 0 ? "bg-sheet" : "bg-sheet-alt"}>
                    <td className="px-4 py-2 font-sans text-row text-ink">{row.name}</td>
                    <td data-label="Cadence" className="whitespace-nowrap px-4 py-2">
                      <div>
                        <div className="font-sans text-row text-ink-soft">
                          {cadenceLabel(row.cadence)}
                        </div>
                        {note && (
                          <div className="font-mono text-label uppercase text-ink-soft">{note}</div>
                        )}
                      </div>
                    </td>
                    <td
                      data-label="Per payment"
                      className="whitespace-nowrap px-4 py-2 text-right font-mono text-row tabular-nums text-ink-soft"
                    >
                      {formatCents(row.amountCents)}
                    </td>
                    <td
                      data-label="Per month"
                      className="whitespace-nowrap px-4 py-2 text-right font-mono text-row font-medium tabular-nums text-ink"
                    >
                      {formatCents(row.monthlyCents)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Button
                        variant="row"
                        size="sm"
                        aria-label={`Remove income source: ${row.name}`}
                        onClick={() => onDelete(row)}
                      >
                        Remove
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-band">
                <td colSpan={3} className="px-4 py-2 font-mono text-label uppercase text-ink">
                  Expected each month
                  {/* The rows above are the sources on file; this total is
                      bigger than their sum by exactly the pretax figure once
                      one is set (see PlanHealthSummary), and that gap has to
                      be named here too or the footer reads as miscounted. */}
                  {pretaxMonthlyCents > 0 && (
                    <span className="normal-case text-ink-soft"> + {formatCents(pretaxMonthlyCents)} pretax</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-right font-mono text-row font-medium tabular-nums text-ink">
                  {formatCents(expectedIncomeCents)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
