import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useState } from "react";
import AddTransactionModal from "./AddTransactionModal";
import AddBudgetModal from "./AddBudgetModal";
import AddGroupModal from "./AddGroupModal";
import AddIncomeSourceModal from "./AddIncomeSourceModal";
import AddAccountModal from "./AddAccountModal";
import AssignIncomeModal from "./AssignIncomeModal";
import AppProviders from "../contexts/AppProviders";
import { useAccounts } from "../contexts/AccountsContext";
import { routerFuture } from "../routerFuture";
import { addMonths, currentPeriod, todayISO } from "../utils";

// The transaction modal points at the Budget plan page when there is nothing to
// book against, so the whole suite renders under a router as the app does.
function Providers({ children }) {
  return (
    <AppProviders>
      <MemoryRouter future={routerFuture}>{children}</MemoryRouter>
    </AppProviders>
  );
}

// Mirrors how TransactionsPage drives the modals: mounted once for the life of
// the page and toggled with `show`, with the budget it was opened from varying
// between openings. The bugs these tests cover only appear across repeated
// open/close cycles, which is exactly what a conditionally-rendered modal would
// have hidden.
function TransactionHarness({ budgetIds }) {
  const [show, setShow] = useState(false);
  const [budgetId, setBudgetId] = useState();
  return (
    <>
      {budgetIds.map((id) => (
        <button
          key={id ?? "header"}
          onClick={() => {
            setBudgetId(id);
            setShow(true);
          }}
        >
          open {id ?? "header"}
        </button>
      ))}
      <AddTransactionModal
        show={show}
        defaultBudgetId={budgetId}
        handleClose={() => setShow(false)}
      />
    </>
  );
}

// The assign modal is period-scoped, so the harness can step the month the same
// way the page's stepper does — including while the modal is open.
function AssignHarness() {
  const [show, setShow] = useState(false);
  const [period, setPeriod] = useState(currentPeriod);
  return (
    <>
      <button onClick={() => setShow(true)}>open</button>
      <button onClick={() => setPeriod(addMonths(period, 1))}>next month</button>
      <AssignIncomeModal show={show} period={period} handleClose={() => setShow(false)} />
    </>
  );
}

function SimpleHarness({ Modal }) {
  const [show, setShow] = useState(false);
  return (
    <>
      <button onClick={() => setShow(true)}>open</button>
      <Modal show={show} handleClose={() => setShow(false)} />
    </>
  );
}

const TWO_BUDGETS = [
  { id: "a", name: "Groceries", max: 400 },
  { id: "b", name: "Fuel", max: 120 },
];

beforeEach(() => {
  localStorage.clear();
});

function seedBudgets(budgets) {
  localStorage.setItem("budgets", JSON.stringify(budgets));
}

function seedIncome(dollars) {
  localStorage.setItem(
    "income",
    JSON.stringify([{ id: "i1", description: "Pay", amount: dollars, date: todayISO() }])
  );
}

// Every transaction names the account it moved through, so the transaction
// modal needs at least one on-budget account before it will show a form at all.
function seedAccounts(accounts = [{ id: "acc1", name: "Everyday", openingBalanceCents: 100000 }]) {
  localStorage.setItem(
    "accounts",
    JSON.stringify(
      accounts.map((account) => ({
        type: "asset",
        scope: "on-budget",
        assetClass: "Cash",
        openingBalanceCents: 0,
        openingDate: null,
        ...account,
      }))
    )
  );
}

describe("assigning income to categories", () => {
  function openWith(budgets, dollars) {
    seedBudgets(budgets);
    if (dollars != null) seedIncome(dollars);
    render(
      <Providers>
        <AssignHarness />
      </Providers>
    );
    fireEvent.click(screen.getByText("open"));
  }

  test("filling a category tops it up to its estimate and the pool drops", () => {
    openWith([{ id: "a", name: "Groceries", max: 400 }], 1000);

    expect(screen.getByRole("status")).toHaveTextContent("$1,000");

    fireEvent.click(screen.getByRole("button", { name: "Fill" }));

    // Money at rest, like every figure on the row it sits in.
    expect(screen.getByLabelText("Assign to Groceries")).toHaveValue("$400");
    expect(screen.getByRole("status")).toHaveTextContent("$600");
  });

  test("the remaining figure tracks typing, and goes negative past the pool", () => {
    openWith([{ id: "a", name: "Groceries", max: 400 }], 1000);

    fireEvent.change(screen.getByLabelText("Assign to Groceries"), { target: { value: "250" } });
    expect(screen.getByRole("status")).toHaveTextContent("$750");

    // Over-assigning is allowed and has to be visible, not blocked.
    fireEvent.change(screen.getByLabelText("Assign to Groceries"), { target: { value: "1200" } });
    expect(screen.getByRole("status")).toHaveTextContent("-$200");
  });

  test("saving writes every row, and reopening shows what was stored", () => {
    openWith(
      [
        { id: "a", name: "Groceries", max: 400 },
        { id: "b", name: "Fuel", max: 120 },
      ],
      1000
    );

    fireEvent.change(screen.getByLabelText("Assign to Groceries"), { target: { value: "300" } });
    fireEvent.change(screen.getByLabelText("Assign to Fuel"), { target: { value: "120" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(JSON.parse(localStorage.getItem("assignments"))).toHaveLength(2);

    fireEvent.click(screen.getByText("open"));
    expect(screen.getByLabelText("Assign to Groceries")).toHaveValue("$300");
    expect(screen.getByRole("status")).toHaveTextContent("$580");
  });

  test("abandoned typing does not survive a reopen", () => {
    openWith([{ id: "a", name: "Groceries", max: 400 }], 1000);

    fireEvent.change(screen.getByLabelText("Assign to Groceries"), { target: { value: "999" } });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    fireEvent.click(screen.getByText("open"));
    expect(screen.getByLabelText("Assign to Groceries")).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent("$1,000");
  });

  test("a negative assignment is accepted — it pulls money back out", () => {
    openWith([{ id: "a", name: "Groceries", max: 400 }], 1000);

    fireEvent.change(screen.getByLabelText("Assign to Groceries"), { target: { value: "-50" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(JSON.parse(localStorage.getItem("assignments"))[0].assignedCents).toBe(-5000);
  });

  test("stepping the month underneath an open modal re-seeds it", () => {
    openWith([{ id: "a", name: "Groceries", max: 400 }], 1000);

    fireEvent.change(screen.getByLabelText("Assign to Groceries"), { target: { value: "300" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(screen.getByText("open"));
    expect(screen.getByLabelText("Assign to Groceries")).toHaveValue("$300");

    fireEvent.click(screen.getByText("next month"));

    // Next month has its own assignment, not this month's carried over.
    expect(screen.getByLabelText("Assign to Groceries")).toHaveValue("");
  });

  test("Uncategorized is offered when it owes money, even with no activity now", () => {
    // An empty assignments key so the day-one seed does not run and zero it out.
    localStorage.setItem("assignments", JSON.stringify([]));
    localStorage.setItem(
      "expenses",
      JSON.stringify([
        {
          id: "e1",
          description: "Parking",
          amountCents: 900,
          budgetId: "Uncategorized",
          date: "2020-01-05",
        },
      ])
    );
    openWith([{ id: "a", name: "Groceries", max: 400 }], 1000);

    // Keyed on the balance rather than this month's activity: an overspend
    // carried in from years ago is exactly the row the user came here to cover.
    expect(screen.getByLabelText("Assign to Uncategorized")).toBeInTheDocument();
  });

  test("a category with no estimate cannot be filled", () => {
    openWith([{ id: "a", name: "Groceries" }], 1000);

    expect(screen.getByRole("button", { name: "Fill" })).toBeDisabled();
  });
});

describe("one form for both directions", () => {
  function openHarness(budgetIds = ["a"]) {
    seedBudgets(TWO_BUDGETS);
    seedAccounts();
    render(
      <Providers>
        <TransactionHarness budgetIds={budgetIds} />
      </Providers>
    );
    fireEvent.click(screen.getByText(`open ${budgetIds[0] ?? "header"}`));
  }

  test("money out requires a category; money in offers one and defaults to none", () => {
    openHarness();

    expect(screen.getByRole("button", { name: "Money out" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByLabelText(/^category$/i)).toBeRequired();
    expect(screen.getByLabelText(/paid to/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Money in" }));

    // The description asks the opposite question, and the category becomes the
    // optional one that tells a refund from income. It defaults to none, because
    // the common inflow is a paycheque.
    expect(screen.getByLabelText(/received from/i)).toBeInTheDocument();
    const category = screen.getByLabelText(/refund to category/i);
    expect(category).not.toBeRequired();
    expect(category).toHaveValue("");
  });

  test("a category picked for an expense does not follow the toggle into money in", () => {
    openHarness();

    // The select is remounted per direction for exactly this reason: reusing it
    // would turn the next paycheque into a refund against whatever was picked.
    fireEvent.click(screen.getByRole("button", { name: "Money in" }));
    expect(screen.getByLabelText(/refund to category/i)).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: "Money out" }));
    expect(screen.getByLabelText(/^category$/i)).not.toHaveValue("");
  });

  test("an expense is stored against its account, category and payee", () => {
    openHarness();

    // "Paid to" is the payee field now, and nobody named Blue Bottle exists yet —
    // so submitting is what brings the payee into being, which is the rule this
    // form keeps and the register's cell cannot: a form abandoned half-typed
    // leaves nothing behind.
    fireEvent.change(screen.getByLabelText(/paid to/i), { target: { value: "Blue Bottle" } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "4.50" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    const payees = JSON.parse(localStorage.getItem("payees"));
    expect(payees).toEqual([
      { id: expect.any(String), name: "Blue Bottle", defaultBudgetId: null },
    ]);

    expect(JSON.parse(localStorage.getItem("transactions"))).toEqual([
      {
        id: expect.any(String),
        kind: "outflow",
        // The reference, and the note left empty: the payee is not a copy of the
        // text, it is where the text went.
        payeeId: payees[0].id,
        description: "",
        amountCents: 450,
        date: todayISO(),
        accountId: "acc1",
        toAccountId: null,
        splits: null,
        budgetId: "a",
      },
    ]);
  });

  test("a payee already on the list is taken rather than duplicated", () => {
    openHarness();

    fireEvent.change(screen.getByLabelText(/paid to/i), { target: { value: "Blue Bottle" } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "4.50" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    fireEvent.click(screen.getByText("open a"));
    // Differently capitalised, and with the spacing a human leaves behind: one
    // payee, because that is what identity means here.
    fireEvent.change(screen.getByLabelText(/paid to/i), { target: { value: "  blue bottle " } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "3.25" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    const payees = JSON.parse(localStorage.getItem("payees"));
    expect(payees).toHaveLength(1);
    const ledger = JSON.parse(localStorage.getItem("transactions"));
    expect(ledger).toHaveLength(2);
    expect(ledger[1].payeeId).toBe(payees[0].id);
  });

  test("a payee's default category seeds the form, until the user answers it", () => {
    seedBudgets(TWO_BUDGETS);
    seedAccounts();
    // Stated up front, the way the payee panel lets it be: this one is usually
    // filed under the second category.
    localStorage.setItem(
      "payees",
      JSON.stringify([{ id: "p1", name: "Shell", defaultBudgetId: "b" }])
    );
    render(
      <Providers>
        <TransactionHarness budgetIds={["a"]} />
      </Providers>
    );
    fireEvent.click(screen.getByText("open a"));

    const field = screen.getByLabelText(/paid to/i);
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "shel" } });
    fireEvent.click(screen.getByRole("option", { name: /Shell/ }));

    // The category followed the payee, which is the whole point of a default.
    expect(screen.getByLabelText(/^category$/i)).toHaveValue("b");
  });

  test("a category the user picked is not overwritten by a payee's default", () => {
    seedBudgets(TWO_BUDGETS);
    seedAccounts();
    localStorage.setItem(
      "payees",
      JSON.stringify([{ id: "p1", name: "Shell", defaultBudgetId: "b" }])
    );
    render(
      <Providers>
        <TransactionHarness budgetIds={["a"]} />
      </Providers>
    );
    fireEvent.click(screen.getByText("open a"));

    // An answer given is an answer. A default that overrode it would be a
    // preference the app had about the user's own filing.
    fireEvent.change(screen.getByLabelText(/^category$/i), { target: { value: "a" } });

    const field = screen.getByLabelText(/paid to/i);
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "shell" } });
    fireEvent.click(screen.getByRole("option", { name: /Shell/ }));

    expect(screen.getByLabelText(/^category$/i)).toHaveValue("a");
  });

  test("income is stored with no category at all", () => {
    openHarness();

    fireEvent.click(screen.getByRole("button", { name: "Money in" }));
    fireEvent.change(screen.getByLabelText(/received from/i), { target: { value: "Salary" } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "3000" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(JSON.parse(localStorage.getItem("transactions"))[0]).toMatchObject({
      kind: "inflow",
      amountCents: 300000,
      accountId: "acc1",
      budgetId: null,
    });
  });

  test("the account select shows what each account currently holds", () => {
    openHarness();

    // $1,000 opening, so the first expense has to come out of something.
    expect(screen.getByRole("option", { name: "Everyday — $1,000" })).toBeInTheDocument();
  });

  test("opening from a budget card preselects that budget, and updates on reopen", () => {
    openHarness(["a", "b"]);
    expect(screen.getByLabelText(/category/i)).toHaveValue("a");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByText("open b"));
    expect(screen.getByLabelText(/category/i)).toHaveValue("b");
  });

  test("opening from the page header falls back to the first category", () => {
    openHarness(["b", undefined]);
    expect(screen.getByLabelText(/category/i)).toHaveValue("b");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByText("open header"));
    // Never blank: a transaction cannot be saved without one, so the form does
    // not open on a choice the user has to make before anything else.
    expect(screen.getByLabelText(/category/i)).toHaveValue("a");
  });

  test("a budget deleted since the modal last opened falls back to the first", () => {
    openHarness(["gone"]);
    expect(screen.getByLabelText(/category/i)).toHaveValue("a");
  });

  test("with no account there is no form, only the way to make one", () => {
    seedBudgets(TWO_BUDGETS);
    render(
      <Providers>
        <TransactionHarness budgetIds={["a"]} />
      </Providers>
    );
    fireEvent.click(screen.getByText("open a"));

    // A form whose submit could only ever fail is worse than no form.
    expect(screen.queryByRole("button", { name: "Add" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /add an account/i })).toHaveAttribute("href", "/plan");
  });
});

describe("forms do not keep stale input", () => {
  test("the transaction form is empty when reopened after a submit", () => {
    seedBudgets(TWO_BUDGETS);
    seedAccounts();
    render(
      <Providers>
        <TransactionHarness budgetIds={["a"]} />
      </Providers>
    );

    fireEvent.click(screen.getByText("open a"));
    fireEvent.change(screen.getByLabelText(/paid to/i), { target: { value: "Coffee" } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "4.50" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    fireEvent.click(screen.getByText("open a"));
    expect(screen.getByLabelText(/paid to/i)).toHaveValue("");
    expect(screen.getByLabelText(/amount/i)).toHaveValue("");
  });

  test("the transaction form is empty when reopened after a cancel", () => {
    seedBudgets(TWO_BUDGETS);
    seedAccounts();
    render(
      <Providers>
        <TransactionHarness budgetIds={["a"]} />
      </Providers>
    );

    fireEvent.click(screen.getByText("open a"));
    fireEvent.change(screen.getByLabelText(/paid to/i), { target: { value: "Abandoned" } });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    fireEvent.click(screen.getByText("open a"));
    expect(screen.getByLabelText(/paid to/i)).toHaveValue("");
  });

  test("the direction resets to money out on reopen", () => {
    seedBudgets(TWO_BUDGETS);
    seedAccounts();
    render(
      <Providers>
        <TransactionHarness budgetIds={["a"]} />
      </Providers>
    );

    fireEvent.click(screen.getByText("open a"));
    fireEvent.click(screen.getByRole("button", { name: "Money in" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    fireEvent.click(screen.getByText("open a"));
    // The toggle is state, not a form field, so `form.reset()` does not reach
    // it — the re-seed effect has to say so explicitly.
    expect(screen.getByLabelText(/category/i)).toBeInTheDocument();
  });

  test("the budget form is empty when reopened after a submit", () => {
    render(
      <Providers>
        <SimpleHarness Modal={AddBudgetModal} />
      </Providers>
    );

    fireEvent.click(screen.getByText("open"));
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Travel" } });
    fireEvent.change(screen.getByLabelText(/monthly estimate/i), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    fireEvent.click(screen.getByText("open"));
    expect(screen.getByLabelText(/name/i)).toHaveValue("");
  });
});

describe("duplicate budget names", () => {
  test("a clashing name reports the problem instead of closing silently", () => {
    seedBudgets([{ id: "a", name: "Groceries", max: 400 }]);
    render(
      <Providers>
        <SimpleHarness Modal={AddBudgetModal} />
      </Providers>
    );

    fireEvent.click(screen.getByText("open"));
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "groceries" } });
    fireEvent.change(screen.getByLabelText(/monthly estimate/i), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(screen.getByRole("alert")).toHaveTextContent(/already exists/i);
    // still open, with the typed name intact so it can be edited
    expect(screen.getByLabelText(/name/i)).toHaveValue("groceries");
    expect(JSON.parse(localStorage.getItem("budgets"))).toHaveLength(1);
  });

  test("a fresh name saves and closes", () => {
    seedBudgets([{ id: "a", name: "Groceries", max: 400 }]);
    render(
      <Providers>
        <SimpleHarness Modal={AddBudgetModal} />
      </Providers>
    );

    fireEvent.click(screen.getByText("open"));
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Travel" } });
    fireEvent.change(screen.getByLabelText(/monthly estimate/i), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("budgets"))).toHaveLength(2);
  });
});

describe("filing a new category under a group", () => {
  // Mirrors the page: the group the modal was opened from varies between
  // openings, which is the case a `defaultValue` on the select cannot serve.
  function GroupChoiceHarness({ groupIds }) {
    const [show, setShow] = useState(false);
    const [groupId, setGroupId] = useState();
    return (
      <>
        {groupIds.map((id) => (
          <button
            key={id ?? "header"}
            onClick={() => {
              setGroupId(id);
              setShow(true);
            }}
          >
            open {id ?? "header"}
          </button>
        ))}
        <AddBudgetModal
          show={show}
          defaultGroupId={groupId}
          handleClose={() => setShow(false)}
        />
      </>
    );
  }

  beforeEach(() => {
    localStorage.setItem(
      "budgetGroups",
      JSON.stringify([
        { id: "g1", name: "Fixed" },
        { id: "g2", name: "Variable" },
      ])
    );
  });

  test("the group preselects from where it was opened, and updates on reopen", () => {
    render(
      <Providers>
        <GroupChoiceHarness groupIds={["g1", "g2"]} />
      </Providers>
    );

    fireEvent.click(screen.getByText("open g1"));
    expect(screen.getByLabelText(/group/i)).toHaveValue("g1");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByText("open g2"));
    expect(screen.getByLabelText(/group/i)).toHaveValue("g2");
  });

  test("opening from the page header, or from a group since deleted, falls back to ungrouped", () => {
    render(
      <Providers>
        <GroupChoiceHarness groupIds={["gone", undefined]} />
      </Providers>
    );

    fireEvent.click(screen.getByText("open gone"));
    expect(screen.getByLabelText(/group/i)).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByText("open header"));
    expect(screen.getByLabelText(/group/i)).toHaveValue("");
  });

  test("the chosen group is stored as an id, and ungrouped as null", () => {
    render(
      <Providers>
        <GroupChoiceHarness groupIds={["g1", undefined]} />
      </Providers>
    );

    fireEvent.click(screen.getByText("open g1"));
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Rent" } });
    fireEvent.change(screen.getByLabelText(/monthly estimate/i), { target: { value: "1200" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    fireEvent.click(screen.getByText("open header"));
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Travel" } });
    fireEvent.change(screen.getByLabelText(/monthly estimate/i), { target: { value: "100" } });
    // The one optional figure on the form. Typed here and left blank above, so
    // both answers go through the same modal on the same open-and-close cycle.
    fireEvent.change(screen.getByLabelText(/goal/i), { target: { value: "3000" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    // "" is what the ungrouped option is worth in the DOM; it must not reach
    // storage, where it would be a group id matching nothing. The bucket is a
    // real one either way — the form arrives on the group's default and stores
    // whatever it is left showing, never a "same as my group" marker.
    expect(JSON.parse(localStorage.getItem("budgets"))).toEqual([
      {
        id: expect.any(String),
        name: "Rent",
        plannedCents: 120000,
        // Blank is no goal, not a goal of nothing — the only field on this form
        // where an empty box is an answer rather than an omission.
        goalCents: null,
        groupId: "g1",
        bucket: "essentials",
      },
      {
        id: expect.any(String),
        name: "Travel",
        plannedCents: 10000,
        goalCents: 300000,
        groupId: null,
        bucket: "essentials",
      },
    ]);
  });

  test("a goal typed into one category is not still in the box for the next", () => {
    render(
      <Providers>
        <GroupChoiceHarness groupIds={["g1", undefined]} />
      </Providers>
    );

    fireEvent.click(screen.getByText("open g1"));
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Car fund" } });
    fireEvent.change(screen.getByLabelText(/monthly estimate/i), { target: { value: "200" } });
    fireEvent.change(screen.getByLabelText(/goal/i), { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    // The modal never unmounts, so a figure left in an uncontrolled field is
    // still there on the next open — and a goal inherited by the next category
    // is one the user never set.
    fireEvent.click(screen.getByText("open header"));
    expect(screen.getByLabelText(/goal/i)).toHaveValue("");
  });
});

describe("the group modal adds and renames with one form", () => {
  function GroupHarness() {
    const [show, setShow] = useState(false);
    const [group, setGroup] = useState(null);
    return (
      <>
        <button
          onClick={() => {
            setGroup(null);
            setShow(true);
          }}
        >
          open new
        </button>
        <button
          onClick={() => {
            setGroup({ id: "g1", name: "Fixed" });
            setShow(true);
          }}
        >
          open rename
        </button>
        <AddGroupModal show={show} group={group} handleClose={() => setShow(false)} />
      </>
    );
  }

  test("renaming seeds the existing name, and adding afterwards starts empty", () => {
    localStorage.setItem("budgetGroups", JSON.stringify([{ id: "g1", name: "Fixed" }]));
    render(
      <Providers>
        <GroupHarness />
      </Providers>
    );

    fireEvent.click(screen.getByText("open rename"));
    expect(screen.getByLabelText(/name/i)).toHaveValue("Fixed");

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Essentials" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(JSON.parse(localStorage.getItem("budgetGroups"))).toEqual([
      { id: "g1", name: "Essentials", bucket: "essentials" },
    ]);

    // The rename left a name in the field; opening it to add must not offer it
    // back as a starting point.
    fireEvent.click(screen.getByText("open new"));
    expect(screen.getByLabelText(/name/i)).toHaveValue("");
  });

  test("a clashing name reports the problem instead of closing silently", () => {
    localStorage.setItem("budgetGroups", JSON.stringify([{ id: "g1", name: "Fixed" }]));
    render(
      <Providers>
        <GroupHarness />
      </Providers>
    );

    fireEvent.click(screen.getByText("open new"));
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "fixed" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(screen.getByRole("alert")).toHaveTextContent(/already exists/i);
    expect(JSON.parse(localStorage.getItem("budgetGroups"))).toHaveLength(1);
  });
});

describe("adding an income source", () => {
  test("the monthly average is previewed as the amount and cadence are set", () => {
    render(
      <Providers>
        <SimpleHarness Modal={AddIncomeSourceModal} />
      </Providers>
    );

    fireEvent.click(screen.getByText("open"));
    fireEvent.change(screen.getByLabelText(/amount per payment/i), { target: { value: "1500" } });

    // Monthly by default: what you type is what you get.
    expect(screen.getByRole("status")).toHaveTextContent("$1,500");

    // 26 payments over 12 months, not two a month — the figure the user did not
    // type has to be on screen before it reaches the plan.
    fireEvent.change(screen.getByLabelText(/how often/i), { target: { value: "biweekly" } });
    expect(screen.getByRole("status")).toHaveTextContent("$3,250");
  });

  test("the cadence resets to monthly on reopen, and so does the preview", () => {
    render(
      <Providers>
        <SimpleHarness Modal={AddIncomeSourceModal} />
      </Providers>
    );

    fireEvent.click(screen.getByText("open"));
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Salary" } });
    fireEvent.change(screen.getByLabelText(/amount per payment/i), { target: { value: "1500" } });
    fireEvent.change(screen.getByLabelText(/how often/i), { target: { value: "biweekly" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(JSON.parse(localStorage.getItem("incomeSources"))).toEqual([
      { id: expect.any(String), name: "Salary", amountCents: 150000, cadence: "biweekly" },
    ]);

    fireEvent.click(screen.getByText("open"));
    expect(screen.getByLabelText(/name/i)).toHaveValue("");
    expect(screen.getByLabelText(/how often/i)).toHaveValue("monthly");
    expect(screen.getByRole("status")).toHaveTextContent("$0");
  });
});

describe("adding an account", () => {
  // Mirrors the page: one modal, opened from either the on-budget panel or the
  // off-budget one, so the panel it was opened from varies between openings.
  // Asset or liability is chosen in the form, since either can sit in either
  // panel.
  function AccountHarness() {
    const [show, setShow] = useState(false);
    const [scope, setScope] = useState("on-budget");
    return (
      <>
        {["on-budget", "credit-card", "off-budget"].map((panel) => (
          <button
            key={panel}
            onClick={() => {
              setScope(panel);
              setShow(true);
            }}
          >
            open {panel}
          </button>
        ))}
        <AddAccountModal show={show} defaultScope={scope} handleClose={() => setShow(false)} />
      </>
    );
  }

  function renderHarness() {
    render(
      <Providers>
        <AccountHarness />
      </Providers>
    );
  }

  test("the scope preselects from the panel it was opened from, and updates on reopen", () => {
    renderHarness();

    fireEvent.click(screen.getByText("open on-budget"));
    expect(screen.getByLabelText(/budgeting/i)).toHaveValue("on-budget");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByText("open off-budget"));
    expect(screen.getByLabelText(/budgeting/i)).toHaveValue("off-budget");
  });

  test("the asset class is not asked, of an asset or of a debt", () => {
    renderHarness();

    fireEvent.click(screen.getByText("open on-budget"));
    expect(screen.getByLabelText(/kind/i)).toHaveValue("asset");
    expect(screen.queryByLabelText(/asset class/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/kind/i), { target: { value: "liability" } });
    expect(screen.queryByLabelText(/asset class/i)).not.toBeInTheDocument();
  });

  test("an asset's class is read off its scope, and a liability stores unclassified", () => {
    renderHarness();

    // An on-budget asset is cash: money the budget spends through.
    fireEvent.click(screen.getByText("open on-budget"));
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Everyday" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    // An off-budget asset: the 401(k) case this split exists for.
    fireEvent.click(screen.getByText("open off-budget"));
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Brokerage" } });
    fireEvent.change(screen.getByLabelText(/starting balance/i), { target: { value: "12000" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    // An on-budget liability: the card the groceries go on.
    fireEvent.click(screen.getByText("open on-budget"));
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Visa" } });
    fireEvent.change(screen.getByLabelText(/kind/i), { target: { value: "liability" } });
    fireEvent.change(screen.getByLabelText(/balance owed/i), { target: { value: "450" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(JSON.parse(localStorage.getItem("accounts"))).toEqual([
      {
        id: expect.any(String),
        name: "Everyday",
        type: "asset",
        scope: "on-budget",
        assetClass: "Cash",
        openingBalanceCents: 0,
        openingDate: todayISO(),
        reconciledOn: null,
      },
      {
        id: expect.any(String),
        name: "Brokerage",
        type: "asset",
        scope: "off-budget",
        assetClass: "Stocks",
        openingBalanceCents: 1200000,
        openingDate: todayISO(),
        // Never reconciled, not reconciled today: the figure the user just
        // typed from memory is the one most worth checking against a statement.
        reconciledOn: null,
      },
      {
        id: expect.any(String),
        name: "Visa",
        type: "liability",
        scope: "on-budget",
        assetClass: "Other",
        // Entered as the amount owed, stored as what it is worth. A debt
        // counted as an asset is the one mistake that silently doubles net
        // worth, so the sign is settled at the boundary rather than trusted.
        openingBalanceCents: -45000,
        openingDate: todayISO(),
        reconciledOn: null,
      },
    ]);
  });

  test("a credit card stops asking what kind of account it is, and stores a debt", () => {
    renderHarness();

    fireEvent.click(screen.getByText("open credit-card"));
    // Picking the card answers the kind question, so the question goes away —
    // leaving it on screen would offer a combination the store refuses.
    expect(screen.queryByLabelText(/kind/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/asset class/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Visa" } });
    fireEvent.change(screen.getByLabelText(/balance owed/i), { target: { value: "450" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(JSON.parse(localStorage.getItem("accounts"))[0]).toMatchObject({
      name: "Visa",
      type: "liability",
      scope: "credit-card",
      assetClass: "Other",
      openingBalanceCents: -45000,
    });
  });

  test("switching away from a card puts the kind question back on its default", () => {
    renderHarness();

    fireEvent.click(screen.getByText("open on-budget"));
    fireEvent.change(screen.getByLabelText(/kind/i), { target: { value: "liability" } });
    expect(screen.getByLabelText(/balance owed/i)).toBeInTheDocument();

    // The select is unmounted while the card is chosen and comes back holding
    // its default, so what the form thinks was chosen has to come back with it.
    fireEvent.change(screen.getByLabelText(/budgeting/i), { target: { value: "credit-card" } });
    fireEvent.change(screen.getByLabelText(/budgeting/i), { target: { value: "on-budget" } });

    expect(screen.getByLabelText(/kind/i)).toHaveValue("asset");
    expect(screen.getByLabelText(/starting balance/i)).toBeInTheDocument();
  });

  test("an account with no starting balance opens at zero rather than being refused", () => {
    renderHarness();

    fireEvent.click(screen.getByText("open on-budget"));
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Everyday" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("accounts"))[0].openingBalanceCents).toBe(0);
  });

  test("the form does not keep the previous account", () => {
    renderHarness();

    fireEvent.click(screen.getByText("open off-budget"));
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Brokerage" } });
    fireEvent.change(screen.getByLabelText(/starting balance/i), { target: { value: "12000" } });
    fireEvent.change(screen.getByLabelText(/kind/i), { target: { value: "liability" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    fireEvent.click(screen.getByText("open on-budget"));
    expect(screen.getByLabelText(/^name$/i)).toHaveValue("");
    expect(screen.getByLabelText(/starting balance/i)).toHaveValue("");
    // The selects are re-seeded through their refs: `defaultValue` on a modal
    // that never unmounts only ever applies once.
    expect(screen.getByLabelText(/kind/i)).toHaveValue("asset");
    expect(screen.getByLabelText(/budgeting/i)).toHaveValue("on-budget");
    expect(screen.getByLabelText(/balance as of/i)).toHaveValue(todayISO());
  });

  test("an account saved before scopes and opening balances existed reads back whole", () => {
    localStorage.setItem(
      "accounts",
      JSON.stringify([
        { id: "a1", name: "Everyday", type: "asset", assetClass: "Cash", institution: "Bendigo" },
      ])
    );
    renderHarness();

    // Adding writes the whole list back, so the migrated record is what lands.
    fireEvent.click(screen.getByText("open off-budget"));
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "401(k)" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(JSON.parse(localStorage.getItem("accounts"))[0]).toEqual({
      id: "a1",
      name: "Everyday",
      type: "asset",
      scope: "on-budget",
      assetClass: "Cash",
      // The institution it was saved with is dropped rather than carried
      // forward: the field is gone, and a record still holding one would leave
      // storage half on each side of the change.
      // Opens at zero on an unknown date. Backfilling what it holds today would
      // put money in the pool the user never said they had.
      openingBalanceCents: 0,
      openingDate: null,
      // Same rule for the same reason: an account that predates reconciliation
      // has never been reconciled, rather than having been at the moment the
      // field appeared.
      reconciledOn: null,
    });
  });

  test("a clashing name reports the problem instead of closing silently", () => {
    localStorage.setItem(
      "accounts",
      JSON.stringify([
        {
          id: "a1",
          name: "Everyday",
          type: "asset",
          scope: "on-budget",
          assetClass: "Cash",
        },
      ])
    );
    renderHarness();

    fireEvent.click(screen.getByText("open on-budget"));
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "everyday" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(screen.getByRole("alert")).toHaveTextContent(/already exists/i);
    expect(screen.getByLabelText(/^name$/i)).toHaveValue("everyday");
    expect(JSON.parse(localStorage.getItem("accounts"))).toHaveLength(1);
  });
});

describe("editing an account", () => {
  // The same modal the panels add through, opened on a row instead. Which job it
  // is doing is the `account` prop, so the harness has to be able to go back and
  // forth between them and between one account and the next: a form that keeps
  // what the last opening put in it is the whole class of bug this shape exists
  // to catch, and here it would rename the wrong account.
  function EditHarness() {
    const [show, setShow] = useState(false);
    const [account, setAccount] = useState(null);
    const { accounts } = useAccounts();
    return (
      <>
        <button
          onClick={() => {
            setAccount(null);
            setShow(true);
          }}
        >
          add
        </button>
        {accounts.map((existing) => (
          <button
            key={existing.id}
            onClick={() => {
              setAccount(existing);
              setShow(true);
            }}
          >
            edit {existing.name}
          </button>
        ))}
        <AddAccountModal show={show} account={account} handleClose={() => setShow(false)} />
      </>
    );
  }

  // One of each shape the form has to seed: an everyday account, a card, a
  // hand-valued holding with a class of its own, and a debt that is only
  // watched.
  function renderHarness() {
    seedAccounts([
      { id: "a1", name: "Everyday", openingBalanceCents: 250000 },
      {
        id: "a2",
        name: "Visa",
        type: "liability",
        scope: "credit-card",
        assetClass: "Other",
        openingBalanceCents: -45000,
      },
      {
        id: "a3",
        name: "Brokerage",
        scope: "off-budget",
        assetClass: "Stocks",
        openingBalanceCents: 1200000,
      },
      {
        id: "a4",
        name: "Mortgage",
        type: "liability",
        scope: "off-budget",
        assetClass: "Other",
        openingBalanceCents: -30000000,
        openingDate: "2021-06-01",
      },
    ]);
    render(
      <Providers>
        <EditHarness />
      </Providers>
    );
  }

  const stored = (id) =>
    JSON.parse(localStorage.getItem("accounts")).find((account) => account.id === id);

  test("the form opens holding the account, with a debt shown as the amount owed", () => {
    renderHarness();

    fireEvent.click(screen.getByText("edit Mortgage"));

    expect(screen.getByLabelText(/^name$/i)).toHaveValue("Mortgage");
    expect(screen.getByLabelText(/budgeting/i)).toHaveValue("off-budget");
    expect(screen.getByLabelText(/kind/i)).toHaveValue("liability");
    // Stored at -$300,000 and asked for as what is owed, the way a statement
    // reads it — the same conversion the monthly update and the backfill grid
    // apply, so the three cannot come to disagree about which way it points.
    expect(screen.getByLabelText(/balance owed/i)).toHaveValue("300000.00");
    expect(screen.getByLabelText(/balance as of/i)).toHaveValue("2021-06-01");
    expect(screen.queryByLabelText(/asset class/i)).not.toBeInTheDocument();
  });

  test("a rename lands and moves nothing else about the account", () => {
    renderHarness();

    fireEvent.click(screen.getByText("edit Everyday"));
    fireEvent.change(screen.getByLabelText(/^name$/i), {
      target: { value: "Everyday checking" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // The same record under a new name, not a second account: renaming through
    // delete-and-re-add would take the account's balance history with it.
    expect(JSON.parse(localStorage.getItem("accounts"))).toHaveLength(4);
    expect(stored("a1")).toEqual({
      id: "a1",
      name: "Everyday checking",
      type: "asset",
      scope: "on-budget",
      assetClass: "Cash",
      openingBalanceCents: 250000,
      openingDate: null,
      reconciledOn: null,
    });
  });

  test("a retyped balance replaces the stored one rather than being swallowed by it", () => {
    renderHarness();

    // The figure on the record would otherwise stand in front of the string the
    // form just sent, and the edit would be taken and quietly discarded.
    fireEvent.click(screen.getByText("edit Everyday"));
    fireEvent.change(screen.getByLabelText(/starting balance/i), { target: { value: "900" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(stored("a1").openingBalanceCents).toBe(90000);

    // And a debt is signed on the way back in, as it was on the way out.
    fireEvent.click(screen.getByText("edit Mortgage"));
    fireEvent.change(screen.getByLabelText(/balance owed/i), { target: { value: "250000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(stored("a4").openingBalanceCents).toBe(-25000000);
  });

  test("a card moved on budget stays a debt", () => {
    renderHarness();

    fireEvent.click(screen.getByText("edit Visa"));
    // The card answered the kind question, so it was not asked.
    expect(screen.queryByLabelText(/kind/i)).not.toBeInTheDocument();

    // Moving it off the card scope puts the question back — holding the
    // account's own answer, not the form's default. Coming back as an asset
    // would flip the sign of the balance and add the debt to net worth.
    fireEvent.change(screen.getByLabelText(/budgeting/i), { target: { value: "on-budget" } });
    expect(screen.getByLabelText(/kind/i)).toHaveValue("liability");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(stored("a2")).toMatchObject({
      scope: "on-budget",
      type: "liability",
      openingBalanceCents: -45000,
    });
  });

  test("an account keeps its own name, and a clash with another is reported", () => {
    renderHarness();

    // Saving a record unchanged must not read as clashing with itself.
    fireEvent.click(screen.getByText("edit Brokerage"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("edit Brokerage"));
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "everyday" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("alert")).toHaveTextContent(/already exists/i);
    expect(screen.getByLabelText(/^name$/i)).toHaveValue("everyday");
    expect(stored("a3").name).toBe("Brokerage");
  });

  test("an asset keeps the class it already had, and one turned into a debt drops it", () => {
    renderHarness();

    // Nothing on the form asks for the class any more, so saving a brokerage
    // must not quietly refile it — and a debt turned into an asset takes the
    // class its scope implies, since it never had one of its own.
    fireEvent.click(screen.getByText("edit Brokerage"));
    fireEvent.change(screen.getByLabelText(/budgeting/i), { target: { value: "on-budget" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(stored("a3")).toMatchObject({ scope: "on-budget", assetClass: "Stocks" });

    fireEvent.click(screen.getByText("edit Mortgage"));
    fireEvent.change(screen.getByLabelText(/kind/i), { target: { value: "asset" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(stored("a4")).toMatchObject({ type: "asset", assetClass: "Stocks" });

    fireEvent.click(screen.getByText("edit Brokerage"));
    fireEvent.change(screen.getByLabelText(/kind/i), { target: { value: "liability" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(stored("a3")).toMatchObject({ type: "liability", assetClass: "Other" });
  });

  test("each opening re-seeds from what it was opened on", () => {
    renderHarness();

    fireEvent.click(screen.getByText("edit Mortgage"));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    fireEvent.click(screen.getByText("edit Brokerage"));
    expect(screen.getByLabelText(/budgeting/i)).toHaveValue("off-budget");
    expect(screen.getByLabelText(/starting balance/i)).toHaveValue("12000.00");

    // And adding after editing is a blank form again, on the defaults.
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByText("add"));
    expect(screen.getByLabelText(/^name$/i)).toHaveValue("");
    expect(screen.getByLabelText(/budgeting/i)).toHaveValue("on-budget");
    expect(screen.getByLabelText(/kind/i)).toHaveValue("asset");
    expect(screen.getByLabelText(/starting balance/i)).toHaveValue("");
    expect(screen.getByLabelText(/balance as of/i)).toHaveValue(todayISO());
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
  });
});

describe("recording a transfer", () => {
  const CHECKING = { id: "acc1", name: "Everyday", openingBalanceCents: 100000 };
  const CARD = {
    id: "acc2",
    name: "Visa",
    type: "liability",
    scope: "credit-card",
    assetClass: "Other",
    openingBalanceCents: -20000,
  };
  const HOLDING = {
    id: "acc3",
    name: "401(k)",
    scope: "off-budget",
    assetClass: "Stocks",
    openingBalanceCents: 1000000,
  };

  function openHarness(accounts = [CHECKING, CARD, HOLDING]) {
    seedBudgets(TWO_BUDGETS);
    seedAccounts(accounts);
    render(
      <Providers>
        <TransactionHarness budgetIds={["a"]} />
      </Providers>
    );
    fireEvent.click(screen.getByText("open a"));
    fireEvent.click(screen.getByRole("button", { name: "Transfer" }));
  }

  test("both ends are asked for, and a holding is on offer on each", () => {
    openHarness();

    // The one form where an off-budget account belongs: nobody logs each tick of a
    // 401(k), but everybody knows when they paid into one.
    expect(screen.getByLabelText(/^from$/i)).toBeInTheDocument();
    const to = screen.getByLabelText(/^to$/i);
    expect(within(to).getByRole("option", { name: /401\(k\)/ })).toBeInTheDocument();
    // And never itself, since the store refuses a transfer that names one account
    // twice and a form should not offer what cannot be saved.
    expect(within(to).queryByRole("option", { name: /Everyday/ })).not.toBeInTheDocument();
  });

  test("a card payment is stored with no category, because it costs the plan nothing", () => {
    openHarness();

    // Both accounts are ones the budget spends through, so there is nothing to
    // file it under and the form does not pretend otherwise.
    expect(screen.queryByLabelText(/comes out of/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: "Card payment" } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "200" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(JSON.parse(localStorage.getItem("transactions"))).toEqual([
      {
        id: expect.any(String),
        kind: "transfer",
        // A transfer moves money between the household's own accounts, so there
        // is nobody it went to — and the form asks for a description rather than
        // a payee for exactly that reason.
        payeeId: null,
        description: "Card payment",
        amountCents: 20000,
        date: todayISO(),
        accountId: "acc1",
        toAccountId: "acc2",
        splits: null,
        budgetId: null,
      },
    ]);
  });

  test("pointing it at a holding is what asks for a category", () => {
    openHarness();

    fireEvent.change(screen.getByLabelText(/^to$/i), { target: { value: "acc3" } });

    const category = screen.getByLabelText(/comes out of/i);
    // Blank rather than the first category: which savings category a contribution
    // comes out of is exactly what the app cannot guess.
    expect(category).toHaveValue("");

    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "500" } });
    fireEvent.change(category, { target: { value: "b" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(JSON.parse(localStorage.getItem("transactions"))[0]).toMatchObject({
      kind: "transfer",
      accountId: "acc1",
      toAccountId: "acc3",
      budgetId: "b",
      amountCents: 50000,
    });
  });

  test("money leaving the budget with no category is refused before anything is written", () => {
    openHarness();

    fireEvent.change(screen.getByLabelText(/^to$/i), { target: { value: "acc3" } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    // The rule the store cannot check, enforced where the scopes are in hand — and
    // nothing lands, so the form stays open on what was typed.
    expect(screen.getByRole("alert")).toHaveTextContent(/comes out of a category/i);
    expect(JSON.parse(localStorage.getItem("transactions"))).toEqual([]);
    // Still open on what was typed, so the figure does not have to be re-entered.
    expect(screen.getByLabelText(/amount/i)).toHaveValue("500");
  });

  test("choosing the source the destination already holds moves the destination", () => {
    openHarness();

    // Everyday → Visa to start with. Making Visa the source cannot leave it as the
    // destination too, so the destination has to give way.
    fireEvent.change(screen.getByLabelText(/^from$/i), { target: { value: "acc2" } });

    expect(screen.getByLabelText(/^from$/i)).toHaveValue("acc2");
    expect(screen.getByLabelText(/^to$/i)).not.toHaveValue("acc2");
  });

  test("switching back to money out drops an off-budget account it could not offer", () => {
    openHarness();

    fireEvent.change(screen.getByLabelText(/^from$/i), { target: { value: "acc3" } });
    fireEvent.click(screen.getByRole("button", { name: "Money out" }));

    // "Paid from" offers only the accounts the budget spends through, so a holding
    // left selected would be a name that is not in its own list.
    expect(screen.getByLabelText(/paid from/i)).toHaveValue("acc1");
  });

  test("a second opening starts clean rather than on the last transfer", () => {
    openHarness();

    fireEvent.change(screen.getByLabelText(/^to$/i), { target: { value: "acc3" } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "500" } });
    fireEvent.change(screen.getByLabelText(/comes out of/i), { target: { value: "b" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    fireEvent.click(screen.getByText("open a"));

    // Back to money out, with nothing of the transfer left behind — the modal
    // never unmounts, so this is the re-seed effect and not React.
    expect(screen.getByLabelText(/paid to/i)).toHaveValue("");
    expect(screen.getByLabelText(/amount/i)).toHaveValue("");
    expect(screen.queryByLabelText(/^to$/i)).not.toBeInTheDocument();
  });

  test("one account is not enough to transfer between, and the form says so", () => {
    openHarness([CHECKING]);

    expect(screen.getByText(/only one so far/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add" })).not.toBeInTheDocument();
  });
});

describe("dividing a receipt as it is entered", () => {
  function openForm() {
    seedBudgets(TWO_BUDGETS);
    seedAccounts();
    render(
      <Providers>
        <TransactionHarness budgetIds={["a"]} />
      </Providers>
    );
    fireEvent.click(screen.getByText("open a"));
  }

  const type = (label, value) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } });

  test("the single category gives way to parts, seeded with the answer already given", () => {
    openForm();
    type(/amount/i, "124");
    fireEvent.click(screen.getByRole("button", { name: /split it between categories/i }));

    // Carried across rather than starting blank: the category picked and the
    // whole amount against it, which is what the record already says. Typing
    // this part down is what makes the rest appear as still to place.
    expect(screen.getByLabelText("Category of part 1")).toHaveValue("a");
    expect(screen.getByLabelText("Amount of part 1")).toHaveValue("$124");
    expect(screen.queryByLabelText("Category")).not.toBeInTheDocument();
  });

  test("a part added takes whatever is left over", () => {
    openForm();
    type(/amount/i, "124");
    fireEvent.click(screen.getByRole("button", { name: /split it between categories/i }));
    type("Amount of part 1", "100");
    fireEvent.click(screen.getByRole("button", { name: "Add a part" }));

    expect(screen.getByLabelText("Amount of part 2")).toHaveValue("$24");
  });

  test("the whole receipt lands in one write, divided", () => {
    openForm();
    type(/paid to/i, "Costco");
    type(/amount/i, "124");
    fireEvent.click(screen.getByRole("button", { name: /split it between categories/i }));
    type("Amount of part 1", "100");
    fireEvent.click(screen.getByRole("button", { name: "Add a part" }));
    type("Category of part 2", "b");
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(JSON.parse(localStorage.getItem("transactions"))).toEqual([
      {
        id: expect.any(String),
        kind: "outflow",
        // The payee came into being on submit alongside the division, which is
        // what makes this one write from the user's side.
        payeeId: expect.any(String),
        description: "",
        amountCents: 12400,
        date: todayISO(),
        accountId: "acc1",
        toAccountId: null,
        // Null while the parts carry the answer — it is what the record falls
        // back to if the division is ever undone, and this one never had a
        // single category to fall back to.
        budgetId: null,
        splits: [
          { id: expect.any(String), budgetId: "a", amountCents: 10000 },
          { id: expect.any(String), budgetId: "b", amountCents: 2400 },
        ],
      },
    ]);
  });

  test("parts that do not add up stop the write, and say how far off they are", () => {
    openForm();
    type(/amount/i, "124");
    fireEvent.click(screen.getByRole("button", { name: /split it between categories/i }));
    type("Amount of part 1", "100");
    fireEvent.click(screen.getByRole("button", { name: "Add a part" }));
    type("Category of part 2", "b");
    type("Amount of part 2", "10");
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    // Nothing lands, so the receipt is never in the ledger filed under nothing —
    // and the message has the figure in it, which the store's own cannot.
    expect(screen.getByRole("alert")).toHaveTextContent("$14 short of the $124 total");
    expect(JSON.parse(localStorage.getItem("transactions"))).toEqual([]);
  });

  test("a part with no category is refused before anything is written", () => {
    openForm();
    type(/amount/i, "124");
    fireEvent.click(screen.getByRole("button", { name: /split it between categories/i }));
    type("Amount of part 1", "100");
    fireEvent.click(screen.getByRole("button", { name: "Add a part" }));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    // The new part came in holding the $24 but nobody has said where it goes,
    // and a prompt is what its select shows rather than the first category.
    expect(screen.getByLabelText("Category of part 2")).toHaveValue("");
    expect(screen.getByRole("alert")).toHaveTextContent(/names the category/i);
    expect(JSON.parse(localStorage.getItem("transactions"))).toEqual([]);
  });

  test("a second opening is back to one category, with no parts left behind", () => {
    openForm();
    type(/amount/i, "124");
    fireEvent.click(screen.getByRole("button", { name: /split it between categories/i }));
    fireEvent.click(screen.getByLabelText("Close"));
    fireEvent.click(screen.getByText("open a"));

    // The modal never unmounts, so this is the re-seed effect and not React.
    expect(screen.queryByLabelText("Amount of part 1")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Category")).toBeInTheDocument();
  });
});

describe("entering one after another", () => {
  const CHECKING = { id: "acc1", name: "Everyday", openingBalanceCents: 100000 };
  const CARD = {
    id: "acc2",
    name: "Visa",
    type: "liability",
    scope: "credit-card",
    assetClass: "Other",
    openingBalanceCents: -20000,
  };
  const SAVINGS = { id: "acc3", name: "Savings", openingBalanceCents: 50000 };

  function openHarness() {
    seedBudgets(TWO_BUDGETS);
    seedAccounts([CHECKING, CARD, SAVINGS]);
    render(
      <Providers>
        <TransactionHarness budgetIds={["a"]} />
      </Providers>
    );
    fireEvent.click(screen.getByText("open a"));
  }

  test("save and add another records it, keeps the form open, and clears the receipt", () => {
    openHarness();

    fireEvent.change(screen.getByLabelText(/paid from/i), { target: { value: "acc2" } });
    fireEvent.change(screen.getByLabelText(/paid to/i), { target: { value: "Corner Shop" } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "12.50" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and add another" }));

    const stored = JSON.parse(localStorage.getItem("transactions"));
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ amountCents: 1250, accountId: "acc2", budgetId: "a" });

    // Still open, saying what landed, on the same account — with the parts that
    // belong to one receipt gone.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Added $12.50 — Corner Shop");
    expect(screen.getByLabelText(/amount/i)).toHaveValue("");
    expect(screen.getByLabelText(/paid to/i)).toHaveValue("");
    expect(screen.getByLabelText(/paid from/i)).toHaveValue("acc2");
    expect(screen.getByLabelText(/^date$/i)).toHaveValue(todayISO());

    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(JSON.parse(localStorage.getItem("transactions"))).toHaveLength(2);
  });

  test("it opens on the account last used, and a transfer on the pair last used", () => {
    openHarness();

    fireEvent.change(screen.getByLabelText(/paid from/i), { target: { value: "acc2" } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    fireEvent.click(screen.getByText("open a"));
    expect(screen.getByLabelText(/paid from/i)).toHaveValue("acc2");

    fireEvent.click(screen.getByRole("button", { name: "Transfer" }));
    fireEvent.change(screen.getByLabelText(/^from$/i), { target: { value: "acc1" } });
    fireEvent.change(screen.getByLabelText(/^to$/i), { target: { value: "acc3" } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(JSON.parse(localStorage.getItem("transactions"))[1]).toMatchObject({
      kind: "transfer",
      accountId: "acc1",
      toAccountId: "acc3",
    });

    // Spending still opens on the card — a transfer is not where spending
    // habits are read from.
    fireEvent.click(screen.getByText("open a"));
    expect(screen.getByLabelText(/paid from/i)).toHaveValue("acc2");
  });
});

describe("reminding about card offers", () => {
  const monthStart = `${todayISO().slice(0, 8)}01`;
  const OFFER = {
    id: "o1",
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
  };

  function openWith(transactions = []) {
    seedBudgets([
      { id: "groceries", name: "Groceries", plannedCents: 0 },
      { id: "dining", name: "Dining out", plannedCents: 0 },
    ]);
    seedAccounts([
      { id: "chk", name: "Checking" },
      { id: "card", name: "Sapphire", type: "liability", scope: "credit-card", assetClass: "Other" },
    ]);
    localStorage.setItem("transactions", JSON.stringify(transactions));
    localStorage.setItem("assignments", "[]");
    localStorage.setItem("rewardsOffers", JSON.stringify([OFFER]));
    render(
      <Providers>
        <TransactionHarness budgetIds={["groceries"]} />
      </Providers>
    );
    fireEvent.click(screen.getByText("open groceries"));
  }

  const reminder = () => screen.queryByRole("list", { name: "Card offers", hidden: true });

  test("nothing is said until the purchase matches a running offer", () => {
    openWith();
    fireEvent.change(screen.getByLabelText(/paid from/i), { target: { value: "chk" } });
    expect(reminder()).toBeNull();

    fireEvent.change(screen.getByLabelText(/^category$/i), { target: { value: "dining" } });
    expect(reminder()).toHaveTextContent(
      "“9% on dining” on Sapphire has $1,000 of room left — this would count there."
    );
  });

  test("on the offer's own card it says what the purchase leaves, and when it fills the cap", () => {
    openWith([
      {
        id: "t1",
        kind: "outflow",
        accountId: "card",
        budgetId: "dining",
        amountCents: 70000,
        date: todayISO(),
        description: "",
        payeeId: null,
        toAccountId: null,
        splits: null,
      },
    ]);
    fireEvent.change(screen.getByLabelText(/paid from/i), { target: { value: "card" } });
    fireEvent.change(screen.getByLabelText(/^category$/i), { target: { value: "dining" } });
    expect(reminder()).toHaveTextContent("Counts towards “9% on dining” — $300 of room left.");

    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "120" } });
    expect(reminder()).toHaveTextContent("$180 of room left after this.");

    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "350" } });
    expect(reminder()).toHaveTextContent(
      "This fills “9% on dining”; $50 of it goes past the limit, at the card's ordinary rate."
    );
  });

  test("a purchase dated outside the offer is not reminded about", () => {
    openWith();
    fireEvent.change(screen.getByLabelText(/^category$/i), { target: { value: "dining" } });
    expect(reminder()).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2020-01-01" } });
    expect(reminder()).toBeNull();
  });
});
