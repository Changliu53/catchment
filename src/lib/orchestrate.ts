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
  PRIMITIVE_OPS,
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

/**
 * One loose step object rather than a discriminated union.
 *
 * The API rejects `oneOf` in a tool's input_schema, so the shape cannot encode
 * "if op is filter then field and comparison are required". That constraint
 * lives in the prompt and, decisively, in `validate.ts`: a step with the wrong
 * parameters for its op fails the Zod discriminated union before anything runs.
 * The schema's job here is to bound the vocabulary — which ops and which field
 * names exist — and it still does that exactly.
 */
const STEP_SCHEMA = {
  type: 'object' as const,
  properties: {
    op: { type: 'string', enum: [...PRIMITIVE_OPS], description: 'Which operation this step performs.' },
    field: { ...fieldEnum, description: 'filter: the field to compare.' },
    comparison: { type: 'string', enum: [...COMPARISON_OPS], description: 'filter: the comparison.' },
    value: { type: 'number', description: 'filter: the threshold, in the field\'s own unit.' },
    min_pct: { type: 'number', minimum: 0, maximum: 1, description: 'flood_exposure: minimum share of area, 0-1.' },
    poi_type: { type: 'string', enum: [...POI_TYPES], description: 'resource_gap: which kind of place.' },
    max_distance_m: { type: 'number', description: 'resource_gap: keep block groups farther than this, in metres.' },
    measure: { ...fieldEnum, description: 'normalize, rank, compare: the field being measured.' },
    by: { type: 'string', enum: [...DENOMINATORS], description: 'normalize: the denominator.' },
    dir: { type: 'string', enum: ['asc', 'desc'], description: 'rank: sort direction.' },
    n: { type: 'integer', minimum: 1, maximum: 200, description: 'rank: how many to keep.' },
    split_on: { ...fieldEnum, description: 'compare: the field the two groups are split on.' },
    threshold: { type: 'number', description: 'compare: the split point, in split_on\'s unit.' },
  },
  required: ['op'],
  additionalProperties: false,
};

/**
 * Two tools, not one with a union. Declining is a first-class outcome, so it
 * gets its own tool rather than a variant the model has to notice it may pick.
 */
const ANALYSE_TOOL = {
  name: 'analyse',
  description: 'Run an analysis over Harris County block groups and draw the result.',
  input_schema: {
    type: 'object' as const,
    properties: {
      pipeline: { type: 'array', items: STEP_SCHEMA, minItems: 1, maxItems: MAX_PIPELINE_STEPS },
      render: { type: 'string', enum: ['choropleth', 'points', 'comparison'] },
      color_by: { ...fieldEnum, description: 'Which field the map shades by.' },
      title: { type: 'string', maxLength: 120, description: 'A short title for the result.' },
    },
    required: ['pipeline', 'render', 'title'],
  },
};

const DECLINE_TOOL = {
  name: 'decline',
  description:
    'Say that the question cannot be answered with this dataset. This is a correct ' +
    'answer, not a failure — prefer it over an approximation presented as the answer.',
  input_schema: {
    type: 'object' as const,
    properties: {
      reason: { type: 'string', maxLength: 300, description: 'Why this dataset cannot answer it.' },
      suggestion: { type: 'string', maxLength: 300, description: 'A related question that does work.' },
    },
    required: ['reason', 'suggestion'],
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
        tools: [ANALYSE_TOOL, DECLINE_TOOL],
        tool_choice: { type: 'any' },
        messages,
      });
    } catch (err) {
      // Swallowing this was a real defect: a wrong model ID and a rejected key
      // both surfaced as the same opaque "could not reach the model", which
      // points at the network and gives no way to tell the two apart.
      throw new OrchestrationError(describeFailure(err), err);
    }

    const block = response.content.find((c) => c.type === 'tool_use');
    if (block && block.type === 'tool_use') {
      if (block.name === DECLINE_TOOL.name) {
        const d = block.input as { reason?: string; suggestion?: string };
        return {
          unsupported: true,
          reason: d.reason ?? 'This dataset cannot answer that question.',
          suggestion: d.suggestion ?? 'Try one of the preset questions.',
        };
      }
      return block.input;
    }

    messages.push(
      { role: 'assistant', content: response.content },
      { role: 'user', content: 'Call analyse, or call decline if the question does not fit.' },
    );
  }

  return {
    unsupported: true,
    reason: 'The question could not be turned into a plan this dataset supports.',
    suggestion: 'Try one of the preset questions to see the shape of what works.',
  };
}
