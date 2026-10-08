import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BooksFilePanel from "./BooksFilePanel";
import { SyncContext } from "../contexts/SyncContext";
import { serializeBooks } from "../booksFile";
import { readKey, setStorageScope } from "../storage";

/**
 * The panel reads its own storage rather than taking the books as a prop,
 * because what it exports is *whatever is there* — a prop would be a second
 * answer to that question and could disagree with the one `replaceScope` writes
 * back to. So these tests seed storage, which is how every store suite in this
 * app works anyway.
 *
 * What is pinned here is the restore contract, and the three parts of it that
 * would be invisible from the call site: that the current books are written out
 * *before* anything is overwritten, that a store the file does not mention is
 * emptied rather than left behind, and that a failed push refuses the reload
 * instead of letting the account's older books come back over the top.
 */

let downloads;
let reload;

beforeEach(() => {
  localStorage.clear();
  setStorageScope(null);

  // jsdom has neither of these. The object URL is what `downloadFile` hangs the
  // blob on, and the anchor click is how a browser is handed a file.
  downloads = [];
  URL.createObjectURL = jest.fn(() => "blob:books");
  URL.revokeObjectURL = jest.fn();
  jest
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(function recordDownload() {
      downloads.push(this.download);
    });

  reload = jest.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, reload },
  });
});

afterEach(() => {
  setStorageScope(null);
  jest.restoreAllMocks();
});

const SEEDED = {
  transactions: [{ id: "t1", amountCents: 500 }],
  budgets: [{ id: "b1", name: "Food" }],
  savingsGoals: [{ id: "g1", name: "Camera" }],
};

function seed(books = SEEDED) {
  for (const [key, value] of Object.entries(books)) {
    localStorage.setItem(key, JSON.stringify(value));
  }
}

/** A file the change handler can read, without depending on jsdom's File.text. */
function booksFile(name, text) {
  const file = new File([text], name, { type: "application/json" });
  if (typeof file.text !== "function") file.text = () => Promise.resolve(text);
  return file;
}

/** Local mode is the no-provider case, which is also how the page suites run. */
function renderPanel(sync) {
  const view = sync
    ? render(
        <SyncContext.Provider value={sync}>
          <BooksFilePanel />
        </SyncContext.Provider>
      )
    : render(<BooksFilePanel />);
  // Closed by default, for the reason the panel above it is.
  return view;
}

async function open() {
  await userEvent.click(screen.getByText("Your books as a file"));
}

/**
 * The export awaits the file handover, so the status line it sets afterwards
 * lands in a microtask rather than in the click — the same reason `clickReplace`
 * is wrapped below.
 */
async function clickExport() {
  await act(async () => {
    await userEvent.click(screen.getByRole("button", { name: /export to a file/i }));
  });
}

/** The replace awaits a flush, so its state updates land after the click. */
async function clickReplace() {
  await act(async () => {
    await userEvent.click(screen.getByRole("button", { name: /replace my books/i }));
  });
}

async function pick(text, name = "books.json") {
  const input = screen.getByLabelText("Books file to restore");
  await act(async () => {
    await userEvent.upload(input, booksFile(name, text));
  });
}

describe("exporting", () => {
  test("it writes a file named for today", async () => {
    seed();
    renderPanel();
    await open();

    await clickExport();

    expect(downloads).toHaveLength(1);
    expect(downloads[0]).toMatch(/^canopy-budget-\d{4}-\d{2}-\d{2}\.json$/);
    // The panel has to say it landed. Asserting it here is also what keeps the
    // state update inside the act above rather than leaking past the test.
    expect(screen.getByRole("status")).toHaveTextContent(/exported/i);
  });

  // Offering an export of nothing produces a file that reads as a failed export.
  test("there is nothing to export from an untouched browser", async () => {
    renderPanel();
    await open();

    expect(screen.getByRole("button", { name: /export to a file/i })).toBeDisabled();
    expect(screen.getByText(/nothing to export yet/i)).toBeInTheDocument();
  });

  test("the local copy is described as the only one, and an account's as a spare", async () => {
    seed();
    renderPanel();
    await open();
    expect(screen.getByText(/only way back/i)).toBeInTheDocument();
  });
});

describe("restoring", () => {
  test("a file that is not books is refused before anything is shown", async () => {
    seed();
    renderPanel();
    await open();

    await pick("{not json at all");

    expect(screen.getByRole("alert")).toHaveTextContent(/not JSON/i);
    expect(screen.queryByRole("button", { name: /replace my books/i })).not.toBeInTheDocument();
  });

  /**
   * "412 transactions against 6" is what lets someone notice they picked last
   * year's file. A confirmation without the counts is asking them to guess.
   */
  test("both sides are counted before the replace is offered", async () => {
    seed();
    renderPanel();
    await open();

    await pick(serializeBooks({ transactions: [{ id: "t9" }, { id: "t10" }] }));

    const here = screen.getByText("On this device now").closest("div");
    const inFile = screen.getByText("In that file").closest("div");

    expect(here).toHaveTextContent("1");
    expect(inFile).toHaveTextContent("2");
    expect(screen.getByRole("button", { name: /replace my books/i })).toBeInTheDocument();
  });

  test("cancelling leaves the books alone", async () => {
    seed();
    renderPanel();
    await open();

    await pick(serializeBooks({ transactions: [{ id: "t9" }] }));
    await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(readKey("transactions")).toEqual([{ id: "t1", amountCents: 500 }]);
    expect(reload).not.toHaveBeenCalled();
  });

  test("the current books are written out before anything is overwritten", async () => {
    seed();
    renderPanel();
    await open();

    await pick(serializeBooks({ transactions: [{ id: "t9" }] }));
    await clickReplace();

    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(downloads).toEqual([expect.stringContaining("before-restore")]);
  });

  /**
   * The difference between a restore and a merge. A household that had three
   * savings goals and restores a backup taken before it had any must not keep
   * the three — those books would be neither the file's nor their own.
   */
  test("a store the file does not mention is emptied, not left behind", async () => {
    seed();
    renderPanel();
    await open();

    await pick(serializeBooks({ transactions: [{ id: "t9" }] }));
    await clickReplace();

    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(readKey("transactions")).toEqual([{ id: "t9" }]);
    expect(readKey("budgets")).toBeUndefined();
    expect(readKey("savingsGoals")).toBeUndefined();
  });

  test("a reload is what shows the restore, since the stores seeded at mount", async () => {
    seed();
    renderPanel();
    await open();

    await pick(serializeBooks({ transactions: [{ id: "t9" }] }));
    await clickReplace();

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });
});

describe("restoring into an account", () => {
  function stageSync(overrides = {}) {
    return {
      remote: true,
      hydrated: true,
      syncState: "idle",
      push: jest.fn(),
      dropRemote: jest.fn(),
      flush: jest.fn(async () => ({ ok: true })),
      subscribeRemote: jest.fn(() => () => {}),
      ...overrides,
    };
  }

  test("the file's documents are pushed and the dropped ones are deleted", async () => {
    seed();
    const sync = stageSync();
    renderPanel(sync);
    await open();

    await pick(serializeBooks({ transactions: [{ id: "t9" }] }));
    await clickReplace();

    await waitFor(() => expect(reload).toHaveBeenCalled());

    expect(sync.push).toHaveBeenCalledWith("transactions", [{ id: "t9" }]);
    // Without this the next hydrate brings the dropped stores straight back.
    expect(sync.dropRemote).toHaveBeenCalledWith(expect.arrayContaining(["budgets", "savingsGoals"]));
    expect(sync.flush).toHaveBeenCalled();
  });

  /**
   * The local copy is already replaced and the safety file is written, so nothing
   * is lost — but reloading would hydrate the account's older books back over the
   * restore, so the reload is the part that has to be refused.
   */
  test("a failed push refuses the reload and says so", async () => {
    seed();
    const sync = stageSync({
      flush: jest.fn(async () => ({ ok: false, error: "Could not reach the server." })),
    });
    renderPanel(sync);
    await open();

    await pick(serializeBooks({ transactions: [{ id: "t9" }] }));
    await clickReplace();

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/could not be sent to your account/i)
    );
    expect(reload).not.toHaveBeenCalled();
  });
});
