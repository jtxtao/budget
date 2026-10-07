/**
 * Sentinel budget id for expenses that have no category of their own — either
 * they were filed without one, or the category they belonged to was deleted.
 * Not a real budget record; nothing in `budgets` ever carries this id.
 *
 * It lives here rather than in BudgetsContext because AssignmentsContext needs
 * it too, and BudgetsContext already imports AssignmentsContext for its delete
 * cascade. A constant in its own module keeps that dependency running one way.
 * BudgetsContext re-exports it, so the original import path still works.
 */
export const UNCATEGORIZED_BUDGET_ID = "Uncategorized";

/**
 * Stands for "to be assigned" — the pool — on either side of a move between
 * envelopes. Not a budget id and never stored: an assignment *is* money leaving
 * the pool, so moving from it is assigning, and moving back to it is assigning
 * less. `moveBetweenBudgets` reads it and writes only the other side.
 */
export const TO_BE_ASSIGNED = "to-be-assigned";
