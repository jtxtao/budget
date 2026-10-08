import { PLAN_BUCKETS } from "../contexts/BudgetsContext";
import { bucketTone } from "../bucketTones";
import { formatCents } from "../utils";

/**
 * Does the plan balance, and what does it balance into?
 *
 *   unplanned = expected income per month − Σ category estimates per month
 *
 * Three figures, then the split. The third figure carries the verdict in its own
 * label — "Over-allocated", "Left to plan", "Fully allocated" — which is the
 * point of the page: a plan that allocates more than it expects to take in is
 * not a plan, and the user has to see that before they leave the screen rather
 * than discover it in three weeks when the envelopes run dry. The split answers
 * the question that survives a balanced plan — four fifths on fun balances
 * exactly as neatly as a fifth put by.
 *
 * **Prose below the figures only where the figures cannot speak for themselves.**
 * A caption restating what a tile already shows — how many sources went into an
 * average, what share of income is allocated, the shortfall a second time in a
 * sentence — is the same fact charged twice to the reader's attention, and it
 * pushes the split below the fold. What survives is the two things a number
 * cannot say: what to do about an over-allocated plan, and why there is no
 * verdict at all when nothing is expected to come in.
 *
 * Both sides are monthly averages that hold until the user changes them, so
 * there is no month on this panel and no figure from the books on it either.
 * Whether the money that actually arrived has been given a job is "to be
 * assigned" on the Transactions page; answering both questions in one place
 * would blur which of them is being answered.
 *
 * **`pretaxMonthlyCents` is added to both "Expected income" and "Planned
 * expenses" equally** — see `usePlanHealth` — so a 401(k) deduction moves the
 * retirement bucket's share of the split without moving "left to plan" at all.
 * The two captions this earns (here, and on the retirement tile below) are an
 * exception to "prose only where the figure cannot speak for itself": a reader
 * comparing this "Expected income" against a payslip has no other way to learn
 * why the two disagree, so both stay suppressed at zero and appear only when
 * they are true.
 *
 * **The pretax figure is typed here, not just read here.** It has no category
 * to be derived from — a 401(k) deduction never reaches an on-budget account
 * — so before this field existed the only door to it was the Retirement
 * page, and a plan built from this page alone had no way to state it. The
 * field writes the same `RetirementContext` record `RetirementAssumptionsPanel`
 * does: one figure, two doors, never two figures that could disagree. It sits
 * outside the "Where it goes" split below, which is hidden while nothing is
 * planned yet — typing a pretax figure is itself how a plan with nothing
 * planned becomes one with something planned.
 */

// One colour per bucket, carried by the meter, the key's swatch and the figure
// alike so the three read as one statement. Taken from the accents' existing
// jobs on dark chrome rather than invented: money that has to go out is a plain
// figure, money spent on wants is the caution colour, money kept is the same
// green as income.
//
// The map itself is `src/bucketTones.js`, because this is one of three screens
// that draw the same four shares — the other two read the books rather than the
// estimates — and the comparison between them is only worth anything while all
// three agree about which colour is which.

/** Cents as the dollars the field asks for, and blank for a figure nobody has
 *  stated — matching `RetirementAssumptionsPanel`'s own `asDollars`, since the
 *  two fields seed from and write to the same stored value. */
const asDollars = (cents) => (cents == null ? "" : cents / 100);

export default function PlanHealthSummary({
  expectedIncomeCents,
  plannedCents,
  unplannedCents,
  bucketRows,
  splitCents = plannedCents,
  sourceCount,
  pretaxMonthlyCents = 0,
  pretaxContributionCents = null,
  pretaxError = null,
  onPretaxChange,
}) {
  // With nothing expected to come in there is no verdict to give: every plan
  // would read as over-allocated, which says more about the empty income side
  // than about the plan.
  const unknown = sourceCount === 0;

  const tone = unknown
    ? { text: "text-chalk-soft", border: "border-edge", label: "Not known yet" }
    : unplannedCents < 0
    ? { text: "text-vermilion", border: "border-vermilion/60", label: "Over-allocated" }
    : unplannedCents > 0
    ? { text: "text-sulfur", border: "border-edge", label: "Left to plan" }
    : { text: "text-verdant", border: "border-verdant/50", label: "Fully allocated" };

  // Only where there is something to say that the tile above has not already
  // said. "Left to plan" with a figure beside it *is* the statement that some
  // expected income is not in a category yet; repeating it in a sentence below
  // is the same fact twice. The two cases that survive both add something the
  // figures cannot: what to do about an over-allocated plan, and why the panel
  // is refusing to give a verdict at all.
  const verdict = unknown
    ? "Nothing is expected to come in yet. Add an income source below, and the plan can tell you whether it balances."
    : unplannedCents < 0
    ? `This plan allocates ${formatCents(-unplannedCents)} more than it expects to take in. Trim an estimate, or add the income you are expecting.`
    : null;

  return (
    <section className={`mb-4 border ${tone.border} bg-panel`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-edge px-4 py-3">
        <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">Plan health</h2>
        <span className="font-mono text-label uppercase text-chalk-soft">Per month</span>
      </div>

      {/* Hairline dividers drawn by the grid gap showing the edge colour through
          between the tiles, so they stay 1px on every display. */}
      <dl className="grid gap-px bg-edge sm:grid-cols-3">
        <div className="bg-panel px-4 py-3">
          <dt className="font-mono text-label uppercase text-chalk-soft">Expected income</dt>
          <dd className="mt-1 font-mono text-figure font-medium text-verdant">
            {formatCents(expectedIncomeCents)}
          </dd>
          {/* Only where pretax makes this figure bigger than a payslip would
              show — otherwise it is exactly what the income sources below add
              up to, and a caption saying so twice is the fact charged twice. */}
          {pretaxMonthlyCents > 0 && (
            <dd className="mt-0.5 font-mono text-label uppercase text-chalk-soft">
              {formatCents(expectedIncomeCents - pretaxMonthlyCents)} take-home +{" "}
              {formatCents(pretaxMonthlyCents)} pretax
            </dd>
          )}
        </div>

        <div className="bg-panel px-4 py-3">
          <dt className="font-mono text-label uppercase text-chalk-soft">Planned expenses</dt>
          <dd className="mt-1 font-mono text-figure font-medium text-chalk">
            {formatCents(plannedCents)}
          </dd>
          {pretaxMonthlyCents > 0 && (
            <dd className="mt-0.5 font-mono text-label uppercase text-chalk-soft">
              Includes {formatCents(pretaxMonthlyCents)} pretax retirement
            </dd>
          )}
        </div>

        <div className="bg-panel px-4 py-3">
          <dt className="font-mono text-label uppercase text-chalk-soft">{tone.label}</dt>
          <dd className={`mt-1 font-mono text-figure font-medium ${tone.text}`}>
            {unknown ? "—" : formatCents(unplannedCents)}
          </dd>
        </div>
      </dl>

      {/* Unconditional, unlike the split below: this is the one field on the
          page that writes rather than reads, and it has to be reachable
          before there is anything else planned — typing a figure here is
          itself what turns "nothing planned yet" into a plan with something
          in it. */}
      <div className="border-t border-edge px-4 py-3">
        <label className="block sm:w-72">
          <span className="font-mono text-label uppercase text-chalk-soft">
            Pretax retirement contributions
          </span>
          <input
            key={`pretax-${pretaxContributionCents ?? ""}`}
            defaultValue={asDollars(pretaxContributionCents)}
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            aria-describedby="pretax-contribution-note"
            className="mt-1.5 w-full border-0 border-b-2 border-edge bg-transparent px-0 py-1.5 font-mono text-lg text-chalk outline-none transition-colors placeholder:text-chalk-soft/60 focus:border-azure"
            onBlur={(event) => onPretaxChange(event.target.value)}
          />
        </label>
        <p id="pretax-contribution-note" className="mt-1.5 font-sans text-row text-chalk-soft">
          A year's worth — a 401(k) or other payroll deduction that never reaches an on-budget
          account, so there is no category here to read it off. Also set on the Retirement page,
          where it feeds the projection; the two are the same figure.
        </p>
        {pretaxError && (
          <p role="alert" className="mt-1.5 font-sans text-row text-vermilion">
            {pretaxError}
          </p>
        )}
      </div>

      {/* A status region rather than an alert: this is on screen from the moment
          the page loads, and an assertive announcement on every keystroke into
          an estimate would talk over the user. Dropped entirely when there is
          nothing to say, so a healthy plan does not carry an empty band under
          its figures. */}
      {verdict && (
        <div role="status" className="border-t border-edge px-4 py-3">
          <p className={`font-sans text-row ${unknown ? "text-chalk-soft" : tone.text}`}>
            {verdict}
          </p>
        </div>
      )}

      {/* Suppressed with nothing to split rather than drawn as thirds of
          nothing: a split of zero is not a fact about the plan. What is left
          to plan counts as savings here (see `usePlanHealth`), so income with
          nothing planned against it yet is already a split of all savings. */}
      {splitCents > 0 && (
        <>
          <div className="border-t border-edge px-4 py-3">
            <h3 className="font-mono text-label uppercase text-chalk">Where it goes</h3>
          </div>

          {/* The same tiles as the figures above, so the eye reads the split as
              a second cut of the same panel rather than a chart bolted to it.
              The percentage leads, because the question the split answers is a
              question about proportion — the dollars are what it is a
              proportion of, and they are already stated above. The swatch is
              what is left of the meter: it keeps each bucket's colour attached
              to its name, and it is never the only channel. Four columns, not
              the three the figures above are fixed at — this row's count is
              `PLAN_BUCKET_ORDER`'s, and hard-coding it here again is exactly
              what let a bucket added there quietly outgrow its own row. */}
          <dl className="grid gap-px border-t border-edge bg-edge sm:grid-cols-2 lg:grid-cols-4">
            {bucketRows.map((row) => (
              <div key={row.bucket} className="bg-panel px-4 py-3">
                <dt className="flex items-center gap-2 font-mono text-label uppercase text-chalk-soft">
                  <span
                    aria-hidden="true"
                    className={`h-2 w-2 shrink-0 ${bucketTone(row.bucket).swatch}`}
                  />
                  {row.label}
                </dt>
                <dd
                  className={`mt-1 font-mono text-figure font-medium tabular-nums ${
                    bucketTone(row.bucket).text
                  }`}
                >
                  {row.percent}%
                </dd>
                <dd className="mt-0.5 font-mono text-label uppercase text-chalk-soft">
                  {formatCents(row.plannedCents)} ·{" "}
                  {row.categoryCount === 1 ? "1 category" : `${row.categoryCount} categories`}
                  {/* The one bucket whose total does not equal its categories'
                      own figures — pretax has no category to be counted
                      through, so the gap needs saying or the row looks
                      miscounted. */}
                  {row.bucket === PLAN_BUCKETS.RETIREMENT && pretaxMonthlyCents > 0 && (
                    <> + {formatCents(pretaxMonthlyCents)} pretax</>
                  )}
                  {/* Savings carries what is left to plan by default, so the
                      row would look miscounted against its categories without
                      saying so. */}
                  {row.leftToPlanCents > 0 && (
                    <> + {formatCents(row.leftToPlanCents)} left to plan</>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </section>
  );
}
