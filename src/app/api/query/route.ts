/**
 * The analysis as JSON.
 *
 * The page does not go through here — it renders on the server and calls
 * `answerFor` directly, which saves a round trip and puts the answer in the
 * first HTML response. This endpoint exists so the same analysis is available
 * to anything that is not a browser, and it is deliberately the *same*
 * function: there is one implementation of what an answer is, and two ways to
 * ask for it.
 *
 * Everything this file does is map a named failure onto a status code.
 */

import { NextResponse } from 'next/server';

import { answerFor, MAX_QUESTION_LENGTH, type Failure } from '@/lib/answer';

export const runtime = 'nodejs';
export const maxDuration = 30;

interface Body {
  presetId?: string;
  question?: string;
}

function clientKey(req: Request): string {
  // Vercel sets x-forwarded-for; fall back to a constant so a missing header
  // shares one bucket rather than bypassing the limiter entirely.
  const fwd = req.headers.get('x-forwarded-for');
  return fwd?.split(',')[0]?.trim() || 'unknown';
}

/** The one place a failure becomes an HTTP response. */
function respondToFailure(failure: Failure): NextResponse {
  switch (failure.kind) {
    case 'unknown-preset':
      return NextResponse.json({ ok: false, error: 'unknown preset' }, { status: 404 });
    case 'no-question':
      return NextResponse.json({ ok: false, error: 'question is required' }, { status: 400 });
    case 'question-too-long':
      return NextResponse.json(
        { ok: false, error: `question must be under ${MAX_QUESTION_LENGTH} characters` },
        { status: 400 },
      );
    case 'rate-limited':
      return NextResponse.json(
        {
          ok: false,
          error: 'rate limited',
          detail: failure.detail,
          retryAfterSeconds: failure.retryAfterSeconds,
        },
        { status: 429, headers: { 'Retry-After': String(failure.retryAfterSeconds) } },
      );
    case 'unsupported':
      // Not an error: the dataset genuinely cannot answer it, and saying so is
      // the correct response.
      return NextResponse.json({
        ok: false,
        unsupported: { reason: failure.reason, suggestion: failure.suggestion },
      });
    case 'model-failed':
      return NextResponse.json(
        { ok: false, error: 'the model call failed', detail: failure.detail },
        { status: 502 },
      );
    case 'data-unavailable':
      return NextResponse.json(
        { ok: false, error: 'data unavailable', detail: failure.detail },
        { status: 503 },
      );
  }
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'malformed request body' }, { status: 400 });
  }

  const result = await answerFor({
    presetId: body.presetId,
    question: body.question,
    clientKey: clientKey(req),
  });

  return result.ok ? NextResponse.json(result) : respondToFailure(result);
}
