import { Metadata } from 'next';
import type { ReactNode } from 'react';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import gapMap from '../../../../scripts/catalog-coverage/results/canon-gap-map-2026-10.json';
import gapStatus from '../../../../scripts/catalog-coverage/results/canon-gap-status-2026-10.json';
import { CanonBars, RoutesDiagram, StatusBoard, STATUS_STYLE, TengyurProgress, TraditionProgress, ImprovementChart, short, type CanonBar, type Improvement, type TraditionProgressRow } from './diagrams';

// Built for the Eternity Foundation working session (#5513): read once, seated, as a
// table with a short argument. Sizes, licences, English shares and draft costs come from
// canon-gap-map.mjs; where each canon stands comes from canon-gap-status.mjs. Re-run
// those scripts (not this page) when a canon moves.
export const revalidate = false;

export const metadata: Metadata = {
  title: 'The Open Canons — Source Library Research',
  description:
    'Which Buddhist, Hindu, Jewish, Islamic and Chinese canons are already typed in openly, how much of each has any English, and what a draft English translation would cost.',
  alternates: { canonical: '/research/canon-gap' },
  robots: { index: false, follow: true },
};

type Row = (typeof gapMap.rows)[number];
type StatusRow = (typeof gapStatus.corpora)[number] & { done?: string };

const ISSUE_URL = 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary/issues/';
const RESULTS_URL =
  'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary/blob/main/scripts/catalog-coverage/results/canon-gap-map-2026-10.json';

// The Eternity shelf and the Tengyur draft are measured by canon-gap-status.mjs on every run
// (eternity_shelf, tengyur_draft), not typed in here.
const SHELF = { ...gapStatus.eternity_shelf, url: `${ISSUE_URL}${gapStatus.eternity_shelf.owner_issue}` };
const TENGYUR = { ...gapStatus.tengyur_draft, url: `${ISSUE_URL}${gapStatus.tengyur_draft.owner_issue}` };

// Rows inside another row (Chan ⊂ CBETA), duplicating one (K-Tripitaka ≈ CBETA Taishō), or
// with no typed text (Mongolian Kanjur) stay out of totals and Figure 2 — the same scope
// the script uses for total_draft_usd.
const OUT_OF_TOTAL = new Set(['cbeta-chan', 'tripitaka-koreana', 'mongolian-kanjur']);

const SHORT_NAME: Record<string, string> = {
  'derge-tengyur': 'Derge Tengyur',
  'derge-kangyur': 'Derge Kangyur',
  cbeta: 'CBETA (Chinese Buddhist canon)',
  'cbeta-chan': 'CBETA Chan records',
  'pali-mula': 'Pali canon: root texts',
  'pali-atthakatha': 'Pali: commentaries',
  'pali-tika': 'Pali: sub-commentaries',
  'gretil-buddhist': 'GRETIL Sanskrit: Buddhist',
  'gretil-vedanta': 'GRETIL Sanskrit: Vedānta',
  'gretil-gaudiya': 'GRETIL Sanskrit: Gauḍīya',
  'sefaria-zohar': 'Zohar (Sefaria)',
  'sefaria-lurianic': 'Lurianic Kabbalah (Sefaria)',
  'sefaria-cordovero': 'Cordovero (Sefaria)',
  'openiti-sufi': 'OpenITI: Sufi texts',
  ganjoor: 'Ganjoor (Persian poetry)',
  'mongolian-kanjur': 'Mongolian Kanjur',
  'tripitaka-koreana': 'Tripitaka Koreana',
  kanripo: 'Kanripo (Chinese classics)',
};
const nameOf = (id: string, fallback: string) => SHORT_NAME[id] ?? fallback;

// Before/after on the same pages and reference, each from the experiment it links to (scripts/eval/experiments/).
// inUse = adopted in the production lane; the rest are measured but not switched on.
const IMPROVEMENTS: Improvement[] = [
  { change: 'Sanskrit, Pali, Chinese: Flash-Lite → Flash', measure: 'reversed statements per 100 pages', before: 15.4, after: 5.9, lowerBetter: true, inUse: true, status: 'in use for new translations since 4 Oct 2026', href: `${ISSUE_URL}5695` },
  { change: 'Tengyur: 8-page blocks → one page at a time', measure: 'pages whose English belongs to another page, per 100', before: 13.3, after: 0.9, lowerBetter: true, inUse: true, status: 'in use for the Tengyur draft', href: `${ISSUE_URL}5497` },
  { change: 'Syriac: Gemini → Kraken (Sophro Mhiro)', measure: 'line error rate on published ground truth, %', before: 74, after: 19, lowerBetter: true, inUse: true, status: 'in use for Syriac', href: `${ISSUE_URL}4883` },
  { change: 'Blank and show-through leaves: OCR prompt v16 → v19.1', measure: 'leaves given invented text, %', before: 75, after: 30, lowerBetter: true, inUse: true, status: 'in use for new OCR since 2 Oct 2026', href: `${ISSUE_URL}4195` },
  { change: 'Page turns: blocks → continuous English with page markers', measure: 'real seam defects per 100 mid-sentence breaks', before: 21, after: 8, lowerBetter: true, inUse: false, status: 'tested; not yet in a lane', href: `${ISSUE_URL}5678` },
  { change: 'Persian manuscripts: Flash-Lite → Flash reading', measure: 'characters matching Ganjoor’s typed text, median %', before: 41, after: 70, lowerBetter: false, inUse: false, status: 'tested; still below the 90% needed to translate', href: `${ISSUE_URL}5525` },
];

const LICENCE_LABEL: Record<string, string> = {
  open: 'Open',
  'open-nc': 'Open, non-commercial',
  'reference-only': 'Reference only',
  unverified: 'Unverified',
  restricted: 'Restricted',
};

const STATUS = new Map((gapStatus.corpora as StatusRow[]).map((s) => [s.id, s]));
const fmt = (n: number) => n.toLocaleString('en-US');

const rows = [...gapMap.rows].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
const inTotal = gapMap.rows.filter((r) => !OUT_OF_TOTAL.has(r.id));
const typedChars = inTotal.reduce((s, r) => s + (r.size.base_chars ?? 0), 0);
const tengyur = gapMap.rows.find((r) => r.id === 'derge-tengyur')!;
const asOf = new Date(gapStatus.generated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

const bars: CanonBar[] = inTotal
  .filter((r) => r.size.base_chars && r.cost.usd != null)
  .map((r) => ({
    id: r.id,
    name: nameOf(r.id, r.corpus),
    chars: r.size.base_chars as number,
    english: r.english.fraction,
    usd: r.cost.usd as number,
    upper: r.english.fraction == null,
  }))
  .sort((a, b) => b.chars - a.chars);

function Stat({ n, label }: { n: string; label: string }) {
  return (
    <div className="px-5 py-6 border-stone-200 [&:not(:last-child)]:border-r max-sm:[&:nth-child(odd)]:border-r max-sm:[&:nth-child(-n+2)]:border-b">
      <div className="font-serif text-3xl md:text-4xl text-stone-900 tracking-tight">{n}</div>
      <div className="font-body text-sm text-stone-500 mt-1.5 leading-snug">{label}</div>
    </div>
  );
}

function Section({ kicker, title, children }: { kicker: string; title: string; children: ReactNode }) {
  return (
    <section className="py-12 border-b border-stone-200">
      <div className="font-body text-xs tracking-[0.16em] uppercase text-amber-700 font-semibold mb-3">{kicker}</div>
      <h2 className="font-serif text-2xl md:text-3xl text-stone-900 mb-4 tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function CorpusRow({ r }: { r: Row }) {
  const st = STATUS.get(r.id);
  const style = st ? STATUS_STYLE[st.status as keyof typeof STATUS_STYLE] : null;
  const upper = r.english.fraction == null;
  return (
    <div id={r.id} className="scroll-mt-24 py-5 border-b border-stone-200 md:grid md:grid-cols-[minmax(0,2.4fr)_repeat(4,minmax(0,1fr))] md:gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-serif text-lg text-stone-900">{r.corpus}</span>
          {style && (
            <span className={`font-body text-[11px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm ${style.cls}`}>{style.label}</span>
          )}
        </div>
        <div className="font-body text-sm text-stone-500 mt-0.5">{r.tradition}</div>
        <div className="font-body text-sm mt-2">
          <a href={r.source.url} className="text-amber-800 underline underline-offset-2 break-words">
            {r.source.name}
          </a>
          <span className="text-stone-500"> · {LICENCE_LABEL[r.licence.open] ?? r.licence.open}</span>
        </div>
        {r.licence.quote && (
          <details className="font-body text-sm text-stone-600 mt-1">
            <summary className="cursor-pointer text-stone-500">Licence, as the source states it</summary>
            <blockquote className="mt-1 pl-3 border-l-2 border-stone-300 italic break-words">
              &ldquo;{r.licence.quote}&rdquo;{' '}
              {r.licence.url && (
                <a href={r.licence.url} className="not-italic text-amber-800 underline underline-offset-2">
                  source
                </a>
              )}
            </blockquote>
          </details>
        )}
        {st?.done && (
          <p className="font-body text-sm text-stone-700 mt-2">
            <span className="font-semibold">Done:</span> {st.done}
          </p>
        )}
        {st?.next_action && (
          <p className="font-body text-sm text-stone-700 mt-1">
            <span className="font-semibold">Next:</span> {st.next_action}
          </p>
        )}
        {st?.owner_issue && (
          <a href={`${ISSUE_URL}${st.owner_issue}`} className="font-body text-xs text-stone-500 underline underline-offset-2">
            Work log #{st.owner_issue}
          </a>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 mt-3 md:mt-0 md:contents font-body text-sm">
        <div>
          <dt className="md:hidden text-[11px] uppercase tracking-wider text-stone-400">Typed text</dt>
          <dd className="text-stone-800">
            {r.size.base_chars ? `${short(r.size.base_chars)} chars` : '—'}
            {r.size.texts != null && <span className="block text-[11px] text-stone-400">{fmt(r.size.texts)} texts</span>}
          </dd>
        </div>
        <div>
          <dt className="md:hidden text-[11px] uppercase tracking-wider text-stone-400">Has English</dt>
          <dd className="text-stone-800">
            {upper ? <span className="text-stone-400">unknown</span> : `${((r.english.fraction as number) * 100).toFixed((r.english.fraction as number) < 0.1 ? 1 : 0)}%`}
          </dd>
        </div>
        <div>
          <dt className="md:hidden text-[11px] uppercase tracking-wider text-stone-400">We hold</dt>
          <dd className="text-stone-800">
            {fmt(st?.held_books ?? r.holdings.live_books + r.holdings.hidden_books)} books
            {st && (
              <span className="block text-[11px] text-stone-400">
                {fmt(st.live_books)} public · {fmt(st.readable_books)} in English
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="md:hidden text-[11px] uppercase tracking-wider text-stone-400">Draft English</dt>
          <dd className="text-stone-900 font-semibold">
            {r.cost.usd == null ? (
              <span className="text-stone-400 font-normal">n/a</span>
            ) : (
              <>
                ${fmt(r.cost.usd)}
                {upper && <span className="block text-[11px] text-stone-400 font-normal">upper bound</span>}
              </>
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}

export default function CanonGapPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="The Open Canons"
          subtitle="Several scriptural canons have been typed in by other projects and released under open licences, so their text does not have to be read from page images. This page lists each one, how much of it has been translated into English, and what a first English draft would cost."
        />
      }
    >
      <div className="max-w-5xl mx-auto font-body text-stone-700 text-lg leading-relaxed">
        <p className="text-sm text-stone-500 mt-6">
          Prepared for the Eternity Foundation working session, October 2026. Figures measured {asOf}.
        </p>

        <Section kicker="Our library" title="Scanned, transcribed, translated">
          <p className="mb-4">
            What we hold in each tradition: pages scanned, pages transcribed, and pages with a draft English
            translation. Click a square to open a book. The Tibetan figure includes the Derge Tengyur and Kangyur we
            imported this month; the Mongolian Kanjur is scans only so far.
          </p>
          <p className="mb-2 font-semibold text-stone-900">The tools and models involved</p>
          <ul className="list-disc pl-5 space-y-2 text-base mb-2">
            <li>
              <strong>Scans</strong> come from the libraries that hold the books: BDRC for the Tibetan and Mongolian
              canons, the British Library&rsquo;s Endangered Archives Programme for the Bhutanese manuscripts, the
              Internet Archive, and national and university libraries.
            </li>
            <li>
              <strong>Transcription.</strong> Where an open typed edition exists we use it, matched to our scans page
              by page: Esukhia&rsquo;s Derge Tengyur and Kangyur, CBETA for the Chinese Buddhist canon, Sefaria for
              Hebrew. Otherwise a model reads the page image. Google&rsquo;s Gemini (3 Flash and 3.1 Flash-Lite)
              reads most scripts. Specialist models read where they measured better: BDRC&rsquo;s Yigdzin for Tibetan
              manuscripts, Kraken for Syriac, and PaddleOCR-VL for Chinese brush manuscripts.
            </li>
            <li>
              <strong>English drafts</strong> are written by Gemini 3 Flash or Gemini 3.1 Flash-Lite. The Derge
              Tengyur is drafted by Gemini 3 Flash one page at a time, which put the English beside the right
              woodblock most reliably in our tests.
            </li>
            <li>
              <strong>Checking.</strong> Claude models (Opus and Sonnet) score samples blind against published
              translations and typed editions, and we read the page images ourselves where scores are low (see
              &ldquo;How good the English is&rdquo; below).
            </li>
          </ul>
          <p className="text-base text-stone-600">
            Under each tradition below, &ldquo;Read by&rdquo; and &ldquo;English by&rdquo; give the share of its pages
            each engine and model produced, from the records on the pages themselves.
          </p>
          {/* JSON imports widen tuples to arrays; the status script writes them as the row type declares. */}
          <TraditionProgress n={1} rows={([...gapStatus.traditions] as unknown as TraditionProgressRow[]).sort((a, b) => b.pages_scanned - a.pages_scanned)} />
        </Section>

        <div className="grid grid-cols-2 md:grid-cols-4 border border-stone-200 rounded-sm bg-stone-50 my-8">
          <Stat n={short(typedChars)} label="characters of canon typed in and openly available, across the canons below" />
          <Stat n={`$${fmt(gapMap.total_draft_usd)}`} label="to draft all of it in English with AI at our measured rates; mostly an upper bound" />
          <Stat
            n={`${(100 - (tengyur.english.fraction ?? 0) * 100).toFixed(1)}%`}
            label="of the Derge Tengyur has no published English translation (84000 catalogue)"
          />
          <Stat n={`${SHELF.readable} / ${SHELF.listed}`} label="books on the Eternity reading list now readable in English here" />
        </div>

        <Section kicker="Cost" title="Where the money goes">
          <p className="mb-4">
            A canon that exists only as page images has to be read by a model page by page, and the reading has to be
            checked. A canon already typed in by a project such as Esukhia, CBETA or Sefaria skips that step. Where an
            open scan of the same edition exists, we pair the typed text with it, so each page can be checked against
            the image.
          </p>
          <p>
            A draft English translation of every canon below would cost about ${fmt(gapMap.total_draft_usd)} in model
            fees. Scholarly review costs far more. A draft lets a reader search a text and follow it in outline; it
            does not replace a translator. Review funds go furthest on canons that are openly licensed, typed, paired
            with scans, and have little English.
          </p>
          <RoutesDiagram n={2} />
        </Section>

        <Section kicker="The gap" title="How much of each canon is in English">
          <p>
            Three catalogues publish how much of their canon is in English: 84000 for the Tibetan canon, SuttaCentral
            for the Pali, and Sefaria for the Hebrew. For the Chinese and Arabic canons, the two largest, nobody has
            measured it, so their draft cost below assumes none of it is in English.
          </p>
          <CanonBars n={3} rows={bars} />
        </Section>

        <Section kicker="First canon" title="The Derge Tengyur">
          <p>
            The Tengyur is the Tibetan canon of Indian commentaries and treatises. Its text is in the public domain,
            BDRC holds open scans of the same woodblock edition, and less than 1% of it has been published in English,
            so we started there. We have imported all of it, paired each typed folio with its page image, and are
            drafting an English translation of every page, to be reviewed by scholars beside the woodblock.{' '}
            <a href={TENGYUR.url} className="text-amber-800 underline underline-offset-2">
              Work log
            </a>
            .
          </p>
          <TengyurProgress
            n={4}
            perVolume={TENGYUR.per_volume as [number, number, number][]}
            pagesImaged={TENGYUR.pages_imaged}
            pagesWithText={TENGYUR.pages_with_text}
            pagesTranslated={TENGYUR.pages_translated}
            spendUsd={TENGYUR.spend_usd}
          />
        </Section>

        <Section kicker="Quality" title="How good the English is">
          <p className="mb-4">
            We test the English against published human translations of the same passages. Two AI judges score each
            page for fidelity from 1 to 5 without knowing which version is which, and we open the page images
            ourselves to find the cause of every low score. These are samples scored by models, not a
            scholar&rsquo;s review. Tests run 30 September to 3 October 2026.
          </p>
          <ImprovementChart n={5} rows={IMPROVEMENTS} />
          <ul className="list-disc pl-5 space-y-3 text-base">
            <li>
              <strong>Tengyur pilot.</strong> Of 40 sampled pages across five sections, 33 scored 4 or 5. The weakest
              section was pramāṇa (logic), 4 of 8, where compressed verse came out as a literal crib. Four pages
              contained a statement reversed in meaning, three of them in Madhyamaka verse. Every Tengyur page is
              therefore labelled an unreviewed machine draft.{' '}
              <a href={TENGYUR.url} className="text-amber-800 underline underline-offset-2">Details</a>
            </li>
            <li>
              <strong>One page at a time.</strong> Against 84000&rsquo;s translations of the same passages (113
              pages), drafting one page per request scored 4 or better on 99% of pages. Drafting eight pages at once
              scored about the same, but put English for the wrong part of the text beside the woodblock 15 times,
              against once. The full Tengyur is drafted one page at a time.
            </li>
            <li>
              <strong>Sanskrit, Pali and classical Chinese.</strong> On 64 pages from 64 books, judged against
              published translations, 58% of the English we serve scored 4 or better (mean 3.6). Sanskrit scored lowest,
              mostly because on pages with verse and commentary the English keeps the verse and shortens or drops the
              commentary. A stronger model (Gemini Flash instead of Flash-Lite) raised the mean by 0.4 and cut reversed
              statements from 15 to 6 per 100 pages. Since 4 October 2026 new translations in these languages, and in
              Greek, Hebrew, Arabic and Persian, use Flash; pages already served are not yet retranslated.{' '}
              <a href={`${ISSUE_URL}5695`} className="text-amber-800 underline underline-offset-2">Details</a>
            </li>
            <li>
              <strong>The reading of the page is often the cause.</strong> Of the 20 worst Sanskrit, Pali and Chinese
              pages, 6 failed because the source text was misread, not mistranslated. Correcting those transcriptions
              by hand raised their scores more than a better model did. This is why the typed canons above matter.
            </li>
            <li>
              <strong>Transcription accuracy.</strong> Our reading of the Bhutanese Kangyur manuscripts matches the
              Derge e-text on a median 95% of syllables. Our Sanskrit transcription matches GRETIL on at least 89% of
              characters, and our Pali on 95%. Persian manuscripts are not yet readable: the best model we tested
              matches Ganjoor&rsquo;s typed text on a median 70% of characters, short of the 90% we require before
              translating, so we are not translating them. Printed Persian reads well.{' '}
              <a href={`${ISSUE_URL}5525`} className="text-amber-800 underline underline-offset-2">Details</a>
            </li>
            <li>
              <strong>What we withdrew.</strong> On some Tibetan manuscript folios our earlier reading model wrote out
              Sanskrit scripture that is not on the page. We took down the English for the Bhutanese Kangyur
              manuscripts and are re-reading the affected pages with a model trained on Tibetan script.{' '}
              <a href={`${ISSUE_URL}4523`} className="text-amber-800 underline underline-offset-2">Details</a>
            </li>
          </ul>
        </Section>

        <Section kicker="Where it stands" title="Each canon, and what happens next">
          <StatusBoard n={6} items={rows.map((r) => ({ id: r.id, name: nameOf(r.id, r.corpus), status: STATUS.get(r.id)?.status ?? 'next' }))} />
          <p className="mb-6 text-base text-stone-600">
            Ordered by how much untranslated text each canon holds, weighted by how open its licence is and whether open
            scans of the same edition exist. &ldquo;We hold&rdquo; counts the books in our library for that canon:
            how many are public, and how many can be read in English.
          </p>
          <div className="hidden md:grid md:grid-cols-[minmax(0,2.4fr)_repeat(4,minmax(0,1fr))] md:gap-4 border-b-2 border-stone-300 pb-2 font-body text-[11px] uppercase tracking-wider text-stone-500">
            <div>Canon · open source · licence</div>
            <div>Typed text</div>
            <div>Has English</div>
            <div>We hold</div>
            <div>Draft English</div>
          </div>
          {rows.map((r) => (
            <CorpusRow key={r.id} r={r} />
          ))}
        </Section>

        <Section kicker="Already under way" title="The Eternity reading list">
          <p>
            We are also transcribing and translating the scanned books on the reading list drawn up with Eternity. At
            the last count, <strong>{SHELF.readable} of {SHELF.listed}</strong> of those books can be
            read in English on Source Library. The rest wait on a second reading of difficult pages or are still being
            translated. Each step is logged in{' '}
            <a href={SHELF.url} className="text-amber-800 underline underline-offset-2">
              the public work log
            </a>
            .
          </p>
        </Section>

        <Section kicker="Caveats" title="What these numbers leave out">
          <ul className="list-disc pl-5 space-y-3 text-base">
            <li>
              <strong>English coverage is unknown for most canons.</strong> Only 84000, SuttaCentral and Sefaria publish
              a measurable share. SuttaCentral&rsquo;s figure also leaves out the Pali Text Society&rsquo;s printed
              translations, so it undercounts.
            </li>
            <li>
              <strong>The cost is for our cheapest translation setting.</strong> A stronger model costs about four
              times as much per page for Chinese. Either way the draft costs much less than review.
            </li>
            <li>
              <strong>Some sizes are sampled.</strong> Kanripo&rsquo;s size is estimated from 40 works per section; two
              estimates differ by about 25%.
            </li>
            <li>
              <strong>Licences are quoted, not assumed.</strong> GRETIL&rsquo;s files say they are for reference only,
              so we do not publish their text; we read our own scans of the printed editions instead. Ganjoor and the
              K-Tripitaka state no licence we could find. Sefaria&rsquo;s main Zohar Hebrew text is marked
              &ldquo;unknown&rdquo;.
            </li>
            <li>
              <strong>&ldquo;We hold&rdquo; is a floor.</strong> It counts books matched by title and collection; we
              may hold more.
            </li>
          </ul>
          <p className="text-sm text-stone-500 mt-6">
            Every figure, quote, sample size and query behind this page is in the{' '}
            <a href={RESULTS_URL} className="text-amber-800 underline underline-offset-2">
              results file
            </a>{' '}
            produced by <code className="text-xs">scripts/catalog-coverage/canon-gap-map.mjs</code>. Measuring it made no
            model calls.
          </p>
        </Section>
      </div>
    </ContentPageLayout>
  );
}
