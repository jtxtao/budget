/**
 * A household's books, invented, for the dev server only.
 *
 * Every page in this app is a derivation over a ledger, and an empty ledger
 * derives to zero — so `npm start` on a fresh browser shows eight pages of
 * dashes and nothing worth looking at. This file writes a household detailed
 * enough that each page has something to say: thirteen months of transactions,
 * a plan that nearly balances, statements on the holdings, goals part-funded,
 * gifts tagged, points banked, and one category deliberately in each of the five
 * funding states.
 *
 * **It is required from `index.js` inside a `process.env.NODE_ENV` check**, which
 * is how it stays out of the production bundle: webpack folds the condition at
 * build time and drops the whole module with the branch. Nothing else imports
 * it, and nothing in `src/` outside this file knows it exists.
 *
 * Three rules it keeps, because the alternative is a dev tool that destroys
 * work:
 *
 *   - **It writes the local scope and nothing else** — `GUEST_SCOPE` in a
 *     browser, the bare keys in the desktop shell, exactly where "use the app
 *     without an account" already puts its books. A signed-in account is never
 *     touched, so demo data cannot be pushed to a real Supabase row.
 *   - **It writes once per version of the data, not once per page load.** See
 *     `STAMP_KEY`: the books are meant to be clicked through and typed into, and
 *     a seed that ran on every load would throw that away on every refresh.
 *     Whatever was in local mode first is archived, so it is not a one-way door.
 *   - **Every figure goes in the shape the stores already expect** — integer
 *     cents, `"YYYY-MM-DD"` on the local calendar, ids as strings — so the
 *     records meet the real migrations on the way in rather than bypassing them.
 *     Nothing here calls a mutator, so nothing here can be the reason a rule
 *     stops being checked.
 *
 * `window.demoBooks.seed()` starts the household over, `.clear()` empties local
 * mode and leaves it empty, and `.restore()` puts back whatever the first seed
 * wrote over. All three reload, so the store initialisers see the new books
 * rather than the old ones.
 */

import {
  GUEST_SCOPE,
  hasStoredBooks,
  isDesktop,
  replaceScope,
  setGuestMode,
  snapshotScope,
} from "./storage";

/* ------------------------------------------------------------------ calendar */

const NOW = new Date();
const pad2 = (n) => String(n).padStart(2, "0");

/** Local calendar, never `toISOString` — the app's rule, and the reason a seed
 *  run late on the 31st does not date itself tomorrow. */
const iso = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

const TODAY = iso(NOW);
const THIS_YEAR = NOW.getFullYear();

/** The first of the month `back` months ago. */
const monthStart = (back) => new Date(THIS_YEAR, NOW.getMonth() - back, 1);

/** `"YYYY-MM"` for that month. Derived, like every period in the app. */
function periodOf(back) {
  const start = monthStart(back);
  return `${start.getFullYear()}-${pad2(start.getMonth() + 1)}`;
}

/** A day in that month, clamped to its length — so 31 is the last of February. */
function dateIn(back, day) {
  const start = monthStart(back);
  const last = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
  return iso(new Date(start.getFullYear(), start.getMonth(), Math.min(day, last)));
}

/** How far back the books run. Thirteen months, so a twelve-column chart has a
 *  month before it to measure a change from. */
const MONTHS = 13;
const BACKS = Array.from({ length: MONTHS }, (_, i) => MONTHS - 1 - i); // 12 … 0
const CURRENT = periodOf(0);

/* -------------------------------------------------------------------- records */

const ACC = {
  checking: "demo-acct-checking",
  savings: "demo-acct-savings",
  card: "demo-acct-card",
  retirement: "demo-acct-401k",
  brokerage: "demo-acct-brokerage",
  house: "demo-acct-house",
  mortgage: "demo-acct-mortgage",
};

const OFF_BUDGET = new Set([ACC.retirement, ACC.brokerage, ACC.house, ACC.mortgage]);

/** `null` is inside, the stance `insideBudget` takes for a detached record. */
const inside = (accountId) => accountId == null || !OFF_BUDGET.has(accountId);

const accounts = [
  {
    id: ACC.checking,
    name: "Everyday checking",
    type: "asset",
    scope: "on-budget",
    assetClass: "Cash",
    openingBalanceCents: 285000,
    openingDate: dateIn(12, 1),
    reconciledOn: iso(new Date(THIS_YEAR, NOW.getMonth(), NOW.getDate() - 12)),
  },
  {
    id: ACC.savings,
    name: "High-yield savings",
    type: "asset",
    scope: "on-budget",
    assetClass: "Cash",
    openingBalanceCents: 640000,
    openingDate: dateIn(12, 1),
    reconciledOn: iso(new Date(THIS_YEAR, NOW.getMonth(), NOW.getDate() - 41)),
  },
  {
    id: ACC.card,
    name: "Rewards card",
    type: "liability",
    scope: "credit-card",
    assetClass: "Other",
    openingBalanceCents: -90000,
    openingDate: dateIn(12, 1),
    reconciledOn: iso(new Date(THIS_YEAR, NOW.getMonth(), NOW.getDate() - 3)),
  },
  {
    id: ACC.retirement,
    name: "401(k)",
    type: "asset",
    scope: "off-budget",
    assetClass: "Stocks",
    openingBalanceCents: 8_600_000,
    openingDate: dateIn(12, 1),
    reconciledOn: null,
  },
  {
    id: ACC.brokerage,
    name: "Brokerage",
    type: "asset",
    scope: "off-budget",
    assetClass: "Stocks",
    openingBalanceCents: 2_400_000,
    openingDate: dateIn(12, 1),
    reconciledOn: null,
  },
  {
    id: ACC.house,
    name: "Home",
    type: "asset",
    scope: "off-budget",
    assetClass: "Real estate",
    openingBalanceCents: 48_500_000,
    openingDate: dateIn(12, 1),
    reconciledOn: null,
  },
  {
    id: ACC.mortgage,
    name: "Mortgage",
    type: "liability",
    scope: "off-budget",
    assetClass: "Other",
    openingBalanceCents: -32_500_000,
    openingDate: dateIn(12, 1),
    reconciledOn: null,
  },
];

const GROUP = {
  home: "demo-group-home",
  living: "demo-group-living",
  lifestyle: "demo-group-lifestyle",
  future: "demo-group-future",
  retirement: "demo-group-retirement",
};

const budgetGroups = [
  { id: GROUP.home, name: "Home", bucket: "essentials" },
  { id: GROUP.living, name: "Living", bucket: "essentials" },
  { id: GROUP.lifestyle, name: "Lifestyle", bucket: "fun" },
  { id: GROUP.future, name: "Future", bucket: "savings" },
  { id: GROUP.retirement, name: "Retirement", bucket: "retirement" },
];

const B = {
  rent: "demo-cat-rent",
  utilities: "demo-cat-utilities",
  internet: "demo-cat-internet",
  repairs: "demo-cat-repairs",
  groceries: "demo-cat-groceries",
  transport: "demo-cat-transport",
  insurance: "demo-cat-insurance",
  phone: "demo-cat-phone",
  health: "demo-cat-health",
  dining: "demo-cat-dining",
  fun: "demo-cat-fun",
  shopping: "demo-cat-shopping",
  travel: "demo-cat-travel",
  gifts: "demo-cat-gifts",
  misc: "demo-cat-misc",
  emergency: "demo-cat-emergency",
  car: "demo-cat-car",
  roth: "demo-cat-roth",
};

// `plannedCents` is the standing monthly estimate; `goalCents` is the balance the
// category is saving towards, and null — the ordinary case — for most of them.
const budgets = [
  { id: B.rent, name: "Rent", plannedCents: 220000, goalCents: null, groupId: GROUP.home, bucket: "essentials" },
  { id: B.utilities, name: "Utilities", plannedCents: 18500, goalCents: null, groupId: GROUP.home, bucket: "essentials" },
  { id: B.internet, name: "Internet", plannedCents: 7500, goalCents: null, groupId: GROUP.home, bucket: "essentials" },
  { id: B.repairs, name: "Home repairs", plannedCents: 10000, goalCents: 300000, groupId: GROUP.home, bucket: "essentials" },
  { id: B.groceries, name: "Groceries", plannedCents: 72000, goalCents: null, groupId: GROUP.living, bucket: "essentials" },
  { id: B.transport, name: "Transit & fuel", plannedCents: 18000, goalCents: null, groupId: GROUP.living, bucket: "essentials" },
  { id: B.insurance, name: "Insurance", plannedCents: 24500, goalCents: null, groupId: GROUP.living, bucket: "essentials" },
  { id: B.phone, name: "Phone", plannedCents: 9000, goalCents: null, groupId: GROUP.living, bucket: "essentials" },
  { id: B.health, name: "Health & medical", plannedCents: 15000, goalCents: 200000, groupId: GROUP.living, bucket: "essentials" },
  { id: B.dining, name: "Dining out", plannedCents: 32000, goalCents: null, groupId: GROUP.lifestyle, bucket: "fun" },
  { id: B.fun, name: "Entertainment", plannedCents: 15000, goalCents: null, groupId: GROUP.lifestyle, bucket: "fun" },
  { id: B.shopping, name: "Shopping", plannedCents: 20000, goalCents: null, groupId: GROUP.lifestyle, bucket: "fun" },
  { id: B.travel, name: "Travel", plannedCents: 25000, goalCents: 500000, groupId: GROUP.lifestyle, bucket: "fun" },
  { id: B.gifts, name: "Gifts & giving", plannedCents: 30000, goalCents: null, groupId: GROUP.lifestyle, bucket: "fun" },
  { id: B.misc, name: "Miscellaneous", plannedCents: 0, goalCents: null, groupId: GROUP.lifestyle, bucket: "fun" },
  { id: B.emergency, name: "Emergency fund", plannedCents: 40000, goalCents: 1_800_000, groupId: GROUP.future, bucket: "savings" },
  { id: B.car, name: "Car replacement", plannedCents: 25000, goalCents: 2_000_000, groupId: GROUP.future, bucket: "savings" },
  { id: B.roth, name: "Roth IRA", plannedCents: 58300, goalCents: null, groupId: GROUP.retirement, bucket: "retirement" },
];

const P = {
  employer: "demo-payee-employer",
  clinic: "demo-payee-clinic",
  landlord: "demo-payee-landlord",
  power: "demo-payee-power",
  isp: "demo-payee-isp",
  telco: "demo-payee-telco",
  insurer: "demo-payee-insurer",
  market: "demo-payee-market",
  gas: "demo-payee-gas",
  taqueria: "demo-payee-taqueria",
  bistro: "demo-payee-bistro",
  streaming: "demo-payee-streaming",
  online: "demo-payee-online",
  bigbox: "demo-payee-bigbox",
  airline: "demo-payee-airline",
  hotel: "demo-payee-hotel",
  doctor: "demo-payee-doctor",
  roofer: "demo-payee-roofer",
  foodbank: "demo-payee-foodbank",
  habitat: "demo-payee-habitat",
  neighbour: "demo-payee-neighbour",
};

// `defaultBudgetId` is a default and nothing more: it seeds the entry form and
// never re-files a row that is already filed.
const payees = [
  { id: P.employer, name: "Acme Corp", defaultBudgetId: null },
  { id: P.clinic, name: "Northside Clinic", defaultBudgetId: null },
  { id: P.landlord, name: "Oak Street Rentals", defaultBudgetId: B.rent },
  { id: P.power, name: "City Power & Water", defaultBudgetId: B.utilities },
  { id: P.isp, name: "Riverline Fiber", defaultBudgetId: B.internet },
  { id: P.telco, name: "Tandem Mobile", defaultBudgetId: B.phone },
  { id: P.insurer, name: "Granite Mutual", defaultBudgetId: B.insurance },
  { id: P.market, name: "Hillside Market", defaultBudgetId: B.groceries },
  { id: P.gas, name: "Birch & Main Fuel", defaultBudgetId: B.transport },
  { id: P.taqueria, name: "La Vecina Taqueria", defaultBudgetId: B.dining },
  { id: P.bistro, name: "Fernwood Bistro", defaultBudgetId: B.dining },
  { id: P.streaming, name: "Lumen Streaming", defaultBudgetId: B.fun },
  { id: P.online, name: "Parcelworks", defaultBudgetId: B.shopping },
  { id: P.bigbox, name: "Greatmart", defaultBudgetId: null },
  { id: P.airline, name: "Northstar Airways", defaultBudgetId: B.travel },
  { id: P.hotel, name: "Harbour Rooms", defaultBudgetId: B.travel },
  { id: P.doctor, name: "Dr. Imani Chen", defaultBudgetId: B.health },
  { id: P.roofer, name: "Cedar Ridge Roofing", defaultBudgetId: B.repairs },
  { id: P.foodbank, name: "Riverside Food Bank", defaultBudgetId: B.gifts },
  { id: P.habitat, name: "Homefront Build", defaultBudgetId: B.gifts },
  { id: P.neighbour, name: "Neighbourhood fundraiser", defaultBudgetId: B.gifts },
];

/* --------------------------------------------------------------- the ledger */

/**
 * Seasonal wobble on the power bill, twelve offsets summing to zero and indexed
 * by calendar month — so the standing estimate beside it stays the honest
 * average however many months the seed covers.
 */
const UTILITY_OFFSETS = [4200, 3100, 1200, -800, -2600, -3400, -2100, -1500, 600, 1900, 2400, -3000];

const GROCERY_OFFSETS = [2600, -1900, 1200, -1900];
const FUEL_OFFSETS = [900, -900];
const SHOPPING_OFFSETS = [3400, -3400];

/** Thirteen months of movements, newest last. Nothing future-dated: a record
 *  past today is excluded from every envelope figure, so seeding one would put
 *  money on screen the books cannot explain. */
function buildLedger() {
  const rows = [];
  let seq = 0;

  const add = (row) => {
    if (row.date !== null && row.date > TODAY) return null;
    const full = {
      id: `demo-tx-${pad2(++seq)}-${row.kind}`,
      kind: row.kind,
      payeeId: row.payeeId ?? null,
      description: row.description ?? "",
      amountCents: row.amountCents,
      date: row.date,
      accountId: row.accountId,
      toAccountId: row.toAccountId ?? null,
      budgetId: row.budgetId ?? null,
      splits: row.splits ?? null,
    };
    rows.push(full);
    return full;
  };

  const out = (back, day, amountCents, budgetId, payeeId, accountId, description) =>
    add({ kind: "outflow", date: dateIn(back, day), amountCents, budgetId, payeeId, accountId, description });

  const inflow = (back, day, amountCents, payeeId, accountId, description, budgetId) =>
    add({ kind: "inflow", date: dateIn(back, day), amountCents, payeeId, accountId, description, budgetId });

  const transfer = (back, day, amountCents, accountId, toAccountId, budgetId, description) =>
    add({ kind: "transfer", date: dateIn(back, day), amountCents, accountId, toAccountId, budgetId, description });

  for (const back of BACKS) {
    const month = monthStart(back).getMonth();

    // Income. A fortnightly paycheque genuinely lands three times in some
    // months, which is what the two extra rows below are.
    inflow(back, 5, 265000, P.employer, ACC.checking, "Paycheque");
    inflow(back, 19, 265000, P.employer, ACC.checking, "Paycheque");
    inflow(back, 15, 82000, P.clinic, ACC.checking, "Shift pay");
    inflow(back, 28, 82000, P.clinic, ACC.checking, "Shift pay");
    if (back === 10 || back === 4) inflow(back, 31, 265000, P.employer, ACC.checking, "Third paycheque");

    // The bills, out of checking.
    out(back, 1, 220000, B.rent, P.landlord, ACC.checking, "Rent");
    out(back, 3, 24500, B.insurance, P.insurer, ACC.checking, "Car & home policy");
    out(back, 8, 7500, B.internet, P.isp, ACC.checking, "Fiber");
    out(back, 10, 9000, B.phone, P.telco, ACC.checking, "Two lines");
    out(back, 12, 18500 + UTILITY_OFFSETS[month], B.utilities, P.power, ACC.checking, "Power & water");

    GROCERY_OFFSETS.forEach((offset, i) => {
      out(back, 4 + i * 7, 18000 + offset, B.groceries, P.market, ACC.checking, "Weekly shop");
    });

    // The card carries the discretionary spend, which is what gives the card
    // payment below something to settle.
    out(back, 7, 9000, B.dining, P.taqueria, ACC.card, "Lunch");
    out(back, 16, 11000, B.dining, P.bistro, ACC.card, "Dinner out");
    out(back, 23, 12000, B.dining, P.bistro, ACC.card, "Friends over");
    FUEL_OFFSETS.forEach((offset, i) => {
      out(back, 9 + i * 13, 9000 + offset, B.transport, P.gas, ACC.card, "Fuel");
    });
    SHOPPING_OFFSETS.forEach((offset, i) => {
      out(back, 14 + i * 10, 10000 + offset, B.shopping, P.online, ACC.card, "Household order");
    });
    out(back, 2, 4500, B.fun, P.streaming, ACC.card, "Subscriptions");
    out(back, 20, 10500, B.fun, P.bistro, ACC.card, "Night out");

    // Two accounts the budget spends through: no envelope effect at all.
    transfer(back, 6, 120000, ACC.checking, ACC.savings, null, "Sweep to savings");
    // Out of the budget: an outflow against the retirement category, and the
    // holding is credited too.
    transfer(back, 6, 58300, ACC.checking, ACC.brokerage, B.roth, "Roth contribution");
  }

  // One-off spending, so the sinking funds have something to have paid for and
  // the reports have a shape rather than a flat line.
  out(6, 11, 78000, B.travel, P.airline, ACC.card, "Flights");
  out(6, 12, 56000, B.travel, P.hotel, ACC.card, "Four nights");
  out(9, 17, 32000, B.health, P.doctor, ACC.checking, "Specialist visit");
  out(3, 21, 18500, B.health, P.doctor, ACC.checking, "Dental");
  out(7, 15, 48000, B.repairs, P.roofer, ACC.checking, "Gutter repair");
  // What a buffer is for: a real draw on a savings-bucket envelope, which is
  // also the only way the savings share appears in a report of the books.
  out(2, 6, 420000, B.emergency, P.roofer, ACC.checking, "Furnace replacement");

  // A receipt divided three ways — the whole is what the account lost, the parts
  // are what the envelopes see, and the two agree because they add up.
  add({
    kind: "outflow",
    date: dateIn(1, 13),
    amountCents: 31400,
    budgetId: B.groceries,
    payeeId: P.bigbox,
    accountId: ACC.card,
    description: "Monthly run",
    splits: [
      { id: "demo-split-1", budgetId: B.groceries, amountCents: 18600 },
      { id: "demo-split-2", budgetId: B.shopping, amountCents: 7800 },
      { id: "demo-split-3", budgetId: B.fun, amountCents: 5000 },
    ],
  });

  // An inflow *with* a category is a refund: it goes back to the envelope it
  // came out of and never reaches the pool.
  inflow(2, 26, 6400, P.online, ACC.card, "Returned lamp", B.shopping);

  // A row from before dates were recorded. It folds into every cumulative sum
  // and into no month, which is exactly what the pages have to say out loud.
  add({
    kind: "outflow",
    date: null,
    amountCents: 5600,
    budgetId: B.groceries,
    payeeId: null,
    accountId: ACC.checking,
    description: "Corner shop — date unknown",
  });

  // The gifts, tagged as donations further down.
  const gifts = [
    out(11, 20, 25000, B.gifts, P.foodbank, ACC.checking, "Winter appeal"),
    out(8, 14, 50000, B.gifts, P.habitat, ACC.checking, "Spring build"),
    out(5, 9, 15000, B.gifts, P.foodbank, ACC.checking, "Monthly gift"),
    out(4, 17, 20000, B.gifts, P.neighbour, ACC.checking, "Fundraiser"),
    out(2, 22, 100000, B.gifts, P.habitat, ACC.checking, "Annual gift"),
    out(0, 3, 30000, B.gifts, P.foodbank, ACC.checking, "Monthly gift"),
  ].filter(Boolean);

  // The card is paid off a month in arrears, for whatever it actually carried —
  // a transfer between two accounts the budget spends through, so no envelope
  // moves and the card's balance simply falls by what checking loses.
  const cardSpendByBack = new Map();
  for (const row of rows) {
    if (row.date === null) continue;
    const back = BACKS.find((candidate) => periodOf(candidate) === row.date.slice(0, 7));
    if (back === undefined) continue;
    const signed =
      row.accountId === ACC.card && row.kind === "outflow"
        ? row.amountCents
        : row.accountId === ACC.card && row.kind === "inflow"
          ? -row.amountCents
          : 0;
    if (signed) cardSpendByBack.set(back, (cardSpendByBack.get(back) ?? 0) + signed);
  }
  for (const back of BACKS) {
    const owed = cardSpendByBack.get(back + 1) ?? 85000;
    if (owed > 0) transfer(back, 26, owed, ACC.checking, ACC.card, null, "Card payment");
  }

  return { rows, giftIds: gifts.map((gift) => gift.id) };
}

/* ------------------------------------------------- the two cuts of the ledger */

/** What a record means to the envelopes: one leg per part, signed, and none at
 *  all for a transfer the budget never sees. */
function legsOf(row) {
  if (row.kind === "transfer") {
    const leaving = inside(row.accountId);
    const arriving = inside(row.toAccountId);
    if (leaving && !arriving) {
      return [{ budgetId: row.budgetId ?? "Uncategorized", cents: -row.amountCents }];
    }
    return [];
  }

  const sign = row.kind === "inflow" ? 1 : -1;
  const parts =
    row.splits ?? (row.budgetId ? [{ budgetId: row.budgetId, amountCents: row.amountCents }] : []);
  return parts.map((part) => ({ budgetId: part.budgetId, cents: sign * part.amountCents }));
}

/** What a record puts in the pool: income naming no category, and a withdrawal
 *  from outside the budget into it. */
function poolIncomeOf(row) {
  if (row.kind === "transfer") {
    return !inside(row.accountId) && inside(row.toAccountId) ? row.amountCents : 0;
  }
  if (row.kind !== "inflow") return 0;
  return legsOf(row).length === 0 ? row.amountCents : 0;
}

/** The balance-sheet cut: opening plus everything that moved through, to `period`. */
function derivedAt(rows, accountId, period) {
  const account = accounts.find((entry) => entry.id === accountId);
  let cents = account.openingBalanceCents;
  for (const row of rows) {
    if (row.date !== null && row.date.slice(0, 7) > period) continue;
    if (row.kind === "transfer") {
      if (row.accountId === accountId) cents -= row.amountCents;
      if (row.toAccountId === accountId) cents += row.amountCents;
      continue;
    }
    if (row.accountId !== accountId) continue;
    cents += row.kind === "inflow" ? row.amountCents : -row.amountCents;
  }
  return cents;
}

/* ---------------------------------------------------------------- assignments */

/**
 * What was put in each envelope, month by month.
 *
 * Every month but this one is funded at the plan's own estimate, which is what a
 * household following its plan actually does — and what leaves the sinking funds
 * carrying a balance. **This month is derived rather than typed**, so the five
 * funding readings land whatever day of the month the seed is run on: the figure
 * is chosen to leave each engineered category at a stated `available`, and
 * `available = carriedIn + assigned + activity` is solved for `assigned`.
 */
function buildAssignments(rows) {
  const assignments = [];
  const push = (budgetId, period, assignedCents) => {
    if (assignedCents === 0) return;
    assignments.push({ id: `demo-assign-${budgetId}-${period}`, budgetId, period, assignedCents });
  };

  const priorBacks = BACKS.filter((back) => back > 0);
  for (const back of priorBacks) {
    for (const budget of budgets) push(budget.id, periodOf(back), budget.plannedCents);
  }

  // Activity, split into what fell before this month (which carries in, undated
  // records included) and what fell inside it.
  const carriedActivity = new Map();
  const thisMonthActivity = new Map();
  for (const row of rows) {
    const bucket =
      row.date === null || row.date.slice(0, 7) < CURRENT ? carriedActivity : thisMonthActivity;
    if (row.date !== null && row.date.slice(0, 7) > CURRENT) continue;
    for (const leg of legsOf(row)) {
      bucket.set(leg.budgetId, (bucket.get(leg.budgetId) ?? 0) + leg.cents);
    }
  }

  const carriedIn = new Map();
  for (const budget of budgets) {
    const assigned = budget.plannedCents * priorBacks.length;
    carriedIn.set(budget.id, assigned + (carriedActivity.get(budget.id) ?? 0));
  }

  /**
   * Five categories are *steered* to a stated balance, one per funding reading,
   * so the dashboard's Funding column carries every colour and every word
   * whatever day of the month this runs on.
   *
   * Everything else is simply funded at its estimate, which is what the month
   * being funded means — and it is the reason this is a lookup rather than a
   * formula for all eighteen. Solving every row for a balance would *drain* the
   * sinking funds' carry-in to get there, and a month that takes $2,750 back out
   * of the car fund to leave it at this month's estimate is a month the headline
   * reports as having budgeted a negative figure.
   */
  const STEERED = new Map([
    // Below zero — the app's one definition of trouble.
    [B.groceries, -15000],
    // Holding something, but not what the rest of the month still needs.
    [B.dining, 2000],
    // Exactly covered, with nothing left for the plan to ask.
    [B.rent, 0],
    // This month and a further month over.
    [B.utilities, 37000],
    // No estimate to be short of — and a figure, so the row is not pruned.
    [B.misc, 5000],
  ]);

  for (const budget of budgets) {
    const activity = thisMonthActivity.get(budget.id) ?? 0;
    const steered = STEERED.get(budget.id);
    const assigned =
      steered === undefined
        ? budget.plannedCents
        : steered - carriedIn.get(budget.id) - activity;
    push(budget.id, CURRENT, assigned);
  }

  return assignments;
}

/* -------------------------------------------------------------- savings goals */

const GOAL = {
  wedding: "demo-goal-wedding",
  camera: "demo-goal-camera",
  roof: "demo-goal-roof",
};

const savingsGoals = [
  {
    id: GOAL.wedding,
    name: "Wedding",
    targetCents: 2_500_000,
    targetDate: dateIn(-14, 12),
  },
  { id: GOAL.camera, name: "Camera kit", targetCents: 320000, targetDate: dateIn(-5, 1) },
  { id: GOAL.roof, name: "Roof replacement", targetCents: 1_200_000, targetDate: null },
];

const GOAL_MONTHLY = { [GOAL.wedding]: 60000, [GOAL.camera]: 20000, [GOAL.roof]: 30000 };

function buildGoalAssignments() {
  const assignments = [];
  for (const back of BACKS.filter((candidate) => candidate > 0)) {
    for (const goal of savingsGoals) {
      assignments.push({
        id: `demo-goal-assign-${goal.id}-${periodOf(back)}`,
        goalId: goal.id,
        period: periodOf(back),
        assignedCents: GOAL_MONTHLY[goal.id],
      });
    }
  }
  return assignments;
}

/**
 * What the pool is left holding, and the one figure worth steering.
 *
 * A household that has been funding its plan for a year leaves whatever it did
 * not assign sitting in "to be assigned", and over thirteen months of invented
 * income that figure drifts wherever the arithmetic takes it — tens of thousands
 * of dollars of money with no job, which reads as a bug rather than as a
 * household. So the difference is settled back over the prior months against the
 * two sinking funds, which is exactly where a real household would have put it
 * (or taken it from), and the pool is left on about a week's unassigned pay.
 *
 * It settles in **both** directions, because which one is needed depends on the
 * day of the month the seed runs: the plan is funded in full from the 1st while
 * the paycheques land through the month, so an early run is short and a late one
 * is over. A share is clamped at zero so a month can never read as having had
 * funding pulled out of it that was not there.
 */
const TARGET_TO_BE_ASSIGNED = 87500;

/** Split by the two funds' own estimates, so the settlement looks like the plan. */
const ABSORBERS = [
  { budgetId: B.emergency, weight: 40000 },
  { budgetId: B.car, weight: 25000 },
];

function absorbSurplus(rows, assignments, goalAssignments) {
  const opening = accounts
    .filter((account) => inside(account.id))
    .reduce((sum, account) => sum + account.openingBalanceCents, 0);

  const poolIncome = rows.reduce(
    (sum, row) =>
      row.date !== null && row.date.slice(0, 7) > CURRENT ? sum : sum + poolIncomeOf(row),
    0
  );
  const assigned = [...assignments, ...goalAssignments].reduce(
    (sum, entry) => sum + entry.assignedCents,
    0
  );

  const surplus = opening + poolIncome - assigned - TARGET_TO_BE_ASSIGNED;
  if (surplus === 0) return assignments;

  const months = BACKS.filter((back) => back > 0).length;
  const total = ABSORBERS.reduce((sum, absorber) => sum + absorber.weight, 0);

  // cents still to place, per absorber, with the rounding remainder on the last.
  const owed = new Map();
  let placed = 0;
  ABSORBERS.forEach((absorber, index) => {
    const share =
      index === ABSORBERS.length - 1
        ? surplus - placed
        : Math.round((surplus * absorber.weight) / total);
    placed += share;
    owed.set(absorber.budgetId, share);
  });

  const left = new Map(owed);
  const steps = new Map([...owed].map(([id, share]) => [id, Math.trunc(share / months)]));
  // The most recent prior month carries whatever the even steps leave over, and
  // whatever an earlier month's clamp refused.
  const lastPrior = periodOf(1);

  return assignments.map((entry) => {
    if (entry.period === CURRENT || !owed.has(entry.budgetId)) return entry;
    const remaining = left.get(entry.budgetId);
    const share = entry.period === lastPrior ? remaining : steps.get(entry.budgetId);
    const taken = Math.max(share, -entry.assignedCents);
    left.set(entry.budgetId, remaining - taken);
    return { ...entry, assignedCents: entry.assignedCents + taken };
  });
}

/* ---------------------------------------------------------- balance snapshots */

/**
 * A statement figure for each holding, month by month — the half of net worth no
 * ledger can know. Deliberately incomplete in two places: the brokerage has
 * nothing for this month, so it reads as waiting on an update, and the house is
 * valued quarterly, which is what the chart's smoothing is for.
 */
function buildBalances(rows) {
  const balances = [];
  const push = (accountId, period, amountCents) =>
    balances.push({ id: `demo-bal-${accountId}-${period}`, accountId, period, amountCents });

  BACKS.forEach((back, index) => {
    const period = periodOf(back);
    const elapsed = index; // 0 at the oldest month

    // Contributions plus market movement, with a down month in the middle so the
    // line is not a ramp.
    const retirementGrowth = Math.round(8_600_000 * (1.0082 ** elapsed - 1));
    const wobble = elapsed === 5 ? -220000 : elapsed === 9 ? -140000 : 0;
    push(ACC.retirement, period, 8_600_000 + retirementGrowth + 112000 * elapsed + wobble);

    if (back > 0) {
      const brokerageGrowth = Math.round(2_400_000 * (1.0061 ** elapsed - 1));
      push(ACC.brokerage, period, 2_400_000 + brokerageGrowth + 58300 * elapsed);
    }

    if (elapsed % 3 === 0) {
      push(ACC.house, period, 48_500_000 + Math.round(48_500_000 * (1.0028 ** elapsed - 1)));
    }

    push(ACC.mortgage, period, -(32_500_000 - 118000 * elapsed));
  });

  // Statements on an everyday account that do not agree with the books, which is
  // what `driftCents` reports and `FixDriftModal` settles. A spend-through
  // account's snapshot answers for its own month only and never carries forward,
  // so the gap has to be stated in *this* month for the page to open on one.
  push(ACC.checking, CURRENT, derivedAt(rows, ACC.checking, CURRENT) + 4200);
  const earlier = periodOf(3);
  push(ACC.checking, earlier, derivedAt(rows, ACC.checking, earlier) - 2600);

  return balances;
}

/* -------------------------------------------------------------- everything else */

const incomeSources = [
  { id: "demo-income-1", name: "Acme Corp salary", amountCents: 265000, cadence: "biweekly" },
  { id: "demo-income-2", name: "Clinic shifts", amountCents: 82000, cadence: "semimonthly" },
];

const paySchedule = {
  cadence: "biweekly",
  lastPaidOn: dateIn(0, 5),
  periodDays: 14,
  daysOfMonth: [15, 31],
};

const emergencyFund = {
  targetSource: "months",
  monthsCovered: 6,
  targetCents: 2_000_000,
  accountIds: [ACC.savings],
  // Part of the savings account is the buffer, not all of it.
  accountAmounts: { [ACC.savings]: 1_800_000 },
};

const REC = {
  foodbank: "demo-recipient-foodbank",
  habitat: "demo-recipient-habitat",
  neighbour: "demo-recipient-neighbour",
};

const donationRecipients = [
  { id: REC.foodbank, name: "Riverside Food Bank", deductible: true },
  { id: REC.habitat, name: "Homefront Build", deductible: true },
  { id: REC.neighbour, name: "Neighbourhood fundraiser", deductible: false },
];

/**
 * A donation is a statement *about* an outflow and holds no money of its own, so
 * each record names the transaction and nothing the ledger already holds. The
 * one here with a deductible part smaller than the gift is the gala-ticket case.
 */
function buildDonations(rows, giftIds) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const recipientFor = {
    [P.foodbank]: REC.foodbank,
    [P.habitat]: REC.habitat,
    [P.neighbour]: REC.neighbour,
  };

  return giftIds.map((transactionId) => {
    const gift = byId.get(transactionId);
    const recipientId = recipientFor[gift.payeeId] ?? null;
    const deductibleCents =
      recipientId === REC.neighbour
        ? 0
        : gift.amountCents === 100000
          ? 92000 // a gala ticket: the dinner is not a gift
          : gift.amountCents;
    return {
      transactionId,
      recipientId,
      deductibleCents,
      acknowledged: gift.amountCents >= 25000 && recipientId !== REC.habitat,
    };
  });
}

const donationGoals = [
  { year: String(THIS_YEAR), source: "income-share", amountCents: 300000, shareBps: 400 },
  { year: String(THIS_YEAR - 1), source: "amount", amountCents: 250000, shareBps: null },
];

const schedules = [
  {
    id: "demo-sched-rent",
    kind: "outflow",
    payeeId: P.landlord,
    amountCents: 220000,
    accountId: ACC.checking,
    budgetId: B.rent,
    description: "Rent",
    cadence: "monthly",
    startDate: dateIn(12, 1),
    endsOn: null,
    enteredThrough: dateIn(0, 1),
  },
  {
    id: "demo-sched-internet",
    kind: "outflow",
    payeeId: P.isp,
    amountCents: 7500,
    accountId: ACC.checking,
    budgetId: B.internet,
    description: "Fiber",
    cadence: "monthly",
    startDate: dateIn(12, 8),
    endsOn: null,
    enteredThrough: dateIn(1, 8),
  },
  {
    // Quarterly, and deliberately left unentered — an occurrence the window
    // opened on and nobody dealt with stays visible as overdue.
    id: "demo-sched-insurance",
    kind: "outflow",
    payeeId: P.insurer,
    amountCents: 24500,
    accountId: ACC.checking,
    budgetId: B.insurance,
    description: "Policy renewal",
    cadence: "quarterly",
    startDate: dateIn(12, 3),
    endsOn: null,
    enteredThrough: dateIn(3, 3),
  },
  {
    id: "demo-sched-gym",
    kind: "outflow",
    payeeId: P.streaming,
    amountCents: 4500,
    accountId: ACC.card,
    budgetId: B.fun,
    description: "Subscriptions",
    cadence: "monthly",
    startDate: dateIn(6, 15),
    endsOn: null,
    enteredThrough: dateIn(1, 15),
  },
  {
    id: "demo-sched-pay",
    kind: "inflow",
    payeeId: P.employer,
    amountCents: 265000,
    accountId: ACC.checking,
    budgetId: null,
    description: "Paycheque",
    cadence: "biweekly",
    startDate: dateIn(12, 5),
    endsOn: null,
    enteredThrough: dateIn(0, 5),
  },
];

const retirementPlan = {
  currentAge: 36,
  retirementAge: 55,
  lifeExpectancy: 95,
  startingSource: "accounts",
  accountIds: [ACC.retirement, ACC.brokerage],
  startingBalanceCents: 11_000_000,
  spendingSource: "income-share",
  incomeShareBps: 8500,
  annualSpendingCents: 7_200_000,
  pretaxContributionCents: 1_400_000,
  annualContributionCents: null,
  growthRateBps: 1000,
  drawdownRateBps: 550,
  inflationRateBps: 250,
  incomeSource: "growth",
  incomeGrowthRateBps: 300,
  salaries: [
    { id: "demo-salary-1", fromAge: 36, grossCents: 11_500_000 },
    { id: "demo-salary-2", fromAge: 42, grossCents: 14_000_000 },
  ],
  workingTaxRateBps: 2200,
  retirementTaxRateBps: 1200,
  cashRateBps: 250,
  propertyRateBps: 350,
  debtAssumptions: {
    [ACC.mortgage]: { rateBps: 575, monthlyPaymentCents: 212000 },
  },
};

const EVENT = {
  wedding: "demo-event-wedding",
  childcare: "demo-event-childcare",
  sabbatical: "demo-event-sabbatical",
  social: "demo-event-social",
  upsize: "demo-event-upsize",
};

const lifeEvents = [
  {
    id: EVENT.wedding,
    name: "Wedding",
    kind: "expense",
    startAge: 37,
    years: 1,
    oneTimeCents: 2_500_000,
    annualCents: null,
    keptShareBps: 0,
    priceCents: null,
    downPaymentCents: null,
    rateBps: 0,
    termYears: 30,
    rentSavedCents: null,
    sellingCostBps: 0,
    propertyRef: null,
    debtRef: null,
    enabled: true,
  },
  {
    id: EVENT.childcare,
    name: "Childcare",
    kind: "expense",
    startAge: 38,
    years: 6,
    oneTimeCents: null,
    annualCents: 1_800_000,
    keptShareBps: 0,
    priceCents: null,
    downPaymentCents: null,
    rateBps: 0,
    termYears: 30,
    rentSavedCents: null,
    sellingCostBps: 0,
    propertyRef: null,
    debtRef: null,
    enabled: true,
  },
  {
    id: EVENT.sabbatical,
    name: "Year off",
    kind: "income-change",
    startAge: 46,
    years: 1,
    oneTimeCents: null,
    annualCents: null,
    keptShareBps: 0,
    priceCents: null,
    downPaymentCents: null,
    rateBps: 0,
    termYears: 30,
    rentSavedCents: null,
    sellingCostBps: 0,
    propertyRef: null,
    debtRef: null,
    enabled: false,
  },
  {
    id: EVENT.social,
    name: "Social Security",
    kind: "income",
    startAge: 67,
    years: null,
    oneTimeCents: null,
    annualCents: 2_800_000,
    keptShareBps: 0,
    priceCents: null,
    downPaymentCents: null,
    rateBps: 0,
    termYears: 30,
    rentSavedCents: null,
    sellingCostBps: 0,
    propertyRef: null,
    debtRef: null,
    enabled: true,
  },
  {
    id: EVENT.upsize,
    name: "Sell and downsize",
    kind: "sell-property",
    startAge: 64,
    years: 1,
    oneTimeCents: null,
    annualCents: null,
    keptShareBps: 0,
    priceCents: null,
    downPaymentCents: null,
    rateBps: 0,
    termYears: 30,
    rentSavedCents: null,
    sellingCostBps: 600,
    propertyRef: ACC.house,
    debtRef: ACC.mortgage,
    enabled: false,
  },
];

// A scenario is a snapshot of the plan, not a link to it: editing the live plan
// leaves these alone.
const retirementScenarios = [
  {
    id: "demo-scenario-early",
    name: "Retire at 60",
    plan: { ...retirementPlan, retirementAge: 60 },
    enabledEventIds: [EVENT.wedding, EVENT.childcare, EVENT.social],
    slot: 0,
  },
  {
    id: "demo-scenario-sabbatical",
    name: "Year off at 46",
    plan: { ...retirementPlan, retirementAge: 62 },
    enabledEventIds: [EVENT.wedding, EVENT.childcare, EVENT.sabbatical, EVENT.social],
    slot: 1,
  },
];

const rewardsBalances = [
  { id: "demo-pts-1", programId: "chase-ur", holder: "Jordan", points: 184000, asOf: dateIn(0, 1) },
  { id: "demo-pts-2", programId: "chase-ur", holder: "Sam", points: 61000, asOf: dateIn(1, 28) },
  { id: "demo-pts-3", programId: "amex-mr", holder: "Jordan", points: 96500, asOf: dateIn(0, 1) },
  { id: "demo-pts-4", programId: "united", holder: "Jordan", points: 42000, asOf: dateIn(2, 14) },
  { id: "demo-pts-5", programId: "hyatt", holder: "Sam", points: 61500, asOf: dateIn(0, 2) },
  { id: "demo-pts-6", programId: "aadvantage", holder: "Sam", points: 15000, asOf: dateIn(4, 6) },
];

// Only where the household's own figure differs from the catalog's.
const rewardsValuations = { "chase-ur": 190, hyatt: 170 };

const rewardsTrips = [
  {
    id: "demo-trip-1",
    name: "Tokyo, two seats",
    date: dateIn(-4, 12),
    programId: "united",
    points: 140000,
    taxesCents: 11200,
    cashPriceCents: 420000,
  },
  {
    id: "demo-trip-2",
    name: "Four nights, Kyoto",
    date: dateIn(-4, 16),
    programId: "hyatt",
    points: 60000,
    taxesCents: 0,
    cashPriceCents: 185000,
  },
  {
    id: "demo-trip-3",
    name: "Thanksgiving flights",
    date: dateIn(-1, 22),
    programId: "aadvantage",
    points: 50000,
    taxesCents: 2240,
    cashPriceCents: 68000,
  },
];

/** The whole household, as the `{ key: value }` snapshot storage speaks in. */
export function demoBooks() {
  const { rows, giftIds } = buildLedger();
  const goalAssignments = buildGoalAssignments();
  const assignments = absorbSurplus(rows, buildAssignments(rows), goalAssignments);

  return {
    transactions: rows,
    payees,
    assignments,
    budgets,
    budgetGroups,
    accounts,
    accountBalances: buildBalances(rows),
    incomeSources,
    paySchedule,
    retirementPlan,
    donationRecipients,
    donations: buildDonations(rows, giftIds),
    donationGoals,
    savingsGoals,
    savingsGoalAssignments: goalAssignments,
    schedules,
    emergencyFund,
    lifeEvents,
    retirementScenarios,
    rewardsBalances,
    rewardsValuations,
    rewardsTrips,
  };
}

/* ------------------------------------------------------------------ plumbing */

/** Where local mode's books live: the guest scope in a browser, the bare keys in
 *  the shell. The same answer `storage.localScope()` gives, restated here
 *  because the seed must never reach a signed-in account's scope. */
const scope = () => (isDesktop() ? null : GUEST_SCOPE);

/** Whether a Supabase session is sitting in this browser. Read rather than
 *  assumed, because switching the app into local mode under a live session would
 *  hide books the developer is signed into. */
function hasSession() {
  try {
    return Object.keys(localStorage).some((key) => /^sb-.+-auth-token$/.test(key));
  } catch {
    return false;
  }
}

/**
 * Where the books that were here before a forced seed are kept.
 *
 * Unscoped, raw, and deliberately not one of `STORE_KEYS`: it is this browser's
 * own bookkeeping rather than anybody's books, the distinction `PENDING_SYNC_KEY`
 * already draws. It exists because a developer who has been using local mode has
 * *real* books sitting in exactly the scope this writes to, and "try the demo
 * household" must not be a one-way door.
 */
const BACKUP_KEY = "demoBooksBackup";

/**
 * What this browser has already been given, and the reason a reload does not
 * wipe the afternoon's testing.
 *
 * "Always seed the demo" and "seed on every page load" are not the same
 * instruction, and only the first is useful: the whole point of the dev server
 * is to click through the app, and a seed that ran on every load would throw
 * away every transaction entered, every figure typed and every scenario saved
 * the moment the page refreshed. So the stamp records that this browser has been
 * seeded **at this version of the data**, and the seed runs when it has not.
 *
 * `SEED_VERSION` is therefore the one thing to bump when the household below
 * changes: every dev browser picks the new books up on its next load, and
 * nothing else has to be cleared by hand.
 *
 * It is set by `clear()` as well as by the seed, because the stamp says "this
 * browser has been dealt with" rather than "the demo is present" — without that,
 * emptying local mode would last exactly until the next reload.
 */
const STAMP_KEY = "demoBooksSeeded";
const SEED_VERSION = "1";

const stamp = () => {
  try {
    localStorage.setItem(STAMP_KEY, SEED_VERSION);
  } catch {
    /* storage disabled; the seed will simply run again next load */
  }
};

const stamped = () => {
  try {
    return localStorage.getItem(STAMP_KEY) === SEED_VERSION;
  } catch {
    return false;
  }
};

export function seedDemoBooks({ reload = false } = {}) {
  const target = scope();

  // Archived before the write, never after, and only where there was something
  // to lose — a second seed must not overwrite the archive with the demo.
  const occupied = hasStoredBooks(target);
  if (occupied && localStorage.getItem(BACKUP_KEY) == null) {
    try {
      localStorage.setItem(BACKUP_KEY, JSON.stringify(snapshotScope(target)));
    } catch {
      return { ok: false, error: "Could not archive the books already here. Nothing was written." };
    }
  }

  replaceScope(target, demoBooks());
  if (!hasSession()) setGuestMode(true);
  stamp();
  if (reload) window.location.reload();
  return { ok: true, archived: occupied };
}

/** Empty local mode and leave it empty — the stamp is what makes it stick across
 *  a reload. The archive survives, so `restore` still works. */
export function clearDemoBooks({ reload = true } = {}) {
  replaceScope(scope(), {});
  setGuestMode(false);
  stamp();
  if (reload) window.location.reload();
  return { ok: true };
}

/** Put back whatever a forced seed wrote over, and let the archive go. */
export function restoreDemoBackup({ reload = true } = {}) {
  const raw = localStorage.getItem(BACKUP_KEY);
  if (raw == null) return { ok: false, error: "Nothing was archived — there is nothing to put back." };

  let snapshot;
  try {
    snapshot = JSON.parse(raw);
  } catch {
    return { ok: false, error: "The archive will not parse. It has been left where it is." };
  }

  replaceScope(scope(), snapshot);
  localStorage.removeItem(BACKUP_KEY);
  if (reload) window.location.reload();
  return { ok: true };
}

/**
 * Put the demo household in front of whoever opens the dev server, once per
 * version of it.
 *
 * Called from `index.js` before the first render, because four store
 * initialisers read storage synchronously to build their lazy defaults and an
 * effect would be far too late.
 */
export function installDemoBooks() {
  window.demoBooks = {
    seed: (options) => seedDemoBooks({ reload: true, ...options }),
    restore: restoreDemoBackup,
    clear: clearDemoBooks,
    snapshot: demoBooks,
  };

  if (stamped()) return;

  const seeded = seedDemoBooks();
  console.info(
    seeded.ok
      ? "[demo books] Seeded a household into local mode. Edits survive a reload; " +
          "demoBooks.seed() starts over and demoBooks.clear() empties it." +
          (seeded.archived ? " What was here is kept — demoBooks.restore() puts it back." : "")
      : `[demo books] ${seeded.error}`
  );
}
