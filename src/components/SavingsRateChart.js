import { useRef, useState } from "react";
import useChartWidth from "../hooks/useChartWidth";
import { axisLabels, axisTicks, chartFrame, labelBudget, lineRuns } from "../domain/chartAxis";
import { formatPeriod, formatPeriodShort, periodLTE } from "../utils";

/**
 * Per-month savings rate as a line over the report window.
 *
 * Savings rate = (income − net spending) / income, expressed as a percentage.
 * A month with no income records has no rate to draw — not zero, which would
 * imply the household spent everything, but a gap in the line, the same
 * refusal every other chart makes about months it cannot speak to.
 *
 * The average for the window is drawn as a dashed threshold, in the same
 * language as the plan line on the chart beside this one: it is the figure
 * each month is measured against, standing rather than varying.
 */

const DEFAULT_HEIGHT = 220;
const PAD = { top: 18, right: 54, bottom: 34, left: 54 };

function formatPct(pct) {
  return `${Math.round(pct)}%`;
}

function scaleFor(rates, averagePct, plotBottom, plotHeight) {
  let high = 0;
  let low = 0;
  for (const r of rates) {
    if (r == null) continue;
    high = Math.max(high, r);
    low = Math.min(low, r);
  }
  if (averagePct != null) {
    high = Math.max(high, averagePct);
    low = Math.min(low, averagePct);
  }
  const { min, max, ticks } = axisTicks(low, high);
  const y = (val) => plotBottom - ((val - min) / (max - min)) * plotHeight;
  return { y, ticks };
}

function describe(entry, rate) {
  if (rate == null) return `${formatPeriod(entry.period)}: no income recorded`;
  return `${formatPeriod(entry.period)}: ${formatPct(rate)} savings rate`;
}

function Readout({ entry, rate }) {
  return (
    <div className="pointer-events-none w-max max-w-[16rem] rounded-lg border border-edge bg-ledger px-3 py-2 shadow-lg shadow-black/50">
      <div className="text-label uppercase text-chalk-soft">{formatPeriod(entry.period)}</div>
      <div
        className={`mt-0.5 font-sans text-base font-semibold tabular-nums ${
          rate < 0 ? "text-vermilion" : "text-chalk"
        }`}
      >
        {formatPct(rate)} savings rate
      </div>
    </div>
  );
}

export default function SavingsRateChart({
  series,
  coverageStartPeriod = null,
  coverageEndPeriod = null,
  averageRatePct = null,
  chartHeight,
}) {
  const viewHeight = chartHeight ?? DEFAULT_HEIGHT;
  const box = useRef(null);
  const { view, plot, plotWidth } = chartFrame({
    width: useChartWidth(box),
    height: viewHeight,
    pad: PAD,
  });
  const [active, setActive] = useState(null);
  const targets = useRef([]);

  const covered = (period) =>
    (coverageStartPeriod == null || periodLTE(coverageStartPeriod, period)) &&
    (coverageEndPeriod == null || periodLTE(period, coverageEndPeriod));

  const rateOf = (entry) =>
    covered(entry.period) && entry.incomeCents > 0
      ? (entry.netCents / entry.incomeCents) * 100
      : null;

  const rates = series.map(rateOf);
  const plotHeight = plot.bottom - plot.top;
  const { y, ticks } = scaleFor(rates, averageRatePct, plot.bottom, plotHeight);

  const slot = plotWidth / series.length;
  const centreOf = (index) => plot.left + slot * (index + 0.5);
  const lastIndex = series.length - 1;

  const linePaths = lineRuns(rates, { x: centreOf, y });
  const baseline = y(0);
  const avgY = averageRatePct != null ? y(averageRatePct) : null;
  const labels = axisLabels(series.map((e) => e.period), labelBudget(plotWidth));
  const activeIndex = active != null && active <= lastIndex ? active : null;
  const activeEntry = activeIndex != null ? series[activeIndex] : null;
  const activeRate = activeEntry ? rateOf(activeEntry) : null;

  function handleKeyDown(event, index) {
    const move = { ArrowLeft: -1, ArrowRight: 1, Home: -index, End: lastIndex - index }[
      event.key
    ];
    if (move == null) return;
    event.preventDefault();
    targets.current[Math.max(0, Math.min(lastIndex, index + move))]?.focus();
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 pt-3">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 shrink-0 bg-azure" aria-hidden="true" />
          <span className="text-label uppercase text-chalk-soft">Post-tax savings rate</span>
        </span>
        {averageRatePct != null && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0 w-4 shrink-0 border-t border-dashed border-chalk-soft" aria-hidden="true" />
            <span className="text-label uppercase text-chalk-soft">
              {formatPct(averageRatePct)} average
            </span>
          </span>
        )}
      </div>

      <div className="px-2 pb-2 pt-1">
        <div ref={box} className="relative">
          {activeEntry && activeRate != null && (
            <div
              className="absolute top-0 z-10"
              style={{
                left: `${(centreOf(activeIndex) / view.width) * 100}%`,
                transform: `translateX(${
                  activeIndex > series.length * 0.65
                    ? "-100%"
                    : activeIndex < series.length * 0.35
                      ? "0"
                      : "-50%"
                })`,
              }}
            >
              <Readout entry={activeEntry} rate={activeRate} />
            </div>
          )}

          <svg
            viewBox={`0 0 ${view.width} ${view.height}`}
            className="w-full"
            role="group"
            aria-label="Post-tax savings rate by month"
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
                  x={plot.left - 8}
                  y={y(tick)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="fill-chalk-soft font-mono text-label tracking-normal tabular-nums"
                >
                  {formatPct(tick)}
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

            {avgY != null && (
              <line
                x1={plot.left}
                x2={plot.right}
                y1={avgY}
                y2={avgY}
                className="stroke-chalk-soft"
                strokeWidth={1}
                strokeDasharray="6 4"
              />
            )}

            {linePaths.map((points, ri) => (
              <polyline
                key={ri}
                points={points}
                fill="none"
                className="stroke-azure"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}

            {activeEntry && activeRate != null && (
              <circle
                cx={centreOf(activeIndex)}
                cy={y(activeRate)}
                r={3.5}
                className="fill-azure stroke-panel"
                strokeWidth={2}
              />
            )}

            {labels.map((label) => (
              <text
                key={label.period}
                x={centreOf(label.index)}
                y={plot.bottom + 16}
                textAnchor="middle"
                className="fill-chalk-soft text-label tracking-normal"
              >
                {formatPeriodShort(label.period)}
                {label.year && (
                  <tspan x={centreOf(label.index)} dy={13} className="fill-chalk-soft">
                    {label.year}
                  </tspan>
                )}
              </text>
            ))}

            {series.map((entry, index) => (
              <rect
                key={entry.period}
                ref={(node) => {
                  targets.current[index] = node;
                }}
                x={plot.left + slot * index}
                y={plot.top}
                width={slot}
                height={plotHeight}
                fill="transparent"
                tabIndex={index === (activeIndex ?? lastIndex) ? 0 : -1}
                role="img"
                aria-label={describe(entry, rateOf(entry))}
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
