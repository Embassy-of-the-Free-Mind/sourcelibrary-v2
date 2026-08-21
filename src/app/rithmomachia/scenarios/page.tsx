import { Metadata } from 'next';
import Link from 'next/link';
import ScenarioSelector from '@/components/rithmomachia/ScenarioSelector';
import SiteHeader from '@/components/layout/SiteHeader';

export const metadata: Metadata = {
  title: 'Rithmomachia Strategy Scenarios | Source Library',
  description: 'Learn Rithmomachia through interactive puzzles grounded in five Renaissance primary sources. Practice captures, victory formations, and strategies from the original treatises.',
  alternates: {
    canonical: '/rithmomachia/scenarios',
  },
};

export default function ScenariosPage() {
  return (
    <main className="min-h-screen bg-cream">
      <SiteHeader
        variant="light"
        breadcrumbs={[
          { label: 'Rithmomachia', href: '/rithmomachia' },
          { label: 'Strategy Scenarios', href: '/rithmomachia/scenarios' },
        ]}
      />
      <div className="max-w-5xl mx-auto px-4 py-8 md:py-12">
        <ScenarioSelector />

        {/* Footer */}
        <div className="mt-12 pt-8 border-t border-border-light text-center text-sm text-muted space-y-2">
          <p>
            Every scenario is grounded in the five primary sources (1496&ndash;1616).{' '}
            <Link href="/blog/rithmomachia" className="text-accent-rust hover:underline">
              Read the full story
            </Link>{' '}
            or{' '}
            <Link href="/rithmomachia" className="text-accent-rust hover:underline">
              play the full game
            </Link>.
          </p>
        </div>
      </div>
    </main>
  );
}
