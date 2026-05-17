import { Metadata } from 'next';
import Link from 'next/link';
import { getReadDb } from '@/lib/mongodb';

export const metadata: Metadata = {
  title: 'Scan Quality — Cases Wanting Review',
  description: 'Pages where the scan_quality system wants a human eye.',
};

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type ScanQuality = {
  scan_score?: number;
  scan_class?: string;
  readable_text?: boolean;
  illustration_fidelity?: string;
  page_completeness?: string;
  concerns?: string[];
  reasoning?: string;
  class_corrected?: string;
  version?: number;
};

type ImageCharacteristics = {
  megapixels?: number;
  chroma_spread?: number;
  histogram_entropy?: number;
  bimodality?: number;
  sharpness_var?: number;
  dynamic_range?: number;
  version?: number;
  flags?: {
    is_blank?: boolean;
    is_monochrome?: boolean;
    is_bitonal?: boolean;
    is_over_compressed?: boolean;
    is_low_resolution?: boolean;
  };
};

type PageDoc = {
  id?: string;
  _id?: string;
  book_id: string;
  page_number: number;
  archived_photo?: string;
  scan_quality?: ScanQuality;
  image_characteristics?: ImageCharacteristics;
};

type BookMini = {
  id: string;
  title?: string;
  year?: number;
  image_source?: { provider?: string };
};

type Section = {
  key: string;
  title: string;
  blurb: string;
  rows: Array<PageDoc & { book?: BookMini; reason: string }>;
  total: number;
  saturated: boolean;
};

type SectionSpec = {
  key: string;
  title: string;
  blurb: string;
  reason: string;
  filter: Record<string, unknown>;
};

const PER_SECTION = 8;

const SECTION_SPECS: SectionSpec[] = [
  {
    key: 'normalizer',
    title: 'Normalizer auto-corrected',
    blurb: 'The v4 worker flagged Gemini’s response as internally contradictory and fixed scan_class to match the concerns/completeness fields. These are exactly where Gemini self-reported contradictory evidence — worth confirming the auto-fix landed on the right class.',
    reason: 'Normalizer overrode Gemini’s scan_class.',
    filter: { 'scan_quality.version': 2, 'scan_quality.class_corrected': { $exists: true } },
  },
  {
    key: 'color-bitonal',
    title: 'Color photograph of bitonal content',
    blurb: 'Gemini called the SCAN color_photo but the pixel-stats flag the IMAGE as bitonal + monochrome. Definition tension: a clean color photograph of black ink on aged paper. Should this be color_photo (the medium) or bitonal_clean (the content)? Schema says scan medium wins, but the cases are worth confirming.',
    reason: 'Pixel-stats say monochrome/bitonal; class says color_photo.',
    filter: {
      'scan_quality.version': 2,
      'scan_quality.scan_class': 'color_photo',
      'image_characteristics.flags.is_bitonal': true,
      'image_characteristics.flags.is_monochrome': true,
    },
  },
  {
    key: 'microfilm-color',
    title: 'Microfilm class on a page with color information',
    blurb: 'Gemini called this bitonal_microfilm or microfiche, but the pixel-stats see meaningful color spread (chroma > 8) — incompatible with a true bitonal scan. Likely the model overreached on microfilm signals. These are the Pausanias-p623 family: a color photograph of yellowed line art misread as microfilm.',
    reason: 'scan_class says microfilm but pixel chroma_spread > 8.',
    filter: {
      'scan_quality.version': 2,
      'scan_quality.scan_class': { $in: ['bitonal_microfilm', 'microfiche'] },
      'image_characteristics.chroma_spread': { $gte: 8 },
    },
  },
  {
    key: 'borderline',
    title: 'Borderline scores (40–65)',
    blurb: 'The mid-band where Gemini’s judgments are most unstable across same-source pages. Worth eyeballing a few — if you mostly agree, the system is calibrated; if you disagree, the rubric needs tuning.',
    reason: 'Score in 40–65 range — stability test.',
    filter: { 'scan_quality.version': 2, 'scan_quality.scan_score': { $gte: 40, $lte: 65 } },
  },
  {
    key: 'missing',
    title: 'scan_quality missing despite characteristics present',
    blurb: 'Pages where the deterministic image_characteristics landed but Gemini didn’t emit a scan_quality block. responseSchema is supposed to make this impossible — each occurrence is evidence the SDK isn’t strictly enforcing required fields.',
    reason: 'image_characteristics present but scan_quality missing.',
    filter: { 'image_characteristics.version': 2, 'scan_quality.version': { $ne: 2 } },
  },
  {
    key: 'near-blank',
    title: 'High score despite near-blank pixel-stats',
    blurb: 'Score ≥ 80 but the page’s pixel histogram says almost nothing is there (entropy < 1.5, bimodality ≥ 0.9). These are pages like a near-empty endpaper with a small library stamp — likely over-scored. An L1-backstop rule (tracked in #16) would downgrade these to blank or low scores.',
    reason: 'High score on a page whose characteristics scream near-blank.',
    filter: {
      'scan_quality.version': 2,
      'scan_quality.scan_class': { $in: ['bitonal_clean', 'color_photo', 'grayscale_photo', 'color_print', 'grayscale_print'] },
      'scan_quality.scan_score': { $gte: 80 },
      'image_characteristics.histogram_entropy': { $lt: 1.5 },
      'image_characteristics.bimodality': { $gte: 0.9 },
    },
  },
];

// Test the SectionSpec filter against an in-memory page record. We pre-load
// every page from books that have a v2 rollup (small set), then bucket them
// by section using these predicates instead of issuing 6 server-side queries
// against an unindexed field on a million-doc collection.
function matchesFilter(spec: SectionSpec, p: PageDoc): boolean {
  const sq = p.scan_quality || {};
  const ch = p.image_characteristics || {};
  const flags = ch.flags || {};
  const v2Page = sq.version === 2;
  const v2Chars = ch.version === 2;

  switch (spec.key) {
    case 'normalizer':
      return v2Page && !!sq.class_corrected;
    case 'color-bitonal':
      return v2Page && sq.scan_class === 'color_photo'
        && flags.is_bitonal === true && flags.is_monochrome === true;
    case 'microfilm-color':
      return v2Page
        && (sq.scan_class === 'bitonal_microfilm' || sq.scan_class === 'microfiche')
        && typeof ch.chroma_spread === 'number' && ch.chroma_spread >= 8;
    case 'borderline':
      return v2Page && typeof sq.scan_score === 'number'
        && sq.scan_score >= 40 && sq.scan_score <= 65;
    case 'missing':
      return v2Chars && !v2Page;
    case 'near-blank': {
      const contentClasses = ['bitonal_clean', 'color_photo', 'grayscale_photo', 'color_print', 'grayscale_print'];
      return v2Page
        && contentClasses.includes(sq.scan_class || '')
        && typeof sq.scan_score === 'number' && sq.scan_score >= 80
        && typeof ch.histogram_entropy === 'number' && ch.histogram_entropy < 1.5
        && typeof ch.bimodality === 'number' && ch.bimodality >= 0.9;
    }
    default:
      return false;
  }
}

async function loadSections(): Promise<Section[]> {
  const db = await getReadDb();
  const pages = db.collection('pages');
  const books = db.collection('books');

  // Drive everything from the books collection. Books with a v2 rollup is a tiny
  // set (currently dozens); books is ~25K docs vs pages which is millions. We
  // also pick up books with image_characteristics-only pages (the "missing
  // scan_quality" section) by including any book that's been touched by the
  // image-extract worker at v2 — for now we approximate this via the v2 rollup.
  let v2Books: BookMini[] = [];
  try {
    v2Books = await books
      .find(
        { 'scan_quality.version': 2 },
        { projection: { id: 1, title: 1, year: 1, 'image_source.provider': 1 }, maxTimeMS: 8000 },
      )
      .limit(500)
      .toArray() as unknown as BookMini[];
  } catch (err) {
    throw new Error(`books.find(scan_quality.version=2) failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (v2Books.length === 0) {
    return SECTION_SPECS.map(spec => ({
      key: spec.key,
      title: spec.title,
      blurb: spec.blurb,
      rows: [],
      total: 0,
      saturated: false,
    }));
  }

  const bookIds = v2Books.map(b => b.id);
  const bookById = new Map(v2Books.map(b => [b.id, b]));

  // Pull every relevant page from those books in ONE query. book_id is indexed,
  // so this is fast even with hundreds of books. We over-fetch slightly (some
  // pages may not match any section), then bucket client-side.
  const PROJECTION = {
    _id: 1, id: 1, book_id: 1, page_number: 1, archived_photo: 1,
    scan_quality: 1, image_characteristics: 1,
  };

  let candidatePages: PageDoc[] = [];
  try {
    candidatePages = await pages
      .find(
        {
          book_id: { $in: bookIds },
          $or: [
            { 'scan_quality.version': 2 },
            { 'image_characteristics.version': 2 },
          ],
        },
        { projection: PROJECTION, maxTimeMS: 15000 },
      )
      .toArray() as unknown as PageDoc[];
  } catch (err) {
    throw new Error(`pages.find(book_id IN v2Books) failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Bucket each page into any sections it matches.
  return SECTION_SPECS.map(spec => {
    const matching = candidatePages.filter(p => matchesFilter(spec, p));
    const rows = matching.slice(0, PER_SECTION).map(r => ({
      ...r,
      book: bookById.get(r.book_id),
      reason: spec.reason,
    }));
    return {
      key: spec.key,
      title: spec.title,
      blurb: spec.blurb,
      rows,
      total: matching.length,
      saturated: matching.length > PER_SECTION,
    };
  });
}

function pageImageUrl(p: PageDoc): string {
  if (p.archived_photo && !p.archived_photo.startsWith('failed:')) return p.archived_photo;
  return '';
}

function shortClass(c?: string) {
  if (!c) return '—';
  return c.replace(/_/g, ' ');
}

function chipColorForClass(c?: string): string {
  if (!c) return 'bg-stone-200 text-stone-700';
  if (c.startsWith('color')) return 'bg-emerald-100 text-emerald-800';
  if (c.startsWith('grayscale')) return 'bg-blue-100 text-blue-800';
  if (c === 'bitonal_clean') return 'bg-amber-100 text-amber-800';
  if (c === 'bitonal_microfilm' || c === 'microfiche') return 'bg-rose-100 text-rose-800';
  if (c === 'scanner_metadata') return 'bg-fuchsia-100 text-fuchsia-800';
  if (c === 'blank' || c === 'corrupt') return 'bg-stone-200 text-stone-700';
  return 'bg-stone-200 text-stone-700';
}

function PageCard({ row }: { row: PageDoc & { book?: BookMini; reason: string } }) {
  const sq = row.scan_quality;
  const chars = row.image_characteristics;
  const flags = chars?.flags || {};
  const activeFlags = Object.entries(flags).filter(([_, v]) => v).map(([k]) => k.replace('is_', ''));
  const url = pageImageUrl(row);
  const bookTitle = row.book?.title || row.book_id;
  const provider = row.book?.image_source?.provider;
  const year = row.book?.year;

  return (
    <div className="border border-stone-300 rounded-lg bg-white overflow-hidden flex flex-col">
      <a href={url} target="_blank" rel="noreferrer" className="block bg-stone-50 border-b border-stone-200">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={`p${row.page_number}`} className="w-full h-64 object-contain" loading="lazy" />
        ) : (
          <div className="w-full h-64 flex items-center justify-center text-stone-400 text-sm">no image url</div>
        )}
      </a>
      <div className="p-3 flex-1 flex flex-col gap-2 text-sm">
        <div className="text-stone-900 font-medium leading-snug line-clamp-2" title={bookTitle}>
          {bookTitle}
        </div>
        <div className="text-stone-500 text-xs flex flex-wrap gap-x-2">
          <span>page {row.page_number}</span>
          {year && <span>· {year}</span>}
          {provider && <span>· {provider}</span>}
        </div>

        <div className="flex flex-wrap gap-1.5 items-center">
          {sq?.scan_class && (
            <span className={`px-2 py-0.5 rounded text-xs ${chipColorForClass(sq.scan_class)}`}>
              {shortClass(sq.scan_class)}
            </span>
          )}
          {typeof sq?.scan_score === 'number' && (
            <span className="px-2 py-0.5 rounded text-xs bg-stone-100 text-stone-800 font-mono">{sq.scan_score}</span>
          )}
          {sq?.page_completeness && sq.page_completeness !== 'full_page' && (
            <span className="px-2 py-0.5 rounded text-xs bg-stone-100 text-stone-700">{shortClass(sq.page_completeness)}</span>
          )}
          {sq?.class_corrected && (
            <span className="px-2 py-0.5 rounded text-xs bg-orange-100 text-orange-800" title={sq.class_corrected}>auto-corrected</span>
          )}
        </div>

        {sq?.concerns && sq.concerns.length > 0 && (
          <div className="text-xs text-stone-600">
            <span className="font-semibold text-stone-500">concerns: </span>
            {sq.concerns.join(', ')}
          </div>
        )}

        {sq?.reasoning && (
          <div className="text-xs text-stone-600 italic leading-snug">"{sq.reasoning}"</div>
        )}

        <div className="text-xs text-stone-500 font-mono pt-1 border-t border-stone-100">
          {chars?.megapixels ?? '—'}MP · chroma {chars?.chroma_spread ?? '—'} · entr {chars?.histogram_entropy ?? '—'} · bimo {chars?.bimodality ?? '—'} · sharp {chars?.sharpness_var ?? '—'}
          {activeFlags.length > 0 && <span className="block">flags: {activeFlags.join(', ')}</span>}
        </div>

        <div className="text-xs text-amber-700 italic pt-1 border-t border-stone-100">
          why this one: {row.reason}
        </div>
      </div>
    </div>
  );
}

export default async function ScanEvaluationPage() {
  let sections: Section[] = [];
  let loadError: string | null = null;
  try {
    sections = await loadSections();
  } catch (e) {
    loadError = e instanceof Error ? e.message : String(e);
  }

  return (
    <main className="max-w-7xl mx-auto px-6 py-10">
      <header className="mb-8">
        <div className="flex items-center gap-2 text-sm text-stone-500 mb-2">
          <Link href="/admin" className="hover:text-stone-700">admin</Link>
          <span>/</span>
          <span>scan-evaluation</span>
        </div>
        <h1 className="text-3xl font-semibold text-stone-900 mb-2">Scan Quality — Cases Wanting a Human Eye</h1>
        <p className="text-stone-600 max-w-3xl">
          The automated scan_quality system (per-page Gemini + pixel-stat hybrid, prompt v4)
          ships per-page judgments and book-level rollups. This page surfaces the cases
          where I want validation — internal contradictions, definition tensions, borderline
          scores, missing fields, and known edge-case patterns. Click any image to open the
          full-resolution scan in a new tab.
        </p>
        <p className="text-stone-500 text-sm mt-3">
          See <Link href="/blog/what-makes-a-good-scan" className="text-accent-rust hover:underline">What Makes a Good Scan?</Link> for the design context, and
          {' '}<a href="https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/1810" className="text-accent-rust hover:underline">issue #1810</a> for the implementation tracker.
        </p>
      </header>

      {loadError && (
        <div className="bg-rose-50 border border-rose-200 rounded p-4 mb-6 text-sm text-rose-800">
          Failed to load sections: {loadError}
        </div>
      )}

      {sections.map(section => (
        <section key={section.key} className="mb-12">
          <div className="flex items-baseline gap-3 mb-2">
            <h2 className="text-xl font-semibold text-stone-900">{section.title}</h2>
            <span className="text-sm text-stone-500">
              {section.total === 0
                ? 'no cases match this filter'
                : section.saturated
                  ? `showing ${section.rows.length} of ${section.total} matches`
                  : `${section.total} match${section.total === 1 ? '' : 'es'}`}
            </span>
          </div>
          <p className="text-sm text-stone-600 max-w-3xl mb-4 leading-snug">{section.blurb}</p>
          {section.rows.length === 0 ? (
            <div className="text-sm text-stone-400 italic">No cases match this filter right now.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {section.rows.map((row) => (
                <PageCard key={`${section.key}-${row.book_id}-${row.page_number}`} row={row} />
              ))}
            </div>
          )}
        </section>
      ))}

      <footer className="mt-12 pt-6 border-t border-stone-200 text-xs text-stone-500">
        Cases are pulled from the production <code>pages</code> collection where{' '}
        <code>scan_quality.version = 2</code> (or characteristics are present and{' '}
        <code>scan_quality</code> is missing). Limited to 8 per section to keep the page
        scannable — if a section has many more, it means the underlying class needs
        prompt-level attention, not page-level fixes.
      </footer>
    </main>
  );
}
