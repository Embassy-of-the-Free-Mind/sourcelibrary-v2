'use client';

import Link from 'next/link';
import { bookUrl } from '@/lib/slugify';
import { getBookThumbnailUrl } from '@/lib/utils';
import { yearOfHit, type AskWork } from '@/lib/catalog/ask-client';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Snippet split into plain and highlighted runs (no HTML is injected). */
function runs(snippet: string, topic: string): { text: string; mark: boolean }[] {
  const stems = topic.split(/\s+/).filter((w) => w.length > 3).map((w) => escapeRe(w.slice(0, Math.max(4, w.length - 2))));
  if (!stems.length) return [{ text: snippet, mark: false }];
  const re = new RegExp(`\\b(?:${stems.join('|')})\\w*`, 'gi');
  const out: { text: string; mark: boolean }[] = [];
  let last = 0;
  for (const m of snippet.matchAll(re)) {
    if (m.index! > last) out.push({ text: snippet.slice(last, m.index), mark: false });
    out.push({ text: m[0], mark: true });
    last = m.index! + m[0].length;
  }
  if (last < snippet.length) out.push({ text: snippet.slice(last), mark: false });
  return out;
}

/**
 * The asked results as a list: each work with the page that answered the
 * request, linked straight to that page, and the other name that found it when
 * it was not the reader's own word. Snippets are the search route's own,
 * already stripped of editorial wrappers (quote-and-snippet-integrity.md).
 */
export default function AskWorkList({ works, topic }: { works: AskWork[]; topic: string }) {
  const rows = works.map(({ hit, page, via }) => {
    const id = hit.book_id || hit.id;
    const base = bookUrl({ slug: hit.slug ?? undefined, id });
    const year = yearOfHit(hit);
    const snippet = page?.snippet?.trim() || '';
    return {
      key: id,
      href: page?.page_number ? `${base}/page-number/${page.page_number}` : base,
      cover: getBookThumbnailUrl({ thumbnail: hit.thumbnail, thumbnail_blob: hit.thumbnail_blob }, 'thumb'),
      title: hit.display_title || hit.title,
      meta: [hit.author || 'Unknown', year != null ? String(year) : '', hit.language || '', via ? `found under “${via}”` : ''].filter(Boolean).join(' · '),
      parts: snippet ? runs(snippet, via || topic) : [],
      pageLabel: page?.page_number ? `page ${page.page_number}` : '',
    };
  });
  return (
    <div>
      {rows.map((r) => (
        <Link key={r.key} href={r.href} className="grid grid-cols-[52px_1fr] sm:grid-cols-[72px_1fr] gap-3.5 sm:gap-5 py-5 border-b border-border-light group">
          <div className="bg-warm border border-border-light self-start min-h-[70px] sm:min-h-24">
            {r.cover && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={r.cover} alt="" loading="lazy" className="w-full block" />
            )}
          </div>
          <div className="min-w-0">
            <div className="text-[19px] leading-snug text-primary group-hover:underline decoration-border-medium underline-offset-[3px]" style={{ fontFamily: 'var(--font-body)' }}>{r.title}</div>
            <div className="text-[13.5px] text-muted mt-0.5">{r.meta}</div>
            {r.parts.length > 0 && (
              <blockquote className="mt-2.5 pl-3.5 border-l-2 border-border-medium text-[15.5px] leading-relaxed text-secondary" style={{ fontFamily: 'var(--font-body)' }}>
                {r.parts.map((p, i) => (p.mark ? <mark key={i} className="bg-search-highlight text-inherit">{p.text}</mark> : <span key={i}>{p.text}</span>))}
                <small className="block mt-1 text-[12.5px] text-muted" style={{ fontFamily: 'var(--font-sans)' }}>{r.pageLabel}</small>
              </blockquote>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}
