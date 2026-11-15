import { Link } from "react-router-dom";
import { formatCents } from "../utils";

/**
 * Where the household's net worth is explicitly earmarked for a purpose.
 *
 * Three purposes, in the order the app lets money be named for one:
 * retirement accounts picked on the Retirement page, the emergency buffer
 * configured on the Budget plan, and savings goals. None of these are
 * required to partition the total — the same dollar could appear in more than
 * one (a retirement account also named in a goal), so each figure is what the
 * household said, not a strict slice.
 *
 * Goals each get a row: saved / target and a meter, the same pairing
 * SavingsGoalList carries on the goals page. No envelope animation here — this
 * is a summary read alongside the balance sheet, not an interactive goal card.
 */

function PurposeRow({ label, children, to, linkLabel }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-1 border-t border-edge px-4 py-4">
      <div className="min-w-0 flex-1">{children}</div>
      {to && (
        <Link
          to={to}
          className="shrink-0 text-label uppercase text-azure underline-offset-2 hover:underline"
        >
          {linkLabel}
        </Link>
      )}
    </div>
  );
}

function GoalProgressBar({ ratio, label }) {
  const percent = Math.max(0, Math.min(100, ratio * 100));
  return (
    <div
      className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-edge"
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span className="block h-full rounded-full bg-verdant" style={{ width: percent + "%" }} />
    </div>
  );
}

export default function NetWorthAllocationPanel({
  netCents = 0,
  retirementCents,
  retirementAccountCount,
  goals,
  totalGoalSavedCents,
  emergencyHeldCents,
  emergencyTargetCents,
  emergencyMonthsHeld,
  assignedAheadCents = 0,
  monthsFundedAhead = 0,
}) {
  const hasRetirement = retirementAccountCount > 0;
  const hasEmergency = emergencyTargetCents > 0 || emergencyHeldCents > 0;
  const visibleGoals = goals.filter((g) => g.savedCents > 0);
  const hasGoals = visibleGoals.length > 0;
  const hasAhead = assignedAheadCents > 0;
  const hasAnything = hasRetirement || hasEmergency || hasGoals || hasAhead;

  const totalEarmarkedCents =
    (hasRetirement ? retirementCents : 0) +
    (hasEmergency ? emergencyHeldCents : 0) +
    (hasAhead ? assignedAheadCents : 0) +
    totalGoalSavedCents;
  const unaccountedCents = netCents - totalEarmarkedCents;

  return (
    <section className="overflow-hidden rounded-2xl border border-edge bg-panel">
      <div className="border-b border-edge px-4 py-3">
        <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">
          What it's for
        </h2>
      </div>

      {!hasAnything && (
        <p className="px-4 py-5 font-sans text-row text-chalk-soft">
          Name what your money is working toward: pick retirement accounts on the{" "}
          <Link to="/retirement" className="text-azure underline-offset-2 hover:underline">
            Retirement page
          </Link>
          , set up an emergency buffer on the{" "}
          <Link to="/plan" className="text-azure underline-offset-2 hover:underline">
            Budget plan
          </Link>
          , or add{" "}
          <Link to="/savings-goals" className="text-azure underline-offset-2 hover:underline">
            savings goals
          </Link>
          .
        </p>
      )}

      {hasRetirement && (
        <PurposeRow to="/retirement" linkLabel="Retirement plan">
          <div className="text-label uppercase text-chalk-soft">Retirement savings</div>
          <div className="mt-0.5 font-mono text-figure font-medium text-chalk">
            {formatCents(retirementCents)}
          </div>
          <div className="mt-0.5 text-label uppercase text-chalk-soft">
            {retirementAccountCount === 1 ? "1 account" : `${retirementAccountCount} accounts`}
          </div>
        </PurposeRow>
      )}

      {hasEmergency && (
        <PurposeRow to="/plan" linkLabel="Budget plan">
          <div className="text-label uppercase text-chalk-soft">Emergency fund</div>
          <div className="mt-0.5 font-mono text-figure font-medium text-chalk">
            {formatCents(emergencyHeldCents)}
          </div>
          <div className="mt-0.5 text-label uppercase text-chalk-soft">
            {emergencyMonthsHeld != null
              ? `${emergencyMonthsHeld.toFixed(1)} months of essentials covered`
              : emergencyTargetCents > 0
              ? `of ${formatCents(emergencyTargetCents)} target`
              : null}
          </div>
        </PurposeRow>
      )}

      {hasAhead && (
        <PurposeRow to="/transactions" linkLabel="Transactions">
          <div className="text-label uppercase text-chalk-soft">Assigned ahead</div>
          <div className="mt-0.5 font-mono text-figure font-medium text-chalk">
            {formatCents(assignedAheadCents)}
          </div>
          <div className="mt-0.5 text-label uppercase text-chalk-soft">
            {monthsFundedAhead > 0
              ? `${monthsFundedAhead} ${monthsFundedAhead === 1 ? "month" : "months"} funded ahead`
              : "funding future months"}
          </div>
        </PurposeRow>
      )}

      {hasGoals && (
        <div className="border-t border-edge px-4 py-4">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <div className="text-label uppercase text-chalk-soft">Savings goals</div>
            <div className="font-mono text-row font-medium text-chalk">
              {formatCents(totalGoalSavedCents)} saved across{" "}
              {visibleGoals.length === 1 ? "1 goal" : `${visibleGoals.length} goals`}
            </div>
          </div>

          <table className="w-full border-collapse">
            <thead className="sr-only">
              <tr>
                <th scope="col">Goal</th>
                <th scope="col">Saved</th>
                <th scope="col">Target</th>
                <th scope="col">Progress</th>
              </tr>
            </thead>
            <tbody>
              {visibleGoals.map((row, i) => {
                const ratio =
                  row.targetCents > 0
                    ? (row.savedCents + row.spentCents) / row.targetCents
                    : 0;
                const percent = Math.round(Math.min(100, ratio * 100));
                return (
                  <tr
                    key={row.goalId}
                    className={i % 2 === 0 ? "bg-sheet" : "bg-sheet-alt"}
                  >
                    <td className="py-2 pl-0 pr-3 font-sans text-row text-ink">
                      {row.name}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right font-mono text-row text-ink">
                      {formatCents(row.savedCents)}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right font-mono text-row text-ink-soft">
                      of {formatCents(row.targetCents)}
                    </td>
                    <td className="w-24 py-2 pl-2">
                      <GoalProgressBar
                        ratio={ratio}
                        label={`${row.name}: ${percent}% saved`}
                      />
                      <div className="mt-0.5 text-right text-label text-ink-soft tabular-nums">
                        {percent}%
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="mt-3 text-right">
            <Link
              to="/savings-goals"
              className="text-label uppercase text-azure underline-offset-2 hover:underline"
            >
              Savings goals
            </Link>
          </div>
        </div>
      )}

      {hasAnything && netCents !== 0 && (
        <div className="border-t border-edge px-4 py-4">
          <div className="flex items-baseline justify-between gap-x-6">
            <span className="font-sans text-row text-chalk-soft">Total earmarked</span>
            <span className="font-mono text-row font-medium text-chalk">
              {formatCents(totalEarmarkedCents)}
            </span>
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-x-6">
            <span className="font-sans text-row text-chalk-soft">
              {unaccountedCents >= 0 ? "Not yet earmarked" : "Items above may overlap"}
            </span>
            <span
              className={`font-mono text-row font-medium ${
                unaccountedCents < 0 ? "text-chalk-soft" : "text-chalk"
              }`}
            >
              {formatCents(Math.abs(unaccountedCents))}{" "}
              <span className="font-sans text-label font-normal text-chalk-soft">
                of {formatCents(netCents)}
              </span>
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
