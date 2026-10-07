import { formatCents } from "../utils";

/**
 * The answer the page exists to give: what has to be there on the day work
 * stops, what is on course to be there, and the distance between them.
 *
 * A hero figure and a gap rather than a table, because the question is a yes or
 * a no before it is a number. Everything below on the page — the chart, the
 * accounts, the assumptions — is the working; this is the result, and it says
 * out loud that it is in today's dollars, because a figure thirty years out that
 * did not say so would be read as one that had been adjusted.
 *
 * The meter is a mirror of `TallyGauge` and deliberately not a call to it: there
 * a full bar means a category is spent out, and here it means the plan is
 * funded. Same ticks, opposite tone, and one component reading both ways would
 * be a trap for whichever caller came next.
 */

const TICKS = 24;

/** Green at or over the target, amber approaching it, red short of it — the
 *  opposite direction to every other meter in the app, which is why it lives
 *  here rather than in the shared one. */
function FundedMeter({ ratio, label }) {
  const filled = Math.max(0, Math.min(TICKS, Math.round(ratio * TICKS)));
  const tone = ratio >= 1 ? "bg-verdant" : ratio >= 0.8 ? "bg-sulfur" : "bg-vermilion";

  return (
    <div
      className="flex gap-[3px]"
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(Math.min(ratio, 1) * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      {Array.from({ length: TICKS }, (_, index) => (
        <span key={index} className={`h-3 w-[3px] ${index < filled ? tone : "bg-edge"}`} />
      ))}
    </div>
  );
}

function Band({ label, children, tone = "text-chalk" }) {
  return (
    <div className="bg-panel px-4 py-3">
      <dt className="font-mono text-label uppercase text-chalk-soft">{label}</dt>
      <dd className={`mt-1 font-mono text-lg font-medium ${tone}`}>{children}</dd>
    </div>
  );
}

/**
 * What to do about the gap, in one sentence.
 *
 * Always an instruction rather than a verdict — "short by $400,000" is a fact
 * the figures above already state, and the useful half is the yearly figure that
 * closes it. A plan already past its target says so and names the surplus, which
 * is the same sentence read the other way.
 */
function Guidance({ projection, inputs }) {
  const { gapCents, requiredContributionCents, depletionAge, surplusCents } = projection;

  if (requiredContributionCents == null) {
    return gapCents >= 0 ? (
      <>
        Retiring now, with <span className="text-verdant">{formatCents(gapCents)}</span> more than
        this plan needs.
      </>
    ) : (
      <>
        Retiring now leaves this plan{" "}
        <span className="text-vermilion">{formatCents(-gapCents)}</span> short — the money runs out
        at {depletionAge}.
      </>
    );
  }

  if (gapCents >= 0) {
    return (
      <>
        On course, with <span className="text-verdant">{formatCents(surplusCents)}</span> still in
        hand at the end. Putting away{" "}
        <span className="text-chalk">{formatCents(requiredContributionCents)}</span> a year would be
        enough to reach the target exactly.
      </>
    );
  }

  // The shortfall itself is already stated above, in the figure this sentence
  // sits beside. Repeating it here would spend the one line of guidance on a
  // number the reader has just read; what is missing is what to do about it.
  return (
    <>
      Putting away <span className="text-chalk">{formatCents(requiredContributionCents)}</span> a
      year instead of {formatCents(inputs.annualContributionCents)} would close the gap
      {depletionAge == null ? "" : `, which otherwise empties at ${depletionAge}`}.
    </>
  );
}

export default function RetirementOutlook({ projection, inputs, retirementAge }) {
  if (!projection.ready) {
    return (
      <section aria-label="Retirement outlook" className="border border-edge bg-panel">
        <div className="border-b border-edge px-4 py-3">
          <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">Outlook</h2>
        </div>
        <div className="px-4 py-5">
          <p className="font-sans text-row text-chalk-soft">
            A few figures short of a projection:
          </p>
          <ul className="mt-3 space-y-2">
            {projection.issues.map((issue) => (
              <li key={issue} className="flex gap-3 font-sans text-row text-chalk">
                <span className="mt-2 h-px w-2.5 shrink-0 bg-sulfur" aria-hidden="true" />
                <span>{issue}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    );
  }

  const { needCents, projectedCents, gapCents, fundedRatio, depletionAge, fundedThroughAge } =
    projection;
  const short = gapCents < 0;

  return (
    <section aria-label="Retirement outlook" className="border border-edge bg-panel">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-edge px-4 py-4">
        <div>
          <div className="font-mono text-label uppercase text-chalk-soft">
            At {retirementAge} · today&rsquo;s dollars
          </div>
          {/* The page's one hero figure: what the plan is on course to be worth
              on the day it is needed. Proportional digits, as elsewhere — a
              standalone figure with tabular numerals reads loose. */}
          <div
            className={`mt-1 font-sans text-5xl font-semibold tracking-tight ${
              short ? "text-vermilion" : "text-chalk"
            }`}
          >
            {formatCents(projectedCents)}
          </div>
          <div className="mt-1 font-sans text-row text-chalk-soft">
            on course to have saved — cash and investments, not the house
          </div>
        </div>

        <dl className="flex flex-wrap gap-x-8 gap-y-2">
          <div>
            <dt className="font-mono text-label uppercase text-chalk-soft">You will need</dt>
            <dd className="mt-0.5 font-mono text-lg font-medium text-chalk">
              {formatCents(needCents)}
            </dd>
          </div>
          <div>
            <dt className="font-mono text-label uppercase text-chalk-soft">
              {short ? "Short by" : "Spare"}
            </dt>
            <dd
              className={`mt-0.5 font-mono text-lg font-medium ${
                short ? "text-vermilion" : "text-verdant"
              }`}
            >
              {formatCents(Math.abs(gapCents))}
            </dd>
          </div>
        </dl>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-edge px-4 py-3">
        <FundedMeter
          ratio={fundedRatio}
          label={`${Math.round(Math.min(fundedRatio, 1) * 100)} percent of the target funded`}
        />
        <p className="flex-1 font-sans text-row text-chalk-soft">
          <Guidance projection={projection} inputs={inputs} />
        </p>
      </div>

      {/* Hairline dividers drawn by the grid gap showing the edge colour
          through, as on the net-worth summary, so they stay 1px on every
          display. */}
      <dl className="grid gap-px bg-edge sm:grid-cols-2 xl:grid-cols-4">
        <Band label="Yearly spending">{formatCents(inputs.annualSpendingCents)}</Band>
        <Band label="Saving each year">{formatCents(inputs.annualContributionCents)}</Band>
        {/* Everything spendable today — cash and every investment — since that
            is what the hero figure above grows from, not the ticked accounts
            alone. */}
        <Band label="Saved today">{formatCents(projection.startingCents ?? inputs.startingCents)}</Band>
        <Band
          label="Money lasts to"
          tone={depletionAge == null ? "text-chalk" : "text-vermilion"}
        >
          {depletionAge == null ? `age ${fundedThroughAge}` : `age ${depletionAge}`}
        </Band>
      </dl>
    </section>
  );
}
