import { useRef, useState } from "react";
import Button from "./Button";
import PayeeField from "./PayeeField";
import { insideBudget, spendsThroughBudget } from "../contexts/AccountsContext";
import { UNCATEGORIZED_BUDGET_ID } from "../contexts/constants";
import { isSplit, isTransfer, TRANSACTION_KINDS } from "../contexts/TransactionsContext";
import { amountAtRest, amountEditing, formatCents, formatDateMedium, formatPeriod, toCents } from "../utils";

/**
 * The ledger as a register: one row per movement of money, every field on it
 * editable where it sits.
 *
 * A single colored amount shows direction at a glance. On ordinary transactions,
 * a sign while editing changes direction without losing the rest of the row.
 *
 * **A transfer row is the one that does not work that way.** Its direction is
 * its pair of accounts, stacked in the Account cell. Whether it has a category
 * to file is not the user's choice either: only a transfer
 * leaving the budget comes out of an envelope, so the rest show a dash there too.
 * Both rules are read off `insideBudget`, the same predicate
 * `AddTransactionModal` and `budgetLegs` ask, so no two screens can disagree about
 * one row.
 *
 * **A split row is the other one that does not.** Its category is not one
 * answer but several, and its figure is whatever those add up to, so neither
 * cell can be edited where it sits: a part typed down on its own would leave the
 * division short of the whole, and the store would refuse it every time. Both
 * cells become buttons onto `SplitTransactionModal`, where the total and the
 * parts move together and commit at once.
 *
 * **The Payee column holds two fields, not one.** Who the money went to is the
 * row's subject and is named through `PayeeField`, which searches the payee list
 * as the letters go in and offers to create one that is not there yet; the note
 * beside it is what the single free-text column used to be, and is where every
 * row written before payees existed still carries its text. They share one column
 * to preserve room for the amount and stay inside the container — the same
 * arithmetic that put both ends of a transfer in the Account cell. Naming a payee here **never** re-files the row's
 * category, even where the payee has a default one: that default seeds a new
 * transaction, and money already filed is not moved because a name was corrected.
 *
 * **Which of the two is drawn is `nameOf`'s own rule, applied to the layout.**
 * The note is a remark *beside* a name, not a second name, so where a payee
 * already names the row the note folds into one mark at the end of it: a comment
 * icon, drawn only when there is something to read, the note itself on hover, and
 * the field to edit it on a click. Sixty rows each carrying an empty second line
 * inviting a note is sixty invitations to write something nobody wanted to write,
 * and it costs the register the one-line row it is read in. **Where no payee names
 * the row the note is on the face of it**, as it always was — which is every row
 * written before payees existed, and every transfer, since a transfer moves money
 * between the household's own accounts and has no other end to name. That is the
 * same precedence `nameOf` reads, so what identifies a row and what is drawn on it
 * cannot come apart.
 *
 * Cells commit on **blur**, the same contract as `CategoryPlanner` and for the
 * same reason: a half-typed "1" on the way to "14" is a real figure, and
 * committing per keystroke would put it through the store. The two selects
 * commit on **change**, because there is nothing to type and the choice is made
 * the moment it is made — and they are controlled, so a value the store refuses
 * simply never appears. Everything else is uncontrolled and keyed on what is
 * stored, so a successful commit re-seeds the cell with what was actually saved
 * and a refused one is put back.
 *
 * Clearing a cell is an **abandoned edit, not a value**. A blank date does not
 * un-date a record and a blank amount is not a transaction of nothing; both put
 * the stored figure back. That is what leaves the keyboard free to select-all
 * and retype without the intermediate empty state meaning anything.
 *
 * Undated rows — the ones folded in from before the ledger tracked dates —
 * belong to no month, so a register that only ever showed one month would put
 * them out of reach forever. They get a band of their own, below the month, and
 * typing a date into one is what files it.
 */

// Header and body cells are driven off one list for the same reason
// `CategoryLedgerTable` does it: the two must not disagree about how many
// columns there are, which is what the band, footer and error rows span.
// Fixed widths, on a `table-fixed` layout, because a register's columns are
// the same width on every row of every month — a grid that resized itself to
// whatever happened to be typed in it would not be one. Each is sized to what
// the column actually holds: a date, a category name, an account name, a figure.
// Description names no width and so takes whatever is left.
const COLUMNS = [
  // Two fields in one column, which is the transfer's own precedent applied
  // again: the fixed columns have to stay inside the container. The
  // payee leads because it identifies the row; the note is the mark after it.
  { key: "payee", label: "Payee & note" },
  { key: "date", label: "Date", width: "w-36" },
  { key: "budgetId", label: "Category", width: "w-40" },
  { key: "accountId", label: "Account", width: "w-36" },
  { key: "amount", label: "Amount", width: "w-40", numeric: true },
];

// Everything to the left of the amount column, which is what a subtotal
// label spans. Derived rather than written as a number, so reordering the list
// above cannot leave a stale colspan behind.
const LEAD_SPAN = COLUMNS.findIndex((column) => column.numeric);
// The remove button has a column of its own with no heading.
const FULL_SPAN = COLUMNS.length + 1;

const rowBg = (index) => (index % 2 === 0 ? "bg-sheet" : "bg-sheet-alt");

// No rule under a cell at rest. `CategoryPlanner` draws one because it holds
// three fields on a row and they have to read as fields; a register is sixty of
// them, and sixty underlines is a grid of noise laid over the figures the page
// exists to show. The rule appears under the pointer and turns azure under the
// caret, so editability is answered where it is being asked about.
const cellBase =
  "w-full min-w-0 border-0 border-b-2 border-transparent px-0 py-1 font-sans text-row text-ink outline-none transition-colors hover:border-rule focus:border-azure";

const cellInput = `${cellBase} bg-transparent placeholder:text-ink-soft/60`;

const figureInput = `${cellBase} bg-transparent text-right font-mono tabular-nums`;

// A `<select>` with a transparent background paints its option list against
// whatever is behind it — see `Field.js` — which on a zebra table means the
// row's own shade rather than the page's.
// `truncate` is on the selects and deliberately not on `cellBase`: a fixed
// 144px column cannot hold "Everyday checking", and a select clips the
// overflow mid-glyph by default — "Everyday checkii", which reads as a
// rendering fault rather than as a name that did not fit. An input must not
// have it, since it scrolls its own content while the caret is in it.
const cellSelect = (index) => `${cellBase} ${rowBg(index)} truncate`;

/**
 * The mark that says this row carries a note.
 *
 * Filled where there is a note to read and an outline where there is not, so the
 * two states are told apart by weight rather than by presence alone — the empty
 * one is only on screen while the row is under the pointer, and a reader who
 * finds it there has to be able to see at a glance that it is an invitation
 * rather than something they have missed.
 */
function NoteIcon({ filled }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5 shrink-0">
      <path
        d="M3.25 2.5H12.75A1.75 1.75 0 0 1 14.5 4.25V9.75A1.75 1.75 0 0 1 12.75 11.5H7.5L4.5 14V11.5H3.25A1.75 1.75 0 0 1 1.5 9.75V4.25A1.75 1.75 0 0 1 3.25 2.5Z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// The icon sits at the end of the payee's own line, so it takes the line's
// baseline and none of its width. A note to read keeps it on screen; an empty
// one appears with the pointer — and on a touch screen, where there is no
// pointer to appear with, it is simply always there. `invisible` would be the
// shorter way to hide it and the wrong one: a hidden element cannot be reached
// by the keyboard, and this is the only route to the note on a named row.
const noteMark =
  "shrink-0 self-center rounded-sm p-0.5 text-ink-soft transition-colors hover:text-ink focus-visible:text-ink max-sm:flex max-sm:min-h-8 max-sm:min-w-8 max-sm:items-center max-sm:justify-center";
const noteMarkQuiet = "sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100";

/**
 * What a row is called when something has to be said about it out loud.
 *
 * The payee first, since that is what the row is *about*, and the note only where
 * there is no payee — which is every row written before payees existed, and every
 * transfer. Both are what a household would actually say to identify the line.
 */
const nameOf = (transaction, payeeById) =>
  payeeById?.get(transaction.payeeId)?.name || transaction.description || "untitled entry";

// Starting a split is an answer to the question the Category column asks — "which
// category did this come out of?", answered with "several" — so it lives in that
// select rather than in a control of its own. There is no width for another
// control on this grid, and a seventh column is the thing CLAUDE.md names as the
// mistake not to make. Picking it opens the editor; the select is controlled, so
// it snaps straight back to what the row actually says.
const START_SPLIT = "__split__";

/**
 * Income and spending totals, shown by color and order in one column.
 *
 * A transfer is in neither: it moved money between accounts, not into or out
 * of the household.
 */
function totalsOf(transactions) {
  return transactions.reduce(
    (totals, transaction) => {
      if (isTransfer(transaction)) return totals;
      return transaction.kind === TRANSACTION_KINDS.INFLOW
        ? { ...totals, inCents: totals.inCents + transaction.amountCents }
        : { ...totals, outCents: totals.outCents + transaction.amountCents };
    },
    { inCents: 0, outCents: 0 }
  );
}

function FlowTotals({ totals, onPanel = false }) {
  if (onPanel) {
    return (
      <div className="flex w-max max-w-full flex-wrap items-center justify-end gap-x-3 gap-y-1 leading-tight">
        <span className="whitespace-nowrap text-vermilion">
          <span className="text-label uppercase">Out </span>
          {formatCents(totals.outCents)}
        </span>
        <span className="whitespace-nowrap text-verdant">
          <span className="text-label uppercase">In </span>
          {formatCents(totals.inCents)}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end leading-tight">
      <span className="text-verdant">
        <span className="sr-only">Money in </span>
        {formatCents(totals.inCents)}
      </span>
      <span className="text-vermilion-ink">
        <span className="sr-only">Money out </span>
        {formatCents(totals.outCents)}
      </span>
    </div>
  );
}

/** A colored figure; a leading sign while editing changes an ordinary row's direction. */
function AmountCell({ transaction, label, onCommit, onSplit }) {
  const transfer = isTransfer(transaction);
  const split = isSplit(transaction);
  const inflow = transaction.kind === TRANSACTION_KINDS.INFLOW;
  const tone = inflow ? "text-verdant" : "text-vermilion-ink";

  if (split) {
    return (
      <td data-label="Amount" className="px-3 py-1">
        <button
          type="button"
          aria-label={`Amount for ${label} — open the split to change it`}
          onClick={() => onSplit(transaction)}
          className={`${cellBase} bg-transparent text-right font-mono tabular-nums ${tone}`}
        >
          {amountAtRest(transaction.amountCents)}
        </button>
      </td>
    );
  }

  const display = amountAtRest(transaction.amountCents);
  const editable = transfer
    ? amountEditing(transaction.amountCents)
    : `${inflow ? "+" : "-"}${amountEditing(transaction.amountCents)}`;

  function handleBlur(e) {
    const raw = e.target.value.trim().replace(/^−/, "-");
    const parsed = raw === "" ? null : toCents(raw);
    if (parsed != null) {
      const amountCents = Math.abs(parsed);
      const kind = transfer
        ? transaction.kind
        : raw.startsWith("+")
          ? TRANSACTION_KINDS.INFLOW
          : raw.startsWith("-")
            ? TRANSACTION_KINDS.OUTFLOW
            : transaction.kind;
      const patch = {};
      if (amountCents !== transaction.amountCents) patch.amountCents = amountCents;
      if (kind !== transaction.kind) patch.kind = kind;
      if (Object.keys(patch).length > 0) onCommit(transaction, patch);
    }
    e.target.value = display;
  }

  return (
    <td data-label="Amount" className="px-3 py-1">
      <div className={`flex items-center justify-end font-mono tabular-nums ${tone}`}>
        <input
          type="text"
          inputMode={transfer ? "decimal" : "text"}
          key={`${transaction.kind}:${transaction.amountCents}`}
          defaultValue={display}
          aria-label={`Amount for ${label}`}
          aria-description={transfer ? undefined : "Type a leading plus for money in or minus for money out."}
          style={{ width: `${display.length}ch` }}
          onFocus={(e) => {
            e.target.value = editable;
            e.target.style.width = `${Math.max(display.length, editable.length)}ch`;
            e.target.select();
          }}
          onChange={(e) => {
            e.target.style.width = `${Math.max(display.length, e.target.value.length)}ch`;
          }}
          onBlur={(e) => {
            handleBlur(e);
            e.target.style.width = `${display.length}ch`;
          }}
          className={`${figureInput} ${tone}`}
        />
      </div>
    </td>
  );
}

/**
 * One account cell's select: the accounts on offer, plus whatever this row
 * actually names.
 *
 * The current value **always** has an option, even when it is not one this list
 * would offer — an off-budget account, an account since deleted, the blank a
 * detached row carries. Without it the select would show its first option instead
 * and the row would appear to have been refiled by simply being looked at.
 */
function AccountSelect({ value, label, offered, accounts, index, onChange }) {
  const known = offered.some((account) => account.id === value);
  const held = accounts.find((account) => account.id === value);

  return (
    <select
      value={value ?? ""}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
      className={cellSelect(index)}
    >
      {value == null && <option value="">— none</option>}
      {offered.map((account) => (
        <option key={account.id} value={account.id}>
          {account.name}
        </option>
      ))}
      {value != null && !known && (
        <option value={value}>{held?.name ?? "Unknown account"}</option>
      )}
    </select>
  );
}

function RegisterRow({
  transaction,
  index,
  budgets,
  accounts,
  payees,
  payeeById,
  inside,
  error,
  onCommit,
  onPayeeCommit,
  onDelete,
  onSplit,
}) {
  const label = nameOf(transaction, payeeById);
  const transfer = isTransfer(transaction);
  const split = isSplit(transaction);
  const isInflow = transaction.kind === TRANSACTION_KINDS.INFLOW;
  // A payee names the row, so the note beside it is a remark and folds into the
  // mark at the end of the name. With no payee the note is the row's name and
  // stays on the face of it — `nameOf`'s own precedence, read as a layout.
  const named = transaction.payeeId != null;
  const hasNote = transaction.description !== "" && transaction.description != null;
  // Open only while the note is being written, which is why it is state here and
  // not a field: a row's note is read far more often than it is edited.
  const [noteOpen, setNoteOpen] = useState(false);
  const noteMarkRef = useRef(null);

  // The current value always has an option, even when it is not one the form
  // would offer: an off-budget account, an account since deleted, or the
  // Uncategorized sentinel a deleted category left behind. Without it the
  // select would show its first option instead and the row would appear to have
  // been refiled by simply being looked at.
  const knownBudget = budgets.some((budget) => budget.id === transaction.budgetId);
  // An archived account is retired rather than deleted — it keeps every
  // transaction that already names it — so it is left out of what a row is
  // *offered* on the same terms an off-budget account already is, while
  // `AccountSelect`'s own "the current value always has an option" rule is
  // what keeps a row already filed against one showing it correctly.
  const active = accounts.filter((account) => !account.archived);
  // A transfer may name a holding on either end — it is the one record that may,
  // for the reason `AddTransactionModal` gives. Every other row spends through the
  // budget or it is a legacy record, and neither wants the holdings on offer.
  const spendable = active.filter(spendsThroughBudget);
  const offered = transfer ? active : spendable;
  // Only a transfer that leaves the budget comes out of a category; the rest move
  // no plan money and have nothing to file. Same rule as the form, read off the
  // same predicate, so the two screens cannot ask different questions of one row.
  const crossesOut = transfer && inside(transaction.accountId) && !inside(transaction.toAccountId);
  const wantsCategory = !transfer || crossesOut;

  function handleDateBlur(e) {
    const next = e.target.value;
    if (next === (transaction.date ?? "")) return;
    if (next === "") {
      e.target.value = transaction.date ?? "";
      return;
    }
    const result = onCommit(transaction, { date: next });
    if (!result.ok) e.target.value = transaction.date ?? "";
  }

  function handleDescriptionBlur(e) {
    if (e.target.value.trim() === transaction.description) {
      e.target.value = transaction.description;
      setNoteOpen(false);
      return;
    }
    const result = onCommit(transaction, { description: e.target.value });
    if (!result.ok) {
      // Refused, so the field stays where it is with the reason under the row —
      // the contract every panel outside a modal keeps. Closing it would take
      // away the thing the message is asking to have corrected.
      e.target.value = transaction.description;
      return;
    }
    setNoteOpen(false);
  }

  // Escape abandons the edit rather than committing it, and hands the keyboard
  // back to the mark it was opened from — the field is gone by then, so there is
  // nowhere else for focus to be.
  function handleNoteKeyDown(e) {
    if (e.key !== "Escape") return;
    e.target.value = transaction.description;
    setNoteOpen(false);
    noteMarkRef.current?.focus();
  }

  // One field, drawn either on the row or under the mark. The two differ by
  // where they sit and nothing else, so the editing contract cannot come apart
  // between them.
  const noteField = (opened) => (
    <input
      type="text"
      key={transaction.description}
      defaultValue={transaction.description}
      // A quiet invitation rather than a dash on a row that has no payee to name
      // it either: an empty field marked "—" reads as a value that is missing
      // instead of one that was never wanted. A transfer names nobody by
      // definition, so there is nothing to invite.
      placeholder={transfer ? "—" : "+ note"}
      aria-label={`Note on ${label}`}
      autoFocus={opened}
      onBlur={handleDescriptionBlur}
      onKeyDown={opened ? handleNoteKeyDown : undefined}
      className={`${cellInput} ${transfer ? "" : "text-ink-soft"}`}
    />
  );

  return (
    <>
      {/* `group` is what lets the note's mark appear with the pointer: it is the
          only thing on the row that is not drawn at rest. */}
      <tr className={`group ${rowBg(index)}`}>
        {/* The payee, with the note as the mark after it — or the note alone,
            where no payee names the row. A transfer is always the second case: it
            moves money between the household's own accounts and has no other end
            to name, which is also what every row written before payees existed
            shows. The payee field is keyed on the stored payee so a commit
            re-seeds it with what actually landed. */}
        <td data-label="Payee & note" className="px-3 py-1">
          {transfer ? (
            noteField(false)
          ) : named ? (
            <>
              <div className="flex items-baseline gap-1">
                {/* `min-w-0` or the field's own content sets a floor the flex
                    row will not go below, and the mark is pushed out of a
                    144px-ish column. */}
                <div className="min-w-0 flex-1">
                  <PayeeField
                    surface="cell"
                    key={transaction.payeeId}
                    label={`Payee of ${label}`}
                    payees={payees}
                    value={transaction.payeeId}
                    placeholder="—"
                    inputClassName={cellInput}
                    onCommit={(committed) => onPayeeCommit(transaction, committed)}
                  />
                </div>
                <button
                  type="button"
                  ref={noteMarkRef}
                  // The note on hover, which is the whole point of folding it
                  // away: a native tooltip rather than one of our own, because
                  // the register scrolls on one axis and a box drawn inside a
                  // cell would be clipped on the other — the same trap
                  // `PayeeField` steps around with a fixed-positioned list.
                  title={hasNote ? transaction.description : "Add a note"}
                  // Said out loud as well as shown, or the note would be
                  // readable only by opening the field that writes it.
                  aria-label={
                    hasNote
                      ? `Note on ${label}: ${transaction.description}`
                      : `Add a note to ${label}`
                  }
                  aria-expanded={noteOpen}
                  // Open, deliberately not toggle: the field commits and closes
                  // on blur, so by the time a second click lands the field has
                  // already gone and a toggle would read as having done nothing.
                  // Escape is what closes it without leaving the keyboard.
                  onClick={() => setNoteOpen(true)}
                  className={`${noteMark} ${hasNote || noteOpen ? "" : noteMarkQuiet}`}
                >
                  <NoteIcon filled={hasNote} />
                </button>
              </div>
              {noteOpen && noteField(true)}
            </>
          ) : (
            <>
              <PayeeField
                surface="cell"
                key="nobody"
                label={`Payee of ${label}`}
                payees={payees}
                value={null}
                placeholder="—"
                inputClassName={cellInput}
                onCommit={(committed) => onPayeeCommit(transaction, committed)}
              />
              {noteField(false)}
            </>
          )}
        </td>
        <td data-label="Date" className="px-3 py-1">
          <input
            type="date"
            key={transaction.date ?? "undated"}
            defaultValue={transaction.date ?? ""}
            aria-label={`Date of ${label}`}
            onBlur={handleDateBlur}
            className={`${cellInput} font-mono`}
          />
        </td>
        <td data-label="Category" className="px-3 py-1">
          {wantsCategory && split ? (
            // Not a select: the answer is several categories, and the one control
            // that can state it is the editor. The count is on the face of it so
            // the row says how many without being opened.
            <button
              type="button"
              aria-label={`Split of ${label}, ${transaction.splits.length} parts`}
              onClick={() => onSplit(transaction)}
              className={`${cellBase} bg-transparent text-left`}
            >
              Split ({transaction.splits.length})
            </button>
          ) : wantsCategory ? (
            <select
              value={transaction.budgetId ?? ""}
              aria-label={`Category of ${label}`}
              onChange={(e) =>
                e.target.value === START_SPLIT
                  ? onSplit(transaction)
                  : onCommit(transaction, { budgetId: e.target.value })
              }
              className={cellSelect(index)}
            >
              {/* Offered on an inflow only, where the blank is a real answer:
                  no category means income to assign, a category means a refund
                  back into it. On an outflow the store refuses it, so putting it
                  on screen would only offer a choice that cannot be made. */}
              {isInflow && <option value="">None — income</option>}
              {budgets.map((budget) => (
                <option key={budget.id} value={budget.id}>
                  {budget.name}
                </option>
              ))}
              {transaction.budgetId != null && !knownBudget && (
                <option value={transaction.budgetId}>
                  {transaction.budgetId === UNCATEGORIZED_BUDGET_ID
                    ? "Uncategorized"
                    : "Unknown category"}
                </option>
              )}
              {budgets.length > 0 && <option value={START_SPLIT}>Split between categories…</option>}
            </select>
          ) : (
            // A transfer inside the budget moves no envelope, so there is nothing
            // to file it under. A dash rather than an empty select, which would
            // offer a choice the figures would then ignore.
            <span className="font-mono text-row text-ink-soft" aria-hidden="true">
              —
            </span>
          )}
        </td>
        {/* Both ends of a transfer live here, stacked, rather than in a column of
            their own: another fixed width would push the grid past its container
            at 768px, and the two are one answer read top to bottom. */}
        <td data-label="Account" className="px-3 py-1">
          <AccountSelect
            value={transaction.accountId}
            label={transfer ? `Transferred from, for ${label}` : `Account of ${label}`}
            offered={offered}
            accounts={accounts}
            index={index}
            onChange={(accountId) => onCommit(transaction, { accountId })}
          />
          {transfer && (
            <div className="flex items-baseline gap-1">
              <span aria-hidden="true" className="font-mono text-row text-ink-soft">
                →
              </span>
              <AccountSelect
                value={transaction.toAccountId}
                label={`Transferred to, for ${label}`}
                offered={active.filter((account) => account.id !== transaction.accountId)}
                accounts={accounts}
                index={index}
                onChange={(toAccountId) => onCommit(transaction, { toAccountId })}
              />
            </div>
          )}
        </td>
        <AmountCell
          transaction={transaction}
          label={label}
          onCommit={onCommit}
          onSplit={onSplit}
        />
        <td data-action="remove" className="px-1 py-1 text-right">
          <Button
            type="button"
            variant="row"
            size="sm"
            aria-label={`Remove entry: ${label}`}
            title="Remove transaction"
            className="h-8 w-8 !p-0 focus-visible:bg-band focus-visible:text-vermilion-ink"
            onClick={() => onDelete(transaction)}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="h-4 w-4 shrink-0"
            >
              <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5" />
            </svg>
          </Button>
        </td>
      </tr>
      {/* Under the row rather than beside it, so a rejected edit does not
          change the width of a column the eye is reading down. */}
      {error && (
        <tr className={rowBg(index)}>
          <td colSpan={FULL_SPAN} className="px-3 pb-2">
            <p role="alert" className="font-sans text-row text-vermilion-ink">
              {error}
            </p>
          </td>
        </tr>
      )}
    </>
  );
}

/** A subtotal band across the sheet, on the same shade the group bands use. */
function Band({ name, totals }) {
  return (
    <tr className="bg-band">
      <th
        scope="colgroup"
        colSpan={LEAD_SPAN}
        className="px-3 py-1.5 text-left text-label uppercase text-ink"
      >
        {name}
      </th>
      <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono text-label tabular-nums">
        <FlowTotals totals={totals} />
      </td>
      <td />
    </tr>
  );
}

/** A full-width divider showing when this account was last reconciled. */
function ReconciliationMarker({ date }) {
  return (
    <tr className="bg-band">
      <td colSpan={FULL_SPAN} className="px-3 py-1.5">
        <div className="flex items-center gap-2 text-label uppercase text-ink">
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="h-3.5 w-3.5 shrink-0 text-verdant"
          >
            <path d="M2 8l4 4 8-8" />
          </svg>
          <span>Reconciled through {formatDateMedium(date)}</span>
        </div>
      </td>
    </tr>
  );
}

export default function TransactionRegister({
  period,
  filtered = false,
  transactions,
  budgets,
  accounts,
  payees,
  payeeById,
  reconciledOn = null,
  onChange,
  onPayeeChange,
  onDelete,
  onAdd,
  onSplit,
}) {
  // One at a time, keyed on the row it belongs to: a rejection is a reply to
  // the edit just made, and a page of stale messages from earlier attempts
  // would say nothing about the cell the user is in.
  const [error, setError] = useState(null);

  function commit(transaction, patch) {
    const result = onChange({ id: transaction.id, ...patch });
    setError(result.ok ? null : { id: transaction.id, message: result.error });
    return result;
  }

  /**
   * A payee named on a row: an existing one, a new one, or none at all.
   *
   * It goes through the page rather than through `onChange` because a payee that
   * does not exist yet has to be created before the row can point at it, and the
   * store that creates it is not this component's business. **The category is
   * deliberately left alone** — a payee's default category seeds a *new*
   * transaction, and re-filing money that is already filed because a name was
   * corrected is the one thing this app never does quietly.
   */
  function commitPayee(transaction, committed) {
    const result = onPayeeChange(transaction, committed);
    setError(result.ok ? null : { id: transaction.id, message: result.error });
    return result;
  }

  // Which side of the budget each account sits on, which is the only thing that
  // decides whether a transfer row has a category to file. Built once for the
  // whole grid rather than per row.
  const inside = insideBudget(accounts);

  const dated = transactions.filter((transaction) => transaction.date != null);
  const undated = transactions.filter((transaction) => transaction.date == null);
  const totals = totalsOf(period == null ? transactions : dated);

  // The zebra runs across the whole table rather than restarting under the
  // undated band, so two rows of the same shade never end up either side of it.
  let stripe = 0;

  const rowsFor = (entries) =>
    entries.map((transaction) => (
      <RegisterRow
        key={transaction.id}
        transaction={transaction}
        index={stripe++}
        budgets={budgets}
        accounts={accounts}
        payees={payees}
        payeeById={payeeById}
        inside={inside}
        error={error?.id === transaction.id ? error.message : null}
        onCommit={commit}
        onPayeeCommit={commitPayee}
        onDelete={onDelete}
        onSplit={onSplit}
      />
    ));

  // The marker sits between transactions dated after reconciledOn and those
  // dated on or before it. Since dated is sorted descending, the split point is
  // the first index where date <= reconciledOn.
  const markerIndex =
    reconciledOn != null
      ? dated.findIndex((t) => t.date != null && t.date <= reconciledOn)
      : -1;

  const datedRows = () => {
    if (markerIndex === -1) return rowsFor(dated);
    const after = dated.slice(0, markerIndex);
    const beforeAndOn = dated.slice(markerIndex);
    return (
      <>
        {rowsFor(after)}
        <ReconciliationMarker date={reconciledOn} />
        {rowsFor(beforeAndOn)}
      </>
    );
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-edge bg-panel">
      {transactions.length === 0 ? (
        <p className="px-4 py-5 font-sans text-row text-chalk-soft">
          {filtered ? "No transactions match these filters." : period ? `Nothing recorded in ${formatPeriod(period)}.` : "Nothing recorded yet."}{" "}
          <button
            type="button"
            onClick={onAdd}
            className="text-azure underline underline-offset-2 hover:text-chalk"
          >
            Add a transaction
          </button>{" "}
          {filtered ? "or change the filters to see more entries." : "and it will appear here, editable where it sits."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          {/* No `min-width` floor under the grid, tempting as one is: Chrome
              counts a table's min-width against the *document's* scroll width
              even inside an `overflow-x-auto` box, so a floor wide enough to
              keep the columns apart puts a scrollbar under the whole page. The
              fixed layout already holds the columns steady; below the width they
              need, they shrink together rather than the page sliding sideways. */}
          <table className="reflow w-full table-fixed border-collapse">
            <thead>
              <tr className="bg-panel-raised">
                {COLUMNS.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className={`whitespace-nowrap px-3 py-2 text-xs uppercase tracking-wide text-chalk ${
                      column.width ?? ""
                    } ${column.numeric ? "text-right" : "text-left"}`}
                  >
                    {column.label}
                  </th>
                ))}
                <th scope="col" className="w-10 px-1 py-2">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>

            <tbody>{datedRows()}</tbody>

            {/* Money that moved before the ledger recorded when. It belongs to
                no month, so it sits under every one of them rather than
                vanishing from all of them. */}
            {undated.length > 0 && (
              <tbody>
                <Band name="Undated" totals={totalsOf(undated)} />
                {rowsFor(undated)}
              </tbody>
            )}

            {/* Give the month and both totals the whole footing width, so the
                figures can stay together until the screen actually runs out. */}
            <tfoot>
              <tr className="bg-panel-raised">
                <th
                  scope="row"
                  colSpan={FULL_SPAN}
                  className="px-3 py-2 text-left text-label uppercase text-chalk"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span>{period ? formatPeriod(period) : "All dates"}{filtered ? " · Filtered transactions" : ""}</span>
                    <div className="font-medium normal-case tracking-normal text-row">
                      <FlowTotals totals={totals} onPanel />
                    </div>
                  </div>
                </th>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {undated.length > 0 && (
        <p className="border-t border-edge px-4 py-2.5 font-sans text-row text-chalk-soft">
          Undated entries were logged before the ledger recorded dates. They count in every month's
          carried-in figure and in no month's activity — give one a date to file it.
        </p>
      )}
    </section>
  );
}
