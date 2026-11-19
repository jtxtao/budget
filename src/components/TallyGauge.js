const TICKS = 24;

/**
 * A spent-against-limit meter drawn as discrete ticks rather than a continuous
 * bar, so a category reads as "19 of 24 marks used" at a glance. Colour tracks
 * how close the category is to its limit: comfortable, close, over.
 *
 * `label` names the two figures being compared, for anyone who gets the meter
 * read out to them rather than seeing it next to them.
 *
 * `overOnly` keeps red for going *past* the limit rather than reaching it —
 * for a single envelope, where spending exactly what it held is the plan
 * working and the app's one definition of trouble is `available < 0`.
 */
export default function TallyGauge({ amount, max, label, overOnly = false }) {
  const ratio = max > 0 ? amount / max : 0;
  const filled = Math.max(0, Math.min(TICKS, Math.round(ratio * TICKS)));
  const over = overOnly ? ratio > 1 : ratio >= 1;
  const tone = over ? "bg-vermilion" : ratio >= 0.8 ? "bg-sulfur" : "bg-verdant";

  return (
    <div
      className="flex gap-[3px]"
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(amount)}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      {Array.from({ length: TICKS }, (_, i) => (
        <span key={i} className={`h-3 w-[3px] ${i < filled ? tone : "bg-edge"}`} />
      ))}
    </div>
  );
}
