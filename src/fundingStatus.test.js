import { FUNDING, fundingStatus } from "./fundingStatus";

/**
 * The rule as the pure function it is. Every case names its figures in cents
 * and the reading they should give, because the thresholds are the whole of it.
 */
const read = (row) => fundingStatus({ goalCents: null, activityCents: 0, ...row });

test("below zero is overspent whatever else is true, short by the overspend", () => {
  expect(read({ availableCents: -4000, targetCents: 60000, goalCents: 1 })).toEqual({
    status: FUNDING.OVERSPENT,
    shortCents: 4000,
  });
  expect(read({ availableCents: -1, targetCents: 0 }).status).toBe(FUNDING.OVERSPENT);
});

test("short of what the month still asks is underfunded, by the gap", () => {
  // $600 planned, nothing spent, $450 in it.
  expect(read({ availableCents: 45000, targetCents: 60000 })).toEqual({
    status: FUNDING.UNDERFUNDED,
    shortCents: 15000,
  });
  // $600 planned, $400 spent, $100 left: the month still asks $200.
  expect(read({ availableCents: 10000, activityCents: -40000, targetCents: 60000 })).toEqual({
    status: FUNDING.UNDERFUNDED,
    shortCents: 10000,
  });
});

test("covering the rest of the month is on track, even past the estimate", () => {
  expect(read({ availableCents: 60000, targetCents: 60000 }).status).toBe(FUNDING.ON_TRACK);
  // Spent more than planned and still holding money: nothing more is asked.
  expect(read({ availableCents: 500, activityCents: -90000, targetCents: 60000 }).status).toBe(
    FUNDING.ON_TRACK
  );
  // A refund is not spending, so it does not lower what the month asks.
  expect(read({ availableCents: 60000, activityCents: 2000, targetCents: 60000 }).status).toBe(
    FUNDING.ON_TRACK
  );
});

test("a month ahead, or a goal reached, is well funded", () => {
  expect(read({ availableCents: 120000, targetCents: 60000 }).status).toBe(FUNDING.WELL_FUNDED);
  expect(read({ availableCents: 119999, targetCents: 60000 }).status).toBe(FUNDING.ON_TRACK);
  expect(read({ availableCents: 250000, targetCents: 0, goalCents: 250000 }).status).toBe(
    FUNDING.WELL_FUNDED
  );
});

test("with no estimate there is nothing to be short of", () => {
  expect(read({ availableCents: 0, targetCents: 0 })).toEqual({
    status: FUNDING.NO_ESTIMATE,
    shortCents: 0,
  });
  // A goal not yet reached is a category part-way through saving, not a short one.
  expect(read({ availableCents: 1000, targetCents: 0, goalCents: 250000 }).status).toBe(
    FUNDING.NO_ESTIMATE
  );
});
