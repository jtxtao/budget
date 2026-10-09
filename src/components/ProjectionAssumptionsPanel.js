import { useRef } from "react";
import Button from "./Button";
import SourceChoice from "./SourceChoice";
import {
  Block,
  Field,
  inputClass,
  labelClass,
  noteClass,
} from "./RetirementAssumptionsPanel";
import { INCOME_SOURCES, MAX_AGE } from "../contexts/RetirementContext";
import { formatBps, formatCents } from "../utils";

/**
 * What the whole-balance-sheet projection assumes that the retirement one did
 * not have to: what the working years earn, what tax takes, what cash and
 * property do, and what each debt charges and is paid.
 *
 * The contract `RetirementAssumptionsPanel` keeps — uncontrolled, committed on
 * blur, each field keyed on its stored value so a figure that lands re-seeds
 * the box and one that is refused stays to be corrected beside the reason. The
 * salary rows and the debt rows are the same contract a row at a time.
 *
 * **The income question has two answers and both are kept**, the starting
 * point's rule: switching to gross salaries does not clear the growth rate,
 * and switching back does not clear the salaries.
 */

// Distinct from every other SourceChoice on the page — see the note there.
const INCOME_OPTIONS = [
  { value: INCOME_SOURCES.GROWTH, label: "Today's take-home, rising by a rate" },
  { value: INCOME_SOURCES.SALARIES, label: "Gross salaries I enter by age" },
];

// The label style without its `block`, which would turn a header cell into a
// stacked box and pull the columns out from over the rows they name.
const headClass = "pb-1.5 font-mono text-label font-normal uppercase text-chalk-soft";

const cellInputClass =
  "w-full border-0 border-b border-edge bg-transparent px-0 py-1 font-mono text-row text-chalk outline-none transition-colors focus:border-azure";

/**
 * The salaries, one row each, plus a row to add one.
 *
 * Each row's two fields commit on their own blur; the add row commits on its
 * button, because a salary is only a salary with both an age and a figure, and
 * writing the age alone would put nothing in force from it.
 */
function SalaryList({ salaries, onAdd, onUpdate, onRemove }) {
  const ageRef = useRef(null);
  const grossRef = useRef(null);

  const add = (event) => {
    event.preventDefault();
    const result = onAdd({ fromAge: ageRef.current.value, gross: grossRef.current.value });
    if (result.ok) {
      ageRef.current.value = "";
      grossRef.current.value = "";
    }
  };

  return (
    <div className="mt-4">
      {salaries.length > 0 && (
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th scope="col" className={`${headClass} w-28 text-left`}>
                From age
              </th>
              <th scope="col" className={`${headClass} text-left`}>
                Gross a year
              </th>
              <th scope="col" className="w-20">
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {salaries.map((salary) => (
              <tr key={salary.id}>
                <td className="py-1 pr-4">
                  <input
                    key={`age-${salary.fromAge}`}
                    type="number"
                    min={0}
                    max={MAX_AGE}
                    step={1}
                    aria-label={`Salary from age ${salary.fromAge}, starting age`}
                    defaultValue={salary.fromAge}
                    className={cellInputClass}
                    onBlur={(event) => onUpdate({ id: salary.id, fromAge: event.target.value })}
                  />
                </td>
                <td className="py-1 pr-4">
                  <input
                    key={`gross-${salary.grossCents}`}
                    type="text"
                    inputMode="decimal"
                    aria-label={`Salary from age ${salary.fromAge}, gross a year`}
                    defaultValue={formatCents(salary.grossCents)}
                    className={cellInputClass}
                    onBlur={(event) => onUpdate({ id: salary.id, gross: event.target.value })}
                  />
                </td>
                <td className="py-1 text-right">
                  <Button
                    variant="outline"
                    aria-label={`Remove the salary from age ${salary.fromAge}`}
                    onClick={() => onRemove(salary.id)}
                  >
                    Remove
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form onSubmit={add} className="mt-3 grid grid-cols-[9rem_1fr_auto] items-end gap-x-4">
        <label className="block">
          <span className={labelClass}>Starting at age</span>
          <input
            ref={ageRef}
            type="number"
            min={0}
            max={MAX_AGE}
            step={1}
            placeholder="e.g. 45"
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className={labelClass}>Gross salary a year</span>
          <input
            ref={grossRef}
            type="text"
            inputMode="decimal"
            placeholder="e.g. $120,000"
            className={inputClass}
          />
        </label>
        <Button type="submit" variant="outline">
          Add salary
        </Button>
      </form>
      <p className={noteClass}>
        In today's dollars. Each salary is in force until the next one starts or you retire; before
        the first, today's take-home stands. Enter $0 for a year off.
      </p>
    </div>
  );
}

function DebtList({ debtRows, onChange }) {
  if (debtRows.length === 0) {
    return (
      <p className="font-sans text-row text-chalk-soft">
        No debts on the books. Add a loan or a mortgage as an account and it appears here.
      </p>
    );
  }

  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          <th scope="col" className={`${headClass} text-left`}>
            Debt
          </th>
          <th scope="col" className={`${headClass} w-24 text-left`}>
            Rate
          </th>
          <th scope="col" className={`${headClass} w-32 text-left`}>
            Paid a month
          </th>
        </tr>
      </thead>
      <tbody>
        {debtRows.map((row) => (
          <tr key={row.account.id}>
            <th scope="row" className="py-1 pr-4 text-left font-sans text-row font-normal text-chalk">
              {row.account.name}
              <span className="block font-mono text-label text-chalk-soft">
                {formatCents(row.owedCents)} owed
              </span>
            </th>
            <td className="py-1 pr-4">
              <input
                key={`rate-${row.rateBps}`}
                type="text"
                inputMode="decimal"
                aria-label={`${row.account.name} interest rate`}
                defaultValue={row.rateBps / 100}
                className={cellInputClass}
                onBlur={(event) => onChange({ accountId: row.account.id, rate: event.target.value })}
              />
            </td>
            <td className="py-1">
              <input
                key={`payment-${row.monthlyPaymentCents}`}
                type="text"
                inputMode="decimal"
                aria-label={`${row.account.name} monthly payment`}
                defaultValue={formatCents(row.monthlyPaymentCents)}
                className={cellInputClass}
                onBlur={(event) =>
                  onChange({ accountId: row.account.id, monthlyPayment: event.target.value })
                }
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function ProjectionAssumptionsPanel({
  plan,
  inputs,
  debtRows,
  projection,
  error,
  onChange,
  onAddSalary,
  onUpdateSalary,
  onRemoveSalary,
  onDebtChange,
}) {
  const bySalaries = plan.incomeSource === INCOME_SOURCES.SALARIES;
  const real = projection.realRatesBps;

  return (
    <section
      aria-labelledby="projection-assumptions-heading"
      className="border border-edge bg-panel"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-edge px-4 py-3">
        <h2
          id="projection-assumptions-heading"
          className="font-sans text-base font-semibold tracking-tight text-chalk"
        >
          Net worth assumptions
        </h2>
        <span className="font-mono text-label uppercase text-chalk-soft">
          Nominal rates, before inflation
        </span>
      </div>

      <Block title="Income while working" hint="A year">
        <SourceChoice
          name="projection-income-source"
          legend="How future income is worked out"
          value={plan.incomeSource}
          options={INCOME_OPTIONS}
          onChange={(incomeSource) => onChange({ incomeSource })}
        />

        {bySalaries ? (
          <>
            <div className="mt-4 grid gap-x-5 gap-y-4 sm:grid-cols-2">
              <Field
                label="Tax on salary"
                type="text"
                inputMode="decimal"
                placeholder="22"
                seed={plan.workingTaxRateBps / 100}
                onCommit={(workingTaxRateBps) => onChange({ workingTaxRateBps })}
                note="One effective rate for everything taken before pay lands — income tax and payroll tax together. Taken after your pretax contributions."
              />
            </div>
            <SalaryList
              salaries={plan.salaries}
              onAdd={onAddSalary}
              onUpdate={onUpdateSalary}
              onRemove={onRemoveSalary}
            />
          </>
        ) : (
          <div className="mt-4 grid gap-x-5 gap-y-4 sm:grid-cols-2">
            <Field
              label="Pay rises each year"
              type="text"
              inputMode="decimal"
              placeholder="3"
              seed={plan.incomeGrowthRateBps / 100}
              onCommit={(incomeGrowthRateBps) => onChange({ incomeGrowthRateBps })}
              note={
                inputs.incomeAnnualCents > 0
                  ? `Starting from the ${formatCents(inputs.incomeAnnualCents)} a year of take-home your budget plan expects.`
                  : "Add your income sources on the budget plan — this grows what they come to."
              }
            />
          </div>
        )}
      </Block>

      <Block title="What the rest of it does" hint="A year">
        <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
          <Field
            label="Tax on retirement withdrawals"
            type="text"
            inputMode="decimal"
            placeholder="12"
            seed={plan.retirementTaxRateBps / 100}
            onCommit={(retirementTaxRateBps) => onChange({ retirementTaxRateBps })}
            note="What a dollar out of a pre-tax account loses on the way to being spent. Cash and other investments are taken as they stand."
          />
          <Field
            label="Return on cash"
            type="text"
            inputMode="decimal"
            placeholder="2.5"
            seed={plan.cashRateBps / 100}
            onCommit={(cashRateBps) => onChange({ cashRateBps })}
            note={`${formatBps(real.cash)} a year after inflation.`}
          />
          <Field
            label="Property appreciation"
            type="text"
            inputMode="decimal"
            placeholder="3.5"
            seed={plan.propertyRateBps / 100}
            onCommit={(propertyRateBps) => onChange({ propertyRateBps })}
            note={`${formatBps(real.property)} a year after inflation.`}
          />
          <div>
            <span className={labelClass}>Spent each year while working</span>
            <div className="border-b-2 border-transparent py-1.5 font-mono text-lg text-chalk">
              {formatCents(inputs.spendingCents)}
            </div>
            <p className={noteClass}>
              Your essentials and fun estimates on the budget plan, a year of them. Savings
              categories ({formatCents(inputs.savingsCents)} a year) go to your investments.
            </p>
          </div>
        </div>
      </Block>

      <Block title="Debts" hint="Nominal rate, today's payment">
        <DebtList debtRows={debtRows} onChange={onDebtChange} />
        {debtRows.length > 0 && (
          <p className={noteClass}>
            The payment should already be one of your budget's categories — the projection pays the
            debt down out of that spending, and gives the money back once the debt is gone. A debt with
            no payment is held where it is.
          </p>
        )}
      </Block>

      {error && (
        <p role="alert" className="border-t border-edge px-4 py-3 font-sans text-row text-vermilion">
          {error}
        </p>
      )}
    </section>
  );
}
