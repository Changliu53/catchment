/**
 * Shown while the server works out an answer.
 *
 * It mirrors the real layout rather than centring a spinner, so the page does
 * not jump when the answer arrives: the controls keep their 45% on a phone and
 * their 26rem column on a laptop, and the map keeps the rest. A spinner in the
 * middle of the viewport would be replaced by a completely different shape.
 */

export default function Loading() {
  return (
    <main className="flex h-dvh flex-col lg:flex-row" aria-busy="true">
      <aside className="flex h-[45dvh] w-full shrink-0 flex-col gap-5 overflow-hidden border-b border-slate-200 bg-white p-5 lg:h-full lg:w-[26rem] lg:border-b-0 lg:border-r">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-slate-900">Catchment</h1>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">
            Flood exposure and service access across Harris County, Texas.
          </p>
        </div>

        <div className="h-10 animate-pulse rounded-md bg-slate-100" />

        <div className="flex flex-col gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
          <div className="h-4 w-2/3 animate-pulse rounded bg-slate-200" />
          <div className="h-3 w-full animate-pulse rounded bg-slate-100" />
          <div className="h-3 w-5/6 animate-pulse rounded bg-slate-100" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-slate-200" />
        </div>

        <div className="flex flex-col gap-1.5">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-11 animate-pulse rounded-md bg-slate-100" />
          ))}
        </div>

        <p className="sr-only">Working out the answer.</p>
      </aside>

      <div className="min-h-0 flex-1 animate-pulse bg-slate-100" />
    </main>
  );
}
