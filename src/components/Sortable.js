import {
  DndContext,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/**
 * Drag to reorder, with no chrome of its own.
 *
 * Every list the household arranges for itself — accounts, categories, groups,
 * income sources, savings goals — can be put in order by picking a row up and
 * dropping it. There is deliberately no handle and no new control: the row is
 * what is dragged, so nothing on screen changes for anybody who never tries.
 * (The plan's category list keeps the handle it has always had, because its
 * rows are mostly text fields.)
 *
 * Three things make a whole row safe to pick up:
 *
 * - **A press on a field never starts a drag** (`fromField`) — selecting text
 *   in an input is a drag of its own, and a select opens on mouse-down.
 * - **A mouse has to move a few pixels first**, so a click on a button or a
 *   figure in the row stays a click; **a finger has to rest** for a moment,
 *   so a swipe stays a scroll on a phone.
 * - **The click that ends a drag is swallowed** — by dnd-kit's own sensor,
 *   which holds a capturing click listener for a moment after the drop. The
 *   row travels under the pointer, so the button pressed at the start is under
 *   it again at the drop, and the browser would otherwise read the pair as a
 *   click on it and open whatever that button opens as the row lands.
 *
 * There is no keyboard route, and that is the price of having no control: a
 * keyboard sensor needs every row to be a tab stop announcing itself as
 * sortable, which is chrome by another name. Order is a convenience here, never
 * a fact the books depend on.
 */

const FIELD_SELECTOR = "input, select, textarea, [contenteditable='true'], [data-no-drag]";

function fromField(event) {
  const target = event?.target;
  return typeof target?.closest === "function" && target.closest(FIELD_SELECTOR) != null;
}

function guarded(Sensor) {
  return class extends Sensor {
    static activators = Sensor.activators.map((activator) => ({
      ...activator,
      handler: (event, options) => !fromField(event.nativeEvent) && activator.handler(event, options),
    }));
  };
}

const RowMouseSensor = guarded(MouseSensor);
const RowTouchSensor = guarded(TouchSensor);

/**
 * Where dnd-kit's announcements go: a node that is never attached. They would
 * read out row ids — uuids — with nothing to say what a row is, and every list
 * on a page would add another empty `role="status"` beside the page's own. A
 * pointer drag needs no announcement; a keyboard route, if one is ever added,
 * would bring its own wording with it.
 */
let silentNode = null;
function silent() {
  if (silentNode == null && typeof document !== "undefined") {
    silentNode = document.createElement("div");
  }
  return silentNode;
}

export function useRowSensors() {
  return useSensors(
    useSensor(RowMouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(RowTouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } })
  );
}

/**
 * One reorderable list. `ids` is what is on screen, in order; `onReorder` gets
 * the same ids in their new order, and only when something actually moved.
 *
 * Renders no element of its own — dnd-kit's live region, by default a `<div>`
 * wherever this is mounted, goes to `silent()` — so it can sit inside a table — around a `<tbody>`'s rows, or around
 * the `<tbody>`s themselves.
 */
export function SortableList({ ids, onReorder, children }) {
  const sensors = useRowSensors();

  function handleDragEnd({ active, over }) {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(active.id);
    const to = ids.indexOf(over.id);
    if (from === -1 || to === -1) return;
    onReorder(arrayMove(ids, from, to));
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      accessibility={{ container: silent() }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

/**
 * The row's half: spread `handle` on whatever is picked up (usually the row
 * itself) and put `ref` and `style` on whatever moves. Deliberately not
 * dnd-kit's `attributes`, which would make every row a tab stop with a role —
 * see the note above.
 */
export function useSortableItem(id, { disabled = false } = {}) {
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });
  return {
    ref: setNodeRef,
    handle: disabled ? {} : listeners ?? {},
    isDragging,
    style: {
      transform: CSS.Translate.toString(transform),
      transition,
      // Above its neighbours while it travels, or the rows it passes would
      // paint over it.
      ...(isDragging ? { position: "relative", zIndex: 10 } : null),
    },
  };
}
