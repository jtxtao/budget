import React, { useCallback, useContext, useMemo } from "react";
import { v4 as uuidV4 } from "uuid";
import useSyncedState from "../hooks/useSyncedState";
import { reorderSubset } from "../reorder";
import { readKey } from "../storage";
import { useAssignments } from "./AssignmentsContext";
import { useTransactions } from "./TransactionsContext";
import { UNCATEGORIZED_BUDGET_ID } from "./constants";
import { currentPeriod, toCents } from "../utils";

const BudgetsContext = React.createContext();

// Re-exported from its own module so AssignmentsContext can share it without
// importing this one back. See ./constants.js.
export { UNCATEGORIZED_BUDGET_ID };

export function useBudgets() {
  return useContext(BudgetsContext);
}

export const UNGROUPED_ID = null;

/**
 * What a category is *for*, as opposed to what it costs.
 *
 * Four buckets, because the useful question about a plan is not only whether it
 * balances but what it balances into: a plan that fits inside its income and
 * spends four fifths of it on fun balances just as neatly as one that saves a
 * fifth, and only the split tells them apart.
 *
 * **Retirement is split out of savings rather than folded into it**, because the
 * two answer different questions even though both are money set aside rather
 * than spent. A house deposit or an emergency fund is still liquid and still the
 * household's to redirect; a Roth contribution or an after-tax brokerage
 * transfer earmarked for retirement is not really being saved *for* anything
 * else, and lumping the two together would both overstate "savings" as a share
 * of the plan and, via `useRetirementProjection`, overstate what the household
 * is actually setting aside for retirement — a down-payment fund would inflate
 * `annualContributionCents`'s default just as much as a real contribution.
 * **Pre-tax payroll deductions (a 401(k)) never appear here at all** — they
 * never reach an on-budget account to be categorised, so this bucket only ever
 * holds the after-tax dollars the household earmarks itself. `RetirementContext`
 * is where the pre-tax half of the picture — and the whole starting balance —
 * lives instead; the two are independent inputs to the same projection.
 *
 * Every category carries one, always — there is no "ask my group" state. A group
 * still carries a bucket, but only as the **default a new category starts on**:
 * most households group by purpose, so filing a category usually answers this
 * question too, and the form arrives with the answer already filled in. What it
 * does not do is keep answering it. A stored category says what it is for on its
 * own record, so moving it under another heading, or renaming the heading, or
 * deleting it, cannot silently move money between the shares of the split.
 *
 * Deferring used to be a real state (`bucket: null`, offered as "Group default"
 * in the pickers). It cost every reader a resolution step and every writer a
 * decision about which of two things a null meant, to express something a
 * default value expresses on its own.
 */
export const PLAN_BUCKETS = {
  ESSENTIALS: "essentials",
  FUN: "fun",
  SAVINGS: "savings",
  RETIREMENT: "retirement",
};

// Display order, and the order the split is reported in — most necessary first,
// retirement last since it is the longest horizon of the four.
export const PLAN_BUCKET_ORDER = [
  PLAN_BUCKETS.ESSENTIALS,
  PLAN_BUCKETS.FUN,
  PLAN_BUCKETS.SAVINGS,
  PLAN_BUCKETS.RETIREMENT,
];

export const PLAN_BUCKET_LABELS = {
  [PLAN_BUCKETS.ESSENTIALS]: "Essentials",
  [PLAN_BUCKETS.FUN]: "Fun",
  [PLAN_BUCKETS.SAVINGS]: "Savings",
  [PLAN_BUCKETS.RETIREMENT]: "Retirement",
};

// What a group with nothing stated is worth, and so what an ungrouped category
// falls back to. Essentials rather than a fourth "unsorted" bucket: a category
// nobody has classified is being paid for regardless, and counting it as a want
// or as saving would flatter the split.
export const DEFAULT_BUCKET = PLAN_BUCKETS.ESSENTIALS;

const isBucket = (value) => PLAN_BUCKET_ORDER.includes(value);

/**
 * What a category is saving *towards*, as opposed to what it costs in a month.
 *
 * `plannedCents` is the standing monthly estimate — what this category is
 * expected to need in a typical month. A goal is a balance: $2,000 in the car
 * fund, $500 kept in the excess. The two answer different questions and a
 * category may carry either, both, or neither, which is why this one is
 * **nullable and the estimate is not**. Most categories are not saving towards
 * anything, and "no goal" is a different statement from "a goal of nothing" —
 * so a blank field clears the goal rather than storing zero, and zero itself is
 * refused. That is the exact opposite of the estimate beside it, where a blank
 * is a category nobody has made their mind up about and reads as zero, and it is
 * the reason the two are parsed by different functions rather than one.
 */
const isGoal = (value) => Number.isInteger(value) && value > 0;

/**
 * A goal off a form or off a caller, as either cents or typed dollars.
 *
 * Returns `{ stated, cents }`: `stated` is false when the caller said nothing at
 * all, which `updateBudget` needs in order to tell "leave the goal alone" from
 * "take the goal off". `cents` is null for a blank — the way a goal is removed —
 * and the whole result is null for junk, so a bad figure is refused rather than
 * quietly clearing what the user was editing.
 */
function readGoal({ goal, goalCents }) {
  if (goalCents !== undefined) {
    if (goalCents === null) return { stated: true, cents: null };
    return isGoal(goalCents) ? { stated: true, cents: goalCents } : null;
  }
  if (goal === undefined) return { stated: false, cents: null };
  if (goal === null || String(goal).trim() === "") return { stated: true, cents: null };

  const cents = toCents(goal);
  return isGoal(cents) ? { stated: true, cents } : null;
}

const GOAL_ERROR = "Enter a goal above zero, or leave it blank for no goal.";

/**
 * The estimate used to live in a separate store, one plan per (budget, period),
 * so that editing next month left last month's figure intact. It is now a single
 * standing figure on the budget itself: the Configuration page describes what a
 * category is expected to need *in general*, not what one particular month was
 * planned at, and a per-period record has nothing left to say. Fold the last
 * plan each budget had into that figure.
 *
 * Guarded end to end: this reads a key this store does not own, and a failure
 * here must not cost the user their estimates. Periods are compared as strings
 * only after both sides are known to be strings — see periodLTE in utils for why
 * a bare comparison against a possibly-missing period is a trap.
 */
function legacyPlannedCentsById() {
  const latest = new Map();

  try {
    // Through `readKey`, so the fold reads the signed-in household's legacy key
    // rather than whatever this browser holds unscoped. See src/storage.js.
    const plans = readKey("budgetPlans");
    if (!Array.isArray(plans)) return latest;

    for (const plan of plans) {
      if (!plan || !plan.budgetId) continue;
      const cents = plan.plannedCents ?? toCents(plan.planned);
      if (cents == null) continue;

      const period = typeof plan.period === "string" ? plan.period : "";
      const seen = latest.get(plan.budgetId);
      if (!seen || period >= seen.period) {
        latest.set(plan.budgetId, { period, plannedCents: cents });
      }
    }
  } catch {
    return new Map();
  }

  return new Map([...latest].map(([id, { plannedCents }]) => [id, plannedCents]));
}

/**
 * groupId -> the bucket that group defaults to, read straight from storage.
 *
 * The buckets migration below has to turn "defers to its group" into a real
 * bucket, and the group is in another key this store owns but has not folded
 * yet. Read here rather than deferred to the provider so a stored category is
 * repaired once, on the way in, instead of every reader carrying a fallback for
 * a state that no longer exists. The same defaulting rule as `migrateGroups`, so
 * the two cannot disagree about what a group with no bucket is worth.
 */
function storedGroupBuckets() {
  try {
    const groups = readKey("budgetGroups");
    if (!Array.isArray(groups)) return new Map();

    return new Map(
      groups
        .filter((group) => group && group.id != null)
        .map((group) => [group.id, isBucket(group.bucket) ? group.bucket : DEFAULT_BUCKET])
    );
  } catch {
    return new Map();
  }
}

// Keyed on field presence rather than a version counter, so it is
// self-describing and safe to run repeatedly: once `plannedCents` is on the
// record, neither legacy source is consulted again. The old `budgetPlans` key is
// left in storage rather than deleted — this store does not own it, and a
// migration that destroys another store's data has no way to undo itself.
//
// The bucket follows the same rule and is repaired on the same terms: a record
// that never had one, or that was deferring to its group back when deferring was
// a state, is stamped with what it was *already counting as* — its group's
// bucket, or the app default outside a group. That is the one answer that leaves
// every figure on screen unchanged by the migration.
function migrateBudgets(stored) {
  const budgets = Array.isArray(stored) ? stored : [];
  const needsLegacy = budgets.some((budget) => budget && !("plannedCents" in budget));
  const planned = needsLegacy ? legacyPlannedCentsById() : new Map();
  const needsBucket = budgets.some((budget) => budget && !isBucket(budget.bucket));
  const groupBuckets = needsBucket ? storedGroupBuckets() : new Map();

  return budgets
    .filter((budget) => budget && budget.name != null)
    .map(({ max, ...budget }) => ({
      id: budget.id ?? uuidV4(),
      name: budget.name,
      // `max` was floating-point dollars on the budget itself, two schemas ago.
      plannedCents: budget.plannedCents ?? planned.get(budget.id) ?? toCents(max) ?? 0,
      // Absent and "in no group" are the same thing; store one of them.
      groupId: budget.groupId ?? UNGROUPED_ID,
      bucket: isBucket(budget.bucket)
        ? budget.bucket
        : groupBuckets.get(budget.groupId ?? UNGROUPED_ID) ?? DEFAULT_BUCKET,
      // Nothing to fold in: a record saved before goals existed was not saving
      // towards anything, which is what null says. Anything unreadable — a
      // string, a negative, a zero from storage edited by hand — reads the same
      // way, since a goal nobody can act on is no goal.
      goalCents: isGoal(budget.goalCents) ? budget.goalCents : null,
    }));
}

function migrateGroups(stored) {
  const groups = Array.isArray(stored) ? stored : [];
  return groups
    .filter((group) => group && group.name != null)
    .map((group) => ({
      id: group.id ?? uuidV4(),
      name: group.name,
      // A group must land on a real bucket — it is what its categories fall back
      // to, and a fallback that defers to nothing is not one.
      bucket: isBucket(group.bucket) ? group.bucket : DEFAULT_BUCKET,
    }));
}

/**
 * Categories and the groups they are filed under.
 *
 * Spend used to live here too, as an `expenses` array. It moved to
 * TransactionsContext when income and expenses became one ledger: a category is
 * a standing fact about the household, an expense is an event, and holding both
 * meant this store answered "what are my categories" and "what did I spend"
 * with one value that changed every time either did. What is left is the
 * relationship — a category is *named* by an outflow, and `deleteBudget`
 * reassigns those the same way it always did.
 *
 * Groups live here rather than in a store of their own on purpose. A group is
 * little more than a heading over a set of categories: it holds no money and no
 * figure of its own — only a name and the bucket its categories fall back to —
 * and deleting one has to hand its categories back without touching them.
 * Splitting it out would buy a cascade between two providers to express a
 * relationship that is one nullable field.
 *
 * **Array order is display order** for both lists. There is no `position` field
 * to drift out of step with the array it describes, and reordering is one
 * mutator — `setCategoryLayout` — that rewrites both lists at once, because a
 * drag can change a category's group and its position in the same gesture.
 */
export const BudgetsProvider = ({ children }) => {
  const [groups, setGroups] = useSyncedState("budgetGroups", [], migrateGroups);
  const [budgets, setBudgets] = useSyncedState("budgets", [], migrateBudgets);
  const { reassignBudgetAssignments } = useAssignments();
  const { reassignBudgetTransactions } = useTransactions();

  const totalPlannedCents = useMemo(
    () => budgets.reduce((sum, budget) => sum + budget.plannedCents, 0),
    [budgets]
  );

  const getPlannedCents = useCallback(
    (budgetId) => budgets.find((budget) => budget.id === budgetId)?.plannedCents ?? 0,
    [budgets]
  );

  // Returns a result rather than silently discarding the input: the caller has
  // to decide what to tell the user, and closing the modal as though a duplicate
  // had been saved is the one option that cannot be right.
  const addBudget = useCallback(
    ({ name, planned, plannedCents, goal, goalCents, groupId = UNGROUPED_ID, bucket }) => {
      const trimmed = (name ?? "").trim();
      if (!trimmed) return { ok: false, error: "Give the category a name." };

      const clash = budgets.some(
        (budget) => budget.name.trim().toLowerCase() === trimmed.toLowerCase()
      );
      if (clash) {
        return { ok: false, error: `A category named “${trimmed}” already exists.` };
      }

      // No estimate at all is a real state — a category the user has not made up
      // their mind about — and reads as zero. Junk is not.
      const cents = plannedCents ?? (planned == null || planned === "" ? 0 : toCents(planned));
      if (cents == null || cents < 0) {
        return { ok: false, error: "Enter a monthly estimate of zero or more." };
      }

      // Optional, unlike the estimate: a category saving towards nothing is the
      // ordinary case, so saying nothing here is an answer rather than an
      // omission. Junk still is not.
      const goalRead = readGoal({ goal, goalCents });
      if (!goalRead) return { ok: false, error: GOAL_ERROR };

      if (bucket !== undefined && !isBucket(bucket)) {
        return { ok: false, error: "Choose what this category is for." };
      }

      // A group that has since been deleted must not strand the category in a
      // heading nothing renders.
      const group = groups.some((entry) => entry.id === groupId) ? groupId : UNGROUPED_ID;

      // Unstated means "whatever this group starts its categories on", resolved
      // once, here — the record that comes out states what it is for like every
      // other. A caller that says nothing about the bucket is not asking for a
      // category that keeps asking its group.
      const filed =
        bucket ?? groups.find((entry) => entry.id === group)?.bucket ?? DEFAULT_BUCKET;

      const id = uuidV4();
      setBudgets((prevBudgets) => [
        ...prevBudgets,
        {
          id,
          name: trimmed,
          plannedCents: cents,
          goalCents: goalRead.cents,
          groupId: group,
          bucket: filed,
        },
      ]);
      return { ok: true, id };
    },
    [budgets, groups, setBudgets]
  );

  /**
   * Rename a category, restate its estimate, re-bucket it, restate or remove its
   * goal, or any combination. Fields left undefined are left alone, so a caller
   * editing one of them cannot blank the others by omission. A stated bucket must
   * be a real one: there is nothing left for null to mean now that every category
   * carries its own.
   *
   * The goal is the one field a caller may deliberately empty — `goalCents: null`
   * or `goal: ""` takes it off — which is why it is read through `readGoal`
   * rather than compared against undefined here. "Say nothing" and "say none"
   * are different instructions and only the field with a null state has both.
   */
  const updateBudget = useCallback(
    ({ id, name, planned, plannedCents, goal, goalCents, bucket }) => {
      const existing = budgets.find((budget) => budget.id === id);
      if (!existing) return { ok: false, error: "That category no longer exists." };

      const patch = {};

      if (name !== undefined) {
        const trimmed = name.trim();
        if (!trimmed) return { ok: false, error: "Give the category a name." };

        const clash = budgets.some(
          (budget) =>
            budget.id !== id && budget.name.trim().toLowerCase() === trimmed.toLowerCase()
        );
        if (clash) {
          return { ok: false, error: `A category named “${trimmed}” already exists.` };
        }
        patch.name = trimmed;
      }

      if (planned !== undefined || plannedCents !== undefined) {
        const cents = plannedCents ?? (planned === "" ? 0 : toCents(planned));
        if (cents == null || cents < 0) {
          return { ok: false, error: "Enter a monthly estimate of zero or more." };
        }
        patch.plannedCents = cents;
      }

      const goalRead = readGoal({ goal, goalCents });
      if (!goalRead) return { ok: false, error: GOAL_ERROR };
      if (goalRead.stated) patch.goalCents = goalRead.cents;

      if (bucket !== undefined) {
        if (!isBucket(bucket)) {
          return { ok: false, error: "Choose what this category is for." };
        }
        patch.bucket = bucket;
      }

      setBudgets((prevBudgets) =>
        prevBudgets.map((budget) => (budget.id === id ? { ...budget, ...patch } : budget))
      );
      return { ok: true };
    },
    [budgets, setBudgets]
  );

  // Spend outlives its category — it is what actually happened — so it is
  // reassigned rather than deleted. Its *funding* follows it onto Uncategorized,
  // because that money was already set aside and dropping it would ask the user
  // to fund the same spend twice. The estimate goes with the record, since there
  // is nothing left for it to describe.
  //
  // One consequence worth knowing: because every envelope figure is derived
  // from current state, deleting a category also changes what past periods
  // read. There is no history to preserve it in.
  const deleteBudget = useCallback(
    ({ id }) => {
      setBudgets((prevBudgets) => prevBudgets.filter((budget) => budget.id !== id));
      reassignBudgetTransactions({ fromBudgetId: id, toBudgetId: UNCATEGORIZED_BUDGET_ID });
      reassignBudgetAssignments({
        fromBudgetId: id,
        toBudgetId: UNCATEGORIZED_BUDGET_ID,
        period: currentPeriod(),
      });
    },
    [setBudgets, reassignBudgetTransactions, reassignBudgetAssignments]
  );

  const addGroup = useCallback(
    ({ name, bucket = DEFAULT_BUCKET }) => {
      const trimmed = (name ?? "").trim();
      if (!trimmed) return { ok: false, error: "Give the group a name." };

      const clash = groups.some(
        (group) => group.name.trim().toLowerCase() === trimmed.toLowerCase()
      );
      if (clash) return { ok: false, error: `A group named “${trimmed}” already exists.` };

      if (!isBucket(bucket)) {
        return { ok: false, error: "Choose what this group is for." };
      }

      const id = uuidV4();
      setGroups((prevGroups) => [...prevGroups, { id, name: trimmed, bucket }]);
      return { ok: true, id };
    },
    [groups, setGroups]
  );

  /**
   * Rename a group, restate the bucket its categories start on, or both.
   * Undefined fields are left alone, as on `updateBudget`.
   *
   * Restating the bucket changes what the *next* category filed here starts on,
   * and nothing else: the categories already under the heading each carry their
   * own, and rewriting those from here would move money between the shares of
   * the split as a side effect of editing a name.
   */
  const updateGroup = useCallback(
    ({ id, name, bucket }) => {
      const existing = groups.find((group) => group.id === id);
      if (!existing) return { ok: false, error: "That group no longer exists." };

      const patch = {};

      if (name !== undefined) {
        const trimmed = name.trim();
        if (!trimmed) return { ok: false, error: "Give the group a name." };

        const clash = groups.some(
          (group) => group.id !== id && group.name.trim().toLowerCase() === trimmed.toLowerCase()
        );
        if (clash) return { ok: false, error: `A group named “${trimmed}” already exists.` };
        patch.name = trimmed;
      }

      if (bucket !== undefined) {
        if (!isBucket(bucket)) return { ok: false, error: "Choose what this group is for." };
        patch.bucket = bucket;
      }

      setGroups((prevGroups) =>
        prevGroups.map((group) => (group.id === id ? { ...group, ...patch } : group))
      );
      return { ok: true };
    },
    [groups, setGroups]
  );

  /**
   * Removing a heading, not the categories under it. A group holds no money and
   * no estimate of its own, so there is nothing to cascade — its members come
   * back out ungrouped, with their figures, their buckets and their history
   * untouched.
   *
   * The bucket used to need stamping here: a category deferring to a heading
   * about to stop existing would have fallen back to the app default and moved
   * money between the shares of the split without the user editing anything.
   * Every category states its own now, so there is nothing left to rescue.
   */
  const deleteGroup = useCallback(
    ({ id }) => {
      setBudgets((prevBudgets) =>
        prevBudgets.map((budget) =>
          budget.groupId === id ? { ...budget, groupId: UNGROUPED_ID } : budget
        )
      );
      setGroups((prevGroups) => prevGroups.filter((group) => group.id !== id));
    },
    [setBudgets, setGroups]
  );

  /**
   * The whole arrangement, in one commit: which group each category sits in and
   * what order everything appears in.
   *
   * `sections` is `[{ groupId, budgetIds }]` in display order, with `groupId`
   * null for the ungrouped section. One mutator rather than a reorder and a
   * regroup, because a single drag can do both and applying them in two writes
   * would put a frame of nonsense on screen between them.
   *
   * Anything the caller failed to mention survives: unknown ids are dropped,
   * groups and categories not listed keep their place at the end. A layout is a
   * rearrangement, and no rearrangement may delete a category.
   */
  const setCategoryLayout = useCallback(
    (sections) => {
      if (!Array.isArray(sections)) return { ok: false, error: "Invalid layout." };

      setGroups((prevGroups) => {
        const byId = new Map(prevGroups.map((group) => [group.id, group]));
        const ordered = [];
        for (const section of sections) {
          const group = byId.get(section?.groupId);
          if (group && !ordered.includes(group)) ordered.push(group);
        }
        for (const group of prevGroups) {
          if (!ordered.includes(group)) ordered.push(group);
        }
        return ordered;
      });

      setBudgets((prevBudgets) => {
        const byId = new Map(prevBudgets.map((budget) => [budget.id, budget]));
        const placed = new Set();
        const ordered = [];

        for (const section of sections) {
          const groupId = section?.groupId ?? UNGROUPED_ID;
          for (const budgetId of section?.budgetIds ?? []) {
            const budget = byId.get(budgetId);
            if (!budget || placed.has(budgetId)) continue;
            placed.add(budgetId);
            ordered.push(budget.groupId === groupId ? budget : { ...budget, groupId });
          }
        }
        for (const budget of prevBudgets) {
          if (!placed.has(budget.id)) ordered.push(budget);
        }
        return ordered;
      });

      return { ok: true };
    },
    [setBudgets, setGroups]
  );

  /**
   * A new order for some categories, or for some groups, from a drag on the
   * dashboard: the ids named take turns in the places they already held, and
   * nothing else moves (`reorderSubset`). Neither regroups anything — moving a
   * category between groups is `setCategoryLayout`'s, on the plan.
   */
  const reorderBudgets = useCallback(
    (orderedIds) => {
      setBudgets((previous) => reorderSubset(previous, orderedIds));
      return { ok: true };
    },
    [setBudgets]
  );

  const reorderGroups = useCallback(
    (orderedIds) => {
      setGroups((previous) => reorderSubset(previous, orderedIds));
      return { ok: true };
    },
    [setGroups]
  );

  // Memoised so a change in any other store does not re-render every consumer
  // of this one.
  const value = useMemo(
    () => ({
      groups,
      budgets,
      totalPlannedCents,
      getPlannedCents,
      addBudget,
      updateBudget,
      deleteBudget,
      addGroup,
      updateGroup,
      deleteGroup,
      setCategoryLayout,
      reorderBudgets,
      reorderGroups,
    }),
    [
      groups,
      budgets,
      totalPlannedCents,
      getPlannedCents,
      addBudget,
      updateBudget,
      deleteBudget,
      addGroup,
      updateGroup,
      deleteGroup,
      setCategoryLayout,
      reorderBudgets,
      reorderGroups,
    ]
  );

  return <BudgetsContext.Provider value={value}>{children}</BudgetsContext.Provider>;
};
