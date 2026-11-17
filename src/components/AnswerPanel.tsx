/**
 * The answer, as HTML.
 *
 * No 'use client' and no state: this renders on the server and ships in the
 * first response, so the numbers are readable before any JavaScript runs and a
 * shared link shows its answer to anything that can read HTML.
 */

import type { Answer } from '@/lib/answer';
import { formatValue, labelFor } from '@/lib/format';

const fmt = new Intl.NumberFormat('en-US');

const share = (part: number, whole: number) => ((part / whole) * 100).toFixed(1);

/**
 * The sentence that states the answer.
 *
 * It used to report only the rows on the map. When a plan ends in a rank step
 * those are a top n, not the answer: the flood-and-grocery preset found 196
 * block groups and the page said "50 block groups, 139,787 people". So the
 * qualifying count gets its own sentence, and the one about what is drawn
 * says it is a selection.
 *
 * The drawn count stays first in its sentence ("50 of …"): the end-to-end
 * suite reads it from there and checks it against what the map rendered.
 */
function Headline({ answer }: { answer: Answer }) {
  const { totals, comparison, rankedBy } = answer;
  const drawn = fmt.format(answer.matched);
  const county = fmt.format(totals.blockGroups);

  if (comparison) {
    const compared = comparison.above.n + comparison.below.n;
    return (
      <p className="text-sm text-slate-700">
        <strong className="tabular-nums">{drawn}</strong> of {county} block groups are on the map;
        the <strong className="tabular-nums">{fmt.format(compared)}</strong> with a value for both
        fields are compared below.
      </p>
    );
  }

  if (!rankedBy) {
    return (
      <p className="text-sm text-slate-700">
        <strong className="tabular-nums">{drawn}</strong> of {county} block groups,{' '}
        <strong className="tabular-nums">{fmt.format(answer.matchedPopulation)}</strong> people (
        {share(answer.matchedPopulation, totals.population)}% of the county).
      </p>
    );
  }

  const order = `${rankedBy.dir === 'desc' ? 'highest' : 'lowest'} ${labelFor(rankedBy.measure).toLowerCase()}`;

  // A rank over the whole county ("the 50 densest") has no conditions to
  // report, so the drawn rows are the answer and get the population.
  if (answer.qualified === totals.blockGroups) {
    return (
      <p className="text-sm text-slate-700">
        <strong className="tabular-nums">{drawn}</strong> of {county} block groups, the ones with
        the {order}:{' '}
        <strong className="tabular-nums">{fmt.format(answer.matchedPopulation)}</strong> people (
        {share(answer.matchedPopulation, totals.population)}% of the county).
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1 text-sm text-slate-700">
      <p>
        <strong className="tabular-nums">{fmt.format(answer.qualified)}</strong> block groups meet
        every condition, home to{' '}
        <strong className="tabular-nums">{fmt.format(answer.qualifiedPopulation)}</strong> people (
        {share(answer.qualifiedPopulation, totals.population)}% of the county).
      </p>
      <p className="text-xs text-slate-600">
        <span className="tabular-nums">{drawn}</span> of {fmt.format(answer.qualified)} block groups
        are on the map and in the table: the ones with the {order}.
      </p>
    </div>
  );
}

export default function AnswerPanel({ answer }: { answer: Answer }) {
  const { plan, trace, comparison } = answer;

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
          No block groups match. That is an answer, not an error — nothing in the county meets every
          condition at once.
        </p>
      ) : (
        <Headline answer={answer} />
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
  // Every value goes through the field's own formatter. This used to be a
  // dollar formatter for everything, so comparing population density printed
  // "$1,828" — right for the one preset, wrong for any other measure.
  const v = (x: number | null) => formatValue(c.measure, x);
  const split = labelFor(c.split_on);
  const at = formatValue(c.split_on, c.threshold);
  const rows = [
    { label: `${split} ≥ ${at}`, s: c.above },
    { label: `${split} < ${at}`, s: c.below },
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
              <td className="py-1 pr-2 text-[11px] text-slate-700">{r.label}</td>
              <td className="text-right tabular-nums">{fmt.format(r.s.n)}</td>
              <td className="text-right tabular-nums">{v(r.s.median)}</td>
              <td className="text-right tabular-nums text-slate-500">
                {v(r.s.p25)}–{v(r.s.p75)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
        {c.measure === 'median_income'
          ? 'Medians, not means: median income is top-coded at $250,001, so averaging understates the wealthier group. '
          : 'Medians, not means: these distributions are skewed, and a few extreme block groups would move a mean. '}
        This shows a difference in distribution, not a cause.
      </p>
    </div>
  );
}
