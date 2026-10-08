import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AppShell from "./AppShell";
import AppProviders from "../contexts/AppProviders";
import { routerFuture } from "../routerFuture";
import { addDays, todayISO } from "../utils";

/**
 * The assistant, from the header to the ledger, through the real stores.
 *
 * The bridge is staged on `window.__hbDesktop` the way `storage.test.js` stages
 * it, with the two assistant verbs as spies — so the model's reply is written
 * out here as the object it would be, and everything after it is the app's
 * own. What has to hold is the claim the feature rests on: **the reading opens
 * an ordinary form and nothing lands until somebody saves it**, and a refile
 * moves exactly the rows left ticked.
 *
 * The storage backend stays the web one — it is picked when `storage.js` first
 * loads and is not reset here — so the books are `localStorage`'s as in every
 * other store suite, and only `isDesktop()` sees the shell.
 */

function seed() {
  localStorage.setItem(
    "budgets",
    JSON.stringify([
      { id: "groc", name: "Groceries", plannedCents: 0, goalCents: null, groupId: null, bucket: "essentials" },
      { id: "home", name: "Household", plannedCents: 0, goalCents: null, groupId: null, bucket: "essentials" },
    ])
  );
  localStorage.setItem(
    "accounts",
    JSON.stringify([
      {
        id: "chk",
        name: "Checking",
        type: "asset",
        scope: "on-budget",
        assetClass: "Cash",
        openingBalanceCents: 100000,
        openingDate: null,
        reconciledOn: null,
      },
    ])
  );
  localStorage.setItem(
    "payees",
    JSON.stringify([{ id: "amzn", name: "Amazon", defaultBudgetId: null }])
  );
  localStorage.setItem("assignments", JSON.stringify([]));
}

function stageBridge(content) {
  const ask = jest.fn(async () => ({ ok: true, content }));
  window.__hbDesktop = {
    snapshot: {},
    write: () => {},
    remove: () => {},
    assistStatus: async () => ({ ok: true, models: ["qwen2.5:7b"] }),
    assistAsk: ask,
  };
  return ask;
}

function renderApp() {
  return render(
    <AppProviders>
      <MemoryRouter future={routerFuture}>
        <AppShell>
          <p>page</p>
        </AppShell>
      </MemoryRouter>
    </AppProviders>
  );
}

const reading = (fields) => ({
  action: "add_transaction",
  kind: "outflow",
  amount: null,
  payee: null,
  category: null,
  to_category: null,
  account: null,
  to_account: null,
  date: null,
  note: null,
  ...fields,
});

/**
 * Open the dialog and ask, with the bridge's answers delivered **inside**
 * `act`. Left outside it, the reply's renders go to React's real scheduler, and
 * the state the form's re-seed effect sets (the account above all) can still
 * be pending when the next click lands — under load, a save refused for want of
 * an account the screen already shows.
 */
async function askFor(sentence) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  });
  const input = screen.getByRole("textbox", { name: "What happened?" });
  fireEvent.change(input, { target: { value: sentence } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Fill in the form" }));
  });
}

const stored = (key) => JSON.parse(localStorage.getItem(key));

beforeEach(() => {
  localStorage.clear();
  seed();
});

afterEach(() => {
  delete window.__hbDesktop;
});

test("there is no Ask in a browser, where there is no model to ask", () => {
  renderApp();
  expect(screen.queryByRole("button", { name: "Ask" })).not.toBeInTheDocument();
});

test("a sentence opens the transaction form filled in, and nothing lands until it is saved", async () => {
  const ask = stageBridge(
    reading({ amount: "45.20", payee: "Joe's Pizza", category: "Groceries", date: "yesterday", note: "party" })
  );
  renderApp();

  await askFor("45.20 at Joe's Pizza yesterday for groceries, party");

  const amount = screen.getByDisplayValue("$45.20");
  const scope = within(amount.closest("dialog"));
  expect(scope.getByText("New transaction")).toBeInTheDocument();
  expect(ask).toHaveBeenCalledTimes(1);
  expect(ask.mock.calls[0][0].model).toBe("qwen2.5:7b");
  expect(ask.mock.calls[0][0].messages[1].content).toBe(
    "45.20 at Joe's Pizza yesterday for groceries, party"
  );

  expect(scope.getByLabelText("Amount")).toHaveValue("$45.20");
  expect(scope.getByLabelText("Date")).toHaveValue(addDays(todayISO(), -1));
  expect(scope.getByLabelText("Category")).toHaveValue("groc");
  expect(scope.getByLabelText("Note")).toHaveValue("party");
  expect(scope.getByRole("combobox", { name: "Paid to" })).toHaveValue("Joe's Pizza");
  expect(scope.getByRole("list", { name: "Check before saving" })).toHaveTextContent(
    "Joe's Pizza isn't a payee yet"
  );

  // Read, filled in — and still nothing in the ledger.
  expect(stored("transactions") ?? []).toEqual([]);

  fireEvent.click(scope.getByRole("button", { name: "Add" }));

  await waitFor(() => expect(stored("transactions")).toHaveLength(1));
  const [transaction] = stored("transactions");
  const pizza = stored("payees").find((payee) => payee.name === "Joe's Pizza");
  expect(transaction).toMatchObject({
    kind: "outflow",
    amountCents: 4520,
    budgetId: "groc",
    accountId: "chk",
    date: addDays(todayISO(), -1),
    description: "party",
    payeeId: pizza.id,
  });
});

test("a transfer out of the budget gets its category, though that field appears a render late", async () => {
  const accounts = JSON.parse(localStorage.getItem("accounts"));
  localStorage.setItem(
    "accounts",
    JSON.stringify([
      ...accounts,
      { ...accounts[0], id: "k401", name: "401(k)", scope: "off-budget", assetClass: "Stocks", openingBalanceCents: 0 },
    ])
  );
  stageBridge(
    reading({ kind: "transfer", amount: "500", account: "Checking", to_account: "401(k)", category: "Household" })
  );
  renderApp();

  await askFor("put 500 from checking into the 401k out of household");

  const amount = await screen.findByDisplayValue("$500");
  const scope = within(amount.closest("dialog"));
  // The amount is written through its ref in the re-seed effect, while the
  // accounts arrive with the render that effect's state causes — so they are
  // waited for too, rather than read the instant the figure shows.
  await waitFor(() => {
    expect(scope.getByLabelText("From")).toHaveValue("chk");
    expect(scope.getByLabelText("To")).toHaveValue("k401");
    expect(scope.getByLabelText("Comes out of")).toHaveValue("home");
  });

  fireEvent.click(scope.getByRole("button", { name: "Add" }));
  expect(stored("transactions")[0]).toMatchObject({
    kind: "transfer",
    accountId: "chk",
    toAccountId: "k401",
    budgetId: "home",
    amountCents: 50000,
  });
});

test("a move opens the move form on both categories and the figure", async () => {
  stageBridge(
    reading({ action: "move_money", amount: "50", category: "Groceries", to_category: "Household" })
  );
  renderApp();

  await askFor("move 50 from groceries to household");

  const amount = await screen.findByDisplayValue("$50");
  const form = amount.closest("form");
  expect(form.elements.fromBudgetId).toHaveValue("groc");
  expect(form.elements.toBudgetId).toHaveValue("home");
  // Opened, not done: the move is the form's to make.
  expect(stored("assignments")).toEqual([]);
});

test("a refile moves exactly the rows left ticked, and can set the payee's default", async () => {
  localStorage.setItem(
    "transactions",
    JSON.stringify(
      [
        ["t1", "2026-09-01", 1000],
        ["t2", "2026-09-02", 2000],
      ].map(([id, date, amountCents]) => ({
        id,
        kind: "outflow",
        payeeId: "amzn",
        description: "",
        amountCents,
        date,
        accountId: "chk",
        toAccountId: null,
        budgetId: "groc",
        splits: null,
      }))
    )
  );
  stageBridge(
    reading({ action: "recategorize", payee: "amazon", to_category: "Household" })
  );
  renderApp();

  await askFor("file the amazon ones under household");

  expect(await screen.findByText("Refile Amazon's spending under Household?")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox", { name: /^Refile \$10 on/ }));
  fireEvent.click(screen.getByRole("button", { name: "Refile 1 transaction" }));

  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(
      "Refiled 1 transaction from Amazon under Household, and new ones will start there too."
    )
  );
  const byId = Object.fromEntries(stored("transactions").map((entry) => [entry.id, entry.budgetId]));
  expect(byId).toEqual({ t1: "groc", t2: "home" });
  expect(stored("payees")[0].defaultBudgetId).toBe("home");
});

test("a sentence it cannot use is said in the dialog, and nothing opens", async () => {
  stageBridge({ ...reading({}), action: "unknown" });
  renderApp();

  await askFor("what's the weather");

  expect(await screen.findByRole("alert")).toHaveTextContent("That isn't something I can do yet.");
  expect(screen.queryByText("New transaction")).not.toBeInTheDocument();
});

test("an answer that arrives after the dialog was closed opens nothing", async () => {
  let answer;
  stageBridge(null).mockImplementation(
    () => new Promise((resolve) => {
      answer = resolve;
    })
  );
  renderApp();

  await askFor("45 at Costco");
  expect(await screen.findByRole("button", { name: "Reading…" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await act(async () => answer({ ok: true, content: reading({ amount: "45" }) }));

  expect(screen.queryByText("New transaction")).not.toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: "What happened?" })).not.toBeInTheDocument();
});

test("no Ollama is explained, with what to do about it", async () => {
  stageBridge(null);
  window.__hbDesktop.assistStatus = async () => ({ ok: false, reason: "unreachable" });
  renderApp();

  fireEvent.click(screen.getByRole("button", { name: "Ask" }));

  expect(await screen.findByText(/isn't answering yet/)).toBeInTheDocument();
  expect(screen.getByText("ollama pull qwen2.5:7b")).toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: "What happened?" })).not.toBeInTheDocument();
});
