import { useState } from "react";
import Button from "../components/Button";
import PageHeader from "../components/PageHeader";
import NetWorthProjection from "../components/NetWorthProjection";
import Placeholder from "../components/Placeholder";
import ProjectionAssumptionsPanel from "../components/ProjectionAssumptionsPanel";
import RetirementAssumptionsPanel from "../components/RetirementAssumptionsPanel";
import RetirementChart from "../components/RetirementChart";
import RetirementOutlook from "../components/RetirementOutlook";
import RetirementStartingPoint from "../components/RetirementStartingPoint";
import { useRetirement } from "../contexts/RetirementContext";
import useRetirementProjection from "../hooks/useRetirementProjection";
import { formatBps, formatCents } from "../utils";

/**
 * The long-range view: whether what is being put away now adds up to the
 * retirement being planned for.
 *
 * **This page has no month on it and no period stepper, and that is deliberate
 * in a different way from the dashboard's.** The dashboard is undated because
 * everything on it is as of today; this is undated because nothing on it is
 * about a month at all. It reads today's account values once, and everything
 * else is a decade-scale assumption. A stepper here would suggest the projection
 * could be walked back through, which it cannot — a plan has no history, only a
 * current shape.
 *
 * Nothing on this page writes to the books. The starting point *reads* the
 * accounts and the contribution *reads* the retirement categories (plus
 * whatever pretax figure is typed in, which the books have no way to know),
 * but the plan is its own store, and a scenario explored here moves no money
 * — see `RetirementContext`.
 *
 * Scenarios are still a placeholder. Comparing two plans side by side needs the
 * store to hold more than one of them, which is a different shape of record and
 * a different screen; what is here answers the single-plan question first.
 */
export default function RetirementPage() {
  const {
    setRetirementPlan,
    toggleRetirementAccount,
    addSalary,
    updateSalary,
    removeSalary,
    setDebtAssumption,
    resetRetirementPlan,
  } = useRetirement();
  const { plan, accountRows, inputs, debtRows, netWorth, projection } = useRetirementProjection();

  // One message per panel rather than one for the page: the field to go back to
  // is in the panel that rejected it, and a rejection at the top of the screen
  // about an input at the bottom is a message the user has to hunt for.
  const [startingError, setStartingError] = useState(null);
  const [assumptionsError, setAssumptionsError] = useState(null);
  const [projectionError, setProjectionError] = useState(null);

  // Every mutator reports `{ ok, error }`; this puts the error in the panel
  // that sent it and hands the result back, so a form can keep what was typed.
  const report = (setError, mutate) => (changes) => {
    const result = mutate(changes);
    setError(result.ok ? null : result.error);
    return result;
  };
  const commit = (setError) => report(setError, setRetirementPlan);

  return (
    <>
      <PageHeader
        eyebrow="Long range"
        title="Retirement planning"
        description="What has to be there on the day you stop working, and whether you are on course for it. Every figure is in today's dollars — the target is a share of what you earn now, so the projection is deflated to match rather than being grown at a rate that would flatter it."
        actions={
          <Button variant="danger" onClick={resetRetirementPlan}>
            Reset plan
          </Button>
        }
      />

      <div className="space-y-4">
        <RetirementOutlook
          projection={projection}
          inputs={inputs}
          retirementAge={plan.retirementAge}
        />

        {projection.ready && (
          <section className="border border-edge bg-panel">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-edge px-4 py-3">
              <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">
                Year by year
              </h2>
              <span className="font-mono text-label uppercase text-chalk-soft">
                Age {plan.currentAge} to {plan.lifeExpectancy} ·{" "}
                {formatBps(projection.realGrowthBps)} then {formatBps(projection.realDrawdownBps)}{" "}
                real
              </span>
            </div>

            <RetirementChart
              series={projection.series}
              targetCents={projection.needCents}
              retirementAge={plan.retirementAge}
              depletionAge={projection.depletionAge}
            />

            {/* The chart's table twin, as on the net-worth page. Every figure it
                draws is readable here, which is what stops the hover being the
                only route to a value on a fifty-year series. */}
            <details className="border-t border-edge">
              <summary className="cursor-pointer px-4 py-2.5 font-mono text-label uppercase text-chalk-soft transition-colors hover:text-chalk">
                Show these figures as a table
              </summary>
              <div className="max-h-96 overflow-auto border-t border-edge">
                <table className="w-full border-collapse">
                  <thead className="sticky top-0">
                    <tr className="bg-panel-raised">
                      <th scope="col" className="px-4 py-2 text-left font-mono text-label uppercase text-chalk">
                        Age
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-mono text-label uppercase text-chalk">
                        Stage
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-mono text-label uppercase text-chalk">
                        Savings
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {projection.series.map((point, index) => (
                      <tr key={point.age} className={index % 2 === 0 ? "bg-sheet" : "bg-sheet-alt"}>
                        <th
                          scope="row"
                          className="px-4 py-2 text-left font-sans text-row font-normal text-ink"
                        >
                          {point.age}
                        </th>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-label uppercase text-ink-soft">
                          {point.phase === "saving" ? "Saving" : "Retired"}
                        </td>
                        <td
                          className={`whitespace-nowrap px-3 py-2 text-right font-mono text-row tabular-nums ${
                            point.balanceCents === 0 ? "text-vermilion-ink" : "text-ink"
                          }`}
                        >
                          {formatCents(point.balanceCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </section>
        )}

        <div className="grid gap-4 xl:grid-cols-2">
          <RetirementStartingPoint
            plan={plan}
            accountRows={accountRows}
            selectedCents={inputs.selectedCents}
            error={startingError}
            onChange={commit(setStartingError)}
            onToggleAccount={toggleRetirementAccount}
          />

          <RetirementAssumptionsPanel
            plan={plan}
            inputs={inputs}
            projection={projection}
            error={assumptionsError}
            onChange={commit(setAssumptionsError)}
          />
        </div>

        {netWorth.ready && (
          <NetWorthProjection
            projection={netWorth}
            retirementAge={plan.retirementAge}
            lifeExpectancy={plan.lifeExpectancy}
          />
        )}

        <ProjectionAssumptionsPanel
          plan={plan}
          inputs={inputs}
          debtRows={debtRows}
          projection={netWorth}
          error={projectionError}
          onChange={commit(setProjectionError)}
          onAddSalary={report(setProjectionError, addSalary)}
          onUpdateSalary={report(setProjectionError, updateSalary)}
          onRemoveSalary={report(setProjectionError, removeSalary)}
          onDebtChange={report(setProjectionError, setDebtAssumption)}
        />

        <Placeholder
          title="Scenarios"
          items={[
            "Save a set of assumptions as a named scenario",
            "Compare scenarios side by side on one chart",
            "Sensitivity view: what a one-point change in return or inflation does to the outcome",
          ]}
        />
      </div>
    </>
  );
}
