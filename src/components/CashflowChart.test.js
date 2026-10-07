import { fireEvent, render, screen } from "@testing-library/react";
import CashflowChart from "./CashflowChart";
import { addMonths, formatPeriod } from "../utils";

/**
 * The chart's geometry, which is the part of it no page test can see: a
 * screenshot shows that something was drawn, and these assert that what was
 * drawn is finite, sits on the right side of the baseline, and is reachable
 * without a pointer.
 *
 * A pure component, so this takes props directly rather than going through the
 * providers — there is no store involved, and the shape it consumes is asserted
 * against the real hook in `useSpendingReport.test.js`.
 */
const month = (period, { income = 0, spent = 0, refund = 0 } = {}) => {
  const netSpentCents = spent - refund;
  return {
    period,
    incomeCents: income,
    spentCents: spent,
    refundCents: refund,
    netSpentCents,
    netCents: income - netSpentCents,
  };
};

const monthsTo = (last, count, build = () => ({})) =>
  Array.from({ length: count }, (_, index) =>
    month(addMonths(last, -(count - 1 - index)), build(index))
  );

const draw = (series) => render(<CashflowChart series={series} />);

const paths = (container) =>
  [...container.querySelectorAll("path")].map((node) => node.getAttribute("d"));

/** Every y coordinate in a path, so a segment's reach either side of the
 *  baseline can be read off it. SVG y grows downward, so smaller is higher. */
const pointsIn = (d) => {
  const numbers = d.match(/-?[\d.]+/g).map(Number);
  return numbers.filter((_, index) => index % 2 === 1);
};
const topOf = (d) => Math.min(...pointsIn(d));
const bottomOf = (d) => Math.max(...pointsIn(d));

test("draws only finite coordinates, so no month renders as a broken path", () => {
  const series = monthsTo("2026-08", 12, (index) => ({
    income: 500000 + index * 1000,
    spent: 420000 + index * 900,
    refund: index % 3 === 0 ? 4000 : 0,
  }));

  const { container } = draw(series);

  const drawn = paths(container);
  expect(drawn.length).toBeGreaterThan(0);
  for (const d of drawn) expect(d).not.toMatch(/NaN|Infinity|undefined/);
  for (const node of container.querySelectorAll("line, circle, polyline, text")) {
    expect(node.outerHTML).not.toMatch(/NaN|Infinity/);
  }
});

test("a window with nothing in it draws no columns rather than dividing by an empty domain", () => {
  // Every month at zero gives the scale nothing to span. The guard matters:
  // without it every value maps to the same pixel and every coordinate is NaN.
  const { container } = draw(monthsTo("2026-08", 12));

  expect(paths(container)).toHaveLength(0);
  for (const node of container.querySelectorAll("line, polyline, circle")) {
    expect(node.outerHTML).not.toMatch(/NaN/);
  }
});

test("income draws above the baseline and spending below it", () => {
  const { container } = draw(monthsTo("2026-08", 12, () => ({ income: 500000, spent: 300000 })));

  // Two segments a month, both starting at the baseline: the one that reaches
  // higher is income and the one that reaches lower is what went out. Stacking
  // them would make the column height earnings plus outgoings, which is a
  // figure that means nothing.
  const [up, down] = paths(container);
  expect(topOf(up)).toBeLessThan(topOf(down));
  expect(bottomOf(down)).toBeGreaterThan(bottomOf(up));
});

test("a month whose refunds outweighed its spending draws above the line, not below it", () => {
  // The household got more back than it spent — money genuinely came in that
  // month, and it belongs on the side its own sign puts it rather than on the
  // side the word "spending" suggests.
  const series = monthsTo("2026-08", 12, () => ({ income: 100000, spent: 20000, refund: 90000 }));
  const { container } = draw(series);

  // Zero is drawn a step brighter than the rest of the grid, which is also the
  // only place the side of a segment is visible from the outside.
  const baseline = Number(container.querySelector("line.stroke-chalk-soft").getAttribute("y1"));
  const drawn = paths(container);

  expect(drawn.length).toBeGreaterThan(0);
  // Nothing reaches below the line: the two segments stack upward from it, the
  // way two positive figures do.
  for (const d of drawn) expect(bottomOf(d)).toBeLessThanOrEqual(baseline);
});

test("every month is reachable and readable without a pointer", () => {
  draw(monthsTo("2026-08", 12, () => ({ income: 500000, spent: 300000 })));

  const targets = screen.getAllByRole("img");
  expect(targets).toHaveLength(12);
  expect(targets[11]).toHaveAccessibleName(expect.stringContaining(formatPeriod("2026-08")));
  // Spending is named as the amount spent, positive, the way a person states
  // it — the sign lives in the maths, not in the read-out.
  expect(targets[11]).toHaveAccessibleName(expect.stringContaining("Spending $3,000"));
  expect(targets[11]).toHaveAccessibleName(expect.stringContaining("net $2,000"));
});

test("the arrows walk the months, so a decade is one tab stop and not a hundred and twenty", () => {
  draw(monthsTo("2026-08", 12, () => ({ income: 500000 })));

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
  draw(monthsTo("2026-08", 12, () => ({ income: 500000, spent: 300000 })));

  expect(screen.queryByText(formatPeriod("2026-04"))).not.toBeInTheDocument();

  fireEvent.focusIn(screen.getAllByRole("img")[7]);

  expect(screen.getByText(formatPeriod("2026-04"))).toBeInTheDocument();
  expect(screen.getByText("$2,000 net")).toBeInTheDocument();
  expect(screen.getByText("$5,000")).toBeInTheDocument();
});

test("the gross figure is named only where a refund makes it differ from the net", () => {
  draw(monthsTo("2026-08", 3, (index) => ({ income: 500000, spent: 300000, refund: index * 5000 })));

  const targets = screen.getAllByRole("img");

  // A month with nothing paid back reads as two figures and says nothing about
  // refunds; one with money back says where the difference came from.
  fireEvent.focusIn(targets[0]);
  expect(screen.queryByText(/refunded/)).not.toBeInTheDocument();

  fireEvent.focusIn(targets[2]);
  expect(screen.getByText("after $100 refunded")).toBeInTheDocument();
});

test("the legend names both series and the line, which is what carries identity when colour cannot", () => {
  draw(monthsTo("2026-08", 12, () => ({ income: 1 })));

  for (const label of ["Income", "Spending", "Net"]) {
    expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  }
});

test("a decade thins the month labels instead of printing a hundred and twenty", () => {
  const { container } = draw(monthsTo("2026-08", 120, () => ({ income: 500000, spent: 400000 })));

  // The month labels, as against the axis ticks, which are money.
  const labels = [...container.querySelectorAll("text")].filter((node) =>
    /^[A-Z][a-z]{2}/.test(node.textContent)
  );

  expect(labels.length).toBeLessThanOrEqual(14);
  expect(labels.length).toBeGreaterThan(4);
  // Counted back from the most recent, so the month the reader came for is
  // always the one named at the right-hand edge.
  expect(labels[labels.length - 1].textContent).toContain("Aug");
  expect(labels[labels.length - 1].textContent).toContain("2026");
});

test("the net line spans the months the books cover and stops there", () => {
  // Twelve columns, records in the last three of them and two months of the
  // window still to come — the shape a custom window makes.
  const series = monthsTo("2026-12", 12, (index) =>
    index >= 7 && index <= 9 ? { income: 500000, spent: 260000 } : {}
  );

  const { container } = render(
    <CashflowChart
      series={series}
      coverageStartPeriod="2026-08"
      coverageEndPeriod="2026-10"
    />
  );

  // One run, three points. A line drawn across the empty columns would be the
  // claim that the household broke even in months nobody recorded or has lived.
  const runs = [...container.querySelectorAll("polyline")];
  expect(runs).toHaveLength(1);
  expect(runs[0].getAttribute("points").trim().split(/\s+/)).toHaveLength(3);

  // And the end label sits on the last month the line reaches, not on the last
  // column — a figure floating past the end of a broken line would name the one
  // month the line declined to describe.
  const label = screen.getByText("$2.4K");
  const dot = container.querySelector("circle");
  expect(Number(label.getAttribute("y"))).toBeCloseTo(Number(dot.getAttribute("cy")), 5);
  const lastRunPoint = runs[0].getAttribute("points").trim().split(/\s+/).pop();
  expect(Number(lastRunPoint.split(",")[0])).toBeCloseTo(Number(dot.getAttribute("cx")), 5);
});

test("with no coverage stated the line spans every month, as it always did", () => {
  const series = monthsTo("2026-08", 6, () => ({ income: 500000, spent: 260000 }));

  const { container } = draw(series);

  const runs = [...container.querySelectorAll("polyline")];
  expect(runs).toHaveLength(1);
  expect(runs[0].getAttribute("points").trim().split(/\s+/)).toHaveLength(6);
});
