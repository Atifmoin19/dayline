import { describe, it, expect } from "vitest";
import {
  getDescendants,
  getViewScope,
  getManagerOptions,
  getVisibleScope,
} from "Utils/orgTree";
import { Employee } from "types";

/**
 * Fixture org tree:
 *
 *            ceo
 *          /      \
 *       mgrA       mgrB (peer of mgrA)
 *      /    \          \
 *   leadC   icE        icF
 *    |
 *   icD
 *
 * mgrA's subtree = {leadC, icD, icE}. mgrB/icF are peers/out-of-scope for mgrA.
 */
const mkEmployee = (emp_id: string, manager_id?: string): Employee => ({
  emp_id,
  emp_name: emp_id,
  emp_email: `${emp_id}@example.com`,
  emp_designation: "Software Engineer",
  manager_id,
});

const ceo = mkEmployee("ceo");
const mgrA = mkEmployee("mgrA", "ceo");
const mgrB = mkEmployee("mgrB", "ceo");
const leadC = mkEmployee("leadC", "mgrA");
const icD = mkEmployee("icD", "leadC");
const icE = mkEmployee("icE", "mgrA");
const icF = mkEmployee("icF", "mgrB");

const allUsers: Employee[] = [ceo, mgrA, mgrB, leadC, icD, icE, icF];

describe("getDescendants", () => {
  it("returns the full multi-depth subtree, not just direct reports", () => {
    const desc = getDescendants(allUsers, "mgrA");
    expect(desc).toEqual(new Set(["leadC", "icD", "icE"]));
  });

  it("does not include the root itself", () => {
    const desc = getDescendants(allUsers, "mgrA");
    expect(desc.has("mgrA")).toBe(false);
  });

  it("does not include peers or their subtrees", () => {
    const desc = getDescendants(allUsers, "mgrA");
    expect(desc.has("mgrB")).toBe(false);
    expect(desc.has("icF")).toBe(false);
  });

  it("returns an empty set for a leaf node with no reports", () => {
    expect(getDescendants(allUsers, "icD")).toEqual(new Set());
  });

  it("is cycle-safe (does not infinite-loop on a manager cycle)", () => {
    const cyclic: Employee[] = [mkEmployee("a", "b"), mkEmployee("b", "a")];
    const desc = getDescendants(cyclic, "a");
    // "a" is its own indirect report in this corrupt fixture; must terminate, not hang.
    expect(desc).toEqual(new Set(["b", "a"]));
  });
});

describe("getViewScope", () => {
  it("is self + entire subtree for a manager", () => {
    const scope = getViewScope(allUsers, mgrA);
    expect(scope).toEqual(new Set(["mgrA", "leadC", "icD", "icE"]));
  });

  it("excludes peers and their subtrees", () => {
    const scope = getViewScope(allUsers, mgrA);
    expect(scope.has("mgrB")).toBe(false);
    expect(scope.has("icF")).toBe(false);
  });

  it("excludes seniors (the CEO is not visible to a manager)", () => {
    const scope = getViewScope(allUsers, mgrA);
    expect(scope.has("ceo")).toBe(false);
  });

  it("is just the user themselves for a pure IC with no reports", () => {
    const scope = getViewScope(allUsers, icD);
    expect(scope).toEqual(new Set(["icD"]));
  });

  it("is scoped correctly deeper in the tree (leadC sees icD but not their own manager or siblings)", () => {
    const scope = getViewScope(allUsers, leadC);
    expect(scope).toEqual(new Set(["leadC", "icD"]));
    expect(scope.has("mgrA")).toBe(false);
    expect(scope.has("icE")).toBe(false);
  });

  it("returns an empty scope when there is no user", () => {
    expect(getViewScope(allUsers, null)).toEqual(new Set());
    expect(getViewScope(allUsers, undefined)).toEqual(new Set());
  });
});

describe("getManagerOptions", () => {
  it("includes only in-scope people who themselves have at least one report", () => {
    const options = getManagerOptions(allUsers, mgrA);
    const ids = options.map((o) => o.emp_id).sort();
    // mgrA (has leadC, icE, icD) and leadC (has icD) qualify; icE (no reports) does not.
    expect(ids).toEqual(["leadC", "mgrA"]);
  });

  it("never includes an out-of-scope manager even if they have reports", () => {
    const options = getManagerOptions(allUsers, mgrA);
    expect(options.map((o) => o.emp_id)).not.toContain("mgrB");
  });
});

describe("getVisibleScope", () => {
  it("falls back to the full scope with no filter", () => {
    expect(getVisibleScope(allUsers, mgrA)).toEqual(getViewScope(allUsers, mgrA));
  });

  it("narrows to the filtered manager + their subtree when the filter is in scope", () => {
    const visible = getVisibleScope(allUsers, mgrA, "leadC");
    expect(visible).toEqual(new Set(["leadC", "icD"]));
  });

  it("falls back to the full scope when the filter is out of scope (e.g. a peer)", () => {
    const visible = getVisibleScope(allUsers, mgrA, "mgrB");
    expect(visible).toEqual(getViewScope(allUsers, mgrA));
  });

  it("falls back to the full scope when the filter is an unknown emp_id", () => {
    const visible = getVisibleScope(allUsers, mgrA, "does-not-exist");
    expect(visible).toEqual(getViewScope(allUsers, mgrA));
  });
});
