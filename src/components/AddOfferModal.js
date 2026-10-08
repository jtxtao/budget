import { useEffect, useMemo, useRef, useState } from "react";
import Dialog from "./Dialog";
import Field, { SelectField } from "./Field";
import Button from "./Button";
import ProgramOptions from "./ProgramOptions";
import { ACCOUNT_SCOPES, spendsThroughBudget, useAccounts } from "../contexts/AccountsContext";
import { useBudgets } from "../contexts/BudgetsContext";
import { usePayees } from "../contexts/PayeesContext";
import { useRewards } from "../contexts/RewardsContext";
import { toSections } from "../planLayout";
import { OFFER_KINDS, OFFER_KIND_LABELS } from "../rewards";
import { amountEditing, formatBps, todayISO } from "../utils";

const checkboxRow = "flex cursor-pointer items-center gap-2.5 py-1";
const legend = "mb-2 block font-mono text-label uppercase text-chalk-soft";

/**
 * A card offer to track — or an edit of one, or the next round of one.
 *
 * Three props say which: `offer` edits that record; `seed` starts a *new*
 * offer from another's answers (the next quarter of a rotating card, where the
 * card, the cap and the rate carry over and only the window and the categories
 * change); neither is a blank form.
 *
 * Uncontrolled like every form here, with two answers held in state because
 * they decide which fields mean anything — the kind (a cap asks for a rate, a
 * target for a bonus) and "all spending" (which makes the category and payee
 * lists moot). **The fields a choice turns off are hidden, not unmounted**, so
 * their answers survive a change of mind and reach the store, which keeps them
 * for the same reason. The checkbox lists are keyed on an open counter, since
 * a mounted checkbox keeps the `defaultChecked` it first had.
 */
export default function AddOfferModal({ show, offer, seed, handleClose }) {
  const formRef = useRef();
  const nameRef = useRef();
  const kindRef = useRef();
  const accountRef = useRef();
  const startRef = useRef();
  const endRef = useRef();
  const limitRef = useRef();
  const rateRef = useRef();
  const bonusPointsRef = useRef();
  const programRef = useRef();
  const allRef = useRef();
  const [kind, setKind] = useState(OFFER_KINDS.CAP);
  const [allSpending, setAllSpending] = useState(false);
  const [opened, setOpened] = useState(0);
  const [error, setError] = useState(null);

  const { addOffer, updateOffer } = useRewards();
  const { accounts } = useAccounts();
  const { groups, budgets } = useBudgets();
  const { payees } = usePayees();
  const editing = offer != null;
  const source = offer ?? seed ?? null;

  // Cards first: that is what an offer is almost always on, but a debit card's
  // checking account can carry one too.
  const cards = useMemo(() => {
    const spendable = accounts.filter(spendsThroughBudget);
    return [
      ...spendable.filter((a) => a.scope === ACCOUNT_SCOPES.CREDIT_CARD),
      ...spendable.filter((a) => a.scope !== ACCOUNT_SCOPES.CREDIT_CARD),
    ];
  }, [accounts]);
  const sections = useMemo(
    () => toSections(groups, budgets).filter((section) => section.budgets.length > 0),
    [groups, budgets]
  );
  const sortedPayees = useMemo(
    () => [...payees].sort((a, b) => a.name.localeCompare(b.name)),
    [payees]
  );

  useEffect(() => {
    if (!show || !formRef.current) return;
    formRef.current.reset();
    setError(null);
    setOpened((count) => count + 1);
    const nextKind = source?.kind ?? OFFER_KINDS.CAP;
    setKind(nextKind);
    setAllSpending(source?.allSpending ?? false);
    nameRef.current.value = source?.name ?? "";
    kindRef.current.value = nextKind;
    accountRef.current.value = source?.accountId ?? cards[0]?.id ?? "";
    startRef.current.value = source?.startDate ?? todayISO();
    endRef.current.value = source?.endDate ?? "";
    limitRef.current.value = source ? amountEditing(source.limitCents) : "";
    rateRef.current.value = source?.rateBps != null ? formatBps(source.rateBps) : "";
    bonusPointsRef.current.value = source?.bonusPoints != null ? String(source.bonusPoints) : "";
    programRef.current.value = source?.programId ?? "";
    allRef.current.checked = source?.allSpending ?? false;
    // `cards` is read for the default only; a sync landing mid-edit must not reset the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, source]);

  const checked = (list, id) => Boolean(source?.[list]?.includes(id));

  function handleSubmit(event) {
    event.preventDefault();
    const data = new FormData(formRef.current);
    const fields = {
      name: nameRef.current.value,
      kind,
      accountId: accountRef.current.value,
      startDate: startRef.current.value,
      endDate: endRef.current.value || null,
      limit: limitRef.current.value,
      allSpending,
      budgetIds: data.getAll("budgetId"),
      payeeIds: data.getAll("payeeId"),
      rate: rateRef.current.value,
      bonusPoints: bonusPointsRef.current.value,
      programId: programRef.current.value || null,
    };
    const result = editing ? updateOffer({ id: offer.id, ...fields }) : addOffer(fields);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    handleClose();
  }

  const title = editing ? "Edit offer" : seed ? "Next round of an offer" : "Track a card offer";

  return (
    <Dialog show={show} handleClose={handleClose} title={title}>
      {cards.length === 0 ? (
        <p className="font-sans text-row text-chalk-soft">
          An offer is tracked against the spending on one card, and there is no account the budget
          spends through yet. Add your card on the Plan page first.
        </p>
      ) : (
        <form ref={formRef} onSubmit={handleSubmit}>
          <Field
            label="Offer"
            inputRef={nameRef}
            type="text"
            placeholder="e.g. 9% back on dining"
            required
          />
          <SelectField
            label="What kind of offer"
            selectRef={kindRef}
            onChange={(event) => setKind(event.target.value)}
          >
            {Object.values(OFFER_KINDS).map((value) => (
              <option key={value} value={value}>
                {OFFER_KIND_LABELS[value]}
              </option>
            ))}
          </SelectField>
          <p className="-mt-3 mb-5 font-sans text-row text-chalk-soft">
            {kind === OFFER_KINDS.CAP
              ? "A better rate on some spending, up to a limit — a limited-time bonus, or a rotating quarter. You'll see the room left, so you know when to go back to your usual card."
              : "Spend a set amount by a date to earn a bonus — a sign-up bonus, or a retention offer. You'll see how far there is to go and how much a week that takes."}
          </p>
          <SelectField label="On card" selectRef={accountRef}>
            {cards.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </SelectField>
          <div className="grid gap-x-4 sm:grid-cols-2">
            <Field label="Starts" inputRef={startRef} type="date" required />
            <Field
              label={kind === OFFER_KINDS.TARGET ? "Spend by" : "Ends (optional)"}
              inputRef={endRef}
              type="date"
            />
          </div>
          <Field
            label={kind === OFFER_KINDS.CAP ? "Bonus applies to spending up to" : "Spending required"}
            inputRef={limitRef}
            type="text"
            inputMode="decimal"
            placeholder="$0.00"
            required
          />
          <div hidden={kind !== OFFER_KINDS.CAP}>
            <Field
              label="Bonus rate (optional)"
              inputRef={rateRef}
              type="text"
              inputMode="decimal"
              placeholder="e.g. 5%"
            />
          </div>
          <div hidden={kind !== OFFER_KINDS.TARGET} className="grid gap-x-4 sm:grid-cols-2">
            <Field
              label="Bonus points (optional)"
              inputRef={bonusPointsRef}
              type="text"
              inputMode="numeric"
              placeholder="e.g. 60,000"
            />
            <SelectField label="Earned in (optional)" selectRef={programRef}>
              <option value="">Not valued</option>
              <ProgramOptions />
            </SelectField>
          </div>

          <label className="mb-4 flex cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              ref={allRef}
              onChange={(event) => setAllSpending(event.target.checked)}
              className="h-3.5 w-3.5 shrink-0 accent-azure"
            />
            <span className="font-sans text-row text-chalk">Count all spending on this card</span>
          </label>

          <div hidden={allSpending} key={`lists-${opened}`}>
            <fieldset className="mb-4">
              <legend className={legend}>Counts spending in these categories</legend>
              <div className="max-h-48 overflow-y-auto border border-edge px-3 py-2">
                {sections.map((section) => (
                  <div key={section.groupId ?? "ungrouped"} className="mb-1">
                    <div className="font-mono text-label uppercase text-chalk-soft">{section.name}</div>
                    {section.budgets.map((budget) => (
                      <label key={budget.id} className={checkboxRow}>
                        <input
                          type="checkbox"
                          name="budgetId"
                          value={budget.id}
                          defaultChecked={checked("budgetIds", budget.id)}
                          className="h-3.5 w-3.5 shrink-0 accent-azure"
                        />
                        <span className="font-sans text-row text-chalk">{budget.name}</span>
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            </fieldset>
            {sortedPayees.length > 0 && (
              <fieldset className="mb-4">
                <legend className={legend}>…or paid to these payees (optional)</legend>
                <div className="max-h-36 overflow-y-auto border border-edge px-3 py-2">
                  {sortedPayees.map((payee) => (
                    <label key={payee.id} className={checkboxRow}>
                      <input
                        type="checkbox"
                        name="payeeId"
                        value={payee.id}
                        defaultChecked={checked("payeeIds", payee.id)}
                        className="h-3.5 w-3.5 shrink-0 accent-azure"
                      />
                      <span className="font-sans text-row text-chalk">{payee.name}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <p className="mb-5 font-sans text-row text-chalk-soft">
              The card decides what qualifies by the kind of shop, not by your categories, so
              this is your best match. A rotating category like "Amazon" or "wholesale clubs" is
              usually easiest to name as a payee.
            </p>
          </div>

          {error && (
            <p role="alert" className="-mt-2 mb-5 font-sans text-row text-vermilion">
              {error}
            </p>
          )}
          <div className="flex justify-end">
            <Button variant="primary" type="submit">
              {editing ? "Save" : "Track offer"}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
