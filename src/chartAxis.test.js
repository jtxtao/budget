import { lineRuns, movingAverage } from "./chartAxis";

/**
 * The two pieces of the chart arithmetic that have a rule rather than only a
 * shape, driven as the pure functions they are.
 *
 * The rest of `chartAxis` is asserted through the charts that draw with it —
 * `NetWorthChart.test.js` and `CashflowChart.test.js` both read coordinates off
 * real paths, which is the only place a tick or a stack is visible. These two
 * are different: what matters about them is *where they refuse to answer*, and
 * a null is invisible in a rendered path.
 */

describe("movingAverage", () => {
  test("the head is null until the window fills, rather than an average of what is there so far", () => {
    // The first two months have fewer than three months behind them. Averaging
    // one month and calling it a three-month average draws a line that traces
    // the data and then peels away from it, which reads as the trend changing
    // when all that changed is the divisor.
    expect(movingAverage([100, 200, 300, 400], 3)).toEqual([null, null, 200, 300]);
  });

  test("is trailing, so the most recent month — the one being read — always has a value", () => {
    const trend = movingAverage([0, 0, 0, 300, 300, 300], 3);

    expect(trend[trend.length - 1]).toBe(300);
    // A centred average would have nothing to say about either end, and the
    // right-hand end is the month the reader came for.
    expect(trend[trend.length - 2]).toBe(200);
  });

  test("rounds to whole cents, because a fraction of a cent is not money", () => {
    expect(movingAverage([100, 101, 101], 3)).toEqual([null, null, 101]);
  });

  test("a window longer than the data is all nulls rather than a single flat point", () => {
    expect(movingAverage([100, 200], 3)).toEqual([null, null]);
  });

  test("a window of one is the data, and a window of none is nothing", () => {
    expect(movingAverage([100, 200], 1)).toEqual([100, 200]);
    expect(movingAverage([100, 200], 0)).toEqual([null, null]);
  });

  test("negative figures average like any others — a refunded month is not a gap", () => {
    expect(movingAverage([300, -300, 300], 3)).toEqual([null, null, 100]);
  });
});

describe("lineRuns", () => {
  const x = (index) => index * 10;
  const y = (value) => 100 - value;

  test("breaks the line across a gap rather than spanning it", () => {
    // A straight segment drawn over missing months asserts a reading nobody
    // took — the same lie `useNetWorth` refuses when it will not propagate a
    // snapshot backwards.
    const runs = lineRuns([10, 20, null, 40, 50], { x, y });

    expect(runs).toHaveLength(2);
    expect(runs[0]).toBe("0,90 10,80");
    expect(runs[1]).toBe("30,60 40,50");
  });

  test("a run of one point draws nothing, because a polyline of one point is not a line", () => {
    expect(lineRuns([10, null, 30, null, 50], { x, y })).toEqual([]);
  });

  test("an unbroken series is one run", () => {
    expect(lineRuns([10, 20, 30], { x, y })).toEqual(["0,90 10,80 20,70"]);
  });

  test("leading nulls — a moving average's own head — do not shift the indices under the line", () => {
    const runs = lineRuns([null, null, 30, 40], { x, y });

    // The run starts at index 2, so it is drawn under the third column rather
    // than under the first.
    expect(runs).toEqual(["20,70 30,60"]);
  });

  test("nothing at all comes back as no runs rather than as an empty string", () => {
    expect(lineRuns([], { x, y })).toEqual([]);
    expect(lineRuns([null, null], { x, y })).toEqual([]);
  });
});
