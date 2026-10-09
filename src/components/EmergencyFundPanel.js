import AccountPicker from "./AccountPicker";
import SourceChoice from "./SourceChoice";
import {
  MAX_MONTHS_COVERED,
  TARGET_SOURCES,
} from "../contexts/EmergencyFundContext";
import { amountAtRest, formatCents, fromBps } from "../utils";

/**
 * How long the household could carry itself with no income, and how much of that
 * buffer is actually there.
 *
 * **It sits on the plan page because the target is part of the plan.** The figure
 * is a multiple of the categories this page files as essentials, so it moves when
 * the rent moves — which is the whole argument for deriving it rather than asking
 * for a number. It is full width, below both columns, because it joins them: the
 * target comes out of the left-hand column's estimates and the balance out of the
 * right-hand column's accounts, and a panel belonging to both belongs under both.
 * `BalanceHistoryPanel`'s placement, and its reasoning.
 *
 * **Open rather than a `<details>`**, unlike the three panels below it. Those are
 * opened to set something up or tidy it; this carries a figure meant to be read
 * in passing, and a buffer nobody is reminded of is the one most likely to be
 * quietly spent.
 *
 * Two readings of the same money, deliberately, because households ask the
 * question both ways: the share of the target that is funded, and the number of
 * months it would actually cover. The second survives a target of zero, which is
 * the ordinary state of a plan nobody has written estimates into yet.
 *
 * Commit on **blur** for both figures, the contract every panel outside a modal
 * keeps — a half-typed "1" on the way to "12" is a valid figure — and each input
 * is keyed on the stored value so a rejected edit, or one made on another device,
 * re-seeds it.
 */

const TICKS = 24;

/**
 * Funded, not spent — so **full is good** and the tone runs the other way from
 * `TallyGauge`'s.
 *
 * Local for the reason `GoalMeter` and `FundedMeter` are local: one component
 * reading both ways would be a trap for whichever caller came next, and this is
 * a third place that needs the reversed reading rather than a reason to make the
 * shared one configurable. The thresholds are this question's own — three months
 * is the figure most advice starts at, so half of a six-month target is the point
 * where a buffer stops being token.
 */
function BufferMeter({ ratio, label }) {
  const filled = Math.max(0, Math.min(TICKS, Math.round(ratio * TICKS)));
  const tone = ratio >= 1 ? "bg-verdant" : ratio >= 0.5 ? "bg-sulfur" : "bg-vermilion";

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

const labelClass = "mb-1.5 block font-mono text-label uppercase text-chalk-soft";

const inputClass =
  "w-full border-0 border-b-2 border-edge bg-transparent px-0 py-1.5 font-mono text-lg text-chalk outline-none transition-colors placeholder:text-chalk-soft/60 focus:border-azure";

// Named apart from the retirement page's two pairs — "a figure I enter" three
// times over would be three radios with one accessible name between them. This
// one says what the figure *is*.
const TARGET_OPTIONS = [
  { value: TARGET_SOURCES.MONTHS, label: "Months of my essentials" },
  { value: TARGET_SOURCES.AMOUNT, label: "A target I enter" },
];

/**
 * One figure in the band, written the way `PlanHealthSummary` writes its three a
 * few sections up the same page: mono, `text-figure`, in a hairline grid. The
 * two bands are read against each other — the plan's monthly shape and the
 * buffer that covers it — so they are set in the same type.
 */
function Figure({ label, cents, tone = "text-chalk", note }) {
  return (
    <div className="bg-panel px-4 py-3">
      <dt className="font-mono text-label uppercase text-chalk-soft">{label}</dt>
      <dd className={`mt-1 font-mono text-figure font-medium ${tone}`}>{formatCents(cents)}</dd>
      {note && <dd className="mt-0.5 font-mono text-label uppercase text-chalk-soft">{note}</dd>}
    </div>
  );
}

export default function EmergencyFundPanel({
  fund,
  error,
  onChange,
  onToggleAccount,
  onAccountAmountChange,
}) {
  const byMonths = fund.fund.targetSource === TARGET_SOURCES.MONTHS;
  const funded = fund.fundedBps == null ? null : fromBps(fund.fundedBps);
  const monthsHeld = fund.monthsHeldBps == null ? null : fromBps(fund.monthsHeldBps);
  const met = fund.targetCents > 0 && fund.remainingCents === 0;

  return (
    <section className="border border-edge bg-panel" aria-labelledby="emergency-fund-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-edge px-4 py-3">
        <h2
          id="emergency-fund-heading"
          className="font-sans text-base font-semibold tracking-tight text-chalk"
        >
          Emergency fund
        </h2>
        <span className="font-mono text-label uppercase text-chalk-soft">
          {/* A month count rather than a percentage, because that is the sentence
              the fund exists to answer — and it is readable even before anybody
              has set a target. "0.0 months covered" is not that sentence though:
              it reads as a measurement where nothing has been measured, so a
              fund with no money pointed at it yet says so instead. */}
          {monthsHeld == null
            ? "No essentials estimated yet"
            : fund.heldCents === 0
              ? "Nothing set aside yet"
              : `${monthsHeld.toFixed(1)} months of essentials covered`}
        </span>
      </div>

      <dl className="grid gap-px border-b border-edge bg-edge sm:grid-cols-3">
        <Figure
          label="Set aside"
          cents={fund.heldCents}
          tone="text-verdant"
          note={fund.accountRows.some((row) => row.included) ? null : "No accounts ticked yet"}
        />
        <Figure
          label="Target"
          cents={fund.targetCents}
          // Choosing to type a figure and typing none is a target of zero rather
          // than a quiet fall back to the derivation — see `useEmergencyFund` —
          // so the cell says which kind of zero it is.
          note={!byMonths && fund.typedTargetCents == null ? "Not stated yet" : null}
        />
        <Figure
          label="Still to save"
          // The app's one definition of trouble is `available < 0` and this is
          // not it: a fund part-way there is the ordinary state of a fund. So
          // the figure is stated plainly and only the meter carries a verdict.
          cents={fund.remainingCents}
          // Green only against a target that exists: nothing left to save under a
          // target of nothing is a plan nobody has written, not a goal met.
          tone={met ? "text-verdant" : "text-chalk"}
          note={met ? "Fully funded" : null}
        />
      </dl>

      {funded != null && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-edge px-4 py-3">
          <BufferMeter
            ratio={funded}
            label={`${formatCents(fund.heldCents)} set aside of a ${formatCents(
              fund.targetCents
            )} target`}
          />
          <span className="font-mono text-label uppercase text-chalk-soft">
            {Math.round(funded * 100)}% funded
          </span>
        </div>
      )}

      <div className="border-b border-edge px-4 py-3">
        <SourceChoice
          name="emergency-fund-target-source"
          legend="Where the emergency fund target comes from"
          value={fund.fund.targetSource}
          options={TARGET_OPTIONS}
          onChange={(targetSource) => onChange({ targetSource })}
        />
      </div>

      {byMonths ? (
        <div className="border-b border-edge px-4 py-4 sm:flex sm:items-start sm:gap-6">
          <label className="block w-32 shrink-0">
            <span className={labelClass}>Months</span>
            <input
              key={`months-${fund.fund.monthsCovered}`}
              // A whole number with nothing to punctuate, which is the one shape
              // of field this app still lets be a number input — the ages and the
              // pay-schedule day count are the others.
              type="number"
              min={1}
              max={MAX_MONTHS_COVERED}
              step={1}
              defaultValue={fund.fund.monthsCovered}
              className={inputClass}
              onBlur={(event) => onChange({ monthsCovered: event.target.value })}
            />
          </label>
          <p className="mt-3 font-sans text-row text-chalk-soft sm:mt-0">
            {fund.hasEssentials ? (
              <>
                Your essentials come to{" "}
                <span className="text-chalk">{formatCents(fund.monthlyEssentialsCents)}</span> a
                month across{" "}
                {fund.essentialsCount === 1 ? "1 category" : `${fund.essentialsCount} categories`},
                so {fund.fund.monthsCovered} months of them is{" "}
                <span className="text-chalk">{formatCents(fund.derivedTargetCents)}</span>. Change
                what a category is expected to need and this follows it.
              </>
            ) : (
              <>
                No category counting as essentials has a monthly estimate yet, so there is nothing
                to take a multiple of. Fill in the estimates above and the target appears here.
              </>
            )}
          </p>
        </div>
      ) : (
        <div className="border-b border-edge px-4 py-4 sm:flex sm:items-start sm:gap-6">
          <label className="block w-40 shrink-0">
            <span className={labelClass}>Target</span>
            <input
              key={`target-${fund.typedTargetCents ?? ""}`}
              // Text, like every money field: a number input refuses "$25,000"
              // outright and renders $25,000.50 as "25000.5".
              type="text"
              inputMode="decimal"
              placeholder="$0.00"
              defaultValue={
                fund.typedTargetCents == null ? "" : amountAtRest(fund.typedTargetCents)
              }
              className={inputClass}
              onBlur={(event) => onChange({ targetCents: event.target.value })}
            />
          </label>
          <p className="mt-3 font-sans text-row text-chalk-soft sm:mt-0">
            What you want held back, whatever the plan says.{" "}
            {fund.hasEssentials && (
              <>
                {fund.fund.monthsCovered} months of your essentials would be{" "}
                <span className="text-chalk">{formatCents(fund.derivedTargetCents)}</span>, which is
                what the other answer uses.
              </>
            )}{" "}
            Clear the field to go back to it.
          </p>
        </div>
      )}

      <AccountPicker
        rows={fund.accountRows}
        totalLabel="Held as the emergency fund"
        totalCents={fund.heldCents}
        emptyNote="an emergency fund is usually an ordinary savings account, and this needs one to read a balance off."
        onToggle={onToggleAccount}
        onPortionChange={onAccountAmountChange}
      />
      {onAccountAmountChange && fund.accountRows.some((row) => row.included) && (
        <p className="border-t border-edge px-4 py-3 font-sans text-row text-chalk-soft">
          A ticked account counts in full. If only part of it is your emergency fund — the rest
          is for something else — enter that part under Counted.
        </p>
      )}

      {/* Commits on change: a tick has nothing to half-type. */}
      <div className="border-t border-edge px-4 py-3">
        <label className="flex items-start gap-2 font-sans text-row text-chalk">
          <input
            type="checkbox"
            className="mt-1"
            checked={fund.fund.holdBack !== false}
            aria-describedby="emergency-fund-hold-note"
            onChange={(event) => onChange({ holdBack: event.target.checked })}
          />
          Hold this money back from To be assigned
        </label>
        <p id="emergency-fund-hold-note" className="mt-1 pl-6 font-sans text-row text-chalk-soft">
          {fund.fund.holdBack !== false && fund.reservedCents > 0 ? (
            <>
              <span className="text-chalk">{formatCents(fund.reservedCents)}</span> is kept out of
              the money you can assign, so it cannot be given to another category.
            </>
          ) : (
            <>
              Leave this off if you already set the fund aside through a category of its own.
            </>
          )}
        </p>
      </div>

      {error && (
        <p role="alert" className="border-t border-edge px-4 py-3 font-sans text-row text-vermilion">
          {error}
        </p>
      )}
    </section>
  );
}
