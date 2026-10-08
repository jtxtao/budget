const { contextBridge, ipcRenderer } = require("electron");

/**
 * The only thing the page can reach outside itself.
 *
 * The renderer runs sandboxed with no Node integration, so this file is the
 * whole surface: a snapshot of the books, four things that can be done to them,
 * two questions for the local model, and nothing else. There is deliberately no
 * general "read a file" or "run a command" here — every capability is one verb
 * the app actually needs.
 *
 * **The snapshot is fetched with `sendSync`, and that is not laziness.** Five
 * things in the app read storage before the first paint — `foldLegacyLedger`,
 * `readStoredLedger`, `legacyPlannedCentsById` and `storedGroupBuckets` build
 * their stores' lazy defaults, and `isGuestMode()` decides which door to show
 * from above every gate, where no provider could hold the render back for it.
 * A preload script runs to completion before any page script evaluates, so this
 * one blocking call at start-up is what lets all five keep working untouched.
 * It happens exactly once per window load.
 *
 * `books:readAll` is answered by `ipcMain.on` setting `event.returnValue` —
 * **never `ipcMain.handle`**, which returns a promise that `sendSync` reads as
 * `undefined`, and the app would boot silently with empty books.
 */
const boot = ipcRenderer.sendSync("books:readAll");

contextBridge.exposeInMainWorld("__hbDesktop", {
  /** Every document, parsed. `src/storage.js` seeds its cache from this. */
  snapshot: boot?.documents ?? {},

  /** Where the file is, so the app can show it and offer to reveal it. */
  path: boot?.path ?? null,

  // Fire-and-forget: the renderer has already written its own cache, so it must
  // never wait on the disk to show what the user just did. Main coalesces these
  // and owns when they land.
  write: (key, json) => ipcRenderer.send("books:write", key, json),
  remove: (key) => ipcRenderer.send("books:remove", key),

  /**
   * Land everything queued, and wait for it.
   *
   * Awaited by sign-out and by "stop syncing", both of which delete documents
   * and then end the session. Without it a quick quit could leave the previous
   * household's books on the disk, which is the whole thing the namespacing
   * exists to prevent.
   */
  flush: () => ipcRenderer.invoke("books:flush"),

  reveal: () => ipcRenderer.invoke("books:reveal"),

  /** Hand the user a file — the export, and the archive before a restore. */
  saveFile: (name, text) => ipcRenderer.invoke("books:saveFile", name, text),

  /**
   * The local model, through main. Two verbs and no more: whether Ollama is
   * there, and "read this sentence into this shape". Neither can reach the
   * books — the answer comes back to the page, which checks every name in it
   * and opens an ordinary form. See `electron/assist.js`.
   */
  assistStatus: () => ipcRenderer.invoke("assist:status"),
  assistAsk: (input) => ipcRenderer.invoke("assist:ask", input),
});
