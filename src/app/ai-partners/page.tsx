import type { Metadata } from 'next';
import { preload } from 'react-dom';
import ConditionalSiteHeader from '@/components/layout/ConditionalSiteHeader';
import { PARTNERS_HTML } from './content';
import './ai-partners.css';

const DESCRIPTION =
  'Source Library for AI partners: 131,000 historical books from more than 30 libraries, 9.6 million pages transcribed and 5.7 million translated into English, with provenance for every page and public-domain originals.';

export const metadata: Metadata = {
  title: 'Source Library for AI Partners',
  description: DESCRIPTION,
  alternates: { canonical: 'https://sourcelibrary.org/ai-partners' },
  openGraph: {
    title: 'Source Library for AI Partners',
    description:
      '131,000 historical books from more than 30 libraries; 9.6 million pages transcribed and 5.7 million translated into English, each traceable to its scan.',
    url: 'https://sourcelibrary.org/ai-partners',
    type: 'website',
    images: ['https://sourcelibrary.org/ai-partners/img/fludd-empyrean.jpg'],
  },
  twitter: { card: 'summary_large_image' },
};

// The site serves Cormorant with display=optional, so a cold first visit renders every
// heading in Georgia. This page is set almost entirely in it: fetch the Latin files early.
const CORMORANT_LATIN = [
  '/fonts/google/cormorantgaramond-v21-co3bmX5slCNuHLi8bLeY9MK7whWMhyjYqXtKky2F7g.woff2',
  '/fonts/google/cormorantgaramond-v21-co3ZmX5slCNuHLi8bLeY9MK7whWMhyjYrEtImSqn7B6D.woff2',
];

// Static: the content is a constant, so there is no fetch to fail and freeze the page.
export default function AiPartnersPage() {
  for (const href of CORMORANT_LATIN) preload(href, { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' });
  return (
    <>
      <ConditionalSiteHeader variant="dark" />
      <main className="ai-partners" dangerouslySetInnerHTML={{ __html: PARTNERS_HTML }} />
    </>
  );
}
