/**
 * What the model is actually sent.
 *
 * The prompt and the tool schema are generated from `schema.ts` so they cannot
 * drift from what the executor supports. That is the design; this is the check
 * that the generation still reaches every field, because a generated artefact
 * that quietly stops including something looks exactly like one that never had
 * it.
 *
 * The failure this guards is specific and silent: the prompt advertises a
 * field, the model uses it, the tool schema rejects it, and the visitor gets a
 * model failure for a question the system can answer. Nothing type-checks the
 * gap, because a prompt is a string.
 */

import { describe, expect, it } from 'vitest';

import { ANALYSE_TOOL, DECLINE_TOOL, systemPrompt } from '@/lib/orchestrate';
import { COMPARISON_OPS, FIELD_NAMES, MAX_PIPELINE_STEPS, PRIMITIVE_OPS } from '@/lib/schema';

const prompt = systemPrompt();

describe('the prompt', () => {
  it('names every field the executor understands, with its unit and range', () => {
    for (const field of FIELD_NAMES) {
      expect(prompt).toContain(field);
      // Not just the name: a field listed without its unit is a field the
      // model will guess the unit of, and `max_distance_m` in kilometres is a
      // plan that validates and means something else.
      const line = prompt.split('\n').find((l) => l.startsWith(`- ${field} (`));
      expect(line, `no dictionary line for ${field}`).toBeDefined();
      expect(line).toMatch(/range .+–.+\):/);
    }
  });

  it('names every operation, with its parameters', () => {
    for (const op of PRIMITIVE_OPS) {
      const line = prompt.split('\n').find((l) => l.startsWith(`- ${op}(`));
      expect(line, `no catalog line for ${op}`).toBeDefined();
      expect(line).toContain('—');
    }
  });

  it('advertises no field the executor does not have', () => {
    // The other direction, and the one that actually bit. Anything matching a
    // field-shaped token in the dictionary block must be a real field.
    const block = prompt.split('FIELDS')[1]!.split('OPERATIONS')[0]!;
    const named = [...block.matchAll(/^- ([a-z0-9_]+) \(/gm)].map((m) => m[1]!);
    expect(named.sort()).toEqual([...FIELD_NAMES].sort());
  });

  it('states the step ceiling the validator enforces', () => {
    // Two numbers that must agree, one of them inside prose.
    expect(prompt).toContain(`At most ${MAX_PIPELINE_STEPS}`);
  });

  it('tells the model that declining is a correct answer', () => {
    // Removed, the model approximates: a question about travel time becomes a
    // straight-line distance plan, presented as the answer. That is the one
    // failure mode here that produces a confident wrong result rather than an
    // error.
    expect(prompt).toMatch(/honest refusal is the correct output/i);
    expect(prompt).toMatch(/return the\s+unsupported form/i);
    // And it names the specific approximation that is tempting here: this
    // dataset has straight-line distance, so a travel-time question has an
    // answer-shaped wrong answer sitting right next to it.
    expect(prompt).toMatch(/travel or commute time cannot\s+be answered/i);
  });

  it('says which floodplain flood_exposure means', () => {
    // Found by the evaluation, not by reading. The catalogue said "in a
    // floodplain" and the op is hard-wired to flood_pct, so a question about
    // the 500-year zone got a 100-year answer — which validates, draws, and
    // understates exposure, the one error this dataset is most likely to be
    // quoted for. A rule elsewhere in the prompt already distinguished the two
    // fields; it did not help, because the ambiguity was in the op catalogue.
    const line = prompt.split('\n').find((l) => l.startsWith('- flood_exposure('))!;
    expect(line).toContain('flood_pct');
    expect(line).toContain('flood_pct_500');
  });

  it('shows a declined example, not only successes', () => {
    // A model shown only successes learns that an answer is always required.
    const answers = [...prompt.matchAll(/^A: (\{.*\})$/gm)].map((m) => JSON.parse(m[1]!));
    expect(answers.length).toBeGreaterThan(1);
    expect(answers.some((a) => 'reason' in a && 'suggestion' in a)).toBe(true);
    expect(answers.some((a) => 'pipeline' in a)).toBe(true);
  });
});

describe('the tool schema', () => {
  const step = ANALYSE_TOOL.input_schema.properties.pipeline.items;

  it('bounds the vocabulary to exactly what the executor accepts', () => {
    expect([...step.properties.op.enum].sort()).toEqual([...PRIMITIVE_OPS].sort());
    expect([...step.properties.comparison.enum].sort()).toEqual([...COMPARISON_OPS].sort());
  });

  it('constrains every field-valued parameter to the dictionary', () => {
    // `field`, `measure`, `color_by` and `split_on` all take a field name. One
    // of them left as a free string is an enum that does not constrain.
    const enums = [
      step.properties.field.enum,
      step.properties.measure.enum,
      step.properties.split_on.enum,
      ANALYSE_TOOL.input_schema.properties.color_by.enum,
    ];
    for (const e of enums) expect([...e].sort()).toEqual([...FIELD_NAMES].sort());
  });

  it('caps the pipeline at the same ceiling as the prompt and the validator', () => {
    expect(ANALYSE_TOOL.input_schema.properties.pipeline.maxItems).toBe(MAX_PIPELINE_STEPS);
  });

  it('gives declining its own tool rather than a variant to be noticed', () => {
    // A union inside one tool makes refusing a branch the model has to choose
    // against; a separate tool makes it a thing it can simply call.
    expect(DECLINE_TOOL.name).not.toBe(ANALYSE_TOOL.name);
    expect(DECLINE_TOOL.input_schema.required).toEqual(['reason', 'suggestion']);
  });

  it('accepts no property the executor would ignore', () => {
    // additionalProperties is what makes the enums meaningful: without it a
    // model can attach anything to a step and the schema will take it.
    expect(step.additionalProperties).toBe(false);
  });
});
