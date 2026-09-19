/**
 * Keep this analysis, or manage the one you are looking at.
 *
 * A server component rendering plain forms bound to Server Actions, so saving,
 * renaming and deleting all work with JavaScript switched off — the same
 * property the rest of the page has. The client components inside it
 * (`SubmitButton`, `ShareLink`) only ever add to what the server sent.
 *
 * Signed out, it says what signing in would buy and nothing more. The offer is
 * the point: nobody should have to create an account to find out whether the
 * thing is worth keeping.
 *
 * The saved state is ordered by what the reader came for. It used to lead with
 * a rename field and a delete link, which is the order a CRUD form takes
 * rather than the order a person does: the sentence that got them to sign in
 * says "get a link you can share", so the link is the headline and the two
 * ways to change the row are folded away underneath it. Renaming is a thing
 * you do occasionally; sharing is the whole reason the row exists.
 */

import { deleteAnalysis, renameAnalysis, saveAnalysis } from '@/app/actions';
import ShareLink from '@/components/ShareLink';
import SubmitButton from '@/components/SubmitButton';
import { pathFor } from '@/lib/saved';

interface Props {
  /** False when this deployment has no database, and so no accounts. */
  accounts: boolean;
  signedIn: boolean;
  defaultTitle: string;
  presetId?: string;
  question?: string;
  /** Present when this page *is* a saved analysis. */
  saved?: { slug: string; title: string; mine: boolean };
  /** Absolute origin of this request, for the copyable link. */
  origin?: string;
}

/**
 * A disclosure whose trigger changes when it is open.
 *
 * The plain version of this was the complaint that started the rewrite: an
 * open `<details>` left "Delete" sitting above a second button also saying
 * "Delete", so a destructive control appeared to have been offered twice with
 * no way back. Swapping the label on `[open]` is pure CSS, costs nothing, and
 * turns the trigger into the cancel — which is what a reader reaches for.
 */
function Disclosure({
  label,
  open: openLabel,
  danger,
  children,
}: {
  label: string;
  open: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  const tone = danger ? 'text-slate-500 hover:text-red-700' : 'text-slate-500 hover:text-slate-900';

  return (
    <details className="group">
      <summary className={`cursor-pointer list-none underline-offset-2 hover:underline ${tone}`}>
        <span className="group-open:hidden">{label}</span>
        <span className="hidden group-open:inline">{openLabel}</span>
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

export default function SaveControls({
  accounts,
  signedIn,
  defaultTitle,
  presetId,
  question,
  saved,
  origin,
}: Props) {
  // Nothing to offer, and no point implying there is.
  if (!accounts && !saved) return null;

  if (saved) {
    const url = `${origin ?? ''}${pathFor(saved.slug)}`;

    return (
      <section className="rounded-md border border-slate-200 bg-white p-3 text-xs">
        <p className="text-slate-500">Saved analysis</p>
        <p className="mt-0.5 text-sm font-medium text-slate-900">{saved.title}</p>

        {saved.mine ? (
          <div className="mt-3 flex flex-col gap-3">
            <ShareLink url={url} />

            {/* Stacked rather than side by side. Two triggers on one line is
                tidier closed and worse open: the expanded confirmation is
                then squeezed into half the panel, starting at its middle,
                which reads as a mistake. Each one opens under itself. */}
            <div className="flex flex-col gap-2 border-t border-slate-100 pt-2.5">
              {/* "Rename this analysis" rather than "Rename", to match the
                  control beside it and because the button inside this one is
                  also called Rename. Two controls with one label in a single
                  panel is ambiguous on screen and worse read aloud. */}
              <Disclosure label="Rename this analysis" open="Cancel">
                <form action={renameAnalysis} className="flex gap-2">
                  <input type="hidden" name="slug" value={saved.slug} />
                  <input
                    name="title"
                    defaultValue={saved.title}
                    maxLength={120}
                    aria-label="Analysis name"
                    className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 outline-none focus:border-blue-500"
                  />
                  <SubmitButton
                    pending="Renaming"
                    className="shrink-0 rounded bg-slate-900 px-2.5 py-1 font-medium text-white transition hover:bg-slate-700"
                  >
                    Rename
                  </SubmitButton>
                </form>
              </Disclosure>

              {/* Two steps, and a native <details> rather than a confirm()
                  dialog: deleting is irreversible and there is no undo, but
                  the rest of this page works with JavaScript switched off and
                  a destructive action is the last place to make an
                  exception. */}
              <Disclosure label="Delete this analysis" open="Keep it" danger>
                <form action={deleteAnalysis} className="flex items-center gap-2">
                  <input type="hidden" name="slug" value={saved.slug} />
                  <span className="text-slate-500">This cannot be undone.</span>
                  <SubmitButton
                    pending="Deleting"
                    className="rounded border border-red-300 px-2 py-0.5 font-medium text-red-700 transition hover:bg-red-50"
                  >
                    Delete
                  </SubmitButton>
                </form>
              </Disclosure>
            </div>
          </div>
        ) : (
          <p className="mt-1.5 leading-relaxed text-slate-600">
            Someone shared this. The question is re-run against the current data every time it is
            opened, so what you see is not a snapshot of what they saw.
          </p>
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
      <SubmitButton
        pending="Saving"
        className="shrink-0 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
      >
        Save
      </SubmitButton>
    </form>
  );
}
