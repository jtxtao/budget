import { useState } from "react";
import { NavLink } from "react-router-dom";
import AddTransactionModal from "./AddTransactionModal";
import AskModal from "./AskModal";
import MoveMoneyModal from "./MoveMoneyModal";
import { TRANSACTION_KINDS } from "../contexts/TransactionsContext";
import { navigation } from "../navigation";
import { currentPeriod } from "../utils";
import Button from "./Button";
import { AUTH_STATUS, useAuth } from "../contexts/AuthContext";
import { SYNC_STATE, useSync } from "../contexts/SyncContext";
import { isDesktop } from "../storage";
import useTheme, { THEMES } from "../hooks/useTheme";
import Elder from "./Elder";

// Sun and moon for the switch: the icon is the mode the app is in now, and the
// label plus `aria-pressed` say the same thing in words.
function SunIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="3" fill="currentColor" />
      <path
        d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M3 13l1.4-1.4M11.6 4.4L13 3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true" focusable="false">
      <path d="M13.5 10.2A5.8 5.8 0 0 1 5.8 2.5a5.8 5.8 0 1 0 7.7 7.7z" fill="currentColor" />
    </svg>
  );
}

// A door with an arrow leaving it: what "Sign out" wears below `sm`, where its
// words are what pushes the header onto a second line.
function SignOutIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true" focusable="false">
      <path
        d="M6 2.5H3.5v11H6M10 5l3 3-3 3M13 8H6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The canopy: the header band, the same deep green in both modes, with the
 * Elder beside the name and the light/dark switch at the far end.
 *
 * The switch is a toggle button (`aria-pressed` on "Dark mode") rather than a
 * two-option strip, because there are only two states and one of them is
 * always the answer to "is it on".
 */
export default function AppShell({ children }) {
  const { theme, toggleTheme } = useTheme();
  const dark = theme === THEMES.DARK;

  return (
    <div className="min-h-screen bg-ledger">
      <header className="bg-canopy">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pt-4 sm:gap-x-4 sm:pt-5">
            <div className="flex items-center gap-x-2.5 sm:gap-x-3.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-on-canopy-soft sm:h-11 sm:w-11">
                <Elder className="h-7 w-8 sm:h-9 sm:w-10" />
              </span>
              <span className="font-display text-xl text-on-canopy sm:text-2xl">Canopy Budget</span>
            </div>
            {/* The switch is a preference about the screen and the account
                control is who the books belong to, so identity sits at the
                far edge where it has always been and the switch tucks in
                beside it. */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-2 sm:gap-x-3">
              <QuickEntry />
              <Button
                variant="canopy"
                className="gap-2 rounded-full max-sm:px-2.5"
                type="button"
                aria-pressed={dark}
                onClick={toggleTheme}
              >
                {dark ? <MoonIcon /> : <SunIcon />}
                {/* The icon already says which mode is on; the words are what
                    makes it a labelled control, so they are kept for a screen
                    reader and dropped from a phone's header, where this is the
                    least important thing on the band. */}
                <span className="sr-only sm:not-sr-only">Dark mode</span>
              </Button>
              <AccountControl />
            </div>
          </div>
          {/* **One row that scrolls, never a block that wraps.** Nine sections
              wrap to three rows on a phone, which pushes the page itself below
              the fold and makes the band the biggest thing on screen. A single
              scrolling strip keeps the header one line high at every width, and
              the negative margin lets it bleed to the screen edge so the last
              tab is visibly cut off rather than looking like the end of the
              list. `flex-wrap` returns once there is room for it. */}
          <nav
            aria-label="Sections"
            className="no-scrollbar -mx-4 mt-3 flex gap-x-6 overflow-x-auto px-4 sm:mx-0 sm:mt-4 sm:flex-wrap sm:gap-x-7 sm:overflow-visible sm:px-0"
          >
            {navigation.map(({ path, label }) => (
              <NavLink
                key={path}
                to={path}
                end={path === "/"}
                className={({ isActive }) =>
                  `shrink-0 whitespace-nowrap border-b-[3px] pb-2.5 pt-1 font-sans text-sm transition-colors ${
                    isActive
                      ? "border-coin font-bold text-on-canopy"
                      : "border-transparent font-medium text-on-canopy-soft hover:border-on-canopy-soft/40 hover:text-on-canopy"
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      {/* The bottom padding is for the entry bar that covers the foot of the
          page on a phone — without it the last row of every table sits under
          it. */}
      <main className="mx-auto max-w-6xl px-4 py-6 pb-28 sm:px-6 sm:py-9 sm:pb-9">{children}</main>
    </div>
  );
}

/**
 * Recording money, from every page.
 *
 * A receipt turns up while the household is looking at the plan, or the net
 * worth, or a retirement scenario — and having to walk to the register first is
 * the kind of friction that turns "log it now" into "log it later". So the one
 * entry form opens from the header wherever the reader is, and a transfer gets a
 * door of its own: moving money between two of the household's accounts is
 * common enough (a card payment, a top-up to savings) that a toggle inside the
 * form is one decision too many to make every time.
 *
 * The modal is **mounted only while open**, unlike the forms the pages keep
 * mounted: the header renders above every page and in suites with no stores
 * at all, and a closed dialog nobody asked for would put a second copy of every
 * field label on every page. Mounting it with `show` already true is still an
 * open — its re-seed effect runs on mount exactly as it does on a `show` flip.
 *
 * **On a phone the pair moves to a bar fixed across the foot of the screen**,
 * which is where a thumb is and where the two things a household does most
 * belong. It is the *same two buttons moved by CSS*, not a second copy rendered
 * under a `sm:hidden` — a copy would be two "Add transaction" buttons in the
 * accessibility tree at every width, since a media query is only a paint-time
 * fact and nothing in the DOM says which of the two is the live one.
 *
 * **"Ask" is the third door, and the desktop app's alone**: a sentence read by
 * a model on this computer (`AskModal`), which opens one of the two ordinary
 * forms already filled in — this one, or `MoveMoneyModal`. Desktop only because
 * the model is Ollama on the household's own machine, which is the only place
 * the promise that nothing leaves it can be kept; the button is absent in a
 * browser rather than present and refusing.
 */
function QuickEntry() {
  const [kind, setKind] = useState(null);
  const [asking, setAsking] = useState(false);
  // What the assistant read, waiting in the form it belongs to. Held as the
  // resolved object rather than rebuilt, so the forms' re-seed effects see one
  // stable value for as long as they are open.
  const [drafted, setDrafted] = useState(null);
  const [moving, setMoving] = useState(null);

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-30 flex gap-2 border-t border-on-canopy-soft/30 bg-canopy px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:static sm:z-auto sm:border-0 sm:bg-transparent sm:p-0">
        <Button
          variant="canopy"
          className="flex-1 rounded-full py-2.5 sm:flex-none sm:py-2"
          type="button"
          onClick={() => setKind(TRANSACTION_KINDS.OUTFLOW)}
        >
          <span aria-hidden="true">+</span>
          Add transaction
        </Button>
        <Button
          variant="canopy"
          className="flex-1 rounded-full py-2.5 sm:flex-none sm:py-2"
          type="button"
          onClick={() => setKind(TRANSACTION_KINDS.TRANSFER)}
        >
          <span aria-hidden="true">⇄</span>
          Transfer
        </Button>
        {isDesktop() && (
          <Button
            variant="canopy"
            className="flex-1 rounded-full py-2.5 sm:flex-none sm:py-2"
            type="button"
            onClick={() => setAsking(true)}
          >
            <span aria-hidden="true">✦</span>
            Ask
          </Button>
        )}
      </div>
      {kind != null && (
        <AddTransactionModal show defaultKind={kind} handleClose={() => setKind(null)} />
      )}
      {asking && (
        <AskModal
          handleClose={() => setAsking(false)}
          onDraft={(resolved) => {
            setAsking(false);
            setDrafted(resolved);
          }}
          onMove={(resolved) => {
            setAsking(false);
            setMoving(resolved);
          }}
        />
      )}
      {drafted != null && (
        <AddTransactionModal
          show
          defaultKind={drafted.draft.kind}
          draft={drafted.draft}
          notes={drafted.notes}
          handleClose={() => setDrafted(null)}
        />
      )}
      {moving != null && (
        <MoveMoneyModal
          show
          period={currentPeriod()}
          seed={moving.seed}
          notes={moving.notes}
          handleClose={() => setMoving(null)}
        />
      )}
    </>
  );
}

/**
 * Where the books are being kept, and the way to change it.
 *
 * **Both hooks are optional here**, and that is deliberate rather than
 * defensive: `AppShell` renders in the page and app test suites, which mount
 * `AppProviders` directly with nothing above them.
 *
 * **Three states get something, and the distinction between the last two
 * matters.** Signed in shows the account and the ways out of it. `GUEST` — a
 * configured build whose user chose to stay local — says so and offers sync,
 * because they were given the choice and may want the other answer. `LOCAL_ONLY`
 * says the same thing and offers *nothing*, because it is a fact about the
 * build: there is no account server configured, so a "turn on sync" button
 * there has exactly one possible outcome, which is an error message explaining
 * that it cannot.
 */
function AccountControl() {
  const { status, email, signOut, stopSyncing, leaveLocalMode } = useAuth() ?? {};
  const { syncState } = useSync() ?? {};

  const local = status === AUTH_STATUS.GUEST || status === AUTH_STATUS.LOCAL_ONLY;

  if (local) {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* Hidden below `sm`, where it is what pushes the header onto a second
            line — the email's rule. */}
        <span
          className="hidden font-mono text-label uppercase text-on-canopy-soft sm:inline"
          title={
            isDesktop()
              ? "Your books are in a file on this computer. Nothing is sent anywhere."
              : "Your books are in this browser. Nothing is sent anywhere."
          }
        >
          On this {isDesktop() ? "computer" : "browser"}
        </span>
        {status === AUTH_STATUS.GUEST && (
          <Button variant="canopy" size="sm" type="button" onClick={leaveLocalMode}>
            Turn on sync
          </Button>
        )}
      </div>
    );
  }

  if (!email) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-2 sm:gap-x-4">
      <SyncBadge state={syncState} />
      {/* `title` rather than a wider column: an address long enough to be
          truncated is still identifiable by its start, and the header must not
          reflow around it. Hidden below `sm`, where it is what pushes the
          header onto a second line. */}
      <span
        title={email}
        className="hidden max-w-[16rem] truncate sm:block font-mono text-label text-on-canopy-soft"
      >
        {email}
      </span>
      {/* Desktop only, and the wording is the difference: on a machine somebody
          owns, the useful thing is to keep the books and drop the server, which
          `signOut` will not do. In a browser the destructive one is the right
          default — the books have to leave with the session, because the next
          person to open this browser is not necessarily the same household. */}
      {isDesktop() && (
        <Button variant="canopy" size="sm" type="button" onClick={stopSyncing}>
          Stop syncing
        </Button>
      )}
      {/* Icon-only below `sm`, the dark-mode switch's treatment: the words
          stay as its accessible name, and `title` says them on hover. */}
      <Button
        variant="canopy"
        className="gap-2 rounded-full max-sm:px-2.5 sm:rounded-none sm:px-2 sm:py-1 sm:text-label"
        type="button"
        title="Sign out"
        onClick={signOut}
      >
        <span className="sm:hidden">
          <SignOutIcon />
        </span>
        <span className="sr-only sm:not-sr-only">Sign out</span>
      </Button>
    </div>
  );
}

/**
 * Says something only when there is something to say.
 *
 * A permanent "Saved" badge is a light that is always on, which is a light
 * nobody reads. Idle shows nothing; the two states worth interrupting for are
 * "still going" and "not landing".
 *
 * **The slot is always there, and always as wide as its widest message.** Both
 * labels sit in one grid cell and only visibility changes, so a badge coming
 * and going cannot reflow the header — before this, every save shoved the
 * account controls and the dark-mode switch sideways and back. The live region
 * stays mounted for the same reason a screen reader needs it to: a status that
 * appears with its own container is often not announced at all.
 *
 * Below `sm` each label is a dot — pulsing while saving, rust when not landing —
 * with the words kept for a screen reader and the `title`, because two words of
 * reserved width are what pushes a phone's header onto a second line.
 */
function SyncBadge({ state }) {
  const saving = state === SYNC_STATE.SAVING;
  const offline = state === SYNC_STATE.OFFLINE;

  return (
    <span role="status" className="inline-grid items-center">
      <span
        aria-hidden={!saving}
        className={`col-start-1 row-start-1 text-center font-mono sm:px-2 sm:py-0.5 text-label uppercase text-on-canopy-soft ${
          saving ? "" : "invisible"
        }`}
      >
        <span className="sr-only sm:not-sr-only">Saving…</span>
        <span
          aria-hidden="true"
          className="block h-2 w-2 animate-pulse rounded-full bg-on-canopy-soft sm:hidden"
        />
      </span>
      <span
        aria-hidden={!offline}
        title={`Your edits are safe ${
          isDesktop() ? "on this computer" : "in this browser"
        } and will be sent when the connection is back.`}
        className={`col-start-1 row-start-1 text-center sm:border sm:border-on-canopy-rust/60 sm:px-2 sm:py-0.5 font-mono text-label uppercase text-on-canopy-rust ${
          offline ? "" : "invisible"
        }`}
      >
        <span className="sr-only sm:not-sr-only">Not saved</span>
        <span
          aria-hidden="true"
          className="block h-2 w-2 rounded-full bg-on-canopy-rust sm:hidden"
        />
      </span>
    </span>
  );
}
