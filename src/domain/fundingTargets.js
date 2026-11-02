export function suggestedFunding(row, target, period) {
  if (!target) return row.plannedCents;
  const carried = row.availableCents - row.assignedCents;
  if (target.targetMode === "refill") return Math.max(0, row.plannedCents - carried);
  if (target.targetMode === "deadline" && target.goalCents > 0 && target.targetDate) {
    const [year, month] = period.split("-").map(Number);
    const [dueYear, dueMonth] = target.targetDate.split("-").map(Number);
    const months = Math.max(1, (dueYear - year) * 12 + dueMonth - month + 1);
    return Math.max(0, Math.ceil((target.goalCents - carried) / months));
  }
  return row.plannedCents;
}
