import { useState } from "react";
import AddScheduleModal from "./AddScheduleModal";
import Button from "./Button";
import { UNCATEGORIZED_BUDGET_ID } from "../contexts/constants";
import { useAccounts } from "../contexts/AccountsContext";
import { useBudgets } from "../contexts/BudgetsContext";
import { usePayees } from "../contexts/PayeesContext";
import { useSchedules } from "../contexts/SchedulesContext";
import { TRANSACTION_KINDS } from "../contexts/TransactionsContext";
import { describeRecurrence, nextOccurrence } from "../recurrence";
import { addDays, formatCents, formatDateMedium } from "../utils";

/**
 * Every scheduled transaction, and the four things only this panel can do to
 * them: add one, restate what it is, say when it stops, and remove it.
 *
 * **It is on Configuration, closed by default**, beside the payee list and the
 * balance-history grid, and for the same reasons. A standing order is a standing
 * fact — "rent is $1,800 on the 1st" describes the household rather than a month —
 * this page deliberately has no month in its corner and nothing here belongs to
 * one, and writing a schedule down is something done once and then left alone for
 * a year. Acting on one is the dashboard's job, which is where what is *due* is
 * shown; editing one is here. Two doors onto two different questions.
 *
 * It reads its own stores rather than taking rows as props, `PayeeList`'s and
 * `BalanceHistoryPanel`'s call: it needs the schedules, the payees they name, the
 * accounts and the categories, and four stores threaded through a page with no
 * other use for them is more plumbing than the testability is worth.
 *
 * Editing is a **modal opened on the record**, never a row of inline controls —
 * `AddAccountModal`'s rule, for its reason: a schedule is seven interlocking
 * answers and a row cannot express one whose meaning depends on another. The
 * recurrence decides what the anchor date means; the direction decides whether a
 * category is asked for at all.
 *
 * **What a row does not show is the cursor.** How far a schedule has been dealt
 * with is a fact about the ledger's backlog rather than about the standing order,
 * and it is read where it is acted on. What is shown instead is the next occurrence
 * still outstanding, which is the one figure that answers "is this thing live".
 */
export default function ScheduleList() {
  const { schedules, deleteSchedule } = useSchedules();
  const { accounts } = useAccounts();
  const { budgets } = useBudgets();
  const { payeeById } = usePayees();
  const [editing, setEditing] = useState(null);
  const [showAdd, setShowAdd] = useState(false);

  /**
   * The next occurrence still outstanding — from the day after the cursor, not
   * from today, so a bill nobody has entered reads as the date it was actually due
   * rather than as next month's.
   */
  function nextFor(schedule) {
    const from =
      schedule.enteredThrough == null ? schedule.startDate : addDays(schedule.enteredThrough, 1);
    // Deliberately not floored at today: an occurrence nobody has dealt with is
    // still the next one, and reading "Feb 1" in the middle of March is how this
    // panel says a bill has been sitting there.
    return nextOccurrence(schedule, from);
  }

  const rows = [...schedules]
    .map((schedule) => {
      const payee = schedule.payeeId == null ? null : payeeById.get(schedule.payeeId);
      const account = accounts.find((entry) => entry.id === schedule.accountId);
      const budget = budgets.find((entry) => entry.id === schedule.budgetId);
      return {
        schedule,
        name:
          payee?.name ??
          (schedule.payeeId != null
            ? "Unknown payee"
            : schedule.description || "Scheduled transaction"),
        // Every reference is inert but kept, so each one has to be able to say it
        // names something that has gone rather than reading as the first option.
        accountName: account?.name ?? "Unknown account",
        categoryName:
          schedule.budgetId == null
            ? schedule.kind === TRANSACTION_KINDS.INFLOW
              ? "Income to assign"
              : "No category"
            : budget?.name ??
              (schedule.budgetId === UNCATEGORIZED_BUDGET_ID ? "Uncategorized" : "Unknown category"),
        next: nextFor(schedule),
      };
    })
    // By what is due next, soonest first, so the panel reads as the calendar it
    // is. A schedule past its end date has no next one and sorts last.
    .sort((a, b) => (a.next ?? "9999").localeCompare(b.next ?? "9999") || a.name.localeCompare(b.name));

  const headingClass = "px-3 py-2 text-left font-mono text-label uppercase text-chalk";

  return (
    <section className="border border-edge bg-panel">
      <details>
        <summary className="cursor-pointer px-4 py-3 marker:text-chalk-soft">
          <span className="font-sans text-base font-semibold tracking-tight text-chalk">
            Scheduled transactions
          </span>
          <span className="ml-3 font-mono text-label uppercase text-chalk-soft">
            {schedules.length === 0
              ? "Rent, subscriptions, the quarterly premium"
              : `${schedules.length} ${schedules.length === 1 ? "schedule" : "schedules"} · due on the dashboard`}
          </span>
        </summary>

        <div className="border-t border-edge">
          <p className="px-4 py-3 font-sans text-row text-chalk-soft">
            The transactions you already know about. Each one names a payee, a figure and how often
            it repeats, and what is due appears on the dashboard — where a transaction is written
            only when you say it happened. Nothing here moves money on its own, and nothing is ever
            recorded while the app is closed.
          </p>

          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-edge px-4 py-2.5">
            <span className="font-mono text-label uppercase text-chalk-soft">
              Removing a schedule keeps every transaction already entered from it.
            </span>
            <Button variant="outline" size="sm" onClick={() => setShowAdd(true)}>
              Schedule a transaction
            </Button>
          </div>

          {rows.length === 0 ? (
            <p className="border-t border-edge px-4 py-5 font-sans text-row text-chalk-soft">
              Nothing scheduled yet. Add the rent, a subscription, or a premium that comes round
              once a quarter — the ones easiest to forget are the ones worth writing down.
            </p>
          ) : (
            /* Its fixed column widths come to more than a phone is wide, so the
               table scrolls inside the panel rather than taking the page with it. */
            <div className="scroll-x">
              <table className="w-full table-fixed border-collapse border-t border-edge">
              <thead>
                <tr className="bg-panel-raised">
                  {/* A width on everything but the actions, so it is the empty
                      column that absorbs the panel's full width — `PayeeList`'s
                      arrangement, and its reason. */}
                  <th scope="col" className={`w-72 ${headingClass}`}>
                    Payee
                  </th>
                  <th scope="col" className={`w-44 ${headingClass}`}>
                    How often
                  </th>
                  <th scope="col" className={`w-28 ${headingClass} text-right`}>
                    Amount
                  </th>
                  <th scope="col" className={`w-32 ${headingClass}`}>
                    Next
                  </th>
                  <th scope="col" className="px-1 py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const striped = index % 2 === 1;
                  const isInflow = row.schedule.kind === TRANSACTION_KINDS.INFLOW;
                  return (
                    <tr key={row.schedule.id} className={striped ? "bg-sheet-alt" : "bg-sheet"}>
                      <td className="px-3 py-1.5">
                        <div className="truncate font-sans text-row text-ink">{row.name}</div>
                        {/* Where it comes from and what it counts as, under the
                            name rather than in two more columns — the same stack
                            the register's payee cell uses, and for the same
                            reason: the widths have to add up. */}
                        <div className="truncate font-mono text-label uppercase text-ink-soft">
                          {row.accountName} · {row.categoryName}
                        </div>
                      </td>
                      <td className="px-3 py-1.5 font-sans text-row text-ink">
                        {describeRecurrence(row.schedule)}
                        {row.schedule.endsOn && (
                          <div className="font-mono text-label uppercase text-ink-soft">
                            until {formatDateMedium(row.schedule.endsOn)}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-row tabular-nums text-ink">
                        {/* Signed, because there is one column and a scheduled
                            paycheque beside a scheduled bill has to be visibly the
                            other direction. */}
                        {isInflow ? "+" : ""}
                        {formatCents(row.schedule.amountCents)}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-row tabular-nums text-ink">
                        {row.next ? (
                          formatDateMedium(row.next)
                        ) : (
                          // Past its end date: still a record, and worth keeping
                          // for what it explains about last year's books.
                          <span className="font-sans text-ink-soft">Finished</span>
                        )}
                      </td>
                      <td className="px-1 py-1.5 text-right">
                        <span className="inline-flex items-center gap-1">
                          <Button
                            variant="row-action"
                            size="sm"
                            aria-label={`Edit schedule: ${row.name}`}
                            onClick={() => setEditing(row.schedule)}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="row"
                            size="sm"
                            aria-label={`Remove schedule: ${row.name}`}
                            onClick={() => deleteSchedule({ id: row.schedule.id })}
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

      {/* One mounted modal for both doors, add and edit, which is what `schedule`
          being a prop means — and the reason its re-seed effect depends on the
          record rather than on `show` alone: the panel opens it on a different row
          without closing it in between. */}
      <AddScheduleModal
        show={showAdd || editing != null}
        schedule={editing}
        handleClose={() => {
          setShowAdd(false);
          setEditing(null);
        }}
      />
    </section>
  );
}
