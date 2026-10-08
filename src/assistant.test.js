import {
  ASSIST_ACTIONS,
  POOL_NAME,
  buildAssistRequest,
  findPayee,
  readDatePhrase,
  resolveReading,
  usualCategory,
} from "./assistant";
import { TO_BE_ASSIGNED } from "./contexts/constants";

/**
 * The assistant's two plain halves: what is sent, and what the reply means.
 *
 * No model anywhere in this suite — the model's reply is written out as the
 * object it would be, which is the whole point of the split: everything that
 * decides what lands in a form is here, and it is ordinary code. Every date is
 * a real day written out, `paySchedule.test.js`'s rule, because the weekday is
 * what is under test. 2026-10-08 is a Thursday.
 */

const TODAY = "2026-10-08";

const budgets = [
  { id: "groc", name: "Groceries" },
  { id: "dine", name: "Dining out" },
  { id: "home", name: "Household" },
];

const accounts = [
  { id: "chk", name: "Checking", scope: "on-budget" },
  { id: "visa", name: "Visa", scope: "credit-card" },
  { id: "k401", name: "401(k)", scope: "off-budget" },
];

const payees = [
  { id: "costco", name: "Costco Wholesale", defaultBudgetId: null },
  { id: "amzn", name: "Amazon", defaultBudgetId: null },
  { id: "cafe", name: "Corner Cafe", defaultBudgetId: "dine" },
];

const books = { budgets, accounts, payees, transactions: [], today: TODAY };

const reading = (fields) => ({
  action: ASSIST_ACTIONS.ADD,
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

describe("readDatePhrase", () => {
  test.each([
    ["today", "2026-10-08"],
    ["yesterday", "2026-10-07"],
    ["day before yesterday", "2026-10-06"],
    ["3 days ago", "2026-10-05"],
    ["a week ago", "2026-10-01"],
    // A bare weekday is the most recent one, today included…
    ["thursday", "2026-10-08"],
    ["monday", "2026-10-05"],
    ["on fri", "2026-10-02"],
    // …and "last" reaches past today.
    ["last thursday", "2026-10-01"],
    ["last monday", "2026-10-05"],
    ["2026-09-30", "2026-09-30"],
    ["9/30", "2026-09-30"],
    ["9/30/25", "2025-09-30"],
    ["Oct 3", "2026-10-03"],
    ["October 3rd, 2025", "2025-10-03"],
    ["3 oct", "2026-10-03"],
    ["the 3rd of october", "2026-10-03"],
  ])("%s → %s", (phrase, expected) => {
    expect(readDatePhrase(phrase, TODAY)).toBe(expected);
  });

  test.each(["", null, "soon", "2026-02-30", "13/1", "feb 30", "mo"])(
    "%p is not a date it will invent",
    (phrase) => {
      expect(readDatePhrase(phrase, TODAY)).toBeNull();
    }
  );

  test("steps across a month end on the local calendar", () => {
    expect(readDatePhrase("yesterday", "2026-03-01")).toBe("2026-02-28");
  });
});

describe("buildAssistRequest", () => {
  test("offers only the household's own categories and accounts, or none", () => {
    const { schema, messages } = buildAssistRequest({ text: "  coffee 4  ", today: TODAY, ...books });

    expect(schema.properties.category.anyOf[0].enum).toEqual([
      POOL_NAME,
      "Groceries",
      "Dining out",
      "Household",
    ]);
    expect(schema.properties.category.anyOf[1]).toEqual({ type: "null" });
    expect(schema.properties.account.anyOf[0].enum).toEqual(["Checking", "Visa", "401(k)"]);
    expect(schema.required).toEqual(Object.keys(schema.properties));

    expect(messages[0].content).toContain("Today is 2026-10-08.");
    expect(messages[0].content).toContain("- Costco Wholesale");
    expect(messages[1]).toEqual({ role: "user", content: "coffee 4" });
  });

  test("an empty list is a field that can only be null, not an empty enum", () => {
    const { schema } = buildAssistRequest({ text: "x", budgets: [], accounts: [], payees: [] });
    expect(schema.properties.account).toEqual({ type: "null" });
  });
});

describe("findPayee", () => {
  test("exact by identity, then a prefix long enough to mean something", () => {
    expect(findPayee(payees, "amazon")).toEqual({ payee: payees[1], matched: false });
    expect(findPayee(payees, "costco")).toEqual({ payee: payees[0], matched: true });
    expect(findPayee(payees, "co")).toEqual({ payee: null });
    // Inside a name is not enough — "cafe" is somewhere in "Corner Cafe" but is
    // not the start of anything.
    expect(findPayee(payees, "cafe")).toEqual({ payee: null });
  });
});

describe("usualCategory", () => {
  test("is the category the payee's spending is most often filed under", () => {
    const live = new Set(["groc", "home"]);
    const transactions = [
      { payeeId: "costco", kind: "outflow", budgetId: "groc" },
      { payeeId: "costco", kind: "outflow", budgetId: "home" },
      { payeeId: "costco", kind: "outflow", budgetId: "groc" },
      // Not evidence: income, a division, a deleted category, the catch-all.
      { payeeId: "costco", kind: "inflow", budgetId: "home" },
      { payeeId: "costco", kind: "outflow", budgetId: "home", splits: [{}] },
      { payeeId: "costco", kind: "outflow", budgetId: "gone" },
      { payeeId: "costco", kind: "outflow", budgetId: "Uncategorized" },
    ];
    expect(usualCategory("costco", transactions, live)).toBe("groc");
    expect(usualCategory("amzn", transactions, live)).toBeNull();
  });
});

describe("resolveReading — add a transaction", () => {
  test("names become ids, the figure cents, and the phrase a date", () => {
    const result = resolveReading(
      reading({
        amount: "$1,045.20",
        payee: "Amazon",
        category: "household",
        account: "visa",
        date: "yesterday",
        note: "  new kettle ",
      }),
      books
    );
    expect(result).toEqual({
      action: ASSIST_ACTIONS.ADD,
      draft: {
        kind: "outflow",
        amountCents: 104520,
        payeeId: "amzn",
        payeeName: "",
        budgetId: "home",
        accountId: "visa",
        toAccountId: null,
        date: "2026-10-07",
        description: "new kettle",
      },
      notes: [],
    });
  });

  test("a payee that is not one yet is carried as a name, and said", () => {
    const { draft, notes } = resolveReading(
      reading({ amount: "12", payee: "Joe's Pizza", category: "Dining out" }),
      books
    );
    expect(draft.payeeId).toBeNull();
    expect(draft.payeeName).toBe("Joe's Pizza");
    expect(notes).toEqual(["Joe's Pizza isn't a payee yet — it'll be added when you save."]);
  });

  test("with no category said, spending takes the payee's default, then its usual one", () => {
    const viaDefault = resolveReading(reading({ amount: "4", payee: "corner cafe" }), books);
    expect(viaDefault.draft.budgetId).toBe("dine");
    expect(viaDefault.notes).toEqual(["Filed under Dining out, where Corner Cafe usually goes."]);

    const viaHistory = resolveReading(reading({ amount: "80", payee: "costco" }), {
      ...books,
      transactions: [{ payeeId: "costco", kind: "outflow", budgetId: "groc" }],
    });
    expect(viaHistory.draft.budgetId).toBe("groc");
  });

  test("a name the books do not have is never turned into an id", () => {
    const { draft, notes } = resolveReading(
      reading({ amount: "4", category: "Coffee", account: "Savings", date: "someday" }),
      books
    );
    expect(draft).toMatchObject({ budgetId: null, accountId: null, date: null });
    expect(notes).toEqual([
      "There's no category called “Coffee”.",
      "No category was named — check the one the form picked.",
      "There's no on-budget account called “Savings”, so the form keeps the one you used last.",
      "Couldn't read “someday” as a date, so it's set to today.",
    ]);
  });

  test("spending cannot come out of an off-budget account; a transfer can", () => {
    const spend = resolveReading(reading({ amount: "4", category: "Groceries", account: "401(k)" }), books);
    expect(spend.draft.accountId).toBeNull();

    const transfer = resolveReading(
      reading({ kind: "transfer", amount: "500", payee: "Fidelity", account: "Checking", to_account: "401(k)" }),
      books
    );
    expect(transfer.draft).toMatchObject({
      kind: "transfer",
      accountId: "chk",
      toAccountId: "k401",
      // A transfer names nobody, whatever the model put in the field.
      payeeId: null,
      payeeName: "",
    });
  });

  test("a paycheque stays income — no category is borrowed from the payee", () => {
    const { draft, notes } = resolveReading(
      reading({ kind: "inflow", amount: "2400", payee: "Corner Cafe" }),
      books
    );
    expect(draft.budgetId).toBeNull();
    expect(notes).toEqual([]);
  });

  test("junk and zero are not an amount", () => {
    expect(resolveReading(reading({ amount: "lots" }), books).draft.amountCents).toBeNull();
    expect(resolveReading(reading({ amount: "0" }), books).draft.amountCents).toBeNull();
  });
});

describe("resolveReading — refile a payee's spending", () => {
  const transactions = [
    { id: "t1", payeeId: "amzn", kind: "outflow", budgetId: "groc", date: "2026-09-01", amountCents: 100 },
    { id: "t2", payeeId: "amzn", kind: "outflow", budgetId: "dine", date: "2026-10-01", amountCents: 200 },
    { id: "t3", payeeId: "amzn", kind: "outflow", budgetId: "home", date: "2026-08-01", amountCents: 300 },
    { id: "t4", payeeId: "amzn", kind: "inflow", budgetId: null, date: "2026-08-02", amountCents: 50 },
    {
      id: "t5",
      payeeId: "amzn",
      kind: "outflow",
      budgetId: null,
      splits: [{ id: "p", budgetId: "groc", amountCents: 1 }],
      date: "2026-08-03",
      amountCents: 1,
    },
    { id: "t6", payeeId: "costco", kind: "outflow", budgetId: "groc", date: "2026-08-04", amountCents: 1 },
  ];

  test("finds the payee's spending filed anywhere else, newest first", () => {
    const result = resolveReading(
      reading({ action: ASSIST_ACTIONS.RECATEGORIZE, payee: "amazon", to_category: "Household" }),
      { ...books, transactions }
    );
    expect(result.action).toBe(ASSIST_ACTIONS.RECATEGORIZE);
    expect(result.payee.id).toBe("amzn");
    expect(result.budget.id).toBe("home");
    // Not the inflow (that would turn income into a refund), not the division,
    // not what is already there, not another payee's.
    expect(result.candidates.map((entry) => entry.id)).toEqual(["t2", "t1"]);
  });

  test("narrows to the category named as the old one", () => {
    const result = resolveReading(
      reading({
        action: ASSIST_ACTIONS.RECATEGORIZE,
        payee: "Amazon",
        category: "Groceries",
        to_category: "Household",
      }),
      { ...books, transactions }
    );
    expect(result.candidates.map((entry) => entry.id)).toEqual(["t1"]);
  });

  test("an unknown payee or category is said, not guessed", () => {
    expect(
      resolveReading(reading({ action: ASSIST_ACTIONS.RECATEGORIZE, payee: "Etsy", to_category: "Household" }), books)
    ).toEqual({
      action: ASSIST_ACTIONS.UNKNOWN,
      error: "There's no payee called “Etsy”, so there is nothing to refile.",
    });
    expect(
      resolveReading(reading({ action: ASSIST_ACTIONS.RECATEGORIZE, payee: "Amazon", to_category: "Toys" }), books)
        .error
    ).toBe("There's no category called “Toys”.");
  });
});

describe("resolveReading — move money", () => {
  test("between two categories, or out of the pool", () => {
    expect(
      resolveReading(
        reading({ action: ASSIST_ACTIONS.MOVE, amount: "50", category: "dining out", to_category: "Groceries" }),
        books
      )
    ).toEqual({
      action: ASSIST_ACTIONS.MOVE,
      seed: { fromBudgetId: "dine", toBudgetId: "groc", amountCents: 5000 },
      notes: [],
    });

    expect(
      resolveReading(
        reading({ action: ASSIST_ACTIONS.MOVE, amount: "20", category: POOL_NAME, to_category: "Groceries" }),
        books
      ).seed.fromBudgetId
    ).toBe(TO_BE_ASSIGNED);
  });
});

test("anything else is unknown, and says what can be done", () => {
  expect(resolveReading({ action: "delete_everything" }, books).action).toBe(ASSIST_ACTIONS.UNKNOWN);
  expect(resolveReading(null, books).action).toBe(ASSIST_ACTIONS.UNKNOWN);
});
