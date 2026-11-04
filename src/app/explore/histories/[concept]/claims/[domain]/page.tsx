import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { HISTORIES, conceptBySlug, loadClaims, domainLabel, claimsHref, fmt, type Claim } from '../../../histories';

// Static (#7623); dynamicParams=false: see ../../page.tsx. One page per domain
// (a whole concept is up to a thousand claims); every claim keeps its id as an
// anchor, which is what the essays' numbered marks link to.
export const dynamicParams = false;
export function generateStaticParams() {
  return HISTORIES.concepts.flatMap((c) => c.domains.map((d) => ({ concept: c.slug, domain: d })));
}

const OG_IMAGE = { url: 'https://sourcelibrary.org/og-image.jpg', alt: 'Source Library: Digitizing and translating ancient texts' };

async function find(params: Promise<{ concept: string; domain: string }>) {
  const { concept, domain } = await params;
  const c = conceptBySlug(concept);
  if (!c || !c.domains.includes(domain)) return null;
  const claims = (await loadClaims(c.slug)).filter((x) => x.d === domain);
  return { c, domain, claims };
}

export async function generateMetadata({ params }: { params: Promise<{ concept: string; domain: string }> }): Promise<Metadata> {
  const hit = await find(params);
  if (!hit) return {};
  const { c, domain, claims } = hit;
  const title = `${c.title}, ${domainLabel(domain)}: the claims and their sources | Source Library`;
  const description = `${fmt(claims.length)} checked claims (${domainLabel(domain)}) behind the conceptual history of ${c.title.toLowerCase()}, each with the page it quotes.`;
  const path = claimsHref(c.slug, domain);
  return {
    title, description,
    alternates: { canonical: path },
    openGraph: { title, description, url: `https://sourcelibrary.org${path}`, siteName: 'Source Library', type: 'website', images: [OG_IMAGE] },
    twitter: { card: 'summary_large_image', title, description, images: [OG_IMAGE.url] },
  };
}

function ClaimItem({ cl }: { cl: Claim }) {
  return (
    <li id={cl.id} className="scroll-mt-24 py-4" style={{ borderBottom: '1px solid var(--border-light)' }}>
      <p className="leading-relaxed" style={{ color: 'var(--text-primary)' }}>
        {cl.p ? <span className="text-xs uppercase tracking-wider mr-2" style={{ color: 'var(--text-muted)' }}>Partly verified</span> : null}
        {cl.s}
      </p>
      <ul className="mt-2 space-y-2 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
        {cl.src.map((s, i) => (
          <li key={i}>
            {s.q && (
              <blockquote className="font-serif italic mb-1 pl-3" style={{ borderLeft: '2px solid var(--border-light)' }}>
                “{s.q}”
                {s.qo && s.qo !== s.q ? <span className="block not-italic text-xs mt-1">{s.qo}</span> : null}
              </blockquote>
            )}
            {s.u ? (s.u.startsWith('/') ? <Link href={s.u}>{s.l}</Link> : <a href={s.u} rel="noopener noreferrer">{s.l}</a>) : s.l}
            {s.loc ? `, ${s.loc}` : ''}
            {s.np ? ' (held by the library, not yet public)' : ''}
          </li>
        ))}
      </ul>
    </li>
  );
}

export default async function DomainClaimsPage({ params }: { params: Promise<{ concept: string; domain: string }> }) {
  const hit = await find(params);
  if (!hit) notFound();
  const { c, domain, claims } = hit;
  const i = c.domains.indexOf(domain);
  const prev = c.domains[i - 1];
  const next = c.domains[i + 1];
  return (
    <ContentPageLayout
      maxWidth="narrow"
      header={<ContentHeader title={`${c.title}: ${domainLabel(domain)}`} subtitle={`${fmt(claims.length)} claims, each with the page it quotes`} maxWidth="narrow" />}
    >
      <div className="space-y-6">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          <Link href="/explore">Explore</Link> / <Link href="/explore/histories">Histories</Link> /{' '}
          <Link href={`/explore/histories/${c.slug}`}>{c.title}</Link> /{' '}
          <Link href={`/explore/histories/${c.slug}/claims`}>Claims</Link> / {domainLabel(domain)}
        </p>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          Each claim was drafted by AI and checked against the page it quotes. Quotations are shown only from books in the
          library, linked to their page; works outside the library, including modern scholarship, are cited without
          quoting them. <Link href={`/explore/histories/${c.slug}#how-far-it-was-checked`}>How far it was checked</Link>.
        </p>
        <ul>{claims.map((cl) => <ClaimItem key={cl.id} cl={cl} />)}</ul>
        <nav className="pt-2 flex justify-between gap-6 text-sm" aria-label="Claim sections">
          <span>{prev && <Link href={claimsHref(c.slug, prev)}>← {domainLabel(prev)}</Link>}</span>
          <span className="text-right">{next && <Link href={claimsHref(c.slug, next)}>{domainLabel(next)} →</Link>}</span>
        </nav>
      </div>
    </ContentPageLayout>
  );
}
