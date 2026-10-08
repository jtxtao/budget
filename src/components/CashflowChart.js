import { useRef, useState } from "react";
import useChartWidth from "../hooks/useChartWidth";
import {
  axisLabels,
  axisTicks,
  barWidthFor,
  chartFrame,
  labelBudget,
  lineRuns,
  radiusFor,
  stackPaths,
} from "../chartAxis";
import {
  formatCents,
  formatCompactCents,
  formatPeriod,
  formatPeriodShort,
  periodLTE,
} from "../utils";

/**
 * What came in and what went out, month by month, with what was left traced
 * across.
 *
 * One column per month, split at the baseline: **income grows up from it and
 * spending is drawn down from it**, and the net is the line. That split is the
 * whole reason the chart reads. Stacked, the column height would be earnings
 * plus outgoings, which is a figure that means nothing; side by side, the
 * reader has to compare two lengths and estimate the difference between them.
 * Either side of the baseline, the two lengths are the two facts and the gap
 * between the line and zero is the third — which is the question a household
 * actually asks of a year of books.
 *
 * There is no second y-axis here and there must never be. Both series and the
 * line are dollars, on one scale, so the reader can compare a column against
 * the line and against last March without checking which axis anything is on.
 *
 * **Spending is drawn net of refunds**, because that is what it cost. Drawing
 * gross spending and counting the refunds as income would put the same money on
 * both sides of the baseline, and the net line — which is the sum of the two
 * segments, by construction — would stop matching the cash that actually moved.
 * The read-out names the gross figure where a refund makes the two differ, so
 * nothing is hidden by the netting; see `useSpendingReport`.
 *
 * **A month is drawn on the side its own sign puts it.** A month whose refunds
 * outweighed its spending genuinely put money back into the household, and it
 * stacks above the line rather than being drawn as a negative column below it.
 * That is `stackPaths`' rule, shared with the net-worth chart.
 *
 * Three channels carry the two series, not one: the legend, the direct label on
 * the net, and the table twin the page draws under the chart. Do not drop one
 * to save space — the colours alone are not the encoding.
 */

// The plot, in viewBox units. The bottom band is reserved for the month labels
// rather than shared with the plot — an axis drawn outside its container is the
// classic way a chart card ends up with its own tiny scrollbar.
const VIEW = { width: 760, height: 300 };
// The right margin holds the net's end label, which sits *beside* the last
// column rather than over it: the line ends wherever the net happens to be,
// which is usually somewhere inside the stack.
const PAD = { top: 18, right: 54, bottom: 34, left: 66 };
const PLOT = {
  left: PAD.left,
  right: VIEW.width - PAD.right,
  top: PAD.top,
  bottom: VIEW.height - PAD.bottom,
};
const PLOT_HEIGHT = PLOT.bottom - PLOT.top;

/**
 * The two series, and which way each one points.
 *
 * `value` is what the chart draws — signed, so income is itself and spending is
 * its own negation. `figure` is what the read-out and the screen reader say,
 * which is the amount as a person states it: money spent is "$4,120 spent", not
 * "minus $4,120". The sign lives in the maths, not on the page, exactly as it
 * does for a debt on the holdings table.
 *
 * `verdant` and `vermilion` are the app's income and expense colours everywhere
 * else, so a reader who has used the register reads this chart the same way.
 */
const SERIES = [
  {
    key: "income",
    label: "Income",
    fill: "fill-verdant",
    swatch: "bg-verdant",
    value: (entry) => entry.incomeCents,
    figure: (entry) => entry.incomeCents,
  },
  {
    key: "spending",
    label: "Spending",
    fill: "fill-vermilion",
    swatch: "bg-vermilion",
    value: (entry) => -entry.netSpentCents,
    figure: (entry) => entry.netSpentCents,
  },
];

const valuesOf = (entry) => SERIES.map((series) => series.value(entry));

/** How far the stack reaches either side of the baseline. The two add to the
 *  net, so the line is always inside the column. */
function extentOf(entry) {
  let up = 0;
  let down = 0;
  for (const value of valuesOf(entry)) {
    if (value > 0) up += value;
    else down += value;
  }
  return { up, down };
}

function scaleFor(series) {
  let high = 0;
  let low = 0;
  for (const entry of series) {
    const { up, down } = extentOf(entry);
    high = Math.max(high, up);
    low = Math.min(low, down);
    // The net line is inside the stack by construction, so it needs no room of
    // its own — but only while both series are drawn. Guarded anyway, because a
    // month of pure income still has to fit its own line.
    high = Math.max(high, entry.netCents);
    low = Math.min(low, entry.netCents);
  }

  const { min, max, ticks } = axisTicks(low, high);
  const y = (cents) => PLOT.bottom - ((cents - min) / (max - min)) * PLOT_HEIGHT;
  return { y, ticks };
}

/** The month and every figure on it, said in words for a screen reader. */
function describe(entry) {
  const parts = SERIES.filter((series) => series.figure(entry) !== 0).map(
    (series) => `${series.label} ${formatCents(series.figure(entry))}`
  );
  return `${formatPeriod(entry.period)}: net ${formatCents(entry.netCents)}${
    parts.length ? `, ${parts.join(", ")}` : ""
  }`;
}

function Swatch({ className }) {
  return <span className={`h-2 w-2 shrink-0 ${className}`} aria-hidden="true" />;
}

/**
 * The hovered month's figures. Never the only route to a value — the table twin
 * under the chart carries every one of them.
 *
 * The gross spend appears only where a refund makes it differ from the net, so
 * an ordinary month reads as two figures and a month with money coming back
 * says where the difference came from.
 */
function Readout({ entry }) {
  const rows = SERIES.filter((series) => series.figure(entry) !== 0);

  return (
    <div className="pointer-events-none w-max max-w-[18rem] border border-edge bg-ledger px-3 py-2 shadow-lg shadow-black/50">
      <div className="font-mono text-label uppercase text-chalk-soft">
        {formatPeriod(entry.period)}
      </div>
      <div
        className={`mt-0.5 font-sans text-base font-semibold tabular-nums ${
          entry.netCents < 0 ? "text-vermilion" : "text-chalk"
        }`}
      >
        {formatCents(entry.netCents)} net
      </div>
      {rows.length > 0 && (
        <dl className="mt-1.5 space-y-0.5 border-t border-edge pt-1.5">
          {rows.map((series) => (
            <div key={series.key} className="flex items-center gap-2">
              <Swatch className={series.swatch} />
              <dt className="font-sans text-row text-chalk-soft">{series.label}</dt>
              <dd className="ml-auto pl-4 font-mono text-row tabular-nums text-chalk">
                {formatCents(series.figure(entry))}
              </dd>
            </div>
          ))}
          {entry.refundCents > 0 && (
            <div className="flex items-center gap-2 pt-0.5">
              <span className="h-2 w-2 shrink-0" aria-hidden="true" />
              <dt className="font-sans text-row text-chalk-soft">
                after {formatCents(entry.refundCents)} refunded
              </dt>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}

export default function CashflowChart({
  series,
  coverageStartPeriod = null,
  coverageEndPeriod = null,
}) {
  // Drawn at the width of the box it sits in, so the type stays at its real
  // size on a phone — see `useChartWidth`.
  const box = useRef(null);
  const { view, plot, plotWidth } = chartFrame({
    width: useChartWidth(box),
    height: VIEW.height,
    pad: PAD,
  });
  // Which column the pointer or the keyboard is on. Null is a real state, not a
  // missing one — it means the chart is being looked at rather than interrogated.
  const [active, setActive] = useState(null);
  // The hit areas, so an arrow key can move focus between them.
  const targets = useRef([]);

  const { y, ticks } = scaleFor(series);
  const slot = plotWidth / series.length;
  const barWidth = barWidthFor(slot, series.length);
  const radius = radiusFor(barWidth);
  const centreOf = (index) => plot.left + slot * (index + 0.5);

  const baseline = y(0);
  const lastIndex = series.length - 1;

  // **The line spans the months the books cover and no further.** A column is a
  // sum and is honest at zero either way; a *line* through those months is a
  // claim, and "the household broke even" is the wrong one — before the first
  // record nobody was writing anything down, and past this month nothing has
  // happened yet. `lineRuns` breaks across a null rather than spanning it, the
  // same refusal `CategoryHistoryChart`'s trend makes and `PlanVsActualChart`
  // makes with its verdicts. With no coverage stated every month counts, which
  // is what the suites that take this chart's props alone rely on.
  const covered = (period) =>
    (coverageStartPeriod == null || periodLTE(coverageStartPeriod, period)) &&
    (coverageEndPeriod == null || periodLTE(period, coverageEndPeriod));
  const netValues = series.map((entry) => (covered(entry.period) ? entry.netCents : null));
  const netRuns = lineRuns(netValues, { x: centreOf, y });
  // The end dot and its label belong at the last month the line actually
  // reaches, not at the last column: a label floating past the end of a broken
  // line would be the figure the reader's eye lands on, naming a month the line
  // declined to describe.
  let endIndex = lastIndex;
  while (endIndex > 0 && netValues[endIndex] == null) endIndex -= 1;
  const hasEnd = netValues[endIndex] != null;
  const labels = axisLabels(series.map((entry) => entry.period), labelBudget(plotWidth));

  // A shorter window can leave the active index past the end of the new series,
  // so it is checked rather than trusted.
  const activeEntry = active != null && active <= lastIndex ? series[active] : null;
  const activeIndex = activeEntry ? active : null;

  // One tab stop, not one per month: ten years is a hundred and twenty hit
  // areas. The strip is entered at the month the reader came for — the most
  // recent — and walked with the arrows from there.
  function handleKeyDown(event, index) {
    const move = { ArrowLeft: -1, ArrowRight: 1, Home: -index, End: lastIndex - index }[event.key];
    if (move == null) return;
    event.preventDefault();
    targets.current[Math.max(0, Math.min(lastIndex, index + move))]?.focus();
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 pt-3">
        {SERIES.map((entry) => (
          <span key={entry.key} className="flex items-center gap-1.5">
            <Swatch className={entry.swatch} />
            <span className="font-mono text-label uppercase text-chalk-soft">{entry.label}</span>
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 shrink-0 bg-chalk" aria-hidden="true" />
          <span className="font-mono text-label uppercase text-chalk-soft">Net</span>
        </span>
      </div>

      <div className="px-2 pb-2 pt-1">
        <div ref={box} className="relative">
          {activeEntry && (
            <div
              className="absolute top-0 z-10"
              style={{
                left: `${(centreOf(activeIndex) / view.width) * 100}%`,
                // Pinned by whichever edge keeps it inside the plot, rather than
                // centred and allowed to hang off the side.
                transform: `translateX(${
                  activeIndex > series.length * 0.65
                    ? "-100%"
                    : activeIndex < series.length * 0.35
                      ? "0"
                      : "-50%"
                })`,
              }}
            >
              <Readout entry={activeEntry} />
            </div>
          )}

          <svg
            viewBox={`0 0 ${view.width} ${view.height}`}
            className="w-full"
            role="group"
            aria-label="Income and spending by month"
          >
            {/* Recessive, solid hairlines — never dashed, which reads as a
                threshold rather than as a grid. */}
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

            {/* Zero is where a month that earned separates from one that spent,
                so it is drawn a step brighter than the rest of the grid. */}
            <line
              x1={plot.left}
              x2={plot.right}
              y1={baseline}
              y2={baseline}
              className="stroke-chalk-soft"
              strokeWidth={1}
            />

            {series.map((entry, index) => (
              <g key={entry.period}>
                {stackPaths(valuesOf(entry), {
                  x: centreOf(index) - barWidth / 2,
                  width: barWidth,
                  y,
                  radius,
                }).map(
                  (path) =>
                    path.d && (
                      <path key={SERIES[path.index].key} d={path.d} className={SERIES[path.index].fill} />
                    )
                )}
              </g>
            ))}

            {activeIndex != null && (
              <line
                x1={centreOf(activeIndex)}
                x2={centreOf(activeIndex)}
                y1={plot.top}
                y2={plot.bottom}
                className="stroke-chalk-soft"
                strokeWidth={1}
                strokeOpacity={0.5}
              />
            )}

            {netRuns.map((points) => (
              <polyline
                key={points}
                points={points}
                fill="none"
                className="stroke-chalk"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}

            {hasEnd && (
              <>
                {/* The end dot wears a ring in the surface colour so it stays
                    legible where it crosses a column. */}
                <circle
                  cx={centreOf(endIndex)}
                  cy={y(series[endIndex].netCents)}
                  r={4}
                  className="fill-chalk stroke-panel"
                  strokeWidth={2}
                />

                {/* The one direct label on the chart. Labelling every point would
                    be chaos; labelling the end is what the reader came for. */}
                <text
                  x={centreOf(endIndex) + barWidth / 2 + 8}
                  y={y(series[endIndex].netCents)}
                  dominantBaseline="middle"
                  className="fill-chalk font-mono text-label font-medium tracking-normal tabular-nums"
                >
                  {formatCompactCents(series[endIndex].netCents)}
                </text>
              </>
            )}

            {labels.map((label) => (
              <text
                key={label.period}
                x={centreOf(label.index)}
                y={plot.bottom + 16}
                textAnchor="middle"
                className="fill-chalk-soft font-mono text-label tracking-normal"
              >
                {formatPeriodShort(label.period)}
                {label.year && (
                  <tspan x={centreOf(label.index)} dy={13} className="fill-chalk-soft">
                    {label.year}
                  </tspan>
                )}
              </text>
            ))}

            {/* The hit areas: the whole column slot, full height, so the target
                is the month rather than the few pixels of bar in it. Each names
                its own figures, so the keyboard and the screen reader get what
                the pointer does — but only one is in the tab order at a time,
                and the arrows move between them. */}
            {series.map((entry, index) => (
              <rect
                key={entry.period}
                ref={(node) => {
                  targets.current[index] = node;
                }}
                x={plot.left + slot * index}
                y={plot.top}
                width={slot}
                height={PLOT_HEIGHT}
                fill="transparent"
                tabIndex={index === (activeIndex ?? lastIndex) ? 0 : -1}
                role="img"
                aria-label={describe(entry)}
                className="cursor-pointer outline-none focus-visible:fill-chalk/5"
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
