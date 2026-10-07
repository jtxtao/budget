import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AppProviders from "../contexts/AppProviders";
import RetirementPage from "./RetirementPage";
import { routerFuture } from "../routerFuture";
import { currentPeriod } from "../utils";

/**
 * The retirement page through the real stores, as the dashboard and net-worth
 * tests are.
 *
 * The maths has its own test — `useRetirementProjection.test.js` drives the pure
 * function directly. What is worth pinning down here is the wiring the maths
 * cannot see: that the starting point really is the accounts the user ticked, at
 * the values the net-worth page gives them; that seventy percent really is
 * seventy percent of the income sources on the budget plan; and that a figure
 * typed over a seeded one takes over from it without the seed leaking back.
 */
const PERIOD = currentPeriod();

const account = (id, name, scope, openingBalanceCents, assetClass = "Cash") => ({
  id,
  name,
  type: "asset",
  scope,
  assetClass,
  openingBalanceCents,
  openingDate: null,
  reconciledOn: null,
});

function seed(overrides = {}) {
  const data = {
    accounts: [
      account("acc1", "Everyday", "on-budget", 500000),
      account("acc2", "401(k)", "off-budget", 20000000, "Stocks"),
      account("acc3", "Brokerage", "off-budget", 10000000, "Stocks"),
    ],
    // $8,000 a month expected, so a year is $96,000 and seventy percent of it
    // is $67,200 — a figure with no rounding in it, so a wrong share is visible
    // rather than plausible.
    incomeSources: [{ id: "inc1", name: "Salary", amountCents: 800000, cadence: "monthly" }],
    budgetGroups: [{ id: "g1", name: "Future", bucket: "retirement" }],
    budgets: [
      { id: "b1", name: "Retirement", groupId: "g1", plannedCents: 100000, bucket: "retirement" },
      { id: "b2", name: "Groceries", groupId: null, plannedCents: 60000, bucket: "essentials" },
    ],
    assignments: [],
    transactions: [],
    ...overrides,
  };

  for (const [key, value] of Object.entries(data)) {
    localStorage.setItem(key, JSON.stringify(value));
  }
}

function renderPage() {
  return render(
    <AppProviders>
      <MemoryRouter future={routerFuture}>
        <RetirementPage />
      </MemoryRouter>
    </AppProviders>
  );
}

/** Fill a blur-committed field the way the panels expect it to be filled. */
function type(label, value) {
  const field = screen.getByLabelText(label);
  fireEvent.change(field, { target: { value } });
  fireEvent.blur(field);
}

/** A plan the projection can answer, so the assertions are about wiring. */
function statePlan({ age = 40, retireAt = 65 } = {}) {
  type("Age today", String(age));
  type("Retire at", String(retireAt));
}

const outlook = () => screen.getByRole("region", { name: "Retirement outlook" });

/**
 * The value beside a named figure in the outlook.
 *
 * Found by its term's text rather than by role and name: a `<dt>` does not take
 * its accessible name from its own content, so there is nothing to match on.
 * Scoped to the outlook because most of these labels also name an input further
 * down the page — which is the point, the figure and the field that sets it say
 * the same thing.
 */
const figure = (label) =>
  within(outlook()).getByText(label).nextElementSibling.textContent;

beforeEach(() => localStorage.clear());

describe("a plan that cannot be answered yet", () => {
  test("asks for what is missing instead of drawing a chart of nothing", () => {
    seed();
    renderPage();

    expect(within(outlook()).getByText("Enter your age today.")).toBeInTheDocument();
    expect(within(outlook()).getByText("Enter the age you want to retire.")).toBeInTheDocument();
    expect(screen.queryByText("Year by year")).not.toBeInTheDocument();
  });

  test("the assumptions are reachable before the projection is", () => {
    seed();
    renderPage();

    // The panel that fixes the problem has to be on screen while the problem is
    // — a page that hid its inputs until it had a projection could never get one.
    expect(screen.getByLabelText("Age today")).toBeInTheDocument();
    expect(screen.getByLabelText("Retire at")).toBeInTheDocument();
  });
});

describe("the starting point", () => {
  test("is the accounts that are ticked, and nothing until one is", () => {
    seed();
    renderPage();
    statePlan();

    expect(figure("Starting from")).toBe("$0");

    fireEvent.click(screen.getByRole("checkbox", { name: "401(k)" }));
    expect(figure("Starting from")).toBe("$200,000");

    fireEvent.click(screen.getByRole("checkbox", { name: "Brokerage" }));
    expect(figure("Starting from")).toBe("$300,000");
  });

  test("counts an everyday account too, if that is what the user says", () => {
    seed();
    renderPage();
    statePlan();

    fireEvent.click(screen.getByRole("checkbox", { name: "Everyday" }));
    expect(figure("Starting from")).toBe("$5,000");
  });

  test("unticking one takes it back out", () => {
    seed();
    renderPage();
    statePlan();

    const holding = screen.getByRole("checkbox", { name: "401(k)" });
    fireEvent.click(holding);
    fireEvent.click(holding);

    expect(figure("Starting from")).toBe("$0");
  });

  test("a typed figure replaces the accounts without clearing them", () => {
    seed();
    renderPage();
    statePlan();
    fireEvent.click(screen.getByRole("checkbox", { name: "401(k)" }));

    fireEvent.click(screen.getByRole("radio", { name: "A balance I enter" }));
    type("Starting balance", "250000");
    expect(figure("Starting from")).toBe("$250,000");

    // Back again: the ticks are still there. A toggle that destroyed the answer
    // it toggled away from could only be used once.
    fireEvent.click(screen.getByRole("radio", { name: "The accounts I tick" }));
    expect(figure("Starting from")).toBe("$200,000");
    expect(screen.getByRole("checkbox", { name: "401(k)" })).toBeChecked();
  });

  test("a hand-entered valuation is what the plan counts, not the opening balance", () => {
    seed({
      accountBalances: [
        { id: "bal1", accountId: "acc2", period: PERIOD, amountCents: 27500000 },
      ],
    });
    renderPage();
    statePlan();

    fireEvent.click(screen.getByRole("checkbox", { name: "401(k)" }));
    expect(figure("Starting from")).toBe("$275,000");
  });
});

describe("what retirement costs", () => {
  test("defaults to seventy percent of the income the plan expects", () => {
    seed();
    renderPage();
    statePlan();

    // $96,000 a year of expected income, so seventy percent is $67,200.
    expect(figure("Yearly spending")).toBe("$67,200");
  });

  test("the share is the user's to change", () => {
    seed();
    renderPage();
    statePlan();

    type("Share of income", "50");
    expect(figure("Yearly spending")).toBe("$48,000");
  });

  test("or replaced with a figure of their own", () => {
    seed();
    renderPage();
    statePlan();

    fireEvent.click(screen.getByRole("radio", { name: "A yearly figure I enter" }));
    type("Yearly spending", "40000");

    expect(figure("Yearly spending")).toBe("$40,000");
  });

  test("with no income sources it asks for one rather than planning on nothing", () => {
    seed({ incomeSources: [] });
    renderPage();
    statePlan();

    expect(
      within(outlook()).getByText("Say what you expect retirement to cost each year.")
    ).toBeInTheDocument();
  });
});

describe("what is being put away", () => {
  test("comes from the retirement categories until it is overridden", () => {
    seed();
    renderPage();
    statePlan();

    // $1,000 a month in the one retirement category.
    expect(figure("Saving each year")).toBe("$12,000");

    type("Saving each year", "20000");
    expect(figure("Saving each year")).toBe("$20,000");
  });

  test("clearing the override goes back to the budget's own figure", () => {
    seed();
    renderPage();
    statePlan();

    type("Saving each year", "20000");
    type("Saving each year", "");

    expect(figure("Saving each year")).toBe("$12,000");
  });

  test("pretax contributions add to the retirement categories rather than replacing them", () => {
    seed();
    renderPage();
    statePlan();

    // $1,000 a month from the budget, plus a $6,000 payroll deduction that
    // never touches a category — the two have to add, not override each other.
    type("Pretax contributions", "6000");
    expect(figure("Saving each year")).toBe("$18,000");
  });

  test("an override still replaces the combined total, not just the after-tax half", () => {
    seed();
    renderPage();
    statePlan();

    type("Pretax contributions", "6000");
    type("Saving each year", "20000");

    expect(figure("Saving each year")).toBe("$20,000");

    type("Saving each year", "");
    expect(figure("Saving each year")).toBe("$18,000");
  });
});

describe("the projection", () => {
  test("draws the years once it has enough to answer", () => {
    seed();
    renderPage();
    statePlan();
    fireEvent.click(screen.getByRole("checkbox", { name: "401(k)" }));

    expect(screen.getByText("Year by year")).toBeInTheDocument();
    // The table twin carries every figure the chart draws, one row per year of
    // the plan, both ends inclusive. Scoped to that table: the account picker
    // below is a table of row headers too.
    const years = screen.getByText("Show these figures as a table").closest("details");
    fireEvent.click(screen.getByText("Show these figures as a table"));
    expect(within(years).getAllByRole("rowheader")).toHaveLength(90 - 40 + 1);
  });

  test("names the age the money runs out when it does", () => {
    seed();
    renderPage();
    statePlan();

    // Nothing saved, nothing being put away, and a retirement to pay for.
    type("Saving each year", "0");
    expect(figure("Money lasts to")).toBe("age 65");
  });

  test("reports the shortfall and the contribution that would close it", () => {
    seed();
    renderPage();
    statePlan();

    expect(figure("Short by")).not.toBe("$0");
    expect(within(outlook()).getByText(/would close the gap/)).toBeInTheDocument();
  });

  test("a plan that is already there says so instead", () => {
    seed();
    renderPage();
    statePlan();
    fireEvent.click(screen.getByRole("checkbox", { name: "401(k)" }));
    type("Saving each year", "100000");

    expect(within(outlook()).getByText(/On course/)).toBeInTheDocument();
  });
});

describe("rejected input", () => {
  test("stays on screen with the reason, and changes nothing", () => {
    seed();
    renderPage();
    statePlan();

    type("Age today", "500");

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter your age today as a whole number of years, 0 to 120."
    );
    // The projection is still the one built from the age that was accepted.
    expect(screen.getByText("Year by year")).toBeInTheDocument();
  });

  test("a bad rate is refused the same way", () => {
    seed();
    renderPage();
    statePlan();

    // A number the field will actually hold — a number input in jsdom, as in a
    // browser, simply refuses to carry "over nine thousand", so junk never
    // reaches the store from this direction at all.
    type("Return while saving", "80");

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter the return while you are saving as a percentage between 0 and 50."
    );
  });
});

test("resetting puts the plan back to its defaults", () => {
  seed();
  renderPage();
  statePlan();

  fireEvent.click(screen.getByRole("button", { name: "Reset plan" }));

  expect(within(outlook()).getByText("Enter your age today.")).toBeInTheDocument();
  // Text fields, not number ones: a rate is written "7%" as often as "7", and a
  // number input refuses the sign outright.
  expect(screen.getByLabelText("Share of income")).toHaveValue("70");
  // The rates are nominal, and the pair is chosen so what comes out the other
  // side is the 7% and 3% real a planner actually means. Pinned here because
  // the two are only defensible together — changing one without the other
  // quietly moves the target.
  expect(screen.getByLabelText("Return while saving")).toHaveValue("10");
  expect(screen.getByLabelText("Return once retired")).toHaveValue("5.5");
  expect(screen.getByLabelText("Inflation")).toHaveValue("2.5");
  expect(screen.getByText(/7\.32% a year after inflation/)).toBeInTheDocument();
  expect(screen.getByText(/2\.93% a year after inflation/)).toBeInTheDocument();
});

describe("net worth by age", () => {
  const projectionRegion = () => screen.getByRole("region", { name: "Net worth by age" });
  const assumptions = () => screen.getByRole("region", { name: "Net worth assumptions" });
  const projected = (label) =>
    within(projectionRegion()).getByText(label).nextElementSibling.textContent;
  const mortgage = {
    id: "acc4",
    name: "Mortgage",
    type: "liability",
    scope: "off-budget",
    assetClass: "Other",
    openingBalanceCents: -12000000,
    openingDate: null,
    reconciledOn: null,
  };

  test("starts from the net worth on the books today", () => {
    seed();
    renderPage();
    statePlan({ age: 40, retireAt: 40 });

    // $5,000 + $200,000 + $100,000, with nothing else to it.
    expect(projected("At 40")).toBe("$305,000");
  });

  test("a salary is added, refused when it clashes, and kept across the income switch", () => {
    seed();
    renderPage();
    statePlan();

    fireEvent.click(within(assumptions()).getByLabelText("Gross salaries I enter by age"));
    const add = (age, gross) => {
      fireEvent.change(within(assumptions()).getByLabelText("Starting at age"), {
        target: { value: age },
      });
      fireEvent.change(within(assumptions()).getByLabelText("Gross salary a year"), {
        target: { value: gross },
      });
      fireEvent.click(within(assumptions()).getByRole("button", { name: "Add salary" }));
    };

    add("45", "$150,000");
    expect(within(assumptions()).getByLabelText("Salary from age 45, gross a year")).toHaveValue(
      "$150,000"
    );

    add("45", "$90,000");
    expect(within(assumptions()).getByRole("alert")).toHaveTextContent(
      "There is already a salary starting at 45."
    );
    // The refused row keeps what was typed, to be corrected.
    expect(within(assumptions()).getByLabelText("Gross salary a year")).toHaveValue("$90,000");

    fireEvent.click(within(assumptions()).getByLabelText("Today's take-home, rising by a rate"));
    expect(within(assumptions()).getByLabelText("Pay rises each year")).toHaveValue("3");
    fireEvent.click(within(assumptions()).getByLabelText("Gross salaries I enter by age"));
    expect(
      within(assumptions()).getByLabelText("Salary from age 45, gross a year")
    ).toBeInTheDocument();
  });

  test("a debt is walked at the rate and payment it is given", () => {
    seed({
      accounts: [
        account("acc1", "Everyday", "on-budget", 500000),
        mortgage,
      ],
      // The payment lives in the budget, as the projection expects it to.
      budgets: [{ id: "b2", name: "Mortgage", groupId: null, plannedCents: 100000, bucket: "essentials" }],
    });
    renderPage();
    statePlan();

    expect(within(assumptions()).getByText("$120,000 owed")).toBeInTheDocument();
    type("Mortgage interest rate", "0");
    type("Mortgage monthly payment", "$1,000");

    // $12,000 a year against $120,000, at no interest: ten years.
    expect(within(projectionRegion()).getByText("Mortgage is paid off at 49.")).toBeInTheDocument();
  });
});

describe("life events", () => {
  const events = () => screen.getByRole("region", { name: "Life events" });
  const dialog = () => screen.getByRole("dialog");
  const atAge = (label) =>
    within(screen.getByRole("region", { name: "Net worth by age" })).getByText(label)
      .nextElementSibling.textContent;
  const money = (text) => Number(text.replace(/[^0-9.-]/g, ""));

  function stateRetiredPlan() {
    // Retiring at 40 with nothing coming in, so every dollar an event moves is
    // visible in what is left at the end.
    seed();
    renderPage();
    statePlan({ age: 40, retireAt: 41 });
  }

  test("a template seeds the form, and nothing lands until it is saved", () => {
    seed();
    renderPage();
    statePlan();
    const before = money(atAge("At 65"));

    fireEvent.click(within(events()).getByRole("button", { name: "Wedding" }));
    expect(within(dialog()).getByLabelText("Name")).toHaveValue("Wedding");
    expect(within(dialog()).getByLabelText("Once, in the first year")).toHaveValue("30000.00");
    expect(within(events()).getByText(/Nothing planned yet/)).toBeInTheDocument();

    fireEvent.click(within(dialog()).getByRole("button", { name: "Add event" }));
    expect(within(events()).getByRole("checkbox", { name: "Include Wedding" })).toBeChecked();
    expect(within(events()).getByText("Out: $30,000 once")).toBeInTheDocument();
    expect(money(atAge("At 65"))).toBeLessThan(before);
  });

  test("unticking an event leaves it in the list and out of the projection", () => {
    seed();
    renderPage();
    statePlan();
    const before = atAge("At 65");
    fireEvent.click(within(events()).getByRole("button", { name: "Wedding" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Add event" }));

    fireEvent.click(within(events()).getByRole("checkbox", { name: "Include Wedding" }));
    expect(within(events()).getByRole("checkbox", { name: "Include Wedding" })).not.toBeChecked();
    expect(atAge("At 65")).toBe(before);
  });

  test("an event is edited in place, and a refused edit keeps the form open", () => {
    stateRetiredPlan();
    fireEvent.click(within(events()).getByRole("button", { name: "Childcare" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Add event" }));
    expect(within(events()).getByText("Out: $18,000 a year")).toBeInTheDocument();

    fireEvent.click(within(events()).getByRole("button", { name: "Edit Childcare" }));
    fireEvent.change(within(dialog()).getByLabelText("Every year it runs"), {
      target: { value: "twelve thousand" },
    });
    fireEvent.click(within(dialog()).getByRole("button", { name: "Save" }));
    expect(within(dialog()).getByRole("alert")).toHaveTextContent(
      "Enter the yearly amount as an amount of zero or more."
    );

    fireEvent.change(within(dialog()).getByLabelText("Every year it runs"), {
      target: { value: "$12,000" },
    });
    fireEvent.click(within(dialog()).getByRole("button", { name: "Save" }));
    expect(within(events()).getByText("Out: $12,000 a year")).toBeInTheDocument();
  });

  test("income in retirement makes the money last longer", () => {
    stateRetiredPlan();
    // The plan runs short: $305,000 against $67,200 a year.
    const before = money(atAge("First year short"));
    fireEvent.click(within(events()).getByRole("button", { name: "Pension" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Add event" }));
    expect(money(atAge("First year short"))).toBeGreaterThan(before);
  });

  test("a savings goal seeds an event with its target", () => {
    seed({
      savingsGoals: [{ id: "g1", name: "Honeymoon", targetCents: 800000, targetDate: null }],
    });
    renderPage();
    statePlan();

    fireEvent.click(within(events()).getByRole("button", { name: "From the savings goal Honeymoon" }));
    expect(within(dialog()).getByLabelText("Name")).toHaveValue("Honeymoon");
    expect(within(dialog()).getByLabelText("Once, in the first year")).toHaveValue("8000.00");
    expect(within(dialog()).getByLabelText("Starts at age")).toHaveValue(41);
  });

  test("a stored event that cannot be read is dropped, and a readable one keeps its fields", () => {
    seed({
      lifeEvents: [
        { id: "e1", name: "Sabbatical", kind: "income-change", startAge: 50, years: 1, keptShareBps: 0, enabled: false },
        { id: "e2", name: "Mystery", kind: "lottery", startAge: 45 },
        { id: "e3", name: "No age", kind: "expense", oneTimeCents: 100 },
      ],
    });
    renderPage();
    statePlan();

    expect(within(events()).getByRole("checkbox", { name: "Include Sabbatical" })).not.toBeChecked();
    expect(within(events()).getByText("No pay")).toBeInTheDocument();
    expect(within(events()).queryByText("Mystery")).not.toBeInTheDocument();
    expect(within(events()).queryByText("No age")).not.toBeInTheDocument();
  });
});
