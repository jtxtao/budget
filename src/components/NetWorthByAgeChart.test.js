import { fireEvent, render, screen } from "@testing-library/react";
import NetWorthByAgeChart from "./NetWorthByAgeChart";

/**
 * The chart on its own, from props — what the `NetWorthChart` suite asserts of
 * that chart, asked of this one: no coordinate is ever NaN, a debt draws below
 * the baseline (readable only off the paths), an event year carries a marker
 * and says what it is, and focus opens the same read-out the pointer does.
 */

const point = (age, fields = {}) => ({
  age,
  phase: age < 65 ? "saving" : "retired",
  cashCents: 0,
  investedCents: 0,
  retirementCents: 0,
  propertyCents: 0,
  debtCents: 0,
  netCents: 0,
  events: [],
  ...fields,
});

function series() {
  return Array.from({ length: 31 }, (_, index) => {
    const age = 60 + index;
    const owned = 100_000_00 + index * 10_000_00;
    const debt = age < 70 ? 50_000_00 : 0;
    return point(age, {
      cashCents: 20_000_00,
      retirementCents: owned,
      propertyCents: 300_000_00,
      debtCents: debt,
      netCents: 20_000_00 + owned + 300_000_00 - debt,
      events: [
        ...(age === 62 ? ["Wedding"] : []),
        ...(age >= 67 ? ["Social Security"] : []),
        ...(age === 67 ? ["Downsize"] : []),
      ],
    });
  });
}

const allPaths = (container) => [...container.querySelectorAll("path")];
const coordinates = (d) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

test("no coordinate is NaN", () => {
  const { container } = render(<NetWorthByAgeChart series={series()} retirementAge={65} />);
  for (const path of allPaths(container)) {
    expect(path.getAttribute("d")).not.toMatch(/NaN/);
  }
  expect(container.querySelector("polyline").getAttribute("points")).not.toMatch(/NaN/);
});

test("a debt is drawn below the baseline", () => {
  const { container } = render(<NetWorthByAgeChart series={series()} retirementAge={65} />);
  const zero = [...container.querySelectorAll("line")].find((line) =>
    line.getAttribute("class").includes("stroke-chalk-soft")
  );
  const baseline = Number(zero.getAttribute("y1"));
  const debt = allPaths(container).filter((path) =>
    path.getAttribute("class")?.includes("fill-vermilion")
  );
  expect(debt.length).toBe(10);
  for (const path of debt) {
    const ys = coordinates(path.getAttribute("d")).filter((_, index) => index % 2 === 1);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(baseline - 0.01);
  }
});

test("the year an event begins carries a marker, and every year names its events", () => {
  render(<NetWorthByAgeChart series={series()} retirementAge={65} />);
  expect(screen.getAllByTestId("event-marker")).toHaveLength(2);
  expect(screen.getByRole("img", { name: /^Age 67: .*; Social Security, Downsize$/ })).toBeInTheDocument();
  // Running every year from 67 is still named at 80, without a marker of its own.
  expect(screen.getByRole("img", { name: /^Age 80: .*; Social Security$/ })).toBeInTheDocument();
});

test("focus opens the read-out, and the arrows walk the years from one tab stop", () => {
  render(<NetWorthByAgeChart series={series()} retirementAge={65} />);
  const years = screen.getAllByRole("img");
  expect(years.filter((year) => year.getAttribute("tabindex") === "0")).toHaveLength(1);

  const at62 = screen.getByRole("img", { name: /^Age 62:/ });
  fireEvent.focusIn(at62);
  expect(screen.getByText("Age 62 · working")).toBeInTheDocument();
  expect(screen.getByText("Wedding")).toBeInTheDocument();

  fireEvent.keyDown(at62, { key: "ArrowRight" });
  expect(document.activeElement).toBe(screen.getByRole("img", { name: /^Age 63:/ }));
});

test("the retirement age is marked", () => {
  render(<NetWorthByAgeChart series={series()} retirementAge={65} />);
  expect(screen.getByText("RETIRE AT 65")).toBeInTheDocument();
});

test("a plan worth nothing draws nothing rather than dividing by an empty domain", () => {
  const { container } = render(
    <NetWorthByAgeChart series={[point(60), point(61), point(62)]} retirementAge={61} />
  );
  expect(allPaths(container)).toHaveLength(0);
  expect(container.innerHTML).not.toMatch(/NaN/);
});
