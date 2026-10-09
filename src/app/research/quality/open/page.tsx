import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { AS_OF, GROUPS, SHIPPED, type Status } from './issues';

// What is still open in text quality, as a companion to the working paper /research/quality.
// The rows live in ./issues.ts so a status change is a one-line edit; the GitHub issue stays the record.
export const revalidate = false;

export const metadata: Metadata = {
  title: 'Open Quality Work — Source Library Research',
  description:
    'Known defects in Source Library’s transcriptions and translations, the measurements under way, and what has already changed, each linked to its public issue.',
  alternates: { canonical: '/research/quality/open' },
};

const ISSUE = 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/';
const PULL = 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/pull/';

const STATUS: Record<Status, { label: string; className: string }> = {
  defect: { label: 'Known defect', className: 'bg-red-50 text-red-800 border-red-200' },
  running: { label: 'In progress', className: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  planned: { label: 'Not started', className: 'bg-stone-100 text-stone-600 border-stone-200' },
};

function Chip({ status }: { status: Status }) {
  const s = STATUS[status];
  return (
    <span className={`inline-block whitespace-nowrap rounded-sm border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${s.className}`}>
      {s.label}
    </span>
  );
}

export default function OpenQualityWorkPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Open quality work"
          subtitle="What we know is wrong with our transcriptions and translations, what we are measuring now, and what has already changed"
        >
          <p className="text-stone-400 text-sm mt-4">Status as of {AS_OF} &middot; companion to <Link href="/research/quality" className="underline hover:text-stone-200">How page quality is measured</Link></p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <div className="mb-6">
        <Link href="/research/quality" className="inline-flex items-center gap-2 text-muted hover:text-secondary transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          How page quality is measured
        </Link>
      </div>

      <article className="max-w-3xl">
        <section className="border-l-2 border-accent-rust pl-5 md:pl-6 mb-10">
          <h2 className="text-xs uppercase tracking-[0.16em] text-muted font-semibold mb-4">Where we stand</h2>
          <p className="text-secondary leading-relaxed mb-4">
            In early October 2026 we scored our English against published human translations of the same pages: 321 pages,
            one per book, in 14 languages. Where the page was transcribed correctly the English is mostly faithful. Latin print
            after 1500, the European vernaculars and the typed Tibetan have 86–99% of pages at 4 or 5 of 5. Greek manuscripts,
            early Greek print, Latin incunabula, Persian and Arabic do not.
          </p>
          <p className="text-secondary leading-relaxed mb-4">
            Most of the worst pages start with a misread. Of 85 low-scoring pages opened by eye, the transcription caused 40.
            Correcting the transcription raised a page by 0.7 to 1.8 points. A stronger translation model raised it by 0.2 to
            0.5, and no change to the prompt helped.
          </p>
          <p className="text-secondary leading-relaxed">
            Every figure, with its method and its confidence interval, is in the{' '}
            <Link href="/research/quality#against-references" className="text-accent-rust hover:underline">working paper</Link>.
            This page lists what is still open. Each item links to its public issue, which is the current record. What it
            costs to read every remaining book, and how each kind of page gets its engine, is in{' '}
            <Link href="/research/reading-plan" className="text-accent-rust hover:underline">the reading plan</Link>.
          </p>
        </section>

        <div className="flex flex-wrap gap-x-5 gap-y-2 items-center text-sm text-muted mb-8">
          {(Object.keys(STATUS) as Status[]).map(s => (
            <span key={s} className="inline-flex items-center gap-2"><Chip status={s} /></span>
          ))}
        </div>

        {GROUPS.map(group => (
          <section key={group.id} id={group.id} className="mb-12 scroll-mt-24">
            <h2 className="text-xl md:text-2xl text-primary mb-2 text-balance border-t-2 border-stone-800 pt-4">{group.title}</h2>
            {group.intro && <p className="text-muted leading-relaxed mb-2">{group.intro}</p>}
            <ul>
              {group.issues.map((it, i) => (
                <li key={`${it.n}-${i}`} className="grid grid-cols-[1fr_auto] md:grid-cols-[4.5rem_1fr_auto] gap-x-4 gap-y-1 py-4 border-b border-stone-200 items-baseline">
                  <a href={`${ISSUE}${it.n}`} className="font-mono text-sm text-accent-rust hover:underline">#{it.n}</a>
                  <div className="col-span-2 md:col-span-1 md:col-start-2 row-start-2 md:row-start-1 min-w-0">
                    <div className="font-semibold text-primary">{it.title}</div>
                    <p className="text-secondary text-[0.95rem] leading-relaxed mt-1">
                      {it.detail}
                      {it.example && (
                        <>
                          {' '}
                          <Link href={it.example.href} className="text-accent-rust hover:underline whitespace-nowrap">{it.example.label}</Link>
                        </>
                      )}
                    </p>
                  </div>
                  <div className="col-start-2 md:col-start-3 row-start-1 justify-self-end"><Chip status={it.status} /></div>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <section id="shipped" className="mb-12 scroll-mt-24">
          <h2 className="text-xl md:text-2xl text-primary mb-2 text-balance border-t-2 border-stone-800 pt-4">Already changed</h2>
          <p className="text-muted leading-relaxed mb-2">Changes now in production that came out of these measurements.</p>
          <ul>
            {SHIPPED.map(s => (
              <li key={s.pr} className="grid grid-cols-[4.5rem_1fr] gap-x-4 py-3 border-b border-stone-200 items-baseline">
                <a href={`${PULL}${s.pr}`} className="font-mono text-sm text-accent-rust hover:underline">#{s.pr}</a>
                <span className="text-secondary leading-relaxed min-w-0">{s.text}</span>
              </li>
            ))}
          </ul>
        </section>

        <p className="text-sm text-muted">
          Something wrong on a page you are reading? Use the feedback button on that page. Each report is checked against the
          page image before anything changes.
        </p>
      </article>
    </ContentPageLayout>
  );
}
