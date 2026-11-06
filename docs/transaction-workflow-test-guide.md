# Transaction workflow changes: review and test guide

This guide covers the transaction rules, category funding targets, and transaction search/filter controls added in November 2026. These changes are in the working tree; they are not a release or a deployment.

## Start a safe test session

1. From the repository root, run `npm install` if dependencies are missing, then `npm start`.
2. Open `http://localhost:3000`.
3. Use a guest/local session or a separate test household. The controls below write to the active household's books. If you use an existing household, export **Settings → Your books as a file** first.
4. Create one account and two categories in Configuration if the test household is empty. Give one category a monthly **Estimate** and a **Goal**.

The desktop app uses the same features. Run `npm run desktop` with the development server setup described in [README.md](../README.md).

## 1. Editable transaction rules

**Where:** Settings → Transaction rules.

### Test a new transaction

1. Add a rule named `Groceries at Market`.
2. Set **Description contains** to `Market`, **Direction** to **Money out**, and **Set category** to your groceries category. Save it.
3. Open Transactions and add an outflow whose note/description contains `Market`. Give it a valid account and category in the entry form.
4. Check the transaction register. Its category should be groceries, even if the entry form started with another category.
5. Add an outflow whose description does not contain `Market`. Its category should stay as entered.
6. In Settings, disable the rule, then add another matching outflow. It should stay as entered. Enable the rule and try again.

You can also match a payee or account. All stated conditions in one rule must match. Enabled rules run in displayed order; if more than one sets the same field, the later rule wins. A **Set note** action replaces the transaction description. Rules do not run on transfers. Rules run as a transaction is entered; editing or disabling a rule does not rewrite transactions already in the register.

## 2. Funding targets and suggestions

**Where:** Set each category's **Estimate** and **Goal** in Configuration. Choose its funding type under Settings → Funding targets. Open **Assign income** from Transactions or the dashboard to use **Suggest funding**.

| Type | Suggested amount for a category |
| --- | --- |
| Monthly | Its full monthly Estimate, regardless of money carried in. |
| Refill | Estimate minus the category's money already available before this month's assignment, with a floor of zero. |
| By date | The remaining Goal balance divided equally across the months from the selected month through the due month, rounded up to a cent. Requires a Goal and Due month; otherwise it falls back to the monthly Estimate. |

### Test the calculation

1. Set a category's Estimate to **$100**. Open Assign income for a month with enough money to assign. Click **Suggest funding**. A Monthly target should suggest **$100**.
2. Give that category **$40** of available carry-in before the selected month's assignment. Change the type to **Refill** and click Suggest funding again. It should suggest **$60**.
3. Set a category Goal of **$300**, type **By date**, and Due month two months after the month selected in Assign income. With no carry-in, the suggestion should be **$100** per month. A positive carry-in reduces the amount still needed.
4. Check **Remaining to assign** after each suggestion. Suggestions are capped by the money available to assign and filled in category order. Review or edit the proposed amounts, then submit the form to save them. Closing the dialog without submitting does not save the suggestion.

If the pool has less money than the targets request, later categories may receive less or zero. The button does not fund savings-goal rows; those remain editable separately in the same form.

## 3. Searching and filtering the register

**Where:** Transactions → filters.

### Test search and filters

1. Add a few transactions across different months, accounts, and categories.
2. Select **All dates** if a transaction is outside the displayed month. Search for a word in its payee or note. The register should narrow to matching rows.
3. Pick an **Account** and a **Category**; the filters combine, and the month/all-dates choice remains separate.
4. Use **Clear filters** to reset search, account, and category filters.

A category filter reads split parts, refunds, and the effective category of a crossing transfer, so a row shows whenever any part of it belongs to the chosen category.

## What changed in code

| Area | Change |
| --- | --- |
| [Transaction store](../src/contexts/TransactionsContext.js) | Stores the rule list, applies rules on creation, persists review status, and validates bulk edits before writing. Older ledger records remain reviewed by default. |
| [Rule logic](../src/domain/transactionRules.js) | Matches payee, account, direction, description, and optional amount bounds; applies category and note actions in order. The current editor exposes payee, account, direction, and description conditions. |
| [Rule editor](../src/components/TransactionRulesPanel.js) | Adds the Settings form and rule list with edit, enable/disable, and delete actions. |
| [Category store](../src/contexts/BudgetsContext.js) | Persists target type and optional due month on categories. Existing categories retain monthly behavior. |
| [Target logic](../src/domain/fundingTargets.js) | Calculates monthly, refill, and by-date suggestions. |
| [Target settings](../src/components/TargetSettingsPanel.js) | Adds the funding type and due-month controls in Settings. |
| [Assignment dialog](../src/components/AssignIncomeModal.js) | Adds Suggest funding, capped by available money. Saving still uses the existing assignment form. |
| [Transactions page](../src/pages/TransactionsPage.js) | Adds search, review filtering, selection, and bulk review, rule, and category actions. |
| [Storage list](../src/storage.js) | Includes `transactionRules` in the keys exported and synced with a household's books. |

## Automated verification

Run:

```sh
npm run build
npm test -- --watchAll=false --runInBand --runTestsByPath src/domain/transactionRules.test.js src/domain/fundingTargets.test.js src/contexts/dataModel.test.js src/pages/TransactionsPage.test.js
git diff --check
```

At the time of writing, the build succeeds with an unrelated hook dependency warning in `CashflowCalendarWidget.js`. The focused run has **201 passing and 2 failing tests**. Both failures are dashboard shortcut tests in `TransactionsPage.test.js` that expect links absent from the dashboard in this run; the new rule, target, and data-model tests pass. Manual UI checks above are still needed for the new controls.
