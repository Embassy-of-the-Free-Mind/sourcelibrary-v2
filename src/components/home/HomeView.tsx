import Link from 'next/link';
import HeroSection from '@/components/layout/HeroSection';
import AskTheSourceBand from '@/components/home/AskTheSourceBand';
import HomePageSchema from '@/components/seo/HomePageSchema';
import EditorialSpread from '@/components/prototype/EditorialSpread';
import BookSlider, { type MiniBook } from '@/components/BookSlider';
import GalleryMasonry from '@/components/GalleryMasonry';
import ResearchNotesSlider from '@/components/home/ResearchNotesSlider';
import RecentlyRead from '@/components/home/RecentlyRead';
import CuratedShowcase from '@/components/home/CuratedShowcase';
import SubjectIndex from '@/components/home/SubjectIndex';
import SignUpCTA from '@/components/auth/SignUpCTA';
import { type HomeData } from '@/lib/home-data';
import CollectionCardImage from '@/components/collections/CollectionCardImage';
import { HOME_STRINGS, type HomeLang, collectionName } from '@/lib/home-i18n';
import { localePath } from '@/lib/locale-path';

// Shared homepage body. The English `/` route renders it with lang="en"; the
// Spanish `/es` route with lang="es". Keeping a single component means the two
// language editions can never silently diverge in structure.

export default function HomeView({ data, lang }: { data: HomeData; lang: HomeLang }) {
  const t = HOME_STRINGS[lang];
  // Every link on this page that HAS a twin keeps the locale; the rest (gallery,
  // catalog, browse, podcast, blog…) are returned untouched by localePath and go
  // to their English page rather than a 404. See .claude/docs/i18n.md rule 5.
  const lp = (href: string) => localePath(href, lang);
  const { featuredItems, discoverBooks, recentlyTranslated, galleryPlates, counts, collections, curatedShowcase, blogPosts, spanishCollection, localizedCollectionCounts } = data;
  const hasShowcase = curatedShowcase.items.length > 0;
  const nf = (n: number) => n.toLocaleString(t.locale);
  // The subject index's count. On /es it also says how many of the collection's
  // books can actually be READ in Spanish — the same thing /es/collections
  // tells you, and the only number there a Spanish visitor can act on. Empty
  // suffix on `/`, where every book is already in the page's language. A
  // collection of artworks rather than books (Leonardo's notebooks) counts
  // its artworks instead of reading "0 books".
  const indexCount = (col: { slug: string; book_count: number; artwork_count?: number }) => {
    const base = col.book_count > 0
      ? `${nf(col.book_count)} ${t.booksLabel}`
      : (col.artwork_count ?? 0) > 0 ? `${nf(col.artwork_count ?? 0)} ${t.artworksLabel}` : '';
    const localized = localizedCollectionCounts[col.slug] ?? 0;
    return localized > 0 ? `${base} · ${nf(localized)} ${t.inThisLanguage}` : base;
  };

  return (
    <div className="min-h-screen">
      <HomePageSchema books={discoverBooks} bookCount={counts.totalBooks} translatedCount={counts.translatedToEnglish} />

      {/* Video Hero */}
      <HeroSection lang={lang} />

      {/* Read in Spanish — the first thing under the hero on /es, because it is
          the one section whose BOOKS (not just chrome) are in the visitor's
          language. One card, the same block /es/collections leads with, opening
          the full Spanish list; the `/es` prefix on the link is the only thing
          that decides reading language (.claude/docs/i18n.md rule 6).
          spanishCollection is null on the English homepage, so nothing renders there. */}
      {spanishCollection && (
        <section className="bg-white py-10 md:py-14">
          <div className="px-6 md:px-12 max-w-[1500px] mx-auto">
            <Link
              href={lp(`/collections/${spanishCollection.slug}`)}
              className="group grid sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-0 overflow-hidden rounded-lg border border-border-light bg-white hover:border-accent-rust/40 hover:shadow-md transition-[border-color,box-shadow]"
            >
              <div className="relative aspect-square sm:aspect-auto sm:min-h-[220px]">
                <CollectionCardImage candidates={spanishCollection.imageCandidates} alt="" sizes="(max-width: 640px) 100vw, 33vw" priority />
              </div>
              <div className="p-6 sm:p-8 flex flex-col justify-center">
                <p className="text-xs uppercase tracking-[0.2em] text-accent-rust mb-2">{t.spanishHeading}</p>
                <h2 className="text-2xl sm:text-3xl font-display text-primary mb-2 group-hover:text-accent-rust transition-colors">{spanishCollection.name}</h2>
                <p className="text-muted leading-relaxed mb-4">{t.spanishSubtitle}</p>
                <p className="text-sm text-secondary">{nf(spanishCollection.bookCount)} {t.booksLabel} &rarr;</p>
              </div>
            </Link>
          </div>
        </section>
      )}

      {/* Collections — two jobs, kept apart. The showcase leads: four curated
          exhibitions with a one-line hook each, one large and three beside it,
          because a small argued selection is what makes someone open a
          collection. The subject index follows as plain navigation: every
          top-level collection with its count, in the pinned reading order, no
          images, so the whole library is one glance away without competing
          with the showcase. The corpus stats belong to the index (they describe
          the whole library), not to the section heading. */}
      <section id="library" className="bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6] py-16 md:py-24">
        <div className="px-6 md:px-12 max-w-[1500px] mx-auto">
          <div className="flex items-end justify-between gap-4 mb-8 md:mb-10">
            <div>
              {hasShowcase && (
                <p className="text-xs uppercase tracking-[0.2em] text-accent-rust mb-2">{t.showcaseEyebrow}</p>
              )}
              <h2 className="text-3xl md:text-4xl text-primary font-display">
                {t.collectionsHeading}
              </h2>
              {hasShowcase && (
                <p className="text-muted mt-2 max-w-2xl">{t.showcaseSubtitle}</p>
              )}
            </div>
            {hasShowcase && (
              <Link
                href="/curated"
                className="text-sm text-muted hover:text-accent-rust transition-colors whitespace-nowrap hidden sm:inline-flex"
              >
                {t.allExhibitions(curatedShowcase.total)} &rarr;
              </Link>
            )}
          </div>

          {hasShowcase && (
            <>
              <CuratedShowcase
                items={curatedShowcase.items}
                lang={lang}
                countLabel={(item) => `${nf(item.book_count)} ${t.booksLabel}`}
              />
              <div className="mt-6 sm:hidden">
                <Link href="/curated" className="text-sm text-accent-rust hover:underline">
                  {t.allExhibitions(curatedShowcase.total)} &rarr;
                </Link>
              </div>
            </>
          )}

          {/* Subject index */}
          <div className={hasShowcase ? 'mt-14 md:mt-20 pt-10 md:pt-12 border-t border-border-light' : ''}>
            <div className="flex items-end justify-between gap-4 mb-6">
              <div>
                <h3 className="text-2xl md:text-3xl text-primary font-display">
                  {t.bySubjectHeading}
                </h3>
                <p className="text-muted mt-2">
                  {t.bySubjectLead}{' '}
                  <Link href="/catalog" className="hover:text-accent-rust transition-colors">{nf(counts.totalBooks)} {t.booksLabel}</Link>
                  {' '}&middot;{' '}
                  <Link href={lp('/search?has_translation=true')} className="hover:text-accent-rust transition-colors">{nf(counts.translatedToEnglish)} {t.translationsLabel}</Link>
                  {' '}&middot;{' '}
                  <Link href={lp('/search?first_translation=true')} className="hover:text-accent-rust transition-colors">{nf(counts.firstTranslationCount)} {t.firstTimeLabel}</Link>
                  {counts.artworkCount > 0 && (
                    <>
                      {' '}&middot;{' '}
                      <Link href="/artwork" className="hover:text-accent-rust transition-colors">{nf(counts.artworkCount)} {t.artworksLabel}</Link>
                    </>
                  )}
                  {counts.illustrationCount > 0 && (
                    <>
                      {' '}&middot;{' '}
                      <Link href="/browse/subjects" className="hover:text-accent-rust transition-colors">{nf(counts.illustrationCount)} {t.illustrationsLabel}</Link>
                    </>
                  )}
                </p>
              </div>
              <Link
                href="/catalog"
                className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg border border-accent-rust/30 text-accent-rust hover:bg-accent-rust hover:text-white transition-colors hidden md:flex"
              >
                {t.browseCatalog}
                <span className="text-xs">&rarr;</span>
              </Link>
            </div>

            <SubjectIndex
              items={collections.map((col) => ({
                slug: col.slug,
                href: lp(`/collections/${col.slug}`),
                name: collectionName(lang, col.slug, col.name),
                count: indexCount(col),
              }))}
              initialCount={12}
              showMoreLabel={t.seeMore}
            />

            <div className="mt-6 flex items-center justify-between">
              <Link
                href="/curated"
                className="group inline-flex items-center gap-2 text-sm text-accent-rust hover:text-accent-rust/80 transition-colors"
              >
                {t.curatedExhibitions}
                <span className="group-hover:translate-x-0.5 transition-transform">&rarr;</span>
              </Link>
              <Link
                href={lp('/collections')}
                className="text-sm text-muted hover:text-accent-rust transition-colors"
              >
                {t.allCollections} &rarr;
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Recently looked at — personalized slider from the signed-in reader's
          history, tucked right under the collections grid. Self-hides for
          anonymous visitors and readers with no history. */}
      <RecentlyRead lang={lang} />

      {/* Recently translated — the same slider as the Mycology collection's
          "First translations" band, auto-filled with the 15 works most recently
          brought into a modern translation site-wide (Supabase last_translation_at).
          Hidden if the catalog query returns nothing. */}
      {recentlyTranslated.length > 0 && (
        <section className="bg-white py-16 md:py-24">
          <div className="px-6 md:px-12 max-w-[1500px] mx-auto">
            <div className="flex items-end justify-between gap-4 mb-3">
              <h2 className="text-3xl md:text-4xl text-primary font-display">
                {t.recentlyTranslatedHeading}
              </h2>
              <Link
                href="/catalog?sort=last_translated"
                className="text-sm text-muted hover:text-accent-rust transition-colors whitespace-nowrap hidden sm:inline-flex"
              >
                {t.browseCatalog} &rarr;
              </Link>
            </div>
            <p className="text-muted mb-6 max-w-2xl">
              {t.recentlyTranslatedSubtitle}
            </p>
            <BookSlider books={recentlyTranslated as unknown as MiniBook[]} lang={lang} />
          </div>
        </section>
      )}

      {/* Ask the source — the librarian's front door. Placed after the
          collections grid so the invitation lands once the visitor has seen
          the breadth of the library, and so it doesn't stack a second input
          box right under the hero sign-up. */}
      <AskTheSourceBand lang={lang} />

      {/* Featured Collection — editorial spread */}
      {featuredItems.length > 0 && (
        <EditorialSpread
          collection={featuredItems[0].collection}
          books={featuredItems[0].books}
          lang={lang}
        />
      )}

      {/* Gallery — true-height masonry (Mycology-style), capped and faded into
          the page, filled with high-quality illustrations from across the whole
          library. */}
      {galleryPlates.length > 0 && (
        <section className="bg-warm py-16 md:py-24">
          <div className="px-6 md:px-12 max-w-[1500px] mx-auto">
            <h2 className="text-3xl md:text-4xl text-primary mb-3 font-display">
              {t.galleryHeading}
            </h2>
            <p className="text-muted mb-10 max-w-2xl">
              {t.gallerySubtitle}
            </p>
            <div
              className="relative max-h-[560px] sm:max-h-[1000px] lg:max-h-[1200px] overflow-hidden"
              style={{
                maskImage: 'linear-gradient(to bottom, #000 80%, transparent)',
                WebkitMaskImage: 'linear-gradient(to bottom, #000 80%, transparent)',
              }}
            >
              <GalleryMasonry plates={galleryPlates} />
            </div>
            {counts.illustrationCount > 0 && (
              <div className="mt-8 flex justify-center">
                <Link
                  href="/gallery"
                  className="inline-flex items-center gap-1.5 text-sm font-medium px-5 py-2.5 rounded-lg border border-accent-rust/30 text-accent-rust hover:bg-accent-rust hover:text-white transition-colors"
                >
                  {t.galleryViewAll(counts.illustrationCount)}
                  <span className="text-xs">&rarr;</span>
                </Link>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Blog Section */}
      <section className="bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6] py-16 md:py-24">
        <div className="px-6 md:px-12 max-w-[1500px] mx-auto">
          <div className="flex items-baseline justify-between mb-10">
            <div>
              <h2 className="text-3xl md:text-4xl text-primary font-display">
                {t.blogHeading}
              </h2>
              <p className="text-muted mt-2">
                {t.blogSubtitle}
              </p>
            </div>
            <Link
              href="/blog"
              className="text-sm text-accent-rust hover:underline"
            >
              {t.blogAllPosts}
            </Link>
          </div>

          <ResearchNotesSlider
            posts={blogPosts}
            deepDiveLabel={t.tagDeepDive}
            collectionLabel={t.tagCollection}
          />
        </div>
      </section>

      {/* About Section */}
      <section id="about" className="bg-white py-16 md:py-24">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <h2 className="text-3xl md:text-4xl lg:text-5xl text-gray-900 mb-8 leading-tight font-display">
            {t.aboutHeading}
          </h2>
          <div className="space-y-6 text-lg md:text-xl text-gray-600 leading-relaxed">
            <p>{t.aboutP1}</p>
            <p>{t.aboutP2}</p>
            <p className="text-gray-500 text-base">
              {t.aboutP3Before}
              <a href="https://embassyofthefreemind.com" className="text-accent-rust hover:underline">{t.efmLinkText}</a>
              {t.aboutP3After}
            </p>
          </div>
        </div>
      </section>

      {/* Be part of this */}
      <section className="py-20 md:py-28" style={{ background: 'var(--bg-dark)' }}>
        <div className="px-6 md:px-12 max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <p
              className="text-sm uppercase tracking-[0.2em] mb-6"
              style={{ color: 'var(--accent-gold)' }}
            >
              {t.bePartEyebrow}
            </p>
            <h2
              className="text-2xl md:text-3xl lg:text-4xl font-display mb-5 leading-snug"
              style={{ color: '#f5f0e8' }}
            >
              {t.bePartHeading}
            </h2>
          </div>

          {/* Support the Library — primary */}
          <div className="max-w-2xl mx-auto mb-12">
            <div className="rounded-xl p-8 text-center" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <h3 className="text-xl font-display mb-3" style={{ color: '#f5f0e8' }}>
                {t.supportTitle}
              </h3>
              <p className="leading-relaxed mb-6" style={{ color: '#a09a90' }}>
                {t.supportBody}
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Link
                  href={lp('/support')}
                  className="inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-full text-sm font-medium transition-all hover:brightness-110"
                  style={{ background: 'var(--accent-rust)', color: '#fff' }}
                >
                  {t.howToSupport}
                </Link>
                <Link
                  href={lp('/auth/signin')}
                  className="inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-full text-sm font-medium transition-all hover:brightness-110"
                  style={{ background: 'rgba(255,255,255,0.08)', color: '#a09a90' }}
                >
                  {t.createAccount}
                </Link>
              </div>
            </div>
          </div>

          {/* Other ways to participate */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-2xl mx-auto">
            <Link
              href="/contribute"
              className="rounded-lg p-5 text-center hover:brightness-110 transition-all"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
            >
              <p className="text-sm font-medium mb-1" style={{ color: '#f5f0e8' }}>{t.contribute}</p>
              <p className="text-xs leading-relaxed" style={{ color: '#6b6560' }}>
                {t.contributeDesc}
              </p>
            </Link>
            <Link
              href="/developers"
              className="rounded-lg p-5 text-center hover:brightness-110 transition-all"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
            >
              <p className="text-sm font-medium mb-1" style={{ color: '#f5f0e8' }}>{t.developers}</p>
              <p className="text-xs leading-relaxed" style={{ color: '#6b6560' }}>
                {t.developersDesc}
              </p>
            </Link>
          </div>

          {/* Free account nudge — for anonymous users only */}
          <SignUpCTA variant="inline" lang={lang} />
        </div>
      </section>

      {/* Search */}
      <section className="bg-[#f6f3ee] py-16 md:py-20">
        <div className="px-6 md:px-12 max-w-2xl mx-auto text-center">
          <h2 className="text-2xl md:text-3xl font-display text-stone-900 mb-3">
            {t.searchHeading}
          </h2>
          <p className="text-stone-500 text-sm mb-8">
            {t.searchStats(nf(counts.totalBooks), nf(counts.authorCount), counts.languageCount)}
          </p>
          <form action={lp('/search')} method="get" className="relative max-w-lg mx-auto mb-6">
            <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              name="q"
              placeholder={t.searchPlaceholder}
              className="w-full pl-12 pr-12 py-3.5 bg-white border border-stone-200 rounded-full text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-accent-rust/20 focus:border-accent-rust shadow-sm"
            />
          </form>
          <p className="text-stone-400 text-sm">
            {t.browseBy}{' '}
            <Link href="/browse/titles/A" className="text-stone-600 hover:text-accent-rust transition-colors underline underline-offset-2">{t.byTitle}</Link>
            {' '}&middot;{' '}
            <Link href="/browse/authors/A" className="text-stone-600 hover:text-accent-rust transition-colors underline underline-offset-2">{t.byAuthor}</Link>
            {' '}&middot;{' '}
            <Link href="/browse/years/1500s" className="text-stone-600 hover:text-accent-rust transition-colors underline underline-offset-2">{t.byYear}</Link>
            {' '}&middot;{' '}
            <Link href="/gallery" className="text-stone-600 hover:text-accent-rust transition-colors underline underline-offset-2">{t.byImages}</Link>
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6] py-16 md:py-24">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <div className="max-w-4xl border-t border-stone-300 pt-10 mt-8">
            <p className="text-sm uppercase tracking-[0.2em] text-stone-500 mb-6">
              {t.inSpiritOf}
            </p>
            <div className="flex flex-col md:flex-row md:items-start gap-8 md:gap-12">
              <div className="flex-1">
                <h3 className="text-xl md:text-2xl text-stone-800 mb-1 font-display">
                  Marsilio Ficino
                </h3>
                <p className="text-stone-500 text-sm mb-3">
                  {t.ficinoRole}
                </p>
                <p className="text-stone-600 text-base leading-relaxed">
                  {t.ficinoBio}
                </p>
              </div>
              <div className="flex-1">
                <h3 className="text-xl md:text-2xl text-stone-800 mb-1 font-display">
                  Cosimo de&apos; Medici
                </h3>
                <p className="text-stone-500 text-sm mb-3">
                  {t.cosimoRole}
                </p>
                <p className="text-stone-600 text-base leading-relaxed">
                  {t.cosimoBio}
                </p>
              </div>
            </div>
            <div className="mt-8 bg-accent-gold/5 rounded-lg p-5 border border-accent-gold/15">
              <p className="text-stone-700 text-base leading-relaxed">
                <strong>{t.closingStrong}</strong>{t.closingRest}
              </p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
