/**
 * Keep this analysis, or manage the one you are looking at.
 *
 * A server component rendering plain forms bound to Server Actions, so saving,
 * renaming and deleting all work with JavaScript switched off — the same
 * property the rest of the page has. No client state, no fetch.
 *
 * Signed out, it says what signing in would buy and nothing more. The offer is
 * the point: nobody should have to create an account to find out whether the
 * thing is worth keeping.
 */

import { deleteAnalysis, renameAnalysis, saveAnalysis } from '@/app/actions';

interface Props {
  /** False when this deployment has no database, and so no accounts. */
  accounts: boolean;
  signedIn: boolean;
  defaultTitle: string;
  presetId?: string;
  question?: string;
  /** Present when this page *is* a saved analysis. */
  saved?: { slug: string; title: string; mine: boolean };
}

export default function SaveControls({
  accounts,
  signedIn,
  defaultTitle,
  presetId,
  question,
  saved,
}: Props) {
  // Nothing to offer, and no point implying there is.
  if (!accounts && !saved) return null;

  if (saved) {
    return (
      <section className="rounded-md border border-slate-200 bg-white p-3 text-xs">
        <p className="text-slate-500">Saved analysis</p>

        {saved.mine ? (
          <div className="mt-2 flex flex-col gap-2">
            <form action={renameAnalysis} className="flex gap-2">
              <input type="hidden" name="slug" value={saved.slug} />
              <input
                name="title"
                defaultValue={saved.title}
                maxLength={120}
                aria-label="Analysis name"
                className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 outline-none focus:border-blue-500"
              />
              <button className="rounded bg-slate-900 px-2.5 py-1 font-medium text-white transition hover:bg-slate-700">
                Rename
              </button>
            </form>

            <form action={deleteAnalysis}>
              <input type="hidden" name="slug" value={saved.slug} />
              <button className="text-slate-500 underline-offset-2 hover:text-red-700 hover:underline">
                Delete this analysis
              </button>
            </form>
          </div>
        ) : (
          <>
            {/* The name the sender chose. It is in the page title and the
                social card, and it is what a reader was told they were
                opening — so it belongs on the page too, rather than leaving
                them to match the plan's own heading against it. */}
            <p className="mt-0.5 text-sm font-medium text-slate-900">{saved.title}</p>
            <p className="mt-1.5 leading-relaxed text-slate-600">
              Someone shared this. The question is re-run against the current data every time it is
              opened, so what you see is not a snapshot of what they saw.
            </p>
          </>
        )}
      </section>
    );
  }

  if (!signedIn) {
    return (
      <p className="text-xs leading-relaxed text-slate-500">
        Sign in to keep this question and get a link you can share. Everything else here works
        without an account.
      </p>
    );
  }

  return (
    <form action={saveAnalysis} className="flex gap-2">
      <input type="hidden" name="presetId" value={presetId ?? ''} />
      <input type="hidden" name="question" value={question ?? ''} />
      <input
        name="title"
        defaultValue={defaultTitle}
        maxLength={120}
        aria-label="Name for this analysis"
        className="min-w-0 flex-1 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:border-blue-500"
      />
      <button className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50">
        Save
      </button>
    </form>
  );
}
