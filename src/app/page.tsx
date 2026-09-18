'use client';

import dynamic from 'next/dynamic';
import { useCallback, useState } from 'react';

import { PRESETS } from '@/lib/presets';
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

  const run = useCallback(async (body: { presetId?: string; question?: string }) => {
    setLoading(true);
    setRefusal(null);
    try {
      const res = await fetch('/api/query', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        setResult(data as Result);
      } else {
        setRefusal(data as Refusal);
      }
    } catch {
      setRefusal({ ok: false, error: 'network error', detail: 'Try again, or use a preset.' });
    } finally {
      setLoading(false);
    }
  }, []);

  const onHover = useCallback((p: Record<string, number | string | boolean | null> | null) => setHover(p), []);

  return (
    <main className="flex h-screen flex-col lg:flex-row">
      {/* ---------------- controls ---------------- */}
      <aside className="flex w-full shrink-0 flex-col gap-5 overflow-y-auto border-slate-200 bg-white p-5 lg:w-[26rem] lg:border-r">
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

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Try one — these are free
          </h2>
          <ul className="flex flex-col gap-1.5">
            {PRESETS.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => !loading && run({ presetId: p.id })}
                  disabled={loading}
                  className="w-full rounded-md border border-slate-200 px-3 py-2 text-left text-sm leading-snug text-slate-700 transition hover:border-blue-400 hover:bg-blue-50 disabled:opacity-50"
                >
                  {p.question}
                </button>
              </li>
            ))}
          </ul>
        </section>

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
          colorBy={result?.plan.color_by ?? null}
          onHover={onHover}
        />

        {!result && !loading && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center p-6">
            <p className="max-w-sm rounded-lg bg-white/90 p-4 text-center text-sm leading-relaxed text-slate-600 shadow-sm">
              Pick a question on the left. Google Maps can tell you where a supermarket is; it
              cannot tell you which flooded neighbourhoods have none.
            </p>
          </div>
        )}

        {hover && (
          <div className="pointer-events-none absolute bottom-4 left-4 rounded-lg bg-white/95 p-3 text-xs shadow-lg ring-1 ring-slate-200">
            <p className="font-mono text-[11px] text-slate-500">{String(hover.geoid)}</p>
            <dl className="mt-1.5 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-slate-700">
              <dt>Population</dt>
              <dd className="text-right tabular-nums">{fmt.format(Number(hover.pop))}</dd>
              <dt>Median income</dt>
              <dd className="text-right tabular-nums">
                {money(hover.median_income === null ? null : Number(hover.median_income))}
                {hover.income_topcoded ? '+' : ''}
              </dd>
              <dt>In 100-yr floodplain</dt>
              <dd className="text-right tabular-nums">
                {(Number(hover.flood_pct) * 100).toFixed(0)}%
              </dd>
              <dt>To supermarket</dt>
              <dd className="text-right tabular-nums">
                {fmt.format(Math.round(Number(hover.dist_grocery_m)))} m
              </dd>
            </dl>
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
