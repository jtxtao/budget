const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  protocol,
  session,
  shell,
} = require("electron");
const fs = require("fs");
const path = require("path");
const books = require("./books");

/**
 * The desktop shell.
 *
 * One window, one instance, one file, and — unless somebody signs in — no
 * network at all. The sign-in page tells a household that nothing is sent
 * anywhere; most of this file is the machinery that makes that a property of
 * the process rather than a promise in a paragraph.
 */

/**
 * Development is "pointed at a dev server", not "not packaged".
 *
 * Keyed off the URL rather than `app.isPackaged` because that is what the
 * difference actually is: every relaxation below — `unsafe-eval` in the policy,
 * localhost in the egress filter — exists to let CRA's dev server and its
 * hot-reload socket work, and none of it should apply to an unpackaged run that
 * is serving the real build. It also means `electron .` against `build/`
 * exercises exactly the path a packaged app takes, which is the only way to
 * test the `app://` scheme without building an installer first.
 */
const DEV_URL = process.env.ELECTRON_START_URL || "";
const isDev = Boolean(DEV_URL);
const BUILD_DIR = path.join(__dirname, "..", "build");

/** The origin the app is served from in production. */
const APP_ORIGIN = "app://books";

/**
 * Where the account server lives, if this build has one.
 *
 * Used for exactly one thing: the one host the egress filter is allowed to open
 * when somebody is signed in. Absent, and nothing outside the app's own origin
 * is reachable — which is a working app, on this computer's own books, rather
 * than a broken one.
 *
 * **Read from a generated file rather than from `process.env`, because the
 * environment is empty by the time this runs.** CRA inlines the URL into the
 * bundle at build time; nothing puts it into the environment of the Electron
 * process spawned beside the dev server, and a packaged app launched from a
 * dock has no developer shell behind it at all. Taking it from `process.env`
 * therefore yielded `null` in every real run: the filter cancelled every
 * request to the account server, and signing in failed with the form saying
 * nothing. `electron/writeShellConfig.js` resolves it once, from the same files
 * CRA reads, and the npm scripts run it before both the dev shell and the
 * packager.
 *
 * A missing file is not an error — an unconfigured checkout is a supported
 * build — but it is worth one line on the console, because "sign-in does
 * nothing" is otherwise indistinguishable from a forgotten build step.
 */
const SUPABASE_ORIGIN = (() => {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, "shell-config.json"), "utf8"));
    return config.supabaseOrigin || null;
  } catch {
    console.log(
      "[canopy-budget] no electron/shell-config.json — running local only. `npm run desktop` writes it."
    );
    return null;
  }
})();

// ---------------------------------------------------------------------------
// Chromium's own background networking
// ---------------------------------------------------------------------------
// None of this is the app's traffic, which is exactly why it has to be turned
// off explicitly: a household that opened a local budget app would not expect
// it to talk to a component updater, and "we did not write that request" is not
// a defence when the claim is that there are none.
app.commandLine.appendSwitch("disable-features", "ComponentUpdater,OptimizationHints");
app.commandLine.appendSwitch("disable-background-networking");

/**
 * Registered before `whenReady`, which is the only time it can be.
 *
 * **Standard and secure is the whole reason this scheme exists** rather than
 * loading `file://`. A standard scheme gets a real origin, which means the
 * History API works — so `BrowserRouter` and every deep link keep working
 * untouched — and `localStorage` and a normal CSP behave exactly as they do on
 * https. Under `file://` all three break at once.
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

/**
 * Two processes over one file means last-writer-wins, and the loser's books are
 * gone with no warning and no trace.
 *
 * The cross-tab `storage` event was the guard against exactly this shape of
 * loss one process narrower; nothing plays that role here, so the second
 * instance simply must not exist.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [existing] = BrowserWindow.getAllWindows();
    if (!existing) return;
    if (existing.isMinimized()) existing.restore();
    existing.focus();
  });

  app.whenReady().then(start);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * Serve `build/` over `app://`.
 *
 * A path with no extension is a route rather than a file, so it falls back to
 * `index.html` — the same single-page rewrite the web deploy relies on, which
 * is what makes a deep link into `/transactions` work on a cold start.
 *
 * Because of this handler, CRA's absolute `/static/...` output resolves
 * correctly and `homepage` stays unset in `package.json` — setting it to `"./"`
 * would have broken deep links on the web to fix them here.
 */
function serveApp() {
  protocol.handle("app", async (request) => {
    const url = new URL(request.url);
    let rel = decodeURIComponent(url.pathname);

    if (rel === "/" || !path.extname(rel)) rel = "/index.html";

    const target = path.normalize(path.join(BUILD_DIR, rel));
    // A traversal out of the build directory is the one way this handler could
    // turn into "read any file on the disk".
    if (!target.startsWith(BUILD_DIR)) {
      return new Response("Forbidden", { status: 403 });
    }

    try {
      const body = await fs.promises.readFile(target);
      return new Response(body, {
        headers: { "content-type": MIME[path.extname(target)] ?? "application/octet-stream" },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

/**
 * The same policy `vercel.json` sets on the web deploy, with `app:` standing in
 * for `'self'`.
 *
 * The two are one policy written in two languages. **Change one and change the
 * other** — there is no way to share a string between a JSON config Vercel
 * reads at deploy time and a JavaScript file Electron reads at run time.
 */
function contentSecurityPolicy() {
  const connect = [
    "'self'",
    ...(SUPABASE_ORIGIN ? [SUPABASE_ORIGIN, SUPABASE_ORIGIN.replace(/^https:/, "wss:")] : []),
    // The dev server and its hot-reload socket, in development only.
    ...(isDev ? ["http://localhost:*", "ws://localhost:*"] : []),
  ].join(" ");

  return [
    `default-src 'self' ${isDev ? "http://localhost:*" : "app:"}`,
    `script-src 'self' ${isDev ? "'unsafe-eval' http://localhost:*" : "app:"}`,
    "style-src 'self' 'unsafe-inline' app: http://localhost:*",
    "font-src 'self' app: http://localhost:*",
    "img-src 'self' data: app: http://localhost:*",
    `connect-src ${connect}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

/**
 * **An allow-list, not a deny-list.**
 *
 * The requirement is "zero requests", and a deny-list is whack-a-mole against
 * that: it can only block the things somebody thought of. This cancels
 * everything that is not the app's own origin, plus the account server when —
 * and only when — there is a session to justify it.
 */
function guardEgress() {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const { url } = details;

    const allowed =
      url.startsWith("app://") ||
      url.startsWith("devtools://") ||
      url.startsWith("blob:") ||
      url.startsWith("data:") ||
      (isDev && url.startsWith("http://localhost")) ||
      (isDev && url.startsWith("ws://localhost")) ||
      (SUPABASE_ORIGIN && url.startsWith(SUPABASE_ORIGIN)) ||
      (SUPABASE_ORIGIN && url.startsWith(SUPABASE_ORIGIN.replace(/^https:/, "wss:")));

    callback({ cancel: !allowed });
  });
}

function hardenSession() {
  // Chromium downloads its dictionaries from Google the first time a spell
  // check runs, which is a request this app has no business making.
  session.defaultSession.setSpellCheckerEnabled(false);

  // Nothing here needs a camera, a microphone, a location or a notification.
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [contentSecurityPolicy()],
      },
    });
  });
}

/**
 * `ledger` — the page's own ground — in each of the Grove's two modes, so a
 * cold start does not flash the wrong one before the first paint arrives.
 *
 * **Hard-coded, because the main process cannot read a CSS variable.** These
 * are the two `--c-ledger` values in `src/index.css`, and moving one there
 * means moving it here; `public/index.html`'s `theme-color` is the third copy
 * of the same idea and is the header's green rather than the page's ground.
 */
const GROUND = { light: "#F6F1E7", dark: "#14110E" };

/**
 * Which ground to open on.
 *
 * The app's own answer is `useTheme`'s: a stored choice, and the system
 * preference while there is none. **Main cannot see the stored choice** — it
 * lives in the renderer's `localStorage`, which does not exist until there is a
 * renderer, and this figure is needed to construct one. So the system
 * preference is what is available, and it is the right answer for everybody who
 * has not pinned a mode, which is everybody until they touch the switch.
 *
 * The residual: somebody who pins a mode *against* their OS gets one frame of
 * the other ground on a cold start. Closing that would mean main keeping its
 * own copy of the preference on disk, which is a second home for a fact the
 * renderer already owns — not worth it for one frame, and a worse trade than
 * the flash. `nativeTheme` is read at construction rather than cached, so a
 * relaunch after an OS change is already right.
 */
function groundColor() {
  return nativeTheme.shouldUseDarkColors ? GROUND.dark : GROUND.light;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: groundColor(),
    show: false,
    title: "Canopy Budget",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });

  win.once("ready-to-show", () => win.show());

  /**
   * A window that fails to load shows a blank frame and says nothing, which is
   * the worst way for the `app://` handler to be wrong. Surfaced rather than
   * swallowed, because the two likely causes — a missing `build/` and a path
   * the handler refused — are both instantly recognisable from the message.
   */
  win.webContents.on("did-fail-load", (_event, code, description, url) => {
    if (code === -3) return; // aborted, which a normal in-app navigation raises
    console.error(`[canopy-budget] could not load ${url}: ${description} (${code})`);
  });

  // Opt-in, because forwarding every renderer log to a terminal nobody is
  // watching is noise in normal use.
  if (process.env.ELECTRON_DEBUG) {
    win.webContents.on("console-message", (_event, _level, message) => {
      console.log(`[renderer] ${message}`);
    });
    win.webContents.on("did-finish-load", () => {
      console.log(`[canopy-budget] loaded ${win.webContents.getURL()}`);
    });
  }

  // Nothing in this app opens a second window, and a second window over the
  // same books file is the same hazard as a second process.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    const allowed = isDev ? url.startsWith(DEV_URL) : url.startsWith(APP_ORIGIN);
    if (!allowed) {
      event.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    }
  });

  // A renderer that dies takes its unsaved edits with it unless the books are
  // already somewhere else — which, because main holds them, they are.
  win.webContents.on("render-process-gone", () => books.flush());

  win.loadURL(isDev ? DEV_URL : `${APP_ORIGIN}/index.html`);
  return win;
}

function buildMenu(win) {
  const template = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
    {
      label: "Books",
      submenu: [
        {
          label: "Show the books file",
          click: () => shell.showItemInFolder(books.booksPath()),
        },
        { type: "separator" },
        {
          label: "Save now",
          accelerator: "CmdOrCtrl+S",
          click: () => books.flush(),
        },
        { type: "separator" },
        { role: process.platform === "darwin" ? "close" : "quit" },
      ],
    },
    // Required on macOS for Cmd+C / Cmd+V to work at all — without an Edit menu
    // the OS has nothing to route the standard shortcuts to.
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  return win;
}

function start() {
  // Before the window, so the synchronous read the preload makes can be
  // answered from memory the moment it arrives.
  books.load(app.getPath("userData"));

  serveApp();
  hardenSession();
  guardEgress();

  ipcMain.on("books:readAll", (event) => {
    // `returnValue`, because the preload asks with `sendSync`.
    event.returnValue = { documents: books.snapshot(), path: books.booksPath() };
  });

  ipcMain.on("books:write", (_event, key, json) => books.write(key, json));
  ipcMain.on("books:remove", (_event, key) => books.remove(key));
  ipcMain.handle("books:flush", () => books.flush());
  ipcMain.handle("books:reveal", () => {
    shell.showItemInFolder(books.booksPath());
    return { ok: true };
  });

  ipcMain.handle("books:saveFile", async (event, name, text) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: "Save your books",
      defaultPath: name,
      filters: [{ name: "Books", extensions: ["json"] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };

    try {
      await fs.promises.writeFile(filePath, text, "utf8");
      return { ok: true, path: filePath };
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) };
    }
  });

  buildMenu(createWindow());

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

// ---------------------------------------------------------------------------
// Landing the books before the process goes
//
// All of these are synchronous on purpose. By the time they run there is no
// event loop left to await a promise on, and a debounce that has not fired yet
// is exactly the edit the user made last.
// ---------------------------------------------------------------------------
app.on("before-quit", () => books.flush());
app.on("will-quit", () => books.flush());

app.on("window-all-closed", () => {
  books.flush();
  // macOS keeps the app alive with no windows, which is the platform's
  // convention rather than an oversight.
  if (process.platform !== "darwin") app.quit();
});
