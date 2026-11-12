import { ReactNode } from 'react';

/**
 * An optional aside in an article: historical background a reader can skip.
 * The main text must read on without it. On the web it is a tinted panel with
 * a small "Context" label; the EPUB builder maps it to <aside class="context">.
 * Keep children to plain paragraphs and inline elements.
 *
 *   <ContextNote title="What the monsoon meant">
 *     <p>The winds of the Indian Ocean ...</p>
 *   </ContextNote>
 */
export default function ContextNote({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <aside
      className="not-prose my-10 rounded-md border border-border-light bg-warm px-5 py-4 md:px-6 md:py-5 font-sans text-[0.95rem] leading-relaxed text-secondary [&_p]:mb-3 [&_p:last-child]:mb-0"
      aria-label={typeof title === 'string' ? `Context: ${title}` : 'Context'}
    >
      <div className="mb-1 text-xs uppercase tracking-wider text-muted">Context</div>
      <div className="mb-3 text-base font-semibold text-primary">{title}</div>
      {children}
    </aside>
  );
}
