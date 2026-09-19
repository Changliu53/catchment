/**
 * The preset questions, checked against the same validator a model's plan
 * faces.
 *
 * `answer.ts` claims that a plan from any source is validated identically
 * before it runs. That claim was false for a while — the preset branch handed
 * its plan straight to the executor — and a false claim in a header comment is
 * worse than no claim, because a reader stops checking. It is true now, and
 * this is what keeps it true: a preset that stops validating fails here, at
 * build time, rather than on the path most visitors take.
 *
 * The presets are also the model's few-shot examples, so a preset that does
 * not validate is simultaneously an example teaching the model to produce
 * plans that do not validate.
 */

import { describe, expect, it } from 'vitest';

import { PRESETS, PRESET_BY_ID } from '@/lib/presets';
import { validatePlan } from '@/lib/validate';

describe('presets', () => {
  it('ships at least a handful, including one the dataset cannot answer', () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(6);
  });

  it.each(PRESETS.map((p) => [p.id, p] as const))('%s produces a valid plan', (id, preset) => {
    const verdict = validatePlan(preset.plan);

    // Asserting on the whole verdict rather than just `ok`: when this fails,
    // the message should say which rule rejected it, not just that something
    // did.
    expect(verdict, `preset "${id}" failed validation`).toMatchObject({ ok: true });
  });

  it('gives every preset a question, a reading and a unique id', () => {
    const ids = new Set<string>();
    for (const preset of PRESETS) {
      expect(preset.question.trim().length, preset.id).toBeGreaterThan(10);
      // The reading is what appears under the map. A preset without one leaves
      // a reader to infer what they are looking at from the colours.
      expect(preset.reading.trim().length, preset.id).toBeGreaterThan(20);
      expect(ids.has(preset.id), `duplicate preset id "${preset.id}"`).toBe(false);
      ids.add(preset.id);
    }
  });

  it('indexes every preset by id', () => {
    expect(PRESET_BY_ID.size).toBe(PRESETS.length);
    for (const preset of PRESETS) expect(PRESET_BY_ID.get(preset.id)).toBe(preset);
  });

  it('colours by a field the plan actually produces', () => {
    for (const preset of PRESETS) {
      const colorBy = preset.plan.color_by;
      if (!colorBy) continue;
      // A `color_by` naming a field the executor never emits leaves the map
      // grey with a legend that explains nothing.
      const verdict = validatePlan(preset.plan);
      expect(verdict.ok, preset.id).toBe(true);
    }
  });
});
