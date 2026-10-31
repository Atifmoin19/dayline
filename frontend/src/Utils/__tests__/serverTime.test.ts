import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalizeServerTimestamp, parseServerDate } from "Utils/serverTime";

// Run under a non-UTC browser timezone so a naive timestamp parsed as local time would be
// visibly wrong (America/New_York is UTC-4/-5, Asia/Kolkata is UTC+5:30).
const ORIGINAL_TZ = process.env.TZ;
beforeAll(() => {
    process.env.TZ = "America/New_York";
});
afterAll(() => {
    process.env.TZ = ORIGINAL_TZ;
});

const UTC_INSTANT = Date.UTC(2026, 2, 11, 5, 0, 0); // 2026-03-11T05:00:00Z

describe("parseServerDate", () => {
    it("runs under a non-UTC timezone", () => {
        expect(new Date(UTC_INSTANT).getTimezoneOffset()).not.toBe(0);
    });

    it("treats a naive server timestamp as UTC", () => {
        expect(parseServerDate("2026-03-11T05:00:00")!.getTime()).toBe(UTC_INSTANT);
        expect(parseServerDate("2026-03-11T05:00:00.000000")!.getTime()).toBe(UTC_INSTANT);
        expect(parseServerDate("2026-03-11 05:00:00")!.getTime()).toBe(UTC_INSTANT);
    });

    it("keeps an explicit Z or positive offset", () => {
        expect(parseServerDate("2026-03-11T05:00:00Z")!.getTime()).toBe(UTC_INSTANT);
        expect(parseServerDate("2026-03-11T05:00:00z")!.getTime()).toBe(UTC_INSTANT);
        expect(parseServerDate("2026-03-11T10:30:00+05:30")!.getTime()).toBe(UTC_INSTANT);
        expect(parseServerDate("2026-03-11T10:30:00+0530")!.getTime()).toBe(UTC_INSTANT);
    });

    it("keeps a negative offset instead of appending Z (old bug: produced Invalid Date)", () => {
        expect(parseServerDate("2026-03-11T00:00:00-05:00")!.getTime()).toBe(UTC_INSTANT);
        expect(normalizeServerTimestamp("2026-03-11T00:00:00-05:00")).toBe("2026-03-11T00:00:00-05:00");
    });

    it("treats a date-only value as UTC midnight", () => {
        expect(parseServerDate("2026-03-11")!.getTime()).toBe(Date.UTC(2026, 2, 11));
    });

    it("returns null for empty or unparseable input", () => {
        expect(parseServerDate("")).toBeNull();
        expect(parseServerDate(null)).toBeNull();
        expect(parseServerDate(undefined)).toBeNull();
        expect(parseServerDate("not a date")).toBeNull();
    });
});
