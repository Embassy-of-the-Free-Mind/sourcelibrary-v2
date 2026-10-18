'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BLOG_KINDS } from '@/app/articles/posts';
import revisions from '@/generated/blog-revisions.json';

const REPO = 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2';

interface RevisionEntry {
  path: string;
  published: string;
  revised: string;
  revisions: number;
}

/**
 * Standard footer for research notes — the AI-disclosure line, the revision
 * record, and the correction channel.
 *
 * Rendered once from the blog layout so every note gets it without per-post
 * edits. The notes are living documents: their full revision history is
 * public on GitHub, and "last revised" is a feature, not a confession.
 * Revision dates come from src/generated/blog-revisions.json, regenerated
 * from git history by scripts/maintenance/generate-blog-revisions.mjs (run
 * automatically by scripts/deploy-prod.sh).
 *
 * Skipped on the /articles index, the category pages and on the colophon page itself.
 */
export default function NoteFooter() {
  const pathname = usePathname();
  if (!pathname || !pathname.startsWith('/articles/')) return null;

  const slug = pathname.replace(/^\/articles\//, '').replace(/\/$/, '');
  if (!slug || slug === 'how-these-are-made' || (BLOG_KINDS as readonly string[]).includes(slug)) return null;

  const rev = (revisions as Record<string, RevisionEntry>)[slug];
  const revisedDate = rev
    ? new Date(rev.revised).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    : null;
  const sourcePath = rev?.path || `src/app/articles/${slug}/page.tsx`;

  return (
    <div className="bg-cream print:hidden">
      <div className="max-w-[var(--container-standard)] mx-auto px-6 md:px-12 pb-16">
        <div className="border border-border-light bg-white px-6 py-6 md:px-8 md:py-7">
          <h2 className="font-serif text-xl text-primary">How this article was made</h2>
          <div className="mt-3 space-y-3 font-body text-secondary leading-relaxed">
            <p>
              This is an AI-assisted article. Derek Lomas set the question; AI models searched the library, read the
              sources and drafted the text, which was reviewed before it was published.
            </p>
            <p>
              Every quotation is checked by machine against the scanned page it comes from and links to that page, so
              you can read the original yourself. The article is a living document: it is revised when a reader finds
              an error or the library gains a better source.
            </p>
          </div>
          <p className="mt-5 pt-4 border-t border-border-light text-sm text-muted">
            <Link href="/articles/how-these-are-made" className="text-secondary underline decoration-border-light underline-offset-2 hover:decoration-secondary">
              How these articles are made
            </Link>
            {' '}&middot;{' '}
            {revisedDate && <>Last revised {revisedDate} &middot; </>}
            <a
              href={`${REPO}/commits/main/${sourcePath}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-secondary underline decoration-border-light underline-offset-2"
            >
              Revision history
            </a>
            {' '}&middot; Spot an error?{' '}
            <a
              href={`${REPO}/edit/main/${sourcePath}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-secondary underline decoration-border-light underline-offset-2"
            >
              Suggest an edit
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
