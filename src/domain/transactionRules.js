export function applyTransactionRules(transaction, rules) {
  if (transaction.kind === "transfer") return transaction;
  return rules.reduce((current, rule) => {
    if (!rule.enabled) return current;
    if (rule.payeeId && current.payeeId !== rule.payeeId) return current;
    if (rule.accountId && current.accountId !== rule.accountId) return current;
    if (rule.kind && current.kind !== rule.kind) return current;
    if (rule.descriptionContains && !current.description.toLowerCase().includes(rule.descriptionContains.toLowerCase())) return current;
    if (rule.minAmountCents != null && current.amountCents < rule.minAmountCents) return current;
    if (rule.maxAmountCents != null && current.amountCents > rule.maxAmountCents) return current;
    return { ...current, ...(rule.budgetId ? { budgetId: rule.budgetId, splits: null } : {}),
      ...(rule.note ? { description: rule.note } : {}) };
  }, transaction);
}
