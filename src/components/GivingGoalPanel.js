import SourceChoice from "./SourceChoice";
import { GOAL_SOURCES } from "../contexts/DonationsContext";
import { amountAtRest, amountField, formatBps, formatCents, toCents } from "../utils";

/**
 * What the year is aiming to give — a figure, or a share of what comes in.
 *
 * **Two legitimate answers, and both are kept.** A household that gives a tenth
 * wants the target to follow what it actually earned; one that has decided on six
 * thousand wants six thousand, whatever the year does. Neither covers the other,
 * and a control that cleared the answer it switched away from could only be used
 * once — the same rule, for the same reason, as the retirement plan's two
 * sources. See `DonationsContext`.
 *
 * **A share is a share of income recorded so far, not of income expected.** That
 * is what makes the target move through the year, which is the point of stating a
 * goal that way: a tenth of what has come in is owed now, and a tenth of what
 * might come in is a different promise. The panel prints the working underneath
 * rather than only the answer, because a figure that changes by itself between
 * two visits has to say why.
 *
 * A panel outside a modal, so it commits on **blur** like every other one here: a
 * half-typed "1" on the way to "10" is a valid figure, and writing it would move
 * the meter above for as long as it took to finish typing. Each field is keyed on
 * the stored value, so a rejected figure stays on screen to be corrected while a
 * successful one re-seeds from what was actually saved.
 */

const labelClass = "mb-1.5 block font-mono text-label uppercase text-chalk-soft";

const inputClass =
  "w-full border-0 border-b-2 border-edge bg-transparent px-0 py-1.5 font-mono text-lg text-chalk outline-none transition-colors placeholder:text-chalk-soft/60 focus:border-azure";

const GOAL_OPTIONS = [
  { value: GOAL_SOURCES.AMOUNT, label: "A figure for the year" },
  { value: GOAL_SOURCES.INCOME_SHARE, label: "A share of what I earn" },
];

export default function GivingGoalPanel({ year, goal, error, onChange }) {
  const byShare = goal.source === GOAL_SOURCES.INCOME_SHARE;

  return (
    <section aria-label="Giving goal" className="border border-edge bg-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-edge px-4 py-3">
        <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">
          Goal for {year}
        </h2>
        <span className="font-mono text-label uppercase text-chalk-soft">
          {goal.stated ? formatCents(goal.targetCents) : "Not set"}
        </span>
      </div>

      <div className="border-b border-edge px-4 py-3">
        <SourceChoice
          name="giving-goal-source"
          legend="How the goal for the year is worked out"
          value={goal.source}
          options={GOAL_OPTIONS}
          onChange={(source) => onChange({ source })}
        />
      </div>

      <div className="px-4 py-4">
        {byShare ? (
          <>
            <label>
              <span className={labelClass}>Share of income</span>
              <input
                key={`share-${goal.shareBps ?? ""}`}
                // Text rather than a number input, like every rate field here:
                // people write this one with a "%", which a number input refuses
                // outright — the box looks filled and reads back empty.
                type="text"
                inputMode="decimal"
                placeholder="e.g. 10%"
                // Divided rather than taken through `fromBps`, which would
                // multiply straight back and leave 10.5% reading as
                // "10.500000000000002" in the box.
                defaultValue={goal.shareBps == null ? "" : String(goal.shareBps / 100)}
                className={inputClass}
                onBlur={(event) => onChange({ share: event.target.value })}
              />
            </label>
            <p className="mt-2 font-sans text-row text-chalk-soft">
              {goal.shareBps == null ? (
                <>Of everything that comes in this year. Leave it blank for no goal.</>
              ) : (
                <>
                  {formatBps(goal.shareBps)} of the{" "}
                  <span className="text-chalk">{formatCents(goal.incomeCents)}</span> recorded so
                  far is <span className="text-chalk">{formatCents(goal.targetCents)}</span> — so
                  the target grows as the year does.
                </>
              )}
            </p>
          </>
        ) : (
          <>
            <label>
              <span className={labelClass}>Goal for the year</span>
              {/* The two faces of a money field: formatted at rest, so the
                  target reads as money beside the figures it is measured
                  against, and raw under the caret. The focus half is the shared
                  one; the blur half is written here, because this field commits
                  on blur and what goes back in the box after a refused edit is a
                  question only it can answer — junk stays exactly as typed, to
                  be corrected beside the message. */}
              <input
                key={`amount-${goal.amountCents ?? ""}`}
                type="text"
                inputMode="decimal"
                placeholder="No goal"
                defaultValue={amountAtRest(goal.amountCents)}
                className={inputClass}
                onFocus={amountField.onFocus}
                onBlur={(event) => {
                  onChange({ amount: event.target.value });
                  const cents = toCents(event.target.value);
                  if (cents != null) event.target.value = amountAtRest(cents);
                }}
              />
            </label>
            <p className="mt-2 font-sans text-row text-chalk-soft">
              What you intend to give in {year}, whatever the year earns. Leave it blank for no
              goal.
            </p>
          </>
        )}
      </div>

      {error && (
        <p role="alert" className="border-t border-edge px-4 py-3 font-sans text-row text-vermilion">
          {error}
        </p>
      )}
    </section>
  );
}
