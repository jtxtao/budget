import { useEffect, useRef, useState } from "react";
import Dialog from "./Dialog";
import Field, { SelectField } from "./Field";
import Button from "./Button";
import { LIFE_EVENT_KINDS, useLifeEvents } from "../contexts/LifeEventsContext";
import { amountEditing } from "../utils";

/**
 * Add a life event, or edit one that exists.
 *
 * `event` decides which, the `AddSavingsGoalModal` contract; `seed` is what a
 * new one starts from — a template, or a savings goal copied once — and is
 * ignored when editing. Uncontrolled and re-seeded on open like every add-modal
 * here, and the effect depends on both props, since the page opens the same
 * mounted modal on a different row or template without closing it in between.
 *
 * **The kind is held in state**, the direction rule from `AddTransactionModal`:
 * it decides which fields are asked, and `form.reset()` cannot reach it. The
 * fields a kind does not ask are **hidden, not unmounted**, so a detour through
 * another kind keeps what was typed — the switched-away-from rule, for a draft.
 */

const KIND_OPTIONS = [
  { value: LIFE_EVENT_KINDS.EXPENSE, label: "Money out — a cost" },
  { value: LIFE_EVENT_KINDS.INCOME, label: "Money in — income or a windfall" },
  { value: LIFE_EVENT_KINDS.INCOME_CHANGE, label: "A change to your pay" },
];

const noteClass = "-mt-3 mb-5 font-sans text-row text-chalk-soft";

const money = (cents) => (cents == null ? "" : amountEditing(cents));

export default function AddLifeEventModal({ show, event, seed, handleClose }) {
  const formRef = useRef();
  const nameRef = useRef();
  const startAgeRef = useRef();
  const yearsRef = useRef();
  const oneTimeRef = useRef();
  const annualRef = useRef();
  const keptShareRef = useRef();
  const [kind, setKind] = useState(LIFE_EVENT_KINDS.EXPENSE);
  const [error, setError] = useState(null);

  const { addLifeEvent, updateLifeEvent } = useLifeEvents();
  const editing = event != null;

  useEffect(() => {
    if (!show) return;
    const from = event ?? seed ?? {};
    formRef.current.reset();
    setError(null);
    setKind(from.kind ?? LIFE_EVENT_KINDS.EXPENSE);
    nameRef.current.value = from.name ?? "";
    startAgeRef.current.value = from.startAge ?? "";
    yearsRef.current.value = from.years ?? "";
    oneTimeRef.current.value = money(from.oneTimeCents);
    annualRef.current.value = money(from.annualCents);
    keptShareRef.current.value = from.keptShareBps == null ? "" : from.keptShareBps / 100;
  }, [show, event, seed]);

  function handleSubmit(submitted) {
    submitted.preventDefault();
    const fields = {
      name: nameRef.current.value,
      kind,
      startAge: startAgeRef.current.value,
      years: yearsRef.current.value,
      oneTime: oneTimeRef.current.value,
      annual: annualRef.current.value,
      keptShare: keptShareRef.current.value,
    };
    const result = editing ? updateLifeEvent({ id: event.id, ...fields }) : addLifeEvent(fields);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    handleClose();
  }

  const isChange = kind === LIFE_EVENT_KINDS.INCOME_CHANGE;

  return (
    <Dialog
      show={show}
      handleClose={handleClose}
      title={editing ? "Edit life event" : "New life event"}
    >
      <form ref={formRef} onSubmit={handleSubmit}>
        <Field label="Name" inputRef={nameRef} type="text" required />
        <SelectField
          label="What it does"
          value={kind}
          onChange={(change) => setKind(change.target.value)}
        >
          {KIND_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectField>

        <div className="grid grid-cols-2 gap-x-5">
          <Field label="Starts at age" inputRef={startAgeRef} type="number" min={0} max={120} step={1} required />
          <Field label="For how many years" inputRef={yearsRef} type="number" min={1} max={120} step={1} placeholder="Rest of the plan" />
        </div>

        <div hidden={isChange}>
          <div className="grid grid-cols-2 gap-x-5">
            <Field label="Once, in the first year" inputRef={oneTimeRef} type="text" inputMode="decimal" placeholder="$0.00" />
            <Field label="Every year it runs" inputRef={annualRef} type="text" inputMode="decimal" placeholder="$0.00" />
          </div>
          <p className={noteClass}>
            In today's dollars. {kind === LIFE_EVENT_KINDS.INCOME
              ? "Income is what lands after tax; once you retire it is spent before your savings are."
              : "Paid out of cash first, then your investments."}
          </p>
        </div>

        <div hidden={!isChange}>
          <Field label="Share of your pay you keep" inputRef={keptShareRef} type="text" inputMode="decimal" placeholder="0" />
          <p className={noteClass}>
            0 for a year off, 50 for half time. Your saving out of pay scales with it; your spending
            does not.
          </p>
        </div>

        {error && (
          <p role="alert" className="-mt-2 mb-5 font-sans text-row text-vermilion">
            {error}
          </p>
        )}
        <div className="flex justify-end">
          <Button variant="primary" type="submit">
            {editing ? "Save" : "Add event"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
