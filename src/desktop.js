/**
 * The desktop shell, from the app's side.
 *
 * `electron/preload.js` exposes one object on `window`, and this is the only
 * module that knows its shape — the same discipline `src/storage.js` keeps for
 * the shape of a storage key. Five places need something from the shell (the
 * storage backend, the sign-in page's copy, the header badge, the books panel,
 * and the sign-out flush) and none of them should be reaching into a global to
 * get it.
 *
 * **Every function here is safe to call in a browser.** The web build has no
 * bridge, so each one answers the way the web would: `isDesktop` is false,
 * there is no path, and the rest are no-ops that report they did nothing. That
 * is what lets the callers stay free of `if (isDesktop())` around every use.
 */

function bridge() {
  return (typeof window !== "undefined" && window.__hbDesktop) || null;
}

/**
 * Whether the app is running inside the desktop shell.
 *
 * A fact about the process, settled by the preload before the bundle evaluated,
 * so it is safe to read at module scope — which `storage.js` does, to pick its
 * backend before any store initialiser runs.
 */
export function isDesktop() {
  return Boolean(bridge());
}

/**
 * The raw bridge, for `storage.js` and nothing else.
 *
 * Exported because the storage backend needs the whole object — the seeded
 * snapshot and the two write verbs — rather than any one call, and because
 * `storage.js` importing from here is what keeps the dependency one-way. The
 * reverse would be a cycle: this module must not need to know what a key is.
 */
export function storageBridge() {
  return bridge();
}

/**
 * What to call the machine the app is running on, inside a sentence.
 *
 * Four screens tell the household where their books are — the sign-in page, the
 * header badge, the import offer and the books panel — and on the web the
 * answer is "this browser" while in the shell it is "this computer". Getting it
 * wrong is not a typo: a desktop app that says the books are "in this browser"
 * is describing a thing the user is not looking at, and the one claim these
 * sentences exist to make is that the books are somewhere they can point to.
 *
 * **It is the noun only, and deliberately not a sentence builder.** Where the
 * two readings differ by more than the word — "safe *on* this computer" against
 * "safe *in* this browser", or a lost machine against a cleared cache — the
 * caller writes both out, because a helper that tried to cover those would be a
 * worse thing to read than the two sentences it replaced.
 */
export function deviceLabel() {
  return isDesktop() ? "computer" : "browser";
}

/** Where the books file lives, for the app to show and to offer to reveal. */
export function booksPath() {
  return bridge()?.path ?? null;
}

/**
 * Land every queued write, and wait for it.
 *
 * Awaited by sign-out and by "stop syncing", because both *delete* documents
 * and then end the session. The renderer's writes are fire-and-forget and the
 * shell coalesces them, so without this a quick quit could leave the previous
 * household's books sitting on the disk — the exact failure namespacing the
 * cache exists to prevent.
 *
 * Resolves immediately on the web, where the write already happened
 * synchronously in `localStorage`.
 */
export async function flushWrites() {
  const desktop = bridge();
  if (!desktop?.flush) return { ok: true };

  try {
    return (await desktop.flush()) ?? { ok: true };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  }
}

/** Show the books file in Explorer or Finder. */
export async function revealBooksFile() {
  const desktop = bridge();
  if (!desktop?.reveal) return { ok: false };

  try {
    return (await desktop.reveal()) ?? { ok: true };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  }
}

/**
 * Hand the user a file — the export, and the archive taken before a restore.
 *
 * Returns `{ ok, canceled, error }` rather than throwing, and **`canceled` is
 * not a failure**: dismissing a save dialog is an answer, and a caller that
 * treated it as an error would report "could not save your books" to somebody
 * who simply changed their mind. The restore flow reads it that way — a
 * cancelled archive stops the restore, because the safety copy is the thing
 * that makes it safe.
 *
 * On the web this returns `{ ok: false, unsupported: true }`, which is the
 * caller's signal to fall back to a download.
 */
export async function saveFile(name, text) {
  const desktop = bridge();
  if (!desktop?.saveFile) return { ok: false, unsupported: true };

  try {
    return (await desktop.saveFile(name, text)) ?? { ok: false };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  }
}

/**
 * Whether the local model is there, and which models it has.
 *
 * `{ ok: true, models }`, or `{ ok: false, reason }` — `"unsupported"` in a
 * browser, where there is no bridge and nothing to ask, and `"unreachable"`
 * when Ollama is not running. See `electron/assist.js`.
 */
export async function assistStatus() {
  const desktop = bridge();
  if (!desktop?.assistStatus) return { ok: false, reason: "unsupported" };

  try {
    return (await desktop.assistStatus()) ?? { ok: false, reason: "bad-response" };
  } catch (error) {
    return { ok: false, reason: "bad-response", error: String(error?.message ?? error) };
  }
}

/**
 * Ask the local model to read a sentence into `schema`'s shape.
 *
 * Resolves to `{ ok: true, content }` with the parsed object — which is the
 * model's reading and nothing more, so the caller checks every name in it
 * against the books before anything is offered — or `{ ok: false, reason }`.
 */
export async function askAssistant({ model, messages, schema }) {
  const desktop = bridge();
  if (!desktop?.assistAsk) return { ok: false, reason: "unsupported" };

  try {
    return (await desktop.assistAsk({ model, messages, schema })) ?? { ok: false, reason: "bad-response" };
  } catch (error) {
    return { ok: false, reason: "bad-response", error: String(error?.message ?? error) };
  }
}
