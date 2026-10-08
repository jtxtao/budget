import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getSupabase, isSupabaseConfigured } from "../supabaseClient";
import { AUTH_STATUS, useAuth } from "./AuthContext";
import {
  getStorageScope,
  localScope,
  PENDING_SYNC_KEY,
  readKey,
  removeKey,
  restoreScope,
  setStorageScope,
  writeKey,
} from "../storage";

/**
 * The seam between the books and the wire.
 *
 * One provider, above every store, doing three things:
 *
 *   1. **Hydrate.** On sign-in it fetches every document for the account in one
 *      query, writes them into the local cache, and only *then* renders the
 *      stores. That ordering is the load-bearing part of this whole migration:
 *      three provider initialisers (`foldLegacyLedger`, `readStoredLedger`,
 *      `legacyPlannedCentsById`) read storage **synchronously** to build their
 *      lazy defaults, and no amount of async plumbing changes that they run
 *      before the first paint. Gating the render is what lets those keep
 *      working untouched — and what lets every migration, every `{ ok, error }`
 *      mutator and every invariant tripwire survive the move to Postgres
 *      unchanged.
 *
 *   2. **Push.** Writes are coalesced per key and flushed after a moment's
 *      quiet, so a run of blur-committing cells in the register is one round
 *      trip rather than one per column. A failed push is *kept* and retried
 *      rather than dropped — the local cache already holds the value, so the
 *      cost of being offline is delay, not loss.
 *
 *   3. **Receive.** A realtime subscription replaces the `storage` event that
 *      used to keep two tabs in step. Same problem, one device wider: every
 *      write replaces a whole document, so without it the last device to save
 *      silently destroys what the other logged.
 *
 * When there is no project configured, or nobody signed in, all three are inert
 * and the app runs on this browser's own books exactly as it always did.
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

export const SyncProvider = ({ children }) => {
  const { status, userId } = useAuth();

  const remote = status === AUTH_STATUS.SIGNED_IN && isSupabaseConfigured && Boolean(userId);

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
  const scope = remote ? userId : status === AUTH_STATUS.GUEST ? localScope() : null;

  // Applied during render, not in the effect below. Every store reads storage in
  // its own lazy initialiser, and those run after this render and before any
  // effect — so a scope set in an effect would be set one render too late, and
  // the stores remounting on a switch out of an account would read the account's
  // cleared keys instead of the local books. Idempotent, so React calling this
  // twice under StrictMode costs nothing.
  if (getStorageScope() !== scope) setStorageScope(scope);

  // Local-only runs need no hydration, so they start ready. A signed-in run
  // starts unhydrated and the render is gated below until the fetch lands.
  const [hydrated, setHydrated] = useState(!remote);
  const [hydrationError, setHydrationError] = useState(null);
  const [syncState, setSyncState] = useState(remote ? SYNC_STATE.IDLE : SYNC_STATE.LOCAL);

  /** key -> the value waiting to be sent. Last write per key wins, by design. */
  const pending = useRef(new Map());

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

  /**
   * key -> the JSON we last sent or received for it.
   *
   * Two jobs. It stops a mount from re-pushing fourteen documents that came
   * down from the server unchanged a moment earlier, and it stops the realtime
   * subscription from echoing our own write back into the store as though a
   * second device had made it — which, because every store's setter replaces
   * the whole value, would cost a render of the entire app per keystroke-ish
   * commit.
   */
  const known = useRef(new Map());

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
      pending.current.clear();
      known.current.clear();
      setHydrated(true);
      setHydrationError(null);
      setSyncState(SYNC_STATE.LOCAL);
      return undefined;
    }

    let active = true;
    setHydrated(false);
    setHydrationError(null);

    (async () => {
      const { data, error } = await getSupabase()
        .from("app_state")
        .select("key, value")
        .eq("user_id", userId);

      if (!active) return;

      if (error) {
        // Refusing to render is the right answer here, and the alternative is
        // why: falling through to the local cache would show the account an
        // empty — or worse, a *stale* — set of books, and the first edit made
        // against it would be pushed up over the real ones.
        setHydrationError(error.message ?? "Could not load your books.");
        return;
      }

      const snapshot = {};
      known.current.clear();
      for (const row of data ?? []) {
        snapshot[row.key] = row.value;
        known.current.set(row.key, canonicalJSON(row.value));
      }
      restoreScope(userId, snapshot);

      // Anything this browser wrote but never managed to send outranks what
      // came back, because it is strictly newer — the server's copy is the one
      // that predates it. Re-applied over the snapshot and re-queued, so a tab
      // closed mid-debounce costs a delay rather than the edit.
      setStorageScope(userId);
      const outbox = readKey(PENDING_SYNC_KEY);
      setStorageScope(scope);

      pending.current.clear();
      if (outbox && typeof outbox === "object") {
        for (const [key, value] of Object.entries(outbox)) {
          pending.current.set(key, value);
          restoreScope(userId, { [key]: value });
        }
      }

      setHydrated(true);

      if (pending.current.size > 0) {
        setSyncState(SYNC_STATE.SAVING);
        flushTimer.current = setTimeout(() => flushRef.current(), FLUSH_DELAY_MS);
      } else {
        setSyncState(SYNC_STATE.IDLE);
      }
    })();

    return () => {
      active = false;
    };
  }, [remote, userId, scope]);

  // ---------------------------------------------------------------------
  // Push
  // ---------------------------------------------------------------------
  /** Park the outbox where the next page load will find it. */
  const persistOutbox = useCallback(() => {
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
    if (flushing.current) return { ok: true };
    if (pending.current.size === 0 && pendingDeletes.current.size === 0) return { ok: true };

    flushing.current = true;
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
        .eq("user_id", userId)
        .in("key", drops));
    }

    if (!error && batch.length > 0) {
      ({ error } = await getSupabase().from("app_state").upsert(
        batch.map(([key, value]) => ({ user_id: userId, key, value })),
        { onConflict: "user_id,key" }
      ));
    }

    flushing.current = false;

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
    for (const key of drops) pendingDeletes.current.delete(key);
    persistOutbox();

    if (pending.current.size > 0 || pendingDeletes.current.size > 0) {
      flushTimer.current = setTimeout(() => flushRef.current(), FLUSH_DELAY_MS);
      setSyncState(SYNC_STATE.SAVING);
    } else {
      setSyncState(SYNC_STATE.IDLE);
    }
    return { ok: true };
  }, [remote, userId, persistOutbox]);

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
    [remote, persistOutbox]
  );

  /**
   * Queue the outright removal of documents from the account.
   *
   * `known` is cleared for each, or a later push of the value that was just
   * dropped would be suppressed as unchanged and the account would be left
   * missing a document the store still holds.
   */
  const dropRemote = useCallback(
    (keys) => {
      if (!remote) return;

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
    [remote, persistOutbox]
  );

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

    // Namespaced by app, because the project behind it is no longer this app's
    // alone. Realtime topics are a flat namespace per project, so `app_state`
    // on its own names a table that only one of the apps sharing this project
    // has — hygiene rather than a fix, since the `postgres_changes` bindings
    // below are per-subscription and would not cross-deliver either way.
    const channel = getSupabase()
      .channel(`budget:app_state:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "app_state",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new ?? payload.old;
          if (!row?.key) return;

          // The session has ended and the render has already moved the cache
          // to another scope, but this channel is only removed in the commit
          // after it. A row landing in that gap must not be written back under
          // an account whose books sign-out has just cleared off this device.
          if (getStorageScope() !== userId) return;

          // A key we are still trying to send is one this device has a newer
          // answer for. Letting the server's copy win here would undo an edit
          // the user can already see on screen.
          if (pending.current.has(row.key)) return;

          const value = payload.eventType === "DELETE" ? undefined : row.value;
          const serialized = canonicalJSON(value);
          // Our own write, echoed back.
          if (known.current.get(row.key) === serialized) return;

          known.current.set(row.key, serialized);
          restoreScope(userId, { [row.key]: value });

          for (const listener of listeners.current.get(row.key) ?? []) listener(value);
        }
      )
      .subscribe();

    return () => {
      getSupabase().removeChannel(channel);
    };
  }, [remote, hydrated, userId]);

  const value = useMemo(
    () => ({ remote, hydrated, syncState, push, dropRemote, subscribeRemote, flush }),
    [remote, hydrated, syncState, push, dropRemote, subscribeRemote, flush]
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
        <p className="font-mono text-label uppercase tracking-wide text-chalk-soft">
          Loading your books…
        </p>
      </div>
    );
  }

  return (
    <SyncContext.Provider value={value}>
      {/* Keyed on the account, so switching users remounts every store rather
          than asking each one to notice that the books underneath it changed. */}
      <React.Fragment key={userId ?? "local"}>{children}</React.Fragment>
    </SyncContext.Provider>
  );
};
