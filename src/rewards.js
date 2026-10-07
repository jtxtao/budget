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
