import { TRANSACTION_KINDS } from "./contexts/TransactionsContext";
import { apportion, formatBps, formatCents } from "./utils";

/**
 * Cash back that a card pays straight onto its own balance — a prepaid card
 * loaded with $5,000 that earns 1% reads $4,901 after a $100 purchase, not
 * $4,900. This module is the arithmetic, and it is pure, like `payeeSearch.js`.
 *
 * **The cash back is its own row in the ledger, an inflow filed under the
 * purchase's category — a refund against it.** Not a smaller outflow: the shop
 * still charged $100, and the register, the spending report and any card offer
 * are about what was charged. Not income either: the household chose to read it
 * as the purchase costing less, so groceries shows $99 of activity and the
 * dollar goes back into that envelope rather than the pool. Two kinds the
 * ledger already has, so neither the envelope identity nor the balance sheet
 * needs a rule for it — the `FixDriftModal` reasoning against a fourth kind.
 *
 * **Written alongside the purchase, never linked to it.** The two rows are
 * edited and deleted apart, the way a refund and the spend it offsets always
 * are: correcting the purchase's amount later leaves the cash back as it was
 * paid, and the row is there on the register to correct by hand.
 *
 * The rate is the account's `cashbackBps` (basis points, the rate discipline:
 * 1% is 100). Rounded to the nearest cent per purchase; an issuer that rounds
 * differently is a cent's drift that a reconciliation closes.
 */

/** The cash back a purchase earns, in cents — zero where there is no rate. */
export function cashbackCents(amountCents, bps) {
  if (!(bps > 0) || !(amountCents > 0)) return 0;
  return Math.round((amountCents * bps) / 10000);
}

/**
 * The inflow a purchase earns on `account`, as `addTransaction`'s argument, or
 * `null` where it earns nothing: no rate, not money out, or less than a cent.
 *
 * A divided receipt is refunded part by part, in proportion — `apportion`, so
 * the parts add up to the whole cash back exactly, which is the store's sum
 * rule. A part too small to earn a cent drops out, and a division left with
 * one part is that part's category, since a division of one is refused.
 */
export function cashbackFor(account, purchase, payeeName) {
  const bps = account?.cashbackBps;
  if (!(bps > 0) || purchase.kind !== TRANSACTION_KINDS.OUTFLOW) return null;
  const total = cashbackCents(purchase.amountCents, bps);
  if (total <= 0) return null;

  let budgetId = purchase.budgetId ?? null;
  let splits = null;
  const parts = purchase.splits ?? [];
  if (parts.length > 0) {
    const shares = apportion(
      parts.map((part) => part.amountCents),
      total
    );
    const earning = parts
      .map((part, index) => ({ budgetId: part.budgetId, amountCents: shares[index] }))
      .filter((part) => part.amountCents > 0);
    if (earning.length === 1) {
      budgetId = earning[0].budgetId;
    } else {
      splits = earning;
      budgetId = null;
    }
  }

  return {
    kind: TRANSACTION_KINDS.INFLOW,
    payeeId: null,
    description: `${formatBps(bps)} cash back on ${formatCents(purchase.amountCents)}${
      payeeName ? ` at ${payeeName}` : ""
    }`,
    amountCents: total,
    date: purchase.date,
    accountId: purchase.accountId,
    budgetId,
    splits,
  };
}
