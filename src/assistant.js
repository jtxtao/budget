import { TO_BE_ASSIGNED, UNCATEGORIZED_BUDGET_ID } from "./contexts/constants";
import { normalizePayeeName } from "./contexts/PayeesContext";
import { spendsThroughBudget } from "./contexts/AccountsContext";
import { matchPayees, searchKey } from "./payeeSearch";
import { addDays, isValidISODate, toCents, todayISO } from "./utils";

/**
 * The assistant, as arithmetic over the household's own lists.
 *
 * A pure module like `paySchedule.js` and `payeeSearch.js`: no React, no
 * bridge, no wording beyond the notes it hands back. It is the two halves of
 * the job that are not the model's:
 *
 *   ask     — what to send: the sentence, the household's names, and a schema
 *             the model's reply is constrained to (`buildAssistRequest`)
 *   resolve — what the reply means: every name looked up again here, against
 *             the live records, and turned into ids (`resolveReading`)
 *
 * **The model is trusted to read, never to decide.** Its reply is a set of
 * *names* — "Groceries", "Costco", "yesterday" — and every one of them is
 * matched here exactly as a person typing into the form would be matched, so a
 * name that is not a category cannot become a category id, and a date phrase
 * is read by the calendar rather than by a model that is bad at calendars. What
 * comes out is a draft for one of the app's ordinary forms, which a person
 * looks at before anything is written, with the ordinary store behind it.
 *
 * **Three things it can do, and one way of saying it cannot.** Record a
 * transaction (all three directions), refile a payee's spending under another
 * category, and move money between envelopes — the three everyday acts whose
 * forms already exist. Anything else is `unknown`, said as such, rather than
 * squeezed into the nearest of the three.
 */

export const ASSIST_ACTIONS = {
  ADD: "add_transaction",
  RECATEGORIZE: "recategorize",
  MOVE: "move_money",
  UNKNOWN: "unknown",
};

/** What the pool is called to the model, and in the move form. */
export const POOL_NAME = "To be assigned";

/** How many payees the model is shown — the most recently used, which is the order `orderPayeesByUse` hands over. */
const PAYEE_LIMIT = 150;

const nullable = (schema) => ({ anyOf: [schema, { type: "null" }] });
const oneOf = (names) => (names.length ? nullable({ enum: names }) : { type: "null" });

/**
 * The names the model may answer with, de-duplicated.
 *
 * Two categories called the same thing cannot be told apart by name, so the
 * schema offers the name once and `resolveReading` takes the first — the same
 * thing a person reading the list would do.
 */
function namesOf(records) {
  return [...new Set(records.map((record) => record.name).filter(Boolean))];
}

/**
 * What to send the model: `{ messages, schema }`.
 *
 * **The categories and accounts are enums in the schema**, so the model can
 * only answer with a name the household actually has — or null. Payees are not,
 * since a new one is a real answer; they go in the prompt instead, so "costco"
 * can be read as the "Costco Wholesale" already on the books.
 *
 * Today's date is given so the model can tell a date from a figure, but the
 * model is asked to pass the date back **as it was said** — "yesterday", "last
 * friday" — and `readDatePhrase` does the arithmetic.
 */
export function buildAssistRequest({ text, today = todayISO(), budgets, accounts, payees }) {
  const categoryNames = namesOf(budgets ?? []);
  const accountNames = namesOf(accounts ?? []);
  const payeeNames = namesOf((payees ?? []).slice(0, PAYEE_LIMIT));
  const envelopeNames = [POOL_NAME, ...categoryNames.filter((name) => name !== POOL_NAME)];

  const schema = {
    type: "object",
    properties: {
      action: { enum: Object.values(ASSIST_ACTIONS) },
      kind: nullable({ enum: ["outflow", "inflow", "transfer"] }),
      amount: nullable({ type: "string" }),
      payee: nullable({ type: "string" }),
      category: oneOf(envelopeNames),
      to_category: oneOf(envelopeNames),
      account: oneOf(accountNames),
      to_account: oneOf(accountNames),
      date: nullable({ type: "string" }),
      note: nullable({ type: "string" }),
    },
    required: [
      "action",
      "kind",
      "amount",
      "payee",
      "category",
      "to_category",
      "account",
      "to_account",
      "date",
      "note",
    ],
  };

  const list = (names) => (names.length ? names.map((name) => `- ${name}`).join("\n") : "(none yet)");

  const system = `You read one sentence from a household's budgeting app and turn it into JSON. You never invent anything: a field the sentence does not mention is null.

Today is ${today}.

Actions:
- "add_transaction": money was spent, received, or moved between two of the household's accounts.
  - kind "outflow" for spending, "inflow" for money received, "transfer" for moving money between two of their own accounts (paying a credit card, topping up savings).
  - amount: the figure as written, e.g. "45.20".
  - payee: who was paid or who paid them, as written. Prefer a known payee's exact spelling when the sentence clearly means one. Null for a transfer.
  - category: what the spending was for, only from the category list. For money received, a category only if it is a refund or someone paying them back; a paycheque has no category.
  - account: the account the money left (or arrived in, for money received), only from the account list. For a transfer, account is where it left and to_account is where it arrived.
  - date: exactly the words used for the day ("yesterday", "last friday", "oct 3"), or null if no day was said.
  - note: anything else worth keeping, briefly, or null.
- "recategorize": file a payee's spending under a different category ("put all the Amazon ones under Household"). payee is the payee, to_category is the new category, category is the old one only if the sentence names it.
- "move_money": move money between budget categories ("move 50 from dining out to groceries"). category is where it comes from, to_category where it goes, amount the figure. "${POOL_NAME}" is the unassigned money.
- "unknown": anything else, or a sentence too unclear to read.

Categories:
${list(categoryNames)}

Accounts:
${list(accountNames)}

Known payees:
${list(payeeNames)}`;

  return {
    messages: [
      { role: "system", content: system },
      { role: "user", content: String(text ?? "").trim() },
    ],
    schema,
  };
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

function monthIndex(word) {
  const key = word.toLowerCase().replace(/\.$/, "");
  if (key.length < 3) return -1;
  return MONTHS.findIndex((month) => month.startsWith(key));
}

function weekdayIndex(word) {
  const key = word.toLowerCase();
  if (key.length < 3) return -1;
  return WEEKDAYS.findIndex((day) => day.startsWith(key));
}

function weekdayOf(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day).getDay();
}

/** A real calendar day, or null — 2026-02-30 is not one. */
function dateFrom(year, month, day) {
  if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31)) return null;
  const date = new Date(year, month - 1, day);
  if (date.getMonth() !== month - 1) return null;
  return todayISO(date);
}

/**
 * A date as somebody says it, on the local calendar, or null for one it cannot
 * read.
 *
 * **Done here and not by the model**, because a model asked what "last friday"
 * is will cheerfully answer with a Thursday. A bare weekday is the most recent
 * one on or before today — "friday" said on a Friday is today, since a receipt
 * is nearly always for something that already happened — and "last friday"
 * reaches past today. Month-first for a slashed date, because `CURRENCY_LOCALE`
 * is en-US and the two have to agree. A date with no year is this year's.
 */
export function readDatePhrase(phrase, today = todayISO()) {
  if (phrase == null) return null;
  const text = String(phrase).trim().toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ");
  if (!text) return null;
  if (isValidISODate(text)) return dateFrom(...text.split("-").map(Number));

  if (text === "today" || text === "tonight" || text === "this morning") return today;
  if (text === "yesterday" || text === "last night") return addDays(today, -1);
  if (text === "day before yesterday" || text === "the day before yesterday") return addDays(today, -2);

  const ago = text.match(/^(\d{1,3}|a|one|two|three|four|five|six|seven) (day|days|week|weeks) ago$/);
  if (ago) {
    const words = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
    const count = words[ago[1]] ?? Number(ago[1]);
    return addDays(today, -count * (ago[2].startsWith("week") ? 7 : 1));
  }

  const weekday = text.match(/^(?:on )?(last |this past |past )?([a-z]+)$/);
  if (weekday && weekdayIndex(weekday[2]) >= 0) {
    const back = (weekdayOf(today) - weekdayIndex(weekday[2]) + 7) % 7;
    return addDays(today, weekday[1] && back === 0 ? -7 : -back);
  }

  const [thisYear] = today.split("-").map(Number);
  const fullYear = (y) => (y == null ? thisYear : y < 100 ? 2000 + y : y);

  const slashed = text.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2}|\d{4}))?$/);
  if (slashed) {
    return dateFrom(
      fullYear(slashed[3] == null ? null : Number(slashed[3])),
      Number(slashed[1]),
      Number(slashed[2])
    );
  }

  // "oct 3", "october 3rd 2026", "3 oct", "the 3rd of october"
  const cleaned = text.replace(/^(?:on )?(?:the )?/, "").replace(/(\d)(st|nd|rd|th)\b/g, "$1").replace(/ of /g, " ");
  const monthFirst = cleaned.match(/^([a-z.]+) (\d{1,2})(?: (\d{4}))?$/);
  if (monthFirst && monthIndex(monthFirst[1]) >= 0) {
    return dateFrom(
      fullYear(monthFirst[3] == null ? null : Number(monthFirst[3])),
      monthIndex(monthFirst[1]) + 1,
      Number(monthFirst[2])
    );
  }
  const dayFirst = cleaned.match(/^(\d{1,2}) ([a-z.]+)(?: (\d{4}))?$/);
  if (dayFirst && monthIndex(dayFirst[2]) >= 0) {
    return dateFrom(
      fullYear(dayFirst[3] == null ? null : Number(dayFirst[3])),
      monthIndex(dayFirst[2]) + 1,
      Number(dayFirst[1])
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** The record `name` names, by the same forgiving key payee search uses, or null. */
function byName(records, name) {
  if (name == null) return null;
  const key = searchKey(name);
  if (!key) return null;
  return (
    records.find((record) => normalizePayeeName(record.name) === normalizePayeeName(name)) ??
    records.find((record) => searchKey(record.name) === key) ??
    null
  );
}

/**
 * The payee a name means: `{ payee, matched }` where `matched` says the name
 * was not the payee's own spelling, or `{ payee: null }` for a name that is no
 * payee yet.
 *
 * Exact first, then the single best search match **only when it starts with
 * what was said** and what was said is long enough to mean something — "cost"
 * is Costco Wholesale, "co" is nothing in particular.
 */
export function findPayee(payees, name) {
  const exact = byName(payees ?? [], name);
  if (exact) return { payee: exact, matched: false };

  const key = searchKey(name);
  if (key.length < 3) return { payee: null };
  const { matches } = matchPayees(payees ?? [], name, { limit: 2 });
  const [best] = matches;
  if (!best || !searchKey(best.name).startsWith(key)) return { payee: null };
  return { payee: best, matched: true };
}

/**
 * The category a payee's spending is most often filed under, or null.
 *
 * Read off the ledger rather than asked of the model: it is a count, and the
 * household's own history is a better answer than any guess about what a shop
 * sells. Divided receipts and the Uncategorized catch-all are not evidence.
 */
export function usualCategory(payeeId, transactions, liveBudgetIds) {
  if (!payeeId) return null;
  const counts = new Map();
  for (const transaction of transactions ?? []) {
    if (transaction.payeeId !== payeeId || transaction.kind !== "outflow") continue;
    if (transaction.splits || !transaction.budgetId) continue;
    if (transaction.budgetId === UNCATEGORIZED_BUDGET_ID) continue;
    if (!liveBudgetIds.has(transaction.budgetId)) continue;
    counts.set(transaction.budgetId, (counts.get(transaction.budgetId) ?? 0) + 1);
  }
  let best = null;
  for (const [id, count] of counts) if (best == null || count > counts.get(best)) best = id;
  return best;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

const KINDS = ["outflow", "inflow", "transfer"];

/**
 * What a reading means against these books.
 *
 * Returns one of:
 *
 *   { action: "add_transaction", draft, notes }
 *   { action: "recategorize", payee, budget, fromBudget, candidates, notes }
 *   { action: "move_money", seed, notes }
 *   { action: "unknown", error }
 *
 * `draft` is what `AddTransactionModal` opens on and `seed` what
 * `MoveMoneyModal` opens on — ids, cents and an ISO date, never names. `notes`
 * are the places the reading and the books did not line up, said in a sentence
 * each, so the person reviewing the form knows which fields to look at.
 *
 * Nothing that cannot be resolved is guessed at. An unknown account leaves the
 * form's own default (the account last used) and says so; an unknown category
 * on spending falls back to the payee's default and then to the payee's usual
 * one, both of which are the household's own answers.
 */
export function resolveReading(reading, { budgets, accounts, payees, transactions, today = todayISO() }) {
  const r = reading && typeof reading === "object" ? reading : {};
  const notes = [];
  const liveBudgets = budgets ?? [];
  const liveBudgetIds = new Set(liveBudgets.map((budget) => budget.id));
  const findBudget = (name) => byName(liveBudgets, name);

  if (r.action === ASSIST_ACTIONS.ADD) {
    const kind = KINDS.includes(r.kind) ? r.kind : "outflow";
    const isTransfer = kind === "transfer";
    const offered = isTransfer ? accounts ?? [] : (accounts ?? []).filter(spendsThroughBudget);

    const amountCents = r.amount == null ? null : toCents(r.amount);
    if (amountCents == null || amountCents <= 0) {
      notes.push(r.amount ? `Couldn't read “${r.amount}” as an amount.` : "No amount was given.");
    }

    let payeeId = null;
    let payeeName = "";
    if (!isTransfer && r.payee) {
      const { payee, matched } = findPayee(payees, r.payee);
      if (payee) {
        payeeId = payee.id;
        if (matched) notes.push(`Read “${r.payee}” as ${payee.name}.`);
      } else {
        payeeName = String(r.payee).trim();
        notes.push(`${payeeName} isn't a payee yet — it'll be added when you save.`);
      }
    }

    let budgetId = null;
    if (r.category != null) {
      const budget = findBudget(r.category);
      if (budget) budgetId = budget.id;
      else notes.push(`There's no category called “${r.category}”.`);
    }
    if (budgetId == null && kind === "outflow" && payeeId) {
      const payee = payees.find((entry) => entry.id === payeeId);
      const preferred = liveBudgetIds.has(payee?.defaultBudgetId) ? payee.defaultBudgetId : null;
      const usual = preferred ?? usualCategory(payeeId, transactions, liveBudgetIds);
      if (usual) {
        budgetId = usual;
        const name = liveBudgets.find((budget) => budget.id === usual)?.name;
        notes.push(`Filed under ${name}, where ${payee.name} usually goes.`);
      }
    }
    if (budgetId == null && kind === "outflow") {
      notes.push("No category was named — check the one the form picked.");
    }

    const accountFor = (name) => {
      if (name == null) return null;
      const account = byName(offered, name);
      if (!account) {
        notes.push(
          `There's no ${isTransfer ? "" : "on-budget "}account called “${name}”, so the form keeps the one you used last.`
        );
      }
      return account?.id ?? null;
    };
    const accountId = accountFor(r.account);
    const toAccountId = isTransfer ? accountFor(r.to_account) : null;

    let date = null;
    if (r.date != null) {
      date = readDatePhrase(r.date, today);
      if (!date) notes.push(`Couldn't read “${r.date}” as a date, so it's set to today.`);
    }

    return {
      action: ASSIST_ACTIONS.ADD,
      draft: {
        kind,
        amountCents: amountCents > 0 ? amountCents : null,
        payeeId,
        payeeName,
        budgetId,
        accountId,
        toAccountId,
        date,
        description: r.note ? String(r.note).trim() : "",
      },
      notes,
    };
  }

  if (r.action === ASSIST_ACTIONS.RECATEGORIZE) {
    const { payee } = r.payee ? findPayee(payees, r.payee) : { payee: null };
    if (!payee) {
      return {
        action: ASSIST_ACTIONS.UNKNOWN,
        error: r.payee
          ? `There's no payee called “${r.payee}”, so there is nothing to refile.`
          : "Which payee's spending should be refiled?",
      };
    }
    const budget = findBudget(r.to_category);
    if (!budget) {
      return {
        action: ASSIST_ACTIONS.UNKNOWN,
        error: r.to_category
          ? `There's no category called “${r.to_category}”.`
          : `Which category should ${payee.name} be filed under?`,
      };
    }
    let fromBudget = null;
    if (r.category != null && r.category !== POOL_NAME) {
      fromBudget = findBudget(r.category);
      if (!fromBudget) notes.push(`There's no category called “${r.category}”, so every category is included.`);
    }

    // Spending only, and never a divided receipt: an inflow given a category
    // turns from income into a refund, which is not "refiling", and a division
    // has no one category to move.
    const candidates = (transactions ?? [])
      .filter(
        (transaction) =>
          transaction.payeeId === payee.id &&
          transaction.kind === "outflow" &&
          !transaction.splits &&
          transaction.budgetId !== budget.id &&
          (!fromBudget || transaction.budgetId === fromBudget.id)
      )
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

    return { action: ASSIST_ACTIONS.RECATEGORIZE, payee, budget, fromBudget, candidates, notes };
  }

  if (r.action === ASSIST_ACTIONS.MOVE) {
    const side = (name) => {
      if (name == null) return "";
      if (searchKey(name) === searchKey(POOL_NAME)) return TO_BE_ASSIGNED;
      const budget = findBudget(name);
      if (!budget) notes.push(`There's no category called “${name}”.`);
      return budget?.id ?? "";
    };
    const amountCents = r.amount == null ? null : toCents(r.amount);
    if (amountCents == null || amountCents <= 0) notes.push("No amount was given.");
    return {
      action: ASSIST_ACTIONS.MOVE,
      seed: {
        fromBudgetId: side(r.category),
        toBudgetId: side(r.to_category),
        amountCents: amountCents > 0 ? amountCents : null,
      },
      notes,
    };
  }

  return {
    action: ASSIST_ACTIONS.UNKNOWN,
    error:
      "That isn't something I can do yet. Try recording a transaction, refiling a payee's spending, or moving money between categories.",
  };
}
