import React, { useCallback, useContext, useMemo } from "react";
import useSyncedState from "../hooks/useSyncedState";
import { toCents } from "../utils";

/**
 * The emergency fund: how much of the household's own plan it should cover, and
 * where the money for it is held.
 *
 * **It holds no money and derives no target.** What is stored here is the shape
 * of the question — how many months, or which figure instead, and which accounts
 * count — exactly as `SavingsGoalsContext` stores a target and leaves the money
 * next door. The answer is `useEmergencyFund`'s, because the figure it needs
 * comes from the plan (the essentials estimates) and the balance sheet (what the
 * ticked accounts are worth), and no single store may read another.
 *
 * **Why the target is derived from essentials rather than typed.** An emergency
 * fund is not a round number somebody likes; it is however long the household
 * could carry its own necessary spending with no income. The app already asks
 * which categories are necessary — every category carries a bucket, and
 * `PLAN_BUCKETS.ESSENTIALS` is that answer — so the figure is already in the
 * books and a hand-typed target would be a second, staler copy of it. Raise the
 * rent on the plan and the fund that has to cover it rises the same day.
 *
 * **Both answers are kept, as everywhere else in the app two are legitimate.**
 * `targetSource` says which is in force and the other is kept rather than
 * cleared — the `RetirementContext` rule, for its reason: comparing "six months
 * of essentials" against "fifty thousand" is the point, and a switch that
 * destroyed what it switched away from could only be used once. A typed figure is
 * a real answer rather than an escape hatch: a household with a redundancy
 * package in mind, or one whose essentials are not all on this plan yet, is
 * stating something the derivation cannot know.
 *
 * `accountIds` is the same question `RetirementContext` asks about retirement
 * money and is answered the same way — **inert but kept**, never checked against
 * the live accounts, because refusing an unknown id would mean this store
 * reaching into another one. An id whose account was deleted reads as an account
 * contributing nothing.
 *
 * **A ticked account counts whole unless the household says how much of it is
 * the fund.** `accountAmounts` maps an account id to the part of its balance
 * set aside, because almost nobody opens an account *only* for this: the buffer
 * is usually the first ten thousand of an ordinary savings account that also
 * holds the holiday money. Absent means the whole balance, which is what a tick
 * meant before the field existed — so a record stored without it reads exactly
 * as it always did. An amount is kept when its account is unticked, the
 * switched-away-from rule, and like `accountIds` it is never checked against
 * the live accounts.
 *
 * A single record with a whole-value guard rather than a field-presence
 * migration, like `PayScheduleContext` and `RetirementContext`: this is one
 * record, not a list of them, and anything unreadable reads as "not set up yet".
 */
const EmergencyFundContext = React.createContext();

/** Where the target comes from. */
export const TARGET_SOURCES = {
  /** A multiple of the plan's own essentials — the derived answer. */
  MONTHS: "months",
  /** A figure the household states outright. */
  AMOUNT: "amount",
};

const TARGET_SOURCE_VALUES = Object.values(TARGET_SOURCES);

/**
 * The widest multiple worth offering, in months.
 *
 * Ten years, the same ceiling `useSpendingReport` and the net-worth chart keep,
 * and for a related reason: past that the figure has stopped being an emergency
 * fund and become a retirement plan, which this app answers elsewhere and
 * properly — with growth, inflation and a drawdown rate, none of which a multiple
 * of this month's groceries has.
 */
export const MAX_MONTHS_COVERED = 120;

export const DEFAULT_FUND = {
  targetSource: TARGET_SOURCES.MONTHS,
  // Three to six months is the common advice and six is the conservative end of
  // it, which is also what the spreadsheet this was drawn from used. It is a
  // default rather than a rule — the field is right there.
  monthsCovered: 6,
  // The typed answer, kept while the derived one is in force. Null is "nothing
  // typed", which is distinct from zero: a target of nothing is not a target,
  // the same bound `SavingsGoalsContext` puts on `targetCents`.
  targetCents: null,
  // Empty rather than "every cash account": which account is the emergency fund
  // is a judgement, and guessing it would put a figure on screen the household
  // never agreed to. `RetirementContext`'s reasoning for the same field.
  accountIds: [],
  // id -> cents of that account counted as the fund. Missing is the whole
  // balance; there is no "zero" entry, since an account contributing nothing is
  // one that is not ticked.
  accountAmounts: {},
  // Whether what the fund holds is kept out of "to be assigned". On by
  // default: the fund's money sits in on-budget accounts, so without this it
  // reads as free to assign and can be spent twice. Off is for a household
  // that already sets the fund aside through a category of its own, where
  // holding it back as well would count it twice.
  holdBack: true,
};

export function useEmergencyFundPlan() {
  return useContext(EmergencyFundContext);
}

const isMonths = (value) =>
  Number.isInteger(value) && value >= 1 && value <= MAX_MONTHS_COVERED;
const isAmount = (value) => Number.isInteger(value) && value > 0;

function migrateFund(stored) {
  const fund = stored && typeof stored === "object" ? stored : {};

  return {
    targetSource: TARGET_SOURCE_VALUES.includes(fund.targetSource)
      ? fund.targetSource
      : DEFAULT_FUND.targetSource,
    monthsCovered: isMonths(fund.monthsCovered)
      ? fund.monthsCovered
      : DEFAULT_FUND.monthsCovered,
    targetCents: isAmount(fund.targetCents) ? fund.targetCents : null,
    accountIds: Array.isArray(fund.accountIds)
      ? [...new Set(fund.accountIds.filter((id) => typeof id === "string"))]
      : [],
    accountAmounts: readAmounts(fund.accountAmounts),
    holdBack: fund.holdBack !== false,
  };
}

/** Only well-formed entries survive: a string id and a positive whole figure. */
function readAmounts(stored) {
  const amounts = {};
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return amounts;
  for (const [id, cents] of Object.entries(stored)) {
    if (isAmount(cents)) amounts[id] = cents;
  }
  return amounts;
}

const isBlank = (value) =>
  value === null || value === undefined || String(value).trim() === "";

export const EmergencyFundProvider = ({ children }) => {
  const [fund, setFund] = useSyncedState("emergencyFund", DEFAULT_FUND, migrateFund);

  /**
   * One patch, each field checked on its own — the `RetirementContext` contract,
   * including the part that matters most: a field the patch does not name is not
   * touched, so the answer not in force survives being switched away from.
   */
  const setEmergencyFund = useCallback(
    (changes) => {
      const patch = {};

      if (changes.targetSource !== undefined) {
        if (!TARGET_SOURCE_VALUES.includes(changes.targetSource)) {
          return { ok: false, error: "Choose where the target comes from." };
        }
        patch.targetSource = changes.targetSource;
      }

      if (changes.monthsCovered !== undefined) {
        // No blank here, unlike every other field: there is always a multiple in
        // force, so an empty one would be a target of nothing rather than a
        // question left open. The field puts the old figure back.
        const months = Number(String(changes.monthsCovered).trim());
        if (!isMonths(months)) {
          return {
            ok: false,
            error: `Enter a whole number of months, from 1 to ${MAX_MONTHS_COVERED}.`,
          };
        }
        patch.monthsCovered = months;
      }

      if (changes.targetCents !== undefined) {
        // Blank is how a typed target is *removed*, which is why it cannot be
        // read as a rejected parse — the `readGoal` rule in BudgetsContext.
        if (isBlank(changes.targetCents)) {
          patch.targetCents = null;
        } else {
          const cents =
            typeof changes.targetCents === "number"
              ? changes.targetCents
              : toCents(changes.targetCents);
          if (!isAmount(cents)) {
            return { ok: false, error: "Enter a target greater than zero, or leave it blank." };
          }
          patch.targetCents = cents;
        }
      }

      if (changes.accountIds !== undefined) {
        if (!Array.isArray(changes.accountIds)) {
          return { ok: false, error: "Choose which accounts hold the fund." };
        }
        patch.accountIds = [...new Set(changes.accountIds.filter((id) => typeof id === "string"))];
      }

      if (changes.holdBack !== undefined) {
        patch.holdBack = changes.holdBack === true;
      }

      // Functional updater rather than the closed-over record: index.js renders
      // under StrictMode, which invokes the updater twice.
      setFund((previous) => ({ ...previous, ...patch }));
      return { ok: true };
    },
    [setFund]
  );

  /** One account in or out. A mutator of its own rather than making every caller
   *  rebuild the list, which is `toggleRetirementAccount`'s reasoning — and it
   *  cannot fail, since a tick names an account that is on screen. */
  const toggleFundAccount = useCallback(
    ({ accountId, included }) => {
      setFund((previous) => {
        const rest = previous.accountIds.filter((id) => id !== accountId);
        return { ...previous, accountIds: included ? [...rest, accountId] : rest };
      });
      return { ok: true };
    },
    [setFund]
  );

  /**
   * How much of one account is the fund. Blank puts the account back to
   * counting whole — the way a portion is *removed*, so a blank is never read
   * as a refused figure; junk, zero and a negative are refused, since a part of
   * nothing is not a part.
   */
  const setFundAccountAmount = useCallback(
    ({ accountId, amount }) => {
      if (typeof accountId !== "string") {
        return { ok: false, error: "Choose which account the amount is for." };
      }

      let cents = null;
      if (!isBlank(amount)) {
        cents = typeof amount === "number" ? amount : toCents(amount);
        if (!isAmount(cents)) {
          return {
            ok: false,
            error: "Enter how much of the account is the fund, or leave it blank to count all of it.",
          };
        }
      }

      setFund((previous) => {
        const { [accountId]: _dropped, ...rest } = previous.accountAmounts ?? {};
        return {
          ...previous,
          accountAmounts: cents == null ? rest : { ...rest, [accountId]: cents },
        };
      });
      return { ok: true };
    },
    [setFund]
  );

  const value = useMemo(
    () => ({ fund, setEmergencyFund, toggleFundAccount, setFundAccountAmount }),
    [fund, setEmergencyFund, toggleFundAccount, setFundAccountAmount]
  );

  return <EmergencyFundContext.Provider value={value}>{children}</EmergencyFundContext.Provider>;
};
