export interface RateLimiter {
  isBlocked(keys: readonly string[], now: number): boolean;
  recordFailure(keys: readonly string[], now: number): void;
  reset(key: string): void;
}

// In-memory fixed-window limiter for failed logins. Resets on restart and is per-process.
export function createLoginLimiter(
  maxFailures = 5,
  windowMs = 15 * 60_000,
  maxEntries = 10_000,
): RateLimiter {
  const hits = new Map<string, { count: number; first: number }>();
  const removeExpired = (now: number) => {
    for (const [key, entry] of hits) {
      if (now - entry.first >= windowMs) hits.delete(key);
    }
  };
  return {
    isBlocked(keys, now) {
      removeExpired(now);
      return keys.some((key) => {
        const entry = hits.get(key);
        return entry ? entry.count >= maxFailures : hits.size >= maxEntries;
      });
    },
    recordFailure(keys, now) {
      removeExpired(now);
      for (const key of keys) {
        const entry = hits.get(key);
        if (entry) entry.count += 1;
        else if (hits.size < maxEntries) hits.set(key, { count: 1, first: now });
      }
    },
    reset: (key) => void hits.delete(key),
  };
}
