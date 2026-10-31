import { describe, it, expect } from "vitest";
import {
  ROLE_RANK,
  DESIGNATIONS,
  rankOf,
  SUPER_ADMIN_ROLES,
  ADMIN_ROLES,
} from "Utils/constants";

describe("rankOf", () => {
  it("returns the configured rank for a known designation", () => {
    expect(rankOf("Chief Technology Officer")).toBe(5);
    expect(rankOf("Software Engineer")).toBe(1);
  });

  it("returns 0 for an unknown/new designation not yet in ROLE_RANK", () => {
    expect(rankOf("Some Brand New Title Nobody Configured")).toBe(0);
  });

  it("returns 0 for undefined", () => {
    expect(rankOf(undefined)).toBe(0);
  });
});

describe("DESIGNATIONS", () => {
  it("contains exactly the ROLE_RANK keys", () => {
    expect(new Set(DESIGNATIONS)).toEqual(new Set(Object.keys(ROLE_RANK)));
  });

  it("is sorted most-senior (highest rank) first", () => {
    for (let i = 1; i < DESIGNATIONS.length; i++) {
      const prevRank = ROLE_RANK[DESIGNATIONS[i - 1]];
      const curRank = ROLE_RANK[DESIGNATIONS[i]];
      expect(prevRank).toBeGreaterThanOrEqual(curRank);
    }
  });
});

describe("SUPER_ADMIN_ROLES / ADMIN_ROLES derivation from ROLE_RANK", () => {
  it("SUPER_ADMIN_ROLES contains only rank >= 4 designations", () => {
    SUPER_ADMIN_ROLES.forEach((role) => {
      expect(ROLE_RANK[role]).toBeGreaterThanOrEqual(4);
    });
  });

  it("ADMIN_ROLES contains only rank === 3 designations", () => {
    ADMIN_ROLES.forEach((role) => {
      expect(ROLE_RANK[role]).toBe(3);
    });
  });

  it("every rank>=4 role in ROLE_RANK is present in SUPER_ADMIN_ROLES (no manual drift)", () => {
    const expected = Object.keys(ROLE_RANK).filter((k) => ROLE_RANK[k] >= 4);
    expect(new Set(SUPER_ADMIN_ROLES)).toEqual(new Set(expected));
  });

  it("every rank===3 role in ROLE_RANK is present in ADMIN_ROLES (no manual drift)", () => {
    const expected = Object.keys(ROLE_RANK).filter((k) => ROLE_RANK[k] === 3);
    expect(new Set(ADMIN_ROLES)).toEqual(new Set(expected));
  });

  it("ADMIN_ROLES and SUPER_ADMIN_ROLES are mutually exclusive", () => {
    const overlap = ADMIN_ROLES.filter((r) => SUPER_ADMIN_ROLES.includes(r));
    expect(overlap).toEqual([]);
  });

  it("a brand-new/unlisted designation is excluded from both admin buckets automatically", () => {
    // This is the whole point of deriving the lists from ROLE_RANK (see plan.md): a title
    // that hasn't been added to ROLE_RANK yet must NOT silently become an admin/super-admin.
    const newTitle = "Director of Something New";
    expect(ROLE_RANK[newTitle]).toBeUndefined();
    expect(SUPER_ADMIN_ROLES).not.toContain(newTitle);
    expect(ADMIN_ROLES).not.toContain(newTitle);
    expect(rankOf(newTitle)).toBe(0);
  });

  it("rank 1 and rank 2 designations (ICs) are excluded from both admin buckets", () => {
    const ics = Object.keys(ROLE_RANK).filter((k) => ROLE_RANK[k] <= 2);
    expect(ics.length).toBeGreaterThan(0);
    ics.forEach((role) => {
      expect(SUPER_ADMIN_ROLES).not.toContain(role);
      expect(ADMIN_ROLES).not.toContain(role);
    });
  });
});
