import { useState } from "react";
import { Link } from "react-router-dom";
import AddDonationModal from "../components/AddDonationModal";
import AddOrganizationModal from "../components/AddOrganizationModal";
import Button from "../components/Button";
import DonationList from "../components/DonationList";
import GivingCategoriesPanel from "../components/GivingCategoriesPanel";
import GivingGoalPanel from "../components/GivingGoalPanel";
import GivingSummary from "../components/GivingSummary";
import OrganizationList from "../components/OrganizationList";
import PageHeader from "../components/PageHeader";
import Placeholder from "../components/Placeholder";
import YearStepper from "../components/YearStepper";
import { useDonations } from "../contexts/DonationsContext";
import { useBudgets } from "../contexts/BudgetsContext";
import { usePayees } from "../contexts/PayeesContext";
import useGiving from "../hooks/useGiving";
import { deleteReceipt, openReceipt, saveReceipt } from "../receipts";
import { formatCents, todayISO } from "../utils";

/**
 * Giving, read a year at a time.
 *
 * **The year is the axis, and it is the only page in the app where that is
 * true.** Everything else here is filed by month, because a month is what a
 * household plans in — but a deduction is claimed on a return, a return covers a
 * year, and a goal that reset every month would be twelve different promises.
 * Hence a year stepper rather than the month stepper the net-worth page carries:
 * same idea, different unit, and neither is a mode of the other.
 *
 * **No money lives on this page.** A gift is an ordinary outflow on the register
 * — it leaves an account, it comes out of an envelope, it counts in the spending
 * report like everything else. What this page adds is the part the ledger has no
 * field for: which organization received it, how much of it the tax office will
 * recognise, and whether the acknowledgment is in hand. Every figure below is
 * that statement joined back to the money, which is why the amounts are read-only
 * here and editable on the register.
 *
 * The three panels answer three different questions and none of them is the
 * others: the list is what was given, the goal is what was meant to be given, and
 * the organizations are who it goes to — a standing list that outlives any year.
 */
export default function DonationsPage() {
  // Read once, so the year on screen and the year everything is filed under come
  // from the same reading of the calendar.
  const [year, setYear] = useState(() => todayISO().slice(0, 4));
  const [showDonationModal, setShowDonationModal] = useState(false);
  const [showOrganizationModal, setShowOrganizationModal] = useState(false);
  // The organization being amended, held apart from the add button: adding names
  // a new one, editing restates one already listed.
  const [editingOrganization, setEditingOrganization] = useState(null);
  const [error, setError] = useState(null);
  // Held apart from the page-level error: the goal has its own panel with its own
  // field, and a message about a percentage belongs beside it rather than at the
  // top of a page about gifts.
  const [goalError, setGoalError] = useState(null);

  const {
    recipients,
    givingSettings,
    recordDonation,
    updateDonation,
    removeDonation,
    deleteRecipient,
    setGivingGoal,
    setGivingCategories,
    setGiftExcluded,
  } = useDonations();
  const { budgets } = useBudgets();
  const giving = useGiving(year);
  // Names for the gift rows. `useGiving` passes the reference through and stops
  // there — it is a hook about what was given, and a payee's name is not a figure —
  // so the join happens here, the same seam `ReportsPage` keeps for its drill-in.
  const { payeeById } = usePayees();
  const giftRows = giving.rows.map((row) => ({
    ...row,
    payeeName: payeeById.get(row.payeeId)?.name ?? null,
  }));

  // The store validates; the page has to say so. Silently swallowing a rejected
  // edit would leave a row showing a figure the books are not using.
  //
  // A row read off a giving category has no tag yet, so the first edit writes
  // one — the row's own reading with the edit laid over it.
  function handleDonationChange(patch) {
    const row = giving.rows.find((entry) => entry.transactionId === patch.transactionId);
    const result = row?.auto
      ? recordDonation({
          transactionId: row.transactionId,
          recipientId: row.recipientId,
          deductibleCents: row.deductibleCents,
          acknowledged: row.acknowledged,
          receipt: row.receipt,
          ...patch,
        })
      : updateDonation(patch);
    setError(result.ok ? null : result.error);
    return result;
  }

  /**
   * Attach the charity's receipt to a gift. The file is stored first (see
   * `src/receipts.js`) and only then described on the gift — which also ticks
   * the receipt box, since a receipt on file is the acknowledgment in hand. If
   * the gift refuses the description, the file is deleted again so nothing is
   * left stored with nothing pointing at it. A file already attached is
   * replaced, and deleted once the new one is on the gift.
   */
  async function handleAttachReceipt(row, file) {
    const saved = await saveReceipt(file);
    if (!saved.ok) return saved;
    const result = handleDonationChange({
      transactionId: row.transactionId,
      receipt: saved.receipt,
      acknowledged: true,
    });
    if (!result.ok) {
      deleteReceipt(saved.receipt);
      return result;
    }
    if (row.receipt) deleteReceipt(row.receipt);
    return result;
  }

  // Taking the file off leaves the box as it is: a paper copy in a drawer is
  // still an acknowledgment in hand.
  function handleRemoveReceipt(row) {
    const result = handleDonationChange({ transactionId: row.transactionId, receipt: null });
    if (result.ok && row.receipt) deleteReceipt(row.receipt);
    return result;
  }

  // Untagging removes the statement and, for a gift read off a giving category,
  // says it is not one — or it would come straight back. The money stays put.
  function handleUntag(row) {
    removeDonation({ transactionId: row.transactionId });
    setGiftExcluded({ transactionId: row.transactionId, excluded: true });
  }

  function handleGoalChange(patch) {
    const result = setGivingGoal({ year, ...patch });
    setGoalError(result.ok ? null : result.error);
    return result;
  }

  function handleEditOrganization(row) {
    // The record as the store holds it, assembled from the row that carries its
    // fields — the list is a year's totals joined to the organizations, so the
    // modal is given the answers rather than the totals.
    setEditingOrganization({
      id: row.recipientId,
      name: row.name,
      deductible: row.deductibleByDefault,
    });
    setShowOrganizationModal(true);
  }

  function handleAddOrganization() {
    setEditingOrganization(null);
    setShowOrganizationModal(true);
  }

  return (
    <>
      <PageHeader
        eyebrow="Giving"
        title="Donations"
        description="What was given, who it went to, and how much of it is tax deductible — read a year at a time, because that is the unit a return is filed in. A gift is an ordinary expense on the register; what is added here is the part the ledger has no field for. The deductible amount is per gift, so a gala ticket can be part deductible and a raffle ticket none of it."
        actions={
          <>
            <YearStepper year={year} onChange={setYear} />
            <Button variant="primary" onClick={() => setShowDonationModal(true)}>
              Record a gift
            </Button>
          </>
        }
      />

      <div className="space-y-4">
        <GivingSummary giving={giving} />

        {error && (
          <p
            role="alert"
            className="border border-vermilion/60 bg-panel px-4 py-3 font-sans text-row text-vermilion"
          >
            {error}
          </p>
        )}

        {/* Gifts big enough that the household's own record of them is not
            evidence, with nothing noted against them. Said out loud rather than
            left to be spotted down a column, because the fix — asking the
            charity — has a deadline the page cannot see. */}
        {giving.awaitingCount > 0 && (
          <p className="border border-sulfur/50 bg-panel px-4 py-3 font-sans text-row text-chalk-soft">
            <span className="font-medium text-sulfur">
              {giving.awaitingCount}{" "}
              {giving.awaitingCount === 1 ? "gift needs" : "gifts need"} a written acknowledgment
            </span>{" "}
            — {formatCents(giving.awaitingCents)} of giving. Tick the receipt box on each once the
            organization has sent one.
          </p>
        )}

        {/* Money the year cannot place. An undated gift belongs to no year, so
            putting it in one would invent the history the ledger deliberately
            refuses to invent — but a figure missing from a total that is going on
            a return has to be visible as missing. */}
        {giving.undatedCount > 0 && (
          <p className="border border-sulfur/50 bg-panel px-4 py-3 font-sans text-row text-chalk-soft">
            <span className="font-medium text-sulfur">
              {giving.undatedCount} {giving.undatedCount === 1 ? "gift has" : "gifts have"} no date
            </span>{" "}
            — {formatCents(giving.undatedTotalCents)} — so they are in no year and in nothing above.{" "}
            <Link
              to="/transactions"
              className="text-azure underline underline-offset-2 hover:text-chalk"
            >
              Date them on the register
            </Link>{" "}
            and they will appear here.
          </p>
        )}

        {/* Two columns from `lg` up: the list of gifts is six columns wide and
            squeezing it into half a tablet would cost more than the scrolling it
            saves. `items-start` so the shorter column ends where its content does
            rather than being stretched to match. */}
        <div className="grid items-start gap-x-5 gap-y-4 [&>*]:min-w-0 lg:grid-cols-3">
          <div className="min-w-0 lg:col-span-2">
            <DonationList
              year={year}
              rows={giftRows}
              recipients={recipients}
              totalCents={giving.totalCents}
              deductibleCents={giving.deductibleCents}
              onChange={handleDonationChange}
              onRemove={handleUntag}
              onAdd={() => setShowDonationModal(true)}
              onAttachReceipt={handleAttachReceipt}
              onRemoveReceipt={handleRemoveReceipt}
              onOpenReceipt={(row) => openReceipt(row.receipt)}
            />

            {/* Only when the year on screen is empty and the books are not: a
                household stepping back through its giving should be told the
                records start later rather than left wondering whether the page
                is broken. */}
            {giving.rows.length === 0 && giving.firstYear != null && (
              <p className="mt-3 border border-edge bg-panel px-4 py-3 font-sans text-row text-chalk-soft">
                The first gift on the books is in{" "}
                <button
                  type="button"
                  onClick={() => setYear(giving.firstYear)}
                  className="text-azure underline underline-offset-2 hover:text-chalk"
                >
                  {giving.firstYear}
                </button>
                .
              </p>
            )}
          </div>

          <div className="space-y-4">
            <GivingGoalPanel
              year={year}
              goal={giving.goal}
              error={goalError}
              onChange={handleGoalChange}
            />
            <GivingCategoriesPanel
              budgets={budgets}
              selectedIds={giving.givingBudgetIds}
              stated={Array.isArray(givingSettings.budgetIds)}
              onChange={setGivingCategories}
            />
            <OrganizationList
              year={year}
              rows={giving.byRecipient}
              onAdd={handleAddOrganization}
              onEdit={handleEditOrganization}
              onRemove={(row) => deleteRecipient({ id: row.recipientId })}
            />
          </div>
        </div>

        <Placeholder
          title="Still to come"
          items={[
            "Non-cash gifts — goods donated, which move no money through an account",
            "A year against the ones before it, so a habit is visible rather than a total",
            "Pledges: what has been promised against what has been paid",
            "Export the year's gifts as CSV, for whoever prepares the return",
          ]}
        />
      </div>

      <AddDonationModal
        show={showDonationModal}
        handleClose={() => setShowDonationModal(false)}
      />
      <AddOrganizationModal
        show={showOrganizationModal}
        organization={editingOrganization}
        handleClose={() => setShowOrganizationModal(false)}
      />
    </>
  );
}
