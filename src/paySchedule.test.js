import {
  cadenceForDays,
  describeSchedule,
  isScheduleConfigured,
  nextPayday,
  payDayLabel,
  payDaysFor,
} from "./paySchedule";

/**
 * The calendar arithmetic, driven as the pure function it is — no providers and
 * no React, the same way the retirement projection is tested.
 *
 * Every date here is a real day in 2026 and the weekday matters, so they are
 * written out rather than derived from today: the whole point of the monthdays
 * family is that the 15th is not always the 15th.
 */

const schedule = (fields) => ({
  cadence: null,
  lastPaidOn: null,
  periodDays: null,
  daysOfMonth: [],
  ...fields,
});

const semimonthly = (daysOfMonth) => schedule({ cadence: "semimonthly", daysOfMonth });
const monthly = (day) => schedule({ cadence: "monthly", daysOfMonth: [day] });

describe("interval cadences", () => {
  test("a fortnight steps from the payday the user recorded", () => {
    const fortnightly = schedule({ cadence: "biweekly", lastPaidOn: "2026-08-07" });

    expect(nextPayday(fortnightly, "2026-08-13").nextDate).toBe("2026-08-21");
    expect(nextPayday(fortnightly, "2026-08-13").previousDate).toBe("2026-08-07");
  });

  test("today's pay recorded today points at the next one, not at today", () => {
    const weekly = schedule({ cadence: "weekly", lastPaidOn: "2026-08-13" });

    expect(nextPayday(weekly, "2026-08-13").nextDate).toBe("2026-08-20");
  });

  test("a schedule left un-updated for months still rolls forward", () => {
    const fortnightly = schedule({ cadence: "biweekly", lastPaidOn: "2026-01-02" });
    const { nextDate, previousDate } = nextPayday(fortnightly, "2026-08-13");

    expect(nextDate >= "2026-08-13").toBe(true);
    expect(previousDate < "2026-08-13").toBe(true);
    // Every payday is the same weekday as the one it was stepped from, which is
    // why the interval family needs no weekend rule.
    expect(new Date(`${nextDate}T00:00:00`).getDay()).toBe(5);
  });

  test("a custom interval takes its length from the record", () => {
    const tenDaily = schedule({ cadence: "custom", periodDays: 10, lastPaidOn: "2026-08-10" });

    expect(nextPayday(tenDaily, "2026-08-13").nextDate).toBe("2026-08-20");
    // A custom cadence with no length stated runs on the default its field
    // shows, rather than on nothing.
    const unstated = schedule({ cadence: "custom", lastPaidOn: "2026-08-10" });
    expect(isScheduleConfigured(unstated)).toBe(true);
    expect(nextPayday(unstated, "2026-08-13").nextDate).toBe("2026-08-20");
  });
});

describe("twice a month", () => {
  test("a payday on a Saturday is paid the Friday before", () => {
    // Aug 15 2026 is a Saturday; Aug 31 is a Monday and stands.
    expect(nextPayday(semimonthly([15, 31]), "2026-08-13").nextDate).toBe("2026-08-14");
    expect(nextPayday(semimonthly([15, 31]), "2026-08-15").nextDate).toBe("2026-08-31");
  });

  test("31 means the last day of the month, whatever the month is", () => {
    // Feb 2026 has 28 days, and the 28th is a Saturday.
    expect(nextPayday(semimonthly([15, 31]), "2026-02-20").nextDate).toBe("2026-02-27");
    // The 15th is a Sunday that February, so the first payday of the month is
    // the Friday the 13th.
    expect(nextPayday(semimonthly([15, 31]), "2026-02-01").nextDate).toBe("2026-02-13");
  });

  test("a payday on the 1st can land in the month before", () => {
    // Nov 1 2026 is a Sunday, so November's pay arrives on Friday Oct 30 — a
    // month's paydays are not all inside it, which is why the search window
    // starts a month early.
    expect(nextPayday(monthly(1), "2026-10-15").nextDate).toBe("2026-10-30");
    expect(nextPayday(monthly(1), "2026-10-30").nextDate).toBe("2026-10-30");
    expect(nextPayday(monthly(1), "2026-10-31").nextDate).toBe("2026-12-01");
  });

  test("two days that clamp onto the same date are one payday", () => {
    // The 30th and the 31st both clamp to Feb 28, a Saturday, and both shift to
    // Friday the 27th.
    const { nextDate, previousDate } = nextPayday(semimonthly([30, 31]), "2026-02-20");

    expect(nextDate).toBe("2026-02-27");
    expect(previousDate).toBe("2026-01-30");
  });

  test("the last day of a month it does not reach is still the last day", () => {
    // May 31 2026 is a Sunday, so a monthly last-day schedule pays on Friday 29.
    expect(nextPayday(monthly(31), "2026-05-20").nextDate).toBe("2026-05-29");
  });

  test("a day left blank means the default its field shows", () => {
    // The 15th and the last day — the figures shown in grey.
    expect(payDaysFor(semimonthly([]))).toEqual([15, 31]);
    expect(payDaysFor(semimonthly([1, null]))).toEqual([1, 31]);
    expect(isScheduleConfigured(semimonthly([]))).toBe(true);
    expect(nextPayday(semimonthly([]), "2026-08-15").nextDate).toBe("2026-08-31");
  });

  test("the day a monthly cadence does not use is kept, not cleared", () => {
    const both = schedule({ cadence: "monthly", daysOfMonth: [15, 31] });

    expect(payDaysFor(both)).toEqual([15]);
    expect(nextPayday(both, "2026-08-13").nextDate).toBe("2026-08-14");
    // And it is still there when the user switches back.
    expect(payDaysFor({ ...both, cadence: "semimonthly" })).toEqual([15, 31]);
  });
});

describe("saying what the schedule is", () => {
  test("in words", () => {
    expect(describeSchedule(schedule({ cadence: "weekly" }))).toBe("every week");
    expect(describeSchedule(schedule({ cadence: "biweekly" }))).toBe("every 2 weeks");
    expect(describeSchedule(schedule({ cadence: "custom", periodDays: 10 }))).toBe("every 10 days");
    expect(describeSchedule(semimonthly([15, 31]))).toBe("on the 15th and the last day");
    expect(describeSchedule(monthly(1))).toBe("on the 1st");
    expect(describeSchedule(schedule({}))).toBe("");
  });

  test("ordinals, and the sentinel that is not one", () => {
    expect(payDayLabel(1)).toBe("1st");
    expect(payDayLabel(2)).toBe("2nd");
    expect(payDayLabel(3)).toBe("3rd");
    expect(payDayLabel(11)).toBe("11th");
    expect(payDayLabel(22)).toBe("22nd");
    expect(payDayLabel(31)).toBe("last day");
  });

  test("a bare day count names its own cadence", () => {
    expect(cadenceForDays(7)).toBe("weekly");
    expect(cadenceForDays(14)).toBe("biweekly");
    expect(cadenceForDays(10)).toBe("custom");
  });
});
