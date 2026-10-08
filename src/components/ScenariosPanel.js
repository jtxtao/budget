import { useRef } from "react";
import Button from "./Button";
import ScenarioCompareChart, { toneFor } from "./ScenarioCompareChart";
import { MAX_SCENARIOS } from "../contexts/ScenariosContext";
import { formatCents } from "../utils";

/**
 * Saved scenarios against the current plan, and what one point on a rate does
 * to it.
 *
 * Three parts, each answering its own question. The **comparison** is the
 * current plan and every saved scenario as rows of the same headline figures,
 * with their net worth drawn on one chart above — which plan ends where. A
 * scenario row can be **used** (its plan and its events become the live ones),
 * **updated** (overwritten with the live ones) or removed; using one replaces
 * the current plan, which the panel says before the button rather than after.
 * The **sensitivity** table is the current plan rerun with one assumption moved
 * a point either way, because a plan that only works at exactly ten percent is
 * a plan that mostly does not.
 *
 * Every figure here comes from `resolveProjection` run over the same books, so
 * a scenario differs from the current plan only by what was saved in it.
 */

const head = "px-3 py-2 text-right font-mono text-label uppercase text-chalk font-normal";
const cell = "whitespace-nowrap px-3 py-2 text-right font-mono text-row tabular-nums text-ink";

function verdict(outlook) {
  if (!outlook.ready) return { text: "—", tone: "text-ink-soft" };
  return outlook.gapCents < 0
    ? { text: `Short ${formatCents(-outlook.gapCents)}`, tone: "text-vermilion-ink" }
    : { text: `Spare ${formatCents(outlook.gapCents)}`, tone: "text-ink" };
}

const lastsTo = (outlook) =>
  outlook.ready ? `age ${outlook.depletionAge ?? outlook.fundedThroughAge}` : "—";

function FigureCells({ row }) {
  const { projection: outlook, netWorth } = row;
  const short = verdict(outlook);
  const atRetirement = netWorth.series.find((point) => point.age === row.retirementAge);
  return (
    <>
      <td className={cell}>{row.retirementAge ?? "—"}</td>
      <td className={cell}>{atRetirement ? formatCents(atRetirement.netCents) : "—"}</td>
      <td className={`${cell} ${short.tone}`}>{short.text}</td>
      <td className={`${cell} ${outlook.depletionAge != null ? "text-vermilion-ink" : ""}`}>
        {lastsTo(outlook)}
      </td>
      <td className={cell}>{netWorth.ready ? formatCents(netWorth.atEndCents) : "—"}</td>
    </>
  );
}

export default function ScenariosPanel({
  rows,
  sensitivity,
  error,
  onSave,
  onUse,
  onUpdate,
  onRemove,
}) {
  const nameRef = useRef(null);
  const saved = rows.filter((row) => row.scenario);
  const full = saved.length >= MAX_SCENARIOS;

  const save = (event) => {
    event.preventDefault();
    const result = onSave(nameRef.current.value);
    if (result.ok) nameRef.current.value = "";
  };

  const lines = rows
    .filter((row) => row.netWorth.ready)
    .map((row) => ({
      key: row.key,
      label: row.label,
      slot: row.scenario ? row.scenario.slot : null,
      series: row.netWorth.series,
    }));

  return (
    <section aria-labelledby="scenarios-heading" className="border border-edge bg-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-edge px-4 py-3">
        <h2 id="scenarios-heading" className="font-sans text-base font-semibold tracking-tight text-chalk">
          Scenarios
        </h2>
        <span className="font-mono text-label uppercase text-chalk-soft">
          Up to {MAX_SCENARIOS} saved · today&rsquo;s dollars
        </span>
      </div>

      <form onSubmit={save} className="flex flex-wrap items-end gap-3 border-b border-edge px-4 py-3">
        <label className="block min-w-[14rem] flex-1">
          <span className="mb-1.5 block font-mono text-label uppercase text-chalk-soft">
            Save the current plan as
          </span>
          <input
            ref={nameRef}
            type="text"
            placeholder="Buy at 35"
            disabled={full}
            className="w-full border-0 border-b-2 border-edge bg-transparent px-0 py-1.5 font-mono text-lg text-chalk outline-none transition-colors placeholder:text-chalk-soft/60 focus:border-azure disabled:opacity-60"
          />
        </label>
        <Button type="submit" variant="outline" disabled={full}>
          Save scenario
        </Button>
        <p className="basis-full font-sans text-row text-chalk-soft">
          A scenario keeps every assumption on this page and which life events are switched on.
          Using one replaces the current plan, so save the current plan first if you want to keep
          it.
        </p>
      </form>

      {error && (
        <p role="alert" className="border-b border-edge px-4 py-3 font-sans text-row text-vermilion">
          {error}
        </p>
      )}

      {lines.length > 1 && (
        <div className="border-b border-edge">
          <ScenarioCompareChart lines={lines} />
        </div>
      )}

      <div className="scroll-x">
        <table className="w-full border-collapse" aria-label="Plans compared">
          <thead>
            <tr className="bg-panel-raised">
              <th scope="col" className="px-4 py-2 text-left font-mono text-label font-normal uppercase text-chalk">
                Plan
              </th>
              <th scope="col" className={head}>Retire at</th>
              <th scope="col" className={head}>Net worth then</th>
              <th scope="col" className={head}>Against the need</th>
              <th scope="col" className={head}>Money lasts to</th>
              <th scope="col" className={head}>At the end</th>
              <th scope="col" className="w-0">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.key} className={index % 2 === 0 ? "bg-sheet" : "bg-sheet-alt"}>
                <th scope="row" className="px-4 py-2 text-left font-sans text-row font-normal text-ink">
                  <span className="flex items-center gap-2">
                    <span className={`h-0.5 w-3 shrink-0 ${toneFor({ slot: row.scenario?.slot ?? null }).swatch}`} aria-hidden="true" />
                    {row.label}
                    {row.inUse && (
                      <span className="font-mono text-label uppercase text-ink-soft">In use</span>
                    )}
                  </span>
                </th>
                <FigureCells row={row} />
                <td className="whitespace-nowrap px-3 py-1.5 text-right">
                  {row.scenario && (
                    <span className="flex justify-end gap-1">
                      <Button
                        variant="row-action"
                        size="sm"
                        disabled={row.inUse}
                        aria-label={`Use ${row.label}`}
                        onClick={() => onUse(row.scenario)}
                      >
                        Use
                      </Button>
                      <Button
                        variant="row-action"
                        size="sm"
                        disabled={row.inUse}
                        aria-label={`Update ${row.label} with the current plan`}
                        onClick={() => onUpdate(row.scenario)}
                      >
                        Update
                      </Button>
                      <Button
                        variant="row"
                        size="sm"
                        aria-label={`Remove ${row.label}`}
                        onClick={() => onRemove(row.scenario.id)}
                      >
                        Remove
                      </Button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sensitivity.length > 0 && (
        <div className="border-t border-edge">
          <div className="px-4 pb-1 pt-3">
            <h3 className="font-mono text-label uppercase text-chalk">What one point changes</h3>
            <p className="mt-1 font-sans text-row text-chalk-soft">
              The current plan, rerun with one rate a percentage point higher or lower and everything
              else as it is.
            </p>
          </div>
          <div className="scroll-x">
            <table className="w-full border-collapse" aria-label="Sensitivity to the rates">
              <thead>
                <tr className="bg-panel-raised">
                  <th scope="col" className="px-4 py-2 text-left font-mono text-label font-normal uppercase text-chalk">
                    If
                  </th>
                  <th scope="col" className={head}>Against the need</th>
                  <th scope="col" className={head}>Money lasts to</th>
                  <th scope="col" className={head}>At the end</th>
                </tr>
              </thead>
              <tbody>
                {sensitivity.map((row, index) => {
                  const short = verdict(row.projection);
                  return (
                    <tr key={row.key} className={index % 2 === 0 ? "bg-sheet" : "bg-sheet-alt"}>
                      <th scope="row" className="px-4 py-2 text-left font-sans text-row font-normal text-ink">
                        {row.label}
                      </th>
                      <td className={`${cell} ${short.tone}`}>{short.text}</td>
                      <td className={`${cell} ${row.projection.depletionAge != null ? "text-vermilion-ink" : ""}`}>
                        {lastsTo(row.projection)}
                      </td>
                      <td className={cell}>
                        {row.netWorth.ready ? formatCents(row.netWorth.atEndCents) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
