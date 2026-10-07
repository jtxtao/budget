import { useState } from "react";
import AccountList from "../components/AccountList";
import AddAccountModal from "../components/AddAccountModal";
import AddBudgetModal from "../components/AddBudgetModal";
import AddGroupModal from "../components/AddGroupModal";
import AddIncomeSourceModal from "../components/AddIncomeSourceModal";
import AssignIncomeModal from "../components/AssignIncomeModal";
import BalanceHistoryPanel from "../components/BalanceHistoryPanel";
import BooksFilePanel from "../components/BooksFilePanel";
import Button from "../components/Button";
import CategoryPlanner from "../components/CategoryPlanner";
import EmergencyFundPanel from "../components/EmergencyFundPanel";
import ExpectedIncomeTable from "../components/ExpectedIncomeTable";
import PageHeader from "../components/PageHeader";
import PayeeList from "../components/PayeeList";
import ScheduleList from "../components/ScheduleList";
import PlanHealthSummary from "../components/PlanHealthSummary";
import PaySchedulePanel from "../components/PaySchedulePanel";
import { DEFAULT_SCOPE, isOffBudget, useAccounts } from "../contexts/AccountsContext";
import { useBudgets } from "../contexts/BudgetsContext";
import { useEmergencyFundPlan } from "../contexts/EmergencyFundContext";
import { useIncomePlan } from "../contexts/IncomePlanContext";
import { usePaySchedule } from "../contexts/PayScheduleContext";
import { useRetirement } from "../contexts/RetirementContext";
import useAccountBalances from "../hooks/useAccountBalances";
import useEmergencyFund from "../hooks/useEmergencyFund";
import useNetWorth from "../hooks/useNetWorth";
import useNextPaycheck from "../hooks/useNextPaycheck";
import usePlanHealth from "../hooks/usePlanHealth";
import useStartingBalances from "../hooks/useStartingBalances";
import { currentPeriod } from "../utils";

/**
 * The standing configuration: what the user expects to earn, what each category
 * is expected to need, how the categories are arranged, and the accounts the
 * money sits in.
 *
 * There is no month on this page, deliberately. Every figure here is a monthly
 * average that holds until the user changes it — an estimate describes a
 * category in general, not January in particular — and the moment a month
 * appeared in the corner, the user would reasonably expect editing it to leave
 * the other months alone. Which month a given dollar landed in is the
 * Transactions page's question, and it answers it from the books rather than
 * from anything set here. Accounts belong here for the same reason: the list of
 * accounts is a standing fact, while what each was worth in August is a figure
 * per month and is entered on the Net worth page.
 *
 * The pay schedule is the one exception, and only just: it names a real day on
 * the calendar, but it is still a standing fact stated once — how often the
 * money arrives, not how much arrived in August. It is here because the
 * dashboard, which is where it is read, derives everything else it shows.
 *
 * The two halves sit side by side on a wide screen rather than one after the
 * other, so setting up a household is one screen with two short columns instead
 * of a single column the user has to scroll to reach the end of. Each block
 * carries the buttons that act on it — a page header holding one button per
 * block says nothing about which of them a given button belongs to.
 */

/** Labels a column of panels and holds the actions that add to it. */
function ColumnHeading({ title, children }) {
  return (
    // The min-height is a small button's — 16px of label, 4px of padding either
    // side, 1px of border — so a heading with no actions still rules off level
    // with the one beside it that has them.
    <div className="mb-3 flex min-h-[1.625rem] flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-edge pb-2">
      <h2 className="font-mono text-label uppercase text-chalk">{title}</h2>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

export default function ConfigurationPage() {
  const [showAddBudgetModal, setShowAddBudgetModal] = useState(false);
  const [showAddGroupModal, setShowAddGroupModal] = useState(false);
  const [showAddIncomeSourceModal, setShowAddIncomeSourceModal] = useState(false);
  const [showAddAccountModal, setShowAddAccountModal] = useState(false);
  const [showAssignStartingModal, setShowAssignStartingModal] = useState(false);
  // The group a category is being added to, and the group being renamed. Held
  // separately: adding files the new category under a heading, renaming edits
  // the heading itself.
  const [addToGroupId, setAddToGroupId] = useState(null);
  const [editingGroup, setEditingGroup] = useState(null);
  // Which panel the account modal was opened from. Asset or liability is left to
  // the form: the two panels are on and off budget, and either can hold either.
  const [addAccountScope, setAddAccountScope] = useState(DEFAULT_SCOPE);
  // The account being amended, held apart from the panel above for the same
  // reason as the group: adding files a new account under a heading, editing
  // restates one that is already there — and where the two disagree, the
  // account's own answers lead.
  const [editingAccount, setEditingAccount] = useState(null);
  const [error, setError] = useState(null);
  // Held apart from the page-level error: the pay schedule sits in its own panel
  // with its own fields, and a message about a pay period belongs beside them
  // rather than at the top of a page about categories.
  const [payError, setPayError] = useState(null);
  // Same reason again: the pretax field lives inside Plan health, not beside
  // the categories, so its own rejection message has to stay with it.
  const [pretaxError, setPretaxError] = useState(null);
  // And again: the fund's two fields are at the foot of the page, and a message
  // about a month count belongs beside the month count.
  const [fundError, setFundError] = useState(null);

  const { updateBudget, deleteBudget, deleteGroup, setCategoryLayout } = useBudgets();
  const { deleteIncomeSource } = useIncomePlan();
  const { accounts, deleteAccount } = useAccounts();
  const { schedule, setPaySchedule } = usePaySchedule();
  const { plan, setRetirementPlan } = useRetirement();
  const { setEmergencyFund, toggleFundAccount } = useEmergencyFundPlan();

  const health = usePlanHealth();
  const fund = useEmergencyFund();
  const { period: startingPeriod, poolCentsOverride: startingPoolCents } = useStartingBalances();
  const paycheck = useNextPaycheck();
  // What each account holds as things stand. On-budget figures are the
  // ledger's own arithmetic, so they belong on a page with no month on it in a
  // way a hand-entered figure never could — there is nothing here to go
  // stale. An off-budget holding has no ledger activity to derive from, so it
  // is read from `useNetWorth` instead — the same snapshot-aware figure the
  // Net worth page shows — or this panel would show a 401(k) frozen at its
  // opening balance while the other page shows what it is actually worth.
  //
  // One month, not the chart's twelve: `rows` is `current.rows` and nothing
  // here reads the series, so the default `spanKey` window would derive eleven
  // further months of holdings, smooth all twelve, and resolve every change
  // range through them for a figure that is only ever the last column.
  const { rows: balanceRows } = useAccountBalances(currentPeriod());
  const { rows: netWorthRows } = useNetWorth(currentPeriod(), { months: 1 });
  const balanceById = new Map(balanceRows.map((row) => [row.account.id, row.balanceCents]));
  for (const row of netWorthRows) {
    if (isOffBudget(row.account)) balanceById.set(row.account.id, row.valueCents);
  }

  // The store validates; the page has to say so. Silently swallowing a rejected
  // figure would leave the row showing an amount the plan is not using.
  function handleEstimateChange(budget, cents) {
    if (cents == null || cents < 0) {
      setError(`Enter a monthly estimate of zero or more for ${budget.name}.`);
      return { ok: false };
    }
    const result = updateBudget({ id: budget.id, plannedCents: cents });
    setError(result.ok ? null : result.error);
    return result;
  }

  // Renaming is the same contract as the estimate: the store owns the rules —
  // a name is required, and two categories may not share one — and the page has
  // to say why a rename did not take, since the row puts the old name back.
  function handleNameChange(budget, name) {
    const result = updateBudget({ id: budget.id, name });
    setError(result.ok ? null : result.error);
    return result;
  }

  // The raw field rather than a figure, because the store is the one place that
  // knows a blank goal is no goal while a blank estimate is zero — and it says
  // so in the message when a figure is refused, so there is nothing to restate
  // here.
  function handleGoalChange(budget, goal) {
    const result = updateBudget({ id: budget.id, goal });
    setError(result.ok ? null : result.error);
    return result;
  }

  function handleBucketChange(budget, bucket) {
    const result = updateBudget({ id: budget.id, bucket });
    setError(result.ok ? null : result.error);
    return result;
  }

  function handleAddCategory(groupId) {
    setAddToGroupId(groupId);
    setShowAddBudgetModal(true);
  }

  function handleEditGroup(section) {
    setEditingGroup({ id: section.groupId, name: section.name, bucket: section.bucket });
    setShowAddGroupModal(true);
  }

  function handleAddAccount(scope) {
    setEditingAccount(null);
    setAddAccountScope(scope);
    setShowAddAccountModal(true);
  }

  // The whole record, not a copy of the fields the form happens to ask for: the
  // form seeds its balance from the stored cents and has to sign it back the way
  // it came, and a copy assembled here is one more place that convention could
  // be applied differently.
  function handleEditAccount(account) {
    setEditingAccount(account);
    setShowAddAccountModal(true);
  }

  // Same contract as the estimates above: the store validates, the page says so.
  // A rejected figure is left in the field to be corrected, as in the modals,
  // and the panel's own message says why it was not taken.
  function handlePayScheduleChange(patch) {
    const result = setPaySchedule(patch);
    setPayError(result.ok ? null : result.error);
    return result;
  }

  // Writes the same `RetirementContext` field `RetirementAssumptionsPanel`
  // does — there is one figure, editable from either page, never two that
  // could disagree. Putting it here too is the point: a 401(k) deduction has
  // no category to be typed from, and before this the only door to it was the
  // Retirement page.
  // The store validates and the panel shows it, the contract every panel on this
  // page keeps: a swallowed rejection would leave a figure on screen that the
  // target below it is not using.
  function handleFundChange(changes) {
    const result = setEmergencyFund(changes);
    setFundError(result.ok ? null : result.error);
  }

  function handlePretaxChange(pretaxContributionCents) {
    const result = setRetirementPlan({ pretaxContributionCents });
    setPretaxError(result.ok ? null : result.error);
    return result;
  }

  return (
    <>
      <PageHeader
        eyebrow="Configuration"
        title="Budget plan"
        description="Set what you expect to earn, what each category is expected to need in a typical month, and the accounts your money sits in. Rename a category by typing over it. Drag categories to file them under a group or change their order — the Transactions page follows the arrangement you set here. Each category counts as essentials, fun, savings, or retirement, starting on its group's default. Give a category a goal and the balance it is saving towards appears beside it on the dashboard; leave the field blank for one that is not saving towards anything."
      />

      {/* The verdict leads. It is the answer the rest of the page is working
          towards, and a plan that does not balance has to be visible before the
          user scrolls, not after. */}
      <PlanHealthSummary
        expectedIncomeCents={health.expectedIncomeCents}
        plannedCents={health.plannedCents}
        unplannedCents={health.unplannedCents}
        bucketRows={health.bucketRows}
        sourceCount={health.sourceCount}
        pretaxMonthlyCents={health.pretaxMonthlyCents}
        pretaxContributionCents={plan.pretaxContributionCents}
        pretaxError={pretaxError}
        onPretaxChange={handlePretaxChange}
      />

      {error && (
        <p
          role="alert"
          className="mb-4 border border-vermilion/60 bg-panel px-4 py-3 font-sans text-row text-vermilion"
        >
          {error}
        </p>
      )}

      {/* Two columns from `lg` up, and one below it: the category rows are drag
          targets with a figure and a button on them, and squeezing them into
          half a tablet would cost more than the scrolling it saves. `items-start`
          so the shorter column ends where its content does rather than being
          stretched to match the taller one. */}
      <div className="mt-4 grid items-start gap-x-5 gap-y-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ColumnHeading title="Categories">
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setAddToGroupId(null);
                setShowAddBudgetModal(true);
              }}
            >
              Add category
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setEditingGroup(null);
                setShowAddGroupModal(true);
              }}
            >
              Add group
            </Button>
          </ColumnHeading>

          {/* Groups on their own are worth showing — a user can lay out their
              headings before filling them — so the page only takes over with an
              empty state when there is nothing at all to arrange. */}
          {health.categoryCount === 0 && health.groupCount === 0 ? (
            <section className="border border-edge bg-panel">
              <p className="px-4 py-5 font-sans text-row text-chalk-soft">
                No categories yet. Add one to start planning, then fund it from the Transactions
                page.
              </p>
            </section>
          ) : (
            <CategoryPlanner
              sections={health.sections}
              onLayoutChange={setCategoryLayout}
              onNameChange={handleNameChange}
              onEstimateChange={handleEstimateChange}
              onGoalChange={handleGoalChange}
              onBucketChange={handleBucketChange}
              onAddCategory={handleAddCategory}
              onEditGroup={handleEditGroup}
              onDeleteGroup={(section) => deleteGroup({ id: section.groupId })}
              onDeleteCategory={deleteBudget}
            />
          )}

          <div className="mt-8 space-y-3">
            <ExpectedIncomeTable
              rows={health.incomeRows}
              expectedIncomeCents={health.expectedIncomeCents}
              pretaxMonthlyCents={health.pretaxMonthlyCents}
              onDelete={deleteIncomeSource}
              actions={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAddIncomeSourceModal(true)}
                >
                  Add income source
                </Button>
              }
            />
            {/* Under the income it belongs to, and the only dated thing on the
                page: the table above says how much arrives, this says when. */}
            <PaySchedulePanel
              schedule={schedule}
              paycheck={paycheck}
              error={payError}
              onChange={handlePayScheduleChange}
            />
          </div>
        </div>

        <div>
          <ColumnHeading title="Accounts">
            {/* Onboarding's door into the assign flow: an opening balance is
                money the household already had, and it wants a home in the
                categories below before the month it happens to be entered in
                claims it as new income. See `startingBalancePeriod`. */}
            <Button variant="outline" size="sm" onClick={() => setShowAssignStartingModal(true)}>
              Assign starting balances
            </Button>
          </ColumnHeading>
          <AccountList
            accounts={accounts}
            balanceById={balanceById}
            onAdd={handleAddAccount}
            onEdit={handleEditAccount}
            onDelete={deleteAccount}
          />
        </div>
      </div>

      {/* Full width below both columns, because it joins them: the target is a
          multiple of the left-hand column's essentials estimates and the balance
          comes out of the right-hand column's accounts, so a panel belonging to
          both belongs under both. Open rather than folded away like the three
          panels beneath it — those are opened to set something up, while this
          carries a figure worth meeting in passing, and a buffer nobody is
          reminded of is the one most likely to be quietly spent. */}
      <div className="mt-8">
        <EmergencyFundPanel
          fund={fund}
          error={fundError}
          onChange={handleFundChange}
          onToggleAccount={toggleFundAccount}
        />
      </div>

      {/* Below both columns and closed by default. Backfilling an account's past
          is a one-off — it happens once, when the books are set up from real
          statements — and it wants the full width of the page when it happens,
          so it sits at the foot of the page rather than squeezed into the
          accounts column or opened on top of it as a modal. The month a figure
          belongs to is on its own row, which is why a grid of months can live on
          a page that deliberately has no month in its corner. */}
      <div className="mt-4">
        <BalanceHistoryPanel />
      </div>

      {/* Above the payee list and closed like it, because a schedule is written
          down once and then left alone — nearer to setting the household up than
          the list below it, which fills itself. What is *due* is read on the
          dashboard; what a schedule *is* is stated here, on the page that holds
          every other standing fact and deliberately carries no month. */}
      <div className="mt-4">
        <ScheduleList />
      </div>

      {/* Between the two, and closed like both. A payee list is a standing fact
          like the accounts above it and belongs to no month, which is what lets it
          sit on a page with none in its corner — but it fills itself as
          transactions are entered, so it is opened to tidy up rather than to set
          anything up, and that puts it below the things this page exists for. */}
      <div className="mt-4">
        <PayeeList />
      </div>

      {/* Last on the page, and closed like the panel above it. Exporting is read
          twice a year and restoring perhaps once ever, so neither belongs above
          the things this page is actually opened to do — but the books being a
          file the household owns is the answer to "what happens if this laptop
          dies", and that question has to be answerable from inside the app. */}
      <div className="mt-4">
        <BooksFilePanel />
      </div>

      <AddBudgetModal
        show={showAddBudgetModal}
        defaultGroupId={addToGroupId}
        handleClose={() => setShowAddBudgetModal(false)}
      />
      <AddGroupModal
        show={showAddGroupModal}
        group={editingGroup}
        handleClose={() => setShowAddGroupModal(false)}
      />
      <AddIncomeSourceModal
        show={showAddIncomeSourceModal}
        handleClose={() => setShowAddIncomeSourceModal(false)}
      />
      <AddAccountModal
        show={showAddAccountModal}
        account={editingAccount}
        defaultScope={addAccountScope}
        handleClose={() => setShowAddAccountModal(false)}
      />
      <AssignIncomeModal
        show={showAssignStartingModal}
        period={startingPeriod}
        poolCentsOverride={startingPoolCents}
        title="Assign starting balances"
        handleClose={() => setShowAssignStartingModal(false)}
      />
    </>
  );
}
