#!/usr/bin/env node
/**
 * Hand the shell the one thing it cannot work out for itself.
 *
 * `electron/main.js` runs a **deny-everything egress filter** and writes a CSP
 * to match, and both need the account server's origin — the single host this
 * app may ever open. The renderer knows it, because Create React App inlines
 * `REACT_APP_SUPABASE_URL` into the bundle at build time. The main process does
 * not, and cannot:
 *
 *   - `.env.local` is read by CRA's own dotenv, inside the build. Nothing puts
 *     it into the environment of the Electron process that `npm run desktop`
 *     spawns beside it.
 *   - A packaged app is launched from a dock or a Start menu, where none of the
 *     developer's shell environment exists at all.
 *
 * Left unanswered, `SUPABASE_ORIGIN` is null, the filter cancels every request
 * to the account server and the CSP omits it — so the sign-in form is there,
 * the credentials are right, and nothing happens. **The desktop build could
 * only ever run locally, silently.**
 *
 * So the origin is resolved once, here, from the same files CRA itself reads
 * and in the same order, and written beside the shell where the packager will
 * pick it up. One input, two readers, and no way for the bundle and the filter
 * to disagree about who the app is allowed to talk to.
 *
 * **It always writes**, including a `null` when nothing is configured. A stale
 * file left from an earlier build would let the shell open a host the bundle it
 * is sitting next to knows nothing about, which is the one failure an
 * allow-list exists to prevent.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUTPUT = path.join(__dirname, "shell-config.json");

/**
 * The environment files CRA reads, most specific first.
 *
 * The order is copied from `react-scripts/config/env.js` deliberately rather
 * than simplified to "just `.env.local`": a household that keeps a staging
 * project in `.env.development` and their real one in `.env.production` would
 * otherwise get a shell configured for the wrong one — which reads as the app
 * being broken rather than as a config being picked up.
 *
 * `.env.<mode>.local` is absent for tests in CRA and irrelevant here, since
 * nothing packages a test build.
 */
function envFiles(mode) {
  return [
    path.join(ROOT, `.env.${mode}.local`),
    path.join(ROOT, ".env.local"),
    path.join(ROOT, `.env.${mode}`),
    path.join(ROOT, ".env"),
  ];
}

/**
 * One variable, out of the first file that states it.
 *
 * A deliberately small parser rather than a dependency: this script has to run
 * before anything is installed in a packaging environment, and the whole of
 * what it needs from dotenv's format is `KEY=value` with optional quotes and
 * `#` comments. Anything more elaborate in one of those files is not something
 * a URL would be written with.
 *
 * **A real environment variable wins over every file**, which is dotenv's own
 * rule and therefore CRA's: a CI job that exports the URL is stating it more
 * deliberately than a file checked out beside it.
 */
function readVariable(name, mode) {
  if (process.env[name]) return process.env[name];

  for (const file of envFiles(mode)) {
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }

    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?([\w.-]+)\s*=\s*(.*)?$/.exec(line);
      if (!match || match[1] !== name) continue;

      let value = (match[2] ?? "").trim();
      // A quoted value keeps whatever is inside the quotes; an unquoted one
      // stops at a comment, since `URL=https://x # staging` is one of those.
      if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
      else value = value.split(" #")[0].trim();

      if (value) return value;
    }
  }

  return null;
}

/**
 * The origin, not the URL.
 *
 * What the filter and the policy both compare against is a scheme and a host,
 * so the narrowing happens once, here, rather than in the two places that would
 * otherwise each have to remember to do it. A URL that will not parse is the
 * same answer as none at all: a configuration this shell cannot honour must not
 * become a host it opens.
 */
function originOf(url) {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function main() {
  // The caller's word first: the npm script knows which build it is about to
  // make, where an inherited `NODE_ENV` is only whatever the shell happened to
  // be carrying.
  const mode = process.argv[2] || process.env.NODE_ENV || "production";
  const url = readVariable("REACT_APP_SUPABASE_URL", mode);
  const origin = originOf(url);

  const config = {
    // Stamped so a person opening the file knows what wrote it and when, and so
    // a shell config from an older layout is recognisable rather than puzzling.
    generatedBy: "electron/writeShellConfig.js",
    generatedAt: new Date().toISOString(),
    mode,
    supabaseOrigin: origin,
  };

  fs.writeFileSync(OUTPUT, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  if (origin) {
    console.log(`[canopy-budget] shell may reach ${origin} (${mode})`);
  } else if (url) {
    console.warn(
      `[canopy-budget] REACT_APP_SUPABASE_URL is not a URL ("${url}"), so the desktop build will run locally only.`
    );
  } else {
    console.log(
      "[canopy-budget] no REACT_APP_SUPABASE_URL — the desktop build will run on this computer's own books, with no network at all."
    );
  }
}

main();
