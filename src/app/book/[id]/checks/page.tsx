import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { getReadDb } from '@/lib/mongodb';
import { findBookForTenant } from '@/lib/tenant-catalog-books';
import { getTenantContext } from '@/lib/tenant-context';
import { isHiddenBook } from '@/lib/book-access';
import { stalePages, type BookCheck, type PageFinding } from '@/lib/book-checks';
import { loadBookChecks, ownChecks, deriveWarnings, checkAnchor, pageAnchor, kindsOfFinding } from '@/lib/book-warnings';
import { CHECK_METHODS, methodDocUrl, evidenceUrl, issueUrl } from '@/lib/check-methods';
import { READER_UI_STRINGS } from '@/lib/reader-strings';

/**
 * /book/[id]/checks — the evidence a reader's quality warning links to (#6199).
 *
 * Every stored check of this book (book_checks, #6174): which pages were read, by whom, what was found, when. A
 * warning in the reader links to a fragment here (#check-<method>-<run>, or …-p<page> for one page), so a scholar
 * lands on the finding itself rather than on a methods essay. Wording follows .claude/docs/quality-statements.md.
 *
 * Reviewer sentences are shown only when the evidence file is public: a row whose evidence is in the private ops
 * repo (`ops:`) shows its defect classes and nothing a reviewer wrote.
 */
export const dynamic = 'force-dynamic';
export const preferredRegion = 'fra1';

interface PageProps {
  params: Promise<{ id: string }>;
}

const BOOK_PROJECTION = { _id: 0, id: 1, slug: 1, title: 1, display_title: 1, visible: 1, hidden: 1, publication: 1, tenantId: 1 };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const ctx = await getTenantContext();
  const db = await getReadDb();
  const result = await findBookForTenant(db, id, { _id: 0, title: 1, display_title: 1 }, ctx);
  const title = result ? result.book.display_title || result.book.title : null;
  return {
    title: title ? `Quality checks — ${title} - Source Library` : 'Book Not Found - Source Library',
    robots: { index: false, follow: true },
    alternates: { canonical: `/book/${id}/checks` },
  };
}

const KIND_TEXT = READER_UI_STRINGS.en.info.qualityKinds;
const STAGE_LABEL = { ocr: 'Transcription', translation: 'English', other: 'Page' } as const;
const RESULT = {
  show: 'No serious errors on the pages read.',
  caveat: 'Usable, with the weaknesses named below.',
  fix: 'Serious errors on the pages read.',
} as const;

const day = (d: Date | string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1) + (/[.!?]$/.test(s) ? '' : '.');

function readerLine(r: BookCheck['reader']): string {
  if (r.kind === 'detector') return 'An automated check. No person or AI reviewer read these pages.';
  const who = r.kind === 'human' ? 'A reviewer' : `An AI reviewer${r.model ? ` (${r.model})` : ''}`;
  const how = r.image_opened === true ? 'reading each page against its image'
    : r.image_opened === false ? 'reading the text only, without the page image'
      : 'whether the page image was opened was not recorded';
  return `${who}, ${how}.`;
}

function Finding({ row, finding, stale, bookPath, showSentences }: {
  row: BookCheck; finding: PageFinding; stale: boolean; bookPath: string; showSentences: boolean;
}) {
  const fallback = kindsOfFinding(finding);
  return (
    <div
      id={pageAnchor(row, finding.page_number)}
      className="scroll-mt-6 rounded px-3 py-2 -mx-3 target:outline target:outline-2 target:outline-[var(--accent-gold-dark)]"
      style={{ opacity: stale ? 0.6 : 1 }}
    >
      <p className="font-sans text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
        {finding.page_number > 0
          ? <Link href={`/book/${bookPath}/page-number/${finding.page_number}`} className="underline underline-offset-2">Page {finding.page_number}</Link>
          : <>Page {finding.page_number}</>}
      </p>
      {stale && (
        <p className="font-sans text-[13px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
          The text of this page has changed since this check, so the finding below is no longer shown in the reader.
        </p>
      )}
      <ul className="mt-1 space-y-1 font-sans text-[14px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
        {finding.wrong_page && <li>{sentence(KIND_TEXT.wrong_page)}</li>}
        {finding.errors.map((e, i) => (
          <li key={i}>
            <span style={{ color: 'var(--text-muted)' }}>{STAGE_LABEL[e.stage]}:</span>
            {showSentences && e.problem ? sentence(e.problem) : sentence(KIND_TEXT[kindsOfFinding({ ...finding, wrong_page: undefined, errors: [e] })[0] ?? fallback[0]])}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default async function BookChecksPage({ params }: PageProps) {
  const { id } = await params;
  const ctx = await getTenantContext();
  const db = await getReadDb();
  const found = await findBookForTenant(db, id, BOOK_PROJECTION, ctx);
  if (!found) notFound();
  const book = found.book as unknown as { id: string; slug?: string; title: string; display_title?: string };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (isHiddenBook(found.book as any)) notFound();

  const bookPath = book.slug || book.id;
  const { rows, stamps } = await loadBookChecks(db, [book.id]);
  const checks = ownChecks(rows);
  const warnings = deriveWarnings(rows, stamps);
  const title = book.display_title || book.title;

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-cream)' }}>
      <main className="max-w-2xl mx-auto px-4 py-10 sm:py-14">
        <p className="font-sans text-sm">
          <Link href={`/book/${bookPath}`} className="underline underline-offset-2" style={{ color: 'var(--accent-rust)' }}>← {title}</Link>
        </p>
        <h1 className="font-serif text-3xl mt-4 leading-tight" style={{ color: 'var(--text-primary)' }}>Quality checks of this book</h1>
        <p className="font-sans text-[15px] leading-relaxed mt-4" style={{ color: 'var(--text-secondary)' }}>
          Each time pages of this book were read against their images, or flagged by an automated check, the record is
          kept here: which pages, read by whom, what was found, and when. A check describes the pages it read, not the
          whole book. Most reviewers are AI models; each record says who read.
        </p>
        <p className="font-sans text-[15px] leading-relaxed mt-3" style={{ color: 'var(--text-secondary)' }}>
          A finding describes the text as it was when the check read it. When a page’s text has since been replaced,
          the finding is marked as no longer current and the reader stops showing its warning.
        </p>

        {checks.length === 0 && (
          <p className="font-sans text-[15px] mt-8 pt-6 border-t" style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-light)' }}>
            No check of this book has been recorded yet.
          </p>
        )}

        {checks.map((row) => {
          const stale = new Set(stalePages(row, stamps));
          const isPublic = !row.evidence_path.startsWith('ops:');
          const method = CHECK_METHODS[row.method_id];
          const evidence = evidenceUrl(row.evidence_path);
          const current = warnings.book?.anchor === checkAnchor(row);
          return (
            <section
              key={`${row.method_id}/${row.run_id}`}
              id={checkAnchor(row)}
              className="scroll-mt-6 mt-8 pt-6 border-t target:outline target:outline-2 target:outline-offset-8 target:outline-[var(--accent-gold-dark)]"
              style={{ borderColor: 'var(--border-light)' }}
            >
              <h2 className="font-serif text-xl" style={{ color: 'var(--text-primary)' }}>{day(row.checked_at)}</h2>
              <p className="font-sans text-sm mt-1" style={{ color: 'var(--text-muted)' }}>{method?.label ?? row.method_id}</p>

              <dl className="mt-4 space-y-2 font-sans text-[14px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                <div>
                  <dt className="inline font-medium" style={{ color: 'var(--text-primary)' }}>Read by: </dt>
                  <dd className="inline">{readerLine(row.reader)}</dd>
                </div>
                <div>
                  <dt className="inline font-medium" style={{ color: 'var(--text-primary)' }}>Pages read: </dt>
                  <dd className="inline">
                    {row.pages_read.map((n, i) => (
                      <span key={n}>
                        {i > 0 && ', '}
                        {n > 0
                          ? <Link href={`/book/${bookPath}/page-number/${n}`} className="underline underline-offset-2">{n}</Link>
                          : <span title="Not shown in the reader">{n}</span>}
                        {stale.has(n) && <span style={{ color: 'var(--text-muted)' }}> (text changed since)</span>}
                      </span>
                    ))}
                  </dd>
                </div>
                <div>
                  <dt className="inline font-medium" style={{ color: 'var(--text-primary)' }}>Result: </dt>
                  <dd className="inline">
                    {row.reader.kind === 'detector' ? 'Flagged. Not yet read by a person.' : RESULT[row.verdict]}
                    {current && warnings.book?.pagesSerious != null && (
                      <> Serious errors on {warnings.book.pagesSerious} of the {warnings.book.pagesRead} pages whose text is unchanged.</>
                    )}
                  </dd>
                </div>
              </dl>

              {isPublic && row.note && (
                <blockquote className="mt-4 pl-4 border-l-2 font-serif text-[15.5px] leading-relaxed" style={{ borderColor: 'var(--border-light)', color: 'var(--text-secondary)' }}>
                  <span className="block font-sans text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
                    {row.reader.kind === 'human' ? 'Reviewer’s note' : 'AI reviewer’s note'}
                  </span>
                  {row.note}
                </blockquote>
              )}

              {row.page_findings && row.page_findings.length > 0 && (
                <div className="mt-4 space-y-2">
                  <h3 className="font-sans text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Serious findings, by page</h3>
                  {row.page_findings.map((f) => (
                    <Finding key={f.page_number} row={row} finding={f} stale={stale.has(f.page_number)} bookPath={bookPath} showSentences={isPublic} />
                  ))}
                </div>
              )}
              {row.page_findings && row.page_findings.length === 0 && row.reader.kind !== 'detector' && (
                <p className="mt-4 font-sans text-[14px]" style={{ color: 'var(--text-secondary)' }}>No serious finding on any page read.</p>
              )}

              <p className="mt-4 font-sans text-[13px]" style={{ color: 'var(--text-muted)' }}>
                <a href={methodDocUrl(row.method_id)} target="_blank" rel="noreferrer" className="underline underline-offset-2">How this check works</a>
                {method?.issue && (
                  <>{' · '}<a href={issueUrl(method.issue)} target="_blank" rel="noreferrer" className="underline underline-offset-2">What the check looks for</a></>
                )}
                {' · '}
                {evidence
                  ? <a href={evidence} target="_blank" rel="noreferrer" className="underline underline-offset-2">Full review file</a>
                  : <>The reviewer’s full notes are not public.</>}
                {' · '}<span className="font-mono text-[12px]">{row.run_id}</span>
              </p>
            </section>
          );
        })}
      </main>
    </div>
  );
}
