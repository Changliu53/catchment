/**
 * The only thing standing between a demo link and someone else's API bill.
 *
 * `checkRateLimit(key, now = Date.now())` takes the clock as an argument and
 * `resetRateLimit()` empties the map — two seams that exist for testing and,
 * until now, were not used by any test. A limiter nobody exercises is a
 * limiter nobody knows the behaviour of, which is an uncomfortable thing to
 * say about the component whose job is to bound a cost.
 *
 * The window is a rolling hour, not a fixed bucket, so these assert on the
 * property that distinguishes the two: an allowance comes back gradually as
 * individual requests age out, rather than all at once on the hour.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checkRateLimit, resetRateLimit } from '@/lib/rate-limit';

const HOUR = 60 * 60 * 1000;
const T0 = 1_700_000_000_000;

const original = process.env.RATE_LIMIT_PER_HOUR;

beforeEach(() => {
  resetRateLimit();
  process.env.RATE_LIMIT_PER_HOUR = '3';
});

afterEach(() => {
  resetRateLimit();
  if (original === undefined) delete process.env.RATE_LIMIT_PER_HOUR;
  else process.env.RATE_LIMIT_PER_HOUR = original;
});

describe('checkRateLimit', () => {
  it('allows up to the limit and counts down', () => {
    expect(checkRateLimit('a', T0)).toMatchObject({ allowed: true, limit: 3, remaining: 2 });
    expect(checkRateLimit('a', T0 + 1)).toMatchObject({ allowed: true, remaining: 1 });
    expect(checkRateLimit('a', T0 + 2)).toMatchObject({ allowed: true, remaining: 0 });
  });

  it('refuses the one after, and says how long to wait', () => {
    for (let i = 0; i < 3; i++) checkRateLimit('a', T0 + i);

    const verdict = checkRateLimit('a', T0 + 10);
    expect(verdict.allowed).toBe(false);
    expect(verdict.remaining).toBe(0);
    // The oldest request ages out an hour after it was made, so the wait is
    // measured from that one — not from now, and not from a fixed boundary.
    expect(verdict.retryAfterSeconds).toBe(Math.ceil((HOUR - 10) / 1000));
  });

  it('never reports a wait of zero while refusing', () => {
    for (let i = 0; i < 3; i++) checkRateLimit('a', T0);

    // A `Retry-After: 0` tells a client to try again immediately, which is
    // exactly what a refusal is meant to prevent.
    const verdict = checkRateLimit('a', T0 + HOUR - 1);
    expect(verdict.allowed).toBe(false);
    expect(verdict.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it('rolls: the allowance returns one request at a time', () => {
    checkRateLimit('a', T0);
    checkRateLimit('a', T0 + 10 * 60 * 1000);
    checkRateLimit('a', T0 + 20 * 60 * 1000);
    expect(checkRateLimit('a', T0 + 21 * 60 * 1000).allowed).toBe(false);

    // Just past an hour after the first request, exactly one slot is free —
    // a fixed-window limiter would have handed back all three.
    expect(checkRateLimit('a', T0 + HOUR + 1).allowed).toBe(true);
    expect(checkRateLimit('a', T0 + HOUR + 2).allowed).toBe(false);
  });

  it('keeps visitors apart', () => {
    for (let i = 0; i < 3; i++) checkRateLimit('a', T0 + i);

    expect(checkRateLimit('a', T0 + 5).allowed).toBe(false);
    expect(checkRateLimit('b', T0 + 5).allowed).toBe(true);
  });

  it('reads the configured limit each time rather than at import', () => {
    process.env.RATE_LIMIT_PER_HOUR = '1';
    expect(checkRateLimit('a', T0)).toMatchObject({ allowed: true, limit: 1 });
    expect(checkRateLimit('a', T0 + 1).allowed).toBe(false);

    // Raising it mid-process takes effect, which is what makes the setting
    // usable at all on a platform where the module outlives a deploy.
    process.env.RATE_LIMIT_PER_HOUR = '5';
    expect(checkRateLimit('a', T0 + 2)).toMatchObject({ allowed: true, limit: 5 });
  });
});
