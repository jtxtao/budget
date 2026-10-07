# Budget App Feature Research & Feature Wish List

> **Research Focus:** Understanding desired features from users of Actual Budget, YNAB, Rule-based budgeting apps (Spending Rules), Monarch Money, and other popular budgeting platforms. Excludes bank syncing/connections as a "nice-to-have" base feature.
>
> **Sources:** Reddit threads (r/budgets, r/personalfinance, r/actualbudget, r/MonarchMoney, r/YNAB), App Store & Play Store review sentiment analysis, product comparison articles (The Points Guy, NerdWallet, Forbes Advisor, etc.), and common user complaint patterns across platforms.

---

## 1. ACTUAL BUDGET ("ABC") — Feature Requests & User Pain Points

### What People Love About Actual Budget
- **True monthly rollover** (not a carryforward like YNAB) + "Sinking Funds" concept with envelope-style budgeting
- **Rule-based automation** (Spending Rules) for categorization and transfer auto-rules
- **Fully offline / self-hostable** — privacy-oriented users flock to this
- **Multiple account support**, joint accounts, custom accounts
- **Budget by category** (traditional zero-sum budgeting) with great flexibility

### Common Feature Requests from Actual Budget Community

| Category | Feature Request | Why People Want It |
|----------|-----------------|-------------------|
| **Charts & Visualizations** | ~~Pie chart of spending by category~~ — **built**, as a ranked share bar per row on `SpendingByCategoryTable` rather than a pie | Easier "big picture" review than tables of numbers |
|  | ~~Stacked bar chart for budget vs actual over time~~ — **built**, `PlanVsActualChart` on `/reports` | See trends across months easily |
|  | ~~Trend lines and moving averages~~ — **built**, a three-month trailing average on the category drill-in | Identify if habits/behaviors are shifting |
|  | Heatmap calendar view (like GitHub contributions) showing spending color-coded by intensity per day | Visual "spending streak" awareness / guilt-free days |
|  | ~~Category comparison radar/spider chart~~ — **answered** by the plan-vs-actual chart's bucket stack against the plan line | Instantly see which buckets are over/under |
| **Reporting** | Exportable reports (PDF, CSV, XLSX) for tax time or accountant | Users need receipts and summaries for taxes/SOB |
|  | Custom report builder with drag-and-drop filters | Power users want to build their own views |
|  | "What-if" projections within reports (e.g. "what if I raise rent $200?") | Scenario planning without creating new budgets |
| **Rule-based / Automation** | Recurring rule engine with exceptions ("only first Friday of month") | Some rules are more complex than simple recurring |
|  | Rule-based alerts before they hit (e.g. "alert if category X is >80% spent") | Proactive warnings instead of reactive post-checking |
|  | Smart rule suggestions based on historical patterns ("I see you always pay Netflix the 3rd of each month - want me to automate?") | Reduce manual rule setup burden |
| **Entry speed** | Quick-add transaction UI that's faster than data entry screens | "I just need to record $4.50 coffee" without navigation |

**On the two charts not built.** The **radar/spider chart** is struck rather than
deferred: it encodes magnitude as area, which the eye reads as roughly the square
of the number, and its axis order is arbitrary so the shape changes meaning when a
category is renamed. The question it was asked for — which buckets are over and
under — is what `PlanVsActualChart`'s stack against the plan line answers, on an
axis that does not distort. The **heatmap calendar** is the one genuinely open
item here, and it is open rather than struck: it needs a *day* axis, and every
figure in this app is filed by month on purpose (`REPORT_RANGES` is months
"because a range that cut a month in half would report a rent payment in whichever
half it landed"). The data is there — transactions carry a `YYYY-MM-DD` date — so
it is a real piece of work rather than a blocked one.

**Out of scope, decided:** a mobile app (and the offline sync with conflict
resolution one would need) and native multi-currency with auto-conversion. Both
are asked for across these communities and neither is being built — the currency
is pinned in `src/utils.js` (`CURRENCY` / `CURRENCY_LOCALE`) and the two builds
are the web app and the Electron shell. Recorded here so the research is not
re-read every year as an open list.

### Actual Budget Reporting — Deep Dive

Actual Budget has a reporting engine that includes:

- **Budget Report** — Shows categories, budgeted amounts, assigned vs unassigned money, and rollover. Exportable.
- **Scheduled Transactions Report** — Preview of future auto-rules and recurring entries.
- **Monthly Transfer Report** — For tracking transfers between months.
- **Net Worth Report** — Balance sheet view as of a given date.

---

## 2. ASPIRE BUDGET v3.3.0 — read against this app

The household's own books were kept in Aspire (a Google Sheets envelope budget)
before this app, with additions of their own. All eleven sheets were read; most
of what they do this app already did. What it did **not** do came to seven
things, and six of those are now closed.

| Aspire has | Status here |
|---|---|
| Per-transaction cleared/pending/reconciled marks | **Not built, and not wanted.** Reconciliation here is a date stamped on the account (`reconcileAccount`), read beside its derived balance on the dashboard — which is how the household's own sheet worked, rather than stock Aspire's row-by-row ticks. A derived figure is worth trusting as far as the last day somebody confirmed it matched the bank, and that is exactly what the date says. |
| A category-to-category transfer sheet | **Built** — `moveBetweenBudgets` and `MoveMoneyModal`, opened off the Available figure on the dashboard. One write rather than Aspire's two visible lines: the two deltas cancel, so "to be assigned" is untouched by construction and there is no intermediate state to see. |
| A balance-adjustment transaction (🔢) | **Built** — `FixDriftModal`, reached from the Source cell that states the gap. It writes an ordinary inflow or outflow dated inside the statement's month, not a fourth kind of record. `useNetWorth` still only *reports* the drift; what was missing was a way for the user to say which record is right. |
| Hidden categories and hidden accounts | **Not built, deliberately.** Decided against rather than deferred. |
| An emergency-fund calculator (6× the ticked categories) | **Built, and derived from the bucket rather than a second list of ticks** — the plan already says which categories are essentials, so `useEmergencyFund` takes the multiple of those and measures it against the accounts the household ticks as holding the fund. The months are editable and a typed target overrides them, both answers kept. |
| A custom start and end month on reports | **Built** — a sixth option on the report's range control, with the coverage divisor clipped at both ends so a window running past today is not quietly averaged over months nobody has lived. |
| A net-worth tile on the dashboard | **Not built, deliberately.** The dashboard answers "where am I right now" out of the envelopes; net worth has a page with a month on it, because half of what it is made of is typed in. |

**The other direction, recorded because it is the reason the four-bucket split
exists.** Aspire's own split is three-way and its `Savings` bucket holds a house
deposit, an emergency fund and retirement together — so a down payment inflates
what the sheet reports as retirement saving. Splitting retirement out is what
keeps `useRetirementProjection`'s seeded contribution honest. Also absent from
the sheet and present here: payees as records with merge and search, split
transactions, scheduled and upcoming bills, donation tracking, an
inflation-deflated retirement projection, the plan-vs-actual chart, dark mode,
and the desktop build.
