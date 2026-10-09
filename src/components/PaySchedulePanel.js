import { Fragment } from "react";
import {
  LAST_DAY,
  DEFAULT_PERIOD_DAYS,
  PAY_CADENCES,
  PAY_CADENCE_KEYS,
  defaultPayDay,
  payCadence,
} from "../paySchedule";
import { formatDateMedium, formatDayDelta } from "../utils";

/**
 * When the paycheques land: how often, and whatever that cadence needs to place
 * the next one on a calendar.
 *
 * The one dated thing on a page that is otherwise deliberately undated. The
 * estimates and income sources above describe a typical month and hold in
 * January as in August; this describes a real calendar, and it is here rather
 * than on the dashboard because it is a standing fact the user states once —
 * every other figure on that page is derived from the books.
 *
 * **The cadence comes first and decides what else is asked**, because the two
 * families of schedule need different facts and neither's fields mean anything
 * under the other. An interval cadence needs one real payday to step from; a
 * twice-monthly one needs the days of the month and no date at all — asking for
 * a last paycheck there would be a field that changes no answer. Nothing is
 * asked until the cadence is picked, and the fields a cadence does not use keep
 * what was typed into them, so switching back restores the schedule rather than
 * asking for it again.
 *
 * Committed on blur rather than per keystroke, as the category estimates are: a
 * half-typed "1" on the way to "14" is a valid pay period, and writing it would
 * put a countdown to tomorrow on the dashboard for as long as it took to finish
 * typing. The cadence select is the exception and commits on change — there is
 * nothing to type, so there is no half-typed state to protect. Each field
 * commits on its own: part of a schedule is a real intermediate state, and the
 * store keeps it rather than refusing the field just filled in.
 *
 * Each input is keyed on the stored value, so a schedule that changes underneath
 * the panel — committed in another tab, or cleared — re-seeds the field instead
 * of leaving a stale figure in it. A value the store *rejects* changes nothing,
 * and so stays on screen to be corrected, with the message beside it saying why
 * it was not taken.
 */

const labelClass = "mb-1.5 block font-mono text-label uppercase text-chalk-soft";

// No `w-full` here: it has to be layered on by each caller instead of baked
// in, because Tailwind resolves same-specificity width utilities by their
// order in the compiled stylesheet, not by order in the className string —
// baking `w-full` into this shared class let it silently beat the day
// fields' own `w-16` and stretch each one across the whole row.
//
// Split so the select can be opaque without relying on which of two background
// utilities Tailwind happens to emit last.
const fieldClass =
  "border-0 border-b-2 border-edge px-0 py-1.5 font-mono text-lg text-chalk outline-none transition-colors placeholder:text-chalk-soft/60 focus:border-azure";

const inputClass = `${fieldClass} w-full bg-transparent`;

const selectClass = `${fieldClass} w-full bg-panel`;

const noteClass = "mt-1.5 font-sans text-row text-chalk-soft";

/** The stored days with the edited one replaced, padded so the second field can
 *  be filled in before the first. The store reads a blank as "not yet". */
function withDayAt(days, index, value) {
  const next = [...days];
  while (next.length <= index) next.push(null);
  next[index] = value === "" ? null : Number(value);
  return next;
}

// The fields are numbered rather than named — "the 15th" is what goes *in* one,
// so it cannot also be what one is called.
const DAY_FIELD_LABELS = ["First payday", "Second payday"];

const DAY_NOTE_ID = "pay-days-note";

export default function PaySchedulePanel({ schedule, paycheck, error, onChange }) {
  const cadence = payCadence(schedule.cadence);
  const days = schedule.daysOfMonth ?? [];

  return (
    <section className="border border-edge bg-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-edge px-4 py-3">
        <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">
          Pay schedule
        </h2>
        <span className="font-mono text-label uppercase text-chalk-soft">
          Counts down on the dashboard
        </span>
      </div>

      <div className="grid items-start gap-x-5 gap-y-4 px-4 py-4 sm:grid-cols-2">
        <label>
          <span className={labelClass}>How often</span>
          {/* Opaque where the inputs beside it are transparent, for the reason
              `SelectField` gives: a transparent select paints its option list
              against whatever is behind it, which on this palette is chalk text
              on nothing. */}
          <select
            value={schedule.cadence ?? ""}
            className={selectClass}
            onChange={(event) => onChange({ cadence: event.target.value || null })}
          >
            <option value="">Choose one…</option>
            {PAY_CADENCE_KEYS.map((key) => (
              <option key={key} value={key}>
                {PAY_CADENCES[key].label}
              </option>
            ))}
          </select>
        </label>

        {cadence?.kind === "interval" && (
          <label>
            <span className={labelClass}>Last paycheck</span>
            <input
              key={`last-${schedule.lastPaidOn ?? ""}`}
              type="date"
              defaultValue={schedule.lastPaidOn ?? ""}
              className={inputClass}
              onBlur={(event) => onChange({ lastPaidOn: event.target.value || null })}
            />
          </label>
        )}

        {schedule.cadence === "custom" && (
          <label>
            <span className={labelClass}>Pay period (days)</span>
            <input
              key={`days-${schedule.periodDays ?? ""}`}
              type="number"
              min={1}
              step={1}
              placeholder={String(DEFAULT_PERIOD_DAYS)}
              defaultValue={schedule.periodDays ?? ""}
              className={inputClass}
              onBlur={(event) => onChange({ periodDays: event.target.value })}
            />
          </label>
        )}

        {cadence?.kind === "monthdays" && (
          <fieldset className="min-w-0">
            <legend className={labelClass}>Paid on</legend>
            <div className="flex items-baseline gap-3">
              {Array.from({ length: cadence.count }, (_, index) => (
                <Fragment key={index}>
                  {index > 0 && <span className="font-sans text-row text-chalk-soft">and</span>}
                  <input
                    key={`day-${index}-${days[index] ?? ""}`}
                    type="number"
                    min={1}
                    max={LAST_DAY}
                    step={1}
                    placeholder={String(defaultPayDay(schedule.cadence, index))}
                    aria-label={DAY_FIELD_LABELS[index]}
                    aria-describedby={DAY_NOTE_ID}
                    defaultValue={days[index] ?? ""}
                    // Wide enough for two digits with the browser's own spinner
                    // beside them, and no wider: the pair reads as one answer.
                    // Built off `fieldClass`, not `inputClass` — the latter's
                    // own `w-full` would still win over `w-16` by stylesheet
                    // order.
                    className={`${fieldClass} w-16 flex-none bg-transparent text-center`}
                    onBlur={(event) =>
                      onChange({ daysOfMonth: withDayAt(days, index, event.target.value) })
                    }
                  />
                </Fragment>
              ))}
            </div>
            {/* Outside any label and tied to the fields by id, so the sentence is
                guidance the field points at rather than part of its own name. */}
            <p id={DAY_NOTE_ID} className={noteClass}>
              {LAST_DAY} means the last day of the month. A payday landing on a weekend is paid
              the Friday before.
            </p>
          </fieldset>
        )}
      </div>

      {error && (
        <p role="alert" className="border-t border-edge px-4 py-3 font-sans text-row text-vermilion">
          {error}
        </p>
      )}

      {/* A status region rather than an alert: it is on screen from the moment
          the page loads, and it changes as a consequence of the user's own edit
          rather than announcing anything they did not just do. */}
      <div role="status" className="border-t border-edge px-4 py-3">
        {paycheck.configured ? (
          <p className="font-sans text-row text-chalk-soft">
            Paid {paycheck.summary}. Next paycheck{" "}
            <span className="font-medium text-chalk">{formatDateMedium(paycheck.nextDate)}</span> —{" "}
            <span className="text-azure">{formatDayDelta(paycheck.daysUntil).toLowerCase()}</span>.
          </p>
        ) : (
          <p className="font-sans text-row text-chalk-soft">
            {cadence
              ? "Fill in the rest to count down to your next paycheck on the dashboard."
              : "Say how often you are paid to count down to your next paycheck on the dashboard."}
          </p>
        )}
      </div>
    </section>
  );
}
