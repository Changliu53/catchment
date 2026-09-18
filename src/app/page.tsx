'use client';

import dynamic from 'next/dynamic';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import Legend from '@/components/Legend';
import { formatValue, labelFor } from '@/lib/format';
import { PRESETS } from '@/lib/presets';
import { quantileBreaks } from '@/lib/ramp';
import type { Feature } from '@/components/MapView';

const MapView = dynamic(() => import('@/components/MapView'), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-slate-100" />,
});

interface Totals {
  blockGroups: number;
  population: number;
  areaKm2: number;
  floodShare: number;
}

interface Stats {
  n: number;
  mean: number | null;
  median: number | null;
  p25: number | null;
  p75: number | null;
}

interface Result {
  ok: true;
  source: 'preset' | 'cache' | 'model';
  plan: { title: string; pipeline: Record<string, unknown>[]; render: string; color_by?: string };
  totals: Totals;
  trace: { op: string; remaining: number }[];
  empty: boolean;
  matched: number;
  matchedPopulation: number;
  comparison: {
    measure: string;
    split_on: string;
    threshold: number;
    above: Stats;
    below: Stats;
  } | null;
  features: Feature[];
  reading?: string;
}

interface Refusal {
  ok: false;
  unsupported?: { reason: string; suggestion: string };
  error?: string;
  detail?: string;
}

const fmt = new Intl.NumberFormat('en-US');
const money = (v: number | null) => (v === null ? '—' : `$${fmt.format(Math.round(v))}`);

export default function Home() {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [hover, setHover] = useState<Record<string, number | string | boolean | null> | null>(null);
  const controls = useRef<HTMLElement>(null);

  const run = useCallback(async (body: { presetId?: string; question?: string }) => {
    setLoading(true);
    setRefusal(null);
    try {
      const res = await fetch('/api/query', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        // A non-JSON body means the function crashed before our handlers ran.
        // Show the status and a slice of the body; a blank "network error"
        // tells the person nothing they can act on.
        setRefusal({
          ok: false,
          error: `server error ${res.status}`,
          detail: text.slice(0, 200) || 'The server returned an empty response.',
        });
        return;
      }
      if ((data as Result).ok) setResult(data as Result);
      else setRefusal(data as Refusal);
    } catch (err) {
      setRefusal({
        ok: false,
        error: 'could not reach the server',
        detail: err instanceof Error ? err.message : 'Check your connection and try again.',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const onHover = useCallback((p: Record<string, number | string | boolean | null> | null) => setHover(p), []);

  // Classification happens once, in one place. If the map computed its own
  // breaks the legend would be describing a different map than the one drawn.
  const colorBy = result?.plan.color_by ?? null;

  // Nulls are counted, never coerced. `Number(null)` is 0, so mapping the
  // values straight through put 273 block groups with suppressed income at the
  // bottom of the distribution — which both painted them as the poorest areas
  // in the county and dragged every quantile break downwards.
  const { colorValues, missing } = useMemo(() => {
    if (!colorBy) return { colorValues: [] as number[], missing: 0 };
    const values: number[] = [];
    let absent = 0;
    for (const f of result?.features ?? []) {
      const raw = f.properties[colorBy];
      const n = raw === null || raw === '' ? NaN : Number(raw);
      if (Number.isFinite(n)) values.push(n);
      else absent++;
    }
    return { colorValues: values, missing: absent };
  }, [result, colorBy]);

  const breaks = useMemo(() => quantileBreaks(colorValues), [colorValues]);

  // Bring a new answer into view. On a phone the controls are a 45%-tall
  // scroller, so a result that lands while the reader is halfway down the
  // preset list is invisible; this is also why the panel sits above the
  // presets rather than below them.
  useEffect(() => {
    if (result || refusal) controls.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [result, refusal]);

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
      <aside
        ref={controls}
        className="flex h-[45dvh] w-full shrink-0 flex-col gap-5 overflow-y-auto border-b border-slate-200 bg-white p-5 lg:h-full lg:w-[26rem] lg:border-b-0 lg:border-r"
      >
        <header>
          <h1 className="text-lg font-semibold tracking-tight text-slate-900">Catchment</h1>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">
            Flood exposure and service access across Harris County, Texas. Ask a question; a
            language model writes the analysis plan, and a fixed program runs it.
          </p>
        </header>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (question.trim() && !loading) run({ question });
          }}
          className="flex gap-2"
        >
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={300}
            placeholder="Ask about flooding, income or access…"
            aria-label="Question"
            className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
          <button
            type="submit"
            disabled={loading || !question.trim()}
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {loading ? '…' : 'Ask'}
          </button>
        </form>

        {refusal && (
          <section
            role="status"
            className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
          >
            <p className="font-medium">
              {refusal.unsupported ? "That one can't be answered here" : refusal.error}
            </p>
            <p className="mt-1 leading-relaxed">
              {refusal.unsupported?.reason ?? refusal.detail}
            </p>
            {refusal.unsupported?.suggestion && (
              <p className="mt-2 leading-relaxed text-amber-800">
                {refusal.unsupported.suggestion}
              </p>
            )}
          </section>
        )}

        {result && <PlanPanel result={result} />}

        {/*
          Below the answer, deliberately. These are a menu, and once someone
          has asked something the answer is what they came back to the panel
          for; eight buttons between the question box and the result meant the
          numbers landed off-screen on every laptop.
        */}
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            {result || refusal ? 'Ask another — these are free' : 'Try one — these are free'}
          </h2>
          <ul className="flex flex-col gap-1.5">
            {PRESETS.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => !loading && run({ presetId: p.id })}
                  disabled={loading}
                  aria-current={result?.plan.title === p.plan.title ? 'true' : undefined}
                  className="w-full rounded-md border border-slate-200 px-3 py-2 text-left text-sm leading-snug text-slate-700 transition hover:border-blue-400 hover:bg-blue-50 disabled:opacity-50 aria-[current]:border-blue-400 aria-[current]:bg-blue-50"
                >
                  {p.question}
                </button>
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
        <MapView
          features={result?.features ?? []}
          colorBy={colorBy}
          breaks={breaks}
          onHover={onHover}
        />

        {colorBy && result && result.features.length > 0 && (
          <Legend field={colorBy} values={colorValues} breaks={breaks} missing={missing} />
        )}

        {!result && !loading && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center p-6">
            <p className="max-w-sm rounded-lg bg-white/90 p-4 text-center text-sm leading-relaxed text-slate-600 shadow-sm">
              Pick a question on the left. Google Maps can tell you where a supermarket is; it
              cannot tell you which flooded neighbourhoods have none.
            </p>
          </div>
        )}

        {hover && (
          <div className="pointer-events-none absolute bottom-4 left-4 max-w-[17rem] rounded-lg bg-white/95 p-3 text-xs shadow-lg ring-1 ring-slate-200">
            <p className="font-mono text-[11px] text-slate-500">
              Block group {String(hover.geoid)}
            </p>
            <dl className="mt-1.5 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-slate-700">
              {(
                [
                  'pop',
                  'median_income',
                  'pop_density',
                  'flood_pct',
                  'flood_pct_500',
                  'dist_grocery_m',
                  'dist_park_m',
                ] as const
              ).map((f) => (
                <Fragment key={f}>
                  <dt className={f === colorBy ? 'font-medium text-slate-900' : ''}>
                    {labelFor(f)}
                  </dt>
                  <dd
                    className={`text-right tabular-nums ${f === colorBy ? 'font-medium text-slate-900' : ''}`}
                  >
                    {formatValue(f, hover[f] === null ? null : Number(hover[f]))}
                    {f === 'median_income' && hover.income_topcoded ? '+' : ''}
                  </dd>
                </Fragment>
              ))}
            </dl>
            {hover.income_topcoded ? (
              <p className="mt-1.5 text-[10px] leading-snug text-slate-500">
                + income is top-coded by the Census at $250,001.
              </p>
            ) : null}
          </div>
        )}
      </div>
    </main>
  );
}

function PlanPanel({ result }: { result: Result }) {
  const { plan, trace, totals, comparison } = result;

  return (
    <section className="flex flex-col gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">{plan.title}</h2>
          <span className="shrink-0 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600">
            {result.source}
          </span>
        </div>
        {result.reading && (
          <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{result.reading}</p>
        )}
      </div>

      {result.empty ? (
        <p className="text-sm text-slate-700">
          No block groups match. That is an answer, not an error — nothing in the county meets
          every condition at once.
        </p>
      ) : (
        <p className="text-sm text-slate-700">
          <strong className="tabular-nums">{fmt.format(result.matched)}</strong> of{' '}
          {fmt.format(totals.blockGroups)} block groups,{' '}
          <strong className="tabular-nums">{fmt.format(result.matchedPopulation)}</strong> people (
          {((result.matchedPopulation / totals.population) * 100).toFixed(1)}% of the county).
        </p>
      )}

      {comparison && <Comparison c={comparison} />}

      <details className="text-xs">
        <summary className="cursor-pointer font-medium text-slate-600 hover:text-slate-900">
          How this was computed
        </summary>
        <ol className="mt-2 flex flex-col gap-1">
          {plan.pipeline.map((step, i) => (
            <li key={i} className="flex items-baseline justify-between gap-3 font-mono text-[11px]">
              <span className="text-slate-700">{JSON.stringify(step)}</span>
              <span className="shrink-0 tabular-nums text-slate-400">
                {fmt.format(trace[i]?.remaining ?? 0)}
              </span>
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}

function Comparison({ c }: { c: NonNullable<Result['comparison']> }) {
  const rows = [
    { label: `${c.split_on} ≥ ${c.threshold}`, s: c.above },
    { label: `${c.split_on} < ${c.threshold}`, s: c.below },
  ];
  return (
    <div className="rounded border border-slate-200 bg-white p-2.5">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-slate-500">
            <th className="font-medium">Group</th>
            <th className="text-right font-medium">n</th>
            <th className="text-right font-medium">Median</th>
            <th className="text-right font-medium">p25–p75</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-slate-100">
              <td className="py-1 font-mono text-[11px] text-slate-700">{r.label}</td>
              <td className="text-right tabular-nums">{fmt.format(r.s.n)}</td>
              <td className="text-right tabular-nums">{money(r.s.median)}</td>
              <td className="text-right tabular-nums text-slate-500">
                {money(r.s.p25)}–{money(r.s.p75)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
        Medians, not means: median income is top-coded at $250,001, so averaging understates the
        wealthier group. This shows a difference in distribution, not a cause.
      </p>
    </div>
  );
}
