import { useRef, useState } from "react";
import useChartWidth from "../hooks/useChartWidth";
import {
  ageLabeller,
  axisTicks,
  barWidthFor,
  chartFrame,
  radiusFor,
  stackPaths,
} from "../chartAxis";
import { formatCents, formatCompactCents } from "../utils";

/**
 * The projected balance sheet as one column per age, from today to the end of
 * the plan — what the household owns above the baseline, what it owes below it,
 * and net worth as the line through the middle.
 *
 * **The bands are the net-worth page's bands, in its measured colours**: cash,
 * invested, property, debt. Retirement money is invested money, so it takes the
 * invested hue at full strength and the rest of the investments take it at a
 * lighter step — `NetWorthChart`'s rule that the number of series moves the
 * ramp, never the palette. Identity never rests on telling the two steps apart:
 * the legend names both, the read-out lists every band by name, and the table
 * beneath the chart carries every figure.
 *
 * **Debt draws below the baseline because its sign puts it there** — the one
 * stacking rule `stackPaths` keeps for every chart — so a mortgage is visibly
 * money owed, and the net line, which is the two extents added, always sits
 * inside the column.
 *
 * Two marks say *when*, not *how much*, and both are drawn in ink rather than a
 * series colour: the retirement age as a full-height solid rule with its label
 * (the `RetirementChart` convention — solid because it is a moment, not a
 * threshold), and a small marker under the year each life event begins, with
 * every event a year holds named in its read-out and its hit area's label, so a reader never has to
 * match a marker to a list by eye.
 *
 * One tab stop with arrows between years — a roving tabindex, as on
 * `NetWorthChart` — because sixty years is sixty stops otherwise.
 */

const VIEW = { width: 760, height: 320 };
const PAD = { top: 22, right: 64, bottom: 44, left: 66 };
const PLOT = {
  left: PAD.left,
  right: VIEW.width - PAD.right,
  top: PAD.top,
  bottom: VIEW.height - PAD.bottom,
};
const PLOT_HEIGHT = PLOT.bottom - PLOT.top;

/** The series, bottom of the stack first, each with its band's colour. */
export const BANDS = [
  { key: "cashCents", label: "Cash", fill: "fill-verdant", swatch: "bg-verdant", shade: 1 },
  { key: "retirementCents", label: "Retirement", fill: "fill-invested", swatch: "bg-invested", shade: 1 },
  { key: "investedCents", label: "Other investments", fill: "fill-invested", swatch: "bg-invested/50", shade: 0.5 },
  { key: "propertyCents", label: "Property", fill: "fill-property", swatch: "bg-property", shade: 1 },
  { key: "debtCents", label: "Debt", fill: "fill-vermilion", swatch: "bg-vermilion", shade: 1, owed: true },
];

/** A band's figure as it is stacked: debt is a magnitude owed, drawn below. */
const signed = (point, band) => (band.owed ? -point[band.key] : point[band.key]);

/** Whether a year holds an event the year before did not — the one it begins. */
const startsIn = (point, previous) =>
  (point.events ?? []).some((name) => !(previous?.events ?? []).includes(name));


function Readout({ point, retirementAge }) {
  return (
    <div className="pointer-events-none w-max border border-edge bg-ledger px-3 py-2 shadow-lg shadow-black/50">
      <div className="font-mono text-label uppercase text-chalk-soft">
        Age {point.age} · {point.age < retirementAge ? "working" : "retired"}
      </div>
      <div className="mt-0.5 font-sans text-base font-semibold tabular-nums text-chalk">
        {formatCents(point.netCents)} net
      </div>
      <dl className="mt-1 grid grid-cols-[auto_auto] gap-x-3 font-mono text-label tabular-nums">
        {BANDS.filter((band) => point[band.key] !== 0).map((band) => (
          <div key={band.key} className="contents">
            <dt className="flex items-center gap-1.5 text-chalk-soft">
              <span className={`h-2 w-2 shrink-0 ${band.swatch}`} aria-hidden="true" />
              {band.label}
            </dt>
            <dd className="text-right text-chalk">
              {band.owed ? "−" : ""}
              {formatCents(point[band.key])}
            </dd>
          </div>
        ))}
      </dl>
      {point.events?.length > 0 && (
        <div className="mt-1 max-w-[16rem] font-sans text-label text-chalk">
          {point.events.join(", ")}
        </div>
      )}
    </div>
  );
}

export default function NetWorthByAgeChart({ series, retirementAge }) {
  // Drawn at the width of the box it sits in, so the type stays at its real
  // size on a phone — see `useChartWidth`.
  const box = useRef(null);
  const { view, plot, plotWidth } = chartFrame({
    width: useChartWidth(box),
    height: VIEW.height,
    pad: PAD,
  });
  const [active, setActive] = useState(null);
  const targets = useRef([]);

  const lastIndex = series.length - 1;
  const highs = series.map((point) =>
    BANDS.reduce((sum, band) => sum + Math.max(0, signed(point, band)), 0)
  );
  const lows = series.map((point) =>
    BANDS.reduce((sum, band) => sum + Math.min(0, signed(point, band)), 0)
  );
  const { min, max, ticks } = axisTicks(Math.min(0, ...lows), Math.max(0, ...highs));
  const y = (cents) => plot.bottom - ((cents - min) / (max - min || 1)) * PLOT_HEIGHT;

  const slot = plotWidth / Math.max(1, series.length);
  const barWidth = barWidthFor(slot, series.length);
  const radius = radiusFor(barWidth);
  const xOf = (index) => plot.left + slot * index + slot / 2;

  const retireIndex = series.findIndex((point) => point.age === retirementAge);
  const activePoint = active == null ? null : series[active];
  const netPoints = series.map((point, index) => `${xOf(index)},${y(point.netCents)}`).join(" ");
  const markerY = plot.bottom + 8;

  function handleKeyDown(event, index) {
    const move = { ArrowLeft: -1, ArrowRight: 1, Home: -index, End: lastIndex - index }[event.key];
    if (move == null) return;
    event.preventDefault();
    targets.current[Math.max(0, Math.min(lastIndex, index + move))]?.focus();
  }

  // Every five years where that fits, wider steps on a phone.
  const labelled = ageLabeller(series.map((point) => point.age), plotWidth);

  return (
    <div>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 pt-3" aria-label="Legend">
        {BANDS.map((band) => (
          <li key={band.key} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 shrink-0 ${band.swatch}`} aria-hidden="true" />
            <span className="font-mono text-label uppercase text-chalk-soft">{band.label}</span>
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 shrink-0 bg-chalk" aria-hidden="true" />
          <span className="font-mono text-label uppercase text-chalk-soft">Net worth</span>
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 shrink-0 rotate-45 bg-chalk-soft" aria-hidden="true" />
          <span className="font-mono text-label uppercase text-chalk-soft">Life event</span>
        </li>
      </ul>

      <div className="px-2 pb-2 pt-1">
        <div ref={box} className="relative">
          {activePoint && (
            <div
              className="absolute top-0 z-10"
              style={{
                left: `${(xOf(active) / view.width) * 100}%`,
                transform: `translateX(${
                  active > series.length * 0.6 ? "-100%" : active < series.length * 0.4 ? "0" : "-50%"
                })`,
              }}
            >
              <Readout point={activePoint} retirementAge={retirementAge} />
            </div>
          )}

          <svg
            viewBox={`0 0 ${view.width} ${view.height}`}
            className="w-full"
            role="group"
            aria-label={`Projected net worth by age, from ${series[0].age} to ${series[lastIndex].age}`}
          >
            {ticks.map((tick) => (
              <g key={tick}>
                <line
                  x1={plot.left}
                  x2={plot.right}
                  y1={y(tick)}
                  y2={y(tick)}
                  className={tick === 0 ? "stroke-chalk-soft" : "stroke-edge"}
                  strokeWidth={1}
                />
                <text
                  x={plot.left - 10}
                  y={y(tick)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="fill-chalk-soft font-mono text-label tracking-normal tabular-nums"
                >
                  {formatCompactCents(tick)}
                </text>
              </g>
            ))}

            {series.map((point, index) => {
              const x = xOf(index) - barWidth / 2;
              const paths = stackPaths(
                BANDS.map((band) => signed(point, band)),
                { x, width: barWidth, y, radius }
              );
              return (
                <g key={point.age}>
                  {/* The surface behind a lightened segment, so grid lines do
                      not show through it as stripes across the money. */}
                  {paths.map((path) =>
                    path.d && BANDS[path.index].shade < 1 ? (
                      <path key={`back-${path.index}`} d={path.d} className="fill-panel" />
                    ) : null
                  )}
                  {paths.map((path) =>
                    path.d ? (
                      <path
                        key={path.index}
                        d={path.d}
                        className={BANDS[path.index].fill}
                        fillOpacity={BANDS[path.index].shade}
                      />
                    ) : null
                  )}
                </g>
              );
            })}

            {retireIndex >= 0 && (
              <g>
                <line
                  x1={xOf(retireIndex) - slot / 2}
                  x2={xOf(retireIndex) - slot / 2}
                  y1={plot.top}
                  y2={plot.bottom}
                  className="stroke-chalk-soft"
                  strokeWidth={1}
                />
                <text
                  x={xOf(retireIndex) - slot / 2 + 5}
                  y={plot.top - 14}
                  dominantBaseline="hanging"
                  className="fill-chalk-soft font-mono text-label tracking-normal"
                >
                  RETIRE AT {retirementAge}
                </text>
              </g>
            )}

            <polyline
              points={netPoints}
              fill="none"
              className="stroke-chalk"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle
              cx={xOf(lastIndex)}
              cy={y(series[lastIndex].netCents)}
              r={4}
              className="fill-chalk stroke-panel"
              strokeWidth={2}
            />
            <text
              x={xOf(lastIndex) + 8}
              y={y(series[lastIndex].netCents)}
              dominantBaseline="middle"
              className="fill-chalk font-mono text-label font-medium tracking-normal tabular-nums"
            >
              {formatCompactCents(series[lastIndex].netCents)}
            </text>

            {/* Only the year an event begins is marked: Social Security runs
                every year from 67, and a marker under each of them would be a
                row of ink that says nothing. The read-out still names every
                event a year holds. */}
            {series.map((point, index) =>
              startsIn(point, series[index - 1]) ? (
                <rect
                  key={`event-${point.age}`}
                  data-testid="event-marker"
                  x={xOf(index) - 3}
                  y={markerY - 3}
                  width={6}
                  height={6}
                  transform={`rotate(45 ${xOf(index)} ${markerY})`}
                  className="fill-chalk-soft"
                />
              ) : null
            )}

            {series.map((point, index) =>
              labelled(point.age, index) ? (
                <text
                  key={point.age}
                  x={xOf(index)}
                  y={plot.bottom + 28}
                  textAnchor="middle"
                  className="fill-chalk-soft font-mono text-label tracking-normal tabular-nums"
                >
                  {point.age}
                </text>
              ) : null
            )}

            {active != null && (
              <rect
                x={xOf(active) - slot / 2}
                y={plot.top}
                width={slot}
                height={PLOT_HEIGHT}
                className="fill-chalk/5"
                pointerEvents="none"
              />
            )}

            {series.map((point, index) => (
              <rect
                key={`hit-${point.age}`}
                ref={(element) => {
                  targets.current[index] = element;
                }}
                x={xOf(index) - slot / 2}
                y={plot.top}
                width={slot}
                height={plot.bottom + 14 - plot.top}
                fill="transparent"
                tabIndex={index === (active ?? lastIndex) ? 0 : -1}
                role="img"
                aria-label={`Age ${point.age}: ${formatCents(point.netCents)} net worth${
                  point.events?.length ? `; ${point.events.join(", ")}` : ""
                }`}
                className="cursor-pointer outline-none"
                onMouseEnter={() => setActive(index)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(index)}
                onBlur={() => setActive(null)}
                onKeyDown={(event) => handleKeyDown(event, index)}
              />
            ))}
          </svg>
        </div>
      </div>
    </div>
  );
}
