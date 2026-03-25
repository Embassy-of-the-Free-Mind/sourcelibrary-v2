import { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'Research Notes - Source Library',
  description: 'Research notes on the history and translation of rare philosophical, esoteric, and scientific texts. AI-assisted analysis directed by Derek Lomas.',
  alternates: {
    canonical: '/blog',
  },
};

interface BlogPost {
  slug: string;
  title: string;
  subtitle: string;
  date: string;
  readTime: string;
  tag?: string;
  tagColor?: string;
  image?: string;
  imageAlt?: string;
}

const posts: BlogPost[] = [
  {
    slug: 'rashi-ocr',
    title: 'The Rashi Problem: When AI OCR Hallucinates in Hebrew',
    subtitle: 'Gemini reads Arabic, Sanskrit, and Chinese fine. On Rashi script it hallucinates — and our quality metrics gave it a passing grade.',
    date: '24 March 2026',
    readTime: '10 min read',
    tag: 'Technical',
    tagColor: 'bg-stone-100 text-stone-600',
    image: 'https://images.sourcelibrary.org/archived/6990630be7b7642c081de08b/8.jpg',
    imageAlt: 'Page from the Zohar, Cremona 1558 edition, showing dense Rashi script in Aramaic',
  },
  {
    slug: 'translation-rate',
    title: 'How Many Renaissance Books Get Translated Each Year?',
    subtitle: 'We queried 13,862 records from the UNESCO Index Translationum and 11 other catalogs. The answer is smaller than anyone guesses.',
    date: '21 March 2026',
    readTime: '10 min read',
    tag: 'Deep dive',
    tagColor: 'bg-accent-rust/10 text-accent-rust',
  },
  {
    slug: 'visualizing-classification',
    title: 'Visualizing 20,000 Books Across Six Dimensions',
    subtitle: 'Four interactive D3 visualizations of our faceted classification: scatter plot, heatmap, Sankey flow, and chord diagram.',
    date: '16 March 2026',
    readTime: '6 min read',
    tag: 'AI research report',
    tagColor: 'bg-accent-sage/10 text-accent-sage-dark',
  },
  {
    slug: 'history-of-classification',
    title: 'Ten Thousand Years of Tagging',
    subtitle: 'From Callimachus at Alexandria to LLM-assigned faceted tags, the history of classification runs through books we actually have.',
    date: '16 March 2026',
    readTime: '20 min read',
    tag: 'AI research report',
    tagColor: 'bg-accent-sage/10 text-accent-sage-dark',
  },
  {
    slug: 'counting-the-gap',
    title: 'We Spent a Day Counting What Hasn\'t Been Translated',
    subtitle: 'We matched 1.6 million early modern editions against translation catalogs. It started as a quick check and turned into an all-day rabbit hole.',
    date: '15 March 2026',
    readTime: '8 min read',
    tag: 'Behind the scenes',
    tagColor: 'bg-stone-100 text-stone-600',
  },
  {
    slug: 'untranslated-renaissance',
    title: 'How Much of the Renaissance Has Been Translated?',
    subtitle: '1.4 million editions, every English translation catalog we could find. The numbers are rough, but the gap is enormous.',
    date: '15 March 2026',
    readTime: '10 min read',
    tag: 'Deep dive',
    tagColor: 'bg-accent-rust/10 text-accent-rust',
  },
  {
    slug: 'origin-story',
    title: 'Where Source Library Came From',
    subtitle: 'One untranslated Ficino manuscript at the Embassy of the Free Mind, 5,000 books later.',
    date: '15 March 2026',
    readTime: '8 min read',
    tag: 'Origin',
    tagColor: 'bg-accent-gold/10 text-accent-gold-dark',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/blog/ficino-bust-laptop.jpg',
    imageAlt: 'Bronze bust of Marsilio Ficino with a laptop at the Embassy of the Free Mind',
  },
  {
    slug: 'hieroglyph-ocr',
    title: 'Can AI Read Hieroglyphs? (No.)',
    subtitle: 'Four approaches to hieroglyphic OCR, four failures. The Unicode block has 1,071 characters and Gemini can\'t reliably pick the right ones.',
    date: '14 March 2026',
    readTime: '12 min read',
    tag: 'Technical',
    tagColor: 'bg-stone-100 text-stone-600',
    image: 'https://iiif.archive.org/iiif/egyptianreadingb00budguoft$80/full/1000,/0/default.jpg',
    imageAlt: 'Page from Budge\'s Egyptian Reading Book showing hieroglyphic text and transliteration, 1896',
  },
  {
    slug: 'clustering',
    title: 'What Does a Library of 3,400 Rare Books Look Like?',
    subtitle: 'Embedding summaries and letting HDBSCAN find the structure. 48 clusters, six intellectual traditions, from alchemy to Sanskrit astronomy.',
    date: '14 March 2026',
    readTime: '10 min read',
    tag: 'Methodology',
    tagColor: 'bg-accent-sage/10 text-accent-sage-dark',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/6952dac677f38f6761bc683a/13.jpg',
    imageAlt: 'Integra Naturae Speculum by Robert Fludd, showing the Great Chain of Being, 1617',
  },
  // Hidden: needs rewrite with proper import session data
  // {
  //   slug: 'autonomous-agents',
  //   title: 'How We Added 950 Books in a Weekend',
  //   subtitle: 'A human curator and three AI agents worked in parallel...',
  //   date: '9 March 2026',
  //   readTime: '12 min read',
  //   tag: 'Methodology',
  //   tagColor: 'bg-accent-sage/10 text-accent-sage-dark',
  //   image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/695230c6ab34727b1f044784/9.jpg',
  //   imageAlt: 'Page from a 16th-century manuscript showing mechanical diagrams',
  // },
  {
    slug: 'progress-studies',
    title: 'The Deeper Roots of Progress',
    subtitle: 'Mokyr, Howes, and Crawford ask why innovation happens. 5,000 newly translated books show where the experimental mindset came from.',
    date: '8 March 2026',
    readTime: '15 min read',
    tag: 'Deep dive',
    tagColor: 'bg-accent-rust/10 text-accent-rust',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/695230c6ab34727b1f044784/9.jpg',
    imageAlt: 'Page from a 16th-century Greek manuscript of Hero of Alexandria\'s Pneumatica, showing mechanical diagrams',
  },
  {
    slug: 'ocr-consistency',
    title: 'How Consistent Is AI OCR?',
    subtitle: 'A digitization error gave us 1,448 natural experiments: two photos of the same page, OCR\'d independently. Median disagreement: 1.8%.',
    date: '7 March 2026',
    readTime: '12 min read',
    tag: 'Methodology',
    tagColor: 'bg-accent-sage/10 text-accent-sage-dark',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/uploads/697b079ac66889d6835b576a/697b09f386b3d3c458a4c04c.jpg',
    imageAlt: 'Page spread from Einleitung zum wahren und gründlichen Erkänntnis des grossen Geheimnisses der Gottseligkeit, an early modern German alchemical text',
  },
  {
    slug: 'cuneiform-ocr',
    title: 'Can AI Read Cuneiform?',
    subtitle: 'Gemini identified the Code of Hammurabi and caught a 2,500-year-old forgery. It also hallucinated an entire document.',
    date: '7 March 2026',
    readTime: '20 min read',
    tag: 'Technical',
    tagColor: 'bg-stone-100 text-stone-600',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/blog/cuneiform/P464358_d-sBPv8Z5dT88Vwi9ZcuAMnSz4nYflrw.jpg',
    imageAlt: 'Code of Hammurabi stele detail showing cuneiform inscription, ca. 1750 BCE',
  },
  {
    slug: 'rithmomachia',
    title: 'Rithmomachia: The Forgotten Game That Taught Europe to Think Like Pythagoras',
    subtitle: 'A mathematical board game played for six centuries. You capture by arithmetic and win by creating harmony.',
    date: '2 March 2026',
    readTime: '18 min read',
    tag: 'Collection',
    tagColor: 'bg-accent-violet/10 text-accent-violet',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/699fcd499ff0f1d2c4518062/498.jpg',
    imageAlt: 'Copperplate engraving of a Rithmomachia game board from Selenus, Das Schach- oder König-Spiel, 1616',
  },
  {
    slug: 'hidden-engineers',
    title: 'The Hidden Engineers',
    subtitle: 'Before engineering was a discipline, its knowledge lived inside spell books and alchemy. One 16th-century manuscript binds Hero\'s steam engines with the Corpus Hermeticum.',
    date: '27 February 2026',
    readTime: '22 min read',
    tag: 'Deep dive',
    tagColor: 'bg-accent-rust/10 text-accent-rust',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/695230c6ab34727b1f044784/93.jpg',
    imageAlt: 'Page from a 16th-century Greek manuscript showing Hero of Alexandria\'s Aeolipile diagram',
  },
  {
    slug: 'philosophers-stone',
    title: "What Is the Philosopher's Stone?",
    subtitle: 'An allegorical emblem sequence, a universal salt, a red powder found in a bishop\'s tomb. Eight primary sources, eight different answers.',
    date: '27 February 2026',
    readTime: '20 min read',
    tag: 'Deep dive',
    tagColor: 'bg-accent-rust/10 text-accent-rust',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/uploads/69804b952c52aad359879321/69804ceaefc8a337f6e2717b.jpg',
    imageAlt: 'Frontispiece engraving from Lambspringk\'s De Lapide Philosophico, Frankfurt 1625',
  },
  {
    slug: 'first-translation-methodology',
    title: 'How We Identify First Translations',
    subtitle: 'AI enrichment, bibliographic heuristics, six-level status system, and the limitations we know about.',
    date: '23 February 2026',
    readTime: '10 min read',
    tag: 'Methodology',
    tagColor: 'bg-accent-sage/10 text-accent-sage-dark',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/6952587bab34727b1f045546/3.jpg',
    imageAlt: 'Title page of Symbola Aureae Mensae by Michael Maier, with twelve alchemist portrait medallions, 1617',
  },
  {
    slug: 'astrological-diagrams',
    title: 'Astrological Diagrams from Nine Centuries',
    subtitle: 'From the 10th-century Dunhuang Star Chart to Kepler\'s cosmic harmonics.',
    date: '22 February 2026',
    readTime: '15 min read',
    tag: 'Visual essay',
    tagColor: 'bg-accent-gold/10 text-accent-gold-dark',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/6952dac677f38f6761bc683a/13.jpg',
    imageAlt: 'Integra Naturae Speculum by Robert Fludd, showing the Great Chain of Being with celestial spheres and zodiac signs, 1617',
  },
  {
    slug: 'demonology',
    title: 'What Are Demons? Five Answers from the Primary Sources',
    subtitle: 'The Hermetic daemon is your cosmic guardian. The Christian demon is a fallen angel. The same word, reversed.',
    date: '21 February 2026',
    readTime: '18 min read',
    tag: 'Deep dive',
    tagColor: 'bg-accent-rust/10 text-accent-rust',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/6953b56577f38f6761bd979d/62.jpg',
    imageAlt: 'Illustration of a jinn from the Book of Wonders, 14th century',
  },
  {
    slug: 'history-of-astrology',
    title: 'A History of Astrology Across Traditions',
    subtitle: 'Babylonian omen tablets to Kepler\'s geometrical cosmos, independently across five civilizations.',
    date: '21 February 2026',
    readTime: '22 min read',
    tag: 'Deep dive',
    tagColor: 'bg-accent-rust/10 text-accent-rust',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/699068948034a3640265b709/311.jpg',
    imageAlt: 'Zodiac Man (Homo Signorum) from a medieval astrological manuscript',
  },
  {
    slug: 'first-translations',
    title: 'Over 500 First English Translations',
    subtitle: 'Lab manuals, radical theology, women alchemists, Sanskrit astrology, founding texts of biblical criticism. Never before in English.',
    date: '20 February 2026',
    readTime: '14 min read',
    tag: 'Collection',
    tagColor: 'bg-accent-violet/10 text-accent-violet',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/4d4089b9-9227-4cc5-b0a2-9b06ee731061/2.jpg',
    imageAlt: 'Frontispiece of Kircher\'s Oedipus Aegyptiacus, 1653',
  },
  {
    slug: 'mcp-server',
    title: 'Claude Can Now Read Thousands of Rare Books',
    subtitle: 'An MCP server giving Claude direct access to Source Library: historical texts, translations, entity graph, and 50,000+ illustrations.',
    date: '18 February 2026',
    readTime: '8 min read',
    tag: 'Technical',
    tagColor: 'bg-stone-100 text-stone-600',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/699065973dc2ed39a49f1e71/4.jpg',
    imageAlt: 'The Fountain of Hermes from the Ripley Scroll, Bodleian Library, c. 1450',
  },
  {
    slug: 'fire-horse',
    title: 'The Year of the Fire Horse',
    subtitle: 'Double yang fire, a 17th-century arsonist, and the original texts behind Chinese astrology.',
    date: '17 February 2026',
    readTime: '16 min read',
    tag: 'Deep dive',
    tagColor: 'bg-accent-rust/10 text-accent-rust',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/6992cac0d4d545ae73feea71/6.jpg',
    imageAlt: 'He Tu (River Map) diagram from Chinese cosmological tradition',
  },
  {
    slug: 'indigenous-traditions',
    title: 'The Sacred Texts That Were Never \'Texts\'',
    subtitle: '90+ volumes: Navajo ceremonies, Yoruba cosmology, Celtic place-lore, Norse Eddas. Every inhabited continent.',
    date: '16 February 2026',
    readTime: '18 min read',
    tag: 'Collection',
    tagColor: 'bg-accent-violet/10 text-accent-violet',
    image: 'https://archive.org/download/gri_33125009545621/page/n23/full/pct:50/0/default.jpg',
    imageAlt: 'Weighing of the Heart scene from the Book of the Dead, Papyrus of Ani, British Museum, c. 1250 BCE',
  },
  {
    slug: 'fechner-bohme',
    title: 'The Mystic Who Invented Psychophysics',
    subtitle: 'Fechner founded experimental psychology. His real goal was proving the universe has a soul.',
    date: '16 February 2026',
    readTime: '15 min read',
    tag: 'Deep dive',
    tagColor: 'bg-accent-rust/10 text-accent-rust',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/6867c580aadfee9e955eca92/4.jpg',
    imageAlt: 'Title page of Aurora by Jakob Bohme, with cosmic diagram and Fraktur typography',
  },
  {
    slug: 'invisible-hand',
    title: 'The Invisible Hand Has a History',
    subtitle: 'Before Adam Smith: Florentine merchants, Salamanca theologians, Cambridge Platonists.',
    date: '15 February 2026',
    readTime: '20 min read',
    tag: 'Deep dive',
    tagColor: 'bg-accent-rust/10 text-accent-rust',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/69520c46ab34727b1f044141/7.jpg',
    imageAlt: 'Title page of Atalanta Fugiens by Michael Maier, with allegorical scenes',
  },
  {
    slug: 'chakra-tradition',
    title: 'Recovering the Chakra Tradition',
    subtitle: 'The primary tantric sources on chakras, nadis, and kundalini. Many translated for the first time.',
    date: '15 February 2026',
    readTime: '12 min read',
    tag: 'Collection',
    tagColor: 'bg-accent-violet/10 text-accent-violet',
    image: 'https://iiif.wellcomecollection.org/image/b33599051_0001.jp2/full/1000,/0/default.jpg',
    imageAlt: 'Chakra diagram from the Shaiva tantric tradition, Wellcome Collection',
  },
];

export default function BlogPage() {
  const [hero, ...rest] = posts;

  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Research Notes"
          subtitle="AI-assisted research on rare texts, classification, and the history of knowledge. Derek Lomas directs the questions; Claude (Anthropic) builds the analysis. Every claim is grounded in primary sources from the collection."
          image="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/699065973dc2ed39a49f1e71/4.jpg"
          imageAlt="The Fountain of Hermes from the Ripley Scroll, Bodleian Library, c. 1450"
        />
      }
      bg="bg-cream"
    >
      {/* Hero post — editorial side-by-side feature */}
      <Link
        href={`/blog/${hero.slug}`}
        className="block bg-white rounded-xl overflow-hidden shadow-sm border border-border-light hover:shadow-lg hover:border-accent-gold/12 transition-all group mb-12"
      >
        <div className="md:flex md:min-h-[340px]">
          {hero.image && (
            <div className="md:w-[45%] shrink-0 overflow-hidden relative h-56 md:h-auto">
              <Image
                src={hero.image}
                alt={hero.imageAlt || ''}
                fill
                sizes="(max-width: 768px) 100vw, 45vw"
                className="object-cover group-hover:scale-[1.02] transition-transform duration-700"
                priority
              />
            </div>
          )}
          <div className="p-8 md:p-10 flex flex-col justify-center">
            <div className="flex items-center gap-3 mb-4">
              {hero.tag && (
                <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${hero.tagColor}`}>
                  {hero.tag}
                </span>
              )}
              <span className="text-xs text-muted tracking-wide uppercase">{hero.date} &middot; {hero.readTime}</span>
            </div>
            <h2 className="font-serif text-2xl md:text-3xl text-primary group-hover:text-accent-gold-dark transition-colors mb-4 leading-tight">
              {hero.title}
            </h2>
            <p className="text-secondary leading-relaxed font-body md:text-lg">
              {hero.subtitle}
            </p>
            <span className="inline-block mt-6 text-accent-rust text-sm font-medium group-hover:translate-x-1 transition-transform">
              Read article &rarr;
            </span>
          </div>
        </div>
      </Link>

      {/* Post list */}
      <div className="divide-y divide-border-light">
        {rest.map((post) => (
          <Link
            key={post.slug}
            href={`/blog/${post.slug}`}
            className="flex gap-5 py-6 first:pt-0 group"
          >
            {post.image && (
              <div className="w-28 h-28 md:w-44 md:h-32 shrink-0 rounded-lg overflow-hidden relative">
                <Image
                  src={post.image}
                  alt={post.imageAlt || ''}
                  fill
                  sizes="(max-width: 768px) 112px, 176px"
                  className="object-cover group-hover:scale-[1.04] transition-transform duration-500"
                />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                {post.tag && (
                  <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${post.tagColor}`}>
                    {post.tag}
                  </span>
                )}
              </div>
              <h2 className="font-serif text-xl md:text-2xl text-primary group-hover:text-accent-gold-dark transition-colors leading-snug mb-2">
                {post.title}
              </h2>
              <p className="text-base text-secondary leading-relaxed line-clamp-2 font-body mb-2 hidden sm:block">
                {post.subtitle}
              </p>
              <span className="text-base text-muted">{post.date} &middot; {post.readTime}</span>
            </div>
          </Link>
        ))}
      </div>
    </ContentPageLayout>
  );
}
