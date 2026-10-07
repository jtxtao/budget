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
 *
 * A purchase's closing costs and yearly costs of owning are the record's
 * `oneTimeCents` and `annualCents`, but they are their own boxes here: the same
 * figure means something different under a different label, and one input
 * moving between groups would carry a wedding's cost into a mortgage.
 *
 * `propertyOptions` and `debtOptions` are what a sale can name — the property
 * accounts on the books and the homes earlier events buy, and the debts on the
 * books. A stored reference neither list holds still gets an option, the
 * register's rule, so editing an event does not quietly change what it names.
 */

const KIND_OPTIONS = [
  { value: LIFE_EVENT_KINDS.EXPENSE, label: "Money out — a cost" },
  { value: LIFE_EVENT_KINDS.INCOME, label: "Money in — income or a windfall" },
  { value: LIFE_EVENT_KINDS.INCOME_CHANGE, label: "A change to your pay" },
  { value: LIFE_EVENT_KINDS.BUY_PROPERTY, label: "Buy a home" },
  { value: LIFE_EVENT_KINDS.SELL_PROPERTY, label: "Sell a home" },
];

const noteClass = "-mt-3 mb-5 font-sans text-row text-chalk-soft";

const money = (cents) => (cents == null ? "" : amountEditing(cents));
const percent = (bps) => (bps == null ? "" : bps / 100);

export default function AddLifeEventModal({
  show,
  event,
  seed,
  propertyOptions = [],
  debtOptions = [],
  handleClose,
}) {
  const formRef = useRef();
  const refs = {
    name: useRef(),
    startAge: useRef(),
    years: useRef(),
    oneTime: useRef(),
    annual: useRef(),
    keptShare: useRef(),
    price: useRef(),
    downPayment: useRef(),
    rate: useRef(),
    termYears: useRef(),
    closing: useRef(),
    owning: useRef(),
    rentSaved: useRef(),
    propertyRef: useRef(),
    debtRef: useRef(),
    sellingCost: useRef(),
  };
  const [kind, setKind] = useState(LIFE_EVENT_KINDS.EXPENSE);
  const [error, setError] = useState(null);

  const { addLifeEvent, updateLifeEvent } = useLifeEvents();
  const editing = event != null;
  const from = event ?? seed ?? {};

  useEffect(() => {
    if (!show) return;
    const record = event ?? seed ?? {};
    const buying = record.kind === LIFE_EVENT_KINDS.BUY_PROPERTY;
    formRef.current.reset();
    setError(null);
    setKind(record.kind ?? LIFE_EVENT_KINDS.EXPENSE);
    const set = (key, value) => {
      refs[key].current.value = value ?? "";
    };
    set("name", record.name);
    set("startAge", record.startAge);
    set("years", record.years);
    set("oneTime", buying ? "" : money(record.oneTimeCents));
    set("annual", buying ? "" : money(record.annualCents));
    set("keptShare", percent(record.keptShareBps));
    set("price", money(record.priceCents));
    set("downPayment", money(record.downPaymentCents));
    set("rate", percent(record.rateBps ?? 650));
    set("termYears", record.termYears ?? 30);
    set("closing", buying ? money(record.oneTimeCents) : "");
    set("owning", buying ? money(record.annualCents) : "");
    set("rentSaved", money(record.rentSavedCents));
    set("propertyRef", record.propertyRef ?? "");
    set("debtRef", record.debtRef ?? "");
    set("sellingCost", percent(record.sellingCostBps ?? 600));
    // Every ref is stable for the life of the component; listing them would
    // re-seed the form on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, event, seed]);

  function handleSubmit(submitted) {
    submitted.preventDefault();
    const value = (key) => refs[key].current.value;
    const buying = kind === LIFE_EVENT_KINDS.BUY_PROPERTY;
    const fields = {
      name: value("name"),
      kind,
      startAge: value("startAge"),
      years: buying || kind === LIFE_EVENT_KINDS.SELL_PROPERTY ? "1" : value("years"),
      oneTime: buying ? value("closing") : value("oneTime"),
      annual: buying ? value("owning") : value("annual"),
      keptShare: value("keptShare"),
      price: value("price"),
      downPayment: value("downPayment"),
      rate: value("rate"),
      termYears: value("termYears"),
      rentSaved: value("rentSaved"),
      propertyRef: value("propertyRef"),
      debtRef: value("debtRef"),
      sellingCost: value("sellingCost"),
    };
    const result = editing ? updateLifeEvent({ id: event.id, ...fields }) : addLifeEvent(fields);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    handleClose();
  }

  const isFlow = kind === LIFE_EVENT_KINDS.EXPENSE || kind === LIFE_EVENT_KINDS.INCOME;
  const isChange = kind === LIFE_EVENT_KINDS.INCOME_CHANGE;
  const isBuy = kind === LIFE_EVENT_KINDS.BUY_PROPERTY;
  const isSell = kind === LIFE_EVENT_KINDS.SELL_PROPERTY;

  // A stored reference neither list holds still gets an option of its own.
  const properties = [...propertyOptions];
  if (from.propertyRef && !properties.some((option) => option.id === from.propertyRef)) {
    properties.push({ id: from.propertyRef, name: "A property no longer in the plan" });
  }
  const debts = [...debtOptions];
  if (from.debtRef && !debts.some((option) => option.id === from.debtRef)) {
    debts.push({ id: from.debtRef, name: "A debt no longer on the books" });
  }

  return (
    <Dialog
      show={show}
      handleClose={handleClose}
      title={editing ? "Edit life event" : "New life event"}
    >
      <form ref={formRef} onSubmit={handleSubmit}>
        <Field label="Name" inputRef={refs.name} type="text" required />
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
          <Field label="Starts at age" inputRef={refs.startAge} type="number" min={0} max={120} step={1} required />
          <div hidden={!isFlow && !isChange}>
            <Field label="For how many years" inputRef={refs.years} type="number" min={1} max={120} step={1} placeholder="Rest of the plan" />
          </div>
        </div>

        <div hidden={!isFlow}>
          <div className="grid grid-cols-2 gap-x-5">
            <Field label="Once, in the first year" inputRef={refs.oneTime} type="text" inputMode="decimal" placeholder="$0.00" />
            <Field label="Every year it runs" inputRef={refs.annual} type="text" inputMode="decimal" placeholder="$0.00" />
          </div>
          <p className={noteClass}>
            In today's dollars. {kind === LIFE_EVENT_KINDS.INCOME
              ? "Income is what lands after tax; once you retire it is spent before your savings are."
              : "Paid out of cash first, then your investments."}
          </p>
        </div>

        <div hidden={!isChange}>
          <Field label="Share of your pay you keep" inputRef={refs.keptShare} type="text" inputMode="decimal" placeholder="0" />
          <p className={noteClass}>
            0 for a year off, 50 for half time. Your saving out of pay scales with it; your spending
            does not.
          </p>
        </div>

        <div hidden={!isBuy}>
          <div className="grid grid-cols-2 gap-x-5">
            <Field label="Price" inputRef={refs.price} type="text" inputMode="decimal" placeholder="$0.00" />
            <Field label="Down payment" inputRef={refs.downPayment} type="text" inputMode="decimal" placeholder="$0.00" />
            <Field label="Mortgage rate" inputRef={refs.rate} type="text" inputMode="decimal" placeholder="6.5" />
            <Field label="Mortgage term in years" inputRef={refs.termYears} type="number" min={1} max={50} step={1} />
            <Field label="Closing costs" inputRef={refs.closing} type="text" inputMode="decimal" placeholder="$0.00" />
            <Field label="Owning it costs a year" inputRef={refs.owning} type="text" inputMode="decimal" placeholder="$0.00" />
            <Field label="Rent it replaces a year" inputRef={refs.rentSaved} type="text" inputMode="decimal" placeholder="$0.00" />
          </div>
          <p className={noteClass}>
            In today's dollars. The down payment and closing costs come out of cash, then your
            investments; the mortgage is paid on top of your budget, and owning costs — tax,
            insurance, upkeep — run until it is sold.
          </p>
        </div>

        <div hidden={!isSell}>
          <SelectField label="Which property" selectRef={refs.propertyRef} defaultValue="">
            <option value="">Choose a property</option>
            {properties.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </SelectField>
          <SelectField label="Mortgage it pays off" selectRef={refs.debtRef} defaultValue="">
            <option value="">None, or the one it was bought with</option>
            {debts.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </SelectField>
          <Field label="Cost of selling" inputRef={refs.sellingCost} type="text" inputMode="decimal" placeholder="6" />
          <p className={noteClass}>
            A share of the price — agents and fees. What is left after the mortgage goes to cash.
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
