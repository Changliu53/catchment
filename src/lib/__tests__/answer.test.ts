/**
 * The routing claim, tested.
 *
 * `answer.ts` says it resolves cheapest-first — preset, then cache, then the
 * model, and only the last one spends anything or touches the rate limiter.
 * That is the sentence the README leans on hardest and it had no test at all,
 * which meant a refactor could quietly start calling a model on the preset
 * path and everything would still look correct.
 *
 * So what is asserted here is mostly *absence*: that the model was not called,
 * that the limiter was not consumed. Those are the properties that cost money
 * when they break, and they are invisible in any output.
 *
 * The model is the only thing stubbed. Everything else is real — the real
 * validator, the real executor, over the real sampled dataset — so a plan that
 * would fail in production fails here too.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Must run before the imports below: `db.ts` decides where rows come from by
// reading this, and an ESM import is hoisted above ordinary statements.
vi.hoisted(() => {
  process.env['CATCHMENT_DATA'] = 'fixture';
  process.env['RATE_LIMIT_PER_HOUR'] = '3';
});

const planFromQuestion = vi.fn();

vi.mock('@/lib/orchestrate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orchestrate')>();
  return { ...actual, planFromQuestion };
});

const { answerFor, MAX_QUESTION_LENGTH } = await import('@/lib/answer');
const { planCache } = await import('@/lib/cache');
const { checkRateLimit, resetRateLimit } = await import('@/lib/rate-limit');
const { OrchestrationError } = await import('@/lib/orchestrate');

/** A plan the real validator accepts, so only the routing is under test. */
const GOOD_PLAN = {
  title: 'Most populous block groups',
  pipeline: [{ op: 'rank', measure: 'pop', dir: 'desc', n: 5 }],
  render: 'choropleth',
  color_by: 'pop',
};

beforeEach(() => {
  planFromQuestion.mockReset();
  resetRateLimit();
  (planCache as unknown as { clear(): void }).clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('presets', () => {
  it('answer from the shipped plan without calling a model', async () => {
    const result = await answerFor({
      presetId: 'flooded-grocery-deserts',
      clientKey: 'visitor',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).toBe('preset');
    expect(result.features.length).toBeGreaterThan(0);
    expect(planFromQuestion).not.toHaveBeenCalled();
  });

  it('cost the visitor nothing from their hourly allowance', async () => {
    for (let i = 0; i < 5; i++) {
      await answerFor({ presetId: 'densest', clientKey: 'visitor' });
    }

    // Five preset answers, and the limiter has still seen nothing: the full
    // allowance is intact for a question that actually needs a model.
    expect(checkRateLimit('visitor')).toMatchObject({ allowed: true, remaining: 2 });
  });

  it('report an id that does not exist rather than guessing', async () => {
    const result = await answerFor({ presetId: 'no-such-preset', clientKey: 'visitor' });
    expect(result).toEqual({ ok: false, kind: 'unknown-preset' });
  });
});

describe('the question itself', () => {
  it('is required', async () => {
    expect(await answerFor({ clientKey: 'v' })).toEqual({ ok: false, kind: 'no-question' });
    expect(await answerFor({ question: '   ', clientKey: 'v' })).toEqual({
      ok: false,
      kind: 'no-question',
    });
  });

  it('is rejected for length before the limiter or the model see it', async () => {
    const result = await answerFor({ question: 'x'.repeat(400), clientKey: 'v' });

    expect(result).toEqual({
      ok: false,
      kind: 'question-too-long',
      limit: MAX_QUESTION_LENGTH,
    });
    expect(planFromQuestion).not.toHaveBeenCalled();
    // An over-long question is the caller's mistake, not an attempt worth
    // charging them for.
    expect(checkRateLimit('v')).toMatchObject({ remaining: 2 });
  });
});

describe('the model tier', () => {
  it('is reached once, and the same question afterwards comes from the cache', async () => {
    planFromQuestion.mockResolvedValue(GOOD_PLAN);

    const first = await answerFor({
      question: 'which areas hold the most people?',
      clientKey: 'v',
    });
    expect(first.ok && first.source).toBe('model');

    // Different capitals, extra spaces, different trailing punctuation — the
    // same question as far as a person is concerned, and normalisation is what
    // makes the cache worth having.
    const second = await answerFor({
      question: '  Which areas hold the MOST people  ',
      clientKey: 'v',
    });

    expect(second.ok && second.source).toBe('cache');
    expect(planFromQuestion).toHaveBeenCalledTimes(1);
  });

  it('does not spend a second visitor’s allowance on a cached question', async () => {
    planFromQuestion.mockResolvedValue(GOOD_PLAN);
    await answerFor({ question: 'which areas hold the most people?', clientKey: 'first' });

    const result = await answerFor({
      question: 'which areas hold the most people?',
      clientKey: 'second',
    });

    expect(result.ok && result.source).toBe('cache');
    expect(checkRateLimit('second')).toMatchObject({ remaining: 2 });
  });

  it('refuses once the allowance is gone, and says when to come back', async () => {
    planFromQuestion.mockResolvedValue(GOOD_PLAN);

    // Distinct questions, so each one has to reach the model.
    for (let i = 0; i < 3; i++) {
      await answerFor({ question: `question number ${i}`, clientKey: 'v' });
    }

    const result = await answerFor({ question: 'one question too many', clientKey: 'v' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('rate-limited');
    if (result.kind !== 'rate-limited') return;
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
    // Said in the message, because a refusal that does not mention the free
    // path reads as "the site is broken".
    expect(result.detail).toMatch(/preset/i);
    expect(planFromQuestion).toHaveBeenCalledTimes(3);
  });

  it('a preset still works after the allowance is gone', async () => {
    planFromQuestion.mockResolvedValue(GOOD_PLAN);
    for (let i = 0; i < 4; i++) await answerFor({ question: `q ${i}`, clientKey: 'v' });

    const result = await answerFor({ presetId: 'densest', clientKey: 'v' });
    expect(result.ok && result.source).toBe('preset');
  });
});

describe('when the model fails', () => {
  it('passes on the hint it gave, and points at the free path', async () => {
    // The first argument is the hint: the sentence a reader is meant to see.
    planFromQuestion.mockRejectedValue(
      new OrchestrationError('The Anthropic API key was rejected.', new Error('401')),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await answerFor({ question: 'anything at all', clientKey: 'v' });

    expect(result.ok).toBe(false);
    if (result.ok || result.kind !== 'model-failed') return expect.fail('expected model-failed');
    expect(result.detail).toContain('The Anthropic API key was rejected.');
    expect(result.detail).toMatch(/preset/i);
  });

  it('does not leak an unexpected error’s text to the reader', async () => {
    planFromQuestion.mockRejectedValue(new Error('ECONNRESET 10.0.0.4:443'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await answerFor({ question: 'anything at all', clientKey: 'v' });

    expect(result.ok).toBe(false);
    if (result.ok || result.kind !== 'model-failed') return expect.fail('expected model-failed');
    // An internal address is not something a visitor can act on, and not
    // something a public page should print.
    expect(result.detail).not.toContain('10.0.0.4');
  });

  it('caches nothing it could not validate', async () => {
    planFromQuestion.mockResolvedValue({ title: 'nonsense', pipeline: [{ op: 'teleport' }] });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const first = await answerFor({ question: 'a question with no valid plan', clientKey: 'v' });
    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.kind).toBe('unsupported');

    // Asking again must reach the model again: caching a rejected plan would
    // make one bad response permanent for that wording.
    await answerFor({ question: 'a question with no valid plan', clientKey: 'v' });
    expect(planFromQuestion).toHaveBeenCalledTimes(2);
  });

  it('relays a decline as the model’s own reason', async () => {
    // `decline` is its own tool, and its payload is a first-class shape the
    // validator recognises rather than a plan that failed.
    planFromQuestion.mockResolvedValue({
      unsupported: true,
      reason: 'This dataset has no travel-time information.',
      suggestion: 'Ask about straight-line distance instead.',
    });

    const result = await answerFor({ question: 'how long is the drive?', clientKey: 'v' });

    expect(result.ok).toBe(false);
    if (result.ok || result.kind !== 'unsupported') return expect.fail('expected unsupported');
    // Declining is a first-class answer, so the reader gets the model's words
    // rather than a generic failure.
    expect(result.reason).toMatch(/travel-time/);
    expect(result.suggestion).toMatch(/straight-line/);
  });
});
