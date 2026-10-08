import { act, renderHook } from "@testing-library/react";
import AppProviders from "../contexts/AppProviders";
import { useEmergencyFundPlan } from "../contexts/EmergencyFundContext";
import useEmergencyFund from "./useEmergencyFund";
import { currentPeriod, fromBps } from "../utils";

/**
 * The fund joins the plan's essentials estimates to what the ticked accounts are
 * worth, so these drive it through the real providers with JSON in storage — the
 * way every cross-store hook here is tested, and for the same reason: the
 * migration and the provider order are part of what is under test.
 *
 * The month is the current one throughout, and has to be: what an account holds
 * *today* is the whole question an emergency fund asks, so there is nothing a
 * fixed period could stand in for.
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

const SAVINGS = account({ id: "acc-save", name: "Savings", openingBalanceCents: 900000 });
const EVERYDAY = account({ id: "acc-cash", name: "Everyday", openingBalanceCents: 100000 });

const budget = (id, name, plannedCents, bucket) => ({
  id,
  name,
  groupId: null,
  plannedCents,
  goalCents: null,
  bucket,
});

// $1,500 of rent and $400 of groceries is a necessary month; the evening out and
// the Roth are not, which is the whole point of deriving the figure from the
// bucket rather than from the plan's total.
const BUDGETS = [
  budget("b1", "Rent", 150000, "essentials"),
  budget("b2", "Groceries", 40000, "essentials"),
  budget("b3", "Dining", 30000, "fun"),
  budget("b4", "Roth", 50000, "retirement"),
];

function seed(data = {}) {
  const file = { accounts: [SAVINGS, EVERYDAY], budgets: BUDGETS, assignments: [], ...data };
  for (const [key, value] of Object.entries(file)) {
    localStorage.setItem(key, JSON.stringify(value));
  }
}

/** The hook and the store it reads, together, so a mutation and its effect can be
 *  asserted in one render tree. */
function setup() {
  const { result } = renderHook(
    () => ({ fund: useEmergencyFund(), store: useEmergencyFundPlan() }),
    { wrapper }
  );
  return {
    read: () => result.current.fund,
    change: (changes) => {
      let outcome;
      act(() => {
        outcome = result.current.store.setEmergencyFund(changes);
      });
      return outcome;
    },
    toggle: (accountId, included) => {
      act(() => {
        result.current.store.toggleFundAccount({ accountId, included });
      });
    },
    portion: (accountId, amount) => {
      let outcome;
      act(() => {
        outcome = result.current.store.setFundAccountAmount({ accountId, amount });
      });
      return outcome;
    },
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe("the target", () => {
  test("is a multiple of the essentials estimates and nothing else in the plan", () => {
    seed();
    const { read } = setup();

    // $1,900 a month of essentials, six months by default. The $300 of fun and
    // the $500 of retirement are not bills that still have to be paid when the
    // income stops.
    expect(read().monthlyEssentialsCents).toBe(190000);
    expect(read().essentialsCount).toBe(2);
    expect(read().fund.monthsCovered).toBe(6);
    expect(read().derivedTargetCents).toBe(1140000);
    expect(read().targetCents).toBe(1140000);
  });

  test("follows the months asked for", () => {
    seed();
    const { read, change } = setup();

    expect(change({ monthsCovered: "3" }).ok).toBe(true);
    expect(read().targetCents).toBe(570000);
  });

  test("a category with no estimate is a plan nobody has written, not a fund of nothing", () => {
    seed({ budgets: [budget("b1", "Rent", 0, "essentials")] });
    const { read } = setup();

    // The page says so in words rather than drawing a target of zero as met.
    expect(read().hasEssentials).toBe(false);
    expect(read().targetCents).toBe(0);
    expect(read().fundedBps).toBe(null);
    expect(read().monthsHeldBps).toBe(null);
  });

  test("a typed figure takes over, and the derived one is kept to switch back to", () => {
    seed();
    const { read, change } = setup();

    expect(change({ targetSource: "amount", targetCents: "$25,000" }).ok).toBe(true);
    expect(read().targetCents).toBe(2500000);
    // Still reported, because the panel shows the answer not in force beside the
    // one that is — which is the only reason keeping it is worth anything.
    expect(read().derivedTargetCents).toBe(1140000);

    change({ targetSource: "months" });
    expect(read().targetCents).toBe(1140000);
    expect(read().typedTargetCents).toBe(2500000);
  });

  test("choosing to type a figure and typing none is a target of zero, not a silent fall back", () => {
    seed();
    const { read, change } = setup();

    change({ targetSource: "amount" });

    // Falling back to the derivation here would hide that the field is empty,
    // and the household has just said they want to state the figure themselves.
    expect(read().targetCents).toBe(0);
    expect(read().typedTargetCents).toBe(null);
  });

  test("blank takes the typed figure off; zero and junk are refused", () => {
    seed();
    const { read, change } = setup();

    change({ targetSource: "amount", targetCents: "25000" });
    expect(change({ targetCents: "" }).ok).toBe(true);
    expect(read().typedTargetCents).toBe(null);

    change({ targetCents: "25000" });
    expect(change({ targetCents: "0" }).ok).toBe(false);
    expect(change({ targetCents: "soon" }).ok).toBe(false);
    // A refused figure changes nothing, so the panel can put the field back.
    expect(read().typedTargetCents).toBe(2500000);
  });

  test("a months count has to be a whole number of months inside the ceiling", () => {
    seed();
    const { read, change } = setup();

    for (const bad of ["0", "-3", "2.5", "many", "", "121"]) {
      expect(change({ monthsCovered: bad }).ok).toBe(false);
    }
    expect(read().fund.monthsCovered).toBe(6);
    expect(change({ monthsCovered: "120" }).ok).toBe(true);
  });
});

describe("what is held", () => {
  test("is the ticked accounts at the net-worth figures, and nothing else", () => {
    seed();
    const { read, toggle } = setup();

    // Nothing ticked is nothing held: which account is the buffer is a judgement,
    // and guessing it would put a figure on screen nobody agreed to.
    expect(read().heldCents).toBe(0);
    expect(read().accountRows).toHaveLength(2);

    toggle("acc-save", true);

    expect(read().heldCents).toBe(900000);
    expect(read().remainingCents).toBe(240000);
    expect(Math.round(fromBps(read().fundedBps) * 100)).toBe(79);
    // The reading a household actually asks for: four and three quarter months of
    // a necessary month's $1,900.
    expect(fromBps(read().monthsHeldBps)).toBeCloseTo(4.74, 2);

    toggle("acc-save", false);
    expect(read().heldCents).toBe(0);
  });

  test("counts a hand-entered statement over the ledger's own arithmetic", () => {
    seed({
      accountBalances: [
        { id: "bal1", accountId: "acc-save", period: PERIOD, amountCents: 1200000 },
      ],
    });
    const { read, toggle } = setup();
    toggle("acc-save", true);

    // The books say $9,000 from the opening balance; the statement says $12,000.
    // `useNetWorth` is the only definition of what an account holds, and this
    // reads it rather than deriving a second one.
    expect(read().heldCents).toBe(1200000);
  });

  test("a fund over its target does not owe money back", () => {
    seed({ accounts: [account({ id: "acc-save", name: "Savings", openingBalanceCents: 2000000 })] });
    const { read, toggle } = setup();
    toggle("acc-save", true);

    expect(read().remainingCents).toBe(0);
    expect(fromBps(read().fundedBps)).toBeCloseTo(1.754, 3);
  });

  test("part of an account can be the fund, never more than the account holds", () => {
    seed();
    const { read, toggle, portion } = setup();
    toggle("acc-save", true);

    // Most households keep the buffer inside an ordinary savings account, so a
    // stated part is what counts — and blank goes back to the whole balance.
    expect(portion("acc-save", "$5,000")).toEqual({ ok: true });
    expect(read().heldCents).toBe(500000);
    expect(read().accountRows.find((row) => row.account.id === "acc-save")).toMatchObject({
      valueCents: 900000,
      portionCents: 500000,
      countedCents: 500000,
    });

    // An earmark larger than the balance counts what is actually there.
    portion("acc-save", "12000");
    expect(read().heldCents).toBe(900000);

    // Unticking keeps the earmark; it simply counts towards nothing.
    toggle("acc-save", false);
    expect(read().heldCents).toBe(0);
    expect(read().fund.accountAmounts).toEqual({ "acc-save": 1200000 });

    toggle("acc-save", true);
    portion("acc-save", "");
    expect(read().heldCents).toBe(900000);
    expect(read().fund.accountAmounts).toEqual({});
  });

  test("a part that is not a positive figure is refused and changes nothing", () => {
    seed({ emergencyFund: { accountIds: ["acc-save"], accountAmounts: { "acc-save": 300000 } } });
    const { read, portion } = setup();

    expect(portion("acc-save", "lots").ok).toBe(false);
    expect(portion("acc-save", "0").ok).toBe(false);
    expect(portion("acc-save", "-50").ok).toBe(false);
    expect(read().heldCents).toBe(300000);
  });

  test("only on-budget accounts are offered or counted", () => {
    const BROKERAGE = account({
      id: "acc-brk",
      name: "Brokerage",
      scope: "off-budget",
      assetClass: "Stocks",
      openingBalanceCents: 2000000,
    });
    const CARD = account({ id: "acc-card", name: "Card", type: "liability", scope: "credit-card" });
    seed({
      accounts: [SAVINGS, EVERYDAY, BROKERAGE, CARD],
      emergencyFund: { targetSource: "months", monthsCovered: 6, accountIds: ["acc-save", "acc-brk"] },
    });
    const { read } = setup();

    expect(read().accountRows.map((row) => row.account.id)).toEqual(["acc-save", "acc-cash"]);
    // The brokerage ticked before stays in the record but counts nothing.
    expect(read().fund.accountIds).toEqual(["acc-save", "acc-brk"]);
    expect(read().heldCents).toBe(900000);
  });

  test("an account that has since been deleted is inert rather than an error", () => {
    seed({ emergencyFund: { targetSource: "months", monthsCovered: 6, accountIds: ["gone"] } });
    const { read } = setup();

    // The id is kept — this store never checks another — and reads as an account
    // contributing nothing, the rule a payee's default category follows.
    expect(read().fund.accountIds).toEqual(["gone"]);
    expect(read().heldCents).toBe(0);
  });
});

describe("what is stored", () => {
  test("an unreadable record reads as not set up yet", () => {
    seed({ emergencyFund: { monthsCovered: "six", targetSource: "vibes", accountIds: "acc-save" } });
    const { read } = setup();

    expect(read().fund).toEqual({
      targetSource: "months",
      monthsCovered: 6,
      targetCents: null,
      accountIds: [],
      accountAmounts: {},
    });
  });

  test("a patch leaves every field it does not name alone", () => {
    seed();
    const { read, change } = setup();

    change({ targetSource: "amount", targetCents: "25000", monthsCovered: "3" });
    change({ monthsCovered: "9" });

    expect(read().fund).toEqual({
      targetSource: "amount",
      monthsCovered: 9,
      targetCents: 2500000,
      accountIds: [],
      accountAmounts: {},
    });
  });
});
