import type { Metadata } from 'next';
import Link from 'next/link';
import { getReadDb } from '@/lib/mongodb';
import { loadJourney } from '@/lib/journey/load-journey';
import type { JourneyInstanceConfig } from '@/lib/journey/types';
import { FEED_TYPES } from '@/lib/feed-links';
import SiteHeader from '@/components/layout/SiteHeader';
import JourneyFilm from '@/components/journey/JourneyFilm';
import JourneyProse from '@/components/journey/JourneyProse';

/**
 * /how-it-works (#5861): one page's journey from an archive scan to a citable
 * English page, as a film and then as prose. The curated instance of the
 * /book/<id>/journey?page=N template: same loader, same component, plus the
 * captions below, each checked against the page (quoted strings are verified
 * by loadJourney and dropped if they no longer occur on it).
 *
 * ISR with a real window and no fallback (rendering-and-seo.md): if the page
 * cannot be loaded the render throws, and the last good page keeps serving.
 */
export const revalidate = 86400;
export const preferredRegion = 'fra1';

const BOOK_ID = '6a308272675ed2bdbe36f649';
const PAGE = 13;

const CONFIG: JourneyInstanceConfig = {
  label: 'Śāntideva, Bodhicaryāvatāra 1.4',
  prologue: {
    eyebrow: 'Śāntideva · eighth century',
    title: 'The Way of the Bodhisattva',
    body: 'Tradition places Śāntideva at Nalanda, and says he first recited this poem there. This film follows one page of it, from a scan of a 1901 Sanskrit edition to an English page that anyone can read and cite.',
  },
  findBody: 'This is the Sanskrit edition of the Bodhicaryāvatāra with Prajñākaramati’s commentary, printed in Calcutta in 1901. The scan was made by the Digital Library of India and is on the Internet Archive.',
  readDetail: 'On page 13 it finds verse 4 of the first chapter, the commentary around it, and the editor’s footnotes in English.',
  lineMatch: 'क्षणसंपदियं',
  linePosition: { x: 0.205, y0: 0.192, dy: 0.0385 },
  note: {
    label: 'Footnote 4, read as text',
    text: "It is as unlikely to happen as if a tortoise should put its neck into a hole opening every yuga in the world's ocean.",
    attribution: 'Kern, quoted by the editor',
  },
  outroQuote: 'How will such a meeting ever occur again?',
  outroSource: 'Śāntideva, with Prajñākaramati’s commentary, ed. Louis de La Vallée Poussin (Calcutta, 1901), page 13. Sanskrit, with an English translation by Source Library.',
};

const TITLE = 'How it works: one page, from scan to citation';
const DESCRIPTION = 'Follow one page of Śāntideva’s Bodhicaryāvatāra from a 1901 scan to an English page that anyone can read and cite.';

export const metadata: Metadata = {
  title: `${TITLE} · Source Library`,
  description: DESCRIPTION,
  // Declaring `alternates` replaces the layout's, so the feed links are spread back in.
  alternates: { canonical: '/how-it-works', types: FEED_TYPES },
};

export default async function HowItWorksPage() {
  const data = await loadJourney(await getReadDb(), BOOK_ID, PAGE, CONFIG);
  if (!data) throw new Error(`how-it-works: book ${BOOK_ID} page ${PAGE} did not load`);

  return (
    <main className="bg-cream">
      <SiteHeader variant="light" />
      <JourneyFilm data={data} />
      <JourneyProse
        data={data}
        intro={
          <>
            <h1 className="text-4xl md:text-5xl text-primary leading-tight mb-6">{TITLE}</h1>
            <p className="text-xl text-secondary leading-relaxed mb-4">
              Source Library holds scans of old books, with a transcription and an English translation beside every page.
              This page follows one page of one book through the steps that put it there. The film above shows each step;
              the same steps are written out below.
            </p>
            <p className="text-xl text-secondary leading-relaxed mb-12">
              The page is page 13 of a 1901 Sanskrit edition of Śāntideva’s <i>Bodhicaryāvatāra</i>, with
              Prajñākaramati’s commentary. It holds verse 4 of the first chapter.
            </p>
          </>
        }
      >
        <Link href="/about" className="text-accent-rust hover:underline">About Source Library</Link>
        <Link href="/vision" className="text-accent-rust hover:underline">Our vision</Link>
      </JourneyProse>
    </main>
  );
}
