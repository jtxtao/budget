import { formatCents } from "../utils";

/**
 * The whole balance sheet, walked forward to the end of the plan.
 *
 * A table for now, with its headline figures above it — the stacked chart over
 * age comes with life events, which are what will give it markers worth
 * drawing. Until then the table is the record: every pot, every age, and the
 * net worth they add up to, in today's dollars.
 *
 * What it says out loud is what a household would otherwise discover too late:
 * the age a year first cannot be paid for, the age the retirement accounts are
 * first reached into before retirement, and the age each debt is gone.
 */

const COLUMNS = [
  { key: "cashCents", label: "Cash" },
  { key: "investedCents", label: "Invested" },
  { key: "retirementCents", label: "Retirement" },
  { key: "propertyCents", label: "Property" },
  { key: "debtCents", label: "Debt" },
  { key: "netCents", label: "Net worth" },
];

function Figure({ label, children, tone = "text-chalk" }) {
  return (
    <div className="bg-panel px-4 py-3">
      <dt className="font-mono text-label uppercase text-chalk-soft">{label}</dt>
      <dd className={`mt-1 font-mono text-lg font-medium ${tone}`}>{children}</dd>
    </div>
  );
}

export default function NetWorthProjection({ projection, retirementAge, lifeExpectancy }) {
  const notes = [
    ...projection.warnings,
    ...(projection.earlyWithdrawalAge != null
      ? [
          `At ${projection.earlyWithdrawalAge} a year costs more than cash and investments can cover, and the retirement accounts are drawn on before you retire.`,
        ]
      : []),
    ...projection.payoffs.map((payoff) => `${payoff.name} is paid off at ${payoff.age}.`),
  ];

  return (
    <section aria-labelledby="net-worth-projection-heading" className="border border-edge bg-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-edge px-4 py-3">
        <h2
          id="net-worth-projection-heading"
          className="font-sans text-base font-semibold tracking-tight text-chalk"
        >
          Net worth by age
        </h2>
        <span className="font-mono text-label uppercase text-chalk-soft">Today's dollars</span>
      </div>

      <dl className="grid gap-px border-b border-edge bg-edge sm:grid-cols-3">
        <Figure label={`At ${retirementAge}`}>{formatCents(projection.atRetirementCents)}</Figure>
        <Figure label={`At ${lifeExpectancy}`}>{formatCents(projection.atEndCents)}</Figure>
        <Figure
          label="First year short"
          tone={projection.shortfallAge == null ? "text-chalk" : "text-vermilion"}
        >
          {projection.shortfallAge == null ? "None" : `Age ${projection.shortfallAge}`}
        </Figure>
      </dl>

      {notes.length > 0 && (
        <ul className="space-y-1 border-b border-edge px-4 py-3">
          {notes.map((note) => (
            <li key={note} className="font-sans text-row text-chalk-soft">
              {note}
            </li>
          ))}
        </ul>
      )}

      <details>
        <summary className="cursor-pointer px-4 py-2.5 font-mono text-label uppercase text-chalk-soft transition-colors hover:text-chalk">
          Show every year
        </summary>
        <div className="max-h-96 overflow-auto border-t border-edge">
          <table className="w-full border-collapse">
            <thead className="sticky top-0">
              <tr className="bg-panel-raised">
                <th scope="col" className="px-4 py-2 text-left font-mono text-label uppercase text-chalk">
                  Age
                </th>
                {COLUMNS.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className="px-3 py-2 text-right font-mono text-label uppercase text-chalk"
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {projection.series.map((point, index) => (
                <tr key={point.age} className={index % 2 === 0 ? "bg-sheet" : "bg-sheet-alt"}>
                  <th scope="row" className="px-4 py-2 text-left font-sans text-row font-normal text-ink">
                    {point.age}
                    {point.age === retirementAge && (
                      <span className="ml-2 font-mono text-label uppercase text-ink-soft">Retire</span>
                    )}
                  </th>
                  {COLUMNS.map((column) => (
                    <td
                      key={column.key}
                      className={`whitespace-nowrap px-3 py-2 text-right font-mono text-row tabular-nums ${
                        column.key === "netCents" && point.netCents < 0
                          ? "text-vermilion-ink"
                          : "text-ink"
                      }`}
                    >
                      {/* Debt is a magnitude, shown as what is owed. */}
                      {formatCents(column.key === "debtCents" ? -point.debtCents : point[column.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
