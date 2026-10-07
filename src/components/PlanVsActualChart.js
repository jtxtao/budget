import { useRef, useState } from "react";
import {
  axisLabels,
  axisTicks,
  barWidthFor,
  radiusFor,
  stackPaths,
} from "../chartAxis";
import { bucketTone } from "../bucketTones";
import {
  formatCents,
  formatCompactCents,
  formatPeriod,
  formatPeriodShort,
  periodLTE,
} from "../utils";

/**
 * What the household actually spent each month, against what the plan says a
 * month costs — and what the spending divided into on the way.
 *
 * This is the one chart in the app where the plan and the books are drawn on
 * the same axis, and it answers the question neither side can answer alone.
 * The dashboard says whether an envelope is over *this* month, which carry-over
 * can explain away. Configuration says whether the estimates balance against
 * expected income, which says nothing about whether anyone lives inside them.
 * A run of months with the plan drawn across it says the thing both of those
 * miss: whether the plan is a description of this household or a wish.
 *
 * ## The plan is a threshold, so it is the one dashed mark here
 *
 * A category's estimate is a **standing** figure — the same in every month,
 * because it describes the category rather than a particular month — so the
 * plan's total is a horizontal line rather than a series with a shape. Drawing
 * it as a second set of columns would invite reading it as data that moved;
 * drawing it as a flat solid line would put it in the same visual language as
 * the grid. It is dashed, which in this app means a threshold and nothing else
 * (`RetirementChart`'s target line is the only other one), and it is what every
 * column is measured against.
 *
 * **The columns are net spending, not gross**, matching `CashflowChart` and the
 * figures in the table twin: a refund went back to the category it came out of,
 * so it reduces what that bucket cost rather than appearing as income the plan
 * never promised.
 *
 * ## Why the column is stacked by bucket rather than drawn as one block
 *
 * A month over the plan is a fact; *which* kind of spending put it over is the
 * reason, and it is the only part a household can act on. Four hues and a grey
 * is the whole encoding — the same four shares the meter under the headline
 * figures draws and the same ones Configuration draws off the estimates, so the
 * reader carries the colours between the three. `bucketTone` is where they
 * live; see that file for why they may not be changed casually.
 *
 * **A bucket is drawn on the side its own sign puts it**, `stackPaths`' rule
 * shared with the other two column charts: a month in which one bucket was
 * refunded more than it spent genuinely put money back, and it draws below the
 * baseline rather than being quietly clamped to zero. That rule is also what
 * guarantees the stack's two extents add to the month's net spend, so the
 * column total is always the figure the read-out names.
 *
 * ## What is deliberately not on it
 *
 * Income. It belongs to the chart above this one, where it is the subject, and
 * a second series on a second scale is the one thing a reader cannot be asked
 * to do. One axis, in dollars, so a column can be compared against the plan
 * line and against last March without checking which axis anything is on.
 *
 * Pre-tax retirement contributions, on either side. They never become
 * transactions, so the books cannot show them; `useSpendingReport` excludes
 * them from the plan figure for exactly that reason, and the note there is the
 * long version.
 */

const VIEW = { width: 760, height: 300 };
// The right margin carries the plan line's own label. It sits beside the line
// rather than over the last column, which is usually where the line crosses.
const PAD = { top: 18, right: 62, bottom: 34, left: 66 };
const PLOT = {
  left: PAD.left,
  right: VIEW.width - PAD.right,
  top: PAD.top,
  bottom: VIEW.height - PAD.bottom,
};
const PLOT_WIDTH = PLOT.right - PLOT.left;
const PLOT_HEIGHT = PLOT.bottom - PLOT.top;

/** How far the stack reaches either side of the baseline. The two add to the
 *  month's net spend, which is what the read-out names. */
function extentOf(entry) {
  let up = 0;
  let down = 0;
  for (const bucket of entry.buckets) {
    if (bucket.netSpentCents > 0) up += bucket.netSpentCents;
    else down += bucket.netSpentCents;
  }
  return { up, down };
}

/**
 * The scale, which **always has room for the plan line**.
 *
 * A household comfortably inside its plan would otherwise get a threshold drawn
 * off the top of the plot — the one month where the chart has good news and the
 * mark carrying it is the one that does not fit.
 */
function scaleFor(series, plannedCents) {
  let high = plannedCents > 0 ? plannedCents : 0;
  let low = 0;
  for (const entry of series) {
    const { up, down } = extentOf(entry);
    high = Math.max(high, up);
    low = Math.min(low, down);
  }

  const { min, max, ticks } = axisTicks(low, high);
  const y = (cents) => PLOT.bottom - ((cents - min) / (max - min)) * PLOT_HEIGHT;
  return { y, ticks };
}

/** Over or under, as a household says it rather than as a sign. */
function varianceOf(entry, plannedCents) {
  const overCents = entry.netSpentCents - plannedCents;
  return {
    overCents,
    // A month exactly on plan is neither, and saying "over by $0" of it would
    // be a worse answer than saying nothing.
    label:
      overCents === 0
        ? "on plan"
        : `${formatCents(Math.abs(overCents))} ${overCents > 0 ? "over" : "under"}`,
  };
}

/**
 * A month the books do not reach has no verdict, and this is what withholds it —
 * at **both** ends of the window.
 *
 * The window can reach back further than the ledger does: twelve months asked
 * for against four months of records is the ordinary case for a household that
 * started recently, and those early columns are empty because nothing was
 * written down rather than because nothing was spent. A custom window can
 * equally run past today — a calendar-year report read in October — and those
 * columns are empty because the months have not happened. Measuring either
 * against the plan would report months of perfect discipline nobody lived, and
 * it would be the most flattering lie on the page.
 *
 * The threshold is still drawn across both: the plan is a standing figure, and
 * it neither began when the records did nor stops at the end of this month. It
 * is only the *claim about a month* that is withheld, which is the same
 * distinction `useSpendingReport` makes when it divides the per-month average by
 * the months the books cover rather than by the months asked for.
 */
const coverageOf = (period, startPeriod, endPeriod) => {
  if (startPeriod != null && !periodLTE(startPeriod, period)) return "before";
  if (endPeriod != null && !periodLTE(period, endPeriod)) return "after";
  return "covered";
};

/** What a month says about itself against the plan, or why it says nothing. */
function verdictOf(entry, plannedCents, coverageStartPeriod, coverageEndPeriod) {
  if (!(plannedCents > 0)) return null;
  const coverage = coverageOf(entry.period, coverageStartPeriod, coverageEndPeriod);
  if (coverage === "before") {
    return { overCents: null, label: "No records this month" };
  }
  // The other end of the same withholding, and it needs its own words: an empty
  // column before the books began is a month nobody wrote down, while one past
  // today is a month nobody has lived. Reporting either as spending held under
  // the plan would be the most flattering lie on the page.
  if (coverage === "after") {
    return { overCents: null, label: "Still to come" };
  }
  const variance = varianceOf(entry, plannedCents);
  return {
    ...variance,
    label: variance.overCents === 0 ? "On plan" : `${variance.label} the plan`,
  };
}

/** The month and every figure on it, said in words for a screen reader. */
function describe(entry, plannedCents, coverageStartPeriod, coverageEndPeriod) {
  const parts = entry.buckets
    .filter((bucket) => bucket.netSpentCents !== 0)
    .map((bucket) => `${bucket.label} ${formatCents(bucket.netSpentCents)}`);

  const verdict = verdictOf(entry, plannedCents, coverageStartPeriod, coverageEndPeriod);

  return `${formatPeriod(entry.period)}: ${formatCents(entry.netSpentCents)} spent${
    verdict ? `, ${verdict.label.toLowerCase()}` : ""
  }${parts.length ? `, ${parts.join(", ")}` : ""}`;
}

function Swatch({ className }) {
  return <span className={`h-2 w-2 shrink-0 ${className}`} aria-hidden="true" />;
}

/**
 * The hovered month's figures. Never the only route to a value — the table twin
 * under the chart carries every one of them.
 */
function Readout({ entry, plannedCents, coverageStartPeriod, coverageEndPeriod }) {
  const rows = entry.buckets.filter((bucket) => bucket.netSpentCents !== 0);
  const verdict = verdictOf(entry, plannedCents, coverageStartPeriod, coverageEndPeriod);

  return (
    <div className="pointer-events-none w-max max-w-[18rem] border border-edge bg-ledger px-3 py-2 shadow-lg shadow-black/50">
      <div className="font-mono text-label uppercase text-chalk-soft">
        {formatPeriod(entry.period)}
      </div>
      <div className="mt-0.5 font-sans text-base font-semibold tabular-nums text-chalk">
        {formatCents(entry.netSpentCents)} spent
      </div>
      {/* Over the plan is the expense colour and under it is the income one —
          the same reading the rest of the app gives those two colours, rather
          than a third meaning for them here. A month the books do not reach is
          neither, and wears the muted tone it deserves. */}
      {verdict && (
        <div
          className={`font-mono text-label uppercase ${
            verdict.overCents > 0
              ? "text-vermilion"
              : verdict.overCents < 0
                ? "text-verdant"
                : "text-chalk-soft"
          }`}
        >
          {verdict.label}
        </div>
      )}
      {rows.length > 0 && (
        <dl className="mt-1.5 space-y-0.5 border-t border-edge pt-1.5">
          {rows.map((bucket) => (
            <div key={bucket.key} className="flex items-center gap-2">
              <Swatch className={bucketTone(bucket.bucket).swatch} />
              <dt className="font-sans text-row text-chalk-soft">{bucket.label}</dt>
              <dd className="ml-auto pl-4 font-mono text-row tabular-nums text-chalk">
                {formatCents(bucket.netSpentCents)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

export default function PlanVsActualChart({
  series,
  plannedCents,
  coverageStartPeriod = null,
  coverageEndPeriod = null,
}) {
  // Which column the pointer or the keyboard is on. Null is a real state — the
  // chart is being looked at rather than interrogated.
  const [active, setActive] = useState(null);
  const targets = useRef([]);

  // Zero is "nobody has set an estimate", not "the plan is to spend nothing",
  // so the threshold is left off rather than drawn along the baseline where it
  // would read as a plan of none that every month overshot. The page says so in
  // words above the chart.
  const hasPlan = plannedCents > 0;

  const { y, ticks } = scaleFor(series, hasPlan ? plannedCents : 0);
  const slot = PLOT_WIDTH / series.length;
  const barWidth = barWidthFor(slot, series.length);
  const radius = radiusFor(barWidth);
  const centreOf = (index) => PLOT.left + slot * (index + 0.5);

  const baseline = y(0);
  const lastIndex = series.length - 1;
  const labels = axisLabels(series.map((entry) => entry.period));

  // Only the buckets that actually appear get a legend entry: five swatches on
  // a household that files everything under two is four facts and three blanks.
  const present = series[0].buckets.filter((_, index) =>
    series.some((entry) => entry.buckets[index].netSpentCents !== 0)
  );

  // A shorter window can leave the active index past the end of the new series,
  // so it is checked rather than trusted.
  const activeEntry = active != null && active <= lastIndex ? series[active] : null;
  const activeIndex = activeEntry ? active : null;

  function handleKeyDown(event, index) {
    const move = { ArrowLeft: -1, ArrowRight: 1, Home: -index, End: lastIndex - index }[event.key];
    if (move == null) return;
    event.preventDefault();
    targets.current[Math.max(0, Math.min(lastIndex, index + move))]?.focus();
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 pt-3">
        {present.map((bucket) => (
          <span key={bucket.key} className="flex items-center gap-1.5">
            <Swatch className={bucketTone(bucket.bucket).swatch} />
            <span className="font-mono text-label uppercase text-chalk-soft">{bucket.label}</span>
          </span>
        ))}
        {hasPlan && (
          <span className="flex items-center gap-1.5">
            {/* The legend mark is dashed because the line is, and for the same
                reason: it is the threshold, not another band of money. */}
            <span
              className="h-0 w-4 shrink-0 border-t-2 border-dashed border-chalk"
              aria-hidden="true"
            />
            <span className="font-mono text-label uppercase text-chalk-soft">
              Plan {formatCents(plannedCents)}/mo
            </span>
          </span>
        )}
      </div>

      {/* Scrolls rather than shrinking: the labels have a size below which they
          stop being labels. */}
      <div className="overflow-x-auto px-2 pb-2 pt-1">
        <div className="relative min-w-[600px]">
          {activeEntry && (
            <div
              className="absolute top-0 z-10"
              style={{
                left: `${(centreOf(activeIndex) / VIEW.width) * 100}%`,
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
              <Readout
                entry={activeEntry}
                plannedCents={hasPlan ? plannedCents : 0}
                coverageStartPeriod={coverageStartPeriod}
                coverageEndPeriod={coverageEndPeriod}
              />
            </div>
          )}

          <svg
            viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
            className="w-full"
            role="group"
            aria-label="Spending by month against the plan, split by bucket"
          >
            {ticks.map((tick) => (
              <g key={tick}>
                <line
                  x1={PLOT.left}
                  x2={PLOT.right}
                  y1={y(tick)}
                  y2={y(tick)}
                  className="stroke-edge"
                  strokeWidth={1}
                />
                <text
                  x={PLOT.left - 10}
                  y={y(tick)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="fill-chalk-soft font-mono text-label tracking-normal tabular-nums"
                >
                  {formatCompactCents(tick)}
                </text>
              </g>
            ))}

            {/* Zero separates a month that cost money from one that was refunded
                more than it spent, so it is a step brighter than the grid. */}
            <line
              x1={PLOT.left}
              x2={PLOT.right}
              y1={baseline}
              y2={baseline}
              className="stroke-chalk-soft"
              strokeWidth={1}
            />

            {/* Behind the columns, so a month that overshoots crosses it and is
                read as crossing it rather than as stopping at it. */}
            {hasPlan && (
              <>
                <line
                  x1={PLOT.left}
                  x2={PLOT.right}
                  y1={y(plannedCents)}
                  y2={y(plannedCents)}
                  className="stroke-chalk"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  strokeLinecap="round"
                />
                <text
                  x={PLOT.right + 8}
                  y={y(plannedCents)}
                  dominantBaseline="middle"
                  className="fill-chalk font-mono text-label font-medium tracking-normal tabular-nums"
                >
                  {formatCompactCents(plannedCents)}
                </text>
              </>
            )}

            {series.map((entry, index) => (
              <g key={entry.period}>
                {stackPaths(
                  entry.buckets.map((bucket) => bucket.netSpentCents),
                  {
                    x: centreOf(index) - barWidth / 2,
                    width: barWidth,
                    y,
                    radius,
                  }
                ).map(
                  (path) =>
                    path.d && (
                      <path
                        key={entry.buckets[path.index].key}
                        d={path.d}
                        className={bucketTone(entry.buckets[path.index].bucket).fill}
                      />
                    )
                )}
              </g>
            ))}

            {activeIndex != null && (
              <line
                x1={centreOf(activeIndex)}
                x2={centreOf(activeIndex)}
                y1={PLOT.top}
                y2={PLOT.bottom}
                className="stroke-chalk-soft"
                strokeWidth={1}
                strokeOpacity={0.5}
              />
            )}

            {labels.map((label) => (
              <text
                key={label.period}
                x={centreOf(label.index)}
                y={PLOT.bottom + 16}
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
                is the month rather than the few pixels of bar in it. One tab
                stop, arrows between them — a decade is a hundred and twenty. */}
            {series.map((entry, index) => (
              <rect
                key={entry.period}
                ref={(node) => {
                  targets.current[index] = node;
                }}
                x={PLOT.left + slot * index}
                y={PLOT.top}
                width={slot}
                height={PLOT_HEIGHT}
                fill="transparent"
                tabIndex={index === (activeIndex ?? lastIndex) ? 0 : -1}
                role="img"
                aria-label={describe(
                  entry,
                  hasPlan ? plannedCents : 0,
                  coverageStartPeriod,
                  coverageEndPeriod
                )}
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
