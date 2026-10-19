import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { INSCRIPTIONS } from '@/lib/inscriptions';

// The list of Maya monuments with their own page (#6985). Static: the list is the config in src/lib/inscriptions.ts.

const SUBTITLE = 'Classic Maya monuments, block by block, from the University of Bonn’s open archive and sign catalog';

export const metadata: Metadata = {
  title: 'Maya inscriptions - Source Library',
  description: SUBTITLE,
  alternates: { canonical: '/inscriptions' },
};

export default function InscriptionsIndex() {
  return (
    <ContentPageLayout header={<ContentHeader title="Maya inscriptions" subtitle={SUBTITLE} />} maxWidth="standard">
      <ul className="max-w-[var(--container-narrow)] mx-auto space-y-6">
        {Object.values(INSCRIPTIONS).map((ins) => (
          <li key={ins.slug}>
            <Link href={`/inscriptions/${ins.slug}`} className="text-xl text-primary underline">{ins.title}</Link>
            <p className="text-secondary font-body mt-1">{ins.subtitle}</p>
          </li>
        ))}
      </ul>
    </ContentPageLayout>
  );
}
