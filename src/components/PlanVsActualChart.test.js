import { fireEvent, render, screen } from "@testing-library/react";
import PlanVsActualChart from "./PlanVsActualChart";
import { BUCKET_SERIES } from "../hooks/useSpendingReport";
import { addMonths, formatPeriod } from "../utils";

/**
 * The chart's geometry and its one rule — that the plan line always has room on
 * the scale — driven as the pure component it is.
 *
 * Props directly rather than through the providers: there is no store here, and
 * the shape this consumes is asserted against the real hook in
 * `useSpendingReport.test.js`. What a page test cannot see is whether a
 * coordinate is finite, which side of the baseline a bucket landed on, and
 * whether the threshold is on the plot at all.
 */

/** A month with its buckets in `BUCKET_SERIES` order, which is the fixed list
 *  and fixed order the real hook builds — a stacked column has to be able to
 *  colour a segment by its position. */
const month = (period, byBucket = {}) => {
  const buckets = BUCKET_SERIES.map((entry) => ({
    ...entry,
    netSpentCents: byBucket[entry.key] ?? 0,
  }));
  return {
    period,
    buckets,
    netSpentCents: buckets.reduce((sum, bucket) => sum + bucket.netSpentCents, 0),
  };
};

const monthsTo = (last, count, build = () => ({})) =>
  Array.from({ length: count }, (_, index) =>
    month(addMonths(last, -(count - 1 - index)), build(index))
  );

const draw = (series, plannedCents = 0, coverageStartPeriod = null) =>
  render(
    <PlanVsActualChart
      series={series}
      plannedCents={plannedCents}
      coverageStartPeriod={coverageStartPeriod}
    />
  );

const paths = (container) =>
  [...container.querySelectorAll("path")].map((node) => node.getAttribute("d"));

/** SVG y grows downward, so smaller is higher up the plot. */
const pointsIn = (d) => d.match(/-?[\d.]+/g).map(Number).filter((_, index) => index % 2 === 1);
const topOf = (d) => Math.min(...pointsIn(d));
const bottomOf = (d) => Math.max(...pointsIn(d));

/** The plan's threshold, which is the only dashed mark on the chart. */
const planLine = (container) => container.querySelector("line[stroke-dasharray]");
/** Zero, drawn a step brighter than the grid — and the only place the side of a
 *  segment is visible from outside. */
const baselineOf = (container) =>
  Number(container.querySelector("line.stroke-chalk-soft").getAttribute("y1"));

const steady = (index) => ({ essentials: 200000, fun: 50000 + index * 1000 });

test("draws only finite coordinates, so no month renders as a broken path", () => {
  const { container } = draw(monthsTo("2026-08", 12, steady), 260000);

  const drawn = paths(container);
  expect(drawn.length).toBeGreaterThan(0);
  for (const d of drawn) expect(d).not.toMatch(/NaN|Infinity|undefined/);
  for (const node of container.querySelectorAll("line, polyline, text")) {
    expect(node.outerHTML).not.toMatch(/NaN|Infinity/);
  }
});

test("a window with nothing in it draws no columns rather than dividing by an empty domain", () => {
  const { container } = draw(monthsTo("2026-08", 12), 0);

  expect(paths(container)).toHaveLength(0);
  for (const node of container.querySelectorAll("line, text")) {
    expect(node.outerHTML).not.toMatch(/NaN/);
  }
});

test("the plan line is on the plot even when every month came in well under it", () => {
  // The one month the chart has good news is the one where a scale fitted to
  // the data alone would push the threshold off the top.
  const { container } = draw(monthsTo("2026-08", 12, () => ({ essentials: 10000 })), 900000);

  const line = planLine(container);
  const y = Number(line.getAttribute("y1"));
  const plotTop = Math.min(
    ...[...container.querySelectorAll("rect")].map((node) => Number(node.getAttribute("y")))
  );

  expect(y).toBeGreaterThanOrEqual(plotTop);
  // And above every column, since nothing came close to it.
  for (const d of paths(container)) expect(topOf(d)).toBeGreaterThan(y);
});

test("a plan of nothing draws no threshold, because nobody has set one", () => {
  // Zero is "no estimates yet", not "a plan to spend nothing". A line along the
  // baseline would read as a plan every month overshot.
  const { container } = draw(monthsTo("2026-08", 6, steady), 0);

  expect(planLine(container)).toBeNull();
  expect(screen.queryByText(/^Plan /)).not.toBeInTheDocument();
});

test("a bucket refunded more than it spent draws below the baseline", () => {
  // The household got money back out of that bucket, and it belongs on the side
  // its own sign puts it rather than clamped to zero.
  const series = monthsTo("2026-08", 4, () => ({ essentials: 200000, fun: -30000 }));
  const { container } = draw(series, 170000);

  const baseline = baselineOf(container);
  const drawn = paths(container);

  expect(drawn.some((d) => bottomOf(d) > baseline)).toBe(true);
  expect(drawn.some((d) => topOf(d) < baseline)).toBe(true);
});

test("the legend names only the buckets that appear, not all five every time", () => {
  draw(monthsTo("2026-08", 6, () => ({ essentials: 200000, fun: 40000 })), 240000);

  expect(screen.getByText("Essentials")).toBeInTheDocument();
  expect(screen.getByText("Fun")).toBeInTheDocument();
  // Nothing was filed under these, so naming them would be three blanks beside
  // two facts.
  expect(screen.queryByText("Savings")).not.toBeInTheDocument();
  expect(screen.queryByText("No category")).not.toBeInTheDocument();
});

test("spending that could not be filed under a bucket still gets a segment", () => {
  // The segments have to add up to the column, or the stack describes a smaller
  // month than the figure the read-out names.
  const { container } = draw(
    monthsTo("2026-08", 4, () => ({ essentials: 100000, unfiled: 50000 })),
    100000
  );

  expect(screen.getByText("No category")).toBeInTheDocument();
  // Two segments a month, so the stack is the whole $1,500.
  expect(paths(container)).toHaveLength(8);
});

test("every month is reachable and readable without a pointer, and says how it sat against the plan", () => {
  draw(monthsTo("2026-08", 12, () => ({ essentials: 300000 })), 250000);

  const targets = screen.getAllByRole("img");
  expect(targets).toHaveLength(12);
  expect(targets[11]).toHaveAccessibleName(expect.stringContaining(formatPeriod("2026-08")));
  expect(targets[11]).toHaveAccessibleName(expect.stringContaining("$3,000 spent"));
  // Over and under, as a household says it rather than as a sign.
  expect(targets[11]).toHaveAccessibleName(expect.stringContaining("$500 over the plan"));
});

test("a month the books do not reach gets no verdict, rather than a flattering one", () => {
  // The window reaches back twelve months and the ledger four. Those eight
  // empty columns are months nobody wrote anything down in, and reporting them
  // as thousands under plan would be eight months of discipline nobody lived.
  const series = monthsTo("2026-08", 12, (index) =>
    index >= 8 ? { essentials: 300000 } : {}
  );
  draw(series, 250000, "2026-05");

  const targets = screen.getAllByRole("img");

  expect(targets[0]).toHaveAccessibleName(expect.stringContaining("no records this month"));
  expect(targets[0]).toHaveAccessibleName(expect.not.stringContaining("under"));
  // And the months it does reach are measured as before.
  expect(targets[11]).toHaveAccessibleName(expect.stringContaining("$500 over the plan"));
});

test("the threshold still spans the uncovered months, because the plan did not start when the records did", () => {
  const series = monthsTo("2026-08", 12, (index) => (index >= 8 ? { essentials: 300000 } : {}));
  const { container } = draw(series, 250000, "2026-05");

  const line = planLine(container);
  const plotLeft = Math.min(
    ...[...container.querySelectorAll("rect")].map((node) => Number(node.getAttribute("x")))
  );
  expect(Number(line.getAttribute("x1"))).toBeLessThanOrEqual(plotLeft);
});

test("a month with no plan to measure against says nothing about one", () => {
  draw(monthsTo("2026-08", 4, () => ({ essentials: 300000 })), 0);

  const targets = screen.getAllByRole("img");
  expect(targets[3]).toHaveAccessibleName(expect.not.stringContaining("plan"));
});

test("the arrows walk the months, so a decade is one tab stop and not a hundred and twenty", () => {
  draw(monthsTo("2026-08", 12, steady), 250000);

  const targets = screen.getAllByRole("img");
  expect(targets.filter((node) => node.getAttribute("tabindex") === "0")).toHaveLength(1);
  expect(targets[11]).toHaveAttribute("tabindex", "0");

  fireEvent.focusIn(targets[11]);
  fireEvent.keyDown(targets[11], { key: "ArrowLeft" });
  expect(targets[10]).toHaveFocus();

  fireEvent.keyDown(targets[10], { key: "Home" });
  expect(targets[0]).toHaveFocus();
});

test("focus opens the same read-out as hover, so the tooltip gates nothing", () => {
  draw(monthsTo("2026-08", 12, () => ({ essentials: 200000, fun: 40000 })), 300000);

  expect(screen.queryByText(formatPeriod("2026-04"))).not.toBeInTheDocument();

  fireEvent.focusIn(screen.getAllByRole("img")[7]);

  expect(screen.getByText(formatPeriod("2026-04"))).toBeInTheDocument();
  expect(screen.getByText("$2,400 spent")).toBeInTheDocument();
  // Under the plan, and said as a household says it.
  expect(screen.getByText("$600 under the plan")).toBeInTheDocument();
});

test("a decade thins the month labels instead of printing a hundred and twenty", () => {
  const { container } = draw(monthsTo("2026-08", 120, steady), 250000);

  const labels = [...container.querySelectorAll("text")].filter((node) =>
    /^[A-Z][a-z]{2}/.test(node.textContent)
  );

  expect(labels.length).toBeLessThanOrEqual(14);
  expect(labels.length).toBeGreaterThan(4);
  expect(labels[labels.length - 1].textContent).toContain("Aug");
});
