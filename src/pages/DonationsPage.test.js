import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AppProviders from "../contexts/AppProviders";
import DonationsPage from "./DonationsPage";
import { TRANSACTION_KINDS } from "../contexts/TransactionsContext";
import { routerFuture } from "../routerFuture";
import { todayISO } from "../utils";

/**
 * The page through the real stores, as with the dashboard and the reports page:
 * every figure on it is a join between the donation records and the ledger those
 * records describe, and mocking the hook would assert only that the mock was
 * wired up.
 *
 * What is checked here rather than in `useGiving.test.js` is the wiring the hook
 * cannot see: that recording a gift writes the money *and* the statement about
 * it, that untagging leaves the money alone, that a deduction larger than its
 * gift is refused where the amount is actually in hand, and that the year
 * stepper moves everything together.
 *
 * The page opens on the current year, so the fixtures are dated into it — a
 * fixture pinned to a particular year would stop being on screen at midnight on
 * the 31st of December.
 */
const YEAR = todayISO().slice(0, 4);
const LAST_YEAR = String(Number(YEAR) - 1);

const ACCOUNT = {
  id: "acc1",
  name: "Everyday",
  type: "asset",
  scope: "on-budget",
  assetClass: "Cash",
  openingBalanceCents: 500000,
  openingDate: null,
  reconciledOn: null,
};

const BUDGET = {
  id: "b1",
  name: "Giving",
  groupId: null,
  plannedCents: 50000,
  goalCents: null,
  bucket: "fun",
};

const RED_CROSS = { id: "r1", name: "Red Cross", deductible: true };
const RAFFLE = { id: "r2", name: "School raffle", deductible: false };

let sequence = 0;
const gift = (date, amountCents, description = "gift") => ({
  id: `t${(sequence += 1)}`,
  kind: TRANSACTION_KINDS.OUTFLOW,
  description,
  accountId: ACCOUNT.id,
  budgetId: BUDGET.id,
  amountCents,
  date,
});

const tag = (transactionId, recipientId, deductibleCents, acknowledged = false) => ({
  transactionId,
  recipientId,
  deductibleCents,
  acknowledged,
});

function seed(data = {}) {
  const file = {
    accounts: [ACCOUNT],
    budgets: [BUDGET],
    assignments: [],
    donationRecipients: [RED_CROSS],
    ...data,
  };
  for (const [key, value] of Object.entries(file)) {
    localStorage.setItem(key, JSON.stringify(value));
  }
}

function renderPage() {
  return render(
    <AppProviders>
      <MemoryRouter future={routerFuture}>
        <DonationsPage />
      </MemoryRouter>
    </AppProviders>
  );
}

const summary = () => screen.getByRole("region", { name: "Giving summary" });

/** A `<dt>` takes no accessible name from its content, so a tile's figure is
 *  reached through its term's text and the element beside it. */
const tile = (label) => within(summary()).getByText(label).nextElementSibling.textContent;

const stored = (key) => JSON.parse(localStorage.getItem(key) ?? "null");

/** Commit a cell the way a user does: type, then leave. */
function type(field, value) {
  fireEvent.change(field, { target: { value } });
  fireEvent.blur(field);
}

beforeEach(() => {
  localStorage.clear();
});

describe("a year with giving in it", () => {
  const setup = () => {
    const one = gift(`${YEAR}-03-04`, 20000, "Spring appeal");
    const gala = gift(`${YEAR}-05-01`, 20000, "Gala ticket");
    const raffle = gift(`${YEAR}-06-01`, 5000, "Raffle tickets");
    seed({
      donationRecipients: [RED_CROSS, RAFFLE],
      transactions: [one, gala, raffle],
      donations: [
        tag(one.id, RED_CROSS.id, 20000),
        // The dinner inside the ticket is not a gift.
        tag(gala.id, RED_CROSS.id, 12000),
        tag(raffle.id, RAFFLE.id, 0),
      ],
    });
    return { one, gala, raffle };
  };

  test("the headline figures separate what was given from what can be claimed", () => {
    setup();
    renderPage();

    expect(tile("Given")).toBe("$450");
    expect(tile("Tax deductible")).toBe("$320");
    // The gap is the figure a household is surprised by, so it is stated rather
    // than left to be subtracted.
    expect(within(summary()).getByText("$130 not deductible")).toBeInTheDocument();
  });

  test("each gift is a row, newest first, with the organization it went to", () => {
    setup();
    renderPage();

    const rows = within(screen.getByText(`Gifts in ${YEAR}`).closest("section")).getAllByRole(
      "row"
    );

    // Header, three gifts, the footer.
    expect(rows).toHaveLength(5);
    expect(rows[1]).toHaveTextContent("Raffle tickets");
    expect(rows[3]).toHaveTextContent("Spring appeal");
    expect(within(rows[1]).getByRole("combobox")).toHaveValue(RAFFLE.id);
  });

  test("the deductible part is edited here and the total follows it", () => {
    setup();
    renderPage();

    type(screen.getByLabelText("Deductible amount for Gala ticket"), "$150");

    expect(tile("Tax deductible")).toBe("$350");
    // And the money is untouched: what was given is the ledger's figure.
    expect(tile("Given")).toBe("$450");
  });

  test("a deduction larger than its gift is refused, where the amount is in hand", () => {
    setup();
    renderPage();

    type(screen.getByLabelText("Deductible amount for Gala ticket"), "$500");

    expect(
      screen.getByText("A deduction cannot be larger than the gift it comes out of.")
    ).toBeInTheDocument();
    expect(tile("Tax deductible")).toBe("$320");
  });

  test("untagging a gift leaves the expense on the register", () => {
    const { gala } = setup();
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Not a donation: Gala ticket" }));

    expect(tile("Given")).toBe("$250");
    // The money still moved. Only the statement about it is gone.
    expect(stored("transactions").some((entry) => entry.id === gala.id)).toBe(true);
    expect(stored("donations").some((entry) => entry.transactionId === gala.id)).toBe(false);
  });

  test("the organizations are listed with what each was given", () => {
    setup();
    renderPage();

    const organizations = screen.getByRole("region", { name: "Organizations" });
    expect(within(organizations).getByText("Red Cross")).toBeInTheDocument();
    expect(within(organizations).getByText("$400")).toBeInTheDocument();
    expect(within(organizations).getByText("$50")).toBeInTheDocument();
  });
});

describe("recording a gift", () => {
  test("writes the money to the ledger and the statement about it here", () => {
    seed({ transactions: [] });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Record a gift" }));
    fireEvent.change(screen.getByLabelText("What it was for"), {
      target: { value: "Winter appeal" },
    });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "$300" } });
    fireEvent.click(screen.getByRole("button", { name: "Record" }));

    expect(tile("Given")).toBe("$300");
    expect(tile("Tax deductible")).toBe("$300");

    // A gift is an ordinary outflow: it leaves an account, it comes out of a
    // category, and it is on the register like everything else.
    const [logged] = stored("transactions");
    expect(logged).toMatchObject({
      kind: TRANSACTION_KINDS.OUTFLOW,
      description: "Winter appeal",
      amountCents: 30000,
      accountId: ACCOUNT.id,
      budgetId: BUDGET.id,
    });
    // And nothing about the money is copied into the statement.
    expect(stored("donations")).toEqual([
      {
        transactionId: logged.id,
        recipientId: RED_CROSS.id,
        deductibleCents: 30000,
        acknowledged: false,
        receipt: null,
      },
    ]);
  });

  test("part of a gift can be deductible, and the rest is not", () => {
    seed({ transactions: [] });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Record a gift" }));
    fireEvent.change(screen.getByLabelText("What it was for"), { target: { value: "Gala" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "200" } });
    fireEvent.change(screen.getByLabelText("Tax deductible"), { target: { value: "part" } });
    fireEvent.change(screen.getByLabelText("Deductible amount"), { target: { value: "120" } });
    fireEvent.click(screen.getByRole("button", { name: "Record" }));

    expect(tile("Given")).toBe("$200");
    expect(tile("Tax deductible")).toBe("$120");
  });

  test("a deduction larger than the gift is refused before the money is written", () => {
    seed({ transactions: [] });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Record a gift" }));
    fireEvent.change(screen.getByLabelText("What it was for"), { target: { value: "Gala" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "200" } });
    fireEvent.change(screen.getByLabelText("Tax deductible"), { target: { value: "part" } });
    fireEvent.change(screen.getByLabelText("Deductible amount"), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Record" }));

    expect(
      screen.getByText("A deduction cannot be larger than the gift it comes out of.")
    ).toBeInTheDocument();
    // The form writes twice, so the money must not be the write that lands
    // alone: nothing at all is recorded.
    expect(stored("transactions")).toEqual([]);
    expect(stored("donations")).toEqual([]);
  });

  test("the deductible answer follows the organization until it is answered", () => {
    seed({ donationRecipients: [RAFFLE, RED_CROSS], transactions: [] });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Record a gift" }));
    // The form opens on an organization whose gifts are not deductible, so the
    // question opens answered that way.
    expect(screen.getByLabelText("Tax deductible")).toHaveValue("none");

    fireEvent.change(screen.getByLabelText("Organization"), { target: { value: RED_CROSS.id } });
    expect(screen.getByLabelText("Tax deductible")).toHaveValue("all");

    // Once the user answers it themselves it stays put — a choice already made
    // is not a default.
    fireEvent.change(screen.getByLabelText("Tax deductible"), { target: { value: "none" } });
    fireEvent.change(screen.getByLabelText("Organization"), { target: { value: RAFFLE.id } });
    expect(screen.getByLabelText("Tax deductible")).toHaveValue("none");
  });

  test("with no organizations the form says so rather than offering a submit that cannot work", () => {
    seed({ donationRecipients: [], transactions: [] });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Record a gift" }));
    // Scoped to the dialog: the panel behind it says the same thing, which is
    // the point — there is one place to fix this and both say where.
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/No organizations yet/)).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Record" })).not.toBeInTheDocument();
  });

  test("an organization added here is what the next gift can be filed under", () => {
    seed({ donationRecipients: [], transactions: [] });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Add organization" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Food bank" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(within(screen.getByRole("region", { name: "Organizations" })).getByText("Food bank"))
      .toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Record a gift" }));
    expect(screen.getByLabelText("Organization")).toHaveValue(stored("donationRecipients")[0].id);
  });
});

describe("the acknowledgment", () => {
  test("a gift over the threshold with none noted is called out until it has one", () => {
    const big = gift(`${YEAR}-03-04`, 40000, "Spring appeal");
    seed({ transactions: [big], donations: [tag(big.id, RED_CROSS.id, 40000)] });
    renderPage();

    expect(screen.getByText("1 gift needs a written acknowledgment")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Acknowledgment received for Spring appeal"));

    expect(screen.queryByText("1 gift needs a written acknowledgment")).not.toBeInTheDocument();
    expect(stored("donations")[0].acknowledged).toBe(true);
  });
});

describe("the goal", () => {
  test("a figure typed for the year becomes the target and the distance to it", () => {
    const one = gift(`${YEAR}-03-04`, 200000, "Spring appeal");
    seed({ transactions: [one], donations: [tag(one.id, RED_CROSS.id, 200000)] });
    renderPage();

    expect(tile("Goal")).toBe("—");

    type(screen.getByLabelText("Goal for the year"), "$6,000");

    expect(tile("Goal")).toBe("$6,000");
    expect(screen.getByText(/still to give to reach \$6,000/)).toBeInTheDocument();
  });

  test("a share is a share of the income actually recorded", () => {
    const one = gift(`${YEAR}-03-04`, 200000, "Spring appeal");
    const pay = {
      id: "pay1",
      kind: TRANSACTION_KINDS.INFLOW,
      description: "Pay",
      accountId: ACCOUNT.id,
      budgetId: null,
      amountCents: 6000000,
      date: `${YEAR}-01-31`,
    };
    seed({ transactions: [one, pay], donations: [tag(one.id, RED_CROSS.id, 200000)] });
    renderPage();

    fireEvent.click(screen.getByRole("radio", { name: "A share of what I earn" }));
    type(screen.getByLabelText("Share of income"), "10%");

    expect(tile("Goal")).toBe("$6,000");
    // The working, not just the answer: a target that moves with income has to
    // say what it is moving with.
    expect(within(screen.getByRole("region", { name: "Giving goal" })).getByText(/of the/))
      .toHaveTextContent("10% of the $60,000 recorded so far is $6,000");
  });

  test("a figure the store refuses stays on screen with the reason beside it", () => {
    seed({ transactions: [] });
    renderPage();

    fireEvent.click(screen.getByRole("radio", { name: "A share of what I earn" }));
    type(screen.getByLabelText("Share of income"), "a tenth");

    expect(screen.getByRole("alert")).toHaveTextContent(/Enter a share of your income/);
    expect(screen.getByLabelText("Share of income")).toHaveValue("a tenth");
  });
});

describe("the year", () => {
  test("stepping back moves every figure on the page together", () => {
    const thisYear = gift(`${YEAR}-03-04`, 20000, "Spring appeal");
    const lastYear = gift(`${LAST_YEAR}-11-04`, 50000, "Winter appeal");
    seed({
      transactions: [thisYear, lastYear],
      donations: [tag(thisYear.id, RED_CROSS.id, 20000), tag(lastYear.id, RED_CROSS.id, 50000)],
      donationGoals: [
        { year: YEAR, source: "amount", amountCents: 600000, shareBps: null },
        { year: LAST_YEAR, source: "amount", amountCents: 100000, shareBps: null },
      ],
    });
    renderPage();

    expect(tile("Given")).toBe("$200");
    expect(tile("Goal")).toBe("$6,000");
    expect(screen.getByText("Spring appeal")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Previous year" }));

    // The gifts, the goal and the organizations' totals are all a year's, and a
    // control that moved some of them and not others would look right in a
    // screenshot.
    expect(tile("Given")).toBe("$500");
    expect(tile("Goal")).toBe("$1,000");
    expect(screen.getByText("Winter appeal")).toBeInTheDocument();
    expect(screen.queryByText("Spring appeal")).not.toBeInTheDocument();
  });

  test("an empty year says where the records actually start", () => {
    const lastYear = gift(`${LAST_YEAR}-11-04`, 50000, "Winter appeal");
    seed({ transactions: [lastYear], donations: [tag(lastYear.id, RED_CROSS.id, 50000)] });
    renderPage();

    expect(screen.getByText(`Nothing recorded in ${YEAR}.`, { exact: false })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: LAST_YEAR }));
    expect(screen.getByText("Winter appeal")).toBeInTheDocument();
  });

  test("an undated gift is in no year, and the page says so rather than dropping it", () => {
    const dated = gift(`${YEAR}-03-04`, 20000, "Spring appeal");
    const undated = gift(null, 7000, "Old gift");
    seed({
      transactions: [dated, undated],
      donations: [tag(dated.id, RED_CROSS.id, 20000), tag(undated.id, RED_CROSS.id, 7000)],
    });
    renderPage();

    expect(screen.getByText("1 gift has no date")).toBeInTheDocument();
    expect(tile("Given")).toBe("$200");
  });
});

describe("gifts from the giving category", () => {
  test("appear without being tagged, and picking the organization writes the tag", () => {
    const given = gift(`${YEAR}-03-04`, 20000, "spring appeal");
    seed({ transactions: [given] });
    renderPage();

    expect(screen.getByText("spring appeal")).toBeInTheDocument();
    expect(stored("donations") ?? []).toEqual([]);

    fireEvent.change(screen.getByLabelText("Organization for spring appeal"), {
      target: { value: RED_CROSS.id },
    });
    expect(stored("donations")).toEqual([
      {
        transactionId: given.id,
        recipientId: RED_CROSS.id,
        deductibleCents: 20000,
        acknowledged: false,
        receipt: null,
      },
    ]);
  });

  test("untagging one keeps it off the page and the money on the register", () => {
    const given = gift(`${YEAR}-03-04`, 20000, "spring appeal");
    seed({ transactions: [given] });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Not a donation: spring appeal" }));
    expect(screen.queryByText("spring appeal")).not.toBeInTheDocument();
    expect(stored("transactions")).toHaveLength(1);
  });
});

describe("receipt files", () => {
  // jsdom has no IndexedDB, so a browser without an account keeps its receipts
  // in memory here — the same three verbs, which is what the page relies on.
  const pdf = (name = "letter.pdf", type = "application/pdf") =>
    new File(["%PDF-1.4 thank you"], name, { type });

  const fileInput = (transactionId) => screen.getByTestId(`receipt-file-${transactionId}`);

  test("attaching a file describes it on the gift and ticks the receipt box", async () => {
    const big = gift(`${YEAR}-03-04`, 30000, "Gala");
    seed({ transactions: [big], donations: [tag(big.id, RED_CROSS.id, 30000)] });
    renderPage();
    expect(screen.getByText("Needed")).toBeInTheDocument();

    fireEvent.change(fileInput(big.id), { target: { files: [pdf()] } });

    expect(
      await screen.findByRole("button", { name: "Open receipt for Gala: letter.pdf" })
    ).toBeInTheDocument();
    // The store writes storage in an effect, and this write came after an await.
    await waitFor(() => expect(stored("donations")[0].acknowledged).toBe(true));
    const [donation] = stored("donations");
    expect(donation.receipt).toEqual({
      id: expect.any(String),
      name: "letter.pdf",
      type: "application/pdf",
      sizeBytes: 18,
      addedOn: todayISO(),
      storedIn: "browser",
    });
    expect(screen.queryByText("Needed")).not.toBeInTheDocument();
  });

  test("a file that cannot be a receipt is refused and nothing is written", async () => {
    const big = gift(`${YEAR}-03-04`, 30000, "Gala");
    seed({ transactions: [big], donations: [tag(big.id, RED_CROSS.id, 30000)] });
    renderPage();

    fireEvent.change(fileInput(big.id), {
      target: { files: [pdf("notes.txt", "text/plain")] },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("Attach a PDF or a photo");
    expect(stored("donations")[0].receipt).toBeNull();
  });

  test("removing the file leaves the receipt box ticked", async () => {
    const big = gift(`${YEAR}-03-04`, 30000, "Gala");
    seed({ transactions: [big], donations: [tag(big.id, RED_CROSS.id, 30000)] });
    renderPage();
    fireEvent.change(fileInput(big.id), { target: { files: [pdf()] } });
    await screen.findByRole("button", { name: /Open receipt for Gala/ });

    await waitFor(() => expect(stored("donations")[0].receipt).not.toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Remove receipt for Gala" }));

    expect(stored("donations")[0]).toMatchObject({ receipt: null, acknowledged: true });
    expect(screen.getByRole("button", { name: "Attach receipt for Gala" })).toBeInTheDocument();
  });

  test("a gift read off the giving category is tagged by attaching to it", async () => {
    // Paid to a payee named like the organization, so the row already knows
    // where it went — a gift with no organization cannot be recorded yet.
    const given = { ...gift(`${YEAR}-03-04`, 30000, "spring appeal"), payeeId: "p1" };
    seed({
      transactions: [given],
      payees: [{ id: "p1", name: "Red Cross", defaultBudgetId: null }],
    });
    renderPage();

    fireEvent.change(fileInput(given.id), { target: { files: [pdf()] } });
    await screen.findByRole("button", { name: /Open receipt for Red Cross/ });

    await waitFor(() => expect(stored("donations")).toHaveLength(1));
    expect(stored("donations")).toEqual([
      expect.objectContaining({
        transactionId: given.id,
        acknowledged: true,
        receipt: expect.objectContaining({ name: "letter.pdf" }),
      }),
    ]);
  });

  test("restating a gift keeps the file it already has", async () => {
    const big = gift(`${YEAR}-03-04`, 30000, "Gala");
    seed({ transactions: [big], donations: [tag(big.id, RED_CROSS.id, 30000)] });
    renderPage();
    fireEvent.change(fileInput(big.id), { target: { files: [pdf()] } });
    await screen.findByRole("button", { name: /Open receipt for Gala/ });
    await waitFor(() => expect(stored("donations")[0].receipt).not.toBeNull());

    type(screen.getByLabelText("Deductible amount for Gala"), "200");

    expect(stored("donations")[0]).toMatchObject({
      deductibleCents: 20000,
      receipt: expect.objectContaining({ name: "letter.pdf" }),
    });
  });
});
