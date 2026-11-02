# STORES.md

The sixteen providers in `src/contexts/AppProviders.js`, field by field. `CLAUDE.md` carries the cascade order, the recurring conventions these rules lean on, and the envelope identity; this is the detail behind them. **Read this before changing a store's shape, its validation, or a cascade.**

## `TransactionsContext`

**One ledger for every movement of money**, discriminated by `kind` (`TRANSACTION_KINDS.INFLOW` / `OUTFLOW` / `TRANSFER`), never a signed amount; `amountCents` is a non-negative magnitude.

- **An outflow must name a `budgetId`; an inflow may.** An inflow with no category is income into the pool; an inflow *with* one is a **refund** against that category — the money was already assigned on its way out. Spend $100 on food, be paid back $60, food shows $40 of activity. `""` from an unpicked select is normalised to `null` at the boundary.
- **Every new record must name an `accountId`** — refused at the boundary. `accountId: null` and the Uncategorized sentinel still *read* fine (legacy records, the delete cascade) but cannot be written.
- **`payeeId` names who the money went to; `description` is the note beside it.** Nullable, and **no rule requires it** — this store is mounted above `PayeesContext` so it cannot check that a payee exists, and a cash withdrawal, a transfer and every record written before the field existed all name nobody. `migrateTransactions` stamps `payeeId: null`, purely additive like `toAccountId` and `splits`, and **mints nothing from the text a legacy row already holds**, which stays where it is as that row's note.
- Every rule a record has to satisfy is written out once, as `RULES`, and checked through `firstBroken`, because two callers check the same rules against different amounts of the record. `addTransaction` builds a whole record and checks all of it. **`updateTransaction` takes a patch and checks only the rules the named fields could break** — which is what lets the register commit one cell at a time and a legacy row (no date, no account) have its description fixed without being asked to invent the rest. It cannot *open* one of those gaps: clearing a date or an account touches that field, so the rule runs and refuses. The cross-field rules are "an outflow names a category" and, for a transfer, "names a second account, and a different one" — each lists every field it reads so either side moving re-checks it. A patch that changes nothing is not written, so tabbing across a row does not re-render every consumer once per column.
- `reassignBudgetTransactions` moves **both kinds** and `getBudgetTransactions` returns both, so a delete cannot strand a refund away from the spend it offsets.
- `deleteTransaction` also calls `removeDonation`: a donation record is a statement *about* an outflow and holds no money, so once the outflow is gone there is nothing left for it to describe. A cascade, unlike `detachAccountTransactions`, where what is left is the money and the money still moved.
- `detachAccountTransactions` cuts **both** sides of a transfer. `detachPayeeTransactions` and `repointPayeeTransactions` are the two cascades `PayeesContext` calls — the first is `detachAccountTransactions` one field over, the second is what a merge is made of.
- The lazy default folds the old `income` and `expenses` keys in via `foldLegacyLedger`; the old keys are left in storage. `readStoredLedger` is the no-React read for `AssignmentsContext`'s lazy default.

### Splits

**One movement of money may be divided between categories.** `splits` is null, or a list of two or more `{ id, budgetId, amountCents }` parts adding up to `amountCents` **exactly** — enforced in `RULES`, and the rule the whole feature rests on: below it the envelopes read the parts while every balance reads the whole, and the two agree only because of it.

Parts on the one record rather than a parent and its children — the transfer's choice for a sharper version of the transfer's reason: two rows that can be edited apart will eventually disagree about the amount, and the division then creates or destroys money.

- A part names a category and carries a **positive** amount: money left unfiled inside a split would be indistinguishable from a smaller transaction, and a negative part would be a refund hiding inside an expense.
- While a record is split its own `budgetId` is **inert but kept** — it is what the record falls back to when the division is undone.
- Because the sum rule names `amountCents` as well as `splits`, retyping the total alone is refused, which is why the register sends a split row's figure to the editor instead of taking it in the cell.
- `migrateSplits` is the one migration here that **drops** what it read: a division that does not add up loses the division and keeps every cent, because no money is lost by falling back to one category and an incoherent split is the single state in which the two cuts of the books disagree. Repairing one would invent a decision nobody made.
- `reassignBudgetTransactions` moves a part like any other filing and **merges two that land on one category**; merging down to a single part ends the division, since a division of one is the record it already was.

**`budgetLegs(transaction, insideBudget)` is what every consumer reads**, and it returns a **list** — one leg per part, one leg for an undivided record, and none at all for a transfer the budget never sees. One list and the same list on both sides of the identity, which is what makes it impossible to count a split or a transfer as cash on one side and miss it on the other.

### Transfers

**The third kind and the only record that names two accounts** — `accountId` is where the money left, `toAccountId` where it arrived. One record, not a linked pair: a pair would need every mutator to keep two rows in step on the amount, the date and the description, and one leg orphaned by a missed cascade would create or destroy money in a ledger whose one invariant is that the sums cover every row. One record cannot disagree with itself, so a delete stays a delete and a patch stays a patch.

What a transfer means to the budget is `budgetLegs`' answer and depends on nothing but which side of the boundary each account sits (`insideBudget`, a pure export on `AccountsContext`, for which **`null` is inside** — a detached side keeps its money in the envelope maths, the stance `accountBalancesAt` already takes):

| source | destination | budget effect |
|---|---|---|
| spends through | spends through | **none** — a card payment, checking → savings |
| spends through | off budget | an **outflow** against `budgetId` — a 401(k) contribution |
| off budget | spends through | **income to assign** — a withdrawal into checking |
| off budget | off budget | **none** — a rollover |

Row one is why a credit card can finally be paid off: the money was budgeted on its way out *through* the card, so settling it is not a second call on any envelope, and on-budget cash is unmoved because the card's balance rises by what checking loses. Row two is exactly what the app already did when a contribution was filed under a savings category — what is new is only that the holding is credited too.

**The store deliberately does not check the matrix**: `TransactionsProvider` is mounted *above* `AccountsProvider` so a delete can detach transactions, so it cannot see a scope. That is the shape of the bound `DonationsContext` cannot check, and it is answered the same way — `AddTransactionModal` refuses a boundary-crossing transfer with no category, and `budgetLegs`' consumers fall back to `UNCATEGORIZED_BUDGET_ID`, so the identity holds whatever reaches storage.

A `budgetId` or a `toAccountId` left on a record that has stopped needing it is **kept, not cleared**. **Money arriving from outside the budget is the one place a split is not read**: it is income to the pool, and there are no categories in the pool, so a division on it is inert in exactly the same way.

## `PayeesContext`

`{ id, name, defaultBudgetId, defaultSplit, defaultAccountId, defaultKind }`, who the money went to. The transaction names it by **id**, which is the whole point — a rename is one write and every row that names the payee follows it, because no row was ever holding the name.

- `defaultBudgetId` is nullable and `null` is the ordinary case; it is **a default and nothing more**, the rule a recipient's `deductible` flag and a group's bucket both keep, so correcting where a shop is usually filed in March cannot restate what was filed in February. Inert but kept — a default naming a deleted category is resolved where it is read (`AddTransactionModal` guards a seeded category; `PayeeList` gives a stored-but-unknown value an option of its own).
- **Two normalisers with different jobs**: `normalizePayeeName` (trim, collapse, lowercase) is **identity** and the only thing the clash check reads, while `searchKey` in `src/payeeSearch.js` also drops punctuation so typing "att" finds "AT&T" — folding punctuation into identity as well would refuse to let "ATT" and "AT&T" both exist, and they may be two real payees.
- **Three more defaults, on the same terms** — each decides what the entry form opens on, never restates a row, and is inert but kept:
  - `defaultSplit` is null or two or more `{ budgetId, shareBps }` adding up to exactly 10000 (`src/payeeDefaults.js`). **Shares, never amounts**, so the form lays it out against whatever total is typed through `apportion` and the parts meet the sum rule by construction. Where set it is what the form opens on, ahead of `defaultBudgetId`, which is **kept beneath it** — "Unsplit" on `PayeeList` brings the single category back. A split left with fewer than two live categories is not laid out; the category beneath it is.
  - `defaultAccountId` — the account the form opens on in place of the last-used one; one no longer spent through is passed over.
  - `defaultKind` — null (money out, the ordinary case) or `inflow`/`outflow`; anything else is refused.
- **Nothing is learned silently.** The entry form offers one unticked "Next time for …" box per answer that differs from what the payee would have opened on; only ticked ones are written, after the ledger write lands (a payee the entry creates takes them in `addPayee`, since it is not in the render's list yet). `AddScheduleModal` reads the account and direction too, never the split — a schedule is never divided.
- `deletePayee` detaches its transactions and keeps them, `deleteRecipient`'s rule.
- `mergePayees({ fromIds, intoId })` is what the entity exists for: several sources at once because a household tidying up is dealing with a cluster, **the whole batch validated before anything is written**, the **ledger written first** (rows pointing at a payee that still exists is a merge that did not happen; payees deleted out from under their rows is not survivable), and the survivor **adopts a default only where it has none of its own** — the category and the split as **one** answer (taking a source's split would refile a survivor filed under one category), the account and direction apart.

## `SchedulesContext`

`schedules`: `{ id, kind, payeeId, amountCents, accountId, budgetId, description, cadence, startDate, endsOn, enteredThrough, occurrenceDecisions, anchorDay? }` — the transactions the household already knows about: rent on the 1st, the quarterly premium, a second paycheque.

**A schedule is a standing intention and holds no money.** What is *expected* lives here, what happened lives in the ledger, and no envelope, balance or report reads this store — so adding a schedule cannot move a figure anywhere in the app.

**Nothing posts itself**, and that is the honest design rather than a limitation: nothing in an app with no backend runs at midnight, so a store that wrote its own rows would be claiming the rent went out on a day nobody opened the app. What it buys is that the row is *offered*, pre-filled, the moment it is due, and that an unpaid one stays visible as unpaid.

**`enteredThrough` is the legacy handled-history boundary.** Existing dates at or before it remain handled. New recording, skipping, and matching use `occurrenceDecisions`, keyed by scheduled date, with `{ status: "recorded" | "skipped", transactionId? }`. Missing decisions migrate to an empty object. `resolveOccurrence` validates an outstanding calendar occurrence and prevents reusing a transaction across schedules; `reopenOccurrence` removes a decision explicitly without touching the ledger. Editing or deleting a linked payment never silently reopens its reminder. References to deleted transactions are kept and explained in the handled-occurrences view.

New schedules start with nothing handled. When the transaction form creates a schedule, `addSchedule` accepts `recordedTransactionId` and resolves its first occurrence in the same store write. `advanceSchedule` and cursor seeding remain for legacy compatibility, not new UI actions. Updating a schedule preserves decisions and the legacy boundary.

**`anchorDay` is optional calendar intent**, used for monthly, quarterly, and annual schedules inferred on a day that may be clamped in the next month. For example, a suggested first date of February 28 with `anchorDay: 31` recurs on March 31. The first date must be the anchor day or the last day of a shorter month. Without this field, the start date supplies the day as before. Changing the first date in the form resets the explicit anchor to that date's day.

**Suggestions hold no money.** Pure rules in `domain/transactionSuggestions.js` derive category evidence, recurring-payment candidates, and possible reminder matches. Memoized hooks join live references, and confirmation rechecks the current payment and occurrence. Categories require three eligible outflows and 80% agreement among the latest 20 within 12 months; saved defaults win. Discovery checks three consecutive payments, two days of calendar drift, and amounts within 5% of their median. Matching requires exact payee/account/direction/category, three days of date drift, and 5% amount tolerance. Splits are excluded. Nothing automatically creates schedules, changes defaults, posts transactions, or reclassifies historical spending reports. Suggestions are recomputed; dismissals stay in provider memory for the current session and survive page navigation, but are not synced or written to the books file.

Every reference is inert but kept — this store reads no other, so a schedule naming a deleted account is resolved where it is read, and the enter form refuses rather than writing against it. Nothing cascades either way, so this provider's position in the order is free. **Two kinds, not three**: a transfer is not schedulable, since what one means to the budget depends on which side of the boundary each end sits and that rule already lives in `AddTransactionModal`.

## `EmergencyFundContext`

One record `{ targetSource, monthsCovered, targetCents, accountIds, accountAmounts, holdBack }` — how long the household means to be able to carry itself and where the money for it sits.

**It holds no money and derives no target**: what is stored here is the *shape of the question*, and the figure is `useEmergencyFund`'s, because it is a join across the plan and the balance sheet.

- **The target comes off the essentials bucket rather than being typed**, which is the whole point: an emergency fund is not a round number somebody likes, it is however long the household could cover its own necessary spending with no income — and the app already asks which categories are necessary, so a hand-typed figure would be a second, staler copy of an answer the books already hold. Raise the rent on the plan and the fund that has to cover it rises the same day.
- **Both answers are kept.** A typed figure is a real answer rather than an escape hatch — a redundancy package in mind, or essentials not all on the plan yet, is something the derivation cannot know.
- `monthsCovered` has **no blank state** unlike every other nullable field here: there is always a multiple in force, so an empty one would be a target of nothing rather than a question left open, and the field puts the old figure back. Capped at `MAX_MONTHS_COVERED` (120, the report window's ceiling) because past that the figure has stopped being a buffer and become a retirement plan.
- `accountIds` is inert but kept, so an id whose account was deleted reads as an account contributing nothing.
- **`accountAmounts` (id → cents) lets part of a ticked account be the fund**, because almost nobody opens an account only for this; absent is the whole balance (what a tick always meant), the figure counted is never more than the account holds, and an amount survives its account being unticked. `setFundAccountAmount` sets one — blank removes it, junk, zero and negatives are refused.
- Empty rather than "every cash account": which account is the buffer is a judgement, and guessing it would put a figure on screen nobody agreed to. Nothing cascades either way.

## `AssignmentsContext`

`assignments` per (budget, period): what was **actually put in**. Does *not* carry forward (the balance does). Zero rows pruned; negatives allowed — under rollover that is the only way to pull money back out.

**A period ahead of today is valid and always was** — `setAssignedAmount` and `setPeriodAssignments` check that the period parses and nothing more — which is what funding next month is made of. This store cannot say any more about it than that: whether the money exists to cover it is a cumulative sum over the whole ledger, so the honesty lives one level up, in `useEnvelopes`' `assignedAheadCents` (see `CLAUDE.md`'s identity). Funding a month ahead past what there is to fund it with is **not** refused, for the same reason over-funding this month is not: the app has one way of saying so and it is the one it always had — the figure goes red.

**`moveBetweenBudgets({ fromBudgetId, toBudgetId, period, amount })` is envelope budgeting's other everyday act**, beside assigning income: groceries came in under and dining out went over, so the difference moves across. It was always *expressible* — assign the source less and the destination more — but only as two edits, with the pool briefly inflated by money that was never free and the user holding the arithmetic in their head in between.

**One `setAssignments` call, so the two deltas cancel and `toBeAssigned` is untouched by construction**: the identity holds at every commit rather than only once both halves have landed, and a failure between them cannot park money in the pool. A move is a positive amount in a stated direction, so zero and negative are refused rather than quietly reversing the two selects.

It is deliberately **not** refused for leaving the source overdrawn — this store sees only assignments, so it could not check it, and covering one category out of one that has not been funded yet is a real thing to want in the week before a paycheque. The app has exactly one way of saying so and it is the one it always had: the figure goes red.

## `BudgetsContext`

`budgets` and `groups`, plus one standing `plannedCents` **estimate** per category (the same figure in every period — it describes the category, not a month) and an optional `goalCents` **goal** beside it.

The two answer different questions — what a category needs in a month against the balance it is saving towards — and only the goal is nullable: a blank estimate is a category nobody has made their mind up about and reads as zero, while a blank goal is a category not saving towards anything, which is most of them. So they are parsed by different functions: `readGoal` reads `""` as `null` (the way a goal is *removed*) and refuses zero, a negative and junk alike, since a bad parse read as null would clear the goal the user was editing. `updateBudget` tells "leave the goal alone" from "take the goal off" through `readGoal`'s `stated`, not through `undefined`.

Deleting a budget moves its outflows **and its assignments** onto the household's choice of category, `UNCATEGORIZED_BUDGET_ID` by default — asked by the delete confirmation, never a second-guess of an id it cannot find — because dropping the funding instead would ask the user to fund the same purchase twice.

Two more booleans, each **stored only once stated** so an untouched category keeps the shape it always had, and each read nowhere by the sums — only by the screens that filter what they show, "inert but kept"'s discipline one step over, because nothing else references a category's own flags back. `rolloverEnabled: false` takes a category out of the closed-form carry-in and into `useEnvelopes`' per-period walk instead — see `CLAUDE.md`'s identity and `forgivenOverspendCents` there. `hidden: true` takes a category out of the planner's default view and the assign-income fill lists without touching its money or its history; a hidden category with a real balance or this month's activity still has to appear wherever money is assigned or read, the same "editable" rule that already keeps an orphaned or zeroed-out row visible there.

### Buckets

`PLAN_BUCKETS`, in `PLAN_BUCKET_ORDER`: essentials / fun / savings / retirement — most necessary first, retirement last because it is the longest horizon of the four.

Four and not three, because **retirement is split out of savings rather than folded into it**: both are money set aside rather than spent, but a house deposit or an emergency fund is still liquid and still the household's to redirect, while a Roth contribution is not really being saved *for* anything else. Folding them together would overstate savings as a share of the plan and — through `useRetirementProjection`, which seeds `annualContributionCents` off the retirement bucket — would let a down-payment fund inflate what the household appears to be setting aside for retirement by exactly as much as a real contribution.

**Pre-tax payroll deductions never appear in any bucket**: a 401(k) leaves the paycheque before it reaches an on-budget account, so it never becomes a transaction to categorise, and `RetirementContext`'s `pretaxContributionCents` is where that half enters the plan instead.

`DEFAULT_BUCKET` is essentials rather than a fifth "unsorted" one — a category nobody has classified is being paid for regardless, and counting it as a want or as saving would flatter the split.

**Every category carries a real one — there is no "ask my group" state.** A group's bucket is only the value a new category *starts* on: `addBudget` resolves it once, at creation, and the record states its own from then on. So moving a category between groups, renaming a group, restating a group's bucket, and `deleteGroup` all leave what a category counts as alone — none of them can move money between the shares of the split as a side effect. `updateBudget` refuses `null` like any other non-bucket. The migration stamps a stored `null` with its group's bucket (read from the `budgetGroups` key by `storedGroupBuckets`), which is what the category was already counting as. `toSections` still hands every row an `effectiveBucket`; it now equals `budget.bucket`, with the section as a fallback only for storage edited by hand.

## `AccountsContext`

`accounts` (set up on `/plan`, since the list is a standing fact) and `balances` per (account, period) — a statement figure, which **any** account may carry, read only by `useNetWorth` and never by the budget's own maths.

- `setPeriodBalances({ period, entries })` writes a whole month at once, validating the batch before writing any of it, and `setBalanceHistory({ months })` carries that rule up a level for the backfill grid — a window of months lands in one commit or none, so a year of history cannot end up half written. Both fold through the same `validateBalanceEntries` / `applyPeriodBalances` pair.
- **A blank amount deletes that row rather than storing zero** — unlike assignments, zero is a real balance here (a card paid off) and "never updated this month" has to stay distinguishable from it.

### Validation

- `addAccount` / `updateAccount` validate a name, a type, a scope, an asset class from `ASSET_CLASSES`, and an **opening balance**; a liability stores `UNCLASSIFIED`, since asset class means nothing on a debt.
- **`AddAccountModal` does not ask for the class** — it was a question households could not usefully answer and only the net-worth bands read it — so `assetClassFor` derives it: an asset keeps the class it already has, and a new one is Cash on budget and Stocks off it.
- `updateAccount` validates the record **as it would stand after the patch**, so a partial update cannot slip a combination past the checks a whole one gets — and where the patch names `opening` (the form's dollar string) it **drops the stored `openingBalanceCents` before validating**, or the cents already on the record would win validate's `??` and the retyped figure would be taken and silently discarded.
- **`openingBalanceCents` is signed** — `signedOpeningCents` negates a liability, because the form asks a debt for the amount *owed*; `toStoredBalanceCents` / `toEnteredBalanceCents` are that same conversion exported as a pair, so the four forms that ask for a balance cannot come to disagree about which way a mortgage points. `openingDate` may be `null` (undated, counts from the beginning of the books).
- **A negation, not a clamp — so a card can start in credit.** A prepaid card loaded with money, a card overpaid, a card carrying a refund bigger than the month's spending: a statement prints each as a *negative* balance owed, and each is a positive thing held. Forcing the sign read all three as a debt of the same size with no figure the user could type to say otherwise. Two consequences worth holding on to: a negation is **its own inverse**, which is what lets `toEnteredBalanceCents` be the same function and the form offer back exactly what was typed; and it is **not idempotent**, so `migrateAccounts` must never re-sign a stored figure — it checks `Number.isFinite` and nothing else, or a card in credit would flip to a debt on every other load.

### Scope

**`ACCOUNT_SCOPES` (on-budget / credit-card / off-budget) is an axis of its own, orthogonal to `type`** — a card is a liability spent through and a mortgage one that is only watched, so never treat scope as a subdivision of assets.

**Only the off-budget line is load-bearing in the maths**: every derivation asks `spendsThroughBudget` (or its complement `isOffBudget`), which is true of on-budget accounts and cards alike, so a card's opening balance reduces "to be assigned", its balance derives from the ledger, and it is offered in the transaction form. A card is always a liability — `validate` refuses the asset combination, and `AddAccountModal` stops asking the kind question once the card scope is picked. Credit cards get a section of their own on `AccountList` because the total owed is the figure that panel is read for; the maths is unchanged by that split.

`scopeLabel` is the shared display name. `DEFAULT_SCOPE` is on-budget, which is also what `migrateAccounts` stamps on a record saved before the field existed — and what an unrecognised scope falls back to everywhere. Deleting an account drops its `balances` but **keeps its transactions**, detaching them.

**`archived: true` is retiring an account rather than deleting it** — stored only once stated, and read by nothing the maths touches: not `insideBudget`, not `spendsThroughBudget`, not a balance or an envelope anywhere. The one thing it changes is which accounts a *new* entry is offered — `AddTransactionModal`'s pickers, `TransactionRegister`'s, `PayOffCardModal`'s "pay from" — on the same terms an off-budget holding is already kept off the two directions that cannot use one, and `AccountList` files it under its own "Archived" panel instead of its scope's section. A transaction already filed against an archived account keeps showing it, `AccountSelect`'s "the current value always has an option" rule one step over. It is set and cleared through `updateAccount` like any other field — there is no dedicated mutator, since nothing about the write needs to be anything other than the ordinary patch every other field already goes through.

`AccountList` divides by scope first and calls out owned/owed as an inner band only when a section holds **both**, and every row carries **Edit** beside Remove — editing is `AddAccountModal` opened on the record (`account` prop), never typing over the name in the list the way a category is renamed on the plan, because an account is six interlocking answers and a row of inline controls cannot express an answer that removes the question below it. Renaming through delete-and-re-add would take the account's `balances` with it, which is what the edit path exists to avoid.

### Reconciliation and cards

**`reconciledOn`** — the day the account was last checked against a statement and agreed. Stored, not derived: it is the one fact no ledger can know. `reconcileAccount({ id, date })` is a mutator of its own (defaults to today, `null` clears it) rather than a field on `updateAccount`, because it records something the user *did* rather than restating what the account *is*. A record predating the field reads as never reconciled, not as reconciled today.

On the dashboard it is reached through **`ReconcileModal`**, which asks for the statement balance (blank is the books' own figure) and, where the two differ, writes the gap as an ordinary inflow or outflow dated today before stamping — `FixDriftModal`'s rule. **Beside it on the row is "Accurate", and it is the same stamp without the dialog**: most months the statement simply agrees, and asking for a figure nobody needed to change made the commonest answer the most expensive one. It calls `reconcileAccount` with today and nothing else.

**It is a check for today, not a box that stays ticked** — a button that goes quiet (disabled, reading "Checked") once `reconciledOn` is today. A checkbox was wrong twice over: it stood ticked for the whole stale window, as though the agreement were still being asserted, and unticking it passed `null` and *erased* the date rather than taking back the day, so a row was one stray click from reading "Never". Whether an account is overdue is a reading of that date and belongs to the date's tone and the header's count; a control has no business being a third voice on it. The store's `null` undo stays — it is simply not wired to a control that can be hit by accident.

**A credit card is paid off rather than reconciled**: `PayOffCardModal` writes a transfer from an on-budget account into the card, stamps it reconciled, and can remember the account as the card's `payFromAccountId` — a default set by `setPayFromAccount`, stored only once stated, refusing anything but an on-budget account other than the card.

**`cashbackBps`** is cash back a card pays straight onto its own balance — a prepaid card loaded with $5,000 at 1% reads $4,901 after a $100 purchase. A rate and nothing more, asked by `AddAccountModal` of an account the budget spends through, stored only once stated (blank or zero takes it off; junk and over 100% are refused). The money is an **ordinary inflow written beside each purchase, filed under the purchase's category — a refund** — so groceries shows $99 of activity, the dollar never reaches the pool, and neither the identity nor the balance sheet needs a rule for it. `src/cashback.js` is the arithmetic (nearest cent per purchase; a divided receipt is refunded part by part through `apportion`), and `useRecordCashback` is the second write, called by `AddTransactionModal` and by a scheduled bill entered from the dashboard after the purchase lands. The two rows are **never linked**: correcting or deleting the purchase leaves its cash back as it was, the way a refund and the spend it offsets are always edited apart.

## `IncomePlanContext`

The paycheques the user *expects*, by cadence. Independent of the ledger in both directions: nothing maps a transaction to the source that predicted it, so neither delete may cascade into the other.

## `PayScheduleContext`

One record `{ cadence, lastPaidOn, periodDays, daysOfMonth }`: the calendar half of the income question, where IncomePlan is the amount half.

**The cadence decides which of the other three fields mean anything** (`src/paySchedule.js` owns that mapping), and the ones it does not read are **kept, not cleared** — switching between fortnightly and twice-monthly to see which describes a new job is the point.

Every field is nullable and independent, because part of a schedule is a real intermediate state and refusing it would blank the field the user just filled in. `cadence` has **no default**: most people are paid every two weeks and the ones who are not are exactly the ones a guess would mislead.

A whole-value guard rather than a field-presence migration — the one thing it upgrades is a schedule stored as a bare day count, through `cadenceForDays` (7 → weekly, 14 → fortnightly, anything else → the custom interval), which is also what a `periodDays` set while no cadence is stated names itself. Read through `useNextPaycheck`.

## `RetirementContext`

One record `retirementPlan`: the ages, the rates, and what the plan is counting on. A store of *guesses*, outside the books, and the separation is load-bearing — the projection reads across the stores but nothing flows back, so a scenario moves no money.

**Two questions here have two legitimate answers each, and both are stored**: the starting point is either the accounts the user ticks (`accountIds`) or a figure they type (`startingBalanceCents`), and retirement spending is either a share of today's income (`incomeShareBps`, default 7000) or a typed figure (`annualSpendingCents`). A `…Source` field says which is in force and the other is kept.

**Until the list is stated (`accountsStated`) the ticks are every off-budget investment** — `retirementAccountIncluded` in `useRetirementProjection.js` — because those balances are already entered on the plan page and asking for them again as a typed figure is double entry. The first tick or untick writes what was on screen out as the list (the page passes it, since this store reads no accounts), and a plan stored before the default existed counts as stated only if it had ticked something.

**`pretaxContributionCents` is the one figure here the projection cannot derive**, and that is why it is stored rather than read off the books: a pre-tax payroll deduction leaves a paycheque before the money ever reaches an on-budget account, so it never becomes a transaction and never gets a category or a bucket. Everything else the projection reads comes from an account, an income source, or the retirement bucket; this is the half of the contribution that has no such home. `null` means **none**, not "not yet known" — most years it really is zero for a household with no payroll plan, and treating a blank as unstated would understate every projection until the user happened to find the field.

`annualContributionCents` is `null` for "whatever the plan already sets aside", which is the **retirement** bucket's estimates annualised **plus `pretaxContributionCents`** — deliberately not the savings bucket, since a house deposit sits there too. A typed figure overrides that combined total rather than only the derived half.

`usePlanHealth` grosses the same pre-tax figure onto **both** sides of its balance — `expectedIncomeCents` and `plannedCents` alike, and onto the retirement bucket's own share — so "left to plan" is unmoved by a figure that never touches a real account, while neither what the household earns nor what it sets aside is understated. **What is left to plan counts as savings in the plan's split** (`leftToPlanCents` on the savings row, `splitCents` the whole) — income with no job is money kept — but only while it is positive, and never in `plannedCents` or the verdict itself.

**All three rates are nominal — before inflation**: `growthRateBps` 1000 while saving, `drawdownRateBps` 550 once retired, `inflationRateBps` 250. The first is ten and not the seven a saver usually quotes: seven is the long-run *real* equity return, already net of inflation, and the projection deflates what it is given rather than assuming it has been deflated already. Entering seven here takes the haircut twice. The pair is set so what comes *out* is roughly the 7% real while saving and 3% real once retired that a planner actually means.

**Coherence between fields is *not* checked here** — retiring before you were born is reported by the projection as something it cannot answer yet, because refusing the field the user just typed is the one response that makes a plan uneditable. A whole-value guard rather than a field-presence migration; the key is `retirementPlan`, and the scaffold's `retirementAssumptions` (rates as fractions, a withdrawal rate this plan has no use for) is left in storage unread.

`src/netWorthProjection.js`'s assumptions sit on the same record: see `DERIVATIONS.md`.

**A third question with two answers: `returnSource`** (`RETURN_SOURCES`, default `"manual"`) says whether `growthRateBps`/`drawdownRateBps` are typed or derived. Under `"mix"` they stop being read and `effectiveReturnRates` blends `equityShareBps`/`equityShareRetiredBps` (default 8000/5000 — more in equities while the money is still a thirty-year bet) against `equityReturnBps`/`bondReturnBps` (1050/450) instead; `equityVolatilityBps`/`bondVolatilityBps` (1800/700) and the signed `returnCorrelationBps` (0) exist only for `src/retirementSimulation.js` to draw around, never for the deterministic figure. `simulationTrials` (500, bounded 100–2000) is how many Monte Carlo trials a "Run simulation" click asks for; the historical engine ignores it and runs once per year its dataset covers. All seven default to exactly today's behaviour until a household opts into `"mix"` — see `DERIVATIONS.md`'s "Probabilistic outcomes" for the maths.

## `DonationsContext`

Giving, in four keys and **no money**: `donationRecipients` (the organizations), `donations` (one statement per gift), `donationGoals` (one per year), and `givingSettings` (`{ budgetIds, excludedIds }`).

**Spending filed under a giving category is a gift without a tag**: `budgetIds: null` guesses the categories by name (`isGivingName` — donations, giving, charity, tithe, offering), a list is the household's choice from `GivingCategoriesPanel`, and `excludedIds` is what "Untag" writes for such a row so it does not come straight back. `useGiving` reads those rows as statements nobody wrote (`auto: true`) — the organization named like the payee, the whole giving part deductible unless that organization is not — and only the parts of a divided receipt filed as giving count. A tag always wins, and the first edit to an auto row writes one through `recordDonation`.

**A donation is not a movement of money, it is a statement about one.** A gift is an ordinary outflow on the register — it leaves an account, comes out of a category, counts against an envelope and appears in the spending report — and the record here is keyed on that transaction's id and carries nothing the ledger already holds: no amount, no date, no account. Copying the amount would give the household two figures for one gift and no way to tell which is the money. `{ transactionId, recipientId, deductibleCents, acknowledged, receipt }`.

- **`deductibleCents` is stated on every gift — there is no "ask the organization" state**, the same rule as a category's bucket: a recipient's `deductible` flag is only what a *new* gift starts on, resolved once at entry, so correcting an organization's status in March cannot restate what a return filed in February claimed. It is also the only form that covers a $200 gala ticket against an $80 dinner.
- **The one bound this store cannot check is "no more than the gift itself"** — the amount lives on the transaction, which it does not read — so the forms check it where the figure is in hand and `useGiving` clamps what it reads.
- Deleting an organization **keeps its gifts** and detaches them (`recipientId: null`), the same way spend outlives its category; deleting the transaction removes the tag, and untagging leaves the money alone.
- `recordDonation` is idempotent on the transaction id — one movement of money is one gift, so recording twice restates rather than duplicates.
- A goal is `{ year, source, amountCents, shareBps }` with **two legitimate answers and both kept** (`GOAL_SOURCES.AMOUNT` / `INCOME_SHARE`): comparing "a tenth of what we earn" against "six thousand" is the point. Blank takes a goal off; junk is refused.
- `ACKNOWLEDGMENT_THRESHOLD_CENTS` (25000) decides nothing — no figure moves because a receipt is missing — it only decides which gifts `useGiving` reports as still needing one.

### Receipts

**A gift can carry the charity's letter as a file**: `receipt` on the donation is `null` or a description `{ id, name, type, sizeBytes, addedOn, storedIn, sealed }` — never the bytes, since every store is one JSON document pushed whole on each write.

- **`sealed`** is `true` only for a receipt encrypted under the account's master key before it was uploaded — `storedIn: "account"` and attached after the household's books turned encryption on. It is **absent**, not `false`, on a receipt attached before encryption existed (the server still holds that file in the clear until it is re-attached) and on the `computer` / `browser` media, which are never sealed because those bytes never leave the household's own machine in the first place. `readReceipt` decrypts when `sealed` is true and takes an unsealed file as-is, the same stance `SyncContext`'s hydrate takes on a plaintext `app_state` row.

`src/receipts.js` holds the files, **where the books are**: signed in, the private `receipts` Supabase Storage bucket under `<uid>/<id>.<ext>` (the first path segment is the bucket's whole RLS policy, in `supabase/schema.sql` — rerun it); local in the shell, `receipts/` beside the books file through the bridge; local in a browser, IndexedDB (memory where there is none, as in jsdom). `storedIn` names which, because a receipt does **not** travel when the household changes mode (signing in after a trial, stopping sync) or in a books export, and reading one kept elsewhere says where it is instead of failing blank.

The page stores the file **first** and only then describes it on the gift — ticking the box in the same write — and deletes the file again if that write is refused; taking the file off leaves the box ticked (a paper copy is still in hand). `recordDonation` keeps an existing receipt unless told otherwise, and `removeDonation` deletes the file best-effort, read through a ref so neither mutator changes identity per write.

**The type list and the 10 MB cap are written three times** — `src/receipts.js`, `electron/receipts.js` and the bucket — change all three together.

## `LifeEventsContext`

`lifeEvents`: `{ id, name, kind, startAge, years, oneTimeCents, annualCents, keptShareBps, enabled }`, the dated changes the net-worth projection walks through — a wedding, childcare, a sabbatical, Social Security, a house. **A store of guesses holding no money**, read by `src/netWorthProjection.js` and nothing else.

Five kinds (`LIFE_EVENT_KINDS`, owned by the projection module and re-exported here):

- an **expense** and an **income** carry a one-time figure, a yearly one, or both, as magnitudes — the direction is the kind, the ledger's rule
- an **income change** carries the share of normal pay kept (0 for a year off), which scales take-home, pretax and the budget's saving together but never the spending
- **buying a home** adds `priceCents`, `downPaymentCents`, the mortgage's nominal `rateBps` and `termYears`, and `rentSavedCents`, reusing `oneTimeCents` for closing costs and `annualCents` for what owning costs a year
- **selling one** names `propertyRef` (a property-band account or a purchase event's id), optionally the `debtRef` it pays off, and `sellingCostBps`

Both references are **inert but kept** — the walk skips a sale whose property it cannot find. **`years`, not an end age**, so whether the last year counts is never a question; `null` runs for the rest of the plan. Fields a kind does not read are kept, and `enabled` leaves an event out without deleting it, which is what scenarios are built on. An event seeded from a savings goal or a template is **copied once**, never linked, so nothing cascades either way and the provider's position is free.

## `ScenariosContext`

`retirementScenarios`: at most `MAX_SCENARIOS` (4) of `{ id, name, plan, enabledEventIds, slot }`.

**A scenario is a snapshot, not a link**: the whole retirement plan is copied, so editing the live plan cannot change what a saved one says, while events are named by **id** — an event is already a record, and a scenario is a choice about which are on, so "buy" against "rent" is two events and one scenario with each. A deleted event's id is inert; an event added since is off in every scenario saved before it.

**Four, because the comparison chart has four measured hues** (the bucket colours), and **`slot` is the colour**: the lowest free one at save time, stored and never moved, so removing a scenario cannot repaint the rest. Names are unique by trimmed, case-folded form.

Using a scenario is the page's write — `replaceRetirementPlan` (the plan through `migratePlan`, now exported, so an older snapshot gains the fields it predates) and `setEnabledEvents` — and never touches the books. Nothing cascades either way.

## `RewardsContext`

Six keys and **no money**: `rewardsBalances` (`{ id, programId, holder, points, asOf }`, one per program per person), `rewardsValuations` (`{ [programId]: valuePer100Cents }`, only where the household's figure differs from the catalog — blank removes it so the program follows the catalog again), `rewardsTrips` (`{ id, name, date, programId, points, taxesCents, cashPriceCents }`), `rewardsOffers`, `rewardsCards` and `rewardsEarnRates`.

**Points are not money until redeemed and a valuation is a judgement**, so nothing in the books, net worth or any report reads this store — the `RetirementContext` split.

- **Programs come only from the built-in catalog in `src/rewards.js`**, and a stored record naming an id the catalog lacks is dropped on the way in: there is no other store a program could have been deleted from, so an unknown id is one a newer build removed and nothing could show it.
- **A point's value is an integer number of cents per hundred points** (`valuePer100Cents`: 1.3¢ is 130), the cents discipline one step down, because fractional cents per point are the ordinary case.
- `summariseRewards` is the whole page as a pure function: programs summed across holders at the resolved value (override, else catalog), and each trip's achieved value per point — the cash fare less the taxes still paid, over the points — against that valuation, with funding from the program's own balance first and then by transfer from bank currencies, largest balance first, **in date order so no point is promised to two trips**, and a ratio's cost rounded up so a trip marked covered really is. Transfer partners are listed for bank currencies only and change without notice, which the page says.

### Card offers

**A card offer is a question asked of the ledger, and holds no money either.** `{ id, name, kind, accountId, startDate, endDate, limitCents, allSpending, budgetIds, payeeIds, rateBps, bonusPoints, programId }`.

Three shapes (`OFFER_KINDS`): a **capped bonus** — 9% on dining up to $1,000, a rotating 5% quarter — where progress is room *used up* and the moment that matters is the limit, because that is when the household goes back to its usual card; a **spending target** — a sign-up bonus — where progress is distance *covered* and the moment is the deadline; and a **credit to use up** — $300 of travel a year, $15 of rides a month — which is a cap's arithmetic read the other way round, because what is left under a credit is money the annual fee has already paid for. A target and a credit both refuse a blank end date (`OFFER_KINDS_NEEDING_END`): neither means anything without the day it runs out.

**A credit earns at 100% and says so nowhere**: `offerProgress` reads a credit's rate as 10,000 bps, so one formula gives `earnedCents` for both kinds that pay money (a cap at its stated rate, a credit at the spending it covers) and `null` for a target, which pays points. Two other things follow from the kind rather than the arithmetic: a credit is **paced** like a target (`perWeekCents`, since it is spending that has to happen by a date), and `overCents` stays a cap's alone — past a cap is spending at a worse rate, past a credit it is just shopping, which is also why `CardOfferList` stops a credit's own figure at the credit rather than printing "$1,340 of $300".

A rotating-category card is a capped bonus per round; "Next round" on the page opens a *new* offer seeded from the old one through `nextOfferWindow`, which steps a first-of-month-to-last-of-month window by **whole months** (a calendar quarter is 90 to 92 days, so stepping by days drifts) and anything else by its own length.

**What counts is the household's filing, not the issuer's**: an offer names categories, payees, or `allSpending`, and a purchase matches on any of them — the issuer files by merchant code, which the books do not have, so the page says the figure is close rather than exact and the form suggests a payee for a merchant-named category ("Amazon"). Its account, categories and payees are **inert but kept** — this store reads no other — so a deleted category matches nothing, and `useCardOffers` counts those in `missing` so the page says so. The fields one kind does not read (a rate on a target, a bonus on a cap), and the lists while `allSpending` is on, are kept, not cleared; the form hides rather than unmounts them for the same reason.

`offerProgress` in `src/rewards.js` is the arithmetic: **outflows and inflows only** (a transfer is never a purchase — paying the card is a transfer *into* it), a split counted by its **matching parts**, an inflow counted as a refund only where it names a category (an uncategorised inflow on a card is a statement credit, which an issuer does not take off qualifying spend), dated records only, inside the window **and no later than today**, floored at zero.

`elsewhereCents` is matching spending on any other account **while the offer still had a use for it** — room under a cap, a target not yet met, a credit not yet used — which is why the walk is in date order (the card's own record first on a tie): a dinner on the usual card before the cap filled is a missed bonus and one after is exactly right, and $300 elsewhere with $100 of room left is $100 missed.

### What a card earns, and what it costs

**`rewardsCards` is what a card costs** — `{ accountId, annualFeeCents, renewsOn }`, and **its identity is the account**, like a valuation's is the program: a card has one fee, and a second record for the same card could only contradict the first, so `saveCard` upserts. A blank fee *and* a blank renewal together **remove the record**, blank versus zero: a fee of zero is the answer "this card is free" and a blank is the question still open.

**`rewardsEarnRates` is what a card earns** — `{ id, accountId, mode, programId, rateBps, pointsPer100Dollars, allSpending, budgetIds, payeeIds }`, one record per advertised rate, mapped onto the household's own categories and payees in the same three fields an offer uses and read by the same `legMatches`.

- **Two modes, one comparison** (`EARN_MODES`). A rate is stored in the unit it is advertised in — cash back as `rateBps`, points as `pointsPer100Dollars` (per hundred dollars, so 1.25× is an integer 125, the per-hundred trick `valuePer100Cents` plays) — and converted only on the way out, by `earnBps`, into **the share of the purchase the card gives back**. 3× at 1.70¢ is 510; 2% back is 200. **That comparison runs on the household's own valuation**, which is why `/rewards` values a point before it recommends a card: lower the valuation and the cashback card wins the same dinner.
- **Both answers kept** across a change of mode, and the form hides rather than unmounts the fields the other mode reads.
- **A rate is uncapped by design.** "5% on groceries up to $6,000 a year" is a rate *and* a cap, and the cap is a `CAP` offer, which already walks a window in date order. A limit here would be that arithmetic in a second place, and the two would disagree the first time one changed.
- **The best matching rate and only the best** (`bestRateFor`): an issuer pays one rate per purchase, so a card with 3× on travel and 1× on everything pays 3× at the airline, not 4×. A card with no matching rate claims **nothing** rather than zero, and is left out of `rankCardsFor` rather than ranked at the bottom.
- **Added only in batches** (`addEarnRates`), because a card advertises a *table* of rates — "4× dining, 4× groceries, 1× everything else" — and one record at a time was a form reopened once per line. The whole batch is validated before any of it is written, the rule every batch mutator here keeps: a table refused on its third row leaves nothing behind, so the corrected second try cannot write the first two twice. The error names the row (`Rate 2: …`) where there is more than one, since the figure refused is one of several on screen. Nothing is checked *across* rows — two rates reaching the same category is redundant, not incoherent, and `bestRateFor` pays the better one, which is what the issuer does.
- Everything a rate names is **inert but kept**, the store's rule throughout — including the account, so a rate whose card has gone simply stops being a row.
- **`cashbackBps` on an *account* is a different thing and must never be added to these.** That cash back is already in the books, as a refund row beside each purchase (`src/cashback.js`); `useCardValue` reports it as `postedBps` and the page says where its money already is, rather than counting it twice.

## `SavingsGoalsContext`

`savingsGoals`: a **standing intention**, `{ id, name, targetCents, targetDate, budgetId, photo, envelopeColor, accountIds, accountAmounts }`, for the medium-term thing expected to *exceed* a normal month — a camera, a wedding, a special event — which is exactly what makes it a goal to plan around rather than a category to estimate. `photo` and `envelopeColor` (one of `ENVELOPE_COLORS`, canopy unless chosen) only dress its card; an update that does not name a colour keeps the one stored.

It holds **no money**: what has actually been put toward it lives next door, on the same split `BudgetsContext` keeps against `AssignmentsContext`, and for the same reason — the target is the estimate, the assignment is the money.

`targetCents` must be a whole number **greater than zero**: a goal of nothing is not a goal, and unlike a category's `goalCents` there is no "not saving towards anything" state to express, since that is what having no goal record already means. `targetDate` is nullable — a goal with no date in mind is still a goal — and is `"YYYY-MM-DD"` or refused.

### Where the money is already held

**A goal's money does not have to be in the budget.** A deposit years out is usually invested rather than left in a current account, and a goal that could only count what the budget had assigned to it read an invested fund as a goal nobody had started. `accountIds` names the accounts holding it and `accountAmounts` (id → cents) says how much of one, where only part of it is this goal's — `EmergencyFundContext`'s pair, field for field, including that a missing amount is the whole balance and that an amount is **kept when its account is unticked**.

Both are **inert but kept**: this store reads no other, so neither is checked against the live accounts, and an id whose account was deleted contributes nothing. **Only an off-budget account is ever counted, and that rule lives in `useSavingsGoalEnvelopes`, not here** — on-budget money is already in the pool a goal's assignment draws on, so counting a balance as well would promise one dollar twice; an id naming an on-budget account is therefore inert rather than refused, and counts again if the account moves off budget.

`parseHoldings` checks each field **only when the caller names it**, so a patch that renames a goal leaves where its money is alone; an amount must be a positive whole figure, since a part of nothing is not a part, and the whole map is checked before any of it is written. The store still names no figure of its own: what an account is worth is `useNetWorth`'s answer, joined one level up.

### The rest

**Spending a goal is a move, never a figure the goal holds.** `spending` is a list of `{ id, date, amountCents, budgetId, note, transactionId }`, one per payment made out of the goal — the venue, then the photographer. **It holds no money**: the money itself left the goal as a negative goal assignment and arrived in `budgetId` as a positive one, in the payment's month, and the purchase is an ordinary outflow against that category (`useGoalSpending` makes all of those writes; this store keeps only the statement). It exists so a goal paid off in pieces can say planned, saved and spent apart — a pull-back with a minus and a payment both lower the assignment, and only this list tells them apart. `budgetId` and `transactionId` are **inert but kept**. `recordGoalSpending` checks only its own fields; `removeGoalSpending` drops the statement and leaves undoing the move to its caller.

**`archivedOn`** (`"YYYY-MM-DD"` or null) closes a goal out without deleting anything: its record, spending and assignments all stay, and `setGoalArchived` reopens it as it was. An archived goal is off the active list and off `AssignIncomeModal`. Releasing what is left in it is an assignment, so it is `useGoalSpending.archiveGoal`'s, not this store's. Both fields are stamped on by the migration — `[]` and `null`, which is what a goal saved before them had done.

**`budgetId`** is nullable and **inert but kept**: a goal may name the budget category its monthly contributions draw from, purely for display. Nothing cascades — a deleted category's id contributes nothing and is resolved where it is read in `useSavingsGoalEnvelopes`.

A goal names **no transaction**, so nothing outside this pair deletes into or out of it — and the accounts and category it names are references it never reads back, the rule that keeps the dependency graph one-way. `updateSavingsGoal` refuses an id it cannot find rather than letting a `map` that matches nothing report the write as landed, because `useSyncedState` syncs a delete from another tab — or from another device — and the edit modal can be open on a record the store no longer has.

## `SavingsGoalAssignmentsContext`

`savingsGoalAssignments`, one record per (goalId, period): what was **actually put in**, the same shape `AssignmentsContext` keeps for budgets. Zero rows are pruned — "assigned nothing" and "never assigned" spend the same — and negatives are allowed for the identical reason a category's are: pulling money back out of a goal over-funded in an earlier month is the only way to move it, and refusing that leaves the user with money they can see and cannot reach.

**There is no day-one seed**, unlike `AssignmentsContext`: a goal has no ledger of its own to have already spent from, so a ledger that predates the feature has nothing to seed here. A period ahead of today is valid here too, on that store's rule and for the same reason — a goal funded ahead draws on the one pool a category funded ahead does, and `assignedAheadCents` sums both.

`setPeriodAssignments({ period, entries })` validates the **whole batch before writing any of it**, so a bad figure in the ninth goal cannot land after the first eight have already committed — the rule `AssignmentsContext` and `setPeriodBalances` both keep, and the one that makes `AssignIncomeModal`'s single submit safe. `removeGoalAssignments` is the cascade `deleteSavingsGoal` calls.

## `LoansContext`

`loans`: the terms of an amortizing loan — a mortgage, a car loan, a student loan. `{ id, accountId, kind, originalPrincipalCents, rateBps, termMonths, firstPaymentDate, paymentSource, paymentCents, rateChanges, balloonCents, collateralAccountId, collateralValueCents, collateralRateBps, escrowCents, pmiCents, pmiRemovalLtvBps, whatIf }`, the seventeenth store.

**A loan is terms *about* a liability account, never a second balance** — it holds no money and moves no figure anywhere (`.claude/LOANS.md`). What is owed is `useNetWorth`'s figure for the account; the amortization schedule is a reading *beside* it, and `useLoans` is the join. It reads no other store, so its position in the provider order is free, and every reference it carries — `accountId`, `collateralAccountId`, each `rateChanges` id — is **inert but kept**: never validated against live records, nothing cascades in, a deleted account leaves the loan readable as "account removed" with its schedule intact. **One loan per account.**

- **`paymentSource` is the both-answers-kept rule.** Derived is the standard annuity payment from principal, rate and term (computed, never stored); typed is what the statement says, kept on `paymentCents` whichever source is in force. Switching clears neither.
- **`escrowCents` and `pmiCents` are not principal or interest** and never enter the amortization — only what the payment *costs* and the record-payment split. Blank removes the field; `0` is a real answer ("no PMI"), the blank-vs-zero rule.
- **`collateralRateBps` is signed and nullable** (+3.5% a house, −15% a car); null takes a default by kind in the hook (mortgage reads the retirement plan's `propertyRateBps`, a car −15%, anything else no collateral line). A typed figure overrides and is kept.
- **`whatIf` sits on the record** — a guess that holds no money, synced like everything else, read by the Loans page and nothing else. Clearing it (`EMPTY_WHAT_IF`) never touches the terms.
- Validation through `toCents` / `toBps`: principal > 0, term 1–600 months, rate 0–`MAX_RATE_BPS`, a valid first-payment date, rate changes dated after it. **Coherence is not checked** — a typed payment below the first month's interest is reported on the page ("this never pays off"), not refused at the field, `RetirementContext`'s stance. **Whether the account is a liability is `AddLoanModal`'s check**, not the store's, since the store reads no other.

## Mutators that can reject input

`addBudget`, `addTransaction`, `updateTransaction`, `addAccount`, `updateAccount`, `reconcileAccount`, `setAssignedAmount`, `setPeriodAssignments`, `moveBetweenBudgets`, `setBalance`, `setPeriodBalances`, `setBalanceHistory`, `setPaySchedule`, `setRetirementPlan`, `setEmergencyFund`, `addRecipient`, `updateRecipient`, `recordDonation`, `updateDonation`, `setGivingGoal`, `addSavingsGoal`, `updateSavingsGoal`, `recordGoalSpending`, `removeGoalSpending`, `setGoalArchived`, the savings-goal `setAssignedAmount` / `setPeriodAssignments`, and `addLoan`, `updateLoan`, `setLoanWhatIf` — all return `{ ok, error }`.

`deleteSavingsGoal` is the exception in that pair and deliberately so: a goal holds no money and nothing else names its id, so there is nothing a delete could be refused for. `deleteLoan` is the same — a loan holds no money and nothing references its id.

**Callers must surface the error** — never close a modal as though the write succeeded.
