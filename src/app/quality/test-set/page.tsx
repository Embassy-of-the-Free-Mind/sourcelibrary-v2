import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout from '@/components/layout/ContentPageLayout';
import SiteHeader from '@/components/layout/SiteHeader';
import RAW from '@/data/test-set-264.json';

// The OCR test set drawn from the library itself (issue 264, stage 1). The reader: someone at a desk with a new
// engine's score, asking "can I read this against a routing decision, and how much should I trust this cell?". So
// the page opens with one table (each router cell's share of the set beside its share of the pages waiting), then one
// block per cell: books, where the truth comes from, what was left out and why, what is known to be weak, and which
// engines have been scored. Every figure is read at build time from src/data/test-set-264.json, which
// scripts/eval/test-set-264/seal.mjs writes from the sealed frame. No page id and no reference text is published:
// the 20% sealed reserve stays unseen. The prose follows .claude/docs/quality-statements.md.
export const revalidate = false;

export const metadata: Metadata = {
  title: 'The OCR Test Set: What It Holds, Cell by Cell | Source Library',
  description:
    'The pages we score transcription engines on, drawn at random from the library: for each kind of page the router sends to an engine, its share of the set beside its share of the library, the books, where the reference text comes from, and what was left out.',
  alternates: { canonical: '/quality/test-set' },
};

type Counted = Record<string, number>;
type Cell = {
  id: string; router_cells: string[]; pooled: boolean; pages_waiting: number; target_books: number;
  drawn_books: number; drawn_pages: number; reserve_pages: number; short_router_cells: { id: string; drawn: number; quota: number }[];
  existing: { reference_books: number; judged_books: number; canonical_reference_books: number };
  observed_kind: Counted; observed_differs: number; class_source: Counted; catalogue_visible: number; image_unfetched: number;
  draw_skips: Counted; draw_languages: { language: string; books_in_catalogue: number; examined: number }[]; truth_holders: Counted;
  exclusions: { references_mapped: number; references_pass: number; judged_mapped: number; judged_pass: number; failed: Counted } | null;
  share_of_library: number; share_of_set: number;
};
const DATA = RAW as unknown as Omit<typeof RAW, 'cells'> & { cells: Cell[] };

const LINK = 'text-amber-800 underline decoration-amber-800/30 underline-offset-2 hover:decoration-amber-800';
const SRC = 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/blob/main/scripts/eval/test-set-264/';
const num = (n: number) => n.toLocaleString('en-US');
const pct = (x: number) => `${(100 * x).toFixed(x < 0.01 ? 2 : 1)}%`;
const day = (iso: string) => iso.slice(0, 10);
const anchor = (id: string) => `cell-${id.replace(/[^a-z0-9]+/gi, '-')}`;

/** The first part of a router cell id, in words: the language, then the text the page holds now. */
const HOLDS: Record<string, string> = {
  lite: 'a first read by the lightest model',
  flash3: 'a read by the mid-tier model',
  blank: 'no text yet',
  yigdzin: 'a read by the Tibetan open engine',
  'paddle-dice': 'a read by Open engine A that disagrees with the Kanripo text (similarity under 0.90)',
  frame: 'a read by Open engine A through the guarded Chinese pipeline',
};

function describe(id: string): string {
  if (id.startsWith('other-')) return `Every smaller ${id.slice(6).replace('-script', '')} cell, pooled`;
  const [base, kind] = id.split('/');
  const parts = base.split('-');
  const lang = parts[0] === 'zh' ? 'Chinese' : parts[0][0].toUpperCase() + parts[0].slice(1);
  const key = Object.keys(HOLDS).find((k) => base.includes(`-${k}`));
  const period = base.endsWith('pre1800') ? ', before 1800' : '';
  return `${lang}${period}, ${kind === 'unknown' ? 'kind of page not recorded' : kind}; the page holds ${key ? HOLDS[key] : 'a stored read'}`;
}

/** A draw-log reason in plain words; engine names stay out of the page (src/lib/plain-engine-words.ts). */
function skipWords(k: string): string {
  if (/ text by none: no router cell/.test(k)) return 'page with no text and no router cell';
  if (/ text by \w+: no router cell/.test(k)) return 'page whose stored read has no router cell';
  if (k === 'drawn page number not found') return 'drawn leaf has no page record';
  if (k.startsWith('Paddle text with Kanripo')) return 'Chinese read that matches the Kanripo text, or was not screened';
  if (k.startsWith('no frame cell')) return 'no cell for this kind of page';
  if (k.startsWith('English, no stored text')) return 'English page with no text, 1800 or later or undated';
  if (k.startsWith('page_type ')) return `${k.slice(10)} leaf`;
  return k;
}

function plainSkips(obj: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(obj)) out[skipWords(k)] = (out[skipWords(k)] || 0) + n;
  return Object.fromEntries(Object.entries(out).sort((x, y) => y[1] - x[1]));
}

function Bar({ v, max, tone }: { v: number; max: number; tone: string }) {
  return (
    <span className="inline-block h-2 align-middle bg-stone-200 w-24 sm:w-32" aria-hidden="true">
      <span className={`block h-2 ${tone}`} style={{ width: `${Math.max(1, (100 * v) / max)}%` }} />
    </span>
  );
}

function Counts({ obj, empty = 'none' }: { obj: Record<string, number>; empty?: string }) {
  const e = Object.entries(obj);
  if (!e.length) return <>{empty}</>;
  return <>{e.map(([k, n], i) => <span key={k}>{i ? '; ' : ''}{k} {num(n)}</span>)}</>;
}

function weaknesses(c: Cell): string[] {
  const w: string[] = [];
  const drawn = c.drawn_pages;
  if (c.drawn_books < c.target_books)
    w.push(`${c.drawn_books} of the ${c.target_books} books the size rule asks for were found: ${c.short_router_cells.map((s) => `${s.id} ${s.drawn} of ${s.quota}`).join(', ')}. The draw ran out of books with a waiting page in this cell.`);
  if (c.pooled)
    w.push(`Pools ${c.router_cells.length} router cells (${c.router_cells.join(', ')}). A score here is a score for the group, not for any one of them.`);
  if (c.observed_differs)
    w.push(`For ${c.observed_differs} of ${drawn} drawn pages, this set's classification names a different kind of page than the stored class the router placed them by (classified: ${Object.entries(c.observed_kind).map(([k, n]) => `${k} ${n}`).join(', ')}). Which of the two is right has not been checked. The pages stay in this cell, because the router places them by the stored class.`);
  const eye = c.class_source['read by eye (Claude Opus), page level'] || 0;
  const none = c.class_source['not classified'] || 0;
  const book = c.class_source['book_class (#5768), book level'] || 0;
  if (book && book < drawn) w.push(`The kind of page comes from the book's recorded class for ${book} pages and from a reading of the page image for ${eye}${none ? `; ${none} are not classified` : ''}.`);
  else if (book === drawn) w.push(`The kind of page comes from the book's recorded class, not from the drawn page itself.`);
  if (c.image_unfetched)
    w.push(`${c.image_unfetched} drawn page images could not be fetched when the set was sealed (the holder answered 403), so they carry no image hash yet.`);
  if (c.id.includes('-blank'))
    w.push(`The pages-waiting count for this cell is the count of pages with no first read. It includes catalogue books with no page records yet, which the draw cannot use, so the cell's share of the library is likely overstated.`);
  const refs = c.existing.reference_books;
  if (!refs) w.push(`No book in this cell has a typed reference yet; its truth so far is a judged read, a model's verdict on our own text, not a typed transcription.`);
  return w;
}

function CellBlock({ c }: { c: Cell }) {
  const ex = c.exclusions;
  const w = weaknesses(c);
  return (
    <section id={anchor(c.id)} className="mt-10 scroll-mt-20 border-t border-stone-300 pt-5 max-w-4xl">
      <h3 className="font-serif text-2xl text-stone-900"><span className="font-mono text-xl">{c.id}</span></h3>
      <p className="text-stone-600 mt-1">{describe(c.id)}.</p>
      <dl className="mt-4 grid grid-cols-1 sm:grid-cols-[12rem_1fr] gap-x-6 gap-y-3 text-stone-700 leading-relaxed">
        <dt className="text-stone-900 font-semibold">Share</dt>
        <dd>
          {pct(c.share_of_set)} of the drawn pages ({num(c.drawn_pages)}); {pct(c.share_of_library)} of the pages waiting
          for a read ({num(c.pages_waiting)}).
        </dd>
        <dt className="text-stone-900 font-semibold">Books</dt>
        <dd>
          {num(c.drawn_books)} books drawn, one page each ({c.target_books} asked for); {num(c.reserve_pages)} of those pages
          are the sealed reserve. {num(c.catalogue_visible)} of the {num(c.drawn_books)} books are in the public catalogue,
          the rest are held back from it. Drawn from: {c.draw_languages.map((l) => `${l.language} (${num(l.examined)} of ${num(l.books_in_catalogue)} books examined)`).join(', ') || 'no language'}.
        </dd>
        <dt className="text-stone-900 font-semibold">Truth sources</dt>
        <dd>
          For the drawn pages: none yet. Already held, as separate rows in this cell: {num(c.existing.reference_books)} books with a
          typed reference{c.existing.canonical_reference_books ? ` (${c.existing.canonical_reference_books} from a canonical edition)` : ''},{' '}
          {num(c.existing.judged_books)} books with a judged read. By source: <Counts obj={c.truth_holders} />.
        </dd>
        <dt className="text-stone-900 font-semibold">Left out</dt>
        <dd>
          {ex ? (
            <>
              Of {num(ex.references_mapped)} references held for this cell, {num(ex.references_pass)} passed; of {num(ex.judged_mapped)} judged
              pages, {num(ex.judged_pass)} passed. Failed (a reference can fail more than one rule): <Counts obj={ex.failed} />.
            </>
          ) : 'No reference or judged page was mapped to this cell.'}{' '}
          Pages passed over while drawing, across the language: <Counts obj={plainSkips(c.draw_skips)} />.
        </dd>
        <dt className="text-stone-900 font-semibold">Known weaknesses</dt>
        <dd>{w.length ? <ul className="list-disc pl-5 space-y-1">{w.map((x) => <li key={x}>{x}</li>)}</ul> : 'None recorded.'}</dd>
        <dt className="text-stone-900 font-semibold">Engines scored</dt>
        <dd>None yet.</dd>
      </dl>
      <p className="mt-3 text-sm"><a href="#cells" className={LINK}>Back to the table</a></p>
    </section>
  );
}

export default function TestSetPage() {
  const t = DATA.totals;
  const cells = DATA.cells;
  const maxShare = Math.max(...cells.flatMap((c) => [c.share_of_set, c.share_of_library]));
  return (
    <ContentPageLayout header={<SiteHeader variant="light" />} bg="bg-cream" maxWidth="wide">
      <div data-reveal-skip="">
        <header className="max-w-3xl">
          <p className="text-sm uppercase tracking-wider text-stone-600">
            <Link href="/quality" className="hover:text-amber-800">Quality Center</Link>
          </p>
          <h1 className="font-serif text-4xl md:text-5xl text-stone-900 mt-2">The OCR test set, cell by cell</h1>
          <p className="text-lg text-stone-700 leading-relaxed mt-4">
            The pages we will score transcription engines on, drawn at random from the library on {day(DATA.drawn_at)}: one
            page from each of {num(t.drawn_books)} books, in {t.cells} cells. A cell is the kind of page the router sends to one
            engine: a language, the text the page holds now, and whether it is printed or written by hand.
          </p>
          <p className="text-base text-stone-700 leading-relaxed mt-3">
            {num(t.reserve_pages)} of the {num(t.drawn_pages)} drawn pages are a sealed reserve, held back so that a score can be
            checked on pages no one has tuned against. A further {num(t.existing_rows)} pages we already hold a reference or a
            judged read for are rows in their cells. No engine has been scored on this set yet. Earlier results, on panels
            chosen another way, stay on <Link href="/quality/pareto" className={LINK}>quality against price and time</Link>.
          </p>
          <p className="text-base text-stone-600 mt-3">
            <a href="#cells" className={LINK}>The cells</a> {'·'} <a href="#cell-detail" className={LINK}>Each cell</a> {'·'}{' '}
            <a href="#method" className={LINK}>How it was drawn</a>
          </p>
        </header>

        <section id="cells" className="mt-10 scroll-mt-16 max-w-5xl">
          <h2 className="font-serif text-3xl text-stone-900 mb-2">The cells</h2>
          <p className="text-stone-700 mb-4 max-w-3xl">
            Each cell&rsquo;s share of the drawn pages beside its share of the {num(t.pages_waiting)} pages waiting for a read.
            Cells with 100,000 or more pages waiting get 50 books, cells with 20,000 to 100,000 get 30, and smaller cells are
            pooled by script. So a large cell has a smaller share of the set than of the library, and a small one a larger
            share.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="text-left text-stone-600 border-b border-stone-300 align-bottom">
                  <th className="font-normal py-2 pr-3">cell</th>
                  <th className="font-normal py-2 pr-3">share of set</th>
                  <th className="font-normal py-2 pr-3">share of library</th>
                  <th className="font-normal py-2 pr-3 text-right">books</th>
                  <th className="font-normal py-2 pr-3 text-right">reserve</th>
                  <th className="font-normal py-2 pr-3 text-right" title="books with a typed reference already held">references</th>
                  <th className="font-normal py-2 text-right" title="books with a judged read already held">judged</th>
                </tr>
              </thead>
              <tbody>
                {cells.map((c) => (
                  <tr key={c.id} className="border-b border-stone-200">
                    <th scope="row" className="text-left font-normal py-1.5 pr-3">
                      <a href={`#${anchor(c.id)}`} className={`${LINK} font-mono`}>{c.id}</a>
                    </th>
                    <td className="py-1.5 pr-3 whitespace-nowrap"><Bar v={c.share_of_set} max={maxShare} tone="bg-amber-700" /> {pct(c.share_of_set)}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap"><Bar v={c.share_of_library} max={maxShare} tone="bg-stone-500" /> {pct(c.share_of_library)}</td>
                    <td className="py-1.5 pr-3 text-right">{c.drawn_books < c.target_books ? `${c.drawn_books} of ${c.target_books}` : c.drawn_books}</td>
                    <td className="py-1.5 pr-3 text-right">{c.reserve_pages}</td>
                    <td className="py-1.5 pr-3 text-right">{c.existing.reference_books}</td>
                    <td className="py-1.5 text-right">{c.existing.judged_books}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="cell-detail" className="mt-14 scroll-mt-16">
          <h2 className="font-serif text-3xl text-stone-900">Each cell</h2>
          {cells.map((c) => <CellBlock key={c.id} c={c} />)}
        </section>

        <details id="method" className="max-w-3xl mt-14 text-stone-700 leading-relaxed scroll-mt-16">
          <summary className="cursor-pointer font-serif text-3xl text-stone-900 hover:text-amber-800">How it was drawn</summary>
          <div className="space-y-3 mt-3">
            <p>
              <strong className="text-stone-900">The draw.</strong> For each catalogue language, the books with at least one
              page, including books held back from the public catalogue (duplicates, rights holds and withdrawn manuscripts
              left out), were put in a fixed pseudo-random order from a recorded seed. From each book one interior page was
              taken (the first 15% and the last 5% of the book skipped), and kept when that page is waiting for a read in a
              cell with room left. Blank leaves, illustrations and maps were passed over.
            </p>
            <p>
              <strong className="text-stone-900">The kind of page.</strong> Script, print or handwriting, and period come
              from a recorded classification of the book where one exists, and from a reading of the page image where it
              does not. Each row names which. The cell stays the router&rsquo;s cell, so a score lands on the routing
              decision it informs; where that classification disagrees with the stored class, the cell says how often.
            </p>
            <p>
              <strong className="text-stone-900">The seal.</strong> The frame was written once on {day(DATA.sealed_at)} and
              its contents are pinned by a hash ({DATA.frame_sha256.slice(0, 12)}&hellip;); a test fails if a sealed row
              changes. A page later found unusable is marked, not removed. The reserve is 20% of the drawn pages in each
              cell, chosen by the same seed; its page ids and any reference text are not published.
            </p>
            <p>
              <strong className="text-stone-900">Truth.</strong> References made by a model, references corrected from our
              own output, and references never checked against their leaf were left out, as were judged reads of
              translation rather than transcription. The drawn pages have no reference yet: typed texts from free
              editions and judged reads come in later stages. Router table {DATA.router_table}.{' '}
              <a href={SRC} className={LINK}>Source code</a>.
            </p>
          </div>
        </details>
      </div>
    </ContentPageLayout>
  );
}
