import { useState } from "react";
import AddPayeeModal from "./AddPayeeModal";
import Button from "./Button";
import MergePayeesModal from "./MergePayeesModal";
import { UNCATEGORIZED_BUDGET_ID } from "../contexts/constants";
import { useBudgets } from "../contexts/BudgetsContext";
import { usePayees } from "../contexts/PayeesContext";
import { useTransactions } from "../contexts/TransactionsContext";

/**
 * The payee list, and the three things only this panel can do to it: rename,
 * merge, and say where a payee is usually filed.
 *
 * All three are what the entity bought. A rename is one write here and every row
 * that names the payee says the new name, because no row was ever holding the
 * name. A merge is the repair for what any list typed into for a year looks like —
 * "Costco", "COSTCO", "Costco Wholesale" — and there is no other way to unify
 * those without retyping every row. And the default category is the one fact a
 * payee can carry that saves work later: it seeds the next transaction and
 * restates nothing already recorded.
 *
 * **It is on Configuration, closed by default**, beside the balance-history grid
 * and for the same reasons. A payee list is a standing fact like the accounts
 * above it, this page deliberately has no month in its corner and nothing here
 * belongs to one, and tidying the list is maintenance done a few times a year —
 * so it must not be the loudest thing on a page somebody opened to rename a
 * category.
 *
 * It reads its own stores rather than taking rows as props, which is
 * `BalanceHistoryPanel`'s call and its reason: it needs the payees, the categories
 * a default is chosen from, and a count off the ledger, and three stores threaded
 * through a page that has no other use for them is more plumbing than the
 * testability is worth.
 *
 * The row's editing contract is `CategoryPlanner`'s, field for field: the name is
 * uncontrolled and commits on **blur**, keyed on the stored name so a successful
 * rename re-seeds it with what was actually saved and a refused one puts the old
 * name back — the rest of the app still knows the payee by it. The default
 * category is a **controlled** select committing on **change**, because there is
 * nothing to type and the choice is made the moment it is made.
 */

const nameClass = "w-full min-w-0 border-0 border-b-2 border-rule bg-transparent px-0 py-1 font-sans text-row text-ink outline-none transition-colors focus:border-azure";

export default function PayeeList() {
  const { payees, updatePayee, deletePayee, mergePayees } = usePayees();
  const { budgets } = useBudgets();
  const { transactions } = useTransactions();
  const [error, setError] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [merging, setMerging] = useState(null);

  // One pass rather than a filter per row. What a payee is worth keeping is partly
  // how much is filed under it, and it is the figure a merge has to state.
  const countById = new Map();
  for (const transaction of transactions) {
    if (!transaction.payeeId) continue;
    countById.set(transaction.payeeId, (countById.get(transaction.payeeId) ?? 0) + 1);
  }

  const rows = [...payees].sort((a, b) => a.name.localeCompare(b.name));

  function handleRename(payee, name) {
    if (name.trim() === payee.name) return { ok: true };
    const result = updatePayee({ id: payee.id, name });
    setError(result.ok ? null : result.error);
    return result;
  }

  function handleDefaultChange(payee, budgetId) {
    const result = updatePayee({ id: payee.id, defaultBudgetId: budgetId || null });
    setError(result.ok ? null : result.error);
    return result;
  }

  function handleDelete(payee) {
    const result = deletePayee({ id: payee.id });
    setError(result.ok ? null : result.error);
  }

  return (
    <section className="border border-edge bg-panel">
      <details>
        <summary className="cursor-pointer px-4 py-3 marker:text-chalk-soft">
          <span className="font-sans text-base font-semibold tracking-tight text-chalk">Payees</span>
          <span className="ml-3 font-mono text-label uppercase text-chalk-soft">
            {payees.length === 0
              ? "Built as you enter transactions"
              : `${payees.length} ${payees.length === 1 ? "payee" : "payees"} · rename, merge, set a default category`}
          </span>
        </summary>

        <div className="border-t border-edge">
          <p className="px-4 py-3 font-sans text-row text-chalk-soft">
            Who you pay and who pays you. A payee is added the first time you name it on a
            transaction, so this list fills itself — what it is for is tidying up: rename one and
            every transaction that names it follows, merge two spellings of one shop into a single
            payee, and give a payee the category it is usually filed under so the next transaction
            to it starts there.
          </p>

          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-edge px-4 py-2.5">
            <span className="font-mono text-label uppercase text-chalk-soft">
              Removing a payee keeps its transactions — they simply stop naming anybody.
            </span>
            {/* There is no Edit here, unlike the account and organisation lists:
                both of a payee's answers are on the row already, so a modal
                restating them would be a second door onto one field. Adding is
                still worth a form — it is the one time neither answer exists. */}
            <Button variant="outline" size="sm" onClick={() => setShowAdd(true)}>
              Add payee
            </Button>
          </div>

          {error && (
            <p
              role="alert"
              className="border-t border-edge px-4 py-2.5 font-sans text-row text-vermilion"
            >
              {error}
            </p>
          )}

          {rows.length === 0 ? (
            <p className="border-t border-edge px-4 py-5 font-sans text-row text-chalk-soft">
              No payees yet. Enter a transaction and type who it was paid to — the field offers
              the ones you already have and creates the one you name.
            </p>
          ) : (
            /* Its fixed column widths come to more than a phone is wide, so the
               table scrolls inside the panel rather than taking the page with it. */
            <div className="scroll-x">
              <table className="stack w-full table-fixed border-collapse border-t border-edge">
              <thead>
                <tr className="bg-panel-raised">
                  {/* A width on the name and none on the actions, so it is the
                      empty column that absorbs the panel's full width rather than
                      a text input stretched half a screen wide around the word
                      "Costco". The reverse of `CategoryPlanner`, where the name
                      takes the remainder — there the panel is a third of the page
                      and the remainder is a sensible width. */}
                  <th
                    scope="col"
                    className="w-96 px-3 py-2 text-left font-mono text-label uppercase text-chalk"
                  >
                    Payee
                  </th>
                  <th
                    scope="col"
                    className="w-44 px-3 py-2 text-left font-mono text-label uppercase text-chalk"
                  >
                    Usually filed under
                  </th>
                  <th
                    scope="col"
                    className="w-20 px-3 py-2 text-right font-mono text-label uppercase text-chalk"
                  >
                    Rows
                  </th>
                  <th scope="col" className="px-1 py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((payee, index) => {
                  const striped = index % 2 === 1;
                  const count = countById.get(payee.id) ?? 0;
                  // The stored default always has an option, even one this list
                  // would not offer — a category since deleted, or the
                  // Uncategorized sentinel. Without it the select would show its
                  // first entry and the payee would look re-filed by being looked
                  // at, which is the register's rule for exactly the same control.
                  const known = budgets.some((budget) => budget.id === payee.defaultBudgetId);
                  return (
                    <tr key={payee.id} className={striped ? "bg-sheet-alt" : "bg-sheet"}>
                      <td className="px-3 py-1.5">
                        <input
                          type="text"
                          key={payee.name}
                          defaultValue={payee.name}
                          aria-label={`Name of ${payee.name}`}
                          onBlur={(e) => {
                            const result = handleRename(payee, e.target.value);
                            if (!result.ok) e.target.value = payee.name;
                          }}
                          className={nameClass}
                        />
                      </td>
                      <td data-label="Usually filed under" className="px-3 py-1.5">
                        <select
                          value={payee.defaultBudgetId ?? ""}
                          aria-label={`Default category for ${payee.name}`}
                          onChange={(e) => handleDefaultChange(payee, e.target.value)}
                          className={`${nameClass} ${striped ? "bg-sheet-alt" : "bg-sheet"}`}
                        >
                          {/* Blank is a real answer and the ordinary one: most
                              payees are not always filed the same way. */}
                          <option value="">None</option>
                          {budgets.map((budget) => (
                            <option key={budget.id} value={budget.id}>
                              {budget.name}
                            </option>
                          ))}
                          {payee.defaultBudgetId != null && !known && (
                            <option value={payee.defaultBudgetId}>
                              {payee.defaultBudgetId === UNCATEGORIZED_BUDGET_ID
                                ? "Uncategorized"
                                : "Unknown category"}
                            </option>
                          )}
                        </select>
                      </td>
                      <td
                        data-label="Rows"
                        className="px-3 py-1.5 text-right font-mono text-row tabular-nums text-ink"
                      >
                        {count}
                      </td>
                      <td className="px-1 py-1.5 text-right">
                        <span className="inline-flex items-center gap-1">
                        {/* Merge before Remove, and drawn as a button where Remove
                            is bare text: the quiet one is the destructive one. */}
                        <Button
                          variant="row-action"
                          size="sm"
                          disabled={payees.length < 2}
                          aria-label={`Merge payees into ${payee.name}`}
                          onClick={() => setMerging(payee)}
                        >
                          Merge
                        </Button>
                        <Button
                          variant="row"
                          size="sm"
                          aria-label={`Remove payee: ${payee.name}`}
                          onClick={() => handleDelete(payee)}
                        >
                          Remove
                        </Button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              </table>
            </div>
          )}
        </div>
      </details>

      <AddPayeeModal show={showAdd} handleClose={() => setShowAdd(false)} />
      <MergePayeesModal
        show={merging != null}
        target={merging}
        payees={payees}
        countById={countById}
        onMerge={mergePayees}
        handleClose={() => setMerging(null)}
      />
    </section>
  );
}
