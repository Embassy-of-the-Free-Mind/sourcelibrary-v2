import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import BlogComments from '@/components/blog/BlogComments';

export const metadata: Metadata = {
  title: 'Recovering the Chakra Tradition - Blog - Source Library',
  description: 'How Source Library is digitizing and translating the primary tantric sources on chakras, nadis, and kundalini — many for the first time in any Western language.',
  openGraph: {
    title: 'Recovering the Chakra Tradition',
    description: 'Digitizing and translating the primary tantric sources on chakras, nadis, and kundalini — many for the first time in any Western language.',
    images: [{ url: 'https://iiif.wellcomecollection.org/image/b33599051_0001.jp2/full/1000,/0/default.jpg', width: 1200, height: 630 }],
  },
  alternates: {
    canonical: '/blog/chakra-tradition',
  },
};

export default function ChakraTraditionPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Recovering the Chakra Tradition"
          subtitle="From Sanskrit Manuscripts to First English Translations"
        >
          <p className="text-stone-400 text-sm mt-4">15 February 2026 &middot; 12 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <div className="mb-6">
        <Link
          href="/blog"
          className="inline-flex items-center gap-2 text-muted hover:text-secondary transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          All posts
        </Link>
      </div>

      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-8">
          The word &ldquo;chakra&rdquo; has become so common in modern wellness culture that it is easy to forget it has a textual history stretching back over a thousand years. The system of subtle energy centres running along the spine &mdash; with its lotuses, seed syllables, presiding deities, and ascending kundalini &mdash; was never a single, fixed doctrine. It was a living tradition debated and refined across dozens of Sanskrit tantric texts, most of which have never been translated into English.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          Source Library is now working to change that. Over the past weeks we have imported, digitized, and begun translating a substantial collection of the primary Sanskrit sources on the chakra system, drawn from the Internet Archive, the Wellcome Collection, and the Cambridge Digital Library. Several of these texts have never appeared in any Western language. What follows is an overview of the tradition these texts represent, and why making them accessible matters.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The Roots: Before There Were Seven
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The earliest references to centres of power within the body appear in the Upanishads, but they look nothing like the familiar seven-chakra diagram hanging in yoga studios. The <em>Yoga Kundalini Upanishad</em> and the <em>Yoga Chudamani Upanishad</em> describe a channel (<em>nadi</em>) system and a coiled energy (<em>kundalini</em>) at the base of the spine, but the number and placement of the centres varies. Some texts describe four. Others describe five, or six, or nine.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          The standardization into a six-chakra system (plus the transcendent <em>sahasrara</em> at the crown) came relatively late, crystallizing in the 16th century <Link href="/book/6991d46921124c9ad6944323" className="text-accent-rust hover:text-accent-rust underline"><em>Sat-Cakra-Nirupana</em></Link> of Purnananda Yati. It was this text, translated by Arthur Avalon (Sir John Woodroffe) in 1919 as part of <em>The Serpent Power</em>, that became the basis for nearly everything the West knows about chakras. But Avalon&apos;s translation &mdash; brilliant and pioneering as it was &mdash; drew from a single lineage. The broader tradition is far richer, more varied, and in many cases more sophisticated than that one text can convey.
        </p>

        <div className="border-l-4 border-accent-gold/30 pl-6 mb-8">
          <p className="text-secondary italic mb-2">
            &ldquo;The notion that there is one &lsquo;correct&rsquo; chakra system is a modern invention. The original texts present a rich diversity of models, each embedded in its own ritual and philosophical context.&rdquo;
          </p>
          <p className="text-muted text-sm">
            &mdash; Christopher Wallis, <em>Tantra Illuminated</em>
          </p>
        </div>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The Core Texts
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The tantric literature on the subtle body is vast. At its centre stand a handful of foundational works that shaped how later authors understood chakras, nadis, and kundalini. Source Library now holds digitized copies of many of these, and several are in active translation:
        </p>

        <h3 className="text-xl text-stone-800 mb-3 mt-10">
          <Link href="/book/6953e2f677f38f6761bea397" className="hover:text-accent-gold-dark transition-colors">The Tantraloka of Abhinavagupta</Link>
        </h3>

        <p className="text-secondary leading-relaxed mb-6">
          The <Link href="/book/6953e2f677f38f6761bea397" className="text-accent-rust hover:text-accent-rust underline"><em>Tantraloka</em></Link> (&ldquo;Light on Tantra&rdquo;) is the masterwork of the Kashmiri Shaiva philosopher Abhinavagupta (c. 950&ndash;1016 CE). At nearly 4,000 pages in its Sanskrit editions, it is the most comprehensive synthesis of tantric philosophy and practice ever composed. No complete English translation exists. Source Library is currently translating the full text &mdash; 3,931 pages &mdash; which would represent the first time the complete <em>Tantraloka</em> has been available in English.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          Abhinavagupta&apos;s treatment of the subtle body is philosophically dense. Unlike later popular accounts, he grounds the chakra system in a sophisticated metaphysics of consciousness (<em>cit</em>) and its power of self-expression (<em>vimarsha</em>). The chakras are not fixed anatomical points but manifestations of consciousness at different degrees of contraction and expansion. Understanding this philosophical framework transforms how one reads every subsequent text in the tradition.
        </p>

        <h3 className="text-xl text-stone-800 mb-3 mt-10">
          <Link href="/book/6991d44821124c9ad694347c" className="hover:text-accent-gold-dark transition-colors">The Svacchanda Tantra</Link>
        </h3>

        <p className="text-secondary leading-relaxed mb-8">
          One of the oldest surviving Bhairava Tantras (perhaps 7th&ndash;8th century), the <Link href="/book/6991d44821124c9ad694347c" className="text-accent-rust hover:text-accent-rust underline"><em>Svacchanda Tantra</em></Link> presents an early and detailed map of the subtle body that differs in important ways from later standardizations. Source Library holds the complete <Link href="/book/6991d44821124c9ad694347c" className="text-accent-rust hover:text-accent-rust underline">five-volume Sanskrit edition</Link> with commentary (2,717 pages), recently imported and now being processed.
        </p>

        <h3 className="text-xl text-stone-800 mb-3 mt-10">
          <Link href="/book/6991d46421124c9ad6943f2b" className="hover:text-accent-gold-dark transition-colors">The Netra Tantra</Link>
        </h3>

        <p className="text-secondary leading-relaxed mb-8">
          A Shaiva text focused on the deity Amriteshvara, the <Link href="/book/6991d46421124c9ad6943f2b" className="text-accent-rust hover:text-accent-rust underline"><em>Netra Tantra</em></Link> (&ldquo;Tantra of the Eye&rdquo;) contains important material on kundalini yoga and the relationship between breath, consciousness, and the energy channels. Our edition runs to 616 pages. Like the <em>Svacchanda Tantra</em>, it has never been fully translated.
        </p>

        <h3 className="text-xl text-stone-800 mb-3 mt-10">
          <Link href="/book/6991d43921124c9ad6942bb9" className="hover:text-accent-gold-dark transition-colors">The Goraksha Samhita</Link>
        </h3>

        <p className="text-secondary leading-relaxed mb-8">
          Attributed to Gorakhnath, the legendary founder of the Nath tradition, this text bridges the gap between the high philosophy of Kashmir Shaivism and the practical hatha yoga that would become popular across India. The Nath yogis were the primary carriers of chakra knowledge into mainstream Indian religious culture. Our <Link href="/book/6991d43921124c9ad6942bb9" className="text-accent-rust hover:text-accent-rust underline">edition (655 pages)</Link> preserves teachings on the six chakras, kundalini awakening, and the network of nadis that became standard in later yoga manuals.
        </p>

        <h3 className="text-xl text-stone-800 mb-3 mt-10">
          <Link href="/book/6991d46921124c9ad6944323" className="hover:text-accent-gold-dark transition-colors">The Sat-Cakra-Nirupana &amp; Paduka-Pancaka</Link>
        </h3>

        <p className="text-secondary leading-relaxed mb-8">
          Purnananda Yati&apos;s 16th-century <Link href="/book/6991d46921124c9ad6944323" className="text-accent-rust hover:text-accent-rust underline"><em>Sat-Cakra-Nirupana</em></Link> (&ldquo;Description of the Six Centres&rdquo;) is the most influential single text on the chakra system. It provides the detailed descriptions of each chakra &mdash; number of petals, colour, seed syllable, presiding deity, element &mdash; that are now widely reproduced. Source Library holds the <Link href="/book/6991d46921124c9ad6944323" className="text-accent-rust hover:text-accent-rust underline">Sanskrit original (107 pages)</Link>, allowing readers to compare the source text against Avalon&apos;s influential translation. The Wellcome Collection also holds a separate <Link href="/book/6991d8938c1030b12444bfdb" className="text-accent-rust hover:text-accent-rust underline">manuscript edition</Link> and a remarkable <Link href="/book/6991d8978c1030b12444c035" className="text-accent-rust hover:text-accent-rust underline">illustrated version</Link> with hand-painted chakra diagrams.
        </p>

        <h3 className="text-xl text-stone-800 mb-3 mt-10">
          <Link href="/book/6991d89a8c1030b12444c076" className="hover:text-accent-gold-dark transition-colors">The Hathayogapradipika</Link>
        </h3>

        <p className="text-secondary leading-relaxed mb-8">
          Svatmarama&apos;s 15th-century manual is the most widely known hatha yoga text, and its treatment of <em>pranayama</em>, <em>bandhas</em>, <em>mudras</em>, and kundalini awakening represents the practical application of the subtle body theory developed in the tantric texts. Source Library holds multiple editions, including a <Link href="/book/6991d89a8c1030b12444c076" className="text-accent-rust hover:text-accent-rust underline">version from the Wellcome Collection</Link> with both the <em>Jyotsna</em> and <em>Manobhilasini</em> commentaries (200 pages) &mdash; offering layers of interpretation rarely available in translation.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Beyond the Familiar
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Several texts in our collection go well beyond the standard chakra model, revealing the full richness of Indian subtle body theory:
        </p>

        <ul className="space-y-4 text-secondary mb-8">
          <li className="flex items-start gap-3">
            <span className="text-accent-rust mt-1.5 shrink-0">&bull;</span>
            <span>
              <Link href="/book/6991d43e21124c9ad6942e4d" className="text-accent-rust hover:text-accent-rust underline"><strong>Kaulajnana Nirnaya</strong></Link> (attributed to Matsyendranath) &mdash; Perhaps the oldest surviving Kaula text, this 1,414-page work describes a chakra system embedded in transgressive ritual and goddess worship that predates the &ldquo;cleaned up&rdquo; versions found in later yoga manuals.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-accent-rust mt-1.5 shrink-0">&bull;</span>
            <span>
              <Link href="/book/6991d44321124c9ad69433d6" className="text-accent-rust hover:text-accent-rust underline"><strong>Siddha Siddhanta Paddhati</strong></Link> (attributed to Gorakhnath) &mdash; This text maps nine chakras (not six or seven) and describes the body as a microcosm containing the entire universe &mdash; mountains, rivers, sacred sites, and celestial realms all located within the practitioner&apos;s own subtle anatomy. 161 pages.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-accent-rust mt-1.5 shrink-0">&bull;</span>
            <span>
              <Link href="/book/6991d46721124c9ad6944195" className="text-accent-rust hover:text-accent-rust underline"><strong>Tantraraja Tantra</strong></Link> &mdash; A major Shakta text focused on the goddess Tripurasundari, containing detailed practices involving chakra visualization and mantra that operate within a framework quite different from the Shaiva texts. 396 pages.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-accent-rust mt-1.5 shrink-0">&bull;</span>
            <span>
              <Link href="/book/6991d8a08c1030b12444c14c" className="text-accent-rust hover:text-accent-rust underline"><strong>Paramesvaratantra</strong></Link> (828 CE) &mdash; A unique early witness from the Cambridge Digital Library, this palm-leaf manuscript is one of the oldest dateable tantric texts in existence. 124 pages from the original manuscript.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-accent-rust mt-1.5 shrink-0">&bull;</span>
            <span>
              <Link href="/book/6991d89d8c1030b12444c140" className="text-accent-rust hover:text-accent-rust underline"><strong>Chakra and Nadi in the Shaiva Tradition</strong></Link> &mdash; An illustrated manuscript from the Wellcome Collection showing the subtle body maps as living visual art, not just textual description.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-accent-rust mt-1.5 shrink-0">&bull;</span>
            <span>
              <Link href="/book/6953e30277f38f6761beb46f" className="text-accent-rust hover:text-accent-rust underline"><strong>Kularnava Tantra</strong></Link> &mdash; One of the most important Kaula texts, containing teachings on guru-disciple initiation, the transformation of desire into spiritual practice, and the subtle body as a site of ritual action. Source Library also holds <Link href="/book/6953e30577f38f6761beb59f" className="text-accent-rust hover:text-accent-rust underline">Arthur Avalon&apos;s English translation</Link> for comparison.
            </span>
          </li>
        </ul>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Why Translation Matters
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The modern understanding of chakras in the West derives almost entirely from three sources: Arthur Avalon&apos;s 1919 <em>The Serpent Power</em>, C.W. Leadbeater&apos;s 1927 Theosophical reinterpretation, and their popularization through 20th-century yoga culture. Each layer added simplifications and distortions. Leadbeater introduced the rainbow colour scheme (red, orange, yellow, green, blue, indigo, violet) that appears nowhere in the Sanskrit sources. The original texts assign colours based on elemental and deity associations that vary from text to text.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Making the primary sources available in English &mdash; in their full complexity, with their internal disagreements intact &mdash; is not an academic exercise. It restores the tradition to its actual depth. Readers can discover that the chakra system was not a fixed anatomical model but a sophisticated technology of consciousness, intimately connected to specific deities, mantras, cosmological principles, and ritual practices.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          These translations are produced using AI (Google&apos;s Gemini models), with the original Sanskrit always preserved alongside the English for verification. They are working translations &mdash; first drafts that make previously inaccessible texts readable for the first time. We hope they will serve as a foundation for future scholarly editions and deeper study.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          What&apos;s Available Now
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Source Library currently holds over 70 texts related to yoga, tantra, and the subtle body tradition. The core chakra collection includes:
        </p>

        <div className="overflow-x-auto mb-8">
          <table className="w-full text-sm text-secondary border-collapse">
            <thead>
              <tr className="border-b-2 border-stone-300">
                <th className="text-left py-3 pr-4 font-semibold text-primary">Text</th>
                <th className="text-left py-3 pr-4 font-semibold text-primary">Pages</th>
                <th className="text-left py-3 pr-4 font-semibold text-primary">Source</th>
                <th className="text-left py-3 font-semibold text-primary">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200">
              <tr>
                <td className="py-3 pr-4"><Link href="/book/6953e2f677f38f6761bea397" className="text-accent-rust hover:text-accent-rust underline">Tantraloka</Link></td>
                <td className="py-3 pr-4">3,931</td>
                <td className="py-3 pr-4">Internet Archive</td>
                <td className="py-3">Translating</td>
              </tr>
              <tr>
                <td className="py-3 pr-4"><Link href="/book/6991d44821124c9ad694347c" className="text-accent-rust hover:text-accent-rust underline">Svacchanda Tantra (5 vols)</Link></td>
                <td className="py-3 pr-4">2,717</td>
                <td className="py-3 pr-4">Internet Archive</td>
                <td className="py-3">Digitized</td>
              </tr>
              <tr>
                <td className="py-3 pr-4"><Link href="/book/6991d43e21124c9ad6942e4d" className="text-accent-rust hover:text-accent-rust underline">Kaulajnana Nirnaya</Link></td>
                <td className="py-3 pr-4">1,414</td>
                <td className="py-3 pr-4">Internet Archive</td>
                <td className="py-3">Digitized</td>
              </tr>
              <tr>
                <td className="py-3 pr-4"><Link href="/book/6991d43921124c9ad6942bb9" className="text-accent-rust hover:text-accent-rust underline">Goraksha Samhita</Link></td>
                <td className="py-3 pr-4">655</td>
                <td className="py-3 pr-4">Internet Archive</td>
                <td className="py-3">Digitized</td>
              </tr>
              <tr>
                <td className="py-3 pr-4"><Link href="/book/6991d46421124c9ad6943f2b" className="text-accent-rust hover:text-accent-rust underline">Netra Tantra</Link></td>
                <td className="py-3 pr-4">616</td>
                <td className="py-3 pr-4">Internet Archive</td>
                <td className="py-3">Digitized</td>
              </tr>
              <tr>
                <td className="py-3 pr-4"><Link href="/book/6991d46721124c9ad6944195" className="text-accent-rust hover:text-accent-rust underline">Tantraraja Tantra</Link></td>
                <td className="py-3 pr-4">396</td>
                <td className="py-3 pr-4">Internet Archive</td>
                <td className="py-3">Digitized</td>
              </tr>
              <tr>
                <td className="py-3 pr-4"><Link href="/book/6991d89a8c1030b12444c076" className="text-accent-rust hover:text-accent-rust underline">Hathayogapradipika (with commentaries)</Link></td>
                <td className="py-3 pr-4">200</td>
                <td className="py-3 pr-4">Wellcome Collection</td>
                <td className="py-3">Digitized</td>
              </tr>
              <tr>
                <td className="py-3 pr-4"><Link href="/book/6991d44321124c9ad69433d6" className="text-accent-rust hover:text-accent-rust underline">Siddha Siddhanta Paddhati</Link></td>
                <td className="py-3 pr-4">161</td>
                <td className="py-3 pr-4">Internet Archive</td>
                <td className="py-3">Digitized</td>
              </tr>
              <tr>
                <td className="py-3 pr-4"><Link href="/book/6991d8ac8c1030b12444c781" className="text-accent-rust hover:text-accent-rust underline">Kriyakandakramavali</Link></td>
                <td className="py-3 pr-4">156</td>
                <td className="py-3 pr-4">Cambridge Digital Library</td>
                <td className="py-3">Digitized</td>
              </tr>
              <tr>
                <td className="py-3 pr-4"><Link href="/book/6991d8a08c1030b12444c14c" className="text-accent-rust hover:text-accent-rust underline">Paramesvaratantra (828 CE)</Link></td>
                <td className="py-3 pr-4">124</td>
                <td className="py-3 pr-4">Cambridge Digital Library</td>
                <td className="py-3">Digitized</td>
              </tr>
              <tr>
                <td className="py-3 pr-4"><Link href="/book/6991d46921124c9ad6944323" className="text-accent-rust hover:text-accent-rust underline">Sat-Cakra-Nirupana</Link></td>
                <td className="py-3 pr-4">107</td>
                <td className="py-3 pr-4">Internet Archive</td>
                <td className="py-3">Digitized</td>
              </tr>
              <tr>
                <td className="py-3 pr-4"><Link href="/book/6991d8938c1030b12444bfdb" className="text-accent-rust hover:text-accent-rust underline">Satchakranirupanam</Link></td>
                <td className="py-3 pr-4">88</td>
                <td className="py-3 pr-4">Wellcome Collection</td>
                <td className="py-3">Digitized</td>
              </tr>
              <tr>
                <td className="py-3 pr-4"><Link href="/book/6991d8978c1030b12444c035" className="text-accent-rust hover:text-accent-rust underline">Satchakranirupanacitram (Illustrated)</Link></td>
                <td className="py-3 pr-4">63</td>
                <td className="py-3 pr-4">Wellcome Collection</td>
                <td className="py-3">Digitized</td>
              </tr>
              <tr>
                <td className="py-3 pr-4"><Link href="/book/6991d8a38c1030b12444c221" className="text-accent-rust hover:text-accent-rust underline">Vajramratatantra</Link></td>
                <td className="py-3 pr-4">12</td>
                <td className="py-3 pr-4">Cambridge Digital Library</td>
                <td className="py-3">Digitized</td>
              </tr>
              <tr>
                <td className="py-3 pr-4"><Link href="/book/6991d89d8c1030b12444c140" className="text-accent-rust hover:text-accent-rust underline">Chakra and Nadi in the Shaiva Tradition</Link></td>
                <td className="py-3 pr-4">10</td>
                <td className="py-3 pr-4">Wellcome Collection</td>
                <td className="py-3">Digitized</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-8">
          All texts are freely available under CC0. The Sanskrit originals are preserved alongside any translations, and every page links back to its source institution. This is a growing collection &mdash; as we process, translate, and verify these texts, their status will update on the site.
        </p>

        <div className="bg-accent-gold/5 rounded-lg p-6 border border-accent-gold/15 mb-8">
          <p className="text-stone-700 leading-relaxed">
            <strong>Explore the collection:</strong> Search for <Link href="/search?q=tantra" className="text-accent-rust hover:text-accent-rust underline">tantra</Link>, <Link href="/search?q=chakra" className="text-accent-rust hover:text-accent-rust underline">chakra</Link>, or <Link href="/search?q=kundalini" className="text-accent-rust hover:text-accent-rust underline">kundalini</Link> in the library, or browse the <Link href="/gallery" className="text-accent-rust hover:text-accent-rust underline">gallery</Link> for illustrations from these manuscripts.
          </p>
        </div>

        <div className="flex flex-wrap gap-4 pt-8 border-t border-border-light">
          <Link
            href="/"
            className="px-5 py-2.5 bg-stone-900 text-white rounded-full hover:bg-stone-800 transition-colors"
          >
            Browse the Library
          </Link>
          <Link
            href="/support"
            className="px-5 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors"
          >
            Support the Project
          </Link>
        </div>
      </article>

      <BlogComments slug="chakra-tradition" />
    </ContentPageLayout>
  );
}
