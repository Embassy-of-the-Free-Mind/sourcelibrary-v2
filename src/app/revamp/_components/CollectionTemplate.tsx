/* eslint-disable @next/next/no-img-element */
import Link from 'next/link';
import { ArrowRight, Search } from 'lucide-react';
import HeroScrim from '@/components/HeroScrim';
import CollectionAnchorBar from '@/components/CollectionAnchorBar';
import type { CollectionBook } from '@/components/CollectionBookCard';
import WorksGrid from './WorksGrid';
import { RAMP } from '../_lib/ramp';
import BookSlider from '@/components/BookSlider';
import GalleryMasonry from '@/components/GalleryMasonry';
import PlateWall from './PlateWall';
import type { CollectionModel } from '../_lib/types';

const WRAP = 'max-w-[1500px] mx-auto px-6 md:px-12 py-8 md:py-16';
const H2 = 'text-2xl sm:text-3xl text-primary font-display';

/**
 * One template for every collection, from the Mycology and Slime Moulds format.
 * Each section renders only when the collection has material for it, and
 * opensOn decides what leads for a collection of one kind.
 */
export default function CollectionTemplate({ m }: { m: CollectionModel }) {
  const n = (v: number) => v.toLocaleString('en-GB');
  const hasWorks = m.books.length > 0;
  const single = m.opensOn !== 'mixed';
  const sections = [
    m.intro.length ? { id: 'introduction', label: 'Introduction' } : null,
    m.firstTranslations.length ? { id: 'translations', label: 'First translations' } : null,
    m.pages.length ? { id: 'pages', label: 'Pages' } : null,
    m.quotes.length ? { id: 'quotes', label: 'Quotes' } : null,
    m.plates.length ? { id: 'gallery', label: m.platesLabel } : null,
    m.ask ? { id: 'librarian', label: 'Librarian' } : null,
    hasWorks ? { id: 'works', label: 'Works' } : null,
  ].filter(Boolean) as { id: string; label: string }[];
  const mosaic = m.heroTiles.length >= 8;

  const gallery = m.plates.length > 0 && (
    <section id="gallery" className="bg-cream border-b border-border-light scroll-mt-16">
      <div className={WRAP}>
        <div className="flex items-end justify-between gap-4 mb-1">
          <h2 className={H2}>{m.platesLabel}</h2>
          {m.stats.images > 0 && <span className="text-sm text-muted whitespace-nowrap">{n(m.stats.images)} in all</span>}
        </div>
        {m.platesNote && <p className="text-sm text-muted mb-6 max-w-2xl leading-relaxed">{m.platesNote}</p>}
        <div
          className={single ? 'mt-6' : 'relative max-h-[560px] sm:max-h-[1000px] lg:max-h-[1200px] overflow-hidden mt-2'}
          style={single ? undefined : { maskImage: 'linear-gradient(to bottom, #000 80%, transparent)', WebkitMaskImage: 'linear-gradient(to bottom, #000 80%, transparent)' }}
        >
          <GalleryMasonry plates={m.plates} />
        </div>
        {m.stats.images > m.plates.length && (
          <div className="mt-6"><Link href={`/gallery?collection=${m.slug}`} className="inline-flex items-center gap-2 h-11 px-5 bg-primary text-cream text-sm font-medium hover:opacity-90 transition-opacity">See all {n(m.stats.images)} in the Gallery <ArrowRight className="w-4 h-4" /></Link></div>
        )}
      </div>
    </section>
  );

  return (
    <div className="min-h-screen bg-cream">
      <section className="relative overflow-hidden min-h-[56svh] md:min-h-[75vh] flex items-end" style={{ backgroundColor: '#1a1612' }}>
        {/* Plates in still rows, as on Collections and the subject pages */}
        {mosaic ? <PlateWall tiles={m.heroTiles} rows={3} still /> : m.heroImage ? <>
          <img src={m.heroImage} alt="" className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-0 md:hidden"><HeroScrim variant="bottom" /></div>
          <div className="absolute inset-0 hidden md:block"><HeroScrim /></div>
        </> : null}
        <div className="relative z-10 w-full max-w-[1500px] mx-auto px-6 md:px-12 py-12 md:py-16" style={{ textShadow: '0 1px 12px rgba(0,0,0,.5)' }}>
          <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 uppercase text-[10.5px] md:text-[13px] tracking-[0.15em] mb-3" style={{ color: 'rgba(255,255,255,.7)' }}>
            <Link href="/revamp/c" className="hover:opacity-80">Collections</Link>
            {m.label && <><span style={{ opacity: 0.5 }}>/</span><span>{m.label}</span></>}
          </nav>
          <h1 className="text-4xl sm:text-5xl md:text-6xl text-white font-semibold leading-tight mb-3 font-display">{m.name}</h1>
          {m.deck && <p className="text-lg sm:text-xl text-white/75 max-w-3xl leading-relaxed mb-5">{m.deck}</p>}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] md:text-[13.5px] font-medium">
            {[
              m.stats.works > 0 ? `${n(m.stats.works)} works` : '',
              m.stats.images > 0 ? `${n(m.stats.images)} ${m.opensOn === 'artworks' ? 'artworks' : 'images'}` : '',
              m.pages.length > 0 ? `${m.pages.length} pages` : '',
              m.quotes.length > 0 ? `${m.quotes.length} quotes` : '',
              m.stats.years ?? '',
              m.stats.firstTranslations > 0 ? `${m.stats.firstTranslations} first translation${m.stats.firstTranslations === 1 ? '' : 's'}` : '',
            ].filter(Boolean).map((t, i) => <span key={t} style={{ color: RAMP[Math.min(i, RAMP.length - 1)] }}>{t}</span>)}
            <span className="text-white/60">{m.byline}</span>
          </div>
        </div>
      </section>

      <CollectionAnchorBar sections={sections} slug={m.slug} tone="dark" />

      {m.intro.length > 0 && (
        <section id="introduction" className="bg-warm border-b border-border-light scroll-mt-16">
          <div className={WRAP}>
            <div className="flex flex-col md:flex-row-reverse md:items-start gap-8 lg:gap-12">
              <div className="font-body flex-1 min-w-0">
                <p className="text-xl sm:text-3xl text-primary leading-snug mb-6">{m.intro[0]}</p>
                {m.intro.slice(1).map((p, i) => <p key={i} className="text-secondary leading-relaxed mb-4 max-w-2xl">{p}</p>)}
              </div>
              {m.introPlate && (
                <figure className="w-full md:w-[min(33%,53.333vh)] shrink-0 m-0 mx-auto md:mx-0">
                  <img src={m.introPlate.src} alt={m.introPlate.label || 'Plate from the collection'} loading="lazy" className="w-full h-auto" />
                  {m.introPlate.label && <figcaption className="mt-2 text-xs text-muted text-center">{m.introPlate.href ? <Link href={m.introPlate.href} className="hover:text-primary">{m.introPlate.label}</Link> : m.introPlate.label}</figcaption>}
                </figure>
              )}
            </div>
            {m.subjects.length > 0 && (
              <p className="mt-6 text-sm text-muted">Subjects: {m.subjects.map((s, i) => (
                <span key={s.id}>{i > 0 && ', '}<Link className="underline underline-offset-2 hover:opacity-70" href={`/revamp/subjects#${s.id}`}>{s.label}</Link></span>
              ))}</p>
            )}
          </div>
        </section>
      )}


      {single && gallery}

      {m.pages.length > 0 && (
        <section id="pages" className="bg-cream border-b border-border-light scroll-mt-16">
          <div className={WRAP}>
            <h2 className={`${H2} mb-6`}>Pages</h2>
            <div className="space-y-10">
              {m.pages.map((p) => (
                <article key={p.page} className="grid md:grid-cols-2 gap-6 md:gap-10 items-start border-t border-border-light pt-8">
                  <a href={p.href}><img src={p.src} alt={`Page ${p.page} of ${p.book}`} loading="lazy" className="w-full h-auto" /></a>
                  <div>
                    <p className="text-sm text-muted mb-3">{p.book} · {p.author} · page {p.page}</p>
                    <p className="text-secondary leading-relaxed font-body whitespace-pre-line">{p.text}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      {m.quotes.length > 0 && (
        <section id="quotes" className="bg-cream border-b border-border-light scroll-mt-16">
          <div className={WRAP}>
            <h2 className={`${H2} mb-6`}>Quotes</h2>
            <div className="max-w-3xl">
              {m.quotes.map((q) => (
                <figure key={q.page} className="border-t border-border-light py-7 m-0">
                  <blockquote className="text-xl sm:text-2xl text-primary leading-snug font-display m-0">{q.text}</blockquote>
                  <figcaption className="mt-3 text-sm text-muted"><a className="hover:text-primary" href={q.href}>{q.book}, {q.author}{q.year ? `, ${q.year}` : ''}, page {q.page}</a></figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>
      )}

      {m.firstTranslations.length > 0 && (
        <section id="translations" className="bg-cream border-b border-border-light scroll-mt-16">
          <div className={WRAP}>
            <div className="flex items-end justify-between gap-4 mb-1">
              <h2 className={H2}>First translations</h2>
              <span className="text-sm text-muted whitespace-nowrap">{m.firstTranslations.length} {m.firstTranslations.length === 1 ? 'title' : 'titles'}</span>
            </div>
            <p className="text-sm text-muted mb-2 max-w-2xl leading-relaxed">Works appearing in a modern, readable translation for the first time.</p>
            <BookSlider books={m.firstTranslations} />
          </div>
        </section>
      )}


      {!single && gallery}

      {m.quoteBand && (
        <section className="bg-dark text-white">
          <div className={`${WRAP} max-w-4xl`}>
            <p className="text-2xl sm:text-3xl leading-snug font-display">{m.quoteBand.text}</p>
            {m.quoteBand.original && <p className="mt-3 text-base text-white/60 italic">{m.quoteBand.original}</p>}
            <p className="mt-4 text-sm text-white/60">{m.quoteBand.source}</p>
          </div>
        </section>
      )}

      {m.ask && (
        <section id="librarian" className="bg-warm border-y border-border-light scroll-mt-16">
          <div className="max-w-[1500px] mx-auto px-6 md:px-12 py-8 md:py-16 flex flex-col md:flex-row md:items-center gap-10 lg:gap-16">
            {m.askMedia && 'video' in m.askMedia && (
              <div className="w-full max-w-[520px] mx-auto md:mx-0 shrink-0 lg:w-auto lg:max-w-none">
                <video className="w-full h-auto mix-blend-multiply lg:w-auto lg:h-[74vh]" autoPlay loop muted playsInline preload="metadata">
                  <source src={m.askMedia.video} type="video/mp4" />
                </video>
              </div>
            )}
            {m.askMedia && 'plate' in m.askMedia && (
              <figure className="w-full max-w-[520px] mx-auto md:mx-0 shrink-0 lg:w-auto lg:max-w-none m-0">
                <img src={m.askMedia.plate} alt={m.askMedia.label || 'Plate from the collection'} loading="lazy" className="w-full h-auto mix-blend-multiply lg:w-auto lg:h-[74vh] lg:max-w-[46vw] object-contain" />
                {m.askMedia.label && <figcaption className="mt-2 text-xs text-muted">{m.askMedia.href ? <Link href={m.askMedia.href} className="hover:text-primary">{m.askMedia.label}</Link> : m.askMedia.label}</figcaption>}
              </figure>
            )}
            {m.askMedia && 'quote' in m.askMedia && (
              <figure className="flex-1 max-w-xl m-0">
                <blockquote className="text-2xl sm:text-3xl text-primary leading-snug font-display m-0">{m.askMedia.quote}</blockquote>
                <figcaption className="mt-3 text-sm text-muted">{m.askMedia.source}</figcaption>
              </figure>
            )}
            <div className="max-w-xl flex-1 min-w-0">
              <p className="text-xs font-medium uppercase tracking-[0.15em] text-muted mb-3">Ask the librarian</p>
              <h2 className={`${H2} mb-3`}>Search inside every book</h2>
              <p className="text-secondary leading-relaxed font-body mb-7">The librarian reads the full transcribed text and the description of every illustration in each book that has been digitised here. Ask a question in plain language and it points you to the exact page, passage, or plate that answers it.</p>
              <div className="flex items-center gap-3 bg-white border border-border-light px-5 py-3.5 text-base text-muted"><Search className="w-5 h-5 shrink-0" />{m.ask}</div>
            </div>
          </div>
        </section>
      )}

      {hasWorks && (
        <section id="works" className="bg-cream border-b border-border-light scroll-mt-16">
          <div className={WRAP}>
            <div className="flex items-end justify-between gap-4 mb-6">
              <h2 className={H2}>Works in this collection</h2>
              <span className="text-sm text-muted whitespace-nowrap">{n(m.stats.works)} works</span>
            </div>
            <WorksGrid books={m.books as unknown as CollectionBook[]} total={m.listed || m.books.length} slug={m.slug} />
          </div>
        </section>
      )}
    </div>
  );
}
