import { Employee } from "types";

/**
 * Organization-tree scoping — the single source of truth for "who may this user see".
 * Mirrors the backend `permissions.get_user_view_scope`: a user sees themselves plus every
 * direct AND indirect report (the whole subtree). PURE TREE — not rank-gated, because real
 * job titles don't encode management level (a "Software Engineer" or "Tech Lead" can have
 * reports). Nobody sees peers or seniors. Built from the `manager_id` edges in the directory.
 */

type NodeLike = { emp_id: string; manager_id?: string };

/** manager_id → [child emp_id, …] adjacency built once per call. */
const buildChildren = (users: NodeLike[]): Map<string, string[]> => {
  const children = new Map<string, string[]>();
  for (const u of users) {
    if (!u.manager_id) continue;
    const arr = children.get(u.manager_id);
    if (arr) arr.push(u.emp_id);
    else children.set(u.manager_id, [u.emp_id]);
  }
  return children;
};

/** All recursive descendants of `rootId` (NOT including root). Cycle-safe. */
export const getDescendants = (users: NodeLike[], rootId: string): Set<string> => {
  const children = buildChildren(users);
  const out = new Set<string>();
  const stack = [...(children.get(rootId) || [])];
  while (stack.length) {
    const id = stack.pop() as string;
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...(children.get(id) || []));
  }
  return out;
};

/**
 * emp_ids this user may see: self + entire subtree (all direct + indirect reports).
 * Pure tree — anyone with reports sees them, regardless of designation. A pure IC (no
 * reports) sees only themselves. Mirrors the backend `get_user_view_scope`.
 */
export const getViewScope = (users: NodeLike[], user?: Employee | null): Set<string> => {
  if (!user) return new Set();
  const scope = new Set<string>([user.emp_id]);
  for (const id of getDescendants(users, user.emp_id)) scope.add(id);
  return scope;
};

/**
 * Managers inside this user's scope that can be drilled into — i.e. anyone in scope who has
 * at least one report. Used to populate the "filter by manager" dropdown (no seniors, no peers).
 */
export const getManagerOptions = (users: Employee[], user?: Employee | null): Employee[] => {
  const scope = getViewScope(users, user);
  return users.filter(
    (u) => scope.has(u.emp_id) && getDescendants(users, u.emp_id).size > 0,
  );
};

/**
 * The emp_ids to display given an optional manager filter. Always a subset of the user's own
 * scope: selecting a manager narrows to that manager + their subtree (intersected with scope);
 * an out-of-scope / empty filter falls back to the full scope.
 */
export const getVisibleScope = (
  users: NodeLike[],
  user?: Employee | null,
  filteredManagerId?: string,
): Set<string> => {
  const scope = getViewScope(users, user);
  if (filteredManagerId && scope.has(filteredManagerId)) {
    const sub = new Set<string>([filteredManagerId, ...getDescendants(users, filteredManagerId)]);
    return new Set([...scope].filter((id) => sub.has(id)));
  }
  return scope;
};
