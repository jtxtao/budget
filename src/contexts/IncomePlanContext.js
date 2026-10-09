import React, { useCallback, useContext, useMemo } from "react";
import { v4 as uuidV4 } from "uuid";
import useSyncedState from "../hooks/useSyncedState";
import { reorderSubset } from "../reorder";
import { CADENCES, monthlyCents } from "../cadence";
import { toCents } from "../utils";

/**
 * The income side of the configuration: the paycheques and other money the user
 * expects, and how often each one arrives.
 *
 * This is what a category's monthly estimate is to expenses — the standing
 * expectation, not the record. Nothing here is money that has landed, and
 * nothing here is spendable: the envelope figures on the Transactions page are
 * built entirely from income that actually arrived. Expected income exists so
 * the configuration can answer one question — does what I intend to spend fit
 * inside what I intend to earn?
 *
 * A source is stored once, as an amount and a cadence, and its contribution to
 * the plan is the monthly average of the two (see src/cadence.js). There is no
 * payday on the calendar here by design: this describes income in general, and a
 * date would only be needed to answer a question about a particular month, which
 * this store does not ask.
 */
const IncomePlanContext = React.createContext();

export function useIncomePlan() {
  return useContext(IncomePlanContext);
}

// Sources used to carry an `anchorDate` — one real payday — and an optional
// `endDate`, so a month's expected income could be counted exactly rather than
// averaged. Configuration has no month to count into, so both fields are
// dropped. Keyed on field presence, and safe to run repeatedly.
function migrateIncomeSources(stored) {
  const sources = Array.isArray(stored) ? stored : [];
  return sources
    .filter((source) => source && source.name != null)
    .map((source) => ({
      id: source.id ?? uuidV4(),
      name: source.name,
      amountCents: source.amountCents ?? toCents(source.amount) ?? 0,
      cadence: source.cadence,
    }));
}

export const IncomePlanProvider = ({ children }) => {
  const [sources, setSources] = useSyncedState("incomeSources", [], migrateIncomeSources);

  /** Each source with what it contributes to a typical month. */
  const incomeRows = useMemo(
    () =>
      sources.map((source) => ({
        ...source,
        monthlyCents: monthlyCents(source.amountCents, source.cadence),
      })),
    [sources]
  );

  const expectedMonthlyCents = useMemo(
    () => incomeRows.reduce((sum, row) => sum + row.monthlyCents, 0),
    [incomeRows]
  );

  // Validated here rather than in the form: this is the boundary every caller
  // crosses, and a source with no cadence would silently expect nothing, every
  // month, forever.
  const addIncomeSource = useCallback(
    ({ name, amount, amountCents, cadence }) => {
      const trimmed = (name ?? "").trim();
      if (!trimmed) return { ok: false, error: "Give the income source a name." };

      const cents = amountCents ?? toCents(amount);
      if (cents == null || cents < 0) {
        return { ok: false, error: "Enter an amount of zero or more." };
      }
      if (!CADENCES[cadence]) return { ok: false, error: "Choose how often it is paid." };

      const id = uuidV4();
      setSources((prevSources) => [
        ...prevSources,
        { id, name: trimmed, amountCents: cents, cadence },
      ]);
      return { ok: true, id };
    },
    [setSources]
  );

  const updateIncomeSource = useCallback(
    ({ id, name, amount, amountCents, cadence }) => {
      const existing = sources.find((source) => source.id === id);
      if (!existing) return { ok: false, error: "That income source no longer exists." };

      const patch = {};

      if (name !== undefined) {
        const trimmed = name.trim();
        if (!trimmed) return { ok: false, error: "Give the income source a name." };
        patch.name = trimmed;
      }

      if (amount !== undefined || amountCents !== undefined) {
        const cents = amountCents ?? (amount === "" ? 0 : toCents(amount));
        if (cents == null || cents < 0) {
          return { ok: false, error: "Enter an amount of zero or more." };
        }
        patch.amountCents = cents;
      }

      if (cadence !== undefined) {
        if (!CADENCES[cadence]) return { ok: false, error: "Choose how often it is paid." };
        patch.cadence = cadence;
      }

      setSources((prevSources) =>
        prevSources.map((source) => (source.id === id ? { ...source, ...patch } : source))
      );
      return { ok: true };
    },
    [sources, setSources]
  );

  /**
   * A new order for some of the income sources, from a drag: the ids named take turns
   * in the places they already held, and nothing else moves (`reorderSubset`).
   * Array order is display order, so this is the whole of it.
   */
  const reorderIncomeSources = useCallback(
    (orderedIds) => {
      setSources((previous) => reorderSubset(previous, orderedIds));
      return { ok: true };
    },
    [setSources]
  );

  /**
   * No cascade, in either direction. Nothing links a source to the income
   * records it predicted — a paycheque that arrives is logged on its own, and
   * matching the two would mean inventing a correspondence the user never
   * stated. Deleting a source only changes what the plan expects.
   */
  const deleteIncomeSource = useCallback(
    ({ id }) => setSources((prevSources) => prevSources.filter((source) => source.id !== id)),
    [setSources]
  );

  // Memoised so a change in any other store does not re-render every consumer
  // of this one.
  const value = useMemo(
    () => ({
      sources,
      incomeRows,
      expectedMonthlyCents,
      addIncomeSource,
      updateIncomeSource,
      deleteIncomeSource,
      reorderIncomeSources,
    }),
    [
      sources,
      incomeRows,
      expectedMonthlyCents,
      addIncomeSource,
      updateIncomeSource,
      deleteIncomeSource,
      reorderIncomeSources,
    ]
  );

  return <IncomePlanContext.Provider value={value}>{children}</IncomePlanContext.Provider>;
};
