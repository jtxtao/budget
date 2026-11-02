import { suggestedFunding } from "./fundingTargets";

const row = { plannedCents: 10000, assignedCents: 2000, availableCents: 7000 };

test("monthly funding repeats while refill accounts for carry-in", () => {
  expect(suggestedFunding(row, { targetMode: "monthly" }, "2026-11")).toBe(10000);
  expect(suggestedFunding(row, { targetMode: "refill" }, "2026-11")).toBe(5000);
});

test("deadline spreads the remaining balance through the due month", () => {
  expect(suggestedFunding(row, { targetMode: "deadline", goalCents: 20000, targetDate: "2027-01" }, "2026-11")).toBe(5000);
});
