import { useEffect, useState } from "react";
import Button from "./Button";
import GoalEnvelope from "./GoalEnvelope";
import { SortableList, useSortableItem } from "./Sortable";
import { currentPeriod, formatCents, formatDateMedium, toCents, toPeriod } from "../utils";

function GoalMeter({ ratio, label }) {
  const percent = Math.max(0, Math.min(100, ratio * 100));
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-edge" role="progressbar" aria-label={label} aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
      <span className="block h-full rounded-full bg-verdant" style={{ width: percent + "%" }} />
    </div>
  );
}

function monthsUntil(targetDate, now) {
  const target = toPeriod(targetDate);
  if (!target || !now) return null;
  const [ty, tm] = now.split("-").map(Number);
  const [gy, gm] = target.split("-").map(Number);
  return (gy - ty) * 12 + gm - tm;
}

/**
 * Planned, saved, spent and what is left, side by side — the reading a goal
 * paid off in pieces is for (the venue in March, the photographer in June).
 * "Saved" is everything ever put aside, spent or not, since spending a saved
 * dollar does not un-save it; "In the goal" is what is still there to spend.
 */
function GoalFigures({ row, totalSavedCents }) {
  const figures = [
    ["Planned", row.targetCents],
    ["Saved", totalSavedCents],
    ["Spent", row.spentCents],
    ["In the goal", row.savedCents],
    ["Still to save", row.remainingCents],
  ];
  return (
    <dl aria-label={`Figures for ${row.name}`} className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
      {figures.map(([term, cents]) => (
        <div key={term}>
          <dt className="font-sans text-label uppercase text-chalk-soft">{term}</dt>
          <dd className="m-0 font-mono text-row text-chalk">{formatCents(cents)}</dd>
        </div>
      ))}
    </dl>
  );
}

function SpendingList({ row, onUndoSpending }) {
  const [error, setError] = useState(null);
  function undo(entry) {
    const result = onUndoSpending(row, entry);
    setError(result?.ok === false ? result.error : null);
  }
  return (
    <div>
      <h4 className="mb-1 font-sans text-label uppercase text-chalk-soft">Spent so far</h4>
      <ul aria-label={`Spending from ${row.name}`} className="divide-y divide-edge">
        {row.spending.map((entry) => (
          <li key={entry.id} className="flex items-center gap-2 py-1.5 font-sans text-row">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-chalk">{entry.note || entry.categoryName || "Spending"}</span>
              <span className="block text-label text-chalk-soft">
                {formatDateMedium(entry.date)}
                {entry.categoryName ? ` · ${entry.categoryName}` : ""}
              </span>
            </span>
            <span className="font-mono text-chalk">{formatCents(entry.amountCents)}</span>
            {onUndoSpending && (
              <Button
                variant="row-action"
                size="sm"
                aria-label={`Undo spending: ${entry.note || formatCents(entry.amountCents)}`}
                onClick={() => undo(entry)}
              >
                Undo
              </Button>
            )}
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="font-sans text-row text-vermilion">{error}</p>}
    </div>
  );
}

function GoalCard({ row, onAssign, onEdit, onDelete, onSpend, onArchive, onUndoSpending, error, sortable }) {
  const item = useSortableItem(row.goalId, { disabled: !sortable });
  const [confirmation, setConfirmation] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const detailsId = `goal-details-${row.goalId}`;
  const spentCents = row.spentCents ?? 0;
  const spending = row.spending ?? [];
  // Spent money was saved first, so it counts towards the target: paying the
  // venue out of the wedding fund leaves the wedding exactly as far along.
  const totalSavedCents = row.savedCents + spentCents;
  const ratio = row.targetCents > 0 ? totalSavedCents / row.targetCents : 0;
  const months = monthsUntil(row.targetDate, currentPeriod());
  const percent = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
  const reached = row.targetCents > 0 && row.remainingCents === 0;

  useEffect(() => {
    if (confirmation === null) return;
    const id = setTimeout(() => setConfirmation(null), 1500);
    return () => clearTimeout(id);
  }, [confirmation]);

  function handleBlur(event) {
    const raw = event.target.value.trim();
    if (!raw) return;
    const delta = toCents(raw);
    if (delta === null || delta === 0) { event.target.value = ""; return; }
    const result = onAssign(row, row.assignedCents + delta);
    event.target.value = "";
    if (result.ok) setConfirmation(delta);
  }

  const pace = totalSavedCents >= row.targetCents || months === null ? null : months <= 0
    ? (months === 0 ? "Due this month" : `${Math.abs(months)}mo overdue`)
    : `${formatCents(Math.ceil(row.remainingCents / months))}/mo · ${months} ${months === 1 ? "month" : "months"} left`;

  return (
    <article ref={item.ref} style={item.style} {...item.handle} className={`relative min-w-0 rounded-xl border border-edge bg-panel p-5 text-chalk ${item.isDragging ? "z-10" : ""}`}>
      {/* The name and date sit outside the envelope, so a sealed one still says
          which goal it is. They head a button that opens the envelope and
          reveals the goal's details — one toggle for both. A heading wrapping a
          button is the accordion pattern: the heading keeps its place for
          screen-reader navigation and takes its name from the label, while the
          button carries the expanded state. */}
      <h3 className="m-0">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-controls={detailsId}
          className="group block w-full -mx-5 -mt-5 overflow-hidden rounded-t-xl px-5 pt-5 text-center"
        >
          <span className="block font-display text-xl leading-tight text-chalk">{row.name}</span>
          <span className="mt-1 block font-sans text-label uppercase tracking-wider text-chalk-soft">
            {row.targetDate ? `By ${formatDateMedium(row.targetDate)}` : "Saving up"}
          </span>
          <span className="-mx-5 mt-2 block">
            <GoalEnvelope
              open={expanded}
              figure={formatCents(totalSavedCents)}
              figureLabel={row.targetCents > 0 ? `of ${formatCents(row.targetCents)} saved` : "saved"}
              sealFigure={reached ? "✓" : `${percent}%`}
              sealLabel={reached ? "Reached" : "Saved"}
              color={row.envelopeColor}
              photo={row.photo}
            />
          </span>
          <span aria-hidden="true" className="-mt-1 flex items-center justify-center gap-1.5 pb-3 font-sans text-label uppercase text-chalk-soft transition-colors group-hover:text-chalk">
            {expanded ? "Hide" : "Add or spend"}
            <svg viewBox="0 0 12 8" className={`h-2 w-3 transition-transform ${expanded ? "rotate-180" : ""}`}><path d="M1 1.5 6 6.5 11 1.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
        </button>
      </h3>
      {expanded && (
        <div id={detailsId} className="goal-details space-y-3">
          <GoalMeter ratio={ratio} label={`Savings progress for ${row.name}`} />
          {/* The envelope's letter already carries saved-of-target and the bar
              carries the percent, so the panel adds only what they cannot: what
              is left to go and the pace that clears it. */}
          <div className="text-chalk-soft flex flex-wrap items-center justify-between gap-x-3 gap-y-1 font-sans text-label">
            <span>{row.remainingCents === 0 ? "Goal reached!" : `${formatCents(row.remainingCents)} to go`}</span>
            {pace && <span>{pace}</span>}
          </div>
          {spentCents > 0 && <GoalFigures row={{ ...row, spentCents }} totalSavedCents={totalSavedCents} />}
          {spending.length > 0 && <SpendingList row={{ ...row, spending }} onUndoSpending={onUndoSpending} />}
          {row.categoryName && <p className="text-label text-chalk-soft">Linked to {row.categoryName}</p>}
          {row.link && <p><a href={row.link} target="_blank" rel="noopener noreferrer" className="font-sans text-label text-azure underline">Open goal link <span className="sr-only">for {row.name}</span></a></p>}
          <div className="flex flex-wrap items-center gap-2 border-t border-edge pt-3">
            <label className="font-sans text-label uppercase text-chalk-soft" htmlFor={`goal-add-${row.goalId}`}>Add money</label>
            <input key={row.assignedCents} id={`goal-add-${row.goalId}`} type="text" inputMode="decimal" placeholder="$0" aria-label={`Add to ${row.name}`} onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }} onBlur={handleBlur} className="w-28 border-b-2 border-rule bg-transparent px-1 py-1 text-right font-mono text-row text-chalk outline-none focus:border-azure" />
            {confirmation !== null && <span className="text-label text-verdant">{confirmation > 0 ? "+" : ""}{formatCents(confirmation)}</span>}
            <span className="flex-1" />
            {onSpend && <Button variant="row-action" size="sm" aria-label={`Spend from ${row.name}`} onClick={() => onSpend(row)}>Spend</Button>}
            <Button variant="row-action" size="sm" aria-label={`Edit goal: ${row.name}`} onClick={() => onEdit(row)}>Edit</Button>
            {onArchive && <Button variant="row-action" size="sm" aria-label={`Close out goal: ${row.name}`} onClick={() => onArchive(row)}>Close out</Button>}
            <Button variant="row" size="sm" aria-label={`Remove goal: ${row.name}`} onClick={() => onDelete(row)}>Remove</Button>
          </div>
          {error && <p role="alert" className="font-sans text-row text-vermilion">{error}</p>}
        </div>
      )}
    </article>
  );
}

export default function SavingsGoalList({ rows, onAssign, onEdit, onDelete, onReorder, onSpend, onArchive, onUndoSpending }) {
  const [error, setError] = useState(null);
  function commit(row, cents) {
    const result = onAssign(row, cents);
    setError(result.ok ? null : { id: row.goalId, message: result.error });
    return result;
  }

  return (
    <section aria-label="Savings goals" className="overflow-hidden rounded-2xl border border-edge bg-panel">
      <div className="flex items-center justify-between border-b border-edge px-4 py-3">
        <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">Your savings goals</h2>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 font-sans text-row text-chalk-soft">No savings goals yet. Add one for something you are excited about: a trip, a new camera, or a cozy home upgrade.</p>
      ) : (
        <div className="p-4 sm:p-5">
          <SortableList ids={rows.map((row) => row.goalId)} onReorder={onReorder ?? (() => {})}>
            <div className="grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {rows.map((row) => <GoalCard key={row.goalId} row={row} onAssign={commit} onEdit={onEdit} onDelete={onDelete} onSpend={onSpend} onArchive={onArchive} onUndoSpending={onUndoSpending} error={error?.id === row.goalId ? error.message : null} sortable={onReorder != null} />)}
            </div>
          </SortableList>
        </div>
      )}
    </section>
  );
}
