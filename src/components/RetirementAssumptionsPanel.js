import { MAX_AGE, SPENDING_SOURCES } from "../contexts/RetirementContext";
import SourceChoice from "./SourceChoice";
import { formatBps, formatCents } from "../utils";

/**
 * Everything the projection is a consequence of, on one panel.
 *
 * Uncontrolled and committed on **blur**, like the pay schedule and the category
 * estimates: a half-typed "6" on the way to "65" is a valid age, and writing it
 * would redraw the chart around a retirement next year for as long as it took to
 * finish typing. Each field commits on its own, because half a plan is a real
 * intermediate state — the store keeps what it can read and the projection says
 * what it still needs.
 *
 * Every input is keyed on its stored value, so a figure the store *rejects*
 * changes nothing and stays on screen to be corrected, with the message beside
 * it, while one that lands re-seeds the field with what was actually saved.
 *
 * Three blocks, because the questions are three different kinds. When you stop
 * working is a decision; what it costs is an estimate; what the money does in
 * the meantime is an assumption, and that last block is the one that says what
 * it is doing to the figures — the rates entered are nominal and the projection
 * runs in today's dollars, so the real rates it actually uses are printed beside
 * them rather than left as a discrepancy for the reader to discover.
 */

export const labelClass = "mb-1.5 block font-mono text-label uppercase text-chalk-soft";

export const inputClass =
  "w-full border-0 border-b-2 border-edge bg-transparent px-0 py-1.5 font-mono text-lg text-chalk outline-none transition-colors placeholder:text-chalk-soft/60 focus:border-azure";

export const noteClass = "mt-1.5 font-sans text-row text-chalk-soft";

// Distinct from the starting point's two options — see the note there.
const SPENDING_OPTIONS = [
  { value: SPENDING_SOURCES.INCOME_SHARE, label: "A share of what I earn now" },
  { value: SPENDING_SOURCES.MANUAL, label: "A yearly figure I enter" },
];

export function Block({ title, hint, children }) {
  return (
    <section className="border-t border-edge px-4 py-4 first:border-t-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="font-mono text-label uppercase text-chalk">{title}</h3>
        {hint && <span className="font-mono text-label uppercase text-chalk-soft">{hint}</span>}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/**
 * A figure field that commits on blur and re-seeds from the store. `seed` is
 * what is stored, and doubles as the key — see the note above.
 *
 * The ages are `type="number"` — a whole year, with nothing to punctuate. Money
 * and rates are not: a number input refuses "$120,000" and "7%" outright, where
 * `toCents` and `toBps` read both. The store checks the figure either way, which
 * is where it has to be checked.
 *
 * The note sits *outside* the label and is tied to the input by
 * `aria-describedby`. Nesting it would fold a sentence of help into the field's
 * accessible name, so a screen reader would announce "Share of income, the usual
 * rule of thumb: the mortgage is paid off and you stop saving for this" every
 * time focus landed on the box — and nothing could find the field by its name.
 */
export function Field({ label, seed, onCommit, note, ...props }) {
  const noteId = `retirement-${label.toLowerCase().replace(/[^a-z]+/g, "-")}-note`;

  return (
    <div>
      <label className="block">
        <span className={labelClass}>{label}</span>
        <input
          key={`${label}-${seed ?? ""}`}
          defaultValue={seed ?? ""}
          className={inputClass}
          aria-describedby={note ? noteId : undefined}
          onBlur={(event) => onCommit(event.target.value)}
          {...props}
        />
      </label>
      {note && (
        <p id={noteId} className={noteClass}>
          {note}
        </p>
      )}
    </div>
  );
}

/** Cents as the dollars the field asks for, and blank for a figure nobody has
 *  stated — which is not the same as zero, and must not seed the box as one. */
export const asDollars = (cents) => (cents == null ? "" : cents / 100);

export default function RetirementAssumptionsPanel({
  plan,
  inputs,
  projection,
  error,
  onChange,
}) {
  const byShare = plan.spendingSource === SPENDING_SOURCES.INCOME_SHARE;

  return (
    <section className="border border-edge bg-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-edge px-4 py-3">
        <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">
          Assumptions
        </h2>
        <span className="font-mono text-label uppercase text-chalk-soft">
          Nothing here touches the books
        </span>
      </div>

      <Block title="When" hint="Whole years">
        <div className="grid gap-x-5 gap-y-4 sm:grid-cols-3">
          <Field
            label="Age today"
            type="number"
            min={0}
            max={MAX_AGE}
            step={1}
            placeholder="40"
            seed={plan.currentAge}
            onCommit={(currentAge) => onChange({ currentAge })}
          />
          <Field
            label="Retire at"
            type="number"
            min={0}
            max={MAX_AGE}
            step={1}
            placeholder="65"
            seed={plan.retirementAge}
            onCommit={(retirementAge) => onChange({ retirementAge })}
          />
          <Field
            label="Money lasts to"
            type="number"
            min={0}
            max={MAX_AGE}
            step={1}
            placeholder="90"
            seed={plan.lifeExpectancy}
            onCommit={(lifeExpectancy) => onChange({ lifeExpectancy })}
            note={
              projection.yearsInRetirement == null
                ? null
                : `${projection.yearsInRetirement} years of retirement to pay for`
            }
          />
        </div>
      </Block>

      <Block title="What retirement costs" hint="A year, today's dollars">
        <SourceChoice
          name="retirement-spending-source"
          legend="How retirement spending is worked out"
          value={plan.spendingSource}
          options={SPENDING_OPTIONS}
          onChange={(spendingSource) => onChange({ spendingSource })}
        />

        <div className="mt-4 grid gap-x-5 gap-y-4 sm:grid-cols-2">
          {byShare ? (
            <>
              <Field
                label="Share of income"
                type="text"
                inputMode="decimal"
                placeholder="70"
                seed={plan.incomeShareBps / 100}
                onCommit={(incomeShareBps) => onChange({ incomeShareBps })}
                note="The usual rule of thumb: the mortgage is paid off and you stop saving for this."
              />
              <div>
                <span className={labelClass}>Comes to</span>
                <div className="border-b-2 border-transparent py-1.5 font-mono text-lg text-chalk">
                  {formatCents(inputs.shareSpendingCents)}
                </div>
                <p className={noteClass}>
                  {inputs.incomeAnnualCents > 0 ? (
                    <>
                      {formatBps(plan.incomeShareBps)} of the{" "}
                      {formatCents(inputs.incomeAnnualCents)} a year your plan expects.
                    </>
                  ) : (
                    <>Add your income sources on the budget plan, or enter a figure instead.</>
                  )}
                </p>
              </div>
            </>
          ) : (
            <Field
              label="Yearly spending"
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              seed={asDollars(plan.annualSpendingCents)}
              onCommit={(annualSpendingCents) => onChange({ annualSpendingCents })}
              note={
                inputs.incomeAnnualCents > 0
                  ? `Your income today is ${formatCents(inputs.incomeAnnualCents)} a year.`
                  : null
              }
            />
          )}
        </div>
      </Block>

      <Block title="What the money does" hint="Nominal rates, before inflation">
        <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
          <Field
            label="Pretax contributions"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            seed={asDollars(plan.pretaxContributionCents)}
            onCommit={(pretaxContributionCents) => onChange({ pretaxContributionCents })}
            note="A 401(k) or other payroll deduction never reaches an on-budget account, so there is no category for the books to read it off — this is the one figure here you have to type. Added to what your retirement categories add up to, to make up the default below. Also set on the budget plan's Plan health panel, where it grosses up expected income and planned expenses by the same amount; the two are the same figure."
          />
          <Field
            label="Saving each year"
            type="text"
            inputMode="decimal"
            // The plan's own savings figure, shown as the placeholder rather
            // than seeded into the field: a seeded value would become a typed
            // one the moment anything else was edited, and the link back to the
            // budget would be silently cut.
            placeholder={inputs.plannedContributionCents / 100}
            seed={asDollars(plan.annualContributionCents)}
            onCommit={(annualContributionCents) => onChange({ annualContributionCents })}
            note={
              inputs.contributionSeeded
                ? inputs.pretaxContributionCents > 0
                  ? `Using ${formatCents(inputs.plannedContributionCents)} — ${formatCents(
                      inputs.budgetContributionCents
                    )} from your retirement categories plus ${formatCents(
                      inputs.pretaxContributionCents
                    )} pretax. Enter a figure to override it.`
                  : `Using ${formatCents(inputs.plannedContributionCents)} — what your retirement categories add up to. Enter a figure to override it.`
                : "Clear this to go back to what your retirement categories and pretax contributions add up to."
            }
          />
          <Field
            label="Inflation"
            type="text"
            inputMode="decimal"
            placeholder="2.5"
            seed={plan.inflationRateBps / 100}
            onCommit={(inflationRateBps) => onChange({ inflationRateBps })}
            note="Every figure on this page is in today's dollars, which is what this buys."
          />
          <Field
            label="Return while saving"
            type="text"
            inputMode="decimal"
            placeholder="10"
            seed={plan.growthRateBps / 100}
            onCommit={(growthRateBps) => onChange({ growthRateBps })}
            note={`${formatBps(projection.realGrowthBps)} a year after inflation. Ten before it, not the seven usually quoted — that figure is already net of inflation, and this one is not.`}
          />
          <Field
            label="Return once retired"
            type="text"
            inputMode="decimal"
            placeholder="5.5"
            seed={plan.drawdownRateBps / 100}
            onCommit={(drawdownRateBps) => onChange({ drawdownRateBps })}
            note={`${formatBps(projection.realDrawdownBps)} a year after inflation. Lower than while saving, because a portfolio being lived on is not a thirty-year bet.`}
          />
        </div>
      </Block>

      {error && (
        <p role="alert" className="border-t border-edge px-4 py-3 font-sans text-row text-vermilion">
          {error}
        </p>
      )}
    </section>
  );
}
