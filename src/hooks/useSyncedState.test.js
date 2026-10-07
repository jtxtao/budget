import { act, renderHook } from "@testing-library/react";
import useSyncedState from "./useSyncedState";
import { SyncContext, canonicalJSON } from "../contexts/SyncContext";
import { setStorageScope } from "../storage";

beforeEach(() => {
  localStorage.clear();
  setStorageScope(null);
  jest.restoreAllMocks();
});

afterEach(() => setStorageScope(null));

// ---------------------------------------------------------------------------
// Local behaviour — the whole of what `useLocalStorage` used to do, and what
// this hook must still do with no sync layer above it. That is not a legacy
// path: it is an unconfigured build, a signed-out session, and every store test
// in the suite, all of which mount `AppProviders` with no provider above them.
// ---------------------------------------------------------------------------

test("reads an existing value out of storage", () => {
  localStorage.setItem("k", JSON.stringify([1, 2, 3]));
  const { result } = renderHook(() => useSyncedState("k", []));
  expect(result.current[0]).toEqual([1, 2, 3]);
});

test("falls back to the default when the key is absent", () => {
  const { result } = renderHook(() => useSyncedState("k", ["fallback"]));
  expect(result.current[0]).toEqual(["fallback"]);
});

test("supports the lazy default-value form", () => {
  const { result } = renderHook(() => useSyncedState("k", () => ({ made: "lazily" })));
  expect(result.current[0]).toEqual({ made: "lazily" });
});

test("persists updates, including the functional-updater form", () => {
  const { result } = renderHook(() => useSyncedState("k", []));

  act(() => result.current[1](["first"]));
  expect(JSON.parse(localStorage.getItem("k"))).toEqual(["first"]);

  act(() => result.current[1]((prev) => [...prev, "second"]));
  expect(result.current[0]).toEqual(["first", "second"]);
  expect(JSON.parse(localStorage.getItem("k"))).toEqual(["first", "second"]);
});

describe("surviving bad storage", () => {
  test("corrupt JSON falls back to the default instead of throwing", () => {
    localStorage.setItem("k", "{not json at all");
    const { result } = renderHook(() => useSyncedState("k", ["safe"]));
    expect(result.current[0]).toEqual(["safe"]);
  });

  test("the corrupt key is cleared so the failure does not repeat forever", () => {
    localStorage.setItem("k", "{not json at all");
    renderHook(() => useSyncedState("k", ["safe"]));
    // re-seeded by the write effect rather than left in its unreadable state
    expect(JSON.parse(localStorage.getItem("k"))).toEqual(["safe"]);
  });

  test("a throwing getItem does not take down the render", () => {
    jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied");
    });
    const { result } = renderHook(() => useSyncedState("k", ["safe"]));
    expect(result.current[0]).toEqual(["safe"]);
  });

  test("a throwing setItem does not take down the render", () => {
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    const { result } = renderHook(() => useSyncedState("k", []));
    act(() => result.current[1](["still works in memory"]));
    expect(result.current[0]).toEqual(["still works in memory"]);
  });
});

describe("cross-tab sync", () => {
  function writeFromAnotherTab(key, newValue) {
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key, newValue, storageArea: localStorage })
      );
    });
  }

  test("a write in another tab updates this one", () => {
    const { result } = renderHook(() => useSyncedState("k", []));
    writeFromAnotherTab("k", JSON.stringify(["from the other tab"]));
    expect(result.current[0]).toEqual(["from the other tab"]);
  });

  test("a different key is ignored", () => {
    const { result } = renderHook(() => useSyncedState("k", ["mine"]));
    writeFromAnotherTab("somethingElse", JSON.stringify(["not mine"]));
    expect(result.current[0]).toEqual(["mine"]);
  });

  test("clearing the key in another tab restores the default", () => {
    localStorage.setItem("k", JSON.stringify(["present"]));
    const { result } = renderHook(() => useSyncedState("k", ["default"]));
    expect(result.current[0]).toEqual(["present"]);

    writeFromAnotherTab("k", null);
    expect(result.current[0]).toEqual(["default"]);
  });

  test("unreadable data from another tab leaves the current value alone", () => {
    const { result } = renderHook(() => useSyncedState("k", ["mine"]));
    writeFromAnotherTab("k", "{garbage");
    expect(result.current[0]).toEqual(["mine"]);
  });

  test("the listener is removed on unmount", () => {
    const remove = jest.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useSyncedState("k", []));
    unmount();
    expect(remove).toHaveBeenCalledWith("storage", expect.any(Function));
  });

  // The event carries the *scoped* key once someone is signed in, so a hook
  // watching the bare name would miss every cross-tab write for that account.
  test("the watched key follows the storage scope", () => {
    setStorageScope("user-1");
    const { result } = renderHook(() => useSyncedState("k", ["mine"]));

    writeFromAnotherTab("k", JSON.stringify(["unscoped"]));
    expect(result.current[0]).toEqual(["mine"]);

    writeFromAnotherTab("hb:user-1:k", JSON.stringify(["scoped"]));
    expect(result.current[0]).toEqual(["scoped"]);
  });
});

describe("migration", () => {
  test("migrate runs on values read from storage", () => {
    localStorage.setItem("k", JSON.stringify([{ amount: 5 }]));
    const migrate = (records) => records.map((r) => ({ amountCents: r.amount * 100 }));
    const { result } = renderHook(() => useSyncedState("k", [], migrate));
    expect(result.current[0]).toEqual([{ amountCents: 500 }]);
  });

  test("migrate does not run on the default value", () => {
    const migrate = jest.fn((v) => v);
    renderHook(() => useSyncedState("k", ["untouched"], migrate));
    expect(migrate).not.toHaveBeenCalled();
  });

  test("a migration that throws falls back to the default rather than crashing", () => {
    localStorage.setItem("k", JSON.stringify([{ shape: "unexpected" }]));
    const migrate = () => {
      throw new TypeError("cannot read property of undefined");
    };
    const { result } = renderHook(() => useSyncedState("k", ["safe"], migrate));
    expect(result.current[0]).toEqual(["safe"]);
  });
});

// ---------------------------------------------------------------------------
// The sync layer. Staged rather than driven through a real SyncProvider,
// because what is worth pinning here is the hook's half of the contract: what
// it sends, and what it does with what arrives.
// ---------------------------------------------------------------------------

describe("with a sync layer", () => {
  function withSync(overrides = {}) {
    const push = jest.fn();
    const remoteListeners = new Map();
    const subscribeRemote = jest.fn((key, listener) => {
      remoteListeners.set(key, listener);
      return () => remoteListeners.delete(key);
    });

    const value = { remote: true, hydrated: true, push, subscribeRemote, ...overrides };
    const wrapper = ({ children }) => (
      <SyncContext.Provider value={value}>{children}</SyncContext.Provider>
    );

    return { wrapper, push, subscribeRemote, remoteListeners };
  }

  test("the value is pushed on mount and on every change", () => {
    const { wrapper, push } = withSync();
    const { result } = renderHook(() => useSyncedState("budgets", []), { wrapper });

    expect(push).toHaveBeenCalledWith("budgets", []);

    act(() => result.current[1]([{ id: "b1" }]));
    expect(push).toHaveBeenLastCalledWith("budgets", [{ id: "b1" }]);
  });

  // Local first: the books have to be on screen whether or not the wire is
  // working, which is what makes an offline edit a delay rather than a loss.
  test("the local cache is written even though the value is pushed", () => {
    const { wrapper } = withSync();
    const { result } = renderHook(() => useSyncedState("budgets", []), { wrapper });

    act(() => result.current[1]([{ id: "b1" }]));
    expect(JSON.parse(localStorage.getItem("budgets"))).toEqual([{ id: "b1" }]);
  });

  test("a change from another device lands in the store, migrated", () => {
    const { wrapper, remoteListeners } = withSync();
    const migrate = (records) => records.map((r) => ({ ...r, migrated: true }));
    const { result } = renderHook(() => useSyncedState("budgets", [], migrate), { wrapper });

    act(() => remoteListeners.get("budgets")([{ id: "b2" }]));
    expect(result.current[0]).toEqual([{ id: "b2", migrated: true }]);
  });

  test("a document deleted on another device restores the default", () => {
    localStorage.setItem("budgets", JSON.stringify([{ id: "b1" }]));
    const { wrapper, remoteListeners } = withSync();
    const { result } = renderHook(() => useSyncedState("budgets", ["default"]), { wrapper });

    act(() => remoteListeners.get("budgets")(undefined));
    expect(result.current[0]).toEqual(["default"]);
  });

  // A device running a later build can write a shape this one cannot read.
  // Blanking the store would be the one unrecoverable response; the server's
  // copy is untouched either way.
  test("an unreadable remote change leaves the current value alone", () => {
    const { wrapper, remoteListeners } = withSync();
    const migrate = (v) => {
      if (v?.[0]?.fromTheFuture) throw new TypeError("unknown shape");
      return v;
    };
    const { result } = renderHook(() => useSyncedState("budgets", [{ id: "mine" }], migrate), {
      wrapper,
    });

    act(() => remoteListeners.get("budgets")([{ fromTheFuture: true }]));
    expect(result.current[0]).toEqual([{ id: "mine" }]);
  });

  test("the remote subscription is dropped on unmount", () => {
    const { wrapper, remoteListeners } = withSync();
    const { unmount } = renderHook(() => useSyncedState("budgets", []), { wrapper });

    expect(remoteListeners.has("budgets")).toBe(true);
    unmount();
    expect(remoteListeners.has("budgets")).toBe(false);
  });
});

describe("canonicalJSON", () => {
  // The server stores documents as jsonb, which hands keys back in its own
  // order. Comparing by plain JSON.stringify read our own write, echoed back,
  // as a change from another device — and re-pushed it, for ever.
  test("one document serialises the same whatever order its keys arrive in", () => {
    const sent = { name: "Rent", plannedCents: 150000, nested: { b: 1, a: [{ y: 2, x: 1 }] } };
    const echoed = { nested: { a: [{ x: 1, y: 2 }], b: 1 }, plannedCents: 150000, name: "Rent" };

    expect(JSON.stringify(sent)).not.toBe(JSON.stringify(echoed));
    expect(canonicalJSON(sent)).toBe(canonicalJSON(echoed));
  });

  test("array order still matters, since it is display order", () => {
    expect(canonicalJSON([1, 2])).not.toBe(canonicalJSON([2, 1]));
  });
});
