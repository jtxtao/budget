import {
  booksFilename,
  FILE_APP,
  FILE_SCHEMA,
  parseBooks,
  serializeBooks,
} from "./booksFile";

/**
 * The file format, as the pure function it is.
 *
 * What is worth pinning here is not that JSON round-trips — it is the two
 * decisions the format makes, because both of them are about a file being read
 * by a version of the app that does not exist yet: the envelope carries a schema
 * so a future reader has something to branch on, and a key nobody recognises is
 * a refusal rather than a silent drop.
 */

const BOOKS = {
  transactions: [{ id: "t1", amountCents: 1250 }],
  budgets: [{ id: "b1", name: "Food" }],
};

describe("writing", () => {
  test("a snapshot round-trips through the envelope", () => {
    const result = parseBooks(serializeBooks(BOOKS));
    expect(result.ok).toBe(true);
    expect(result.snapshot).toEqual(BOOKS);
  });

  test("the envelope names the app and its own schema", () => {
    const written = JSON.parse(serializeBooks(BOOKS));
    expect(written.app).toBe(FILE_APP);
    expect(written.schema).toBe(FILE_SCHEMA);
    expect(written.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  // The user is being told the file is theirs, so it has to be one they can
  // open and read. Indentation is the whole of that promise being kept.
  test("it is pretty-printed", () => {
    expect(serializeBooks(BOOKS)).toContain('\n  "app"');
  });
});

describe("reading", () => {
  test("a bare flat map is accepted, since that is what the books were", () => {
    const result = parseBooks(JSON.stringify(BOOKS));
    expect(result.ok).toBe(true);
    expect(result.snapshot).toEqual(BOOKS);
  });

  test("legacy keys travel, because the folds run on read", () => {
    const result = parseBooks(JSON.stringify({ expenses: [{ id: "e1" }] }));
    expect(result.ok).toBe(true);
    expect(result.snapshot).toEqual({ expenses: [{ id: "e1" }] });
  });

  test("something that is not JSON is refused", () => {
    const result = parseBooks("{not json at all");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not JSON/i);
  });

  test("an array is not a set of books", () => {
    expect(parseBooks("[1,2,3]").ok).toBe(false);
  });

  /**
   * The alternative is importing the half we understood while the user believes
   * they restored everything — which is the one failure a restore must not have,
   * because they will delete the file afterwards.
   */
  test("a key this version does not know is refused, and named", () => {
    const result = parseBooks(
      JSON.stringify({ transactions: [{ id: "t1" }], mortgageSchedules: [{ id: "m1" }] })
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("mortgageSchedules");
  });

  test("a file from a newer app is refused rather than half-read", () => {
    const result = parseBooks(
      JSON.stringify({ app: FILE_APP, schema: FILE_SCHEMA + 1, data: BOOKS })
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/newer version/i);
  });

  // The same rule `hasStoredBooks` keeps: a store writes `[]` on first render
  // whether or not anything happened, so an empty document is not books.
  test("a file of empty documents holds no books", () => {
    const result = parseBooks(serializeBooks({ transactions: [], budgets: [] }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no books/i);
  });

  test("an envelope with no data is refused", () => {
    expect(parseBooks(JSON.stringify({ app: FILE_APP, schema: 1 })).ok).toBe(false);
  });
});

describe("naming", () => {
  test("the day is local, not UTC", () => {
    // 1 March in local time, whatever the runner's offset — the same discipline
    // `todayISO` keeps, since a file named for yesterday is confusing.
    const at = new Date(2026, 2, 1, 9, 30);
    expect(booksFilename({ at })).toBe("canopy-budget-2026-03-01.json");
  });

  test("the archive names itself apart from the export", () => {
    const at = new Date(2026, 2, 1);
    expect(booksFilename({ at, suffix: "before-restore" })).toBe(
      "canopy-budget-before-restore-2026-03-01.json"
    );
  });
});
