/**
 * How well a category is funded for the month it is in, as one of five
 * readings — a pure module like `paySchedule.js`, with no colour and no React.
 * `CategoryLedgerTable` maps the readings to the dashboard's green, yellow and
 * red; nothing here knows what a tone is.
 *
 * **What the reading is measured against is the category's standing estimate**,
 * the figure the plan says a month needs. The envelope view's one definition
 * of *trouble* is still `available < 0` and only that — this does not add a
 * second one. It answers a different question, which is the one a household
 * reads the dashboard to answer: will this envelope get me through the month
 * the plan describes?
 *
 *   spentNet   = what has gone out net of refunds, never below zero
 *   stillToGo  = max(0, estimate − spentNet)       ← the plan's rest of month
 *   shortCents = stillToGo − available             ← > 0 is underfunded
 *
 * - **Overspent** — `available < 0`. The envelope is empty and still paying
 *   out, which is the app's one definition of trouble and always wins.
 * - **Underfunded** — what is left will not cover what the plan still expects
 *   this month. Carried-in money counts as much as this month's assignment,
 *   which is what lets a sinking fund read as funded without being topped up.
 * - **On track** — the rest of the month is covered.
 * - **Well funded** — the rest of this month *and* a whole further month's
 *   estimate are covered, or the category's goal has been reached. A month
 *   ahead is the honest meaning of "well": anything less is merely on track.
 * - **No estimate** — nothing to measure against. A category nobody has made
 *   their mind up about is not underfunded; it is unplanned, and saying so in
 *   red would be crying wolf on every new category.
 *
 * A category that has spent past its estimate but still holds money is on
 * track rather than underfunded: the plan has nothing left to ask of it this
 * month, and money carried forward is allowed to be spent — the reason the
 * envelope view refuses a rule about the estimate.
 */

export const FUNDING = {
  OVERSPENT: "overspent",
  UNDERFUNDED: "underfunded",
  ON_TRACK: "on-track",
  WELL_FUNDED: "well-funded",
  NO_ESTIMATE: "no-estimate",
};

/** Most urgent first — the order a legend or a count should read in. */
export const FUNDING_ORDER = [
  FUNDING.OVERSPENT,
  FUNDING.UNDERFUNDED,
  FUNDING.ON_TRACK,
  FUNDING.WELL_FUNDED,
  FUNDING.NO_ESTIMATE,
];

/**
 * The reading for one dashboard row.
 *
 * Returns `{ status, shortCents }`, where `shortCents` is what it would take to
 * bring the category to on track — the overspend for an overspent one, the gap
 * to the rest of the month's estimate for an underfunded one, and zero
 * otherwise. It is the figure a "cover it" action wants typed in.
 */
export function fundingStatus({ availableCents, activityCents, targetCents, goalCents }) {
  if (availableCents < 0) {
    return { status: FUNDING.OVERSPENT, shortCents: -availableCents };
  }

  // A goal reached is well funded whatever the estimate says: the category has
  // done what it was saving towards.
  if (goalCents != null && goalCents > 0 && availableCents >= goalCents) {
    return { status: FUNDING.WELL_FUNDED, shortCents: 0 };
  }

  const estimate = targetCents ?? 0;
  if (estimate <= 0) return { status: FUNDING.NO_ESTIMATE, shortCents: 0 };

  const spentNet = Math.max(0, -(activityCents ?? 0));
  const stillToGo = Math.max(0, estimate - spentNet);
  const shortCents = stillToGo - availableCents;

  if (shortCents > 0) return { status: FUNDING.UNDERFUNDED, shortCents };
  if (availableCents >= stillToGo + estimate) return { status: FUNDING.WELL_FUNDED, shortCents: 0 };
  return { status: FUNDING.ON_TRACK, shortCents: 0 };
}

/** The word for each reading, so colour is never the only thing saying it. */
export const FUNDING_LABELS = {
  [FUNDING.OVERSPENT]: "Overspent",
  [FUNDING.UNDERFUNDED]: "Underfunded",
  [FUNDING.ON_TRACK]: "On track",
  [FUNDING.WELL_FUNDED]: "Well funded",
  [FUNDING.NO_ESTIMATE]: "No estimate",
};
