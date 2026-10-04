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

const ISSUE_URL = 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/';
const RESULTS_URL =
  'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/blob/main/scripts/catalog-coverage/results/canon-gap-map-2026-10.json';
const STATUS_URL =
  'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/blob/main/scripts/catalog-coverage/results/canon-gap-status-2026-10.json';

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

// Before/after on the same pages and reference. Every figure is copied from the write-up in `source`:
// an experiment file pinned to the commit it was read at, or, where the write-up is not on main yet,
// the issue comment that reports the run. inUse = adopted in a production lane.
const EXP = 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/blob/88b09e0084cbd9dc9c025cecec53e2a2430c8973/scripts/eval/experiments/';
const IMPROVEMENTS: Improvement[] = [
  {
    change: 'Sanskrit, Pali, Chinese: Flash-Lite → Flash', measure: 'reversed statements per 100 pages', before: 15.4, after: 5.9, lowerBetter: true,
    inUse: true, status: 'in use for new translations since 4 Oct 2026',
    basis: '68 pages from 68 books, against published translations (SuttaCentral, CC0; public-domain translators); two blind Claude Opus judges; 3 Oct 2026',
    source: `${EXP}2026-10-03-xlref-t5-sanskrit-pali-chinese-vs-reference.md`,
  },
  {
    change: 'Tengyur: 8-page blocks → one page at a time', measure: 'pages whose English belongs to another page, per 100', before: 13.3, after: 0.9, lowerBetter: true,
    inUse: true, status: 'in use for the Tengyur draft',
    basis: '113 pages (15 vs 1), against 84000’s published translations; two blind Claude Opus judges; 3 Oct 2026',
    source: `${EXP}2026-10-03-tengyur-84000-reference-ab-5497.md`,
  },
  {
    change: 'Syriac: Gemini → Kraken (Sophro Mhiro)', measure: 'line error rate, %', before: 74, after: 19, lowerBetter: true,
    inUse: true, status: 'in use for Syriac',
    basis: '40 manuscript pages with published transcriptions (Jerusalem SMMJ 36, ÖNB Cod. Syr. 1); Gemini arms 74–79%, lower shown; 16 Sep 2026',
    source: `${EXP}2026-09-16-syriac-retest-do-the-beth-mardutho-kraken-models-read-4746.md`,
  },
  {
    change: 'Blank and show-through leaves: OCR prompt v16 → v19.1', measure: 'leaves given invented text, %', before: 75, after: 30, lowerBetter: true,
    inUse: true, status: 'in use for new OCR since 2 Oct 2026',
    basis: '69 white and show-through leaves labelled by eye before any run, three reads each, v16 run alongside as control; 2 Oct 2026',
    source: `${EXP}2026-10-02-ocr-v19-1-stamps-4195.md`,
  },
  {
    change: 'Sentences across a page turn: Flash-Lite → Flash', measure: 'defects at mid-sentence page breaks, per 100', before: 26, after: 16, lowerBetter: true,
    inUse: true, status: 'in use for new translations in seven languages since 4 Oct 2026',
    basis: '100 mid-sentence page breaks from 100 books, screened by eye; a defect counts only when both of two blind Claude Opus judges flag it; 3–4 Oct 2026',
    source: 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/5678#issuecomment-5974324959',
  },
  {
    change: 'Sentences across a page turn: Flash with page markers', measure: 'defects at mid-sentence page breaks, per 100', before: 26, after: 11, lowerBetter: true,
    inUse: false, status: 'tested; markers added too little beyond Flash to adopt',
    basis: 'same 100 breaks and judges as the row above; 3–4 Oct 2026',
    source: 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/5678#issuecomment-5974324959',
  },
  {
    change: 'Persian manuscripts: Flash-Lite → Flash reading', measure: 'characters matching Ganjoor’s typed text, median %', before: 41, after: 70, lowerBetter: false,
    inUse: false, status: 'tested; still below the 90% needed to translate',
    basis: 'manuscript pages of classical poetry located in Ganjoor (9 and 13 pages); 1 Oct 2026; a small sample',
    source: 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/5525#issuecomment-5936907070',
  },
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

// Our shelf for each tradition and canon language. Mongolian has no language page yet.
const LANG_PAGE: Record<string, string> = {
  tibetan: '/languages/tibetan',
  chinese: '/languages/chinese',
  pali: '/languages/pali',
  sanskrit: '/languages/sanskrit',
  hebrew: '/languages/hebrew',
  arabic: '/languages/arabic',
  persian: '/languages/persian',
};
const TRADITION_LANG: Record<string, string> = {
  tibetan: 'tibetan',
  'chinese-buddhist': 'chinese',
  'chinese-classics': 'chinese',
  pali: 'pali',
  sanskrit: 'sanskrit',
  kabbalah: 'hebrew',
  sufi: 'arabic',
  'persian-poetry': 'persian',
};
const LANG_NAME: Record<string, string> = {
  tibetan: 'Tibetan', chinese: 'Chinese', pali: 'Pali', sanskrit: 'Sanskrit', hebrew: 'Hebrew', arabic: 'Arabic', persian: 'Persian',
};
// The Mongolian Kanjur row carries lang "tibetan" (its BDRC catalogue language); our books are Mongolian.
const rowLang = (r: Row) => (r.id === 'mongolian-kanjur' ? null : r.lang);

// External projects named in the prose.
const L = {
  k84000: 'https://84000.co',
  suttacentral: 'https://suttacentral.net',
  sefaria: 'https://www.sefaria.org',
  cbeta: 'https://www.cbeta.org',
  esukhia: 'https://github.com/Esukhia/derge-tengyur',
  bdrc: 'https://www.bdrc.io',
  bdrcTengyur: 'https://library.bdrc.io/show/bdr:W23703',
  eap: 'https://eap.bl.uk',
  ia: 'https://archive.org',
  gretil: 'https://gretil.sub.uni-goettingen.de',
  ganjoor: 'https://ganjoor.net',
  kraken: 'https://kraken.re',
};

const TRADITIONS = ([...gapStatus.traditions] as unknown as TraditionProgressRow[])
  .map((t) => ({ ...t, href: LANG_PAGE[TRADITION_LANG[t.id]] }))
  .sort((a, b) => b.pages_scanned - a.pages_scanned);

const CONTENTS = [
  ['gap', 'How much is in English'],
  ['cost', 'Why typed text matters'],
  ['tengyur', 'The Derge Tengyur'],
  ['canons', 'Each canon, and what is next'],
  ['library', 'What we already hold'],
  ['quality', 'How good the English is'],
  ['eternity', 'The Eternity reading list'],
  ['method', 'Method and caveats'],
] as const;

function A({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="text-amber-800 underline decoration-amber-800/30 underline-offset-2 hover:decoration-amber-800">
      {children}
    </a>
  );
}

function Stat({ n, label, href }: { n: string; label: string; href: string }) {
  return (
    <a
      href={href}
      className="group block px-5 py-6 border-stone-200 hover:bg-white transition-colors [&:not(:last-child)]:border-r max-sm:[&:nth-child(odd)]:border-r max-sm:[&:nth-child(-n+2)]:border-b"
    >
      <div className="font-serif text-3xl md:text-4xl text-stone-900 tracking-tight tabular-nums group-hover:text-amber-800">{n}</div>
      <div className="font-body text-sm text-stone-500 mt-1.5 leading-snug">{label}</div>
    </a>
  );
}

function Section({ id, title, children }: { id: (typeof CONTENTS)[number][0]; title: string; children: ReactNode }) {
  const i = CONTENTS.findIndex(([k]) => k === id) + 1;
  return (
    <section id={id} className="scroll-mt-24 py-14 border-t border-stone-200">
      <div className="font-body text-xs tracking-[0.16em] uppercase text-amber-700 font-semibold mb-3 tabular-nums">
        {String(i).padStart(2, '0')}
      </div>
      <h2 className="font-serif text-2xl md:text-3xl text-stone-900 mb-5 tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function CorpusRow({ r }: { r: Row }) {
  const st = STATUS.get(r.id);
  const style = st ? STATUS_STYLE[st.status as keyof typeof STATUS_STYLE] : null;
  const upper = r.english.fraction == null;
  const lang = rowLang(r);
  return (
    <div id={r.id} className="scroll-mt-24 py-6 border-b border-stone-200 md:grid md:grid-cols-[minmax(0,2.4fr)_repeat(4,minmax(0,1fr))] md:gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-serif text-lg text-stone-900 leading-snug">{r.corpus}</span>
          {style && (
            <span className={`font-body text-[11px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm ${style.cls}`}>{style.label}</span>
          )}
        </div>
        <div className="font-body text-sm text-stone-500 mt-0.5">{r.tradition}</div>
        <div className="font-body text-sm mt-2 flex flex-wrap gap-x-3 gap-y-1">
          <span>
            <A href={r.source.url}>{r.source.name}</A>
            <span className="text-stone-500"> · {LICENCE_LABEL[r.licence.open] ?? r.licence.open}</span>
          </span>
          {lang && LANG_PAGE[lang] && <A href={LANG_PAGE[lang]}>Our {LANG_NAME[lang]} books</A>}
          {st?.owner_issue && <A href={`${ISSUE_URL}${st.owner_issue}`}>Work log #{st.owner_issue}</A>}
        </div>
        {(st?.next_action || st?.done || r.licence.quote) && (
          <details className="font-body text-sm text-stone-600 mt-2">
            <summary className="cursor-pointer text-stone-500 hover:text-stone-800">
              {st?.next_action || st?.done ? 'Progress, next step and licence' : 'The licence, as the source states it'}
            </summary>
            {st?.done && (
              <p className="mt-2 text-stone-700">
                <span className="font-semibold">Done:</span> {st.done}
              </p>
            )}
            {st?.next_action && (
              <p className="mt-2 text-stone-700">
                <span className="font-semibold">Next:</span> {st.next_action}
              </p>
            )}
            {r.licence.quote && (
              <blockquote className="mt-2 pl-3 border-l-2 border-stone-300 italic break-words">
                &ldquo;{r.licence.quote}&rdquo;{' '}
                {r.licence.url && (
                  <a href={r.licence.url} className="not-italic text-amber-800 underline underline-offset-2">
                    source
                  </a>
                )}
              </blockquote>
            )}
          </details>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 mt-4 md:mt-0 md:contents font-body text-sm tabular-nums">
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
          subtitle="Buddhist, Hindu, Jewish, Islamic and Chinese canons that other projects have already typed in and released openly: how much of each is in English, what a first English draft would cost, and where our work on each stands."
        />
      }
    >
      <div className="max-w-5xl mx-auto font-body text-stone-700 text-lg leading-relaxed">
        <p className="text-sm text-stone-500 mt-8">
          Prepared for the Eternity Foundation working session, October 2026. Figures measured {asOf}.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 border border-stone-200 rounded-sm bg-stone-50 mt-6">
          <Stat href="#gap" n={short(typedChars)} label="characters of canon typed in and openly available" />
          <Stat href="#cost" n={`$${fmt(gapMap.total_draft_usd)}`} label="to draft all of it in English at our measured rates (mostly an upper bound)" />
          <Stat
            href="#tengyur"
            n={`${(100 - (tengyur.english.fraction ?? 0) * 100).toFixed(1)}%`}
            label="of the Derge Tengyur has no published English translation"
          />
          <Stat href="#eternity" n={`${SHELF.readable} / ${SHELF.listed}`} label="books on the Eternity reading list readable in English here" />
        </div>

        <nav aria-label="Contents" className="mt-10 mb-4">
          <div className="font-body text-xs tracking-[0.16em] uppercase text-stone-400 mb-3">Contents</div>
          <ol className="grid sm:grid-cols-2 gap-x-8 gap-y-1.5 text-base">
            {CONTENTS.map(([id, title], i) => (
              <li key={id} className="flex gap-3">
                <span className="text-amber-700 tabular-nums text-sm pt-0.5">{String(i + 1).padStart(2, '0')}</span>
                <a href={`#${id}`} className="text-stone-800 hover:text-amber-800 hover:underline underline-offset-2">
                  {title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <Section id="gap" title="How much of each canon is in English">
          <p>
            Three catalogues publish how much of their canon has been translated: <A href={L.k84000}>84000</A> for the
            Tibetan canon, <A href={L.suttacentral}>SuttaCentral</A> for the Pali, and <A href={L.sefaria}>Sefaria</A>{' '}
            for the Hebrew. Nobody has measured it for the Chinese and Arabic canons, the two largest, so their draft
            cost assumes none of it is in English. Click a canon to see its row in{' '}
            <a href="#canons" className="text-amber-800 underline underline-offset-2">the table</a>.
          </p>
          <CanonBars n={1} rows={bars} />
        </Section>

        <Section id="cost" title="Why typed text matters">
          <p className="mb-4">
            A canon that exists only as page images has to be read by a model page by page, and the reading checked. A
            canon already typed in, by <A href={L.esukhia}>Esukhia</A>, <A href={L.cbeta}>CBETA</A> or{' '}
            <A href={L.sefaria}>Sefaria</A>, skips both steps. Where an open scan of the same edition exists, we pair
            the typed text with it, so every page can still be checked against its image.
          </p>
          <p>
            A draft English translation of every canon here would cost about ${fmt(gapMap.total_draft_usd)} in model
            fees. Scholarly review costs far more. A draft lets a reader search a text and follow it in outline; it
            does not replace a translator. Review money goes furthest on canons that are openly licensed, typed, paired
            with scans, and have little English.
          </p>
          <RoutesDiagram n={2} />
        </Section>

        <Section id="tengyur" title="The first canon: the Derge Tengyur">
          <p>
            The Tengyur is the Tibetan canon of Indian commentaries and treatises. <A href={L.esukhia}>Esukhia&rsquo;s
            typed text</A> is in the public domain, <A href={L.bdrcTengyur}>BDRC holds open scans</A> of the same
            woodblock edition, and less than 1% of it is published in English by <A href={L.k84000}>84000</A>. So we
            started there: all 213 volumes are imported, each typed folio is paired with its page image, and every
            page is being drafted in English for scholars to review beside the woodblock.{' '}
            <A href={TENGYUR.url}>Work log #{TENGYUR.owner_issue}</A>
          </p>
          <TengyurProgress
            n={3}
            perVolume={TENGYUR.per_volume as [number, number, number][]}
            pagesImaged={TENGYUR.pages_imaged}
            pagesWithText={TENGYUR.pages_with_text}
            pagesTranslated={TENGYUR.pages_translated}
            spendUsd={TENGYUR.spend_usd}
          />
          <ul className="list-disc pl-5 space-y-3 text-base">
            <li>
              <strong>Pilot quality.</strong> Of 40 sampled pages across five sections, 33 scored 4 or 5 out of 5. The
              weakest section was pramāṇa (logic), 4 of 8, where compressed verse came out as a literal crib. Four pages
              reversed a statement&rsquo;s meaning, three of them in Madhyamaka verse. Every Tengyur page is labelled
              an unreviewed machine draft.
            </li>
            <li>
              <strong>One page at a time.</strong> Against 84000&rsquo;s translations of the same passages (113
              pages), drafting one page per request scored 4 or better on 99% of pages. Drafting eight pages at once
              scored about the same but put English for the wrong passage beside the woodblock 15 times, against once.
            </li>
          </ul>
        </Section>

        <Section id="canons" title="Each canon, and what happens next">
          <StatusBoard n={4} items={rows.map((r) => ({ id: r.id, name: nameOf(r.id, r.corpus), status: STATUS.get(r.id)?.status ?? 'next' }))} />
          <p className="mb-6 text-base text-stone-600">
            Ordered by how much untranslated text each canon holds, weighted by how open its licence is and whether
            open scans of the same edition exist. &ldquo;We hold&rdquo; counts our books for that canon: how many are
            public, and how many can be read in English.
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

        <Section id="library" title="What we already hold">
          <p>
            Pages scanned, transcribed and translated in each tradition, across every edition in our library. The
            Tibetan figure includes the Derge Tengyur and Kangyur imported this month; the Mongolian Kanjur is scans
            only so far. Each square opens a book; each tradition&rsquo;s name opens its shelf.
          </p>
          <TraditionProgress n={5} rows={TRADITIONS} />
        </Section>

        <Section id="quality" title="How good the English is">
          <p className="mb-4">
            We test the English against published human translations of the same passages. Two AI judges score each
            page from 1 to 5 for fidelity without knowing which version is which, and we open the page images to find
            the cause of every low score. These are model-scored samples, not a scholar&rsquo;s review. The full
            write-up is on <a href="/research/quality" className="text-amber-800 underline underline-offset-2">our translation quality page</a>.
          </p>
          <ImprovementChart n={6} rows={IMPROVEMENTS} />
          <ul className="list-disc pl-5 space-y-3 text-base">
            <li>
              <strong>Sanskrit, Pali and classical Chinese.</strong> On 64 pages from 64 books, 58% of the English we
              serve scored 4 or better (mean 3.6). Sanskrit scored lowest: on pages with verse and commentary, the
              English keeps the verse and shortens or drops the commentary. Gemini Flash in place of Flash-Lite raised
              the mean by 0.4 and cut reversed statements from 15 to 6 per 100 pages. Since 4 October 2026 new
              translations in these languages, and in Greek, Hebrew, Arabic and Persian, use Flash; pages already
              served are not yet retranslated. <A href={`${ISSUE_URL}5695`}>#5695</A>
            </li>
            <li>
              <strong>Misreading causes many failures.</strong> Of the 20 worst Sanskrit, Pali and Chinese pages, 6
              failed because the source text was misread, not mistranslated. Correcting those transcriptions by hand
              raised their scores more than a better model did, which is why the typed canons matter.
            </li>
            <li>
              <strong>Transcription accuracy.</strong> Our reading of the Bhutanese Kangyur manuscripts matches the
              Derge e-text on a median 95% of syllables. Our Sanskrit matches <A href={L.gretil}>GRETIL</A> on at
              least 89% of characters, our Pali 95%. Persian manuscripts are not yet readable: the best model matches{' '}
              <A href={L.ganjoor}>Ganjoor</A>&rsquo;s text on a median 70% of characters, short of the 90% we require
              before translating. Printed Persian reads well. <A href={`${ISSUE_URL}5525`}>#5525</A>
            </li>
            <li>
              <strong>What we withdrew.</strong> On some Tibetan manuscript folios an earlier reading model wrote out
              Sanskrit scripture that is not on the page. We took down the English for the{' '}
              <a href="/bhutan-library" className="text-amber-800 underline underline-offset-2">Bhutanese Kangyur manuscripts</a>{' '}
              and are re-reading the affected pages with a model trained on Tibetan script.{' '}
              <A href={`${ISSUE_URL}4523`}>#4523</A>
            </li>
          </ul>
        </Section>

        <Section id="eternity" title="The Eternity reading list">
          <p>
            We are also transcribing and translating the scanned books on the reading list drawn up with Eternity.{' '}
            <strong>
              {SHELF.readable} of {SHELF.listed}
            </strong>{' '}
            can now be read in English on Source Library. The rest wait on a second reading of difficult pages or are
            still being translated. <A href={SHELF.url}>Work log #{SHELF.owner_issue}</A>
          </p>
        </Section>

        <Section id="method" title="Method and caveats">
          <h3 className="font-serif text-xl text-stone-900 mb-3">Tools and models</h3>
          <ul className="list-disc pl-5 space-y-2 text-base mb-8">
            <li>
              <strong>Scans</strong> come from the libraries that hold the books: <A href={L.bdrc}>BDRC</A> for the
              Tibetan and Mongolian canons, the British Library&rsquo;s <A href={L.eap}>Endangered Archives
              Programme</A> for the Bhutanese manuscripts, the <A href={L.ia}>Internet Archive</A>, and{' '}
              <a href="/libraries" className="text-amber-800 underline underline-offset-2">national and university libraries</a>.
            </li>
            <li>
              <strong>Transcription.</strong> Where an open typed edition exists we use it, matched to our scans page
              by page: Esukhia for the Derge Tengyur and Kangyur, CBETA for the Chinese Buddhist canon, Sefaria for
              Hebrew. Otherwise a model reads the page image: Google&rsquo;s Gemini 3 Flash and 3.1 Flash-Lite for most
              scripts; BDRC&rsquo;s Yigdzin for Tibetan manuscripts, <A href={L.kraken}>Kraken</A> for Syriac, and
              PaddleOCR-VL for Chinese brush manuscripts, where each measured better.
            </li>
            <li>
              <strong>English drafts</strong> are written by Gemini 3 Flash or 3.1 Flash-Lite. The Derge Tengyur is
              drafted by Gemini 3 Flash, one page at a time.
            </li>
            <li>
              <strong>Checking.</strong> Claude Opus and Sonnet score samples blind against published translations
              and typed editions, and we read the page images where scores are low.
            </li>
          </ul>

          <h3 className="font-serif text-xl text-stone-900 mb-3">What these numbers leave out</h3>
          <ul className="list-disc pl-5 space-y-3 text-base">
            <li>
              <strong>English coverage is unknown for most canons.</strong> Only 84000, SuttaCentral and Sefaria publish
              a measurable share. SuttaCentral&rsquo;s figure leaves out the Pali Text Society&rsquo;s printed
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

          <h3 className="font-serif text-xl text-stone-900 mt-8 mb-3">Data and related pages</h3>
          <ul className="list-disc pl-5 space-y-2 text-base">
            <li>
              <A href={RESULTS_URL}>Canon results file</A>: every size, licence quote, sample and query behind this page
              (<code className="text-sm">canon-gap-map.mjs</code>, no model calls), and the{' '}
              <A href={STATUS_URL}>status file</A> for where each canon stands (<code className="text-sm">canon-gap-status.mjs</code>).
            </li>
            <li>
              <a href="/research/quality" className="text-amber-800 underline underline-offset-2">Translation quality</a>:
              the full evaluation behind section 6.
            </li>
            <li>
              <a href="/research/translation-gap" className="text-amber-800 underline underline-offset-2">The translation gap</a>{' '}
              and <a href="/research/translation-registry" className="text-amber-800 underline underline-offset-2">translation registry</a>:
              the same question across the whole library.
            </li>
            <li>
              <a href="/research" className="text-amber-800 underline underline-offset-2">All research pages</a>
            </li>
          </ul>
        </Section>
      </div>
    </ContentPageLayout>
  );
}
