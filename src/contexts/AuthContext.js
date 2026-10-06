import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getSupabase, isSupabaseConfigured } from "../supabaseClient";
import {
  clearScope,
  hasStoredBooks,
  isGuestMode,
  localScope,
  replaceScope,
  setGuestMode,
  snapshotScope,
} from "../storage";
import { booksFilename, offerFile, serializeBooks } from "../booksFile";
import { flushWrites } from "../desktop";

/**
 * Who is signed in, and the four things they can do about it.
 *
 * The app was single-user with no auth for its whole life, and the reason that
 * had to end is not that a second person appeared — it is that the books moved
 * off this browser. A Supabase anon key is compiled into the JavaScript bundle
 * and is public by design; the only thing standing between a household's ledger
 * and anyone who opens devtools on the deployed app is a row-level security
 * predicate, and a predicate needs a subject. `auth.uid()` is that subject.
 *
 * **Every mutator here returns `{ ok, error }`**, the convention every store in
 * this app keeps, wrapped in a promise because the network is involved.
 * `error` is always a sentence fit to put on screen — see `describeAuthError`,
 * which is the one place a Supabase error string is turned into one, so two
 * forms cannot word the same failure differently.
 *
 * **`status` is a three-state, not a boolean.** "Checking" is a real state: a
 * persisted session is read back asynchronously at boot, and a gate that
 * treated the gap as signed-out would flash the sign-in form at every returning
 * user on every reload.
 */
const AuthContext = React.createContext();

export function useAuth() {
  return useContext(AuthContext);
}

export const AUTH_STATUS = {
  CHECKING: "checking",
  SIGNED_IN: "signedIn",
  SIGNED_OUT: "signedOut",
  /** No project configured. The app runs on this browser's own books. */
  LOCAL_ONLY: "localOnly",
  /**
   * Configured, but the person chose to try the app without an account.
   *
   * Distinct from `LOCAL_ONLY`, which is a fact about the *build*: nothing was
   * configured, so there was never an account to have. This is a fact about the
   * *person*, who was offered one and declined for now — so the app owes them a
   * way to change their mind, which `LOCAL_ONLY` has no need of.
   */
  GUEST: "guest",
};

/** Enforced here rather than left to the project's own minimum, which is six. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * A Supabase error, as a sentence for a person.
 *
 * The strings the API returns are written for a developer reading a log —
 * "Invalid login credentials", "User already registered" — and several of them
 * are actively misleading in a form ("User already registered" appears on the
 * *sign-up* form, where the useful thing to say is "sign in instead"). Matched
 * on substrings rather than codes because the codes are not stable across
 * versions and the messages have been.
 *
 * Anything unrecognised falls through to the original text rather than to a
 * generic apology: a message we did not anticipate is still more use to the
 * person stuck behind it than "Something went wrong."
 */
export function describeAuthError(error) {
  if (!error) return null;
  const message = String(error.message ?? error);
  const lower = message.toLowerCase();

  if (lower.includes("invalid login credentials")) {
    return "That email and password do not match an account.";
  }
  if (lower.includes("already registered") || lower.includes("already been registered")) {
    return "An account already exists for that email. Sign in instead.";
  }
  if (lower.includes("email not confirmed")) {
    return "Confirm your email address first — the link is in your inbox.";
  }
  if (lower.includes("password should be at least")) {
    return `Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (lower.includes("unable to validate email") || lower.includes("invalid email")) {
    return "Enter a valid email address.";
  }
  if (lower.includes("for security purposes") || lower.includes("rate limit")) {
    return "Too many attempts just now. Wait a minute and try again.";
  }
  if (lower.includes("same password")) {
    return "That is already your password. Choose a different one.";
  }
  if (lower.includes("failed to fetch") || lower.includes("network")) {
    return "Could not reach the server. Check your connection and try again.";
  }
  return message;
}

/**
 * What "no session" means, which is two different answers.
 *
 * Signed out is only one of them, and which one applies is a fact about *this
 * browser* rather than about the request that just finished: a household
 * running locally has declined an account, so the absence of a session is the
 * state they chose rather than news to report.
 *
 * Without this, the boot-time `getSession` would resolve and overwrite the
 * `GUEST` status that was read synchronously a moment earlier — bouncing a
 * local household to the sign-in form on every single reload — and the
 * `SIGNED_OUT` event that `stopSyncing` itself causes would undo the mode it
 * had just entered.
 */
function signedOutStatus() {
  return isGuestMode() ? AUTH_STATUS.GUEST : AUTH_STATUS.SIGNED_OUT;
}

/** Shared by sign-up and the new-password form, so the two cannot disagree. */
function checkPassword(password, confirmation) {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return `Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (confirmation !== undefined && password !== confirmation) {
    return "The two passwords do not match.";
  }
  return null;
}

function checkEmail(email) {
  const trimmed = (email ?? "").trim();
  if (!trimmed) return "Enter your email address.";
  // Deliberately loose. The address is confirmed by an email actually arriving;
  // a stricter pattern here only ever turns away real addresses.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return "Enter a valid email address.";
  return null;
}

export const AuthProvider = ({ children }) => {
  // Read synchronously, so a returning guest is never shown the sign-in form
  // they already declined — the same reason CHECKING exists for a session.
  const [status, setStatus] = useState(() => {
    if (!isSupabaseConfigured) return AUTH_STATUS.LOCAL_ONLY;
    if (isGuestMode()) return AUTH_STATUS.GUEST;
    return AUTH_STATUS.CHECKING;
  });
  const [user, setUser] = useState(null);

  /**
   * True between following a password-reset link and choosing the new password.
   *
   * The recovery link *signs the user in* — that is how Supabase authorises the
   * password change — so without this flag the app would simply open at the
   * dashboard and the person who clicked "I forgot my password" would never be
   * asked for a new one.
   */
  const [recovering, setRecovering] = useState(false);

  /**
   * Set when a sign-up needs its email confirmed before it can be used. Held
   * here rather than in the form because the form's own state is reset by the
   * navigation between its modes.
   */
  const [pendingConfirmation, setPendingConfirmation] = useState(null);

  /**
   * True while this browser is running on its own books by choice.
   *
   * Read as state rather than through `isGuestMode()` so the effect below
   * re-runs when it changes — leaving local mode has to be able to *start* the
   * session work it skipped.
   */
  const local = status === AUTH_STATUS.GUEST;

  useEffect(() => {
    /**
     * **Local mode does no account work at all, and that is the point.**
     *
     * Everything below reaches for the client, and reaching for it is what
     * builds it — a session read out of localStorage, a refresh timer that will
     * go to the network when a stored token ages, a listener on all of it. A
     * household that chose to keep their books on their own machine asked for
     * none of that, and the honest way to give them "nothing is sent anywhere"
     * is for there to be nothing that could send it.
     *
     * The one exception is a recovery link, which arrives as a URL fragment
     * that only the client can consume. Skipping it there would leave somebody
     * who followed a password-reset email staring at a dashboard, with the
     * reset silently dropped — so a fragment that looks like one is enough to
     * bring the client back for this load.
     */
    const followingAuthLink = window.location.hash.includes("access_token");
    if (local && !followingAuthLink) return undefined;

    const supabase = getSupabase();
    if (!supabase) return undefined;

    let active = true;

    // The persisted session is read back asynchronously, which is the whole
    // reason CHECKING exists.
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        setUser(data?.session?.user ?? null);
        setStatus(data?.session ? AUTH_STATUS.SIGNED_IN : signedOutStatus());
      })
      .catch(() => {
        // Offline at boot with no cached session. Signed out is the honest
        // reading, and the sign-in form will say why when it is used.
        if (active) setStatus(signedOutStatus());
      });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;

      if (event === "PASSWORD_RECOVERY") setRecovering(true);
      if (event === "SIGNED_OUT") setRecovering(false);

      setUser(session?.user ?? null);
      setStatus(session ? AUTH_STATUS.SIGNED_IN : signedOutStatus());
    });

    return () => {
      active = false;
      subscription?.subscription?.unsubscribe();
    };
  }, [local]);

  const signUp = useCallback(async ({ email, password, confirmation }) => {
    const supabase = getSupabase();
    if (!supabase) return { ok: false, error: "This build has no account server configured." };

    const emailError = checkEmail(email);
    if (emailError) return { ok: false, error: emailError };
    const passwordError = checkPassword(password, confirmation);
    if (passwordError) return { ok: false, error: passwordError };

    const address = email.trim();
    const { data, error } = await supabase.auth.signUp({
      email: address,
      password,
      options: {
        // **Back to the app that asked, not to the project's Site URL.** A
        // Supabase project has one Site URL and it is what a confirmation link
        // falls back to — which was harmless while this project served one app,
        // and is wrong the moment it serves two: a household signing up here
        // would confirm their address and land in an unrelated app with no idea
        // why. Same reasoning, and the same expression, as
        // `requestPasswordReset` below, so the two emails cannot disagree about
        // where they lead.
        emailRedirectTo: window.location.origin,
      },
    });
    if (error) return { ok: false, error: describeAuthError(error) };

    // With email confirmation on, `signUp` returns a user and *no* session —
    // the account exists but cannot be used until the link is followed. With
    // confirmation off, a session comes back and the auth listener above takes
    // it from here.
    if (!data?.session) {
      setPendingConfirmation(address);
      return { ok: true, confirmationRequired: true };
    }
    return { ok: true };
  }, []);

  const signIn = useCallback(async ({ email, password }) => {
    const supabase = getSupabase();
    if (!supabase) return { ok: false, error: "This build has no account server configured." };

    const emailError = checkEmail(email);
    if (emailError) return { ok: false, error: emailError };
    if (!password) return { ok: false, error: "Enter your password." };

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) return { ok: false, error: describeAuthError(error) };

    setPendingConfirmation(null);
    return { ok: true };
  }, []);

  /**
   * End the session, and take the books out of this browser with it.
   *
   * The cache is cleared *before* the sign-out call rather than after: the auth
   * listener unmounts the store providers the moment the session goes, and a
   * clear racing that unmount could be beaten by a provider's final persist
   * effect writing the ledger straight back.
   */
  const signOut = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase) return { ok: true };

    clearScope(user?.id);

    // The deletes above are asynchronous in the desktop shell — the renderer
    // posts them across and the main process coalesces them. Ending the session
    // without landing them first would let a quick quit leave the previous
    // household's books on the disk, which is the whole thing namespacing the
    // cache exists to prevent. A no-op in a browser, where the removal already
    // happened synchronously.
    await flushWrites();

    const { error } = await supabase.auth.signOut();
    if (error) return { ok: false, error: describeAuthError(error) };
    return { ok: true };
  }, [user]);

  /**
   * Run on this device's own books, with no account at all.
   *
   * The first caller `setGuestMode` has ever had. Until now the app offered
   * exactly one way past the sign-in form — having an account — which is the
   * right default for a browser and the wrong one for something a household
   * downloads onto their own computer specifically so that nothing leaves it.
   *
   * Remembered, because a choice that had to be made again on every reload
   * would read as the trial having been revoked.
   */
  const continueLocally = useCallback(() => {
    if (!isSupabaseConfigured) return { ok: true };
    setGuestMode(true);
    setStatus(AUTH_STATUS.GUEST);
    return { ok: true };
  }, []);

  /**
   * Come back to the sign-in form after running locally.
   *
   * **Nothing is moved and nothing is deleted.** The local books stay exactly
   * where they are, under their own scope, so this is reversible by pressing
   * the other button — and if an account is then signed into, `ImportBooksGate`
   * is what offers to carry them up.
   */
  const leaveLocalMode = useCallback(() => {
    setGuestMode(false);
    setStatus(isSupabaseConfigured ? AUTH_STATUS.SIGNED_OUT : AUTH_STATUS.LOCAL_ONLY);
    return { ok: true };
  }, []);

  /**
   * Stop syncing, and keep the books on this device.
   *
   * **The counterpart to `signOut`, not a variant of it.** Signing out is
   * destructive on purpose: on a shared browser the books have to leave with
   * the session, which is the entire reason the cache is namespaced. On a
   * machine somebody owns, that same behaviour answers "I would rather my
   * ledger were not on a server" by deleting the ledger, which is not what
   * anybody means by it.
   *
   * So the account's books are copied down into local mode first, and only then
   * is the session ended. Three details are load-bearing:
   *
   *   - **The copy is a replace, not a merge.** Whatever is in the local scope
   *     may be a stale snapshot from before this account signed in, and a store
   *     the account no longer has must not survive from it.
   *   - **Those stale local books are written out as a file first**, because
   *     replacing them is the one destructive thing this does.
   *   - **Guest mode is set before the sign-out**, so the `SIGNED_OUT` event
   *     the sign-out raises reads as local mode rather than as signed out and
   *     the sign-in form never appears.
   */
  const stopSyncing = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase) return { ok: false, error: "This build has no account server configured." };

    const id = user?.id;
    if (!id) return { ok: false, error: "You are not signed in." };

    const books = snapshotScope(id);
    const target = localScope();

    if (hasStoredBooks(target)) {
      const archived = await offerFile(
        booksFilename({ suffix: "replaced-local-copy" }),
        serializeBooks(snapshotScope(target))
      );

      // Same rule as the restore: the copy is what makes replacing safe, so
      // declining it stops the operation rather than proceeding without it.
      if (!archived.ok) {
        return {
          ok: false,
          error: archived.canceled
            ? "Nothing was changed — the copy of this device's existing books was not saved."
            : "Could not save a copy of the books already on this device, so nothing was changed.",
        };
      }
    }

    replaceScope(target, books);
    setGuestMode(true);

    // Cleared before the sign-out for `signOut`'s reason: the auth listener
    // unmounts the store providers the moment the session goes, and a clear
    // racing that unmount can be beaten by a provider's final persist effect.
    clearScope(id);

    // Both halves have to be on disk before the session ends — the books that
    // just moved down into local mode, and the account's copy that was cleared.
    await flushWrites();

    const { error } = await supabase.auth.signOut();
    if (error) return { ok: false, error: describeAuthError(error) };
    return { ok: true };
  }, [user]);

  const requestPasswordReset = useCallback(async ({ email }) => {
    const supabase = getSupabase();
    if (!supabase) return { ok: false, error: "This build has no account server configured." };

    const emailError = checkEmail(email);
    if (emailError) return { ok: false, error: emailError };

    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      // Back to the app itself, where the recovery event opens the
      // new-password form. Uses the running origin so a deploy preview sends
      // its own link rather than production's.
      redirectTo: window.location.origin,
    });
    if (error) return { ok: false, error: describeAuthError(error) };
    return { ok: true };
  }, []);

  const updatePassword = useCallback(async ({ password, confirmation }) => {
    const supabase = getSupabase();
    if (!supabase) return { ok: false, error: "This build has no account server configured." };

    const passwordError = checkPassword(password, confirmation);
    if (passwordError) return { ok: false, error: passwordError };

    const { error } = await supabase.auth.updateUser({ password });
    if (error) return { ok: false, error: describeAuthError(error) };

    setRecovering(false);
    return { ok: true };
  }, []);

  const dismissConfirmation = useCallback(() => setPendingConfirmation(null), []);

  const value = useMemo(
    () => ({
      status,
      user,
      userId: user?.id ?? null,
      email: user?.email ?? null,
      recovering,
      pendingConfirmation,
      dismissConfirmation,
      signUp,
      signIn,
      signOut,
      continueLocally,
      leaveLocalMode,
      stopSyncing,
      requestPasswordReset,
      updatePassword,
    }),
    [
      status,
      user,
      recovering,
      pendingConfirmation,
      dismissConfirmation,
      signUp,
      signIn,
      signOut,
      continueLocally,
      leaveLocalMode,
      stopSyncing,
      requestPasswordReset,
      updatePassword,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
