/**
 * @jest-environment node
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

/**
 * `electron/receipts.js` against real files in a real temp directory, for
 * `electronBooks.test.js`' reason: what is relied on is the filesystem's own
 * rename, and the narrowness of the verbs — every one of them refuses anything
 * that is not an id the page minted.
 */
const receipts = require("../electron/receipts");

const ID = "0b8f6a9e-4c1d-4e2a-9f3b-7d6c5e4a3b21";
let dir;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "receipts-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

test("writes a receipt beside the books, finds it and deletes it", () => {
  expect(receipts.put(dir, ID, "pdf", new Uint8Array([37, 80, 68, 70]))).toEqual({ ok: true });

  const file = receipts.locate(dir, ID);
  expect(file).toBe(path.join(dir, "receipts", `${ID}.pdf`));
  expect(fs.readFileSync(file, "utf8")).toBe("%PDF");
  expect(fs.readdirSync(path.join(dir, "receipts"))).toEqual([`${ID}.pdf`]);

  expect(receipts.remove(dir, ID)).toEqual({ ok: true });
  expect(receipts.locate(dir, ID)).toBeNull();
});

test("refuses anything that is not a minted id, a receipt type or a sensible size", () => {
  const bytes = new Uint8Array([1]);
  expect(receipts.put(dir, "../../books", "pdf", bytes).ok).toBe(false);
  expect(receipts.put(dir, ID, "exe", bytes).ok).toBe(false);
  expect(receipts.put(dir, ID, "pdf", new Uint8Array()).ok).toBe(false);
  expect(receipts.put(dir, ID, "pdf", new Uint8Array(receipts.MAX_BYTES + 1)).ok).toBe(false);
  expect(receipts.locate(dir, "../books")).toBeNull();
  expect(fs.existsSync(path.join(dir, "receipts"))).toBe(false);
});

test("deleting a receipt that is not there is not an error", () => {
  expect(receipts.remove(dir, ID)).toEqual({ ok: true });
});
