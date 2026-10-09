import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import Button from "./Button";
import { ACKNOWLEDGMENT_THRESHOLD_CENTS } from "../contexts/DonationsContext";
import { RECEIPT_ACCEPT, formatFileSize } from "../receipts";
import { amountAtRest, amountEditing, formatCents, formatDayShort, toCents } from "../utils";

/**
 * The year's gifts, one to a row, with the two things only this page knows how to
 * ask editable where they sit.
 *
 * **This table owns the giving facts and the register owns the money facts.** A
 * gift's amount, its date, the account it left and the category it came out of
 * are all the ledger's — they are on the register, editable there, and shown here
 * read-only so the two screens cannot come to disagree about what was given.
 * What is editable here is what the ledger has no field for: which organisation
 * received it, how much of it is deductible, and whether the acknowledgment is in
 * hand. That is the same seam the dashboard and the register cut along, drawn
 * once more.
 *
 * **Removing a gift here removes the tag, not the money.** The outflow stays on
 * the register, because it still happened — this is the user saying it was not a
 * donation, or was filed against the wrong organisation. Deleting the transaction
 * is the register's own action, and it takes the tag with it.
 *
 * Cells commit on **blur** and selects on **change**, the same contract as
 * `TransactionRegister`: a half-typed figure is still a figure, while a choice
 * from a list is made the moment it is made. A blank is an abandoned edit rather
 * than a value — every gift has a deductible portion, and "none of it" is typed
 * as zero — so clearing the cell puts back what is stored.
 */

// Fixed widths on a fixed layout, as on the register: a column of figures that
// resized itself to whatever was typed in it would not be a column. Description
// names no width and takes what is left. No `min-width` on the table itself —
// Chrome counts one against the document's scroll width even inside an
// `overflow-x-auto` box, which puts a scrollbar under the whole page.
// Sized to what each column actually holds — a short date, a name, two figures,
// a checkbox — and kept as narrow as the contents allow, because everything they
// take comes out of the payee cell, which is the only one holding a phrase.
const COLUMNS = [
  { key: "date", label: "Date", width: "w-20" },
  { key: "recipient", label: "Organization", width: "w-40" },
  { key: "payee", label: "Payee" },
  { key: "amount", label: "Given", width: "w-20", numeric: true },
  // Wider than the column beside it by one step, for the two things only this
  // cell can hold: a figure with the clamp note under it, and the flag that a
  // gift is still waiting on its acknowledgment. On a fixed layout a cell that
  // outgrows its column overflows into the next one rather than pushing it
  // along, so the two that can are the two that are given room.
  { key: "deductible", label: "Deductible", width: "w-24", numeric: true },
  { key: "receipt", label: "Receipt", width: "w-28" },
];

const LEAD_SPAN = COLUMNS.findIndex((column) => column.numeric);
const FULL_SPAN = COLUMNS.length + 1;

const rowBg = (index) => (index % 2 === 0 ? "bg-sheet" : "bg-sheet-alt");

// No rule under a cell at rest, for the same reason the register draws none: a
// page of underlines is a grid of noise over the figures it exists to show. The
// rule appears under the pointer and turns azure under the caret.
const cellBase =
  "w-full min-w-0 border-0 border-b-2 border-transparent px-0 py-1 font-sans text-row text-ink outline-none transition-colors hover:border-rule focus:border-azure";

const figureInput = `${cellBase} bg-transparent text-right font-mono tabular-nums`;

// A transparent `<select>` paints its option list against whatever is behind it,
// which on a zebra table is the row's own shade.
const cellSelect = (index) => `${cellBase} ${rowBg(index)}`;

const figureCell = "whitespace-nowrap px-3 py-1 text-right font-mono text-row tabular-nums";

/** What a gift is called when something has to be said about it out loud. */
const nameOf = (row) => row.payeeName || row.description || row.recipientName || "untitled gift";

const OVER_GIFT_ERROR = "A deduction cannot be larger than the gift it comes out of.";

/**
 * How much of one gift is deductible, edited in place.
 *
 * **Formatted at rest, raw under the caret**, through `amountAtRest` /
 * `amountEditing` rather than formatting written here — the app's contract for
 * every money field, and what lets `toCents` take back whatever the field wrote.
 *
 * The bound this cell checks is the one the store cannot: `DonationsContext`
 * never sees the gift's amount, which lives on the transaction, so "no more than
 * the gift itself" is checked where the figure is actually in hand. A gift that
 * has come *back* — a donation returned — is not editable here at all: the
 * refund's sign belongs to the ledger, and the way to restate one is to untag it.
 */
function DeductibleCell({ row, onCommit, onReject }) {
  const display = amountAtRest(row.statedDeductibleCents);

  if (row.returned) {
    return (
      <td data-label="Deductible" className={`${figureCell} text-ink-soft`}>
        {formatCents(row.deductibleCents)}
      </td>
    );
  }

  function handleBlur(event) {
    const raw = event.target.value.trim();
    const cents = raw === "" ? null : toCents(raw);

    if (cents != null && cents !== row.statedDeductibleCents) {
      if (cents > row.amountCents) onReject(row, OVER_GIFT_ERROR);
      else onCommit(row, { deductible: raw });
    }
    // Committed, refused or abandoned, the cell goes back to reading as money. A
    // successful change remounts it anyway; this covers the three cases that do
    // not.
    event.target.value = display;
  }

  return (
    <td data-label="Deductible" className="px-3 py-1">
      <div>
        <input
          type="text"
          inputMode="decimal"
          key={row.statedDeductibleCents}
          defaultValue={display}
          aria-label={`Deductible amount for ${nameOf(row)}`}
          onFocus={(event) => {
            event.target.value = amountEditing(row.statedDeductibleCents);
            event.target.select();
          }}
          onBlur={handleBlur}
          className={`${figureInput} ${row.clamped ? "text-vermilion-ink" : ""}`}
        />
        {/* An amount edited down on the register can leave a deduction stranded
            above the gift it belongs to. Said on the row rather than repaired in
            storage: the figure is not wrong, it is out of date, and the claim is
            the clamped one until it is put right. */}
        {row.clamped && (
          <span className="mt-0.5 block text-right font-mono text-label uppercase text-vermilion-ink">
            {formatCents(row.deductibleCents)} claimed
          </span>
        )}
      </div>
    </td>
  );
}

/**
 * Whether the charity's acknowledgment is in hand, and the file itself.
 *
 * The box is the statement and the file is the evidence, and they are kept
 * apart: a paper receipt in a drawer is an acknowledgment in hand with nothing
 * attached, so ticking the box never asks for a file. Attaching one ticks the
 * box (the page does that, in the same write), and taking it off leaves the box
 * alone. Attaching is the one thing on this row that waits on something — the
 * file has to be stored before the gift can describe it — so it is the one cell
 * with a busy state.
 */
function ReceiptCell({ row, label, onCommit, onReject, onAttach, onDetach, onOpen }) {
  const inputRef = useRef();
  const [busy, setBusy] = useState(false);
  const canFile = Boolean(onAttach) && !row.returned;

  async function handleFile(event) {
    const file = event.target.files?.[0];
    // Cleared at once, so choosing the same file again still fires a change.
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    const result = await onAttach(row, file);
    setBusy(false);
    if (!result.ok) onReject(row, result.error);
  }

  async function handleOpen() {
    const result = await onOpen(row);
    if (!result.ok) onReject(row, result.error);
  }

  const linkClass =
    "font-mono text-label uppercase text-azure underline underline-offset-2 hover:text-ink disabled:no-underline disabled:opacity-60";

  return (
    <td data-label="Receipt" className="px-3 py-1">
      {/* A gift big enough to need a written acknowledgment says so until it
          has one; a smaller one still gets the box, because keeping the
          receipt is a habit rather than a threshold. */}
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={row.acknowledged}
          aria-label={`Acknowledgment received for ${label}`}
          onChange={(event) => onCommit(row, { acknowledged: event.target.checked })}
          className="h-3.5 w-3.5 shrink-0 accent-ink-soft"
        />
        {row.needsAcknowledgment && (
          <span className="font-mono text-label uppercase text-vermilion-ink">Needed</span>
        )}
      </label>
      {canFile && (
        <div className="mt-0.5 flex items-center gap-2">
          {busy ? (
            <span className="font-mono text-label uppercase text-ink-soft">Saving…</span>
          ) : row.receipt ? (
            <>
              <button
                type="button"
                onClick={handleOpen}
                title={`${row.receipt.name} · ${formatFileSize(row.receipt.sizeBytes)}`}
                aria-label={`Open receipt for ${label}: ${row.receipt.name}`}
                className={linkClass}
              >
                View
              </button>
              <button
                type="button"
                onClick={() => {
                  const result = onDetach(row);
                  if (!result.ok) onReject(row, result.error);
                }}
                aria-label={`Remove receipt for ${label}`}
                className="font-mono text-label uppercase text-ink-soft hover:text-vermilion-ink"
              >
                ×
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              aria-label={`Attach receipt for ${label}`}
              className={linkClass}
            >
              Attach
            </button>
          )}
          <input
            ref={inputRef}
            type="file"
            accept={RECEIPT_ACCEPT}
            onChange={handleFile}
            className="hidden"
            tabIndex={-1}
            aria-hidden="true"
            data-testid={`receipt-file-${row.transactionId}`}
          />
        </div>
      )}
    </td>
  );
}

function DonationRow({
  row,
  index,
  recipients,
  error,
  onCommit,
  onReject,
  onRemove,
  onAttach,
  onDetach,
  onOpen,
}) {
  const label = nameOf(row);
  // The current organisation always has an option, even one the list would not
  // offer — a gift whose organisation was removed. Without it the select would
  // show its first entry and the row would look refiled by being looked at.
  const known = recipients.some((recipient) => recipient.id === row.recipientId);

  return (
    <>
      <tr className={rowBg(index)}>
        <td data-label="Date" className="whitespace-nowrap px-3 py-1 font-mono text-row text-ink-soft">
          {formatDayShort(row.date)}
        </td>
        <td data-label="Organization" className="px-3 py-1">
          <select
            value={row.recipientId ?? ""}
            aria-label={`Organization for ${label}`}
            onChange={(event) => onCommit(row, { recipientId: event.target.value })}
            className={cellSelect(index)}
          >
            {row.recipientId == null && <option value="">— none</option>}
            {recipients.map((recipient) => (
              <option key={recipient.id} value={recipient.id}>
                {recipient.name}
              </option>
            ))}
            {row.recipientId != null && !known && (
              <option value={row.recipientId}>Unknown organization</option>
            )}
          </select>
        </td>
        {/* Read-only: who the money went to and any note on it are the ledger's,
            and the register is where they are corrected. The payee leads with the
            note behind it, the order the register stacks them in. */}
        <td data-stack-title className="truncate px-3 py-1 font-sans text-row text-ink">
          {row.payeeName || row.description || "—"}
          {row.payeeName && row.description && (
            <span className="ml-2 text-ink-soft">{row.description}</span>
          )}
          {row.returned && (
            <span className="ml-2 font-mono text-label uppercase text-ink-soft">returned</span>
          )}
        </td>
        <td data-label="Given" className={`${figureCell} font-medium text-ink`}>
          {formatCents(row.amountCents)}
        </td>
        <DeductibleCell row={row} onCommit={onCommit} onReject={onReject} />
        <ReceiptCell
          row={row}
          label={label}
          onCommit={onCommit}
          onReject={onReject}
          onAttach={onAttach}
          onDetach={onDetach}
          onOpen={onOpen}
        />
        <td className="px-1 py-1 text-right">
          <Button
            variant="row"
            size="sm"
            aria-label={`Not a donation: ${label}`}
            onClick={() => onRemove(row)}
          >
            Untag
          </Button>
        </td>
      </tr>
      {/* Under the row rather than beside it, so a rejected edit does not change
          the width of a column the eye is reading down. */}
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

export default function DonationList({
  year,
  rows,
  recipients,
  totalCents,
  deductibleCents,
  onChange,
  onRemove,
  onAdd,
  onAttachReceipt,
  onRemoveReceipt,
  onOpenReceipt,
}) {
  // One at a time, keyed on the row it belongs to: a rejection is a reply to the
  // edit just made, and a page of stale messages would say nothing about the
  // cell the user is in.
  const [error, setError] = useState(null);

  function commit(row, patch) {
    const result = onChange({ transactionId: row.transactionId, ...patch });
    setError(result.ok ? null : { id: row.transactionId, message: result.error });
    return result;
  }

  function reject(row, message) {
    setError({ id: row.transactionId, message });
  }

  return (
    <section className="border border-edge bg-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-edge px-4 py-3">
        <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">
          Gifts in {year}
        </h2>
        <span className="font-mono text-label uppercase text-chalk-soft">
          Written acknowledgment wanted from {formatCents(ACKNOWLEDGMENT_THRESHOLD_CENTS)}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-5 font-sans text-row text-chalk-soft">
          Nothing recorded in {year}.{" "}
          <button
            type="button"
            onClick={onAdd}
            className="text-azure underline underline-offset-2 hover:text-chalk"
          >
            Record the first one
          </button>{" "}
          — it goes on the register like any other expense, and appears here with the part that is
          deductible.
        </p>
      ) : (
        <div className="scroll-x">
          <table className="stack w-full table-fixed border-collapse">
            <thead>
              <tr className="bg-panel-raised">
                {COLUMNS.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className={`whitespace-nowrap px-3 py-2 font-mono text-label uppercase text-chalk ${
                      column.width ?? ""
                    } ${column.numeric ? "text-right" : "text-left"}`}
                  >
                    {column.label}
                  </th>
                ))}
                <th scope="col" className="w-16 px-1 py-2">
                  <span className="sr-only">Untag</span>
                </th>
              </tr>
            </thead>

            <tbody>
              {rows.map((row, index) => (
                <DonationRow
                  key={row.transactionId}
                  row={row}
                  index={index}
                  recipients={recipients}
                  error={error?.id === row.transactionId ? error.message : null}
                  onCommit={commit}
                  onReject={reject}
                  onRemove={onRemove}
                  onAttach={onAttachReceipt}
                  onDetach={onRemoveReceipt}
                  onOpen={onOpenReceipt}
                />
              ))}
            </tbody>

            {/* Back on the dark chrome, bookending the header: this is the
                year's total, not another band inside the sheet. */}
            <tfoot>
              <tr className="bg-panel-raised">
                <th
                  scope="row"
                  colSpan={LEAD_SPAN}
                  className="px-3 py-2 text-left font-mono text-label uppercase text-chalk"
                >
                  {year}
                </th>
                <td
                  data-label="Given"
                  className="whitespace-nowrap px-3 py-2 text-right font-mono text-row font-medium tabular-nums text-chalk"
                >
                  {formatCents(totalCents)}
                </td>
                <td
                  data-label="Deductible"
                  className="whitespace-nowrap px-3 py-2 text-right font-mono text-row font-medium tabular-nums text-verdant"
                >
                  {formatCents(deductibleCents)}
                </td>
                <td />
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className="border-t border-edge px-4 py-2.5 font-sans text-row text-chalk-soft">
        The organization, the deductible part and the receipt — ticked, with the charity’s letter
        attached if you have it as a file — are set here. The amount, the date and
        what it was for belong to the money itself —{" "}
        <Link
          to="/transactions"
          className="text-azure underline underline-offset-2 hover:text-chalk"
        >
          correct those on the register
        </Link>
        . Untagging leaves the expense where it is; it only says this was not a gift.
      </p>
    </section>
  );
}
