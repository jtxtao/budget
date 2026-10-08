/**
 * Credit card rewards as arithmetic: the built-in catalog of programs, what a
 * point is worth, and whether a planned redemption can be reached.
 *
 * A pure module like `paySchedule.js` and `chartAxis.js` — no React, no store,
 * no wording beyond the figures themselves — so the page and the tests read the
 * same answers.
 *
 * **A point's value is an integer number of cents per hundred points**
 * (`valuePer100Cents`), the money-is-cents discipline carried one step down: a
 * mile worth 1.3¢ is 130, and a hotel point worth 0.45¢ is 45. Fractional cents
 * per point are the ordinary case here, and a float multiplied by a six-figure
 * balance is exactly where drift shows up as a dollar on screen.
 *
 * **The catalog is built in and the values in it are starting points, not
 * facts.** What a mile is worth depends on how it is spent, so every program's
 * figure can be overridden by the household and the override is what every
 * total reads. The catalog value is still shown beside it, so a figure typed in
 * a hurry can be compared against something.
 *
 * **Transfer partners are listed for the flexible bank currencies only**, as
 * `[from, to]` ratios. They change without notice, so the page says to confirm
 * before moving points — a transfer is irreversible, and nothing here can know
 * about this month's bonus or last month's devaluation.
 */

import { daysBetween, todayISO } from "./utils";

export const PROGRAM_KINDS = {
  BANK: "bank",
  AIRLINE: "airline",
  HOTEL: "hotel",
};

export const PROGRAM_KIND_ORDER = [PROGRAM_KINDS.BANK, PROGRAM_KINDS.AIRLINE, PROGRAM_KINDS.HOTEL];

export const PROGRAM_KIND_LABELS = {
  [PROGRAM_KINDS.BANK]: "Card points",
  [PROGRAM_KINDS.AIRLINE]: "Airline miles",
  [PROGRAM_KINDS.HOTEL]: "Hotel points",
};

const one = (to) => ({ to, ratio: [1, 1] });

const airline = (id, name, valuePer100Cents) => ({
  id,
  name,
  kind: PROGRAM_KINDS.AIRLINE,
  unit: "miles",
  valuePer100Cents,
  transfers: [],
});

const hotel = (id, name, valuePer100Cents) => ({
  id,
  name,
  kind: PROGRAM_KINDS.HOTEL,
  unit: "points",
  valuePer100Cents,
  transfers: [],
});

const bank = (id, name, valuePer100Cents, transfers) => ({
  id,
  name,
  kind: PROGRAM_KINDS.BANK,
  unit: "points",
  valuePer100Cents,
  transfers,
});

export const CATALOG = [
  bank("chase-ur", "Chase Ultimate Rewards", 170, [
    one("united"),
    one("southwest"),
    one("aeroplan"),
    one("avios"),
    one("flying-blue"),
    one("virgin"),
    one("krisflyer"),
    one("jetblue"),
    one("hyatt"),
    one("marriott"),
    one("ihg"),
  ]),
  bank("amex-mr", "Amex Membership Rewards", 170, [
    one("delta"),
    one("aeroplan"),
    one("avios"),
    one("flying-blue"),
    one("virgin"),
    one("krisflyer"),
    one("lifemiles"),
    { to: "jetblue", ratio: [250, 200] },
    { to: "hilton", ratio: [1, 2] },
    one("marriott"),
    one("choice"),
  ]),
  bank("citi-ty", "Citi ThankYou Points", 160, [
    one("aadvantage"),
    one("flying-blue"),
    one("virgin"),
    one("krisflyer"),
    one("lifemiles"),
    one("turkish"),
    one("jetblue"),
    { to: "choice", ratio: [1, 2] },
    one("wyndham"),
  ]),
  bank("capital-one", "Capital One Miles", 160, [
    one("aeroplan"),
    one("avios"),
    one("flying-blue"),
    one("virgin"),
    one("krisflyer"),
    one("lifemiles"),
    one("turkish"),
    one("wyndham"),
    one("choice"),
  ]),
  bank("bilt", "Bilt Rewards", 180, [
    one("united"),
    one("aadvantage"),
    one("alaska"),
    one("aeroplan"),
    one("avios"),
    one("flying-blue"),
    one("virgin"),
    one("turkish"),
    one("hyatt"),
    one("ihg"),
    one("marriott"),
    one("hilton"),
  ]),
  airline("united", "United MileagePlus", 130),
  airline("delta", "Delta SkyMiles", 120),
  airline("aadvantage", "American AAdvantage", 150),
  airline("southwest", "Southwest Rapid Rewards", 135),
  airline("alaska", "Alaska Mileage Plan", 150),
  airline("jetblue", "JetBlue TrueBlue", 130),
  airline("aeroplan", "Air Canada Aeroplan", 150),
  airline("avios", "British Airways Avios", 140),
  airline("flying-blue", "Air France-KLM Flying Blue", 130),
  airline("virgin", "Virgin Atlantic Flying Club", 140),
  airline("krisflyer", "Singapore KrisFlyer", 140),
  airline("lifemiles", "Avianca LifeMiles", 150),
  airline("turkish", "Turkish Miles&Smiles", 140),
  hotel("hyatt", "World of Hyatt", 180),
  hotel("marriott", "Marriott Bonvoy", 80),
  hotel("hilton", "Hilton Honors", 50),
  hotel("ihg", "IHG One Rewards", 60),
  hotel("wyndham", "Wyndham Rewards", 90),
  hotel("choice", "Choice Privileges", 60),
];

const BY_ID = new Map(CATALOG.map((program) => [program.id, program]));

/** The catalog entry, or null for an id this build does not know. */
export function programById(id) {
  return BY_ID.get(id) ?? null;
}

/** What one point of `programId` is worth: the household's figure, else the catalog's. */
export function resolvedValuePer100Cents(programId, valuations = {}) {
  const override = valuations[programId];
  if (Number.isInteger(override) && override >= 0) return override;
  return programById(programId)?.valuePer100Cents ?? 0;
}

/** A balance in dollars, rounded once at the end rather than per point. */
export function valueOfPointsCents(points, valuePer100Cents) {
  return Math.round((points * valuePer100Cents) / 100);
}

/** "1.30¢" — two places, since 1.3¢ and 1.35¢ are different valuations. */
export function formatPointValue(valuePer100Cents) {
  if (valuePer100Cents == null) return "—";
  return `${(valuePer100Cents / 100).toFixed(2)}¢`;
}

/**
 * A valuation typed the way it is said — "1.3", "1.3¢", "1.35 cents" — as cents
 * per hundred points. Null for junk, the `toCents` contract, and for anything
 * negative or absurd (a point worth more than a dollar is a typo for a cent).
 */
export function toValuePer100Cents(text) {
  if (text == null) return null;
  const cleaned = String(text).trim().replace(/¢|cents?|c$/gi, "").trim();
  if (!/^\d*\.?\d+$/.test(cleaned)) return null;
  const value = Math.round(Number(cleaned) * 100);
  return value >= 0 && value <= 10000 ? value : null;
}

/** A whole number of points, commas and spaces allowed. Null for anything else. */
export function toPoints(text) {
  if (typeof text === "number") return Number.isInteger(text) && text >= 0 ? text : null;
  if (text == null) return null;
  const cleaned = String(text).trim().replace(/[,\s]/g, "");
  if (!/^\d+$/.test(cleaned)) return null;
  return Number(cleaned);
}

/** Points arriving on the other side of a transfer. Partners never pay out a fraction. */
export function pointsAfterTransfer(points, [from, to]) {
  return Math.floor((points * to) / from);
}

/**
 * What a redemption gets per point, as cents per hundred: the cash fare it
 * replaces, less the taxes still paid in cash, over the points it costs. Null
 * where there is nothing to divide by or no fare to compare against.
 */
export function achievedValuePer100Cents({ points, cashPriceCents, taxesCents }) {
  if (!points || points <= 0 || cashPriceCents == null) return null;
  const saved = cashPriceCents - (taxesCents ?? 0);
  return Math.round((saved * 100) / points);
}

/** Every bank currency that can move points into `programId`, with its ratio. */
export function transferSources(programId) {
  const sources = [];
  for (const program of CATALOG) {
    for (const transfer of program.transfers) {
      if (transfer.to === programId) sources.push({ programId: program.id, ratio: transfer.ratio });
    }
  }
  return sources;
}

/**
 * The whole page's figures from the three stored lists.
 *
 * `programs` is one row per program the household holds, with every holder's
 * points summed and valued at the resolved figure. `trips` carries, for each
 * planned redemption, the value it achieves, whether that beats the program's
 * own valuation, and how it would be paid for: points already in the program
 * first, then transfers from bank currencies, largest balance first. A balance
 * already promised to an earlier trip is not counted twice — trips are funded
 * in date order (undated last), the order they will actually be booked in.
 */
export function summariseRewards({ balances = [], valuations = {}, trips = [] }) {
  const pointsByProgram = new Map();
  const holdersByProgram = new Map();
  for (const balance of balances) {
    if (!programById(balance.programId)) continue;
    pointsByProgram.set(
      balance.programId,
      (pointsByProgram.get(balance.programId) ?? 0) + balance.points
    );
    const holders = holdersByProgram.get(balance.programId) ?? [];
    holders.push(balance);
    holdersByProgram.set(balance.programId, holders);
  }

  const programs = CATALOG.filter((program) => pointsByProgram.has(program.id)).map((program) => {
    const points = pointsByProgram.get(program.id);
    const valuePer100Cents = resolvedValuePer100Cents(program.id, valuations);
    return {
      program,
      points,
      valuePer100Cents,
      valueCents: valueOfPointsCents(points, valuePer100Cents),
      balances: holdersByProgram.get(program.id),
    };
  });

  const totalValueCents = programs.reduce((sum, row) => sum + row.valueCents, 0);
  const valueByKind = Object.fromEntries(PROGRAM_KIND_ORDER.map((kind) => [kind, 0]));
  for (const row of programs) valueByKind[row.program.kind] += row.valueCents;

  // What is still unpromised as each trip claims its points.
  const remaining = new Map(pointsByProgram);
  const ordered = [...trips].sort((a, b) => {
    if (a.date === b.date) return 0;
    if (a.date == null) return 1;
    if (b.date == null) return -1;
    return a.date < b.date ? -1 : 1;
  });

  const planned = new Map();
  for (const trip of ordered) {
    const program = programById(trip.programId);
    const valuePer100Cents = resolvedValuePer100Cents(trip.programId, valuations);
    const achieved = achievedValuePer100Cents(trip);

    let needed = trip.points;
    const fromProgram = Math.min(needed, remaining.get(trip.programId) ?? 0);
    needed -= fromProgram;
    remaining.set(trip.programId, (remaining.get(trip.programId) ?? 0) - fromProgram);

    const transfers = [];
    const sources = transferSources(trip.programId)
      .map((source) => ({ ...source, available: remaining.get(source.programId) ?? 0 }))
      .filter((source) => source.available > 0)
      .sort((a, b) => b.available - a.available);
    for (const source of sources) {
      if (needed <= 0) break;
      const [from, to] = source.ratio;
      // Partners move in whole units of the ratio, so round the cost up.
      const sourceNeeded = Math.ceil((needed * from) / to);
      const sent = Math.min(sourceNeeded, source.available);
      const arrives = pointsAfterTransfer(sent, source.ratio);
      if (arrives <= 0) continue;
      transfers.push({ programId: source.programId, ratio: source.ratio, sent, arrives });
      remaining.set(source.programId, source.available - sent);
      needed -= arrives;
    }

    planned.set(trip.id, {
      trip,
      program,
      valuePer100Cents,
      achievedPer100Cents: achieved,
      // Whether the redemption beats what the household says a point is worth —
      // the whole reason to have a valuation at all.
      goodValue: achieved == null ? null : achieved >= valuePer100Cents,
      fromProgram,
      transfers,
      shortfall: Math.max(0, needed),
      covered: needed <= 0,
    });
  }

  return {
    programs,
    totalValueCents,
    valueByKind,
    totalPoints: programs.reduce((sum, row) => sum + row.points, 0),
    // Back in the order the household entered them.
    trips: trips.map((trip) => planned.get(trip.id)),
  };
}

/* ---------------------------------------------------------------- card offers */

/**
 * **A card offer is a promise about spending, and there are two shapes of it.**
 *
 *   - **A capped bonus** (`CAP`) — a higher rate on some spending, up to a
 *     limit: 9% back on dining up to $1,000, a rotating 5% quarter capped at
 *     $1,500. Progress is room *used up*, and the useful moment is the limit,
 *     because that is when the household goes back to its usual card.
 *   - **A spending target** (`TARGET`) — spend at least this much by a date to
 *     earn a bonus: a sign-up bonus, a retention offer. Progress is distance
 *     *covered*, and the useful moment is the deadline.
 *
 * Both read the same thing off the ledger — the household's own spending, on
 * one card, inside a window, in the categories (or at the payees) the offer is
 * mapped to — and differ only in what the figure is measured against and which
 * side of the limit is good news. A rotating-category card is a capped bonus
 * per quarter; nothing about it needs a third shape.
 *
 * **What counts is decided by the household's categories, not the issuer's.**
 * An issuer files a purchase by the merchant's code, which the books do not
 * have and could not check; what the books do have is the category each
 * purchase was filed under and who it was paid to. So an offer names
 * categories, payees, or "all spending", and a purchase counts if it matches
 * any of them. Where the two filings disagree — a café the issuer calls a
 * grocery — the issuer wins and this is an estimate; the page says so.
 */
export const OFFER_KINDS = {
  CAP: "cap",
  TARGET: "target",
};

export const OFFER_KIND_LABELS = {
  [OFFER_KINDS.CAP]: "Bonus up to a limit",
  [OFFER_KINDS.TARGET]: "Spend to earn a bonus",
};

export const OFFER_STATUS = {
  UPCOMING: "upcoming",
  ACTIVE: "active",
  /** A capped bonus with no room left, or a target already met. */
  DONE: "done",
  ENDED: "ended",
};

/** Whether one leg of a record falls under the offer's mapping. */
function legMatches(offer, payeeId, budgetId) {
  if (offer.allSpending) return true;
  if (budgetId != null && offer.budgetIds.includes(budgetId)) return true;
  return payeeId != null && offer.payeeIds.includes(payeeId);
}

/**
 * The legs of a record that bear on an offer, signed: spending positive, a
 * refund negative.
 *
 * Only outflows and inflows. A transfer is never a purchase — paying the card
 * off is a transfer *into* it, and a cash advance is not what any bonus pays
 * on — so it is read here as nothing at all, whatever `budgetLegs` makes of it.
 * An inflow counts only where it names a category: that is a refund, which an
 * issuer takes back off qualifying spend, while an inflow naming none is
 * income — a statement credit, cash back redeemed — which an issuer does not.
 */
function qualifyingCents(offer, transaction) {
  const { kind } = transaction;
  if (kind !== "outflow" && kind !== "inflow") return 0;
  const parts =
    Array.isArray(transaction.splits) && transaction.splits.length > 0
      ? transaction.splits
      : [{ budgetId: transaction.budgetId, amountCents: transaction.amountCents }];
  let cents = 0;
  for (const part of parts) {
    if (kind === "inflow" && part.budgetId == null) continue;
    if (!legMatches(offer, transaction.payeeId ?? null, part.budgetId ?? null)) continue;
    cents += kind === "outflow" ? part.amountCents : -part.amountCents;
  }
  return cents;
}

/**
 * Where an offer stands as of `today`.
 *
 * The window is inclusive at both ends and **stops at today** — a record dated
 * next week is a plan, not spending, the envelope view's rule for the future.
 * An undated record is in no window, the spending report's rule: whether it
 * counts is a question about a date nobody wrote down.
 *
 * Records are walked **in date order**, which is what makes `elsewhereCents`
 * honest. It is matching spending that went on some *other* card while this
 * offer still had a use for it — room left under a cap, or a target not yet
 * met — and only a walk in order can tell a dinner bought on the usual card
 * before the cap filled (a missed bonus) from one bought after (exactly right).
 * On one day the offer's own card goes first, the generous reading.
 *
 * `qualifyingCents` is floored at zero: refunds can outweigh purchases inside a
 * window, and a negative figure would be a cap with more room than it started
 * with.
 */
export function offerProgress(offer, transactions, today) {
  const start = offer.startDate;
  const end = offer.endDate ?? null;
  const through = end != null && end < today ? end : today;

  let status;
  if (start > today) status = OFFER_STATUS.UPCOMING;
  else if (end != null && end < today) status = OFFER_STATUS.ENDED;
  else status = OFFER_STATUS.ACTIVE;

  const inWindow = transactions
    .filter((t) => t.date != null && t.date >= start && t.date <= through)
    .map((t) => ({ t, cents: qualifyingCents(offer, t), onCard: t.accountId === offer.accountId }))
    .filter((row) => row.cents !== 0)
    .sort((a, b) => {
      if (a.t.date !== b.t.date) return a.t.date < b.t.date ? -1 : 1;
      return a.onCard === b.onCard ? 0 : a.onCard ? -1 : 1;
    });

  const limit = offer.limitCents;
  let running = 0;
  let elsewhere = 0;
  let purchaseCount = 0;
  for (const row of inWindow) {
    if (row.onCard) {
      running += row.cents;
      if (row.cents > 0) purchaseCount += 1;
    } else if (row.cents > 0 && Math.max(0, running) < limit) {
      // Only as much as there was still a use for: $300 of dinners elsewhere
      // with $100 of room left is $100 missed, not $300.
      elsewhere += Math.min(row.cents, limit - Math.max(0, running));
    }
  }

  const qualifying = Math.max(0, running);
  const remainingCents = Math.max(0, limit - qualifying);
  const reached = remainingCents === 0;
  if (reached && status === OFFER_STATUS.ACTIVE) status = OFFER_STATUS.DONE;

  const daysLeft = end != null && status !== OFFER_STATUS.ENDED ? daysBetween(today, end) : null;

  // What still has to go on the card each week to make a deadline: the days
  // left include today, so the last day of the offer is one day, not zero.
  const perWeekCents =
    offer.kind === OFFER_KINDS.TARGET && !reached && daysLeft != null && status === OFFER_STATUS.ACTIVE
      ? Math.ceil((remainingCents * 7) / (daysLeft + 1))
      : null;

  const earnedCents =
    offer.kind === OFFER_KINDS.CAP && offer.rateBps != null
      ? Math.round((Math.min(qualifying, limit) * offer.rateBps) / 10000)
      : null;

  return {
    offer,
    status,
    qualifyingCents: qualifying,
    remainingCents,
    /** Spent past a cap — at the card's ordinary rate, which is the point of knowing. */
    overCents: offer.kind === OFFER_KINDS.CAP ? Math.max(0, qualifying - limit) : 0,
    reached,
    earnedCents,
    elsewhereCents: elsewhere,
    purchaseCount,
    daysLeft,
    perWeekCents,
  };
}

/**
 * The same offer's next round, for a card whose categories rotate.
 *
 * A window that runs from the first of a month to the last of one is stepped
 * by **whole months** — a calendar quarter is 90, 91 or 92 days, and stepping
 * by days would drift off the quarter within a year. Anything else is stepped
 * by its own length in days. An offer with no end has no length to repeat.
 */
export function nextOfferWindow({ startDate, endDate }) {
  if (!startDate || !endDate) return null;
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const [ey, em, ed] = endDate.split("-").map(Number);
  const lastOfMonth = new Date(ey, em, 0).getDate() === ed;
  if (sd === 1 && lastOfMonth) {
    const months = (ey - sy) * 12 + (em - sm) + 1;
    return {
      startDate: todayISO(new Date(sy, sm - 1 + months, 1)),
      endDate: todayISO(new Date(ey, em + months, 0)),
    };
  }
  const length = daysBetween(startDate, endDate) + 1;
  return {
    startDate: todayISO(new Date(sy, sm - 1, sd + length)),
    endDate: todayISO(new Date(ey, em - 1, ed + length)),
  };
}

/**
 * Which running offers bear on a purchase being entered, for the entry form's
 * reminder — read off `useCardOffers`' rows, so the room left is the page's own
 * figure and the two cannot disagree.
 *
 * Only an offer that is open on the purchase's date and still has a use for
 * spending (room under a cap, a target not yet met) is returned, and only
 * where the purchase matches its mapping in at least one category or by payee.
 * `onCard` says which way round the reminder reads: this purchase counts, or
 * another card would have counted it. `afterCents` is the room or distance left
 * once this purchase lands — only meaningful `onCard`, and floored at zero.
 */
export function offerNudges(rows, { accountId, payeeId, budgetIds, date, amountCents }) {
  if (!date) return [];
  const ids = budgetIds.filter(Boolean);
  return rows
    .filter((row) => row.status === OFFER_STATUS.ACTIVE && !row.reached)
    .filter(({ offer }) => offer.startDate <= date && (offer.endDate == null || date <= offer.endDate))
    .filter(
      ({ offer }) =>
        legMatches(offer, payeeId ?? null, null) || ids.some((id) => legMatches(offer, null, id))
    )
    .map((row) => {
      const onCard = row.offer.accountId === accountId;
      const spent = onCard && Number.isInteger(amountCents) && amountCents > 0 ? amountCents : 0;
      return {
        row,
        onCard,
        afterCents: Math.max(0, row.remainingCents - spent),
        pastCents:
          row.offer.kind === OFFER_KINDS.CAP ? Math.max(0, spent - row.remainingCents) : 0,
      };
    })
    // The card being used first: what this purchase does matters more than
    // what it might have done elsewhere.
    .sort((a, b) => (a.onCard === b.onCard ? 0 : a.onCard ? -1 : 1));
}
