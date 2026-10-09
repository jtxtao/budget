import { v4 as uuidV4 } from "uuid";
import { GUEST_SCOPE, getStorageScope } from "./storage";
import { getSupabase } from "./supabaseClient";
import {
  isDesktop,
  openReceiptFile,
  putReceiptFile,
  removeReceiptFile,
} from "./desktop";
import { todayISO } from "./utils";

/**
 * Receipts — the charity's written acknowledgment of a gift — as files.
 *
 * **A file is not a document, so it does not go where the books go.** Every
 * store is one JSON document, pushed whole on every write and held whole in
 * `localStorage`; a few scanned receipts as base64 would make every edit to a
 * gift re-send megabytes and would fill a browser's few megabytes of storage on
 * their own. So the bytes live beside the books, in the medium that matches
 * where the books are, and the donation record holds only a small
 * description of the file (`receipt` on the donation: id, name, type, size, the
 * day it was added, and where it was stored).
 *
 * **Where is decided the way the books' source of truth is** (see
 * `storage.js`):
 *
 *   - Signed in: the account's private `receipts` bucket in Supabase Storage,
 *     under a folder named by the user id, which is what its row-level policy
 *     checks (`supabase/schema.sql`). Any device signed in can open it.
 *   - Local, in the desktop shell: a file in the app's own folder on this
 *     computer, through three narrow bridge verbs (`electron/receipts.js`).
 *   - Local, in a browser: this browser's IndexedDB — or, where there is none
 *     (the test suite), memory.
 *
 * `storedIn` on the record names which, because a household can change mode
 * — sign in after a trial, or stop syncing on the desktop — and a receipt does
 * not travel with the books when it does. Asked for one that lives elsewhere,
 * this says where it is rather than failing with nothing to say.
 */

export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

/**
 * What a receipt can be, and the extension each is filed under. Also written
 * out in `electron/receipts.js` (the shell cannot import this module), and in
 * the bucket's `allowed_mime_types` in `supabase/schema.sql` — change one,
 * change all three.
 */
export const RECEIPT_TYPES = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
};

/** For a file input's `accept`. */
export const RECEIPT_ACCEPT = Object.keys(RECEIPT_TYPES).join(",");

export const RECEIPT_MEDIA = {
  ACCOUNT: "account",
  COMPUTER: "computer",
  BROWSER: "browser",
};

const BUCKET = "receipts";

function currentMedium() {
  const scope = getStorageScope();
  if (scope && scope !== GUEST_SCOPE && getSupabase()) return RECEIPT_MEDIA.ACCOUNT;
  if (isDesktop()) return RECEIPT_MEDIA.COMPUTER;
  return RECEIPT_MEDIA.BROWSER;
}

/** Why a file cannot be a receipt, or null. Checked before anything is sent. */
export function checkReceiptFile(file) {
  if (!file) return "Choose a file.";
  if (!RECEIPT_TYPES[file.type]) return "Attach a PDF or a photo (JPEG, PNG, WebP, GIF or HEIC).";
  if (file.size > MAX_RECEIPT_BYTES) return "That file is over 10 MB. Attach a smaller copy.";
  if (file.size === 0) return "That file is empty.";
  return null;
}

/** A description of a stored receipt is well formed. Used by the store's migration. */
export function isReceipt(value) {
  return (
    value != null &&
    typeof value === "object" &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof RECEIPT_TYPES[value.type] === "string" &&
    Object.values(RECEIPT_MEDIA).includes(value.storedIn)
  );
}

const WHERE = {
  [RECEIPT_MEDIA.ACCOUNT]: "in your account — sign in to open it",
  [RECEIPT_MEDIA.COMPUTER]: "on the computer it was attached on",
  [RECEIPT_MEDIA.BROWSER]: "in the browser it was attached in, without an account",
};

function elsewhere(receipt) {
  return {
    ok: false,
    error: `This receipt is stored ${WHERE[receipt.storedIn] ?? "somewhere else"}.`,
  };
}

function accountPath(receipt) {
  return `${getStorageScope()}/${receipt.id}.${RECEIPT_TYPES[receipt.type]}`;
}

function failure(error) {
  return { ok: false, error: `The receipt could not be saved: ${String(error?.message ?? error)}` };
}

// ---------------------------------------------------------------------------
// This browser, without an account
// ---------------------------------------------------------------------------

const memory = new Map();
let dbPromise = null;

function browserKey(id) {
  return `${getStorageScope() ?? "local"}/${id}`;
}

function openDb() {
  if (typeof indexedDB === "undefined") return null;
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open("canopy-receipts", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("files");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

async function browserCall(mode, run) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("files", mode);
    const request = run(tx.objectStore("files"));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
  });
}

const browserStore = {
  async put(id, blob) {
    if (!openDb()) return void memory.set(browserKey(id), blob);
    await browserCall("readwrite", (files) => files.put(blob, browserKey(id)));
  },
  async get(id) {
    if (!openDb()) return memory.get(browserKey(id)) ?? null;
    return (await browserCall("readonly", (files) => files.get(browserKey(id)))) ?? null;
  },
  async remove(id) {
    if (!openDb()) return void memory.delete(browserKey(id));
    await browserCall("readwrite", (files) => files.delete(browserKey(id)));
  },
};

// ---------------------------------------------------------------------------
// The three verbs
// ---------------------------------------------------------------------------

/**
 * Store a file and describe it. Nothing is written to the books here — the
 * caller writes the description onto the gift, and deletes the file again if
 * that write is refused, so a refused gift never leaves a file behind.
 */
export async function saveReceipt(file) {
  const problem = checkReceiptFile(file);
  if (problem) return { ok: false, error: problem };

  const receipt = {
    id: uuidV4(),
    name: file.name || `receipt.${RECEIPT_TYPES[file.type]}`,
    type: file.type,
    sizeBytes: file.size,
    addedOn: todayISO(),
    storedIn: currentMedium(),
  };

  try {
    if (receipt.storedIn === RECEIPT_MEDIA.ACCOUNT) {
      const { error } = await getSupabase()
        .storage.from(BUCKET)
        .upload(accountPath(receipt), file, { contentType: file.type, upsert: false });
      if (error) return failure(error);
    } else if (receipt.storedIn === RECEIPT_MEDIA.COMPUTER) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await putReceiptFile(receipt.id, RECEIPT_TYPES[file.type], bytes);
      if (!result.ok) return failure(result.error ?? "the file could not be written");
    } else {
      await browserStore.put(receipt.id, file);
    }
  } catch (error) {
    return failure(error);
  }
  return { ok: true, receipt };
}

/** The file's bytes, where this session can reach them. */
export async function readReceipt(receipt) {
  if (receipt.storedIn !== currentMedium()) return elsewhere(receipt);
  try {
    if (receipt.storedIn === RECEIPT_MEDIA.ACCOUNT) {
      const { data, error } = await getSupabase().storage.from(BUCKET).download(accountPath(receipt));
      if (error || !data) return { ok: false, error: "The receipt could not be found." };
      return { ok: true, blob: data };
    }
    if (receipt.storedIn === RECEIPT_MEDIA.BROWSER) {
      const blob = await browserStore.get(receipt.id);
      return blob ? { ok: true, blob } : { ok: false, error: "The receipt could not be found." };
    }
    return { ok: false, unsupported: true };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  }
}

/**
 * Show the receipt. On this computer it opens in whatever the household opens
 * a PDF or a photo with; anywhere else it is handed over as a download, which
 * is the one door a browser has that no popup blocker or content policy stands
 * in front of.
 */
export async function openReceipt(receipt) {
  if (receipt.storedIn === RECEIPT_MEDIA.COMPUTER && currentMedium() === RECEIPT_MEDIA.COMPUTER) {
    const result = await openReceiptFile(receipt.id);
    return result.ok ? { ok: true } : { ok: false, error: result.error ?? "The receipt could not be opened." };
  }
  const read = await readReceipt(receipt);
  if (!read.ok) return read;
  const url = URL.createObjectURL(read.blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = receipt.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return { ok: true };
}

/**
 * Delete the file. Best effort, and never the thing that decides whether the
 * gift's record changes: a file left behind costs a little space, while a
 * record left pointing at a deleted file would say a receipt is in hand when
 * it is not. A receipt kept elsewhere is left alone.
 */
export async function deleteReceipt(receipt) {
  if (!receipt || receipt.storedIn !== currentMedium()) return { ok: false };
  try {
    if (receipt.storedIn === RECEIPT_MEDIA.ACCOUNT) {
      const { error } = await getSupabase().storage.from(BUCKET).remove([accountPath(receipt)]);
      return { ok: !error };
    }
    if (receipt.storedIn === RECEIPT_MEDIA.COMPUTER) return removeReceiptFile(receipt.id);
    await browserStore.remove(receipt.id);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** How big a file is, the way the row says it. */
export function formatFileSize(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
