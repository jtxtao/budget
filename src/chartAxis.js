/**
 * The arithmetic behind a column chart over months: where the ticks land, which
 * months get a label, and the path a column is drawn as.
 *
 * Pulled out of `NetWorthChart` when the reports page grew a second column chart
 * over the same axis. Nothing here carries a design opinion — no colour, no
 * layout, no wording, no ARIA — so two charts can share it without either one
 * deciding how the other looks. What stays in a chart file is what that chart
 * *means*: its frame, its series, and how it says out loud what it is showing.
 *
 * Every figure in and out is cents, and every period is "YYYY-MM".
 */

/**
 * Round to a power of ten times one of these, so ticks land on figures people
 * actually say. 2.5 earns its place: without it a span of a million falls to a
 * step of 500,000 and the axis carries three labels, which on a chart this tall
 * leaves the reader estimating everything between them.
 */
const NICE_STEPS = [1, 2, 2.5, 5, 10];

export function niceStep(rough) {
  const magnitude = 10 ** Math.floor(Math.log10(Math.abs(rough) || 1));
  const normalised = Math.abs(rough) / magnitude;
  return (NICE_STEPS.find((step) => normalised <= step) ?? 10) * magnitude;
}

/**
 * A domain that covers the data and ends on round numbers, **always including
 * zero**.
 *
 * Zero is where what is owned separates from what is owed, and where a month
 * that spent more than it earned separates from one that did not. It is the
 * meaning of both charts that use this, so it is not something the scale may
 * crop out to gain resolution — which is why it is clamped in here rather than
 * left to each caller to remember.
 *
 * A domain with no width would map every value to the same pixel and make the
 * divide below a division by nothing, so it is given one.
 *
 * `intervals` is what is *asked* for; rounding the step up to a speakable one
 * lands the result between four and eight ticks. The step is floored at a cent,
 * because the unit here is cents and a step of two tenths of one produces six
 * ticks that all print the same three figures.
 */
export function axisTicks(low, high, { intervals = 5 } = {}) {
  let min = Math.min(0, low);
  let max = Math.max(0, high);
  if (min === max) max = min + 100;

  const step = Math.max(1, niceStep((max - min) / intervals));
  min = Math.floor(min / step) * step;
  max = Math.ceil(max / step) * step;

  const ticks = [];
  for (let value = min; value <= max + step / 2; value += step) ticks.push(Math.round(value));

  return { min, max, ticks };
}

/**
 * How many months apart the month labels are.
 *
 * Twelve columns can each carry a label; a hundred and twenty cannot, and a
 * label per column at that width is a grey smear where an axis should be. The
 * strides are the ones a calendar reads in — every month, every other, a
 * quarter, a half, a year — so the axis of a five-year window is quarters rather
 * than "every fourth month", which is a stride nobody thinks in.
 */
const LABEL_STRIDES = [1, 2, 3, 6, 12];
const MAX_LABELS = 14;

/**
 * Which columns get a label, counted **back from the most recent** so the right
 * edge is always named — that is the month the reader came for, and an axis that
 * labels the left edge instead leaves the newest figure anonymous.
 *
 * The year is carried on the first label of each year rather than under every
 * January, because at a stride of six or twelve there may be no January on the
 * axis at all.
 */
export function axisLabels(periods) {
  const stride = LABEL_STRIDES.find((step) => periods.length / step <= MAX_LABELS) ?? 12;

  const indices = [];
  for (let index = periods.length - 1; index >= 0; index -= stride) indices.push(index);
  indices.reverse();

  let lastYear = null;
  return indices.map((index) => {
    const period = periods[index];
    const year = period.slice(0, 4);
    const label = { index, period, year: year === lastYear ? null : year };
    lastYear = year;
    return label;
  });
}

/**
 * A column segment, square where it meets the baseline and rounded at the data
 * end — the end that carries the value is the end that gets the corner.
 *
 * `to` is the data end and `from` the baseline side, so the same helper draws
 * upward for money coming in and downward for money going out without a caller
 * ever working out which way the corners go. A segment too short to see comes
 * back null rather than as a sliver of ink standing for nothing.
 */
export function columnPath({ x, width, from, to, radius }) {
  const height = Math.abs(to - from);
  if (height < 0.5) return null;

  const r = Math.min(radius, width / 2, height);
  if (r <= 0) return `M${x},${from} L${x},${to} L${x + width},${to} L${x + width},${from} Z`;

  // Signed, so the arc turns the right way whichever side of the baseline this
  // segment is on.
  const inset = to < from ? r : -r;
  return [
    `M${x},${from}`,
    `L${x},${to + inset}`,
    `Q${x},${to} ${x + r},${to}`,
    `L${x + width - r},${to}`,
    `Q${x + width},${to} ${x + width},${to + inset}`,
    `L${x + width},${from}`,
    "Z",
  ].join(" ");
}

/**
 * One month's column, as a stack either side of the baseline.
 *
 * **A value is drawn on the side its own sign puts it, never on the side its
 * kind suggests.** That single rule is what lets one helper draw both charts: a
 * spending band whose cards outweigh its cash is genuinely negative working
 * capital, and a month whose refunds outweigh its spending genuinely put money
 * back — both belong above or below the line by arithmetic rather than by
 * category. It also guarantees the property both charts are read for, that the
 * stack's two extents add to the net, so the line is always inside the column.
 *
 * `values` is indexed as it is given and the order survives per side, so a
 * caller can pair the result back to its own series. Returns one entry per
 * value, `d` null where the segment is too short to draw.
 *
 * The gap is the surface showing through between stacked segments — never a
 * stroke drawn around them, which would add ink that is not data. It is taken
 * off the data end of every segment that has another one on top of it, and only
 * when the segment can spare it: insetting a segment worth $40 out of $400,000
 * by its full 2px would erase it, and a band that disappears reads as money that
 * is not there.
 */
export function stackPaths(values, { x, width, y, radius, gap = 2 }) {
  const paths = [];
  const baseline = y(0);

  for (const direction of [1, -1]) {
    const side = values
      .map((value, index) => ({ value, index }))
      .filter((entry) => Math.sign(entry.value) === direction);

    let base = baseline;
    side.forEach((entry, position) => {
      const end = base - (baseline - y(entry.value));
      const inset = position > 0 && Math.abs(base - end) > gap * 2 ? gap * direction : 0;

      paths.push({
        index: entry.index,
        d: columnPath({
          x,
          width,
          from: base - inset,
          to: end,
          // Only the outermost segment carries the corner: the end that holds
          // the value is the end that gets rounded.
          radius: position === side.length - 1 ? radius : 0,
        }),
      });
      base = end;
    });
  }

  return paths;
}

/**
 * How wide a column is, and how much of its slot is air.
 *
 * Capped rather than filling the slot, so the leftover is air. The cap is in
 * viewBox units and the charts are drawn scaled up — at the width these cards
 * get on a desktop, 16 here is about 24 real pixels, which is the actual
 * ceiling. Setting it to 24 makes columns that read as heavy blocks rather than
 * as marks.
 *
 * A short window is read column by column, and the air between them is what
 * makes each one a month. A long one is read as a *shape*, and the same
 * proportion of air at a slot a few units wide turns the plot into a barcode — a
 * hundred and twenty hairline gaps the eye reads as vertical stripes across the
 * money. So past three years the columns close up to a seam and the bands read
 * as the areas they are.
 */
const MAX_BAR = 16;
const CROWDED = 36;

export function barWidthFor(slot, count, { max = MAX_BAR, fill = 0.72 } = {}) {
  return Math.min(max, slot * (count > CROWDED ? 0.94 : fill));
}

/** A rounded corner needs a bar wide enough to put one on. Below about five
 *  units the arc eats the whole segment and the column reads as a smudge. */
export function radiusFor(barWidth) {
  if (barWidth >= 10) return 4;
  return barWidth >= 5 ? 2 : 0;
}

/**
 * A trailing moving average over a run of monthly figures — the trend under the
 * noise, which is the one question a column chart genuinely cannot answer.
 *
 * **Trailing rather than centred**, because the right-hand end of these charts
 * is always the month the reader came for. A centred average has no value for
 * the last `window / 2` months, so the newest column — the one being read — is
 * exactly the one the trend abandons. Trailing lags by half a window instead,
 * which is the honest cost and is visible as the line sitting behind a turn.
 *
 * **The first months come back `null` rather than as an average of whatever is
 * there so far.** A "three-month average" computed from one month is that
 * month, drawn as though it were a trend, and the line would open by tracing
 * the data exactly before peeling away from it — which reads as the trend
 * changing when all that changed is how many months went into it. Null is a
 * gap, and the caller draws the line from where it becomes true.
 *
 * Returns an array the same length as `values`, so a caller can index it
 * against its own months without tracking an offset.
 */
export function movingAverage(values, window = 3) {
  if (!(window >= 1)) return values.map(() => null);

  let sum = 0;
  return values.map((value, index) => {
    sum += value;
    if (index >= window) sum -= values[index - window];
    return index < window - 1 ? null : Math.round(sum / window);
  });
}

/**
 * The polyline points for a series that may have gaps in it, as one or more
 * runs of consecutive real values.
 *
 * A `null` is a month the series has no value for, and the two reasons it
 * happens are different: a moving average has no value until its window fills,
 * and a series can simply stop. Either way the line must **break** rather than
 * span the gap — a straight segment drawn across missing months asserts a
 * reading nobody took, which is the same lie `useNetWorth` refuses when it will
 * not propagate a snapshot backwards.
 *
 * A run of one point gets no line of its own, because a polyline of a single
 * point draws nothing; callers that want those visible draw a marker.
 */
export function lineRuns(values, { x, y }) {
  const runs = [];
  let run = [];

  values.forEach((value, index) => {
    if (value == null) {
      if (run.length > 1) runs.push(run);
      run = [];
      return;
    }
    run.push(`${x(index)},${y(value)}`);
  });
  if (run.length > 1) runs.push(run);

  return runs.map((points) => points.join(" "));
}
