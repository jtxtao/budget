import { useEffect, useRef, useState } from "react";
import Dialog from "./Dialog";
import Field, { SelectField } from "./Field";
import Button from "./Button";
import ProgramOptions from "./ProgramOptions";
import { useRewards } from "../contexts/RewardsContext";
import { CATALOG } from "../rewards";
import { amountEditing } from "../utils";

/**
 * A redemption being planned — a flight or a stay, priced in points and in cash
 * — or an edit of one.
 *
 * The cash price is optional but it is what makes the plan worth writing down:
 * it is the figure the points are being measured against, and without it the
 * page can say whether the trip is covered but not whether it is a good use of
 * the points. Taxes and fees are asked for apart from the points because they
 * are still paid in cash, and leaving them in would flatter every award.
 */
export default function AddTripModal({ show, trip, handleClose }) {
  const formRef = useRef();
  const nameRef = useRef();
  const dateRef = useRef();
  const programRef = useRef();
  const pointsRef = useRef();
  const taxesRef = useRef();
  const cashRef = useRef();
  const [error, setError] = useState(null);

  const { addTrip, updateTrip } = useRewards();
  const editing = trip != null;

  useEffect(() => {
    if (!show) return;
    formRef.current.reset();
    setError(null);
    nameRef.current.value = trip?.name ?? "";
    dateRef.current.value = trip?.date ?? "";
    programRef.current.value = trip?.programId ?? CATALOG.find((p) => p.kind === "airline").id;
    pointsRef.current.value = trip ? String(trip.points) : "";
    taxesRef.current.value = trip?.taxesCents ? amountEditing(trip.taxesCents) : "";
    cashRef.current.value = trip?.cashPriceCents != null ? amountEditing(trip.cashPriceCents) : "";
  }, [show, trip]);

  function handleSubmit(event) {
    event.preventDefault();
    const fields = {
      name: nameRef.current.value,
      date: dateRef.current.value || null,
      programId: programRef.current.value,
      points: pointsRef.current.value,
      taxes: taxesRef.current.value,
      cashPrice: cashRef.current.value,
    };
    const result = editing ? updateTrip({ id: trip.id, ...fields }) : addTrip(fields);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    handleClose();
  }

  return (
    <Dialog show={show} handleClose={handleClose} title={editing ? "Edit trip" : "Plan a trip"}>
      <form ref={formRef} onSubmit={handleSubmit}>
        <Field label="Trip" inputRef={nameRef} type="text" placeholder="e.g. Tokyo in spring" required />
        <Field label="Travel date (optional)" inputRef={dateRef} type="date" />
        <SelectField label="Booked with" selectRef={programRef}>
          <ProgramOptions />
        </SelectField>
        <Field label="Points or miles needed" inputRef={pointsRef} type="text" inputMode="numeric" required />
        <Field
          label="Taxes and fees paid in cash"
          inputRef={taxesRef}
          type="text"
          inputMode="decimal"
          placeholder="$0.00"
        />
        <Field
          label="Cash price of the same trip (optional)"
          inputRef={cashRef}
          type="text"
          inputMode="decimal"
          placeholder="$0.00"
        />
        {error && (
          <p role="alert" className="-mt-2 mb-5 font-sans text-row text-vermilion">
            {error}
          </p>
        )}
        <div className="flex justify-end">
          <Button variant="primary" type="submit">
            {editing ? "Save" : "Add trip"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
