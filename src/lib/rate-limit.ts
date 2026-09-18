/**
 * Per-visitor rate limiting, in memory.
 *
 * Deliberately not Redis. On serverless this is per-instance, so the real
 * ceiling is looser than the configured number — but it sits behind a hard
 * spend limit on the Anthropic account, which is the control that actually
 * bounds the loss. Adding a Redis dependency to a portfolio demo would buy
 * precision that nothing here needs.
 *
 * Saying that out loud is the point: the trade-off is chosen, not overlooked.
 */

const WINDOW_MS = 60 * 60 * 1000;
const DEFAULT_LIMIT = 10;

const hits = new Map<string, number[]>();

export interface RateLimitVerdict {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

export function checkRateLimit(key: string, now = Date.now()): RateLimitVerdict {
  const limit = Number(process.env.RATE_LIMIT_PER_HOUR ?? DEFAULT_LIMIT);
  const cutoff = now - WINDOW_MS;

  const recent = (hits.get(key) ?? []).filter((t) => t > cutoff);

  if (recent.length >= limit) {
    const oldest = recent[0] ?? now;
    return {
      allowed: false,
      limit,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000)),
    };
  }

  recent.push(now);
  hits.set(key, recent);

  // Bound memory: without this the map grows once per unique visitor forever.
  if (hits.size > 10_000) {
    for (const [k, v] of hits) {
      if (v.every((t) => t <= cutoff)) hits.delete(k);
    }
  }

  return { allowed: true, limit, remaining: limit - recent.length, retryAfterSeconds: 0 };
}

/** Test seam. */
export function resetRateLimit() {
  hits.clear();
}
