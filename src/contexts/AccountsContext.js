import React, { useCallback, useContext, useMemo } from "react";
import { v4 as uuidV4 } from "uuid";
import useSyncedState from "../hooks/useSyncedState";
import { reorderSubset } from "../reorder";
import { useTransactions } from "./TransactionsContext";
import { formatPeriod, isValidISODate, toCents, todayISO, toPeriod } from "../utils";

/**
 * The accounts the money actually sits in, what each started at, and what each
 * was worth in a given month.
 *
 * `accounts` is the list of things owned and owed — set up once, on the
 * Configuration page, alongside the categories and the income sources, because
 * all three are standing facts about the household rather than anything that
 * happened in a particular month. Each one states whether it is on or off
 * budget — see `ACCOUNT_SCOPES` — and what it held when the books opened, which
 * is what gives the ledger something to spend from on day one.
 *
 * `balances` is a hand-entered balance for one account in one period
 * ("YYYY-MM"). It answers a different question from the opening balance and
 * does not compete with it: an on-budget account's balance today is *derived*
 * — opening plus everything that moved through it, see
 * `src/hooks/useAccountBalances.js` — while an off-budget holding has no
 * transactions to derive from and is snapshotted by hand for the net-worth
 * chart.
 *
 * Each account also carries `reconciledOn`: the day it was last checked against
 * a statement and found to agree. Stored here rather than derived, because it is
 * the one fact about an account no ledger can know — it says the books and the
 * bank were the same on that day, which is a thing the user did, not a thing
 * that happened to the money.
 *
 * Storage and CRUD only — totals, allocation, and period-over-period change are
 * deliberately absent, and belong to the Net worth page when it is built.
 */
const AccountsContext = React.createContext();

export const ACCOUNT_TYPES = { ASSET: "asset", LIABILITY: "liability" };

const ACCOUNT_TYPE_VALUES = Object.values(ACCOUNT_TYPES);

/**
 * What the account is *to the budget*.
 *
 * On budget is where the day-to-day money moves: the everyday account, the
 * savings it sweeps into. A credit card is spent through in exactly the same way
 * — every rule that follows the money treats it as on budget — but it is its own
 * scope because it is the one account the user reads differently: the balance is
 * a debt that grows as they spend, and grouping it under the same heading as the
 * current account buries the figure they most want to see on its own. Off budget
 * is held rather than spent — a 401(k), a brokerage, the house, the mortgage
 * against it — where the question is what it is worth over years, not what was
 * assigned to it this month.
 *
 * An axis of its own, orthogonal to `type`, not a subdivision of it. Both sides
 * of the balance sheet appear across it: a card is a liability spent through, a
 * mortgage a liability that is only watched, and net worth wants both.
 *
 * Only the off-budget line is load-bearing in the maths — see
 * `spendsThroughBudget`, which is what every derivation asks. Adding a scope
 * beside on-budget therefore changes where an account is *shown*, not what it
 * counts as.
 */
export const ACCOUNT_SCOPES = {
  ON_BUDGET: "on-budget",
  CREDIT_CARD: "credit-card",
  OFF_BUDGET: "off-budget",
};

const ACCOUNT_SCOPE_VALUES = Object.values(ACCOUNT_SCOPES);

export const ACCOUNT_SCOPE_LABELS = {
  [ACCOUNT_SCOPES.ON_BUDGET]: "On budget",
  [ACCOUNT_SCOPES.CREDIT_CARD]: "Credit card",
  [ACCOUNT_SCOPES.OFF_BUDGET]: "Off budget",
};

/**
 * Whether the budget spends through this account — true of on-budget accounts
 * and of credit cards alike.
 *
 * Asked as a predicate rather than compared against a scope at each call site,
 * because the question every derivation has is "does this money move through the
 * plan", and there are now two scopes that answer yes. Written as "not off
 * budget" so an unrecognised scope spends, matching `DEFAULT_SCOPE`: an account
 * that fell out of the ledger because its scope was misspelt would take its
 * balance out of "to be assigned" with it.
 */
export const spendsThroughBudget = (account) => account.scope !== ACCOUNT_SCOPES.OFF_BUDGET;

/** Its complement, so the two readings of the line are never spelled differently. */
export const isOffBudget = (account) => !spendsThroughBudget(account);

/**
 * The same question asked by id rather than by record: `insideBudget(accounts)`
 * returns a predicate over an `accountId`.
 *
 * Built once and shared because three derivations now have to ask it per
 * transaction — `useEnvelopes`, `useSpendingReport` and `useNetWorth`, all of
 * which resolve a transfer's effect from which side of the budget each of its
 * two accounts sits on — and a `find` over the accounts per record per render is
 * the wrong shape for a ledger of any size.
 *
 * **`null` is inside.** A transaction cut loose from a deleted account keeps its
 * money in the envelope maths and loses only its place on the balance sheet, which
 * is the stance `accountBalancesAt` and `detachAccountTransactions` already take;
 * reading a detached side as off-budget instead would make money appear to leave
 * the household because an account was tidied away. An id naming no account at
 * all — reachable only by editing storage by hand — reads as off budget, which is
 * the cautious answer: it asks for a category rather than quietly moving money.
 */
export const insideBudget = (accounts) => {
  const ids = new Set(accounts.filter(spendsThroughBudget).map((account) => account.id));
  return (accountId) => accountId == null || ids.has(accountId);
};

/** What to call the scope on screen; an unrecognised one reads as the default. */
export const scopeLabel = (account) =>
  ACCOUNT_SCOPE_LABELS[account.scope] ?? ACCOUNT_SCOPE_LABELS[DEFAULT_SCOPE];

// What an account with no scope stated is: on budget. This is a budgeting app,
// so an account someone bothered to enter was one they were spending from until
// they say otherwise — and the alternative default would quietly drop an
// existing account out of the part of the app it was entered for.
export const DEFAULT_SCOPE = ACCOUNT_SCOPES.ON_BUDGET;

export const ASSET_CLASSES = ["Cash", "Stocks", "Bonds", "Real estate", "Alternatives", "Other"];

// What an account with no class stated is worth: unclassified, not cash. A form
// offering a likely first pick is a different question — see AddAccountModal.
export const UNCLASSIFIED = "Other";

export function useAccounts() {
  return useContext(AccountsContext);
}

/**
 * A balance as it is stored, from the figure that was typed.
 *
 * Signed, on the same convention as the rest of the balance sheet: an asset is
 * positive, a debt negative. Every form asks a liability for the amount *owed* as
 * a positive figure, because that is how anyone reads a credit card statement,
 * and this is where that is turned into what it means. Normalising here rather
 * than trusting the caller also repairs a hand-edited record, and keeps the one
 * combination that would quietly corrupt net worth — a debt counted as an asset
 * — out of storage entirely.
 *
 * Exported as a pair with its inverse so the forms that ask for a balance — the
 * monthly update on the Net worth page and the backfill grid on Configuration —
 * cannot come to disagree about which way a mortgage points. Zero is written out
 * rather than negated: `-0` is a real value in JavaScript and would travel from
 * here into every sum downstream.
 */
export function toStoredBalanceCents(account, cents) {
  if (account.type !== ACCOUNT_TYPES.LIABILITY) return cents;
  const magnitude = Math.abs(cents);
  return magnitude === 0 ? 0 : -magnitude;
}

/** Its inverse: what belongs in the field, and what to print beside it. */
export function toEnteredBalanceCents(account, cents) {
  return account.type === ACCOUNT_TYPES.LIABILITY ? Math.abs(cents) : cents;
}

/** The same rule for the opening balance, which arrives as a bare type. */
function signedOpeningCents(cents, type) {
  return toStoredBalanceCents({ type }, cents);
}

// On and off budget, and the opening balance, both arrived after the first
// accounts were saved, so a stored record may predate either. Keyed on the
// value being one the app knows rather than on a version counter, which makes
// it safe to re-run and repairs a hand-edited value at the same time.
//
// An account saved before opening balances existed opens at zero on an unknown
// date, not at whatever it holds today. Guessing would put money in the pool
// that the user never said they had — and, for the same reason, an account
// saved before reconciliation existed has never been reconciled rather than
// having been reconciled when it was created.
//
// `institution` is dropped rather than carried: the app never asked what it was
// for beyond printing it beside the name, and a field that decorates a row is
// one more thing to keep true about every account. Removed here so a record
// saved while it existed stops carrying it, instead of leaving storage half on
// each side of the change.
function migrateAccounts(stored) {
  const accounts = Array.isArray(stored) ? stored : [];
  return accounts.map(({ institution, ...account }) => ({
    ...account,
    scope: ACCOUNT_SCOPE_VALUES.includes(account.scope) ? account.scope : DEFAULT_SCOPE,
    openingBalanceCents: signedOpeningCents(account.openingBalanceCents ?? 0, account.type),
    openingDate: isValidISODate(account.openingDate) ? account.openingDate : null,
    reconciledOn: isValidISODate(account.reconciledOn) ? account.reconciledOn : null,
  }));
}

// Balances follow the same rule as every other figure in the app: integer
// cents, never floating-point dollars.
function migrateBalances(stored) {
  const balances = Array.isArray(stored) ? stored : [];
  return balances.map((balance) =>
    "amount" in balance
      ? {
          id: balance.id ?? uuidV4(),
          accountId: balance.accountId,
          period: balance.period,
          amountCents: toCents(balance.amount) ?? 0,
        }
      : balance
  );
}

/**
 * One month's entries, checked and normalised, or the first reason they are not.
 *
 * Split out because two mutators write snapshots — one month at a time, and a
 * window of months at once — and both have to reject the same figures for the
 * same reasons. An entry whose amount is blank normalises to `null`, which is the
 * instruction to *remove* that snapshot rather than store zero.
 */
function validateBalanceEntries(entries) {
  const validated = [];
  for (const entry of entries) {
    const blank = entry.amount == null || String(entry.amount).trim() === "";
    if (blank && entry.amountCents == null) {
      validated.push({ accountId: entry.accountId, cents: null });
      continue;
    }
    const cents = entry.amountCents ?? toCents(entry.amount);
    if (cents == null) {
      return { ok: false, error: `Enter a valid balance for ${entry.label ?? "every account"}.` };
    }
    validated.push({ accountId: entry.accountId, cents });
  }
  return { ok: true, validated };
}

/** Fold one validated month into a balances array, keeping the ids that exist so
 *  an unchanged figure is not rewritten as a new record. */
function applyPeriodBalances(balances, period, validated) {
  return validated.reduce((next, { accountId, cents }) => {
    const rest = next.filter(
      (balance) => !(balance.accountId === accountId && balance.period === period)
    );
    if (cents == null) return rest;

    const existing = next.find(
      (balance) => balance.accountId === accountId && balance.period === period
    );
    return [...rest, { id: existing?.id ?? uuidV4(), accountId, period, amountCents: cents }];
  }, balances);
}

/**
 * An off-budget account's opening balance, folded into `accountBalances` as a
 * real snapshot dated to `openingDate` — so stating (or restating) it writes
 * the same record "Update balances" would, rather than a fact only
 * `useNetWorth`'s `openingAsSnapshot` knows how to read back. On-budget
 * accounts are never written here: their balance is the ledger's own
 * arithmetic, and a snapshot beside it would read as a reconciliation nobody
 * entered. Undated (`openingDate: null`) has no period to anchor a snapshot
 * to and is left alone, exactly as it already was.
 *
 * **Restating the date, not just the figure, is the case that needs care.**
 * The account record holds exactly one opening date at a time, so moving it
 * forward — "the balance I typed in January was really August's figure" —
 * would otherwise erase January everywhere that reads the account's own
 * fields: `accountBalancesAt`'s fallback gates the opening balance on
 * `openedIn <= period`, so once `openedIn` becomes August, January has no
 * ledger activity of its own and no snapshot behind it either, and reads as
 * zero instead of what was actually recorded — a month of real history
 * quietly disappearing from every chart that covers it. `previous` is the
 * account as it stood before this patch; when its opening date is about to
 * change, its old date and figure are written as a real snapshot first —
 * unless one already sits on file for that exact month — so the new date
 * competes purely on when it happened rather than deleting what came before
 * it.
 */
function withOpeningSnapshot(balances, previous, { scope, openingDate, openingBalanceCents }, accountId) {
  const period = toPeriod(openingDate);
  if (!isOffBudget({ scope }) || period == null) return balances;

  let next = balances;
  if (previous && isOffBudget(previous) && previous.openingDate !== openingDate) {
    const priorPeriod = toPeriod(previous.openingDate);
    const alreadyReal =
      priorPeriod != null &&
      balances.some((balance) => balance.accountId === accountId && balance.period === priorPeriod);
    if (priorPeriod != null && !alreadyReal) {
      next = applyPeriodBalances(next, priorPeriod, [
        { accountId, cents: previous.openingBalanceCents },
      ]);
    }
  }

  return applyPeriodBalances(next, period, [{ accountId, cents: openingBalanceCents }]);
}

export const AccountsProvider = ({ children }) => {
  const [accounts, setAccounts] = useSyncedState("accounts", [], migrateAccounts);
  const [balances, setBalances] = useSyncedState("accountBalances", [], migrateBalances);
  const { detachAccountTransactions } = useTransactions();

  /**
   * Shared by add and update. Validated here rather than in the form: this is
   * the boundary every caller crosses, and an account whose type is neither
   * asset nor liability would sit in the books counting towards nothing.
   *
   * `exceptId` is the account being edited, which must not clash with itself.
   *
   * Returns the normalised name and opening balance alongside `ok`, so neither
   * caller has to re-derive them and risk deriving them differently.
   */
  const validate = useCallback(
    ({ name, type, scope, assetClass, opening, openingBalanceCents, openingDate }, exceptId) => {
      const trimmed = (name ?? "").trim();
      if (!trimmed) return { ok: false, error: "Give the account a name." };

      const clash = accounts.some(
        (account) =>
          account.id !== exceptId && account.name.trim().toLowerCase() === trimmed.toLowerCase()
      );
      if (clash) return { ok: false, error: `An account named “${trimmed}” already exists.` };

      if (!ACCOUNT_TYPE_VALUES.includes(type)) {
        return { ok: false, error: "Choose whether this is an asset or a liability." };
      }
      if (!ACCOUNT_SCOPE_VALUES.includes(scope)) {
        return { ok: false, error: "Choose whether this account is on or off budget." };
      }
      // The one combination of the two axes that is not a real account. A card
      // is money owed by definition, and one filed as an asset would add its
      // balance to net worth instead of subtracting it. The form cannot produce
      // this — it stops asking once the card scope is picked — so this is here
      // for every other caller, and for storage edited by hand.
      if (scope === ACCOUNT_SCOPES.CREDIT_CARD && type !== ACCOUNT_TYPES.LIABILITY) {
        return { ok: false, error: "A credit card is money owed, not an asset." };
      }
      if (!ASSET_CLASSES.includes(assetClass)) {
        return { ok: false, error: "Choose what kind of asset this is." };
      }

      // An account that starts empty is a real answer — a card just paid off, a
      // savings account opened today — and reads as zero. Junk is not, and must
      // not reach storage, where JSON.stringify records NaN as null.
      const cents =
        openingBalanceCents ?? (opening == null || opening === "" ? 0 : toCents(opening));
      if (cents == null) {
        return { ok: false, error: "Enter a starting balance as a number." };
      }
      if (!(openingDate == null || isValidISODate(openingDate))) {
        return { ok: false, error: "Enter a valid date for the starting balance." };
      }

      return { ok: true, name: trimmed, openingBalanceCents: signedOpeningCents(cents, type) };
    },
    [accounts]
  );

  const addAccount = useCallback(
    ({
      name,
      type = ACCOUNT_TYPES.ASSET,
      scope = DEFAULT_SCOPE,
      assetClass = UNCLASSIFIED,
      opening,
      openingBalanceCents,
      // Undated by default rather than dated today: a caller that does not
      // mention the date is not claiming the money arrived this morning, and an
      // undated opening balance counts from the beginning of the books.
      openingDate = null,
    }) => {
      const checked = validate({
        name,
        type,
        scope,
        assetClass,
        opening,
        openingBalanceCents,
        openingDate,
      });
      if (!checked.ok) return checked;

      const id = uuidV4();
      setAccounts((prevAccounts) => [
        ...prevAccounts,
        {
          id,
          name: checked.name,
          type,
          scope,
          assetClass,
          openingBalanceCents: checked.openingBalanceCents,
          openingDate,
          // Never reconciled, not reconciled today. An opening balance the user
          // typed from memory is exactly the balance most worth checking against
          // a statement, and stamping today's date would say it already had been.
          reconciledOn: null,
        },
      ]);
      setBalances((prevBalances) =>
        withOpeningSnapshot(
          prevBalances,
          null,
          { scope, openingDate, openingBalanceCents: checked.openingBalanceCents },
          id
        )
      );
      return { ok: true, id };
    },
    [validate, setAccounts, setBalances]
  );

  const updateAccount = useCallback(
    ({ id, ...fields }) => {
      const existing = accounts.find((account) => account.id === id);
      if (!existing) return { ok: false, error: "That account no longer exists." };

      // Validated as the record would stand after the patch, so a partial update
      // cannot slip an invalid combination past the checks the full record gets.
      const next = { ...existing, ...fields };
      // A form asks for the balance in dollars and sends back the string it
      // asked for. Where it does, that string is the figure the user just
      // typed — so the cents already on the record must not stand in front of
      // it in validate's `??`, which would take the edit and store the old
      // figure. Dropped here rather than in the form, because it is this
      // merge that puts the stale copy there.
      if ("opening" in fields) delete next.openingBalanceCents;
      const checked = validate(next, id);
      if (!checked.ok) return checked;

      const patch = {
        ...next,
        name: checked.name,
        openingBalanceCents: checked.openingBalanceCents,
      };
      // `opening` is the form's dollar string, folded into cents by validate.
      // Letting it through would leave a second, staler copy of the figure on
      // the record.
      delete patch.opening;

      setAccounts((prevAccounts) =>
        prevAccounts.map((account) => (account.id === id ? patch : account))
      );
      setBalances((prevBalances) => withOpeningSnapshot(prevBalances, existing, patch, id));
      return { ok: true };
    },
    [accounts, validate, setAccounts, setBalances]
  );

  /**
   * Mark that the account was checked against its statement, and agreed.
   *
   * A mutator of its own rather than a field on `updateAccount`, because it is a
   * different kind of act: everything else there restates what the account *is*
   * — its name, what it holds, which side of the budget it sits on — while this
   * records something the user did on a particular day. It is also the one
   * change worth making from a screen that is otherwise read-only, and a button
   * that reads "Mark reconciled" should not be able to rename anything.
   *
   * Stores the date rather than a flag: "reconciled" with no day attached stops
   * meaning anything the moment the next transaction is logged, and the question
   * the dashboard asks is not whether an account was ever reconciled but how
   * long ago. Passing `null` clears it, so a reconciliation entered by mistake
   * can be taken back off.
   */
  const reconcileAccount = useCallback(
    ({ id, date = todayISO() }) => {
      if (!accounts.some((account) => account.id === id)) {
        return { ok: false, error: "That account no longer exists." };
      }
      if (!(date === null || isValidISODate(date))) {
        return { ok: false, error: "Enter a valid date for the reconciliation." };
      }

      setAccounts((prevAccounts) =>
        prevAccounts.map((account) =>
          account.id === id ? { ...account, reconciledOn: date } : account
        )
      );
      return { ok: true };
    },
    [accounts, setAccounts]
  );

  /**
   * Which account a credit card is usually paid off from — a default for the
   * "Paid off" dialog and nothing more, the payee-default rule: it moves no
   * money and restates nothing already paid. `null` takes it off. Only an
   * account the budget spends through and that is not itself a card can pay
   * one, since paying a card from another card is a balance transfer and
   * paying it from an off-budget holding is not budget money.
   *
   * Stored on the card only once stated, so a record that never named one
   * keeps the shape it always had.
   */
  const setPayFromAccount = useCallback(
    ({ id, payFromAccountId }) => {
      if (!accounts.some((account) => account.id === id)) {
        return { ok: false, error: "That account no longer exists." };
      }
      if (payFromAccountId != null) {
        const source = accounts.find((account) => account.id === payFromAccountId);
        if (
          !source ||
          source.id === id ||
          source.scope !== ACCOUNT_SCOPES.ON_BUDGET
        ) {
          return { ok: false, error: "Choose an on-budget account to pay it from." };
        }
      }
      setAccounts((prevAccounts) =>
        prevAccounts.map((account) =>
          account.id === id ? { ...account, payFromAccountId: payFromAccountId ?? null } : account
        )
      );
      return { ok: true };
    },
    [accounts, setAccounts]
  );

  /**
   * A new order for some of the accounts, from a drag: the ids named take turns
   * in the places they already held, and nothing else moves (`reorderSubset`).
   * Array order is display order, so this is the whole of it.
   */
  const reorderAccounts = useCallback(
    (orderedIds) => {
      setAccounts((previous) => reorderSubset(previous, orderedIds));
      return { ok: true };
    },
    [setAccounts]
  );

  // Deleting an account drops its balance history with it — there is nothing
  // meaningful to reassign those to. Its transactions are kept and cut loose
  // instead: the money moved and the envelopes it moved through are unchanged,
  // so deleting them would rewrite every category balance because the user
  // tidied up their account list.
  const deleteAccount = useCallback(
    ({ id }) => {
      setBalances((prevBalances) => prevBalances.filter((balance) => balance.accountId !== id));
      setAccounts((prevAccounts) => prevAccounts.filter((account) => account.id !== id));
      detachAccountTransactions({ accountId: id });
    },
    [setBalances, setAccounts, detachAccountTransactions]
  );

  const getAccountBalances = useCallback(
    (accountId) => balances.filter((balance) => balance.accountId === accountId),
    [balances]
  );

  const getPeriodBalances = useCallback(
    (period) => balances.filter((balance) => balance.period === period),
    [balances]
  );

  // Upsert: one balance per (accountId, period). A liability's balance is
  // negative, so this validates only that the figure is a real number.
  const setBalance = useCallback(
    ({ accountId, period, amount, amountCents }) => {
      const cents = amountCents ?? toCents(amount);
      if (cents == null) {
        return { ok: false, error: "Enter a balance as a number." };
      }

      setBalances((prevBalances) => {
        const existing = prevBalances.find(
          (balance) => balance.accountId === accountId && balance.period === period
        );
        if (existing) {
          return prevBalances.map((balance) =>
            balance.id === existing.id ? { ...balance, amountCents: cents } : balance
          );
        }
        return [...prevBalances, { id: uuidV4(), accountId, period, amountCents: cents }];
      });

      return { ok: true };
    },
    [setBalances]
  );

  /**
   * A whole month's snapshots in one commit — the "first of the month, update
   * everything" pass the Net worth page is built around.
   *
   * The whole batch is validated before anything is written, as
   * `setPeriodAssignments` does: a form covering six holdings that failed on the
   * fourth would leave three committed and three not, and nothing on screen to
   * say which.
   *
   * An entry whose amount is blank **removes** that account's snapshot for the
   * period rather than storing zero. The two are different facts here in a way
   * they are not for an assignment: zero is a real balance — an account emptied,
   * a card paid off — while no snapshot means the month was never updated, and
   * the account carries its previous figure forward. Pruning zeros the way
   * assignments do would make "paid the card off" unrecordable.
   */
  const setPeriodBalances = useCallback(
    ({ period, entries }) => {
      if (toPeriod(period) == null) return { ok: false, error: "Enter a valid period." };

      const checked = validateBalanceEntries(entries);
      if (!checked.ok) return checked;

      // Functional updater, not the closed-over array: index.js renders under
      // StrictMode, which invokes the updater twice.
      setBalances((prevBalances) =>
        applyPeriodBalances(prevBalances, period, checked.validated)
      );
      return { ok: true };
    },
    [setBalances]
  );

  /**
   * A window of months in one commit — the backfill grid on the Configuration
   * page, where a year of a holding's history is typed in a single pass.
   *
   * The same all-or-nothing rule as `setPeriodBalances`, carried up a level:
   * there, a form covering six holdings must not fail on the fourth; here, a grid
   * covering twelve months must not fail on August and leave the seven months
   * before it written. So every month is validated before any of them is applied,
   * and the whole window lands in one update — which is also what stops a
   * half-written backfill being read by the chart between renders.
   *
   * A rejection names the month as well as the account, because the field to go
   * back to is a cell rather than a row.
   */
  const setBalanceHistory = useCallback(
    ({ months }) => {
      const checked = [];
      for (const { period, entries } of months) {
        if (toPeriod(period) == null) return { ok: false, error: "Enter a valid period." };

        const result = validateBalanceEntries(entries);
        if (!result.ok) return { ok: false, error: `${formatPeriod(period)}: ${result.error}` };
        checked.push({ period, validated: result.validated });
      }

      setBalances((prevBalances) =>
        checked.reduce(
          (next, { period, validated }) => applyPeriodBalances(next, period, validated),
          prevBalances
        )
      );
      return { ok: true };
    },
    [setBalances]
  );

  const deleteBalance = useCallback(
    ({ id }) => setBalances((prevBalances) => prevBalances.filter((balance) => balance.id !== id)),
    [setBalances]
  );

  // Memoised so a change in any other store does not re-render every consumer
  // of this one.
  const value = useMemo(
    () => ({
      accounts,
      balances,
      addAccount,
      updateAccount,
      reconcileAccount,
      setPayFromAccount,
      reorderAccounts,
      deleteAccount,
      getAccountBalances,
      getPeriodBalances,
      setBalance,
      setPeriodBalances,
      setBalanceHistory,
      deleteBalance,
    }),
    [
      accounts,
      balances,
      addAccount,
      updateAccount,
      reconcileAccount,
      setPayFromAccount,
      reorderAccounts,
      deleteAccount,
      getAccountBalances,
      getPeriodBalances,
      setBalance,
      setPeriodBalances,
      setBalanceHistory,
      deleteBalance,
    ]
  );

  return <AccountsContext.Provider value={value}>{children}</AccountsContext.Provider>;
};
