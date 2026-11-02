import { render, screen, renderHook, act, waitFor } from "@testing-library/react";
import { v4 as uuidv4 } from "uuid";
import { AuthProvider } from "./AuthContext";
import { SyncProvider, useSync } from "./SyncContext";
import { decryptDocument, encryptDocument, isEncryptedDocument, newMasterKey } from "../booksCrypto";
import { clearBooksKey, setBooksKey } from "../booksKey";
import { getStorageScope, readKey, setStorageScope, writeKey } from "../storage";

// Names must begin with `mock` — jest hoists the factory above the imports and
// refuses any other out-of-scope reference. Same shape as AuthContext.test.js,
// since this suite mounts the real AuthProvider above the real SyncProvider.
let mockConfigured = true;
let mockAuthListener;

const mockAuth = {
  getSession: jest.fn(),
  onAuthStateChange: jest.fn(),
  signOut: jest.fn(),
};

const mockDb = {
  from: jest.fn(),
  channel: jest.fn(),
  removeChannel: jest.fn(),
};

jest.mock("../supabaseClient", () => ({
  get isSupabaseConfigured() {
    return mockConfigured;
  },
  getSupabase: () => {
    if (!mockConfigured) return null;
    return {
      auth: mockAuth,
      from: (...args) => mockDb.from(...args),
      channel: (...args) => mockDb.channel(...args),
      removeChannel: (...args) => mockDb.removeChannel(...args),
    };
  },
}));

// SyncProvider now reads the active household from HouseholdContext, which is
// not mounted here. Mocking the hook keeps this suite focused on the wire,
// exactly as it mounts the real AuthProvider but mocks the Supabase client.
jest.mock("./HouseholdContext", () => ({
  useHousehold: () => ({ activeHouseholdId: "h1" }),
}));

const USER_ID = "u1";
const HOUSEHOLD_ID = "h1";
// The books cache is scoped by household now: `<uid>:<householdId>`.
const SCOPE = `${USER_ID}:${HOUSEHOLD_ID}`;

/**
 * What the server holds *after* hydrate, for the realtime handler's fetch of
 * the one row a notification names. Hydrate reads `rows` below instead, so a
 * test can stage the two moments separately.
 */
let mockServerRows = new Map();
let fetchRow;

/** A `.from("app_state")` stub covering select, upsert and delete in one shape. */
function fromStub({ rows = [], upsert, deleteError = null } = {}) {
  return {
    // `.eq("household_id")` is awaited whole on hydrate; the realtime handler
    // chains a second `.eq("key")` and `.maybeSingle()` onto it instead.
    select: () => ({
      eq: () => {
        const all = Promise.resolve({ data: rows, error: null });
        all.eq = (_column, key) => ({ maybeSingle: () => fetchRow(key) });
        return all;
      },
    }),
    upsert: upsert ?? jest.fn(() => Promise.resolve({ error: null })),
    delete: () => ({ eq: () => ({ in: () => Promise.resolve({ error: deleteError }) }) }),
  };
}

let capturedChannelCallback = null;

function stageChannel() {
  capturedChannelCallback = null;
  const channel = {
    on: jest.fn((_type, _filter, cb) => {
      capturedChannelCallback = cb;
      return channel;
    }),
    subscribe: jest.fn(() => channel),
  };
  mockDb.channel.mockReturnValue(channel);
  return channel;
}

beforeEach(() => {
  mockConfigured = true;
  localStorage.clear();
  setStorageScope(null);
  clearBooksKey();
  jest.clearAllMocks();

  mockAuth.onAuthStateChange.mockImplementation((listener) => {
    mockAuthListener = listener;
    return { data: { subscription: { unsubscribe: jest.fn() } } };
  });
  mockAuth.getSession.mockResolvedValue({
    data: { session: { user: { id: USER_ID, email: "jt@example.com" } } },
  });
  mockAuth.signOut.mockResolvedValue({ error: null });

  mockDb.from.mockReturnValue(fromStub());
  stageChannel();
  mockServerRows = new Map();
  fetchRow = jest.fn((key) => Promise.resolve({ data: mockServerRows.get(key) ?? null, error: null }));
});

/**
 * Another device's write, as this one hears about it: the row lands on the
 * server, and the broadcast names it — key, operation and the envelope's IV,
 * never the document. Not awaited by the race tests below, so the synchronous
 * part (the row landing) happens before the call returns its promise.
 */
function notify(key, value, op = "UPDATE") {
  if (op === "DELETE") mockServerRows.delete(key);
  else mockServerRows.set(key, { key, value });
  return capturedChannelCallback({
    type: "broadcast",
    event: "app_state_changed",
    payload: { key, op, iv: op === "DELETE" ? null : value?.iv ?? null },
  });
}

afterEach(() => setStorageScope(null));

const wrapper = ({ children }) => (
  <AuthProvider>
    <SyncProvider>{children}</SyncProvider>
  </AuthProvider>
);

/**
 * Mounts the real provider pair and waits for hydrate to finish.
 *
 * `hydrated` is `true` on the very first render, because `AuthProvider`'s own
 * session check is still "checking" at that point, `remote` reads false, and
 * the local books need no fetch. Waiting on `hydrated` alone would stop there,
 * before `remote` flips true and the real fetch-gated hydrate runs. `remote`
 * has to be asserted too.
 */
async function mountSync() {
  const view = renderHook(() => useSync(), { wrapper });
  await waitFor(() => {
    expect(view.result.current?.remote).toBe(true);
    expect(view.result.current?.hydrated).toBe(true);
  });
  return view;
}

async function freshKey() {
  const mk = await newMasterKey();
  const kid = uuidv4();
  setBooksKey(mk, kid);
  return { mk, kid };
}

test("a failed upload completing after logout cannot recreate its outbox", async () => {
  await freshKey();
  let finishUpload;
  const upsert = jest.fn(() => new Promise((resolve) => { finishUpload = resolve; }));
  mockDb.from.mockReturnValue(fromStub({ upsert }));
  const view = await mountSync();
  const old = view.result.current;
  act(() => old.push("budgets", [{ id: "private" }]));
  let upload;
  act(() => { upload = old.flush(); });
  await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
  await act(async () => mockAuthListener("SIGNED_OUT", null));
  await act(async () => {
    finishUpload({ error: { message: "network failure" } });
    expect((await upload).ok).toBe(false);
    old.push("budgets", [{ id: "late edit" }]);
    expect((await old.flush()).ok).toBe(false);
  });
  expect(localStorage.getItem("hb:u1:h1:pendingSync")).toBeNull();
  expect(localStorage.getItem("pendingSync")).toBeNull();
  expect(upsert).toHaveBeenCalledTimes(1);
});

// ---------------------------------------------------------------------------
// 1. The test the whole change exists to pass.
// ---------------------------------------------------------------------------

describe("switching scope", () => {
  /**
   * The render between the scope changing and the hydrate effect noticing.
   * `hydrated` used to be a bare boolean left `true` by the previous scope, so
   * in that render the stores mounted against the new household's still-empty
   * cache — and the dashboard, seeing no accounts and no categories, sent an
   * established household into setup.
   */
  test("never renders the books for a scope whose documents have not landed", async () => {
    let land;
    mockDb.from.mockReturnValue({
      ...fromStub(),
      select: () => ({ eq: () => new Promise((resolve) => (land = resolve)) }),
    });
    const seen = [];
    function Probe() {
      const sync = useSync();
      seen.push({ remote: sync.remote, scope: getStorageScope() });
      return <p>books</p>;
    }

    render(
      <AuthProvider>
        <SyncProvider>
          <Probe />
        </SyncProvider>
      </AuthProvider>
    );

    // Signed in, fetch outstanding: the gate is up, and nothing rendered the
    // books under the account's scope.
    await screen.findByText(/Loading your books/);
    expect(seen.some((render) => render.remote)).toBe(false);

    await act(async () => land({ data: [], error: null }));
    await screen.findByText("books");
    expect(seen.filter((render) => render.remote).every((render) => render.scope === SCOPE)).toBe(true);
  });
});

describe("what reaches the wire", () => {
  test("is an envelope and never a document", async () => {
    await freshKey();
    const upsert = jest.fn(() => Promise.resolve({ error: null }));
    mockDb.from.mockReturnValue(fromStub({ rows: [], upsert }));

    const { result } = await mountSync();

    const document = [{ id: "p1", name: "Alice's Diner", amountCents: 987654 }];
    act(() => result.current.push("payees", document));
    await act(async () => {
      await result.current.flush();
    });

    expect(upsert).toHaveBeenCalledTimes(1);
    const [rows] = upsert.mock.calls[0];
    expect(rows).toHaveLength(1);

    for (const row of rows) {
      expect(isEncryptedDocument(row.value)).toBe(true);
    }

    // No recognisable plaintext anywhere in what was actually sent.
    const wire = JSON.stringify(rows);
    expect(wire).not.toMatch(/Alice/);
    expect(wire).not.toMatch(/987654/);
    expect(wire).not.toMatch(/amountCents/);
  });
});

// ---------------------------------------------------------------------------
// 2. Fresh IV, and not an echo loop.
// ---------------------------------------------------------------------------

describe("sealing the same document twice", () => {
  test("produces different ciphertext, one write per flush", async () => {
    await freshKey();
    const upsert = jest.fn(() => Promise.resolve({ error: null }));
    mockDb.from.mockReturnValue(fromStub({ rows: [], upsert }));

    const { result } = await mountSync();

    act(() => result.current.push("budgets", [{ id: "b1" }]));
    await act(async () => {
      await result.current.flush();
    });
    expect(upsert).toHaveBeenCalledTimes(1);
    const first = upsert.mock.calls[0][0][0].value;

    // A real edit and then a real revert — "known" (plaintext) sees both as
    // changes, so both genuinely reach `flush`, which is what makes the two
    // ciphertexts comparable rather than the second push being suppressed as
    // unchanged.
    act(() => result.current.push("budgets", [{ id: "b1", extra: true }]));
    await act(async () => {
      await result.current.flush();
    });
    expect(upsert).toHaveBeenCalledTimes(2);

    act(() => result.current.push("budgets", [{ id: "b1" }]));
    await act(async () => {
      await result.current.flush();
    });
    expect(upsert).toHaveBeenCalledTimes(3);
    const third = upsert.mock.calls[2][0][0].value;

    // Same plaintext, two different seals.
    expect(third.ct).not.toBe(first.ct);
    expect(third.iv).not.toBe(first.iv);
  });
});

// ---------------------------------------------------------------------------
// 3. The self-migration.
// ---------------------------------------------------------------------------

describe("a plaintext row on the way in", () => {
  test("is accepted, renders, and is re-pushed sealed", async () => {
    await freshKey();
    const upsert = jest.fn(() => Promise.resolve({ error: null }));
    mockDb.from.mockReturnValue(
      fromStub({ rows: [{ key: "budgets", value: [{ id: "b1", name: "Groceries" }] }], upsert })
    );

    // `mountSync` only resolves once `hydrated` is true, which is the "renders
    // rather than refuses" half of the claim.
    const { result } = await mountSync();

    // The plaintext row is taken as-is — the cache holds it in the clear.
    const previousScope = getStorageScope();
    setStorageScope(SCOPE);
    expect(readKey("budgets")).toEqual([{ id: "b1", name: "Groceries" }]);
    setStorageScope(previousScope);

    // The self-migration already queued it; flushing directly (rather than
    // waiting on the real 700ms debounce) is what resync's own write rides on.
    await act(async () => {
      await result.current.flush();
    });

    expect(upsert).toHaveBeenCalled();
    const [rows] = upsert.mock.calls[0];
    const sent = rows.find((row) => row.key === "budgets");
    expect(isEncryptedDocument(sent.value)).toBe(true);
    expect(JSON.stringify(rows)).not.toMatch(/Groceries/);
  });

  test("an account with no rows at all is not migrated", async () => {
    await freshKey();
    const upsert = jest.fn(() => Promise.resolve({ error: null }));
    mockDb.from.mockReturnValue(fromStub({ rows: [], upsert }));

    const { result } = await mountSync();
    // Nothing was queued by a migration that should not have run — a flush
    // right now has nothing to send.
    let outcome;
    await act(async () => {
      outcome = await result.current.flush();
    });
    expect(outcome).toEqual({ ok: true });
    expect(upsert).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. An envelope that will not decrypt.
// ---------------------------------------------------------------------------

describe("an envelope that cannot be opened", () => {
  test("refuses the render instead of blanking a store", async () => {
    const { mk, kid } = await freshKey();
    const sealed = await encryptDocument(mk, kid, { id: "b1" });
    expect(sealed.ok).toBe(true);

    // Flip a character in the ciphertext so GCM's tag fails to verify.
    const tampered = {
      ...sealed.envelope,
      ct: sealed.envelope.ct.slice(0, -1) + (sealed.envelope.ct.endsWith("A") ? "B" : "A"),
    };

    mockDb.from.mockReturnValue(fromStub({ rows: [{ key: "budgets", value: tampered }] }));

    render(
      <AuthProvider>
        <SyncProvider>
          <div>mounted</div>
        </SyncProvider>
      </AuthProvider>
    );

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /could not load your books/i })).toBeInTheDocument()
    );
    expect(screen.queryByText("mounted")).not.toBeInTheDocument();
  });

  test("a mismatched kid refuses the render too", async () => {
    const { mk } = await freshKey();
    const sealed = await encryptDocument(mk, uuidv4(), { id: "b1" });
    // Unlock under a *different* kid than the one the envelope claims.
    setBooksKey(mk, uuidv4());

    mockDb.from.mockReturnValue(fromStub({ rows: [{ key: "budgets", value: sealed.envelope }] }));

    render(
      <AuthProvider>
        <SyncProvider>
          <div>mounted</div>
        </SyncProvider>
      </AuthProvider>
    );

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /could not load your books/i })).toBeInTheDocument()
    );
    expect(screen.queryByText("mounted")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 5. Receive.
// ---------------------------------------------------------------------------

describe("a realtime notification", () => {
  test("lands decrypted in the store", async () => {
    const { mk, kid } = await freshKey();
    mockDb.from.mockReturnValue(fromStub({ rows: [] }));

    const { result } = await mountSync();

    const listener = jest.fn();
    act(() => {
      result.current.subscribeRemote("budgets", listener);
    });

    const sealed = await encryptDocument(mk, kid, [{ id: "fromAnotherDevice" }]);
    await act(async () => {
      await notify("budgets", sealed.envelope);
    });

    expect(listener).toHaveBeenCalledWith([{ id: "fromAnotherDevice" }]);
    setStorageScope(SCOPE);
    expect(readKey("budgets")).toEqual([{ id: "fromAnotherDevice" }]);
    setStorageScope(null);
  });

  test("an undecryptable row is ignored, keeping what the store has", async () => {
    const { mk, kid } = await freshKey();
    mockDb.from.mockReturnValue(fromStub({ rows: [] }));

    const { result } = await mountSync();

    const listener = jest.fn();
    act(() => {
      result.current.subscribeRemote("budgets", listener);
    });

    // A good update first, so there is something to "keep".
    const good = await encryptDocument(mk, kid, [{ id: "good" }]);
    await act(async () => {
      await notify("budgets", good.envelope);
    });
    expect(listener).toHaveBeenCalledTimes(1);

    // Then a row sealed under a key this device does not hold.
    const otherMk = await newMasterKey();
    const bad = await encryptDocument(otherMk, uuidv4(), [{ id: "bad" }]);
    await act(async () => {
      await notify("budgets", bad.envelope);
    });

    // Ignored outright: no second call, and the cache still holds the good value.
    expect(listener).toHaveBeenCalledTimes(1);
    setStorageScope(SCOPE);
    expect(readKey("budgets")).toEqual([{ id: "good" }]);
    setStorageScope(null);
  });

  test("the DELETE branch is untouched — nothing to decrypt", async () => {
    await freshKey();
    mockDb.from.mockReturnValue(fromStub({ rows: [{ key: "budgets", value: [{ id: "b1" }] }] }));

    const { result } = await mountSync();
    // The plaintext row triggers a resync; flush it directly (rather than
    // waiting on the real 700ms debounce) so it is settled before asserting.
    await act(async () => {
      await result.current.flush();
    });

    const listener = jest.fn();
    act(() => {
      result.current.subscribeRemote("budgets", listener);
    });

    await act(async () => {
      await notify("budgets", undefined, "DELETE");
    });

    expect(listener).toHaveBeenCalledWith(undefined);
  });

  test("is heard on the household's private Broadcast topic, not Postgres Changes", async () => {
    await freshKey();
    await mountSync();

    expect(mockDb.channel).toHaveBeenCalledWith(`budget:app_state:${HOUSEHOLD_ID}`, { config: { private: true } });
    const channel = mockDb.channel.mock.results[0].value;
    expect(channel.on).toHaveBeenCalledWith("broadcast", { event: "app_state_changed" }, expect.any(Function));
    expect(channel.on).not.toHaveBeenCalledWith("postgres_changes", expect.anything(), expect.anything());
  });

  /**
   * The notification names a row and never carries one, so every remote change
   * costs a fetch — except our own write coming back, which the envelope's IV
   * identifies before any request is made. A different IV under the same key is
   * another device's write, and is fetched.
   */
  test("our own write echoed back costs no fetch; another device's does", async () => {
    const { mk, kid } = await freshKey();
    const upsert = jest.fn(() => Promise.resolve({ error: null }));
    mockDb.from.mockReturnValue(fromStub({ rows: [], upsert }));

    const { result } = await mountSync();
    const listener = jest.fn();
    act(() => {
      result.current.subscribeRemote("budgets", listener);
    });

    act(() => result.current.push("budgets", [{ id: "mine" }]));
    await act(async () => {
      await result.current.flush();
    });
    const [[[sent]]] = upsert.mock.calls;

    await act(async () => {
      await notify("budgets", sent.value);
    });
    expect(fetchRow).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();

    const theirs = await encryptDocument(mk, kid, [{ id: "theirs" }]);
    await act(async () => {
      await notify("budgets", theirs.envelope);
    });
    expect(fetchRow).toHaveBeenCalledWith("budgets");
    expect(listener).toHaveBeenCalledWith([{ id: "theirs" }]);
  });

  test("a row gone again by the time it is fetched changes nothing", async () => {
    const { mk, kid } = await freshKey();
    const { result } = await mountSync();
    const listener = jest.fn();
    act(() => {
      result.current.subscribeRemote("budgets", listener);
    });

    const sealed = await encryptDocument(mk, kid, [{ id: "brief" }]);
    fetchRow.mockResolvedValueOnce({ data: null, error: null });
    await act(async () => {
      await notify("budgets", sealed.envelope);
    });

    expect(listener).not.toHaveBeenCalled();
    setStorageScope(SCOPE);
    expect(readKey("budgets")).toBeUndefined();
    setStorageScope(null);
  });

  /**
   * **The two guards in this handler have to be asked again after the decrypt,
   * and these two tests are why.**
   *
   * The handler was synchronous before documents were sealed, so checking the
   * scope and the pending queue once *was* checking them at the moment of the
   * write. A decrypt is an `await`, which opens a window between the checks and
   * the write, and both of the things those checks protect against can really
   * land in it. Neither test can observe the re-check directly — what they
   * observe is the damage its absence would do.
   *
   * The call is deliberately not awaited until after the racing action: that is
   * what puts the action inside the handler's own suspension.
   */
  test("a local edit landing mid-decrypt is not overwritten by the server's copy", async () => {
    const { mk, kid } = await freshKey();
    mockDb.from.mockReturnValue(fromStub({ rows: [] }));

    const { result } = await mountSync();

    const listener = jest.fn();
    act(() => {
      result.current.subscribeRemote("budgets", listener);
    });

    // What the user already has on screen, written the way `useSyncedState`
    // writes it.
    //
    // The scope is put **back** rather than set to null, which is not
    // housekeeping: the provider owns that module state and has it on this
    // account, and leaving it null here would trip the handler's *pre-await*
    // scope guard so the decrypt never ran — passing this test while proving
    // nothing about the window after it.
    const previousScope = getStorageScope();
    setStorageScope(SCOPE);
    writeKey("budgets", [{ id: "typedHere" }]);
    setStorageScope(previousScope);

    const sealed = await encryptDocument(mk, kid, [{ id: "fromTheServer" }]);

    await act(async () => {
      const inFlight = notify("budgets", sealed.envelope);
      // The user types while that decrypt is in flight.
      result.current.push("budgets", [{ id: "typedHere" }]);
      await inFlight;
    });

    // The server's older copy must not have won: no listener fired, and the
    // cache still holds what the user can see.
    expect(listener).not.toHaveBeenCalled();
    setStorageScope(SCOPE);
    expect(readKey("budgets")).toEqual([{ id: "typedHere" }]);
    setStorageScope(null);
  });

  test("a sign-out landing mid-decrypt does not write the row back", async () => {
    const { mk, kid } = await freshKey();
    mockDb.from.mockReturnValue(fromStub({ rows: [] }));

    const { result, unmount } = await mountSync();

    const listener = jest.fn();
    act(() => {
      result.current.subscribeRemote("budgets", listener);
    });

    const sealed = await encryptDocument(mk, kid, [{ id: "fromTheServer" }]);

    await act(async () => {
      const inFlight = notify("budgets", sealed.envelope);

      // Sign-out, as this handler actually experiences it: the tree goes and
      // the cache moves off the account, a commit before the channel is torn
      // down — which is the gap the original comment in `SyncContext` names.
      //
      // **Unmounted before the scope is moved, and that ordering is what makes
      // this test deterministic rather than flaky.** The provider re-asserts
      // the scope *during render* (`if (getStorageScope() !== scope)`), so a
      // bare `setStorageScope(null)` here races any render React still has in
      // flight: under full-suite load one would interleave, put the scope
      // back, and the row would be written after all. Unmounting first means
      // there is no render left to undo it.
      unmount();
      setStorageScope(null);
      await inFlight;
    });

    expect(listener).not.toHaveBeenCalled();
    setStorageScope(SCOPE);
    expect(readKey("budgets")).toBeUndefined();
    setStorageScope(null);
  });
});

// ---------------------------------------------------------------------------
// 6. No key, no send.
// ---------------------------------------------------------------------------

describe("flushing with no key unlocked", () => {
  test("queues rather than sending", async () => {
    const upsert = jest.fn(() => Promise.resolve({ error: null }));
    mockDb.from.mockReturnValue(fromStub({ rows: [], upsert }));

    const { result } = await mountSync();
    // Deliberately no `setBooksKey` call — the device is locked.

    act(() => result.current.push("budgets", [{ id: "b1" }]));

    let outcome;
    await act(async () => {
      outcome = await result.current.flush();
    });

    expect(outcome.ok).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
    expect(result.current.syncState).toBe("offline");
  });
});
