import React, { useCallback, useContext, useMemo } from "react";
import { v4 as uuidV4 } from "uuid";
import useSyncedState from "../hooks/useSyncedState";
import { LIFE_EVENT_KINDS } from "../netWorthProjection";
import { MAX_AGE, MAX_RATE_BPS, MIN_AGE } from "./RetirementContext";
import { toBps, toCents } from "../utils";

/**
 * Life events: the dated changes to a household's money the net-worth
 * projection walks through — a wedding, childcare, a sabbatical, Social
 * Security. See `.claude/LIFE_EVENTS.md` for the plan this is part of.
 *
 * **A store of guesses holding no money**, the `RetirementContext` rule and for
 * its reason: an event changes what the projection expects, never what the
 * books hold, so nothing here is read by an envelope, a balance or a report.
 * `src/netWorthProjection.js` is the only reader.
 *
 * **Five kinds, and the direction lives in the kind**, never in a sign — the
 * ledger's rule. An expense and an income each carry a one-time figure, a yearly
 * figure, or both, as non-negative magnitudes; an income change carries the
 * share of normal pay that is kept (0 for a sabbatical, 50% for going
 * part-time). Fields a kind does not read are **kept, not cleared**, the
 * switched-away-from rule, so changing a draft's kind and back loses nothing.
 *
 * **Buying and selling a home** carry their own fields: a purchase states a
 * price, a down payment, the mortgage's nominal rate and term, the rent it ends
 * (`rentSavedCents`, a year of it) and reuses `oneTimeCents` for closing costs
 * and `annualCents` for what owning costs a year; a sale names the property
 * (`propertyRef`: an account in the property band, or the id of a purchase
 * event) and, for one already on the books, the mortgage it pays off
 * (`debtRef`), with its costs as a share of the price. **Both references are
 * inert but kept**, the payee-default rule — the projection skips a sale whose
 * property it cannot find, rather than this store reaching into the accounts.
 *
 * **`years` rather than an end age**: "childcare for five years" is how the
 * question is answered, and an end age would leave whether the last year is
 * included to whoever read it. `null` is "for the rest of the plan" — Social
 * Security does not stop.
 *
 * **`enabled` leaves an event out without deleting it**, which is what makes
 * "with kids" against "without" a click rather than a re-entry, and what saved
 * scenarios will be built on.
 *
 * Every figure is in **today's dollars**, like the rest of the page. Nothing
 * here references another store's record, so nothing cascades in either
 * direction and this provider's position is free. An event copied from a
 * savings goal is copied once — name, target and date — and states its own
 * figures from then on, the rule a category's bucket keeps against its group.
 */
const LifeEventsContext = React.createContext();

export { LIFE_EVENT_KINDS };

const KIND_VALUES = Object.values(LIFE_EVENT_KINDS);

// Keeping more than twice normal pay is not a plan, it is a typo; a raise is
// what the salaries are for.
export const MAX_KEPT_SHARE_BPS = 20000;

export function useLifeEvents() {
  return useContext(LifeEventsContext);
}

const isAge = (value) => Number.isInteger(value) && value >= MIN_AGE && value <= MAX_AGE;
const isAmount = (value) => value === null || (Number.isInteger(value) && value >= 0);
const isYears = (value) => value === null || (Number.isInteger(value) && value >= 1 && value <= MAX_AGE);
const isShare = (value) => Number.isInteger(value) && value >= 0 && value <= MAX_KEPT_SHARE_BPS;
const isRate = (value) => Number.isInteger(value) && value >= 0 && value <= MAX_RATE_BPS;
const isTerm = (value) => Number.isInteger(value) && value >= 1 && value <= 50;
const isRef = (value) => value === null || typeof value === "string";
const isBlank = (value) => value === null || value === undefined || String(value).trim() === "";

/** Field-presence on every field, so a record from an older build keeps
 *  whatever it has and gains defaults for the rest. */
function migrateEvents(stored) {
  if (!Array.isArray(stored)) return [];
  return stored
    .filter(
      (event) =>
        event &&
        typeof event.id === "string" &&
        KIND_VALUES.includes(event.kind) &&
        isAge(event.startAge)
    )
    .map((event) => ({
      id: event.id,
      name: typeof event.name === "string" && event.name.trim() ? event.name : "Untitled event",
      kind: event.kind,
      startAge: event.startAge,
      years: "years" in event && isYears(event.years) ? event.years : null,
      oneTimeCents: "oneTimeCents" in event && isAmount(event.oneTimeCents) ? event.oneTimeCents : null,
      annualCents: "annualCents" in event && isAmount(event.annualCents) ? event.annualCents : null,
      keptShareBps: "keptShareBps" in event && isShare(event.keptShareBps) ? event.keptShareBps : 0,
      priceCents: "priceCents" in event && isAmount(event.priceCents) ? event.priceCents : null,
      downPaymentCents:
        "downPaymentCents" in event && isAmount(event.downPaymentCents) ? event.downPaymentCents : null,
      rateBps: "rateBps" in event && isRate(event.rateBps) ? event.rateBps : 0,
      termYears: "termYears" in event && isTerm(event.termYears) ? event.termYears : 30,
      rentSavedCents:
        "rentSavedCents" in event && isAmount(event.rentSavedCents) ? event.rentSavedCents : null,
      sellingCostBps: "sellingCostBps" in event && isRate(event.sellingCostBps) ? event.sellingCostBps : 0,
      propertyRef: "propertyRef" in event && isRef(event.propertyRef) ? event.propertyRef : null,
      debtRef: "debtRef" in event && isRef(event.debtRef) ? event.debtRef : null,
      enabled: event.enabled !== false,
    }));
}

/**
 * Read a whole event from what a form sent. Strings for the figures, as every
 * form here sends them; the kind decides which of them are required, and the
 * rest are read if present and kept as they are.
 */
function readEvent({
  name,
  kind,
  startAge,
  years,
  oneTime,
  annual,
  keptShare,
  price,
  downPayment,
  rate,
  termYears,
  rentSaved,
  sellingCost,
  propertyRef,
  debtRef,
}) {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) return { error: "Give the event a name." };
  if (!KIND_VALUES.includes(kind)) return { error: "Choose what kind of event this is." };

  if (isBlank(startAge) || !isAge(Number(startAge))) {
    return { error: `Enter the age it starts as a whole number, ${MIN_AGE} to ${MAX_AGE}.` };
  }
  const yearsValue = isBlank(years) ? null : Number(years);
  if (!isYears(yearsValue)) return { error: "Enter how many years it lasts, or leave it blank for the rest of the plan." };

  const money = (value, label) => {
    if (isBlank(value)) return { cents: null };
    const cents = toCents(value);
    if (cents == null || cents < 0) return { error: `Enter ${label} as an amount of zero or more.` };
    return { cents };
  };
  const oneTimeRead = money(oneTime, "the one-time amount");
  if (oneTimeRead.error) return oneTimeRead;
  const annualRead = money(annual, "the yearly amount");
  if (annualRead.error) return annualRead;

  let keptShareBps = 0;
  if (!isBlank(keptShare)) {
    keptShareBps = toBps(keptShare);
    if (keptShareBps == null || !isShare(keptShareBps)) {
      return { error: `Enter the share of pay kept as a percentage, 0 to ${MAX_KEPT_SHARE_BPS / 100}.` };
    }
  } else if (kind === LIFE_EVENT_KINDS.INCOME_CHANGE) {
    return { error: "Enter how much of your normal pay you keep — 0 for a year off." };
  }

  const flowKind = kind === LIFE_EVENT_KINDS.EXPENSE || kind === LIFE_EVENT_KINDS.INCOME;
  if (flowKind && !oneTimeRead.cents && !annualRead.cents) {
    return { error: "Enter a one-time amount, a yearly amount, or both." };
  }

  const percent = (value, label) => {
    if (isBlank(value)) return { bps: 0 };
    const bps = toBps(value);
    if (bps == null || !isRate(bps)) {
      return { error: `Enter ${label} as a percentage between 0 and ${MAX_RATE_BPS / 100}.` };
    }
    return { bps };
  };

  const priceRead = money(price, "the price");
  if (priceRead.error) return priceRead;
  const downRead = money(downPayment, "the down payment");
  if (downRead.error) return downRead;
  const rentRead = money(rentSaved, "the rent it replaces");
  if (rentRead.error) return rentRead;
  const rateRead = percent(rate, "the mortgage rate");
  if (rateRead.error) return rateRead;
  const sellingRead = percent(sellingCost, "the cost of selling");
  if (sellingRead.error) return sellingRead;
  const term = isBlank(termYears) ? 30 : Number(termYears);
  if (!isTerm(term)) return { error: "Enter the mortgage term as a whole number of years, 1 to 50." };

  if (kind === LIFE_EVENT_KINDS.BUY_PROPERTY) {
    if (!priceRead.cents) return { error: "Enter what the home costs." };
    if ((downRead.cents ?? 0) > priceRead.cents) {
      return { error: "The down payment cannot be more than the price." };
    }
  }
  if (kind === LIFE_EVENT_KINDS.SELL_PROPERTY && isBlank(propertyRef)) {
    return { error: "Choose which property is sold." };
  }

  return {
    event: {
      name: trimmed,
      kind,
      startAge: Number(startAge),
      years: yearsValue,
      oneTimeCents: oneTimeRead.cents,
      annualCents: annualRead.cents,
      keptShareBps,
      priceCents: priceRead.cents,
      downPaymentCents: downRead.cents,
      rateBps: rateRead.bps,
      termYears: term,
      rentSavedCents: rentRead.cents,
      sellingCostBps: sellingRead.bps,
      propertyRef: isBlank(propertyRef) ? null : propertyRef,
      debtRef: isBlank(debtRef) ? null : debtRef,
    },
  };
}

export const LifeEventsProvider = ({ children }) => {
  const [events, setEvents] = useSyncedState("lifeEvents", [], migrateEvents);

  const addLifeEvent = useCallback(
    (fields) => {
      const read = readEvent(fields);
      if (read.error) return { ok: false, error: read.error };
      const id = uuidV4();
      setEvents((previous) => [...previous, { id, ...read.event, enabled: true }]);
      return { ok: true, id };
    },
    [setEvents]
  );

  /** Restate an event whole — the modal sends every field it shows. */
  const updateLifeEvent = useCallback(
    ({ id, ...fields }) => {
      // Refused rather than reported as landed: an event deleted on another
      // device can still be open in the modal here.
      if (!events.some((event) => event.id === id)) {
        return { ok: false, error: "That event is no longer in the plan." };
      }
      const read = readEvent(fields);
      if (read.error) return { ok: false, error: read.error };
      setEvents((previous) =>
        previous.map((event) => (event.id === id ? { ...event, ...read.event } : event))
      );
      return { ok: true };
    },
    [events, setEvents]
  );

  const setLifeEventEnabled = useCallback(
    ({ id, enabled }) => {
      setEvents((previous) =>
        previous.map((event) => (event.id === id ? { ...event, enabled: Boolean(enabled) } : event))
      );
      return { ok: true };
    },
    [setEvents]
  );

  /** Switch on exactly these events and off every other — a scenario used. */
  const setEnabledEvents = useCallback(
    (ids) => {
      const on = new Set(ids);
      setEvents((previous) => previous.map((event) => ({ ...event, enabled: on.has(event.id) })));
      return { ok: true };
    },
    [setEvents]
  );

  const deleteLifeEvent = useCallback(
    (id) => {
      setEvents((previous) => previous.filter((event) => event.id !== id));
      return { ok: true };
    },
    [setEvents]
  );

  const value = useMemo(
    () => ({
      events,
      addLifeEvent,
      updateLifeEvent,
      setLifeEventEnabled,
      setEnabledEvents,
      deleteLifeEvent,
    }),
    [events, addLifeEvent, updateLifeEvent, setLifeEventEnabled, setEnabledEvents, deleteLifeEvent]
  );

  return <LifeEventsContext.Provider value={value}>{children}</LifeEventsContext.Provider>;
};
