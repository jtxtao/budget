import { fireEvent, render, screen } from "@testing-library/react";
import ScenarioCompareChart from "./ScenarioCompareChart";

/**
 * The comparison chart from props: one line per plan in its own colour, no NaN
 * anywhere, plans of different lengths on one age axis, and a read-out that
 * names every plan — so no line is identified by its colour alone.
 */

const series = (from, to, perYear) =>
  Array.from({ length: to - from + 1 }, (_, index) => ({
    age: from + index,
    netCents: 100_000_00 + index * perYear,
  }));

const lines = [
  { key: "current", label: "Current plan", slot: null, series: series(40, 90, 20_000_00) },
  { key: "a", label: "Buy at 35", slot: 0, series: series(40, 90, 15_000_00) },
  { key: "b", label: "Retire early", slot: 2, series: series(40, 85, -1_000_00) },
];

test("one line per plan, each in the colour of its slot, with no NaN", () => {
  const { container } = render(<ScenarioCompareChart lines={lines} />);
  expect(screen.getByTestId("line-current").getAttribute("class")).toContain("stroke-chalk");
  expect(screen.getByTestId("line-a").getAttribute("class")).toContain("stroke-azure");
  expect(screen.getByTestId("line-b").getAttribute("class")).toContain("stroke-verdant");
  expect(container.innerHTML).not.toMatch(/NaN/);
});

test("the read-out names every plan, and says so where one has no figure", () => {
  render(<ScenarioCompareChart lines={lines} />);
  const at88 = screen.getByRole("img", { name: /^Age 88:/ });
  expect(at88.getAttribute("aria-label")).toMatch(/Retire early no figure/);
  fireEvent.focusIn(at88);
  expect(screen.getByText("Age 88")).toBeInTheDocument();
  expect(screen.getAllByText("Buy at 35").length).toBeGreaterThan(1);
});

test("one tab stop, and the arrows walk the ages", () => {
  render(<ScenarioCompareChart lines={lines} />);
  const years = screen.getAllByRole("img");
  expect(years.filter((year) => year.getAttribute("tabindex") === "0")).toHaveLength(1);
  const at50 = screen.getByRole("img", { name: /^Age 50:/ });
  fireEvent.keyDown(at50, { key: "ArrowLeft" });
  expect(document.activeElement).toBe(screen.getByRole("img", { name: /^Age 49:/ }));
});
