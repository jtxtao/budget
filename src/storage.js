/**
 * Where a store's value sits in this browser, and under whose name.
 *
 * Every store in the app used to write a bare key — `localStorage.budgets`,
 * `localStorage.transactions`. That was correct while the app was one person's
 * books in one browser. With accounts it is not: two people signing into the
 * same browser would read each other's books, and signing out would leave the
 * previous household's ledger sitting in the next one's app.
 *
 * So a key is **namespaced by the signed-in user**, and this module owns that
 * mapping. It is the only place that knows the shape of a storage key.
 *
 * ---
 *
 * **The unscoped case is not a degenerate one — it is the app's other supported
 * mode**, and it is why `scopedKey` returns the bare key when no user is set:
 *
 *   - A build with no Supabase credentials (`isSupabaseConfigured` false) runs
 *     signed out against bare keys, exactly as the app always did.
 *   - The test suite seeds bare keys and renders `AppProviders` with no auth
 *     above it, so every existing test exercises the stores unchanged.
 *   - The books this browser already holds — written before accounts existed —
 *     *are* the unscoped documents, which is what makes the first-sign-in
 *     import a copy rather than an archaeology dig.
 *
 * ---
 *
 * **Who the source of truth is depends on the mode, and there are three.**
 *
 *   - Signed in: the account's copy in Postgres. What is here is a cache.
 *   - Local, in the browser: this browser's own storage, and nothing else.
 *   - Local, in the desktop shell: a JSON file the user owns, on their disk.
 *
 * What does *not* vary is that the read is **synchronous**, and it cannot be
 * made otherwise. Four provider initialisers — `foldLegacyLedger`,
 * `readStoredLedger`, `legacyPlannedCentsById`, `storedGroupBuckets` — read
 * storage to build their lazy defaults, and they run before the first paint, so
 * no amount of async plumbing reaches them. Two different things answer that
 * one requirement: `SyncContext` hydrates the cache from the server and gates
 * the render on it, and the desktop shell hands its whole file across before
 * the bundle evaluates. Either way, by the time an initialiser runs, what it
 * reads is already the right household's books.
 *
 * The medium itself is one seam lower, in `webBackend` / `desktopBackend`.
 */

import { isDesktop, storageBridge } from "./desktop";

/** Namespace prefix. Short, and distinctive enough not to collide. */
const PREFIX = "hb";

/**
 * The stores the app keeps, and so the documents that make up one account's
 * books. Order is the order they are pushed and imported in; it carries no
 * other meaning.
 *
 * **Adding a store means adding its key here**, or it will live in the browser
 * and never reach the server — the one failure this list exists to prevent.
 */
export const STORE_KEYS = [
  "transactions",
  "transactionRules",
  "payees",
  "assignments",
  "budgets",
  "budgetGroups",
  "accounts",
  "accountBalances",
  "incomeSources",
  "paySchedule",
  "retirementPlan",
  "donationRecipients",
  "donations",
  "donationGoals",
  "givingSettings",
  "savingsGoals",
  "savingsGoalAssignments",
  "schedules",
  "emergencyFund",
  "lifeEvents",
  "retirementScenarios",
  "rewardsBalances",
  "rewardsValuations",
  "rewardsTrips",
  "rewardsOffers",
  "rewardsCards",
  "rewardsEarnRates",
  "loans",
];

/**
 * Keys no store owns any more, still read on the way in by the folds in
 * `TransactionsContext` and `BudgetsContext`.
 *
 * They are carried by the import for the same reason those folds still exist:
 * a browser that has never run the current build has its ledger *only* in
 * `expenses` and `income`, and importing the current keys alone would carry up
 * an empty account. They are never written back.
 */
export const LEGACY_KEYS = ["expenses", "income", "budgetPlans", "retirementAssumptions"];

/**
 * Where `SyncContext` parks the unsent queue between page loads.
 *
 * It exists because without it there is a real hole: an edit lands in the
 * cache, the debounce is still counting, the tab closes, and the next load
 * hydrates from the server straight over the top of it. Local-first is only
 * worth anything if "local" survives a closed laptop.
 *
 * It lives here rather than in `SyncContext` because this module is the one
 * that knows the shape of a key, and because `clearScope` has to know about it:
 * the outbox is not part of the books — it is this browser's own bookkeeping,
 * which is why it is deliberately absent from `STORE_KEYS` — but **it holds
 * book content**, a copy of whatever documents were waiting to be sent.
 *
 * Leaving it behind on sign-out therefore defeats the entire point of
 * namespacing the cache: the most recent edits, which is the worst slice to
 * leave, sit in the browser for whoever opens it next. So it is cleared with
 * the books even though it is not one of them.
 */
export const PENDING_SYNC_KEY = "pendingSync";

/**
 * Where this device's unlocked books key is cached between page loads.
 *
 * It exists so that unlocking is a once-per-device thing rather than a
 * once-per-page-load thing: without it, every reload would ask the books
 * password again, which is exactly the friction a cache is for.
 *
 * **Absent from `STORE_KEYS` for `PENDING_SYNC_KEY`'s exact reason, and added
 * to `clearScope`'s loop beside it**: this is not one of the books, but it is
 * what opens them, so it leaves with the session the same way the outbox
 * does. It is also kept out of `hasStoredBooks`, `snapshotScope` and
 * `replaceScope` on purpose — it is not a document, it must never travel in
 * an export or a restore, and it must never reach the server. Caching the raw
 * key bytes here costs nothing beyond what is already true: this scope
 * already holds a plaintext cache of the very books the key opens, so the key
 * adds no exposure a reader of this browser's storage did not already have.
 */
export const BOOKS_KEY_CACHE_KEY = "booksKey";

/**
 * Where this device caches the account's unlocked **identity private key**
 * between page loads — the RSA key the books password guards, which in turn
 * unwraps each household's master key.
 *
 * Cached under the **user's** scope (not a household's), because one identity
 * opens every household the user belongs to. Absent from `STORE_KEYS` and swept
 * by `clearScope` for `BOOKS_KEY_CACHE_KEY`'s exact reason: it is not one of the
 * books but it is what opens them, so it leaves with the session.
 */
export const IDENTITY_KEY_CACHE_KEY = "identityKey";

/**
 * The "I already decided about importing" flag, written by `ImportBooksGate`.
 *
 * Named here, not just in that component, because `clearScope` has to recognise
 * it: it is the one scoped key that must **survive** sign-out, since it records
 * a choice the person already made rather than any book content, and dropping it
 * would re-offer the import to someone who answered "start fresh".
 */
export const IMPORT_DECISION_KEY = "importDecision";

/**
 * The scope a trial runs in — someone using the app without an account.
 *
 * A scope of its own, and **not** the unscoped bare keys, which is the whole
 * point: the unscoped documents are this browser's *real* pre-account books,
 * and a stranger trying the app out on a shared machine must not be able to
 * type into them. `hb:guest:budgets` cannot collide with a real account either,
 * since every other scope is a UUID.
 *
 * Trial books are still offered to an account on sign-up, the same way the
 * pre-account ones are — see `ImportBooksGate`. What makes that safe is not
 * where they came from but that the account is empty.
 */
export const GUEST_SCOPE = "guest";

/**
 * Where the choice to run without an account is remembered.
 *
 * Deliberately **unscoped** and deliberately absent from `STORE_KEYS`: it is a
 * fact about this browser, not a document belonging to anyone. Unscoped is also
 * what makes it survive `clearScope` — signing out of a real account has no
 * business ending someone else's trial.
 *
 * It is remembered at all because without it every reload would throw a guest
 * back to the sign-in form, which reads as the trial having been revoked.
 */
const GUEST_MODE_KEY = "guestMode";

/** Whether this browser has chosen to run without an account. */
export function isGuestMode() {
  const previous = scope;
  setStorageScope(null);
  try {
    return readKey(GUEST_MODE_KEY) === true;
  } finally {
    setStorageScope(previous);
  }
}

/** Enter or leave the trial. Leaving does not delete the trial's books. */
export function setGuestMode(on) {
  const previous = scope;
  setStorageScope(null);
  try {
    if (on) writeKey(GUEST_MODE_KEY, true);
    else removeKey(GUEST_MODE_KEY);
  } finally {
    setStorageScope(previous);
  }
}

/**
 * The user whose books this browser is currently showing, or null for the
 * unscoped local books.
 *
 * Module state rather than context because `scopedKey`'s callers include three
 * functions that run outside React entirely. It is set once per session, by
 * `SyncProvider`, before the store providers mount — and the provider tree is
 * keyed on the user id, so a change of user remounts every store rather than
 * asking each one to notice.
 */
let scope = null;

export function setStorageScope(userId) {
  scope = userId ?? null;
}

export function getStorageScope() {
  return scope;
}

/** Where `key` lives for the user currently in scope. */
export function scopedKey(key) {
  return scope ? `${PREFIX}:${scope}:${key}` : key;
}

/**
 * The scope string for one household's books — `<uid>:<householdId>`.
 *
 * A shared budget is a household, not an account, so the books a device shows
 * belong to the active household rather than to the signed-in user. Keeping the
 * user id as the first segment is what lets `clearScope` sweep every household a
 * user has cached in one pass on sign-out, and keeps the key tables and outbox
 * grouped under the person the session belongs to. Falls back to the bare user
 * id when there is no household yet (a brand-new account mid-setup), which is
 * harmless: nothing is stored against it until a household exists.
 */
export function householdScope(userId, householdId) {
  if (!userId) return null;
  return householdId ? `${userId}:${householdId}` : userId;
}

/**
 * The medium a key's bytes actually sit in.
 *
 * Two of them, and the shape is deliberately the three methods `localStorage`
 * already has — `getItem` / `setItem` / `removeItem`, over strings — rather than
 * anything richer. Everything above this line stays unchanged by which medium is
 * in force: `scopedKey` still decides the name, `hasStoredBooks`,
 * `snapshotScope`, `restoreScope` and `clearScope` still work in terms of keys,
 * and every test that seeds `localStorage` directly still seeds the real thing.
 *
 * **The desktop backend reads from memory, never from disk**, and that is the
 * whole reason this seam can exist. Four store initialisers —
 * `foldLegacyLedger`, `readStoredLedger`, `legacyPlannedCentsById`,
 * `storedGroupBuckets` — read storage *synchronously* to build their lazy
 * defaults, before the first paint. No promise can be put underneath them
 * without rewriting all four, so the desktop shell hands the whole snapshot
 * across before the bundle evaluates and the backend below holds it in a Map.
 */
const webBackend = {
  keys: () => Object.keys(localStorage),
  // Called through, never captured. `const { getItem } = localStorage` would be
  // the natural thing to write and would be wrong twice over: the binding loses
  // its receiver, and it is resolved at module evaluation, which is before any
  // test can install the `Storage.prototype` spies that pin the quota-exceeded
  // and storage-disabled paths — so those tests would pass while asserting
  // nothing.
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
  removeItem: (key) => localStorage.removeItem(key),
};

/**
 * The desktop shell's books file, as a Storage.
 *
 * `bridge.takeSnapshot()` consumes the whole file, already parsed, read by the
 * preload before any of this ran. It is re-serialised into the cache one key at
 * a time so that what this backend hands back is a **string** — a fresh parse
 * per read, exactly as `localStorage` gives, with no object shared between the
 * cache and a store that could mutate it. The file on disk stays parsed and
 * legible, because the main process is what writes it; that split is what lets
 * the user open their own books in a text editor and still lets this be a
 * drop-in Storage.
 *
 * Writes land in the cache at once and go to the bridge for the disk. The shell
 * coalesces them and flushes before quitting, so a burst of blur-commits is one
 * write and a quit inside the debounce is not a lost edit.
 */
function desktopBackend(bridge) {
  const cache = new Map();
  for (const [key, value] of Object.entries(bridge.takeSnapshot?.() ?? {})) {
    cache.set(key, JSON.stringify(value));
  }

  return {
    keys: () => [...cache.keys()],
    // `null` for absent, not `undefined` — `readKey` tells the two apart and
    // `localStorage` answers this way.
    getItem: (key) => (cache.has(key) ? cache.get(key) : null),
    setItem: (key, value) => {
      cache.set(key, value);
      bridge.write(key, value);
    },
    removeItem: (key) => {
      cache.delete(key);
      bridge.remove(key);
    },
  };
}

function resolveBackend() {
  const bridge = storageBridge();
  return bridge ? desktopBackend(bridge) : webBackend;
}

let backend = resolveBackend();

/**
 * Re-read which shell we are in.
 *
 * For the tests, which stage and remove a fake bridge on `window` between
 * cases. Nothing in the app calls it — the shell cannot change mid-session.
 */
export function resetStorageBackend() {
  backend = resolveBackend();
}

/**
 * Where local mode's books live — and it is not the same answer on both builds.
 *
 * **In the desktop shell, local mode is unscoped.** There the bare keys *are*
 * the household's real books: the file belongs to one machine and one
 * household, there is nobody else to collide with, and the books written before
 * they ever considered an account are exactly the ones they expect to still be
 * there when they decline one.
 *
 * **In a browser it is `GUEST_SCOPE`**, for the reason that scope exists at
 * all: the unscoped documents are *this browser's* pre-account books, and
 * somebody trying the app out on a shared machine must not be able to type into
 * them.
 *
 * An unconfigured build is a third case and is neither — unscoped on every
 * platform, because nothing was ever configured for there to be an account to
 * decline. That distinction belongs to the caller, which is the one holding the
 * auth status; this module deliberately knows nothing about it.
 */
export function localScope() {
  return isDesktop() ? null : GUEST_SCOPE;
}

// Re-exported because `localScope` above is the reason most callers ask, and
// a caller reaching for both would otherwise import from two modules to get
// one answer. `src/desktop.js` remains where it is defined.
export { isDesktop };

/**
 * Read one key, surviving everything the backend can throw at us.
 *
 * This matters more than it looks: every store is built on it and all ten
 * providers wrap the entire app, so anything that throws here white-screens the
 * whole application — and keeps doing it on every reload, because nothing would
 * clear the value that caused it. A corrupt document is dropped so the next
 * write re-seeds it and the app self-heals rather than failing identically
 * forever.
 *
 * Returns `undefined` for "nothing stored", which is distinct from a stored
 * `null`. Callers apply their own default.
 */
export function readKey(key) {
  let raw;
  try {
    raw = backend.getItem(scopedKey(key));
  } catch {
    // Storage disabled outright, or the shell's bridge is gone. The app
    // still runs for this session.
    return undefined;
  }

  if (raw == null) return undefined;

  try {
    return JSON.parse(raw);
  } catch {
    try {
      backend.removeItem(scopedKey(key));
    } catch {
      /* nothing further we can do */
    }
    return undefined;
  }
}

/**
 * Write one key. A failed persist must never take the render down.
 *
 * **A write of what is already there is not a write**, and the guard matters
 * more than it looks. Every `useSyncedState` persists on mount, so a signed-in
 * load writes all fourteen documents — and `SyncContext` has just written the
 * same fourteen into the cache itself, from the server's own copy
 * (`restoreScope`, on hydrate and again per outbox entry and per realtime row).
 * Without the check each of those lands twice: on the web as a redundant
 * `setItem` that other tabs see as a change and re-parse, and in the desktop
 * shell as a redundant trip to the disk.
 *
 * The comparison is byte-level and reads through the backend, so it is the same
 * question the medium would be asked anyway, and it is wrapped because an
 * unreadable cache is a reason to write rather than a reason to stop.
 */
export function writeKey(key, value) {
  const name = scopedKey(key);
  const serialized = JSON.stringify(value);

  try {
    if (backend.getItem(name) === serialized) return true;
  } catch {
    /* unreadable — fall through and write */
  }

  try {
    backend.setItem(name, serialized);
    return true;
  } catch {
    // Quota exceeded, storage disabled, or the shell refused the write.
    return false;
  }
}

export function removeKey(key) {
  try {
    backend.removeItem(scopedKey(key));
  } catch {
    /* nothing further we can do */
  }
}

/**
 * Whether the given scope holds any books at all.
 *
 * Used two ways, and the distinction between them is the whole import flow: run
 * against `null` it asks "does this browser have books that predate accounts",
 * and against a user id it asks "is this account still empty". An import is
 * offered only when the first is true and the second is false, so it can never
 * overwrite an account that already has something in it.
 *
 * A key holding an empty array is *not* books. A store writes `[]` on first
 * render whether or not the user has done anything, so counting it would report
 * every freshly-opened browser as having data to import.
 */
export function hasStoredBooks(userId) {
  const previous = scope;
  setStorageScope(userId);
  try {
    return [...STORE_KEYS, ...LEGACY_KEYS].some((key) => {
      const value = readKey(key);
      if (value == null) return false;
      if (Array.isArray(value)) return value.length > 0;
      if (typeof value === "object") return Object.keys(value).length > 0;
      return true;
    });
  } finally {
    setStorageScope(previous);
  }
}

/**
 * Every stored document for one scope, as `{ key: value }`.
 *
 * Keys with nothing stored are absent rather than present-and-null, so a caller
 * can tell "never written" from "written as null" — which is what stops an
 * import from planting empty documents over an account's real ones.
 */
export function snapshotScope(userId) {
  const previous = scope;
  setStorageScope(userId);
  try {
    const snapshot = {};
    for (const key of [...STORE_KEYS, ...LEGACY_KEYS]) {
      const value = readKey(key);
      if (value !== undefined) snapshot[key] = value;
    }
    return snapshot;
  } finally {
    setStorageScope(previous);
  }
}

/** Books on this device that may be offered to a newly signed-in account. */
export function snapshotLocalBooks() {
  const guestScope = localScope();
  const source = guestScope !== null && hasStoredBooks(guestScope) ? guestScope : null;
  return hasStoredBooks(source) ? snapshotScope(source) : null;
}

/** Write a `{ key: value }` snapshot into one scope. */
export function restoreScope(userId, snapshot) {
  const previous = scope;
  setStorageScope(userId);
  try {
    for (const [key, value] of Object.entries(snapshot)) {
      if (value === undefined) removeKey(key);
      else writeKey(key, value);
    }
  } finally {
    setStorageScope(previous);
  }
}

/**
 * Make `snapshot` the whole of one scope's books.
 *
 * **The difference from `restoreScope` is what happens to a key the snapshot
 * does not mention, and it is the difference between a restore and a merge.**
 * `restoreScope` writes what it is given and leaves everything else alone, which
 * is right for an import into an account known to be empty. It is wrong for a
 * restore from a file: a household that had five savings goals and restores a
 * backup taken before it had any would keep the five, and end up with books that
 * are neither the file's nor their own.
 *
 * So every known key not named in the snapshot is removed. Deliberately *not*
 * expressed as `clearScope` followed by `restoreScope`: `clearScope` refuses to
 * run unscoped — which is the case this is most often used in — and it also
 * takes the outbox with it, which is this browser's bookkeeping rather than one
 * of the books.
 *
 * `importDecision` and the outbox survive for the same reason: neither is a
 * document, and one of them is a fact about a choice the user already made.
 */
export function replaceScope(userId, snapshot) {
  const previous = scope;
  setStorageScope(userId);
  try {
    for (const key of [...STORE_KEYS, ...LEGACY_KEYS]) {
      const value = snapshot[key];
      if (value === undefined) removeKey(key);
      else writeKey(key, value);
    }
  } finally {
    setStorageScope(previous);
  }
}

/**
 * Drop every document for one scope.
 *
 * Called on sign-out, and it is the reason the cache is namespaced at all: the
 * books have to leave the browser with the session, or the next person to open
 * the app on this machine reads the last one's ledger out of the cache before
 * any gate has a chance to stop them.
 *
 * Never touches the unscoped keys — those are the browser's own local books and
 * do not belong to any session.
 *
 * **The outbox goes too, and so does the cached books key.** Neither is one
 * of the books, but the outbox holds a copy of them — see `PENDING_SYNC_KEY`
 * — and the key is what opens them — see `BOOKS_KEY_CACHE_KEY`. The rule this
 * function enforces is "no book content, and nothing that unlocks it,
 * survives the session", which is not the same list as `STORE_KEYS`.
 * `importDecision` is deliberately *not* cleared: it holds a timestamp and no
 * content, and dropping it would re-offer the import to someone who already
 * answered "start fresh" on an account that is still empty.
 */
export function clearScope(userId) {
  if (!userId) return;
  let keys;
  try {
    keys = backend.keys();
  } catch {
    return;
  }
  // Everything under this user's prefix goes — every household's documents, the
  // per-household outbox and master-key cache, and the user's own identity-key
  // cache — in one sweep rather than a fixed list, because a user may have more
  // than one household cached and `clearScope` cannot name them all. Prefix
  // rather than `setStorageScope`, deliberately: the keys to remove sit under
  // `hb:<uid>:<householdId>:…` as well as `hb:<uid>:…`, so a single scope could
  // not address them. The one survivor is the import decision — a choice the
  // person made, not book content (see `IMPORT_DECISION_KEY`).
  const prefix = `${PREFIX}:${userId}:`;
  for (const name of keys) {
    if (name.startsWith(prefix) && !name.endsWith(`:${IMPORT_DECISION_KEY}`)) {
      try {
        backend.removeItem(name);
      } catch {
        /* nothing further we can do */
      }
    }
  }
}

/** Remove orphaned account caches at boot or an account switch, keeping local
 * books, the kept guest trial, and each account's non-content import decision. */
export function clearOtherAccountScopes(keepUserId = null) {
  let keys;
  try {
    keys = backend.keys();
  } catch {
    return;
  }
  for (const name of keys) {
    const match = /^hb:([^:]+):(.+)$/.exec(name);
    if (!match) continue;
    const owner = match[1];
    if (owner === GUEST_SCOPE || owner === keepUserId) continue;
    if (name.endsWith(`:${IMPORT_DECISION_KEY}`)) continue;
    backend.removeItem(name);
  }
}
