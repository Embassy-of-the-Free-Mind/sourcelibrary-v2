import { Metadata } from 'next';
import type { ReactNode } from 'react';
import { hierarchy, treemap, treemapSquarify } from 'd3-hierarchy';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { experiment } from '@/lib/experiments-index';
import { TENGYUR_QUALITY } from '@/lib/tengyur-quality';
import data from '@/data/tibetan-expert-page.json';
import gapMap from '../../../../scripts/catalog-coverage/results/canon-gap-map-2026-10.json';
import { plainEngineWords } from '@/lib/plain-engine-words';
import { ENGLISH, NO_ENGLISH, Figure, Swatch, TraditionProgress, type TraditionProgressRow } from '../canon-gap/diagrams';

// A briefing for Tibetologists whose feedback we are asking for: what we hold, how the Tibetan
// text and the English are made, what has been measured, real pages that went right and wrong,
// and the questions we would like answered. Static: the census and every quoted excerpt come from
// src/data/tibetan-expert-page.json (scripts/eval/tibetan-expert-page/build-examples.mjs, which
// stops if a quoted passage is no longer in the stored text), the Tengyur section rates from
// src/data/tengyur-section-quality.json, and every other figure from a dated write-up linked
// beside it. Re-measure there, not here. Unlisted (noindex), like /research/canon-quality: it is
// a page we send to people, not a landing page.

export const metadata: Metadata = {
  title: 'Tibetan and Bhutanese Texts: A Briefing for Reviewers | Source Library Research',
  description:
    'What Source Library holds in Tibetan, how the Tibetan text and the English are made, what has been measured so far, pages that went right and wrong, and the questions we would like a Tibetologist to answer.',
  alternates: { canonical: '/research/tibetan' },
  robots: { index: false, follow: true },
};

const ISSUE = 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/';
const exp = (file: string) => experiment(file).href;

const SRC = {
  kangyurOcr: exp('2026-10-01-kangyur-ocr-accuracy-confirmatory-redraw-4523.md'),
  nyingma: exp('2026-10-01-can-the-nyingma-tantra-manuscripts-get-an-accuracy-number-4523.md'),
  terma: exp('2026-10-07-bl-tibetan-terma-biography-printed-reference-4523.md'),
  liteVsYigdzin: exp('2026-10-04-tibetan-lite-vs-yigdzin-4523.md'),
  yigdzinRest: exp('2026-10-14-yigdzin-rest-withheld-and-unread-tibetan-4523.md'),
  correct: exp('2026-10-12-tibetan-yigdzin-correct-vs-redo-6560.md'),
  correctionPass: exp('2026-10-28-tibetan-flash-correct-wave3-7263.md'),
  kangyurEnglish: `${ISSUE}6948`,
  blOther: exp('2026-10-07-bl-tibetan-other-stratum-by-eye-4523.md'),
  blKangyur: exp('2026-10-07-bl-kangyur-chained-retranslation-pilot-4523.md'),
  tengyurRandom: exp('2026-10-04-tengyur-characterize-random-sample-5829.md'),
  tengyurVs84000: exp('2026-10-04-tengyur-stored-draft-vs-84000-5797.md'),
  tengyurCli: exp('2026-10-11-tengyur-cli-nudge-reread-convergent-6361.md'),
  titleLeaves: `${ISSUE}6297`,
  scholar: `${ISSUE}5800`,
  reocr: `${ISSUE}4523`,
};


type Excerpt = { text: string; before: boolean; after: boolean } | null;
type Example = {
  book_id: string;
  title: string;
  page: number;
  image: string;
  tibetan_source: string | null;
  english_model: string | null;
  english_withheld: string | null;
  tibetan: Excerpt;
  english: Excerpt;
};
const EX = data.examples as Record<string, Example>;
const C = data.census;
const TQ = TENGYUR_QUALITY;

const n0 = (x: number) => x.toLocaleString('en-US');
const pct = (a: number, b: number) => `${Math.round((100 * a) / b)}%`;
const fmtDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const readerUrl = (e: Example) => `/book/${e.book_id}?page=${e.page}`;

const MODEL_NAMES: Record<string, string> = {
  'gemini-3-flash-preview': 'the mid-tier model',
  'gemini-3.8-flash-low': 'the current reading model',
};

const CONTENTS = [
  ['why', 'Why we are writing to you'],
  ['holdings', 'What we hold'],
  ['pipeline', 'How a page is made'],
  ['reading', 'The Tibetan text'],
  ['english', 'The English'],
  ['checked', 'Volume by volume: what has been checked'],
  ['material', 'By kind of text'],
  ['errors', 'What goes wrong: specimens'],
  ['human', 'Beside a scholars’ translation'],
  ['unknown', 'What we have not measured'],
  ['needed', 'What is needed'],
] as const;

// Plain-language meanings for a reader new to the project, to OCR, or to the Tibetan canon.
const GLOSSARY: [string, ReactNode][] = [
  ['Transcription (OCR)', 'Turning a photographed page into typed text. OCR, optical character recognition, is the machine version.'],
  ['E-text', 'A typed text of a work made by people, here the Esukhia digital Derge Kangyur and Tengyur, proofread and in the public domain.'],
  ['Kangyur / Tengyur', 'The two parts of the Tibetan Buddhist canon: the words attributed to the Buddha, and the Indian treatises and commentaries.'],
  ['Derge', 'The eighteenth-century woodblock edition of the canon that scholars usually cite. We use its e-text as the answer key.'],
  ['Kanjur volume (manuscript)', 'A handwritten copy of a Kangyur volume. A Bhutanese temple’s copy is a different witness of the same text, with its own variants.'],
  ['Pecha, leaf, folio', 'Pecha are loose, long, narrow sheets. One sheet is a leaf or folio; an archive photograph often shows two or more.'],
  ['dbu can / dbu med', 'The headed, formal Tibetan script and the headless, cursive one. Cursive is harder to read, for people and machines.'],
  ['Tsheg, shad', 'The dot between Tibetan syllables (་) and the vertical stroke ending a phrase (།).'],
  ['Syllable identity', 'The share of syllables in our reading that line up with the reference text. 0.95 means about 95 in 100 line up.'],
  ['BDRC Tibetan model', 'An open-source Tibetan OCR model released by the Buddhist Digital Resource Center (BDRC). We run it on our own machines.'],
  ['General-purpose AI models', 'Large AI models trained on text of every kind. One writes our English; another is used as a reviewer.'],
  ['AI reviewer', 'An AI model asked to read our page against the image and the Tibetan and list every error it finds. Not a person.'],
  ['84000', 'A project publishing English translations of the canon by scholars. Where it has translated a passage, we compare our English with theirs.'],
  ['EAP', 'The British Library’s Endangered Archives Programme, which photographed the Bhutanese collections.'],
  ['Per 100 pages', 'How many errors of a kind were found for every 100 pages read. A rate above 100 means more than one per page on average.'],
];

/* ---------- small pieces ---------- */

function A({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="text-amber-800 underline underline-offset-2 hover:text-amber-900">
      {children}
    </a>
  );
}

/** A source link after a figure. */
function S({ href, label = 'source' }: { href: string; label?: string }) {
  return (
    <>
      {' '}
      <a href={href} className="text-sm text-amber-800 underline underline-offset-2 whitespace-nowrap">
        ({label})
      </a>
    </>
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
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function H3({ children }: { children: ReactNode }) {
  return <h3 className="font-serif text-xl text-stone-900 pt-6">{children}</h3>;
}

const KIND_STYLE = {
  works: { label: 'Works', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  error: { label: 'Error', cls: 'bg-rose-50 text-rose-800 border-rose-200' },
  judge: { label: 'Open question', cls: 'bg-amber-50 text-amber-900 border-amber-200' },
  withheld: { label: 'Withheld', cls: 'bg-stone-100 text-stone-700 border-stone-300' },
} as const;

function Clip({ e, lang }: { e: Excerpt; lang: 'bo' | 'en' }) {
  if (!e) return null;
  const text = `${e.before ? '… ' : ''}${e.text}${e.after ? ' …' : ''}`;
  return lang === 'bo' ? (
    <p lang="bo" className="text-xl leading-loose text-stone-900 break-words">
      {text}
    </p>
  ) : (
    <p className="font-body text-base leading-relaxed text-stone-800">{text}</p>
  );
}

function ExampleCard({
  id,
  kind,
  heading,
  children,
}: {
  id: string;
  kind: keyof typeof KIND_STYLE;
  heading: string;
  children: ReactNode;
}) {
  const e = EX[id];
  const k = KIND_STYLE[kind];
  return (
    <figure id={`ex-${id}`} className="scroll-mt-24 rounded-sm border border-stone-200 bg-white my-8 overflow-hidden">
      <a href={readerUrl(e)} className="block bg-stone-900">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={e.image}
          alt={`Page ${e.page} of ${e.title}, as photographed`}
          loading="lazy"
          className="w-full max-h-[26rem] object-contain mx-auto"
        />
      </a>
      <div className="px-4 py-5 md:px-6 md:py-6 space-y-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
          <span className={`text-[11px] uppercase tracking-wider font-semibold border rounded-sm px-2 py-0.5 ${k.cls}`}>
            {k.label}
          </span>
          <figcaption className="font-serif text-lg text-stone-900">{heading}</figcaption>
        </div>
        <div className="text-sm text-stone-500">
          <A href={readerUrl(e)}>
            {e.title}, page {e.page}
          </A>
          {' · '}Tibetan: {e.tibetan_source && plainEngineWords(e.tibetan_source)}
          {e.english_model ? ` · English: ${MODEL_NAMES[e.english_model] ?? plainEngineWords(e.english_model)}` : ''}
        </div>
        {(e.tibetan || e.english) && (
          <div className="grid md:grid-cols-2 gap-4 md:gap-6 border-t border-stone-100 pt-4">
            {e.tibetan && (
              <div>
                <div className="font-body text-[11px] uppercase tracking-wider text-stone-500 mb-1">Tibetan, as stored</div>
                <Clip e={e.tibetan} lang="bo" />
              </div>
            )}
            {e.english && (
              <div>
                <div className="font-body text-[11px] uppercase tracking-wider text-stone-500 mb-1">English, as served</div>
                <Clip e={e.english} lang="en" />
              </div>
            )}
          </div>
        )}
        <div className="font-body text-base text-stone-700 leading-relaxed border-t border-stone-100 pt-4 space-y-2">
          {children}
        </div>
      </div>
    </figure>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="border-l-2 border-amber-600 pl-3">
      <div className="font-serif text-2xl text-stone-900 tabular-nums">{value}</div>
      <div className="font-body text-sm text-stone-600 leading-snug">{label}</div>
    </div>
  );
}

/* ---------- done and remaining ---------- */

type GroupCensus = {
  books: number;
  pages: number;
  tibetan: number;
  english: number;
  reader_by_model: Record<string, number>;
  english_by_model: Record<string, number>;
  book_pages: TraditionProgressRow['book_pages'];
};

function progressRow(id: string, name: string, g: GroupCensus, href?: string): TraditionProgressRow {
  return {
    id,
    name,
    books: g.books,
    readable_books: g.book_pages.filter((b) => b[5] > 0).length,
    pages_scanned: g.pages,
    pages_transcribed: g.tibetan,
    pages_translated: g.english,
    canon_page_equivalents: 0,
    ocr_engines: Object.entries(g.reader_by_model),
    translation_models: Object.entries(g.english_by_model),
    book_pages: g.book_pages,
    href,
  };
}

const PROGRESS: TraditionProgressRow[] = [
  progressRow('bhutan', 'Manuscripts from Bhutan', C.bl as unknown as GroupCensus, '/collections/bhutan'),
  progressRow('tengyur', 'Derge Tengyur', C.tengyur as unknown as GroupCensus),
  progressRow('kangyur', 'Derge Kangyur', C.kangyur as unknown as GroupCensus),
  progressRow('other', 'Other Tibetan volumes', C.other as unknown as GroupCensus),
];

// How much of the canon anyone has put into English: 84000's published share, page-weighted, from
// the canon gap map (/research/canon-gap), which reads the 84000 Reading Room catalogue.
const CANON_ENGLISH = (['derge-kangyur', 'derge-tengyur'] as const).map((id) => {
  const r = gapMap.rows.find((x) => x.id === id);
  if (!r || r.english.fraction == null) throw new Error(`canon gap map has no English share for ${id}`);
  return { id, name: id === 'derge-kangyur' ? 'Kangyur' : 'Tengyur', fraction: r.english.fraction, chars: r.size.base_chars as number };
});
const GAP_ASOF = fmtDate(gapMap.generated_at.slice(0, 10));

function CanonEnglishBars({ n }: { n: number }) {
  const max = Math.max(...CANON_ENGLISH.map((c) => c.chars));
  return (
    <Figure
      n={n}
      title="How much of the canon has a published English translation"
      caption={
        <>
          Share of each canon, by pages, that 84000 lists as published in English, from the 84000 Reading Room
          catalogue as read on {GAP_ASOF}. Bar length is the size of the typed Tibetan text, so the two bars compare
          directly: the Tengyur is about twice the Kangyur. Translations 84000 lists as in progress are not
          counted. Source: <A href="/research/canon-gap">The Open Canons</A>.
        </>
      }
    >
      <div className="font-body text-xs text-stone-600 mb-4">
        <Swatch style={{ backgroundColor: ENGLISH }} label="published English (84000)" />
        <Swatch style={{ backgroundColor: NO_ENGLISH }} label="no published English" />
      </div>
      <div className="space-y-3">
        {CANON_ENGLISH.map((c) => (
          <div key={c.id} className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3 items-center">
            <div className="font-serif text-lg text-stone-900">{c.name}</div>
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex h-5 rounded-r overflow-hidden" style={{ width: `${(c.chars / max) * 100}%` }}>
                <div style={{ width: `max(${c.fraction * 100}%, 2px)`, backgroundColor: ENGLISH }} />
                <div className="flex-1" style={{ backgroundColor: NO_ENGLISH }} />
              </div>
              <span className="font-body text-sm text-stone-700 whitespace-nowrap tabular-nums">
                {c.fraction < 0.01 ? (c.fraction * 100).toFixed(1) : Math.round(c.fraction * 100)}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </Figure>
  );
}

/* ---------- book-level checks ---------- */

// The latest check of each public volume, from `book_checks`: [verdict, date, pages read, method].
type Verdict = 'show' | 'caveat' | 'fix';
const CHECKS = data.checks as unknown as {
  rows: number;
  by_people: number;
  first: string;
  last: string;
  latest: Record<string, [Verdict, string, number, string]>;
};
const HIDDEN = data.hidden as { books: number; pages: number; transcribed: number; translated: number };

const VERDICT: Record<Verdict | 'none', { label: string; color: string }> = {
  show: { label: 'no serious error on the pages read', color: '#059669' },
  caveat: { label: 'errors noted on the pages read', color: '#d97706' },
  fix: { label: 'a serious defect on the pages read', color: '#e11d48' },
  none: { label: 'not yet checked', color: '#e7e5e4' },
};

type BookRow = TraditionProgressRow['book_pages'][number];
const volNo = (b: BookRow) => Number(/vol\. (\d+)\)/.exec(b[1])?.[1] ?? 0);
const byVolume = (rows: BookRow[]) => [...rows].sort((a, b) => volNo(a) - volNo(b));
const byTitle = (rows: BookRow[]) => [...rows].sort((a, b) => a[1].localeCompare(b[1]));
const sum = (rows: BookRow[], i: 3 | 4 | 5) => rows.reduce((t, b) => t + b[i], 0);

const BL_BOOKS = (C.bl as unknown as GroupCensus).book_pages;
const TSHAMDRAK_TANTRAS = BL_BOOKS.filter((b) => /Tshamdrak rNying rgyud/.test(b[1]));
const DRAMETSE_TANTRAS = BL_BOOKS.filter((b) => /rNying ma rgyud .bum/.test(b[1]));
const TANTRA_IDS = new Set([...TSHAMDRAK_TANTRAS, ...DRAMETSE_TANTRAS].map((b) => b[0]));

const CHECK_GROUPS: { name: string; rows: BookRow[] }[] = [
  { name: 'Derge Tengyur, by volume', rows: byVolume((C.tengyur as unknown as GroupCensus).book_pages) },
  { name: 'Derge Kangyur, by volume', rows: byVolume((C.kangyur as unknown as GroupCensus).book_pages) },
  { name: 'Nyingma tantras, Tshamdrak', rows: byTitle(TSHAMDRAK_TANTRAS) },
  { name: 'Nyingma tantras, Drametse', rows: byTitle(DRAMETSE_TANTRAS) },
  { name: 'Other manuscripts from Bhutan', rows: byTitle(BL_BOOKS.filter((b) => !TANTRA_IDS.has(b[0]))) },
  { name: 'Other Tibetan volumes', rows: byTitle((C.other as unknown as GroupCensus).book_pages) },
];
const tally = (rows: BookRow[]) => {
  const t = { show: 0, caveat: 0, fix: 0, none: 0 };
  for (const b of rows) t[CHECKS.latest[b[0]]?.[0] ?? 'none'] += 1;
  return t;
};
const ALL_ROWS = CHECK_GROUPS.flatMap((g) => g.rows);
const TOTAL = tally(ALL_ROWS);
const CHECKED = TOTAL.show + TOTAL.caveat + TOTAL.fix;

function VerdictMap({ n }: { n: number }) {
  return (
    <Figure
      n={n}
      title="Every public volume, by its latest check"
      caption={
        <>
          One square is one volume and opens it in the reader. A check is an AI reviewer reading between 1 and 10 pages
          of the volume against the page images, so a square describes the pages read, not the whole volume. Some of
          the volumes checked were drawn at random and some were chosen because something had been reported, so the
          colours are not a rate for the shelf. {n0(CHECKS.rows)} checks between {fmtDate(CHECKS.first)} and{' '}
          {fmtDate(CHECKS.last)}; {CHECKS.by_people === 0 ? 'none' : n0(CHECKS.by_people)} by a person. Read from our
          database on {fmtDate(data.measured)}.
        </>
      }
    >
      <div className="font-body text-xs text-stone-600 mb-5 leading-relaxed">
        {(['show', 'caveat', 'fix', 'none'] as const).map((v) => (
          <Swatch key={v} style={{ backgroundColor: VERDICT[v].color }} label={`${VERDICT[v].label} (${n0(TOTAL[v])})`} />
        ))}
      </div>
      <div className="space-y-5">
        {CHECK_GROUPS.map((g) => {
          const t = tally(g.rows);
          return (
            <div key={g.name}>
              <div className="font-body text-sm text-stone-700 mb-1.5">
                <span className="font-semibold text-stone-900">{g.name}</span>{' '}
                <span className="tabular-nums text-stone-500">
                  {n0(g.rows.length)} volumes, {n0(t.show + t.caveat + t.fix)} checked
                </span>
              </div>
              <div className="flex flex-wrap gap-[3px]">
                {g.rows.map((b) => {
                  const c = CHECKS.latest[b[0]];
                  const v = c?.[0] ?? 'none';
                  const what = c ? `${VERDICT[v].label}, ${c[2]} ${c[2] === 1 ? 'page' : 'pages'} read, ${fmtDate(c[1])}` : VERDICT.none.label;
                  return (
                    <a
                      key={b[0]}
                      href={`/book/${b[0]}`}
                      title={`${b[1]}: ${what}`}
                      aria-label={`${b[1]}: ${what}`}
                      className="block w-2.5 h-2.5 rounded-[1px] hover:outline hover:outline-2 hover:outline-stone-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-stone-900"
                      style={{ backgroundColor: VERDICT[v].color }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </Figure>
  );
}

/* ---------- by material ---------- */

// The shelf sorted by what the volumes contain. Derge volumes carry their section in the title
// ("བསྟན་འགྱུར། སྡེ་དགེ། ཚད་མ། ཅེ"); the Bhutanese manuscripts are sorted by title words, the same
// rules as scripts/eval/tibetan-bl-evidence/strata.mjs. Counts come from the census in the JSON.
const DERGE_SECTION: Record<string, string> = {
  'འདུལ་བ': 'Vinaya',
  'འབུམ': 'Prajñāpāramitā',
  'ཉི་ཁྲི': 'Prajñāpāramitā',
  'ཁྲི་བརྒྱད': 'Prajñāpāramitā',
  'ཁྲི་པ': 'Prajñāpāramitā',
  'བརྒྱད་སྟོང་པ': 'Prajñāpāramitā',
  'ཤེས་རབ་སྣ་ཚོགས': 'Prajñāpāramitā',
  'ཤེར་ཕྱིན': 'Prajñāpāramitā',
  'ཕལ་ཆེན': 'Avataṃsaka',
  'དཀོན་བརྩེགས': 'Ratnakūṭa',
  'མདོ་སྡེ': 'Sūtra',
  'རྒྱུད་འབུམ': 'Tantra',
  'རྙིང་རྒྱུད': 'Old tantras',
  'དྲི་མེད་འོད': 'Vimalaprabhā',
  'གཟུངས་འདུས': 'Dhāraṇī',
  'བསྟོད་ཚོགས': 'Hymns',
  'རྒྱུད་འགྲེལ': 'Tantra commentary',
  'དབུ་མ': 'Madhyamaka',
  'སེམས་ཙམ': 'Cittamātra',
  'མངོན་པ': 'Abhidharma',
  'སྐྱེས་རབས': 'Jātaka',
  'འཁྲི་ཤིང': 'Kalpalatā',
  'ཚད་མ': 'Pramāṇa',
  'སྒྲ་མདོ': 'Grammar',
  'སྣ་ཚོགས': 'Miscellaneous',
  'གསོ་རིག': 'Medicine',
  'སྤྲིང་ཡིག': 'Letters',
  'དཀར་ཆག': 'Catalogue',
};
const dergeSection = (b: BookRow, canon: string) => {
  const bo = /། སྡེ་དགེ། ([^། (]+)/.exec(b[1])?.[1] ?? '';
  const en = DERGE_SECTION[bo];
  if (!en) return 'Other';
  return canon === 'Tengyur' && en === 'Sūtra' ? 'Sūtra commentary' : en;
};
// The first three rules are strata.mjs's, widened; the rest sort what it left as "other". A title is
// a cataloguer's short label and a volume often holds several texts, so this is a first sorting for
// a reader to correct, not a classification. First matching rule wins.
const MS_KINDS: [string, RegExp][] = [
  ['Nyingma tantras', /rnying ?(ma'?i? )?rgyud|tsham ?drak|mtshams ?brag|rnying ma rgyud 'bum|rgyud bcu bdun/i],
  ['Kangyur manuscripts', /kanjur|kangyur|bka'? ?'?gyur|brgyad stong|khri brgyad|nyi khri|rdo rje gcod pa|gser 'od dam pa|mtshan lnga stong|^'?bum [a-z']{1,4}$|mdo mang|gzungs? ?'?(bsdus|'dus)/i],
  ['Sūtras and dhāraṇīs, single texts', /\bmdo\b|gzungs|za ma tog|so sor 'brang|rma bya chen mo|bshags pa/i],
  ['Treasure cycles and biographies', /ma ?ni bka['’‘]? ?['’‘]?bum/i],
  ['Collected works', /bka['’‘]? ?['’‘]?bum|gsung ['’‘]?bum|bka['’‘]? ['’‘]?thor/i],
  ['Great Perfection', /rdzogs (pa )?chen|snying ?thig|snying tig|yang (thig|tig)|klong (gsal|chen|grol|sde)|ngal gso|mkha' 'gro (snying|yang)|bi ma|ye shes bla ma|khregs chod|thod rgal/i],
  ['Treasure cycles and biographies', /kun bzang dgongs|bka['’‘]? ?thang|thang yig|mi la|ras chung|mgur ['’‘]?bum|bzhad pa rdo rje|dgongs ['’‘]?dus|dgongs pa 'dus|zhi khro|bar do|thos grol|kar gling|rnam ?['’‘]?thar|rnam par thar|skyes rabs|gter (ma|byon|chos|mdzod|gsar)|gling pa|rgod (kyi )?ldem|rgdo ldem|byang[- ]gter|thugs sgrub|thugs thig|bla ma nor bu rgya mtsho|dag snang|lung bstan|bka['’‘]? brgyad/i],
  ['Epic, song and poetics', /ge sar|g\.yul 'gyed|snyan ngag|glu'i phreng|rdo rje glu|mgur/i],
  ['Medicine and astrology', /\bsman\b|gso (ba )?(rig|dpyad)|rgyud bzhi|rtsis/i],
  ['History, lineage and catalogues', /gser '?phreng|lo rgyus|chos 'byung|gnas (bshad|yig)|dkar chag|rgyal rabs|gdung rabs|bstan rtsis|thob yig|gsan yig/i],
  ['Instructions', /khrid|zhal gdams|gdams (ngag|pa)|man ngag|snyan brgyud|phyag (rgya )?chen|do ha|lam rim|blo sbyong|gcod|zhi byed|nyams len/i],
  ['Ritual and practice', /sgrub (thabs|skor|pa|rim)|cho ga|\bchog\b|las byang|gtor|dbang (chog|bskur|gi|skor)|mchod|gsol ('debs|kha)|srung|bskang|skangs|sbyin sreg|rab gnas|bsnyen|phrin las|smon lam|bsangs?\b|sngon 'gro|tshogs|sku rim|\bmdos\b|bzlog|phur (pa|ba)|rta mgrin|phag mo|mgon po|bde mchog|dus ['’‘]?khor|sgrol ma|tshe (sgrub|dbang)|mkha' spyod|drag po|rnal ['’‘]?byor|skyabs ['’‘]?gro/i],
  ['Philosophy and commentary', /'grel|bstan bcos|mdzod|rgyud bla|spyod 'jug|dbu ma|tshad ma|mngon (pa|rtogs)|legs bshad|bshad|theg (pa|gsum)|sdom gsum|grub mtha'|sa lam|dgag lan/i],
  ['Miscellanies', /thor ?bu|sna tshogs?|be'u bum/i],
];
const msKind = (b: BookRow) => MS_KINDS.find(([, re]) => re.test(b[1]))?.[0] ?? 'Not yet sorted';

type Tile = { group: string; label: string; vols: number; pages: number; english: number; checked: number };
function tiles(group: string, rows: BookRow[], labelOf: (b: BookRow) => string): Tile[] {
  const m = new Map<string, Tile>();
  for (const b of rows) {
    const label = labelOf(b);
    const t = m.get(label) ?? { group, label, vols: 0, pages: 0, english: 0, checked: 0 };
    t.vols += 1;
    t.pages += b[3];
    t.english += b[5];
    if (CHECKS.latest[b[0]]) t.checked += 1;
    m.set(label, t);
  }
  return [...m.values()].sort((a, b) => b.pages - a.pages);
}
const MATERIAL: { group: string; tiles: Tile[] }[] = [
  { group: 'Manuscripts from Bhutan', tiles: tiles('Manuscripts from Bhutan', BL_BOOKS, msKind) },
  { group: 'Derge Tengyur', tiles: tiles('Derge Tengyur', (C.tengyur as unknown as GroupCensus).book_pages, (b) => dergeSection(b, 'Tengyur')) },
  { group: 'Derge Kangyur', tiles: tiles('Derge Kangyur', (C.kangyur as unknown as GroupCensus).book_pages, (b) => dergeSection(b, 'Kangyur')) },
];
const UNSORTED = MATERIAL[0].tiles.find((t) => t.label === 'Not yet sorted');

const TM_W = 1000;
const TM_H = 620;
const TREEMAP = treemap<{ name: string; tile?: Tile; children?: unknown[] }>()
  .tile(treemapSquarify)
  .size([TM_W, TM_H])
  .paddingOuter(4)
  .paddingTop(26)
  .paddingInner(2)
  .round(true)(
  hierarchy<{ name: string; tile?: Tile; children?: unknown[] }>(
    { name: 'shelf', children: MATERIAL.map((g) => ({ name: g.group, children: g.tiles.map((t) => ({ name: t.label, tile: t })) })) },
    (d) => d.children as { name: string; tile?: Tile; children?: unknown[] }[] | undefined,
  ).sum((d) => d.tile?.pages ?? 0),
);

function MaterialMap({ n }: { n: number }) {
  return (
    <Figure
      n={n}
      title="The public shelf by what the volumes contain"
      caption={
        <>
          Each rectangle is one kind of text, sized by its pages; the darker it is, the larger the share of its pages
          that have English. Derge volumes are sorted by the section named in their titles. The Bhutanese manuscripts
          are sorted by words in their catalogue titles: a volume that holds several texts is counted once, under the
          first kind its title matches, and {UNSORTED ? n0(UNSORTED.vols) : 0} volumes match none. That sorting is
          ours and rough, and a reader of Tibetan will find volumes in the wrong place. Read from our database on {fmtDate(data.measured)}. The same figures are in the table below.
        </>
      }
    >
      <div className="font-body text-xs text-stone-600 mb-4 leading-relaxed">
        <Swatch style={{ backgroundColor: '#e7e5e4' }} label="no English" />
        <Swatch style={{ backgroundColor: `color-mix(in srgb, ${ENGLISH} 50%, #e7e5e4)` }} label="half in English" />
        <Swatch style={{ backgroundColor: ENGLISH }} label="all in English" />
      </div>
      <svg viewBox={`0 0 ${TM_W} ${TM_H}`} className="w-full h-auto" role="img" aria-label="Treemap of the public Tibetan shelf by kind of text. The table below gives the same figures.">
        {(TREEMAP.children ?? []).map((g) => (
          <g key={g.data.name}>
            <rect x={g.x0} y={g.y0} width={g.x1 - g.x0} height={g.y1 - g.y0} fill="#fafaf9" stroke="#d6d3d1" />
            <text x={g.x0 + 8} y={g.y0 + 18} fontSize={15} fontWeight={600} fill="#1c1917" className="font-body">
              {g.data.name}
            </text>
            {(g.children ?? []).map((leaf) => {
              const t = leaf.data.tile as Tile;
              const share = t.pages ? t.english / t.pages : 0;
              const w = leaf.x1 - leaf.x0;
              const h = leaf.y1 - leaf.y0;
              const ink = share > 0.55 ? '#ffffff' : '#1c1917';
              return (
                <g key={t.label}>
                  <title>{`${t.group}, ${t.label}: ${n0(t.vols)} ${t.vols === 1 ? 'volume' : 'volumes'}, ${n0(t.pages)} pages, ${pct(t.english, t.pages)} with English, ${n0(t.checked)} checked`}</title>
                  <rect x={leaf.x0} y={leaf.y0} width={w} height={h} style={{ fill: `color-mix(in srgb, ${ENGLISH} ${Math.round(share * 100)}%, #e7e5e4)` }} />
                  {w > 84 && h > 22 && (
                    <text x={leaf.x0 + 6} y={leaf.y0 + 16} fontSize={12.5} fill={ink} className="font-body">
                      {t.label.length * 6.6 > w - 10 ? `${t.label.slice(0, Math.max(3, Math.floor((w - 16) / 6.6)))}…` : t.label}
                    </text>
                  )}
                  {w > 84 && h > 40 && (
                    <text x={leaf.x0 + 6} y={leaf.y0 + 32} fontSize={11.5} fill={ink} opacity={0.85} className="font-body">
                      {n0(t.pages)} pp · {pct(t.english, t.pages)}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        ))}
      </svg>
      <div className="overflow-x-auto mt-6">
        <table className="w-full font-body text-sm text-left border-collapse">
          <thead>
            <tr className="border-b border-stone-300 text-stone-500 text-xs uppercase tracking-wider">
              <th className="py-2 pr-4 font-semibold">Kind of text</th>
              <th className="py-2 pr-4 font-semibold text-right">Volumes</th>
              <th className="py-2 pr-4 font-semibold text-right">Pages</th>
              <th className="py-2 pr-4 font-semibold text-right">With English</th>
              <th className="py-2 font-semibold text-right">Volumes checked</th>
            </tr>
          </thead>
          {MATERIAL.map((g) => (
            <tbody key={g.group}>
              <tr>
                <th colSpan={5} className="pt-4 pb-1 font-serif text-base text-stone-900 font-normal">
                  {g.group}
                </th>
              </tr>
              {g.tiles.map((t) => (
                <tr key={t.label} className="border-b border-stone-100 text-stone-800">
                  <td className="py-1.5 pr-4">{t.label}</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">{n0(t.vols)}</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">{n0(t.pages)}</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">{pct(t.english, t.pages)}</td>
                  <td className="py-1.5 text-right tabular-nums">{n0(t.checked)}</td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </Figure>
  );
}

/* ---------- specimens of error ---------- */

type Specimen = { book_id: string; title: string; page: number; severity: 'misleads' | 'wrong_text'; quote: string; what: string };
type ErrorKind = { code: string; name: string; cosmetic: number; misleads: number; wrong_text: number; pages: number; specimens: Specimen[] };
const ZOO = data.zoo as unknown as {
  judged_pages: number;
  judged_books: number;
  first: string;
  last: string;
  other_defects: number;
  kinds: ErrorKind[];
};
const HUMAN = data.human as { toh: string; title: string; published: string; sides: number; vol: number; book_id: string; page: number; folio: string; url: string }[];
const SEVERITY = {
  wrong_text: { label: 'Wrong text', cls: 'bg-rose-50 text-rose-800 border-rose-200' },
  misleads: { label: 'Misleading', cls: 'bg-amber-50 text-amber-900 border-amber-200' },
} as const;
const ZOO_TOTAL = ZOO.kinds.reduce((t, k) => ({ wrong_text: t.wrong_text + k.wrong_text, misleads: t.misleads + k.misleads, cosmetic: t.cosmetic + k.cosmetic }), { wrong_text: 0, misleads: 0, cosmetic: 0 });

function ErrorZoo() {
  return (
    <div className="space-y-10 pt-2">
      {ZOO.kinds.map((k) => (
        <div key={k.code} id={`kind-${k.code}`} className="scroll-mt-24">
          <h3 className="font-serif text-xl text-stone-900">{k.name}</h3>
          <div className="font-body text-sm text-stone-500 tabular-nums mt-1">
            {n0(k.wrong_text)} wrong text, {n0(k.misleads)} misleading, {n0(k.cosmetic)} cosmetic, on {n0(k.pages)}{' '}
            {k.pages === 1 ? 'page' : 'pages'}
          </div>
          {k.specimens.length === 0 ? (
            <p className="font-body text-sm text-stone-500 mt-3">No specimen can be shown: the passages concerned have since been corrected or withheld.</p>
          ) : (
            <div className="grid md:grid-cols-3 gap-3 mt-3">
              {k.specimens.map((s) => (
                <a
                  key={`${s.book_id}-${s.page}-${s.quote.slice(0, 12)}`}
                  href={`/book/${s.book_id}?page=${s.page}`}
                  className="block rounded-sm border border-stone-200 bg-white p-4 hover:border-stone-400 transition-colors"
                >
                  <span className={`text-[11px] uppercase tracking-wider font-semibold border rounded-sm px-2 py-0.5 ${SEVERITY[s.severity].cls}`}>
                    {SEVERITY[s.severity].label}
                  </span>
                  <p lang="bo" className="text-lg leading-loose text-stone-900 break-words mt-3">
                    {s.quote}
                  </p>
                  <p className="font-body text-sm leading-relaxed text-stone-700 mt-2">{s.what}</p>
                  <p className="font-body text-xs text-stone-500 mt-3">
                    {s.title}, page {s.page}
                  </p>
                </a>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ---------- tables ---------- */

const BL_COLLECTIONS: [string, number, string, string][] = [
  // [collection, books in the frame, serious pages, show / caveat / don't], from SRC.blOther
  ['Ogyen Choling', 411, '6%', '0 / 4 / 0'],
  ['Gangtey', 243, '19%', '0 / 4 / 0'],
  ['Drametse', 207, '0%', '1 / 3 / 0'],
  ['Tshamdrak', 55, '19%', '0 / 4 / 0'],
  ['Thadrak', 27, '13%', '0 / 4 / 0'],
  ['Neyphug', 26, '13%', '0 / 4 / 0'],
  ['Phurdrup', 24, '13%', '2 / 2 / 0'],
];

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto -mx-4 px-4">
      <table className="w-full text-sm font-body border-collapse min-w-[32rem]">
        <thead>
          <tr className="border-b border-stone-300 text-left text-stone-500">
            {head.map((h) => (
              <th key={h} className="py-2 pr-4 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-stone-100">
              {r.map((c, j) => (
                <td key={j} className={`py-2 pr-4 ${j > 0 ? 'tabular-nums' : ''}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TengyurSectionTable() {
  const rows = Object.entries(TQ.sections)
    .filter(([, s]) => s.rated)
    .sort((a, b) => b[1].corpus_pages - a[1].corpus_pages)
    .map(([name, s]) => [
      name + (name === 'Pramāṇa' || name === 'Madhyamaka' ? ' *' : ''),
      n0(s.corpus_pages),
      String(s.n),
      `${Math.round(s.light ?? 0)}%`,
      String(Math.round(s.rev_agent_per100 ?? 0)),
      String(Math.round(s.term_per100 ?? 0)),
    ]);
  return (
    <Table
      head={['Section', 'Pages', 'Read', 'Light edits only', 'Reversed or wrong speaker, per 100 pages', 'Wrong term, per 100 pages']}
      rows={rows}
    />
  );
}

/* ---------- page ---------- */

export default function TibetanBriefingPage() {
  const bl = C.bl;
  const tg = C.tengyur;
  const other = C.other;
  const kg = C.kangyur;
  const corrected = (bl.reader_by_model as Record<string, number>)['gemini-3.8-flash-low'] ?? 0;
  const blNoEnglish = bl.tibetan - bl.english;
  const sample = TQ.sample;
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Tibetan and Bhutanese Texts"
          subtitle="An introduction for reviewers: what we hold, how we read and translate it, what we have measured, pages that went right and wrong, and what is still needed."
          image={EX['two-leaves'].image}
          imageAlt="Two leaves of the Neyphug Kanjur, a Bhutanese manuscript copy of the canon, photographed together by the British Library's Endangered Archives Programme"
          backHref="/research"
          backLabel="Research"
        />
      }
    >
      <div className="max-w-4xl mx-auto font-body text-stone-700 text-lg leading-relaxed">
        <p className="text-sm text-stone-500 mt-8">
          Prepared October 2026. The counts and the checks were read from our database on {fmtDate(data.measured)}. Every other
          figure is copied from a dated write-up of a measurement and links to it. About fifteen minutes to read.
        </p>

        <div className="mt-8 rounded-sm border border-stone-200 bg-white px-5 py-5 md:px-6">
          <div className="font-body text-xs tracking-[0.16em] uppercase text-amber-700 font-semibold mb-3">In brief</div>
          <ul className="list-disc pl-5 space-y-2 text-base">
            <li>
              {n0(bl.books)} handwritten volumes from Bhutanese temples, and the Derge canon: {n0(tg.books)} volumes
              of the Tengyur and {n0(kg.books)} of the Kangyur. Each is shown as scans, Tibetan text and English, page
              by page.
            </li>
            <li>
              On manuscript copies of the canon, our machine reading of the Tibetan agrees with the Derge text on
              about 95 syllables in 100. About 1 page in 20 is missing a line.
            </li>
            <li>
              On the Tengyur, AI reviewers judged three pages in four to need only light edits to the English. The
              commonest serious error is a reversed statement or a statement given to the wrong speaker.
            </li>
            <li>
              Most of the Bhutanese manuscripts have no printed counterpart, so they cannot be scored against one.
              Read by AI reviewers, about 1 page in 11 has a serious error, mostly in the English.
            </li>
            <li>
              {n0(CHECKED)} of the {n0(ALL_ROWS.length)} public volumes have had a few pages checked against the
              image by an AI reviewer: no serious error on the pages read in {n0(TOTAL.show)}, errors noted in{' '}
              {n0(TOTAL.caveat)}, a serious defect in {n0(TOTAL.fix)}. The <A href="#checked">map below</A> shows which.
            </li>
            <li>No one who reads Tibetan has yet checked our pages.</li>
          </ul>
        </div>

        <details className="mt-6 rounded-sm border border-stone-200 bg-white px-5 py-4 md:px-6 group">
          <summary className="cursor-pointer font-serif text-lg text-stone-900">Terms used on this page</summary>
          <dl className="mt-4 text-base">
            {GLOSSARY.map(([term, meaning]) => (
              <div key={term} className="md:grid md:grid-cols-[13rem_minmax(0,1fr)] md:gap-4 py-2 border-t border-stone-100 first:border-t-0">
                <dt className="font-semibold text-stone-900">{term}</dt>
                <dd className="text-stone-700">{meaning}</dd>
              </div>
            ))}
          </dl>
        </details>

        <nav aria-label="Contents" className="mt-8 mb-2">
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

        <Section id="why" title="Why we are writing to you">
          <p>
            Source Library is a free online library of primary sources. Each book is shown as its scans, a transcription
            of the original language, and an English translation, page by page and side by side. In Tibetan we now
            serve {n0(bl.books + tg.books + kg.books + other.books)} volumes, most of them manuscripts from the temples
            of Bhutan and the Derge Kangyur and Tengyur.
          </p>
          <p>
            Both the Tibetan text and the English are made by machine. We have measured them against texts typed and
            translated by people, and had AI reviewers read hundreds of pages against the images. No one who reads
            Tibetan has yet checked our pages. This page sets out what we know, shows real pages where the work
            holds up and where it fails, and ends with what is still needed.
          </p>
          <p>
            <strong>How to read the examples.</strong> Each example shows the photographed page (click it to open the
            page in our reader), a short passage of the Tibetan as we store it, and the same passage of the English
            readers see. A label says what the example shows: <em>Works</em>, <em>Error</em>, <em>Withheld</em> (taken
            down from readers), or <em>Open question</em> (a point we cannot settle ourselves). The passages are
            copied from the live pages; an error quoted here was still on the page on {fmtDate(data.measured)}.
          </p>
        </Section>

        <Section id="holdings" title="What we hold">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5 my-6">
            <Stat value={n0(bl.books)} label="Bhutanese manuscripts" />
            <Stat value={n0(tg.books)} label="Derge Tengyur volumes" />
            <Stat value={n0(kg.books)} label="Derge Kangyur volumes" />
            <Stat value={n0(bl.pages + tg.pages + kg.pages + other.pages)} label="pages in all" />
          </div>
          <H3>Manuscripts from Bhutan</H3>
          <p>
            The British Library&rsquo;s Endangered Archives Programme photographed the manuscript holdings of several
            Bhutanese temples and monasteries: Gangtey (EAP039), Drametse and Ogyen Choling (EAP105), and Thadrak,
            Neyphug, Phurdrup and Tshamdrak (EAP310). We hold {n0(bl.books)} of these volumes. Almost all are
            handwritten, in dbu can and dbu med, on loose pecha folios. Many photographs show two or more leaves at
            once.
          </p>
          <p>
            By title, about a sixth of the books are Kanjur volumes, which can be checked against the Derge Kangyur.
            Others are Nyingma tantras, and about a tenth are treasure cycles and biographies. The largest group by
            far, about 1,000 volumes, has no printed counterpart we can find. That group includes ritual manuals,
            sādhanas, empowerment texts, astrology, medicine and local compilations. <S href={SRC.terma} />
          </p>
          <H3>The Derge Tengyur</H3>
          <p>
            {n0(tg.books)} volumes of BDRC&rsquo;s scans of the Derge Tengyur (W23703). Here we do not read the page by
            machine. The Tibetan is the Esukhia digital Derge Tengyur, a proofread public-domain e-text, fitted to
            each scan folio by folio and checked by sampled reads.
          </p>
          <H3>The Derge Kangyur</H3>
          <p>
            {n0(kg.books)} volumes of BDRC&rsquo;s scans of the Library of Congress copy of the Derge Kangyur
            (W4CZ5369), made the same way: the Tibetan is the Esukhia digital Derge Kangyur, fitted folio by folio.{' '}
            {n0(kg.tibetan)} of {n0(kg.pages)} pages carry the e-text and {n0(kg.english)} have English, the last of it
            written in November 2026. <S href={SRC.kangyurEnglish} label="#6948" />
          </p>
          <H3>The Nyingma tantras</H3>
          <p>
            Among the Bhutanese manuscripts are two sets of the Nyingma tantras (rNying ma rgyud &rsquo;bum):{' '}
            {n0(TSHAMDRAK_TANTRAS.length)} volumes from Tshamdrak ({n0(sum(TSHAMDRAK_TANTRAS, 3))} pages,{' '}
            {n0(sum(TSHAMDRAK_TANTRAS, 5))} with English) and {n0(DRAMETSE_TANTRAS.length)} from Drametse (
            {n0(sum(DRAMETSE_TANTRAS, 3))} pages, {n0(sum(DRAMETSE_TANTRAS, 5))} with English). Each set has its own
            row in the <A href="#checked">map of checks</A> below.
          </p>
          <H3>Other</H3>
          <p>
            {n0(other.books)} further Tibetan volumes, from BDRC and the Internet Archive, mostly modern prints.
          </p>
          <H3>Held, not yet public</H3>
          <p>
            A further {n0(HIDDEN.books)} Tibetan volumes ({n0(HIDDEN.pages)} pages), most of them BDRC scans of
            collected works and treasure cycles, are held but not public. {n0(HIDDEN.transcribed)} of their pages have
            a machine reading of the Tibetan, and {n0(HIDDEN.translated)} have English. They are not counted anywhere
            else on this page.
          </p>

          <H3>What has been done, and what remains</H3>
          <p>
            Every page we hold has been photographed. Most now carry Tibetan text, and most of those an English
            draft. The grey squares below are pages with no text yet, mostly the {n0(bl.not_legible)} manuscript
            pages marked not reliably legible. The orange squares are pages whose Tibetan is ready but not yet
            translated.
          </p>
          <TraditionProgress
            n={1}
            rows={PROGRESS}
            title="Our Tibetan holdings, page by page"
            caption={
              <>
                Each square is 1,000 pages, rounded, with at least one square for any stage that has pages. A page
                is transcribed when it carries Tibetan text, read by OCR or fitted from the Esukhia e-text, and
                translated when it has a draft English translation. Each square opens a book whose pages it stands
                for. &ldquo;Read by&rdquo; and &ldquo;English by&rdquo; are shares of pages, from the engine each page
                records. Counted from our database on {fmtDate(data.measured)}.
              </>
            }
          />
          <p>
            How much English already exists differs sharply between the two parts of the canon. 84000&rsquo;s
            translators have published over half of the Kangyur, and under one percent of the Tengyur.
          </p>
          <CanonEnglishBars n={2} />
        </Section>

        <Section id="pipeline" title="How a page is made">
          <ol className="list-decimal pl-6 space-y-3">
            <li>
              <strong>The scan</strong> is shown as photographed by the holding library, and stays the authority.
            </li>
            <li>
              <strong>The Tibetan text.</strong> On the Tengyur, the Esukhia e-text. On the manuscripts, a reading by
              a Tibetan OCR model from BDRC (Apache 2.0), run by us one leaf at a time. Its reading stands on{' '}
              {n0(bl.yigdzin)} of the {n0(bl.pages)} manuscript pages. On a further {n0(corrected)} pages a
              general-purpose model was given the image and that reading and corrected it. We stopped that pass on
              29 October 2026, when an audit of its last run (7,890 pages) found a new serious error on 3 of 8 pages
              checked. That run&rsquo;s readings are still served, and whether to keep them is undecided.{' '}
              <S href={SRC.correctionPass} /> Where we could not confirm a reading, the page
              is marked <em>not reliably legible</em> and the reader shows only the scan. That applies to{' '}
              {n0(bl.not_legible)} pages ({pct(bl.not_legible, bl.pages)}).
            </li>
            <li>
              <strong>The English.</strong> A general-purpose model translates one page at
              a time from the stored Tibetan. It keeps technical terms with a
              short gloss and can add notes. {n0(bl.english)} manuscript pages, {n0(tg.english)} Tengyur pages and{' '}
              {n0(kg.english)} Kangyur pages have English. On {n0(blNoEnglish)} manuscript pages the Tibetan is ready but the English has not been
              made yet.
            </li>
            <li>
              <strong>The checks</strong>, described below. So far every check is either a comparison with a text
              typed or translated by people (the Derge Kangyur e-text, 84000) or a reading by AI reviewers.
            </li>
          </ol>
          <p>
            Every page records which text, model, prompt and run produced it. A correction is kept as a new revision,
            with the earlier text and the reason for the change.
          </p>
        </Section>

        <Section id="reading" title="The Tibetan text">
          <H3>What went wrong first</H3>
          <p>
            Until September 2026 these manuscripts were read by the same general-purpose model we use for European
            print. Its output was fluent and repeated itself from run to run, which we took as a sign of reliability.
            Checked against the canon, most of it was not what the page says. On some leaves it produced Devanagari
            instead of Tibetan. We replaced every one of those readings with the BDRC model. On 23 Kangyur pages checked
            against Derge, the BDRC model matched at 0.962 and the earlier model at 0.149. <S href={SRC.liteVsYigdzin} />{' '}
            Pages where neither reading could be confirmed were marked not legible. <S href={SRC.reocr} label="#4523" />
          </p>
          <H3>Kanjur volumes, checked against Derge</H3>
          <p>
            A Bhutanese Kanjur is another witness of the canon, so a true reading of a folio should match the
            corresponding Derge passage closely, and an invented one should not. We score this as syllable identity
            against the Derge Kangyur e-text (OpenPecha). One interior page from each of 100 randomly drawn Kanjur
            volumes gave a median of <strong>0.947</strong>: on a typical page, about 95 syllables in 100 line up with
            Derge. 76 of the 100 pages were at 0.9 or above. The figure
            includes the real differences between the two witnesses, not only reading errors. As controls, the
            e-text itself with 5% of syllables corrupted scores 0.968, and a page compared with the wrong folio
            scores 0.247. <S href={SRC.kangyurOcr} />
          </p>
          <p>
            Identity cannot see a line that is missing. About 5% of pages have fewer lines than their book&rsquo;s
            median, usually the first line of the lower leaf on a two-leaf photograph. <S href={SRC.kangyurOcr} /> The
            Nyingma tantras score a median of 0.833 against the rKTs Gting skyes edition. That is a lower bound, since
            the witnesses differ more. <S href={SRC.nyingma} />
          </p>
          <H3>Everything else: no answer key</H3>
          <p>
            For the roughly 1,000 volumes with no printed counterpart, no score is possible. Even among the treasure
            cycles and biographies, where we searched BDRC&rsquo;s open e-text deposit book by book, 96% of pages
            match no open e-text. <S href={SRC.terma} /> We had AI reviewers read 112 pages from 28 randomly drawn books, four from each collection, against the photographs.
            Every page&rsquo;s text was a reading of the leaf in the image. None was invented or from another leaf.{' '}
            <S href={SRC.blOther} /> Their recurring reading problems were dbu med letters confused with one another,
            mantra syllables confused (ĀḤ / OM), and scribal abbreviations kept as written rather than expanded.
          </p>

          <ExampleCard id="two-leaves" kind="works" heading="Two leaves in one photograph, read leaf by leaf">
            <p>
              A Neyphug Kanjur volume, the rGyud section. The photograph holds two folios, and the reading marks the
              break between them, which the English carries as a seam (‖). In this volume, 64 pages that earlier
              checks had marked unreadable all scored at least 0.7 against Derge once read by the BDRC model, with a mean of
              0.95. <S href={`${ISSUE}4722`} label="#4722" />
            </p>
          </ExampleCard>

          <ExampleCard id="cursive" kind="works" heading="Cursive dbu med, with the terma marks kept">
            <p>
              A dbu med history of Padmasambhava. The reading keeps the ༔ terma punctuation and all seven lines. The
              earlier model wrote one sentence four times on this page. Checked line by line against the image on
              three leaves of this book (pp. 57, 233 and 412), by an AI reviewer, not by a reader of Tibetan. Contractions such as ཁཾས for ཁམས are kept as the scribe
              wrote them. Whether to expand them is one of our questions below. This page has no English yet.
            </p>
          </ExampleCard>

          <ExampleCard id="byed-med" kind="error" heading="One misread syllable reverses the argument">
            <p>
              An Abhidharma passage in a Thadrak miscellany, in dbu med. The leaf says each faculty{' '}
              <em>exercises power over</em> (དབང་བྱེད) four ends. The reading has དབང་མྱེད, &ldquo;has no power&rdquo;:
              the cursive བྱ was read as མྱ. The English follows the misreading and states the opposite thesis,
              though the next sentences argue for it. Found by an AI reviewer, confirmed against the image.{' '}
              <S href={SRC.blOther} />
            </p>
          </ExampleCard>
        </Section>

        <Section id="english" title="The English">
          <p>
            We measure the English three ways. We compare it with a published human translation of the same passage,
            usually 84000&rsquo;s, scored by two AI judges who do not know which version is ours. AI reviewers read
            random pages against the Tibetan and classify each error. And we read a smaller number by eye. A rate
            judged against 84000 covers only texts 84000 has translated, which are the better-known ones.
          </p>

          <H3>The Derge Tengyur</H3>
          <p>
            {sample.n} randomly drawn pages were read against the Tibetan by two AI reviewers, blind to each
            other ({fmtDate(TQ.measured)}). <strong>{Math.round(sample.light)}%</strong> of pages needed only light
            edits, {Math.round(sample.work)}% substantial revision and {Math.round(sample.specialist)}% a specialist.
            The commonest serious error is a reversed statement or the wrong speaker, such as an opponent&rsquo;s
            objection given as the author&rsquo;s view. These run at about {Math.round(sample.rev_agent_per100_adjusted)}{' '}
            per 100 pages [{Math.round(sample.rev_agent_ci_adjusted[0])}–{Math.round(sample.rev_agent_ci_adjusted[1])}],
            after allowing for the reviewers being right about {TQ.reviewers.precision_pct}% of the time when checked
            by hand. Verse fares worse than prose: {TQ.verse.mostly_verse.rev_agent_per100} against{' '}
            {Math.round(TQ.verse.prose.rev_agent_per100)} per 100 pages. <S href={SRC.tengyurRandom} />
          </p>
          <p>
            On the 8 texts where 84000 has published the same passage (354 aligned passages), two AI judges found 6.2
            reversed statements per 100 pages by either judge, and 3.4 by both. 84000 has not published the Tengyur
            Pramāṇa or Madhyamaka, so those sections have no reference. <S href={SRC.tengyurVs84000} />
          </p>
          <TengyurSectionTable />
          <p className="text-sm text-stone-500">
            Sections with at least {TQ.min_pages} pages in the random sample. The Jātaka, Abhidharma, sūtra
            commentaries and sciences had too few pages to rate. * The Pramāṇa and Madhyamaka English was replaced
            on 10 October 2026 by the current reading model. In a blind read of 40 replaced pages against the image, an AI reviewer
            found a serious error on 3 new pages and 6 old ones. A second reader from another model family found 3
            and 11. These rates describe the earlier English. <S href={SRC.tengyurCli} />
          </p>

          <H3>The Bhutanese manuscripts</H3>
          <p>
            On Kanjur volumes whose reading matches Derge, the English scored a mean of 4.22 out of 5 for fidelity
            against 84000, with 21 of 23 pages at 4 (minor slips only) or above. That is a small sample from 10
            books. <S href={SRC.blKangyur} /> On the volumes with no reference, the 112 pages above were also read
            for the English. Weighted by the size of each collection, 9% of pages had a serious defect, most of them
            in the English rather than the Tibetan. <S href={SRC.blOther} />
          </p>
          <Table
            head={['Collection', 'Books', 'Pages with a serious defect', 'Show / with caveat / don’t']}
            rows={BL_COLLECTIONS.map(([c, b, s, v]) => [c, n0(b), s, v])}
          />
          <p className="text-sm text-stone-500">
            4 books and 16 pages per collection, AI reviewers, 7 October 2026. The intervals are wide: Gangtey&rsquo;s
            19% is 6–25% by book.
          </p>

          <ExampleCard id="good-bl" kind="works" heading="A fire-offering manual from Drametse">
            <p>
              A wrathful homa and Vajrakīla effigy rite. The AI reviewer scored this page 5 of 5 for both the reading
              and the English, with no errors found. Their summary of the book: the English &ldquo;can be trusted for
              the sequence of the rite, but should be checked against the Tibetan for iconographic detail.&rdquo;{' '}
              <S href={SRC.blOther} />
            </p>
          </ExampleCard>

          <ExampleCard id="tengyur-good" kind="works" heading="Prajñāpāramitā, close to the Tibetan">
            <p>
              The Prajñāpāramitā section had the best rate in the sample: all 10 pages read needed only light edits.
              The terms are kept with a gloss (Bhagavan, Mahāsattva).
            </p>
          </ExampleCard>

          <ExampleCard id="numeral" kind="error" heading="A number misread: five heads become five hundred">
            <p>
              The Tibetan is the proofread e-text, so this is the translation&rsquo;s error alone. The text has མི་མགོ་ལྔ་
              བརྒྱུས་པས, &ldquo;strung with five human heads&rdquo;. The English read བརྒྱུས (&ldquo;strung&rdquo;) as
              བརྒྱ (&ldquo;hundred&rdquo;). <S href={`${ISSUE}5797`} label="#5797" />
            </p>
          </ExampleCard>

          <ExampleCard id="seam" kind="error" heading="A dropped negation at a leaf seam">
            <p>
              Pema Lingpa&rsquo;s collected works, Neyphug. At the seam between two leaves, མི of མི་དགེ་བཅུ (&ldquo;the
              ten non-virtues&rdquo;) is lost, and the prayer in English asks to abandon the ten virtues. On the same
              page, the name Devacandra becomes &ldquo;Dhana-Sanskrita&rdquo;. <S href={SRC.blOther} />
            </p>
          </ExampleCard>

          <ExampleCard id="mansions" kind="error" heading="Lunar mansions given the wrong Sanskrit names">
            <p>
              An astrological omen manual from Tshamdrak. The reading is sound, but the English maps the Tibetan
              lunar mansions onto the wrong Sanskrit names. On this page, མེ་བཞི (Hasta) becomes Pūrvaphalgunī, གྲོ་བཞིན
              (Śravaṇa) becomes Āśleṣā, and སྣྲུབས (Mūla) becomes Kṛttikā. The mansion is the key datum of each omen,
              so the omens in this chapter are not usable in English. The doctrinal texts in the same bundle read
              well. <S href={SRC.blOther} />
            </p>
          </ExampleCard>

          <ExampleCard id="title-leaf" kind="withheld" heading="A recited chapter on a title leaf, taken down">
            <p>
              This leaf carries only a title, but the translation model produced 2,286 characters of the
              Abhidharmasamuccaya&rsquo;s first chapter: text that exists, but is not on this page. A detector now
              looks for title leaves with long English, and each one confirmed against the image has its English
              withheld. A reader of this page now sees the scan and the Tibetan only. <S href={SRC.titleLeaves} label="#6297" />
            </p>
          </ExampleCard>
        </Section>

        <Section id="checked" title="Volume by volume: what has been checked">
          <p>
            Beside the sampled measurements above, we keep a record of every time a volume&rsquo;s pages were read
            against their images. Each check ends in one of three findings for the pages read: no serious error,
            errors noted, or a serious defect, such as text that is not on the leaf, a dropped line, or English that
            says the opposite of the Tibetan.
          </p>
          <VerdictMap n={3} />
          <p>
            {n0(CHECKED)} of {n0(ALL_ROWS.length)} public volumes have a check and {n0(TOTAL.none)} have none. The
            Derge Kangyur English is the newest text here: {n0(tally(CHECK_GROUPS[1].rows).none)} of its{' '}
            {n0(kg.books)} volumes have no check yet.
          </p>
        </Section>

        <Section id="material" title="By kind of text">
          <p>
            The same public shelf, sorted by what the volumes contain instead of where they came from. For the two
            Derge collections the Tibetan is a proofread digital text placed page by page, so what varies between
            sections is the English. For the manuscripts both the reading of the leaf and the English vary.
          </p>
          <MaterialMap n={4} />
        </Section>

        <Section id="errors" title="What goes wrong: specimens">
          <p>
            {ZOO.first === ZOO.last ? `On ${fmtDate(ZOO.first)}` : `Between ${fmtDate(ZOO.first)} and ${fmtDate(ZOO.last)}`} AI
            reviewers read {n0(ZOO.judged_pages)} pages
            from {n0(ZOO.judged_books)} public volumes against their photographs and recorded the differences they
            saw in the Tibetan. Sorted into the {ZOO.kinds.length} kinds below, they noted {n0(ZOO_TOTAL.wrong_text)}{' '}
            cases of wrong text, {n0(ZOO_TOTAL.misleads)} that could mislead a reader, and {n0(ZOO_TOTAL.cosmetic)}{' '}
            cosmetic ones. A further {n0(ZOO.other_defects)} notes fall outside these kinds and are not shown. No
            person has confirmed these findings, and that is one of the things we are asking for.
          </p>
          <p>
            The pages come from several test runs that chose pages in different ways, so the counts say what was found
            and are not rates for the shelf. Each specimen quotes the Tibetan as it is stored now, gives the
            reviewer&rsquo;s note, and opens the page, where the photograph can be compared. In the notes,
            &ldquo;the candidate&rdquo; is the transcription under review.
          </p>
          <ErrorZoo />
        </Section>

        <Section id="human" title="Beside a scholars&rsquo; translation">
          <p>
            For {n0(HUMAN.length)} Tengyur texts a translation by scholars exists: those 84000 had published by 3
            October 2026, {n0(HUMAN.reduce((t, h) => t + h.sides, 0))} folio sides in all. Each row opens our page
            where the text begins, with the leaf, the Tibetan and our English, and 84000&rsquo;s translation of the
            same text, so the three can be read side by side. We link to 84000&rsquo;s text and do not copy it. The
            passages our English was scored against in <A href="#english">section 5</A> come from eight of these
            texts.{' '}
            <S href={SRC.tengyurVs84000} />
          </p>
          <div className="overflow-x-auto">
            <table className="w-full font-body text-sm text-left border-collapse">
              <thead>
                <tr className="border-b border-stone-300 text-stone-500 text-xs uppercase tracking-wider">
                  <th className="py-2 pr-4 font-semibold">Text (84000&rsquo;s English title)</th>
                  <th className="py-2 pr-4 font-semibold">Tōhoku</th>
                  <th className="py-2 pr-4 font-semibold text-right">Folio sides</th>
                  <th className="py-2 pr-4 font-semibold">Our page</th>
                  <th className="py-2 font-semibold">Scholars&rsquo; translation</th>
                </tr>
              </thead>
              <tbody>
                {HUMAN.map((h) => (
                  <tr key={h.toh} className="border-b border-stone-100 text-stone-800 align-top">
                    <td className="py-2 pr-4">{h.title}</td>
                    <td className="py-2 pr-4 tabular-nums whitespace-nowrap">{h.toh}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{n0(h.sides)}</td>
                    <td className="py-2 pr-4 whitespace-nowrap">
                      <A href={`/book/${h.book_id}?page=${h.page}`}>
                        vol. {h.vol}, f. {h.folio}
                      </A>
                    </td>
                    <td className="py-2 whitespace-nowrap">
                      <A href={h.url}>84000, {h.published.slice(0, 4)}</A>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            84000 has published no Tengyur text from the Pramāṇa or Madhyamaka sections, so for those the only
            comparison is a reader&rsquo;s own.
          </p>
        </Section>

        <Section id="unknown" title="What we have not measured">
          <ul className="list-disc pl-6 space-y-3">
            <li>
              <strong>Most volumes.</strong> {n0(TOTAL.none)} of the {n0(ALL_ROWS.length)} public volumes have had no
              page read against its image in a recorded check. The sampled rates above are what we know about them.
            </li>
            <li>
              <strong>A reader of Tibetan.</strong> Every judgement on this page is either agreement with a text
              people made or the view of an AI reviewer. The AI reviewers are right about 70% of the time when their
              findings are checked by hand, and they may share the translating model&rsquo;s blind spots. We do not
              know how far their verdicts match a scholar&rsquo;s.
            </li>
            <li>
              <strong>Accuracy on the manuscripts with no counterpart.</strong> About 1,000 volumes. We know the
              readings are of the right leaves. We do not have a rate for how many syllables are wrong.
            </li>
            <li>
              <strong>Cursive hands at scale.</strong> Spot checks of dbu med pages have gone well, but they are a few
              dozen pages, not a measurement.
            </li>
            <li>
              <strong>Whether our error categories are the ones that matter.</strong> We count reversed statements,
              wrong speakers, wrong terms, omissions and additions. A scholar may weigh these differently, or see
              errors we do not count.
            </li>
            <li>
              <strong>Catalogue data.</strong> Titles, dates and authors for the Bhutanese volumes come from the
              archive&rsquo;s records and our own reading of title pages. Some are wrong: 285 volumes, for example,
              name their holding collection as their author. <S href={`${ISSUE}6298`} label="#6298" />
            </li>
          </ul>
        </Section>

        <Section id="needed" title="What is needed">
          <p>
            Some of what would improve these texts is work we can do ourselves, given time. Some of it needs people
            who read Tibetan, and in places a specialist in one genre.
          </p>

          <H3>Readers of Tibetan, page by page</H3>
          <p>
            Our only measure of most of the English is AI review, and we do not know how far AI reviewers agree
            with a scholar. A scholar reading a few dozen pages, each as the image, the Tibetan and our English, and
            marking what is wrong, would tell us how far to trust the AI review of everything else. The first round
            is planned for the Derge Tengyur: about 30 pages, weighted toward Pramāṇa, verse and the Vinaya, where the
            AI review found the most problems. The Bhutanese manuscripts, especially the collections with no printed
            counterpart, need the same. <S href={SRC.scholar} label="the plan, #5800" />
          </p>

          <H3>Specialist judgement on open points</H3>
          <p>Two examples of points we cannot settle ourselves:</p>

          <ExampleCard id="pramana" kind="judge" heading="“Under the sway of desire”, or “at will”?">
            <p>
              Pramāṇa, Derge Tengyur vol. 174, in a passage on whether conceptual cognition is an external object.
              Our English renders འདོད་པའི་དབང་གིས as &ldquo;under the sway of desire&rdquo;. An AI reviewer read it
              as &ldquo;at will&rdquo;, as one pleases, and judged that the structure of the surrounding verse is
              misbuilt. Which is right, and whether this page is a usable draft, needs a reader of Dharmakīrti.{' '}
              <S href={`${ISSUE}6121`} label="#6121" />
            </p>
          </ExampleCard>

          <ExampleCard id="vinaya" kind="judge" heading="Is འགལ་ཚབས་ཅན a sthūlātyaya?">
            <p>
              Vinaya, Derge Tengyur vol. 152. Our English gives འགལ་ཚབས་ཅན as &ldquo;a grave offence
              (sthūlātyaya)&rdquo;. An AI reviewer questioned the equivalence. The Vinaya has the highest rate of
              term errors in our sample, and on {n0(TQ.defects.vinaya_pali_pages)} Vinaya pages
              ({TQ.defects.vinaya_pali_pct}%) the English uses Pāli names for offence classes. A consistent rendering
              of the offence classes needs a Vinaya specialist.
            </p>
          </ExampleCard>

          <p>
            The astrological and medical texts among the Bhutanese manuscripts need the same kind of reader: the
            lunar-mansion example above shows the English getting the technical vocabulary wrong while the reading
            is sound.
          </p>

          <H3>Conventions, decided once</H3>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong>Scribal abbreviations</strong> (ཁཾས for ཁམས, ཌ for སོགས): expand them in the transcription,
              mark them, or keep them as written.
            </li>
            <li>
              <strong>Terms</strong>: Sanskrit equivalents with a gloss, or English renderings; and one rendering per
              term across the corpus.
            </li>
            <li>
              <strong>Names</strong> of people, deities and places: translated, transliterated, or both.
            </li>
            <li>
              <strong>Which errors matter most</strong> for scholarly use. We count reversed statements, wrong
              speakers, wrong terms, omissions and additions; the weighting is ours, not a scholar&rsquo;s.
            </li>
          </ul>

          <H3>Reference texts</H3>
          <p>
            Any open typed edition of a work in the Bhutanese collections lets us score our reading of it, as the
            Derge text does for the Kanjur volumes. Searching BDRC&rsquo;s open e-text deposit found a match for 28
            of 133 treasure and biography books. The ritual, astrological and local texts have not been searched
            yet. <S href={SRC.terma} />
          </p>

          <H3>Work we can do ourselves</H3>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              English for the {n0(blNoEnglish)} manuscript pages whose Tibetan is ready but not yet translated.
            </li>
            <li>
              A better reading of the {n0(bl.not_legible)} manuscript pages marked not reliably legible, and of the
              lines dropped where two leaves share a photograph.
            </li>
            <li>Correcting titles, dates and authors in the catalogue records of the Bhutanese volumes.</li>
          </ul>

          <p className="text-base text-stone-600 mt-8">
            For every canon in the programme, including Sanskrit, Pāli and Chinese, see{' '}
            <A href="/research/canon-quality">How We Check Each Canon</A>.
          </p>
        </Section>
      </div>
    </ContentPageLayout>
  );
}
