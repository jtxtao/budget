import { useMemo } from "react";
import { useRetirement } from "../contexts/RetirementContext";
import { retirementAccountIncluded } from "./useRetirementProjection";
import useEmergencyFund from "./useEmergencyFund";
import useEnvelopes from "./useEnvelopes";
import useNetWorth from "./useNetWorth";
import useSavingsGoalEnvelopes from "./useSavingsGoalEnvelopes";
import { fromBps } from "../utils";

/**
 * Where the household's net worth is explicitly earmarked — the three places
 * the app lets money be named for a purpose: retirement accounts, the
 * emergency buffer, and savings goals.
 *
 * None of these are required to partition the total. The same dollar could in
 * principle be in a retirement account that is also named in a goal (the app
 * allows it, though few households set it up that way), so each figure is
 * reported as the household stated it rather than as a strict allocation. The
 * point is "here is what this money is for", not an accounting identity.
 *
 * `useNetWorth` is called at one month's depth here — the allocation view
 * answers "what is it worth right now", not how it moved over time, so the
 * history the page draws its chart from is a different and larger call with
 * its own memo key. `useEmergencyFund` has its own `useNetWorth` call too
 * (always at `currentPeriod()`); the two agree when `period` is the current
 * month, which is the ordinary case.
 */
export default function useNetWorthAllocation(period) {
  const { current, rows } = useNetWorth(period, { months: 1 });
  const { plan } = useRetirement();
  const goalRows = useSavingsGoalEnvelopes(period);
  const emergency = useEmergencyFund();
  const { assignedAheadCents, monthsFundedAhead } = useEnvelopes(period);

  return useMemo(() => {
    const retirementRows = rows.filter((row) => retirementAccountIncluded(plan, row));
    const retirementCents = retirementRows.reduce((sum, row) => sum + row.valueCents, 0);

    const activeGoals = goalRows.filter((row) => !row.archivedOn);
    const totalGoalSavedCents = activeGoals.reduce((sum, row) => sum + row.savedCents, 0);

    const monthsHeld =
      emergency.monthsHeldBps == null ? null : fromBps(emergency.monthsHeldBps);

    return {
      netCents: current.netCents,
      retirementCents,
      retirementAccountCount: retirementRows.length,
      goals: activeGoals,
      totalGoalSavedCents,
      emergencyHeldCents: emergency.heldCents,
      emergencyTargetCents: emergency.targetCents,
      emergencyFundedBps: emergency.fundedBps,
      emergencyMonthsHeld: monthsHeld,
      // Money already committed to future months — it is in on-budget accounts
      // right now but its job is already declared, so it is not free to spend.
      // `useEnvelopes` sums both future category and future goal assignments.
      assignedAheadCents,
      monthsFundedAhead,
    };
  }, [current.netCents, rows, plan, goalRows, emergency, assignedAheadCents, monthsFundedAhead]);
}
