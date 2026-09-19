/**
 * The cache is the middle tier: it decides how often a question reaches a
 * model at all.
 *
 * Two behaviours matter and neither is obvious from the type. First, what
 * counts as "the same question" — normalisation is the entire hit rate, since
 * two people never type identical strings. Second, that the LRU evicts the
 * least *recently used* entry rather than the oldest inserted; get the second
 * wrong and a popular question gets thrown out by a run of one-off ones.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { normaliseQuestion, planCache } from '@/lib/cache';
import type { Plan } from '@/lib/validate';

const plan = (title: string): Plan =>
  ({
    title,
    pipeline: [{ op: 'rank', measure: 'pop', dir: 'desc', n: 10 }],
    render: 'choropleth',
    color_by: 'pop',
  }) as Plan;

beforeEach(() => {
  // The cache is a module singleton, which is the point of it; tests that
  // share one would pass or fail depending on their order.
  (planCache as unknown as { clear(): void }).clear();
});

describe('normaliseQuestion', () => {
  it('ignores case and surrounding space', () => {
    expect(normaliseQuestion('  Where Is Flooding Worst  ')).toBe('where is flooding worst');
  });

  it('collapses runs of whitespace, including newlines', () => {
    expect(normaliseQuestion('where   is\n\tflooding worst')).toBe('where is flooding worst');
  });

  it('drops trailing punctuation, which is where people differ most', () => {
    const forms = [
      'where is flooding worst?',
      'Where is flooding worst.',
      'where is flooding worst!!',
    ];
    for (const form of forms) expect(normaliseQuestion(form)).toBe('where is flooding worst');
  });

  it('leaves punctuation that is part of the question alone', () => {
    // Only *trailing* punctuation is noise. A question mark in the middle is
    // two questions, and "$250,001" is a number.
    expect(normaliseQuestion('income over $250,001 — where?')).toBe('income over $250,001 — where');
  });
});

describe('planCache', () => {
  it('returns what was stored', () => {
    planCache.set('a', plan('A'));
    expect(planCache.get('a')?.title).toBe('A');
    expect(planCache.get('missing')).toBeUndefined();
  });

  it('overwrites rather than duplicating', () => {
    planCache.set('a', plan('first'));
    planCache.set('a', plan('second'));

    expect(planCache.get('a')?.title).toBe('second');
    expect(planCache.size).toBe(1);
  });

  it('evicts the least recently used, not the least recently written', () => {
    for (let i = 0; i < 500; i++) planCache.set(`q${i}`, plan(`p${i}`));
    expect(planCache.size).toBe(500);

    // q0 is the oldest insertion. Reading it makes it the newest use, so the
    // next eviction should take q1 instead — this is the whole difference
    // between an LRU and a queue.
    expect(planCache.get('q0')?.title).toBe('p0');

    planCache.set('q500', plan('p500'));

    expect(planCache.size).toBe(500);
    expect(planCache.get('q0')?.title).toBe('p0');
    expect(planCache.get('q1')).toBeUndefined();
  });

  it('never grows past its bound, however many questions arrive', () => {
    for (let i = 0; i < 2_000; i++) planCache.set(`q${i}`, plan(`p${i}`));

    // The instance is long-lived on a warm serverless container; unbounded
    // growth here is a memory leak with a very slow fuse.
    expect(planCache.size).toBe(500);
  });
});
