import { render, screen, fireEvent, within } from "@testing-library/react";
import CategoryPlanner from "./CategoryPlanner";
import { PLAN_BUCKETS } from "../contexts/BudgetsContext";
import { toSections } from "../planLayout";

/**
 * The planner takes its rows as a prop and writes through callbacks, so these
 * render it directly rather than through `AppProviders` — what is under test is
 * the row's editing contract, not how the categories got there.
 *
 * Sections are built with the real `toSections` rather than by hand: the row
 * reads `effectiveBucket`, and a fixture that supplied it differently from the
 * fold the page uses would test a shape the app never renders.
 */
const ok = () => ({ ok: true });

function renderPlanner({ groups = [], budgets = [], ...handlers } = {}) {
  const props = {
    onLayoutChange: () => {},
    onNameChange: ok,
    onEstimateChange: ok,
    onGoalChange: ok,
    onBucketChange: () => {},
    onAddCategory: () => {},
    onEditGroup: () => {},
    onDeleteGroup: () => {},
    onDeleteCategory: () => {},
    ...handlers,
  };
  render(<CategoryPlanner sections={toSections(groups, budgets)} {...props} />);
  return props;
}

const budget = (fields) => ({
  id: fields.name,
  plannedCents: 40000,
  goalCents: null,
  groupId: null,
  bucket: PLAN_BUCKETS.ESSENTIALS,
  ...fields,
});

test("a category is renamed by typing over it, committed on blur", () => {
  const onNameChange = jest.fn(ok);
  renderPlanner({ budgets: [budget({ name: "Grocerys" })], onNameChange });

  const field = screen.getByLabelText("Name of Grocerys");
  fireEvent.change(field, { target: { value: "Groceries" } });

  // Nothing is written while the user is still typing: a rename a letter at a
  // time would put a dozen half-names through the store's duplicate check.
  expect(onNameChange).not.toHaveBeenCalled();

  fireEvent.blur(field);

  expect(onNameChange).toHaveBeenCalledTimes(1);
  expect(onNameChange.mock.calls[0][1]).toBe("Groceries");
});

test("a name the store refuses is put back rather than left on screen", () => {
  const onNameChange = jest.fn(() => ({ ok: false, error: "A category named “Fuel” already exists." }));
  renderPlanner({ budgets: [budget({ name: "Groceries" })], onNameChange });

  const field = screen.getByLabelText("Name of Groceries");
  fireEvent.change(field, { target: { value: "Fuel" } });
  fireEvent.blur(field);

  // The rest of the app still calls this category Groceries, so the row has to
  // as well.
  expect(field).toHaveValue("Groceries");
});

test("blurring without editing writes nothing", () => {
  const onNameChange = jest.fn(ok);
  renderPlanner({ budgets: [budget({ name: "Groceries" })], onNameChange });

  fireEvent.blur(screen.getByLabelText("Name of Groceries"));

  expect(onNameChange).not.toHaveBeenCalled();
});

test("a goal is typed on the row and committed on blur, like the estimate", () => {
  const onGoalChange = jest.fn(ok);
  renderPlanner({ budgets: [budget({ name: "Car fund" })], onGoalChange });

  const field = screen.getByLabelText("Goal for Car fund");
  // Empty and showing what an empty one means, which is not the estimate's "0".
  expect(field).toHaveValue("");
  expect(field).toHaveAttribute("placeholder", "None");

  fireEvent.change(field, { target: { value: "5000" } });
  expect(onGoalChange).not.toHaveBeenCalled();

  fireEvent.blur(field);

  // The raw field, not a figure: blank and junk both parse to null and only one
  // of them means "no goal", so the store is the one that reads it.
  expect(onGoalChange).toHaveBeenCalledTimes(1);
  expect(onGoalChange.mock.calls[0][1]).toBe("5000");
});

test("clearing a goal is sent as the blank it is", () => {
  const onGoalChange = jest.fn(ok);
  renderPlanner({ budgets: [budget({ name: "Car fund", goalCents: 500000 })], onGoalChange });

  const field = screen.getByLabelText("Goal for Car fund");
  // Both decimal places, the raw-under-the-caret face every money field wears:
  // a bare `fromCents` would seed "5000" here and "12340.5" for a figure with
  // cents on it, and the column would stop lining up on its decimal point.
  expect(field).toHaveValue("5000.00");

  fireEvent.change(field, { target: { value: "" } });
  fireEvent.blur(field);

  expect(onGoalChange.mock.calls[0][1]).toBe("");
});

test("a goal the store refuses is put back rather than left on screen", () => {
  const onGoalChange = jest.fn(() => ({ ok: false, error: "Enter a goal above zero." }));
  renderPlanner({ budgets: [budget({ name: "Car fund", goalCents: 500000 })], onGoalChange });

  const field = screen.getByLabelText("Goal for Car fund");
  fireEvent.change(field, { target: { value: "0" } });
  fireEvent.blur(field);

  // The plan is still saving towards $5,000, so the row has to say so.
  expect(field).toHaveValue("5000.00");
});

test("the two figure columns are named, since a row now carries both", () => {
  renderPlanner({ budgets: [budget({ name: "Car fund" })] });

  // The aria-labels tell them apart for a screen reader; the headings are what
  // tell them apart on screen.
  expect(screen.getByText("Estimate")).toBeInTheDocument();
  expect(screen.getByText("Goal")).toBeInTheDocument();
});

test("what a category is for offers the four buckets and nothing else", () => {
  // "Group default" used to sit at the top of this list. A category carries its
  // own bucket now, so an option meaning "ask my heading" would be a fifth
  // answer to a question with four.
  renderPlanner({
    groups: [{ id: "g1", name: "Leisure", bucket: PLAN_BUCKETS.FUN }],
    budgets: [budget({ name: "Cinema", groupId: "g1", bucket: PLAN_BUCKETS.FUN })],
  });

  const select = screen.getByLabelText("What Cinema is for");
  expect(within(select).getAllByRole("option").map((option) => option.textContent)).toEqual([
    "Essentials",
    "Fun",
    "Savings",
    "Retirement",
  ]);
  expect(select).toHaveValue(PLAN_BUCKETS.FUN);
});

test("an empty Ungrouped section is not shown once every category is in a group", () => {
  const groups = [{ id: "g1", name: "Leisure", bucket: PLAN_BUCKETS.FUN }];
  renderPlanner({ groups, budgets: [budget({ name: "Cinema", groupId: "g1" })] });
  expect(screen.queryByRole("heading", { name: "Ungrouped" })).not.toBeInTheDocument();
});

test("Ungrouped is shown while it holds a category", () => {
  const groups = [{ id: "g1", name: "Leisure", bucket: PLAN_BUCKETS.FUN }];
  renderPlanner({ groups, budgets: [budget({ name: "Rent" })] });
  expect(screen.getByRole("heading", { name: "Ungrouped" })).toBeInTheDocument();
});

test("with no groups and no categories the list keeps its empty state", () => {
  renderPlanner();
  expect(screen.getByRole("heading", { name: "Categories" })).toBeInTheDocument();
  expect(screen.getByText("No categories yet.")).toBeInTheDocument();
});
