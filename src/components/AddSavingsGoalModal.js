import { useEffect, useRef, useState } from "react";
import AccountPicker from "./AccountPicker";
import Dialog from "./Dialog";
import Field, { SelectField } from "./Field";
import Button from "./Button";
import { useBudgets } from "../contexts/BudgetsContext";
import { ENVELOPE_COLORS, useSavingsGoals } from "../contexts/SavingsGoalsContext";
import { countedHoldingCents, useHoldingOptions } from "../hooks/useSavingsGoalEnvelopes";
import { amountEditing, currentPeriod, toCents } from "../utils";

const PORTION_ERROR =
  "Enter how much of an account is this goal, or leave it blank to count all of it.";

/**
 * Add a medium-term savings goal — a camera, a wedding, a special event — or
 * edit one that exists.
 *
 * `goal` decides which, the same way `account` does on `AddAccountModal`:
 * absent, this adds one; present, it amends that one. Uncontrolled and
 * re-seeded on open, the contract every add-modal in the app keeps — the
 * modal stays mounted, so nothing else clears the previous entry.
 *
 * **Where the goal's money is held is the one part of this form held in
 * state**, `SpendingMapFields`' exception and for its reason: a tick carries no
 * form value for `FormData` to read, and a new goal has no id for a store
 * mutator to write against yet. So the picker's answers are a draft that
 * commits with the rest on submit — one write, and an abandoned form leaves
 * nothing behind, which a picker writing on each tick could not promise for a
 * goal that was never saved.
 *
 * Off-budget accounts only, and `useHoldingOptions` is where that rule lives:
 * on-budget money is already in the pool a goal's assignment draws from, so
 * counting a balance here as well would promise the same dollar twice.
 */
export default function AddSavingsGoalModal({ show, goal, handleClose }) {
  const formRef = useRef();
  const nameRef = useRef();
  const targetRef = useRef();
  const targetDateRef = useRef();
  const linkRef = useRef();
  const budgetIdRef = useRef();
  const monthlyContributionRef = useRef();
  const [error, setError] = useState(null);
  // The draft of where the money is held: which accounts, and how much of one
  // where only part of it is this goal's.
  const [accountIds, setAccountIds] = useState([]);
  const [amounts, setAmounts] = useState({});
  const [photo, setPhoto] = useState(null);
  const [photoError, setPhotoError] = useState(null);
  // Held in state for the photo's reason: the picker is radios drawn as
  // swatches, and the choice has to survive the form being re-seeded.
  const [envelopeColor, setEnvelopeColor] = useState(ENVELOPE_COLORS[0]);

  const { addSavingsGoal, updateSavingsGoal } = useSavingsGoals();
  const { budgets } = useBudgets();
  const options = useHoldingOptions(currentPeriod());

  const editing = goal != null;

  useEffect(() => {
    if (!show) return;
    formRef.current.reset();
    setError(null);
    nameRef.current.value = goal?.name ?? "";
    // `amountEditing`, not a bare `fromCents`: the raw-under-the-caret face
    // keeps both decimal places, so a $1,250.50 target does not seed as
    // "1250.5" — the exact defect that keeps every money field off `type=number`.
    targetRef.current.value = goal ? amountEditing(goal.targetCents) : "";
    targetDateRef.current.value = goal?.targetDate ?? "";
    linkRef.current.value = goal?.link ?? "";
    budgetIdRef.current.value = goal?.budgetId ?? "";
    monthlyContributionRef.current.value = goal?.monthlyContributionCents ? amountEditing(goal.monthlyContributionCents) : "";
    setAccountIds(goal?.accountIds ?? []);
    setAmounts(goal?.accountAmounts ?? {});
    setPhoto(goal?.photo ?? null);
    setPhotoError(null);
    setEnvelopeColor(goal?.envelopeColor ?? ENVELOPE_COLORS[0]);
  }, [show, goal]);

  const rows = options.map((row) => ({
    ...row,
    included: accountIds.includes(row.account.id),
    portionCents: amounts[row.account.id] ?? null,
  }));

  const heldCents = rows
    .filter((row) => row.included)
    .reduce((sum, row) => sum + countedHoldingCents(row.valueCents, row.portionCents), 0);

  function handleToggle({ accountId, included }) {
    setAccountIds((previous) => {
      const rest = previous.filter((id) => id !== accountId);
      return included ? [...rest, accountId] : rest;
    });
    return { ok: true };
  }

  /**
   * Blank is how a part is *removed* — the account goes back to counting whole
   * — so it can never be read as a refused figure; zero and a negative are,
   * since a part of nothing is not a part. The same contract
   * `setFundAccountAmount` keeps, checked here because this is a draft and the
   * store does not see it until submit.
   */
  function handlePortion({ accountId, amount }) {
    if (String(amount ?? "").trim() === "") {
      setAmounts(({ [accountId]: _dropped, ...rest }) => rest);
      setError(null);
      return { ok: true };
    }

    const cents = toCents(amount);
    if (cents == null || cents <= 0) {
      setError(PORTION_ERROR);
      return { ok: false, error: PORTION_ERROR };
    }

    setAmounts((previous) => ({ ...previous, [accountId]: cents }));
    setError(null);
    return { ok: true };
  }

  function handleSubmit(event) {
    event.preventDefault();

    const fields = {
      name: nameRef.current.value,
      target: targetRef.current.value,
      targetDate: targetDateRef.current.value || null,
      link: linkRef.current.value,
      budgetId: budgetIdRef.current.value || null,
      monthlyContribution: monthlyContributionRef.current.value,
      accountIds,
      // Kept rather than filtered to the ticked accounts, the switched-away-from
      // rule: unticking an account and ticking it again should not lose the part
      // of it that was stated.
      accountAmounts: amounts,
      photo,
      envelopeColor,
    };
    const result = editing ? updateSavingsGoal({ id: goal.id, ...fields }) : addSavingsGoal(fields);

    if (!result.ok) {
      setError(result.error);
      nameRef.current.focus();
      return;
    }

    handleClose();
  }

  function handlePhoto(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setPhotoError("Choose an image file.");
      return;
    }
    const image = new Image();
    const reader = new FileReader();
    reader.onload = () => {
      image.onload = () => {
        const scale = Math.min(1, 640 / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
        const compressed = canvas.toDataURL("image/jpeg", 0.78);
        if (compressed.length > 180_000) {
          setPhotoError("That photo is too large. Try a smaller image.");
          return;
        }
        setPhoto(compressed);
        setPhotoError(null);
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  return (
    <Dialog
      show={show}
      handleClose={handleClose}
      // Wide only where the holdings table is on it: a three-field form in a
      // 2xl sheet reads as a form that lost its contents.
      wide={options.length > 0}
      title={editing ? "Edit savings goal" : "New savings goal"}
    >
      <form ref={formRef} onSubmit={handleSubmit}>
        <Field label="Name" inputRef={nameRef} type="text" required />
        <Field
          label="Target amount"
          inputRef={targetRef}
          type="text"
          inputMode="decimal"
          placeholder="$0.00"
          required
        />
        <Field
          label="Target date (optional)"
          inputRef={targetDateRef}
          type="date"
        />
        <Field
          label="Monthly contribution (optional)"
          inputRef={monthlyContributionRef}
          type="text"
          inputMode="decimal"
          placeholder="$0.00"
        />
        <Field
          label="Link (optional)"
          inputRef={linkRef}
          type="url"
          placeholder="https://…"
        />

        <fieldset className="mb-5">
          <legend className="mb-2 font-sans text-row font-semibold text-chalk">Envelope colour</legend>
          <div className="flex flex-wrap gap-2">
            {ENVELOPE_COLORS.map((color) => (
              <label key={color} className="cursor-pointer">
                <input
                  type="radio"
                  name="envelope-color"
                  value={color}
                  checked={envelopeColor === color}
                  onChange={() => setEnvelopeColor(color)}
                  className="peer sr-only"
                />
                <span className="flex flex-col items-center gap-1 rounded-lg border-2 border-transparent p-1.5 font-sans text-label capitalize text-chalk-soft peer-checked:border-azure peer-checked:text-chalk peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-azure">
                  <span data-envelope-color={color} className="goal-envelope-swatch" aria-hidden="true" />
                  {color}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="mb-5 rounded-xl border border-edge bg-panel-raised p-4">
          <label className="mb-2 block font-sans text-row font-semibold text-chalk" htmlFor="goal-photo">
            Picture for your goal <span className="font-normal text-chalk-soft">(optional)</span>
          </label>
          {photo && <img src={photo} alt="Goal preview" className="mb-3 h-36 w-full rounded-lg object-cover" />}
          <div className="flex flex-wrap items-center gap-3">
            <input id="goal-photo" type="file" accept="image/*" onChange={handlePhoto} className="max-w-full font-sans text-row text-chalk-soft file:mr-3 file:rounded-lg file:border-0 file:bg-azure/15 file:px-3 file:py-2 file:text-chalk" />
            {photo && <button type="button" className="font-sans text-row text-chalk-soft underline" onClick={() => setPhoto(null)}>Remove photo</button>}
          </div>
          {photoError && <p role="alert" className="mt-2 font-sans text-row text-vermilion">{photoError}</p>}
          <p className="mt-2 font-sans text-label text-chalk-soft">A little reminder of what you’re saving for.</p>
        </div>

        <SelectField label="Budget category (optional)" selectRef={budgetIdRef}>
          <option value="">None</option>
          {budgets.map((budget) => (
            <option key={budget.id} value={budget.id}>
              {budget.name}
            </option>
          ))}
          {/* A stored id that no longer names a live category gets its own option
              so the select does not silently fall back to the first one. */}
          {goal?.budgetId && !budgets.some((b) => b.id === goal.budgetId) && (
            <option value={goal.budgetId}>Unknown category</option>
          )}
        </SelectField>

        <div className="mb-5 overflow-hidden rounded-lg border border-edge">
          <div className="border-b border-edge px-4 py-3">
            <h3 className="font-sans text-row font-semibold text-chalk">
              Money already held for this goal (optional)
            </h3>
            <p className="mt-1 font-sans text-row text-chalk-soft">
              A fund years out is often invested rather than left in the current account. Tick the
              off-budget accounts holding this one and their value counts towards the target beside
              what the budget has assigned to it.
            </p>
          </div>
          {options.length === 0 ? (
            <p className="px-4 py-4 font-sans text-row text-chalk-soft">
              No off-budget accounts yet. Add one on the budget plan — a brokerage or a savings
              account the budget does not spend through — and it can be pointed at a goal here. An
              on-budget balance is not offered: that money is already in what there is to assign.
            </p>
          ) : (
            <>
              <AccountPicker
                rows={rows}
                totalLabel="Held for this goal"
                totalCents={heldCents}
                emptyNote="a goal counts money held in an account the budget does not spend through."
                onToggle={handleToggle}
                onPortionChange={handlePortion}
              />
              <p className="border-t border-edge px-4 py-3 font-sans text-row text-chalk-soft">
                A ticked account counts in full. If only part of it is this goal — the rest is for
                something else — enter that part under Counted.
              </p>
            </>
          )}
        </div>

        {error && (
          <p role="alert" className="-mt-2 mb-5 font-sans text-row text-vermilion">
            {error}
          </p>
        )}
        <div className="flex justify-end">
          <Button variant="primary" type="submit">
            {editing ? "Save" : "Add goal"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
