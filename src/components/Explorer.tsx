/**
 * The analysis view, rendered on the server.
 *
 * Shared by `/` and by `/a/[slug]`, because a saved analysis is the same page
 * reached by a different address — the saved row stores the *question*, so the
 * share link re-runs it rather than replaying a stored answer that would go
 * stale the next time the pipeline runs.
 *
 * The question lives in the URL, so the analysis runs here rather than in the
 * browser: no fetch, no loading flash, and the answer is in the first HTML
 * response. That makes a result shareable, readable by anything that reads
 * HTML, and — apart from the map — usable with JavaScript switched off, since
 * the question box is an ordinary GET form and the presets are ordinary links.
 *
 * It also skips a round trip. The old page shipped JavaScript, ran it, POSTed
 * to /api/query, and only then had something to show. That endpoint still
 * exists and calls exactly the same function; the browser just no longer has
 * to be the one asking.
 */

import { headers } from 'next/headers';
import Link from 'next/link';

import AnswerPanel from '@/components/AnswerPanel';
import Legend from '@/components/Legend';
import ResultMap from '@/components/ResultMap';
import ResultsTable from '@/components/ResultsTable';
import { answerFor, MAX_QUESTION_LENGTH, type Result } from '@/lib/answer';
import { classify } from '@/lib/classify';
import { PRESETS } from '@/lib/presets';
import AccountBar from '@/components/AccountBar';
import SaveControls from '@/components/SaveControls';
import type { Viewer } from '@/lib/session';
import { accountsEnabled } from '@/lib/auth';

export interface ExplorerProps {
  preset?: string;
  q?: string;
  me: Viewer | null;
  /** Set when this view *is* a saved analysis, reached by its share link. */
  saved?: { slug: string; title: string; mine: boolean };
  /** Absolute origin of this request, so the panel can show a copyable link. */
  origin?: string;
}

export default async function Explorer({ preset, q, me, saved, origin }: ExplorerProps) {
  const accounts = accountsEnabled();
  const asked = Boolean(preset || q?.trim());

  let result: Result | null = null;
  if (asked) {
    // Only read headers when there is something to rate limit. Reading them
    // unconditionally would opt the empty landing page into dynamic rendering
    // for no reason.
    const needsKey = Boolean(q?.trim()) && !saved;
    const forwarded = needsKey ? (await headers()).get('x-forwarded-for') : null;

    result = await answerFor({
      presetId: preset,
      question: q,
      // A saved analysis is limited as itself, not as whoever opened it.
      //
      // Without this, opening someone's share link spent the *reader's* hourly
      // allowance — so a link shared with ten colleagues could greet the
      // eleventh with "slow down a moment" for something they never did. The
      // link gets its own bucket instead: the first open may reach the model,
      // every open after that is served from the plan cache, and no reader is
      // ever charged for arriving.
      //
      // What this does not do is bound the cost across many different links.
      // That would mean storing the validated plan alongside the question, so
      // a share link never reaches a model at all — a schema change worth
      // making if this were more than a demo, and the reason it is not made
      // here is that the cache plus a spend limit already bound the bill.
      clientKey: saved ? `saved:${saved.slug}` : forwarded?.split(',')[0]?.trim() || 'unknown',
    });
  }

  const answer = result?.ok ? result : null;
  const failure = result && !result.ok ? result : null;

  // Computed once, on the server, so the legend and the map cannot disagree.
  // A comparison shades by the field it compares — the question is about that
  // measure, not about which side of the threshold a row fell on.
  const colorBy = answer?.plan.color_by ?? answer?.comparison?.measure ?? null;
  const { values, breaks, missing } = classify(answer?.features ?? [], colorBy);
  const split = answer?.comparison
    ? {
        field: answer.comparison.split_on,
        threshold: answer.comparison.threshold,
        above: answer.comparison.above.n,
        below: answer.comparison.below.n,
      }
    : null;

  return (
    // h-dvh, not h-screen: on mobile Safari 100vh is the height the page
    // *would* have with the URL bar hidden, so h-screen puts the bottom of the
    // map under the browser chrome.
    <main className="flex h-dvh flex-col lg:flex-row">
      {/* ---------------- controls ---------------- */}
      {/*
        The explicit height is load-bearing on small screens. Stacked, this
        aside is ~1000px of content and `shrink-0` means it will not give any
        of that back, so the map — the entire point of the page — was squeezed
        to zero pixels on a phone and 237 on a tablet. Capping the controls at
        45% of the viewport and letting them scroll inside that leaves the map
        a real 55%.
      */}
      <aside className="flex h-[45dvh] w-full shrink-0 flex-col gap-5 overflow-y-auto border-b border-slate-200 bg-white p-5 lg:h-full lg:w-[26rem] lg:border-b-0 lg:border-r">
        <header>
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-lg font-semibold tracking-tight text-slate-900">Catchment</h1>
            {accounts && <AccountBar name={me?.name ?? null} />}
          </div>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">
            Flood exposure and service access across Harris County, Texas. Ask a question; a
            language model writes the analysis plan, and a fixed program runs it.
          </p>
        </header>

        {/*
          A GET form, not a handler. Submitting navigates to /?q=… , which is
          the same URL someone could paste — and it works without JavaScript.
        */}
        <form action="/" method="get" className="flex gap-2">
          <input
            type="search"
            name="q"
            defaultValue={q ?? ''}
            maxLength={MAX_QUESTION_LENGTH}
            placeholder="Ask about flooding, income or access…"
            aria-label="Question"
            className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
          <button
            type="submit"
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
          >
            Ask
          </button>
        </form>

        {failure && <Failed failure={failure} />}
        {answer && <AnswerPanel answer={answer} />}
        {/* The same rows the map draws, reachable without a pointer. Placed
            under the answer rather than beside the map: it is the detail
            behind the summary just above it, and on a phone the map is a
            separate scroll region entirely. */}
        {answer && (
          <ResultsTable
            features={answer.features}
            colorBy={colorBy}
            splitOn={split?.field ?? null}
          />
        )}
        {answer && (
          <SaveControls
            accounts={accounts}
            signedIn={Boolean(me)}
            defaultTitle={answer.plan.title}
            presetId={preset}
            question={q}
            saved={saved}
            origin={origin}
          />
        )}

        {/*
          Below the answer, deliberately. These are a menu, and once someone
          has asked something the answer is what they came back to the panel
          for; eight buttons between the question box and the result meant the
          numbers landed off-screen on every laptop.
        */}
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            {asked ? 'Ask another — these are free' : 'Try one — these are free'}
          </h2>
          <ul className="flex flex-col gap-1.5">
            {PRESETS.map((p) => (
              <li key={p.id}>
                {/*
                  prefetch is off on purpose. Each of these answers carries the
                  matched block groups' geometry, so prefetching all eight on
                  hover would run the county's analysis eight times over for a
                  reader who clicks one.
                */}
                <Link
                  href={`/?preset=${p.id}`}
                  prefetch={false}
                  aria-current={preset === p.id ? 'true' : undefined}
                  className="block w-full rounded-md border border-slate-200 px-3 py-2 text-left text-sm leading-snug text-slate-700 transition hover:border-blue-400 hover:bg-blue-50 aria-[current]:border-blue-400 aria-[current]:bg-blue-50"
                >
                  {p.question}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <footer className="mt-auto pt-4 text-xs leading-relaxed text-slate-500">
          <p>
            Census ACS 5-year and TIGER/Line boundaries, FEMA National Flood Hazard Layer, and
            points of interest from OpenStreetMap contributors (ODbL). Distances are straight-line,
            not travel time. Results describe distributions; they do not establish cause.
          </p>
        </footer>
      </aside>

      {/* ---------------- map ---------------- */}
      <div className="relative min-h-0 flex-1">
        <ResultMap
          features={answer?.features ?? []}
          colorBy={colorBy}
          breaks={breaks}
          split={split}
        />

        {answer && answer.features.length > 0 && (colorBy || split) && (
          <Legend
            field={colorBy ?? split!.field}
            values={values}
            breaks={breaks}
            missing={missing}
            split={split}
          />
        )}

        {!asked && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center p-6">
            <p className="max-w-sm rounded-lg bg-white/90 p-4 text-center text-sm leading-relaxed text-slate-600 shadow-sm">
              Pick a question on the left. Google Maps can tell you where a supermarket is; it
              cannot tell you which flooded neighbourhoods have none.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}

/** Every failure the analysis can name, as something a reader can act on. */
function Failed({ failure }: { failure: Extract<Result, { ok: false }> }) {
  const { title, detail, hint } = describe(failure);

  return (
    // <output> rather than a div with role="status": it carries that role
    // implicitly, so the announcement and the element agree by construction.
    <output className="block rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <p className="font-medium">{title}</p>
      <p className="mt-1 leading-relaxed">{detail}</p>
      {hint && <p className="mt-2 leading-relaxed text-amber-800">{hint}</p>}
    </output>
  );
}

function describe(failure: Extract<Result, { ok: false }>): {
  title: string;
  detail: string;
  hint?: string;
} {
  switch (failure.kind) {
    case 'unsupported':
      // Not an error. The dataset genuinely cannot answer it, and saying so is
      // the correct response rather than an approximation presented as one.
      return {
        title: "That one can't be answered here",
        detail: failure.reason,
        hint: failure.suggestion,
      };
    case 'unknown-preset':
      return { title: 'No such question', detail: 'That preset does not exist.' };
    case 'no-question':
      return { title: 'Nothing to answer', detail: 'Type a question, or pick one below.' };
    case 'question-too-long':
      return {
        title: 'That question is too long',
        detail: `Questions are limited to ${failure.limit} characters.`,
      };
    case 'rate-limited':
      return { title: 'Slow down a moment', detail: failure.detail };
    case 'model-failed':
      return { title: 'The model call failed', detail: failure.detail };
    case 'data-unavailable':
      return { title: 'Data unavailable', detail: failure.detail };
  }
}
