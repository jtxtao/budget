# Life events and the net-worth projection

In progress. Step 1 is built: the whole-balance-sheet projection (`src/netWorthProjection.js`)
and its assumptions, on the Retirement page. Life events are not built yet. Three decisions
here were made in conversation rather than deduced from the code, and they are the ones to
keep if the rest is revisited: the projection is **full net worth**, not the retirement pot
alone; future income is **either today's take-home grown by a rate or gross salaries entered
by age, with both kept**; and every assumption is **stored and editable**, never a constant.

## Context

ProjectionLab's life events are dated changes to a household's money — a wedding, childcare,
a house, a sabbatical, Social Security, retirement itself. A life event is only worth
modelling against a projection of the whole balance sheet: a down payment moves cash into
property and takes on a mortgage, and a projection of the retirement pot alone cannot see
any of it.

## The projection (built)

Five pots — cash, invested, retirement, property, and each debt walked on its own — starting
from every account at `useNetWorth`'s value, so year zero is the net worth the Net worth page
shows. A ticked account is retirement money; a typed starting figure stands for money the app
does not track, so the ticked accounts go back to their bands rather than being counted twice.
Each year, in today's dollars:

| Flow | From | Once retired |
|---|---|---|
| Income | take-home: `IncomePlan` × 12 grown at `incomeGrowthRateBps`, **or** the gross salary in force at that age, less pretax, less `workingTaxRateBps` | none yet (events will add pensions) |
| Spending | essentials + fun estimates × 12 | the plan's retirement spending figure |
| Saving | savings bucket → invested; retirement bucket + pretax → retirement | stops |
| Surplus / shortfall | to cash / drawn cash → invested → retirement (grossed up by `retirementTaxRateBps`) | same order |

- **A debt payment is inside the budget's spending while working**, so it is not subtracted
  twice — it pays the debt down, and what the debt no longer takes comes back to cash (all of
  it the year the loan ends). **Once retired it is paid on top**, since the retirement figure
  is defined as a life with the mortgage gone.
- **Debts run on a real rate and a deflated payment.** A fixed payment is fixed in nominal
  dollars; walking it flat in today's dollars would overstate it every year after the first.
- **Salaries are in today's dollars**, like everything on the page. Before the first one,
  today's take-home stands; $0 is a year off.
- A retirement-pot draw before retirement is reported (`earlyWithdrawalAge`), not prevented;
  what cannot be paid at all is `unfundedCents` and the first such year is `shortfallAge`.

Three tripwires in `netWorthProjection.test.js`: the **identity** (every year, `Δnet = income
− consumption − tax − interest + growth + unfunded`); the **reproduction** (retirement pot
only, the walk equals `projectRetirement` to the cent); and **funded to the cent** (a pot of
`requiredNestEgg` ends at zero).

The Retirement page's outlook still reads `projectRetirement`. It moves onto this projection
in step 5, which will also make the two disagree less: today the outlook ignores retirement
tax and everything outside the ticked accounts.

## Life events (next)

`LifeEventsContext`, key `lifeEvents` (add it to `STORE_KEYS`). `{ id, name, kind, startAge,
endAge, enabled, … }`, non-negative magnitudes with the direction in `kind`. A store of guesses
holding no money, like the plan.

| Kind | Fields | Examples |
|---|---|---|
| Expense | one-time and/or yearly, optional end age | wedding, childcare, college |
| Income | one-time and/or yearly | Social Security, pension, inheritance, part-time work |
| Income change | new take-home or a % change, start to end | sabbatical, going part-time |
| Buy property | price, down payment, rate, term, rent that stops | first home |
| Sell property | which property, selling costs | downsizing |

Retirement is drawn on the timeline as a fixed event from `retirementAge`. A savings goal with a
target date becomes an event through "add as event", copied once — the money already set
aside sits in cash, and the event spends it from there. `enabled` keeps an event while leaving
it out, which is what "with kids / without" and later Scenarios are built on.

## Order

1. ~~Projection and its assumptions, with the three tripwires.~~ Done.
2. ~~Debt rates and payments, payoff, appreciation.~~ Done with step 1.
3. Life events store, the walk reading it, templates (wedding from a goal, childcare, Social
   Security, sabbatical).
4. Buy and sell property.
5. The page: stacked chart by band over age with event markers, the outlook read off this
   projection.
6. Later: scenarios, per-event inflation (college), Monte Carlo.
