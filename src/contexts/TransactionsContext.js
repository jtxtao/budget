import React, { useCallback, useContext, useMemo } from "react";
import { v4 as uuidV4 } from "uuid";
import useSyncedState from "../hooks/useSyncedState";
import { readKey } from "../storage";
import { useDonations } from "./DonationsContext";
import { useActivity } from "./ActivityContext";
import { isValidISODate, toCents, todayISO } from "../utils";
import { applyTransactionRules } from "../domain/transactionRules";

/**
 * Every movement of money, in one ledger.
 *
 * Income and expenses used to be two stores — `income` in a context of its own
 * and `expenses` inside BudgetsContext — which meant two forms, two lists, and
 * two record shapes describing the same event: money moved, on a date, through
 * an account. They are one store now, discriminated by `kind`.
 *
 * A record is:
 *
 *   { id, kind, date, payeeId, description, amountCents, accountId, toAccountId,
 *     budgetId, splits }
 *
 * **`payeeId` names who the money went to, and `description` is the note beside
 * it.** The two were one field for the whole of this store's life — free text
 * labelled "Paid to" on the form — which is the shape a payee cannot be
 * corrected, counted or reasoned about in. `PayeesContext` owns the records; what
 * is here is the reference, and it is an **id** so that renaming a shop is one
 * write rather than one write per row that names it.
 *
 * `payeeId` is nullable and **no rule requires it**. A cash withdrawal has no
 * payee, a transfer between the household's own accounts has none by
 * construction, and every record written before this field existed has none
 * either. See the note on `RULES` for why its existence is not checked here.
 *
 * `amountCents` is a non-negative magnitude and `kind` carries the direction,
 * rather than a signed amount. Money that moves in two directions through one
 * signed field invites every sign bug there is; the direction is a field of its
 * own, and the amount is always the size of the movement.
 *
 * **There are three kinds, and the third names two accounts.** A `transfer` moves
 * money between the household's own accounts: `accountId` is where it left and
 * `toAccountId` is where it arrived, which is the same "direction is a field"
 * rule one step further on. It is **one record and not a linked pair** — a pair
 * would need every mutator to keep two rows in step on the amount, the date and
 * the description, and a single leg left orphaned by a missed cascade would
 * create or destroy money in a ledger whose one invariant is that the sums cover
 * every row. One record cannot disagree with itself. What a transfer means to the
 * budget is `budgetLegs`'s business, below.
 *
 * **One movement of money may be divided between categories.** `splits` is
 * either null — the ordinary record, filed under the one `budgetId` beside it —
 * or a list of two or more `{ id, budgetId, amountCents }` parts whose amounts
 * add up to `amountCents` exactly. A supermarket run is groceries and a light
 * bulb and a birthday card, and filing the whole receipt under one of the three
 * is the oldest reason a household stops trusting its own categories.
 *
 * **It is parts on the one record, not a parent and its children.** The same
 * choice a transfer makes, for a sharper version of the same reason: the
 * ledger's one invariant is that the sums cover every row, and two rows that can
 * be edited apart will eventually disagree about the amount, the date or the
 * account — at which point the division either creates or destroys money. Here
 * the whole is a field and the parts are a field, so the rule that binds them is
 * something this store can simply check. `sum(parts) === amountCents` is enforced
 * in `RULES` below, and it is what lets the balance sheet go on reading
 * `amountCents` while the envelopes read the parts, with no way for the two to
 * disagree about how much money moved.
 *
 * A part names a category and carries a positive amount — there is no part with
 * no category, because money left unfiled inside a split would be
 * indistinguishable from a smaller transaction, and no negative part, because a
 * discount is a smaller figure rather than money coming back. While a record is
 * split its own `budgetId` is **inert but kept**, the rule a switched-away-from
 * `toAccountId` follows: it is what the record falls back to when the split is
 * undone.
 *
 * **An outflow must name a category. An inflow may.** An inflow with no category
 * is income — it lands in the pool as money to assign. An inflow *with* one is a
 * refund against that category: the friend paying back their half of dinner, the
 * returned jacket, the reimbursed fare. It never reaches the pool, because that
 * money was already assigned once when it went out; it goes back where it came
 * from, and the category's activity for the month is the net of the two. Spend
 * $100 on food and be paid back $60 and food shows $40 of activity, which is what
 * the household actually spent on food.
 *
 * **Every new record names an account.** Refused at this boundary rather than in
 * the form, because this is the edge every caller crosses, and money has to come
 * from somewhere for an account balance to mean anything. `accountId: null` and
 * the Uncategorized sentinel still *read* fine: legacy records have no account,
 * and deleting a category hands its transactions to Uncategorized. What cannot
 * happen is writing a new one that way.
 *
 * **A record can be corrected in place.** `updateTransaction` takes a patch of
 * whatever fields moved and checks the rules those fields could break, so the
 * register can commit one cell at a time and a row folded in from the old
 * stores — no date, no account — can still have its description fixed without
 * being asked to invent the rest. See `RULES` and `firstBroken`.
 */
const TransactionsContext = React.createContext();

export const TRANSACTION_KINDS = { INFLOW: "inflow", OUTFLOW: "outflow", TRANSFER: "transfer" };

const KIND_VALUES = Object.values(TRANSACTION_KINDS);

export function useTransactions() {
  return useContext(TransactionsContext);
}

const isOutflow = (transaction) => transaction.kind === TRANSACTION_KINDS.OUTFLOW;
const isInflow = (transaction) => transaction.kind === TRANSACTION_KINDS.INFLOW;
export const isTransfer = (transaction) => transaction.kind === TRANSACTION_KINDS.TRANSFER;

/** Divided between categories, rather than filed under the one beside it. */
export const isSplit = (transaction) =>
  Array.isArray(transaction?.splits) && transaction.splits.length > 0;

/** What a list of parts adds up to — the figure the whole has to match. */
export const sumSplitCents = (splits) =>
  (splits ?? []).reduce((total, part) => total + (part?.amountCents ?? 0), 0);

/**
 * A list of parts as this store holds them, or `null` for a record that is not
 * split.
 *
 * `null`, `undefined` and an empty list all mean the same thing — not split —
 * because a split of nothing is not a state worth being able to reach. Ids are
 * kept where the caller supplied one, so an editor that sends a part back
 * unchanged produces a record equal to the one it started from and
 * `updateTransaction`'s no-op guard can still see that nothing moved.
 *
 * Amounts are taken in either currency, as everywhere else here: `amountCents`
 * if it is there, otherwise `amount` as it was typed. Junk parses to `null` and
 * is left that way rather than coerced to zero, so `RULES` refuses it instead of
 * the store quietly filing a part of nothing.
 */
export function readSplits(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  return value.map((part) => ({
    id: part?.id ?? uuidV4(),
    budgetId: part?.budgetId || null,
    amountCents:
      part?.amountCents != null
        ? part.amountCents
        : part?.amount != null
          ? toCents(part.amount)
          : null,
  }));
}

/**
 * How one record enters the budget's arithmetic: a **list** of legs, each
 * `{ kind, budgetId, amountCents }`, and an empty list for a record the budget
 * never sees.
 *
 * A list rather than a single leg because one movement of money can be divided
 * between categories. An unsplit record is one leg and this is the identity
 * function over its three fields; a split one is a leg per part, and those add
 * up to the whole because the store refuses a split where they do not. Every
 * consumer walks the list, so nothing downstream has to know which shape it was
 * handed.
 *
 * A **transfer** is the other reason this exists: whether it touches the budget
 * at all depends on which side of the boundary each of its two accounts sits, and
 * nothing else.
 *
 *   spends through -> spends through   none      <- a card payment, checking -> savings
 *   spends through -> off budget       outflow   <- a 401(k) contribution
 *   off budget     -> spends through   income    <- a withdrawal into checking
 *   off budget     -> off budget       none      <- a rollover
 *
 * Paying a credit card costs the budget nothing, because the money was already
 * budgeted on its way out through the card; what changes is which account holds
 * it, and both of those are accounts the budget spends through, so on-budget cash
 * is unmoved. Crossing *out* of the budget is real spending and is the shape the
 * app already had before transfers existed — an outflow filed under a savings or
 * retirement category — so it keeps counting exactly that way, and what is new is
 * only that the holding on the far side is credited too. Crossing *in* is new
 * money to assign, for the same reason a paycheque is.
 *
 * **Money arriving from outside the budget ignores any split on the record**, and
 * it is the one place a division is not read. Such a transfer is income to the
 * pool, and there are no categories in the pool — a split says where money
 * *went*, which is exactly what money arriving has not done yet. Inert rather
 * than refused, on the rule this store already keeps for a `toAccountId` left on
 * a record that has stopped being a transfer: re-point it and the division means
 * something again.
 *
 * **One list, and every consumer reads the same one**, which is what keeps the
 * envelope identity true: `useEnvelopes` builds both the pool and the cash-on-hand
 * side of the identity out of this, so neither a transfer nor a split can be
 * counted on one side and missed on the other. `budgetId` is passed through
 * untouched — callers keep their own `?? UNCATEGORIZED_BUDGET_ID` fallback, which
 * is what a crossing transfer with no category stored on it lands on.
 *
 * `insideBudget` comes from `AccountsContext` and is taken as an argument rather
 * than imported: this store sits *above* the account store so that deleting an
 * account can detach its transactions, so it cannot read account scopes itself.
 * That is also why the matrix is not checked in `RULES` — see the note there.
 */
export function budgetLegs(transaction, insideBudget) {
  const { kind, budgetId, amountCents } = transaction;

  // Each part at the direction the record as a whole is going: a split outflow
  // is three lots of spending, a split inflow three refunds.
  const parts = (legKind) =>
    isSplit(transaction)
      ? transaction.splits.map((part) => ({
          kind: legKind,
          budgetId: part.budgetId,
          amountCents: part.amountCents,
        }))
      : [{ kind: legKind, budgetId, amountCents }];

  if (kind !== TRANSACTION_KINDS.TRANSFER) return parts(kind);

  const from = insideBudget(transaction.accountId);
  const to = insideBudget(transaction.toAccountId);
  // Both sides on the same side of the line: the money is still exactly where the
  // budget thought it was, so there is nothing for an envelope to say about it.
  if (from === to) return [];

  return from
    ? parts(TRANSACTION_KINDS.OUTFLOW)
    : // Income, never a refund: money arriving from outside the budget was never
      // assigned on its way out, so it lands in the pool rather than in a
      // category — which leaves a division between categories nothing to divide.
      [{ kind: TRANSACTION_KINDS.INFLOW, budgetId: null, amountCents }];
}

/** One legacy record — from either old key — in the shape this store holds. */
function fromLegacy(record, kind) {
  if (!record) return null;
  // Both old stores went through a cents migration of their own, so a stored
  // value may be at either schema.
  const cents = "amount" in record ? toCents(record.amount) ?? 0 : record.amountCents ?? 0;

  return {
    id: record.id ?? uuidV4(),
    kind,
    // Neither old store had payees, and the text they did hold is left where it
    // is: it becomes the row's note, not a payee minted out of a guess. Promoting
    // free text into an entity would invent a decision the household never made,
    // the same reason an undated record is not given today's date.
    payeeId: null,
    description: record.description ?? "",
    amountCents: cents,
    // Genuinely unknown for records logged before dates existed. Left null
    // rather than backfilled with today's date, which would invent history.
    date: record.date ?? null,
    // Nothing recorded which account the money moved through, and there is no
    // way to work it out after the fact. Undated is to dates what this is to
    // accounts: an honest gap rather than a guess.
    accountId: null,
    // Nothing in either old store could have been a transfer — there was no such
    // kind — so there is no second account to fold in, and nothing could have
    // been divided between categories either.
    toAccountId: null,
    splits: null,
    // The old income store had no category to record, so a folded inflow is
    // income rather than a refund — which is what it was when it was logged.
    budgetId: record.budgetId ?? null,
  };
}

/**
 * The two old keys, folded into one ledger.
 *
 * Runs in the lazy default *only* — the `transactions` key existing means this
 * has already happened, and re-running it could only duplicate the ledger. The
 * old keys are left in storage rather than deleted: a migration that destroys
 * the only copy of the user's data has no way to undo itself, and leaving them
 * means clearing `transactions` re-seeds from them instead of losing everything.
 *
 * Guarded end to end. A failure here must cost nothing worse than starting
 * empty, and it must never take the render down — every provider wraps the whole
 * app.
 */
export function foldLegacyLedger() {
  const folded = [];

  for (const [key, kind] of [
    ["expenses", TRANSACTION_KINDS.OUTFLOW],
    ["income", TRANSACTION_KINDS.INFLOW],
  ]) {
    try {
      // Through `readKey` rather than `localStorage` directly, so the fold reads
      // the *signed-in household's* legacy keys and not whatever the browser
      // happens to hold unscoped. See src/storage.js.
      const records = readKey(key);
      if (!Array.isArray(records)) continue;

      for (const record of records) {
        const transaction = fromLegacy(record, kind);
        if (transaction) folded.push(transaction);
      }
    } catch {
      // Unreadable key. The other one may still be fine.
    }
  }

  return folded;
}

/**
 * The ledger as it stands in storage, without a React tree.
 *
 * Exists for the day-one assignment seed, which runs in AssignmentsContext's
 * lazy default and so cannot read this provider — see AssignmentsContext. It
 * prefers the current key and falls back to the legacy ones, because provider
 * *initialisers* all run before any provider's persist effect has written
 * anything: on the very first load after the merge, `transactions` is still
 * absent from storage while this store already holds the folded ledger.
 */
export function readStoredLedger() {
  try {
    const parsed = readKey("transactions");
    if (Array.isArray(parsed)) return migrateTransactions(parsed);
  } catch {
    // Fall through to the legacy keys, which may still be readable.
  }
  return foldLegacyLedger();
}

/**
 * A stored division, kept only where it still adds up.
 *
 * The one migration here that can decide to drop what it read, and the
 * asymmetry is deliberate: **no money is ever lost by dropping a split**, since
 * the whole lives in `amountCents` and the record simply falls back to being
 * filed under its own `budgetId`. Keeping an incoherent one would be far worse —
 * a division whose parts do not add up to the whole is the single state in which
 * the envelope view and the balance sheet disagree about how much money moved,
 * and nothing downstream is in a position to notice. So a hand-edited file, or a
 * record written by some future shape of this app, loses its division rather
 * than the books losing their arithmetic.
 *
 * Repairing one instead — scaling the parts, or filing the difference somewhere —
 * would be inventing a decision the household never made, which is the same
 * reason an undated record is not given today's date.
 */
function migrateSplits(stored, amountCents) {
  const splits = readSplits(stored);
  if (!splits) return null;

  const coherent =
    splits.length >= 2 &&
    splits.every(
      (part) =>
        part.budgetId != null && Number.isInteger(part.amountCents) && part.amountCents > 0
    ) &&
    sumSplitCents(splits) === amountCents;

  return coherent ? splits : null;
}

// Keyed on field presence rather than a version counter, so it is
// self-describing and safe to re-run. Anything without a recognised kind is
// treated as an outflow: the overwhelming majority of any ledger is spending,
// and a record dropped here would be money vanishing from the books.
function migrateTransactions(stored) {
  const transactions = Array.isArray(stored) ? stored : [];

  return transactions
    .filter((transaction) => transaction && typeof transaction === "object")
    .map((transaction) => {
      const kind = KIND_VALUES.includes(transaction.kind)
        ? transaction.kind
        : TRANSACTION_KINDS.OUTFLOW;

      const amountCents =
        "amount" in transaction ? toCents(transaction.amount) ?? 0 : transaction.amountCents ?? 0;

      return {
        id: transaction.id ?? uuidV4(),
        kind,
        // Who the money went to, and null for a record that names nobody — a
        // transfer, a cash withdrawal, or anything written before payees existed.
        // Additive like `toAccountId` and `splits`, and safe to re-run for the
        // same reason: nothing stored before this field can have one, and the text
        // such a record does hold stays where it is as its note.
        payeeId: transaction.payeeId ?? null,
        description: transaction.description ?? "",
        ...(transaction.reviewed === false ? { reviewed: false } : {}),
        amountCents,
        date: transaction.date ?? null,
        accountId: transaction.accountId ?? null,
        // Where a transfer's money arrived, and null on every other kind. Purely
        // additive: no record written before transfers existed can have been one,
        // so nothing here is rewritten and this stays safe to re-run.
        toAccountId: transaction.toAccountId ?? null,
        // Carried on both kinds. On an outflow it is the category the money came
        // from; on an inflow it is the category the money went back to, which is
        // a refund. An inflow without one is income.
        budgetId: transaction.budgetId ?? null,
        // True when this entry was confirmed from a recurring schedule. Kept
        // as a fact about how it was recorded, without linking it to a schedule
        // whose cursor can later change independently.
        ...(transaction.scheduled === true ? { scheduled: true } : {}),
        // How the whole was divided, or null for the ordinary undivided record.
        // Additive like `toAccountId` and safe to re-run for the same reason:
        // nothing written before splits existed can have one.
        splits: migrateSplits(transaction.splits, amountCents),
      };
    });
}

/**
 * Every rule a stored record has to satisfy, in the order the user meets them
 * while filling a row in.
 *
 * Written out as data rather than a run of `if`s because two callers check the
 * same rules against different amounts of the record. `addTransaction` builds a
 * whole one and checks all of it. `updateTransaction` changes a field or two of
 * a record that already exists, and checks only the rules those fields could
 * break — which is why each rule names the fields it is about.
 *
 * The last four are cross-field: an outflow names a category *or* is divided
 * between several, a transfer names a second account that is not the first, and
 * a division adds up to the whole it divides. Either side of any of them moving
 * can break it, so each lists every field it reads — which is what makes the sum
 * rule run when the amount is retyped as well as when the parts are.
 *
 * **The transfer matrix is deliberately not here.** Whether a transfer needs a
 * category depends on which side of the budget boundary its two accounts sit, and
 * this store cannot see an account's scope — it is mounted *above* the account
 * store so that deleting an account can detach its transactions. So the rule is
 * kept where the facts are in hand, exactly as the "no more than the gift itself"
 * bound is for a donation: `AddTransactionModal` refuses to submit a
 * boundary-crossing transfer without a category, and `budgetLegs`'s consumers fall
 * back to `UNCATEGORIZED_BUDGET_ID` for anything that reaches storage without one
 * — the same landing place an orphaned `budgetId` already has, and the reason the
 * envelope identity holds whatever is in the file.
 *
 * **There is no rule about `payeeId` either, for both of those reasons at once.**
 * This store cannot check that a payee exists — `PayeesProvider` is mounted
 * *inside* it so that deleting a payee can detach these rows, which is the same
 * arrangement `AccountsProvider` has and the same reason the matrix above is
 * absent. And a payee is not required in the first place: a cash withdrawal has
 * none, a transfer between the household's own accounts has none, and every
 * record written before the field existed has none. Requiring one would refuse
 * edits to rows that were complete before, which is precisely what
 * `updateTransaction`'s per-field checking exists to avoid.
 */
const RULES = [
  {
    fields: ["kind"],
    holds: (t) => KIND_VALUES.includes(t.kind),
    error: "Choose whether money came in or went out.",
  },
  {
    fields: ["amountCents"],
    holds: (t) => t.amountCents != null && t.amountCents >= 0,
    error: "Enter an amount of zero or more.",
  },
  {
    fields: ["date"],
    holds: (t) => isValidISODate(t.date),
    error: "Enter a valid date.",
  },
  {
    fields: ["accountId"],
    holds: (t) => Boolean(t.accountId),
    error: "Choose the account this moved through.",
  },
  {
    fields: ["kind", "budgetId", "splits"],
    // Divided between several is an answer to "which category", not an excuse
    // from it — every part names one, which the shape rule below is what checks.
    holds: (t) => t.kind !== TRANSACTION_KINDS.OUTFLOW || Boolean(t.budgetId) || isSplit(t),
    error: "Choose a category for this expense.",
  },
  {
    fields: ["splits"],
    holds: (t) =>
      t.splits == null ||
      (t.splits.length >= 2 &&
        t.splits.every(
          (part) =>
            part.budgetId != null && Number.isInteger(part.amountCents) && part.amountCents > 0
        )),
    // One part is not a division, it is the record it already was; a part with no
    // category would be money inside the split that nothing accounts for; and a
    // negative part would be a refund hiding inside an expense, which is what the
    // two kinds exist to keep apart.
    error: "A split needs two or more parts, each with a category and an amount above zero.",
  },
  {
    fields: ["splits", "amountCents"],
    // The rule the whole feature rests on. Below it the envelopes read the parts
    // while every balance reads the whole, and the two agree only because of this.
    holds: (t) => t.splits == null || sumSplitCents(t.splits) === t.amountCents,
    error: "The parts of a split have to add up to the transaction's total.",
  },
  {
    fields: ["kind", "toAccountId"],
    holds: (t) => t.kind !== TRANSACTION_KINDS.TRANSFER || Boolean(t.toAccountId),
    error: "Choose the account this moved to.",
  },
  {
    fields: ["kind", "toAccountId", "accountId"],
    // Money that left and arrived in the same account did not move. Checked here
    // rather than left to read as a no-op, because on the register it is one
    // mis-click away and the row it leaves behind looks like a real movement.
    holds: (t) => t.kind !== TRANSACTION_KINDS.TRANSFER || t.toAccountId !== t.accountId,
    error: "A transfer has to name two different accounts.",
  },
];

/**
 * The first rule `record` breaks, as a result the caller can surface.
 *
 * `touched` is the set of fields being written; leave it out to check the whole
 * record. **An update checks only what it changes**, which is what lets a
 * legacy row be corrected at all: records folded in from the old stores have no
 * date and no account, and refusing to fix a typo on one until the user invents
 * a date for it would be a worse ledger, not a stricter one. What an update
 * still cannot do is *open* one of those gaps — clearing a date or an account
 * touches that field, so the rule runs and refuses.
 */
function firstBroken(record, touched) {
  for (const rule of RULES) {
    if (touched && !rule.fields.some((field) => touched.has(field))) continue;
    if (!rule.holds(record)) return { ok: false, error: rule.error };
  }
  return { ok: true };
}

/** Two divisions that say the same thing, part for part and in the same order. */
function sameSplits(a, b) {
  if (a == null || b == null) return a === b;
  if (a.length !== b.length) return false;
  return a.every(
    (part, index) =>
      part.id === b[index].id &&
      part.budgetId === b[index].budgetId &&
      part.amountCents === b[index].amountCents
  );
}

export const TransactionsProvider = ({ children }) => {
  const [transactions, setTransactions] = useSyncedState(
    "transactions",
    foldLegacyLedger,
    migrateTransactions
  );
  const { removeDonation } = useDonations();
  const { logActivity } = useActivity() ?? {};
  const [rules, setRules] = useSyncedState("transactionRules", [], (stored) =>
    Array.isArray(stored) ? stored.filter((rule) => rule && rule.id) : []
  );

  const saveRule = useCallback((rule) => {
    const name = String(rule.name ?? "").trim();
    if (!name) return { ok: false, error: "Name the rule." };
    if (!rule.payeeId && !rule.accountId && !rule.descriptionContains && !rule.kind) {
      return { ok: false, error: "Choose at least one condition." };
    }
    if (!rule.budgetId && !rule.note) return { ok: false, error: "Choose an action." };
    const id = rule.id || uuidV4();
    setRules((previous) => previous.some((item) => item.id === id)
      ? previous.map((item) => item.id === id ? { ...rule, id, name, enabled: rule.enabled !== false } : item)
      : [...previous, { ...rule, id, name, enabled: rule.enabled !== false }]);
    return { ok: true, id };
  }, [setRules]);
  const deleteRule = useCallback((id) => setRules((previous) => previous.filter((rule) => rule.id !== id)), [setRules]);

  const updateTransactionsBulk = useCallback(({ ids, patch, applyRules = false }) => {
    const selected = new Set(ids);
    const replacements = new Map();
    for (const current of transactions) {
      if (!selected.has(current.id)) continue;
      const next = applyRules ? applyTransactionRules(current, rules) : { ...current, ...patch };
      const changed = Object.keys(next).filter((key) => next[key] !== current[key]);
      const result = firstBroken(next, new Set(changed));
      if (!result.ok) return result;
      replacements.set(current.id, next);
    }
    setTransactions((previous) => previous.map((row) => replacements.get(row.id) ?? row));
    return { ok: true, count: replacements.size };
  }, [transactions, rules, setTransactions]);

  // The two literal kinds, and a transfer is in neither: it is money the household
  // moved rather than money it earned or spent, and what the *budget* makes of one
  // is `budgetLegs`'s answer rather than a list membership.
  const outflows = useMemo(() => transactions.filter(isOutflow), [transactions]);
  const inflows = useMemo(() => transactions.filter(isInflow), [transactions]);

  // One pass instead of a full scan per category per render. Both kinds, since
  // a refund is part of what the category did this month — a list of a
  // category's spending that omits the money that came back would not add up to
  // the activity shown against it.
  //
  // A split record belongs to every category it names, and to each of them once:
  // the list is of the movements a category was part of, so a receipt divided
  // twice into one category is still one receipt.
  const byBudget = useMemo(() => {
    const grouped = new Map();
    for (const transaction of transactions) {
      const ids = isSplit(transaction)
        ? new Set(transaction.splits.map((part) => part.budgetId))
        : [transaction.budgetId];
      for (const budgetId of ids) {
        if (budgetId == null) continue;
        const bucket = grouped.get(budgetId);
        if (bucket) bucket.push(transaction);
        else grouped.set(budgetId, [transaction]);
      }
    }
    return grouped;
  }, [transactions]);

  const getBudgetTransactions = useCallback(
    (budgetId) => byBudget.get(budgetId) ?? [],
    [byBudget]
  );

  // Either side of the record: a transfer *into* an account is as much that
  // account's business as one out of it.
  const getAccountTransactions = useCallback(
    (accountId) =>
      transactions.filter(
        (transaction) =>
          transaction.accountId === accountId || transaction.toAccountId === accountId
      ),
    [transactions]
  );

  /**
   * Log one movement of money. Returns a result rather than throwing or
   * silently dropping the input: the caller has to decide what to tell the
   * user, and closing a modal as though a rejected record had been saved is the
   * one option that cannot be right.
   */
  const addTransaction = useCallback(
    ({
      kind,
      payeeId,
      description,
      amount,
      amountCents,
      date = todayISO(),
      accountId,
      toAccountId,
      budgetId,
      splits,
      scheduled = false,
    }) => {
      const id = uuidV4();
      let transaction = {
        id,
        kind,
        // Normalised from "" the same way `accountId` and `budgetId` are: an
        // unanswered field in the DOM is an empty string, and "nobody" here is
        // null.
        payeeId: payeeId || null,
        description: (description ?? "").trim(),
        reviewed: false,
        amountCents: amountCents ?? toCents(amount),
        date,
        accountId: accountId || null,
        // Only a transfer has one, and the rules above are what enforce that it
        // does. Normalised from "" the same way `accountId` is.
        toAccountId: toAccountId || null,
        // "" is what an unpicked select is worth in the DOM, and null is what
        // "no category" is worth here. The two must not be confused, or an
        // inflow would be a refund against a category with no name.
        budgetId: budgetId || null,
        ...(scheduled === true ? { scheduled: true } : {}),
        // How the whole is divided, or null. Normalised here rather than in the
        // form so that the two forms which can write one — the entry modal and
        // the split editor — cannot come to disagree about what an empty part is.
        splits: readSplits(splits),
      };
      transaction = applyTransactionRules(transaction, rules);

      // Every rule, because every field is being written. The one that keeps
      // the ledger finishable in one sitting is the last: an outflow names its
      // category now, not later. An inflow is under no such rule — having no
      // category is what makes it income rather than a refund, so an empty
      // choice there is an answer and not an omission.
      const result = firstBroken(transaction);
      if (!result.ok) return result;

      setTransactions((prevTransactions) => [...prevTransactions, transaction]);
      logActivity?.("transaction.created", {
        amountCents: transaction.amountCents,
        kind: transaction.kind,
        payeeId: transaction.payeeId ?? null,
        budgetId: isSplit(transaction) ? null : (transaction.budgetId ?? null),
        date: transaction.date,
      });
      return { ok: true, id };
    },
    [setTransactions, logActivity, rules]
  );

  /**
   * Correct a record already in the ledger, a field or two at a time.
   *
   * A patch rather than a whole record: the register edits one cell at a time,
   * and a mutator that took the full row would have every cell resubmitting the
   * five fields it did not touch. Only the fields present in the patch are
   * written, and only the rules those fields could break are checked — see
   * `firstBroken`.
   *
   * `amount` (dollars, as typed) and `amountCents` are both accepted, as on
   * `addTransaction`. The direction is an ordinary field here: filing a
   * paycheque as an expense is a mistake worth being able to undo without
   * deleting the row and losing everything else typed on it.
   */
  const updateTransaction = useCallback(
    (patch) => {
      const current = transactions.find((transaction) => transaction.id === patch?.id);
      // Two cells committing at once — a blur that lands on a Remove button —
      // can reach here after the row is gone. Say so rather than writing a
      // deleted record back into the ledger.
      if (!current) return { ok: false, error: "That transaction is no longer in the ledger." };

      const changes = {};
      if ("kind" in patch) changes.kind = patch.kind;
      // A row may legitimately name nobody, so clearing this is a real answer
      // rather than an abandoned edit — unlike a blank date or a blank amount,
      // which no record can have.
      if ("payeeId" in patch) changes.payeeId = patch.payeeId || null;
      if ("description" in patch) changes.description = (patch.description ?? "").trim();
      if ("reviewed" in patch) changes.reviewed = patch.reviewed === true;
      if ("amountCents" in patch) changes.amountCents = patch.amountCents;
      else if ("amount" in patch) changes.amountCents = toCents(patch.amount);
      if ("date" in patch) changes.date = patch.date;
      // Normalised at this boundary exactly as on the way in, so a cleared
      // select reads the same whichever mutator it went through.
      if ("accountId" in patch) changes.accountId = patch.accountId || null;
      if ("toAccountId" in patch) changes.toAccountId = patch.toAccountId || null;
      // A `toAccountId` left on a record whose kind moved away from transfer is
      // **kept, not cleared**, and is inert while it is not a transfer — the rule
      // a switched-away-from pay cadence follows, for the same reason: switching
      // back is the point, and only `budgetLegs` and `accountBalancesAt` read it,
      // both of which ask the kind first.
      if ("budgetId" in patch) changes.budgetId = patch.budgetId || null;
      // `null` is how a split is undone, and it is the reason this reads the key
      // rather than the value: sending no `splits` at all leaves the division
      // alone, which is what every one-cell edit on the register does.
      if ("splits" in patch) changes.splits = readSplits(patch.splits);

      const next = { ...current, ...changes };
      const result = firstBroken(next, new Set(Object.keys(changes)));
      if (!result.ok) return result;

      // Nothing actually moved. Writing anyway would re-render every consumer
      // of the ledger, and in a grid whose cells commit on blur, tabbing across
      // one row would do that once per column. `splits` is the one field that is
      // not a scalar, so it is compared part by part — an editor that re-submits
      // a division untouched has changed nothing, and a fresh array is not a
      // change.
      const moved = Object.keys(changes).some((field) =>
        field === "splits"
          ? !sameSplits(changes.splits, current.splits)
          : changes[field] !== current[field]
      );
      if (!moved) return { ok: true, id: current.id };

      setTransactions((prevTransactions) =>
        prevTransactions.map((transaction) => (transaction.id === current.id ? next : transaction))
      );
      logActivity?.("transaction.updated", {
        amountCents: next.amountCents,
        kind: next.kind,
        payeeId: next.payeeId ?? null,
        budgetId: isSplit(next) ? null : (next.budgetId ?? null),
        date: next.date,
      });
      return { ok: true, id: current.id };
    },
    [transactions, setTransactions, logActivity]
  );

  /**
   * Take one record off the ledger, and with it anything said *about* that
   * record elsewhere.
   *
   * A donation is the only such statement so far: it holds no money of its own,
   * only which organisation an outflow went to and how much of it is deductible,
   * so once the outflow is gone there is nothing left for it to describe. That
   * is a cascade rather than a detach, unlike an account's transactions — those
   * are the money, and the money still moved.
   */
  const deleteTransaction = useCallback(
    ({ id }) => {
      const tx = transactions.find((t) => t.id === id);
      setTransactions((prevTransactions) =>
        prevTransactions.filter((transaction) => transaction.id !== id)
      );
      removeDonation({ transactionId: id });
      if (tx) {
        logActivity?.("transaction.deleted", {
          amountCents: tx.amountCents,
          kind: tx.kind,
          payeeId: tx.payeeId ?? null,
          date: tx.date,
        });
      }
    },
    [transactions, setTransactions, removeDonation, logActivity]
  );

  /**
   * Move everything filed under one category onto another, in one commit.
   *
   * Used when a category is deleted. Spend outlives the category it was filed
   * under — it is what actually happened — so it is reassigned rather than
   * dropped, and its funding follows it (see `reassignBudgetAssignments`).
   *
   * Refunds move with the spend they offset, which is why this is not filtered
   * to outflows. Leaving a refund pointing at a deleted category would strand it
   * against an id nothing renders while the spend it cancels moved on, and the
   * category it landed on would read as $100 spent on a dinner that cost $40.
   *
   * **A part of a split moves the same way, and two parts that land on the same
   * category are merged.** Deleting two categories a receipt was divided between
   * leaves both parts pointing at Uncategorized, and while two parts naming one
   * category still add up correctly, they are two rows saying one thing. Merging
   * can leave a single part, and a division into one is not a division — that
   * record goes back to being an ordinary one filed under where the money landed,
   * which is exactly what undoing a split does.
   */
  const reassignBudgetTransactions = useCallback(
    ({ fromBudgetId, toBudgetId }) => {
      setTransactions((prevTransactions) =>
        prevTransactions.map((transaction) => {
          if (isSplit(transaction)) {
            if (!transaction.splits.some((part) => part.budgetId === fromBudgetId)) {
              return transaction;
            }
            const merged = [];
            for (const part of transaction.splits) {
              const budgetId = part.budgetId === fromBudgetId ? toBudgetId : part.budgetId;
              const landed = merged.find((entry) => entry.budgetId === budgetId);
              if (landed) landed.amountCents += part.amountCents;
              else merged.push({ ...part, budgetId });
            }
            return merged.length > 1
              ? { ...transaction, splits: merged }
              : { ...transaction, budgetId: merged[0].budgetId, splits: null };
          }
          return transaction.budgetId === fromBudgetId
            ? { ...transaction, budgetId: toBudgetId }
            : transaction;
        })
      );
    },
    [setTransactions]
  );

  /**
   * Cut every transaction loose from a deleted account, keeping the ledger.
   *
   * The money moved, and the budget it moved through is unchanged — only the
   * record of *where* it sat is gone. Deleting the transactions instead would
   * rewrite every envelope balance because the user tidied up their account
   * list. What is lost is the account's own running balance, which had nowhere
   * left to be shown anyway.
   *
   * **Both sides of a transfer are cut**, and a transfer with a detached side
   * reads as money that never left the budget — `insideBudget` treats null as
   * inside, so a contribution whose holding has been deleted hands its money back
   * to the envelope it came out of. That is the same trade deleting an account
   * already makes everywhere else: its opening balance leaves "to be assigned"
   * and its transactions lose their place on the balance sheet.
   */
  const detachAccountTransactions = useCallback(
    ({ accountId }) => {
      setTransactions((prevTransactions) =>
        prevTransactions.map((transaction) => {
          if (transaction.accountId === accountId) return { ...transaction, accountId: null };
          if (transaction.toAccountId === accountId) return { ...transaction, toAccountId: null };
          return transaction;
        })
      );
    },
    [setTransactions]
  );

  /**
   * Cut every transaction loose from a deleted payee, keeping the ledger.
   *
   * `detachAccountTransactions`' rule, one field over and for the same reason:
   * the money moved and every figure derived from it is unchanged — what is gone
   * is only the record of who it went to, which the register shows as an empty
   * payee for the user to correct. Deleting the rows instead would rewrite every
   * envelope balance because somebody tidied a list.
   */
  const detachPayeeTransactions = useCallback(
    ({ payeeId }) => {
      setTransactions((prevTransactions) =>
        prevTransactions.map((transaction) =>
          transaction.payeeId === payeeId ? { ...transaction, payeeId: null } : transaction
        )
      );
    },
    [setTransactions]
  );

  /**
   * Point everything that named one of several payees at a single one, in one
   * commit.
   *
   * What a merge is made of. Several sources rather than one because a household
   * unifying "Costco", "COSTCO" and "Costco Wholesale" is doing one thing, and
   * three passes over the ledger would be three renders and three chances for a
   * synced write to land in between.
   *
   * Unlike `reassignBudgetTransactions` there is nothing to merge *within* a
   * record: a transaction names one payee, so repointing it cannot produce two
   * fields that now say the same thing the way two split parts landing on one
   * category can.
   */
  const repointPayeeTransactions = useCallback(
    ({ fromPayeeIds, toPayeeId }) => {
      const sources = new Set(fromPayeeIds ?? []);
      if (sources.size === 0) return;
      setTransactions((prevTransactions) =>
        prevTransactions.map((transaction) =>
          sources.has(transaction.payeeId) ? { ...transaction, payeeId: toPayeeId } : transaction
        )
      );
    },
    [setTransactions]
  );

  // Memoised so a change in any other store does not re-render every consumer
  // of this one.
  const value = useMemo(
    () => ({
      transactions,
      rules,
      saveRule,
      deleteRule,
      updateTransactionsBulk,
      inflows,
      outflows,
      getBudgetTransactions,
      getAccountTransactions,
      addTransaction,
      updateTransaction,
      deleteTransaction,
      reassignBudgetTransactions,
      detachAccountTransactions,
      detachPayeeTransactions,
      repointPayeeTransactions,
    }),
    [
      transactions,
      rules,
      saveRule,
      deleteRule,
      updateTransactionsBulk,
      inflows,
      outflows,
      getBudgetTransactions,
      getAccountTransactions,
      addTransaction,
      updateTransaction,
      deleteTransaction,
      reassignBudgetTransactions,
      detachAccountTransactions,
      detachPayeeTransactions,
      repointPayeeTransactions,
    ]
  );

  return <TransactionsContext.Provider value={value}>{children}</TransactionsContext.Provider>;
};
