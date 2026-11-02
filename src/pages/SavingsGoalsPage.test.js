import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AppProviders from "../contexts/AppProviders";
import SavingsGoalsPage from "./SavingsGoalsPage";
import { routerFuture } from "../routerFuture";
import { currentPeriod } from "../utils";

/**
 * The page through the real stores: spending a goal through its form, the
 * planned / saved / spent reading that follows, and closing a goal out into the
 * archived list. The money arithmetic is `useGoalSpending.test.js`'s; what is
 * checked here is that the form and the card are wired to it.
 */
const PERIOD = currentPeriod();

function seed() {
  const file = {
    accounts: [
      {
        id: "acc1",
        name: "Everyday",
        type: "asset",
        scope: "on-budget",
        assetClass: "Cash",
        openingBalanceCents: 5_000_000,
        openingDate: null,
        reconciledOn: null,
      },
    ],
    budgets: [{ id: "b-wed", name: "Wedding costs", plannedCents: 0 }],
    assignments: [],
    transactions: [],
    savingsGoals: [
      {
        id: "g1",
        name: "Wedding",
        targetCents: 3_000_000,
        targetDate: null,
        budgetId: "b-wed",
        accountIds: [],
        accountAmounts: {},
      },
    ],
    savingsGoalAssignments: [{ id: "a1", goalId: "g1", period: PERIOD, assignedCents: 1_200_000 }],
  };
  for (const [key, value] of Object.entries(file)) localStorage.setItem(key, JSON.stringify(value));
}

function renderPage() {
  render(
    <MemoryRouter future={routerFuture}>
      <AppProviders>
        <SavingsGoalsPage />
      </AppProviders>
    </MemoryRouter>
  );
}

const openCard = (name) =>
  fireEvent.click(screen.getByRole("button", { name: new RegExp("^" + name), expanded: false }));

beforeEach(() => {
  localStorage.clear();
  seed();
});

test("spending from a goal shows planned, saved and spent apart, and lists what was paid", () => {
  renderPage();
  openCard("Wedding");
  fireEvent.click(screen.getByRole("button", { name: "Spend from Wedding" }));

  const dialog = screen.getByRole("dialog", { name: "Spend from Wedding" });
  const amount = within(dialog).getByRole("textbox", { name: "Amount" });
  // Opens on everything in the goal, into the goal's own category.
  expect(amount).toHaveValue("12000.00");
  expect(within(dialog).getByRole("combobox", { name: "Category it counts in" })).toHaveValue("b-wed");

  fireEvent.change(amount, { target: { value: "8000" } });
  fireEvent.change(within(dialog).getByRole("textbox", { name: "What it was for" }), {
    target: { value: "Venue deposit" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Spend from goal" }));

  const figures = screen.getByLabelText("Figures for Wedding");
  const figure = (term) => within(figures).getByText(term).nextElementSibling.textContent;
  expect(figure("Planned")).toBe("$30,000");
  expect(figure("Saved")).toBe("$12,000");
  expect(figure("Spent")).toBe("$8,000");
  expect(figure("In the goal")).toBe("$4,000");
  expect(figure("Still to save")).toBe("$18,000");

  const spending = screen.getByRole("list", { name: "Spending from Wedding" });
  expect(within(spending).getByText("Venue deposit")).toBeInTheDocument();
  expect(within(spending).getByText("$8,000")).toBeInTheDocument();
});

test("a refused spend keeps the form open and says why", () => {
  renderPage();
  openCard("Wedding");
  fireEvent.click(screen.getByRole("button", { name: "Spend from Wedding" }));
  const dialog = screen.getByRole("dialog", { name: "Spend from Wedding" });
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Amount" }), { target: { value: "20000" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Spend from goal" }));
  expect(within(dialog).getByRole("alert")).toHaveTextContent("Only $12,000 is in this goal to spend.");
});

test("closing a goal out moves it to the archived list, and it can be restored", () => {
  renderPage();
  openCard("Wedding");
  fireEvent.click(screen.getByRole("button", { name: "Close out goal: Wedding" }));
  const dialog = screen.getByRole("dialog", { name: "Close out Wedding?" });
  expect(dialog).toHaveTextContent("$12,000 still in this goal goes back to To be assigned.");
  fireEvent.click(within(dialog).getByRole("button", { name: "Close out goal" }));

  const archived = screen.getByRole("list", { name: "Archived goals" });
  expect(within(archived).getByText("Wedding")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^Wedding/, expanded: false })).toBeNull();

  fireEvent.click(within(archived).getByRole("button", { name: "Restore goal: Wedding" }));
  expect(screen.queryByRole("list", { name: "Archived goals" })).toBeNull();
  expect(screen.getByRole("button", { name: /^Wedding/, expanded: false })).toBeInTheDocument();
});
