/**
 * The only place a model is called.
 *
 * The model's entire job is translation: a question in English becomes an
 * analysis plan in the closed schema from `schema.ts`. It never sees the data,
 * never computes anything, and never emits code. Everything it produces is
 * re-validated by `validate.ts` before the executor touches it.
 *
 * The tool schema and the prompt are generated from `schema.ts`, so they cannot
 * drift away from what the executor actually supports — the failure mode where
 * a prompt still advertises a field that was renamed six commits ago.
 */

import Anthropic from '@anthropic-ai/sdk';

import {
  COMPARISON_OPS,
  DENOMINATORS,
  FIELD_NAMES,
  MAX_PIPELINE_STEPS,
  POI_TYPES,
  describeFields,
  describePrimitives,
} from './schema';
import { PRESETS, UNSUPPORTED_EXAMPLE } from './presets';

// Dated snapshot, not a bare alias: `claude-haiku-4-5` is not a valid
// identifier and the API rejects it. Pinning the snapshot also means a new
// Haiku release cannot silently change this demo's behaviour.
const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5-20251001';

// A translation into a closed schema needs no reasoning ability, so this is
// sized to the task rather than to the biggest model available. It also caps
// the cost of a single call, which matters on a public endpoint.
const MAX_TOKENS = 1024;

const fieldEnum = { type: 'string' as const, enum: [...FIELD_NAMES] };

const STEP_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      properties: {
        op: { const: 'filter' },
        field: fieldEnum,
        comparison: { type: 'string', enum: [...COMPARISON_OPS] },
        value: { type: 'number' },
      },
      required: ['op', 'field', 'comparison', 'value'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: { op: { const: 'flood_exposure' }, min_pct: { type: 'number', minimum: 0, maximum: 1 } },
      required: ['op', 'min_pct'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        op: { const: 'resource_gap' },
        poi_type: { type: 'string', enum: [...POI_TYPES] },
        max_distance_m: { type: 'number', exclusiveMinimum: 0, maximum: 50000 },
      },
      required: ['op', 'poi_type', 'max_distance_m'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        op: { const: 'normalize' },
        measure: fieldEnum,
        by: { type: 'string', enum: [...DENOMINATORS] },
      },
      required: ['op', 'measure', 'by'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        op: { const: 'rank' },
        measure: fieldEnum,
        dir: { type: 'string', enum: ['asc', 'desc'] },
        n: { type: 'integer', minimum: 1, maximum: 200 },
      },
      required: ['op', 'measure', 'dir', 'n'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        op: { const: 'compare' },
        measure: fieldEnum,
        split_on: fieldEnum,
        threshold: { type: 'number' },
      },
      required: ['op', 'measure', 'split_on', 'threshold'],
      additionalProperties: false,
    },
  ],
};

const TOOL = {
  name: 'answer',
  description:
    'Return an analysis plan for the question, or declare it unsupported. ' +
    'Declaring a question unsupported is a correct answer, not a failure.',
  input_schema: {
    type: 'object' as const,
    oneOf: [
      {
        type: 'object',
        properties: {
          pipeline: { type: 'array', items: STEP_SCHEMA, minItems: 1, maxItems: MAX_PIPELINE_STEPS },
          render: { type: 'string', enum: ['choropleth', 'points', 'comparison'] },
          color_by: fieldEnum,
          title: { type: 'string', maxLength: 120 },
        },
        required: ['pipeline', 'render', 'title'],
      },
      {
        type: 'object',
        properties: {
          unsupported: { const: true },
          reason: { type: 'string', maxLength: 300 },
          suggestion: { type: 'string', maxLength: 300 },
        },
        required: ['unsupported', 'reason', 'suggestion'],
      },
    ],
  },
};

/** Built from the schema, never hand-written. */
function systemPrompt(): string {
  const examples = PRESETS.slice(0, 3)
    .map((p) => `Q: ${p.question}\nA: ${JSON.stringify(p.plan)}`)
    .join('\n\n');

  return `You translate questions about Harris County, Texas into analysis plans.
You do not analyse anything yourself and you never see the data. Your output is
executed by a fixed program that understands only the operations below.

FIELDS (one row per census block group, 2,830 of them):
${describeFields()}

OPERATIONS:
${describePrimitives()}

RULES
- Steps run in order. At most ${MAX_PIPELINE_STEPS}.
- normalize must come before rank; it reorders rows and rank truncates them.
- compare emits statistics rather than rows, so it must be the last step and
  requires render "comparison".
- flood_pct is the 1% annual chance floodplain. flood_pct_500 is the 0.2% zone
  and is NOT a subset of flood_pct. If a question says "floodplain" without
  qualification, use flood_pct.
- Distances are straight-line. A question about travel or commute time cannot
  be answered; say so.
- If the question cannot be expressed with these operations, return the
  unsupported form. Do not approximate it with something adjacent and present
  that as the answer. An honest refusal is the correct output.

EXAMPLES
${examples}

Q: ${UNSUPPORTED_EXAMPLE.question}
A: ${JSON.stringify(UNSUPPORTED_EXAMPLE.response)}`;
}

let client: Anthropic | null = null;

function anthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

/**
 * One retry, then give up. Structured output that fails twice usually means
 * the question genuinely does not fit, and retrying past that is a linear way
 * to burn money on a public endpoint.
 */
/** Turns an SDK failure into something a reader can act on. */
export class OrchestrationError extends Error {
  constructor(
    readonly hint: string,
    cause: unknown,
  ) {
    super(hint, { cause });
    this.name = 'OrchestrationError';
  }
}

function describeFailure(err: unknown): string {
  const status = (err as { status?: number })?.status;
  switch (status) {
    case 401:
    case 403:
      return 'The Anthropic API key was rejected. Check ANTHROPIC_API_KEY on the deployment.';
    case 404:
      return `The model "${MODEL}" was not found. Model IDs are dated snapshots; check the current one.`;
    case 429:
      return 'The Anthropic account is rate limited or out of credit.';
    case 400:
      return 'The request was rejected as malformed — usually the tool schema, not the question.';
    default:
      return status
        ? `The Anthropic API returned ${status}.`
        : 'The Anthropic API could not be reached.';
  }
}

export async function planFromQuestion(question: string): Promise<unknown> {
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: question }];

  for (let attempt = 0; attempt < 2; attempt++) {
    let response;
    try {
      response = await anthropic().messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt(),
        tools: [TOOL],
        tool_choice: { type: 'tool', name: TOOL.name },
        messages,
      });
    } catch (err) {
      // Swallowing this was a real defect: a wrong model ID and a rejected key
      // both surfaced as the same opaque "could not reach the model", which
      // points at the network and gives no way to tell the two apart.
      throw new OrchestrationError(describeFailure(err), err);
    }

    const block = response.content.find((c) => c.type === 'tool_use');
    if (block && block.type === 'tool_use') return block.input;

    messages.push(
      { role: 'assistant', content: response.content },
      { role: 'user', content: 'Use the answer tool. Return the unsupported form if the question does not fit.' },
    );
  }

  return {
    unsupported: true,
    reason: 'The question could not be turned into a plan this dataset supports.',
    suggestion: 'Try one of the preset questions to see the shape of what works.',
  };
}
