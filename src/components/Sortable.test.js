import { act, fireEvent, render, screen } from "@testing-library/react";
import { SortableList, useSortableItem } from "./Sortable";

/**
 * jsdom lays nothing out, so every row is given a 40px band of its own off
 * `data-row` — enough for dnd-kit to measure, collide and choose a drop.
 */
let restoreRects;
beforeEach(() => {
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () {
    const row = this.closest?.("[data-row]");
    const index = row ? Number(row.dataset.row) : 0;
    const top = index * 40;
    return { x: 0, y: top, top, left: 0, right: 300, bottom: top + 40, width: 300, height: 40 };
  };
  restoreRects = () => {
    Element.prototype.getBoundingClientRect = original;
  };
});
afterEach(async () => {
  restoreRects();
  // dnd-kit keeps its click-swallowing listener on the document for 50ms after
  // a drop; let it go before the next test clicks anything.
  await act(() => new Promise((resolve) => setTimeout(resolve, 60)));
});

function Row({ id, index, onOpen }) {
  const item = useSortableItem(id);
  return (
    <li ref={item.ref} style={item.style} {...item.handle} data-row={index}>
      {id}
      <button type="button" onClick={() => onOpen(id)}>
        Open {id}
      </button>
      <input aria-label={`Note ${id}`} />
    </li>
  );
}

function List({ ids, onReorder, onOpen }) {
  return (
    <ul>
      <SortableList ids={ids} onReorder={onReorder}>
        {ids.map((id, index) => (
          <Row key={id} id={id} index={index} onOpen={onOpen} />
        ))}
      </SortableList>
    </ul>
  );
}

function drag(from, toY) {
  fireEvent.mouseDown(from, { button: 0, clientX: 10, clientY: 10 });
  act(() => {
    fireEvent.mouseMove(document, { clientX: 10, clientY: 30 });
  });
  act(() => {
    fireEvent.mouseMove(document, { clientX: 10, clientY: toY });
  });
  act(() => {
    fireEvent.mouseUp(document, { clientX: 10, clientY: toY });
  });
}

describe("drag to reorder", () => {
  it("drops a row in a new place and reports the new order", () => {
    const onReorder = jest.fn();
    render(<List ids={["a", "b", "c"]} onReorder={onReorder} onOpen={() => {}} />);

    drag(screen.getByText("a", { selector: "li" }), 95);

    expect(onReorder).toHaveBeenCalledWith(["b", "c", "a"]);
  });

  it("leaves a click a click, and swallows the one a drop produces", () => {
    const onOpen = jest.fn();
    render(<List ids={["a", "b"]} onReorder={() => {}} onOpen={onOpen} />);

    fireEvent.click(screen.getByRole("button", { name: "Open a" }));
    expect(onOpen).toHaveBeenCalledTimes(1);

    const button = screen.getByRole("button", { name: "Open a" });
    drag(button, 60);
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("never starts a drag from a field", () => {
    const onReorder = jest.fn();
    render(<List ids={["a", "b", "c"]} onReorder={onReorder} onOpen={() => {}} />);

    drag(screen.getByLabelText("Note a"), 95);

    expect(onReorder).not.toHaveBeenCalled();
  });
});
