/**
 * The answer, as HTML.
 *
 * No 'use client' and no state: this renders on the server and ships in the
 * first response, so the numbers are readable before any JavaScript runs and a
 * shared link shows its answer to anything that can read HTML.
 */

import type { Answer } from '@/lib/answer';

const fmt = new Intl.NumberFormat('en-US');
const money = (v: number | null) => (v === null ? '—' : `$${fmt.format(Math.round(v))}`);

export default function AnswerPanel({ answer }: { answer: Answer }) {
  const { plan, trace, totals, comparison } = answer;

  return (
    <section className="flex flex-col gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">{plan.title}</h2>
          <span className="shrink-0 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600">
            {answer.source}
          </span>
        </div>
        {answer.reading && (
          <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{answer.reading}</p>
        )}
      </div>

      {answer.empty ? (
        <p className="text-sm text-slate-700">
          No block groups match. That is an answer, not an error — nothing in the county meets
          every condition at once.
        </p>
      ) : (
        <p className="text-sm text-slate-700">
          <strong className="tabular-nums">{fmt.format(answer.matched)}</strong> of{' '}
          {fmt.format(totals.blockGroups)} block groups,{' '}
          <strong className="tabular-nums">{fmt.format(answer.matchedPopulation)}</strong> people (
          {((answer.matchedPopulation / totals.population) * 100).toFixed(1)}% of the county).
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

function Comparison({ c }: { c: NonNullable<Answer['comparison']> }) {
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
