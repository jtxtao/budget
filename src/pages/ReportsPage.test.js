import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AppProviders from "../contexts/AppProviders";
import ReportsPage from "./ReportsPage";
import { TRANSACTION_KINDS } from "../contexts/TransactionsContext";
import { routerFuture } from "../routerFuture";
import { addMonths, currentPeriod, formatPeriod } from "../utils";

/**
 * The page through the real stores, as with the dashboard and the net-worth
 * page: every figure on it is a join across the ledger and the plan, and mocking
 * the hook would assert only that the mock was wired up.
 *
 * The range control gets driven in several of these, because it is the only
 * control on the page — the custom window's two month fields are that same
 * control's sixth option, not a second one — and everything moves with it
 * together: the headline figures, the columns, the ranking, and the divisor under
 * every per-month figure. A range that moved some of those and not others would
 * look right in a screenshot.
 */
const PERIOD = currentPeriod();
const monthsBack = (count) => addMonths(PERIOD, -count);

const ACCOUNT = {
  id: "acc1",
  name: "Everyday",
  type: "asset",
  scope: "on-budget",
  assetClass: "Cash",
  openingBalanceCents: 0,
  openingDate: null,
  reconciledOn: null,
};

let sequence = 0;
const entry = (kind) => (period, amountCents, budgetId = null) => ({
  id: `t${(sequence += 1)}`,
  kind,
  accountId: ACCOUNT.id,
  budgetId,
  amountCents,
  date: period == null ? null : `${period}-05`,
});
const out = entry(TRANSACTION_KINDS.OUTFLOW);
const inn = entry(TRANSACTION_KINDS.INFLOW);

function seed(data = {}) {
  const file = { accounts: [ACCOUNT], assignments: [], ...data };
  for (const [key, value] of Object.entries(file)) {
    localStorage.setItem(key, JSON.stringify(value));
  }
}

function renderPage() {
  return render(
    <AppProviders>
      <MemoryRouter future={routerFuture}>
        <ReportsPage />
      </MemoryRouter>
    </AppProviders>
  );
}

const summary = () => screen.getByRole("region", { name: "Report summary" });

/** A `<dt>` takes no accessible name from its content, so a tile's figure is
 *  reached through its term's text and the element beside it. */
const tile = (label) =>
  within(summary()).getByText(label).nextElementSibling.textContent;

const pickRange = (label) => fireEvent.click(screen.getByRole("button", { name: label }));

beforeEach(() => {
  localStorage.clear();
});

test("an empty ledger sends the reader to the register rather than drawing an empty chart", () => {
  seed();
  renderPage();

  expect(screen.getByRole("link", { name: "Start the register" })).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Report summary" })).not.toBeInTheDocument();
});

describe("a year of books", () => {
  const setup = () =>
    seed({
      budgetGroups: [{ id: "g1", name: "Bills", bucket: "essentials" }],
      budgets: [
        { id: "b1", name: "Rent", groupId: "g1", plannedCents: 100000, goalCents: null, bucket: null },
        { id: "b2", name: "Dining", groupId: null, plannedCents: 20000, goalCents: null, bucket: "fun" },
      ],
      transactions: [
        // Twelve months back, so the window is fully covered and the per-month
        // figures divide by the whole of it.
        ...Array.from({ length: 12 }, (_, index) => inn(monthsBack(11 - index), 500000)),
        ...Array.from({ length: 12 }, (_, index) => out(monthsBack(11 - index), 100000, "b1")),
        out(PERIOD, 60000, "b2"),
        inn(PERIOD, 10000, "b2"), // a refund against dining
      ],
    });

  test("the headline figures are the window's, net of refunds", () => {
    setup();
    renderPage();

    expect(tile("Income")).toBe("$60,000");
    // Twelve months of $1,000 rent, plus a $600 evening out less $100 a friend
    // paid back.
    expect(tile("Spending")).toBe("$12,500");
    expect(tile("Net")).toBe("$47,500");
    // The refund is not income, so it is not counted on both sides — and the
    // gross figure is stated beside the net rather than swallowed by it.
    expect(within(summary()).getByText("$12,600 out, $100 back")).toBeInTheDocument();
  });

  test("the categories are ranked by what they cost, with the plan's estimate beside them", () => {
    setup();
    renderPage();

    const rows = within(screen.getByText("Where the money went").closest("section")).getAllByRole(
      "row"
    );
    // Header, two categories, the footer. Rent is the bigger of the two and
    // comes first, though the plan lists it second — the ranking is the
    // report's own, not the plan's.
    expect(rows).toHaveLength(4);
    expect(rows[1]).toHaveTextContent("Rent");
    expect(rows[2]).toHaveTextContent("Dining");

    // Rent moved in every month of the window; dining in one. The same average
    // means different things at those two counts, which is why the row says.
    // Filed under the heading the plan files them under, including the heading
    // for the ones filed under nothing — the same word the plan itself uses.
    expect(rows[1]).toHaveTextContent("Bills · 12 of 12 months");
    expect(rows[2]).toHaveTextContent("Ungrouped · 1 of 12 months");
    // And the refund is stated on the row it came back to, so the figure beside
    // it is not quietly smaller than the register says.
    expect(rows[2]).toHaveTextContent("$100 back");
    // What it cost, and what that is a month. Rent is $1,000 either way;
    // dining's one $600 evening, less $100 back, amortises to $41.67.
    expect(rows[1]).toHaveTextContent("$12,000");
    expect(rows[1]).toHaveTextContent("$1,000");
    expect(rows[2]).toHaveTextContent("$41.67");
  });

  test("the month-by-month figures are readable as a table, not only off the chart", () => {
    setup();
    renderPage();

    fireEvent.click(screen.getByText("Show these figures as a table"));
    const rows = screen.getAllByRole("row").filter((row) => row.textContent.includes(formatPeriod(PERIOD)));

    // This month: $5,000 in; $1,000 of rent and $600 of dining less $100 back;
    // $3,500 left. The row shows its own arithmetic rather than asking to be
    // trusted, which is what the twin is for.
    expect(rows[0]).toHaveTextContent("$5,000");
    expect(rows[0]).toHaveTextContent("$1,500");
    expect(rows[0]).toHaveTextContent("$100");
    expect(rows[0]).toHaveTextContent("$3,500");
  });

  test("the range moves every figure on the page together", () => {
    setup();
    renderPage();

    expect(tile("Income")).toBe("$60,000");
    expect(screen.getByText(`${formatPeriod(monthsBack(11))} – ${formatPeriod(PERIOD)}`)).toBeInTheDocument();

    pickRange("3M");

    // Three months of the same income, and the ranking with it.
    expect(tile("Income")).toBe("$15,000");
    expect(screen.getByText(`${formatPeriod(monthsBack(2))} – ${formatPeriod(PERIOD)}`)).toBeInTheDocument();
    expect(
      within(screen.getByText("Where the money went").closest("section")).getByText(
        "Per month is over 3 months of records"
      )
    ).toBeInTheDocument();
  });
});

test("a window wider than the books says what it divided by", () => {
  seed({
    budgets: [{ id: "b1", name: "Rent", groupId: null, plannedCents: 0, goalCents: null, bucket: null }],
    transactions: [out(monthsBack(1), 100000, "b1"), out(PERIOD, 100000, "b1")],
  });
  renderPage();

  // Two months of records over a twelve-month window. Dividing by twelve would
  // report a household spending $1,000 a month as spending $167, silently.
  expect(
    screen.getByText(
      `Records start in ${formatPeriod(monthsBack(1))}, so per-month figures are divided by 2 rather than 12.`
    )
  ).toBeInTheDocument();
});

test("undated records are called out rather than quietly left out of every month", () => {
  seed({
    budgets: [{ id: "b1", name: "Rent", groupId: null, plannedCents: 0, goalCents: null, bucket: null }],
    transactions: [out(PERIOD, 100000, "b1"), out(null, 70000, "b1"), inn(null, 30000)],
  });
  renderPage();

  expect(screen.getByText("2 records have no date")).toBeInTheDocument();
  expect(screen.getByText(/\$700 of spending and \$300 of income/)).toBeInTheDocument();
  // And the chart genuinely does not carry them.
  expect(tile("Spending")).toBe("$1,000");
});

describe("the plan against the books", () => {
  const BUDGETS = [
    { id: "b1", name: "Rent", groupId: "g1", plannedCents: 150000, goalCents: null, bucket: null },
    { id: "b2", name: "Dining", groupId: "g2", plannedCents: 40000, goalCents: null, bucket: null },
  ];
  const GROUPS = [
    { id: "g1", name: "Bills", bucket: "essentials" },
    { id: "g2", name: "Treats", bucket: "fun" },
  ];

  const planSection = () => screen.getByText("Against the plan").closest("section");

  test("the plan's monthly total is named beside the chart, and the chart draws a threshold", () => {
    seed({
      budgetGroups: GROUPS,
      budgets: BUDGETS,
      transactions: [out(PERIOD, 150000, "b1"), out(PERIOD, 60000, "b2")],
    });
    const { container } = renderPage();

    expect(within(planSection()).getByText("$1,900 planned a month")).toBeInTheDocument();
    // The one dashed mark in the app is a threshold, and this is one.
    expect(container.querySelector("line[stroke-dasharray]")).not.toBeNull();
  });

  test("a plan nobody has written says so and points at where it is written", () => {
    // Zero estimates is not a plan to spend nothing, so no line is drawn — but
    // the columns are still worth having, and the gap has to be visible as a
    // gap rather than as a household that beat its plan every month.
    seed({
      budgetGroups: GROUPS,
      budgets: BUDGETS.map((entry) => ({ ...entry, plannedCents: 0 })),
      transactions: [out(PERIOD, 150000, "b1")],
    });
    const { container } = renderPage();

    expect(within(planSection()).getByText("No estimates set")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set estimates on the plan" })).toBeInTheDocument();
    expect(container.querySelector("line[stroke-dasharray]")).toBeNull();
  });

  test("the table twin carries every figure the columns draw, and what each month was against plan", () => {
    seed({
      budgetGroups: GROUPS,
      budgets: BUDGETS,
      transactions: [out(PERIOD, 200000, "b1"), out(PERIOD, 50000, "b2")],
    });
    renderPage();

    fireEvent.click(screen.getByText("Show the plan comparison as a table"));

    const row = within(planSection())
      .getAllByRole("row")
      .find((node) => node.textContent.includes(formatPeriod(PERIOD)));

    // $2,000 of essentials and $500 of fun is $2,500 against a $1,900 plan.
    expect(row).toHaveTextContent("$2,000");
    expect(row).toHaveTextContent("$500");
    expect(row).toHaveTextContent("$2,500");
    expect(row).toHaveTextContent("+$600");
  });

  test("only the buckets that moved money get a column, not all five every time", () => {
    seed({
      budgetGroups: GROUPS,
      budgets: BUDGETS,
      transactions: [out(PERIOD, 200000, "b1")],
    });
    renderPage();

    fireEvent.click(screen.getByText("Show the plan comparison as a table"));

    const headers = within(planSection())
      .getAllByRole("columnheader")
      .map((node) => node.textContent);

    expect(headers).toContain("Essentials");
    expect(headers).not.toContain("Savings");
    expect(headers).not.toContain("Retirement");
  });

  test("the range control moves this chart with everything else on the page", () => {
    seed({
      budgetGroups: GROUPS,
      budgets: BUDGETS,
      transactions: [out(monthsBack(5), 300000, "b1"), out(PERIOD, 100000, "b1")],
    });
    renderPage();

    fireEvent.click(screen.getByText("Show the plan comparison as a table"));
    const monthsIn = () =>
      within(planSection())
        .getAllByRole("row")
        .filter((node) => /\d{4}/.test(node.textContent)).length;

    expect(monthsIn()).toBe(12);
    pickRange("3M");
    expect(monthsIn()).toBe(3);
  });
});

describe("a window the reader names", () => {
  const RENT = {
    id: "b1",
    name: "Rent",
    groupId: "g1",
    plannedCents: 100000,
    goalCents: null,
    bucket: null,
  };

  const setup = () =>
    seed({
      budgetGroups: [{ id: "g1", name: "Bills", bucket: "essentials" }],
      budgets: [RENT],
      transactions: [
        out(monthsBack(5), 100000, "b1"),
        out(monthsBack(4), 200000, "b1"),
        inn(monthsBack(5), 500000),
      ],
    });

  const monthField = (label) => screen.getByLabelText(label);

  test("the two ends appear with the option rather than standing beside it always", () => {
    setup();
    renderPage();

    // Nothing on screen depends on them while a preset is in force, so they are
    // not on screen either.
    expect(screen.queryByLabelText("From")).not.toBeInTheDocument();

    pickRange("Custom");

    // Seeded with the window the page was already showing, so picking the option
    // changes nothing until the reader changes something.
    expect(monthField("From")).toHaveValue(monthsBack(11));
    expect(monthField("To")).toHaveValue(PERIOD);
    // Each end bounds the other, which is what stops the window being typed
    // backwards rather than a message after the fact.
    expect(monthField("From")).toHaveAttribute("max", PERIOD);
    expect(monthField("To")).toHaveAttribute("min", monthsBack(11));
  });

  test("the window is the pair, and every figure on the page follows it", () => {
    setup();
    renderPage();

    pickRange("Custom");
    fireEvent.change(monthField("From"), { target: { value: monthsBack(5) } });
    fireEvent.change(monthField("To"), { target: { value: monthsBack(5) } });

    // A window of one month names itself rather than reading "X to X" — and
    // "Custom" would have named nothing at all.
    expect(
      within(summary()).getByText(`1 month · ${formatPeriod(monthsBack(5))}`)
    ).toBeInTheDocument();
    expect(tile("Spending")).toBe("$1,000");
    expect(tile("Income")).toBe("$5,000");

    // The month after it is outside the window now, which is the whole point of
    // being able to end one in the past.
    fireEvent.change(monthField("To"), { target: { value: monthsBack(4) } });
    expect(tile("Spending")).toBe("$3,000");
  });

  test("a window reaching past this month divides by the months that happened, and says both reasons", () => {
    setup();
    renderPage();

    pickRange("Custom");
    fireEvent.change(monthField("To"), { target: { value: addMonths(PERIOD, 2) } });
    fireEvent.change(monthField("From"), { target: { value: monthsBack(8) } });

    // Eleven columns; six of them months the books could cover. Both ends fall
    // short and each is named for its own reason — one is a gap in the records
    // and the other is the calendar.
    expect(
      screen.getByText(
        `Records start in ${formatPeriod(monthsBack(5))} and the window runs past ${formatPeriod(
          PERIOD
        )}, so per-month figures are divided by 6 rather than 11.`
      )
    ).toBeInTheDocument();
  });

  test("a month that has not happened gets no verdict against the plan", () => {
    setup();
    renderPage();

    pickRange("Custom");
    fireEvent.change(monthField("To"), { target: { value: addMonths(PERIOD, 1) } });
    fireEvent.click(screen.getByText("Show the plan comparison as a table"));

    const planSection = screen.getByText("Against the plan").closest("section");
    const rowFor = (period) =>
      within(planSection)
        .getAllByRole("row")
        .find((node) => node.textContent.includes(formatPeriod(period)));

    // Next month is drawn — the plan's threshold is standing and does not stop
    // at today — but calling it $1,000 under would be reporting discipline
    // nobody has had the chance to show yet.
    expect(rowFor(addMonths(PERIOD, 1))).toBeDefined();
    expect(rowFor(addMonths(PERIOD, 1))).not.toHaveTextContent("-$1,000");
    expect(rowFor(monthsBack(4))).toHaveTextContent("+$1,000");
  });
});

describe("the drill-in's trend line", () => {
  const BUDGET = {
    id: "b1",
    name: "Groceries",
    groupId: null,
    plannedCents: 0,
    goalCents: null,
    bucket: null,
  };

  const openDrillIn = () =>
    fireEvent.click(screen.getByRole("button", { name: /detail for Groceries/ }));

  /** The drill-in's own hit areas. Scoped, because three charts are on the page
   *  once a row is open and `getAllByRole("img")` reaches into all of them. */
  const drillInMonths = () =>
    within(
      screen.getByRole("group", { name: "Spending by month for this category" })
    ).getAllByRole("img");

  test("a window long enough to have a trend draws one and names it", () => {
    seed({
      budgets: [BUDGET],
      transactions: Array.from({ length: 6 }, (_, index) =>
        out(monthsBack(5 - index), 50000 + index * 10000, "b1")
      ),
    });
    renderPage();
    openDrillIn();

    expect(screen.getByText("3-month average")).toBeInTheDocument();
    // The most recent three months are $800, $900 and $1,000, so $900 — and it
    // is on the newest column, which is the whole reason the average trails
    // rather than being centred.
    expect(drillInMonths().at(-1)).toHaveAccessibleName(
      expect.stringContaining("3-month average $900")
    );
  });

  test("the average starts where the books do, not where the window does", () => {
    // Six months of records at a steady $500, inside a twelve-month window. The
    // six months before them are empty because nobody was recording yet, and a
    // trend averaged through them would climb out of the floor — a habit that
    // looks like it is growing when all that grew is the record of it.
    seed({
      budgets: [BUDGET],
      transactions: Array.from({ length: 6 }, (_, index) =>
        out(monthsBack(5 - index), 50000, "b1")
      ),
    });
    renderPage();
    openDrillIn();

    const named = drillInMonths()
      .map((node) => node.getAttribute("aria-label"))
      .filter((label) => label.includes("average"));

    // Two of the six covered months are the window filling, so four carry one.
    expect(named).toHaveLength(4);
    // And every one of them is the real rate, never a figure diluted by the
    // months before the ledger starts — $166.67 is what a third of one month
    // looks like, and it must not appear.
    for (const label of named) {
      expect(label).toContain("3-month average $500");
    }
  });

  test("a window too short for a trend draws none rather than a dot with an opinion", () => {
    seed({
      budgets: [BUDGET],
      transactions: [out(monthsBack(1), 50000, "b1"), out(PERIOD, 70000, "b1")],
    });
    renderPage();
    pickRange("3M");
    openDrillIn();

    expect(screen.queryByText("3-month average")).not.toBeInTheDocument();
  });
});
