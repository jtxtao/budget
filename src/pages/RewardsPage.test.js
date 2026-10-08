import { fireEvent, render, screen, within } from "@testing-library/react";
import AppProviders from "../contexts/AppProviders";
import RewardsPage from "./RewardsPage";
import { todayISO } from "../utils";

/**
 * Through the real providers, because what is worth checking is that a figure
 * typed on the page lands in the store and moves every total that reads it.
 */
function renderPage() {
  return render(
    <AppProviders>
      <RewardsPage />
    </AppProviders>
  );
}

const stored = (key) => JSON.parse(localStorage.getItem(key));
const tile = (label) => screen.getByText(label, { selector: "dt" }).nextElementSibling;

beforeEach(() => localStorage.clear());

test("adding a balance stores it and values it at the catalog's figure", () => {
  renderPage();

  fireEvent.click(screen.getByRole("button", { name: "Add balance" }));
  fireEvent.change(screen.getByLabelText("Program"), { target: { value: "united" } });
  fireEvent.change(screen.getByLabelText("Points or miles"), { target: { value: "80,000" } });
  fireEvent.change(screen.getByLabelText(/whose/i), { target: { value: "Alex" } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));

  expect(stored("rewardsBalances")).toEqual([
    { id: expect.any(String), programId: "united", holder: "Alex", points: 80000, asOf: expect.any(String) },
  ]);
  // 80,000 × 1.30¢.
  expect(tile("All points and miles")).toHaveTextContent("$1,040");
  expect(tile("Airline miles")).toHaveTextContent("$1,040");
});

test("a typed valuation moves every figure that reads it, and blank puts the catalog's back", () => {
  localStorage.setItem(
    "rewardsBalances",
    JSON.stringify([{ id: "b1", programId: "united", holder: null, points: 100000, asOf: null }])
  );
  renderPage();
  expect(tile("All points and miles")).toHaveTextContent("$1,300");

  const field = screen.getByRole("textbox", { name: /your value for united/i });
  fireEvent.change(field, { target: { value: "1.1" } });
  fireEvent.blur(field);

  expect(stored("rewardsValuations")).toEqual({ united: 110 });
  expect(tile("All points and miles")).toHaveTextContent("$1,100");

  const again = screen.getByRole("textbox", { name: /your value for united/i });
  fireEvent.change(again, { target: { value: "" } });
  fireEvent.blur(again);
  expect(stored("rewardsValuations")).toEqual({});
  expect(tile("All points and miles")).toHaveTextContent("$1,300");
});

test("a refused valuation is said out loud and changes nothing", () => {
  renderPage();
  const field = screen.getByRole("textbox", { name: /your value for hilton/i });
  fireEvent.change(field, { target: { value: "cheap" } });
  fireEvent.blur(field);

  expect(screen.getByRole("alert")).toHaveTextContent(/Hilton Honors: Enter a value in cents per point/);
  expect(stored("rewardsValuations")).toEqual({});
});

test("editing the points on a row commits on blur", () => {
  localStorage.setItem(
    "rewardsBalances",
    JSON.stringify([{ id: "b1", programId: "hyatt", holder: null, points: 40000, asOf: null }])
  );
  renderPage();

  const cell = screen.getByRole("textbox", { name: "World of Hyatt points" });
  fireEvent.change(cell, { target: { value: "45,500" } });
  fireEvent.blur(cell);

  expect(stored("rewardsBalances")[0].points).toBe(45500);
});

test("a planned trip says how it is paid for and what each point is worth on it", () => {
  localStorage.setItem(
    "rewardsBalances",
    JSON.stringify([
      { id: "b1", programId: "hyatt", holder: null, points: 10000, asOf: null },
      { id: "b2", programId: "chase-ur", holder: null, points: 50000, asOf: null },
    ])
  );
  renderPage();

  fireEvent.click(screen.getByRole("button", { name: "Plan a trip" }));
  fireEvent.change(screen.getByLabelText("Trip"), { target: { value: "Park Hyatt Kyoto" } });
  fireEvent.change(screen.getByLabelText("Booked with"), { target: { value: "hyatt" } });
  fireEvent.change(screen.getByLabelText("Points or miles needed"), { target: { value: "35000" } });
  fireEvent.change(screen.getByLabelText(/cash price/i), { target: { value: "$1,050" } });
  fireEvent.click(screen.getByRole("button", { name: "Add trip", hidden: true }));

  const row = screen.getByRole("rowheader", { name: /Park Hyatt Kyoto/ }).closest("tr");
  expect(within(row).getByText("Covered")).toBeInTheDocument();
  expect(row).toHaveTextContent("10,000 from World of Hyatt, 25,000 moved from Chase Ultimate Rewards");
  // $1,050 / 35,000 = 3.00¢, against Hyatt's 1.80¢.
  expect(row).toHaveTextContent("3.00¢");
  expect(row).toHaveTextContent("Beats your 1.80¢");
  expect(screen.getByText("1 of 1 covered")).toBeInTheDocument();
});

test("a trip the points cannot reach says by how much", () => {
  localStorage.setItem(
    "rewardsTrips",
    JSON.stringify([
      { id: "t1", name: "Lisbon", date: null, programId: "avios", points: 50000, taxesCents: 20000, cashPriceCents: null },
    ])
  );
  renderPage();

  const row = screen.getByRole("rowheader", { name: /Lisbon/ }).closest("tr");
  expect(within(row).getByText("50,000 short")).toBeInTheDocument();
  expect(row).toHaveTextContent("$200");
});

describe("card offers", () => {
  // Real dates relative to today: the offer's window and "up to today" are the
  // whole point, and the page reads todayISO() itself.
  const today = todayISO();
  const monthStart = `${today.slice(0, 8)}01`;

  function seedBooks(transactions = []) {
    const data = {
      accounts: [
        { id: "card", name: "Sapphire", type: "liability", scope: "credit-card", assetClass: "Other", openingBalanceCents: 0, openingDate: null, reconciledOn: null },
        { id: "chk", name: "Checking", type: "asset", scope: "on-budget", assetClass: "Cash", openingBalanceCents: 500000, openingDate: null, reconciledOn: null },
      ],
      budgetGroups: [{ id: "g1", name: "Lifestyle", bucket: "fun" }],
      budgets: [
        { id: "dining", name: "Dining out", groupId: "g1", plannedCents: 30000, bucket: "fun" },
        { id: "groceries", name: "Groceries", groupId: "g1", plannedCents: 60000, bucket: "essentials" },
      ],
      payees: [],
      assignments: [],
      transactions,
    };
    for (const [key, value] of Object.entries(data)) localStorage.setItem(key, JSON.stringify(value));
  }

  const out = (id, amountCents, budgetId, accountId = "card") => ({
    id,
    kind: "outflow",
    accountId,
    budgetId,
    amountCents,
    date: today,
    description: id,
    payeeId: null,
    toAccountId: null,
    splits: null,
  });

  test("a capped bonus is mapped to a category and counts the card's spending in it", () => {
    seedBooks([out("dinner", 32000, "dining"), out("shop", 9000, "groceries"), out("lunch", 5000, "dining", "chk")]);
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Track an offer" }));
    fireEvent.change(screen.getByLabelText("Offer"), { target: { value: "9% on dining" } });
    fireEvent.change(screen.getByLabelText("On card"), { target: { value: "card" } });
    fireEvent.change(screen.getByLabelText("Starts"), { target: { value: monthStart } });
    fireEvent.change(screen.getByLabelText("Bonus applies to spending up to"), { target: { value: "$1,000" } });
    fireEvent.change(screen.getByLabelText("Bonus rate (optional)"), { target: { value: "9%" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Dining out", hidden: true }));
    fireEvent.click(screen.getByRole("button", { name: "Track offer", hidden: true }));

    expect(stored("rewardsOffers")).toEqual([
      {
        id: expect.any(String),
        name: "9% on dining",
        kind: "cap",
        accountId: "card",
        startDate: monthStart,
        endDate: null,
        limitCents: 100000,
        allSpending: false,
        budgetIds: ["dining"],
        payeeIds: [],
        rateBps: 900,
        bonusPoints: null,
        programId: null,
      },
    ]);

    const offer = screen.getByRole("heading", { name: "9% on dining" }).closest("li");
    // Only the card's dining: not the groceries, not the lunch on checking.
    expect(offer).toHaveTextContent("$320 of $1,000");
    expect(offer).toHaveTextContent("$680 of room left");
    expect(offer).toHaveTextContent("$28.80 earned at 9%");
    expect(offer).toHaveTextContent("$50 of matching spending went on another account");
    expect(within(offer).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "32");
  });

  test("an offer mapped to nothing is refused, and the form stays open", () => {
    seedBooks();
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Track an offer" }));
    fireEvent.change(screen.getByLabelText("Offer"), { target: { value: "Q4 5%" } });
    fireEvent.change(screen.getByLabelText("Bonus applies to spending up to"), { target: { value: "1500" } });
    fireEvent.click(screen.getByRole("button", { name: "Track offer", hidden: true }));

    expect(screen.getByRole("alert", { hidden: true })).toHaveTextContent(/at least one category or payee/);
    expect(stored("rewardsOffers")).toEqual([]);
  });

  test("a sign-up target counts all spending, and says when it is met", () => {
    seedBooks([out("a", 250000, "groceries"), out("b", 160000, "dining")]);
    localStorage.setItem(
      "rewardsOffers",
      JSON.stringify([
        {
          id: "sub",
          name: "Welcome bonus",
          kind: "target",
          accountId: "card",
          startDate: monthStart,
          endDate: "2099-12-31",
          limitCents: 400000,
          allSpending: true,
          budgetIds: [],
          payeeIds: [],
          rateBps: null,
          bonusPoints: 60000,
          programId: "chase-ur",
        },
      ])
    );
    renderPage();

    const offer = screen.getByRole("heading", { name: "Welcome bonus" }).closest("li");
    expect(offer).toHaveTextContent("Target met");
    expect(offer).toHaveTextContent("$4,100 of $4,000");
    // 60,000 × the catalog's 1.70¢.
    expect(offer).toHaveTextContent("Earned: 60,000 points (about $1,020)");
  });

  test("next round opens a new offer one quarter on, and leaves the old one alone", () => {
    seedBooks();
    const quarter = {
      id: "q3",
      name: "Rotating 5%",
      kind: "cap",
      accountId: "card",
      startDate: "2026-07-01",
      endDate: "2026-09-30",
      limitCents: 150000,
      allSpending: false,
      budgetIds: ["groceries"],
      payeeIds: [],
      rateBps: 500,
      bonusPoints: null,
      programId: null,
    };
    localStorage.setItem("rewardsOffers", JSON.stringify([quarter]));
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Next round of Rotating 5%" }));
    expect(screen.getByLabelText("Starts")).toHaveValue("2026-10-01");
    expect(screen.getByLabelText("Ends (optional)")).toHaveValue("2026-12-31");
    // The categories rotate: swap groceries for dining.
    fireEvent.click(screen.getByRole("checkbox", { name: "Groceries", hidden: true }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Dining out", hidden: true }));
    fireEvent.click(screen.getByRole("button", { name: "Track offer", hidden: true }));

    const offers = stored("rewardsOffers");
    expect(offers).toHaveLength(2);
    expect(offers[0]).toEqual(quarter);
    expect(offers[1]).toEqual({
      ...quarter,
      id: expect.any(String),
      startDate: "2026-10-01",
      endDate: "2026-12-31",
      budgetIds: ["dining"],
    });
    expect(offers[1].id).not.toBe("q3");
  });
});
