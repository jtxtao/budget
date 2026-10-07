import { PLAN_BUCKETS } from "./contexts/BudgetsContext";

/**
 * What colour each of the plan's four buckets wears, and the one every screen
 * that draws the split reads.
 *
 * It is a module rather than a constant in whichever component needed it first
 * because the split is now drawn in three places — the meter on Configuration,
 * the meter under the report's headline figures, and the stacked columns of the
 * plan-against-books chart — and the whole value of those three being the same
 * four shares is that a reader carries the colours between them. Two copies of
 * this map would eventually disagree, and the disagreement would be invisible
 * in review: each screen would look right on its own.
 *
 * **The four hues are not chosen here and must not be changed here.** They are
 * `azure`, `sulfur`, `verdant` and `invested`, validated all-pairs by CIEDE2000
 * under normal vision and under simulated protan and deutan, in both modes, by
 * the same measurement that chose the net-worth series — which is why light-mode
 * `azure` is a teal rather than a blue. Changing one means re-running that check
 * on all four. See `tailwind.config.js`.
 *
 * **Each entry holds whole class names, never a token to be interpolated.**
 * Tailwind's scanner reads source text for complete class strings, so a
 * `` `fill-${colour}` `` would compile locally against a stylesheet built from
 * some *other* file's literal and then vanish the day that file changed. The
 * repetition is the price of the class ever existing.
 *
 * Three forms, because the split is drawn three ways. `swatch` is the legend
 * square and the meter segment, `fill` is the same hue as an SVG fill, and
 * `text` is a figure wearing its bucket's colour. A caller needing a fourth
 * adds it here rather than writing the colour out at the call site.
 *
 * **`text` is only ever safe on `text-figure`.** These accents are tuned as
 * marks rather than as type: `azure` reaches 4.1:1 on `panel`, which clears AA
 * at that size and nowhere below it, and is why secondary text on this palette
 * is `chalk-soft` instead. Colour is never the only channel either way — every
 * swatch has its name beside it.
 */
const TONES = {
  [PLAN_BUCKETS.ESSENTIALS]: {
    swatch: "bg-azure",
    fill: "fill-azure",
    text: "text-azure",
  },
  [PLAN_BUCKETS.FUN]: {
    swatch: "bg-sulfur",
    fill: "fill-sulfur",
    text: "text-sulfur",
  },
  [PLAN_BUCKETS.SAVINGS]: {
    swatch: "bg-verdant",
    fill: "fill-verdant",
    text: "text-verdant",
  },
  // The same hue the net-worth chart gives holdings actually invested, which is
  // where most retirement money ends up.
  [PLAN_BUCKETS.RETIREMENT]: {
    swatch: "bg-invested",
    fill: "fill-invested",
    text: "text-invested",
  },
};

/**
 * Spending that could not be filed under a bucket at all — the Uncategorized
 * sentinel, or an id whose category has since been deleted.
 *
 * Grey rather than a fifth hue, and deliberately: it is not a fifth kind of
 * spending the household chose, it is spending the books cannot classify, and
 * giving it a colour of its own would seat it beside the four as an equal. Grey
 * also keeps the hue count at four, which is where a stacked chart stops being
 * readable.
 */
const UNFILED = { swatch: "bg-chalk-soft", fill: "fill-chalk-soft", text: "text-chalk-soft" };

/** The tones for a bucket, where `null` is the unfiled segment. */
export function bucketTone(bucket) {
  return TONES[bucket] ?? UNFILED;
}
