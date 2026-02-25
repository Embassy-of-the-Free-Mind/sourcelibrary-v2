import { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import BlogComments from '@/components/blog/BlogComments';

export const metadata: Metadata = {
  title: 'Reading the Stars: Astrological Diagrams from Nine Centuries — Blog — Source Library',
  description: 'A visual tour of Source Library\'s astrological collection: from the 10th-century Dunhuang Star Chart to Kepler\'s cosmic harmonics, with the original diagrams that mapped humanity\'s relationship to the heavens.',
  alternates: {
    canonical: '/blog/astrological-diagrams',
  },
};

// Timeline data — chronological order
const timelineEras = [
  {
    era: 'Ancient World',
    entries: [
      { year: 'c. 150 CE', label: 'Ptolemy', work: 'Tetrabiblos', lang: 'Greek', langColor: 'text-accent-violet bg-accent-violet/10', note: 'Foundation of Western astrology' },
      { year: 'c. 550 CE', label: 'Varahamihira', work: 'Brihat Jataka', lang: 'Sanskrit', langColor: 'text-accent-sage-dark bg-accent-sage/10', note: 'Foundational Indian natal horoscopy' },
    ],
  },
  {
    era: 'Islamic Golden Age',
    entries: [
      { year: '787–886 CE', label: 'Abu Ma\'shar', work: 'Kitāb al-Mudkhal', lang: 'Arabic', langColor: 'text-accent-gold-dark bg-accent-gold/10', note: 'Bridge from antiquity to medieval Europe' },
    ],
  },
  {
    era: 'Medieval',
    entries: [
      { year: 'c. 900 CE', label: 'Dunhuang Star Chart', work: 'Pelliot chinois 3594', lang: 'Chinese', langColor: 'text-accent-rust bg-accent-rust/10', note: 'Oldest known complete star atlas' },
      { year: 'c. 1440', label: 'John Dunstable', work: 'Judicial Astrology & Astronomy', lang: 'Latin', langColor: 'text-secondary bg-stone-100', note: 'Medieval English astrological compilation' },
    ],
  },
  {
    era: 'Early Print Era',
    entries: [
      { year: '1484', label: 'Ptolemy / Hali', work: 'Quadripartitum (first print)', lang: 'Latin', langColor: 'text-secondary bg-stone-100', note: 'First printed edition with horoscope diagrams' },
      { year: '1489', label: 'Abu Ma\'shar', work: 'Introductorium in Astronomiam', lang: 'Latin', langColor: 'text-secondary bg-stone-100', note: 'Venetian incunable' },
    ],
  },
  {
    era: 'Scientific Revolution',
    entries: [
      { year: '1543', label: 'Copernicus', work: 'De revolutionibus orbium coelestium', lang: 'Latin', langColor: 'text-secondary bg-stone-100', note: 'The heliocentric revolution' },
      { year: '1571', label: 'Paracelsus', work: 'Astronomia Magna', lang: 'German', langColor: 'text-secondary bg-stone-100', note: 'Celestial forces in medicine' },
      { year: '1619', label: 'Kepler', work: 'Harmonices Mundi', lang: 'Latin', langColor: 'text-secondary bg-stone-100', note: 'Geometry, harmony, and the planets' },
    ],
  },
  {
    era: 'Baroque Science',
    entries: [
      { year: '1650', label: 'Gaffarel', work: 'Curiositez inouyes', lang: 'French', langColor: 'text-accent-rust bg-accent-gold/8', note: 'Talismanic astrology and celestial scripts' },
      { year: '1656', label: 'Kircher', work: 'Itinerarium Exstaticum', lang: 'Latin', langColor: 'text-secondary bg-stone-100', note: 'A Jesuit\'s ecstatic voyage through the cosmos' },
      { year: '1671', label: 'Kircher', work: 'Ars Magna Lucis et Umbrae', lang: 'Latin', langColor: 'text-secondary bg-stone-100', note: 'Light, shadow, and the stellar sphere' },
    ],
  },
];

export default function AstrologicalDiagramsPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Reading the Stars"
          subtitle="Astrological Diagrams from Nine Centuries of the Heavens"
        >
          <p className="text-stone-400 text-sm mt-4">21 February 2026 &middot; 20 min read</p>
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

        {/* Opening */}
        <p className="text-xl text-secondary leading-relaxed mb-8">
          For most of human history, the sky was not decoration. It was a text. The planets moved through the zodiacal constellations according to measurable laws, and those movements, it was universally believed by the most learned scholars of four continents, bore directly on the fate of kingdoms, the health of bodies, and the character of souls. Astrology was not the superstitious cousin of astronomy: it <em>was</em> astronomy, practiced by the same men, using the same instruments and tables, toward overlapping ends.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          Source Library holds dozens of primary astrological texts spanning from a 10th-century Chinese manuscript to a Jesuit polymath&rsquo;s encyclopaedia of light and shadow in 1671. Together they form an unbroken record of how humanity read the heavens — in Greek, Latin, Arabic, Sanskrit, Persian, Chinese, and early modern German. This post tours the most visually remarkable of those documents: the diagrams, maps, and emblems through which astrologers organized the sky into meaning.
        </p>

        {/* Timeline */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-8">
          A Timeline of the Collection
        </h2>

        <p className="text-secondary leading-relaxed mb-8">
          The works span nine centuries and six languages. Scroll left and right if needed. Each entry links to the book in the collection.
        </p>

        <div className="mb-16 space-y-8">
          {timelineEras.map((era) => (
            <div key={era.era}>
              {/* Era header */}
              <div className="flex items-center gap-3 mb-4">
                <span className="text-xs font-semibold tracking-widest uppercase text-muted">{era.era}</span>
                <div className="flex-1 h-px bg-border-light" />
              </div>
              {/* Entries */}
              <div className="pl-4 border-l-2 border-accent-gold/12 space-y-4">
                {era.entries.map((entry) => (
                  <div key={entry.year + entry.work} className="relative flex gap-4 items-start group">
                    {/* Dot on the line */}
                    <div className="absolute -left-[21px] top-1.5 w-2.5 h-2.5 rounded-full bg-accent-gold border-2 border-accent-gold/20 shrink-0" />
                    {/* Year */}
                    <div className="w-28 shrink-0">
                      <span className="text-sm font-bold text-accent-rust tabular-nums">{entry.year}</span>
                    </div>
                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <span className="font-semibold text-primary text-sm">{entry.label}</span>
                      <span className="text-secondary text-sm">, <em>{entry.work}</em></span>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${entry.langColor}`}>{entry.lang}</span>
                        <span className="text-xs text-muted">{entry.note}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* === SECTION 1: Dunhuang === */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The Oldest Star Map: Dunhuang (c. 900&nbsp;CE)
        </h2>

        <div className="grid md:grid-cols-2 gap-8 mb-8 items-start">
          <div>
            <p className="text-secondary leading-relaxed mb-4">
              Discovered in Cave 17 of the Mogao Grottoes near Dunhuang in 1900, this manuscript is one of the earliest known comprehensive star atlases in the world. Rolled up among thousands of Buddhist texts sealed in the cave around 1000&nbsp;CE, it charts over 1,300 stars across 13 segments of the sky using a cylindrical projection technique strikingly similar to modern cartography.
            </p>
            <p className="text-secondary leading-relaxed mb-4">
              Chinese astronomical tradition mapped the heavens differently from the Greek. Where Western astrology divided the ecliptic into twelve zodiacal signs, the Chinese system organised the sky into 28 <em>lunar lodges</em> (<em>xiù</em>) marking the moon&rsquo;s nightly stations, plus three enclosures surrounding the north celestial pole. The result is a sky that looks unfamiliar to Western eyes but no less systematic — and the Dunhuang chart executes it with beautiful precision in ink on paper scroll.
            </p>
            <p className="text-secondary leading-relaxed">
              The manuscript is held at the Bibliothèque nationale de France (Pelliot chinois 3594) and is now{' '}
              <Link href="/book/6992ca1ad4d545ae73fed806" className="text-accent-rust hover:text-accent-rust underline">
                in Source Library
              </Link>
              {' '}with a full English translation.
            </p>
          </div>
          <div>
            <figure>
              <div className="rounded-xl overflow-hidden border border-accent-gold/10 shadow-md">
                <Image
                  src="https://gallica.bnf.fr/iiif/ark:/12148/btv1b8300637x/f2/full/800,/0/default.jpg"
                  alt="Dunhuang Star Chart, c. 900 CE — Chinese star atlas showing lunar lodges"
                  width={800}
                  height={600}
                  className="w-full h-auto"
                  unoptimized
                />
              </div>
              <figcaption className="text-xs text-muted mt-2 text-center">
                Pelliot chinois 3594, c. 900 CE. One of the oldest comprehensive star atlases in the world.{' '}
                <Link href="/book/6992ca1ad4d545ae73fed806" className="text-accent-rust hover:text-accent-rust">
                  View in collection →
                </Link>
              </figcaption>
            </figure>
          </div>
        </div>

        {/* === SECTION 2: Ptolemy === */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The Greek Foundation: Ptolemy&rsquo;s <em>Quadripartitum</em> (1484)
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The Egyptian astronomer Claudius Ptolemy, working in Alexandria around 150&nbsp;CE, produced two texts that would dominate Western cosmology for fifteen centuries. The <em>Almagest</em> (now{' '}
          <Link href="/book/6993881874305116d72cf0ab" className="text-accent-rust hover:text-accent-rust underline">in the collection</Link>
          ) was the mathematical atlas of the heavens. The <em>Tetrabiblos</em> — &ldquo;Four Books&rdquo; — was the interpretive companion, explaining how planetary positions at birth determine character, health, and fate. In Latin translation it circulated as the <em>Quadripartitum</em>, and the 1484 Venetian printed edition{' '}
          <Link href="/book/69906313e7b7642c081de828" className="text-accent-rust hover:text-accent-rust underline">now in Source Library</Link>
          {' '}is one of the earliest printed astrological books in existence.
        </p>

        {/* Two-image grid */}
        <div className="grid md:grid-cols-2 gap-6 mb-8">
          <figure>
            <div className="rounded-xl overflow-hidden border border-accent-gold/10 shadow-md bg-stone-100">
              <Image
                src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/69906313e7b7642c081de828/8.jpg"
                alt="Astrological horoscope chart from Ptolemy's Quadripartitum, 1484 — twelve houses in square format"
                width={800}
                height={1000}
                className="w-full h-auto"
              />
            </div>
            <figcaption className="text-xs text-muted mt-2 text-center">
              Page 8: The horoscope chart. Twelve triangular and diamond-shaped &ldquo;houses&rdquo; labelled in Latin — the basic framework of Western natal astrology.{' '}
              <Link href="/book/69906313e7b7642c081de828" className="text-accent-rust hover:text-accent-rust">View →</Link>
            </figcaption>
          </figure>
          <figure>
            <div className="rounded-xl overflow-hidden border border-accent-gold/10 shadow-md bg-stone-100">
              <Image
                src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/69906313e7b7642c081de828/22.jpg"
                alt="Circular zodiac diagram from Ptolemy's Quadripartitum — twelve signs and their geometric aspects"
                width={800}
                height={1000}
                className="w-full h-auto"
              />
            </div>
            <figcaption className="text-xs text-muted mt-2 text-center">
              Page 22: The twelve zodiac signs and their geometric <em>aspects</em> — the angular relationships (opposition, trine, square) that determine planetary influence.{' '}
              <Link href="/book/69906313e7b7642c081de828" className="text-accent-rust hover:text-accent-rust">View →</Link>
            </figcaption>
          </figure>
        </div>

        <p className="text-secondary leading-relaxed mb-6">
          The horoscope chart on page 8 is an early printed version of a diagram that had been drawn by hand in manuscripts for a thousand years. The twelve houses — domains of life ranging from body and wealth to death and the afterlife — are arranged around a central diamond. Above left sits the ascendant, the degree of the zodiac rising on the eastern horizon at the moment of birth. This single diagram encapsulates the entire logic of natal astrology: a snapshot of the sky at the instant of first breath, from which a trained astrologer could read a lifetime.
        </p>

        <div className="border-l-4 border-accent-gold/30 pl-6 mb-8">
          <p className="text-secondary italic mb-2">
            &ldquo;The astrologer does not speak of what must necessarily happen, but of what is likely to happen according to the stars&rsquo; natural inclination.&rdquo;
          </p>
          <p className="text-muted text-sm">
            &mdash; Claudius Ptolemy, <em>Tetrabiblos</em>, Book I — translated in{' '}
            <Link href="/book/69906057ef12272ffdc8ce25" className="text-accent-rust hover:text-accent-rust underline">Source Library</Link>
          </p>
        </div>

        {/* === SECTION 3: Abu Ma'shar === */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The Arabic Bridge: Abu Ma&rsquo;shar&rsquo;s <em>Introductorium</em> (1489)
        </h2>

        <div className="grid md:grid-cols-2 gap-8 mb-8 items-start">
          <figure className="order-2 md:order-1">
            <div className="rounded-xl overflow-hidden border border-accent-gold/10 shadow-md bg-stone-100">
              <Image
                src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/69905e3c2fd6a039938a1980/5.jpg"
                alt="Page from Abu Ma'shar's Introductorium in Astronomiam, Venice 1489"
                width={800}
                height={1100}
                className="w-full h-auto"
              />
            </div>
            <figcaption className="text-xs text-muted mt-2 text-center">
              Abu Ma&rsquo;shar, <em>Introductorium in Astronomiam</em>, Venice 1489. One of the most influential Arabic texts translated into Latin.{' '}
              <Link href="/book/69905e3c2fd6a039938a1980" className="text-accent-rust hover:text-accent-rust">View →</Link>
            </figcaption>
          </figure>
          <div className="order-1 md:order-2">
            <p className="text-secondary leading-relaxed mb-4">
              When Greek learning was largely lost to Western Europe after the fall of Rome, it survived and flourished in the Islamic world. Abu Ma&rsquo;shar al-Balkhi (787–886&nbsp;CE), working in Baghdad, was the greatest astrologer of the Abbasid period. His <em>Kitāb al-Mudkhal al-Kabīr</em> — the <em>Great Introduction to Astrology</em> — synthesized Ptolemy, Persian astronomical tables, and Indian <em>jyotiṣa</em> tradition into a single comprehensive system.
            </p>
            <p className="text-secondary leading-relaxed mb-4">
              When his works were translated into Latin in the 12th century, they electrified European natural philosophy. Abu Ma&rsquo;shar argued, on Aristotelian grounds, that the planets acted on earthly matter through heat, moisture, cold, and dryness — the four elemental qualities. This made astrology compatible with scholastic natural philosophy and gave it a theoretical foundation it would not lose until Descartes.
            </p>
            <p className="text-secondary leading-relaxed">
              The 1489 Venetian incunable{' '}
              <Link href="/book/69905e3c2fd6a039938a1980" className="text-accent-rust hover:text-accent-rust underline">in Source Library</Link>
              {' '}is a landmark of early printing: one of the first Arabic-derived scientific texts to reach a mass audience.
            </p>
          </div>
        </div>

        {/* === SECTION 4: Dunstable === */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Medieval England: Dunstable&rsquo;s Judicial Astrology (c. 1440)
        </h2>

        <div className="grid md:grid-cols-2 gap-8 mb-8 items-start">
          <div>
            <p className="text-secondary leading-relaxed mb-4">
              John Dunstable (c. 1390–1453) is primarily remembered as one of the founders of Renaissance polyphonic music — the English composer who revolutionised harmony in fifteenth-century Europe. What is less often noted is that he was also a distinguished astronomer and astrologer who compiled a major treatise on judicial astrology: the branch of the art concerned with predicting worldly events from celestial configurations.
            </p>
            <p className="text-secondary leading-relaxed mb-4">
              Judicial astrology was controversial in medieval Europe. The Church objected to its apparent determinism — if the stars fixed your fate, what room remained for free will or grace? Dunstable navigated this carefully: the heavens <em>incline</em> but do not <em>compel</em>. His compilation draws on Arabic sources (including Abu Ma&rsquo;shar), older Latin translations, and original astronomical tables.
            </p>
            <p className="text-secondary leading-relaxed">
              The manuscript{' '}
              <Link href="/book/69906e6d8a353648e1ecfd91" className="text-accent-rust hover:text-accent-rust underline">in Source Library</Link>
              {' '}is a rare survival: a complete Latin treatise on judicial and horary astrology from 15th-century England, now with English translation.
            </p>
          </div>
          <figure>
            <div className="rounded-xl overflow-hidden border border-accent-gold/10 shadow-md bg-stone-100">
              <Image
                src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/69906e6d8a353648e1ecfd91/15.jpg"
                alt="Page from John Dunstable's Judicial Astrology and Astronomy, c. 1440"
                width={800}
                height={1100}
                className="w-full h-auto"
              />
            </div>
            <figcaption className="text-xs text-muted mt-2 text-center">
              John Dunstable, <em>Judicial Astrology and Astronomy</em>, c.&nbsp;1440. The composer-astronomer&rsquo;s astrological compilation.{' '}
              <Link href="/book/69906e6d8a353648e1ecfd91" className="text-accent-rust hover:text-accent-rust">View →</Link>
            </figcaption>
          </figure>
        </div>

        {/* === SECTION 5: Copernicus === */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The Diagram That Changed Everything: Copernicus, 1543
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          In 1543, the year Nicolaus Copernicus died, his <em>De revolutionibus orbium coelestium</em> was published in Nuremberg. The book proposed that the Sun, not the Earth, stands at the centre of the cosmos — a claim so radical that Copernicus had apparently withheld it from publication for decades, and the first printed copy reached him, according to legend, only on his deathbed.
        </p>

        {/* Hero image: Copernicus heliocentric diagram */}
        <figure className="mb-8">
          <div className="rounded-xl overflow-hidden border border-accent-gold/10 shadow-lg bg-stone-100 max-w-2xl mx-auto">
            <Image
              src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/694b3b5b58a47807cc735dce/34.jpg"
              alt="Heliocentric diagram from Copernicus's De revolutionibus orbium coelestium, 1543 — the Sun at the centre of nested planetary orbits"
              width={900}
              height={1100}
              className="w-full h-auto"
            />
          </div>
          <figcaption className="text-xs text-muted mt-2 text-center">
            <em>De revolutionibus</em>, Book I, page 34. The heliocentric diagram: the Sun at the centre, surrounded by Mercury, Venus, Earth with the Moon, Mars, Jupiter, Saturn, and the sphere of fixed stars.{' '}
            <Link href="/book/694b3b5b58a47807cc735dce" className="text-accent-rust hover:text-accent-rust">
              View in collection →
            </Link>
          </figcaption>
        </figure>

        <p className="text-secondary leading-relaxed mb-6">
          This woodcut — one of the most reproduced scientific diagrams in history — shows the Sun (<em>Sol</em>) in the central position, surrounded by concentric rings for Mercury, Venus, Earth (with the Moon circling it), Mars, Jupiter, Saturn, and the outermost sphere of fixed stars. The inscription at the centre reads <em>In hoc ergo centro mundi Sol residet</em>: &ldquo;In this centre of the universe, then, the Sun resides.&rdquo;
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          For astrology, the Copernican shift posed a profound challenge. The entire edifice of astrological theory rested on Earth&rsquo;s central position as the receiver of planetary influences. If Earth moved around the Sun, what became of the ascendant, the houses, the angles? Astrological practitioners of the 16th and 17th centuries largely ignored the problem and continued their calculations unchanged — the geocentric tables still worked — but the conceptual foundation had been quietly pulled away. The{' '}
          <Link href="/book/694b3b5b58a47807cc735dce" className="text-accent-rust hover:text-accent-rust underline">full text is in Source Library</Link>
          , with 411 pages and all the original woodcut diagrams, translated into English.
        </p>

        {/* === SECTION 6: Paracelsus === */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Celestial Medicine: Paracelsus&rsquo;s <em>Astronomia Magna</em> (1571)
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Theophrastus Bombastus von Hohenheim — Paracelsus — was the most controversial physician of the 16th century: a wandering empiricist who rejected university medicine, burned Galenic textbooks, and insisted that the physician must understand the stars before he could understand the body. His <em>Astronomia Magna oder die gantze Philosophia sagax der grossen und kleinen Welt</em> (&ldquo;The Great Astronomy, or the Complete Sagacious Philosophy of the Great and Small World,&rdquo; published 1571){' '}
          <Link href="/book/6956eae3b5d89fc3ccb47a2a" className="text-accent-rust hover:text-accent-rust underline">is now in Source Library in German</Link>
          {' '}with English translation.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          For Paracelsus, &ldquo;astronomy&rdquo; meant something far broader than celestial mechanics. Every human being contains a &ldquo;sidereal body&rdquo; — an inner constellation — that mediates between the outer cosmos and the physical flesh. The planets do not act on us mechanically from outside; they act through this inner firmament, which is why the physician must read both: the sky above and the microcosm within. This was astrology transformed into a theory of biological individuality, and it would influence medical thinking well into the 18th century.
        </p>

        <div className="bg-accent-gold/5 border border-accent-gold/12 rounded-xl p-6 mb-10">
          <p className="text-secondary italic mb-2">
            &ldquo;A physician who has no knowledge of astronomy can be no physician at all. He knows nothing, for heaven and earth are one, and what is above is also below.&rdquo;
          </p>
          <p className="text-muted text-sm">
            &mdash; Paracelsus, <em>Astronomia Magna</em> (1571) —{' '}
            <Link href="/book/6956eae3b5d89fc3ccb47a2a" className="text-accent-rust hover:text-accent-rust underline">translated in Source Library</Link>
          </p>
        </div>

        {/* === SECTION 7: Kepler === */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The Harmony of the Spheres: Kepler, 1619
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Johannes Kepler discovered the laws of planetary motion — the same Kepler who made his living as an imperial astrologer to Rudolf II. He believed both completely. The <em>Harmonices Mundi</em> (&ldquo;Harmony of the World,&rdquo; 1619){' '}
          <Link href="/book/6952d12e77f38f6761bc5bec" className="text-accent-rust hover:text-accent-rust underline">in Source Library</Link>
          {' '}contains his Third Law of Planetary Motion — the square of a planet&rsquo;s orbital period is proportional to the cube of its distance from the Sun — embedded within a vast Neoplatonic argument that the solar system is structured according to the five Platonic solids and musical ratios.
        </p>

        <div className="grid md:grid-cols-2 gap-6 mb-8">
          <figure>
            <div className="rounded-xl overflow-hidden border border-accent-gold/10 shadow-md bg-stone-100">
              <Image
                src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/6952d12e77f38f6761bc5bec/2.jpg"
                alt="Atlas or Hercules bearing an armillary sphere — bookplate engraving from Kepler's Harmonices Mundi, 1619"
                width={800}
                height={1100}
                className="w-full h-auto"
              />
            </div>
            <figcaption className="text-xs text-muted mt-2 text-center">
              Page 2: Atlas bearing an armillary sphere — the bookplate of the Burndy Library copy of <em>Harmonices Mundi</em>.{' '}
              <Link href="/book/6952d12e77f38f6761bc5bec" className="text-accent-rust hover:text-accent-rust">View →</Link>
            </figcaption>
          </figure>
          <figure>
            <div className="rounded-xl overflow-hidden border border-accent-gold/10 shadow-md bg-stone-100">
              <Image
                src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/6952d12e77f38f6761bc5bec/74.jpg"
                alt="Five Platonic solids from Kepler's Harmonices Mundi — the cosmic figures inscribing the planetary orbits"
                width={800}
                height={1100}
                className="w-full h-auto"
              />
            </div>
            <figcaption className="text-xs text-muted mt-2 text-center">
              Page 74: The five Platonic solids — the &ldquo;cosmic figures&rdquo; that, in Kepler&rsquo;s theory, nest inside one another to produce the exact spacing of the planetary orbits.{' '}
              <Link href="/book/6952d12e77f38f6761bc5bec" className="text-accent-rust hover:text-accent-rust">View →</Link>
            </figcaption>
          </figure>
        </div>

        <p className="text-secondary leading-relaxed mb-8">
          Kepler&rsquo;s argument is both beautiful and strange: the octahedron fits between Mercury and Venus, the icosahedron between Venus and Earth, the dodecahedron between Earth and Mars, the tetrahedron between Mars and Jupiter, the cube between Jupiter and Saturn. The music of the spheres is literally mathematical: each planet emits a &ldquo;tone&rdquo; as it moves from perihelion to aphelion, and the ratios of those tones form the intervals of counterpoint. Saturn and Jupiter together produce a major sixth. Earth sings a minor second — barely a semitone, reflecting our constrained, nearly circular orbit. This was science and music theory as one.
        </p>

        {/* === SECTION 8: Gaffarel === */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Stars as Script: Gaffarel&rsquo;s <em>Curiositez Inouyes</em> (1650)
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Jacques Gaffarel was librarian to Cardinal Richelieu and one of the strangest figures in the history of French letters. His <em>Curiositez inouyes sur la sculpture talismanique des Persans. Horoscope des Patriarches, et Lecture des Estoilles</em> (&ldquo;Unheard-of Curiosities on the Talismanic Sculpture of the Persians, the Horoscope of the Patriarchs, and the Reading of the Stars,&rdquo; 1650){' '}
          <Link href="/book/697a3055a3866af9498458ac" className="text-accent-rust hover:text-accent-rust underline">is in Source Library in French</Link>
          {' '}with English translation. It argues three remarkable claims.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          First: that the stars are not random but form an <em>alphabet</em> — a celestial script inscribed by God at creation, legible to anyone who knows how to read it. Second: that the Hebrew patriarchs, who lived to such extreme ages, did so because they were born under extraordinarily favourable celestial configurations — their horoscopes, he argues, can be reconstructed from Scripture. Third: that the Persian magi who visited the infant Christ were not astrologers in the ordinary sense but readers of this celestial script, following a literal star-word rather than a planetary conjunction.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          These claims were dangerous enough that Gaffarel was summoned before the Sorbonne and his book was temporarily suppressed. The <em>Curiositez</em> was later translated into English (1650) and reprinted multiple times, becoming an important text in the history of Christian Kabbalah and its intersection with astrological theory.
        </p>

        {/* === SECTION 9: Kircher === */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The Jesuit Cosmographer: Athanasius Kircher
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Athanasius Kircher (1602–1680) was the most prolific scholarly polymath of the 17th century: a Jesuit priest who wrote 40 books on music, cryptography, China, Egyptology, geology, optics, magnetism, and the construction of mechanical organs. Two of his major works are{' '}
          <Link href="/book/6952db5477f38f6761bc7402" className="text-accent-rust hover:text-accent-rust underline">in Source Library</Link>
          . The <em>Itinerarium Exstaticum</em> (1656) is an extraordinary cosmological dialogue in which Kircher is taken on an ecstatic journey through the heavens by the angel Cosmiel, visiting each planet in turn and receiving an account of its properties. Think Dante&rsquo;s <em>Paradiso</em> rewritten by a natural philosopher who has read Copernicus, Galileo, and Kepler.
        </p>

        {/* Three-image gallery */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <figure>
            <div className="rounded-xl overflow-hidden border border-accent-gold/10 shadow-md bg-stone-100">
              <Image
                src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/a5d0c381-d4ea-42cd-8864-44457e7fda33/5.jpg"
                alt="Allegorical frontispiece from Athanasius Kircher's Ars Magna Lucis et Umbrae, 1671"
                width={600}
                height={900}
                className="w-full h-auto"
              />
            </div>
            <figcaption className="text-xs text-muted mt-2 text-center">
              <em>Ars Magna</em> frontispiece — allegory of light and shadow.
            </figcaption>
          </figure>
          <figure>
            <div className="rounded-xl overflow-hidden border border-accent-gold/10 shadow-md bg-stone-100">
              <Image
                src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/a5d0c381-d4ea-42cd-8864-44457e7fda33/2.jpg"
                alt="Atlas bearing an armillary sphere from Kircher's Ars Magna Lucis et Umbrae"
                width={600}
                height={900}
                className="w-full h-auto"
              />
            </div>
            <figcaption className="text-xs text-muted mt-2 text-center">
              Atlas bearing the armillary sphere — Kircher&rsquo;s emblem of the celestial science.
            </figcaption>
          </figure>
          <figure>
            <div className="rounded-xl overflow-hidden border border-accent-gold/10 shadow-md bg-stone-100">
              <Image
                src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/a5d0c381-d4ea-42cd-8864-44457e7fda33/366.jpg"
                alt="Circular star map with zodiac constellations from Kircher's Ars Magna Lucis et Umbrae — Sciathericon stellarum fixarum"
                width={600}
                height={900}
                className="w-full h-auto"
              />
            </div>
            <figcaption className="text-xs text-muted mt-2 text-center">
              <em>Sciathericon Stellarum Fixarum</em>: star positions mapped by zodiac hour, for use in sundial construction.
            </figcaption>
          </figure>
        </div>

        <p className="text-secondary leading-relaxed mb-6">
          The third image above is from the <em>Ars Magna Lucis et Umbrae</em> (1671) — &ldquo;The Great Art of Light and Shadow&rdquo; — Kircher&rsquo;s encyclopaedia of optics and light. The diagram is a <em>Sciathericon Stellarum Fixarum</em>: a map of fixed star positions organised by zodiac sign, designed for calculating sundial gnomonic lines at any latitude. But what makes it arresting is that it doubles as a complete star map: all the major constellations are labelled, and their positions relative to the zodiac are precisely plotted. This is practical astronomy inseparable from astrological geometry.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          Kircher accepted the broad outline of the Copernican cosmos while rejecting Galileo&rsquo;s specific mechanical claims. He was, like most learned Europeans of his era, trying to hold together a cosmos that was rapidly splitting between the mathematical and the theological — to maintain a universe in which the planets were still angels, the music of the spheres was still audible to the attentive soul, and the fixed stars were still signs written for human benefit. The{' '}
          <Link href="/book/a5d0c381-d4ea-42cd-8864-44457e7fda33" className="text-accent-rust hover:text-accent-rust underline">
            <em>Ars Magna</em>
          </Link>
          {' '}is 760 pages and represents the last great baroque synthesis of natural philosophy and celestial symbolism.
        </p>

        {/* === SECTION 10: Indian Astrology === */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The Parallel Tradition: Indian Astrology
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          While Western astrology developed from Babylonian, Greek, and Arabic sources, the Indian tradition — <em>jyotiṣa</em> — grew independently and reached comparable sophistication. Source Library holds over 50 Sanskrit astrological texts, including the foundational classics. Varahamihira&rsquo;s{' '}
          <Link href="/book/69905f4440bc3a0478efb9b2" className="text-accent-rust hover:text-accent-rust underline">
            <em>Brihat Jataka</em>
          </Link>
          {' '}(c. 550&nbsp;CE) — &ldquo;Large Nativity&rdquo; — is the definitive Sanskrit text on natal horoscopy: 25 chapters covering every aspect of birth chart interpretation, with its celebrated commentary by Bhattotpala (966&nbsp;CE).
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Indian natal astrology shared the same twelve-sign zodiac with Western astrology (probably transmitted from Hellenistic Alexandria around the 1st century CE) but integrated it into an existing framework of 27 <em>nakṣatras</em> (lunar mansions), nine <em>grahas</em> (planets including the ascending and descending nodes of the Moon, Rahu and Ketu), and a complex system of planetary periods (<em>daśā</em>) that has no Western parallel. The tradition also produced a distinctive genre of <em>prashna</em> (horary astrology) texts — divination from the moment a question is asked — and <em>muhurta</em> texts advising auspicious timing for marriages, journeys, and building projects.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          The two traditions — Western and Indian — arrived at similar conclusions about the significance of the sky through entirely different intellectual routes, and meeting points like Abu Ma&rsquo;shar, who knew both, are some of the most fascinating figures in the history of astronomy. Source Library is one of the few digital collections to hold primary texts from both sides of this encounter.
        </p>

        {/* === Conclusion === */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          What the Diagrams Tell Us
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          What is most striking about these diagrams, viewed together across nine centuries, is their consistency. The horoscope chart in Ptolemy&rsquo;s 1484 <em>Quadripartitum</em> and the chart drawn in an Arabic manuscript a century earlier and the one cast digitally today are the same diagram. The twelve houses, the ascendant, the aspects — once established, these forms proved so useful that they persisted through every cosmological revolution: through Copernicus, through Kepler&rsquo;s ellipses, through Newton&rsquo;s gravity. The underlying architecture of astrological computation remained stable even as its physical basis was completely overturned.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          This is because astrology was never purely a theory about how the universe works. It was, at its core, a system of meaning — a way of connecting the particular moment of a person&rsquo;s birth to a larger temporal order. The diagrams are maps of that connection: they show how the celestial and the biographical intersect. And meaning, unlike physical theory, does not become obsolete when the mechanism is revised.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          Source Library is continuing to expand its astrological collection. All the texts featured here are{' '}
          <Link href="/search?q=astrology&has_translation=true" className="text-accent-rust hover:text-accent-rust underline">
            searchable with full English translations
          </Link>
          . Many of the Sanskrit texts are receiving first-ever English translations through our ongoing pipeline. If you are researching astrology&rsquo;s history, the planetary medicine tradition, or the relationship between astronomy and magic in the early modern period, the primary sources are here.
        </p>

        {/* Book list */}
        <div className="bg-white rounded-xl border border-border-light p-6 mb-8">
          <h3 className="text-xl font-semibold text-primary mb-4">All astrological works mentioned in this post</h3>
          <ul className="space-y-2 text-secondary">
            {[
              { href: '/book/6992ca1ad4d545ae73fed806', text: 'Pelliot chinois 3594 — Dunhuang Star Chart (c. 900 CE, Chinese)' },
              { href: '/book/6993881874305116d72cf0ab', text: 'Ptolemy, Almagest / Syntaxis Mathematica (c. 150 CE, Greek)' },
              { href: '/book/69906057ef12272ffdc8ce25', text: 'Ptolemy, Tetrabiblos (c. 150 CE, Greek — 1822 edition)' },
              { href: '/book/69906313e7b7642c081de828', text: 'Ptolemy / Hali, Quadripartitum et Centiloquium (1484, Latin)' },
              { href: '/book/69905e3c2fd6a039938a1980', text: 'Abu Ma\'shar, Introductorium in Astronomiam (1489, Arabic/Latin)' },
              { href: '/book/695361cd9c494f9f9f042f19', text: 'Maslama al-Majriti, Ghayat al-Hakim / Picatrix (960 CE, Arabic)' },
              { href: '/book/69905f4440bc3a0478efb9b2', text: 'Varahamihira / Bhattotpala, Brihat Jataka (966 CE, Sanskrit)' },
              { href: '/book/69906e6d8a353648e1ecfd91', text: 'John Dunstable, Judicial Astrology and Astronomy (c. 1440, Latin)' },
              { href: '/book/694b3b5b58a47807cc735dce', text: 'Nicolaus Copernicus, De revolutionibus orbium coelestium (1543, Latin)' },
              { href: '/book/6956eae3b5d89fc3ccb47a2a', text: 'Paracelsus, Astronomia Magna (1571, German)' },
              { href: '/book/6952d12e77f38f6761bc5bec', text: 'Johannes Kepler, Harmonices Mundi (1619, Latin)' },
              { href: '/book/697a3055a3866af9498458ac', text: 'Jacques Gaffarel, Curiositez inouyes (1650, French)' },
              { href: '/book/6952db5477f38f6761bc7402', text: 'Athanasius Kircher, Itinerarium Exstaticum (1656, Latin)' },
              { href: '/book/a5d0c381-d4ea-42cd-8864-44457e7fda33', text: 'Athanasius Kircher, Ars Magna Lucis et Umbrae (1671, Latin)' },
            ].map((item) => (
              <li key={item.href} className="flex items-start gap-2">
                <span className="text-accent-gold mt-1 shrink-0">→</span>
                <Link href={item.href} className="text-accent-rust hover:text-accent-rust hover:underline transition-colors">
                  {item.text}
                </Link>
              </li>
            ))}
          </ul>
        </div>

      </article>

      <BlogComments slug="astrological-diagrams" />
    </ContentPageLayout>
  );
}
