import { Metadata } from 'next';
import Link from 'next/link';
import RithmomachiaGame from '@/components/rithmomachia/RithmomachiaGame';

export const metadata: Metadata = {
  title: 'Rithmomachia — Play the Battle of Numbers - Source Library',
  description: 'Play Rithmomachia, the medieval mathematical board game. Capture opponents through arithmetic — addition, subtraction, multiplication, and division. Win by creating Pythagorean harmonies.',
  openGraph: {
    title: 'Rithmomachia — Play the Battle of Numbers',
    description: 'A mathematical board game played across Europe for six centuries. Now playable online, grounded in five Renaissance primary sources.',
    images: [
      {
        url: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/699fcd499ff0f1d2c4518062/498.jpg',
        width: 1200,
        height: 630,
      },
    ],
  },
  alternates: {
    canonical: '/rithmomachia',
  },
};

export default function RithmomachiaPage() {
  return (
    <main className="min-h-screen bg-cream">
      <div className="max-w-6xl mx-auto px-4 py-8 md:py-12">
        {/* Breadcrumb */}
        <nav className="mb-8">
          <Link
            href="/"
            className="text-sm text-muted hover:text-secondary transition-colors"
          >
            Source Library
          </Link>
          <span className="text-muted mx-2">/</span>
          <span className="text-sm text-secondary">Rithmomachia</span>
        </nav>

        <RithmomachiaGame />

        {/* Footer links */}
        <div className="mt-12 pt-8 border-t border-border-light text-center text-sm text-muted space-y-2">
          <p>
            Rules grounded in five Renaissance primary sources (1496&ndash;1616).{' '}
            <Link href="/blog/rithmomachia" className="text-accent-rust hover:underline">
              Read the blog post
            </Link>{' '}
            or{' '}
            <Link href="/book/the-most-noble-auncient-and-learned-playe-called-the-fulke" className="text-accent-rust hover:underline">
              read Lever &amp; Fulke&apos;s original treatise
            </Link>.
          </p>
          <p className="text-xs">
            Default rules follow Lever &amp; Fulke (1563), &ldquo;The first kind of play.&rdquo;
          </p>
        </div>
      </div>
    </main>
  );
}
