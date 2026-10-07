import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import EmergencyFundPanel from "./EmergencyFundPanel";
import { routerFuture } from "../routerFuture";

/**
 * Props and spies, the way `PaySchedulePanel` and `SavingsGoalList` are tested:
 * what this pins down is the panel's editing contract — which patch each field
 * sends, which fields each answer asks for, and what happens to a figure the
 * store refuses — not how the figures were derived. The arithmetic is
 * `useEmergencyFund.test.js`, through the real stores.
 *
 * Wrapped in a router because the account list links to the plan when there are
 * no accounts to tick.
 */
const FUND = {
  fund: {
    targetSource: "months",
    monthsCovered: 6,
    targetCents: null,
    accountIds: ["acc-save"],
  },
  monthlyEssentialsCents: 190000,
  essentialsCount: 2,
  derivedTargetCents: 1140000,
  targetCents: 1140000,
  typedTargetCents: null,
  accountRows: [
    {
      account: { id: "acc-save", name: "Savings", type: "asset", scope: "on-budget" },
      valueCents: 900000,
      included: true,
      hand: false,
      asOf: null,
    },
    {
      account: { id: "acc-cash", name: "Everyday", type: "asset", scope: "on-budget" },
      valueCents: 100000,
      included: false,
      hand: false,
      asOf: null,
    },
  ],
  heldCents: 900000,
  remainingCents: 240000,
  fundedBps: 7895,
  monthsHeldBps: 47368,
  hasEssentials: true,
};

function renderPanel(overrides = {}, handlers = {}) {
  const onChange = handlers.onChange ?? jest.fn();
  const onToggleAccount = handlers.onToggleAccount ?? jest.fn();
  const result = render(
    <MemoryRouter future={routerFuture}>
      <EmergencyFundPanel
        fund={{ ...FUND, ...overrides }}
        error={overrides.error ?? null}
        onChange={onChange}
        onToggleAccount={onToggleAccount}
      />
    </MemoryRouter>
  );
  return { ...result, onChange, onToggleAccount };
}

const typed = (overrides = {}) => ({
  fund: { ...FUND.fund, targetSource: "amount", targetCents: 2500000 },
  targetCents: 2500000,
  typedTargetCents: 2500000,
  remainingCents: 1600000,
  fundedBps: 3600,
  ...overrides,
});

test("leads with the months covered, which is readable before any target is set", () => {
  renderPanel();

  // The headline is a month count rather than a percentage: that is the sentence
  // the fund exists to answer.
  expect(screen.getByText("4.7 months of essentials covered")).toBeInTheDocument();
  expect(screen.getByText("79% funded")).toBeInTheDocument();

  const figure = (label) => screen.getByText(label).nextElementSibling.textContent;
  expect(figure("Set aside")).toBe("$9,000");
  expect(figure("Target")).toBe("$11,400");
  expect(figure("Still to save")).toBe("$2,400");
});

test("the derivation is shown as working, not as a figure to take on trust", () => {
  renderPanel();

  // Read off the whole paragraph: the figures in it are their own elements, which
  // is what lets them carry the brighter tone, so no single text node holds the
  // sentence.
  const sentence = screen.getByText(/change what a category is expected to need/i).textContent;
  expect(sentence).toContain("essentials come to $1,900 a month across 2 categories");
  expect(sentence).toContain("6 months of them is $11,400");
});

test("each answer asks for its own figure and the other is not on screen", () => {
  const { unmount } = renderPanel();

  expect(screen.getByLabelText("Months")).toHaveValue(6);
  expect(screen.queryByLabelText("Target")).not.toBeInTheDocument();
  unmount();

  renderPanel(typed());

  // A textbox, not a number field: a number input refuses "$25,000" outright.
  expect(screen.getByRole("textbox", { name: "Target" })).toHaveValue("$25,000");
  expect(screen.queryByLabelText("Months")).not.toBeInTheDocument();
  // The answer switched away from is still stated, which is the only thing that
  // makes keeping it worth anything.
  expect(screen.getByText(/6 months of your essentials would be/i)).toBeInTheDocument();
});

test("the months count commits on blur, as a panel does", () => {
  const { onChange } = renderPanel();

  const months = screen.getByLabelText("Months");
  fireEvent.change(months, { target: { value: "3" } });
  // Nothing is written while it is being typed — a "1" on the way to "12" is a
  // valid figure and would redraw every figure above for as long as it took.
  expect(onChange).not.toHaveBeenCalled();

  fireEvent.blur(months);
  expect(onChange).toHaveBeenCalledWith({ monthsCovered: "3" });
});

test("a typed target is sent as what was typed, symbol and separators and all", () => {
  const { onChange } = renderPanel(typed());

  const target = screen.getByRole("textbox", { name: "Target" });
  fireEvent.change(target, { target: { value: "$30,000.50" } });
  fireEvent.blur(target);

  expect(onChange).toHaveBeenCalledWith({ targetCents: "$30,000.50" });
});

test("picking an answer is the only thing the radios do", () => {
  const { onChange } = renderPanel();

  fireEvent.click(screen.getByLabelText("A target I enter"));
  expect(onChange).toHaveBeenCalledWith({ targetSource: "amount" });
});

test("a refused figure stays on screen to be corrected, with the message beside it", () => {
  renderPanel({ error: "Enter a whole number of months, from 1 to 120." });

  expect(screen.getByRole("alert")).toHaveTextContent("Enter a whole number of months");
});

test("ticking an account is one call, and the total says what it adds up to", () => {
  const { onToggleAccount } = renderPanel();

  expect(screen.getByLabelText("Savings")).toBeChecked();
  expect(screen.getByLabelText("Everyday")).not.toBeChecked();
  expect(screen.getByText("Held as the emergency fund")).toBeInTheDocument();

  fireEvent.click(screen.getByLabelText("Everyday"));
  expect(onToggleAccount).toHaveBeenCalledWith({ accountId: "acc-cash", included: true });
});

test("a fund with no money pointed at it says so rather than measuring zero months", () => {
  renderPanel({
    accountRows: FUND.accountRows.map((row) => ({ ...row, included: false })),
    heldCents: 0,
    remainingCents: 1140000,
    fundedBps: 0,
    monthsHeldBps: 0,
  });

  // "0.0 months covered" reads as a measurement where nothing has been measured.
  expect(screen.getByText("Nothing set aside yet")).toBeInTheDocument();
  // And the zero says why it is zero, which the headline cannot.
  expect(screen.getByText("No accounts ticked yet")).toBeInTheDocument();
});

test("a plan with no essentials says so rather than drawing a target of zero as met", () => {
  renderPanel({
    monthlyEssentialsCents: 0,
    essentialsCount: 0,
    derivedTargetCents: 0,
    targetCents: 0,
    remainingCents: 0,
    fundedBps: null,
    monthsHeldBps: null,
    hasEssentials: false,
  });

  expect(screen.getByText("No essentials estimated yet")).toBeInTheDocument();
  expect(screen.getByText(/no category counting as essentials has a monthly estimate/i)).toBeInTheDocument();
  // No meter at all, rather than an empty one — there is nothing to be a share of.
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
});
