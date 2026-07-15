'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
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
 * Skipped on the /blog index and on the colophon page itself.
 */
export default function NoteFooter() {
  const pathname = usePathname();
  if (!pathname || !pathname.startsWith('/blog/')) return null;

  const slug = pathname.replace(/^\/blog\//, '').replace(/\/$/, '');
  if (!slug || slug === 'how-these-are-made') return null;

  const rev = (revisions as Record<string, RevisionEntry>)[slug];
  const revisedDate = rev
    ? new Date(rev.revised).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;
  const sourcePath = rev?.path || `src/app/blog/${slug}/page.tsx`;

  return (
    <div className="bg-cream print:hidden">
      <div className="max-w-[var(--container-standard)] mx-auto px-6 md:px-12 pb-12">
        <div className="border-t border-border-light pt-6 text-sm text-muted space-y-1.5">
          <p>
            An AI-assisted research note from Source Library.{' '}
            <Link href="/blog/how-these-are-made" className="text-accent-rust hover:underline">
              How these notes are made
            </Link>
          </p>
          <p>
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
