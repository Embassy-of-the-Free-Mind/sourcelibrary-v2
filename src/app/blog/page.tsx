import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'Blog - Source Library',
  description: 'Essays on the history and translation of rare philosophical, esoteric, and scientific texts from the Western and Eastern traditions.',
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
    slug: 'first-translation-methodology',
    title: 'How We Identify First Translations',
    subtitle: 'The methodology behind Source Library\'s first-translation classification: AI enrichment, six-level status system, bibliographic heuristics, deep verification, and known limitations.',
    date: '23 February 2026',
    readTime: '10 min read',
    tag: 'Methodology',
    tagColor: 'bg-accent-sage/10 text-accent-sage-dark',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/6952898bab34727b1f04d709/3.jpg',
    imageAlt: 'Frontispiece portrait from La chymie charitable by Marie Meurdrac',
  },
  {
    slug: 'astrological-diagrams',
    title: 'Reading the Stars: Astrological Diagrams from Nine Centuries',
    subtitle: 'A visual tour from the 10th-century Dunhuang Star Chart to Kepler\'s cosmic harmonics — the original diagrams that mapped humanity\'s relationship to the heavens.',
    date: '22 February 2026',
    readTime: '15 min read',
    tag: 'Visual essay',
    tagColor: 'bg-accent-gold/10 text-accent-gold-dark',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/69906313e7b7642c081de828/22.jpg',
    imageAlt: 'Astrological diagram from a medieval manuscript',
  },
  {
    slug: 'demonology',
    title: 'What Are Demons? Five Answers from the Primary Sources',
    subtitle: 'The Hermetic daemon is your cosmic guardian; the Christian demon is a fallen angel. Source Library holds the texts that document this extraordinary reversal.',
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
    subtitle: 'From Babylonian omen tablets to Kepler\'s geometrical cosmos — pursued independently across Greek, Indian, Arabic, Chinese, and European traditions.',
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
    subtitle: 'Alchemical lab manuals, radical theology, women alchemists, Sanskrit astrology manuscripts, and founding texts of biblical criticism — all previously inaccessible in English.',
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
    subtitle: 'An MCP server that gives Claude direct access to Source Library — thousands of historical texts with translations, a cross-book entity graph, and 50,000+ illustrations.',
    date: '18 February 2026',
    readTime: '8 min read',
    tag: 'Technical',
    tagColor: 'bg-stone-100 text-stone-600',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/694f3d6ebe37f451a5324e95/4.jpg',
    imageAlt: 'Illustration from the Complete Hermetica, 1505 Paris edition',
  },
  {
    slug: 'fire-horse',
    title: 'The Year of the Fire Horse',
    subtitle: 'Double yang fire, a 17th-century arsonist, and the original texts behind Chinese astrology — from the sexagenary cycle to the I Ching.',
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
    subtitle: '90+ volumes documenting indigenous spiritual traditions from every inhabited continent — Navajo ceremonies, Yoruba cosmology, Celtic place-lore, Norse Eddas.',
    date: '16 February 2026',
    readTime: '18 min read',
    tag: 'Collection',
    tagColor: 'bg-accent-violet/10 text-accent-violet',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/695910f2ecb01322b3068302/5.jpg',
    imageAlt: 'Illustration from Historia natural y moral de las Indias',
  },
  {
    slug: 'fechner-bohme',
    title: 'The Mystic Who Invented Psychophysics',
    subtitle: 'Gustav Fechner founded experimental psychology — but his real goal was proving the universe has a soul. His untranslated German works reveal the mysticism behind the Weber-Fechner law.',
    date: '16 February 2026',
    readTime: '15 min read',
    tag: 'Deep dive',
    tagColor: 'bg-accent-rust/10 text-accent-rust',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/6867c580aadfee9e955eca92/2.jpg',
    imageAlt: 'Page from Aurora by Jakob Bohme',
  },
  {
    slug: 'invisible-hand',
    title: 'The Invisible Hand Has a History',
    subtitle: 'Before Adam Smith, Florentine merchants, Salamanca theologians, and Cambridge Platonists built the intellectual foundations of market theory.',
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
    subtitle: 'Digitizing and translating the primary tantric sources on chakras, nadis, and kundalini — many for the first time in any Western language.',
    date: '15 February 2026',
    readTime: '12 min read',
    tag: 'Collection',
    tagColor: 'bg-accent-violet/10 text-accent-violet',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/6953c86b77f38f6761bdc210/2.jpg',
    imageAlt: 'Page from the Shiva Samhita',
  },
];

export default function BlogPage() {
  const [hero, ...rest] = posts;

  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Blog"
          subtitle="Essays on recovering and translating rare texts from the world's philosophical traditions."
        />
      }
      bg="bg-cream"
    >
      {/* Hero post — editorial feature */}
      <Link
        href={`/blog/${hero.slug}`}
        className="block bg-white rounded-xl overflow-hidden shadow-sm border border-border-light hover:shadow-lg hover:border-accent-gold/12 transition-all group mb-14"
      >
        {hero.image && (
          <div className="h-64 md:h-80 overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={hero.image}
              alt={hero.imageAlt || ''}
              className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-700"
            />
          </div>
        )}
        <div className="p-8 md:p-10">
          <div className="flex items-center gap-3 mb-4">
            {hero.tag && (
              <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${hero.tagColor}`}>
                {hero.tag}
              </span>
            )}
            <span className="text-xs text-muted tracking-wide uppercase">{hero.date} &middot; {hero.readTime}</span>
          </div>
          <h2 className="font-serif text-2xl md:text-3xl lg:text-4xl text-primary group-hover:text-accent-gold-dark transition-colors mb-4 leading-tight">
            {hero.title}
          </h2>
          <p className="text-secondary leading-relaxed font-body text-base md:text-lg max-w-2xl">
            {hero.subtitle}
          </p>
          <span className="inline-block mt-6 text-accent-rust text-sm font-medium group-hover:translate-x-1 transition-transform">
            Read article &rarr;
          </span>
        </div>
      </Link>

      {/* Ornamental divider */}
      <div className="flex items-center gap-4 mb-14">
        <div className="flex-1 h-px bg-border-light" />
        <span className="text-accent-gold/40 text-lg tracking-[0.3em] font-serif select-none" aria-hidden="true">&bull; &bull; &bull;</span>
        <div className="flex-1 h-px bg-border-light" />
      </div>

      {/* Remaining posts in 2-column grid */}
      <div className="grid md:grid-cols-2 gap-8">
        {rest.map((post) => (
          <Link
            key={post.slug}
            href={`/blog/${post.slug}`}
            className="block bg-white rounded-xl overflow-hidden shadow-sm border border-border-light hover:shadow-lg hover:border-accent-gold/12 transition-all group"
          >
            {post.image && (
              <div className="h-48 md:h-52 overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={post.image}
                  alt={post.imageAlt || ''}
                  className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500"
                />
              </div>
            )}
            <div className="p-6">
              <div className="flex items-center gap-3 mb-3">
                {post.tag && (
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${post.tagColor}`}>
                    {post.tag}
                  </span>
                )}
                <span className="text-xs text-muted tracking-wide uppercase">{post.readTime}</span>
              </div>
              <h2 className="font-serif text-xl md:text-2xl text-primary group-hover:text-accent-gold-dark transition-colors mb-3 leading-snug">
                {post.title}
              </h2>
              <p className="text-sm text-secondary leading-relaxed line-clamp-3 font-body">
                {post.subtitle}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </ContentPageLayout>
  );
}
