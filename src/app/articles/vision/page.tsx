import { Metadata } from 'next';
import { withArticleMeta } from '@/lib/article-metadata';
import { visionContent } from './content';
import VisionView from './VisionView';

const OG_TITLE = 'Bringing ancient wisdom into the future';
const OG_DESCRIPTION =
  'A letter from Source Library founder Derek Lomas on translating the world’s untranslated books, and the five-year budget to do it.';

export const metadata: Metadata = withArticleMeta('vision', {
  title: 'Our Vision: A Letter from the Founder - Articles - Source Library',
  description: OG_DESCRIPTION,
  openGraph: { title: OG_TITLE, description: OG_DESCRIPTION },
  alternates: { canonical: '/articles/vision' },
});

export default async function VisionPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const { edit } = await searchParams;
  return <VisionView content={visionContent} editable={edit !== undefined} />;
}
