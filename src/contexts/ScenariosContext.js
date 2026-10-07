import React, { useCallback, useContext, useMemo } from "react";
import { v4 as uuidV4 } from "uuid";
import useSyncedState from "../hooks/useSyncedState";

/**
 * Saved retirement scenarios: a named copy of the plan, and which life events
 * were switched on when it was saved.
 *
 * **A scenario is a snapshot, not a link.** The plan is copied whole — ages,
 * rates, salaries, the debts' assumptions, everything `RetirementContext`
 * holds — so editing the live plan afterwards cannot quietly change what "Buy
 * at 35" said. Events are named by id rather than copied, because an event is
 * already a stored record and a scenario is a choice about which of them are
 * on: two houses written as two events, one scenario with each. An id whose
 * event was deleted is **inert but kept**, and an event added since is off in
 * every scenario saved before it — it was not part of the plan that was saved.
 *
 * **At most four, and each keeps the colour slot it was saved into.** The
 * comparison chart draws one line per scenario beside the current plan, and the
 * app has four hues measured against each other for a chart (the plan's bucket
 * colours); a fifth would be a colour nobody checked. A slot is the lowest one
 * free when the scenario is saved and it never moves, so deleting one scenario
 * cannot repaint the others — colour follows the scenario, never its position.
 *
 * **A store of guesses holding no money**, like the plan itself: nothing reads
 * it but the Retirement page, and using a scenario writes the plan and the
 * events' switches, never the books. Names are unique by their trimmed,
 * case-folded form, since two scenarios called "Buy" are a comparison nobody
 * can read.
 */
const ScenariosContext = React.createContext();

export const MAX_SCENARIOS = 4;

export function useScenarios() {
  return useContext(ScenariosContext);
}

const normalise = (name) => name.trim().replace(/\s+/g, " ").toLowerCase();

function migrateScenarios(stored) {
  if (!Array.isArray(stored)) return [];
  const taken = new Set();
  const kept = [];
  for (const scenario of stored) {
    if (
      !scenario ||
      typeof scenario.id !== "string" ||
      typeof scenario.name !== "string" ||
      !scenario.name.trim() ||
      !scenario.plan ||
      typeof scenario.plan !== "object"
    ) {
      continue;
    }
    const slot =
      Number.isInteger(scenario.slot) && scenario.slot >= 0 && scenario.slot < MAX_SCENARIOS
        ? scenario.slot
        : null;
    kept.push({
      id: scenario.id,
      name: scenario.name,
      plan: scenario.plan,
      enabledEventIds: Array.isArray(scenario.enabledEventIds)
        ? scenario.enabledEventIds.filter((id) => typeof id === "string")
        : [],
      slot,
    });
  }
  // A slot missing or repeated is given the lowest free one, in stored order,
  // so every scenario has a colour and no two share one.
  for (const scenario of kept) {
    if (scenario.slot != null && !taken.has(scenario.slot)) {
      taken.add(scenario.slot);
    } else {
      scenario.slot = null;
    }
  }
  for (const scenario of kept) {
    if (scenario.slot != null) continue;
    const free = [...Array(MAX_SCENARIOS).keys()].find((slot) => !taken.has(slot));
    scenario.slot = free ?? 0;
    taken.add(scenario.slot);
  }
  return kept.slice(0, MAX_SCENARIOS);
}

export const ScenariosProvider = ({ children }) => {
  const [scenarios, setScenarios] = useSyncedState("retirementScenarios", [], migrateScenarios);

  const clash = useCallback(
    (name, exceptId) =>
      scenarios.some((scenario) => scenario.id !== exceptId && normalise(scenario.name) === normalise(name)),
    [scenarios]
  );

  /** Save the plan and the events now on as a new scenario. */
  const saveScenario = useCallback(
    ({ name, plan, enabledEventIds }) => {
      const trimmed = typeof name === "string" ? name.trim() : "";
      if (!trimmed) return { ok: false, error: "Give the scenario a name." };
      if (clash(trimmed)) return { ok: false, error: `There is already a scenario called "${trimmed}".` };
      if (scenarios.length >= MAX_SCENARIOS) {
        return {
          ok: false,
          error: `Four scenarios is the most that can be compared at once — remove one, or update one with the current plan.`,
        };
      }
      const used = new Set(scenarios.map((scenario) => scenario.slot));
      const slot = [...Array(MAX_SCENARIOS).keys()].find((candidate) => !used.has(candidate));
      const id = uuidV4();
      setScenarios((previous) => [
        ...previous,
        { id, name: trimmed, plan, enabledEventIds: [...enabledEventIds], slot },
      ]);
      return { ok: true, id };
    },
    [scenarios, clash, setScenarios]
  );

  /** Overwrite a scenario's plan and events with the current ones. */
  const updateScenario = useCallback(
    ({ id, plan, enabledEventIds }) => {
      if (!scenarios.some((scenario) => scenario.id === id)) {
        return { ok: false, error: "That scenario is no longer saved." };
      }
      setScenarios((previous) =>
        previous.map((scenario) =>
          scenario.id === id ? { ...scenario, plan, enabledEventIds: [...enabledEventIds] } : scenario
        )
      );
      return { ok: true };
    },
    [scenarios, setScenarios]
  );

  const renameScenario = useCallback(
    ({ id, name }) => {
      const trimmed = typeof name === "string" ? name.trim() : "";
      if (!trimmed) return { ok: false, error: "Give the scenario a name." };
      if (!scenarios.some((scenario) => scenario.id === id)) {
        return { ok: false, error: "That scenario is no longer saved." };
      }
      if (clash(trimmed, id)) return { ok: false, error: `There is already a scenario called "${trimmed}".` };
      setScenarios((previous) =>
        previous.map((scenario) => (scenario.id === id ? { ...scenario, name: trimmed } : scenario))
      );
      return { ok: true };
    },
    [scenarios, clash, setScenarios]
  );

  const deleteScenario = useCallback(
    (id) => {
      setScenarios((previous) => previous.filter((scenario) => scenario.id !== id));
      return { ok: true };
    },
    [setScenarios]
  );

  const value = useMemo(
    () => ({ scenarios, saveScenario, updateScenario, renameScenario, deleteScenario }),
    [scenarios, saveScenario, updateScenario, renameScenario, deleteScenario]
  );

  return <ScenariosContext.Provider value={value}>{children}</ScenariosContext.Provider>;
};
