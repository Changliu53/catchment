/**
 * Layers 1 and 2 of output validation: structural (Zod) and semantic.
 *
 * The model's output is never trusted. Layer 1 proves the JSON has the right
 * shape; layer 2 proves the values make sense together. Layer 3 (result
 * plausibility) lives in the executor, because it needs the data.
 */

import { z } from 'zod';
import {
  COMPARISON_OPS,
  DENOMINATORS,
  FIELDS,
  FIELD_NAMES,
  MAX_PIPELINE_STEPS,
  POI_TYPES,
  type FieldName,
} from './schema';

const fieldName = z.enum(FIELD_NAMES as [FieldName, ...FieldName[]]);

const filterStep = z.object({
  op: z.literal('filter'),
  field: fieldName,
  comparison: z.enum(COMPARISON_OPS),
  value: z.number().finite(),
});

const floodExposureStep = z.object({
  op: z.literal('flood_exposure'),
  min_pct: z.number().min(0).max(1),
});

const resourceGapStep = z.object({
  op: z.literal('resource_gap'),
  poi_type: z.enum(POI_TYPES),
  max_distance_m: z.number().positive().max(50_000),
});

const normalizeStep = z.object({
  op: z.literal('normalize'),
  measure: fieldName,
  by: z.enum(DENOMINATORS),
});

const rankStep = z.object({
  op: z.literal('rank'),
  measure: fieldName,
  dir: z.enum(['asc', 'desc']),
  n: z.number().int().min(1).max(200),
});

const compareStep = z.object({
  op: z.literal('compare'),
  measure: fieldName,
  split_on: fieldName,
  threshold: z.number().finite(),
});

export const stepSchema = z.discriminatedUnion('op', [
  filterStep,
  floodExposureStep,
  resourceGapStep,
  normalizeStep,
  rankStep,
  compareStep,
]);

export type Step = z.infer<typeof stepSchema>;

export const planSchema = z.object({
  pipeline: z.array(stepSchema).min(1).max(MAX_PIPELINE_STEPS),
  render: z.enum(['choropleth', 'points', 'comparison']),
  color_by: fieldName.optional(),
  title: z.string().min(1).max(120),
});

export type Plan = z.infer<typeof planSchema>;

export const unsupportedSchema = z.object({
  unsupported: z.literal(true),
  reason: z.string().min(1).max(300),
  suggestion: z.string().min(1).max(300),
});

export type Unsupported = z.infer<typeof unsupportedSchema>;

export type ValidationResult =
  | { ok: true; plan: Plan }
  | { ok: false; unsupported: Unsupported }
  | { ok: false; errors: string[] };

/**
 * Layer 2. Catches plans that parse but cannot mean anything sensible.
 * Each rule exists because a model plausibly produces that mistake.
 */
export function checkSemantics(plan: Plan): string[] {
  const errors: string[] = [];

  plan.pipeline.forEach((step, i) => {
    // A threshold outside the field's plausible range is a hallucinated unit,
    // e.g. flood_pct expressed as 50 instead of 0.5.
    if (step.op === 'filter') {
      const [lo, hi] = FIELDS[step.field].range;
      if (step.value < lo || step.value > hi) {
        errors.push(
          `step ${i} (filter): value ${step.value} is outside the plausible range ` +
            `${lo}–${hi} for ${step.field} (${FIELDS[step.field].unit})`,
        );
      }
    }

    if (step.op === 'compare') {
      const [lo, hi] = FIELDS[step.split_on].range;
      if (step.threshold < lo || step.threshold > hi) {
        errors.push(
          `step ${i} (compare): threshold ${step.threshold} is outside the plausible ` +
            `range ${lo}–${hi} for ${step.split_on}`,
        );
      }
    }

    // Normalizing an already-derived rate produces a meaningless quantity.
    if (step.op === 'normalize' && FIELDS[step.measure].isDerived) {
      errors.push(`step ${i} (normalize): ${step.measure} is already a derived rate`);
    }
  });

  // Ordering: normalizing after ranking silently discards the rows that
  // normalization was supposed to reorder.
  const rankAt = plan.pipeline.findIndex((s) => s.op === 'rank');
  const normalizeAt = plan.pipeline.findIndex((s) => s.op === 'normalize');
  if (rankAt !== -1 && normalizeAt !== -1 && normalizeAt > rankAt) {
    errors.push('normalize must come before rank, otherwise it reorders an already-truncated set');
  }

  // compare terminates the pipeline: it emits statistics, not block groups.
  const compareAt = plan.pipeline.findIndex((s) => s.op === 'compare');
  if (compareAt !== -1 && compareAt !== plan.pipeline.length - 1) {
    errors.push('compare produces statistics, so it must be the last step');
  }
  if (compareAt !== -1 && plan.render !== 'comparison') {
    errors.push("a pipeline ending in compare must use render: 'comparison'");
  }
  if (compareAt === -1 && plan.render === 'comparison') {
    errors.push("render: 'comparison' requires a compare step");
  }

  return errors;
}

/** Layers 1 and 2 together. Accepts raw model output of unknown shape. */
export function validatePlan(raw: unknown): ValidationResult {
  const refusal = unsupportedSchema.safeParse(raw);
  if (refusal.success) return { ok: false, unsupported: refusal.data };

  const parsed = planSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    };
  }

  const semantic = checkSemantics(parsed.data);
  if (semantic.length > 0) return { ok: false, errors: semantic };

  return { ok: true, plan: parsed.data };
}
