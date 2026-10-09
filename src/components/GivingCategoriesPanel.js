/**
 * Which categories are giving. Spending filed under any of them appears on the
 * Donations page as a gift without being tagged one.
 *
 * Until something is ticked here the answer is a guess from the names —
 * "Donations", "Giving", "Charity", "Tithe" — so a household that already files
 * its giving under a category like that sees its gifts with nothing to set up.
 * The first tick or untick writes what was on screen out as the list, the
 * retirement picker's rule, and "Guess from names" goes back to the guess.
 *
 * Commits on change: a tick has nothing to half-type.
 */
export default function GivingCategoriesPanel({ budgets, selectedIds, stated, onChange }) {
  function toggle(budgetId, checked) {
    const rest = [...selectedIds].filter((id) => id !== budgetId);
    onChange(checked ? [...rest, budgetId] : rest);
  }

  return (
    <section className="border border-edge bg-panel" aria-labelledby="giving-categories-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-edge px-4 py-3">
        <h2
          id="giving-categories-heading"
          className="font-sans text-base font-semibold tracking-tight text-chalk"
        >
          Giving categories
        </h2>
        {stated && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="font-mono text-label uppercase text-azure underline underline-offset-2 hover:text-chalk"
          >
            Guess from names
          </button>
        )}
      </div>
      <p className="px-4 pt-3 font-sans text-row text-chalk-soft">
        Anything spent from these categories shows up here as a gift, matched to the organization
        named like its payee.
      </p>
      {budgets.length === 0 ? (
        <p className="px-4 py-3 font-sans text-row text-chalk-soft">No categories yet.</p>
      ) : (
        <ul className="max-h-56 overflow-y-auto px-4 py-3">
          {budgets.map((budget) => (
            <li key={budget.id}>
              <label className="flex items-center gap-2 py-0.5 font-sans text-row text-chalk">
                <input
                  type="checkbox"
                  checked={selectedIds.has(budget.id)}
                  onChange={(event) => toggle(budget.id, event.target.checked)}
                />
                {budget.name}
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
