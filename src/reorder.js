/**
 * Put some of a list's records in a new order, leaving every other record where
 * it was.
 *
 * A drag only ever sees part of a list — the dashboard shows the accounts the
 * budget spends through, the plan shows one scope at a time, the ledger leaves
 * out a category with nothing in it — so a reorder names the records it saw, in
 * their new order, and those records take turns filling the places they already
 * held between them. A record the drag never saw keeps its exact index, and an
 * id the list does not hold is ignored. **No reorder can add or drop a record**,
 * `setCategoryLayout`'s rule.
 *
 * Returns the list itself when nothing moved, so a drop back where it started
 * is not a write.
 */
export function reorderSubset(list, orderedIds, idOf = (item) => item.id) {
  if (!Array.isArray(list) || !Array.isArray(orderedIds)) return list;
  const byId = new Map(list.map((item) => [idOf(item), item]));
  const seen = new Set();
  const moving = [];
  for (const id of orderedIds) {
    if (!byId.has(id) || seen.has(id)) continue;
    seen.add(id);
    moving.push(byId.get(id));
  }

  let next = 0;
  let changed = false;
  const result = list.map((item) => {
    if (!seen.has(idOf(item))) return item;
    const placed = moving[next++];
    if (placed !== item) changed = true;
    return placed;
  });
  return changed ? result : list;
}
