import { applyTransactionRules } from "./transactionRules";

const transaction = { kind: "outflow", payeeId: "shop", accountId: "checking", description: "Market", amountCents: 1200, budgetId: "old", splits: null };

test("matching rules run in order and leave unmatched records alone", () => {
  const rules = [
    { id: "one", enabled: true, payeeId: "shop", budgetId: "food" },
    { id: "two", enabled: true, descriptionContains: "market", budgetId: "household" },
    { id: "three", enabled: true, payeeId: "other", budgetId: "wrong" },
  ];
  expect(applyTransactionRules(transaction, rules).budgetId).toBe("household");
  expect(transaction.budgetId).toBe("old");
});

test("transfers are not recategorized", () => {
  const transfer = { ...transaction, kind: "transfer" };
  expect(applyTransactionRules(transfer, [{ enabled: true, accountId: "checking", budgetId: "food" }])).toBe(transfer);
});
