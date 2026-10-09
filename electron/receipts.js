const fs = require("fs");
const path = require("path");

/**
 * Receipt files on this computer, for the household that keeps its books here.
 *
 * One folder, `receipts/` beside the books file, and one file per receipt named
 * by its id and the extension its type earns. Three verbs and nothing general:
 * write this file, open this file, delete this file — each about an id the page
 * minted, never a path the page chose. That is the bridge's rule (see
 * `preload.js`): a verb that would carry anything is a general verb with a
 * narrow name.
 *
 * The types and the size cap are written out again here because main cannot
 * import `src/receipts.js`; change one, change both.
 */

const TYPES_BY_EXT = new Set(["pdf", "jpg", "png", "webp", "gif", "heic", "heif"]);
const MAX_BYTES = 10 * 1024 * 1024;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function dirFor(userData) {
  return path.join(userData, "receipts");
}

function find(dir, id) {
  if (!ID.test(String(id))) return null;
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const name = names.find((entry) => entry.startsWith(`${id}.`));
  return name ? path.join(dir, name) : null;
}

/**
 * Write one receipt. Temp file then rename, the books file's rule, so a crash
 * leaves the whole file or none of it; owner-only, since it is the same
 * household's paperwork.
 */
function put(userData, id, ext, bytes) {
  if (!ID.test(String(id))) return { ok: false, error: "That is not a receipt id." };
  if (!TYPES_BY_EXT.has(ext)) return { ok: false, error: "That kind of file cannot be a receipt." };
  if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > MAX_BYTES) {
    return { ok: false, error: "That file is empty or over 10 MB." };
  }

  const dir = dirFor(userData);
  const target = path.join(dir, `${id}.${ext}`);
  const temp = `${target}.tmp`;
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(temp, Buffer.from(bytes), { mode: 0o600 });
    fs.renameSync(temp, target);
    return { ok: true };
  } catch (error) {
    try {
      fs.rmSync(temp, { force: true });
    } catch {
      // Nothing more to do; the write already failed and says so.
    }
    return { ok: false, error: String(error?.message ?? error) };
  }
}

/** Where one receipt is, or null — for `shell.openPath` in main. */
function locate(userData, id) {
  return find(dirFor(userData), id);
}

function remove(userData, id) {
  const file = find(dirFor(userData), id);
  if (!file) return { ok: true };
  try {
    fs.rmSync(file, { force: true });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  }
}

module.exports = { put, locate, remove, MAX_BYTES };
