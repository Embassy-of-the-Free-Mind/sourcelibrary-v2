import { Metadata } from 'next';
import type { ReactNode } from 'react';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import gapMap from '../../../../scripts/catalog-coverage/results/canon-gap-map-2026-10.json';
import gapStatus from '../../../../scripts/catalog-coverage/results/canon-gap-status-2026-10.json';
import folio from '../../../../scripts/catalog-coverage/results/canon-gap-folio-2026-10.json';
import { READER_UI_STRINGS } from '@/lib/reader-strings';
import { IMPROVEMENTS } from './improvements';
import FolioPipeline, { type CritiqueGate, type FolioSnapshot } from './FolioPipeline';
import { CanonBars, RoutesDiagram, StatusBoard, STATUS_STYLE, TengyurProgress, TraditionProgress, QualityLoop, short, type CanonBar, type TraditionProgressRow } from './diagrams';

// First built for the Eternity Foundation working session (#5513), widened to every open canon
// (#6220): read once, seated, as a table with a short argument. Sizes, licences, English shares and draft costs come from
// canon-gap-map.mjs; where each canon stands comes from canon-gap-status.mjs. Re-run
// those scripts (not this page) when a canon moves.
export const revalidate = false;

export const metadata: Metadata = {
  title: 'The Open Canons — Source Library Research',
  description:
    'Which Buddhist, Hindu, Jewish, Islamic, Chinese, Latin and Greek canons are already typed in openly, how much of each has any English, and what a draft English translation would cost.',
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
  'patrologia-latina': 'Patrologia Latina',
  'camena-poemata': 'CAMENA Neo-Latin poetry',
  'perseus-latin': 'Perseus classical Latin',
  'perseus-greek': 'Perseus classical Greek',
  'first1k-greek': 'First1KGreek',
};
const nameOf = (id: string, fallback: string) => SHORT_NAME[id] ?? fallback;


// The three automated checks in the "one page through the pipeline" figure (#5846). Each rate is
// copied from the issue comment that reports it; "This page" is what changed on vol. 98 fol. 106b,
// read from its revision rows (canon-gap-folio.mjs).
const GATES: [CritiqueGate, CritiqueGate, CritiqueGate] = [
  {
    name: 'Against a human translation',
    result: '6.2 reversed statements per 100 pages by either of two AI judges, 3.4 by both',
    basis: '354 pages that 84000 has also translated, from 8 texts, none of them Madhyamaka or Pramāṇa; two blind Claude Opus judges',
    source: `${ISSUE_URL}5797#issuecomment-5978287405`,
    onThisPage: 'not in that sample: 84000 has published nothing from this section.',
  },
  {
    name: 'False “illegible” marks',
    result: '16,157 pages repaired, with no new model calls',
    basis: 'every drafted page scanned for an “illegible” tag at the page end that only marks where the side breaks off',
    source: `${ISSUE_URL}5797#issuecomment-5978287405`,
    onThisPage: 'the side ends mid-sentence and the draft called the break illegible. Now “…”.',
  },
  {
    name: 'AI specialist review against the Tibetan',
    result: 'on 150 random pages, 75% need only light edits; about 38 per 100 pages have a reversed statement or a wrong speaker or agent (95% CI 23–50)',
    basis: 'a random draw from all 116,703 pages with English; two blind Claude Opus reviewers acting as Tibetologists; rate adjusted for the share of their findings that held up when checked',
    source: `${ISSUE_URL}5829#issuecomment-5982612936`,
    onThisPage: (
      <>
        a Claude reviewer reading the Tibetan removed a fifth item the draft had added to a four-part list (&ldquo;inherit their
        karma&rdquo;) and moved the materialists&rsquo; reason back to its clause. <A href={`${ISSUE_URL}5800`}>#5800</A>
      </>
    ),
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
const pctEnglish = (f: number | null) => (f == null ? 'unknown' : f >= 0.995 ? (f === 1 ? '100%' : '>99%') : `${Math.round(f * 100)}%`);

// Canons with a complete or nearly complete English translation: listed, never priced (#6220).
const ALREADY = gapMap.already_in_english;
const LATIN_BOOKS_ALL = gapStatus.latin_books_all;

const rows = [...gapMap.rows].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
const inTotal = gapMap.rows.filter((r) => !OUT_OF_TOTAL.has(r.id));
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
  latin: '/languages/latin',
  greek: '/languages/greek',
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
  latin: 'latin',
  greek: 'greek',
};
const LANG_NAME: Record<string, string> = {
  tibetan: 'Tibetan', chinese: 'Chinese', pali: 'Pali', sanskrit: 'Sanskrit', hebrew: 'Hebrew', arabic: 'Arabic', persian: 'Persian',
  latin: 'Latin', greek: 'Greek',
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
  ['library', 'What we already hold'],
  ['canons', 'Each canon, and what is next'],
  ['english', 'Canons already in English'],
  ['eternity', 'The Eternity reading list'],
  ['quality', 'How we check quality'],
  ['gap', 'How much is in English'],
  ['cost', 'Why typed text matters'],
  ['tengyur', 'The Derge Tengyur'],
  ['method', 'Method and caveats'],
] as const;

function A({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="text-amber-800 underline decoration-amber-800/30 underline-offset-2 hover:decoration-amber-800">
      {children}
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
          subtitle="The religious and philosophical canons that other projects have already typed in and released openly: how much of each is in English, what a first English draft would cost, and where our work on each stands."
        />
      }
    >
      <div className="max-w-5xl mx-auto font-body text-stone-700 text-lg leading-relaxed">
        <p className="text-sm text-stone-500 mt-8">Figures measured {asOf}.</p>

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

        <Section id="library" title="What we already hold">
          <p>
            Pages scanned, transcribed and translated in each tradition, across every edition in our library. The
            Tibetan figure includes the Derge Tengyur and Kangyur imported this month; the Mongolian Kanjur is scans
            only so far. Each square opens a book; each tradition&rsquo;s name opens its shelf.
          </p>
          <p className="mt-4 text-base text-stone-600">
            Latin is our largest language, about {fmt(LATIN_BOOKS_ALL)} books, so the Latin row counts only the
            books in four of our collections: Hermetica, alchemy, Kabbalah and natural philosophy. Latin books on
            Kabbalah are counted in the Kabbalah row too. The Greek row counts every book in Greek.
          </p>
          <TraditionProgress n={1} rows={TRADITIONS} />
        </Section>

        <Section id="canons" title="Each canon, and what happens next">
          <StatusBoard n={2} items={rows.map((r) => ({ id: r.id, name: nameOf(r.id, r.corpus), status: STATUS.get(r.id)?.status ?? 'next' }))} />
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

        <Section id="english" title="Canons already in English">
          <p className="mb-6">
            These canons have complete or nearly complete English translations, so they are not priced as gaps. The
            share is measured where a catalogue publishes it; the source is linked on each line.
          </p>
          <ul className="divide-y divide-stone-200 border-y border-stone-200 text-base">
            {ALREADY.map((a) => (
              <li key={a.id} className="py-3 md:grid md:grid-cols-[minmax(0,1.6fr)_6rem_minmax(0,2.4fr)] md:gap-4">
                <div>
                  <span className="font-serif text-lg text-stone-900">{a.corpus}</span>
                  <span className="block text-sm text-stone-500">{a.tradition}</span>
                </div>
                <div className="tabular-nums text-stone-900 font-semibold">{pctEnglish(a.english.fraction)}</div>
                <div className="text-sm text-stone-600">
                  {a.english.note} <A href={a.english.source.split(' ')[0]}>source</A>
                </div>
              </li>
            ))}
          </ul>
          <h3 className="font-serif text-xl text-stone-900 mt-10 mb-3">Canons we looked at and left out</h3>
          <ul className="list-disc pl-5 space-y-3 text-base">
            {gapMap.left_out.map((o) => (
              <li key={o.corpus}>
                <strong>{o.corpus}.</strong> {o.reason} <A href={o.source}>source</A>
              </li>
            ))}
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

        <Section id="quality" title="How we check quality">
          <p className="mb-4">
            Our checks compare our work with work done by people. Typed editions check our transcription; published
            translations check our English. Two AI judges score samples without knowing which version is ours, and
            we open the page image behind every low score. No scholar has yet reviewed our English for these canons;
            the first round, on the Tengyur draft, is planned (<A href={`${ISSUE_URL}5800`}>#5800</A>).
          </p>
          <p className="mb-4">
            Canon by canon, with the figures and what we would ask of a scholar:{' '}
            <a href="/research/canon-quality" className="text-amber-800 underline underline-offset-2">How we check each canon</a>.
            The method in full:{' '}
            <a href="/research/quality" className="text-amber-800 underline underline-offset-2">How page quality is measured</a>.
          </p>
          <QualityLoop n={3} adopted={IMPROVEMENTS.filter((r) => r.inUse).length} tested={IMPROVEMENTS.length} issueUrl={ISSUE_URL} resultsHref="/research/canon-quality#changes" />
          <h3 className="font-serif text-xl text-stone-900 mt-10 mb-3">One page through the pipeline</h3>
          <p className="mb-6">
            A single page of the Derge Tengyur, from the woodblock scan to the page a reader sees, through the six
            stages of Eternity&rsquo;s translation pipeline. Click a stage to jump to it.
          </p>
          <FolioPipeline
            folio={folio as unknown as FolioSnapshot}
            tengyur={{
              perVolume: TENGYUR.per_volume as [number, number, number][],
              pagesWithText: TENGYUR.pages_with_text,
              pagesTranslated: TENGYUR.pages_translated,
              usdPerPage: TENGYUR.usd_per_page,
              countedAt: TENGYUR.counted_at,
            }}
            gates={GATES}
            draftLabel={READER_UI_STRINGS.en.info.machineDraftNotice}
          />
        </Section>

        <Section id="gap" title="How much of each canon is in English">
          <p>
            Three catalogues publish how much of their canon has been translated: <A href={L.k84000}>84000</A> for the
            Tibetan canon, <A href={L.suttacentral}>SuttaCentral</A> for the Pali, and <A href={L.sefaria}>Sefaria</A>{' '}
            for the Hebrew. For classical Latin and Greek we count the English translations that Perseus and
            First1KGreek keep beside their texts. Nobody has measured it for the Chinese and Arabic canons or the
            Patrologia Latina, so their draft cost assumes none of it is in English. Click a canon to see its row in{' '}
            <a href="#canons" className="text-amber-800 underline underline-offset-2">the table</a>.
          </p>
          <CanonBars n={4} rows={bars} />
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
            fees. Scholarly review costs far more. With a draft, a reader can search a text and follow its outline,
            but a translator is still needed. Review is cheapest to start on canons that are openly licensed, typed,
            paired with scans, and have little English.
          </p>
          <RoutesDiagram n={5} />
        </Section>

        <Section id="tengyur" title="The first canon: the Derge Tengyur">
          <p>
            The Tengyur is the Tibetan canon of Indian commentaries and treatises. <A href={L.esukhia}>Esukhia&rsquo;s
            typed text</A> is in the public domain, <A href={L.bdrcTengyur}>BDRC holds open scans</A> of the same
            woodblock edition, and less than 1% of it is published in English by <A href={L.k84000}>84000</A>. We
            started there. All 213 volumes are imported, each typed folio is paired with its page image, and every
            page has a draft English translation, public and labelled as not yet reviewed by a scholar.{' '}
            <A href={TENGYUR.url}>Work log #{TENGYUR.owner_issue}</A>
          </p>
          <TengyurProgress
            n={6}
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
              an AI translation not yet reviewed by a scholar.
            </li>
            <li>
              <strong>One page at a time.</strong> Against 84000&rsquo;s translations of the same passages (113
              pages), drafting one page per request scored 4 or better on 99% of pages. Drafting eight pages at once
              scored about the same but put English for the wrong passage beside the woodblock 15 times, against once.
            </li>
          </ul>
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
              a measurable share, and Perseus and First1KGreek keep English beside some of their texts. SuttaCentral&rsquo;s figure leaves out the Pali Text Society&rsquo;s printed
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
              <strong>We quote each licence.</strong> GRETIL&rsquo;s files say they are for reference only,
              so we do not publish their text; we read our own scans of the printed editions instead. Ganjoor and the
              K-Tripitaka state no licence we could find. Sefaria&rsquo;s main Zohar Hebrew text is marked
              &ldquo;unknown&rdquo;.
            </li>
            <li>
              <strong>&ldquo;We hold&rdquo; is a floor.</strong> It counts books matched by title and collection; we
              may hold more.
            </li>
            <li>
              <strong>Latin and Greek.</strong> The Patrologia Latina&rsquo;s size is Corpus Corporum&rsquo;s word
              count converted to characters on a sample of its texts. CAMENA&rsquo;s is its own count of 60,000
              typed pages at our average Latin page length, an estimate. Corpus Corporum allows non-commercial
              reuse and says its texts come from various sources, so each needs checking before we publish it.
              Perseus and First1KGreek count only the English in their own repositories; printed translations such
              as the Loeb volumes are left out, so the English share is understated.
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
