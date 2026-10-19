import { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ReactNode } from 'react';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import PageFigure from '@/components/articles/PageFigure';
import { FEED_TYPES } from '@/lib/feed-links';
import { INSCRIPTIONS, getInscription, type BlockSign } from '@/lib/inscriptions';
import { GMT, gregorianFromJdn, tzolkin, haab, DAY_NAMES, MONTHS, LONG_COUNT_UNITS } from '@/app/articles/maya-mathematics/maya';

// A Classic Maya monument, read from the University of Bonn's open sources (#6985): the object and its
// photographs from the ULB Bonn Maya archive, the signs in each glyph block from the TWKM sign catalog.
// Data: src/lib/inscriptions.ts. One monument for now, so the route is closed to other slugs.

export const revalidate = 86400;
export const dynamicParams = false;
export function generateStaticParams() {
  return Object.keys(INSCRIPTIONS).map((slug) => ({ slug }));
}

/** What each monument says, in a few plain sentences. Everything here is checked against the record below. */
const INTRO: Record<string, { subtitle: string; lead: ReactNode; named?: { block: string; text: ReactNode } }> = {
  'yaxchilan-lintel-21': {
    subtitle: 'A carved limestone lintel from the Maya city of Yaxchilan, dated 10 May 752',
    lead: (
      <>
        A lintel is the beam over a doorway. This one, from Yaxchilan on the Usumacinta river, on today&apos;s border
        between Mexico and Guatemala, carries 32 blocks of hieroglyphic text and no picture. It was photographed at
        the site, broken in two, in 1978.
      </>
    ),
    named: {
      block: 'D7',
      text: (
        <>
          Block D7, near the end, holds the name <strong>Yaxuun Bahlam</strong>, king of Yaxchilan from 752, known to
          modern scholars as Bird Jaguar IV.
        </>
      ),
    },
  },
};

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Day count, calendar round and our date for a Long Count string such as "9.16.1.0.9". */
function readLongCount(lc: string) {
  const digits = lc.split('.').map(Number);
  if (digits.length !== 5 || digits.some((d) => !Number.isInteger(d))) return null;
  const n = digits.reduce((sum, d, i) => sum + d * LONG_COUNT_UNITS[i].days, 0);
  const g = gregorianFromJdn(n + GMT);
  const t = tzolkin(n);
  const h = haab(n);
  return {
    digits,
    calendarRound: `${t.number} ${DAY_NAMES[t.index]} ${h.day} ${MONTHS[h.month]}`,
    date: `${g.d} ${MONTH_NAMES[g.m - 1]} ${g.y}`,
  };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const ins = await getInscription(slug);
  if (!ins) return {};
  const intro = INTRO[slug];
  const photo = ins.images.find((i) => i.kind === 'photograph');
  const images = photo ? [{ url: photo.url, alt: `${ins.title}, photographed by ${photo.creator}` }] : [];
  return {
    title: `${ins.title} - Maya inscriptions - Source Library`,
    description: intro?.subtitle,
    openGraph: { title: ins.title, description: intro?.subtitle, images },
    twitter: { card: 'summary_large_image', images },
    alternates: { canonical: `/inscriptions/${slug}`, types: FEED_TYPES },
  };
}

function Sign({ s }: { s: BlockSign }) {
  return (
    <li className="flex items-center gap-2 min-w-0">
      {s.image ? (
        // eslint-disable-next-line @next/next/no-img-element -- small line drawings, already sized for this
        <img src={s.image} alt={s.value ? `sign ${s.value}` : 'unread sign'} width={36} height={36} loading="lazy" className="w-9 h-9 object-contain shrink-0 bg-white rounded-sm" />
      ) : (
        <span className="w-9 h-9 shrink-0" />
      )}
      <span className="min-w-0 leading-tight">
        <span className={`block text-sm ${s.value ? 'text-primary font-medium' : 'text-muted italic'}`}>{s.value ?? 'unread'}</span>
        {s.translation && <span className="block text-xs text-muted truncate">{s.translation.split('|')[0].trim()}</span>}
      </span>
    </li>
  );
}

export default async function InscriptionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ins = await getInscription(slug);
  if (!ins) notFound();
  const intro = INTRO[slug];
  const lc = ins.longCount ? readLongCount(ins.longCount) : null;
  const photo = ins.images.find((i) => i.kind === 'photograph');
  const drawing = ins.images.find((i) => i.kind === 'drawing');
  const nBlocks = Object.keys(ins.blocks).length;
  const p = 'text-secondary leading-relaxed mb-6 font-body';
  const h2 = 'text-2xl md:text-3xl text-primary mt-16 mb-6 scroll-mt-24';
  const licence = (l: { label: string; url: string | null } | null) =>
    l ? (l.url ? <a href={l.url} className="underline">{l.label}</a> : l.label) : null;

  return (
    <ContentPageLayout header={<ContentHeader title={ins.title} subtitle={intro?.subtitle} />} maxWidth="standard">
      <article className="max-w-[var(--container-narrow)] mx-auto">
        {photo && (
          <PageFigure
            src={photo.url}
            alt={`${ins.title}: a limestone slab broken in two, its face covered in rows of glyph blocks, propped between two posts in the forest.`}
            wide
            credit={<>Photo: {photo.creator}, {photo.date}. <a href={photo.ulbUrl} className="underline">ULB Bonn</a>, {licence(photo.licence)}.</>}
          >
            {ins.title} at Yaxchilan.
          </PageFigure>
        )}

        <p className={p}>{intro?.lead}</p>
        {lc && (
          <p className={p}>
            The text opens with a date in the Long Count, the Maya count of days from the start of the present era:{' '}
            <strong>{lc.digits.join('.')}</strong>, the day {lc.calendarRound}. That is {lc.date} in our calendar. (How the count
            works: <Link href="/articles/maya-mathematics" className="underline">How the Maya Counted</Link>.)
          </p>
        )}
        {intro?.named && <p className={p}>{intro.named.text}</p>}

        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm font-body border-t border-b border-stone-200 py-4 my-10">
          {ins.provenance && (<><dt className="text-muted">Site</dt><dd className="text-primary">{ins.provenance}</dd></>)}
          {ins.currentLocation && (<><dt className="text-muted">Now at</dt><dd className="text-primary">{ins.currentLocation}</dd></>)}
          {lc && (<><dt className="text-muted">Date</dt><dd className="text-primary">{lc.digits.join('.')} · {lc.calendarRound} · {lc.date}</dd></>)}
          {ins.material && (<><dt className="text-muted">Material</dt><dd className="text-primary">{[ins.material, ins.technique].filter(Boolean).join(', ')}</dd></>)}
          {ins.extent[1] && (<><dt className="text-muted">Size</dt><dd className="text-primary">{ins.extent[1]}</dd></>)}
        </dl>

        <h2 id="text" className={h2}>The text, block by block</h2>
        <p className={p}>
          Maya texts are read in pairs of columns, left to right and top to bottom: A1, B1, A2, B2, and so on. Each
          block below lists the signs identified in it by the University of Bonn&apos;s sign catalog, with that
          catalog&apos;s best-supported reading. The signs in a block are listed together, not in the order they are read.
          Capitals are word signs, lower case are syllables.
        </p>
      </article>

      <div className="grid gap-10 md:grid-cols-2 mt-8">
        {ins.config.panels.map(([left, right]) => (
          <section key={left} aria-label={`Columns ${left} and ${right}`} className="grid grid-cols-2 gap-2">
            {Array.from({ length: ins.config.rows }, (_, i) => i + 1).flatMap((row) =>
              [left, right].map((col) => {
                const zone = `${col}${row}`;
                const signs = ins.blocks[zone] ?? [];
                const named = intro?.named?.block === zone;
                return (
                  <div key={zone} id={zone} className={`rounded border p-2 ${named ? 'border-amber-400 bg-amber-50' : 'border-stone-200 bg-white'}`}>
                    <div className="text-xs text-muted font-mono mb-1">{zone}</div>
                    {signs.length ? (
                      <ul className="space-y-1">{signs.map((s, k) => <Sign key={`${s.graphNo}-${k}`} s={s} />)}</ul>
                    ) : (
                      <p className="text-xs text-muted italic">no signs recorded</p>
                    )}
                  </div>
                );
              }),
            )}
          </section>
        ))}
      </div>

      <article className="max-w-[var(--container-narrow)] mx-auto">
        {drawing && (
          // The drawing is a narrow strip (two columns of blocks); at full column width it runs several screens tall.
          <div className="max-w-[280px] mx-auto">
          <PageFigure
            src={drawing.url}
            alt={`An ink drawing of glyph blocks from ${ins.title}, two columns of seven blocks.`}
            credit={<>Drawing, <a href={drawing.ulbUrl} className="underline">ULB Bonn</a>, {licence(drawing.licence)}.</>}
          >
            An older drawing of the opening blocks.
          </PageFigure>
          </div>
        )}

        <h2 id="sources" className={h2}>Sources</h2>
        <ul className="text-sm text-secondary font-body space-y-3 list-disc pl-5">
          <li>
            The object, its date and its pictures: <a href={ins.ulbUrl} className="underline">{ins.title}</a>, Maya
            Hieroglyphic Text and Image Archive, Universitäts- und Landesbibliothek Bonn.
          </li>
          <li>
            The signs in each block, their readings and drawings: <em>A Digital Catalog of Maya Hieroglyphs</em>, directed by
            Nikolai Grube, developed and edited by Christian Prager, Text Database and Dictionary of Classic Mayan,
            University of Bonn, <a href="https://classicmayan.org/portal/signcatalog" className="underline">classicmayan.org</a>.
            Sign drawings by Christian Prager, CC BY 4.0.
          </li>
          <li>{nBlocks} blocks recorded; dates converted with the GMT correlation (584283).</li>
        </ul>
      </article>
    </ContentPageLayout>
  );
}
