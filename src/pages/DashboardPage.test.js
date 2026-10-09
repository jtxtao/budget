import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AppProviders from "../contexts/AppProviders";
import DashboardPage from "./DashboardPage";
import { TRANSACTION_KINDS } from "../contexts/TransactionsContext";
import { routerFuture } from "../routerFuture";
import { addDays, currentPeriod, formatDateLong, formatDateMedium, todayISO } from "../utils";

/**
 * The dashboard through the real stores, because almost everything on it is
 * derived across several of them and a page test that mocked them would only
 * assert that the mocks were wired up.
 *
 * Wrapped in a router: the empty states and the pay-schedule tile link to the
 * budget plan.
 */
const PERIOD = currentPeriod();
const TODAY = todayISO();

const ACCOUNT = {
  id: "acc1",
  name: "Everyday",
  type: "asset",
  scope: "on-budget",
  assetClass: "Cash",
  openingBalanceCents: 200000,
  openingDate: null,
  reconciledOn: null,
};

function seed(overrides = {}) {
  const data = {
    accounts: [ACCOUNT],
    budgetGroups: [{ id: "g1", name: "Bills", bucket: "essentials" }],
    budgets: [
      { id: "b1", name: "Rent", groupId: "g1", plannedCents: 150000, bucket: null },
      {
        id: "b2",
        name: "Groceries",
        groupId: null,
        plannedCents: 60000,
        bucket: null,
        goalCents: 250000,
      },
    ],
    transactions: [
      {
        id: "t1",
        kind: TRANSACTION_KINDS.OUTFLOW,
        accountId: "acc1",
        budgetId: "b1",
        amountCents: 120000,
        date: `${PERIOD}-03`,
        description: "August rent",
      },
    ],
    assignments: [{ id: "as1", budgetId: "b1", period: PERIOD, assignedCents: 150000 }],
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
        <DashboardPage />
      </MemoryRouter>
    </AppProviders>
  );
}

/**
 * The row of a table whose first cell holds this name.
 *
 * Matched on the opening of the accessible name rather than the whole of it: a
 * category row's header now also speaks its funding reading ("Rent, on track"),
 * which is the point of carrying that reading on the name instead of in a
 * column of its own.
 */
const row = (name) =>
  screen
    .getByRole("rowheader", { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`) })
    .closest("tr");

beforeEach(() => {
  localStorage.clear();
});

test("states today's date, since every figure on the page is as of today", () => {
  seed();
  renderPage();

  expect(screen.getByText(formatDateLong(TODAY))).toBeInTheDocument();
});

test("the headline figures are this month's, not all time", () => {
  seed();
  renderPage();

  const tile = (label) => screen.getByText(label).closest("div");

  // 200,000 opening − 150,000 assigned. Nothing has come in this month.
  expect(within(tile("Available to budget")).getByText("$500")).toBeInTheDocument();
  expect(within(tile("Budgeted this month")).getByText("$1,500")).toBeInTheDocument();
  expect(within(tile("Spent this month")).getByText("$1,200")).toBeInTheDocument();
});

test("money refunded into a category comes off what was spent this month", () => {
  seed({
    transactions: [
      {
        id: "t1",
        kind: TRANSACTION_KINDS.OUTFLOW,
        accountId: "acc1",
        budgetId: "b1",
        amountCents: 120000,
        date: `${PERIOD}-03`,
        description: "August rent",
      },
      {
        id: "t2",
        kind: TRANSACTION_KINDS.INFLOW,
        accountId: "acc1",
        budgetId: "b1",
        amountCents: 20000,
        date: `${PERIOD}-04`,
        description: "Deposit returned",
      },
    ],
  });
  renderPage();

  const tile = screen.getByText("Spent this month").closest("div");
  expect(within(tile).getByText("$1,000")).toBeInTheDocument();
  expect(within(tile).getByText("After $200 refunded")).toBeInTheDocument();
});

test("categories are grouped, with the figures on each row", () => {
  seed();
  renderPage();

  expect(screen.getByRole("columnheader", { name: "Goal" })).toBeInTheDocument();

  const rent = within(row("Rent"));
  expect(rent.getByText("$300")).toBeInTheDocument(); // available
  expect(rent.getByText("$1,500")).toBeInTheDocument(); // budgeted
  // Signed, so the row adds up as it reads: $0 carried in + $1,500 − $1,200.
  expect(rent.getByText("-$1,200")).toBeInTheDocument();
  // Nothing being saved towards here, which is a dash rather than $0.
  expect(rent.getAllByText("—")).toHaveLength(1);

  // A category with no funding and no spend still appears, at zero.
  const groceries = within(row("Groceries"));
  expect(groceries.getAllByText("$0").length).toBeGreaterThan(0);
  // The goal set for it on the budget plan, carried through to the row.
  expect(groceries.getByText("$2,500")).toBeInTheDocument();

  expect(screen.getByRole("columnheader", { name: "Bills" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Ungrouped" })).toBeInTheDocument();
});

test("a refund shows on the category's row as the net of the month", () => {
  seed({
    transactions: [
      {
        id: "t1",
        kind: TRANSACTION_KINDS.OUTFLOW,
        accountId: "acc1",
        budgetId: "b2",
        amountCents: 10000,
        date: `${PERIOD}-03`,
        description: "Dinner",
      },
      {
        id: "t2",
        kind: TRANSACTION_KINDS.INFLOW,
        accountId: "acc1",
        budgetId: "b2",
        amountCents: 6000,
        date: `${PERIOD}-04`,
        description: "Their half",
      },
    ],
    assignments: [{ id: "as1", budgetId: "b2", period: PERIOD, assignedCents: 10000 }],
  });
  renderPage();

  // $100 out, $60 back: groceries cost the household $40 this month.
  expect(within(row("Groceries")).getByText("-$40")).toBeInTheDocument();
});

test("an account shows what it holds and when it last agreed with the bank", () => {
  seed();
  renderPage();

  // 200,000 opening − 120,000 spent through it.
  expect(screen.getByText("$800")).toBeInTheDocument();
  expect(screen.getByText(/Never/)).toBeInTheDocument();
  expect(screen.getByText("1 need checking")).toBeInTheDocument();
});

test("reconciling with the statement left blank stamps today without touching the balance", () => {
  seed();
  renderPage();

  fireEvent.click(screen.getByRole("button", { name: "Reconcile Everyday" }));
  const dialog = screen.getByRole("dialog");
  // The books' own figure is the default, shown in the field.
  expect(within(dialog).getByLabelText("Statement balance")).toHaveAttribute("placeholder", "$800");
  fireEvent.click(within(dialog).getByRole("button", { name: "Reconcile" }));

  expect(screen.getAllByText(new RegExp(formatDateMedium(TODAY))).length).toBeGreaterThan(0);
  expect(screen.getByText("All up to date")).toBeInTheDocument();
  expect(screen.getByText("$800")).toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem("transactions"))).toHaveLength(1);
});

test("a statement that disagrees adjusts the books before reconciling", () => {
  seed();
  renderPage();

  fireEvent.click(screen.getByRole("button", { name: "Reconcile Everyday" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Statement balance"), {
    target: { value: "$775" },
  });
  // Money left that nobody wrote down, so it needs a category.
  fireEvent.click(within(dialog).getByRole("button", { name: "Adjust and reconcile" }));
  expect(within(dialog).getByRole("alert")).toHaveTextContent(/choose the category/i);

  fireEvent.change(within(dialog).getByLabelText("Category"), { target: { value: "b2" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Adjust and reconcile" }));

  expect(screen.getByText("$775")).toBeInTheDocument();
  expect(screen.getByText("All up to date")).toBeInTheDocument();
  const added = JSON.parse(localStorage.getItem("transactions")).find((t) => t.id !== "t1");
  expect(added).toMatchObject({
    kind: TRANSACTION_KINDS.OUTFLOW,
    accountId: "acc1",
    budgetId: "b2",
    amountCents: 2500,
    date: TODAY,
  });
});

test("a credit card is paid off rather than reconciled, from a remembered account", () => {
  const CARD = {
    id: "card1",
    name: "Visa",
    type: "liability",
    scope: "credit-card",
    assetClass: "Other",
    openingBalanceCents: -30000,
    openingDate: null,
    reconciledOn: null,
  };
  seed({ accounts: [ACCOUNT, CARD] });
  renderPage();

  expect(screen.queryByRole("button", { name: "Reconcile Visa" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Record paying off Visa" }));
  let dialog = screen.getByRole("dialog");
  expect(within(dialog).getByLabelText("Amount paid")).toHaveValue("300.00");
  fireEvent.change(within(dialog).getByLabelText("Paid from"), { target: { value: "acc1" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Record payment" }));

  const payment = JSON.parse(localStorage.getItem("transactions")).find((t) => t.id !== "t1");
  expect(payment).toMatchObject({
    kind: TRANSACTION_KINDS.TRANSFER,
    accountId: "acc1",
    toAccountId: "card1",
    amountCents: 30000,
  });
  const stored = JSON.parse(localStorage.getItem("accounts")).find((a) => a.id === "card1");
  expect(stored.payFromAccountId).toBe("acc1");
  expect(stored.reconciledOn).toBe(TODAY);

  // Next time it opens on the remembered account.
  fireEvent.click(screen.getByRole("button", { name: "Record paying off Visa" }));
  dialog = screen.getByRole("dialog");
  expect(within(dialog).getByLabelText("Paid from")).toHaveValue("acc1");
});

test("off-budget accounts sit on Net worth, not the dashboard's account panel", () => {
  seed({
    accounts: [
      ACCOUNT,
      {
        id: "acc2",
        name: "401(k)",
        type: "asset",
        scope: "off-budget",
        assetClass: "Invested",
        openingBalanceCents: 500000,
        openingDate: null,
        reconciledOn: null,
      },
    ],
  });
  renderPage();

  expect(screen.getByText("Everyday")).toBeInTheDocument();
  expect(screen.queryByText("401(k)")).not.toBeInTheDocument();
});

test("the paycheck tile counts down once a schedule is set", () => {
  seed({ paySchedule: { lastPaidOn: addDays(TODAY, -4), periodDays: 14 } });
  renderPage();

  expect(screen.getByText("in 10 days")).toBeInTheDocument();
  expect(screen.getByText(new RegExp(formatDateMedium(addDays(TODAY, 10))))).toBeInTheDocument();
});

test("with no schedule the tile points at where one is set rather than guessing", () => {
  seed();
  renderPage();

  expect(screen.getByRole("link", { name: /set a pay schedule/i })).toHaveAttribute("href", "/plan");
});

test("an empty file renders the page rather than a wall of zeroes with no way out", () => {
  renderPage();

  expect(screen.getByRole("link", { name: /add one on the budget plan/i })).toBeInTheDocument();
  expect(screen.getByText(/no accounts yet/i)).toBeInTheDocument();
});

/**
 * Upcoming bills, through the real stores — because what is worth checking here is
 * that pressing Enter lands *both* writes: the transaction, and the schedule's
 * cursor. The panel's own contract is in `UpcomingBills.test.js` and the calendar
 * arithmetic in `recurrence.test.js`; neither of those can see that the money
 * arrived in the ledger.
 */
describe("what is due", () => {
  const LANDLORD = { id: "p1", name: "Landlord", defaultBudgetId: "b1" };

  /** A schedule, due `offset` days from today, with nothing dealt with yet. */
  const schedule = (offset = 0, overrides = {}) => ({
    id: "s1",
    kind: TRANSACTION_KINDS.OUTFLOW,
    payeeId: "p1",
    amountCents: 180000,
    accountId: "acc1",
    budgetId: "b1",
    description: "Rent",
    cadence: "monthly",
    startDate: addDays(TODAY, offset),
    endsOn: null,
    enteredThrough: null,
    ...overrides,
  });

  const stored = (key) => JSON.parse(localStorage.getItem(key));
  const ledger = () => stored("transactions");

  function openDue(offset = 0, overrides = {}) {
    seed({ payees: [LANDLORD], schedules: [schedule(offset, overrides)] });
    renderPage();
    return addDays(TODAY, offset);
  }

  test("a scheduled bill shows by its payee, with what it is filed under", () => {
    openDue();

    expect(screen.getByText("Landlord")).toBeInTheDocument();
    expect(screen.getByText("Everyday · Rent")).toBeInTheDocument();
    expect(screen.getByText("$1,800 going out in the next 28 days.")).toBeInTheDocument();
  });

  test("one nobody entered is still on the list, and says it is late", () => {
    openDue(-6);

    expect(screen.getByText("1 is overdue")).toBeInTheDocument();
    expect(screen.getByText(/6 days ago/)).toBeInTheDocument();
  });

  test("entering it writes the transaction and marks the occurrence dealt with", () => {
    const date = openDue();

    fireEvent.click(screen.getByRole("button", { name: `Enter Landlord due ${formatDateMedium(date)}` }));
    fireEvent.click(screen.getByRole("button", { name: "Record it" }));

    // The ledger first, then the cursor — the order `AddDonationModal` takes, and
    // chosen for which half is survivable alone.
    const entered = ledger().find((row) => row.id !== "t1");
    expect(entered).toMatchObject({
      kind: TRANSACTION_KINDS.OUTFLOW,
      payeeId: "p1",
      accountId: "acc1",
      budgetId: "b1",
      amountCents: 180000,
      date,
      description: "Rent",
    });
    expect(stored("schedules")[0].enteredThrough).toBe(date);
    // And it is off the list, so it cannot be entered twice by accident.
    expect(screen.queryByRole("button", { name: /^Enter Landlord/ })).not.toBeInTheDocument();
  });

  test("the amount is what the statement said, not what the schedule guessed", () => {
    const date = openDue();

    fireEvent.click(screen.getByRole("button", { name: `Enter Landlord due ${formatDateMedium(date)}` }));
    // The whole reason this is a form rather than a one-click write: the electric
    // bill is never the same twice.
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "$1,847.20" } });
    fireEvent.click(screen.getByRole("button", { name: "Record it" }));

    expect(ledger().find((row) => row.id !== "t1").amountCents).toBe(184720);
    // What is *expected* from now on is unmoved — that is edited on the schedule.
    expect(stored("schedules")[0].amountCents).toBe(180000);
  });

  test("the date is seeded with the day it was due, not today", () => {
    const date = openDue(-6);

    fireEvent.click(screen.getByRole("button", { name: `Enter Landlord due ${formatDateMedium(date)}` }));

    // Seeding today would quietly restate every overdue bill as paid on time.
    expect(screen.getByLabelText("Date it went out")).toHaveValue(date);
  });

  test("an occurrence paid late still only retires the one it was for", () => {
    const date = openDue(-6);

    fireEvent.click(screen.getByRole("button", { name: `Enter Landlord due ${formatDateMedium(date)}` }));
    fireEvent.change(screen.getByLabelText("Date it went out"), { target: { value: TODAY } });
    fireEvent.click(screen.getByRole("button", { name: "Record it" }));

    // The money moved today; the occurrence it settled was six days ago. Stamping
    // today would swallow anything else falling in between.
    expect(ledger().find((row) => row.id !== "t1").date).toBe(TODAY);
    expect(stored("schedules")[0].enteredThrough).toBe(date);
  });

  test("a refused figure keeps the form open on what was typed", () => {
    const date = openDue();

    fireEvent.click(screen.getByRole("button", { name: `Enter Landlord due ${formatDateMedium(date)}` }));
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "twelve apples" } });
    fireEvent.click(screen.getByRole("button", { name: "Record it" }));

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(ledger()).toHaveLength(1);
    expect(stored("schedules")[0].enteredThrough).toBeNull();
  });

  test("skipping moves the cursor and touches no money at all", () => {
    const date = openDue();

    fireEvent.click(screen.getByRole("button", { name: `Skip Landlord due ${formatDateMedium(date)}` }));

    // A month the gym was closed. The one thing a bill reminder has to be able to
    // do without lying about the books.
    expect(ledger()).toHaveLength(1);
    expect(stored("schedules")[0].enteredThrough).toBe(date);
    expect(screen.queryByRole("button", { name: /^Skip Landlord/ })).not.toBeInTheDocument();
  });

  test("a schedule naming something deleted says so rather than looking refiled", () => {
    seed({ payees: [], schedules: [schedule(0, { payeeId: "gone", budgetId: "gone" })] });
    renderPage();

    // Every reference on a schedule is inert but kept, so each one has to be able
    // to report that what it names has gone.
    expect(screen.getByText("Unknown payee")).toBeInTheDocument();
    expect(screen.getByText("Everyday · Unknown category")).toBeInTheDocument();
  });

  test("with nothing scheduled the panel points at where one is written", () => {
    seed();
    renderPage();

    expect(
      screen.getByRole("link", { name: /add a scheduled transaction/i })
    ).toHaveAttribute("href", "/plan");
  });
});

describe("funding against the estimate", () => {
  // The reading lives on the name now, not in a column of its own: the word is
  // spoken from the row header and the gap, where there is one, is printed
  // beside it.
  const funding = (name) => within(row(name)).getByRole("rowheader").textContent;

  test("each row says how it stands against its estimate, in words", () => {
    seed();
    renderPage();

    // Rent: $1,500 planned, $1,200 spent, $300 left — exactly what the month
    // still asks of it.
    expect(funding("Rent")).toBe("Rent, on track");
    // Groceries: $600 planned and nothing in it.
    expect(funding("Groceries")).toBe("Groceries, underfunded$600 short");
    expect(screen.getByText(/1 category short/)).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Funding key" })).toHaveTextContent(
      /Overspent.*Short.*Funded/
    );
  });

  test("a month ahead is well funded, and an underfunded row opens to fund it", () => {
    seed({
      assignments: [{ id: "as1", budgetId: "b1", period: PERIOD, assignedCents: 300000 }],
      accounts: [{ ...ACCOUNT, openingBalanceCents: 500000 }],
    });
    renderPage();

    // $1,800 left against $300 still to go this month and $1,500 next month.
    expect(funding("Rent")).toBe("Rent, well funded");

    fireEvent.click(screen.getByRole("button", { name: "Fund Groceries" }));
    expect(screen.getByLabelText("Move from")).toHaveValue("to-be-assigned");
    expect(screen.getByLabelText("Move to")).toHaveValue("b2");
    expect(screen.getByLabelText("Amount to move")).toHaveValue("$600");
  });

  test("assign income opens from the categories panel", () => {
    seed();
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Assign income" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("moving money between categories", () => {
  /** Rent is funded and underspent; Groceries is funded nothing and overspent. */
  function seedShortfall() {
    seed({
      transactions: [
        {
          id: "t1",
          kind: TRANSACTION_KINDS.OUTFLOW,
          accountId: "acc1",
          budgetId: "b1",
          amountCents: 120000,
          date: `${PERIOD}-03`,
          description: "Rent",
        },
        {
          id: "t2",
          kind: TRANSACTION_KINDS.OUTFLOW,
          accountId: "acc1",
          budgetId: "b2",
          amountCents: 40000,
          date: `${PERIOD}-04`,
          description: "Shop",
        },
      ],
      assignments: [{ id: "as1", budgetId: "b1", period: PERIOD, assignedCents: 150000 }],
    });
  }

  function amounts() {
    // Available is the row's first cell again, now that the funding reading is
    // carried by the name rather than by a column of its own.
    return {
      rent: within(row("Rent")).getAllByRole("cell")[0].textContent,
      groceries: within(row("Groceries")).getAllByRole("cell")[0].textContent,
    };
  }

  test("the overspent row opens the move already pointed at covering it", () => {
    seedShortfall();
    renderPage();

    // Groceries is $400 in the red, so its own figure is the way to settle it.
    fireEvent.click(
      screen.getByRole("button", { name: "Cover Groceries" })
    );

    expect(screen.getByLabelText("Move to")).toHaveValue("b2");
    expect(screen.getByLabelText("Amount to move")).toHaveValue("$400");
    // The pool holds $500, enough to cover it, so that is where it starts.
    expect(screen.getByLabelText("Move from")).toHaveValue("to-be-assigned");
  });

  test("covering from the pool assigns it, and the pool goes down by exactly that", () => {
    seedShortfall();
    renderPage();

    const pool = () =>
      within(screen.getByText("Available to budget").closest("div")).getByText(/^\$/).textContent;
    expect(pool()).toBe("$500");

    fireEvent.click(screen.getByRole("button", { name: "Cover Groceries" }));
    expect(screen.getByRole("status")).toHaveTextContent(/To be assigned.*\$500.*\$100/);
    fireEvent.click(screen.getByRole("button", { name: "Assign it" }));

    expect(amounts()).toEqual({ rent: "$300", groceries: "$0" });
    expect(pool()).toBe("$100");
  });

  test("a shortfall the pool cannot cover leaves the source for the user to pick", () => {
    seedShortfall();
    // Assign the whole of the pool away first, so nothing is left to cover with.
    localStorage.setItem(
      "assignments",
      JSON.stringify([{ id: "as1", budgetId: "b1", period: PERIOD, assignedCents: 200000 }])
    );
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Cover Groceries" }));
    expect(screen.getByLabelText("Move from")).toHaveValue("");
    expect(screen.getByLabelText("Move to")).toHaveValue("b2");
  });

  test("a row with money to spare opens the move as the source", () => {
    seedShortfall();
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Move money out of Rent" }));

    expect(screen.getByLabelText("Move from")).toHaveValue("b1");
    // Nothing assumed about where it is going or how much.
    expect(screen.getByLabelText("Move to")).toHaveValue("");
    expect(screen.getByLabelText("Amount to move")).toHaveValue("");
  });

  test("it says what each side will be left with before anything is written", () => {
    seedShortfall();
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Move money out of Rent" }));
    fireEvent.change(screen.getByLabelText("Move to"), { target: { value: "b2" } });
    fireEvent.change(screen.getByLabelText("Amount to move"), { target: { value: "300" } });

    const preview = screen.getByRole("status");
    expect(preview).toHaveTextContent(/Rent.*\$300.*\$0/);
    // Still short by a hundred, and the figure says so rather than the move
    // being refused for it.
    expect(preview).toHaveTextContent(/Groceries.*-\$400.*-\$100/);
  });

  test("the move lands on both rows and leaves the pool alone", () => {
    seedShortfall();
    renderPage();

    const poolBefore = screen.getByText("Available to budget").closest("div").textContent;
    expect(amounts()).toEqual({ rent: "$300", groceries: "-$400" });

    fireEvent.click(
      screen.getByRole("button", { name: "Cover Groceries" })
    );
    fireEvent.change(screen.getByLabelText("Move from"), { target: { value: "b1" } });
    fireEvent.click(screen.getByRole("button", { name: "Move it" }));

    expect(amounts()).toEqual({ rent: "-$100", groceries: "$0" });
    // The two deltas cancel, so what is left to assign cannot have moved.
    expect(screen.getByText("Available to budget").closest("div").textContent).toBe(poolBefore);
  });

  test("a move the store refuses keeps the form open and says why", () => {
    seedShortfall();
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Move money out of Rent" }));
    fireEvent.change(screen.getByLabelText("Move to"), { target: { value: "b1" } });
    fireEvent.change(screen.getByLabelText("Amount to move"), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "Move it" }));

    expect(screen.getByRole("alert")).toHaveTextContent("two different categories");
    expect(amounts()).toEqual({ rent: "$300", groceries: "-$400" });
  });
});
