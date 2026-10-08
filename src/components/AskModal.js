import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Dialog from "./Dialog";
import Button from "./Button";
import { useAccounts } from "../contexts/AccountsContext";
import { useBudgets } from "../contexts/BudgetsContext";
import { usePayees } from "../contexts/PayeesContext";
import { useTransactions } from "../contexts/TransactionsContext";
import { askAssistant, assistStatus } from "../desktop";
import { ASSIST_ACTIONS, buildAssistRequest, resolveReading } from "../assistant";
import { orderPayeesByUse } from "../payeeSearch";
import { formatCents, formatDateMedium, todayISO } from "../utils";

/**
 * Which local model to ask, remembered on this machine.
 *
 * **Read bare, outside `src/storage.js`**, for `useTheme`'s reason: it is a fact
 * about the computer — which models Ollama has pulled here — and not about the
 * books. Through the storage seam it would be namespaced per account, pushed to
 * a server whose other devices may not have that model at all, and written into
 * the books file, which refuses an unknown key on the way back in.
 */
const MODEL_KEY = "assistModel";

/** What to pull, said in the one place a household is told to pull something. */
export const SUGGESTED_MODEL = "qwen2.5:7b";

function loadModel() {
  try {
    const value = JSON.parse(window.localStorage.getItem(MODEL_KEY));
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

function saveModel(model) {
  try {
    window.localStorage.setItem(MODEL_KEY, JSON.stringify(model));
  } catch {
    // Not remembered, which costs one pick next time.
  }
}

const EXAMPLES = [
  "45.20 at Costco yesterday for groceries",
  "Paycheque of 2,400 into checking",
  "Paid 300 off the Visa from checking",
  "Move 50 from dining out to groceries",
  "File all the Amazon ones under Household",
];

/**
 * Say what happened, in a sentence, and the app opens the form for it.
 *
 * **Desktop only, and the model is the household's own** — Ollama, on this
 * computer, asked through the main process (see `electron/assist.js`). The
 * model reads the sentence into names; `src/assistant.js` turns the names into
 * ids against the live books; and what the household sees next is the
 * ordinary form — `AddTransactionModal` or `MoveMoneyModal` — already filled
 * in, which the host opens through `onDraft` / `onMove`. **Nothing is written
 * from here except a refile**, and that one is shown row by row with each row
 * ticked or not before anything moves, because refiling twenty receipts
 * through twenty forms would be the opposite of help.
 *
 * Mounted only while open, `QuickEntry`'s rule, so there is nothing to
 * re-seed.
 */
export default function AskModal({ handleClose, onDraft, onMove }) {
  const inputRef = useRef();
  const [status, setStatus] = useState({ state: "checking" });
  const [model, setModel] = useState(loadModel);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [refile, setRefile] = useState(null);
  // A model can take a while, and the dialog can be closed in the meantime. An
  // answer arriving after that is to a question nobody is still asking, and
  // opening a form off it would be a window appearing out of nowhere.
  const openRef = useRef(true);
  useEffect(
    () => () => {
      openRef.current = false;
    },
    []
  );

  const { transactions } = useTransactions();
  const { accounts } = useAccounts();
  const { budgets } = useBudgets();
  const { payees } = usePayees();
  const orderedPayees = useMemo(() => orderPayeesByUse(payees, transactions), [payees, transactions]);

  const check = useCallback(async () => {
    setStatus({ state: "checking" });
    const result = await assistStatus();
    if (!result.ok) {
      setStatus({ state: "unavailable", reason: result.reason });
      return;
    }
    setStatus({ state: "ready", models: result.models });
    // The remembered model if it is still installed, else the first that is.
    setModel((current) => (result.models.includes(current) ? current : result.models[0] ?? null));
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  useEffect(() => {
    if (status.state === "ready") inputRef.current?.focus();
  }, [status.state]);

  async function handleSubmit(e) {
    e.preventDefault();
    const text = inputRef.current.value.trim();
    if (!text || !model || busy) return;

    setBusy(true);
    setError(null);
    setRefile(null);
    const today = todayISO();
    const request = buildAssistRequest({ text, today, budgets, accounts, payees: orderedPayees });
    const answer = await askAssistant({ model, ...request });
    if (!openRef.current) return;
    setBusy(false);

    if (!answer.ok) {
      setError(
        answer.reason === "unreachable"
          ? "Ollama stopped answering. Check that it is still running, then try again."
          : answer.reason === "timeout"
          ? "The model took too long to answer. A smaller model may be quicker."
          : answer.error ?? "The model's answer could not be read. Try saying it another way."
      );
      return;
    }

    const resolved = resolveReading(answer.content, {
      budgets,
      accounts,
      payees,
      transactions,
      today,
    });

    if (resolved.action === ASSIST_ACTIONS.ADD) {
      onDraft(resolved);
    } else if (resolved.action === ASSIST_ACTIONS.MOVE) {
      onMove(resolved);
    } else if (resolved.action === ASSIST_ACTIONS.RECATEGORIZE) {
      setRefile(resolved);
    } else {
      setError(resolved.error);
    }
  }

  return (
    <Dialog show handleClose={handleClose} title="Ask" wide={refile != null}>
      {status.state === "checking" && (
        <p role="status" className="font-sans text-row text-chalk-soft">
          Looking for Ollama on this computer…
        </p>
      )}

      {status.state === "unavailable" && (
        <Unavailable reason={status.reason} onRetry={check} />
      )}

      {status.state === "ready" && status.models.length === 0 && (
        <div className="font-sans text-row text-chalk-soft">
          <p className="mb-3">
            Ollama is running, but it has no models yet. Pull one from a terminal, then try again:
          </p>
          <pre className="mb-4 border border-edge bg-panel-raised px-3 py-2 font-mono text-row text-chalk">
            ollama pull {SUGGESTED_MODEL}
          </pre>
          <Button type="button" onClick={check}>
            Try again
          </Button>
        </div>
      )}

      {status.state === "ready" && status.models.length > 0 && (
        <>
          <form onSubmit={handleSubmit}>
            <label className="mb-2 block">
              <span className="mb-2 block font-mono text-label uppercase text-chalk-soft">
                What happened?
              </span>
              <input
                ref={inputRef}
                type="text"
                autoComplete="off"
                disabled={busy}
                aria-describedby="ask-help"
                className="w-full border-0 border-b-2 border-edge bg-transparent px-0 py-1.5 font-sans text-lg text-chalk outline-none transition-colors placeholder:text-chalk-soft/60 focus:border-azure"
                placeholder={EXAMPLES[0]}
              />
            </label>
            <p id="ask-help" className="mb-5 font-sans text-label text-chalk-soft">
              Read by {model} on this computer — nothing is sent anywhere. You'll see the form
              filled in before anything is saved.
            </p>
            {error && (
              <p role="alert" className="mb-5 font-sans text-row text-vermilion">
                {error}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 font-mono text-label uppercase text-chalk-soft">
                Model
                <select
                  value={model ?? ""}
                  onChange={(e) => {
                    setModel(e.target.value);
                    saveModel(e.target.value);
                  }}
                  className="border border-edge bg-panel px-2 py-1 font-mono text-label normal-case text-chalk outline-none focus:border-azure"
                >
                  {status.models.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <Button variant="primary" type="submit" disabled={busy}>
                {busy ? "Reading…" : "Fill in the form"}
              </Button>
            </div>
          </form>

          {refile ? (
            <RefilePreview key={refile.payee.id + refile.budget.id} refile={refile} />
          ) : (
            <div className="mt-6 border-t border-edge pt-4">
              <p className="mb-2 font-mono text-label uppercase text-chalk-soft">For example</p>
              <ul className="space-y-1 font-sans text-row text-chalk-soft">
                {EXAMPLES.map((example) => (
                  <li key={example}>
                    <button
                      type="button"
                      className="text-left hover:text-chalk"
                      onClick={() => {
                        inputRef.current.value = example;
                        inputRef.current.focus();
                      }}
                    >
                      “{example}”
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}

/** Why there is nothing to ask, and the one thing to do about it. */
function Unavailable({ reason, onRetry }) {
  if (reason === "unsupported") {
    return (
      <p className="font-sans text-row text-chalk-soft">
        The assistant runs on a model on your own computer, so it is only in the desktop app.
      </p>
    );
  }
  return (
    <div className="font-sans text-row text-chalk-soft">
      <p className="mb-3">
        The assistant reads your sentence with a model running on this computer, through{" "}
        <span className="text-chalk">Ollama</span> — so nothing you type leaves the machine. It
        isn't answering yet. Install it from ollama.com, pull a model, and leave it running:
      </p>
      <pre className="mb-4 border border-edge bg-panel-raised px-3 py-2 font-mono text-row text-chalk">
        ollama pull {SUGGESTED_MODEL}
      </pre>
      <Button type="button" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

/**
 * The one thing the assistant writes itself: a payee's spending, refiled.
 *
 * Shown row by row, every row ticked, so the household sees exactly which
 * receipts move before any of them do — and can leave one where it is. Each row
 * goes through `updateTransaction`, the register's own write, so every rule a
 * cell edit meets is met here too, and a row the store refuses is named rather
 * than skipped in silence. Ticking "from now on" sets the payee's default, the
 * same field `PayeeList` edits, which is what makes the next receipt from them
 * arrive already filed.
 */
function RefilePreview({ refile }) {
  const { payee, budget, fromBudget, candidates, notes } = refile;
  const { updateTransaction } = useTransactions();
  const { budgets } = useBudgets();
  const { updatePayee } = usePayees();
  const [picked, setPicked] = useState(() => new Set(candidates.map((entry) => entry.id)));
  const [setDefault, setSetDefault] = useState(payee.defaultBudgetId !== budget.id);
  const [outcome, setOutcome] = useState(null);

  const nameOf = (id) => budgets.find((entry) => entry.id === id)?.name ?? "Uncategorized";
  const toggle = (id) =>
    setPicked((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  function apply() {
    const failures = [];
    let moved = 0;
    for (const entry of candidates) {
      if (!picked.has(entry.id)) continue;
      const result = updateTransaction({ id: entry.id, budgetId: budget.id });
      if (result.ok) moved += 1;
      else failures.push(`${formatDateMedium(entry.date) || "Undated"}: ${result.error}`);
    }
    if (setDefault) {
      const result = updatePayee({ id: payee.id, defaultBudgetId: budget.id });
      if (!result.ok) failures.push(result.error);
    }
    setOutcome({ moved, failures });
  }

  if (outcome) {
    return (
      <div className="mt-6 border-t border-edge pt-4 font-sans text-row">
        <p role="status" className="text-verdant">
          Refiled {outcome.moved} {outcome.moved === 1 ? "transaction" : "transactions"} from{" "}
          {payee.name} under {budget.name}
          {setDefault ? `, and new ones will start there too` : ""}.
        </p>
        {outcome.failures.length > 0 && (
          <ul role="alert" className="mt-2 list-disc pl-5 text-vermilion">
            {outcome.failures.map((failure) => (
              <li key={failure}>{failure}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="mt-6 border-t border-edge pt-4 font-sans text-row text-chalk">
      <p className="mb-3">
        {candidates.length === 0
          ? `Nothing from ${payee.name} is filed anywhere but ${budget.name}${
              fromBudget ? ` under ${fromBudget.name}` : ""
            }.`
          : `Refile ${payee.name}'s spending under ${budget.name}?`}
      </p>
      {notes.length > 0 && (
        <ul className="mb-3 list-disc pl-5 text-chalk-soft">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
      {candidates.length > 0 && (
        <div className="mb-4 max-h-64 overflow-y-auto border border-edge">
          <table className="w-full bg-sheet text-ink">
            <caption className="sr-only">
              Transactions from {payee.name} to refile
            </caption>
            <thead>
              <tr className="border-b border-rule font-mono text-label uppercase text-ink-soft">
                <th className="w-10 px-2 py-1.5">
                  <span className="sr-only">Refile</span>
                </th>
                <th className="px-2 py-1.5 text-left font-normal">Date</th>
                <th className="px-2 py-1.5 text-left font-normal">Filed under</th>
                <th className="px-2 py-1.5 text-right font-normal">Amount</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((entry) => (
                <tr key={entry.id} className="border-b border-rule last:border-0">
                  <td className="px-2 py-1.5 text-center">
                    <input
                      type="checkbox"
                      checked={picked.has(entry.id)}
                      onChange={() => toggle(entry.id)}
                      aria-label={`Refile ${formatCents(entry.amountCents)} on ${
                        formatDateMedium(entry.date) || "an undated day"
                      }`}
                    />
                  </td>
                  <td className="px-2 py-1.5 font-mono">{formatDateMedium(entry.date) || "Undated"}</td>
                  <td className="px-2 py-1.5">{nameOf(entry.budgetId)}</td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                    {formatCents(entry.amountCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {payee.defaultBudgetId !== budget.id && (
        <label className="mb-4 flex items-center gap-2 text-chalk-soft">
          <input
            type="checkbox"
            checked={setDefault}
            onChange={(e) => setSetDefault(e.target.checked)}
          />
          File new {payee.name} transactions under {budget.name} from now on
        </label>
      )}
      <Button
        variant="primary"
        type="button"
        disabled={picked.size === 0 && !setDefault}
        onClick={apply}
      >
        {picked.size > 0
          ? `Refile ${picked.size} ${picked.size === 1 ? "transaction" : "transactions"}`
          : "Save the default"}
      </Button>
    </div>
  );
}
