import { useState } from "react";
import { useTransactions } from "../contexts/TransactionsContext";
import { usePayees } from "../contexts/PayeesContext";
import { useBudgets } from "../contexts/BudgetsContext";
import { useAccounts } from "../contexts/AccountsContext";
import Button from "./Button";

const empty = { name: "", payeeId: "", accountId: "", descriptionContains: "", kind: "", budgetId: "", note: "", enabled: true };
const field = "rounded-lg border border-edge bg-panel px-3 py-2 text-chalk";

export default function TransactionRulesPanel() {
  const { rules, saveRule, deleteRule } = useTransactions();
  const { payees } = usePayees();
  const { budgets } = useBudgets();
  const { accounts } = useAccounts();
  const [draft, setDraft] = useState(empty);
  const [error, setError] = useState("");
  const change = (key, value) => setDraft((previous) => ({ ...previous, [key]: value }));
  function submit(event) {
    event.preventDefault();
    const result = saveRule(draft);
    if (!result.ok) { setError(result.error); return; }
    setError("");
    setDraft(empty);
  }
  return <section className="rounded-2xl border border-edge bg-panel p-5" aria-label="Transaction rules">
    <h2 className="mb-2 text-lg font-semibold text-chalk">Transaction rules</h2>
    <p className="mb-4 text-row text-chalk-soft">Rules run in list order on new transactions. Apply them to existing transactions from the review queue.</p>
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      <label className="text-chalk">Name<input className={`${field} block w-full`} value={draft.name} onChange={(e) => change("name", e.target.value)} /></label>
      <label className="text-chalk">Description contains<input className={`${field} block w-full`} value={draft.descriptionContains} onChange={(e) => change("descriptionContains", e.target.value)} /></label>
      <label className="text-chalk">Payee<select className={`${field} block w-full`} value={draft.payeeId} onChange={(e) => change("payeeId", e.target.value)}><option value="">Any payee</option>{payees.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label className="text-chalk">Account<select className={`${field} block w-full`} value={draft.accountId} onChange={(e) => change("accountId", e.target.value)}><option value="">Any account</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label className="text-chalk">Direction<select className={`${field} block w-full`} value={draft.kind} onChange={(e) => change("kind", e.target.value)}><option value="">Any direction</option><option value="outflow">Money out</option><option value="inflow">Money in</option></select></label>
      <label className="text-chalk">Set category<select className={`${field} block w-full`} value={draft.budgetId} onChange={(e) => change("budgetId", e.target.value)}><option value="">Leave category</option>{budgets.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <label className="text-chalk sm:col-span-2">Set note<input className={`${field} block w-full`} value={draft.note} onChange={(e) => change("note", e.target.value)} /></label>
      {error && <p role="alert" className="text-vermilion sm:col-span-2">{error}</p>}
      <div className="sm:col-span-2"><Button type="submit">{draft.id ? "Save rule" : "Add rule"}</Button>{draft.id && <Button type="button" variant="outline" onClick={() => setDraft(empty)}>Cancel edit</Button>}</div>
    </form>
    <ul className="mt-4 space-y-2">{rules.map((rule) => <li key={rule.id} className="flex items-center justify-between gap-3 border-t border-edge pt-2 text-chalk"><span>{rule.name}{rule.enabled === false ? " (off)" : ""}</span><span className="flex gap-2"><Button type="button" variant="outline" size="sm" onClick={() => setDraft(rule)}>Edit</Button><Button type="button" variant="outline" size="sm" onClick={() => saveRule({ ...rule, enabled: rule.enabled === false })}>{rule.enabled === false ? "Enable" : "Disable"}</Button><Button type="button" variant="outline" size="sm" onClick={() => deleteRule(rule.id)}>Delete</Button></span></li>)}</ul>
  </section>;
}
