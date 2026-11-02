import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AppProviders from "../contexts/AppProviders";
import ConfigurationPage from "./ConfigurationPage";
import { TRANSACTION_KINDS } from "../contexts/TransactionsContext";
import { routerFuture } from "../routerFuture";
import { currentPeriod } from "../utils";

/**
 * The setup walk-through on the budget plan, through the real stores.
 *
 * Its skips live in this browser only, so a household seen from a fresh device
 * has none — and an incomplete plan (no income source here) would restart the
 * walk-through over a full ledger unless the books themselves say otherwise.
 */
const PERIOD = currentPeriod();

function seed(overrides = {}) {
  const data = {
    accounts: [
      {
        id: "acc1",
        name: "Everyday",
        type: "asset",
        scope: "on-budget",
        assetClass: "Cash",
        openingBalanceCents: 200000,
        openingDate: null,
        reconciledOn: null,
      },
    ],
    budgets: [{ id: "b1", name: "Rent", groupId: null, plannedCents: 150000, bucket: null }],
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
        <ConfigurationPage />
      </MemoryRouter>
    </AppProviders>
  );
}

beforeEach(() => {
  localStorage.clear();
  // jsdom has no layout, so no `scrollIntoView` for the coachmark to call.
  Element.prototype.scrollIntoView = jest.fn();
});

test("walks a household with nothing recorded through setup", () => {
  seed();
  renderPage();

  expect(screen.getByText("Getting started")).toBeInTheDocument();
});

test("does not walk a household already keeping its books through setup again", () => {
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
    ],
  });
  renderPage();

  expect(screen.queryByText("Getting started")).not.toBeInTheDocument();
});
