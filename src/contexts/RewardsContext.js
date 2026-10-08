import React, { useCallback, useContext, useMemo } from "react";
import { v4 as uuidV4 } from "uuid";
import useSyncedState from "../hooks/useSyncedState";
import { isValidISODate, toBps, toCents } from "../utils";
import { OFFER_KINDS, programById, toPoints, toValuePer100Cents } from "../rewards";

/**
 * Credit card rewards: the points and miles the household holds, what they say
 * each is worth, and the trips they mean to spend them on.
 *
 * **A store of its own, outside the books, holding no money.** A point is not a
 * dollar until it is redeemed, and what it is worth is a judgement, so nothing
 * here reaches an envelope, a balance, a report or net worth — the same split
 * `RetirementContext` keeps as a store of guesses. Three keys:
 *
 *   - `rewardsBalances` — `{ id, programId, holder, points, asOf }`, one per
 *     program per person, since two cardholders in one household each have an
 *     account with the same airline. `holder` is optional free text.
 *   - `rewardsValuations` — `{ [programId]: valuePer100Cents }`, the household's
 *     own figure where it disagrees with the catalog. Absent is the catalog's
 *     figure, so a blank field puts it back rather than storing a copy that
 *     would stop following the catalog.
 *   - `rewardsTrips` — `{ id, name, date, programId, points, taxesCents,
 *     cashPriceCents }`, a redemption being planned: what it costs in points and
 *     cash, and what the same trip would cost paid outright.
 *   - `rewardsOffers` — `{ id, name, kind, accountId, startDate, endDate,
 *     limitCents, allSpending, budgetIds, payeeIds, rateBps, bonusPoints,
 *     programId }`, a card offer being tracked: a capped bonus or a spending
 *     target (`OFFER_KINDS`), on one card, over a window, mapped onto the
 *     household's own categories and payees. **It holds no money either** — it
 *     is a question asked of the ledger, and `useCardOffers` is what answers it.
 *     Its references to an account, categories and payees are **inert but
 *     kept**, the payee-default rule: this store reads no other, so a deleted
 *     category simply stops matching anything. The fields one kind does not
 *     read (a rate on a target, a bonus on a cap) are kept, not cleared, and so
 *     are the lists while `allSpending` is on — switching back is the point.
 *
 * **Programs come from the built-in catalog (`src/rewards.js`) and a record
 * naming an id it does not know is dropped on the way in** — unlike the inert-
 * but-kept references elsewhere, there is no other store a program could have
 * been deleted from; an unknown id is a catalog entry a newer build removed, and
 * nothing on the page could show it.
 *
 * Nothing cascades into or out of this store, so its position in the provider
 * order is free.
 */
const RewardsContext = React.createContext();

export function useRewards() {
  return useContext(RewardsContext);
}

const isPoints = (value) => Number.isInteger(value) && value >= 0;
const isMoney = (value) => Number.isInteger(value) && value >= 0;
const known = (programId) => programById(programId) != null;
const cleanText = (value) => (typeof value === "string" ? value.trim() : "");

function migrateBalances(stored) {
  if (!Array.isArray(stored)) return [];
  return stored
    .filter((balance) => balance && known(balance.programId) && isPoints(balance.points))
    .map((balance) => ({
      id: typeof balance.id === "string" ? balance.id : uuidV4(),
      programId: balance.programId,
      holder: cleanText(balance.holder) || null,
      points: balance.points,
      asOf: isValidISODate(balance.asOf) ? balance.asOf : null,
    }));
}

function migrateValuations(stored) {
  const valuations = {};
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return valuations;
  for (const [programId, value] of Object.entries(stored)) {
    if (known(programId) && Number.isInteger(value) && value >= 0) valuations[programId] = value;
  }
  return valuations;
}

function migrateTrips(stored) {
  if (!Array.isArray(stored)) return [];
  return stored
    .filter((trip) => trip && known(trip.programId) && isPoints(trip.points) && trip.points > 0)
    .map((trip) => ({
      id: typeof trip.id === "string" ? trip.id : uuidV4(),
      name: cleanText(trip.name) || "Untitled trip",
      date: isValidISODate(trip.date) ? trip.date : null,
      programId: trip.programId,
      points: trip.points,
      taxesCents: isMoney(trip.taxesCents) ? trip.taxesCents : 0,
      cashPriceCents: isMoney(trip.cashPriceCents) ? trip.cashPriceCents : null,
    }));
}

const isBlank = (value) => value == null || String(value).trim() === "";

const idList = (value) =>
  Array.isArray(value) ? [...new Set(value.filter((id) => typeof id === "string" && id))] : [];

function migrateOffers(stored) {
  if (!Array.isArray(stored)) return [];
  return stored
    .filter(
      (offer) =>
        offer &&
        Object.values(OFFER_KINDS).includes(offer.kind) &&
        isValidISODate(offer.startDate) &&
        Number.isInteger(offer.limitCents) &&
        offer.limitCents > 0
    )
    .map((offer) => ({
      id: typeof offer.id === "string" ? offer.id : uuidV4(),
      name: cleanText(offer.name) || "Untitled offer",
      kind: offer.kind,
      accountId: typeof offer.accountId === "string" ? offer.accountId : null,
      startDate: offer.startDate,
      endDate: isValidISODate(offer.endDate) ? offer.endDate : null,
      limitCents: offer.limitCents,
      allSpending: offer.allSpending === true,
      budgetIds: idList(offer.budgetIds),
      payeeIds: idList(offer.payeeIds),
      rateBps: Number.isInteger(offer.rateBps) && offer.rateBps >= 0 ? offer.rateBps : null,
      bonusPoints: isPoints(offer.bonusPoints) ? offer.bonusPoints : null,
      programId: known(offer.programId) ? offer.programId : null,
    }));
}

/** A money field that may be blank, as cents or a refusal. */
function readMoney(value, { blank, label }) {
  if (isBlank(value)) return { ok: true, cents: blank };
  const cents = typeof value === "number" ? value : toCents(value);
  if (!isMoney(cents)) return { ok: false, error: `Enter ${label} as an amount of zero or more.` };
  return { ok: true, cents };
}

function parseBalance({ programId, holder, points, asOf }) {
  if (!known(programId)) return { ok: false, error: "Choose a program from the list." };
  const parsed = toPoints(points);
  if (parsed == null) return { ok: false, error: "Enter the balance as a whole number of points." };
  const date = asOf || null;
  if (date !== null && !isValidISODate(date)) {
    return { ok: false, error: "Enter a valid date, or leave it blank." };
  }
  return { ok: true, record: { programId, holder: cleanText(holder) || null, points: parsed, asOf: date } };
}

function parseTrip({ name, date, programId, points, taxes, cashPrice }) {
  const trimmed = cleanText(name);
  if (!trimmed) return { ok: false, error: "Give the trip a name." };
  if (!known(programId)) return { ok: false, error: "Choose which program the trip is booked with." };
  const parsedPoints = toPoints(points);
  if (!parsedPoints) return { ok: false, error: "Enter how many points the trip costs." };
  const when = date || null;
  if (when !== null && !isValidISODate(when)) {
    return { ok: false, error: "Enter a valid date, or leave it blank." };
  }
  const taxesRead = readMoney(taxes, { blank: 0, label: "the taxes and fees" });
  if (!taxesRead.ok) return taxesRead;
  const cashRead = readMoney(cashPrice, { blank: null, label: "the cash price" });
  if (!cashRead.ok) return cashRead;
  return {
    ok: true,
    record: {
      name: trimmed,
      date: when,
      programId,
      points: parsedPoints,
      taxesCents: taxesRead.cents,
      cashPriceCents: cashRead.cents,
    },
  };
}

/**
 * A whole offer, as the form hands it over: money and rates as typed strings,
 * read here so the page and the store cannot disagree about what "$1,000" or
 * "9%" means.
 */
function parseOffer(fields) {
  const name = cleanText(fields.name);
  if (!name) return { ok: false, error: "Give the offer a name." };
  if (!Object.values(OFFER_KINDS).includes(fields.kind)) {
    return { ok: false, error: "Choose what kind of offer this is." };
  }
  if (typeof fields.accountId !== "string" || !fields.accountId) {
    return { ok: false, error: "Choose the card the offer is on." };
  }
  if (!isValidISODate(fields.startDate)) return { ok: false, error: "Enter the day the offer starts." };
  const endDate = fields.endDate || null;
  if (endDate !== null && !isValidISODate(endDate)) {
    return { ok: false, error: "Enter a valid end date, or leave it blank." };
  }
  if (endDate !== null && endDate < fields.startDate) {
    return { ok: false, error: "The offer has to end on or after the day it starts." };
  }
  if (fields.kind === OFFER_KINDS.TARGET && endDate === null) {
    return { ok: false, error: "A spending target needs the date it has to be met by." };
  }

  const limitCents = typeof fields.limit === "number" ? fields.limit : toCents(fields.limit);
  if (!Number.isInteger(limitCents) || limitCents <= 0) {
    return {
      ok: false,
      error:
        fields.kind === OFFER_KINDS.CAP
          ? "Enter the most spending the bonus applies to, as an amount above zero."
          : "Enter how much has to be spent, as an amount above zero.",
    };
  }

  const allSpending = fields.allSpending === true;
  const budgetIds = idList(fields.budgetIds);
  const payeeIds = idList(fields.payeeIds);
  if (!allSpending && budgetIds.length === 0 && payeeIds.length === 0) {
    return {
      ok: false,
      error: "Choose at least one category or payee the offer applies to, or count all spending.",
    };
  }

  let rateBps = null;
  if (!isBlank(fields.rate)) {
    rateBps = typeof fields.rate === "number" ? fields.rate : toBps(fields.rate);
    if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > 10000) {
      return { ok: false, error: "Enter the bonus rate as a percentage, like 5%, or leave it blank." };
    }
  }

  let bonusPoints = null;
  if (!isBlank(fields.bonusPoints)) {
    bonusPoints = toPoints(fields.bonusPoints);
    if (bonusPoints == null) {
      return { ok: false, error: "Enter the bonus as a whole number of points, or leave it blank." };
    }
  }
  const programId = fields.programId || null;
  if (programId !== null && !known(programId)) {
    return { ok: false, error: "Choose a program from the list, or leave it blank." };
  }

  return {
    ok: true,
    record: {
      name,
      kind: fields.kind,
      accountId: fields.accountId,
      startDate: fields.startDate,
      endDate,
      limitCents,
      allSpending,
      budgetIds,
      payeeIds,
      rateBps,
      bonusPoints,
      programId,
    },
  };
}

export const RewardsProvider = ({ children }) => {
  const [balances, setBalances] = useSyncedState("rewardsBalances", [], migrateBalances);
  const [valuations, setValuations] = useSyncedState("rewardsValuations", {}, migrateValuations);
  const [trips, setTrips] = useSyncedState("rewardsTrips", [], migrateTrips);
  const [offers, setOffers] = useSyncedState("rewardsOffers", [], migrateOffers);

  const addBalance = useCallback(
    (fields) => {
      const parsed = parseBalance(fields);
      if (!parsed.ok) return parsed;
      const id = uuidV4();
      setBalances((previous) => [...previous, { id, ...parsed.record }]);
      return { ok: true, id };
    },
    [setBalances]
  );

  /** A patch: only the named fields are checked, so the points cell can commit alone. */
  const updateBalance = useCallback(
    ({ id, ...patch }) => {
      const existing = balances.find((balance) => balance.id === id);
      if (!existing) return { ok: false, error: "That balance no longer exists." };
      const parsed = parseBalance({ ...existing, ...patch });
      if (!parsed.ok) return parsed;
      setBalances((previous) =>
        previous.map((balance) => (balance.id === id ? { id, ...parsed.record } : balance))
      );
      return { ok: true };
    },
    [balances, setBalances]
  );

  const deleteBalance = useCallback(
    ({ id }) => setBalances((previous) => previous.filter((balance) => balance.id !== id)),
    [setBalances]
  );

  /** The household's own figure for a program. Blank goes back to the catalog's. */
  const setValuation = useCallback(
    ({ programId, value }) => {
      if (!known(programId)) return { ok: false, error: "That program is not in the catalog." };
      if (isBlank(value)) {
        setValuations((previous) => {
          const { [programId]: _dropped, ...rest } = previous;
          return rest;
        });
        return { ok: true };
      }
      const parsed = typeof value === "number" ? value : toValuePer100Cents(value);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10000) {
        return {
          ok: false,
          error: "Enter a value in cents per point, like 1.4, or leave it blank for the catalog's.",
        };
      }
      setValuations((previous) => ({ ...previous, [programId]: parsed }));
      return { ok: true };
    },
    [setValuations]
  );

  const addTrip = useCallback(
    (fields) => {
      const parsed = parseTrip(fields);
      if (!parsed.ok) return parsed;
      const id = uuidV4();
      setTrips((previous) => [...previous, { id, ...parsed.record }]);
      return { ok: true, id };
    },
    [setTrips]
  );

  const updateTrip = useCallback(
    ({ id, ...fields }) => {
      if (!trips.some((trip) => trip.id === id)) {
        return { ok: false, error: "That trip no longer exists." };
      }
      const parsed = parseTrip(fields);
      if (!parsed.ok) return parsed;
      setTrips((previous) => previous.map((trip) => (trip.id === id ? { id, ...parsed.record } : trip)));
      return { ok: true };
    },
    [trips, setTrips]
  );

  const deleteTrip = useCallback(
    ({ id }) => setTrips((previous) => previous.filter((trip) => trip.id !== id)),
    [setTrips]
  );

  const addOffer = useCallback(
    (fields) => {
      const parsed = parseOffer(fields);
      if (!parsed.ok) return parsed;
      const id = uuidV4();
      setOffers((previous) => [...previous, { id, ...parsed.record }]);
      return { ok: true, id };
    },
    [setOffers]
  );

  /** A whole offer, like `updateTrip`: the form states every field every time. */
  const updateOffer = useCallback(
    ({ id, ...fields }) => {
      if (!offers.some((offer) => offer.id === id)) {
        return { ok: false, error: "That offer no longer exists." };
      }
      const parsed = parseOffer(fields);
      if (!parsed.ok) return parsed;
      setOffers((previous) => previous.map((offer) => (offer.id === id ? { id, ...parsed.record } : offer)));
      return { ok: true };
    },
    [offers, setOffers]
  );

  const deleteOffer = useCallback(
    ({ id }) => setOffers((previous) => previous.filter((offer) => offer.id !== id)),
    [setOffers]
  );

  const value = useMemo(
    () => ({
      balances,
      valuations,
      trips,
      offers,
      addBalance,
      updateBalance,
      deleteBalance,
      setValuation,
      addTrip,
      updateTrip,
      deleteTrip,
      addOffer,
      updateOffer,
      deleteOffer,
    }),
    [
      balances,
      valuations,
      trips,
      offers,
      addBalance,
      updateBalance,
      deleteBalance,
      setValuation,
      addTrip,
      updateTrip,
      deleteTrip,
      addOffer,
      updateOffer,
      deleteOffer,
    ]
  );

  return <RewardsContext.Provider value={value}>{children}</RewardsContext.Provider>;
};
