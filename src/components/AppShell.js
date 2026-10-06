import { NavLink } from "react-router-dom";
import { navigation } from "../navigation";
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
        <div className="mx-auto max-w-6xl px-6">
          <div className="flex flex-wrap items-center justify-between gap-4 pt-5">
            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
              <span className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-on-canopy-soft">
                <Elder className="h-9 w-10" />
              </span>
              <span className="font-display text-2xl text-on-canopy">Household Books</span>
              <span className="font-sans text-label font-bold uppercase text-on-canopy-soft">
                Personal budget
              </span>
            </div>
            {/* The switch is a preference about the screen and the account
                control is who the books belong to, so identity sits at the
                far edge where it has always been and the switch tucks in
                beside it. */}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="canopy"
                className="rounded-full gap-2"
                type="button"
                aria-pressed={dark}
                onClick={toggleTheme}
              >
                {dark ? <MoonIcon /> : <SunIcon />}
                Dark mode
              </Button>
              <AccountControl />
            </div>
          </div>
          <nav aria-label="Sections" className="mt-4 flex flex-wrap gap-x-7">
            {navigation.map(({ path, label }) => (
              <NavLink
                key={path}
                to={path}
                end={path === "/"}
                className={({ isActive }) =>
                  `border-b-[3px] pb-2.5 pt-1 font-sans text-sm transition-colors ${
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
      <main className="mx-auto max-w-6xl px-6 py-9">{children}</main>
    </div>
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
        <span
          className="font-mono text-label uppercase text-on-canopy-soft"
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
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <SyncBadge state={syncState} />
      {/* `title` rather than a wider column: an address long enough to be
          truncated is still identifiable by its start, and the header must not
          reflow around it. */}
      <span
        title={email}
        className="max-w-[16rem] truncate font-mono text-label text-on-canopy-soft"
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
      <Button variant="canopy" size="sm" type="button" onClick={signOut}>
        Sign out
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
 */
function SyncBadge({ state }) {
  if (state === SYNC_STATE.SAVING) {
    return (
      <span role="status" className="font-mono text-label uppercase text-on-canopy-soft">
        Saving…
      </span>
    );
  }
  if (state === SYNC_STATE.OFFLINE) {
    return (
      <span
        role="status"
        title={`Your edits are safe ${
          isDesktop() ? "on this computer" : "in this browser"
        } and will be sent when the connection is back.`}
        className="border border-on-canopy-rust/60 px-2 py-0.5 font-mono text-label uppercase text-on-canopy-rust"
      >
        Not saved
      </span>
    );
  }
  return null;
}
