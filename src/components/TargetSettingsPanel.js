import { useState } from "react";
import { useBudgets } from "../contexts/BudgetsContext";

export default function TargetSettingsPanel() {
  const { budgets, updateBudget } = useBudgets();
  const [error, setError] = useState("");
  function change(id, patch) {
    const result = updateBudget({ id, ...patch });
    setError(result.ok ? "" : result.error);
  }
  return <section className="rounded-2xl border border-edge bg-panel p-5" aria-label="Funding targets">
    <h2 className="mb-2 text-lg font-semibold text-chalk">Funding targets</h2>
    <p className="mb-4 text-row text-chalk-soft">Monthly adds the estimate each month. Refill accounts for money carried in. Deadline divides the remaining balance goal across the months until it is due. Suggest funding uses these settings and available cash.</p>
    {error && <p role="alert" className="text-vermilion">{error}</p>}
    <div className="space-y-3">{budgets.map((budget) => <div key={budget.id} className="flex flex-wrap items-center gap-3 border-t border-edge pt-3 text-chalk">
      <span className="min-w-40 flex-1">{budget.name}</span>
      <label>Type <select className="rounded-lg border border-edge bg-panel p-2" value={budget.targetMode ?? "monthly"} onChange={(e) => change(budget.id, { targetMode: e.target.value })}><option value="monthly">Monthly</option><option value="refill">Refill</option><option value="deadline">By date</option></select></label>
      {(budget.targetMode === "deadline") && <label>Due month <input type="month" className="rounded-lg border border-edge bg-panel p-2" value={budget.targetDate ?? ""} onChange={(e) => change(budget.id, { targetDate: e.target.value })} /></label>}
    </div>)}</div>
  </section>;
}
