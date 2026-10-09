import { useEffect, useRef, useState } from "react";
import Dialog from "./Dialog";
import Field, { SelectField } from "./Field";
import Button from "./Button";
import {
  ACCOUNT_SCOPES,
  ACCOUNT_TYPES,
  DEFAULT_SCOPE,
  UNCLASSIFIED,
  toEnteredBalanceCents,
  useAccounts,
} from "../contexts/AccountsContext";
import { amountEditing, formatBps, todayISO } from "../utils";

/**
 * A place money sits — an account owned, or a debt owed — and what it held when
 * the books opened, or an edit of one that exists.
 *
 * `account` decides which, as `group` does on `AddGroupModal`: absent, this adds
 * one; present, it amends that one. Both jobs are the same form because an
 * account is a small set of interlocking answers — a card is a debt, a debt has
 * no asset class, a debt's balance is asked for as the amount owed — and a row
 * of inline controls cannot express an answer that removes the question below
 * it. It is also why renaming is not typing over the name in the list, the way
 * a category is renamed on the plan: the accounts panel is a column of figures
 * read at a glance, and the name is one of six fields rather than the whole
 * record.
 *
 * The starting balance is asked for here and nowhere else, because it is a
 * standing fact in exactly the way the account's name is: it is stated once,
 * when the account joins the books, and never restated. What the account holds
 * *now* is never typed in at all — it is the opening figure plus every
 * transaction since, which is what makes spending from an account move its
 * balance. The per-month figures on the Net worth page are a different thing
 * again: hand-entered snapshots for off-budget holdings whose worth no ledger
 * can know.
 *
 * A debt is asked for the amount **owed**, as a positive number, because that
 * is how a statement reads. The store signs it — see `signedOpeningCents`.
 *
 * **The asset class is not asked.** Cash, stocks, bonds and the rest were a
 * question most households could not usefully answer for an account that holds
 * a bit of everything, and nothing they budget with reads it — only the net
 * worth chart's bands do. So it is derived instead: see `assetClassFor`.
 *
 * **Cash back paid onto the balance** is asked of an account the budget spends
 * through and of nothing else — a prepaid card that earns 1%, a credit card
 * whose rewards land as a statement credit. A rate, not money: the entry form
 * writes the cash back as its own row beside each purchase (`src/cashback.js`).
 * It comes and goes with the scope like the kind select does, and takes the
 * seed as its `defaultValue` for the same reason.
 *
 * A credit card is picked as a *scope*, not a kind, and picking it answers the
 * kind question outright: a card is money owed, so the form stops asking and
 * submits a liability. That is why `type` here is derived from both selects
 * rather than read straight off the one — the store refuses the combination the
 * user would otherwise be able to build by choosing "card" and then "asset".
 */

/**
 * What the store is handed for the class nobody was asked about.
 *
 * An asset already on the books keeps the class it has, so an account set up
 * before the question was dropped — a brokerage filed as stocks, a house filed
 * as real estate — is not quietly moved to another band of the net-worth chart
 * by being edited. A new asset is read off its scope: money the budget spends
 * through is cash, and a holding off budget is most often an investment. A debt
 * is stored unclassified, as ever.
 */
function assetClassFor(account, type, scope) {
  if (type !== ACCOUNT_TYPES.ASSET) return UNCLASSIFIED;
  if (account?.type === ACCOUNT_TYPES.ASSET && account.assetClass) return account.assetClass;
  return scope === ACCOUNT_SCOPES.OFF_BUDGET ? "Stocks" : "Cash";
}

/**
 * What the form opens holding: the account being amended, or the defaults for a
 * new one.
 *
 * One function, because two things seed these fields — the effect that runs on
 * open, and the `defaultValue` of the kind select that comes and goes with the
 * answer above it — and a form whose field says one thing while the value it
 * would submit says another is the whole class of bug the re-seed effect exists
 * to prevent.
 *
 * `baseType` and `baseScope` are the account's own answers where there is an
 * account, and the panel's defaults where there is not.
 */
function seedFor(account, baseType, baseScope) {
  return {
    name: account?.name ?? "",
    type: baseType,
    scope: baseScope,
    // Shown the way it was entered rather than the way it is stored: a debt as
    // the amount owed, positive — and through `amountEditing`, the raw-under-
    // the-caret face every money field in the app wears, so $12,340.50 seeds as
    // "12340.50" rather than the "12340.5" a bare `fromCents` would print.
    opening: account
      ? amountEditing(toEnteredBalanceCents(account, account.openingBalanceCents))
      : "",
    // An account undated when it was added stays undated — blank, not today.
    // Today is the right guess only for an account being stated for the first
    // time.
    openingDate: account ? account.openingDate ?? "" : todayISO(),
    cashback: account?.cashbackBps ? formatBps(account.cashbackBps) : "",
  };
}

export default function AddAccountModal({
  show,
  account,
  defaultType = ACCOUNT_TYPES.ASSET,
  defaultScope = DEFAULT_SCOPE,
  handleClose,
}) {
  const formRef = useRef();
  const nameRef = useRef();
  const typeRef = useRef();
  const scopeRef = useRef();
  const openingRef = useRef();
  const openingDateRef = useRef();
  const cashbackRef = useRef();
  const [error, setError] = useState(null);
  // Mirror the two selects, and only so the fields below them can be shown or
  // hidden and the balance relabelled — the submitted values are still read from
  // the DOM, so there is no second copy of what the user chose.
  const [type, setType] = useState(defaultType);
  const [scope, setScope] = useState(defaultScope);

  const { addAccount, updateAccount } = useAccounts();

  const editing = account != null;
  // The account's own answers lead where there is one: reopening the form on a
  // mortgage must not offer it the on-budget panel's defaults.
  const baseType = account?.type ?? defaultType;
  const baseScope = account?.scope ?? defaultScope;

  const isCard = scope === ACCOUNT_SCOPES.CREDIT_CARD;
  // What will actually be stored: a card is owed, whatever the kind select last
  // held before it was taken off screen.
  const effectiveType = isCard ? ACCOUNT_TYPES.LIABILITY : type;
  const owed = effectiveType === ACCOUNT_TYPES.LIABILITY;
  const spentThrough = scope !== ACCOUNT_SCOPES.OFF_BUDGET;
  const seed = seedFor(account, baseType, baseScope);

  // The modal stays mounted, so clear the previous entry — and the previous
  // error — each time it opens, with the account's own values where it was
  // opened on one. The selects are set explicitly rather than left to
  // `defaultValue`, which only ever applies on the first mount.
  useEffect(() => {
    if (!show) return;
    const seed = seedFor(account, baseType, baseScope);

    formRef.current.reset();
    setError(null);
    nameRef.current.value = seed.name;
    scopeRef.current.value = seed.scope;
    openingRef.current.value = seed.opening;
    openingDateRef.current.value = seed.openingDate;
    setType(seed.type);
    setScope(seed.scope);
    // Absent for a card, and remounted holding the mirror above if the user
    // switches back to an account that has it.
    if (typeRef.current) typeRef.current.value = seed.type;
    if (cashbackRef.current) cashbackRef.current.value = seed.cashback;
  }, [show, account, baseType, baseScope]);

  // One handler on the form, so both mirrors are set from whatever is on
  // screen *after* the change. The kind select unmounts while a card is chosen
  // and remounts holding its `defaultValue`, so the mirror has to go back with
  // it — otherwise picking "liability", switching to card, and switching back
  // would leave the select reading "asset" and the form behaving as though it
  // still said otherwise. What it goes back *to* is the account's own kind when
  // there is one, which is what stops a detour through the card option turning
  // a mortgage into an asset.
  function handleChange() {
    const nextScope = scopeRef.current.value;
    setScope(nextScope);
    setType(
      nextScope === ACCOUNT_SCOPES.CREDIT_CARD ? baseType : typeRef.current?.value ?? baseType
    );
  }

  function handleSubmit(e) {
    e.preventDefault();

    // Cleared rather than left as the empty string: "" is not a date, and the
    // store reads null as "from the beginning of the books".
    const openingDate = openingDateRef.current.value || null;

    const submittedScope = scopeRef.current.value;
    const fields = {
      name: nameRef.current.value,
      type: effectiveType,
      scope: submittedScope,
      assetClass: assetClassFor(account, effectiveType, submittedScope),
      opening: openingRef.current.value,
      openingDate,
      // Sent only while the field is on screen: an off-budget account was not
      // asked, and a rate it carried from before is kept, inert, rather than
      // cleared by a question nobody put.
      ...(cashbackRef.current && { cashback: cashbackRef.current.value }),
    };
    const result = editing ? updateAccount({ id: account.id, ...fields }) : addAccount(fields);

    // Keep the modal open on a rejection so the typed details are still there
    // to correct.
    if (!result.ok) {
      setError(result.error);
      return;
    }

    handleClose();
  }

  return (
    <Dialog show={show} handleClose={handleClose} title={editing ? "Edit account" : "New account"}>
      <form ref={formRef} onChange={handleChange} onSubmit={handleSubmit}>
        <Field label="Name" inputRef={nameRef} type="text" required />
        {/* Asked first, and of debts as much as of assets: a card is spent
            through and a mortgage is not, and the two want opposite answers
            here. It also decides whether the kind below is still a question. */}
        <SelectField label="Budgeting" selectRef={scopeRef} defaultValue={baseScope}>
          <option value={ACCOUNT_SCOPES.ON_BUDGET}>On budget — money moves through it</option>
          <option value={ACCOUNT_SCOPES.CREDIT_CARD}>Credit card — spent through, paid off</option>
          <option value={ACCOUNT_SCOPES.OFF_BUDGET}>Off budget — tracked for net worth only</option>
        </SelectField>
        {/* Gone for a card, which has already answered it. Leaving it on screen
            set to "liability" would offer the user a choice whose other option
            the store refuses. */}
        {!isCard && (
          <SelectField label="Kind" selectRef={typeRef} defaultValue={type}>
            <option value={ACCOUNT_TYPES.ASSET}>Asset — something you own</option>
            <option value={ACCOUNT_TYPES.LIABILITY}>Liability — something you owe</option>
          </SelectField>
        )}
        {/* Not required: an account that starts empty is a real answer, and a
            blank reads as zero rather than as a mistake. Text rather than a
            number field, like every money field here, so a balance written the
            way a statement prints it — "$12,500.00" — is taken as read. */}
        <Field
          label={owed ? "Balance owed" : "Starting balance"}
          inputRef={openingRef}
          type="text"
          inputMode="decimal"
          placeholder="0"
        />
        {/* Sits with the figure it describes rather than after the date, and
            says nothing about "today" — the date field below is what decides
            when this was true. Said out loud at all because it is the
            difference between money you can budget and money you can only
            watch. */}
        <p className="-mt-3 mb-5 font-sans text-row text-chalk-soft">
          {owed
            ? "What you owe on this account. Debt you spend through reduces what there is to assign."
            : "What this account holds. On budget, it lands in “to be assigned” and can be pushed into categories."}
        </p>
        <Field
          label="Balance as of"
          inputRef={openingDateRef}
          type="date"
          defaultValue={todayISO()}
        />
        {spentThrough && (
          <>
            <Field
              label="Cash back onto the balance"
              inputRef={cashbackRef}
              type="text"
              inputMode="decimal"
              placeholder="None"
              defaultValue={seed.cashback}
              aria-describedby="account-cashback-help"
            />
            <p id="account-cashback-help" className="-mt-3 mb-5 font-sans text-row text-chalk-soft">
              For a card that pays its rewards straight back onto itself — 1% means a $100
              purchase costs the balance $99. Each purchase gets a cash-back row of its own, filed
              as a refund to the purchase's category.
            </p>
          </>
        )}
        {error && (
          <p role="alert" className="-mt-2 mb-5 font-sans text-row text-vermilion">
            {error}
          </p>
        )}
        <div className="flex justify-end">
          <Button variant="primary" type="submit">
            {editing ? "Save" : "Add"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
