import { useMemo } from "react";
import {
  PLAN_BUCKET_LABELS,
  PLAN_BUCKET_ORDER,
  useBudgets,
} from "../contexts/BudgetsContext";
import { insideBudget, useAccounts } from "../contexts/AccountsContext";
import { budgetLegs, TRANSACTION_KINDS, useTransactions } from "../contexts/TransactionsContext";
import { UNCATEGORIZED_BUDGET_ID } from "../contexts/constants";
import { toSections } from "../planLayout";
import { addMonths, currentPeriod, formatPeriod, periodLTE, toPeriod } from "../utils";

/**
 * What the books did over a **window of months** — where the money went, how
 * much came in, and what was left.
 *
 * The fifth hook that reads across stores, and the only one whose subject is a
 * span rather than an instant. Every other view answers a question about one
 * period: what is in the envelopes *now* (`useEnvelopes`), what the accounts
 * hold *at* P (`useAccountBalances`, `useNetWorth`). A report is the other
 * question — what has been happening — and it cannot be answered a month at a
 * time, because the whole point of it is that one month is not evidence.
 *
 * It reads the ledger and the plan's arrangement, and of the accounts nothing but
 * **which side of the budget each one sits on** — that being the only thing a
 * transfer's meaning depends on. Not assignments: what was put into an envelope is
 * a decision, and a report is about what actually happened. Not account balances:
 * a report of spending is indifferent to how much was in the account it left from.
 * Not the opening balances, for the same reason `useEnvelopes` keeps them out of
 * income — money the household already had is not money it earned this year.
 *
 * ## The three quantities, and why there are three rather than two
 *
 *   spent(b, p)     = outflows naming b, in p                   ← gross, ≥ 0
 *   refunded(b, p)  = inflows naming b, in p                    ← gross, ≥ 0
 *   netSpent(b, p)  = spent − refunded                          ← what it cost
 *   income(p)       = inflows naming no category, in p
 *
 * A record divided between categories contributes one figure to each of them,
 * adding up to the whole — `budgetLegs` in TransactionsContext is where that
 * division is read, and it is read the same way here as in `useEnvelopes`. The
 * ranking below is therefore a ranking of where money actually went rather than
 * of which receipt it happened to arrive on, which is the entire reason a
 * household splits one.
 *
 * The refund rule is the store's, unchanged: **an inflow with a category is
 * money coming back to that category, and an inflow without one is income.**
 * Spend $100 on dinner and be paid $60 by the friends who ate it and the
 * household spent $40 on dinner — not $100 of dinner and $60 of earnings. So a
 * refund nets off the category it names and never reaches income. Getting this
 * wrong does not merely misfile a row; it inflates both halves of the headline
 * at once, which is the one error a savings rate cannot survive.
 *
 * That gives the identity this hook is checked against:
 *
 *   netCents = Σ income − Σ netSpent = Σ inflows − Σ outflows      ← over the window
 *
 * The right-hand side is cash actually moved. It holds because every inflow is
 * counted exactly once — as income or as a refund — and refunds are subtracted
 * from spending rather than added to income. Both routes reach the same total,
 * which is what makes "net saved" a fact about the bank rather than a figure
 * assembled from two different books.
 *
 * ## What is left out, and said out loud
 *
 * **Undated records belong to no month, so they are in no report.** `useEnvelopes`
 * folds them into every cumulative sum, because a balance has to account for
 * every dollar whether or not anyone wrote down when it moved. A report is the
 * opposite shape: its axis *is* the month, and putting an undated record in one
 * would be inventing the history the migration deliberately refused to invent.
 * They are counted instead, and the page says how many — money that is missing
 * from a chart has to be visible as missing.
 *
 * **A month outside the window is outside the window**, including a future-dated
 * record beyond the end month. Nothing accumulates from before the start: this
 * is a report of a span, not a balance at the end of one.
 *
 * **A transfer that moves no budget money is in no report** — not as spending, not
 * as income, and not in the undated count either. Paying a credit card is not an
 * expense; it is the same money in a different account, and a report that counted
 * it would say the household spent it twice.
 *
 * A transfer that crosses **out** of the budget *is* spending, against its own
 * category, exactly as the categorised outflow it replaces was — which is what
 * keeps `buckets` below comparable with the share of the estimates `usePlanHealth`
 * reports. A transfer **in** is the one place this hook parts company with
 * `useEnvelopes`, deliberately: there it is money to assign, because it is money
 * that can now be spent, while here it is not income, because the household did
 * not earn it. Draw $5,000 out of an emergency fund to fix a roof and this report
 * says $5,000 of spending against whatever was actually earned — which is the
 * month the household really had. Counting the withdrawal as income would report
 * it as $5,000 better off in the month its net worth fell by that much, and it
 * would carry into the savings rate. `useGiving` keeps the same distinction for
 * the same reason.
 *
 * The asymmetry between the two directions is real rather than an oversight: the
 * outbound half is the shape the app already had (money set aside is one of the
 * four buckets a plan allocates to) and the inbound half has no such precedent to
 * keep faith with. `budgetLegs` in TransactionsContext owns the matrix itself;
 * this is the one line on top of it.
 */

/**
 * The spans a report is read over.
 *
 * Months rather than a pair of dates, because every figure in this app is filed
 * by month and a range that cut a month in half would report a rent payment in
 * whichever half it landed. Each one is inclusive of both ends.
 *
 * **Five are derived from the end month and one is typed.** The presets answer
 * "how far back", which is the question a reader usually has, and they always
 * run to the current month — so the last column is a month still in progress.
 * "Custom" is the one window that names both of its ends, which is what lets a
 * report cover a calendar year, or a year that has already finished. It is a
 * sixth preset rather than a mode: everything below it reads the window the same
 * way whichever produced it.
 *
 * "All" is the only one that needs to know anything about the ledger, and
 * "custom" the only one that needs to know what the reader typed, which is why
 * every `start` takes the first month on the books and the chosen start as well
 * as the end month — a signature the other four ignore.
 */
export const REPORT_RANGES = [
  { key: "3m", label: "3M", name: "the last 3 months", start: (end) => addMonths(end, -2) },
  { key: "6m", label: "6M", name: "the last 6 months", start: (end) => addMonths(end, -5) },
  { key: "12m", label: "1Y", name: "the last 12 months", start: (end) => addMonths(end, -11) },
  {
    key: "ytd",
    label: "YTD",
    name: "the year to date",
    // January of the end month's own year — the year so far, not the last
    // twelve months, which is what the range beside it already is.
    start: (end) => `${end.slice(0, 4)}-01`,
  },
  {
    key: "all",
    label: "ALL",
    name: "every month on the books",
    start: (end, first) => first ?? end,
  },
  {
    key: "custom",
    label: "Custom",
    // Replaced by the hook with the two months themselves, which is the only
    // honest name a window nobody can infer from a label can have.
    name: "the months you chose",
    // The one range whose start is neither counted back from the end month nor
    // read off the ledger: it is handed in. The end month is the reader's too,
    // which makes this the only range that can name a window **not running to
    // today** — the whole reason it exists, and the reason it is the only one
    // the coverage bound below can bite at the far end for.
    start: (end, first, chosen) => chosen ?? end,
  },
];

export const DEFAULT_REPORT_RANGE = "12m";

/** The one range that reads its own two months rather than deriving them. */
export const CUSTOM_REPORT_RANGE = "custom";

/**
 * The buckets a month's spending divides into, as a fixed list in a fixed
 * order — the plan's four, and then everything that could not be filed under
 * one.
 *
 * The fifth entry is not a fifth bucket. It is the Uncategorized sentinel and
 * any id whose category has since been deleted, and it exists because the
 * segments of a stack have to add up to the figure the stack is drawn against.
 * Dropping it would quietly describe a smaller household than the headline
 * above does.
 *
 * `key` is here rather than left to each caller because `bucket` is null for
 * that fifth entry and a null React key is a warning and a bug waiting for the
 * next entry to be added beside it.
 */
export const BUCKET_SERIES = [
  ...PLAN_BUCKET_ORDER.map((bucket) => ({
    bucket,
    key: bucket,
    label: PLAN_BUCKET_LABELS[bucket],
  })),
  { bucket: null, key: "unfiled", label: "No category" },
];

/**
 * The ceiling on "all", in months.
 *
 * Ten years, matching the net-worth chart's longest span and for the same
 * reason: past a hundred and twenty columns a month stops being resolvable at
 * the width these cards get, and a household that has kept books for thirty
 * years would otherwise get a plot of three hundred and sixty hairlines.
 */
const MAX_WINDOW_MONTHS = 120;

/**
 * The months a range resolves to, oldest first and always ending at `endPeriod`.
 *
 * Every path is guarded back to a window of at least the end month itself: a
 * range that resolved to a start after its end — "all" on a ledger holding only
 * future-dated records, a hand-edited period — would otherwise produce an empty
 * month list, and every figure downstream would divide by it.
 */
function windowFor(endPeriod, rangeKey, firstPeriod, chosenStartPeriod) {
  const range =
    REPORT_RANGES.find((entry) => entry.key === rangeKey) ??
    REPORT_RANGES.find((entry) => entry.key === DEFAULT_REPORT_RANGE);

  let start = range.start(endPeriod, firstPeriod, chosenStartPeriod);
  if (!periodLTE(start, endPeriod)) start = endPeriod;

  const floor = addMonths(endPeriod, -(MAX_WINDOW_MONTHS - 1));
  if (periodLTE(start, floor)) start = floor;

  const months = [];
  for (let period = start; periodLTE(period, endPeriod); period = addMonths(period, 1)) {
    months.push(period);
  }
  return { range, months };
}

/**
 * `part` as a share of `whole`, in basis points — or null where a share says
 * nothing.
 *
 * A whole of zero has no size to be a share of, and a negative whole (a window
 * whose refunds outweighed its spending) makes the ratio meaningless rather than
 * merely large. Both come back null and the page prints a dash, on the same
 * discipline as `percentChangeBps` in `useNetWorth`: the figure itself is always
 * shown beside the share, so refusing to invent one costs nothing.
 */
export function shareBps(part, whole) {
  if (!(whole > 0)) return null;
  return Math.round((part / whole) * 10000);
}

const emptyCategory = (budgetId) => ({
  budgetId,
  spentCents: 0,
  refundCents: 0,
  // Which months this category moved money in, so the average below can be read
  // as the rate it is or the artefact it is not.
  months: new Set(),
  // Per-month spent/refund, for the drill-in's own chart — the same split the
  // headline carries, just kept one level deeper rather than collapsed into the
  // window total the rest of this hook wants.
  monthly: new Map(),
  // The dated, in-window transactions that fed this category's figures, for the
  // drill-in's transaction list. Nothing here is derived twice: it is the same
  // records the loop below already visits to build every other figure on the row.
  transactions: [],
});

/**
 * `useSpendingReport(endPeriod, rangeKey)`
 *
 * @param endPeriod the last month in the window, inclusive
 * @param rangeKey  one of `REPORT_RANGES`
 */
export default function useSpendingReport(
  endPeriod,
  rangeKey = DEFAULT_REPORT_RANGE,
  chosenStartPeriod = null
) {
  const { groups, budgets } = useBudgets();
  const { transactions } = useTransactions();
  // Read for one reason only: a transfer's effect on the books depends on which
  // side of the budget boundary each of its two accounts sits. Nothing else here
  // asks an account anything — a report is about the money, not about where it sat.
  const { accounts } = useAccounts();

  return useMemo(() => {
    const inside = insideBudget(accounts);

    // The first month anything was recorded in, which is what "all" reaches back
    // to and what the average below is honestly divisible by.
    let firstPeriod = null;
    for (const transaction of transactions) {
      const period = toPeriod(transaction.date);
      if (period != null && (firstPeriod == null || period < firstPeriod)) firstPeriod = period;
    }

    const { range, months } = windowFor(endPeriod, rangeKey, firstPeriod, chosenStartPeriod);
    const startPeriod = months[0];
    // A custom window has no label anybody could read a span off, so it is named
    // by the two months it actually is. One month names itself rather than
    // reading "October 2026 to October 2026", and the name is derived here
    // rather than stored on the entry because only this scope knows what the
    // guards above settled the window at.
    const namedRange =
      range.key === CUSTOM_REPORT_RANGE
        ? {
            ...range,
            name:
              startPeriod === endPeriod
                ? formatPeriod(startPeriod)
                : `${formatPeriod(startPeriod)} to ${formatPeriod(endPeriod)}`,
          }
        : range;

    const byMonth = new Map(
      months.map((period) => [
        period,
        // `byBucket` is this month's net spend split four ways plus unfiled —
        // the same cut `buckets` reports over the whole window, kept per month
        // so the plan-against-books chart can stack a column out of it. Built
        // in this pass rather than by a second walk of the ledger, for the
        // reason the drill-in's `monthly` is: two walks can disagree about the
        // refund rule or about which month a record falls in, and nothing
        // downstream would be in a position to notice.
        { period, incomeCents: 0, spentCents: 0, refundCents: 0, byBucket: new Map() },
      ])
    );

    // Which heading and which bucket each category is filed under, and what the
    // plan intends for it. Read off the sections rather than the flat list,
    // exactly as `usePlanHealth` does: resolving what a category counts as needs
    // its group beside it, and `toSections` has already done that once.
    //
    // Built **before** the ledger walk rather than after it, because the walk
    // now needs each leg's bucket as it goes.
    const filing = new Map();
    const plannedByBucket = new Map(PLAN_BUCKET_ORDER.map((bucket) => [bucket, 0]));
    for (const section of toSections(groups, budgets)) {
      for (const budget of section.budgets) {
        filing.set(budget.id, {
          name: budget.name,
          groupName: section.name,
          bucket: budget.effectiveBucket,
          targetCents: budget.plannedCents,
        });
        if (plannedByBucket.has(budget.effectiveBucket)) {
          plannedByBucket.set(
            budget.effectiveBucket,
            plannedByBucket.get(budget.effectiveBucket) + budget.plannedCents
          );
        }
      }
    }

    /**
     * What the plan intends to spend in a month, and the one figure on this
     * hook that is not read off the books.
     *
     * It is **every** category's standing estimate, including the ones that
     * spent nothing in the window — an estimate for a category that was quiet
     * all year is still part of what the plan set aside, and dropping it would
     * make the plan appear to shrink in exactly the months the household
     * underspent.
     *
     * **Deliberately not `usePlanHealth`'s `plannedCents`**, which is the same
     * sum grossed up by `pretaxContributionCents`. That figure is right for the
     * question that hook asks — does the standing configuration balance against
     * what the household earns — and wrong for this one. A pre-tax payroll
     * deduction never becomes a transaction, so the books can never show it;
     * comparing a plan that counts it against spending that structurally cannot
     * would draw a permanent gap the household could never close by spending
     * differently. Like against like, which here means the categories only.
     */
    const plannedCents = budgets.reduce((sum, budget) => sum + budget.plannedCents, 0);

    const byCategory = new Map();
    const categoryEntry = (budgetId) => {
      let entry = byCategory.get(budgetId);
      if (!entry) {
        entry = emptyCategory(budgetId);
        byCategory.set(budgetId, entry);
      }
      return entry;
    };

    // Money with no month to put it in. Counted rather than placed, and reported
    // so that a chart missing a figure says so instead of quietly disagreeing
    // with the register.
    let undatedCount = 0;
    let undatedSpentCents = 0;
    let undatedIncomeCents = 0;

    for (const transaction of transactions) {
      // A transfer the budget never sees is in no report either — it is money the
      // household moved, not money it earned or spent, and a report of the books is
      // a report of what happened to them. A transfer *out* of the budget reads
      // here exactly as the categorised outflow it replaces, which is what keeps
      // `buckets` below comparable with `usePlanHealth`'s share of the estimates.
      // A split reads as one leg per part. See `budgetLegs` in TransactionsContext.
      const legs = budgetLegs(transaction, inside);
      if (legs.length === 0) continue;
      // **And a transfer *into* the budget is not income here, though it is money
      // to assign in `useEnvelopes`.** That divergence is the same one `useGiving`
      // keeps, and it is what makes `netCents` mean something: a household that
      // draws $5,000 out of its emergency fund to fix a roof and spends it has not
      // earned $5,000, it has spent down a holding, and counting the withdrawal as
      // income would report the month as $4,000 better off in the month its net
      // worth fell. Excluded rather than netted, so it cannot reach the savings
      // rate through either half of the ratio.
      if (
        transaction.kind === TRANSACTION_KINDS.TRANSFER &&
        legs[0].kind === TRANSACTION_KINDS.INFLOW
      ) {
        continue;
      }

      const period = toPeriod(transaction.date);
      const month = period == null ? null : byMonth.get(period);
      // Outside the window — earlier than the start, or dated past the end.
      // Neither accumulates into it: this is a report of a span.
      if (period != null && !month) continue;
      // **Counted once, however many categories it touched.** `undatedCount` is a
      // count of records the report could not place, and it is printed beside the
      // register's own row count — a receipt split three ways is one row there and
      // has to be one here.
      if (period == null) undatedCount += 1;

      for (const leg of legs) {
        const inflow = leg.kind === TRANSACTION_KINDS.INFLOW;
        const amountCents = leg.amountCents;

        if (period == null) {
          if (inflow && leg.budgetId == null) undatedIncomeCents += amountCents;
          else undatedSpentCents += inflow ? -amountCents : amountCents;
          continue;
        }

        // Income is an inflow naming no category, and it is the only inflow the
        // household actually earned.
        if (inflow && leg.budgetId == null) {
          month.incomeCents += amountCents;
          continue;
        }

        const budgetId = leg.budgetId ?? UNCATEGORIZED_BUDGET_ID;
        const entry = categoryEntry(budgetId);
        const field = inflow ? "refundCents" : "spentCents";
        month[field] += amountCents;
        entry[field] += amountCents;
        entry.months.add(period);

        // The month's own bucket split, signed the way `netSpentCents` is: a
        // refund comes back off the bucket it was filed under rather than
        // landing anywhere else. A category filed under no bucket — the
        // Uncategorized sentinel, or an id whose category was deleted — keys on
        // null and gets a segment of its own, because the segments have to add
        // up to the month's spending or the stack describes a smaller month
        // than the column it is drawn in.
        const bucket = filing.get(budgetId)?.bucket ?? null;
        const signed = inflow ? -amountCents : amountCents;
        month.byBucket.set(bucket, (month.byBucket.get(bucket) ?? 0) + signed);

        let entryMonth = entry.monthly.get(period);
        if (!entryMonth) {
          entryMonth = { spentCents: 0, refundCents: 0 };
          entry.monthly.set(period, entryMonth);
        }
        entryMonth[field] += amountCents;

        entry.transactions.push({
          id: transaction.id,
          date: transaction.date,
          // The reference, never the name: this hook reads the ledger and
          // `toSections` and nothing else, and a payee's name is not money. The
          // page it feeds resolves it — see `ReportsPage`.
          payeeId: transaction.payeeId,
          description: transaction.description,
          // **The part, not the receipt.** A row here is what this category was
          // charged, and it is what the figures above it add up to; the whole is
          // carried beside it so the drill-in can say the row is a part of
          // something larger rather than appearing to contradict the register.
          amountCents,
          wholeAmountCents: amountCents === transaction.amountCents ? null : transaction.amountCents,
          kind: transaction.kind,
          accountId: transaction.accountId,
        });
      }
    }

    // How many months the per-month average is honestly divided by.
    //
    // **The window, clipped to where the books actually start** — not the number
    // of months the category itself was active in. Amortising is the whole point
    // of the figure: a $1,200 premium paid once reads as $100 a month, which is
    // what makes it comparable with the rent beside it, and dividing it by the
    // one month it was paid in would report it as $1,200 a month. But dividing
    // three months of records by twelve understates every category by four, and
    // silently, so the divisor stops at the first month on file and the page
    // prints what it was.
    //
    // **Clipped at both ends, and the far end is the calendar's.** A window that
    // ends at the current month — which every preset does — has nothing to clip
    // there, but a custom window may be asked to run to December while it is
    // still October, and counting those two unlived months in the divisor would
    // understate every figure on the page by a sixth. A month that has not
    // happened is as empty as one nobody wrote anything down in, and for a
    // better reason.
    const thisMonth = currentPeriod();
    const covered = months.filter(
      (period) =>
        (firstPeriod == null || periodLTE(firstPeriod, period)) && periodLTE(period, thisMonth)
    );
    const averagedOverMonths = Math.max(1, covered.length);
    const coverageStartPeriod = covered[0] ?? startPeriod;
    // The last month in the window the books could have anything to say about.
    // Reported alongside the start so the chart and its table twin can withhold
    // a verdict past the present exactly as they withhold one before the first
    // record — the plan's threshold is still drawn across both, because a
    // standing figure neither began when the records did nor ends at today.
    const coverageEndPeriod = covered[covered.length - 1] ?? coverageStartPeriod;
    const perMonth = (cents) => Math.round(cents / averagedOverMonths);

    const series = months.map((period) => {
      const month = byMonth.get(period);
      const netSpentCents = month.spentCents - month.refundCents;
      return {
        ...month,
        netSpentCents,
        // Signed, and it is cash: what came in less what went out, for this
        // month alone. Nothing carries forward — that is the balance's job.
        netCents: month.incomeCents - netSpentCents,
        // The month's spending split by bucket, in `PLAN_BUCKET_ORDER` with
        // unfiled last — a fixed list in a fixed order, including the buckets
        // this month spent nothing in. A stacked chart has to be able to colour
        // a series by its position, and a list that dropped its empty entries
        // would hand the same index to different buckets in different months.
        buckets: BUCKET_SERIES.map((entry) => ({
          ...entry,
          netSpentCents: month.byBucket.get(entry.bucket) ?? 0,
        })),
        // What the plan intended for this same month. Standing, so it is the
        // same figure in every month of the window — which is exactly what
        // makes it readable as a threshold the columns cross rather than as a
        // second series with a shape of its own.
        plannedCents,
      };
    });

    const totalIncomeCents = series.reduce((sum, month) => sum + month.incomeCents, 0);
    const totalSpentCents = series.reduce((sum, month) => sum + month.spentCents, 0);
    const totalRefundCents = series.reduce((sum, month) => sum + month.refundCents, 0);
    const netSpentCents = totalSpentCents - totalRefundCents;

    // Every category that moved money in the window, biggest first.
    //
    // **Ranked rather than arranged**, which is the one place this table
    // deliberately parts company with the dashboard's. The plan's arrangement is
    // answered on the dashboard and on the plan itself; the question here is
    // where the money went, and that question has an order of its own. The group
    // each row is filed under travels on the row, so the arrangement is still
    // readable — it is just no longer the axis.
    //
    // A category with nothing against it is dropped, the same rule the dashboard
    // uses: a report of spending is not the place to list what was not spent.
    const rows = [...byCategory.values()]
      .map((entry) => {
        const filed = filing.get(entry.budgetId);
        const netCents = entry.spentCents - entry.refundCents;
        return {
          budgetId: entry.budgetId,
          kind: filed
            ? "category"
            : entry.budgetId === UNCATEGORIZED_BUDGET_ID
              ? "uncategorized"
              : "orphan",
          name:
            filed?.name ??
            (entry.budgetId === UNCATEGORIZED_BUDGET_ID ? "Uncategorized" : "Unknown category"),
          // Null rather than a placeholder heading: the catch-alls are filed
          // under nothing, and a dash is the truthful cell.
          groupName: filed?.groupName ?? null,
          bucket: filed?.bucket ?? null,
          spentCents: entry.spentCents,
          refundCents: entry.refundCents,
          netSpentCents: netCents,
          averageCents: perMonth(netCents),
          // The standing monthly estimate from the plan. Zero means nobody has
          // set one, which is not an estimate of nothing — null, and the table
          // draws it as a dash.
          targetCents: filed?.targetCents ? filed.targetCents : null,
          shareBps: shareBps(netCents, netSpentCents),
          monthsWithSpend: entry.months.size,
          // The window, month by month, for this category alone — the drill-in's
          // chart. Aligned to `months` exactly as `series` is, so a month with
          // nothing against it is a real zero rather than a gap.
          monthly: months.map((period) => {
            const m = entry.monthly.get(period);
            const spent = m?.spentCents ?? 0;
            const refund = m?.refundCents ?? 0;
            return { period, spentCents: spent, refundCents: refund, netCents: spent - refund };
          }),
          // Newest first — the drill-in reads as a register scrolled to the
          // window's own end, not as an accession log.
          transactions: [...entry.transactions].sort((a, b) =>
            a.date === b.date ? 0 : a.date < b.date ? 1 : -1
          ),
        };
      })
      .sort((a, b) => b.netSpentCents - a.netSpentCents);

    // What the spending split into, against what the plan says it should. The
    // plan's own split is on Configuration; this is the same four shares read
    // off the books instead of off the estimates, which is the comparison the
    // pair exists for.
    //
    // A category with no bucket — the Uncategorized sentinel, an id whose
    // category was deleted — cannot be filed under one, so it gets a fifth
    // segment rather than being dropped. The five have to add up to the total
    // or the split is describing a smaller household than the headline does.
    const bucketTotals = new Map(PLAN_BUCKET_ORDER.map((bucket) => [bucket, 0]));
    let unfiledCents = 0;
    for (const row of rows) {
      if (row.bucket != null && bucketTotals.has(row.bucket)) {
        bucketTotals.set(row.bucket, bucketTotals.get(row.bucket) + row.netSpentCents);
      } else unfiledCents += row.netSpentCents;
    }

    const buckets = BUCKET_SERIES.map((entry) => ({
      ...entry,
      netSpentCents: entry.bucket == null ? unfiledCents : bucketTotals.get(entry.bucket),
      // What the plan sets aside for this bucket every month. Null for the
      // unfiled segment rather than zero: there is no estimate for "no
      // category", and a zero there would read as a plan to spend nothing on
      // it, which is a claim nobody made.
      plannedCents: entry.bucket == null ? null : plannedByBucket.get(entry.bucket),
    }))
      .filter((entry) => entry.netSpentCents !== 0)
      .map((entry) => ({
        ...entry,
        averageCents: perMonth(entry.netSpentCents),
        shareBps: shareBps(entry.netSpentCents, netSpentCents),
      }));

    return {
      range: namedRange,
      months,
      startPeriod,
      endPeriod,
      series,

      rows,
      buckets,

      totalIncomeCents,
      totalSpentCents,
      totalRefundCents,
      netSpentCents,
      // The identity: income less what spending actually cost, which is also
      // every inflow less every outflow in the window.
      netCents: totalIncomeCents - netSpentCents,
      // Null on a window with no income — a savings rate needs something to be a
      // rate of, and a household with $2,000 of spending and no recorded pay has
      // not saved −∞ percent, it has a gap in its records.
      savingsRateBps: shareBps(totalIncomeCents - netSpentCents, totalIncomeCents),

      // What the plan intends in a month, against which every column of the
      // plan-and-books chart is read. Standing rather than per-month, so the
      // same figure answers for every month in the window — see the note where
      // it is computed for why it is not `usePlanHealth`'s figure.
      plannedCents,
      // The window's plan: the standing monthly figure times the months the
      // books actually cover, which is the total the window's spending is
      // fairly held against. Times `averagedOverMonths` and not `months.length`
      // for the same reason the per-month average divides by it — a twelve-month
      // window over three months of records would otherwise be compared with a
      // year of plan.
      plannedWindowCents: plannedCents * averagedOverMonths,

      averagedOverMonths,
      coverageStartPeriod,
      coverageEndPeriod,
      // How many months the books could actually cover, which is
      // `averagedOverMonths` without its floor of one — and zero is a real
      // answer, for a custom window made entirely of months that have not
      // happened. The divisor cannot be zero, but the sentence about it has to
      // be able to say so.
      coveredMonths: covered.length,
      averageIncomeCents: perMonth(totalIncomeCents),
      averageSpendCents: perMonth(netSpentCents),
      averageNetCents: perMonth(totalIncomeCents - netSpentCents),

      // Money the report cannot place. Reported so the page can say so out loud
      // rather than leaving the reader to find the gap against the register.
      undatedCount,
      undatedSpentCents,
      undatedIncomeCents,

      hasLedger: transactions.length > 0,
      firstPeriod,
    };
  }, [groups, budgets, transactions, accounts, endPeriod, rangeKey, chosenStartPeriod]);
}
