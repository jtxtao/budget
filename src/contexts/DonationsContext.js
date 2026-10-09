import React, { useCallback, useContext, useMemo } from "react";
import { v4 as uuidV4 } from "uuid";
import useSyncedState from "../hooks/useSyncedState";
import { toBps, toCents } from "../utils";

/**
 * Giving: who the household gives to, which of its outflows were gifts, how much
 * of each one the tax office will recognise, and what it is aiming to give.
 *
 * **A donation is not a movement of money.** It is a *statement about* one that
 * already exists in the ledger — the second ledger this store is not. A gift is
 * an outflow like any other: it leaves an account, it comes out of a category, it
 * counts against an envelope, and it is on the register with everything else.
 * What the ledger cannot know is the part that only matters in April: which
 * organisation it went to, and how much of it is deductible. So a donation record
 * is keyed on the transaction it describes and carries nothing the ledger already
 * holds — no amount, no date, no account. Copying the amount here would give the
 * household two figures for one gift, and the day they disagreed there would be
 * no way to tell which was the money.
 *
 * Three record shapes, in three keys:
 *
 *   recipient { id, name, deductible }
 *   donation  { transactionId, recipientId, deductibleCents, acknowledged }
 *   goal      { year, source, amountCents, shareBps }
 *
 * **`deductibleCents` is stated on every donation — there is no "ask the
 * organisation" state.** A recipient's `deductible` flag is only what a new gift
 * *starts* on, the same rule a category's bucket follows in `BudgetsContext`:
 * resolved once, at entry, so that correcting an organisation's status later
 * cannot silently restate what was claimed on a return already filed. It also
 * covers the case a flag cannot: a $200 gala ticket against an $80 dinner is
 * $120 deductible, and no property of the charity says so.
 *
 * **The one bound this store cannot check is "no more than the gift itself".**
 * The amount lives on the transaction, which this store does not read — the
 * dependency runs one way, as everywhere else. So the forms check it where they
 * have the figure in hand, and `useGiving` clamps what it reads, which is what
 * keeps an amount edited down on the register from leaving a deduction stranded
 * above it.
 *
 * The cascade runs the other way: `TransactionsContext.deleteTransaction` calls
 * `removeDonation`, which is why `DonationsProvider` sits *outside* it. Deleting
 * the money deletes the statement about it; untagging the gift leaves the money
 * alone, because the money still moved.
 */
const DonationsContext = React.createContext();

/** How a year's giving goal is arrived at. Two legitimate answers, and both are
 *  kept — a household that gives a tenth wants the tenth to follow what it
 *  actually earned, and one giving a fixed sum wants the sum. */
export const GOAL_SOURCES = {
  /** A figure the user names for the year. */
  AMOUNT: "amount",
  /** A share of what actually came in — a tithe, and what it is usually called. */
  INCOME_SHARE: "income-share",
};

const GOAL_SOURCE_VALUES = Object.values(GOAL_SOURCES);

export const DEFAULT_GOAL_SOURCE = GOAL_SOURCES.AMOUNT;

/**
 * The gift size above which the tax office wants a written acknowledgment from
 * the charity rather than the household's own record of it.
 *
 * $250 in US rules, which is the currency this app books. It decides nothing on
 * its own — no figure moves because a receipt is missing — it only decides which
 * gifts `useGiving` counts as still needing one, so the page can list them while
 * they can still be asked for.
 */
export const ACKNOWLEDGMENT_THRESHOLD_CENTS = 25000;

/** A goal above everything the household earned is a typo, not an intention. */
export const MAX_GOAL_SHARE_BPS = 10000;

export function useDonations() {
  return useContext(DonationsContext);
}

const isAmount = (value) => Number.isInteger(value) && value >= 0;
const isShare = (value) => Number.isInteger(value) && value >= 0 && value <= MAX_GOAL_SHARE_BPS;
/** Years are the four digits, as a string — the leading slice of an ISO date, so
 *  a gift's year is derived from its transaction rather than stored beside it,
 *  exactly as a period is. */
export const isYear = (value) => typeof value === "string" && /^\d{4}$/.test(value);

/** "2026-08-11" -> "2026", or null for a record with no date to place it by. */
export function toYear(isoDate) {
  return typeof isoDate === "string" && /^\d{4}-\d{2}(?:-\d{2})?$/.test(isoDate)
    ? isoDate.slice(0, 4)
    : null;
}

const AMOUNT_ERROR = "Enter how much of the gift is tax deductible, as an amount of zero or more.";

/**
 * A deductible figure off a form or off a caller, as either cents or typed
 * dollars — `null` for junk, so a bad figure is refused rather than quietly
 * stored as nothing claimed.
 *
 * Unlike a category's goal there is no blank state to tell apart: every gift has
 * a deductible portion, and for most of them it is either the whole thing or
 * none of it. A blank field is therefore junk here, not an instruction.
 */
function readDeductible({ deductible, deductibleCents }) {
  if (deductibleCents !== undefined) return isAmount(deductibleCents) ? deductibleCents : null;
  const cents = toCents(deductible);
  return cents != null && cents >= 0 ? cents : null;
}

// Keyed on field presence rather than a version counter, so it is
// self-describing and safe to re-run.
function migrateRecipients(stored) {
  const recipients = Array.isArray(stored) ? stored : [];
  return recipients
    .filter((recipient) => recipient && recipient.name != null)
    .map((recipient) => ({
      id: recipient.id ?? uuidV4(),
      name: recipient.name,
      // A record saved before the flag existed is treated as a qualified
      // charity, which is what an organisation somebody bothered to list
      // almost always is — and it is only a default for the next gift, so
      // getting it wrong costs a select, not a figure.
      deductible: recipient.deductible !== false,
    }));
}

function migrateDonations(stored) {
  const donations = Array.isArray(stored) ? stored : [];
  return donations
    .filter((donation) => donation && typeof donation.transactionId === "string")
    .map((donation) => ({
      transactionId: donation.transactionId,
      // Null is a real state: the organisation was deleted and the gift
      // outlived it, the same way spend outlives its category.
      recipientId: donation.recipientId ?? null,
      deductibleCents: isAmount(donation.deductibleCents) ? donation.deductibleCents : 0,
      acknowledged: donation.acknowledged === true,
    }));
}

function migrateGoals(stored) {
  const goals = Array.isArray(stored) ? stored : [];
  return goals
    .filter((goal) => goal && isYear(goal.year))
    .map((goal) => ({
      year: goal.year,
      source: GOAL_SOURCE_VALUES.includes(goal.source) ? goal.source : DEFAULT_GOAL_SOURCE,
      // Both nullable and both kept. A year with neither figure is a year with
      // no goal, which is most of them — and the source it is sitting on says
      // which field the page should be asking for.
      amountCents: isAmount(goal.amountCents) ? goal.amountCents : null,
      shareBps: isShare(goal.shareBps) ? goal.shareBps : null,
    }));
}

/**
 * Which categories are giving, and which of their outflows are not.
 *
 * **Spending filed under a giving category is a gift without being tagged one**
 * — the household already said so when it filed it, and asking again on this
 * page was the step everybody skipped. `budgetIds: null` means "whatever is
 * named like giving" (`isGivingName`), resolved where it is read, so a category
 * added later called "Donations" is picked up without a visit here; a list is a
 * choice the household made and replaces the guess. `excludedIds` is the
 * transactions in those categories the household has said are not gifts — the
 * untag button on a row nobody tagged.
 */
export const DEFAULT_GIVING_SETTINGS = { budgetIds: null, excludedIds: [] };

const GIVING_NAME = /\b(donat|giving|charit|tith|offering)/i;

/** A category name that reads as giving — the guess used until one is chosen. */
export const isGivingName = (name) => GIVING_NAME.test(name ?? "");

/** The category ids counting as giving, under the settings and the live plan. */
export function givingBudgetIds(settings, budgets) {
  if (Array.isArray(settings?.budgetIds)) return new Set(settings.budgetIds);
  return new Set(budgets.filter((budget) => isGivingName(budget.name)).map((budget) => budget.id));
}

const readIds = (value) =>
  Array.isArray(value) ? [...new Set(value.filter((id) => typeof id === "string"))] : null;

function migrateGivingSettings(stored) {
  const settings = stored && typeof stored === "object" ? stored : {};
  return {
    budgetIds: readIds(settings.budgetIds),
    excludedIds: readIds(settings.excludedIds) ?? [],
  };
}

export const DonationsProvider = ({ children }) => {
  const [recipients, setRecipients] = useSyncedState(
    "donationRecipients",
    [],
    migrateRecipients
  );
  const [donations, setDonations] = useSyncedState("donations", [], migrateDonations);
  const [goals, setGoals] = useSyncedState("donationGoals", [], migrateGoals);
  const [givingSettings, setGivingSettings] = useSyncedState(
    "givingSettings",
    DEFAULT_GIVING_SETTINGS,
    migrateGivingSettings
  );

  /** Choose which categories are giving; `null` goes back to guessing by name. */
  const setGivingCategories = useCallback(
    (budgetIds) => {
      const ids = budgetIds === null ? null : readIds(budgetIds);
      if (budgetIds !== null && ids == null) {
        return { ok: false, error: "Choose which categories are giving." };
      }
      setGivingSettings((previous) => ({ ...previous, budgetIds: ids }));
      return { ok: true };
    },
    [setGivingSettings]
  );

  /** A transaction in a giving category that is not a gift — or is again. */
  const setGiftExcluded = useCallback(
    ({ transactionId, excluded }) => {
      setGivingSettings((previous) => {
        const rest = previous.excludedIds.filter((id) => id !== transactionId);
        return { ...previous, excludedIds: excluded ? [...rest, transactionId] : rest };
      });
      return { ok: true };
    },
    [setGivingSettings]
  );

  /**
   * Add an organisation. Returns a result rather than throwing: the caller has
   * to decide what to tell the user, and a modal that closes on a duplicate is
   * the one option that cannot be right.
   */
  const addRecipient = useCallback(
    ({ name, deductible = true }) => {
      const trimmed = (name ?? "").trim();
      if (!trimmed) return { ok: false, error: "Give the organization a name." };

      const clash = recipients.some(
        (recipient) => recipient.name.trim().toLowerCase() === trimmed.toLowerCase()
      );
      if (clash) {
        return { ok: false, error: `An organization named “${trimmed}” already exists.` };
      }

      const id = uuidV4();
      setRecipients((previous) => [
        ...previous,
        { id, name: trimmed, deductible: deductible !== false },
      ]);
      return { ok: true, id };
    },
    [recipients, setRecipients]
  );

  /**
   * Rename an organisation or restate whether gifts to it are deductible.
   * Undefined fields are left alone.
   *
   * Restating the flag changes what the *next* gift here starts on and nothing
   * else. The gifts already recorded each carry their own deductible figure, and
   * rewriting those from here would restate what was claimed in a year that may
   * already have been filed.
   */
  const updateRecipient = useCallback(
    ({ id, name, deductible }) => {
      const existing = recipients.find((recipient) => recipient.id === id);
      if (!existing) return { ok: false, error: "That organization no longer exists." };

      const patch = {};

      if (name !== undefined) {
        const trimmed = name.trim();
        if (!trimmed) return { ok: false, error: "Give the organization a name." };

        const clash = recipients.some(
          (recipient) =>
            recipient.id !== id &&
            recipient.name.trim().toLowerCase() === trimmed.toLowerCase()
        );
        if (clash) {
          return { ok: false, error: `An organization named “${trimmed}” already exists.` };
        }
        patch.name = trimmed;
      }

      if (deductible !== undefined) patch.deductible = deductible !== false;

      setRecipients((previous) =>
        previous.map((recipient) => (recipient.id === id ? { ...recipient, ...patch } : recipient))
      );
      return { ok: true };
    },
    [recipients, setRecipients]
  );

  /**
   * Remove an organisation, keeping every gift made to it.
   *
   * The same rule as deleting a category: the giving happened, and the record of
   * what was given and what was deductible is the whole point of keeping it. What
   * is lost is the name, which the page reports as a gap to be refiled rather
   * than as an empty cell — an internal cascade rather than a cross-store one,
   * since both lists live here.
   */
  const deleteRecipient = useCallback(
    ({ id }) => {
      setRecipients((previous) => previous.filter((recipient) => recipient.id !== id));
      setDonations((previous) =>
        previous.map((donation) =>
          donation.recipientId === id ? { ...donation, recipientId: null } : donation
        )
      );
      return { ok: true };
    },
    [setRecipients, setDonations]
  );

  /**
   * Mark one transaction as a gift, or restate the gift it already is.
   *
   * Written whole, and idempotent on the transaction id: one movement of money
   * is one gift, so recording against a transaction already tagged replaces the
   * statement rather than adding a second one beside it.
   *
   * The transaction is not checked for existence — this store cannot read the
   * ledger, and refusing an id it cannot see would mean reaching across the
   * dependency the provider order exists to keep one-way. A tag whose
   * transaction is gone contributes to nothing: `useGiving` drives the join from
   * the ledger, and `deleteTransaction` clears the tag on its way out.
   */
  const recordDonation = useCallback(
    ({ transactionId, recipientId, deductible, deductibleCents, acknowledged = false }) => {
      if (!transactionId) return { ok: false, error: "That transaction is no longer in the ledger." };
      if (!recipientId) return { ok: false, error: "Choose which organization this went to." };

      const cents = readDeductible({ deductible, deductibleCents });
      if (cents == null) return { ok: false, error: AMOUNT_ERROR };

      const record = {
        transactionId,
        recipientId,
        deductibleCents: cents,
        acknowledged: acknowledged === true,
      };

      setDonations((previous) => [
        ...previous.filter((donation) => donation.transactionId !== transactionId),
        record,
      ]);
      return { ok: true, id: transactionId };
    },
    [setDonations]
  );

  /**
   * Correct one field of a gift already tagged — which organisation it went to,
   * how much of it is deductible, whether the acknowledgment is in hand.
   *
   * A patch rather than a whole record, the same contract as
   * `updateTransaction`: the list edits one cell at a time, and a mutator taking
   * the full record would have every cell resubmitting the fields it did not
   * touch.
   */
  const updateDonation = useCallback(
    (patch) => {
      const current = donations.find(
        (donation) => donation.transactionId === patch?.transactionId
      );
      if (!current) return { ok: false, error: "That gift is no longer recorded." };

      const changes = {};

      if ("recipientId" in patch) {
        // "" is what an unpicked select is worth in the DOM. Unlike the stored
        // null a deleted organisation leaves behind, choosing nothing is not an
        // answer: a gift with no organisation cannot be claimed.
        if (!patch.recipientId) return { ok: false, error: "Choose which organization this went to." };
        changes.recipientId = patch.recipientId;
      }

      if ("deductible" in patch || "deductibleCents" in patch) {
        const cents = readDeductible(patch);
        if (cents == null) return { ok: false, error: AMOUNT_ERROR };
        changes.deductibleCents = cents;
      }

      if ("acknowledged" in patch) changes.acknowledged = patch.acknowledged === true;

      // Nothing actually moved. Writing anyway would re-render every consumer of
      // this store for a cell the user only tabbed through.
      const moved = Object.keys(changes).some((field) => changes[field] !== current[field]);
      if (!moved) return { ok: true, id: current.transactionId };

      setDonations((previous) =>
        previous.map((donation) =>
          donation.transactionId === current.transactionId ? { ...donation, ...changes } : donation
        )
      );
      return { ok: true, id: current.transactionId };
    },
    [donations, setDonations]
  );

  /**
   * This was not a gift — or the transaction it described is gone.
   *
   * Both callers want the same thing and neither wants the money touched. On the
   * donations page it is the user saying the outflow was misfiled, and the
   * outflow stays on the register because it still happened; from
   * `deleteTransaction` it is the cascade, and by then there is nothing left to
   * describe.
   */
  const removeDonation = useCallback(
    ({ transactionId }) => {
      setDonations((previous) =>
        previous.filter((donation) => donation.transactionId !== transactionId)
      );
      return { ok: true };
    },
    [setDonations]
  );

  /**
   * Set — or restate — what a year is aiming to give.
   *
   * Patch semantics per year, and **the answer not in force is kept**: a
   * household comparing "a tenth of what we earn" against "six thousand" is
   * doing the thing this control exists for, and a switch that cleared the
   * figure it switched away from could only be used once. Same rule as the
   * retirement plan's two sources.
   */
  const setGivingGoal = useCallback(
    ({ year, source, amount, amountCents, share, shareBps }) => {
      if (!isYear(year)) return { ok: false, error: "Choose a year for the goal." };

      const patch = {};

      if (source !== undefined) {
        if (!GOAL_SOURCE_VALUES.includes(source)) {
          return { ok: false, error: "Choose how the goal for the year is worked out." };
        }
        patch.source = source;
      }

      if (amount !== undefined || amountCents !== undefined) {
        // A blank is how a goal is taken off, which is why this one field has an
        // empty state where a gift's deductible portion does not: a year with no
        // target is the ordinary case, and a target of nothing is not the same
        // statement.
        const blank =
          amountCents === null ||
          (amountCents === undefined && String(amount ?? "").trim() === "");
        const cents = blank ? null : amountCents !== undefined ? amountCents : toCents(amount);
        if (!blank && !isAmount(cents)) {
          return { ok: false, error: "Enter a giving goal of zero or more, or leave it blank." };
        }
        patch.amountCents = cents;
      }

      if (share !== undefined || shareBps !== undefined) {
        const blank =
          shareBps === null || (shareBps === undefined && String(share ?? "").trim() === "");
        const bps = blank ? null : shareBps !== undefined ? shareBps : toBps(share);
        if (!blank && !isShare(bps)) {
          return {
            ok: false,
            error: `Enter a share of your income between 0 and ${MAX_GOAL_SHARE_BPS / 100} percent, or leave it blank.`,
          };
        }
        patch.shareBps = bps;
      }

      setGoals((previous) => {
        const existing = previous.find((goal) => goal.year === year);
        const next = {
          year,
          source: DEFAULT_GOAL_SOURCE,
          amountCents: null,
          shareBps: null,
          ...existing,
          ...patch,
        };
        return existing
          ? previous.map((goal) => (goal.year === year ? next : goal))
          : [...previous, next];
      });
      return { ok: true };
    },
    [setGoals]
  );

  // Memoised so a change in any other store does not re-render every consumer
  // of this one.
  const value = useMemo(
    () => ({
      recipients,
      donations,
      goals,
      givingSettings,
      addRecipient,
      updateRecipient,
      deleteRecipient,
      recordDonation,
      updateDonation,
      removeDonation,
      setGivingGoal,
      setGivingCategories,
      setGiftExcluded,
    }),
    [
      recipients,
      donations,
      goals,
      givingSettings,
      setGivingCategories,
      setGiftExcluded,
      addRecipient,
      updateRecipient,
      deleteRecipient,
      recordDonation,
      updateDonation,
      removeDonation,
      setGivingGoal,
    ]
  );

  return <DonationsContext.Provider value={value}>{children}</DonationsContext.Provider>;
};
