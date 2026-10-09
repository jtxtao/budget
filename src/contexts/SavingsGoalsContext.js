import React, { useCallback, useContext, useMemo } from "react";
import { v4 as uuidV4 } from "uuid";
import useSyncedState from "../hooks/useSyncedState";
import { reorderSubset } from "../reorder";
import { useSavingsGoalAssignments } from "./SavingsGoalAssignmentsContext";
import { toCents } from "../utils";

/**
 * Medium-term savings: a camera, a wedding, a special event — a goal that is
 * expected to *exceed* the normal monthly budget, so it has to be planned
 * around rather than absorbed into an envelope's estimate.
 *
 * Independent of every store but one, in both directions: nothing here moves
 * money, and nothing but SavingsGoalAssignments references a goal's id — and
 * only to drop its assignments when the goal is deleted, never to read them
 * back. A goal is a standing intention — { id, name, targetCents, targetDate }
 * — with no link yet to a category or an account.
 */
const SavingsGoalsContext = React.createContext();

export function useSavingsGoals() {
  return useContext(SavingsGoalsContext);
}

const isAmount = (value) => Number.isInteger(value) && value > 0;
const isDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

/** The fields `addSavingsGoal` and `updateSavingsGoal` both have to check. */
function parseGoalFields({ name, target, targetCents, targetDate }) {
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

  return { ok: true, name: trimmed, targetCents: cents, targetDate: date };
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

      const id = uuidV4();
      setGoals((previous) => [
        ...previous,
        { id, name: parsed.name, targetCents: parsed.targetCents, targetDate: parsed.targetDate },
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

      setGoals((previous) =>
        previous.map((goal) =>
          goal.id === id
            ? { ...goal, name: parsed.name, targetCents: parsed.targetCents, targetDate: parsed.targetDate }
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
    () => ({ goals, addSavingsGoal, updateSavingsGoal, deleteSavingsGoal, reorderSavingsGoals }),
    [goals, addSavingsGoal, updateSavingsGoal, deleteSavingsGoal, reorderSavingsGoals]
  );

  return <SavingsGoalsContext.Provider value={value}>{children}</SavingsGoalsContext.Provider>;
};
