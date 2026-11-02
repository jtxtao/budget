import React, { useCallback, useContext, useMemo } from "react";
import { v4 as uuidV4 } from "uuid";
import useSyncedState from "../hooks/useSyncedState";
import { reorderSubset } from "../domain/reorder";
import { useSavingsGoalAssignments } from "./SavingsGoalAssignmentsContext";
import { todayISO, toCents } from "../utils";

/**
 * Medium-term savings: a camera, a wedding, a special event — a goal that is
 * expected to *exceed* the normal monthly budget, so it has to be planned
 * around rather than absorbed into an envelope's estimate.
 *
 * Independent of every store but one, in both directions: nothing here moves
 * money, and nothing but SavingsGoalAssignments references a goal's id — and
 * only to drop its assignments when the goal is deleted, never to read them
 * back. A goal is a standing intention —
 * { id, name, targetCents, targetDate, accountIds, accountAmounts }.
 *
 * **A goal's money can already be sitting off budget**, which is what the last
 * two fields are for: a house deposit years out is usually invested rather than
 * left in a current account, and before this the only money a goal could count
 * was what the budget had assigned to it — so an invested fund read as a goal
 * nobody had started. `accountIds` names the off-budget accounts holding it and
 * `accountAmounts` says how much of one, where only part of it is this goal's.
 *
 * Both are **inert but kept**, the rule `EmergencyFundContext` and
 * `RetirementContext` keep for the same question: this store reads no other, so
 * an id is never checked against the live accounts. One whose account was
 * deleted — or moved on budget, where its money is in the pool and counting it
 * here would count it twice — contributes nothing, resolved where it is read in
 * `useSavingsGoalEnvelopes`. An amount survives its account being unticked.
 *
 * It still holds no money and names no figure of its own: what an account is
 * worth is `useNetWorth`'s answer, joined to the goal one level up.
 *
 * **`spending` is what has already been spent towards the goal** — the venue,
 * the photographer, the dress, each `{ id, date, amountCents, budgetId, note,
 * transactionId }`. A statement, not money: the money itself moved out of the
 * goal and into `budgetId` as an ordinary assignment, and the purchase is an
 * ordinary outflow against that category (`useGoalSpending` makes all three
 * writes). This list only remembers that the move was *spending towards this
 * goal* rather than a pull-back, so the goal can report planned, saved and spent
 * apart. No envelope or balance sum reads it. `budgetId` and `transactionId`
 * are inert but kept.
 *
 * **`archivedOn` closes a goal out** (`"YYYY-MM-DD"`, or null for a live one).
 * An archived goal keeps its record, its spending and its assignments; it only
 * leaves the active list and the funding form.
 */
const SavingsGoalsContext = React.createContext();

export function useSavingsGoals() {
  return useContext(SavingsGoalsContext);
}

const isAmount = (value) => Number.isInteger(value) && value > 0;
const isDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
// The paper a goal's envelope is drawn in. Canopy, the first, is the default.
export const ENVELOPE_COLORS = ["canopy", "sage", "kraft", "butter", "orange", "rose", "red", "lavender", "indigo", "sky", "cobalt"];

/** The fields `addSavingsGoal` and `updateSavingsGoal` both have to check. */
function parseGoalFields({ name, target, targetCents, targetDate, budgetId, photo, link, envelopeColor }) {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return { ok: false, error: "Give the goal a name." };

  const cents = targetCents !== undefined ? targetCents : toCents(target);
  if (!isAmount(cents)) {
    return { ok: false, error: "Enter a target amount greater than zero." };
  }

  const date = targetDate || null;
  if (date !== null && !isDate(date)) {
    return { ok: false, error: "Enter a valid target date, or leave it blank." };
  }

  // Inert but kept: a string id is stored as-is, "" or non-string becomes null.
  const linkedBudgetId = typeof budgetId === "string" && budgetId ? budgetId : null;

  const rawLink = typeof link === "string" ? link.trim() : "";
  let goalLink = null;
  if (rawLink) {
    try {
      const parsedLink = new URL(rawLink);
      if (parsedLink.protocol !== "http:" && parsedLink.protocol !== "https:") throw new Error();
      goalLink = parsedLink.href;
    } catch {
      return { ok: false, error: "Enter a valid web link, or leave it blank." };
    }
  }

  const goalPhoto = typeof photo === "string" && photo.startsWith("data:image/") && photo.length <= 180_000 ? photo : null;
  const color = ENVELOPE_COLORS.includes(envelopeColor) ? envelopeColor : ENVELOPE_COLORS[0];
  return { ok: true, name: trimmed, targetCents: cents, targetDate: date, budgetId: linkedBudgetId, photo: goalPhoto, link: goalLink, envelopeColor: color };
}

/** Ids, deduped. Anything that is not a string was never an account id. */
function readAccountIds(value) {
  if (!Array.isArray(value)) return null;
  return [...new Set(value.filter((id) => typeof id === "string"))];
}

/** Only well-formed spending entries survive a read of storage. */
function readSpending(stored) {
  if (!Array.isArray(stored)) return [];
  return stored
    .filter((entry) => entry && isAmount(entry.amountCents) && isDate(entry.date))
    .map((entry) => ({
      id: typeof entry.id === "string" ? entry.id : uuidV4(),
      date: entry.date,
      amountCents: entry.amountCents,
      budgetId: typeof entry.budgetId === "string" ? entry.budgetId : null,
      note: typeof entry.note === "string" ? entry.note : "",
      transactionId: typeof entry.transactionId === "string" ? entry.transactionId : null,
    }));
}

const AMOUNT_ERROR =
  "Enter how much of an account is this goal, or leave it blank to count all of it.";

/**
 * The two holding fields, each only when the caller names it — a patch that
 * says nothing about them leaves what is stored alone, which is what lets the
 * edit modal save a renamed goal without restating where its money is.
 *
 * A blank amount is how a part is *removed* (the account goes back to counting
 * whole), so the form drops the entry rather than sending an empty one; zero
 * and a negative are refused here, since a part of nothing is not a part.
 * `setFundAccountAmount`'s contract, asked of the whole map at once because
 * this arrives from a form that commits every answer together.
 */
function parseHoldings({ accountIds, accountAmounts }) {
  const patch = {};

  if (accountIds !== undefined) {
    const ids = readAccountIds(accountIds);
    if (ids == null) return { ok: false, error: "Choose which accounts hold this goal's money." };
    patch.accountIds = ids;
  }

  if (accountAmounts !== undefined) {
    if (!accountAmounts || typeof accountAmounts !== "object" || Array.isArray(accountAmounts)) {
      return { ok: false, error: AMOUNT_ERROR };
    }
    const amounts = {};
    for (const [id, amount] of Object.entries(accountAmounts)) {
      const cents = typeof amount === "number" ? amount : toCents(amount);
      if (!isAmount(cents)) return { ok: false, error: AMOUNT_ERROR };
      amounts[id] = cents;
    }
    patch.accountAmounts = amounts;
  }

  return { ok: true, patch };
}

/** Only well-formed entries survive a read of storage: a positive whole figure
 *  under a string id. `EmergencyFundContext`'s `readAmounts`. */
function storedAmounts(stored) {
  const amounts = {};
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return amounts;
  for (const [id, cents] of Object.entries(stored)) {
    if (isAmount(cents)) amounts[id] = cents;
  }
  return amounts;
}

// Keyed on field presence rather than a version counter, so it is
// self-describing and safe to re-run.
function migrateGoals(stored) {
  const goals = Array.isArray(stored) ? stored : [];
  return goals
    .filter((goal) => goal && typeof goal.name === "string" && isAmount(goal.targetCents))
    .map((goal) => ({
      id: goal.id ?? uuidV4(),
      name: goal.name,
      targetCents: goal.targetCents,
      // Optional: a goal without a date in mind is still a goal.
      targetDate: isDate(goal.targetDate) ? goal.targetDate : null,
      // Purely additive, like every other field stamped on by a migration: a
      // goal saved before its money could be held off budget was being funded
      // out of the budget and nothing else, which is what these two say.
      accountIds: readAccountIds(goal.accountIds) ?? [],
      accountAmounts: storedAmounts(goal.accountAmounts),
      // Inert but kept: a deleted category contributes nothing, resolved where read.
      budgetId: typeof goal.budgetId === "string" ? goal.budgetId : null,
      photo: typeof goal.photo === "string" && goal.photo.startsWith("data:image/") && goal.photo.length <= 180_000 ? goal.photo : null,
      link: typeof goal.link === "string" && /^https?:\/\//i.test(goal.link) ? goal.link : null,
      envelopeColor: ENVELOPE_COLORS.includes(goal.envelopeColor) ? goal.envelopeColor : ENVELOPE_COLORS[0],
      // Purely additive: a goal saved before either existed had spent nothing
      // through the app and was never closed out.
      spending: readSpending(goal.spending),
      archivedOn: isDate(goal.archivedOn) ? goal.archivedOn : null,
    }));
}

export const SavingsGoalsProvider = ({ children }) => {
  const [goals, setGoals] = useSyncedState("savingsGoals", [], migrateGoals);
  const { removeGoalAssignments } = useSavingsGoalAssignments();

  /**
   * Add a savings goal. Returns a result rather than throwing: the caller has
   * to decide what to tell the user.
   */
  const addSavingsGoal = useCallback(
    (fields) => {
      const parsed = parseGoalFields(fields);
      if (!parsed.ok) return parsed;
      const holdings = parseHoldings(fields);
      if (!holdings.ok) return holdings;

      const id = uuidV4();
      setGoals((previous) => [
        ...previous,
        {
          id,
          name: parsed.name,
          targetCents: parsed.targetCents,
          targetDate: parsed.targetDate,
          budgetId: parsed.budgetId,
          photo: parsed.photo,
          link: parsed.link,
          envelopeColor: parsed.envelopeColor,
          // Empty rather than a guess at which account the money is in — the
          // `EmergencyFundContext` rule: naming one the household never agreed
          // to would put a figure on screen nobody stated.
          accountIds: [],
          accountAmounts: {},
          ...holdings.patch,
          spending: [],
          archivedOn: null,
        },
      ]);
      return { ok: true, id };
    },
    [setGoals]
  );

  /** Same fields as `addSavingsGoal`, checked the same way, against an id. */
  const updateSavingsGoal = useCallback(
    ({ id, ...fields }) => {
      const existing = goals.find((goal) => goal.id === id);
      // `useSyncedState` listens for the `storage` event and for a realtime
      // change from another device, so a goal deleted anywhere syncs into this
      // tab — and the edit modal can be open on a
      // record the store no longer has. Say so rather than letting a `map` that
      // matches nothing report the write as landed and the modal close on it.
      if (!existing) return { ok: false, error: "That savings goal no longer exists." };

      const parsed = parseGoalFields(fields);
      if (!parsed.ok) return parsed;
      const holdings = parseHoldings(fields);
      if (!holdings.ok) return holdings;

      setGoals((previous) =>
        previous.map((goal) =>
          goal.id === id
            ? {
                ...goal,
                name: parsed.name,
                targetCents: parsed.targetCents,
                targetDate: parsed.targetDate,
                budgetId: parsed.budgetId,
                photo: parsed.photo,
                link: parsed.link,
                // A patch that says nothing about the colour leaves it alone.
                envelopeColor: fields.envelopeColor === undefined ? goal.envelopeColor : parsed.envelopeColor,
                ...holdings.patch,
              }
            : goal
        )
      );
      return { ok: true };
    },
    [goals, setGoals]
  );

  /**
   * A goal holds no money of its own and nothing else references its id, so
   * deleting one is never refused — the only cleanup is its own assignments,
   * which have nowhere else to belong once the goal they were put toward is
   * gone.
   */
  const deleteSavingsGoal = useCallback(
    ({ id }) => {
      setGoals((previous) => previous.filter((goal) => goal.id !== id));
      removeGoalAssignments({ goalId: id });
    },
    [setGoals, removeGoalAssignments]
  );

  /**
   * Remember that money moved out of a goal was spent towards it. The move and
   * the purchase are other stores' writes (`useGoalSpending`); this is only
   * the statement, so it checks only its own fields.
   */
  const recordGoalSpending = useCallback(
    ({ goalId, date, amountCents, budgetId, note, transactionId }) => {
      if (!goals.some((goal) => goal.id === goalId)) {
        return { ok: false, error: "That savings goal no longer exists." };
      }
      if (!isAmount(amountCents)) return { ok: false, error: "Enter an amount greater than zero." };
      if (!isDate(date)) return { ok: false, error: "Enter a valid date." };

      const entry = {
        id: uuidV4(),
        date,
        amountCents,
        budgetId: typeof budgetId === "string" && budgetId ? budgetId : null,
        note: (note ?? "").trim(),
        transactionId: typeof transactionId === "string" && transactionId ? transactionId : null,
      };
      setGoals((previous) =>
        previous.map((goal) =>
          goal.id === goalId ? { ...goal, spending: [...(goal.spending ?? []), entry] } : goal
        )
      );
      return { ok: true, id: entry.id };
    },
    [goals, setGoals]
  );

  /** Forget one spending entry. Undoing the move it describes is the caller's. */
  const removeGoalSpending = useCallback(
    ({ goalId, spendingId }) => {
      const goal = goals.find((entry) => entry.id === goalId);
      if (!goal || !(goal.spending ?? []).some((entry) => entry.id === spendingId)) {
        return { ok: false, error: "That spending entry no longer exists." };
      }
      setGoals((previous) =>
        previous.map((entry) =>
          entry.id === goalId
            ? { ...entry, spending: entry.spending.filter((spent) => spent.id !== spendingId) }
            : entry
        )
      );
      return { ok: true };
    },
    [goals, setGoals]
  );

  /**
   * Close a goal out, or reopen it. Nothing is deleted either way: the goal's
   * spending and its assignments stay, so a reopened goal reads exactly as it
   * did. Releasing money still left in it is `useGoalSpending`'s, since that is
   * an assignment.
   */
  const setGoalArchived = useCallback(
    ({ id, archived, date = todayISO() }) => {
      if (!goals.some((goal) => goal.id === id)) {
        return { ok: false, error: "That savings goal no longer exists." };
      }
      if (archived && !isDate(date)) return { ok: false, error: "Enter a valid date." };
      setGoals((previous) =>
        previous.map((goal) => (goal.id === id ? { ...goal, archivedOn: archived ? date : null } : goal))
      );
      return { ok: true };
    },
    [goals, setGoals]
  );

  /**
   * A new order for some of the goals, from a drag: the ids named take turns
   * in the places they already held, and nothing else moves (`reorderSubset`).
   * Array order is display order, so this is the whole of it.
   */
  const reorderSavingsGoals = useCallback(
    (orderedIds) => {
      setGoals((previous) => reorderSubset(previous, orderedIds));
      return { ok: true };
    },
    [setGoals]
  );

  // Memoised so a change in any other store does not re-render every
  // consumer of this one.
  const value = useMemo(
    () => ({
      goals,
      addSavingsGoal,
      updateSavingsGoal,
      deleteSavingsGoal,
      reorderSavingsGoals,
      recordGoalSpending,
      removeGoalSpending,
      setGoalArchived,
    }),
    [
      goals,
      addSavingsGoal,
      updateSavingsGoal,
      deleteSavingsGoal,
      reorderSavingsGoals,
      recordGoalSpending,
      removeGoalSpending,
      setGoalArchived,
    ]
  );

  return <SavingsGoalsContext.Provider value={value}>{children}</SavingsGoalsContext.Provider>;
};
