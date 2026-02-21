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
}

const posts: BlogPost[] = [
  {
    slug: 'astrological-diagrams',
    title: 'Reading the Stars: Astrological Diagrams from Nine Centuries',
    subtitle: 'A visual tour of Source Library\'s astrological collection — from the 10th-century Dunhuang Star Chart and Ptolemy\'s horoscope diagrams to Copernicus\'s heliocentric revolution and Kircher\'s constellation maps.',
    date: '21 February 2026',
    readTime: '20 min read',
  },
  {
    slug: 'first-translations',
    title: '314 First English Translations',
    subtitle: 'Roughly a quarter of Source Library\'s 1,234 books appear to be first-ever English translations — alchemical lab manuals, radical theology, women alchemists, and founding texts of biblical criticism, all trapped in Latin, German, and French until now.',
    date: '20 February 2026',
    readTime: '12 min read',
  },
  {
    slug: 'mcp-server',
    title: 'Claude Can Now Read 5,000 Rare Books',
    subtitle: 'We shipped an MCP server that gives Claude direct access to Source Library — 5,000+ historical texts with translations, a cross-book entity graph, and 34,000+ illustrations. One command to install, no API key.',
    date: '18 February 2026',
    readTime: '8 min read',
  },
  {
    slug: 'fire-horse',
    title: 'The Year of the Fire Horse',
    subtitle: 'Double yang fire, a 17th-century arsonist, and the original texts behind Chinese astrology — from the sexagenary cycle to the I Ching, now in Source Library.',
    date: '17 February 2026',
    readTime: '16 min read',
  },
  {
    slug: 'indigenous-traditions',
    title: 'The Sacred Texts That Were Never \'Texts\'',
    subtitle: 'Source Library now holds 90+ volumes documenting indigenous spiritual traditions from every inhabited continent — Navajo ceremonies, Yoruba cosmology, Celtic place-lore, Norse Eddas, and more. Most were recorded by ethnographers who knew the traditions were vanishing.',
    date: '16 February 2026',
    readTime: '18 min read',
  },
  {
    slug: 'fechner-bohme',
    title: 'The Mystic Who Invented Psychophysics',
    subtitle: 'Gustav Fechner founded experimental psychology — but his real goal was proving the universe has a soul. His untranslated German works, now in Source Library, reveal the Böhmean mysticism behind the Weber-Fechner law.',
    date: '16 February 2026',
    readTime: '15 min read',
  },
  {
    slug: 'invisible-hand',
    title: 'The Invisible Hand Has a History',
    subtitle: 'Before Adam Smith, Florentine merchants, Salamanca theologians, and Cambridge Platonists built the intellectual foundations of market theory. Source Library traces the hidden lineage from Aristotle to Bastiat in original editions.',
    date: '15 February 2026',
    readTime: '20 min read',
  },
  {
    slug: 'chakra-tradition',
    title: 'Recovering the Chakra Tradition: From Sanskrit Manuscripts to First English Translations',
    subtitle: 'How Source Library is digitizing and translating the primary tantric sources on chakras, nadis, and kundalini — many for the first time in any Western language.',
    date: '15 February 2026',
    readTime: '12 min read',
  },
];

export default function BlogPage() {
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
      <div className="space-y-8">
        {posts.map((post) => (
          <Link
            key={post.slug}
            href={`/blog/${post.slug}`}
            className="block bg-white rounded-xl p-8 shadow-sm border border-border-light hover:shadow-md hover:border-amber-200 transition-all group"
          >
            <p className="text-sm text-muted mb-2">{post.date} &middot; {post.readTime}</p>
            <h2 className="text-2xl md:text-3xl text-primary group-hover:text-amber-800 transition-colors mb-3">
              {post.title}
            </h2>
            <p className="text-secondary leading-relaxed">
              {post.subtitle}
            </p>
            <span className="inline-block mt-4 text-amber-700 text-sm font-medium group-hover:translate-x-1 transition-transform">
              Read article &rarr;
            </span>
          </Link>
        ))}
      </div>
    </ContentPageLayout>
  );
}
