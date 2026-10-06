import type { Metadata } from 'next';
import Link from 'next/link';
import type { Db } from 'mongodb';
import { getReadDb } from '@/lib/mongodb';
import { getSiteStats } from '@/lib/site-stats';
import { loadJourney } from '@/lib/journey/load-journey';
import type { JourneyData, JourneyInstanceConfig } from '@/lib/journey/types';
import { READER_UI_STRINGS } from '@/lib/reader-strings';
import { FEED_TYPES } from '@/lib/feed-links';
import SiteHeader from '@/components/layout/SiteHeader';
import JourneyFilm from '@/components/journey/JourneyFilm';
import JourneyProse from '@/components/journey/JourneyProse';
import {
  LineFigure,
  PeopleFigure,
  RecordFigure,
  TextRoutesFigure,
  type PageRecord,
} from '@/components/how-it-works/HowItWorksFigures';
import gapStatus from '../../../scripts/catalog-coverage/results/canon-gap-status-2026-10.json';

/**
 * /how-it-works (#5861): how Source Library works, written for a library or a partner
 * project deciding whether to work with us. Four diagrams of the system, with one real
 * page's journey (the film, the curated instance of /book/<id>/journey?page=N) as the
 * worked example in the middle.
 *
 * ISR with a real window and no fallback (rendering-and-seo.md): if the page cannot be
 * loaded the render throws, and the last good page keeps serving.
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

const TENGYUR = gapStatus.tengyur_draft;
const GAP_STATUS_URL =
  'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/blob/main/scripts/catalog-coverage/results/canon-gap-status-2026-10.json';

const TITLE = 'How Source Library works';
const DESCRIPTION =
  'What happens to a book between a library’s scan and an English page anyone can read and cite: the steps, what is recorded with every page, and where scholars come in.';

export const metadata: Metadata = {
  title: `${TITLE} · Source Library`,
  description: DESCRIPTION,
  // Declaring `alternates` replaces the layout's, so the feed links are spread back in.
  alternates: { canonical: '/how-it-works', types: FEED_TYPES },
};

// UTC, so the server render and the browser agree on the day.
const day = (d: unknown) =>
  d instanceof Date ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : undefined;

/** The stored record behind the film's page, for Figure 3. Only fields that exist are shown. */
async function loadPageRecord(db: Db, data: JourneyData): Promise<PageRecord> {
  type Engine = { model?: string; model_version?: string; api?: string };
  type P = {
    photo_original?: string;
    image_width?: number;
    image_height?: number;
    archive_metadata?: { archived_at?: Date };
    ocr?: { model?: string; prompt_name?: string; prompt_version?: string; updated_at?: Date };
    translation?: {
      model?: string;
      prompt_version?: string;
      batch_job_id?: string;
      content_hash?: string;
      updated_at?: Date;
      engine?: Engine;
    };
    word_alignment?: { pairs?: unknown[]; model?: string };
  };
  const [p, revisions] = await Promise.all([
    db.collection('pages').findOne<P>(
      { id: data.pageId },
      {
        projection: {
          _id: 0, photo_original: 1, image_width: 1, image_height: 1, 'archive_metadata.archived_at': 1,
          'ocr.model': 1, 'ocr.prompt_name': 1, 'ocr.prompt_version': 1, 'ocr.updated_at': 1,
          'translation.model': 1, 'translation.prompt_version': 1, 'translation.batch_job_id': 1,
          'translation.content_hash': 1, 'translation.updated_at': 1,
          'translation.engine.model': 1, 'translation.engine.model_version': 1, 'translation.engine.api': 1,
          'word_alignment.pairs': 1, 'word_alignment.model': 1,
        },
      },
    ),
    db.collection('page_revisions').countDocuments({ page_id: data.pageId }),
  ]);
  if (!p) throw new Error(`how-it-works: page record ${data.pageId} not found`);
  const tr = p.translation;
  return {
    pageLabel: `${data.citation.locator} of the 1901 Bodhicaryāvatāra`,
    readerUrl: data.readerPath,
    image: {
      from: data.providerName ?? 'the holding library',
      sourceUrl: p.photo_original,
      archivedAt: day(p.archive_metadata?.archived_at),
      width: p.image_width,
      height: p.image_height,
    },
    text: p.ocr?.model
      ? {
          model: p.ocr.model,
          prompt: p.ocr.prompt_name ? `“${p.ocr.prompt_name}” v${p.ocr.prompt_version}` : undefined,
          at: day(p.ocr.updated_at),
        }
      : undefined,
    english: tr?.model
      ? {
          model: tr.engine?.model ?? tr.model,
          modelVersion: tr.engine?.model_version,
          prompt: tr.prompt_version ? `v${tr.prompt_version}` : undefined,
          api: tr.engine?.api === 'batch' ? 'Batch API' : undefined,
          batch: tr.batch_job_id,
          hash: tr.content_hash,
          at: day(tr.updated_at),
        }
      : undefined,
    alignment: p.word_alignment?.pairs?.length
      ? { pairs: p.word_alignment.pairs.length, model: p.word_alignment.model }
      : undefined,
    revisions,
  };
}

const H2 = 'text-3xl md:text-4xl text-primary leading-tight mb-4';
const P = 'text-lg text-secondary leading-relaxed mb-4';
const A = 'text-accent-rust hover:underline';

export default async function HowItWorksPage() {
  const db = await getReadDb();
  const data = await loadJourney(db, BOOK_ID, PAGE, CONFIG);
  if (!data) throw new Error(`how-it-works: book ${BOOK_ID} page ${PAGE} did not load`);
  const [record, stats] = await Promise.all([loadPageRecord(db, data), getSiteStats()]);

  return (
    <main className="bg-cream">
      <SiteHeader variant="light" />

      <div className="max-w-[var(--container-standard)] mx-auto px-6 pt-14 md:pt-20">
        <div className="max-w-[var(--container-narrow)]">
          <p className="font-sans text-xs font-semibold uppercase tracking-[0.12em] text-accent-rust mb-3">
            For libraries and partner projects
          </p>
          <h1 className="text-4xl md:text-5xl text-primary leading-tight mb-6">{TITLE}</h1>
          <p className="text-xl text-secondary leading-relaxed mb-4">
            Source Library takes scans of old books from the libraries that hold them and puts a transcription and an English
            translation beside every page, so that anyone can read the book and quote it with a link to the page.
          </p>
          <p className="text-xl text-secondary leading-relaxed">
            This page shows how that is done: the steps every book goes through, one real page followed through them, what we
            record about each page, and where scholars come in.
          </p>
        </div>

        <LineFigure books={stats.totalBooks} readable={stats.readableInEnglish} languages={stats.languageCount} />

        <TextRoutesFigure
          tengyurPages={TENGYUR.pages_with_text}
          examplePage={{ model: record.text?.model ?? data.readBy, label: 'page 13 of the 1901 Bodhicaryāvatāra in the film below' }}
        />
      </div>

      <div className="max-w-[var(--container-narrow)] mx-auto px-6 pt-6 pb-8">
        <h2 className={H2}>One page, followed through</h2>
        <p className={P}>
          The film follows page 13 of a 1901 Sanskrit edition of Śāntideva’s <i>Bodhicaryāvatāra</i>, with Prajñākaramati’s
          commentary, through the steps above. It holds verse 4 of the first chapter. The same steps are written out below
          the film.
        </p>
      </div>
      <JourneyFilm data={data} />
      <JourneyProse data={data}>
        <Link href="/about" className={A}>About Source Library</Link>
      </JourneyProse>

      <div className="max-w-[var(--container-standard)] mx-auto px-6 pb-8">
        <RecordFigure r={record} />
        <PeopleFigure draftLabel={READER_UI_STRINGS.en.info.machineDraftNotice} />
      </div>

      <div className="max-w-[var(--container-narrow)] mx-auto px-6 pb-20">
        <h2 className={H2}>Working with us</h2>
        <ul className="space-y-5 mb-10">
          <li className={P}>
            <strong className="text-primary">Your library is credited.</strong> The holding institution is named on every book
            and its pages link back to the original scan. All contributing libraries are listed on{' '}
            <Link href="/libraries" className={A}>Libraries</Link>.
          </li>
          <li className={P}>
            <strong className="text-primary">A reading room of your own.</strong> A partner’s books can have their own site on
            a Source Library address, as the Embassy of the Free Mind’s{' '}
            <a href="https://bph.sourcelibrary.org" className={A}>Bibliotheca Philosophica Hermetica</a> does.
          </li>
          <li className={P}>
            <strong className="text-primary">Nothing is locked in.</strong> Every book has a IIIF manifest and a full-text
            download, every page a stable link, and finished editions can get a DOI. AI assistants can search and quote the
            library through our <Link href="/connect" className={A}>connector</Link>.
          </li>
          <li className={P}>
            <strong className="text-primary">What a draft costs.</strong> The English draft of the Derge Tengyur cost{' '}
            ${TENGYUR.spend_usd.toLocaleString('en-US')} for {TENGYUR.pages_translated.toLocaleString('en-US')} pages, about $
            {TENGYUR.usd_per_page} a page (<a href={GAP_STATUS_URL} className={A}>figures</a>). Review by scholars is the part
            that costs time, and it is the part we have not yet done.
          </li>
        </ul>
        <div className="border-t border-border-light pt-8 flex flex-wrap gap-x-8 gap-y-3 font-sans text-sm">
          <Link href="/research/canon-gap" className={A}>The Open Canons: holdings and drafts</Link>
          <Link href="/research/canon-quality" className={A}>How we check each canon</Link>
          <Link href="/quality" className={A}>Quality Center</Link>
          <Link href="/developers/pipeline" className={A}>Pipeline, for developers</Link>
        </div>
      </div>
    </main>
  );
}
