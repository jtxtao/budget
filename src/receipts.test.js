import {
  MAX_RECEIPT_BYTES,
  RECEIPT_MEDIA,
  checkReceiptFile,
  deleteReceipt,
  readReceipt,
  saveReceipt,
} from "./receipts";
import { GUEST_SCOPE, setStorageScope } from "./storage";
import { getSupabase } from "./supabaseClient";

jest.mock("./supabaseClient", () => ({ getSupabase: jest.fn(), isSupabaseConfigured: true }));

const pdf = (body = "%PDF-1.4") => new File([body], "letter.pdf", { type: "application/pdf" });

afterEach(() => setStorageScope(null));

describe("checkReceiptFile", () => {
  test("takes a PDF or a photo, and nothing empty, oversized or of another kind", () => {
    expect(checkReceiptFile(pdf())).toBeNull();
    expect(checkReceiptFile(new File(["x"], "a.jpg", { type: "image/jpeg" }))).toBeNull();
    expect(checkReceiptFile(new File(["x"], "a.txt", { type: "text/plain" }))).toMatch(/PDF or a photo/);
    expect(checkReceiptFile(new File([], "a.pdf", { type: "application/pdf" }))).toMatch(/empty/);
    const huge = { name: "a.pdf", type: "application/pdf", size: MAX_RECEIPT_BYTES + 1 };
    expect(checkReceiptFile(huge)).toMatch(/over 10 MB/);
  });
});

describe("without an account, in a browser", () => {
  beforeEach(() => getSupabase.mockReturnValue(null));

  test("a receipt is stored, read back and deleted here", async () => {
    setStorageScope(GUEST_SCOPE);
    const file = pdf("%PDF thanks");
    const saved = await saveReceipt(file);
    expect(saved.ok).toBe(true);
    expect(saved.receipt.storedIn).toBe(RECEIPT_MEDIA.BROWSER);

    const read = await readReceipt(saved.receipt);
    expect(read.ok).toBe(true);
    expect(read.blob).toBe(file);

    await deleteReceipt(saved.receipt);
    expect((await readReceipt(saved.receipt)).ok).toBe(false);
  });

  test("a receipt kept in the account says so rather than failing silently", async () => {
    const receipt = {
      id: "x",
      name: "letter.pdf",
      type: "application/pdf",
      sizeBytes: 1,
      addedOn: "2026-10-09",
      storedIn: RECEIPT_MEDIA.ACCOUNT,
    };
    expect(await readReceipt(receipt)).toEqual({
      ok: false,
      error: "This receipt is stored in your account — sign in to open it.",
    });
  });
});

describe("signed in", () => {
  // The folder is the whole of the bucket's policy, so the path is what is
  // pinned: the signed-in user's id first, then the receipt's own.
  test("uploads into the user's own folder, privately, and never overwrites", async () => {
    const upload = jest.fn().mockResolvedValue({ error: null });
    const remove = jest.fn().mockResolvedValue({ error: null });
    const from = jest.fn(() => ({ upload, remove }));
    getSupabase.mockReturnValue({ storage: { from } });
    setStorageScope("user-1");

    const file = pdf();
    const saved = await saveReceipt(file);

    expect(saved.receipt.storedIn).toBe(RECEIPT_MEDIA.ACCOUNT);
    expect(from).toHaveBeenCalledWith("receipts");
    expect(upload).toHaveBeenCalledWith(`user-1/${saved.receipt.id}.pdf`, file, {
      contentType: "application/pdf",
      upsert: false,
    });

    await deleteReceipt(saved.receipt);
    expect(remove).toHaveBeenCalledWith([`user-1/${saved.receipt.id}.pdf`]);
  });

  test("a refused upload is reported and describes nothing", async () => {
    const upload = jest.fn().mockResolvedValue({ error: { message: "Payload too large" } });
    getSupabase.mockReturnValue({ storage: { from: () => ({ upload }) } });
    setStorageScope("user-1");

    expect(await saveReceipt(pdf())).toEqual({
      ok: false,
      error: "The receipt could not be saved: Payload too large",
    });
  });
});
