import { act, renderHook } from "@testing-library/react";
import AppProviders from "../contexts/AppProviders";
import { useSavingsGoals } from "../contexts/SavingsGoalsContext";
import { useSavingsGoalAssignments } from "../contexts/SavingsGoalAssignmentsContext";
import useEnvelopes from "./useEnvelopes";
import useSavingsGoalEnvelopes from "./useSavingsGoalEnvelopes";
import { currentPeriod } from "../utils";

/**
 * A goal's money can sit in two places at once — assigned out of the budget, or
 * already held in an off-budget account — and this hook is the only thing that
 * knows both. Driven through the real providers with JSON in storage, like every
 * cross-store hook here: the migration that stamps the two holding fields onto a
 * goal saved before they existed is part of what is under test.
 *
 * The month is the current one throughout. What an account holds *now* is the
 * question a goal is read with, and the figures the budget half contributes
 * (`useEnvelopes`' `goalRows`) are already pinned down against a fixed period in
 * `dataModel.test.js`.
 */
const wrapper = ({ children }) => <AppProviders>{children}</AppProviders>;

const PERIOD = currentPeriod();

const account = (overrides) => ({
  type: "asset",
  scope: "on-budget",
  assetClass: "Cash",
  openingBalanceCents: 0,
  openingDate: null,
  reconciledOn: null,
  ...overrides,
});

const CHECKING = account({ id: "acc-cash", name: "Checking", openingBalanceCents: 500000 });
const BROKERAGE = account({
  id: "acc-brk",
  name: "Brokerage",
  scope: "off-budget",
  assetClass: "Stocks",
  openingBalanceCents: 2_000_000,
});
const ISA = account({
  id: "acc-isa",
  name: "Index fund",
  scope: "off-budget",
  assetClass: "Stocks",
  openingBalanceCents: 1_000_000,
});

const goal = (overrides) => ({
  targetCents: 4_000_000,
  targetDate: null,
  accountIds: [],
  accountAmounts: {},
  ...overrides,
});

const HOUSE = goal({ id: "g-house", name: "House deposit" });

function seed(data = {}) {
  const file = {
    accounts: [CHECKING, BROKERAGE, ISA],
    budgets: [],
    // Written explicitly, or seeding a ledger would fire the day-one assignment
    // seed and put figures in the pool this suite is not about.
    assignments: [],
    savingsGoals: [HOUSE],
    savingsGoalAssignments: [],
    ...data,
  };
  for (const [key, value] of Object.entries(file)) {
    localStorage.setItem(key, JSON.stringify(value));
  }
}

/** The hook, the pool it draws on, and the two stores behind it — so a write and
 *  its effect on both can be read in one render tree. */
function setup() {
  const { result } = renderHook(
    () => ({
      rows: useSavingsGoalEnvelopes(PERIOD),
      env: useEnvelopes(PERIOD),
      goals: useSavingsGoals(),
      goalAssignments: useSavingsGoalAssignments(),
    }),
    { wrapper }
  );
  return {
    row: (goalId = HOUSE.id) => result.current.rows.find((row) => row.goalId === goalId),
    env: () => result.current.env,
    stored: (goalId = HOUSE.id) => result.current.goals.goals.find((one) => one.id === goalId),
    update: (fields) => {
      let outcome;
      act(() => {
        outcome = result.current.goals.updateSavingsGoal({ id: HOUSE.id, ...fields });
      });
      return outcome;
    },
    assign: (amountCents, period = PERIOD) => {
      act(() => {
        result.current.goalAssignments.setAssignedAmount({
          goalId: HOUSE.id,
          period,
          amountCents,
        });
      });
    },
  };
}

beforeEach(() => {
  localStorage.clear();
});

test("a goal funded out of the budget alone is saved exactly what it was assigned", () => {
  seed();
  const { row, assign } = setup();

  expect(row()).toMatchObject({ availableCents: 0, heldCents: 0, savedCents: 0, holdings: [] });
  expect(row().remainingCents).toBe(4_000_000);

  assign(120000);

  // The reading this hook has always had, unchanged: `savedCents` is the
  // assignment and the assignment is `availableCents`.
  expect(row()).toMatchObject({ availableCents: 120000, heldCents: 0, savedCents: 120000 });
  expect(row().remainingCents).toBe(3_880_000);
});

describe("money already held off budget", () => {
  test("counts towards the target beside what the budget assigned", () => {
    seed({ savingsGoals: [goal({ ...HOUSE, accountIds: ["acc-brk"] })] });
    const { row, assign } = setup();

    expect(row().heldCents).toBe(2_000_000);
    expect(row().holdings).toEqual([
      { accountId: "acc-brk", name: "Brokerage", countedCents: 2_000_000 },
    ]);

    assign(120000);

    // Two piles, reported apart and summed once: $20,000 invested and $1,200
    // earmarked in the budget is $21,200 towards a $40,000 deposit.
    expect(row()).toMatchObject({
      availableCents: 120000,
      heldCents: 2_000_000,
      savedCents: 2_120_000,
      remainingCents: 1_880_000,
    });
  });

  test("is valued the one way the app values an account", () => {
    seed({
      savingsGoals: [goal({ ...HOUSE, accountIds: ["acc-brk"] })],
      accountBalances: [
        { id: "bal1", accountId: "acc-brk", period: PERIOD, amountCents: 2_400_000 },
      ],
    });
    const { row } = setup();

    // The books say $20,000 from the opening balance; the statement says
    // $24,000, and what the market did is not in any ledger. `useNetWorth` is
    // the only definition of what an account holds, and this reads it rather
    // than deriving a second one.
    expect(row().heldCents).toBe(2_400_000);
  });

  test("several accounts can back one goal, and part of one can be it", () => {
    seed({
      savingsGoals: [
        goal({ ...HOUSE, accountIds: ["acc-brk", "acc-isa"], accountAmounts: { "acc-brk": 750000 } }),
      ],
    });
    const { row } = setup();

    // $7,500 of the brokerage is this goal's, the whole index fund is.
    expect(row().heldCents).toBe(1_750_000);
    expect(row().holdings.map((holding) => holding.countedCents)).toEqual([750000, 1_000_000]);
  });

  test("a part is never more than the account actually holds", () => {
    seed({
      savingsGoals: [
        goal({ ...HOUSE, accountIds: ["acc-isa"], accountAmounts: { "acc-isa": 3_000_000 } }),
      ],
    });
    const { row, stored } = setup();

    // The earmark is kept, so the figure comes back as the account refills —
    // `useEmergencyFund`'s rule for the same question.
    expect(row().heldCents).toBe(1_000_000);
    expect(stored().accountAmounts).toEqual({ "acc-isa": 3_000_000 });
  });

  test("an on-budget account counts nothing, so no dollar is promised twice", () => {
    seed({ savingsGoals: [goal({ ...HOUSE, accountIds: ["acc-cash", "acc-brk"] })] });
    const { row, stored } = setup();

    // Checking is in the pool already, and every claim a goal has on the pool is
    // its assignment. Counting the balance here as well would say the household
    // has money it would then be free to assign to groceries.
    expect(row().heldCents).toBe(2_000_000);
    // Kept rather than refused: an account moved back off budget counts again.
    expect(stored().accountIds).toEqual(["acc-cash", "acc-brk"]);
  });

  test("an account that has since been deleted is inert rather than an error", () => {
    seed({ savingsGoals: [goal({ ...HOUSE, accountIds: ["gone"] })] });
    const { row, stored } = setup();

    expect(stored().accountIds).toEqual(["gone"]);
    expect(row().heldCents).toBe(0);
    expect(row().holdings).toEqual([]);
  });

  test("a goal over its target does not owe money back", () => {
    seed({
      savingsGoals: [goal({ ...HOUSE, targetCents: 1_500_000, accountIds: ["acc-brk"] })],
    });
    const { row } = setup();

    expect(row().remainingCents).toBe(0);
  });
});

/**
 * The claim the whole shape rests on. Off-budget money is on neither side of the
 * envelope identity — it is not in `opening`, and a transfer into it left the
 * budget as spending against a category — so a goal naming a holding may not
 * move the pool by a cent. Fold `heldCents` into `goalRows`' `availableCents`
 * instead and every invested dollar would read as a dollar the budget had
 * assigned and never spent.
 */
describe("what it must not touch", () => {
  test("naming a holding moves neither the pool nor the goal's envelope figure", () => {
    seed();
    const { row, env, update, stored } = setup();

    const poolBefore = env().toBeAssignedCents;
    // $5,000 of checking, and nothing else on budget.
    expect(poolBefore).toBe(500000);

    expect(update({ name: "House deposit", target: "40000", accountIds: ["acc-brk"] }).ok).toBe(
      true
    );

    expect(stored().accountIds).toEqual(["acc-brk"]);
    expect(row().heldCents).toBe(2_000_000);
    // The pool is untouched, and so is the term the identity reads.
    expect(env().toBeAssignedCents).toBe(poolBefore);
    expect(env().goalRows).toEqual([]);
  });

  test("an assignment is still the only thing that comes out of the pool", () => {
    seed({ savingsGoals: [goal({ ...HOUSE, accountIds: ["acc-brk"] })] });
    const { row, env, assign } = setup();

    assign(120000);

    expect(env().toBeAssignedCents).toBe(380000);
    // The identity's goal term: the cumulative assignment and nothing else.
    expect(env().goalRows).toEqual([
      { goalId: HOUSE.id, carriedInCents: 0, assignedCents: 120000, availableCents: 120000 },
    ]);
    expect(row().savedCents).toBe(2_120_000);
  });
});

describe("what is stored", () => {
  test("a goal saved before its money could be held off budget gains both fields empty", () => {
    seed({
      savingsGoals: [{ id: "g-old", name: "Camera", targetCents: 320000, targetDate: null }],
    });
    const { stored, row } = setup();

    expect(stored("g-old")).toEqual({
      id: "g-old",
      name: "Camera",
      targetCents: 320000,
      targetDate: null,
      budgetId: null,
      photo: null,
      envelopeColor: "canopy",
      link: null,
      spending: [],
      archivedOn: null,
      accountIds: [],
      accountAmounts: {},
    });
    expect(row("g-old")).toMatchObject({ heldCents: 0, savedCents: 0 });
  });

  test("unreadable holding fields read as none, and a part has to be a positive figure", () => {
    seed({
      savingsGoals: [
        {
          id: "g-odd",
          name: "Roof",
          targetCents: 1_200_000,
          targetDate: null,
          accountIds: "acc-brk",
          accountAmounts: { "acc-brk": 0, "acc-isa": -5, "acc-cash": 2.5, "acc-x": 700 },
        },
      ],
    });
    const { stored } = setup();

    expect(stored("g-odd").accountIds).toEqual([]);
    expect(stored("g-odd").accountAmounts).toEqual({ "acc-x": 700 });
  });

  test("a patch that says nothing about the holdings leaves them alone", () => {
    seed({
      savingsGoals: [
        goal({ ...HOUSE, accountIds: ["acc-brk"], accountAmounts: { "acc-brk": 750000 } }),
      ],
    });
    const { update, stored } = setup();

    expect(update({ name: "First home", target: "45000" }).ok).toBe(true);

    expect(stored()).toEqual({
      id: HOUSE.id,
      name: "First home",
      targetCents: 4_500_000,
      targetDate: null,
      budgetId: null,
      photo: null,
      envelopeColor: "canopy",
      link: null,
      spending: [],
      archivedOn: null,
      accountIds: ["acc-brk"],
      accountAmounts: { "acc-brk": 750000 },
    });
  });

  test("an edit that does not name the envelope colour keeps the one chosen", () => {
    seed({ savingsGoals: [goal({ ...HOUSE, envelopeColor: "rose" })] });
    const { update, stored } = setup();

    expect(update({ name: "First home", target: "45000" }).ok).toBe(true);
    expect(stored().envelopeColor).toBe("rose");

    expect(update({ name: "First home", target: "45000", envelopeColor: "sky" }).ok).toBe(true);
    expect(stored().envelopeColor).toBe("sky");
  });

  test("a part that is not a positive figure is refused and changes nothing", () => {
    seed({
      savingsGoals: [
        goal({ ...HOUSE, accountIds: ["acc-brk"], accountAmounts: { "acc-brk": 750000 } }),
      ],
    });
    const { update, stored } = setup();

    for (const bad of [{ "acc-brk": 0 }, { "acc-brk": -500 }, { "acc-brk": "lots" }]) {
      const outcome = update({ name: "House deposit", target: "40000", accountAmounts: bad });
      expect(outcome.ok).toBe(false);
    }
    // A refused figure writes nothing at all — not the amounts, not the name
    // beside them, which is what lets the form put every field back.
    expect(stored().accountAmounts).toEqual({ "acc-brk": 750000 });
    expect(stored().name).toBe("House deposit");
  });

  test("a new goal starts with no holdings named, and can name them on the way in", () => {
    seed({ savingsGoals: [] });
    const { result } = renderHook(() => useSavingsGoals(), { wrapper });

    let plain;
    act(() => {
      plain = result.current.addSavingsGoal({ name: "Camera", target: "3200" });
    });
    expect(result.current.goals[0]).toEqual({
      id: plain.id,
      name: "Camera",
      targetCents: 320000,
      targetDate: null,
      budgetId: null,
      photo: null,
      envelopeColor: "canopy",
      link: null,
      spending: [],
      archivedOn: null,
      accountIds: [],
      accountAmounts: {},
    });

    let held;
    act(() => {
      held = result.current.addSavingsGoal({
        name: "House",
        target: "40000",
        accountIds: ["acc-brk"],
        accountAmounts: { "acc-brk": 750000 },
      });
    });
    expect(result.current.goals[1]).toMatchObject({
      accountIds: ["acc-brk"],
      accountAmounts: { "acc-brk": 750000 },
    });
    expect(held.ok).toBe(true);
  });
});
