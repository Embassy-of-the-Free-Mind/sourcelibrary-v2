import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import BlogComments from '@/components/blog/BlogComments';

export const metadata: Metadata = {
  title: 'First English Translations - Blog - Source Library',
  description: 'Hundreds of books in Source Library appear to be first-ever English translations — alchemical lab manuals, radical theology, Sanskrit astrology manuscripts, women alchemists, and founding texts of biblical criticism, all previously inaccessible in English.',
  openGraph: {
    title: 'Over 500 First English Translations',
    description: 'Alchemical lab manuals, radical theology, women alchemists, Sanskrit astrology manuscripts, and founding texts of biblical criticism — all previously inaccessible in English.',
    images: [{ url: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/4d4089b9-9227-4cc5-b0a2-9b06ee731061/2.jpg', width: 1200, height: 630 }],
  },
  alternates: {
    canonical: '/blog/first-translations',
  },
};

export default function FirstTranslationsPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="First English Translations"
          subtitle="Hundreds of books in Source Library have never been read in English before"
        >
          <p className="text-stone-400 text-sm mt-4">20 February 2026, updated 23 February 2026 &middot; 14 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <div className="mb-8">
        <Link
          href="/blog"
          className="inline-flex items-center gap-2 text-muted hover:text-secondary transition-colors text-sm"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          All posts
        </Link>
      </div>

      <article className="prose-content max-w-none">
        {/* Lede */}
        <p className="text-xl text-secondary leading-relaxed mb-8 font-body">
          When we set out to build Source Library, we knew the collection would include texts that had never been translated into English. We did not expect the number to be this large.
        </p>

        <p className="text-secondary leading-relaxed mb-10 font-body">
          As the library has grown, systematic classification has identified over 500 books that appear to be first-ever English translations, with another 26 that are the first <em>complete</em> translations where only fragments had previously appeared in anthologies or scholarly excerpts.
        </p>

        {/* === Stat block === */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 my-12">
          {[
            { number: '500+', label: 'First English translations' },
            { number: '95', label: 'Astrology & divination' },
            { number: '166', label: 'Christian mysticism' },
            { number: '123', label: 'Alchemy & chemistry' },
          ].map((stat) => (
            <div key={stat.label} className="text-center py-5 px-3 bg-warm rounded-lg border border-border-light">
              <div className="font-serif text-3xl md:text-4xl text-accent-rust mb-1">{stat.number}</div>
              <div className="text-xs text-muted leading-tight">{stat.label}</div>
            </div>
          ))}
        </div>

        <p className="text-secondary leading-relaxed mb-8 font-body">
          These are not obscure marginalia. They include founding texts of biblical criticism, alchemical laboratory manuals, the writings of women philosophers, radical theological treatises that reshaped Protestantism, one of the earliest attempts to decode Egyptian hieroglyphics, and &mdash; as a recent deep classification revealed &mdash; 95 works of astrology and divination, mostly Sanskrit jyotish manuscripts that have never existed in any European language.
        </p>

        {/* === Pull quote === */}
        <div className="border-l-4 border-accent-rust pl-6 my-12">
          <p className="text-lg text-secondary italic font-body leading-relaxed">
            They were never translated because they fell outside the narrow canon that English-language scholarship chose to preserve. AI translation is now making them readable for the first time.
          </p>
        </div>

        <hr className="border-border-light my-12" />

        {/* === Section 1 === */}
        <section className="mb-16">
          <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
            What &ldquo;first translation&rdquo; means here
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            To be clear about what we are claiming and what we are not: these are AI translations produced by Google&apos;s Gemini models, with the original language always preserved alongside for verification. They are working translations &mdash; the first time a modern English reader can sit down and read these texts from beginning to end. They are not critical scholarly editions. They have not been reviewed line-by-line by a specialist in Early Modern German or Neo-Latin.
          </p>

          <p className="text-secondary leading-relaxed font-body">
            But for the vast majority of these books, the alternative is not a better translation. The alternative is no translation at all. A German sermon from 1618 that has never been rendered into English is simply invisible to anglophone readers &mdash; invisible to students, to researchers working outside German studies, to anyone who cannot read 17th-century Fraktur. An imperfect translation that makes the text legible for the first time is, we believe, a genuine scholarly contribution.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        {/* === Section 2 === */}
        <section className="mb-16">
          <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
            The buried stratum of Early Modern thought
          </h2>

          <p className="text-secondary leading-relaxed mb-8 font-body">
            The books cluster in ways that reveal systematic gaps in the English-language record. This is not a random sample of untranslated texts. Entire fields of intellectual history have been inaccessible to English readers simply because no one undertook the labour of translation.
          </p>

          {/* -- Alchemy -- */}
          <h3 className="font-serif text-xl text-stone-800 mb-4 mt-10">
            Alchemy and chemical philosophy
          </h3>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Roughly 123 of the first translations are alchemical texts &mdash; practical laboratory manuals, transmutation treatises, commentaries on Basilius Valentinus, and the Paracelsian medical chemistry that formed the bridge between medieval alchemy and modern chemistry. English-language history of science has long relied on a handful of translated alchemical works (the <em>Turba Philosophorum</em>, the Emerald Tablet, selections from Paracelsus). The vast German-language alchemical literature &mdash; hundreds of books published between 1600 and 1750 &mdash; has remained almost entirely untouched.
          </p>

          {/* Featured book card: Walchin */}
          <div className="bg-white rounded-xl border border-border-light p-5 md:p-6 mb-8 flex flex-col md:flex-row gap-5">
            <div className="md:w-24 shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/uploads/698255f12f8186e7ada0c92c/698255f82cf8a3ab2e0b44d2.avif"
                alt="Title page of Das mineralische Gluten by Dorothea Juliana Walchin"
                className="w-full md:w-24 h-32 md:h-auto object-cover rounded-lg"
              />
            </div>
            <div className="flex-1">
              <p className="text-secondary leading-relaxed font-body">
                Among these is the work of{' '}
                <Link href="https://sourcelibrary.org/book/698255f12f8186e7ada0c92c" className="text-accent-rust hover:text-accent-rust underline font-medium">Dorothea Juliana Walchin</Link>, a woman alchemist active in the early 18th century. Her three books &mdash;{' '}
                <Link href="https://sourcelibrary.org/book/698255f12f8186e7ada0c92c" className="text-accent-rust hover:text-accent-rust underline"><em>Das mineralische Gluten</em></Link>,{' '}
                <Link href="https://sourcelibrary.org/book/6984e84ebcfafeceb11019c1" className="text-accent-rust hover:text-accent-rust underline"><em>Der philosophische Perl-Baum</em></Link>, and{' '}
                <Link href="https://sourcelibrary.org/book/6988a5a1f3319e17203eb918" className="text-accent-rust hover:text-accent-rust underline"><em>Schl&uuml;ssel zu dem Cabinet</em></Link>{' '}
                &mdash; have never appeared in English. They are practical alchemical treatises written by a woman in a field overwhelmingly dominated by men, and their existence is barely noted in the standard histories.
              </p>
            </div>
          </div>

          {/* -- Mysticism -- */}
          <h3 className="font-serif text-xl text-stone-800 mb-4 mt-10">
            Christian mysticism and radical theology
          </h3>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The largest cluster &mdash; about 166 books &mdash; falls under Christian mysticism and heterodox Protestant theology. This includes the sermons of Valentin Weigel, Pietist devotional works by Philipp Jakob Spener, Gottfried Arnold&apos;s massive church history, and the writings of radical reformers, spiritualists, and Schwenckfelders. These texts shaped the religious landscape of Early Modern Europe, but because they were written in German and aimed at German-speaking congregations, they were never translated for an English audience.
          </p>

          {/* Pull quote: Semler */}
          <div className="bg-warm rounded-xl p-6 border border-border-light my-8">
            <p className="text-secondary italic font-body leading-relaxed mb-3">
              Johann Salomo Semler&apos;s <em>Free Investigation of the Canon</em> (1771) is widely recognized as a founding text of modern biblical criticism. Semler argued that the biblical canon was a historical product, assembled by human beings with human motivations. Every course on the history of biblical studies mentions Semler. Yet this specific work &mdash; the one that started it all &mdash; has never been translated into English.
            </p>
            <p className="text-sm text-muted">
              Students have read <em>about</em> it for 250 years. Now they can{' '}
              <Link href="https://sourcelibrary.org/book/69776dfe4896622ce9e30c70" className="text-accent-rust hover:text-accent-rust not-italic underline">
                read it
              </Link>.
            </p>
          </div>

          {/* -- Rosicrucianism -- */}
          <h3 className="font-serif text-xl text-stone-800 mb-4 mt-10">
            Rosicrucianism and secret societies
          </h3>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            About 84 books relate to Rosicrucianism, Freemasonry, and the Illuminati-era pamphlet wars. The Rosicrucian manifestos themselves have been translated many times, but the vast literature of responses, defences, attacks, and elaborations that they provoked has not. Source Library holds dozens of these pamphlets from the 1610s and 1620s, now readable in English for the first time.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Among the most striking is the{' '}
            <Link href="https://sourcelibrary.org/book/697c8e0f6000fdec2f130606" className="text-accent-rust hover:text-accent-rust underline"><em>Frawen Zimmer des Gottseligen Hocherleuchten Gottesgelehrten</em></Link>{' '}
            (1620) &mdash; the &ldquo;Women&apos;s Chamber of the Rosy Cross.&rdquo; Published just six years after the <em>Fama Fraternitatis</em>, this text addresses women&apos;s participation in the Rosicrucian movement at a time when the standard narrative assumes the movement was entirely male. It has never appeared in English.
          </p>

          {/* -- Other clusters -- */}
          <h3 className="font-serif text-xl text-stone-800 mb-4 mt-10">
            Cabala, natural philosophy, and the rest
          </h3>

          <p className="text-secondary leading-relaxed font-body">
            The remaining clusters include about 30 books on Christian Cabala and Jewish mysticism (including Postel&apos;s <em>Sefer Yetzirah</em> commentary and Gaffarel&apos;s catalogue of Pico&apos;s Kabbalistic manuscripts), 89 on natural philosophy and early science, 65 on law, politics, and history, and 46 on Paracelsian medicine and alchemical pharmacy. Each cluster represents a body of primary sources that English-language scholarship has discussed at second hand for centuries.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        {/* === Section 3: Astrology === */}
        <section className="mb-16">
          <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
            Astrology and divination: 95 first translations
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            A deep classification of the library&apos;s{' '}
            <Link href="https://sourcelibrary.org/collections/astrology" className="text-accent-rust hover:text-accent-rust underline">Astrology &amp; Divination</Link>{' '}
            collection revealed 95 works that have never been translated into English &mdash; the largest single-subject cluster identified so far.
          </p>

          {/* Sanskrit astrology manuscript image */}
          <figure className="my-10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/69905f4140bc3a0478efb47b/3.jpg"
              alt="Page from the Brihat Samhita, a Sanskrit astrological encyclopedia"
              className="w-full max-w-md mx-auto rounded-lg shadow-md"
            />
            <figcaption className="text-center text-sm text-muted mt-3 italic">
              A page from the <em>Brihat Samhita</em>, one of the foundational texts of Indian astrology.{' '}
              <Link href="https://sourcelibrary.org/book/69905f4140bc3a0478efb47b" className="text-accent-rust hover:text-accent-rust not-italic">Read in Source Library &rarr;</Link>
            </figcaption>
          </figure>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The majority are Sanskrit jyotish manuscripts: 59 texts on electional astrology (<em>muhurta</em>), horary astrology (<em>prasna</em>), planetary remediation (<em>graha shanti</em>), nakshatras, nadi divination, and geomancy (<em>ramala shastra</em>). These are texts from an Indian astrological tradition that is enormous in its own right but has been almost entirely inaccessible to English-speaking readers.
          </p>

          {/* Language breakdown card */}
          <div className="bg-warm rounded-xl p-5 border border-border-light my-8">
            <p className="text-sm font-medium text-stone-800 mb-3">Beyond Sanskrit, the astrology first translations include:</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-sm text-secondary font-body">
              <span>14 German texts</span>
              <span>11 Latin works</span>
              <span>3 French treatises</span>
              <span>2 Arabic manuscripts</span>
              <span>2 Tamil nadi texts</span>
              <span>1 Chinese manual (1657)</span>
            </div>
          </div>

          <p className="text-secondary leading-relaxed font-body">
            Of these first translations, over 200 are already 80% or more complete. Many of the Sanskrit manuscripts are fully translated &mdash; texts like the <em>Muhurta Ratna</em> of Govinda Bhatta (c. 1420), the <em>Prashna Bhairava</em>, the <em>Pashakavali</em> (a treatise on dice divination from c. 1610), and the <em>Ramala Shastra</em> (Indian geomancy, c. 1700). These are works that scholars of Indian astrology have long known about but could only access in Sanskrit. They are now readable in English for the first time.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        {/* === Section 4: Women === */}
        <section className="mb-16">
          <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
            The women who wrote
          </h2>

          <p className="text-secondary leading-relaxed mb-8 font-body">
            Several of the first translations are by women whose work has been largely inaccessible in English. Beyond Walchin&apos;s alchemical treatises:
          </p>

          {/* Meurdrac image + card */}
          <div className="bg-white rounded-xl border border-border-light overflow-hidden mb-6">
            <div className="md:flex">
              <div className="md:w-48 shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/6952898bab34727b1f04d709/3.jpg"
                  alt="Title page of La chymie charitable et facile en faveur des dames by Marie Meurdrac, 1666"
                  className="w-full h-48 md:h-full object-cover"
                />
              </div>
              <div className="p-5 md:p-6">
                <Link href="https://sourcelibrary.org/book/6952898bab34727b1f04d709" className="text-accent-rust hover:text-accent-rust underline font-medium">
                  Marie Meurdrac, <em>La chymie charitable et facile en faveur des dames</em>
                </Link>
                <p className="text-sm text-muted mt-1 mb-3">Paris, 1666</p>
                <p className="text-secondary text-sm leading-relaxed font-body">
                  One of the earliest chemistry books written by a woman, offering practical chemical recipes and pharmaceutical preparations explicitly addressed to a female audience. Never fully translated into English.
                </p>
              </div>
            </div>
          </div>

          {/* Other women authors */}
          <div className="space-y-4 mb-8">
            <div className="bg-white rounded-xl border border-border-light p-5">
              <Link href="https://sourcelibrary.org/book/6984e84d875ef560e34aef4e" className="text-accent-rust hover:text-accent-rust underline font-medium">
                Anna Maria van Schurman, <em>Opuscula</em>
              </Link>
              <p className="text-sm text-muted mt-1">Leiden, 1648</p>
              <p className="text-secondary text-sm leading-relaxed mt-2 font-body">
                The collected works of &ldquo;the most learned woman in the world,&rdquo; as her contemporaries called her. Schurman was a polymath who corresponded with Descartes and wrote in Latin, Greek, Hebrew, and several modern languages. Her <em>Opuscula</em> has never been published in English.
              </p>
            </div>

            <div className="bg-white rounded-xl border border-border-light p-5">
              <Link href="https://sourcelibrary.org/book/69529036b184004c526a17f8" className="text-accent-rust hover:text-accent-rust underline font-medium">
                Jacopo Filippo Foresti, <em>De claris selectisque mulieribus</em>
              </Link>
              <p className="text-sm text-muted mt-1">Ferrara, 1497</p>
              <p className="text-secondary text-sm leading-relaxed mt-2 font-body">
                A Renaissance catalogue of famous women, from antiquity to Foresti&apos;s own time. Written in Latin and never translated into English, it offers a 15th-century perspective on women&apos;s intellectual and political achievements.
              </p>
            </div>
          </div>

          <p className="text-secondary leading-relaxed font-body">
            Source Library has recently launched a{' '}
            <Link href="https://sourcelibrary.org/collections/women-esoteric-voices" className="text-accent-rust hover:text-accent-rust underline">Women&apos;s Voices</Link>{' '}
            collection gathering 35 books by and about women &mdash; from Madame Guyon and Antoinette Bourignon to Jane Lead, Catherine of Siena, Teresa of &Aacute;vila, and Marguerite Porete. Many of these are among the first translations in the library.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        {/* === Section 5: Kircher + Conring === */}
        <section className="mb-16">
          <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
            Two books that should have been translated long ago
          </h2>

          <p className="text-secondary leading-relaxed mb-8 font-body">
            Some of the first translations are genuinely surprising &mdash; books that are famous, widely discussed in secondary literature, and yet have never been rendered into English.
          </p>

          {/* Kircher with image */}
          <div className="bg-white rounded-xl border border-border-light overflow-hidden mb-6">
            <div className="md:flex">
              <div className="md:w-48 shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/4d4089b9-9227-4cc5-b0a2-9b06ee731061/2.jpg"
                  alt="Frontispiece of Athanasius Kircher's Oedipus Aegyptiacus, 1653"
                  className="w-full h-48 md:h-full object-cover"
                />
              </div>
              <div className="p-5 md:p-6">
                <Link href="https://sourcelibrary.org/book/69593d0aa41e40e9146a5a56" className="text-accent-rust hover:text-accent-rust underline font-medium">
                  Athanasius Kircher, <em>Oedipus Aegyptiacus</em>
                </Link>
                <p className="text-sm text-muted mt-1 mb-3">Rome, 1652&ndash;1654 &middot; 581 pages</p>
                <p className="text-secondary text-sm leading-relaxed font-body">
                  One of the most ambitious works of 17th-century scholarship: a 581-page attempt to decode Egyptian hieroglyphics, drawing on Coptic, Hebrew, Arabic, Chinese, and virtually every other written tradition Kircher could access. Cited in every history of Egyptology, every study of Baroque intellectual culture. No complete English translation had ever been published. The Latin original is now fully translated and readable.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-border-light p-5 md:p-6">
            <Link href="https://sourcelibrary.org/book/697d9c9c810ed7ecc13c1e5a" className="text-accent-rust hover:text-accent-rust underline font-medium">
              Hermann Conring, <em>De Hermetica Medicina</em>
            </Link>
            <p className="text-sm text-muted mt-1 mb-3">Helmstedt, 1649 &middot; 433 pages</p>
            <p className="text-secondary text-sm leading-relaxed font-body">
              A critical history of ancient Hermetic medicine &mdash; one of the earliest attempts to sort myth from evidence in the history of alchemy and early chemistry. Conring is a significant figure in the history of science, but this work has remained locked in Latin for nearly four centuries.
            </p>
          </div>
        </section>

        <hr className="border-border-light my-12" />

        {/* === Section 6: What this means === */}
        <section className="mb-16">
          <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
            What this means
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The first translations in Source Library are not a planned editorial project. They are a consequence of digitizing and translating everything in the collection &mdash; approaching the historical record without the filter of what previous generations decided was worth translating. When you translate thousands of non-English books, you discover that a large fraction of them simply fell through the cracks.
          </p>

          <p className="text-secondary leading-relaxed mb-8 font-body">
            The reasons differ. Some texts were too long (Kircher&apos;s 581 pages of dense Latin). Some were in the wrong language (the entire German alchemical tradition, the Sanskrit jyotish corpus). Some were by the wrong people (women, heterodox theologians, anonymous pamphleteers). Some were in the wrong field &mdash; too religious for historians of science, too scientific for historians of religion, too esoteric for both. And some were simply never prioritized by the small number of scholars who could have translated them.
          </p>

          {/* Pull quote */}
          <div className="border-l-4 border-accent-gold pl-6 my-12">
            <p className="text-lg text-secondary italic font-body leading-relaxed">
              AI translation does not replace scholarly editing. It cannot produce a critical apparatus, identify textual variants, or situate a passage in its full intellectual context. But it can do something that no human translator could do at this scale: it can make hundreds of previously unreadable books readable, all at once, and let readers decide for themselves what is important.
            </p>
          </div>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The history of translation has always been a history of selection &mdash; someone deciding what is worth the effort. AI removes that bottleneck. The texts can speak for themselves.
          </p>

          <p className="text-secondary leading-relaxed font-body">
            Classification is ongoing. Where deep bibliographic verification has been performed &mdash; as with the 95 astrology first translations &mdash; confidence is high: 85 of those 95 were identified with 80%+ confidence that no prior English translation exists. For the broader library, many identifications are based on the AI&apos;s initial assessment and await deeper review. If you are a specialist who knows of a prior translation we missed, we would welcome the correction.
          </p>
        </section>

        {/* === CTA box === */}
        <div className="bg-warm rounded-xl p-6 md:p-8 border border-border-light mb-8">
          <p className="font-serif text-lg text-primary mb-3">Explore the collection</p>
          <div className="grid md:grid-cols-3 gap-3">
            <Link href="https://sourcelibrary.org/collections/astrology" className="block bg-white rounded-lg p-4 border border-border-light hover:border-accent-rust/30 transition-colors group">
              <p className="font-medium text-sm text-stone-800 group-hover:text-accent-rust transition-colors">Astrology &amp; Divination</p>
              <p className="text-xs text-muted mt-1">95 first translations</p>
            </Link>
            <Link href="https://sourcelibrary.org/collections/women-esoteric-voices" className="block bg-white rounded-lg p-4 border border-border-light hover:border-accent-rust/30 transition-colors group">
              <p className="font-medium text-sm text-stone-800 group-hover:text-accent-rust transition-colors">Women&apos;s Voices</p>
              <p className="text-xs text-muted mt-1">35 books by and about women</p>
            </Link>
            <Link href="https://sourcelibrary.org/search" className="block bg-white rounded-lg p-4 border border-border-light hover:border-accent-rust/30 transition-colors group">
              <p className="font-medium text-sm text-stone-800 group-hover:text-accent-rust transition-colors">Search the library</p>
              <p className="text-xs text-muted mt-1">By language, date, or keyword</p>
            </Link>
          </div>
          <p className="text-sm text-muted mt-4 font-body">
            Every book preserves the original text alongside the translation for verification.
          </p>
        </div>

        {/* === Footer === */}
        <div className="border-t border-border-light pt-8 mt-16">
          <p className="text-secondary text-sm leading-relaxed font-body">
            Source Library is a project of the Embassy of the Free Mind. Everything in the collection is CC0 public domain. If you are a scholar who can improve any of these translations, or if you know of a prior English translation we missed, please reach out &mdash;{' '}
            <a href="mailto:derek@ancientwisdomtrust.org" className="text-accent-rust hover:text-accent-rust underline">derek@ancientwisdomtrust.org</a>.
          </p>
        </div>
      </article>

      <BlogComments slug="first-translations" />
    </ContentPageLayout>
  );
}
