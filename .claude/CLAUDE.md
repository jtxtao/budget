# CLAUDE.md

Personal budgeting app: Create React App at the repo root, **one household per account**, backed by Supabase (Postgres + Auth) with **no server of our own** — and, over the same bundle, an Electron desktop app whose books are a file the household owns.

Every store persists through `useSyncedState` (`src/hooks/useSyncedState.js`) — `useState`-shaped, JSON, optional third `migrate` arg applied to stored values but never to the default.

## Where the rest is written down

This file is the orientation and the rules that bite everywhere. **Each companion doc in `.claude/` is the single place its subject's rules live** — a rule stated twice eventually disagrees with itself — and each says at the top when to read it.

| Doc | Read it before |
|---|---|
| **`STORES.md`** | changing a store's shape, its validation, or a cascade |
| **`DERIVATIONS.md`** | changing any cross-store hook's maths, any sum the envelope identity covers, or a chart that reads one |
| **`TESTING.md`** | writing or changing any test, or working out where a claim belongs |
| **`UI.md`** | writing UI — the palette, the two modes, the shared components |
| **`ACCOUNTS.md`** | touching auth, sync, or storage scoping |
| **`DESKTOP_APP.md`** | touching the Electron shell, the books file, or packaging |
| **`ASSISTANT.md`** | touching "Ask" |

Plans, not descriptions of what exists: `LIFE_EVENTS.md`, `END_TO_END_ENCRYPTION.md`, `LOANS.md`.

## Commands

Run from the repo root.

- `npm start` — dev server at http://localhost:3000
- `npm test` — Jest + RTL, watch mode. Single file: `npm test -- --watchAll=false src/App.test.js`
- `npm run build` — production build
- `npm run desktop` — the shell against the dev server, hot reload and all
- `npm run desktop:build` — packaged into `dist/win-unpacked` (etc.), no installer
- `npm run desktop:dist` — the installer for the platform you are on
- `npm run shell-config` — regenerate `electron/shell-config.json` alone; the three above already do

No lint script; CRA's ESLint (`react-app`) runs during `npm start` / `npm test`. Credentials live in `.env.local` (gitignored; copy `.env.example`). `supabase/schema.sql` is the whole server side and is idempotent. `node buildResources/makeIcon.js` redraws the icon from the palette; output is committed, so run it when a colour moves.

## Recurring conventions

Stated once here. Where a rule in a companion doc names one of these, this is it.

- **Inert but kept.** A reference to another store's record (a payee's `defaultBudgetId`, a schedule's `accountId`, an offer's `budgetIds`, `accountIds` anywhere, a life event's `propertyRef`) is **never validated against live records and nothing cascades into it**. A dangling id contributes nothing, resolved where it is read. This is what keeps the dependency graph one-way.
- **Both answers kept.** Where a question has two legitimate answers (derived vs typed), both are stored and a `…Source` field says which is in force; the other is never cleared. Same for fields a cadence or kind does not currently read. Comparing them is the point, and a switch that destroyed what it switched away from could only be used once.
- **Holds no money.** Stores of intentions, guesses and statements (`Schedules`, `SavingsGoals`, `Retirement`, `LifeEvents`, `Scenarios`, `Rewards`, `Donations`, `EmergencyFund`) are read by a hook or a page, never by the envelope or balance maths. Adding a record there moves no figure in the books.
- **`{ ok, error }`.** Every mutator that can reject input returns it, and **callers must surface the error** — never close a modal as though the write succeeded. Batch mutators validate the **whole batch before writing any of it**.
- **Blank vs zero.** A blank is a question left open; zero is an answer. Where both are meaningful (a balance snapshot, a goal, a rate) blank **removes the record** rather than storing zero.
- **Nothing is invented.** No migration backfills a decision nobody made — no date on an undated record, no repair of an incoherent split.
- **Commit on blur** for a figure edited in place, **on change** for a select or a control with nothing to half-type. A refused edit goes back, says why, and the input is keyed on the stored value so it re-seeds.

## Money and dates

- **Money is an integer number of cents**, always in a `…Cents` field. Never floating-point dollars. Parse with `toCents`, render with `formatCents` (`src/utils.js`); `toCents` returns `null` for junk, which is how contexts reject bad input instead of writing `NaN`.
- `toCents` takes a figure written the way figures are written ("$1,234.56", "1 234.50", a leading sign) — what `formatCents` itself writes, so a field can show its figure as money and hand it straight back. **Never `parseFloat`**: it reads "1,234.56" as **1** and reports success. Once symbol, separators and spaces come off, what is left must be a number and nothing else, so "12 apples" is `null`.
- **Rates are an integer number of basis points**, always `…Bps`: `toBps` / `fromBps` / `formatBps`, same `null`-for-junk discipline, a "%" taken the way `toCents` takes a "$". A rate stored as `0.025` is a float the retirement projection raises to the power of thirty.
- **Transactions carry a `date`** (`"YYYY-MM-DD"`, local calendar via `todayISO` — never `toISOString`, which is UTC). Periods (`"YYYY-MM"`) are always **derived** with `toPeriod`, never stored, so the two cannot disagree. Legacy records have `date: null` and display as "Undated".
- **Compare periods with `periodLTE`, never a bare `<=`** — `null <= null` is `true`, which sweeps undated records into sums that already count them. Step months with `addMonths`, never string arithmetic (`"2026-13"` sorts before `"2027-01"`).
- Migrations live next to the store owning the key and are keyed on **field presence** (`"amount" in record`), not a version counter, so they are safe to re-run.

## Routing

`react-router-dom` v7, pinned to a patched release. CRA's Jest resolver needs the `react-router/dom` mapping in `package.json`; keep it when updating the router. The shared `routerFuture` flags remain compatible with the existing router wrappers.

`src/navigation.js` is the single source of truth for pages, feeding both the route table in `App.js` and the tab bar in `AppShell.js` — **adding a page means adding one entry there**. `src/App.js` is only shell; each page owns its state and modals.

| Route | Subject |
|---|---|
| `/` | Dashboard — today's figures, accounts and their last reconciliation, categories as the plan groups them, the one door to moving money between envelopes |
| `/transactions` | The editable register, a slim to-be-assigned bar, the ledger-entry modal, the split editor, assignment |
| `/plan` | Categories, estimates and goals, expected income, pay schedule, accounts and openings, the emergency fund, the balance-history grid (closed, at the foot) |
| `/net-worth` | Hero figure and band split, stacked chart + table twin, holdings by band, settling a statement, the monthly pass |
| `/loans` | Per-loan cards and totals, the hero and four tiles, balance-over-time chart, pay-it-off-faster with a sensitivity table, the mortgage/car panel, the full schedule (closed, at the foot) |
| `/retirement` | The outlook, year-by-year chart + table twin, net worth by age, the account picker, assumptions, scenarios |
| `/reports` | The window, headline figures, bucket split, cashflow chart, spending-by-day heat map calendar, where-it-went flow diagram, plan-vs-actual chart, spending by category ranked, per-category drill-in |
| `/donations` | A year of giving: given against claimable, the year's gifts, the goal, the organizations |
| `/savings-goals` | Goals with target, what is saved (assigned plus any off-budget holding), what has been spent from them, remaining, this period's contribution; spending a goal into a category; closing one out into the archived list; read-only to-be-assigned above |
| `/rewards` | Card offers and credits, which card to reach for, each card's fee against what it earns, then points/miles: value per point, catalog vs the household's own, planned trips |

`Placeholder` marks what is still to come: asset allocation (`/net-worth`), non-cash gifts and pledges (`/donations`), a recurring filter and CSV export (`/reports`).

**The dashboard has no period selector.** Everything on it is as of `todayISO()`, read once in the page so the date, the countdown and the reconciliation ages cannot disagree. Walking back through the books is the register's job, and **funding a month ahead is `AssignIncomeModal`'s** — the month is a control on that form rather than on any page, so the pool keeps one door and the dashboard keeps one date. The Net worth page *does* have a month, because half of what is on it is typed in and the month it was typed for is the meaning of the figure. The Retirement page has none, because nothing on it is about a month at all.

**The dashboard and the register cut the same books along different axes.** What each *envelope* holds is answered once, on the dashboard, by `CategoryLedgerTable`. What *happened*, line by line, is the register. The one envelope figure on the register is what is left to assign. **Do not put a grid of envelope cards back on `/transactions`.**

## State: seventeen providers in `src/contexts/AppProviders.js`

Add stores there, not in `index.js`. IDs are generated with `uuid` v4 **in the context**, never in form components. Each context memoises its value. **Cross-store maths belongs in a hook, never in a provider.**

`BooksKeyProvider` (`src/contexts/BooksKeyContext.js`) does not join this count: it wraps `AppProviders` from outside, in `index.js`, alongside `AuthProvider` and `SyncProvider` rather than among the seventeen stores. It holds the account's key record and the unwrapped master key, never a store's own data. **`ACCOUNTS.md` is the detail** — the key design (why envelope encryption, why two passwords, why the local cache stays plaintext, why receipts are in scope), the five layers in `index.js`, and the storage-key inventory.

The stores: `Transactions`, `Payees`, `Schedules`, `EmergencyFund`, `Assignments`, `Budgets`, `Accounts`, `IncomePlan`, `PaySchedule`, `Retirement`, `Donations`, `LifeEvents`, `Scenarios`, `Rewards`, `SavingsGoals`, `SavingsGoalAssignments`, `Loans`. **`STORES.md` is the field-by-field detail.**

**Provider order is a cascade order** — a store that cleans up after another's delete sits *outside* it:

- `TransactionsProvider` + `AssignmentsProvider` wrap `BudgetsProvider` (deleting a category takes its spend and its funding)
- `TransactionsProvider` wraps `AccountsProvider` (deleting an account cuts its transactions loose) and `PayeesProvider` (detach on delete, repoint on merge)
- `DonationsProvider` wraps `TransactionsProvider` (deleting an outflow takes the statement that it was a gift)
- `SavingsGoalAssignmentsProvider` wraps `SavingsGoalsProvider` (deleting a goal drops every assignment to it)

A deleted category's funding **moves** to `UNCATEGORIZED_BUDGET_ID` (`src/contexts/constants.js`) — dropping it would ask the user to fund the same purchase twice. A deleted goal's simply stops existing and the money reappears in "to be assigned". Each store references the other by id and never reads it back.

### The three shapes a ledger record takes

**`TransactionsContext` is one ledger for every movement of money**, discriminated by `kind` (`TRANSACTION_KINDS.INFLOW` / `OUTFLOW` / `TRANSFER`), never a signed amount; `amountCents` is a non-negative magnitude. Three rules are load-bearing far outside that store (`STORES.md` has the store's own detail):

1. **An outflow must name a `budgetId`; an inflow may.** An inflow with no category is income into the pool; an inflow *with* one is a **refund** against that category. Spend $100 on food, be paid back $60, food shows $40 of activity.
2. **A split's parts add up to `amountCents` exactly.** The envelopes read the parts while every balance reads the whole, and the two agree only because of that rule.
3. **A transfer's meaning depends only on which side of the budget boundary each account sits** (`insideBudget`; **`null` is inside**):

| source | destination | budget effect |
|---|---|---|
| spends through | spends through | **none** — a card payment, checking → savings |
| spends through | off budget | an **outflow** against `budgetId` — a 401(k) contribution |
| off budget | spends through | **income to assign** — a withdrawal into checking |
| off budget | off budget | **none** — a rollover |

**`budgetLegs(transaction, insideBudget)` is what every consumer reads**, and it returns a **list** — one leg per split part, one for an undivided record, none for a transfer the budget never sees. One list on both sides of the identity below, so a split or a transfer cannot be counted as cash on one side and missed on the other.

## The envelope identity

`useEnvelopes(period)` returns one row per budget id, one row per savings goal, and the pool:

```
activity(b, p)   = refunded(b,p) − spent(b,p)          ← signed
available(b, P)  = Σ over p ≤ P of [ assigned(b,p) + activity(b,p) ]     ← rollover on, the default
available(b, P)  = a walk over p ≤ P, floored at zero at every boundary strictly before P   ← rollover off
available(g, P)  = Σ over p ≤ P of assigned(g,p)       ← a goal, and nothing else
assignedAhead(P) = max(0, Σ over p > P of [ Σ_b assigned(b,p) + Σ_g assigned(g,p) ])
toBeAssigned(P)  = opening(P)
                 + Σ over p ≤ P of [ poolIncome(p) − Σ over b of assigned(b,p)
                                                   − Σ over g of assigned(g,p) ]
                 − assignedAhead(P)
                 − forgivenOverspend(P)
```

**A savings goal draws on the same pool a category does** — a dollar diverted to the wedding fund cannot also fund groceries. There is no second pool anywhere. A goal may also *name* off-budget accounts holding its money (an invested house deposit), and that figure is on **neither** side of the identity — it was never the budget's to assign — so it is reported beside the assignment by `useSavingsGoalEnvelopes` and never folded into `goalRows`.

**A category may opt out of rollover** (`budgets[].rolloverEnabled === false`, stored only once stated — every category rolls over until told otherwise). Its overspending is not carried into next month as a debt against it: `available(b, P)` is not the flat closed-form sum but a walk, month by month, that forgives a negative running total at every boundary it crosses before P. What is forgiven is real spending that really happened, so it cannot just vanish from the identity — `forgivenOverspend(P)` is the running total of everything floored away this way, summed across every opted-out category, and it comes off the pool exactly as `assignedAhead` does: the deficit is covered automatically from "to be assigned" rather than following the category into the next month. Zero whenever no category has opted out.

**The invariant**, asserted after every mutation by the tripwire in `dataModel.test.js`:

```
toBeAssigned + reserved + assignedAhead + Σ available + Σ goal available === opening + cumulative inflow − cumulative gross spend
```

**Three terms are money that is still there and no longer free**, each subtracted from the pool and reported back so the identity closes over it: **`reserved`**, the emergency fund held back; **`assignedAhead`**, a month funded before it arrived — because **an assignment, unlike a transaction, may be dated ahead on purpose**, and a pool that offered that money again would let one dollar fund two months; and **`forgivenOverspend`**, above. All three are floored at zero (or, for the last, a sum of already-non-negative corrections).

The assignment terms cancel algebraically, so this checks **coverage, not arithmetic**. **`DERIVATIONS.md` carries the five conditions that keep it true**, and the terms in full — read them before touching any sum on either side.

**The balance sheet is the other cut of the same ledger**: `balance(a, P) = opening(a) + Σ inflows − Σ outflows, through P` (`useAccountBalances`, derived and never stored). Envelopes say what money is *for*, this says where it *is*. `accountBalancesAt` **stays the only definition of what an account holds.**

## The eleven cross-store hooks

`useEnvelopes`, `useAccountBalances`, `useNetWorth`, `useRetirementProjection`, `useSpendingReport`, `useGiving`, `useSavingsGoalEnvelopes`, `useEmergencyFund`, `useCardOffers`, `useCardValue`, `useLoans`. Each owns a definition no single store can own, and the pure modules beside them (`paySchedule`, `recurrence`, `cadence`, `netWorthProjection`, `rewards`, `chartAxis`, `cashflowSankey`, `bucketTones`, `cashback`, `payeeSearch`, `payeeDefaults`, `duplicates`, `receipts`, `socialSecurity`, `amortization`) own the arithmetic React would only be in the way of.

**`DERIVATIONS.md` is the detail**, including which hooks are deliberately *not* in the eleven and why `useUpcoming` must never join them, the four cadence names that look consolidatable and are not, and the two `plannedCents` figures that look alike and are not.

## Testing

**Read `TESTING.md` before writing or changing a test.** It carries the environment gotchas (jsdom's missing `<dialog>`, `resetMocks: true`, money fields being textboxes, the dnd-kit wait, why `electron/` tests live in `src/`, the guarded WebCrypto and `TextEncoder`/`TextDecoder` polyfills jsdom 16 ships without), the seeding rules (real providers over mocked hooks, an account before any transaction, whole stored records), which suite covers what — including `booksCrypto.test.js`, `BooksKeyContext.test.js` and `SyncContext.test.js`, the three the key design added — and the six tripwires.

**The six tripwires — `dataModel.test.js`, `useRetirementProjection.test.js`, `netWorthProjection.test.js`, `useSpendingReport.test.js`, `storage.test.js`, `amortization.test.js` — must stay green through any change to the maths**, and each asserts its claim from outside the code under test. What each one pins down is in `TESTING.md`; weakening one to make a change pass is never the answer.

## Agent skills

### Issue tracker

Issues are tracked as GitHub Issues in `jtxtao/budget`. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root (neither exists yet — created lazily by `/domain-modeling`). See `docs/agents/domain.md`.
