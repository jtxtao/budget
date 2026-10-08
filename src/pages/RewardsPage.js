import { useMemo, useState } from "react";
import AddRewardBalanceModal from "../components/AddRewardBalanceModal";
import AddTripModal from "../components/AddTripModal";
import Button from "../components/Button";
import PageHeader from "../components/PageHeader";
import { useRewards } from "../contexts/RewardsContext";
import {
  CATALOG,
  PROGRAM_KIND_LABELS,
  PROGRAM_KIND_ORDER,
  formatPointValue,
  programById,
  summariseRewards,
  toPoints,
  valueOfPointsCents,
} from "../rewards";
import { formatCents, formatDateMedium } from "../utils";

/**
 * Credit card rewards and the trips they are for.
 *
 * **Valuation leads the page's arithmetic.** A balance of points is a number
 * with no unit until somebody says what a point is worth, and that figure
 * decides everything below it — the total, which program to spend first, and
 * whether a given award is a good use of the points. So every program in the
 * built-in catalog carries a starting value, the household's own figure
 * replaces it wherever they type one, and both are shown side by side.
 *
 * **Nothing here touches the books.** Points are not money until they are
 * redeemed, and a valuation is a judgement — so this page has no month on it,
 * no envelope reads it, and net worth does not count it. The `RetirementContext`
 * split: a store of guesses, read by one page.
 *
 * Editing follows the panels elsewhere: the points on a balance and the value
 * of a program commit on **blur**, are keyed on the stored figure so a refused
 * edit re-seeds, and say why under the table rather than beside the cell.
 */

const headCell = "px-3 py-2 font-mono text-label uppercase text-chalk";
const numberCell = "whitespace-nowrap px-3 py-2 text-right font-mono text-row tabular-nums";
const inlineInput =
  "w-28 border-0 border-b border-transparent bg-transparent px-0 py-0.5 text-right font-mono text-row tabular-nums text-ink outline-none placeholder:text-ink-soft/50 hover:border-rule focus:border-azure";

const formatPoints = (points) => points.toLocaleString("en-US");

function Panel({ id, title, note, actions, children }) {
  return (
    <section className="border border-edge bg-panel" aria-labelledby={id}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-edge px-4 py-3">
        <h2 id={id} className="font-sans text-base font-semibold tracking-tight text-chalk">
          {title}
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          {note && <span className="font-mono text-label uppercase text-chalk-soft">{note}</span>}
          {actions}
        </div>
      </div>
      {children}
    </section>
  );
}

function Tile({ label, cents, note }) {
  return (
    <div className="bg-panel px-4 py-3">
      <dt className="font-mono text-label uppercase text-chalk-soft">{label}</dt>
      <dd className="mt-1 font-mono text-figure font-medium text-chalk">{formatCents(cents)}</dd>
      {note && <dd className="mt-0.5 font-mono text-label uppercase text-chalk-soft">{note}</dd>}
    </div>
  );
}

function ErrorLine({ message }) {
  if (!message) return null;
  return (
    <p role="alert" className="border-t border-edge px-4 py-3 font-sans text-row text-vermilion">
      {message}
    </p>
  );
}

/** Balances, one row per program per person, grouped by kind. */
function BalancesTable({ balances, valuations, resolve, onPoints, onEdit, onDelete }) {
  const rows = balances
    .map((balance) => ({ balance, program: programById(balance.programId) }))
    .filter((row) => row.program);

  return (
    <div className="relative scroll-x">
      <table className="stack w-full border-collapse">
        <thead>
          <tr className="bg-panel-raised">
            <th scope="col" className={`${headCell} text-left`}>
              Program
            </th>
            <th scope="col" className={`${headCell} text-right`}>
              Points
            </th>
            <th scope="col" className={`${headCell} text-right`}>
              Per point
            </th>
            <th scope="col" className={`${headCell} text-right`}>
              Worth
            </th>
            <th scope="col" className="px-3 py-2">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {PROGRAM_KIND_ORDER.flatMap((kind) => {
            const inKind = rows.filter((row) => row.program.kind === kind);
            if (inKind.length === 0) return [];
            return [
              <tr key={`kind-${kind}`} className="bg-band">
                <th
                  scope="rowgroup"
                  colSpan={5}
                  className="px-3 py-1.5 text-left font-mono text-label uppercase text-ink-soft"
                >
                  {PROGRAM_KIND_LABELS[kind]}
                </th>
              </tr>,
              ...inKind.map(({ balance, program }, index) => {
                const per100 = resolve(program.id);
                const label = balance.holder ? `${program.name} (${balance.holder})` : program.name;
                return (
                  <tr key={balance.id} className={index % 2 === 0 ? "bg-sheet" : "bg-sheet-alt"}>
                    <th scope="row" className="px-3 py-2 text-left font-sans text-row font-normal text-ink">
                      <div>{program.name}</div>
                      <div className="font-mono text-label uppercase text-ink-soft">
                        {[balance.holder, balance.asOf && `as of ${formatDateMedium(balance.asOf)}`]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </th>
                    <td data-label="Points" className={numberCell}>
                      <input
                        key={`points-${balance.id}-${balance.points}`}
                        type="text"
                        inputMode="numeric"
                        aria-label={`${label} points`}
                        defaultValue={formatPoints(balance.points)}
                        className={inlineInput}
                        onFocus={(event) => event.target.select()}
                        onBlur={(event) => {
                          const typed = event.target.value;
                          if (toPoints(typed) === balance.points) {
                            event.target.value = formatPoints(balance.points);
                            return;
                          }
                          onPoints(balance, typed);
                        }}
                      />
                    </td>
                    <td data-label="Per point" className={`${numberCell} text-ink-soft`}>
                      {formatPointValue(per100)}
                      {valuations[program.id] != null && (
                        <span className="sr-only"> (your value)</span>
                      )}
                    </td>
                    <td data-label="Worth" className={`${numberCell} font-medium text-ink`}>
                      {formatCents(valueOfPointsCents(balance.points, per100))}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="row-action"
                          size="sm"
                          aria-label={`Edit ${label}`}
                          onClick={() => onEdit(balance)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="row"
                          size="sm"
                          aria-label={`Remove ${label}`}
                          onClick={() => onDelete(balance)}
                        >
                          Remove
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              }),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Every program in the catalog, its starting value, and the household's own. */
function ValuationsTable({ valuations, heldPoints, onValue }) {
  return (
    <div className="relative scroll-x">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-panel-raised">
            <th scope="col" className={`${headCell} text-left`}>
              Program
            </th>
            {/* Not on a phone: the catalog's figure is already the placeholder
                in the field beside it, and dropping it is what lets this list
                stay one line per program rather than becoming thirty cards. */}
            <th scope="col" className={`${headCell} hidden text-right sm:table-cell`}>
              Catalog value
            </th>
            <th scope="col" className={`${headCell} text-right`}>
              Your value
            </th>
            <th scope="col" className={`${headCell} text-right`}>
              You hold
            </th>
          </tr>
        </thead>
        <tbody>
          {PROGRAM_KIND_ORDER.flatMap((kind) => [
            <tr key={`kind-${kind}`} className="bg-band">
              <th
                scope="rowgroup"
                colSpan={4}
                className="px-3 py-1.5 text-left font-mono text-label uppercase text-ink-soft"
              >
                {PROGRAM_KIND_LABELS[kind]}
              </th>
            </tr>,
            ...CATALOG.filter((program) => program.kind === kind).map((program, index) => {
              const stored = valuations[program.id];
              const held = heldPoints.get(program.id);
              return (
                <tr key={program.id} className={index % 2 === 0 ? "bg-sheet" : "bg-sheet-alt"}>
                  <th scope="row" className="px-3 py-2 text-left font-sans text-row font-normal text-ink">
                    {program.name}
                  </th>
                  <td className={`${numberCell} hidden text-ink-soft sm:table-cell`}>
                    {formatPointValue(program.valuePer100Cents)}
                  </td>
                  <td className={numberCell}>
                    <input
                      key={`value-${program.id}-${stored ?? ""}`}
                      type="text"
                      inputMode="decimal"
                      aria-label={`Your value for ${program.name}, in cents per point`}
                      placeholder={formatPointValue(program.valuePer100Cents)}
                      defaultValue={stored == null ? "" : formatPointValue(stored)}
                      className={inlineInput}
                      onFocus={(event) => event.target.select()}
                      onBlur={(event) => {
                        const typed = event.target.value;
                        const unchanged =
                          (typed.trim() === "" && stored == null) ||
                          (stored != null && typed === formatPointValue(stored));
                        if (!unchanged) onValue(program, typed);
                      }}
                    />
                  </td>
                  <td className={`${numberCell} ${held ? "text-ink" : "text-ink-soft"}`}>
                    {held ? formatPoints(held) : "—"}
                  </td>
                </tr>
              );
            }),
          ])}
        </tbody>
      </table>
    </div>
  );
}

/** How a planned trip would be paid for, in a sentence. */
function fundingSentence(plan) {
  const parts = [];
  if (plan.fromProgram > 0) {
    parts.push(`${formatPoints(plan.fromProgram)} from ${plan.program.name}`);
  }
  for (const transfer of plan.transfers) {
    const source = programById(transfer.programId);
    const ratio =
      transfer.ratio[0] === transfer.ratio[1] ? "" : ` at ${transfer.ratio[0]}:${transfer.ratio[1]}`;
    parts.push(`${formatPoints(transfer.sent)} moved from ${source.name}${ratio}`);
  }
  return parts.join(", ");
}

function TripsTable({ plans, onEdit, onDelete }) {
  return (
    <div className="relative scroll-x">
      <table className="stack w-full border-collapse">
        <thead>
          <tr className="bg-panel-raised">
            <th scope="col" className={`${headCell} text-left`}>
              Trip
            </th>
            <th scope="col" className={`${headCell} text-right`}>
              Points
            </th>
            <th scope="col" className={`${headCell} text-right`}>
              Cash too
            </th>
            <th scope="col" className={`${headCell} text-right`}>
              Per point
            </th>
            <th scope="col" className={`${headCell} text-left`}>
              Paid for by
            </th>
            <th scope="col" className="px-3 py-2">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {plans.map((plan, index) => {
            const { trip, program } = plan;
            return (
              <tr key={trip.id} className={index % 2 === 0 ? "bg-sheet" : "bg-sheet-alt"}>
                <th scope="row" className="px-3 py-2 text-left font-sans text-row font-normal text-ink">
                  <div>{trip.name}</div>
                  <div className="font-mono text-label uppercase text-ink-soft">
                    {[program.name, trip.date && formatDateMedium(trip.date)].filter(Boolean).join(" · ")}
                  </div>
                </th>
                <td data-label="Points" className={`${numberCell} text-ink`}>
                  {formatPoints(trip.points)}
                </td>
                <td data-label="Cash too" className={`${numberCell} text-ink`}>
                  {formatCents(trip.taxesCents)}
                </td>
                <td data-label="Per point" className={numberCell}>
                  {plan.achievedPer100Cents == null ? (
                    <span className="text-ink-soft" title="Add the cash price to see what each point is worth on this trip">
                      —
                    </span>
                  ) : (
                    <div>
                      <div className={plan.goodValue ? "font-medium text-verdant" : "text-ink"}>
                        {formatPointValue(plan.achievedPer100Cents)}
                      </div>
                      <div className="font-mono text-label uppercase text-ink-soft">
                        {plan.goodValue ? "Beats" : "Under"} your {formatPointValue(plan.valuePer100Cents)}
                      </div>
                    </div>
                  )}
                </td>
                <td data-label="Paid for by" className="px-3 py-2 font-sans text-row text-ink">
                  {plan.covered ? (
                    <span>
                      <span className="font-medium text-verdant">Covered</span>
                      {" — "}
                      {fundingSentence(plan)}
                    </span>
                  ) : (
                    <span>
                      <span className="font-medium text-vermilion-ink">
                        {formatPoints(plan.shortfall)} short
                      </span>
                      {fundingSentence(plan) && <> — {fundingSentence(plan)} so far</>}
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="row-action"
                      size="sm"
                      aria-label={`Edit ${trip.name}`}
                      onClick={() => onEdit(trip)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="row"
                      size="sm"
                      aria-label={`Remove ${trip.name}`}
                      onClick={() => onDelete(trip)}
                    >
                      Remove
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function RewardsPage() {
  const {
    balances,
    valuations,
    trips,
    updateBalance,
    deleteBalance,
    setValuation,
    deleteTrip,
  } = useRewards();

  const [balanceModal, setBalanceModal] = useState({ show: false, balance: null });
  const [tripModal, setTripModal] = useState({ show: false, trip: null });
  const [balanceError, setBalanceError] = useState(null);
  const [valueError, setValueError] = useState(null);

  const summary = useMemo(
    () => summariseRewards({ balances, valuations, trips }),
    [balances, valuations, trips]
  );
  const heldPoints = new Map(summary.programs.map((row) => [row.program.id, row.points]));
  const resolve = (programId) =>
    summary.programs.find((row) => row.program.id === programId)?.valuePer100Cents ??
    programById(programId)?.valuePer100Cents ??
    0;

  function handlePoints(balance, typed) {
    const result = updateBalance({ id: balance.id, points: typed });
    setBalanceError(result.ok ? null : result.error);
  }

  function handleValue(program, typed) {
    const result = setValuation({ programId: program.id, value: typed });
    setValueError(result.ok ? null : `${program.name}: ${result.error}`);
  }

  const coveredCount = summary.trips.filter((plan) => plan.covered).length;

  return (
    <>
      <PageHeader
        eyebrow="Rewards & travel"
        title="Points and miles"
        description="What your card points, airline miles and hotel points are worth, and the trips you are saving them for. Every program starts on a catalog value — type your own wherever you value a point differently, and every figure on the page follows it. None of this counts towards your budget or net worth."
        actions={
          <>
            <Button variant="primary" onClick={() => setBalanceModal({ show: true, balance: null })}>
              Add balance
            </Button>
            <Button variant="outline" onClick={() => setTripModal({ show: true, trip: null })}>
              Plan a trip
            </Button>
          </>
        }
      />

      <div className="space-y-6">
        <section aria-label="What your points are worth" className="overflow-hidden border border-edge">
          <dl className="grid gap-px bg-edge sm:grid-cols-2 xl:grid-cols-4">
            <Tile
              label="All points and miles"
              cents={summary.totalValueCents}
              note={`${formatPoints(summary.totalPoints)} across ${summary.programs.length} ${
                summary.programs.length === 1 ? "program" : "programs"
              }`}
            />
            {PROGRAM_KIND_ORDER.map((kind) => (
              <Tile key={kind} label={PROGRAM_KIND_LABELS[kind]} cents={summary.valueByKind[kind]} />
            ))}
          </dl>
        </section>

        <Panel id="rewards-balances" title="Balances">
          {balances.length === 0 ? (
            <p className="px-4 py-5 font-sans text-row text-chalk-soft">
              No balances yet. Add each card, airline and hotel program you hold — one per person
              if two of you earn separately.
            </p>
          ) : (
            <BalancesTable
              balances={balances}
              valuations={valuations}
              resolve={resolve}
              onPoints={handlePoints}
              onEdit={(balance) => setBalanceModal({ show: true, balance })}
              onDelete={(balance) => deleteBalance({ id: balance.id })}
            />
          )}
          <ErrorLine message={balanceError} />
        </Panel>

        <Panel
          id="rewards-trips"
          title="Trips"
          note={
            summary.trips.length > 0
              ? `${coveredCount} of ${summary.trips.length} covered`
              : null
          }
        >
          {summary.trips.length === 0 ? (
            <p className="px-4 py-5 font-sans text-row text-chalk-soft">
              No trips planned. Add one with its award price and the cash fare for the same trip,
              and this shows whether you have the points — counting what your card points can
              transfer — and what each point is worth on it.
            </p>
          ) : (
            <>
              <TripsTable
                plans={summary.trips}
                onEdit={(trip) => setTripModal({ show: true, trip })}
                onDelete={(trip) => deleteTrip({ id: trip.id })}
              />
              <p className="border-t border-edge px-4 py-3 font-sans text-row text-chalk-soft">
                Trips are funded in date order, from the program's own balance first and then by
                transfer from your card points, largest balance first. Transfer partners and ratios
                change, and a transfer cannot be undone — confirm with the card issuer before moving
                points.
              </p>
            </>
          )}
        </Panel>

        <Panel id="rewards-valuations" title="What a point is worth" note="Cents per point">
          <p className="border-b border-edge px-4 py-3 font-sans text-row text-chalk-soft">
            The catalog value is a typical figure for spending points well. Yours is what you
            actually get — leave it blank to use the catalog's. A trip that earns more per point
            than your value is a good use of the points.
          </p>
          <ValuationsTable valuations={valuations} heldPoints={heldPoints} onValue={handleValue} />
          <ErrorLine message={valueError} />
        </Panel>
      </div>

      <AddRewardBalanceModal
        show={balanceModal.show}
        balance={balanceModal.balance}
        handleClose={() => setBalanceModal({ show: false, balance: null })}
      />
      <AddTripModal
        show={tripModal.show}
        trip={tripModal.trip}
        handleClose={() => setTripModal({ show: false, trip: null })}
      />
    </>
  );
}
