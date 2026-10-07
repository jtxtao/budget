import Button from "./Button";
import { LIFE_EVENT_KINDS } from "../contexts/LifeEventsContext";
import { formatBps, formatCents, todayISO } from "../utils";

/**
 * The household's life events, on the Retirement page beside the projection
 * they move.
 *
 * Each row says what the event does in one phrase, when, and whether it is in
 * the plan; the checkbox leaves it out without deleting it. Adding goes through
 * `AddLifeEventModal`, from a blank form, a template, or a savings goal — the
 * last two only *seed* the form, so nothing lands until the household has
 * looked at the figures and pressed save.
 *
 * Templates are starting figures, not advice: a wedding is whatever the
 * household's wedding costs. Each names a plausible age off the plan's own,
 * since an event at an age already behind you would do nothing.
 */

export const LIFE_EVENT_TEMPLATES = [
  {
    key: "wedding",
    label: "Wedding",
    seed: ({ currentAge }) => ({ name: "Wedding", kind: LIFE_EVENT_KINDS.EXPENSE, startAge: currentAge + 1, years: 1, oneTimeCents: 30_000_00 }),
  },
  {
    key: "childcare",
    label: "Childcare",
    seed: ({ currentAge }) => ({ name: "Childcare", kind: LIFE_EVENT_KINDS.EXPENSE, startAge: currentAge + 1, years: 5, annualCents: 18_000_00 }),
  },
  {
    key: "college",
    label: "College",
    seed: ({ currentAge }) => ({ name: "College", kind: LIFE_EVENT_KINDS.EXPENSE, startAge: currentAge + 18, years: 4, annualCents: 25_000_00 }),
  },
  {
    key: "sabbatical",
    label: "Sabbatical",
    seed: ({ currentAge }) => ({ name: "Sabbatical", kind: LIFE_EVENT_KINDS.INCOME_CHANGE, startAge: currentAge + 5, years: 1, keptShareBps: 0 }),
  },
  {
    key: "part-time",
    label: "Going part-time",
    seed: ({ retirementAge }) => ({ name: "Part-time", kind: LIFE_EVENT_KINDS.INCOME_CHANGE, startAge: Math.max(0, retirementAge - 5), years: 5, keptShareBps: 5000 }),
  },
  {
    key: "social-security",
    label: "Social Security",
    seed: () => ({ name: "Social Security", kind: LIFE_EVENT_KINDS.INCOME, startAge: 67, years: null, annualCents: 24_000_00 }),
  },
  {
    key: "pension",
    label: "Pension",
    seed: ({ retirementAge }) => ({ name: "Pension", kind: LIFE_EVENT_KINDS.INCOME, startAge: retirementAge, years: null, annualCents: 12_000_00 }),
  },
  {
    key: "inheritance",
    label: "Inheritance",
    seed: ({ currentAge }) => ({ name: "Inheritance", kind: LIFE_EVENT_KINDS.INCOME, startAge: currentAge + 20, years: 1, oneTimeCents: 100_000_00 }),
  },
];

/**
 * A savings goal as the seed of an event: its target spent in the year of its
 * date. The money already set aside for it sits in the accounts the projection
 * starts from, so spending the whole target that year is the honest reading —
 * nothing is counted twice. Undated, it lands next year.
 */
export function seedFromGoal(goal, currentAge) {
  const thisYear = Number(todayISO().slice(0, 4));
  const year = goal.targetDate ? Number(goal.targetDate.slice(0, 4)) : thisYear + 1;
  return {
    name: goal.name,
    kind: LIFE_EVENT_KINDS.EXPENSE,
    startAge: currentAge + Math.max(0, year - thisYear),
    years: 1,
    oneTimeCents: goal.targetCents,
  };
}

/** When an event runs, in ages and in calendar years. */
function describeWhen(event, currentAge) {
  const thisYear = Number(todayISO().slice(0, 4));
  const yearOf = (age) => (currentAge == null ? null : thisYear + (age - currentAge));
  const at = (age) => (yearOf(age) == null ? `${age}` : `${age} (${yearOf(age)})`);
  if (event.years === 1) return `at ${at(event.startAge)}`;
  if (event.years == null) return `from ${at(event.startAge)} on`;
  return `from ${at(event.startAge)} for ${event.years} years`;
}

/** What an event does, in one phrase. */
export function describeEffect(event) {
  if (event.kind === LIFE_EVENT_KINDS.INCOME_CHANGE) {
    return event.keptShareBps === 0 ? "No pay" : `${formatBps(event.keptShareBps)} of pay`;
  }
  const parts = [];
  if (event.oneTimeCents) parts.push(`${formatCents(event.oneTimeCents)} once`);
  if (event.annualCents) parts.push(`${formatCents(event.annualCents)} a year`);
  const sign = event.kind === LIFE_EVENT_KINDS.INCOME ? "In" : "Out";
  return `${sign}: ${parts.join(" + ")}`;
}

export default function LifeEventsPanel({
  plan,
  events,
  goals,
  onAdd,
  onEdit,
  onToggle,
  onRemove,
}) {
  const ready = plan.currentAge != null && plan.retirementAge != null;
  const ages = { currentAge: plan.currentAge, retirementAge: plan.retirementAge };
  const sorted = [...events].sort((a, b) => a.startAge - b.startAge);

  return (
    <section aria-labelledby="life-events-heading" className="border border-edge bg-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-edge px-4 py-3">
        <h2 id="life-events-heading" className="font-sans text-base font-semibold tracking-tight text-chalk">
          Life events
        </h2>
        <Button variant="outline" onClick={() => onAdd(null)}>
          Add an event
        </Button>
      </div>

      {sorted.length === 0 ? (
        <p className="px-4 py-3 font-sans text-row text-chalk-soft">
          Nothing planned yet. A wedding, childcare, a year off, Social Security — each one moves
          the net worth above, year by year.
        </p>
      ) : (
        <ul className="divide-y divide-edge">
          {sorted.map((event) => (
            <li key={event.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
              <input
                type="checkbox"
                checked={event.enabled}
                aria-label={`Include ${event.name}`}
                onChange={(change) => onToggle({ id: event.id, enabled: change.target.checked })}
                className="h-3.5 w-3.5 shrink-0 accent-azure"
              />
              <div className={`min-w-0 flex-1 ${event.enabled ? "" : "opacity-60"}`}>
                <span className="font-sans text-row text-chalk">{event.name}</span>{" "}
                <span className="font-sans text-row text-chalk-soft">
                  {describeWhen(event, plan.currentAge)}
                </span>
                <span className="block font-mono text-label text-chalk-soft">{describeEffect(event)}</span>
              </div>
              <Button variant="outline" aria-label={`Edit ${event.name}`} onClick={() => onEdit(event)}>
                Edit
              </Button>
              <Button variant="outline" aria-label={`Remove ${event.name}`} onClick={() => onRemove(event.id)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="border-t border-edge px-4 py-3">
        <h3 className="mb-2 font-mono text-label uppercase text-chalk-soft">Start from</h3>
        {ready ? (
          <div className="flex flex-wrap gap-2">
            {LIFE_EVENT_TEMPLATES.map((template) => (
              <Button key={template.key} variant="outline" onClick={() => onAdd(template.seed(ages))}>
                {template.label}
              </Button>
            ))}
            {goals.map((goal) => (
              <Button
                key={goal.id}
                variant="outline"
                aria-label={`From the savings goal ${goal.name}`}
                onClick={() => onAdd(seedFromGoal(goal, plan.currentAge))}
              >
                Goal: {goal.name}
              </Button>
            ))}
          </div>
        ) : (
          <p className="font-sans text-row text-chalk-soft">
            Enter your age and when you want to retire, and the templates will start at sensible ages.
          </p>
        )}
      </div>
    </section>
  );
}
