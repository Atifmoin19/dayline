/**
 * Server timestamps are UTC. Postgres returns them with an offset, but SQLite (and some
 * older rows) come back naive, e.g. "2026-03-11T05:00:00.123456". `new Date()` would read a
 * naive value as the browser's LOCAL time, so normalize it to explicit UTC first, while
 * leaving any value that already carries a zone (Z, +05:30, -0500) untouched.
 */
const HAS_ZONE = /(?:z|[+-]\d{2}(?::?\d{2})?)$/i;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export const normalizeServerTimestamp = (t: string): string => {
    if (!t) return t;
    const s = t.trim().replace(" ", "T");
    if (DATE_ONLY.test(s)) return `${s}T00:00:00Z`;
    if (!s.includes("T")) return s; // not an ISO timestamp; let Date decide (and fail)
    return HAS_ZONE.test(s.slice(s.indexOf("T"))) ? s : `${s}Z`;
};

/** Parse a server timestamp as an instant; null when empty or unparseable. */
export const parseServerDate = (t: string | null | undefined): Date | null => {
    if (!t) return null;
    const d = new Date(normalizeServerTimestamp(t));
    return Number.isNaN(d.getTime()) ? null : d;
};
