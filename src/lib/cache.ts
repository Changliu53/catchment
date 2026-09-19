/**
 * Question -> plan cache.
 *
 * Two visitors asking the same thing in different words still cost two model
 * calls; that is accepted. The cheap win is the same question repeated, which
 * in a demo is most of the traffic: people retype, refresh, and share links.
 */

import type { Plan } from './validate';

const MAX_ENTRIES = 500;

/** Lowercase, collapse whitespace, drop trailing punctuation. */
export function normaliseQuestion(q: string): string {
  return q
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[?.!,;:]+$/, '')
    .trim();
}

class LruCache<V> {
  private store = new Map<string, V>();

  get(key: string): V | undefined {
    const value = this.store.get(key);
    if (value === undefined) return undefined;
    // Re-insert so recently used keys survive eviction.
    this.store.delete(key);
    this.store.set(key, value);
    return value;
  }

  set(key: string, value: V): void {
    if (this.store.has(key)) this.store.delete(key);
    this.store.set(key, value);
    while (this.store.size > MAX_ENTRIES) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }

  get size(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }
}

export const planCache = new LruCache<Plan>();
