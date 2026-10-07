import Button from "./Button";
import { ACCOUNT_SCOPES, ACCOUNT_TYPES } from "../contexts/AccountsContext";
import { formatCents } from "../utils";

/**
 * The accounts the household holds, split by what each is to the budget.
 *
 * One section per scope — on budget, credit cards, off budget — rather than
 * assets and liabilities in two panels: which side of the balance sheet an
 * account sits on changes only how its balance is signed, while its scope
 * changes what the account is *for*. The everyday account and the card are both
 * spent through this month, so they sit next to each other and both count
 * towards what there is to assign; the 401(k) sits away from both because
 * nothing is assigned to it.
 *
 * Cards get a heading of their own even though the maths treats them as on
 * budget, because what the user wants off this panel is what is owed on the
 * cards as one figure — which is the section subtotal, and is buried the moment
 * a current account is added into the same sum.
 *
 * Owned and owed are still called out, as a band inside the section — but only
 * once a section actually holds a debt, since a list of three bank accounts
 * needs no heading telling it that it is not a mortgage.
 *
 * `balanceById` is what each account currently holds: opening balance plus
 * every transaction through it for an on-budget account or a card, and the
 * same snapshot-aware figure the Net worth page shows for an off-budget
 * holding — see `ConfigurationPage`. Optional: the component takes its rows
 * as props and renders the figures only for accounts the caller has a
 * balance for, so a caller that has none simply gets the names.
 */

function AccountRow({ account, balanceCents, striped, onEdit, onDelete }) {
  // One definition of trouble, as in the category table: an account that is
  // *owned* and has gone under. A debt is negative by definition — red on each
  // would say nothing about any of them — while a current account below zero is
  // the thing worth seeing from across the room.
  const overdrawn = account.type !== ACCOUNT_TYPES.LIABILITY && balanceCents < 0;

  return (
    <div
      className={`flex items-center gap-3 px-4 py-2 ${striped ? "bg-sheet-alt" : "bg-sheet"}`}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate font-sans text-row text-ink">{account.name}</div>
      </div>
      {balanceCents != null && (
        <div
          className={`shrink-0 font-mono text-row font-medium tabular-nums ${
            overdrawn ? "text-vermilion-ink" : "text-ink"
          }`}
        >
          {formatCents(balanceCents)}
        </div>
      )}
      {/* Editing before removing, and drawn as a button where Remove is bare
          text: the quiet one is the destructive one, and the row's ordinary
          action should not have to be reached past it. Both are labelled with
          the account, since a column of them is otherwise a column of the same
          two words. */}
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="row-action"
          size="sm"
          aria-label={`Edit account: ${account.name}`}
          onClick={() => onEdit(account)}
        >
          Edit
        </Button>
        <Button
          variant="row"
          size="sm"
          aria-label={`Remove account: ${account.name}`}
          onClick={() => onDelete(account)}
        >
          Remove
        </Button>
      </div>
    </div>
  );
}

function AccountSection({
  title,
  subtitle,
  scope,
  accounts,
  balanceById,
  addLabel,
  empty,
  onAdd,
  onEdit,
  onDelete,
}) {
  const owned = accounts.filter((account) => account.type !== ACCOUNT_TYPES.LIABILITY);
  const owed = accounts.filter((account) => account.type === ACCOUNT_TYPES.LIABILITY);

  // Label the two sides only when both are present. A list of three bank
  // accounts needs no heading telling it that it is not a mortgage — and neither
  // does the card section, where everything is owed and the heading would repeat
  // the section's own title on every row.
  const labelSides = owed.length > 0 && owned.length > 0;
  const groups = [
    { label: "Owned", accounts: owned },
    { label: "Owed", accounts: owed },
  ].filter((group) => group.accounts.length > 0);

  // Runs across the whole section rather than restarting per group, so a band
  // between two groups does not leave two rows of the same shade touching.
  let stripe = 0;

  // Net, not gross: a section holding a card is worth what it holds minus what
  // is owed on it, which is the only figure that means anything on a panel that
  // deliberately mixes the two sides of the balance sheet. Suppressed entirely
  // when no balances were supplied rather than shown as zero.
  const subtotalCents = balanceById
    ? accounts.reduce((sum, account) => sum + (balanceById.get(account.id) ?? 0), 0)
    : null;

  return (
    <section className="overflow-hidden rounded-2xl border border-edge bg-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-edge px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-3">
            <h3 className="font-sans text-base font-semibold tracking-tight text-chalk">{title}</h3>
            <span className="font-mono text-label uppercase text-chalk-soft">
              {accounts.length} {accounts.length === 1 ? "account" : "accounts"}
            </span>
          </div>
          <p className="mt-0.5 font-sans text-row text-chalk-soft">{subtitle}</p>
        </div>
        <div className="flex items-center gap-3">
          {subtotalCents != null && accounts.length > 0 && (
            <span
              className={`font-mono text-figure font-medium tabular-nums ${
                subtotalCents < 0 ? "text-vermilion" : "text-azure"
              }`}
            >
              {formatCents(subtotalCents)}
            </span>
          )}
          <Button variant="outline" size="sm" aria-label={addLabel} onClick={() => onAdd(scope)}>
            Add account
          </Button>
        </div>
      </div>

      {accounts.length === 0 ? (
        <p className="px-4 py-5 font-sans text-row text-chalk-soft">{empty}</p>
      ) : (
        groups.map((group) => (
          <div key={group.label}>
            {labelSides && (
              <div className="bg-band px-4 py-1 font-mono text-label uppercase text-ink">
                {group.label}
              </div>
            )}
            {group.accounts.map((account) => (
              <AccountRow
                key={account.id}
                account={account}
                balanceCents={balanceById?.get(account.id)}
                striped={stripe++ % 2 === 1}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))}
          </div>
        ))
      )}
    </section>
  );
}

const SECTIONS = [
  {
    scope: ACCOUNT_SCOPES.ON_BUDGET,
    title: "On budget",
    subtitle: "Spending runs through these.",
    addLabel: "Add an on-budget account",
    empty: "Nothing on budget yet. Add the account your everyday money moves through.",
  },
  {
    scope: ACCOUNT_SCOPES.CREDIT_CARD,
    title: "Credit cards",
    subtitle: "Spent through now, paid off later. Counts against what there is to assign.",
    addLabel: "Add a credit card",
    empty: "No cards yet. Add one if you spend on a card and pay it off from these accounts.",
  },
  {
    scope: ACCOUNT_SCOPES.OFF_BUDGET,
    title: "Off budget",
    subtitle: "Held for the long term, tracked for net worth.",
    addLabel: "Add an off-budget account",
    empty:
      "Nothing off budget yet. Add a 401(k), a brokerage, the house, or the mortgage against it — what you hold rather than spend.",
  },
];

export default function AccountList({ accounts, balanceById, onAdd, onEdit, onDelete }) {
  // Filed by scope, with anything unrecognised falling to on budget — matching
  // the store's default, and keeping every account on a screen that is the only
  // place one can be deleted from. Built as a bucket per section rather than a
  // filter per section so no account can land in two, or in none.
  const byScope = new Map(SECTIONS.map((section) => [section.scope, []]));
  for (const account of accounts) {
    (byScope.get(account.scope) ?? byScope.get(ACCOUNT_SCOPES.ON_BUDGET)).push(account);
  }

  return (
    <div className="space-y-3">
      {SECTIONS.map((section) => (
        <AccountSection
          key={section.scope}
          title={section.title}
          subtitle={section.subtitle}
          scope={section.scope}
          accounts={byScope.get(section.scope)}
          balanceById={balanceById}
          addLabel={section.addLabel}
          empty={section.empty}
          onAdd={onAdd}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}
