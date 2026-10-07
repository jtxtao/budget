import { useState } from "react";
import Field from "../components/Field";
import Button from "../components/Button";
import { MAGIC_CODE_LENGTH, MIN_PASSWORD_LENGTH, useAuth } from "../contexts/AuthContext";
import { isDesktop } from "../storage";

/**
 * The way into the books: sign in, sign up, or ask for a reset link.
 *
 * Three modes on one page rather than three routes, because they are one
 * decision seen from different angles — a person who mistypes their password
 * twice needs "forgot" to be a click away, not a navigation — and because the
 * email survives the switch between them, which it could not across a route
 * change. The recovery form is a fourth state, but not a mode: it is *entered
 * by following a link*, never by choosing it, so it takes over the page rather
 * than sitting in the switcher. The screen that waits on an emailed sign-in is
 * a fifth, for the same reason.
 *
 * **Signing in by email is not a mode either, and deliberately so.** It needs
 * exactly one field, and that field is already on the sign-in form — so it is a
 * second button under the same form rather than a screen of its own that would
 * ask again for the address just typed. The password field sitting above it
 * unused is the honest shape of the choice: type your password, or have us send
 * something instead.
 *
 * **These forms are controlled, unlike every `Add*Modal` in the app.** That rule
 * exists because those modals stay mounted and `defaultValue` silently stops
 * applying after the first open. Nothing here stays mounted — the whole page
 * unmounts the moment a session exists — and being controlled buys two things
 * worth having on an auth form: the submit button can disable itself while a
 * request is in flight, and the email can be carried across a mode switch.
 */
export default function AuthPage() {
  const {
    signIn,
    signUp,
    continueLocally,
    requestPasswordReset,
    requestSignInEmail,
    verifySignInCode,
    updatePassword,
    recovering,
    pendingConfirmation,
    dismissConfirmation,
    pendingSignInEmail,
    dismissSignInEmail,
    // The account the recovery link signed us in as. Named apart from the
    // `email` field below, which is what the person is typing.
    email: accountEmail,
  } = useAuth();

  const [mode, setMode] = useState("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  function switchTo(next) {
    setMode(next);
    setError(null);
    setNotice(null);
    // The email is the one field worth carrying across — someone who just
    // failed to sign in and is now registering is registering that address.
    setPassword("");
    setConfirmation("");
    setCode("");
  }

  async function run(action) {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    return result;
  }

  async function handleRecovery(e) {
    e.preventDefault();
    const result = await run(() => updatePassword({ password, confirmation }));
    if (!result.ok) setError(result.error);
    // On success the provider drops `recovering` and the app renders behind us.
  }

  async function handleCode(e) {
    e.preventDefault();
    const result = await run(() => verifySignInCode({ code }));
    if (!result.ok) setError(result.error);
    // On success the session lands and this whole page unmounts.
  }

  async function sendSignInEmail(address) {
    const result = await run(() => requestSignInEmail({ email: address }));
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // Nothing is set on success: the provider now holds the address, and the
    // screen that waits on it takes over the page.
    setCode("");
  }

  async function handleSubmit(e) {
    e.preventDefault();

    if (mode === "forgot") {
      const result = await run(() => requestPasswordReset({ email }));
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Deliberately worded so it says the same thing whether or not an account
      // exists for that address: a form that confirms the difference lets
      // anyone test whether a given person banks here.
      setNotice(
        `If an account exists for ${email.trim()}, a reset link is on its way. The link is good for one hour.`
      );
      return;
    }

    const result = await run(() =>
      mode === "signUp" ? signUp({ email, password, confirmation }) : signIn({ email, password })
    );
    if (!result.ok) setError(result.error);
    // On success the session lands and this whole page unmounts.
  }

  // ---------------------------------------------------------------------
  // Following a reset link. Not a mode — there is no way to choose it.
  // ---------------------------------------------------------------------
  if (recovering) {
    return (
      <Shell title="Choose a new password" blurb="You followed a reset link, so you are signed in — set a password and you are done.">
        <form onSubmit={handleRecovery} noValidate>
          {/* Read-only, and present for two reasons. It says which account is
              being changed, which matters on a form reached from an email that
              may be days old — and a password form with no username field
              leaves password managers unable to tell which entry to update, and
              Chrome unable to offer the fill at all. */}
          <Field
            label="Account"
            type="email"
            autoComplete="username"
            value={accountEmail ?? ""}
            readOnly
            tabIndex={-1}
            className="w-full cursor-default border-0 border-b-2 border-edge bg-transparent px-0 py-1.5 font-mono text-lg text-chalk-soft outline-none"
          />
          <Field
            label="New password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby="password-hint"
            required
          />
          <PasswordHint />
          <Field
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            required
          />
          <Message error={error} notice={notice} />
          <Button variant="primary" type="submit" disabled={busy} className="w-full">
            {busy ? "Saving…" : "Save password"}
          </Button>
        </form>
      </Shell>
    );
  }

  // ---------------------------------------------------------------------
  // Signed up, waiting on the confirmation email.
  // ---------------------------------------------------------------------
  if (pendingConfirmation) {
    return (
      <Shell title="Confirm your email" blurb={`We sent a confirmation link to ${pendingConfirmation}. Follow it, then sign in.`}>
        <p className="mb-6 font-sans text-sm leading-relaxed text-chalk-soft">
          Nothing is saved to your account until it is confirmed. If the message has not arrived in
          a few minutes, check the spam folder.
        </p>
        <Button
          variant="outline"
          type="button"
          className="w-full"
          onClick={() => {
            dismissConfirmation();
            switchTo("signIn");
          }}
        >
          Back to sign in
        </Button>
      </Shell>
    );
  }

  // ---------------------------------------------------------------------
  // A sign-in email is out. Not a mode either: the provider holds the address,
  // and this is the one screen in the app where the two builds are offered
  // different *mechanics* rather than different wording — a browser follows the
  // link, the shell cannot, so it reads the code out of the same email.
  // ---------------------------------------------------------------------
  if (pendingSignInEmail) {
    const desktop = isDesktop();
    return (
      <Shell
        title={desktop ? "Enter your sign-in code" : "Check your inbox"}
        // Hedged in both builds, for the reason the reset notice is hedged: a
        // screen that appeared only for addresses that exist would answer "does
        // this household keep their books here" to anybody who asked.
        blurb={
          desktop
            ? `If an account exists for ${pendingSignInEmail}, we have sent it a ${MAGIC_CODE_LENGTH}-digit code. It is good for one hour.`
            : `If an account exists for ${pendingSignInEmail}, a sign-in link is on its way. It is good for one hour.`
        }
      >
        {desktop ? (
          <form onSubmit={handleCode} noValidate>
            {/* `text`, never `number` — the app's rule about figures, holding
                here for its own reason: a code can begin with a zero, and a
                number input drops it. It is also pasted at least as often as it
                is typed, which spinners only get in the way of.
                `one-time-code` is what lets a password manager, and macOS
                handoff, offer the code without the household retyping it. */}
            <Field
              label="Sign-in code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              aria-describedby="code-hint"
              required
            />
            <p id="code-hint" className="-mt-3.5 mb-5 font-sans text-row leading-relaxed text-chalk-soft">
              {MAGIC_CODE_LENGTH} digits, from the email. The link in that message will not open this
              app — the code is the part to use here.
            </p>
            <Message error={error} notice={notice} />
            <Button variant="primary" type="submit" disabled={busy} className="w-full">
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        ) : (
          <>
            <p className="mb-6 font-sans text-sm leading-relaxed text-chalk-soft">
              Follow the link and you are in — there is no password to type. If the message has not
              arrived in a few minutes, check the spam folder.
            </p>
            <Message error={error} notice={notice} />
          </>
        )}

        <div className="mt-6 border-t border-edge pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Switcher onClick={() => sendSignInEmail(pendingSignInEmail)}>Send another</Switcher>
            <Switcher
              onClick={() => {
                dismissSignInEmail();
                switchTo("signIn");
              }}
            >
              Back to sign in
            </Switcher>
          </div>
        </div>
      </Shell>
    );
  }

  const titles = {
    signIn: "Sign in",
    signUp: "Create an account",
    forgot: "Reset your password",
  };
  const blurbs = {
    // "Device" rather than `deviceLabel()` in the shell: what an account buys
    // is the *second* machine, so the sentence is about everywhere else rather
    // than about the one being used.
    signIn: `Your books are on the server now — they follow you to any ${
      isDesktop() ? "device" : "browser"
    } you sign in from.`,
    // Deliberately a claim about *other accounts*, not about encryption. Rows
    // are stored in plain Postgres and the project's owner can read them; a
    // sign-up form promising otherwise would be selling something this does not
    // do.
    signUp: "One account, one household's books. Nobody else signing in can see them.",
    forgot: "Enter the address you registered with and we will send a link.",
  };

  return (
    <Shell
      title={titles[mode]}
      blurb={blurbs[mode]}
      // Not on the reset form: somebody midway through recovering an account has
      // already told us which way they are going, and offering to abandon it
      // there reads as the reset having failed.
      footer={mode !== "forgot" ? <LocalDoor onChoose={continueLocally} /> : null}
    >
      <form onSubmit={handleSubmit} noValidate>
        {/* `username` rather than `email`: this is the account identifier, and
            it is what lets a password manager pair it with the password field
            below. `email` alone leaves the two unassociated and Chrome declines
            to offer the fill. */}
        <Field
          label="Email"
          type="email"
          autoComplete={mode === "forgot" ? "email" : "username"}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        {mode !== "forgot" && (
          <>
            <Field
              label="Password"
              type="password"
              autoComplete={mode === "signUp" ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-describedby={mode === "signUp" ? "password-hint" : undefined}
              required
            />
            {mode === "signUp" && <PasswordHint />}
          </>
        )}

        {mode === "signUp" && (
          <Field
            label="Confirm password"
            type="password"
            autoComplete="new-password"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            required
          />
        )}

        <Message error={error} notice={notice} />

        <Button variant="primary" type="submit" disabled={busy} className="w-full">
          {busy
            ? "Working…"
            : mode === "signUp"
            ? "Create account"
            : mode === "forgot"
            ? "Send reset link"
            : "Sign in"}
        </Button>

        {/* Inside the form, because it reads the email field above it — and a
            `type="button"`, so it cannot be what Enter triggers. Offered only
            on sign-in: there is nothing to email somebody who is registering,
            and the reset form is already an emailed route. */}
        {mode === "signIn" && (
          <>
            <div className="my-5 flex items-center gap-3">
              <span className="h-px flex-1 bg-edge" />
              <span className="font-mono text-label uppercase text-chalk-soft">or</span>
              <span className="h-px flex-1 bg-edge" />
            </div>
            <Button
              variant="outline"
              type="button"
              disabled={busy}
              className="w-full"
              onClick={() => sendSignInEmail(email)}
            >
              {isDesktop() ? "Email me a sign-in code" : "Email me a sign-in link"}
            </Button>
            <p className="mt-2 text-center font-sans text-row text-chalk-soft">
              No password needed — useful if you have never set one.
            </p>
          </>
        )}
      </form>

      <div className="mt-6 border-t border-edge pt-5">
        {mode === "signIn" && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Switcher onClick={() => switchTo("signUp")}>Create an account</Switcher>
            <Switcher onClick={() => switchTo("forgot")}>Forgot your password?</Switcher>
          </div>
        )}
        {mode !== "signIn" && <Switcher onClick={() => switchTo("signIn")}>Back to sign in</Switcher>}
      </div>
    </Shell>
  );
}

/**
 * The third door: use the app without an account at all.
 *
 * **It is weighted differently on the two builds, and that is the honest thing
 * rather than an inconsistency.**
 *
 * In the desktop app this is the point of the product — the household
 * downloaded something onto a computer they own so that their ledger would not
 * sit on anybody's server — so it is stated plainly, given the room to say what
 * it actually means, and drawn as a real choice rather than as a way out of the
 * form above it.
 *
 * In a browser it is a quieter line, because a browser cannot honour the same
 * promise. `localStorage` is cleared by the things that clear caches, it does
 * not survive the machine, and "on this computer" in a tab is a much smaller
 * claim than the same words beside a file on disk. Offering it in the same
 * weight as the desktop build would be selling something the web build does not
 * do — the rule the sign-up blurb above already keeps about encryption.
 */
function LocalDoor({ onChoose }) {
  const desktop = isDesktop();

  if (!desktop) {
    // Two elements rather than one wrapped sentence: at this width a single
    // line breaks after the em dash, which strands "the" at the end of a line
    // and reads as a typo. Splitting it puts the break where it belongs.
    return (
      <div className="mt-5 text-center">
        <Switcher onClick={onChoose}>Use this browser without an account</Switcher>
        <p className="mt-1 font-sans text-row text-chalk-soft">
          The books stay in this browser and go no further.
        </p>
      </div>
    );
  }

  // The same card treatment as the form above rather than a raised one: `edge`
  // and `panel-raised` are two steps apart in the palette, so an outline button
  // on a raised surface loses its border almost entirely. The gap does the
  // separating, which is what keeps this to one card style instead of two.
  return (
    <div className="mt-5 border border-edge bg-panel p-5">
      {/* The heading names what this is and the button names what it does. Both
          saying "keep everything on this computer" made the card read as though
          it were asking twice. */}
      <h2 className="font-sans text-sm font-semibold tracking-tight text-chalk">
        No account needed
      </h2>
      <p className="mb-4 mt-1.5 font-sans text-row leading-relaxed text-chalk-soft">
        Your books are saved to a file on this machine and nothing is sent anywhere — no account,
        no server, no connection needed. Sign in later if you ever want a second device, and this
        computer's books can come with you.
      </p>
      <Button variant="outline" type="button" onClick={onChoose} className="w-full">
        Keep everything on this computer
      </Button>
    </div>
  );
}

/**
 * The page's frame. Carries the app's only `<h1>`, as every page does — the
 * wordmark above it is the same one `AppShell` shows, so arriving and signing in
 * do not look like two different products.
 */
function Shell({ title, blurb, children, footer }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ledger px-6 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8">
          <div className="font-sans text-xl font-bold tracking-tight text-chalk">
            Household Books
          </div>
          <div className="mt-0.5 font-mono text-label uppercase text-chalk-soft">
            Personal budget
          </div>
        </div>

        <div className="border border-edge bg-panel p-7">
          <h1 className="font-sans text-lg font-bold tracking-tight text-chalk">{title}</h1>
          <p className="mb-7 mt-2 font-sans text-sm leading-relaxed text-chalk-soft">{blurb}</p>
          {children}
        </div>

        {/* Outside the card on purpose: what goes here is an alternative to the
            whole form above, not another control inside it. */}
        {footer}
      </div>
    </div>
  );
}

/**
 * Outside the `<label>` and tied to the input with `aria-describedby`, the rule
 * `RetirementAssumptionsPanel`'s `Field` keeps: nesting it would fold the
 * sentence into the field's accessible name, so nothing could find the field by
 * its name and a screen reader would read the whole hint on focus.
 */
function PasswordHint() {
  return (
    <p id="password-hint" className="-mt-3.5 mb-5 font-sans text-row text-chalk-soft">
      At least {MIN_PASSWORD_LENGTH} characters.
    </p>
  );
}

function Message({ error, notice }) {
  if (error) {
    return (
      <p role="alert" className="mb-5 font-sans text-row text-vermilion">
        {error}
      </p>
    );
  }
  if (notice) {
    return (
      <p role="status" className="mb-5 font-sans text-row text-verdant">
        {notice}
      </p>
    );
  }
  return null;
}

/** A link in behaviour, a button in fact — it changes what is on screen. */
function Switcher({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="font-sans text-row text-azure underline-offset-4 transition-colors hover:text-chalk hover:underline"
    >
      {children}
    </button>
  );
}
