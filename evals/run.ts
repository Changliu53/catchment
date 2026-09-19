/**
 * The live evaluation run.
 *
 *     ANTHROPIC_API_KEY=... npm run eval
 *     npm run eval -- --tag decline        # one category
 *     npm run eval -- --threshold 0.9      # fail below this pass rate
 *
 * Calls the real model once per case, grades each one with the same grader the
 * offline tests exercise, and exits non-zero if the pass rate falls below the
 * threshold.
 *
 * This is deliberately not on the push path. A model call per push is a bill
 * that grows with commit frequency, a third-party dependency in the gate that
 * decides whether code ships, and — because the model is non-deterministic —
 * a build that can fail for reasons the commit did not cause. A CI job that
 * goes red on its own teaches people to ignore red.
 *
 * What runs on every push is `src/lib/__tests__/evals.test.ts`, which checks
 * that the corpus is well-formed and that the grader discriminates. The live
 * run belongs on a schedule and on demand, where a drop in the score is
 * information rather than a blocked deploy.
 */

import { CASES } from './cases';
import { grade, report, type Grade } from './grade';

// Imported lazily so `--help` and a missing key fail before anything is built.
type Planner = (question: string) => Promise<unknown>;

const GREEN = '\u001b[32m';
const RED = '\u001b[31m';
const DIM = '\u001b[2m';
const OFF = '\u001b[0m';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

/**
 * One at a time, on purpose.
 *
 * Thirty concurrent requests is a faster way to discover the account's rate
 * limit than to discover the model's accuracy, and a run that half-fails on
 * 429s produces a score that looks like a regression.
 */
async function runAll(planFromQuestion: Planner, cases: typeof CASES): Promise<Grade[]> {
  const grades: Grade[] = [];

  for (const [i, c] of cases.entries()) {
    const at = `${String(i + 1).padStart(2)}/${cases.length}`;
    let g: Grade;
    try {
      g = grade(c, await planFromQuestion(c.question));
    } catch (err) {
      g = { id: c.id, tag: c.tag, pass: false, reason: `call failed: ${String(err)}` };
    }

    const mark = g.pass ? `${GREEN}pass${OFF}` : `${RED}FAIL${OFF}`;
    console.log(`${DIM}${at}${OFF} ${mark}  ${c.id.padEnd(24)} ${DIM}${c.tag}${OFF}`);
    if (!g.pass) console.log(`         ${RED}${g.reason}${OFF}`);
    grades.push(g);
  }

  return grades;
}

async function main(): Promise<number> {
  if (!process.env['ANTHROPIC_API_KEY']) {
    console.error('ANTHROPIC_API_KEY is not set. This run calls the real model.');
    return 1;
  }

  const tag = arg('tag');
  const threshold = Number(arg('threshold') ?? 0.85);
  const cases = tag ? CASES.filter((c) => c.tag === tag) : CASES;

  if (cases.length === 0) {
    console.error(`no cases tagged "${tag}"`);
    return 1;
  }

  const { planFromQuestion } = await import('../src/lib/orchestrate');
  console.log(`${cases.length} cases, model ${process.env['ANTHROPIC_MODEL'] ?? '(default)'}\n`);

  const r = report(await runAll(planFromQuestion, cases));

  console.log(`\n${r.passed}/${r.total} — ${(r.score * 100).toFixed(0)}%`);
  for (const [name, { passed, total }] of Object.entries(r.byTag)) {
    console.log(`  ${name.padEnd(12)} ${passed}/${total}`);
  }

  if (r.score < threshold) {
    console.error(`\nbelow the ${(threshold * 100).toFixed(0)}% threshold`);
    return 1;
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
