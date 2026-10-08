import { useRef, useState } from "react";
import useChartWidth from "../hooks/useChartWidth";
import { ageLabeller, axisTicks, chartFrame } from "../chartAxis";
import { formatCents, formatCompactCents } from "../utils";

/**
 * Net worth by age, one line per plan: the current plan and every saved
 * scenario, on one axis so the gap between two lines is the difference the
 * choice makes.
 *
 * **Lines, not columns** — `NetWorthByAgeChart` already answers what the
 * balance sheet is made of; the question here is which plan ends where, and
 * five stacks side by side would bury it.
 *
 * **Each scenario wears the colour of the slot it was saved into**, from the
 * four hues the app has measured against each other for a chart (the plan's
 * bucket colours, CIEDE2000 all-pairs under normal and simulated colour-blind
 * vision, both modes — see `src/bucketTones.js`). The slot is stored on the
 * scenario, so deleting one never repaints the others. The current plan is the
 * one line in ink and the thickest, because it is the one the page is about.
 * Colour is never the only channel: the legend names every line, the read-out
 * lists each by name at the age under the pointer, and the table beneath the
 * chart carries every figure.
 */

const VIEW = { width: 760, height: 300 };
const PAD = { top: 18, right: 24, bottom: 34, left: 66 };
const PLOT = {
  left: PAD.left,
  right: VIEW.width - PAD.right,
  top: PAD.top,
  bottom: VIEW.height - PAD.bottom,
};
const PLOT_HEIGHT = PLOT.bottom - PLOT.top;

/** Whole class names, never interpolated — Tailwind reads source for them. */
export const SLOT_TONES = [
  { stroke: "stroke-azure", swatch: "bg-azure" },
  { stroke: "stroke-sulfur", swatch: "bg-sulfur" },
  { stroke: "stroke-verdant", swatch: "bg-verdant" },
  { stroke: "stroke-invested", swatch: "bg-invested" },
];
export const CURRENT_TONE = { stroke: "stroke-chalk", swatch: "bg-chalk" };

export const toneFor = (line) => (line.slot == null ? CURRENT_TONE : SLOT_TONES[line.slot]);

function Readout({ age, lines }) {
  return (
    <div className="pointer-events-none w-max border border-edge bg-ledger px-3 py-2 shadow-lg shadow-black/50">
      <div className="font-mono text-label uppercase text-chalk-soft">Age {age}</div>
      <dl className="mt-1 grid grid-cols-[auto_auto] gap-x-3 font-mono text-label tabular-nums">
        {lines.map((line) => {
          const point = line.series.find((entry) => entry.age === age);
          return (
            <div key={line.key} className="contents">
              <dt className="flex items-center gap-1.5 text-chalk-soft">
                <span className={`h-0.5 w-3 shrink-0 ${toneFor(line).swatch}`} aria-hidden="true" />
                {line.label}
              </dt>
              <dd className="text-right text-chalk">{point ? formatCents(point.netCents) : "—"}</dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

export default function ScenarioCompareChart({ lines }) {
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

  const drawn = lines.filter((line) => line.series.length > 0);
  if (drawn.length === 0) return null;

  const firstAge = Math.min(...drawn.map((line) => line.series[0].age));
  const lastAge = Math.max(...drawn.map((line) => line.series[line.series.length - 1].age));
  const ages = Array.from({ length: lastAge - firstAge + 1 }, (_, index) => firstAge + index);
  const values = drawn.flatMap((line) => line.series.map((point) => point.netCents));
  const { min, max, ticks } = axisTicks(Math.min(0, ...values), Math.max(0, ...values));

  const step = plotWidth / Math.max(1, ages.length - 1);
  const xOf = (age) => plot.left + step * (age - firstAge);
  const y = (cents) => plot.bottom - ((cents - min) / (max - min || 1)) * PLOT_HEIGHT;
  const lastIndex = ages.length - 1;

  function handleKeyDown(event, index) {
    const move = { ArrowLeft: -1, ArrowRight: 1, Home: -index, End: lastIndex - index }[event.key];
    if (move == null) return;
    event.preventDefault();
    targets.current[Math.max(0, Math.min(lastIndex, index + move))]?.focus();
  }

  // The current plan last, so its ink line sits on top of the scenarios.
  const ordered = [...drawn].sort((a, b) => (a.slot == null) - (b.slot == null));

  // Every five years where that fits, wider steps on a phone.
  const labelled = ageLabeller(ages, plotWidth);

  return (
    <div>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 pt-3" aria-label="Legend">
        {drawn.map((line) => (
          <li key={line.key} className="flex items-center gap-1.5">
            <span className={`h-0.5 w-4 shrink-0 ${toneFor(line).swatch}`} aria-hidden="true" />
            <span className="font-mono text-label uppercase text-chalk-soft">{line.label}</span>
          </li>
        ))}
      </ul>

      <div className="px-2 pb-2 pt-1">
        <div ref={box} className="relative">
          {active != null && (
            <div
              className="absolute top-0 z-10"
              style={{
                left: `${(xOf(ages[active]) / view.width) * 100}%`,
                transform: `translateX(${
                  active > ages.length * 0.6 ? "-100%" : active < ages.length * 0.4 ? "0" : "-50%"
                })`,
              }}
            >
              <Readout age={ages[active]} lines={drawn} />
            </div>
          )}

          <svg
            viewBox={`0 0 ${view.width} ${view.height}`}
            className="w-full"
            role="group"
            aria-label={`Net worth by age under each plan, from ${firstAge} to ${lastAge}`}
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

            {active != null && (
              <line
                x1={xOf(ages[active])}
                x2={xOf(ages[active])}
                y1={plot.top}
                y2={plot.bottom}
                className="stroke-chalk-soft"
                strokeWidth={1}
                strokeOpacity={0.5}
              />
            )}

            {ordered.map((line) => (
              <polyline
                key={line.key}
                data-testid={`line-${line.key}`}
                points={line.series.map((point) => `${xOf(point.age)},${y(point.netCents)}`).join(" ")}
                fill="none"
                className={toneFor(line).stroke}
                strokeWidth={line.slot == null ? 2.5 : 2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}

            {ages.map((age, index) =>
              labelled(age, index) ? (
                <text
                  key={age}
                  x={xOf(age)}
                  y={plot.bottom + 18}
                  textAnchor="middle"
                  className="fill-chalk-soft font-mono text-label tracking-normal tabular-nums"
                >
                  {age}
                </text>
              ) : null
            )}

            {ages.map((age, index) => (
              <rect
                key={`hit-${age}`}
                ref={(element) => {
                  targets.current[index] = element;
                }}
                x={xOf(age) - step / 2}
                y={plot.top}
                width={step}
                height={PLOT_HEIGHT}
                fill="transparent"
                tabIndex={index === (active ?? lastIndex) ? 0 : -1}
                role="img"
                aria-label={`Age ${age}: ${drawn
                  .map((line) => {
                    const point = line.series.find((entry) => entry.age === age);
                    return `${line.label} ${point ? formatCents(point.netCents) : "no figure"}`;
                  })
                  .join(", ")}`}
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
