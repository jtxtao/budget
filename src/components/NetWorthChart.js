import { useRef, useState } from "react";
import useChartWidth from "../hooks/useChartWidth";
import {
  axisLabels,
  axisTicks,
  barWidthFor,
  chartFrame,
  labelBudget,
  radiusFor,
  stackPaths as stackedColumn,
} from "../chartAxis";
import { HOLDING_CLASSES } from "../hooks/useNetWorth";
import { formatCents, formatCompactCents, formatPeriod, formatPeriodShort } from "../utils";

/**
 * Net worth over time, and which holdings it is made of.
 *
 * One stacked column per month, **one segment per series**: every account valued
 * by hand gets its own, and the accounts the budget spends through share one
 * between them. What is owned grows up from the baseline and what is owed is
 * drawn down from it, with the net traced across as a line. Debt below the axis
 * rather than stacked with the assets is the whole reason the chart reads:
 * stacking it would make the column height the sum of what is owned and what is
 * owed, which is a figure that means nothing. Split across the baseline, the
 * column shows both sides and the line shows the gap between them, which is the
 * question the page is named after.
 *
 * **A segment's side is decided by its own sign, not by its kind.** That is what
 * lets the spending band be one series: a household whose cards outweigh its
 * cash that month genuinely has negative working capital, and it draws below the
 * line for that month rather than being folded into the assets.
 *
 * The line and the columns share one axis and one unit. There is no second scale
 * here and there must never be: two y-axes on one plot let the reader see a
 * relationship that only exists in where the axes were pinned.
 *
 * **Colour still says what kind of money, and lightness says which account.**
 * The four band hues are the ones validated against each other in
 * `tailwind.config.js` and nothing here adds a fifth — an account is drawn in
 * its band's hue, stepped down toward the surface by its position within that
 * band, and same-hue segments are stacked adjacent so each band reads as one
 * ramp. Hue count is what makes a stacked chart unreadable, so the number of
 * accounts moves the ramp and never the palette.
 *
 * **Three channels carry the series, not one.** With shades in play that matters
 * more, not less: the legend, the direct label on the net, and the table view
 * below the chart are load-bearing accessibility, not decoration. Do not remove
 * one to save space.
 *
 * Drawn at a fixed viewBox and scaled, with a minimum width the card scrolls
 * inside rather than shrinking below: a decade of labels squeezed onto a phone
 * would be a chart nobody can read, and a chart that scrolls is one that is
 * merely inconvenient.
 */

// The plot, in viewBox units. The bottom band is reserved for the month labels
// rather than shared with the plot — an axis drawn outside its container is the
// classic way a chart card ends up with its own tiny scrollbar.
const VIEW = { width: 760, height: 300 };
// The right margin is wide enough for the net's end label to sit *beside* the
// last column rather than on top of it. The line ends wherever the net happens
// to be, which on a household with a mortgage is usually somewhere in the middle
// of the stack — so a label placed over the plot would land on a filled bar
// whatever anchor it was given.
const PAD = { top: 18, right: 54, bottom: 34, left: 66 };
const PLOT = {
  left: PAD.left,
  right: VIEW.width - PAD.right,
  top: PAD.top,
  bottom: VIEW.height - PAD.bottom,
};
const PLOT_HEIGHT = PLOT.bottom - PLOT.top;

/**
 * The hue each band is drawn in — the four validated together on `panel`, and
 * the only four the chart uses however many accounts there are.
 */
const BAND_STYLE = {
  [HOLDING_CLASSES.CASH]: { fill: "fill-verdant", swatch: "bg-verdant" },
  [HOLDING_CLASSES.INVESTED]: { fill: "fill-invested", swatch: "bg-invested" },
  [HOLDING_CLASSES.PROPERTY]: { fill: "fill-property", swatch: "bg-property" },
  [HOLDING_CLASSES.DEBT]: { fill: "fill-vermilion", swatch: "bg-vermilion" },
};

// How far the ramp within a band is allowed to fall toward the surface. Below
// about half, a segment stops separating from the panel behind it and reads as
// the gap between two others rather than as money.
const SHADE_FLOOR = 0.5;

/**
 * Pair every slice with a hue and a step within it.
 *
 * The steps are spread evenly across the band however many accounts are in it,
 * rather than taken from a fixed list — a fixed list either runs out or leaves
 * two accounts at the two extremes of a ramp built for six.
 */
function styleSlices(slices) {
  const counts = new Map();
  for (const slice of slices) counts.set(slice.band, (counts.get(slice.band) ?? 0) + 1);

  const seen = new Map();
  return slices.map((slice) => {
    const index = seen.get(slice.band) ?? 0;
    seen.set(slice.band, index + 1);
    const count = counts.get(slice.band);
    return {
      ...slice,
      ...BAND_STYLE[slice.band],
      shade: count < 2 ? 1 : 1 - (index / (count - 1)) * (1 - SHADE_FLOOR),
    };
  });
}

const valueOf = (entry, slice) => entry.values?.[slice.key] ?? 0;

/** How far the stack reaches either side of the baseline this month. The two
 *  add to the net, so the line is always inside the column. */
function extentOf(entry, slices) {
  let up = 0;
  let down = 0;
  for (const slice of slices) {
    const value = valueOf(entry, slice);
    if (value > 0) up += value;
    else down += value;
  }
  return { up, down };
}

/**
 * A domain that covers the data, in cents.
 *
 * Zero is always in it — the baseline is where debt separates from assets, so it
 * is not something the scale may crop out to gain resolution — but that
 * guarantee belongs to `axisTicks` rather than to this caller, along with the
 * empty-domain guard and the rounding to figures people say.
 */
function scaleFor(series, slices) {
  let high = 0;
  let low = 0;
  for (const entry of series) {
    const { up, down } = extentOf(entry, slices);
    high = Math.max(high, up);
    low = Math.min(low, down);
  }

  const { min, max, ticks } = axisTicks(low, high);
  const y = (cents) => PLOT.bottom - ((cents - min) / (max - min)) * PLOT_HEIGHT;
  return { y, ticks };
}

/**
 * The stack for one month, as paths ready to draw, each paired back to the slice
 * it belongs to so the caller has its hue and its shade on the same object.
 *
 * The stacking itself — which side of the baseline a figure lands on, and the
 * gap between segments — is `chartAxis`', shared with the cashflow chart. What
 * is left here is what makes it a *net-worth* column: which account each segment
 * is, and what colour that makes it.
 */
function stackPaths(entry, slices, geometry) {
  return stackedColumn(
    slices.map((slice) => valueOf(entry, slice)),
    geometry
  ).map((path) => ({ ...slices[path.index], d: path.d }));
}

/** The month, and every figure on it, said in words for a screen reader. */
function describe(entry, slices) {
  const parts = slices
    .filter((slice) => valueOf(entry, slice) !== 0)
    .map((slice) => `${slice.label} ${formatCents(valueOf(entry, slice))}`);
  return `${formatPeriod(entry.period)}: net worth ${formatCents(entry.netCents)}${
    parts.length ? `, ${parts.join(", ")}` : ""
  }`;
}

function Swatch({ className, shade = 1 }) {
  return (
    <span
      className={`h-2 w-2 shrink-0 ${className}`}
      style={{ opacity: shade }}
      aria-hidden="true"
    />
  );
}

/** The hovered month's figures. Never the only route to a value — the table
 *  below the chart carries every one of them. */
function Readout({ entry, slices }) {
  const rows = slices.filter((slice) => valueOf(entry, slice) !== 0);

  return (
    <div className="pointer-events-none w-max max-w-[18rem] border border-edge bg-ledger px-3 py-2 shadow-lg shadow-black/50">
      <div className="font-mono text-label uppercase text-chalk-soft">
        {formatPeriod(entry.period)}
      </div>
      <div className="mt-0.5 font-sans text-base font-semibold tabular-nums text-chalk">
        {formatCents(entry.netCents)}
      </div>
      {rows.length > 0 && (
        <dl className="mt-1.5 space-y-0.5 border-t border-edge pt-1.5">
          {rows.map((slice) => (
            <div key={slice.key} className="flex items-center gap-2">
              <Swatch className={slice.swatch} shade={slice.shade} />
              <dt className="font-sans text-row text-chalk-soft">{slice.label}</dt>
              <dd className="ml-auto pl-4 font-mono text-row tabular-nums text-chalk">
                {formatCents(valueOf(entry, slice))}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

export default function NetWorthChart({ series, slices }) {
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
  // The hit areas, so an arrow key can move focus between them. A window that
  // shrinks leaves stale entries past its end; they are only ever read by index
  // against the current series, so they are never reached.
  const targets = useRef([]);

  const drawn = styleSlices(slices);
  const { y, ticks } = scaleFor(series, drawn);
  const slot = plotWidth / series.length;
  const barWidth = barWidthFor(slot, series.length);
  const radius = radiusFor(barWidth);
  const centreOf = (index) => plot.left + slot * (index + 0.5);

  const baseline = y(0);
  const netPoints = series.map((entry, index) => `${centreOf(index)},${y(entry.netCents)}`);
  const lastIndex = series.length - 1;
  const labels = axisLabels(series.map((entry) => entry.period), labelBudget(plotWidth));

  // Switching the window to a shorter one can leave the active index past the
  // end of the new series, so it is checked rather than trusted — a stale index
  // here would be a read of `undefined` in the read-out.
  const activeEntry = active != null && active <= lastIndex ? series[active] : null;
  const activeIndex = activeEntry ? active : null;

  // One tab stop, not one per month: ten years is a hundred and twenty hit
  // areas, and a chart that costs a hundred and twenty presses to tab past is a
  // chart the keyboard cannot get past. The strip is entered at the month the
  // reader came for — the most recent — and walked with the arrows from there.
  function handleKeyDown(event, index) {
    const move = { ArrowLeft: -1, ArrowRight: 1, Home: -index, End: lastIndex - index }[event.key];
    if (move == null) return;
    event.preventDefault();
    targets.current[Math.max(0, Math.min(lastIndex, index + move))]?.focus();
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 pt-3">
        {drawn.map((slice) => (
          <span key={slice.key} className="flex items-center gap-1.5">
            <Swatch className={slice.swatch} shade={slice.shade} />
            <span className="font-mono text-label uppercase text-chalk-soft">{slice.label}</span>
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 shrink-0 bg-chalk" aria-hidden="true" />
          <span className="font-mono text-label uppercase text-chalk-soft">Net worth</span>
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
              <Readout entry={activeEntry} slices={drawn} />
            </div>
          )}

          <svg
            viewBox={`0 0 ${view.width} ${view.height}`}
            className="w-full"
            role="group"
            aria-label="Net worth by month, split by account"
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

            {/* Zero is where owned separates from owed, so it is drawn a step
                brighter than the rest of the grid. */}
            <line
              x1={plot.left}
              x2={plot.right}
              y1={baseline}
              y2={baseline}
              className="stroke-chalk-soft"
              strokeWidth={1}
            />

            {series.map((entry, index) => {
              // The column's own ground, in the surface colour. The shades
              // within a band are drawn as the band hue at reduced opacity —
              // which is what keeps the palette at four hues however many
              // accounts there are — and without this the grid hairlines behind
              // a dimmed segment show through it as stripes across the money.
              const { up, down } = extentOf(entry, drawn);
              if (up === down) return null;
              return (
                <rect
                  key={entry.period}
                  x={centreOf(index) - barWidth / 2}
                  y={y(up)}
                  width={barWidth}
                  height={y(down) - y(up)}
                  className="fill-panel"
                />
              );
            })}

            {series.map((entry, index) => (
              <g key={entry.period}>
                {stackPaths(entry, drawn, {
                  x: centreOf(index) - barWidth / 2,
                  width: barWidth,
                  y,
                  radius,
                }).map(
                  (path) =>
                    path.d && (
                      <path
                        key={path.key}
                        d={path.d}
                        className={path.fill}
                        fillOpacity={path.shade}
                      />
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

            <polyline
              points={netPoints.join(" ")}
              fill="none"
              className="stroke-chalk"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* The end dot wears a ring in the surface colour so it stays legible
                where it crosses a column. */}
            <circle
              cx={centreOf(lastIndex)}
              cy={y(series[lastIndex].netCents)}
              r={4}
              className="fill-chalk stroke-panel"
              strokeWidth={2}
            />

            {/* The one direct label on the chart. Labelling every point would be
                chaos; labelling the end is what the reader came for — and it
                sits in the right margin, clear of the columns, because the net
                line ends inside the stack rather than above it. */}
            <text
              x={centreOf(lastIndex) + barWidth / 2 + 8}
              y={y(series[lastIndex].netCents)}
              dominantBaseline="middle"
              className="fill-chalk font-mono text-label tracking-normal font-medium tabular-nums"
            >
              {formatCompactCents(series[lastIndex].netCents)}
            </text>

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
                the pointer does — but only one of them is in the tab order at a
                time, and the arrows move between them. */}
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
                aria-label={describe(entry, drawn)}
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
