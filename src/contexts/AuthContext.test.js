import { render, screen, waitFor } from "@testing-library/react";
import { renderHook, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider, describeAuthError, useAuth, AUTH_STATUS } from "./AuthContext";
import AuthGate from "../components/AuthGate";
import { routerFuture } from "../routerFuture";
import { SyncProvider } from "./SyncContext";
import {
  getStorageScope,
  GUEST_SCOPE,
  isGuestMode,
  readKey,
  restoreScope,
  setGuestMode,
  setStorageScope,
} from "../storage";

// Names must begin with `mock` — jest hoists the factory above the imports and
// refuses any other out-of-scope reference.
let mockConfigured = true;
let mockAuthListener = null;
// Every time something reached for the client. In the real module that is what
// *builds* one, so an empty list is the whole of the local-mode claim.
let mockClientBuilds = [];

const mockAuth = {
  getSession: jest.fn(),
  onAuthStateChange: jest.fn(),
  signUp: jest.fn(),
  signInWithPassword: jest.fn(),
  signOut: jest.fn(),
  resetPasswordForEmail: jest.fn(),
  updateUser: jest.fn(),
};

// The db half, needed only by the tests that mount `SyncProvider` — which
// hydrates and subscribes the moment a session exists.
const mockDb = {
  from: jest.fn(),
  channel: jest.fn(),
  removeChannel: jest.fn(),
};

// A plain function rather than a `jest.fn`, because react-scripts sets
// `resetMocks: true` and would wipe the implementation before every test.
jest.mock("../supabaseClient", () => ({
  get isSupabaseConfigured() {
    return mockConfigured;
  },
  getSupabase: () => {
    if (!mockConfigured) return null;
    mockClientBuilds.push(Date.now());
    return {
      auth: mockAuth,
      from: (...args) => mockDb.from(...args),
      channel: (...args) => mockDb.channel(...args),
      removeChannel: (...args) => mockDb.removeChannel(...args),
    };
  },
}));

beforeEach(() => {
  mockConfigured = true;
  mockAuthListener = null;
  mockClientBuilds = [];
  localStorage.clear();
  setStorageScope(null);
  // Unscoped, absent from STORE_KEYS, and deliberately outlives `clearScope` —
  // so `localStorage.clear()` is what has to take it, and a test that forgot
  // would leak local mode into the one after it.
  setGuestMode(false);
  jest.clearAllMocks();
  // react-scripts sets `resetMocks: true`, which wipes implementations as well
  // as calls before every test — so every one of these has to be re-staged
  // here rather than at module scope.
  mockAuth.onAuthStateChange.mockImplementation((cb) => {
    mockAuthListener = cb;
    return { data: { subscription: { unsubscribe: jest.fn() } } };
  });
  mockAuth.getSession.mockResolvedValue({ data: { session: null } });
  mockAuth.signUp.mockResolvedValue({ data: { session: null, user: { id: "u1" } }, error: null });
  mockAuth.signInWithPassword.mockResolvedValue({ data: {}, error: null });
  mockAuth.signOut.mockResolvedValue({ error: null });
  mockAuth.resetPasswordForEmail.mockResolvedValue({ error: null });
  mockAuth.updateUser.mockResolvedValue({ error: null });

  // An account with nothing in it yet. The hydrate is one query, and the
  // realtime channel is chained, so both are staged as their own shapes.
  mockDb.from.mockReturnValue({
    select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
  });
  const channel = { on: jest.fn(() => channel), subscribe: jest.fn(() => channel) };
  mockDb.channel.mockReturnValue(channel);
});

afterEach(() => setStorageScope(null));

const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;

async function mountAuth() {
  const view = renderHook(() => useAuth(), { wrapper });
  await waitFor(() => expect(view.result.current.status).not.toBe(AUTH_STATUS.CHECKING));
  return view;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

describe("status", () => {
  // A persisted session is read back asynchronously, so treating the gap as
  // signed out would flash the sign-in form at every returning user on every
  // reload. "Checking" is a real state, not a synonym for signed out.
  test("starts by checking rather than by assuming signed out", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.status).toBe(AUTH_STATUS.CHECKING);
    // Settle the pending lookup before the test ends, or its state update lands
    // outside act — and assert the transition while we are here.
    await waitFor(() => expect(result.current.status).toBe(AUTH_STATUS.SIGNED_OUT));
  });

  test("an existing session resolves to signed in", async () => {
    mockAuth.getSession.mockResolvedValue({
      data: { session: { user: { id: "u1", email: "jt@example.com" } } },
    });
    const { result } = await mountAuth();

    expect(result.current.status).toBe(AUTH_STATUS.SIGNED_IN);
    expect(result.current.email).toBe("jt@example.com");
    expect(result.current.userId).toBe("u1");
  });

  // Offline at boot with no cached session. Signed out is the honest reading,
  // and it must not leave the app stuck on "checking" forever.
  test("a failed session lookup resolves to signed out rather than hanging", async () => {
    mockAuth.getSession.mockRejectedValue(new Error("offline"));
    const { result } = await mountAuth();
    expect(result.current.status).toBe(AUTH_STATUS.SIGNED_OUT);
  });

  test("an unconfigured build is local-only and never checks", () => {
    mockConfigured = false;
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.status).toBe(AUTH_STATUS.LOCAL_ONLY);
  });
});

// ---------------------------------------------------------------------------
// Validation — checked before the network, so a typo costs no round trip and
// the wording is ours rather than the API's.
// ---------------------------------------------------------------------------

describe("sign-up validation", () => {
  test("a mismatched confirmation is refused without calling the API", async () => {
    const { result } = await mountAuth();

    let outcome;
    await act(async () => {
      outcome = await result.current.signUp({
        email: "jt@example.com",
        password: "correct-horse",
        confirmation: "correct-hoarse",
      });
    });

    expect(outcome).toEqual({ ok: false, error: "The two passwords do not match." });
    expect(mockAuth.signUp).not.toHaveBeenCalled();
  });

  test("a short password is refused", async () => {
    const { result } = await mountAuth();

    let outcome;
    await act(async () => {
      outcome = await result.current.signUp({
        email: "jt@example.com",
        password: "short",
        confirmation: "short",
      });
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/at least 8 characters/i);
    expect(mockAuth.signUp).not.toHaveBeenCalled();
  });

  test("junk in the email field is refused", async () => {
    const { result } = await mountAuth();

    let outcome;
    await act(async () => {
      outcome = await result.current.signUp({
        email: "not-an-email",
        password: "correct-horse",
        confirmation: "correct-horse",
      });
    });

    expect(outcome).toEqual({ ok: false, error: "Enter a valid email address." });
  });

  // With confirmation on, sign-up returns a user and no session: the account
  // exists but cannot be used yet, and the form has to say so rather than
  // dropping the person on a sign-in screen that will reject them.
  test("a sign-up needing confirmation reports it", async () => {
    const { result } = await mountAuth();

    let outcome;
    await act(async () => {
      outcome = await result.current.signUp({
        email: "  jt@example.com  ",
        password: "correct-horse",
        confirmation: "correct-horse",
      });
    });

    expect(outcome).toEqual({ ok: true, confirmationRequired: true });
    expect(result.current.pendingConfirmation).toBe("jt@example.com");
    // Trimmed on the way to the API, or the address never matches on sign-in.
    // Asserted whole, this suite's rule: `emailRedirectTo` is what sends the
    // confirmation link back to the app that asked rather than to the project's
    // single Site URL, which matters because the project behind it also serves
    // another app. jsdom's origin is "http://localhost".
    expect(mockAuth.signUp).toHaveBeenCalledWith({
      email: "jt@example.com",
      password: "correct-horse",
      options: { emailRedirectTo: "http://localhost" },
    });
  });
});

describe("sign-in", () => {
  test("an API failure comes back as a sentence, not a log line", async () => {
    mockAuth.signInWithPassword.mockResolvedValue({
      error: { message: "Invalid login credentials" },
    });
    const { result } = await mountAuth();

    let outcome;
    await act(async () => {
      outcome = await result.current.signIn({ email: "jt@example.com", password: "wrong-one" });
    });

    expect(outcome).toEqual({
      ok: false,
      error: "That email and password do not match an account.",
    });
  });

  test("a missing password is refused before the network", async () => {
    const { result } = await mountAuth();

    let outcome;
    await act(async () => {
      outcome = await result.current.signIn({ email: "jt@example.com", password: "" });
    });

    expect(outcome).toEqual({ ok: false, error: "Enter your password." });
    expect(mockAuth.signInWithPassword).not.toHaveBeenCalled();
  });
});

describe("sign-out", () => {
  // The reason the cache is namespaced at all: the books have to leave the
  // browser with the session, or the next person to open the app on this
  // machine reads the last one's ledger straight out of the cache.
  test("it takes the account's books out of this browser", async () => {
    mockAuth.getSession.mockResolvedValue({
      data: { session: { user: { id: "u1", email: "jt@example.com" } } },
    });
    restoreScope("u1", { budgets: [{ id: "b1" }], transactions: [{ id: "t1" }] });

    const { result } = await mountAuth();
    await act(async () => {
      await result.current.signOut();
    });

    setStorageScope("u1");
    expect(readKey("budgets")).toBeUndefined();
    expect(readKey("transactions")).toBeUndefined();
    expect(mockAuth.signOut).toHaveBeenCalled();
  });

  test("the browser's own unscoped books are left alone", async () => {
    mockAuth.getSession.mockResolvedValue({
      data: { session: { user: { id: "u1", email: "jt@example.com" } } },
    });
    setStorageScope(null);
    localStorage.setItem("budgets", JSON.stringify([{ id: "local" }]));

    const { result } = await mountAuth();
    await act(async () => {
      await result.current.signOut();
    });

    setStorageScope(null);
    expect(readKey("budgets")).toEqual([{ id: "local" }]);
  });
});

// ---------------------------------------------------------------------------
// Local mode
//
// `GUEST` existed as a status, `GUEST_SCOPE` and `setGuestMode` existed in
// storage with long docstrings, and nothing anywhere called them. These are the
// tests for the seam once it is joined up.
// ---------------------------------------------------------------------------

describe("local mode", () => {
  test("choosing it is remembered, so a reload does not undo the choice", async () => {
    const { result } = await mountAuth();

    act(() => {
      result.current.continueLocally();
    });

    expect(result.current.status).toBe(AUTH_STATUS.GUEST);
    expect(isGuestMode()).toBe(true);
  });

  /**
   * The boot-time `getSession` resolves *after* the status was read
   * synchronously, and it used to overwrite it — so a household that had
   * declined an account was shown the sign-in form again on every single
   * reload, which reads as the choice having been revoked.
   */
  test("the session lookup resolving does not bounce a guest to the sign-in form", async () => {
    setGuestMode(true);

    const { result } = await mountAuth();

    expect(result.current.status).toBe(AUTH_STATUS.GUEST);
  });

  test("turning sync on comes back to the form and leaves the books alone", async () => {
    setGuestMode(true);
    restoreScope(GUEST_SCOPE, { budgets: [{ id: "b1" }] });

    const { result } = await mountAuth();
    await act(async () => {
      result.current.leaveLocalMode();
    });

    expect(result.current.status).toBe(AUTH_STATUS.SIGNED_OUT);
    expect(isGuestMode()).toBe(false);

    // Leaving local mode starts the session lookup that was being skipped;
    // settling it here keeps its state update inside `act`.
    await act(async () => {});

    setStorageScope(GUEST_SCOPE);
    expect(readKey("budgets")).toEqual([{ id: "b1" }]);
  });

  // An unconfigured build has no account to decline, so there is no mode to
  // enter — and `AUTH_STATUS.LOCAL_ONLY` already says what is true of it.
  test("an unconfigured build cannot enter it, because it is already local", async () => {
    mockConfigured = false;

    const { result } = await mountAuth();
    act(() => {
      result.current.continueLocally();
    });

    expect(result.current.status).toBe(AUTH_STATUS.LOCAL_ONLY);
    expect(isGuestMode()).toBe(false);
  });
});

describe("stopping sync", () => {
  function signedIn() {
    mockAuth.getSession.mockResolvedValue({
      data: { session: { user: { id: "u1", email: "jt@example.com" } } },
    });
  }

  /**
   * The whole point of the pair. `signOut` deletes the books with the session,
   * which is right on a shared browser and is an extremely wrong answer to "I
   * would rather my ledger were not on a server".
   */
  test("the account's books come down into local mode and the session ends", async () => {
    signedIn();
    restoreScope("u1", { budgets: [{ id: "b1" }], transactions: [{ id: "t1" }] });

    const { result } = await mountAuth();
    await act(async () => {
      await result.current.stopSyncing();
    });

    setStorageScope(GUEST_SCOPE);
    expect(readKey("budgets")).toEqual([{ id: "b1" }]);
    expect(readKey("transactions")).toEqual([{ id: "t1" }]);

    setStorageScope("u1");
    expect(readKey("budgets")).toBeUndefined();

    expect(mockAuth.signOut).toHaveBeenCalled();
    expect(isGuestMode()).toBe(true);
  });

  /**
   * The sign-out raises a `SIGNED_OUT` event, and reading that as "signed out"
   * would drop the user on the sign-in form one tick after they asked to keep
   * working locally.
   */
  test("the sign-out it causes lands in local mode, not on the sign-in form", async () => {
    signedIn();
    const { result } = await mountAuth();

    await act(async () => {
      await result.current.stopSyncing();
    });
    act(() => {
      mockAuthListener("SIGNED_OUT", null);
    });

    expect(result.current.status).toBe(AUTH_STATUS.GUEST);
  });

  // A stale copy from before this account signed in must not survive under the
  // account's newer books — but it is still somebody's data, so it goes out as
  // a file before it is replaced.
  test("books already in local mode are replaced, not merged, and written out first", async () => {
    signedIn();
    restoreScope("u1", { budgets: [{ id: "fromTheAccount" }] });
    restoreScope(GUEST_SCOPE, { budgets: [{ id: "stale" }], savingsGoals: [{ id: "g1" }] });

    const clicks = [];
    URL.createObjectURL = jest.fn(() => "blob:books");
    URL.revokeObjectURL = jest.fn();
    jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function record() {
      clicks.push(this.download);
    });

    const { result } = await mountAuth();
    await act(async () => {
      await result.current.stopSyncing();
    });

    expect(clicks).toEqual([expect.stringContaining("replaced-local-copy")]);

    setStorageScope(GUEST_SCOPE);
    expect(readKey("budgets")).toEqual([{ id: "fromTheAccount" }]);
    // The account has no savings goals, so neither does local mode now.
    expect(readKey("savingsGoals")).toBeUndefined();
  });

  test("it refuses when there is no session rather than moving nothing", async () => {
    const { result } = await mountAuth();

    let outcome;
    await act(async () => {
      outcome = await result.current.stopSyncing();
    });

    expect(outcome.ok).toBe(false);
    expect(mockAuth.signOut).not.toHaveBeenCalled();
  });
});

describe("password recovery", () => {
  test("the recovery event puts the app into recovery", async () => {
    const { result } = await mountAuth();
    expect(result.current.recovering).toBe(false);

    act(() => {
      mockAuthListener("PASSWORD_RECOVERY", { user: { id: "u1", email: "jt@example.com" } });
    });

    expect(result.current.recovering).toBe(true);
  });

  test("saving a new password ends recovery", async () => {
    const { result } = await mountAuth();
    act(() => {
      mockAuthListener("PASSWORD_RECOVERY", { user: { id: "u1", email: "jt@example.com" } });
    });

    await act(async () => {
      await result.current.updatePassword({
        password: "a-new-long-one",
        confirmation: "a-new-long-one",
      });
    });

    expect(result.current.recovering).toBe(false);
  });

  test("a mismatched confirmation does not end recovery", async () => {
    const { result } = await mountAuth();
    act(() => {
      mockAuthListener("PASSWORD_RECOVERY", { user: { id: "u1" } });
    });

    let outcome;
    await act(async () => {
      outcome = await result.current.updatePassword({
        password: "a-new-long-one",
        confirmation: "a-different-one",
      });
    });

    expect(outcome.ok).toBe(false);
    expect(result.current.recovering).toBe(true);
    expect(mockAuth.updateUser).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// describeAuthError — the one place an API string becomes a sentence, so two
// forms cannot word the same failure differently.
// ---------------------------------------------------------------------------

describe("describeAuthError", () => {
  test.each([
    ["Invalid login credentials", /do not match an account/],
    ["User already registered", /already exists.*Sign in instead/],
    ["Email not confirmed", /Confirm your email address first/],
    ["Failed to fetch", /Could not reach the server/],
  ])("%s becomes a sentence for a person", (message, expected) => {
    expect(describeAuthError({ message })).toMatch(expected);
  });

  // An unrecognised message is more use to the person stuck behind it than a
  // generic apology would be.
  test("an unrecognised message is passed through rather than swallowed", () => {
    expect(describeAuthError({ message: "Some new failure mode" })).toBe("Some new failure mode");
  });

  test("no error is no message", () => {
    expect(describeAuthError(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

describe("AuthGate", () => {
  // The session lookup is a promise resolved in an effect, so it has to be
  // settled *inside* act or its state update lands after the test and React
  // warns. Awaiting an empty act flushes the microtask queue under act's
  // supervision, which is what makes the assertions below plain and
  // synchronous.
  async function renderGate() {
    const view = render(
      <MemoryRouter future={routerFuture}>
        <AuthProvider>
          <AuthGate>
            <p>the books</p>
          </AuthGate>
        </AuthProvider>
      </MemoryRouter>
    );
    await act(async () => {});
    return view;
  }

  test("signed out, it shows the way in rather than the books", async () => {
    await renderGate();
    expect(screen.getByRole("heading", { level: 1, name: /sign in/i })).toBeInTheDocument();
    expect(screen.queryByText("the books")).not.toBeInTheDocument();
  });

  test("signed in, it shows the books", async () => {
    mockAuth.getSession.mockResolvedValue({
      data: { session: { user: { id: "u1", email: "jt@example.com" } } },
    });
    await renderGate();
    expect(screen.getByText("the books")).toBeInTheDocument();
  });

  // An unconfigured build has no accounts to gate on, and this is the path the
  // rest of the suite runs: every store test mounts AppProviders with no
  // session above it.
  test("an unconfigured build renders straight through", async () => {
    mockConfigured = false;
    await renderGate();
    expect(screen.getByText("the books")).toBeInTheDocument();
  });

  // A reset link *signs you in* — that is how the change is authorised — so a
  // gate that checked the session first would drop someone who just clicked "I
  // forgot my password" onto the dashboard and never ask for a new one.
  test("a guest sees the books, not the way in", async () => {
    setGuestMode(true);

    render(
      <MemoryRouter future={routerFuture}>
        <AuthProvider>
          <AuthGate>
            <div>the books</div>
          </AuthGate>
        </AuthProvider>
      </MemoryRouter>
    );
    await act(async () => {});

    expect(screen.getByText("the books")).toBeInTheDocument();
  });

  test("recovery beats a live session", async () => {
    mockAuth.getSession.mockResolvedValue({
      data: { session: { user: { id: "u1", email: "jt@example.com" } } },
    });
    await renderGate();
    expect(screen.getByText("the books")).toBeInTheDocument();

    act(() => {
      mockAuthListener("PASSWORD_RECOVERY", { user: { id: "u1", email: "jt@example.com" } });
    });

    expect(
      screen.getByRole("heading", { level: 1, name: /choose a new password/i })
    ).toBeInTheDocument();
    expect(screen.queryByText("the books")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Which books a guest is given
//
// The bug this closes was latent rather than theoretical: `SyncContext` read
// `remote ? userId : null`, so the first caller of `setGuestMode` would have
// handed a guest the *unscoped* documents — this browser's own pre-account
// books — which is the precise collision `GUEST_SCOPE` was written to prevent.
// ---------------------------------------------------------------------------

describe("the scope a guest runs in", () => {
  function mountTree() {
    return render(
      <AuthProvider>
        <SyncProvider>
          <div>mounted</div>
        </SyncProvider>
      </AuthProvider>
    );
  }

  test("a guest gets their own scope, not the browser's pre-account books", async () => {
    setGuestMode(true);
    localStorage.setItem("budgets", JSON.stringify([{ id: "thisBrowsersOwn" }]));

    mountTree();
    await act(async () => {});

    expect(getStorageScope()).toBe(GUEST_SCOPE);
    // Untouched, and unreachable from where the guest is now typing.
    setStorageScope(null);
    expect(readKey("budgets")).toEqual([{ id: "thisBrowsersOwn" }]);
  });

  /**
   * The third case, and not the same as the second: an unconfigured build is a
   * fact about the *build*. There was never an account to decline, and the bare
   * keys are the books the app has always kept — which is also how the whole
   * test suite runs.
   */
  test("an unconfigured build stays unscoped", async () => {
    mockConfigured = false;

    mountTree();
    await act(async () => {});

    expect(getStorageScope()).toBe(null);
  });

  test("a signed-in account gets its own scope", async () => {
    mockAuth.getSession.mockResolvedValue({
      data: { session: { user: { id: "u1", email: "jt@example.com" } } },
    });

    mountTree();
    await waitFor(() => expect(getStorageScope()).toBe("u1"));
  });
});

// ---------------------------------------------------------------------------
// What local mode does not do
//
// The sign-in page tells a desktop household that nothing is sent anywhere.
// These are the tests that make that a fact about the code rather than a claim
// in a paragraph: in local mode nothing ever reaches for the client, and
// reaching for it is what builds one.
// ---------------------------------------------------------------------------

describe("local mode touches no account machinery", () => {
  test("a guest never builds a client", async () => {
    setGuestMode(true);

    const { result } = await mountAuth();

    expect(result.current.status).toBe(AUTH_STATUS.GUEST);
    expect(mockClientBuilds).toHaveLength(0);
    expect(mockAuth.getSession).not.toHaveBeenCalled();
    expect(mockAuth.onAuthStateChange).not.toHaveBeenCalled();
  });

  test("an unconfigured build has none to build", async () => {
    mockConfigured = false;

    await mountAuth();

    expect(mockAuth.getSession).not.toHaveBeenCalled();
  });

  /**
   * The one exception, and it is a dead end without it: a reset link arrives as
   * a URL fragment that only the client can consume, so a guest who followed
   * one would land on the dashboard with the reset silently dropped.
   */
  test("a recovery link brings the client back even for a guest", async () => {
    setGuestMode(true);
    window.location.hash = "#access_token=abc&type=recovery";

    try {
      await mountAuth();
      expect(mockAuth.getSession).toHaveBeenCalled();
      // `mountAuth` returns as soon as the status settles, which for a guest is
      // immediate — so the session promise is still in flight and its state
      // update would land outside `act`.
      await act(async () => {});
    } finally {
      window.location.hash = "";
    }
  });

  // Leaving local mode has to be able to start the work it skipped, or the
  // sign-in form would sit there with no listener behind it.
  test("turning sync on starts the session work that was skipped", async () => {
    setGuestMode(true);

    const { result } = await mountAuth();
    expect(mockAuth.getSession).not.toHaveBeenCalled();

    await act(async () => {
      result.current.leaveLocalMode();
    });

    // The call is what is being asserted; settling the promise it returns is
    // what keeps its state update inside `act`.
    await waitFor(() => expect(mockAuth.getSession).toHaveBeenCalled());
    await act(async () => {});
  });
});
