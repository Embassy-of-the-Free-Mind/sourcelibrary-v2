import Image from 'next/image';
import Link from 'next/link';
import HeroSection from '@/components/layout/HeroSection';
import AskTheSourceBand from '@/components/home/AskTheSourceBand';
import HomePageSchema from '@/components/seo/HomePageSchema';
import EditorialSpread from '@/components/prototype/EditorialSpread';
import BookSlider, { type MiniBook } from '@/components/BookSlider';
import GalleryMasonry from '@/components/GalleryMasonry';
import ResearchNotesSlider from '@/components/home/ResearchNotesSlider';
import RecentlyRead from '@/components/home/RecentlyRead';
import SignUpCTA from '@/components/auth/SignUpCTA';
import { type HomeData, SPANISH_COLLECTION_SLUG } from '@/lib/home-data';
import { HOME_STRINGS, type HomeLang, collectionName } from '@/lib/home-i18n';
import { localePath } from '@/lib/locale-path';
import { localizedTitle } from '@/lib/localized';
import { isPublishedFirstTranslation } from '@/lib/book';

// Shared homepage body. The English `/` route renders it with lang="en"; the
// Spanish `/es` route with lang="es". Keeping a single component means the two
// language editions can never silently diverge in structure.

export default function HomeView({ data, lang }: { data: HomeData; lang: HomeLang }) {
  const t = HOME_STRINGS[lang];
  // Every link on this page that HAS a twin keeps the locale; the rest (gallery,
  // catalog, browse, podcast, blog…) are returned untouched by localePath and go
  // to their English page rather than a 404. See .claude/docs/i18n.md rule 5.
  const lp = (href: string) => localePath(href, lang);
  const { featuredItems, discoverBooks, recentlyTranslated, galleryPlates, counts, collections, blogPosts, featuredPodcast, spanishBooks, spanishCounts, spanishShowpiece } = data;
  const nf = (n: number) => n.toLocaleString(t.locale);
  const spanishFirsts = spanishBooks.filter(isPublishedFirstTranslation).slice(0, 6);

  return (
    <div className="min-h-screen">
      <HomePageSchema books={discoverBooks} bookCount={counts.totalBooks} translatedCount={counts.translatedToEnglish} />

      {/* Video Hero */}
      <HeroSection lang={lang} />

      {/* Read in Spanish — the first thing under the hero on /es, because it is
          the one section whose BOOKS (not just chrome) are in the visitor's
          language. Most-read first; the reader opens these in Spanish because
          /es stores the reading-language preference (ReadingLanguagePreference).
          spanishBooks is empty on the English homepage, so nothing renders there. */}
      {spanishBooks.length > 0 && (
        <section className="bg-white py-16 md:py-24">
          <div className="px-6 md:px-12 max-w-[1500px] mx-auto">
            <div className="flex items-end justify-between gap-4 mb-3">
              <h2 className="text-3xl md:text-4xl text-primary font-display">
                {t.spanishHeading}
              </h2>
              <Link
                href={lp(`/collections/${SPANISH_COLLECTION_SLUG}`)}
                className="text-sm text-muted hover:text-accent-rust transition-colors whitespace-nowrap hidden sm:inline-flex"
              >
                {t.spanishViewAll} &rarr;
              </Link>
            </div>
            <p className="text-muted mb-8 max-w-2xl">
              {t.spanishSubtitle}
            </p>

            {/* Say the size — as what has been done, not as a share of the
                library. Pages and books are the work; first translations and
                source languages are why it matters. The total sits underneath
                as the upside, which is the honest frame for a corpus this young. */}
            {spanishCounts && (
              <div className="mb-10">
                <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-6 border-y border-border-light py-6">
                  {[
                    [spanishCounts.pages, t.spanishStatPages],
                    [spanishCounts.books + spanishCounts.nativeBooks, t.spanishStatBooks],
                    [spanishCounts.firstTranslations, t.spanishStatFirsts],
                    [spanishCounts.sourceLanguages, t.spanishStatLanguages],
                  ].filter(([n]) => (n as number) > 0).map(([n, label]) => (
                    <div key={label as string}>
                      <dd className="font-display text-3xl md:text-4xl text-primary tabular-nums leading-none">{nf(n as number)}</dd>
                      <dt className="text-xs uppercase tracking-[0.15em] text-muted mt-2">{label}</dt>
                    </div>
                  ))}
                </dl>
                <p className="text-sm text-muted/80 mt-3">{t.spanishUpside(nf(counts.totalBooks))}</p>
              </div>
            )}

            {/* One page, seen. The image is the real scan and both sentences
                were found verbatim in the page's stored text before render
                (home-data.ts getSpanishShowpiece) — the block hides rather
                than misquotes. */}
            {spanishShowpiece && (
              <Link
                href={spanishShowpiece.href}
                className="group grid md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-6 md:gap-10 items-stretch mb-12 border border-border-light hover:border-accent-rust/40 hover:shadow-md transition-[border-color,box-shadow] bg-warm/40"
              >
                <div className="relative aspect-[3/4] md:aspect-auto md:min-h-[420px] bg-warm overflow-hidden">
                  <Image
                    src={spanishShowpiece.imageUrl}
                    alt={`${spanishShowpiece.title}, p. ${spanishShowpiece.pageNumber}`}
                    fill
                    sizes="(max-width: 768px) 100vw, 40vw"
                    className="object-cover object-top group-hover:scale-[1.02] transition-transform duration-500"
                  />
                </div>
                <div className="flex flex-col justify-center p-6 md:pr-10 md:py-8">
                  <p className="text-xs uppercase tracking-[0.2em] text-accent-rust mb-3">{t.spanishShowpieceEyebrow}</p>
                  <p className="font-display text-xl md:text-2xl text-primary leading-snug">{spanishShowpiece.title}</p>
                  <p className="text-sm text-muted mt-1 mb-6">
                    {[spanishShowpiece.author, spanishShowpiece.year, spanishShowpiece.language].filter(Boolean).join(' · ')}
                  </p>
                  <div className="grid sm:grid-cols-2 gap-6">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.15em] text-muted mb-2">{t.spanishShowpieceOriginal}</p>
                      <p className="font-display italic text-secondary leading-relaxed" lang={spanishShowpiece.language === 'Latin' ? 'la' : undefined}>{spanishShowpiece.original}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.15em] text-muted mb-2">{t.spanishShowpieceSpanish}</p>
                      <p className="text-primary leading-relaxed" lang="es">{spanishShowpiece.spanish}</p>
                    </div>
                  </div>
                  <p className="text-sm text-accent-rust mt-6 group-hover:underline">
                    {t.spanishShowpieceOpen(nf(spanishShowpiece.pageNumber))} &rarr;
                  </p>
                </div>
              </Link>
            )}

            {/* Named, not badged: the titles that exist in Spanish for the
                first time are the band's strongest claim. Same gate as the
                card tag (isPublishedFirstTranslation), so the list can never
                say more than the cards do. */}
            {spanishFirsts.length > 0 && (
              <p className="text-sm text-muted mb-6 leading-relaxed">
                <span className="text-primary font-medium">{t.spanishFirstsLabel}:</span>{' '}
                {spanishFirsts.map((b, i) => (
                  <span key={b.id}>
                    <Link href={b.href} className="text-primary hover:text-accent-rust underline decoration-border-light underline-offset-4 hover:decoration-accent-rust transition-colors">
                      {localizedTitle(b, lang)}
                    </Link>
                    {i < spanishFirsts.length - 1 ? ', ' : '.'}
                  </span>
                ))}
              </p>
            )}

            <BookSlider books={spanishBooks as unknown as MiniBook[]} lang={lang} hideStatus />
            <div className="mt-6 sm:hidden">
              <Link href={lp(`/collections/${SPANISH_COLLECTION_SLUG}`)} className="text-sm text-accent-rust hover:underline">
                {t.spanishViewAll} &rarr;
              </Link>
            </div>

            {/* The ask, where the evidence is. /es/support exists and is the
                Spanish twin of /support. */}
            <div className="mt-12 flex flex-col md:flex-row md:items-center md:justify-between gap-5 border border-border-light bg-warm/60 px-6 py-6">
              <div>
                <p className="font-display text-xl md:text-2xl text-primary leading-snug">{t.spanishSupportHeading}</p>
                <p className="text-sm text-muted mt-1 max-w-xl">{t.spanishSupportBody}</p>
              </div>
              <Link
                href={lp('/support')}
                className="inline-flex items-center justify-center gap-1.5 text-sm font-medium px-5 py-2.5 rounded-lg bg-accent-rust text-white hover:bg-accent-rust/90 transition-colors whitespace-nowrap"
              >
                {t.spanishSupportCta}
                <span className="text-xs">&rarr;</span>
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* Collections Grid */}
      <section id="library" className="bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6] py-16 md:py-24">
        <div className="px-6 md:px-12 max-w-[1500px] mx-auto">
          <div className="flex items-baseline justify-between mb-8">
            <div>
              <h2 className="text-3xl md:text-4xl text-primary font-display">
                {t.collectionsHeading}
              </h2>
              <p className="text-muted mt-2">
                <Link href="/catalog" className="hover:text-accent-rust transition-colors">{nf(counts.totalBooks)} {t.booksLabel}</Link>
                {' '}&middot;{' '}
                <Link href="/search?has_translation=true" className="hover:text-accent-rust transition-colors">{nf(counts.translatedToEnglish)} {t.translationsLabel}</Link>
                {' '}&middot;{' '}
                <Link href="/search?first_translation=true" className="hover:text-accent-rust transition-colors">{nf(counts.firstTranslationCount)} {t.firstTimeLabel}</Link>
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

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {collections.slice(0, 11).map((col, i) => (
              <Link
                key={col.slug}
                href={lp(`/collections/${col.slug}`)}
                className="group relative rounded-xl overflow-hidden aspect-square hover:shadow-lg transition-all hover:-translate-y-0.5"
              >
                {col.hero_image ? (
                  <Image
                    src={col.hero_image}
                    alt=""
                    fill
                    sizes="(max-width: 640px) 50vw, 25vw"
                    className="object-cover group-hover:scale-105 transition-transform duration-500"
                    priority={i < 4}
                    loading={i < 8 ? 'eager' : 'lazy'}
                  />
                ) : (
                  <div className="absolute inset-0 bg-gradient-to-br from-accent-rust/10 to-accent-gold/10" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 p-4">
                  <p className="text-white/50 text-xs mb-1 hidden sm:block">
                    {col.book_count} {t.booksLabel}
                  </p>
                  <h3 className="font-serif text-sm sm:text-base lg:text-lg text-white group-hover:text-accent-gold transition-colors line-clamp-2">
                    {collectionName(lang, col.slug, col.name)}
                  </h3>
                </div>
              </Link>
            ))}
            {collections.length > 11 && (
              <Link
                href={lp('/collections')}
                className="group relative rounded-xl overflow-hidden aspect-square bg-[#2a2520] flex items-center justify-center hover:shadow-lg transition-all hover:-translate-y-0.5"
              >
                <div className="text-center px-4">
                  <p className="font-serif text-lg sm:text-xl text-white/90 group-hover:text-accent-gold transition-colors">
                    {t.seeMore(collections.length - 11)}
                  </p>
                  <p className="text-white/40 text-xs mt-1">{t.collectionsWord}</p>
                </div>
              </Link>
            )}
          </div>

          {/* Curated exhibitions link */}
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
      </section>

      {/* Recently looked at — personalized slider from the signed-in reader's
          history, tucked right under the collections grid. Self-hides for
          anonymous visitors and readers with no history. */}
      <RecentlyRead />

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
            <BookSlider books={recentlyTranslated as unknown as MiniBook[]} />
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

      {/* Featured podcast episode, in the page's own language.
          Sits down here with the writing, NOT in the second slot under the hero:
          the podcast is still experimental and the homepage's prominent space
          belongs to the books. It remains the podcast's main entry point (the
          header nav item was retired — see SiteHeader) alongside the footer link.
          Renders nothing when that language has no published episode, which is
          currently the state of several languages — an empty section is correct,
          not a bug. */}
      {featuredPodcast && (
        <section className="py-14 md:py-20" style={{ background: 'var(--bg-dark)' }}>
          <div className="px-6 md:px-12 max-w-[1100px] mx-auto">
            <div className="grid md:grid-cols-[1fr_1.2fr] gap-8 md:gap-12 items-center">
              {featuredPodcast.heroImageUrl && (
                <Link href={`/podcast/${featuredPodcast.threadId}`} className="block rounded-xl overflow-hidden bg-black/30">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/image?url=${encodeURIComponent(featuredPodcast.heroImageUrl)}&w=720&q=85`}
                    alt=""
                    className="w-full max-h-[360px] object-contain"
                    loading="lazy"
                  />
                </Link>
              )}
              <div>
                <p className="text-sm uppercase tracking-[0.2em] mb-3" style={{ color: 'var(--accent-gold)' }}>
                  {t.podcastEyebrow}
                </p>
                <h2 className="text-2xl md:text-3xl font-display mb-4 leading-snug" style={{ color: '#f5f0e8' }}>
                  {featuredPodcast.title}
                </h2>
                <p className="text-base leading-relaxed mb-5" style={{ color: '#b8b2a8' }}>
                  {featuredPodcast.topic}
                </p>

                <audio controls preload="none" src={featuredPodcast.audioUrl} className="w-full mb-5">
                  <a href={featuredPodcast.audioUrl}>{t.podcastListen}</a>
                </audio>

                {featuredPodcast.sources.length > 0 && (
                  <div className="mb-5">
                    <p className="text-xs uppercase tracking-wider mb-2" style={{ color: '#8a8480' }}>
                      {t.podcastSourcesLabel}
                    </p>
                    <ul className="space-y-1.5">
                      {featuredPodcast.sources.map((s) => (
                        <li key={s.bookId}>
                          <Link
                            href={lp(`/book/${s.slug || s.bookId}`)}
                            className="text-[15px] hover:underline"
                            style={{ color: '#e8e2d8' }}
                          >
                            <span className="font-serif">{s.title}</span>
                            {(s.author || s.origin) && (
                              <span style={{ color: '#8a8480' }}>
                                {' — '}{[s.author, s.origin].filter(Boolean).join(' · ')}
                              </span>
                            )}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <Link
                  href={`/podcast/${featuredPodcast.threadId}`}
                  className="inline-flex items-center gap-1.5 text-sm font-medium px-5 py-2.5 rounded-full transition-all hover:brightness-110"
                  style={{ background: 'var(--accent-rust)', color: '#fff' }}
                >
                  {t.podcastFullEpisode}
                  <span className="text-xs">&rarr;</span>
                </Link>
              </div>
            </div>
          </div>
        </section>
      )}

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
          <SignUpCTA variant="inline" />
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
          <form action="/search" method="get" className="relative max-w-lg mx-auto mb-6">
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
