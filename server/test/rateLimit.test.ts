import { describe, expect, it } from 'vitest';
import { createLoginLimiter } from '../src/auth/rateLimit.js';

describe('login rate limiter storage', () => {
  it('expires stale keys when a different key is checked and stays within its capacity', () => {
    const limiter = createLoginLimiter(2, 100, 1);
    limiter.recordFailure(['old'], 0);

    expect(limiter.isBlocked(['new'], 99)).toBe(true);
    expect(limiter.isBlocked(['new'], 100)).toBe(false);

    limiter.recordFailure(['new'], 100);
    expect(limiter.isBlocked(['new'], 100)).toBe(false);
    expect(limiter.isBlocked(['other'], 100)).toBe(true);
    limiter.recordFailure(['new'], 100);
    expect(limiter.isBlocked(['new'], 100)).toBe(true);
    expect(limiter.isBlocked(['old'], 200)).toBe(false);
  });
});
