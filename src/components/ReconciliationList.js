import Button from "./Button";
import { ACCOUNT_SCOPES, ACCOUNT_TYPES, scopeLabel } from "../contexts/AccountsContext";
import { SortableList, useSortableItem } from "./Sortable";
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
 *
 * **Two controls, because there are two sizes of answer.** Most months the
 * statement simply agrees, and `ReconcileModal` makes that cost a press to open
 * and a press to confirm a figure nobody needed to change — so "Accurate" is
 * the whole of that act in one click, and the dialog is kept for the day the two
 * disagree and the difference has to be settled.
 *
 * **It is a check for today, not a box that stays ticked.** What is stored is
 * the day the books and the bank were last found to agree, and the act is
 * saying so about today — so the control is a button that records it, and goes
 * quiet once today is what is on file. A checkbox said something different and
 * neither half of it was true: it stood ticked for a month after a check, as
 * though the state were still being asserted, and unticking it *erased* the
 * date rather than taking the day back, so the one row the user least wanted to
 * disturb was one stray click from reading "Never". Whether an account is
 * overdue is a reading of that date, which the row and the header already give
 * — in the date's tone and in "N need checking" — and a control has no business
 * being a third voice on it.
 */

// A month. Long enough that an account checked at the last statement is not
// nagged about, short enough that a figure nobody has confirmed this cycle is.
const STALE_AFTER_DAYS = 31;

/**
 * The panel's one definition of up to date, read by the tick box and the header
 * count alike so neither can drift from the other.
 *
 * `daysSince` is null exactly when nothing has been reconciled, which is why the
 * date is tested rather than the age — `null <= 31` is true in JS, and an
 * account nobody has ever checked is the one case this must never call settled.
 */
function isUpToDate(account, daysSince, balanceCents) {
  if (account.type === ACCOUNT_TYPES.LIABILITY && balanceCents === 0) return true;
  return account.reconciledOn != null && daysSince <= STALE_AFTER_DAYS;
}

/**
 * How the date reads, and whether it needs attention.
 *
 * Colour is never the only channel — the state has a word of its own on the row
 * — and on this light surface `vermilion-ink` is the one warning tone that
 * carries text, since the accents are tuned for the dark chrome.
 */
function reconciliation(account, daysSince, balanceCents) {
  const settled = account.type === ACCOUNT_TYPES.LIABILITY && balanceCents === 0;
  if (account.reconciledOn == null) {
    return {
      text: "Never",
      note: "Not checked yet",
      tone: settled ? "text-ink" : "text-vermilion-ink",
    };
  }
  return {
    text: formatDateMedium(account.reconciledOn),
    note: formatDayDelta(-daysSince),
    tone: !settled && daysSince > STALE_AFTER_DAYS ? "text-vermilion-ink" : "text-ink",
  };
}

function ReconciliationRow({
  account,
  balanceCents,
  daysSince,
  striped,
  onReconcile,
  onPayOff,
  onConfirm,
  sortable,
}) {
  const item = useSortableItem(account.id, { disabled: !sortable });
  const status = reconciliation(account, daysSince, balanceCents);
  // The same single definition of trouble as everywhere else: something owned
  // that has gone under. Neither way a debt can read is trouble — owed is what a
  // debt is for, and a card in credit is money waiting on it.
  const overdrawn = account.type !== ACCOUNT_TYPES.LIABILITY && balanceCents < 0;
  // Today is already on file, so there is nothing left for the button to say.
  // Tested on the date rather than the age, as `isUpToDate` is: `daysSince` is
  // null exactly when nothing has been reconciled, and `null === 0` is false
  // only by luck of which comparison was written.
  const checkedToday = account.reconciledOn != null && daysSince === 0;

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
    <div
      ref={item.ref}
      style={item.style}
      {...item.handle}
      className={`px-4 py-2 ${striped ? "bg-sheet-alt" : "bg-sheet"}`}
    >
      <div className="flex items-baseline gap-3">
        <span className="min-w-0 flex-1 truncate font-sans text-row text-ink">
          {account.name}
        </span>
        <div
          className={`shrink-0 font-mono text-row font-medium tabular-nums ${
            overdrawn ? "text-vermilion-ink" : "text-ink"
          }`}
        >
          {formatCents(balanceCents)}
        </div>
      </div>

      <div className="mt-0.5 flex flex-wrap items-start gap-x-3 gap-y-1">
        {/* This line **wraps rather than truncates**, which is the one thing it
            must do differently from the name above it. Both the day and how
            long ago it was are on it — the exact date is the fact, the relative
            note is the staleness at a glance — and at this width they do not
            fit beside the action on one line. Truncating would drop the half
            that carries the tone; a name is still recognisable from its start,
            but "SEP 28, 2026 · 3 D…" is not a date anybody can read. So it is
            allowed a second line instead, and nothing is hidden. */}
        {/* Sized to its content rather than `flex-1`, which is what makes the
            wrap fall in the right place: a flex item that may not shrink below
            its own content pushes the action group onto a line of its own the
            moment the two no longer fit, instead of the date being squeezed to
            three ragged lines beside it. On a wider container they share one
            line, and nothing had to name a breakpoint to say so. */}
        <div className="text-label uppercase">
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
            a reconciliation does — so it needs no tick box of its own, since
            the payment already stamps it. Everything else gets both answers:
            the box for "it agrees", the dialog for when it does not. */}
        {account.scope === ACCOUNT_SCOPES.CREDIT_CARD ? (
          <Button
            variant="row-action"
            size="sm"
            className="ml-auto"
            aria-label={`Record paying off ${account.name}`}
            onClick={() => onPayOff(account)}
          >
            Paid off
          </Button>
        ) : (
          /* The pair is one shrink-0 group so the status line keeps every pixel
             the two of them do not need, and `flex-wrap` on the line above lets
             the group drop below the date rather than squeezing it at 355px. */
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {/* The quick answer leads, since it is the one most months want,
                and both wear the same weight: which is the right press is the
                statement's business, not something a louder button can know.
                Every row would otherwise hold a control called "Accurate", so
                the account's name is in the accessible name. */}
            <Button
              variant="row-action"
              size="sm"
              disabled={checkedToday}
              aria-label={
                checkedToday
                  ? `${account.name} was checked today`
                  : `Mark ${account.name} accurate today`
              }
              onClick={() => onConfirm(account)}
            >
              {checkedToday ? "Checked" : "Accurate"}
            </Button>
            <Button
              variant="row-action"
              size="sm"
              aria-label={`Reconcile ${account.name}`}
              onClick={() => onReconcile(account)}
            >
              Reconcile
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * `onReorder`, where given, lets a row be picked up and dropped to put the
 * accounts in the household's own order — the order every account list in the
 * app reads.
 */
export default function ReconciliationList({
  rows,
  onReconcile,
  onPayOff,
  onConfirm,
  onReorder,
}) {
  const unchecked = rows.filter((row) => !isUpToDate(row.account, row.daysSince, row.balanceCents)).length;

  return (
    <section className="overflow-hidden rounded-2xl border border-edge bg-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-edge px-4 py-3">
        <div className="min-w-0">
          <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">Accounts</h2>
        </div>
        {rows.length > 0 && (
          <span
            className={`text-label uppercase ${
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
        <SortableList
          ids={rows.map((row) => row.account.id)}
          onReorder={onReorder ?? (() => {})}
        >
          {rows.map((row, index) => (
            <ReconciliationRow
              key={row.account.id}
              account={row.account}
              balanceCents={row.balanceCents}
              daysSince={row.daysSince}
              striped={index % 2 === 1}
              onReconcile={onReconcile}
              onPayOff={onPayOff}
              onConfirm={onConfirm}
              sortable={onReorder != null}
            />
          ))}
        </SortableList>
      )}
    </section>
  );
}
