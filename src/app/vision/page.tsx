import { Metadata } from 'next';
import { visionContent } from './content';
import VisionView from './VisionView';

const OG_TITLE = 'Bringing ancient wisdom into the future';
const OG_DESCRIPTION =
  'A letter from Source Library founder Derek Lomas on translating the world’s untranslated books, and the five-year budget to do it.';

export const metadata: Metadata = {
  title: 'Our Vision: A Letter from the Founder | Source Library',
  description: OG_DESCRIPTION,
  alternates: { canonical: '/vision' },
  openGraph: {
    title: OG_TITLE,
    description: OG_DESCRIPTION,
    url: '/vision',
    type: 'article',
    images: [{ url: '/og-image.jpg', width: 1200, height: 630, alt: OG_TITLE }],
  },
  twitter: {
    card: 'summary_large_image',
    title: OG_TITLE,
    description: OG_DESCRIPTION,
    images: ['/og-image.jpg'],
  },
};

export default async function VisionPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const { edit } = await searchParams;
  return <VisionView content={visionContent} editable={edit !== undefined} />;
}
