import { saveFile } from "./desktop";
import { LEGACY_KEYS, STORE_KEYS } from "./storage";

/**
 * The books as a file, and back again.
 *
 * Two doors need this and they must agree byte for byte: the export on
 * Configuration, and — once there is a desktop shell — the archive it writes
 * before a restore overwrites anything. A second serialiser would eventually
 * disagree with the first about the envelope, and the file that matters least
 * on the day it is written is the one that matters most a year later.
 *
 * **A local household has no copy but this one.** Signed in, the account's rows
 * in Postgres are the durable record and an export is a convenience; signed out
 * — which is the whole point of the desktop build — there is no server, so this
 * file *is* the backup, and the format has to survive being read by a version
 * of the app that does not exist yet.
 *
 * Hence the envelope. `schema` is what a future reader branches on, and it is
 * here from the first version rather than added when it is first needed, because
 * by then every file in the wild lacks it.
 */

/**
 * Stamped into every file, so a stray JSON file is not mistaken for books.
 *
 * Files exported while the app was called "Household Books" carry that name and
 * **still import**: `parseBooks` treats anything carrying a `schema` as an
 * envelope, and every stamped file has one, so the rename needed no second
 * constant and no migration. `electron/books.js` holds the shell's copy.
 */
export const FILE_APP = "canopy-budget";

/**
 * The shape of the wrapper, not of the books.
 *
 * It goes up when the *envelope* changes — a new field, a different place for
 * the documents — and **not** when a store's own records change shape. Those are
 * migrated on read by the store that owns them, keyed on field presence, which
 * is a mechanism this file deliberately does not duplicate: a document in here
 * is the same document that was in storage, so it arrives at exactly the
 * migration it would have met anyway.
 */
export const FILE_SCHEMA = 1;

/** Every key a file may carry. Legacy keys travel; the folds run on read. */
const KNOWN_KEYS = new Set([...STORE_KEYS, ...LEGACY_KEYS]);

/**
 * A snapshot, wrapped for writing.
 *
 * Pretty-printed with two spaces, and that is a decision rather than a default:
 * the user is being told this file is theirs, so it has to be a file they can
 * open, read and search. The size cost is irrelevant next to that — these are
 * tens of kilobytes.
 */
export function serializeBooks(snapshot, { at = new Date() } = {}) {
  return `${JSON.stringify(
    {
      app: FILE_APP,
      schema: FILE_SCHEMA,
      exportedAt: at.toISOString(),
      data: snapshot,
    },
    null,
    2
  )}\n`;
}

/**
 * A file, read back into a snapshot — or a sentence saying why not.
 *
 * Returns `{ ok, snapshot, error }`, the convention every mutator in this app
 * keeps, because the caller has something to put on screen either way.
 *
 * **Liberal about the wrapper, strict about the contents.** A bare flat map is
 * accepted as well as an envelope, since the books were a flat map before this
 * module existed and a file somebody assembled by hand is still their books. But
 * a key nobody recognises is a refusal rather than something to drop quietly: it
 * means either this is not a books file, or it was written by a later version
 * that knows about a store this one does not — and silently importing the part
 * we understood would leave the user believing they had restored everything.
 */
export function parseBooks(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file is not JSON. Pick a file exported from this app." };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "That file does not hold a set of books." };
  }

  // An envelope if it says it is one, and the bare map otherwise. `data` is
  // checked for shape rather than trusted, since a file can claim anything.
  const isEnvelope = parsed.app === FILE_APP || "schema" in parsed;
  const data = isEnvelope ? parsed.data : parsed;

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, error: "That file does not hold a set of books." };
  }

  if (isEnvelope && Number(parsed.schema) > FILE_SCHEMA) {
    return {
      ok: false,
      error: "That file was written by a newer version of this app. Update it and try again.",
    };
  }

  const unknown = Object.keys(data).filter((key) => !KNOWN_KEYS.has(key));
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `That file holds something this version does not know how to read: ${unknown
        .slice(0, 4)
        .join(", ")}. Update the app and try again.`,
    };
  }

  if (!Object.keys(data).some((key) => hasContent(data[key]))) {
    return { ok: false, error: "That file holds no books — there is nothing in it to restore." };
  }

  return { ok: true, snapshot: data };
}

/**
 * Whether a document holds anything.
 *
 * The same rule `hasStoredBooks` applies, and for the same reason: a store
 * writes `[]` on first render whether or not the user has done anything, so
 * counting an empty array would read a freshly-opened browser as having books.
 */
function hasContent(value) {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

/** `canopy-budget-2026-09-27.json`, and the archive's variant beside it. */
export function booksFilename({ at = new Date(), suffix = "" } = {}) {
  const day = [
    at.getFullYear(),
    String(at.getMonth() + 1).padStart(2, "0"),
    String(at.getDate()).padStart(2, "0"),
  ].join("-");
  return `canopy-budget${suffix ? `-${suffix}` : ""}-${day}.json`;
}

/**
 * Hand a file to the browser.
 *
 * The object URL is revoked, because this can run several times in a session —
 * an archive and then an export — and each one otherwise pins its whole blob in
 * memory for the life of the document.
 */
export function downloadFile(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Hand the user a file, by whichever door this build has.
 *
 * Two doors, one function, because three places need to write a file and all
 * three have to behave the same: the export, the archive taken before a
 * restore, and the archive taken before "stop syncing" replaces the local
 * books. In the shell it is a real save dialog, so the household picks where
 * their books land; in a browser it is a download, which is the only door
 * there is.
 *
 * **Cancelling is reported apart from failing**, and the distinction is the
 * whole reason this returns a shape rather than a boolean. Dismissing a save
 * dialog is an answer, not an error — telling somebody "could not save your
 * books" because they changed their mind would be a lie. It also has to stop
 * the operation it was protecting: a restore whose archive was cancelled must
 * not go on to overwrite the books it just failed to copy.
 */
export async function offerFile(filename, text) {
  const saved = await saveFile(filename, text);

  if (saved.ok) return { ok: true, path: saved.path };
  if (saved.canceled) return { ok: false, canceled: true };
  if (!saved.unsupported) return { ok: false, error: saved.error };

  // No shell: the browser's own download is the only way to hand over a file.
  try {
    downloadFile(filename, text);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  }
}
