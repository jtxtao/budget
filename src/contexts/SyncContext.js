import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getSupabase, isSupabaseConfigured } from "../supabaseClient";
import { AUTH_STATUS, useAuth } from "./AuthContext";
import {
  getStorageScope,
  householdScope,
  localScope,
  PENDING_SYNC_KEY,
  readKey,
  removeKey,
  restoreScope,
  setStorageScope,
  STORE_KEYS,
  writeKey,
} from "../storage";
import { decryptDocument, encryptDocument, envelopeKid, isEncryptedDocument } from "../booksCrypto";
import { booksKeyGeneration, getBooksKey } from "../booksKey";
import { useHousehold } from "./HouseholdContext";

/**
 * The seam between the books and the wire — and the only file that touches
 * document ciphertext. `src/booksCrypto.js` knows the shape of an envelope;
 * this is the one place that calls it against a live key.
 *
 * One provider, above every store, doing four things:
 *
 *   1. **Hydrate.** On sign-in it fetches every document for the account in
 *      one query, decrypts each envelope under this device's key — or takes a
 *      row **as-is** when it predates encryption, which is a supported state
 *      and not an error — and writes the result into the local cache before
 *      the stores ever mount. That ordering is the load-bearing part of this
 *      whole migration: four provider initialisers (`foldLegacyLedger`,
 *      `readStoredLedger`, `legacyPlannedCentsById`, `storedGroupBuckets`)
 *      read storage **synchronously** to build their lazy defaults, and no
 *      amount of async plumbing changes that they run before the first paint.
 *      Gating the render is what lets those keep working untouched — and what
 *      lets every migration, every `{ ok, error }` mutator and every
 *      invariant tripwire survive the move to Postgres unchanged. An envelope
 *      that will not decrypt, or whose `kid` does not match this device's
 *      key, refuses the render rather than falling through to an empty or
 *      stale set of books.
 *
 *   2. **Push and seal.** Writes are coalesced per key and flushed after a
 *      moment's quiet, so a run of blur-committing cells in the register is
 *      one round trip rather than one per column. `flush` is the **only**
 *      place a document is encrypted — `pending`, the outbox and `known` stay
 *      plaintext throughout, which is what keeps the echo-suppression below
 *      working, since a fresh IV means the same document seals to different
 *      bytes on every call. It reads the key through `getBooksKey()` fresh on
 *      every call rather than a closure, because it also runs from
 *      `beforeunload` and `visibilitychange` listeners outside any
 *      component's lifetime. A flush with no key available sends nothing, and
 *      neither does one where any document in the batch fails to seal — the
 *      whole batch is encrypted before any of it goes out. Either way the
 *      push is treated as failed and *kept* rather than dropped: the local
 *      cache already holds the plaintext, so the cost is delay, never a
 *      document sent in the clear.
 *
 *   3. **Receive.** A realtime subscription replaces the `storage` event that
 *      used to keep two tabs in step. Same problem, one device wider: every
 *      write replaces a whole document, so without it the last device to save
 *      silently destroys what the other logged. Decrypted before any listener
 *      sees it; a row that will not decrypt is ignored, keeping what the
 *      store already has rather than blanking it.
 *
 *   4. **Migrate.** `resync()` clears `known` and re-queues every cached
 *      document so the next flush reseals it. Hydrate calls it once, after
 *      the render is already showing, for an account where at least one row
 *      came back plaintext — an account that predates this file's
 *      encryption. The ordinary debounce/outbox/retry machinery carries the
 *      rest, so a migration a closed laptop interrupts finishes on the next
 *      load.
 *
 * When there is no project configured, or nobody signed in, all four are
 * inert and the app runs on this browser's own books exactly as it always
 * did.
 */
// Exported so a test can stage a sync layer without a network — `useSyncedState`
// is the only consumer in the app, and it reads through `useSync` below.
export const SyncContext = React.createContext();

export function useSync() {
  return useContext(SyncContext);
}

/**
 * How long to wait for more writes before flushing.
 *
 * Long enough that tabbing across a row of cells that each commit on blur is
 * one request; short enough that closing the laptop a second after typing does
 * not lose the edit. `flush` on page-hide covers the rest.
 */
const FLUSH_DELAY_MS = 700;

/**
 * A document's identity as a string, independent of key order.
 *
 * `known` exists to recognise "the server already has this", and the server
 * stores documents as `jsonb` — which does not keep keys in the order they were
 * written (it sorts them, shortest first). A plain `JSON.stringify` therefore
 * never matched a document on its way back down: every hydrate re-pushed every
 * store, and every realtime echo of our own write read as a change from another
 * device, was applied, re-pushed, and echoed again — a loop that kept the
 * header's "Saving…" lit for as long as the app was open. Sorting the keys
 * makes two serialisations of one document equal however either was ordered.
 */
export function canonicalJSON(value) {
  return JSON.stringify(value, (_key, inner) => {
    if (!inner || typeof inner !== "object" || Array.isArray(inner)) return inner;
    const sorted = {};
    for (const key of Object.keys(inner).sort()) sorted[key] = inner[key];
    return sorted;
  });
}

/** Backoff after a failed flush, so an offline device does not spin. */
const RETRY_DELAY_MS = 5000;

export const SYNC_STATE = {
  /** Nothing to send and nothing outstanding. */
  IDLE: "idle",
  /** Edits are queued or in flight. */
  SAVING: "saving",
  /** A push failed. The edits are safe locally and will be retried. */
  OFFLINE: "offline",
  /** No account server, or signed out. Local books only. */
  LOCAL: "local",
};

/** `hydratedScope` before any scope's documents are in the cache. */
const NOT_HYDRATED = Symbol("not hydrated");

export const SyncProvider = ({ children }) => {
  const { status, userId } = useAuth();
  const { activeHouseholdId } = useHousehold();

  // A shared budget is a household, so the books belong to one and `remote`
  // needs a household as much as it needs a signed-in user. The gate above this
  // provider (`HouseholdGate`) only renders children once a household is ready,
  // so in practice this is true whenever this provider is reached signed in.
  const remote =
    status === AUTH_STATUS.SIGNED_IN && isSupabaseConfigured && Boolean(userId) && Boolean(activeHouseholdId);
  const householdId = activeHouseholdId;

  /**
   * Whose books the cache is showing, and the one place the three cases are
   * resolved.
   *
   * **The guest case is the bug this replaces.** It used to read
   * `remote ? userId : null`, which handed somebody who had declined an account
   * the *unscoped* documents — this browser's own pre-account books — which is
   * the exact collision `GUEST_SCOPE` was written to prevent. Nothing called
   * `setGuestMode`, so it never fired; giving that function its first caller is
   * what makes it reachable.
   *
   * `LOCAL_ONLY` stays unscoped, and deliberately: it is a fact about the
   * *build* rather than about the person, there was never an account to decline,
   * and those bare keys are the books the app has always kept. It is also how
   * the whole test suite runs.
   */
  const scope = remote ? householdScope(userId, householdId) : status === AUTH_STATUS.GUEST ? localScope() : null;

  // Applied during render, not in the effect below. Every store reads storage in
  // its own lazy initialiser, and those run after this render and before any
  // effect — so a scope set in an effect would be set one render too late, and
  // the stores remounting on a switch out of an account would read the account's
  // cleared keys instead of the local books. Idempotent, so React calling this
  // twice under StrictMode costs nothing.
  if (getStorageScope() !== scope) setStorageScope(scope);

  // Local-only runs need no hydration, so they start ready. A signed-in run
  // starts unhydrated and the render is gated below until the fetch lands.
  //
  // Held as *which scope* was hydrated rather than a bare boolean. A boolean
  // stays true for the one render between a household (or user) switch and the
  // effect below noticing it, and in that render the stores mount against the
  // new scope's still-empty cache: the dashboard reads a household with no
  // accounts and no categories and sends an established user into setup.
  // Comparing against the scope in force closes that render.
  const [hydratedScope, setHydratedScope] = useState(remote ? NOT_HYDRATED : scope);
  const hydrated = hydratedScope === scope;
  const [hydrationError, setHydrationError] = useState(null);
  const [syncState, setSyncState] = useState(remote ? SYNC_STATE.IDLE : SYNC_STATE.LOCAL);

  /** key -> the value waiting to be sent. Last write per key wins, by design. */
  const pending = useRef(new Map());
  const accountWork = useRef(null);

  /**
   * Keys whose row is to be removed from the account outright.
   *
   * Only a restore queues these, and it is the one operation that can make a
   * document *stop existing* rather than change: the file being restored may not
   * name a store the account currently has, and leaving that row behind would
   * mean the next hydrate quietly brought it back over the top of the restore.
   *
   * Deliberately **not** persisted in the outbox. The restore awaits the flush
   * and refuses to reload if it failed, so a queued delete never has to survive
   * a page load — which is what keeps the outbox's shape, and every older outbox
   * already sitting in a browser, readable as it is.
   */
  const pendingDeletes = useRef(new Set());
  const flushTimer = useRef(null);
  const flushing = useRef(false);

  // The hydrate effect has to be able to kick a flush for anything it recovers
  // out of the outbox, and it runs above `flush`'s definition. A ref rather than
  // a reorder, so the two do not have to be tangled into one effect.
  const flushRef = useRef(null);

  // Same reason as `flushRef`: hydrate has to be able to kick off the
  // self-migration below, and `resync` is defined after it.
  const resyncRef = useRef(null);

  /**
   * key -> the JSON we last sent or received for it.
   *
   * Two jobs. It stops a mount from re-pushing every document that came
   * down from the server unchanged a moment earlier, and it stops the realtime
   * subscription from echoing our own write back into the store as though a
   * second device had made it — which, because every store's setter replaces
   * the whole value, would cost a render of the entire app per keystroke-ish
   * commit.
   *
   * **Always plaintext, even once the wire is sealed.** `encryptDocument`
   * draws a fresh IV every call, so the same document seals to different
   * bytes each time — a `known` holding ciphertext would match nothing, ever,
   * and both jobs above would fail silently: every hydrate would re-push
   * every store, and every echo of our own write would read as a change from
   * another device, get applied, and get re-pushed again. Comparing
   * plaintext is what keeps both loops closed.
   */
  const known = useRef(new Map());

  /**
   * key -> the IV of the envelope this device last sent for it.
   *
   * A realtime notification names a row rather than carrying it, so telling
   * our own echo apart *before* fetching it back needs something the
   * notification can carry that the server cannot have produced on its own.
   * The envelope's IV is that: public by design, and fresh on every seal, so
   * a match means "the row on the server is still the one we wrote". Purely a
   * saving — a miss fetches the row, and `known` still recognises it.
   */
  const sentIvs = useRef(new Map());

  /** key -> Set of listeners, for changes arriving from another device. */
  const listeners = useRef(new Map());

  // ---------------------------------------------------------------------
  // Hydrate
  // ---------------------------------------------------------------------
  useEffect(() => {
    // The scope is set before anything else can read storage. Children do not
    // mount until `hydrated`, so by the time a store's initialiser runs, both
    // the scope and the account's documents are in place.
    setStorageScope(scope);

    if (!remote) {
      accountWork.current = null;
      pending.current.clear();
      pendingDeletes.current.clear();
      known.current.clear();
      sentIvs.current.clear();
      setHydratedScope(scope);
      setHydrationError(null);
      setSyncState(SYNC_STATE.LOCAL);
      return undefined;
    }

    let active = true;
    const generation = booksKeyGeneration();
    const work = { householdId, generation };
    accountWork.current = work;
    pendingDeletes.current.clear();
    setHydratedScope(NOT_HYDRATED);
    setHydrationError(null);

    (async () => {
      const { data, error } = await getSupabase()
        .from("app_state")
        .select("key, value")
        .eq("household_id", householdId);

      if (!active || booksKeyGeneration() !== generation) return;

      if (error) {
        // Refusing to render is the right answer here, and the alternative is
        // why: falling through to the local cache would show the account an
        // empty — or worse, a *stale* — set of books, and the first edit made
        // against it would be pushed up over the real ones.
        setHydrationError(error.message ?? "Could not load your books.");
        return;
      }

      const rows = data ?? [];
      // Read once per hydrate rather than per row: the key does not change
      // mid-pass, and this is not `flush`, which has to read it fresh on
      // every call because it can run long after this effect has finished.
      const booksKey = getBooksKey();

      const snapshot = {};
      let sawPlaintext = false;

      for (const row of rows) {
        if (isEncryptedDocument(row.value)) {
          // A cached document that crossed a scope switch, or a row that
          // crossed accounts, names a `kid` that is not this device's — and
          // handing that to GCM would fail obscurely instead of saying why.
          if (!booksKey || envelopeKid(row.value) !== booksKey.kid) {
            setHydrationError("This device's key does not match this account's books.");
            return;
          }
          const decrypted = await decryptDocument(booksKey.mk, row.value);
          if (!active || booksKeyGeneration() !== generation) return;
          if (!decrypted.ok) {
            // Same stance as a failed fetch, and the same reason: falling
            // through would show empty books and then push them up over the
            // real ones.
            setHydrationError(decrypted.error ?? "Could not load your books.");
            return;
          }
          snapshot[row.key] = decrypted.value;
        } else {
          // A row from before encryption existed — a supported state, not an
          // error, and taken as-is.
          snapshot[row.key] = row.value;
          sawPlaintext = true;
        }
      }

      if (!active || booksKeyGeneration() !== generation) return;

      // `known` holds plaintext even though the rows that produced it were
      // ciphertext — see the comment on `known`'s declaration for why a
      // cache of ciphertext could never match anything again.
      known.current.clear();
      sentIvs.current.clear();
      for (const key of Object.keys(snapshot)) known.current.set(key, canonicalJSON(snapshot[key]));
      restoreScope(scope, snapshot);

      // Anything this browser wrote but never managed to send outranks what
      // came back, because it is strictly newer — the server's copy is the one
      // that predates it. Re-applied over the snapshot and re-queued, so a tab
      // closed mid-debounce costs a delay rather than the edit. The outbox lives
      // under this household's own scope, which is already in force.
      const outbox = readKey(PENDING_SYNC_KEY);

      pending.current.clear();
      if (outbox && typeof outbox === "object") {
        for (const [key, value] of Object.entries(outbox)) {
          pending.current.set(key, value);
          restoreScope(scope, { [key]: value });
        }
      }

      setHydratedScope(scope);

      // The self-migration: at least one row came back plaintext, so the
      // account predates this file's encryption and needs every row
      // rewritten sealed. `resync` re-queues every cached document — which,
      // thanks to the outbox merge just above, already includes anything
      // this browser had queued — so there is nothing left to additionally
      // schedule here. An account with no rows at all is not a migration;
      // there is nothing to reseal.
      if (rows.length > 0 && sawPlaintext) {
        resyncRef.current();
      } else if (pending.current.size > 0) {
        setSyncState(SYNC_STATE.SAVING);
        flushTimer.current = setTimeout(() => flushRef.current(), FLUSH_DELAY_MS);
      } else {
        setSyncState(SYNC_STATE.IDLE);
      }
    })();

    return () => {
      active = false;
      if (accountWork.current === work) accountWork.current = null;
    };
  }, [remote, scope, householdId]);

  // ---------------------------------------------------------------------
  // Push
  // ---------------------------------------------------------------------
  /** Park the outbox where the next page load will find it. */
  const persistOutbox = useCallback(() => {
    if (!accountWork.current || accountWork.current.generation !== booksKeyGeneration()) return;
    if (pending.current.size === 0) removeKey(PENDING_SYNC_KEY);
    else writeKey(PENDING_SYNC_KEY, Object.fromEntries(pending.current));
  }, []);

  /**
   * Send everything queued. Returns `{ ok, error }` like every other mutator in
   * the app — the import flow is the one caller that needs to know, since it
   * has a decision to make about what to tell the user.
   */
  const flush = useCallback(async () => {
    if (!remote) return { ok: true };
    const work = accountWork.current;
    if (!work || work.householdId !== householdId || work.generation !== booksKeyGeneration()) {
      return { ok: false, error: "The account session ended." };
    }
    if (flushing.current) return { ok: true };
    if (pending.current.size === 0 && pendingDeletes.current.size === 0) return { ok: true };

    flushing.current = true;
    const generation = booksKeyGeneration();
    const cancelled = () => {
      if (accountWork.current === work && booksKeyGeneration() === generation && getStorageScope() === scope) return false;
      flushing.current = false;
      return true;
    };
    // Taken as a batch, and left in `pending` until it lands. A write arriving
    // mid-flight lands in the map for the next pass rather than being lost to
    // the one already in flight.
    const batch = [...pending.current.entries()];
    const drops = [...pendingDeletes.current];
    setSyncState(SYNC_STATE.SAVING);

    // Deletes go first, so that a key somehow in both lists ends up written
    // rather than missing — the safer way round for a pair that should never
    // overlap in the first place.
    let error = null;

    if (drops.length > 0) {
      ({ error } = await getSupabase()
        .from("app_state")
        .delete()
        .eq("household_id", householdId)
        .in("key", drops));
      if (cancelled()) return { ok: false, error: "The account session ended." };
    }

    // Sealed here and only here — `pending`, the outbox and `known` all stay
    // plaintext (see `known`'s comment), so this is the one place "the
    // server never sees plaintext" is a property of the code rather than a
    // claim about it. Read fresh rather than closed over: this function is
    // also called from `beforeunload` and `visibilitychange` listeners,
    // long after whatever render captured a key could have gone stale.
    let sealed = null;
    if (!error && batch.length > 0) {
      const booksKey = getBooksKey();
      if (!booksKey) {
        // No key, no send — the alternative is a document in the clear,
        // which is the one thing this file exists to prevent. Treated
        // exactly like a failed push below: queued, retried, reported.
        error = { message: "The books are locked on this device." };
      } else {
        // The whole batch is sealed before any of it is sent, the project's
        // batch-mutator rule — one bad document must not leave a
        // partially-sealed write sitting on the server.
        sealed = [];
        for (const [key, value] of batch) {
          const envelope = await encryptDocument(booksKey.mk, booksKey.kid, value);
          if (cancelled()) return { ok: false, error: "The account session ended." };
          if (!envelope.ok) {
            error = { message: envelope.error };
            sealed = null;
            break;
          }
          sealed.push({ household_id: householdId, key, value: envelope.envelope });
        }
      }
    }

    if (!error && sealed) {
      ({ error } = await getSupabase().from("app_state").upsert(sealed, { onConflict: "household_id,key" }));
    }

    flushing.current = false;
    if (cancelled()) return { ok: false, error: "The account session ended." };

    if (error) {
      setSyncState(SYNC_STATE.OFFLINE);
      // Nothing is dropped — the values stay queued, the local cache already
      // holds them, and the outbox keeps them across a reload, so an offline
      // stretch costs delay and not data.
      persistOutbox();
      flushTimer.current = setTimeout(() => flushRef.current(), RETRY_DELAY_MS);
      return { ok: false, error: error.message ?? "Could not reach the server." };
    }

    for (const [key, value] of batch) {
      const serialized = canonicalJSON(value);
      known.current.set(key, serialized);
      // Only clear the key if nothing newer arrived while this was in flight.
      if (canonicalJSON(pending.current.get(key)) === serialized) pending.current.delete(key);
    }
    // Deletes first, mirroring the order they were sent in.
    for (const key of drops) {
      pendingDeletes.current.delete(key);
      sentIvs.current.delete(key);
    }
    for (const row of sealed ?? []) sentIvs.current.set(row.key, row.value.iv);
    persistOutbox();

    if (pending.current.size > 0 || pendingDeletes.current.size > 0) {
      flushTimer.current = setTimeout(() => flushRef.current(), FLUSH_DELAY_MS);
      setSyncState(SYNC_STATE.SAVING);
    } else {
      setSyncState(SYNC_STATE.IDLE);
    }
    return { ok: true };
  }, [remote, householdId, scope, persistOutbox]);

  flushRef.current = flush;

  /**
   * Queue one document for the server.
   *
   * Called by every `useSyncedState` on every change. Returns immediately: the
   * local cache is already written by the time this runs, so the UI never waits
   * on the network to show what the user just did.
   */
  const push = useCallback(
    (key, value) => {
      if (!remote) return;
      if (!accountWork.current || accountWork.current.householdId !== householdId || accountWork.current.generation !== booksKeyGeneration()) return;

      // Unchanged from what the server last told us. This is what makes a
      // reload cost zero writes despite every store's persist effect firing on
      // mount.
      if (known.current.get(key) === canonicalJSON(value)) return;

      pendingDeletes.current.delete(key);
      pending.current.set(key, value);
      // Written before the debounce starts, not after it lands, so the window
      // between typing and sending is covered rather than being the gap.
      persistOutbox();
      setSyncState(SYNC_STATE.SAVING);

      clearTimeout(flushTimer.current);
      flushTimer.current = setTimeout(() => flushRef.current(), FLUSH_DELAY_MS);
    },
    [remote, householdId, persistOutbox]
  );

  /**
   * Queue the outright removal of documents from the account.
   *
   * Needs no change for encryption, and is worth a line saying so rather than
   * leaving the next reader to re-derive it: a delete sends only the key,
   * never the value, so there is nothing here to seal.
   *
   * `known` is cleared for each, or a later push of the value that was just
   * dropped would be suppressed as unchanged and the account would be left
   * missing a document the store still holds.
   */
  const dropRemote = useCallback(
    (keys) => {
      if (!remote) return;
      if (!accountWork.current || accountWork.current.householdId !== householdId || accountWork.current.generation !== booksKeyGeneration()) return;

      for (const key of keys) {
        pending.current.delete(key);
        known.current.delete(key);
        pendingDeletes.current.add(key);
      }

      persistOutbox();
      setSyncState(SYNC_STATE.SAVING);

      clearTimeout(flushTimer.current);
      flushTimer.current = setTimeout(() => flushRef.current(), FLUSH_DELAY_MS);
    },
    [remote, householdId, persistOutbox]
  );

  /**
   * Re-seal every cached document for this account.
   *
   * The honest primitive for "the server's copy needs rewriting for a reason
   * that has nothing to do with its contents" — which is a different claim
   * from "this document changed", and conflating the two would leave no way
   * to ask for the first without faking the second. Used once today, by
   * hydrate's self-migration above, and exported as a verb in its own right
   * for the same reason `flush` is.
   *
   * Clearing `known` is what makes every document look changed to `push`'s
   * guard; re-reading the cache rather than diffing it is what makes this
   * correct even for a document this device never had queued.
   */
  const resync = useCallback(() => {
    if (!remote) return;
    if (!accountWork.current || accountWork.current.householdId !== householdId || accountWork.current.generation !== booksKeyGeneration()) return;

    known.current.clear();

    const previousScope = getStorageScope();
    setStorageScope(scope);
    try {
      for (const key of STORE_KEYS) {
        const value = readKey(key);
        if (value !== undefined) pending.current.set(key, value);
      }
    } finally {
      setStorageScope(previousScope);
    }

    persistOutbox();
    setSyncState(SYNC_STATE.SAVING);

    clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => flushRef.current(), FLUSH_DELAY_MS);
  }, [remote, householdId, scope, persistOutbox]);

  resyncRef.current = resync;

  // A queued edit must not be lost to a closing tab. `visibilitychange` rather
  // than `beforeunload` alone, because mobile browsers frequently never fire
  // the latter.
  useEffect(() => {
    if (!remote) return undefined;

    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    const onOnline = () => flush();

    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", flush);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("online", onOnline);
    };
  }, [remote, flush]);

  useEffect(() => () => clearTimeout(flushTimer.current), []);

  // ---------------------------------------------------------------------
  // Receive
  // ---------------------------------------------------------------------
  const subscribeRemote = useCallback((key, listener) => {
    const forKey = listeners.current.get(key) ?? new Set();
    forKey.add(listener);
    listeners.current.set(key, forKey);
    return () => forKey.delete(listener);
  }, []);

  useEffect(() => {
    if (!remote || !hydrated) return undefined;
    const generation = booksKeyGeneration();
    const work = accountWork.current;

    // A private Broadcast topic, not Postgres Changes: see the Realtime section
    // of `supabase/schema.sql` for why, and for the receive policy that makes
    // joining it the authorization. Namespaced by app, because the project
    // behind it is not this app's alone and topics are one flat namespace per
    // project.
    //
    // **The message names a row and never carries one** — `{ key, op, iv }`.
    // The row is fetched through PostgREST, so its own SELECT policy decides
    // who reads it, exactly as on hydrate.
    const supabase = getSupabase();
    const stale = () => accountWork.current !== work || getStorageScope() !== scope || booksKeyGeneration() !== generation;
    const channel = supabase
      .channel(`budget:app_state:${householdId}`, { config: { private: true } })
      .on("broadcast", { event: "app_state_changed" }, async (message) => {
        const notice = message?.payload;
        if (!notice?.key) return;
        const deleted = notice.op === "DELETE";

        // The session has ended and the render has already moved the cache
        // to another scope, but this channel is only removed in the commit
        // after it. A row landing in that gap must not be written back under
        // a household whose books sign-out or a switch has just cleared off
        // this device.
        if (stale()) return;

        // A key we are still trying to send is one this device has a newer
        // answer for. Letting the server's copy win here would undo an edit
        // the user can already see on screen.
        if (pending.current.has(notice.key)) return;

        // Our own write, echoed back — recognised by the nonce we sealed it
        // under, so it costs no fetch. A miss falls through to `known` below.
        if (!deleted && notice.iv && sentIvs.current.get(notice.key) === notice.iv) return;

        let row = { key: notice.key, value: undefined };
        if (!deleted) {
          const { data, error } = await supabase
            .from("app_state")
            .select("key, value")
            .eq("household_id", householdId)
            .eq("key", notice.key)
            .maybeSingle();
          // Unreadable, or gone again by the time we asked: either way there
          // is nothing to apply, and a DELETE has its own notice. The row is
          // the server's, and the next hydrate fetches it regardless.
          if (error || !data) return;
          row = data;

          // Same two guards as above, asked again: the fetch is an `await`,
          // and both things they protect against can land inside it.
          if (stale()) return;
          if (pending.current.has(row.key)) return;
        }

        let value = deleted ? undefined : row.value;

        // Decrypted before anything below ever sees it. A row that will not
        // decrypt is ignored outright — `useSyncedState`'s existing stance
        // for a document it cannot read, kept rather than blanked, and there
        // is no render left here to refuse the way hydrate's does.
        if (!deleted && isEncryptedDocument(value)) {
          const booksKey = getBooksKey();
          const decrypted =
            booksKey && envelopeKid(value) === booksKey.kid
              ? await decryptDocument(booksKey.mk, value)
              : { ok: false };
          if (!decrypted.ok) return;
          value = decrypted.value;

          // **Both guards above are re-asked after the decrypt, and that is
          // not belt-and-braces.** They were written when this handler was
          // synchronous, where checking once was checking at the moment of
          // the write; a decrypt is an `await`, so there is now a gap
          // between them and the `restoreScope` below, and each guard
          // protects against something that really can land in it:
          //
          //   - the session can end mid-decrypt, moving the cache to
          //     another scope, and this row would then be written back
          //     under an account whose books sign-out has just cleared off
          //     this device;
          //   - a local edit can land in `pending` mid-decrypt, and the
          //     server's older copy would overwrite an edit the user can
          //     already see on screen.
          //
          // Returning is right for both: the row is the server's and the
          // next hydrate fetches it again, while what we would be throwing
          // away here is either nothing or somebody's own typing.
          if (stale()) return;
          if (pending.current.has(row.key)) return;
        }

        const serialized = canonicalJSON(value);
        // Our own write, echoed back.
        if (known.current.get(row.key) === serialized) return;

        known.current.set(row.key, serialized);
        restoreScope(scope, { [row.key]: value });

        for (const listener of listeners.current.get(row.key) ?? []) listener(value);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [remote, hydrated, scope, householdId]);

  const value = useMemo(
    () => ({ remote, hydrated, syncState, push, dropRemote, subscribeRemote, flush, resync }),
    [remote, hydrated, syncState, push, dropRemote, subscribeRemote, flush, resync]
  );

  if (hydrationError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ledger px-6">
        <div className="max-w-md border border-edge bg-panel p-6">
          <h1 className="font-sans text-lg font-bold text-chalk">Could not load your books</h1>
          <p className="mt-3 font-sans text-sm text-chalk-soft">{hydrationError}</p>
          <p className="mt-3 font-sans text-sm text-chalk-soft">
            Nothing has been changed. Reload once you have a connection.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 inline-flex items-center border border-transparent bg-azure px-3.5 py-2 font-sans text-sm font-medium tracking-wide text-panel transition-colors hover:bg-chalk"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }

  // The gate. Stores do not mount — and so their initialisers do not read
  // storage — until the account's documents are in the cache underneath them.
  if (!hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ledger">
        <p className="text-label uppercase tracking-wide text-chalk-soft">
          Loading your books…
        </p>
      </div>
    );
  }

  return (
    <SyncContext.Provider value={value}>
      {/* Keyed on the household scope, so switching households (or users)
          remounts every store rather than asking each one to notice that the
          books underneath it changed. */}
      <React.Fragment key={scope ?? "local"}>{children}</React.Fragment>
    </SyncContext.Provider>
  );
};
