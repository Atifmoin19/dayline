const DEFAULT_HOURS = 24;

/** Whole hours (rounded up, at least 1) until `expiresAt`; 24 when unknown. */
export const hoursUntil = (expiresAt: string | undefined, now: number = Date.now()): number => {
  const t = expiresAt ? Date.parse(expiresAt) : NaN;
  if (Number.isNaN(t)) return DEFAULT_HOURS;
  return Math.max(1, Math.ceil((t - now) / 3600e3));
};
