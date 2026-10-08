import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Button from "./Button";
import { PLAN_BUCKET_LABELS, PLAN_BUCKET_ORDER } from "../contexts/BudgetsContext";
import { toLayout } from "../planLayout";
import { amountEditing, formatCents, toCents } from "../utils";

/**
 * The categories, filed under their groups, in the order the user arranged
 * them — and the place that order, their estimates, their goals, and what each
 * is for are set.
 *
 * Two figures per row, and they answer different questions: the estimate is what
 * a category is expected to need in a month, the goal is the balance it is
 * saving towards. The estimate is always a figure — a blank one reads as nothing
 * planned — while the goal is optional and a blank one is no goal at all. That
 * is the difference the placeholders carry, "0" against "None".
 *
 * Dragging is the whole point of the component: a group is a heading and
 * nothing else, so "which group is this in" and "where in the list is it" are
 * the same gesture, and the store commits them as one write for that reason.
 *
 * A drag is previewed against a copy and committed once, on drop. Nothing is
 * written while the pointer is moving: `setCategoryLayout` rewrites both stored
 * lists, and doing that on every frame of a drag would put a few hundred
 * writes through localStorage to describe one rearrangement.
 */

// Sections need droppable ids of their own so an empty group is still a target
// — otherwise the last category to leave a group could never be put back.
// Prefixed so they cannot collide with a category's uuid.
const SECTION_PREFIX = "section:";
const sectionId = (groupId) => `${SECTION_PREFIX}${groupId ?? "ungrouped"}`;

/** Where an id sits: which section, and which row within it. `item` is -1 for
 *  the section itself, which is what a drop onto empty space reports. */
function locate(sections, id) {
  if (id == null) return null;
  for (let section = 0; section < sections.length; section += 1) {
    if (sectionId(sections[section].groupId) === id) return { section, item: -1 };
    const item = sections[section].budgets.findIndex((budget) => budget.id === id);
    if (item !== -1) return { section, item };
  }
  return null;
}

/**
 * Re-derive what a rearranged copy would look like: the section totals, which
 * move as soon as a category crosses a heading.
 *
 * The same fold `toSections` performs on committed data, applied to the copy
 * being dragged, so the previewed totals and the ones that appear on drop are
 * arrived at the same way. What a category is *for* is not re-derived, because
 * it no longer depends on where it sits: a category carries its own bucket, and
 * dragging it under another heading moves it without re-labelling it.
 */
function withDerived(sections) {
  return sections.map((section) => ({
    ...section,
    plannedCents: section.budgets.reduce((sum, budget) => sum + budget.plannedCents, 0),
  }));
}

/** Lift a category out of one section and drop it into another. */
function moveBetweenSections(sections, from, to) {
  const next = sections.map((section) => ({ ...section, budgets: [...section.budgets] }));
  const [moved] = next[from.section].budgets.splice(from.item, 1);
  const at = to.item === -1 ? next[to.section].budgets.length : to.item;
  next[to.section].budgets.splice(at, 0, moved);
  return withDerived(next);
}

function GripIcon() {
  return (
    <svg viewBox="0 0 10 16" aria-hidden="true" className="h-4 w-2.5 fill-current">
      <circle cx="2" cy="3" r="1.4" />
      <circle cx="8" cy="3" r="1.4" />
      <circle cx="2" cy="8" r="1.4" />
      <circle cx="8" cy="8" r="1.4" />
      <circle cx="2" cy="13" r="1.4" />
      <circle cx="8" cy="13" r="1.4" />
    </svg>
  );
}

const rowBg = (index) => (index % 2 === 0 ? "bg-sheet" : "bg-sheet-alt");

/**
 * The row's two shapes. From `sm` up it is one line of six fixed columns, as it
 * always was. On a phone those widths come to more than the screen, and the
 * column that gives way is the name — the one that matters most — so below `sm`
 * the row is a grid of two lines instead: the handle, the name and Remove on the
 * first, the bucket and the two figures under it. Every element carries its
 * place in that grid (`PLACE`), and grid placement means nothing to a flex
 * container, so the same classes are inert once the row turns back into one
 * line. The headings, the rows and the drag overlay all take both, which is
 * what keeps the three in step at either width.
 */
const lineClass =
  "grid grid-cols-[auto_minmax(0,1fr)_4.75rem_4.75rem] items-center gap-x-3 gap-y-1 sm:flex sm:gap-y-0";

const PLACE = {
  handle: "col-start-1 row-start-1",
  name: "col-span-2 col-start-2 row-start-1",
  remove: "col-start-4 row-start-1 justify-self-end",
  bucket: "col-span-2 col-start-1 row-start-2",
  estimate: "col-start-3 row-start-2",
  goal: "col-start-4 row-start-2",
};

const rowClass = (index) => `${lineClass} px-3 py-2 ${rowBg(index)}`;

const handleClass =
  "cursor-grab touch-none px-1 py-1 text-ink-soft transition-colors hover:text-ink focus-visible:text-ink focus-visible:outline-none active:cursor-grabbing";

// The fixed columns, shared by the header, the rows and the drag overlay so the
// three cannot drift apart. A number field either side of the same width is the
// whole reason the header exists: with one figure on the row its aria-label was
// enough, and with two the reader needs to be told which is which.
//
// Both are as narrow as their contents allow, because everything they take comes
// out of the name — the one field on the row holding a sentence rather than a
// short figure, and the one that has to survive the page's two-column layout at
// its narrowest. A bucket is one of three known words and an estimate is rarely
// past five digits; a category name is whatever the household calls it.
const bucketClass = "w-full shrink-0 sm:w-32";

const figureClass = "w-full shrink-0 text-right sm:w-24";

const figureInputClass = `${figureClass} border-0 border-b-2 border-rule bg-transparent px-0 py-1 font-mono text-row tabular-nums text-ink outline-none transition-colors placeholder:text-ink-soft/60 focus:border-azure`;

/**
 * What each column on the rows below holds.
 *
 * Every cell is a spacer of the same width as the control it sits over, and the
 * two that are not labelled — the drag handle and Remove — are invisible copies
 * of the real thing rather than a hand-measured width, so a change to either
 * control moves its heading with it. `visibility: hidden` keeps them out of the
 * tab order and out of the accessibility tree, which a copy of a live control
 * has to be.
 */
function ColumnHeadings() {
  return (
    <div
      className={`${lineClass} border-b border-rule bg-band px-3 py-1.5 font-mono text-label uppercase text-ink`}
    >
      <span aria-hidden="true" className={`${handleClass} ${PLACE.handle} invisible`}>
        <GripIcon />
      </span>
      <span className={`${PLACE.name} min-w-0 flex-1`}>Category</span>
      <span className={`${bucketClass} ${PLACE.bucket}`}>What it&rsquo;s for</span>
      <span className={`${figureClass} ${PLACE.estimate}`}>Estimate</span>
      <span className={`${figureClass} ${PLACE.goal}`}>Goal</span>
      <Button
        aria-hidden="true"
        tabIndex={-1}
        variant="row"
        size="sm"
        className={`${PLACE.remove} invisible`}
      >
        Remove
      </Button>
    </div>
  );
}

/**
 * What each figure column holds when nothing is being typed into it, and both
 * are the raw-under-the-caret face rather than a bare `fromCents`: $1,250.50 has
 * to seed as "1250.50", or the column stops lining up on its decimal point —
 * which is the whole reason none of these is a `type="number"`.
 *
 * One function per column because the two blanks mean different things. An empty
 * estimate is a category nobody has made their mind up about, which reads as
 * zero against the "0" placeholder; an empty goal is a category saving towards
 * nothing, which is most of them, and the "None" placeholder is what tells the
 * two apart. Both the seed and the put-back go through these, so a refused edit
 * cannot restore a figure in a shape the field would never have shown.
 */
const estimateValue = (budget) => (budget.plannedCents ? amountEditing(budget.plannedCents) : "");

const goalValue = (budget) => amountEditing(budget.goalCents);

/**
 * What a category is for, chosen on the row itself.
 *
 * Four options, one of which is always selected. There is no "group default"
 * entry: a category starts on its group's bucket when it is created and states
 * its own from then on, so an option meaning "ask my heading" would offer a
 * fifth answer to a question that only has four.
 *
 * Controlled, unlike the estimate beside it: there is nothing to type, so the
 * choice commits the moment it is made and the control has to show what the
 * store now holds rather than what was picked. Its own background, because a
 * transparent `<select>` paints its option list against whatever is behind it —
 * see `Field.js` — which on the zebra rows means picking the row's own shade.
 */
function BucketSelect({ value, onChange, label, className }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={label}
      className={className}
    >
      {PLAN_BUCKET_ORDER.map((bucket) => (
        <option key={bucket} value={bucket}>
          {PLAN_BUCKET_LABELS[bucket]}
        </option>
      ))}
    </select>
  );
}

/**
 * One category row: a drag handle, its name, what it is for, its estimate, and a
 * way out.
 *
 * The handle is a button of its own rather than the whole row being draggable.
 * The row holds text fields, and a pointer sensor over the whole row would
 * swallow the click that focuses one — the user could never edit the figure or
 * the name they came here to edit.
 */
function CategoryRow({
  budget,
  index,
  onNameChange,
  onEstimateChange,
  onGoalChange,
  onBucketChange,
  onDelete,
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: budget.id,
  });

  // Committed on blur rather than per keystroke: a half-typed "12" on the way
  // to "1200" is a real figure, and writing it would leave the plan wrong for
  // as long as it took to finish typing.
  function handleBlur(e) {
    const raw = e.target.value;
    const cents = raw.trim() === "" ? 0 : toCents(raw);
    const result = onEstimateChange(budget, cents);
    // Put the stored figure back when the store refuses the typed one, so the
    // row never shows an amount the plan is not actually using — through the
    // same `estimateValue` the field was seeded with, so a category estimated
    // at nothing goes back to the blank its placeholder explains rather than to
    // a typed "0" the user never wrote.
    if (!result.ok) e.target.value = estimateValue(budget);
  }

  /**
   * The goal, on the same commit-on-blur contract and with one difference that
   * matters: **a blank clears it rather than reading as zero**. Most categories
   * are not saving towards anything, so emptying the field is how that is said,
   * and it is why the raw string goes to the store rather than a figure — blank
   * and junk both parse to null, and only one of them means "no goal".
   */
  function handleGoalBlur(e) {
    const result = onGoalChange(budget, e.target.value);
    if (!result.ok) e.target.value = goalValue(budget);
  }

  // The same contract for the name: committed on blur, because a rename typed a
  // letter at a time would put a dozen half-names through the store's duplicate
  // check and reject most of them. A rejected name — blank, or one another
  // category already has — is put back rather than left on screen, since the
  // rest of the app is still calling this category by the old one.
  function handleNameBlur(e) {
    const next = e.target.value;
    if (next.trim() === budget.name) {
      e.target.value = budget.name;
      return;
    }
    const result = onNameChange(budget, next);
    if (!result.ok) e.target.value = budget.name;
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      // The original keeps its place in the flow as a gap rather than
      // disappearing, so the list does not resize under the pointer.
      className={`${rowClass(index)} ${isDragging ? "opacity-25" : ""}`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${budget.name}`}
        className={`${handleClass} ${PLACE.handle}`}
      >
        <GripIcon />
      </button>

      {/* Keyed on the stored name so a successful rename re-seeds the field with
          what was actually saved — trimmed, and as the rest of the app now knows
          it. Remounting costs nothing here: the commit is on blur, so focus has
          already left. */}
      <input
        key={budget.name}
        type="text"
        defaultValue={budget.name}
        aria-label={`Name of ${budget.name}`}
        onBlur={handleNameBlur}
        className={`${PLACE.name} min-w-0 flex-1 border-0 border-b-2 border-rule bg-transparent px-0 py-1 font-sans text-row text-ink outline-none transition-colors focus:border-azure`}
      />

      <BucketSelect
        value={budget.effectiveBucket}
        onChange={(bucket) => onBucketChange(budget, bucket)}
        label={`What ${budget.name} is for`}
        className={`${bucketClass} ${PLACE.bucket} border-0 border-b-2 border-rule px-0 py-1 font-sans text-row text-ink outline-none transition-colors focus:border-azure ${rowBg(
          index
        )}`}
      />

      <input
        type="text"
        inputMode="decimal"
        defaultValue={estimateValue(budget)}
        placeholder="0"
        aria-label={`Monthly estimate for ${budget.name}`}
        onBlur={handleBlur}
        className={`${figureInputClass} ${PLACE.estimate}`}
      />

      {/* Keyed on the stored goal, unlike the estimate beside it: this field has
          two empty states — nothing typed, and a goal taken off — and without a
          re-seed a cleared field would keep showing a blank the store had
          refused. The placeholder says which blank this is. */}
      <input
        key={budget.goalCents}
        type="text"
        inputMode="decimal"
        defaultValue={goalValue(budget)}
        placeholder="None"
        aria-label={`Goal for ${budget.name}`}
        onBlur={handleGoalBlur}
        className={`${figureInputClass} ${PLACE.goal}`}
      />

      <Button
        variant="row"
        size="sm"
        className={PLACE.remove}
        aria-label={`Remove category: ${budget.name}`}
        onClick={() => onDelete(budget)}
      >
        Remove
      </Button>
    </div>
  );
}

/**
 * The copy that follows the pointer.
 *
 * Flat markup rather than a second `CategoryRow`: a sortable registers itself
 * under its id, and mounting one for a row already on screen would put two
 * claims on the same id into the same context. It is also the reason the
 * estimate is text here and the Remove button is gone — a duplicate of a live
 * form control is a control the user can reach and a label that matches two
 * fields at once.
 */
function DraggedRow({ budget }) {
  return (
    <div className={`${rowClass(0)} border border-azure shadow-lg`}>
      <span className={`${handleClass} ${PLACE.handle}`}>
        <GripIcon />
      </span>
      <span className={`${PLACE.name} min-w-0 flex-1 truncate font-sans text-row text-ink`}>
        {budget.name}
      </span>
      <span className={`${bucketClass} ${PLACE.bucket} pb-1 font-sans text-row text-ink-soft`}>
        {PLAN_BUCKET_LABELS[budget.effectiveBucket]}
      </span>
      <span className={`${figureClass} ${PLACE.estimate} pb-1 font-mono text-row tabular-nums text-ink`}>
        {formatCents(budget.plannedCents)}
      </span>
      {/* A dash, not $0: the row being dragged is not saving towards nothing, it
          is not saving towards anything. */}
      <span className={`${figureClass} ${PLACE.goal} pb-1 font-mono text-row tabular-nums text-ink-soft`}>
        {budget.goalCents == null ? "—" : formatCents(budget.goalCents)}
      </span>
    </div>
  );
}

function Section({
  section,
  hasGroups,
  onNameChange,
  onEstimateChange,
  onGoalChange,
  onBucketChange,
  onDeleteCategory,
  onAddCategory,
  onEditGroup,
  onDeleteGroup,
  onMoveGroup,
  canMoveUp,
  canMoveDown,
}) {
  const { setNodeRef, isOver } = useDroppable({ id: sectionId(section.groupId) });
  const ungrouped = section.groupId == null;

  // "Ungrouped" only means something once there is a group to be outside of.
  // Before that it is the whole list, and heading it with the name of an
  // exception the user has never met would be noise. Empty, with groups in
  // play, the planner shows it only during a drag (see the section list).
  const heading = ungrouped && !hasGroups ? "Categories" : section.name;

  return (
    <section className={`border ${isOver ? "border-azure" : "border-edge"} bg-panel`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-edge px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <h3
            className={`font-sans text-base font-semibold tracking-tight ${
              ungrouped ? "text-chalk-soft" : "text-chalk"
            }`}
          >
            {heading}
          </h3>
          {/* What a category added here starts on — stated, not offered: the one
              control that sets it lives in the group's own form, where it was
              chosen, and every row beneath already names what it settled on. */}
          <span className="font-mono text-label uppercase text-chalk-soft">
            {section.budgets.length}{" "}
            {section.budgets.length === 1 ? "category" : "categories"} ·{" "}
            <span className="text-chalk">{formatCents(section.plannedCents)}</span>
            {!ungrouped && <> · {PLAN_BUCKET_LABELS[section.bucket]} by default</>}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => onAddCategory(section.groupId)}>
            Add category
          </Button>
          {!ungrouped && (
            <>
              <Button
                variant="outline"
                size="sm"
                aria-label={`Move group up: ${section.name}`}
                disabled={!canMoveUp}
                onClick={() => onMoveGroup(section.groupId, -1)}
              >
                ↑
              </Button>
              <Button
                variant="outline"
                size="sm"
                aria-label={`Move group down: ${section.name}`}
                disabled={!canMoveDown}
                onClick={() => onMoveGroup(section.groupId, 1)}
              >
                ↓
              </Button>
              <Button variant="outline" size="sm" onClick={() => onEditGroup(section)}>
                Edit
              </Button>
              <Button
                variant="danger"
                size="sm"
                aria-label={`Delete group: ${section.name}`}
                onClick={() => onDeleteGroup(section)}
              >
                Delete
              </Button>
            </>
          )}
        </div>
      </div>

      <div ref={setNodeRef}>
        <SortableContext
          items={section.budgets.map((budget) => budget.id)}
          strategy={verticalListSortingStrategy}
        >
          {section.budgets.length === 0 ? (
            <p className="px-4 py-5 font-sans text-row text-chalk-soft">
              {!ungrouped
                ? "Nothing here yet. Add a category, or drag one in."
                : hasGroups
                ? "Drop a category here to take it out of its group."
                : "No categories yet."}
            </p>
          ) : (
            <>
              <ColumnHeadings />
              {section.budgets.map((budget, index) => (
                <CategoryRow
                  key={budget.id}
                  budget={budget}
                  index={index}
                  onNameChange={onNameChange}
                  onEstimateChange={onEstimateChange}
                  onGoalChange={onGoalChange}
                  onBucketChange={onBucketChange}
                  onDelete={onDeleteCategory}
                />
              ))}
            </>
          )}
        </SortableContext>
      </div>
    </section>
  );
}

export default function CategoryPlanner({
  sections,
  onLayoutChange,
  onNameChange,
  onEstimateChange,
  onGoalChange,
  onBucketChange,
  onAddCategory,
  onEditGroup,
  onDeleteGroup,
  onDeleteCategory,
}) {
  // Non-null only while a drag is in flight, so there is no mirror of the store
  // to fall out of step with it between drags. The row being dragged is held as
  // an id rather than a copy of the record: it is read back out of the preview
  // on every render, so the label the overlay carries is the one the row will
  // have where it currently sits, not the one it had when the drag began.
  const [preview, setPreview] = useState(null);
  const [draggingId, setDraggingId] = useState(null);

  const sensors = useSensors(
    // A few pixels of slop, so a click on the handle stays a click and the
    // Remove button beside it is not swallowed by a drag that never started.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const view = preview ?? sections;
  const groupCount = view.filter((section) => section.groupId != null).length;

  // An empty "Ungrouped" says nothing at rest, so it is hidden. It comes back
  // while a drag is in flight, because then it is the one place a category can
  // be dropped to take it out of its group — and it sits last, so appearing
  // moves nothing above it. With no groups at all it is the whole list, headed
  // "Categories", and keeps its empty state.
  const isShown = (section) =>
    section.groupId != null ||
    section.budgets.length > 0 ||
    groupCount === 0 ||
    draggingId != null;

  const draggingAt = draggingId == null ? null : locate(view, draggingId);
  const dragging =
    draggingAt && draggingAt.item !== -1 ? view[draggingAt.section].budgets[draggingAt.item] : null;

  function handleDragStart({ active }) {
    const at = locate(sections, active.id);
    if (!at || at.item === -1) return;
    setDraggingId(active.id);
    setPreview(sections);
  }

  // Crossing into another section is handled here so the row appears under its
  // new heading while the pointer is still down. Reordering *within* a section
  // is left to the drop — dnd-kit is already animating that, and moving the
  // array underneath it as well would fight the animation.
  function handleDragOver({ active, over }) {
    if (!over) return;
    setPreview((current) => {
      const base = current ?? sections;
      const from = locate(base, active.id);
      const to = locate(base, over.id);
      if (!from || !to || from.item === -1 || from.section === to.section) return base;
      return moveBetweenSections(base, from, to);
    });
  }

  function handleDragEnd({ active, over }) {
    const base = preview ?? sections;
    setDraggingId(null);
    setPreview(null);

    // Dropped into nothing, or never actually moved: leave the stored order
    // alone rather than rewriting it with itself.
    if (!over) return;
    if (!preview && active.id === over.id) return;

    const from = locate(base, active.id);
    const to = locate(base, over.id);
    if (!from || !to || from.item === -1) return;

    const next =
      from.section === to.section
        ? withDerived(
            base.map((section, index) =>
              index === from.section
                ? {
                    ...section,
                    budgets: arrayMove(
                      section.budgets,
                      from.item,
                      to.item === -1 ? section.budgets.length - 1 : to.item
                    ),
                  }
                : section
            )
          )
        : moveBetweenSections(base, from, to);

    onLayoutChange(toLayout(next));
  }

  function handleDragCancel() {
    setDraggingId(null);
    setPreview(null);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      {/* From `sm` up the row's columns are fixed widths shared with the
          heading and the drag overlay — that is what keeps the three aligned —
          and in the plan's narrower column they can still come to more than
          the box is wide, so the list scrolls sideways inside its own box
          rather than taking the page with it. Below `sm` every row folds onto
          two lines instead (see `lineClass`) and nothing scrolls. The overlay
          is deliberately *outside* this box: paint containment would make it
          the containing block for the fixed-position copy that follows the
          pointer. */}
      <div className="scroll-x">
        <div className="space-y-3 sm:min-w-[29rem]">
          {view.filter(isShown).map((section, index) => (
            <Section
              key={sectionId(section.groupId)}
              section={section}
              hasGroups={groupCount > 0}
              onNameChange={onNameChange}
              onEstimateChange={onEstimateChange}
              onGoalChange={onGoalChange}
              onBucketChange={onBucketChange}
              onDeleteCategory={onDeleteCategory}
              onAddCategory={onAddCategory}
              onEditGroup={onEditGroup}
              onDeleteGroup={onDeleteGroup}
              onMoveGroup={(groupId, delta) => {
                const at = view.findIndex((entry) => entry.groupId === groupId);
                const to = at + delta;
                if (at === -1 || to < 0 || to >= groupCount) return;
                onLayoutChange(toLayout(arrayMove(view, at, to)));
              }}
              canMoveUp={index > 0}
              canMoveDown={index < groupCount - 1}
            />
          ))}
        </div>
      </div>

      {/* The dragged row follows the pointer as a detached copy, so it stays
          legible over whichever heading it is currently above. */}
      <DragOverlay>{dragging && <DraggedRow budget={dragging} />}</DragOverlay>
    </DndContext>
  );
}
