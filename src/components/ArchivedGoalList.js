import Button from "./Button";
import { formatCents, formatDateMedium } from "../utils";

/**
 * Goals that have been closed out: what each was planned at, saved and spent,
 * kept for the record. Closed by default — it is history, not something to act
 * on — and a goal can be reopened or removed for good from here.
 */
export default function ArchivedGoalList({ rows, onRestore, onDelete }) {
  if (rows.length === 0) return null;
  return (
    <details className="rounded-2xl border border-edge bg-panel">
      <summary className="cursor-pointer px-4 py-3 font-sans text-base font-semibold tracking-tight text-chalk">
        Archived goals ({rows.length})
      </summary>
      <ul aria-label="Archived goals" className="divide-y divide-edge border-t border-edge">
        {rows.map((row) => (
          <li key={row.goalId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 font-sans text-row">
            <span className="min-w-0 flex-1">
              <span className="block text-chalk">{row.name}</span>
              <span className="block text-label text-chalk-soft">Closed out {formatDateMedium(row.archivedOn)}</span>
            </span>
            <span className="text-label text-chalk-soft">
              Planned <span className="font-mono text-chalk">{formatCents(row.targetCents)}</span>
              {" · "}Saved <span className="font-mono text-chalk">{formatCents(row.savedCents + row.spentCents)}</span>
              {" · "}Spent <span className="font-mono text-chalk">{formatCents(row.spentCents)}</span>
            </span>
            <span className="flex gap-2">
              <Button variant="row-action" size="sm" aria-label={`Restore goal: ${row.name}`} onClick={() => onRestore(row)}>
                Restore
              </Button>
              <Button variant="row" size="sm" aria-label={`Remove goal: ${row.name}`} onClick={() => onDelete(row)}>
                Remove
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
