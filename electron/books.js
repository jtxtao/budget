const fs = require("fs");
const path = require("path");

/**
 * The household's books, as a file on their own disk.
 *
 * **This module is the source of truth in local mode and the cache when signed
 * in, and in both cases it is the only copy on the machine.** That is the whole
 * reason the durability rules below are what they are rather than a
 * `writeFile` and a shrug.
 *
 * It lives in the **main** process, and that placement is load-bearing:
 *
 *   - The renderer needs a **synchronous** read at start-up. Five things in the
 *     app read storage before the first paint — four store initialisers and the
 *     guest-mode check that sits above every gate — so there is no point in the
 *     tree where a promise could be awaited on their behalf. `sendSync` can
 *     only be answered by a process that already has the data in hand, which is
 *     why `load()` runs before the window is created.
 *   - The **debounce has to survive the renderer**. A timer in the page cannot
 *     be flushed from `before-quit`, because by then the page is gone. So the
 *     renderer posts every write across immediately and the coalescing happens
 *     here, where the quit handlers can reach it.
 */

/**
 * Stamped into the file, so a stray JSON file is not mistaken for books.
 *
 * A file written while the app was called "Household Books" carries that name
 * instead, and still reads: the envelope test below accepts anything carrying a
 * `schema`, which every stamped file has, so the rename needed no second
 * constant here. `src/booksFile.js` holds the renderer's copy of both.
 */
const FILE_APP = "canopy-budget";

/**
 * The folder this app's books sat in before it was called Canopy Budget.
 *
 * `app.getPath("userData")` is built from `productName`, so renaming the app
 * moved the folder — `%APPDATA%/Canopy Budget` where there had been
 * `%APPDATA%/Household Books`, and the same sibling swap under
 * `~/Library/Application Support` and `~/.config`. Without the adoption in
 * `load()` the rename would read, on an installed copy, as a household's books
 * vanishing on upgrade.
 */
const LEGACY_APP_DIR = "Household Books";

/**
 * The shape of the *wrapper*, not of the books.
 *
 * It goes up when the envelope changes, and never because a store's records
 * changed shape — those are migrated on read by the store that owns them, keyed
 * on field presence. A document in here is the same document that was in
 * storage, so it meets exactly the migration it would have met anyway.
 */
const FILE_SCHEMA = 1;

/** Quiet after the last write before landing on disk. */
const TRAILING_MS = 300;

/**
 * The longest a write may be deferred, counted from the *first* dirty write
 * rather than the last.
 *
 * Without this the trailing timer can be starved indefinitely: tabbing across a
 * row of the register commits a cell every couple of hundred milliseconds, each
 * one resetting the timer, and nothing ever reaches the disk. Deliberately not
 * `SyncContext`'s 700ms — that number is tuned for a network round trip, and
 * this is a local file.
 */
const MAX_WAIT_MS = 2000;

/**
 * Owner read and write, and nobody else.
 *
 * The default umask leaves a new file readable by every account on the machine
 * (0644 on most Linux and macOS setups), and this file is a household's whole
 * ledger in plain JSON. Ignored on Windows, where the profile folder's own ACL
 * already keeps other users out.
 */
const PRIVATE_MODE = 0o600;

/** Applied after the fact as well, since `mode` only counts when a file is created. */
function makePrivate(file) {
  try {
    fs.chmodSync(file, PRIVATE_MODE);
  } catch {
    /* not fatal: the books are still better written than not */
  }
}

let filePath = null;
let bakPath = null;

/** key -> the parsed document. Parsed, so the file on disk stays legible. */
const documents = new Map();

let dirty = false;
let trailingTimer = null;
let maxWaitTimer = null;

/**
 * Whether this session has already taken its backup.
 *
 * The backup is **the file as it was found at launch**, not a rotation on every
 * save. Temp-and-rename already makes a torn write impossible, so a copy from
 * three hundred milliseconds ago protects against nothing at all. What a person
 * actually wants recovering is "the books as of last time I opened the app" —
 * after a bad restore, or a change they regret — and for that the copy has to
 * be old. Taking it lazily, at the first write, is what makes it exactly that:
 * until then the real file is still untouched.
 */
let backedUp = false;

function booksPath() {
  return filePath;
}

/**
 * Read the file into memory. Called once, before the window exists.
 *
 * A file that cannot be parsed is **moved aside, never overwritten**. Starting
 * empty and saving over it would destroy the only copy of the books at the
 * exact moment something had already gone wrong with them.
 */
function load(userDataDir) {
  filePath = path.join(userDataDir, "books.json");
  bakPath = path.join(userDataDir, "books.bak.json");

  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    // No file yet. A genuine first run looks exactly like an upgrade across the
    // rename from here, so ask the old folder before concluding it is one.
    adoptLegacy(userDataDir);
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const aside = path.join(
      userDataDir,
      `books.unreadable-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
    );
    try {
      fs.renameSync(filePath, aside);
    } catch {
      /* if we cannot even move it, still refuse to start writing over it */
      filePath = null;
    }
    return;
  }

  const data = documentsIn(parsed);
  if (!data) return;

  for (const [key, value] of Object.entries(data)) documents.set(key, value);
}

/**
 * The documents inside a parsed file, or null if that is not what it is.
 *
 * Liberal about the wrapper, the same way `parseBooks` is in the renderer, and
 * by the same test: a bare flat map is what the books were before the envelope
 * existed, and a file somebody assembled by hand is still theirs. Asking
 * whether the file *says* it is an envelope, rather than whether it happens to
 * have a `data` key, is what keeps the two readers agreeing about the same file
 * — and it is why a file stamped `household-books` still reads under the new
 * name, since every stamped file carries a `schema` beside the stamp.
 *
 * One function because two readers now need it: the file in this app's own
 * folder, and the one left behind in the folder it used before the rename.
 */
function documentsIn(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const isEnvelope = parsed.app === FILE_APP || "schema" in parsed;
  const data = isEnvelope ? parsed.data : parsed;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return data;
}

/**
 * The books from the folder this app used before it was renamed.
 *
 * **Read, never moved or written.** The old file is left exactly where it was,
 * which makes it a free copy of the books as they stood on the day of the
 * upgrade — the same thing `books.bak.json` is for, and worth more here because
 * a rename is precisely when somebody wants to be able to go back. The first
 * ordinary write lands in the new folder through temp-and-rename as usual, so
 * nothing special happens on the way out.
 *
 * Adopting is therefore **idempotent**: a session that reads the old books and
 * changes nothing writes nothing, and the next launch adopts them again. What
 * it is not is a merge — it runs only when this app's own file is *absent*,
 * because once there is a file here it is the truth and the old folder is
 * history. In particular it does not run when the file here was found and
 * quarantined as unreadable: something has already gone wrong with the books at
 * that point, and quietly substituting an older copy is the one response that
 * would hide it.
 */
function adoptLegacy(userDataDir) {
  // `%APPDATA%/Canopy Budget` beside `%APPDATA%/Household Books`, and the same
  // sibling swap under `~/Library/Application Support` and `~/.config`.
  const legacyPath = path.join(path.dirname(userDataDir), LEGACY_APP_DIR, "books.json");

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(legacyPath, "utf8"));
  } catch {
    // No old folder, or nothing readable in it: a real first run after all.
    return;
  }

  const data = documentsIn(parsed);
  if (!data) return;

  for (const [key, value] of Object.entries(data)) documents.set(key, value);
}

/** Every document, parsed, for the preload's one synchronous read. */
function snapshot() {
  return Object.fromEntries(documents);
}

function clearTimers() {
  clearTimeout(trailingTimer);
  clearTimeout(maxWaitTimer);
  trailingTimer = null;
  maxWaitTimer = null;
}

function schedule() {
  dirty = true;
  clearTimeout(trailingTimer);
  trailingTimer = setTimeout(writeNow, TRAILING_MS);
  // Set from the first dirty write and deliberately not reset by later ones.
  if (!maxWaitTimer) maxWaitTimer = setTimeout(writeNow, MAX_WAIT_MS);
}

/**
 * Put the books on disk, now and synchronously.
 *
 * Synchronous because the callers that matter most are the quit handlers, and
 * there is no event loop left to await a promise on by the time they run.
 *
 * Temp file then rename: a rename within a directory is atomic, so a crash or a
 * pulled plug leaves either the old file or the new one and never half of
 * either.
 */
function writeNow() {
  clearTimers();
  if (!dirty || !filePath) return { ok: true };

  try {
    if (!backedUp) {
      // The real file is still exactly as this session found it, which is the
      // whole point of taking the copy here rather than at launch.
      try {
        fs.copyFileSync(filePath, bakPath);
        // A copy keeps the source's mode, which for a file an older build wrote
        // is the world-readable default.
        makePrivate(bakPath);
      } catch {
        // No file to back up on a first run, which is not a failure.
      }
      backedUp = true;
    }

    const payload = `${JSON.stringify(
      {
        app: FILE_APP,
        schema: FILE_SCHEMA,
        writtenAt: new Date().toISOString(),
        data: Object.fromEntries(documents),
      },
      null,
      2
    )}\n`;

    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, payload, { encoding: "utf8", mode: PRIVATE_MODE });
    // A temp file left by a crash keeps whatever mode it was created with.
    makePrivate(tmp);
    fs.renameSync(tmp, filePath);
    dirty = false;
    return { ok: true };
  } catch (error) {
    // Kept dirty, so the next write or the next quit tries again.
    return { ok: false, error: String(error?.message ?? error) };
  }
}

/**
 * Take one document from the renderer.
 *
 * The renderer speaks in JSON strings, because its end of this is a drop-in
 * replacement for `localStorage`. It is parsed here so that what lands on disk
 * is readable JSON rather than a map of escaped strings — the split that lets
 * the same file be both a `Storage` and something a person can open.
 */
function write(key, json) {
  if (typeof key !== "string" || typeof json !== "string") return;

  let value;
  try {
    value = JSON.parse(json);
  } catch {
    return;
  }

  // Unchanged is not a write. The renderer already guards this, but a second
  // check here is free and keeps the disk out of it if that ever regresses.
  if (documents.has(key) && JSON.stringify(documents.get(key)) === json) return;

  documents.set(key, value);
  schedule();
}

function remove(key) {
  if (typeof key !== "string" || !documents.has(key)) return;
  documents.delete(key);
  schedule();
}

/** Everything the quit handlers need, in one call. */
function flush() {
  return writeNow();
}

module.exports = { load, snapshot, write, remove, flush, booksPath, FILE_SCHEMA };
