import { Metadata } from 'next';
import { visionContent } from './content';
import VisionView from './VisionView';

export const metadata: Metadata = {
  title: 'Our Vision — A Letter from the Founder | Source Library',
  description:
    'A letter from Source Library founder Derek Lomas on bringing the ancient wisdom of every civilization into the age of AI — and a brief plan for the institution we are building.',
  alternates: { canonical: '/vision' },
};

export default async function VisionPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const { edit } = await searchParams;
  return <VisionView content={visionContent} editable={edit !== undefined} />;
}
