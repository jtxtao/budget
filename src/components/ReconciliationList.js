import Button from "./Button";
import { ACCOUNT_SCOPES, ACCOUNT_TYPES, scopeLabel } from "../contexts/AccountsContext";
import { formatCents, formatDateMedium, formatDayDelta } from "../utils";

/**
 * Every account, what it holds, and when it was last checked against a
 * statement.
 *
 * The balance beside it is derived — opening plus every transaction through the
 * account — and the reconciliation date is the only thing here that is not. That
 * is exactly why the two belong on one row: the derived figure is only worth
 * trusting as far as the last day someone confirmed it matched the bank, and a
 * balance with no date beside it invites more confidence than the books have
 * earned.
 *
 * The caller hands this only the accounts the budget spends through — an
 * off-budget holding is reconciled from the Net worth page instead, where its
 * balance is actually used.
 */

// A month. Long enough that an account checked at the last statement is not
// nagged about, short enough that a figure nobody has confirmed this cycle is.
const STALE_AFTER_DAYS = 31;

/**
 * How the date reads, and whether it needs attention.
 *
 * Colour is never the only channel — the state has a word of its own on the row
 * — and on this light surface `vermilion-ink` is the one warning tone that
 * carries text, since the accents are tuned for the dark chrome.
 */
function reconciliation(account, daysSince) {
  if (account.reconciledOn == null) {
    return { text: "Never", note: "Not checked yet", tone: "text-vermilion-ink" };
  }
  return {
    text: formatDateMedium(account.reconciledOn),
    note: formatDayDelta(-daysSince),
    tone: daysSince > STALE_AFTER_DAYS ? "text-vermilion-ink" : "text-ink",
  };
}

function ReconciliationRow({ account, balanceCents, daysSince, striped, onReconcile, onPayOff }) {
  const status = reconciliation(account, daysSince);
  // The same single definition of trouble as everywhere else: something owned
  // that has gone under. A debt is negative by definition.
  const overdrawn = account.type !== ACCOUNT_TYPES.LIABILITY && balanceCents < 0;

  return (
    /* Two lines, not three columns. This panel sits in the dashboard's narrow
       side column, where a row of name, figures and button puts the account's
       own name last in the queue for the space: the figure block refuses to
       shrink because the date in it must not wrap, so at 355px the name was
       truncated to five characters while "SEP 28, 2026 · 3 DAYS AGO" — which
       nobody reads first — kept its full width. The name and its balance are
       the pair worth reading together, so they take the top line; what the
       account is and when it was last checked go under them, beside the
       action. */
    <div className={`px-4 py-2 ${striped ? "bg-sheet-alt" : "bg-sheet"}`}>
      <div className="flex items-baseline gap-3">
        <div className="min-w-0 flex-1 truncate font-sans text-row text-ink">{account.name}</div>
        <div
          className={`shrink-0 font-mono text-row font-medium tabular-nums ${
            overdrawn ? "text-vermilion-ink" : "text-ink"
          }`}
        >
          {formatCents(balanceCents)}
        </div>
      </div>

      <div className="mt-0.5 flex items-start gap-3">
        {/* This line **wraps rather than truncates**, which is the one thing it
            must do differently from the name above it. Both the day and how
            long ago it was are on it — the exact date is the fact, the relative
            note is the staleness at a glance — and at this width they do not
            fit beside the action on one line. Truncating would drop the half
            that carries the tone; a name is still recognisable from its start,
            but "SEP 28, 2026 · 3 D…" is not a date anybody can read. So it is
            allowed a second line instead, and nothing is hidden. */}
        <div className="min-w-0 flex-1 font-mono text-label uppercase">
          <span className="text-ink-soft">{scopeLabel(account)}</span>
          <span className="text-ink-soft"> · </span>
          {/* Each half is unbreakable on its own, so the wrap falls between
              them rather than through the middle of "3 DAYS AGO". */}
          <span className={`whitespace-nowrap ${status.tone}`}>{status.text}</span>
          <span className={status.tone}> · </span>
          <span className={`whitespace-nowrap ${status.tone}`}>{status.note}</span>
        </div>
        {/* A card is settled rather than checked: paying it off is the act a
            household does with one each month, and it confirms the same thing
            a reconciliation does. Everything else opens the reconcile dialog,
            which can adjust the books when the statement disagrees. */}
        {account.scope === ACCOUNT_SCOPES.CREDIT_CARD ? (
          <Button
            variant="row-action"
            size="sm"
            aria-label={`Record paying off ${account.name}`}
            onClick={() => onPayOff(account)}
          >
            Paid off
          </Button>
        ) : (
          <Button
            variant="row-action"
            size="sm"
            aria-label={`Reconcile ${account.name}`}
            onClick={() => onReconcile(account)}
          >
            Reconcile
          </Button>
        )}
      </div>
    </div>
  );
}

export default function ReconciliationList({ rows, onReconcile, onPayOff }) {
  const unchecked = rows.filter(
    (row) => row.account.reconciledOn == null || row.daysSince > STALE_AFTER_DAYS
  ).length;

  return (
    <section className="overflow-hidden rounded-2xl border border-edge bg-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-edge px-4 py-3">
        <div className="min-w-0">
          <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">Accounts</h2>
          <p className="mt-0.5 font-sans text-row text-chalk-soft">
            Balance, and when it last agreed with the statement.
          </p>
        </div>
        {rows.length > 0 && (
          <span
            className={`font-mono text-label uppercase ${
              unchecked > 0 ? "text-sulfur" : "text-verdant"
            }`}
          >
            {unchecked > 0 ? `${unchecked} need checking` : "All up to date"}
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-5 font-sans text-row text-chalk-soft">
          No accounts yet. Add one on the budget plan and its balance will follow the ledger from
          there.
        </p>
      ) : (
        rows.map((row, index) => (
          <ReconciliationRow
            key={row.account.id}
            account={row.account}
            balanceCents={row.balanceCents}
            daysSince={row.daysSince}
            striped={index % 2 === 1}
            onReconcile={onReconcile}
            onPayOff={onPayOff}
          />
        ))
      )}
    </section>
  );
}
