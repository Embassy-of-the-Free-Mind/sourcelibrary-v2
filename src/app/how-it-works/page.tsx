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
 * /how-it-works (#5861, #6074): how Source Library works, written for a library or a
 * partner project deciding whether to work with us. Figure 1 is the true order: the
 * line (find, read, translate, connect, publish), then checks that loop over the
 * published pages. One real page's journey (the film, the curated instance of
 * /book/<id>/journey?page=N) is the worked example in the middle.
 *
 * The film's page was chosen because it has all three things Connect shows: a row in
 * the meaning index, page-precise entries in the book's index, and other editions of
 * the same work (verified on #6074). The search below is re-run at every render; if
 * the page stops coming up, the film drops the claim.
 *
 * ISR with a real window and no fallback (rendering-and-seo.md): if the page cannot be
 * loaded the render throws, and the last good page keeps serving.
 */
export const revalidate = 86400;
export const preferredRegion = 'fra1';

const BOOK_ID = '6991d89a8c1030b12444c076';
const PAGE = 20;

const RESULTS = 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/blob/main/scripts/eval/results';

const CONFIG: JourneyInstanceConfig = {
  label: 'Svātmārāma, Haṭhayogapradīpikā 1.10',
  prologue: {
    eyebrow: 'Svātmārāma · fifteenth century',
    title: 'The Light on Hatha Yoga',
    body: 'Svātmārāma’s Haṭhayogapradīpikā is the classic manual of hatha yoga. This film follows one page of it, from the scan of an 1895 Bombay edition to an English page that anyone can read and cite.',
  },
  findBody: 'This is the Haṭhayogapradīpikā with two commentaries, Brahmānanda’s in Sanskrit and Shridhara’s in Hindi, printed in Bombay in 1895. The copy is in the Wellcome Collection in London, which has put its scan online for anyone to use.',
  readDetail: 'On this page it finds verses 8 to 10 of the first chapter, with both commentaries below them.',
  lineMatch: 'अशेषतापतप्तानां',
  lineCount: 2,
  linePosition: { x: 0.135, y0: 0.172, dy: 0.03 },
  outroQuote: 'Hatha Yoga is a sheltering monastery for those scorched by every kind of suffering.',
  outroSource: 'Svātmārāma, Haṭhayogapradīpikā 1.10, with the commentaries of Brahmānanda and Shridhara (Bombay, 1895), page 8. Sanskrit, with an English translation by Source Library.',
  search: { query: 'the masters of hatha yoga who conquered death' },
  checks: [
    {
      text: 'In October 2026 all 200 pages of this book went through three detectors: for an empty or refused reading, for placeholder English, and for text copied from another page. None was found.',
      href: `${RESULTS}/quality-sprint/2026-10-07-detectors/books.jsonl`,
    },
    {
      text: 'Our reading of another page of the book was scored against the typed Sanskrit in GRETIL: 84% of the characters agree, where an unrelated passage scores 30%.',
      href: `${RESULTS}/nalanda-readiness-2026-09-30/indic-sa-gretil-scores.jsonl`,
    },
  ],
  revisionNote: 'A check across the whole library had found explanations run into the English where only the Sanskrit word belonged, and moved each one into a note.',
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
  const [p] = await Promise.all([
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
  ]);
  if (!p) throw new Error(`how-it-works: page record ${data.pageId} not found`);
  const tr = p.translation;
  return {
    pageLabel: `${data.citation.locator} of the 1895 Haṭhayogapradīpikā`,
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
    revisions: data.revisions.count,
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
          examplePage={{ model: record.text?.model ?? data.readBy, label: `${data.citation.locator} of the 1895 Haṭhayogapradīpikā in the film below` }}
        />
      </div>

      <div className="max-w-[var(--container-narrow)] mx-auto px-6 pt-6 pb-8">
        <h2 className={H2}>One page, followed through</h2>
        <p className={P}>
          The film follows one page of an 1895 Bombay edition of Svātmārāma’s <i>Haṭhayogapradīpikā</i>, the classic manual
          of hatha yoga, through the steps above. The page holds verses 8 to 10 of the first chapter, the end of the list of
          the great masters of the tradition. The same steps are written out below the film.
        </p>
      </div>
      <JourneyFilm data={data} />
      <JourneyProse data={data}>
        <Link href="/about" className={A}>About Source Library</Link>
      </JourneyProse>

      <div className="max-w-[var(--container-narrow)] mx-auto px-6 pb-8">
        <h2 className={H2}>What a library cannot do on its own</h2>
        <p className={P}>
          A library can put its scans online. What it cannot easily do is tie each page to everything else that has been
          written on the same subject, in other languages and other collections. That is the Connect step, and it is where
          a book gains most from sitting beside the others.
        </p>
        <ul className="space-y-4 mb-6">
          <li className={P}>
            <strong className="text-primary">Search by meaning.</strong> Translated pages are indexed by what they say, so a
            question in plain English finds a page even when the page puts it in other words.{' '}
            <Link href="/search" className={A}>Search</Link>.
          </li>
          <li className={P}>
            <strong className="text-primary">An index of people, places and ideas.</strong> Each book gets an index tied to
            the pages where a name appears, and each name opens onto every other book in the library that mentions it.{' '}
            <Link href="/encyclopedia" className={A}>Encyclopedia</Link>.
          </li>
          <li className={P}>
            <strong className="text-primary">The illustrations, gathered.</strong> Woodcuts, engravings and diagrams are
            found on the page, described and collected, so they can be searched across books.{' '}
            <Link href="/gallery" className={A}>Gallery</Link>.
          </li>
          <li className={P}>
            <strong className="text-primary">Editions of the same work, linked.</strong> Scans of the same work from
            different printers, years and libraries are grouped, so a reader can move from one edition to another.
          </li>
          <li className={P}>
            <strong className="text-primary">Existing translations, credited.</strong> For early modern Latin works we record
            which have already been translated into English and by whom, and link to those translations.{' '}
            <Link href="/research/translation-registry" className={A}>Translation Registry</Link>.
          </li>
        </ul>
      </div>

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
