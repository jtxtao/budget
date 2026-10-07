import { fireEvent, render, screen, within } from "@testing-library/react";
import AppProviders from "../contexts/AppProviders";
import RewardsPage from "./RewardsPage";

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
