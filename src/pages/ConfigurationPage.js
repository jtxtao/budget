import { useState } from "react";
import AccountList from "../components/AccountList";
import AddAccountModal from "../components/AddAccountModal";
import AddBudgetModal from "../components/AddBudgetModal";
import AddGroupModal from "../components/AddGroupModal";
import AddIncomeSourceModal from "../components/AddIncomeSourceModal";
import AssignIncomeModal from "../components/AssignIncomeModal";
import Button from "../components/Button";
import CategoryPlanner from "../components/CategoryPlanner";
import DeleteCategoryModal from "../components/DeleteCategoryModal";
import EmergencyFundPanel from "../components/EmergencyFundPanel";
import ExpectedIncomeTable from "../components/ExpectedIncomeTable";
import PageHeader from "../components/PageHeader";
import PlanHealthSummary from "../components/PlanHealthSummary";
import PaySchedulePanel from "../components/PaySchedulePanel";
import SetupGuideCallout from "../components/SetupGuideCallout";
import {
  ACCOUNT_SCOPES,
  DEFAULT_SCOPE,
  isOffBudget,
  useAccounts,
} from "../contexts/AccountsContext";
import { useBudgets } from "../contexts/BudgetsContext";
import { useEmergencyFundPlan } from "../contexts/EmergencyFundContext";
import { useIncomePlan } from "../contexts/IncomePlanContext";
import { usePaySchedule } from "../contexts/PayScheduleContext";
import { useRetirement } from "../contexts/RetirementContext";
import useAccountBalances from "../hooks/useAccountBalances";
import useEmergencyFund from "../hooks/useEmergencyFund";
import useNetWorth from "../hooks/useNetWorth";
import useNextPaycheck from "../hooks/useNextPaycheck";
import useHouseholdInUse from "../hooks/useHouseholdInUse";
import usePlanHealth from "../hooks/usePlanHealth";
import useStartingBalances from "../hooks/useStartingBalances";
import { currentPeriod } from "../utils";

const SETUP_SKIPS_KEY = "configurationSetupSkips";

function readSetupSkips() {
  try {
    const value = JSON.parse(window.localStorage.getItem(SETUP_SKIPS_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((step) => typeof step === "string") : [];
  } catch {
    return [];
  }
}

function saveSetupSkips(skips) {
  try {
    window.localStorage.setItem(SETUP_SKIPS_KEY, JSON.stringify(skips));
  } catch {
    // The setup flow can still continue if browser storage is unavailable.
  }
}

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
    <div
      className={`mb-3 flex min-h-[1.625rem] flex-wrap items-center justify-between gap-x-4 gap-y-2 ${
        title ? "border-b border-edge pb-2" : ""
      }`}
    >
      {title ? <h2 className="text-label uppercase text-chalk">{title}</h2> : <span />}
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
  const [skippedSetupSteps, setSkippedSetupSteps] = useState(() => new Set(readSetupSkips()));
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
  // The category a Remove click is asking to delete, so its own confirmation
  // can ask where that category's money goes — null whenever the dialog is
  // not open, the same "which row" shape `editingAccount` keeps above.
  const [deletingBudget, setDeletingBudget] = useState(null);

  const { budgets, updateBudget, deleteGroup, setCategoryLayout } = useBudgets();
  const { deleteIncomeSource, reorderIncomeSources } = useIncomePlan();
  const { accounts, updateAccount, deleteAccount, reorderAccounts } = useAccounts();
  const { schedule, setPaySchedule } = usePaySchedule();
  const { plan, setRetirementPlan } = useRetirement();
  const { setEmergencyFund, toggleFundAccount, setFundAccountAmount } = useEmergencyFundPlan();

  const health = usePlanHealth();
  const householdInUse = useHouseholdInUse();
  const fund = useEmergencyFund();
  const paycheck = useNextPaycheck();
  const { period: startingPeriod, poolCentsOverride: startingPoolCents } = useStartingBalances();
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

  // Both booleans, commit on change like the bucket select above — there is
  // nothing to type, so nothing to put back on a refusal either.
  function handleRolloverChange(budget, rolloverEnabled) {
    updateBudget({ id: budget.id, rolloverEnabled });
  }

  function handleHideChange(budget, hidden) {
    updateBudget({ id: budget.id, hidden });
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

  function handleFundAccountAmount(change) {
    const result = setFundAccountAmount(change);
    setFundError(result.ok ? null : result.error);
    return result;
  }

  function handlePretaxChange(pretaxContributionCents) {
    const result = setRetirementPlan({ pretaxContributionCents });
    setPretaxError(result.ok ? null : result.error);
    return result;
  }

  function skipSetupStep(step) {
    setSkippedSetupSteps((previous) => {
      const next = new Set(previous);
      next.add(step);
      saveSetupSkips([...next]);
      return next;
    });
  }

  const activeAccounts = accounts.filter((account) => !account.archived);
  const accountSetupSteps = [
    {
      key: "on-budget",
      targetId: `setup-add-account-${ACCOUNT_SCOPES.ON_BUDGET}`,
      title: "Add your everyday accounts",
      description:
        "Think about the accounts you spend from today, such as checking and savings. Add one to start; you can come back for any others later.",
      done: activeAccounts.some((account) => account.scope === ACCOUNT_SCOPES.ON_BUDGET),
    },
    {
      key: "credit-card",
      targetId: `setup-add-account-${ACCOUNT_SCOPES.CREDIT_CARD}`,
      title: "Add your credit cards",
      description:
        "Add the cards you spend on and pay off. Canopy tracks their spending alongside your everyday accounts.",
      done: activeAccounts.some((account) => account.scope === ACCOUNT_SCOPES.CREDIT_CARD),
    },
    {
      key: "off-budget",
      targetId: `setup-add-account-${ACCOUNT_SCOPES.OFF_BUDGET}`,
      title: "Add accounts you track off budget",
      description:
        "Include savings for the long term, retirement, investments, property, or loans you want to see in net worth. You can add these later too.",
      done: activeAccounts.some((account) => account.scope === ACCOUNT_SCOPES.OFF_BUDGET),
    },
  ];
  const nextAccountStep = accountSetupSteps.find(
    (step) => !step.done && !skippedSetupSteps.has(step.key)
  );
  const emergencyFundIsSetUp = fund.accountRows.some((row) => row.included);
  const earlierSetupStepsDone =
    !nextAccountStep &&
    (health.sourceCount > 0 || skippedSetupSteps.has("income")) &&
    (plan.pretaxContributionCents != null || skippedSetupSteps.has("pretax")) &&
    health.categoryCount > 0 &&
    (emergencyFundIsSetUp || skippedSetupSteps.has("emergency-fund"));
  // The walk-through is for a household setting up, never one already keeping
  // its books: the skips above live in this browser only, so a new device would
  // otherwise restart setup over a full ledger. See `useHouseholdInUse`.
  const setupStep = householdInUse
    ? null
    : nextAccountStep?.key ??
    (health.sourceCount === 0 && !skippedSetupSteps.has("income")
      ? "income"
      : (health.sourceCount > 0 || skippedSetupSteps.has("income")) &&
          plan.pretaxContributionCents == null &&
          !skippedSetupSteps.has("pretax")
        ? "pretax"
        : health.categoryCount === 0 && !skippedSetupSteps.has("categories")
          ? "categories"
          : health.categoryCount > 0 &&
              !emergencyFundIsSetUp &&
              !skippedSetupSteps.has("emergency-fund")
            ? "emergency-fund"
            : earlierSetupStepsDone && !skippedSetupSteps.has("starting-balances")
              ? "starting-balances"
              : null);

  return (
    <>
      <PageHeader
        title="Budget plan"
      />

      {/* The verdict leads. It is the answer the rest of the page is working
          towards, and a plan that does not balance has to be visible before the
          user scrolls, not after. */}
      <PlanHealthSummary
        expectedIncomeCents={health.expectedIncomeCents}
        plannedCents={health.plannedCents}
        unplannedCents={health.unplannedCents}
        bucketRows={health.bucketRows}
        splitCents={health.splitCents}
        sourceCount={health.sourceCount}
        pretaxMonthlyCents={health.pretaxMonthlyCents}
        pretaxContributionCents={plan.pretaxContributionCents}
        pretaxError={pretaxError}
        onPretaxChange={handlePretaxChange}
      />

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-vermilion/60 bg-panel px-4 py-3 font-sans text-row text-vermilion"
        >
          {error}
        </p>
      )}

      {/* Two columns from `lg` up, and one below it: the category rows are drag
          targets with a figure and a button on them, and squeezing them into
          half a tablet would cost more than the scrolling it saves. `items-start`
          so the shorter column ends where its content does rather than being
          stretched to match the taller one. */}
      <div className="mt-4 grid items-start gap-x-5 gap-y-8 [&>*]:min-w-0 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          {/* Income leads the column: it is what the categories below are
              planned against, so the money coming in is stated before the
              money it is divided into. */}
          <div className="mb-8 space-y-3">
            <ExpectedIncomeTable
              rows={health.incomeRows}
              expectedIncomeCents={health.expectedIncomeCents}
              pretaxMonthlyCents={health.pretaxMonthlyCents}
              onDelete={deleteIncomeSource}
              onReorder={reorderIncomeSources}
              actions={
                <Button
                  id="setup-add-income"
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
          <ColumnHeading title="Categories">
            <Button
              id="setup-add-category"
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
            <section className="overflow-hidden rounded-2xl border border-edge bg-panel">
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
              onRolloverChange={handleRolloverChange}
              onHideChange={handleHideChange}
              onAddCategory={handleAddCategory}
              onEditGroup={handleEditGroup}
              onDeleteGroup={(section) => deleteGroup({ id: section.groupId })}
              onDeleteCategory={setDeletingBudget}
            />
          )}

        </div>

        <div>
          <ColumnHeading title="Accounts">
            <Button
              id="setup-assign-starting-balances"
              variant="outline"
              size="sm"
              onClick={() => setShowAssignStartingModal(true)}
            >
              Assign starting balances
            </Button>
          </ColumnHeading>
          <AccountList
            accounts={accounts}
            balanceById={balanceById}
            onAdd={handleAddAccount}
            onEdit={handleEditAccount}
            onArchive={(account, archived) => updateAccount({ id: account.id, archived })}
            onReorder={reorderAccounts}
          />
        </div>
      </div>

      {nextAccountStep && setupStep === nextAccountStep.key && (
        <SetupGuideCallout
          targetId={nextAccountStep.targetId}
          title={nextAccountStep.title}
          description={nextAccountStep.description}
        >
          <button
            type="button"
            className="mt-3 font-sans text-row text-chalk-soft underline"
            onClick={() => skipSetupStep(nextAccountStep.key)}
          >
            Skip this account type
          </button>
        </SetupGuideCallout>
      )}
      {setupStep === "income" && (
        <SetupGuideCallout
          targetId="setup-add-income"
          title="Look ahead to money coming in"
          description="Add a paycheck or another regular source of income. Canopy uses it to compare what you expect to earn with what you plan to spend."
        >
          <button
            type="button"
            className="mt-3 font-sans text-row text-chalk-soft underline"
            onClick={() => skipSetupStep("income")}
          >
            Skip income for now
          </button>
        </SetupGuideCallout>
      )}
      {setupStep === "pretax" && (
        <SetupGuideCallout
          targetId="setup-pretax-contribution"
          title="Add pre-tax retirement contributions"
          description="If payroll takes money for a 401(k) or similar plan before it reaches your account, enter that amount here. You can enter it by month or year."
        >
          <button
            type="button"
            className="mt-3 font-sans text-row text-chalk-soft underline"
            onClick={() => skipSetupStep("pretax")}
          >
            I don’t have pre-tax contributions
          </button>
        </SetupGuideCallout>
      )}
      {setupStep === "categories" && (
        <SetupGuideCallout
          targetId="setup-add-category"
          title="Plan where your spending goes"
          description="Start with a few categories that match your life, such as housing, groceries, and bills. You can organize and add more later."
        />
      )}
      {setupStep === "emergency-fund" && (
        <SetupGuideCallout
          targetId="setup-emergency-fund"
          title="Set up your emergency fund"
          description={
            <>
              <p>
                Your default target is six months of planned spending in Essentials categories.
                Change the months or enter a custom target above.
              </p>
              <p className="mt-2">
                Below, select the on-budget account that holds your emergency savings. If only part
                of its balance is for emergencies, enter that amount under Counted. Hold the
                money back to ensure that you always have this set aside as your emergency fund.
              </p>
            </>
          }
        >
          <button
            type="button"
            className="mt-3 font-sans text-row text-chalk-soft underline"
            onClick={() => skipSetupStep("emergency-fund")}
          >
            Set this up later
          </button>
        </SetupGuideCallout>
      )}
      {setupStep === "starting-balances" && (
        <SetupGuideCallout
          targetId="setup-assign-starting-balances"
          title="Give your starting balances a job"
          description={
            <>
              <p>
                If you have money already in your accounts, assign it to categories and savings goals.
                These are starting balances, so they are recorded before this month and do not count
                toward this month&apos;s budget.
              </p>
              <p className="mt-2">Then head to the Dashboard to see your budget at a glance.</p>
            </>
          }
        >
          <button
            type="button"
            className="mt-3 font-sans text-row text-chalk-soft underline"
            onClick={() => skipSetupStep("starting-balances")}
          >
            Do this later
          </button>
        </SetupGuideCallout>
      )}

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
          onAccountAmountChange={handleFundAccountAmount}
        />
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
      <DeleteCategoryModal
        show={deletingBudget != null}
        budget={deletingBudget}
        categories={budgets}
        handleClose={() => setDeletingBudget(null)}
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
        onDelete={deleteAccount}
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
