import { useRef, useState } from "react";
import useChartWidth from "../hooks/useChartWidth";
import { ageLabeller, chartFrame } from "../chartAxis";
import { formatCents, formatCompactCents } from "../utils";

/**
 * The plan as one line: what the savings are worth at every age from today to
 * the last year the money has to cover.
 *
 * One series, not a stack, because there is one quantity — a balance — and it is
 * the same balance before and after the day work stops. What changes at that day
 * is what is happening *to* it, and that is drawn as a labelled rule rather than
 * as a second colour, so the meaning survives being read in greyscale. The
 * fill lightens past the rule for the same reason a paragraph is indented: it
 * helps, and nothing depends on it.
 *
 * The horizontal target is the figure the page is about. This is the one place a
 * dashed line belongs in this app — the rule about solid hairlines is a rule
 * about *grids*, which must not read as thresholds; this is a threshold, and
 * drawing it like the grid would be the actual mistake.
 *
 * Drawn at a fixed viewBox and scaled, with a minimum width the card scrolls
 * inside rather than shrinking below: fifty years of labels squeezed onto a
 * phone would be a chart nobody can read.
 */

const VIEW = { width: 760, height: 300 };
// The right margin carries the end label — the balance the plan finishes on,
// which is the second figure a reader looks for after the peak.
const PAD = { top: 20, right: 58, bottom: 34, left: 66 };
const PLOT = {
  left: PAD.left,
  right: VIEW.width - PAD.right,
  top: PAD.top,
  bottom: VIEW.height - PAD.bottom,
};
const PLOT_HEIGHT = PLOT.bottom - PLOT.top;

/** As in `NetWorthChart`: ticks land on figures people actually say. */
const NICE_STEPS = [1, 2, 2.5, 5, 10];

function niceStep(rough) {
  const magnitude = 10 ** Math.floor(Math.log10(Math.abs(rough) || 1));
  const normalised = Math.abs(rough) / magnitude;
  return (NICE_STEPS.find((step) => normalised <= step) ?? 10) * magnitude;
}

/**
 * A domain from zero to a round figure above the data.
 *
 * Always anchored at zero: this is a balance, the whole question is how close it
 * gets to running out, and a scale that cropped the baseline to gain resolution
 * would draw a plan that fails as though it merely dipped. The target is part of
 * the domain too — a plan miles short of it still has to show how short.
 */
function scaleFor(series, targetCents) {
  const high = Math.max(targetCents, ...series.map((point) => point.balanceCents), 1);
  const step = niceStep(high / 4);
  const max = Math.ceil(high / step) * step;

  const ticks = [];
  for (let value = 0; value <= max + step / 2; value += step) ticks.push(Math.round(value));

  const y = (cents) => PLOT.bottom - (cents / max) * PLOT_HEIGHT;
  return { y, ticks };
}

function Readout({ point, retirementAge }) {
  return (
    <div className="pointer-events-none w-max border border-edge bg-ledger px-3 py-2 shadow-lg shadow-black/50">
      <div className="font-mono text-label uppercase text-chalk-soft">
        Age {point.age} · {point.age < retirementAge ? "saving" : "retired"}
      </div>
      <div className="mt-0.5 font-sans text-base font-semibold tabular-nums text-chalk">
        {formatCents(point.balanceCents)}
      </div>
    </div>
  );
}

export default function RetirementChart({ series, targetCents, retirementAge, depletionAge }) {
  // Drawn at the width of the box it sits in, so the type stays at its real
  // size on a phone — see `useChartWidth`.
  const box = useRef(null);
  const { view, plot, plotWidth } = chartFrame({
    width: useChartWidth(box),
    height: VIEW.height,
    pad: PAD,
  });
  // Which year the pointer or the keyboard is on. Null is a real state — the
  // chart is being looked at rather than interrogated.
  const [active, setActive] = useState(null);

  const { y, ticks } = scaleFor(series, targetCents);
  const slot = plotWidth / Math.max(1, series.length - 1);
  const xOf = (index) => plot.left + slot * index;

  const baseline = y(0);
  const points = series.map((point, index) => `${xOf(index)},${y(point.balanceCents)}`);
  const lastIndex = series.length - 1;
  const activePoint = active == null ? null : series[active];

  // Where the line crosses into retirement. The two areas meet on it rather than
  // either side of it, so there is no seam in the fill.
  const splitIndex = Math.max(0, series.findIndex((point) => point.age >= retirementAge));
  const area = (from, to) =>
    [
      `M${xOf(from)},${baseline}`,
      ...series.slice(from, to + 1).map((point, offset) => `L${xOf(from + offset)},${y(point.balanceCents)}`),
      `L${xOf(to)},${baseline}`,
      "Z",
    ].join(" ");

  const peak = series.reduce((best, point) => (point.balanceCents > best.balanceCents ? point : best));

  // Every five years where that fits, wider steps on a phone.
  const labelled = ageLabeller(series.map((point) => point.age), plotWidth);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 pt-3">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 shrink-0 bg-azure" aria-hidden="true" />
          <span className="font-mono text-label uppercase text-chalk-soft">Savings</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 shrink-0 bg-sulfur" aria-hidden="true" />
          <span className="font-mono text-label uppercase text-chalk-soft">
            Needed at {retirementAge}
          </span>
        </span>
        {depletionAge != null && (
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 bg-vermilion" aria-hidden="true" />
            <span className="font-mono text-label uppercase text-vermilion">
              Runs out at {depletionAge}
            </span>
          </span>
        )}
      </div>

      <div className="px-2 pb-2 pt-1">
        <div ref={box} className="relative">
          {activePoint && (
            <div
              className="absolute top-0 z-10"
              style={{
                left: `${(xOf(active) / view.width) * 100}%`,
                transform: `translateX(${
                  active > series.length * 0.65 ? "-100%" : active < series.length * 0.35 ? "0" : "-50%"
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
            aria-label={`Retirement savings by age, from ${series[0].age} to ${series[lastIndex].age}`}
          >
            {ticks.map((tick) => (
              <g key={tick}>
                <line
                  x1={plot.left}
                  x2={plot.right}
                  y1={y(tick)}
                  y2={y(tick)}
                  className="stroke-edge"
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

            {/* Saving, then living on it. The second area is the same hue at
                half strength — the labelled rule between them is what carries
                the meaning. */}
            <path d={area(0, splitIndex)} className="fill-azure/30" />
            <path d={area(splitIndex, lastIndex)} className="fill-azure/10" />

            {/* The target. Dashed on purpose: it is a threshold, not a grid
                line, and this is the one mark on the page that a reader is meant
                to measure the curve against. */}
            <line
              x1={plot.left}
              x2={plot.right}
              y1={y(targetCents)}
              y2={y(targetCents)}
              className="stroke-sulfur"
              strokeWidth={1.5}
              strokeDasharray="5 4"
            />
            <text
              x={plot.right + 6}
              y={y(targetCents)}
              dominantBaseline="middle"
              className="fill-sulfur font-mono text-label tracking-normal tabular-nums"
            >
              {formatCompactCents(targetCents)}
            </text>

            {/* The day work stops. A full-height rule with the age on it, which
                is the chart's second channel — nothing here depends on telling
                two shades of blue apart. */}
            <line
              x1={xOf(splitIndex)}
              x2={xOf(splitIndex)}
              y1={plot.top}
              y2={plot.bottom}
              className="stroke-chalk-soft"
              strokeWidth={1}
            />
            <text
              x={xOf(splitIndex) + 5}
              y={plot.top + 2}
              dominantBaseline="hanging"
              className="fill-chalk-soft font-mono text-label tracking-normal"
            >
              RETIRE AT {retirementAge}
            </text>

            {active != null && (
              <line
                x1={xOf(active)}
                x2={xOf(active)}
                y1={plot.top}
                y2={plot.bottom}
                className="stroke-chalk-soft"
                strokeWidth={1}
                strokeOpacity={0.5}
              />
            )}

            <polyline
              points={points.join(" ")}
              fill="none"
              className="stroke-azure"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* The year the money runs out, marked where it happens. A plan that
                fails should not need the table to say so. */}
            {depletionAge != null && (
              <circle
                cx={xOf(series.findIndex((point) => point.age === depletionAge))}
                cy={baseline}
                r={4}
                className="fill-vermilion stroke-panel"
                strokeWidth={2}
              />
            )}

            <circle
              cx={xOf(lastIndex)}
              cy={y(series[lastIndex].balanceCents)}
              r={4}
              className="fill-azure stroke-panel"
              strokeWidth={2}
            />
            {/* The two direct labels the reader came for: the most the plan is
                ever worth, and what is left at the end. Labelling every point
                would be chaos. */}
            <text
              x={xOf(lastIndex) + 8}
              y={y(series[lastIndex].balanceCents)}
              dominantBaseline="middle"
              className="fill-chalk font-mono text-label font-medium tracking-normal tabular-nums"
            >
              {formatCompactCents(series[lastIndex].balanceCents)}
            </text>

            {series.map((point, index) =>
              labelled(point.age, index) ? (
                <text
                  key={point.age}
                  x={xOf(index)}
                  y={plot.bottom + 16}
                  textAnchor="middle"
                  className="fill-chalk-soft font-mono text-label tracking-normal tabular-nums"
                >
                  {point.age}
                </text>
              ) : null
            )}

            {/* The hit areas: a full-height band per year, so the target is the
                age rather than the two pixels of line at it. Focusable, so the
                keyboard reads exactly what the pointer does. */}
            {series.map((point, index) => (
              <rect
                key={point.age}
                x={xOf(index) - slot / 2}
                y={plot.top}
                width={slot}
                height={PLOT_HEIGHT}
                fill="transparent"
                tabIndex={0}
                role="img"
                aria-label={`Age ${point.age}: ${formatCents(point.balanceCents)}${
                  point.age === peak.age ? ", the most this plan is ever worth" : ""
                }`}
                className="cursor-pointer outline-none focus-visible:fill-chalk/5"
                onMouseEnter={() => setActive(index)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(index)}
                onBlur={() => setActive(null)}
              />
            ))}
          </svg>
        </div>
      </div>
    </div>
  );
}
