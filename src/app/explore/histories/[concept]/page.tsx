import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import ContentPageLayout from '@/components/layout/ContentPageLayout';
import {
  HISTORIES, conceptBySlug, fmt, qualityStatement, loadEssays, loadLanes, pickFor, keyQuotes, sections, essayLine, isStub,
  claimsHref, domainLabel, plainTitle,
} from '../histories';
import Markdown from '../Markdown';
import Quote from '../Quote';
import HistoryHero from '../HistoryHero';
import KeepTerms from '../KeepTerms';
import SenseLanes from '../SenseLanes';

// Static (#7623). dynamicParams=false makes an unknown concept a routing-level
// 404, not a notFound() under /explore's loading.tsx (a soft 200, rendering-and-seo.md).
export const dynamicParams = false;
export function generateStaticParams() { return HISTORIES.concepts.map((c) => ({ concept: c.slug })); }

export async function generateMetadata({ params }: { params: Promise<{ concept: string }> }): Promise<Metadata> {
  const c = conceptBySlug((await params).concept);
  if (!c) return {};
  const title = `${c.title}: a conceptual history | Source Library`;
  const url = `https://sourcelibrary.org/explore/histories/${c.slug}`;
  const img = pickFor(c.slug).image;
  return {
    title, description: c.question,
    alternates: { canonical: `/explore/histories/${c.slug}` },
    openGraph: { title, description: c.question, url, siteName: 'Source Library', type: 'article', images: [{ url: img.src, alt: img.alt }] },
    twitter: { card: 'summary_large_image', title, description: c.question, images: [img.src] },
  };
}

/** Paragraphs that explain the project's own markup ("How to read it") are left out of the excerpt. */
const excerpt = (md: string) => md.split(/\n\s*\n/).filter((p) => !/^\*\*How to read\b/.test(p.trim())).join('\n\n');

/** The claims in sentences; a count of zero is never printed as a sentence. */
function claimsSentence(c: { counts: { verified: number; partial: number; dropped: number } }): string {
  const { verified, partial, dropped } = c.counts;
  const parts = [`The essays rest on ${fmt(verified + partial)} claims, each tied to the page it quotes.`];
  if (partial > 0) parts.push(`${fmt(partial)} of them are only partly supported by their page and are marked as such.`);
  if (dropped > 0) parts.push(`${fmt(dropped)} more, unverified or disputed, are not shown.`);
  return parts.join(' ');
}

const H2 = ({ children, id }: { children: React.ReactNode; id?: string }) => (
  <h2 id={id} className="font-serif text-3xl mb-4 scroll-mt-24" style={{ color: 'var(--text-primary)' }}>{children}</h2>
);

export default async function ConceptPage({ params }: { params: Promise<{ concept: string }> }) {
  const c = conceptBySlug((await params).concept);
  if (!c) notFound();
  const pick = pickFor(c.slug);
  const essays = await loadEssays(c.slug);
  const opening = essays.find((e) => e.slug === pick.opening.essay) ?? essays[0];
  const sec = sections(opening.md).find((s) => s.heading === pick.opening.section) ?? sections(opening.md)[0];
  const others = essays.filter((e) => e !== opening && !isStub(e.md));
  const key = keyQuotes(c.slug);
  const chart = await loadLanes(c.slug);
  const quality = qualityStatement(c);
  const essayHref = (slug: string) => `/explore/histories/${c.slug}/${slug}`;
  return (
    <ContentPageLayout
      maxWidth="narrow"
      header={<HistoryHero title={c.title} question={c.question} pick={pick} />}
    >
      <div className="space-y-16">
        {chart && <SenseLanes data={chart} />}

        <section>
          <H2><Link href={essayHref(opening.slug)}>{plainTitle(opening.title)}</Link></H2>
          {sec.heading && <h3 className="font-serif text-xl mb-3" style={{ color: 'var(--text-primary)' }}>{sec.heading}</h3>}
          <Markdown md={excerpt(sec.md)} />
          <p className="mt-6 font-body text-lg">
            <Link href={essayHref(opening.slug)}>Read the whole essay</Link>
          </p>
        </section>

        {key.length > 0 && (
          <section>
            <H2>From the sources</H2>
            {key.map((f) => <Quote key={`${f.claim}-${f.u}`} f={f} />)}
          </section>
        )}

        {others.length > 0 && (
          <section>
            <H2>{others.length === 1 ? 'The other essay' : 'The other essays'}</H2>
            <ul className="space-y-5">
              {others.map((e) => (
                <li key={e.slug}>
                  <Link href={essayHref(e.slug)} className="font-serif text-xl leading-snug">{plainTitle(e.title)}</Link>
                  <p className="font-body leading-relaxed mt-1" style={{ color: 'var(--text-muted)' }}>{essayLine(e.md)}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {c.keepTerms.length > 0 && <KeepTerms terms={c.keepTerms} />}

        {c.map && (
          <section>
            <H2>The sources</H2>
            <p className="font-body text-lg leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              Every work on {c.title.toLowerCase()} the library knows of, by tradition and date: what you can read now, what
              is held but not yet readable, and what is missing, with the works this history quotes marked.{' '}
              <Link href={c.map}>The sources on {c.title.toLowerCase()}</Link>.
            </p>
          </section>
        )}

        <section>
          <H2>The claims</H2>
          <p className="font-body text-lg leading-relaxed mb-4" style={{ color: 'var(--text-secondary)' }}>
            {claimsSentence(c)} <Link href={`/explore/histories/${c.slug}/claims`}>All the claims</Link>, or by tradition and period:
          </p>
          <ul className="flex flex-wrap gap-x-5 gap-y-2 font-body">
            {c.domains.map((d) => <li key={d}><Link href={claimsHref(c.slug, d)}>{domainLabel(d)}</Link></li>)}
          </ul>
        </section>

        <section id="how-far-it-was-checked" className="scroll-mt-24 pt-10" style={{ borderTop: '1px solid var(--border-medium)' }}>
          <H2>How far it was checked</H2>
          <p className="font-serif text-2xl leading-snug mb-5" style={{ color: 'var(--text-primary)' }}>{quality.lead}</p>
          <div className="space-y-3 font-body leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {quality.paragraphs.map((p) => <p key={p}>{p}</p>)}
            <p style={{ color: 'var(--text-muted)' }}>Found a claim its page does not support? Tell us with the feedback link at the foot of this page.</p>
          </div>
        </section>
      </div>
    </ContentPageLayout>
  );
}
