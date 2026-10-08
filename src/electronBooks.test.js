/**
 * `electron/books.js` — the household's books as a file on their own disk.
 *
 * **It lives in `src/` and it is not renderer code**, which needs saying
 * because nothing else in this suite is like that. Create React App pins
 * Jest's `roots` to `<rootDir>/src` and does not allow that key to be
 * overridden (`react-scripts/scripts/utils/createJestConfig.js` lists what it
 * will take, and `roots` is not on it), so a test file under `electron/` is
 * never discovered — it does not fail, it silently does not exist. Putting it
 * here is the price of one test runner; the alternative is a second Jest
 * install with its own config to keep in step with this one.
 *
 * What is pinned down here is **durability, not behaviour**. Everything this
 * module does is one map and four small functions; what is hard about it is
 * that in local mode this file is the only copy of the books anywhere, so the
 * ways it can lose them are the whole subject:
 *
 *   - a write that is still sitting in a debounce when the app quits,
 *   - a file that cannot be parsed being started over rather than kept,
 *   - a backup that turns out to be a copy of the damage,
 *   - a torn write, which temp-and-rename is what prevents.
 *
 * Real files in a real temporary directory rather than a mocked `fs`: the
 * atomicity being relied on is the filesystem's own, and a mock would assert
 * that this module calls `renameSync` rather than that renaming works.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

let root;
let dir;
let books;

/**
 * Fresh module state per test — this module is a singleton over one file.
 *
 * `dir` is a *named folder inside* `root` rather than the temp directory
 * itself, because that is the shape of the real thing: `getPath("userData")` is
 * always `<some parent>/<productName>`, and the adoption across the rename
 * reads a sibling of it. A fixture rooted at `os.tmpdir()` would make that
 * sibling a shared global folder.
 */
beforeEach(() => {
  jest.useFakeTimers();
  jest.resetModules();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "canopy-budget-"));
  dir = path.join(root, "Canopy Budget");
  fs.mkdirSync(dir);
  books = require("../electron/books");
});

afterEach(() => {
  jest.useRealTimers();
  fs.rmSync(root, { recursive: true, force: true });
});

const at = (name) => path.join(dir, name);
const exists = (name) => fs.existsSync(at(name));
const read = (name) => JSON.parse(fs.readFileSync(at(name), "utf8"));
const seed = (name, contents) =>
  fs.writeFileSync(at(name), typeof contents === "string" ? contents : JSON.stringify(contents));

/** The name the quarantined copy is given, whatever timestamp it carries. */
const unreadableFile = () => fs.readdirSync(dir).find((name) => name.startsWith("books.unreadable-"));

describe("reading the file at start-up", () => {
  it("starts empty on a first run, and does not create a file it has nothing to put in", () => {
    books.load(dir);

    expect(books.snapshot()).toEqual({});

    // The quit handlers call this unconditionally. A household that opened the
    // app and closed it again should leave no trace at all.
    books.flush();
    expect(exists("books.json")).toBe(false);
  });

  it("reads the envelope it writes", () => {
    seed("books.json", {
      app: "canopy-budget",
      schema: 1,
      writtenAt: "2026-09-01T00:00:00.000Z",
      data: { budgets: [{ id: "a" }], paySchedule: { cadence: "fortnightly" } },
    });

    books.load(dir);

    expect(books.snapshot()).toEqual({
      budgets: [{ id: "a" }],
      paySchedule: { cadence: "fortnightly" },
    });
  });

  it("reads a bare map, which is what the books were before the envelope", () => {
    seed("books.json", { budgets: [{ id: "a" }] });

    books.load(dir);

    expect(books.snapshot()).toEqual({ budgets: [{ id: "a" }] });
  });

  it("moves a file it cannot parse aside rather than writing over it", () => {
    seed("books.json", '{"budgets": [{"id": "a"}');

    books.load(dir);

    // The damaged bytes survive, under a name that says what happened to them.
    const aside = unreadableFile();
    expect(aside).toBeDefined();
    expect(fs.readFileSync(at(aside), "utf8")).toBe('{"budgets": [{"id": "a"}');

    // And the app starts, rather than refusing to open at all.
    expect(books.snapshot()).toEqual({});

    books.write("budgets", JSON.stringify([{ id: "b" }]));
    books.flush();
    expect(read("books.json").data).toEqual({ budgets: [{ id: "b" }] });
  });

  it("ignores a file holding something that is not a set of books", () => {
    seed("books.json", [1, 2, 3]);

    books.load(dir);

    expect(books.snapshot()).toEqual({});
  });
});

/**
 * The app was called "Household Books", and `getPath("userData")` is built from
 * that name — so renaming it moved the folder out from under an installed copy.
 * On that machine a first run and an upgrade are the same thing on disk, which
 * is why this is read-only and idempotent rather than a one-shot move.
 */
describe("the folder the app used before it was renamed", () => {
  const legacyDir = () => path.join(root, "Household Books");
  const seedLegacy = (contents) => {
    fs.mkdirSync(legacyDir(), { recursive: true });
    fs.writeFileSync(path.join(legacyDir(), "books.json"), JSON.stringify(contents));
  };
  const legacyRaw = () => fs.readFileSync(path.join(legacyDir(), "books.json"), "utf8");

  it("adopts the old books when this folder has none, stamp and all", () => {
    seedLegacy({
      app: "household-books",
      schema: 1,
      data: { budgets: [{ id: "a", name: "Food" }] },
    });

    books.load(dir);

    expect(books.snapshot()).toEqual({ budgets: [{ id: "a", name: "Food" }] });
  });

  it("leaves the old file exactly where it was, as the copy from before the upgrade", () => {
    seedLegacy({ app: "household-books", schema: 1, data: { budgets: [{ id: "a" }] } });
    const before = legacyRaw();

    books.load(dir);

    // Adopting is a read. Nothing is written here until the household edits
    // something, and when they do it lands in the new folder.
    books.flush();
    expect(exists("books.json")).toBe(false);
    expect(legacyRaw()).toBe(before);

    books.write("budgets", JSON.stringify([{ id: "a" }, { id: "b" }]));
    books.flush();
    expect(read("books.json").data).toEqual({ budgets: [{ id: "a" }, { id: "b" }] });
    expect(legacyRaw()).toBe(before);
  });

  it("prefers its own file, because once there is one the old folder is history", () => {
    seedLegacy({ app: "household-books", schema: 1, data: { budgets: [{ id: "old" }] } });
    seed("books.json", { app: "canopy-budget", schema: 1, data: { budgets: [{ id: "new" }] } });

    books.load(dir);

    expect(books.snapshot()).toEqual({ budgets: [{ id: "new" }] });
  });

  it("does not stand in for a file it had to quarantine", () => {
    // Something has already gone wrong with the books here. Quietly serving an
    // older copy instead is the one response that would hide it.
    seedLegacy({ app: "household-books", schema: 1, data: { budgets: [{ id: "old" }] } });
    seed("books.json", '{"budgets": [{"id": "a"}');

    books.load(dir);

    expect(unreadableFile()).toBeDefined();
    expect(books.snapshot()).toEqual({});
  });

  it("is a real first run when there is no old folder at all", () => {
    books.load(dir);

    expect(books.snapshot()).toEqual({});
    books.flush();
    expect(exists("books.json")).toBe(false);
  });
});

describe("writing", () => {
  it("puts the documents in the file parsed, so a person can read their own books", () => {
    books.load(dir);
    books.write("budgets", JSON.stringify([{ id: "a", name: "Food" }]));
    books.flush();

    const file = read("books.json");

    expect(file.app).toBe("canopy-budget");
    expect(file.schema).toBe(books.FILE_SCHEMA);
    // The renderer speaks in JSON strings because its end of this is a drop-in
    // `Storage`. What lands on disk must not be a map of escaped strings.
    expect(file.data.budgets).toEqual([{ id: "a", name: "Food" }]);
  });

  it("waits for the writing to stop before touching the disk", () => {
    books.load(dir);
    books.write("budgets", "[1]");

    expect(exists("books.json")).toBe(false);

    jest.advanceTimersByTime(299);
    expect(exists("books.json")).toBe(false);

    jest.advanceTimersByTime(1);
    expect(read("books.json").data).toEqual({ budgets: [1] });
  });

  it("lands anyway under a steady stream of edits, rather than being starved", () => {
    books.load(dir);

    // Tabbing across a row of the register commits a cell every couple of
    // hundred milliseconds. Each one resets the trailing timer, so without the
    // cap counted from the *first* dirty write nothing would ever reach the
    // disk while the user was working.
    books.write("k0", "0");
    for (let i = 1; i < 10; i += 1) {
      jest.advanceTimersByTime(200);
      books.write(`k${i}`, String(i));
    }

    expect(exists("books.json")).toBe(false); // 1800ms in, and no gap yet

    jest.advanceTimersByTime(200); // 2000ms since the first dirty write
    expect(read("books.json").data.k0).toBe(0);
  });

  it("does not write a document that has not changed", () => {
    books.load(dir);
    books.write("budgets", "[1]");
    books.flush();
    const first = read("books.json").writtenAt;

    jest.advanceTimersByTime(5000);
    books.write("budgets", "[1]");
    books.flush();

    expect(read("books.json").writtenAt).toBe(first);

    // …and the same call with a different document does write, or the check
    // above would pass on a module that had stopped writing altogether.
    books.write("budgets", "[2]");
    books.flush();
    expect(read("books.json").writtenAt).not.toBe(first);
  });

  it("refuses a key or a document that is not a string, and JSON that will not parse", () => {
    books.load(dir);

    books.write(7, "[1]");
    books.write("budgets", { id: "a" });
    books.write("budgets", "{not json");
    books.flush();

    expect(books.snapshot()).toEqual({});
    expect(exists("books.json")).toBe(false);
  });

  it("removes a document, and does not write for a key it never held", () => {
    books.load(dir);
    books.write("budgets", "[1]");
    books.write("accounts", "[2]");
    books.flush();

    books.remove("budgets");
    books.flush();
    expect(read("books.json").data).toEqual({ accounts: [2] });

    const written = read("books.json").writtenAt;
    jest.advanceTimersByTime(5000);
    books.remove("savingsGoals");
    books.flush();
    expect(read("books.json").writtenAt).toBe(written);
  });

  it("keeps the books dirty when the disk refuses, so the next attempt still has them", () => {
    books.load(dir);
    books.write("budgets", "[1]");

    // A directory where the temp file wants to be. Contrived, but it is the
    // shape of every real failure here — a full disk, a locked file, a
    // revoked permission — and what matters is what is done about it.
    fs.mkdirSync(at("books.json.tmp"));

    const failed = books.flush();
    expect(failed.ok).toBe(false);
    expect(exists("books.json")).toBe(false);

    fs.rmdirSync(at("books.json.tmp"));

    // Nothing re-sent the document: the quit handler's second flush is enough,
    // which is the whole reason the dirty flag is not cleared on failure.
    expect(books.flush()).toEqual({ ok: true });
    expect(read("books.json").data).toEqual({ budgets: [1] });
  });
});

describe("the backup", () => {
  it("is the file as it was found at launch, and is taken once", () => {
    seed("books.json", {
      app: "canopy-budget",
      schema: 1,
      data: { budgets: [{ id: "as-found" }] },
    });

    books.load(dir);

    // Nothing copied yet: until the first write the real file is still exactly
    // what this session found, so there is nothing a backup would add.
    expect(exists("books.bak.json")).toBe(false);

    books.write("budgets", JSON.stringify([{ id: "first" }]));
    books.flush();
    expect(read("books.bak.json").data).toEqual({ budgets: [{ id: "as-found" }] });

    books.write("budgets", JSON.stringify([{ id: "second" }]));
    books.flush();

    // **Still the launch copy.** What a person wants back is "the books as of
    // last time I opened the app", after a change they regret — a copy from
    // three hundred milliseconds ago would be a copy of the regret.
    expect(read("books.bak.json").data).toEqual({ budgets: [{ id: "as-found" }] });
    expect(read("books.json").data).toEqual({ budgets: [{ id: "second" }] });
  });

  it("is not attempted on a first run, where there is nothing to copy", () => {
    books.load(dir);
    books.write("budgets", "[1]");

    expect(books.flush()).toEqual({ ok: true });
    expect(exists("books.bak.json")).toBe(false);
  });
});
