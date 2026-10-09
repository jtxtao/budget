import { reorderSubset } from "./reorder";

const list = ["a", "b", "c", "d", "e"].map((id) => ({ id }));
const ids = (records) => records.map((record) => record.id);

describe("reorderSubset", () => {
  it("reorders a whole list", () => {
    expect(ids(reorderSubset(list, ["e", "d", "c", "b", "a"]))).toEqual(["e", "d", "c", "b", "a"]);
  });

  it("moves only the records named, inside the places they already held", () => {
    // A view showing b, d and e (c and a filtered out) drags e to the top.
    expect(ids(reorderSubset(list, ["e", "b", "d"]))).toEqual(["a", "e", "c", "b", "d"]);
  });

  it("can neither add nor drop a record", () => {
    const next = reorderSubset(list, ["c", "zzz", "c", "a"]);
    expect(ids(next)).toEqual(["c", "b", "a", "d", "e"]);
    expect(next).toHaveLength(list.length);
  });

  it("hands back the same list when nothing moved, so a drop in place is not a write", () => {
    expect(reorderSubset(list, ["b", "d"])).toBe(list);
    expect(reorderSubset(list, [])).toBe(list);
  });
});
