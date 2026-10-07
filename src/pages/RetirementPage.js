import { useMemo, useState } from "react";
import AddLifeEventModal from "../components/AddLifeEventModal";
import Button from "../components/Button";
import LifeEventsPanel from "../components/LifeEventsPanel";
import PageHeader from "../components/PageHeader";
import NetWorthProjection from "../components/NetWorthProjection";
import ProjectionAssumptionsPanel from "../components/ProjectionAssumptionsPanel";
import ScenariosPanel from "../components/ScenariosPanel";
import RetirementAssumptionsPanel from "../components/RetirementAssumptionsPanel";
import RetirementChart from "../components/RetirementChart";
import RetirementOutlook from "../components/RetirementOutlook";
import RetirementStartingPoint from "../components/RetirementStartingPoint";
import { LIFE_EVENT_KINDS, useLifeEvents } from "../contexts/LifeEventsContext";
import { migratePlan, useRetirement } from "../contexts/RetirementContext";
import { useScenarios } from "../contexts/ScenariosContext";
import { useSavingsGoals } from "../contexts/SavingsGoalsContext";
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
 * Scenarios are saved copies of the plan with the events that were on, each
 * projected over the same books through `resolveWith` and compared beside the
 * current plan, with a sensitivity table under them — see `ScenariosContext`
 * and `ScenariosPanel`. Using one writes the plan and the events' switches,
 * never the books.
 */
/** Two records equal field by field, whatever order their keys were written
 *  in — a stored plan and a migrated copy of it list theirs differently. */
function sameRecord(a, b) {
  const canonical = (value) =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, canonical(value[key])])
          )
        : value;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

export default function RetirementPage() {
  const {
    setRetirementPlan,
    toggleRetirementAccount,
    addSalary,
    updateSalary,
    removeSalary,
    setDebtAssumption,
    resetRetirementPlan,
    replaceRetirementPlan,
  } = useRetirement();
  const {
    plan,
    accountRows,
    inputs,
    debtRows,
    netWorth,
    projection,
    propertyOptions,
    debtOptions,
    resolveWith,
  } = useRetirementProjection();

  // One message per panel rather than one for the page: the field to go back to
  // is in the panel that rejected it, and a rejection at the top of the screen
  // about an input at the bottom is a message the user has to hunt for.
  const [startingError, setStartingError] = useState(null);
  const [assumptionsError, setAssumptionsError] = useState(null);
  const [projectionError, setProjectionError] = useState(null);

  const { events, setLifeEventEnabled, setEnabledEvents, deleteLifeEvent } = useLifeEvents();
  const { scenarios, saveScenario, updateScenario, deleteScenario } = useScenarios();
  const [scenarioError, setScenarioError] = useState(null);

  // The current plan and every saved scenario, each projected over the same
  // books by the same derivation — a scenario differs only by what it saved.
  const enabledEventIds = events.filter((event) => event.enabled).map((event) => event.id);
  const scenarioRows = useMemo(() => {
    const live = new Set(events.filter((event) => event.enabled).map((event) => event.id));
    const saved = scenarios.map((scenario) => {
      const savedPlan = migratePlan(scenario.plan);
      const on = new Set(scenario.enabledEventIds);
      const resolved = resolveWith(
        savedPlan,
        events.map((event) => ({ ...event, enabled: on.has(event.id) }))
      );
      // "In use" when the live plan is this one: the same assumptions, and the
      // same events on among those that still exist.
      const sameEvents = events.every((event) => on.has(event.id) === live.has(event.id));
      return {
        key: scenario.id,
        label: scenario.name,
        retirementAge: savedPlan.retirementAge,
        projection: resolved.projection,
        netWorth: resolved.netWorth,
        scenario,
        inUse: sameEvents && sameRecord(savedPlan, plan),
      };
    });
    return [
      {
        key: "current",
        label: "Current plan",
        retirementAge: plan.retirementAge,
        projection,
        netWorth,
        scenario: null,
        inUse: false,
      },
      ...saved,
    ];
  }, [scenarios, events, plan, projection, netWorth, resolveWith]);

  // The current plan with one rate a point either way.
  const sensitivity = useMemo(() => {
    if (!projection.ready) return [];
    const moves = [
      { field: "growthRateBps", label: "Returns while saving" },
      { field: "drawdownRateBps", label: "Returns once retired" },
      { field: "inflationRateBps", label: "Inflation" },
    ];
    const rows = [{ key: "base", label: "As planned", projection, netWorth }];
    for (const move of moves) {
      for (const delta of [100, -100]) {
        const value = plan[move.field] + delta;
        if (value < 0) continue;
        const resolved = resolveWith({ ...plan, [move.field]: value });
        rows.push({
          key: `${move.field}${delta}`,
          label: `${move.label} ${formatBps(value)} (${delta > 0 ? "+" : "−"}1 point)`,
          projection: resolved.projection,
          netWorth: resolved.netWorth,
        });
      }
    }
    return rows;
  }, [plan, projection, netWorth, resolveWith]);

  const { goals } = useSavingsGoals();
  // One modal for adding and editing, the savings-goals page's arrangement:
  // `editing` is the record, `seed` what a new one starts from.
  const [eventModal, setEventModal] = useState({ show: false, editing: null, seed: null });
  // What a sale can name: the property accounts, and every home an event buys.
  const saleOptions = [
    ...propertyOptions,
    ...events
      .filter((event) => event.kind === LIFE_EVENT_KINDS.BUY_PROPERTY)
      .map((event) => ({ id: event.id, name: event.name })),
  ];
  const propertyNames = Object.fromEntries(saleOptions.map((option) => [option.id, option.name]));

  // Every mutator reports `{ ok, error }`; this puts the error in the panel
  // that sent it and hands the result back, so a form can keep what was typed.
  const report = (setError, mutate) => (changes) => {
    const result = mutate(changes);
    setError(result.ok ? null : result.error);
    return result;
  };
  const commit = (setError) => report(setError, setRetirementPlan);

  // The money a year of retirement can be paid from — everything but the
  // house — which is what the outlook measures against what is needed.
  const savingsSeries = netWorth.series.map((point) => ({
    age: point.age,
    phase: point.phase,
    balanceCents: point.liquidCents,
  }));

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
              series={savingsSeries}
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
                    {savingsSeries.map((point, index) => (
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

        <LifeEventsPanel
          plan={plan}
          events={events}
          goals={goals}
          propertyNames={propertyNames}
          onAdd={(seed) => setEventModal({ show: true, editing: null, seed })}
          onEdit={(event) => setEventModal({ show: true, editing: event, seed: null })}
          onToggle={setLifeEventEnabled}
          onRemove={deleteLifeEvent}
        />

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

        <AddLifeEventModal
          show={eventModal.show}
          event={eventModal.editing}
          seed={eventModal.seed}
          propertyOptions={saleOptions.filter((option) => option.id !== eventModal.editing?.id)}
          debtOptions={debtOptions}
          handleClose={() => setEventModal((current) => ({ ...current, show: false }))}
        />

        <ScenariosPanel
          rows={scenarioRows}
          sensitivity={sensitivity}
          error={scenarioError}
          onSave={report(setScenarioError, (name) =>
            saveScenario({ name, plan, enabledEventIds })
          )}
          onUse={report(setScenarioError, (scenario) => {
            replaceRetirementPlan(scenario.plan);
            return setEnabledEvents(scenario.enabledEventIds);
          })}
          onUpdate={report(setScenarioError, (scenario) =>
            updateScenario({ id: scenario.id, plan, enabledEventIds })
          )}
          onRemove={report(setScenarioError, deleteScenario)}
        />
      </div>
    </>
  );
}
