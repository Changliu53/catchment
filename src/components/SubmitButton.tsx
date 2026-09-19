'use client';

/**
 * A submit button that says when it is working.
 *
 * Every write on this page is a Server Action reached through a plain form,
 * which means the browser's own navigation is the feedback — a favicon
 * spinner, somewhere the reader is not looking. On a fast connection that is
 * fine and on a cold serverless instance talking to a sleeping Postgres it is
 * a button that appears to have done nothing, so people press it again.
 *
 * `useFormStatus` reads the pending state of the form this sits inside, which
 * is why it is its own component rather than a prop on the form: the hook only
 * sees a form it is rendered *within*.
 *
 * The progressive-enhancement property is kept. On the server this renders an
 * ordinary submit button with its ordinary label, so with JavaScript switched
 * off the form still posts and the only thing missing is the spinner.
 */

import { useFormStatus } from 'react-dom';

interface Props {
  children: React.ReactNode;
  /** Shown while the action is in flight. */
  pending: string;
  className?: string;
}

export default function SubmitButton({ children, pending: pendingLabel, className }: Props) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`inline-flex items-center justify-center gap-1.5 disabled:cursor-progress disabled:opacity-70 ${className ?? ''}`}
    >
      {pending ? (
        <>
          {/* aria-hidden: the label already changed, and the live region in
              the form would otherwise announce a spinner. */}
          <span
            aria-hidden
            className="size-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent motion-reduce:animate-none"
          />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}
