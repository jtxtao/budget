import { useMemo } from "react";
import {
  ACKNOWLEDGMENT_THRESHOLD_CENTS,
  DEFAULT_GOAL_SOURCE,
  GOAL_SOURCES,
  givingBudgetIds,
  toYear,
  useDonations,
} from "../contexts/DonationsContext";
import { useBudgets } from "../contexts/BudgetsContext";
import { normalizePayeeName, usePayees } from "../contexts/PayeesContext";
import { isSplit, TRANSACTION_KINDS, useTransactions } from "../contexts/TransactionsContext";
// One definition of "a share, or a dash where a share would be a fiction",
// shared with the spending report rather than written a second time here: a
// denominator of zero or of the wrong sign has the same answer wherever it turns
// up, and two versions of that rule would eventually disagree.
import { shareBps } from "./useSpendingReport";

/**
 * A year of giving: what went out, who it went to, how much of it the tax office
 * will recognise, and how that stands against what the household meant to give.
 *
 * The sixth hook that reads across stores, and **the only one whose subject is a
 * calendar year**. Every other view is filed by month, because that is the unit a
 * household plans in — but a deduction is claimed on a return, a return covers a
 * year, and a giving goal that reset every month would be a different promise
 * twelve times over. So the axis here is the year, derived from each gift's own
 * transaction date exactly as a period is derived, and never stored.
 *
 * ## The join, and which side drives it
 *
 * A donation record holds no money: it is a statement about an outflow that is
 * already on the register — see `DonationsContext`. **The ledger drives the
 * join.** A tag whose transaction is gone contributes to nothing at all rather
 * than to a figure with no row behind it, which is what makes the cascade in
 * `deleteTransaction` a tidying rather than a correctness fix.
 *
 * ```
 * given(y)      = Σ tagged outflows dated in y  −  Σ tagged inflows dated in y
 * deductible(y) = the same sum over min(deductibleCents, amountCents)
 * ```
 *
 * **A tagged inflow is money back from the organisation**, and it subtracts — the
 * ledger's own refund rule, applied to the one thing a refund of a gift changes
 * that matters here: a donation returned in the year it was made cannot be
 * claimed in it. Recording it as an inflow against the same category is what the
 * register already does; tagging it is what keeps the deduction honest.
 *
 * **The deductible portion is clamped to the gift.** The store cannot check that
 * bound — it never sees the amount, which lives on the transaction — so an amount
 * edited down on the register can leave a deduction stranded above the gift it
 * belongs to. Clamped here rather than repaired in storage, because the figure
 * the user typed is not wrong, it is out of date, and the moment they put the
 * amount back it means what it said again.
 *
 * ## What is left out, and said out loud
 *
 * **An undated gift is in no year**, the same rule the spending report applies to
 * months and for the same reason: placing it would invent the history the ledger
 * deliberately refuses to invent. They are counted instead — `undatedCount`,
 * `undatedTotalCents` — and the page says so, because money missing from a total
 * has to be visible as missing when that total is going on a return.
 *
 * **Nothing here is a tax calculation.** This reports what was given and what
 * portion of it the household recorded as deductible. It applies no limits, no
 * carry-forward and no standard-deduction comparison, because those are questions
 * about a whole return rather than about a ledger — and a figure that looked like
 * an answer to them would be trusted as one.
 */

/**
 * `useGiving(year)`
 *
 * @param year the calendar year as four digits, e.g. "2026"
 */
export default function useGiving(year) {
  const { recipients, donations, goals, givingSettings } = useDonations();
  const { transactions } = useTransactions();
  const { budgets } = useBudgets();
  const { payeeById } = usePayees();

  return useMemo(() => {
    const transactionById = new Map(transactions.map((transaction) => [transaction.id, transaction]));
    const recipientById = new Map(recipients.map((recipient) => [recipient.id, recipient]));

    const rows = [];
    let totalCents = 0;
    let deductibleCents = 0;
    let awaitingCount = 0;
    let awaitingCents = 0;

    // Gifts with no date to file them under. Counted rather than placed.
    let undatedCount = 0;
    let undatedTotalCents = 0;

    // The earliest year anything was given in, across every year — what the page
    // says when the year on screen is empty but the books are not.
    let firstYear = null;

    // **Spending filed under a giving category is a gift without a tag.** Each
    // untagged outflow there (and each refund back into one) is read as a
    // statement the household never had to write: the organization is the one
    // named like its payee, and the deductible part is the whole gift — or none
    // of it where that organization is marked not deductible. Only the parts of
    // a divided receipt that are filed as giving count. A tag, where one exists,
    // always wins; editing one of these rows writes a tag (`auto` says so).
    const giving = givingBudgetIds(givingSettings, budgets);
    const excluded = new Set(givingSettings?.excludedIds ?? []);
    const tagged = new Set(donations.map((donation) => donation.transactionId));
    const recipientByName = new Map(
      recipients.map((recipient) => [normalizePayeeName(recipient.name), recipient])
    );
    const statements = [...donations];
    const autoAmounts = new Map();
    if (giving.size > 0) {
      for (const transaction of transactions) {
        if (tagged.has(transaction.id) || excluded.has(transaction.id)) continue;
        if (
          transaction.kind !== TRANSACTION_KINDS.OUTFLOW &&
          transaction.kind !== TRANSACTION_KINDS.INFLOW
        ) {
          continue;
        }
        const parts = isSplit(transaction)
          ? transaction.splits
          : [{ budgetId: transaction.budgetId, amountCents: transaction.amountCents }];
        const givenCents = parts
          .filter((part) => giving.has(part.budgetId))
          .reduce((sum, part) => sum + part.amountCents, 0);
        if (givenCents <= 0) continue;

        const payee = transaction.payeeId == null ? null : payeeById.get(transaction.payeeId);
        const recipient = payee ? recipientByName.get(normalizePayeeName(payee.name)) : null;
        autoAmounts.set(transaction.id, givenCents);
        statements.push({
          transactionId: transaction.id,
          recipientId: recipient?.id ?? null,
          deductibleCents: recipient && !recipient.deductible ? 0 : givenCents,
          acknowledged: false,
          auto: true,
        });
      }
    }

    for (const donation of statements) {
      const transaction = transactionById.get(donation.transactionId);
      // An orphaned tag. The ledger is the join, so it is worth nothing here;
      // `deleteTransaction` clears these on the way out.
      if (!transaction) continue;

      const giftYear = toYear(transaction.date);
      if (giftYear != null && (firstYear == null || giftYear < firstYear)) firstYear = giftYear;

      // Money back from the organisation, which subtracts from both figures.
      const returned = transaction.kind === TRANSACTION_KINDS.INFLOW;
      const sign = returned ? -1 : 1;
      // An untagged gift is only the part filed as giving.
      const giftCents = autoAmounts.get(donation.transactionId) ?? transaction.amountCents;
      const amountCents = sign * giftCents;
      const claimedCents = sign * Math.min(donation.deductibleCents, giftCents);

      if (giftYear == null) {
        undatedCount += 1;
        undatedTotalCents += amountCents;
        continue;
      }
      if (giftYear !== year) continue;

      const recipient =
        donation.recipientId == null ? null : recipientById.get(donation.recipientId) ?? null;

      // Big enough that the household's own record of it is not evidence, and
      // no acknowledgment noted yet. Only ever asked of a gift actually being
      // claimed, and never of money coming back.
      const needsAcknowledgment =
        !returned &&
        !donation.acknowledged &&
        claimedCents > 0 &&
        giftCents >= ACKNOWLEDGMENT_THRESHOLD_CENTS;

      rows.push({
        transactionId: donation.transactionId,
        date: transaction.date,
        // The reference rather than the name, for `useSpendingReport`'s reason:
        // this hook is about what was given, and the page resolves who to.
        payeeId: transaction.payeeId,
        description: transaction.description,
        amountCents,
        deductibleCents: claimedCents,
        // What the user typed, before the clamp — so a row whose amount was
        // edited down on the register can say what happened rather than quietly
        // showing a smaller figure than the one that was entered.
        statedDeductibleCents: sign * donation.deductibleCents,
        clamped: donation.deductibleCents > giftCents,
        recipientId: donation.recipientId ?? null,
        // Null is a real state — the organisation was deleted and the gift
        // outlived it — and the row prints it as a gap to be refiled.
        recipientName: recipient?.name ?? null,
        acknowledged: donation.acknowledged,
        needsAcknowledgment,
        returned,
        auto: donation.auto === true,
      });

      totalCents += amountCents;
      deductibleCents += claimedCents;
      if (needsAcknowledgment) {
        awaitingCount += 1;
        awaitingCents += amountCents;
      }
    }

    // Newest first: the gift just entered is the one being checked, and a tax
    // list read from either end adds up the same.
    rows.sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));

    // Every organisation, including the ones given nothing this year — this is
    // the list the page manages, not a ranking of the year's activity, and an
    // organisation that vanished from it in January would look deleted.
    const totals = new Map(
      recipients.map((recipient) => [
        recipient.id,
        {
          recipientId: recipient.id,
          name: recipient.name,
          deductibleByDefault: recipient.deductible,
          totalCents: 0,
          deductibleCents: 0,
          giftCount: 0,
        },
      ])
    );
    // Gifts whose organisation is gone. One bucket rather than one row each, and
    // only when there are any: the figures below have to add up to the total
    // above them, so it cannot simply be dropped.
    const unfiled = {
      recipientId: null,
      name: null,
      deductibleByDefault: false,
      totalCents: 0,
      deductibleCents: 0,
      giftCount: 0,
    };

    for (const row of rows) {
      const entry = totals.get(row.recipientId) ?? unfiled;
      entry.totalCents += row.amountCents;
      entry.deductibleCents += row.deductibleCents;
      entry.giftCount += 1;
    }

    const byRecipient = [...totals.values(), ...(unfiled.giftCount > 0 ? [unfiled] : [])].sort(
      // By what was given, then by name — never by the order they were added, or
      // the list would reshuffle as gifts land. A name of null (the unfiled
      // bucket) sorts last of the zeros, which is where it reads best.
      (a, b) =>
        b.totalCents - a.totalCents ||
        (a.name ?? "￿").localeCompare(b.name ?? "￿")
    );

    // What the household actually earned in the year, on the same definition the
    // spending report uses: an inflow naming no category. A refund is money
    // coming back to a category, and giving a tenth of a refunded jacket is not
    // what anybody means by a tenth of their income.
    //
    // **A transfer is not income here even when it is income to the pool.** Money
    // drawn out of a brokerage into checking becomes spendable, so `useEnvelopes`
    // rightly puts it in "to be assigned" — but it is not something the household
    // earned, and a tithe is a share of earnings. The `kind` test is what keeps
    // the two readings apart, and the divergence is deliberate rather than an
    // oversight in one of them.
    let incomeCents = 0;
    for (const transaction of transactions) {
      if (transaction.kind !== TRANSACTION_KINDS.INFLOW) continue;
      // Naming no category is what makes an inflow income — and an inflow divided
      // between categories names several, so it is refund all the way down and
      // never earnings.
      if (transaction.budgetId != null || isSplit(transaction)) continue;
      if (toYear(transaction.date) === year) incomeCents += transaction.amountCents;
    }

    const stored = goals.find((entry) => entry.year === year) ?? null;
    const source = stored?.source ?? DEFAULT_GOAL_SOURCE;
    const targetCents =
      source === GOAL_SOURCES.INCOME_SHARE
        ? stored?.shareBps == null
          ? null
          : Math.round((incomeCents * stored.shareBps) / 10000)
        : stored?.amountCents ?? null;

    const goal = {
      // A year with no figure on the source in force has no goal — which is most
      // years, and the page asks for one rather than drawing a meter against
      // nothing. The other answer is still carried, so switching back to it
      // finds what was there.
      stated: targetCents != null,
      source,
      amountCents: stored?.amountCents ?? null,
      shareBps: stored?.shareBps ?? null,
      targetCents,
      // Against the target, so a year that gave more than it meant to reads past
      // 100 rather than being capped at it.
      progressBps: targetCents == null ? null : shareBps(totalCents, targetCents),
      remainingCents: targetCents == null ? null : Math.max(0, targetCents - totalCents),
      // What a share-of-income goal is a share *of*, so the page can print the
      // working rather than a figure that moves for no visible reason.
      incomeCents,
    };

    return {
      year,
      firstYear,
      rows,
      byRecipient,

      totalCents,
      deductibleCents,
      // What was given but cannot be claimed — a raffle ticket, the dinner half
      // of a gala ticket, a gift to a person. Reported rather than left to be
      // subtracted, because it is the figure a household is surprised by.
      nonDeductibleCents: totalCents - deductibleCents,
      giftCount: rows.length,

      incomeCents,
      // What the year gave as a share of what it earned. Independent of any
      // goal: it is the figure a household is usually actually asking for.
      shareOfIncomeBps: shareBps(totalCents, incomeCents),

      goal,

      awaitingCount,
      awaitingCents,

      undatedCount,
      undatedTotalCents,

      hasRecipients: recipients.length > 0,
      hasGiving: statements.length > 0,
      givingBudgetIds: giving,
    };
  }, [recipients, donations, goals, givingSettings, budgets, payeeById, transactions, year]);
}
