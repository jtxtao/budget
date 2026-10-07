import { DonationsProvider } from "./DonationsContext";
import { TransactionsProvider } from "./TransactionsContext";
import { PayeesProvider } from "./PayeesContext";
import { BudgetsProvider } from "./BudgetsContext";
import { IncomePlanProvider } from "./IncomePlanContext";
import { PayScheduleProvider } from "./PayScheduleContext";
import { AssignmentsProvider } from "./AssignmentsContext";
import { AccountsProvider } from "./AccountsContext";
import { RetirementProvider } from "./RetirementContext";
import { SavingsGoalsProvider } from "./SavingsGoalsContext";
import { SavingsGoalAssignmentsProvider } from "./SavingsGoalAssignmentsContext";
import { SchedulesProvider } from "./SchedulesContext";
import { EmergencyFundProvider } from "./EmergencyFundContext";

// Composes every store in one place so index.js and the tests wrap the app the
// same way, and adding a store does not mean editing both.
//
// **Three layers now sit outside this one, and none of them are its business.**
// index.js wraps it in AuthProvider, AuthGate and SyncProvider, so by the time
// any store below mounts there is a session and the account's documents are
// already in the local cache underneath it. That ordering is what lets every
// store here keep reading storage *synchronously* in its lazy default — see
// src/hooks/useSyncedState.js, which is the single seam between these stores
// and the network, and the reason nothing in this file had to change when the
// books moved off the browser.
//
// **Provider order is a cascade order.** A store that has to clean up after
// another's delete sits *outside* it, so the inner one can call into it:
//
//   - Transactions and Assignments wrap Budgets, because deleting a category
//     has to hand its spend and its funding to Uncategorized.
//   - Transactions also wraps Accounts, because deleting an account has to cut
//     its transactions loose without destroying them.
//   - Transactions wraps Payees for exactly that reason again: deleting a payee
//     detaches every row that named it and merging two repoints them, and both
//     of those are writes only the ledger can make. Nothing deletes *into*
//     Payees — a payee's default category is inert rather than cascaded when the
//     category goes, see PayeesContext — so its position is otherwise free.
//   - Donations wraps Transactions, because a donation record is a statement
//     *about* an outflow — which organisation it went to, how much of it is
//     deductible — and deleting the money has to take the statement with it.
//     It is the only store outside the ledger, and it holds no money of its
//     own: a gift is an ordinary outflow on the register like any other.
//
// Each of those references the other by id and never reads it back, so the
// dependency only ever runs one way — keep it that way. Anything needing to
// read *across* stores belongs in a hook: src/hooks/useEnvelopes.js for the
// envelope figures, src/hooks/useAccountBalances.js for what each account
// holds. Never in a provider.
//
// A category's monthly estimate needs no provider of its own: it is a standing
// figure on the budget record, and BudgetsContext owns it along with the groups
// categories are filed under.
//
// IncomePlan is independent of the ledger in both directions. One holds the
// paycheques the user expects, the other the money that actually arrived;
// nothing maps a record to the source that predicted it, so neither delete may
// cascade into the other. PaySchedule is independent of both again — it is one
// record saying when the next paycheque lands, and nothing deletes into it — so
// its position in the cascade is free.
//
// Schedules is independent in both directions too, and more strictly than any
// other store here: a schedule is a *prediction*, so nothing derived from the
// books reads one, and it references a payee, an account and a category only by
// id and never reads any of them back. A reference to something deleted is inert
// but kept — the rule a payee's default category follows — so nothing cascades
// in either, and its position in this order is free. Turning an occurrence into
// a real transaction is a page's write, not a store's: see the dashboard's
// upcoming panel.
//
// EmergencyFund is independent in both directions, like Schedules: it holds the
// shape of one question — how many months of essentials to cover, or which figure
// instead, and which accounts hold the money — and names its accounts by id
// without ever reading them back. A reference to a deleted account is inert but
// kept, so nothing cascades either way and its position here is free. The target
// itself is nobody's record: src/hooks/useEmergencyFund.js joins the plan's
// essentials to what those accounts are worth, which is the cross-store read no
// provider may make.
//
// SavingsGoals is independent of every other store: a goal names no category,
// no account, and no transaction, so nothing outside this pair deletes into or
// out of it. SavingsGoalAssignments is the money-actually-put-in half of a
// goal, keyed on the goal's id, the same split AssignmentsContext keeps with
// BudgetsContext — and it sits *outside* SavingsGoalsContext for the same
// cascade reason Transactions sits outside Budgets: deleting a goal drops
// every assignment to it, and the store doing that cleanup has to wrap the
// one whose delete triggers it.
export default function AppProviders({ children }) {
  return (
    <DonationsProvider>
      <TransactionsProvider>
        <PayeesProvider>
          <AssignmentsProvider>
            <BudgetsProvider>
              <IncomePlanProvider>
                <PayScheduleProvider>
                  <AccountsProvider>
                    <RetirementProvider>
                      <SavingsGoalAssignmentsProvider>
                        <SavingsGoalsProvider>
                          <SchedulesProvider>
                            <EmergencyFundProvider>{children}</EmergencyFundProvider>
                          </SchedulesProvider>
                        </SavingsGoalsProvider>
                      </SavingsGoalAssignmentsProvider>
                    </RetirementProvider>
                  </AccountsProvider>
                </PayScheduleProvider>
              </IncomePlanProvider>
            </BudgetsProvider>
          </AssignmentsProvider>
        </PayeesProvider>
      </TransactionsProvider>
    </DonationsProvider>
  );
}
