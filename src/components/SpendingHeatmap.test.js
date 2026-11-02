import { levelFor, quartileThresholds } from "./SpendingHeatmap";

/**
 * The shading rule, pinned as a rule rather than as colours: four steps by the
 * quartiles of the days that cost something, so one large day cannot wash every
 * other day out to the faintest step.
 */
test("thresholds are the quartiles of the days that cost something", () => {
  expect(quartileThresholds([0, -500, 100, 200, 300, 400])).toEqual([200, 300, 400]);
  expect(quartileThresholds([0, -100])).toBeNull();
});

test("one huge day does not wash the rest out", () => {
  const days = [1000, 1100, 1200, 1300, 1400, 1500, 1600, 250000];
  const thresholds = quartileThresholds(days);

  expect(levelFor(250000, thresholds)).toBe(4);
  expect(levelFor(1000, thresholds)).toBe(1);
  // A middling day sits mid-scale rather than at the bottom with everything else.
  expect(levelFor(1400, thresholds)).toBe(3);
});

test("a day that cost nothing, or was refunded more than it cost, is the empty step", () => {
  const thresholds = quartileThresholds([100, 200, 300]);
  expect(levelFor(0, thresholds)).toBe(0);
  expect(levelFor(-50, thresholds)).toBe(0);
  expect(levelFor(500, null)).toBe(0);
});
