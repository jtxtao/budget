import { useRef, useState } from "react";
import useChartWidth from "../hooks/useChartWidth";
import {
  axisLabels,
  axisTicks,
  barWidthFor,
  chartFrame,
  columnPath,
  labelBudget,
  lineRuns,
  movingAverage,
  radiusFor,
} from "../chartAxis";
import {
  formatCents,
  formatCompactCents,
  formatPeriod,
  formatPeriodShort,
  periodLTE,
} from "../utils";

/**
 * One category, month by month — the drill-in's own chart, and the one place
 * on the report a single category's history is drawn rather than folded into a
 * total.
 *
 * One series of columns, not two: `CashflowChart` needs income and spending
 * side by side because the household earns and spends through different
 * accounts of the ledger, but a category only ever spends and is refunded into,
 * and those two are already netted into `netCents` on the row
 * `useSpendingReport` builds. So a month is one column, drawn on the side its
 * own sign puts it — `vermilion` above the baseline for a month that cost the
 * category money, `verdant` below it for the rare month a refund outweighed the
 * spend, the same rule `stackPaths` uses for the cashflow chart, just with
 * nothing left to stack.
 *
 * ## The trend line, and the question it exists for
 *
 * The columns answer "what did this category cost in March". The line answers
 * the question a household actually opens a drill-in with, which is whether the
 * habit is *shifting* — and a column chart is close to useless for it, because
 * grocery spending that is climbing ten percent a year and grocery spending
 * that is flat look identical under a month that happened to hold a party.
 *
 * It is a **three-month trailing average**, and all three of those words are
 * choices. Three months is long enough to swallow one unusual month and short
 * enough to turn inside a year. Trailing rather than centred, because the right
 * edge is the month the reader came for and a centred average has nothing to
 * say about it. An average rather than a fitted line, because a regression over
 * twelve points states a confidence this data has not got — and because a
 * household can check an average against the three columns above it, which is
 * the only honest kind of trend line in a tool people make decisions with.
 *
 * It **starts where it becomes true**, two months in, rather than tracing the
 * data and peeling away from it; `movingAverage` returns nulls for that head
 * and `lineRuns` breaks the line across them. Below four months there is no
 * line at all, since a trend drawn through one point is a dot with an opinion.
 *
 * Solid, not dashed: it is data, and a dashed line in this app is a threshold.
 *
 * The keyboard and pointer contract mirrors `CashflowChart`'s: one tab stop
 * moved with the arrow keys rather than one hit area per month, because a
 * ten-year "all" window is still a hundred and twenty of them.
 */

/** Months in the trailing average, and the fewest months a window needs before
 *  drawing one — one more than the window, so the line is a line. */
const TREND_MONTHS = 3;
const TREND_MINIMUM = TREND_MONTHS + 1;

const VIEW = { width: 760, height: 220 };
// The right margin holds the trend's end label, which sits beside the last
// column rather than over it — the average ends wherever it happens to be,
// which on a steady category is right through the middle of the bar.
const PAD = { top: 16, right: 52, bottom: 34, left: 66 };
const PLOT = {
  left: PAD.left,
  right: VIEW.width - PAD.right,
  top: PAD.top,
  bottom: VIEW.height - PAD.bottom,
};
const PLOT_HEIGHT = PLOT.bottom - PLOT.top;

function scaleFor(monthly) {
  let high = 0;
  let low = 0;
  for (const entry of monthly) {
    high = Math.max(high, entry.netCents);
    low = Math.min(low, entry.netCents);
  }
  const { min, max, ticks } = axisTicks(low, high);
  const y = (cents) => PLOT.bottom - ((cents - min) / (max - min)) * PLOT_HEIGHT;
  return { y, ticks };
}

/** The month and its figure, said in words for a screen reader. The trend is
 *  named only where there is one, so the early months do not announce a gap. */
function describe(entry, trendCents) {
  const parts = [`${formatPeriod(entry.period)}: ${formatCents(entry.netCents)}`];
  if (entry.refundCents > 0) parts.push(`${formatCents(entry.refundCents)} of it refunded`);
  if (trendCents != null) {
    parts.push(`${TREND_MONTHS}-month average ${formatCents(trendCents)}`);
  }
  return parts.join(", ");
}

function Readout({ entry, trendCents }) {
  return (
    <div className="pointer-events-none w-max max-w-[16rem] border border-edge bg-ledger px-3 py-2 shadow-lg shadow-black/50">
      <div className="font-mono text-label uppercase text-chalk-soft">
        {formatPeriod(entry.period)}
      </div>
      <div
        className={`mt-0.5 font-sans text-base font-semibold tabular-nums ${
          entry.netCents < 0 ? "text-verdant" : "text-chalk"
        }`}
      >
        {formatCents(entry.netCents)}
      </div>
      {entry.refundCents > 0 && (
        <div className="mt-1 font-sans text-row text-chalk-soft">
          {formatCents(entry.spentCents)} spent, {formatCents(entry.refundCents)} back
        </div>
      )}
      {trendCents != null && (
        <div className="mt-1 border-t border-edge pt-1 font-mono text-label uppercase text-chalk-soft">
          {TREND_MONTHS}-month avg {formatCents(trendCents)}
        </div>
      )}
    </div>
  );
}

export default function CategoryHistoryChart({
  monthly,
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
  const [active, setActive] = useState(null);
  const targets = useRef([]);

  const { y, ticks } = scaleFor(monthly);
  const slot = plotWidth / monthly.length;
  const barWidth = barWidthFor(slot, monthly.length);
  const radius = radiusFor(barWidth);
  const centreOf = (index) => plot.left + slot * (index + 0.5);

  const baseline = y(0);
  const lastIndex = monthly.length - 1;
  const labels = axisLabels(monthly.map((entry) => entry.period), labelBudget(plotWidth));

  const activeEntry = active != null && active <= lastIndex ? monthly[active] : null;
  const activeIndex = activeEntry ? active : null;

  // **The average is taken over the months the books cover, not over the
  // window.** A window can reach back further than the ledger does, and those
  // early columns are zero because nobody was recording yet rather than because
  // nothing was spent. Averaging through them would draw a line climbing out of
  // the floor on every category the household owns — a habit that appears to be
  // growing when all that grew is the record of it, which is the exact
  // misreading a trend line is supposed to prevent.
  //
  // The far end is the same refusal: a custom window can run past today, and a
  // month nobody has lived yet is a zero for an even better reason than a month
  // nobody wrote down. Trailing an average into it would drag the line toward
  // the floor at precisely the end of the chart a reader looks at first.
  const firstCovered = Math.max(
    0,
    monthly.findIndex(
      (entry) => coverageStartPeriod == null || periodLTE(coverageStartPeriod, entry.period)
    )
  );
  const afterCovered =
    coverageEndPeriod == null
      ? monthly.length
      : monthly.filter((entry) => periodLTE(entry.period, coverageEndPeriod)).length;
  const covered = monthly.slice(firstCovered, Math.max(firstCovered, afterCovered));

  // Below four covered months there is nothing a trend could honestly say, so
  // the whole series is suppressed rather than drawn as a fragment — including
  // its legend entry, which would otherwise name a line that is not there.
  const hasTrend = covered.length >= TREND_MINIMUM;
  const trend = hasTrend
    ? [
        ...Array(firstCovered).fill(null),
        ...movingAverage(
          covered.map((entry) => entry.netCents),
          TREND_MONTHS
        ),
        ...Array(monthly.length - firstCovered - covered.length).fill(null),
      ]
    : monthly.map(() => null);

  function handleKeyDown(event, index) {
    const move = { ArrowLeft: -1, ArrowRight: 1, Home: -index, End: lastIndex - index }[event.key];
    if (move == null) return;
    event.preventDefault();
    targets.current[Math.max(0, Math.min(lastIndex, index + move))]?.focus();
  }

  return (
    <div>
      {hasTrend && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 pt-3">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 bg-vermilion" aria-hidden="true" />
            <span className="font-mono text-label uppercase text-chalk-soft">Spent</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 shrink-0 bg-chalk" aria-hidden="true" />
            <span className="font-mono text-label uppercase text-chalk-soft">
              {TREND_MONTHS}-month average
            </span>
          </span>
        </div>
      )}

      <div className="overflow-x-auto px-2 pb-2 pt-3">
        <div ref={box} className="relative">
          {activeEntry && (
            <div
              className="absolute top-0 z-10"
              style={{
                left: `${(centreOf(activeIndex) / view.width) * 100}%`,
                transform: `translateX(${
                  activeIndex > monthly.length * 0.65
                    ? "-100%"
                    : activeIndex < monthly.length * 0.35
                      ? "0"
                      : "-50%"
                })`,
              }}
            >
              <Readout entry={activeEntry} trendCents={trend[activeIndex]} />
            </div>
          )}

          <svg
            viewBox={`0 0 ${view.width} ${view.height}`}
            className="w-full"
            role="group"
            aria-label="Spending by month for this category"
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

            <line
              x1={plot.left}
              x2={plot.right}
              y1={baseline}
              y2={baseline}
              className="stroke-chalk-soft"
              strokeWidth={1}
            />

            {monthly.map((entry, index) => {
              const path = columnPath({
                x: centreOf(index) - barWidth / 2,
                width: barWidth,
                from: baseline,
                to: y(entry.netCents),
                radius,
              });
              return (
                path && (
                  <path
                    key={entry.period}
                    d={path}
                    className={entry.netCents < 0 ? "fill-verdant" : "fill-vermilion"}
                  />
                )
              );
            })}

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

            {/* Over the columns, because the trend is the thing being read and
                the columns are what it is read against. Broken across the
                months before the window fills rather than drawn through them —
                see `lineRuns`. */}
            {hasTrend &&
              lineRuns(trend, { x: centreOf, y }).map((points) => (
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

            {hasTrend && trend[lastIndex] != null && (
              <>
                {/* A ring in the surface colour, so the dot stays legible where
                    it sits on top of a column. */}
                <circle
                  cx={centreOf(lastIndex)}
                  cy={y(trend[lastIndex])}
                  r={4}
                  className="fill-chalk stroke-panel"
                  strokeWidth={2}
                />
                <text
                  x={centreOf(lastIndex) + barWidth / 2 + 8}
                  y={y(trend[lastIndex])}
                  dominantBaseline="middle"
                  className="fill-chalk font-mono text-label font-medium tracking-normal tabular-nums"
                >
                  {formatCompactCents(trend[lastIndex])}
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

            {monthly.map((entry, index) => (
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
                aria-label={describe(entry, trend[index])}
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
