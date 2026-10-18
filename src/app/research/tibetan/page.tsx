import { Metadata } from 'next';
import type { ReactNode } from 'react';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { experiment } from '@/lib/experiments-index';
import { TENGYUR_QUALITY } from '@/lib/tengyur-quality';
import data from '@/data/tibetan-expert-page.json';

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
  blOther: exp('2026-10-07-bl-tibetan-other-stratum-by-eye-4523.md'),
  blKangyur: exp('2026-10-07-bl-kangyur-chained-retranslation-pilot-4523.md'),
  tengyurRandom: exp('2026-10-04-tengyur-characterize-random-sample-5829.md'),
  tengyurVs84000: exp('2026-10-04-tengyur-stored-draft-vs-84000-5797.md'),
  tengyurCli: exp('2026-10-11-tengyur-cli-nudge-reread-convergent-6361.md'),
  titleLeaves: `${ISSUE}6297`,
  scholar: `${ISSUE}5800`,
  reocr: `${ISSUE}4523`,
};

const CONTACT = 'team@sourcelibrary.org';
const MAILTO = `mailto:${CONTACT}?subject=${encodeURIComponent('Tibetan texts: reviewer feedback')}`;

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
  'gemini-3-flash-preview': 'Gemini 3 Flash',
  'gemini-3.8-flash-low': 'Gemini 3.8 Flash',
};

const CONTENTS = [
  ['why', 'Why we are writing to you'],
  ['holdings', 'What we hold'],
  ['pipeline', 'How a page is made'],
  ['reading', 'The Tibetan text'],
  ['english', 'The English'],
  ['unknown', 'What we have not measured'],
  ['ask', 'What we would ask of you'],
] as const;

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
  judge: { label: 'Your judgement', cls: 'bg-amber-50 text-amber-900 border-amber-200' },
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
          {' · '}Tibetan: {e.tibetan_source}
          {e.english_model ? ` · English: ${MODEL_NAMES[e.english_model] ?? e.english_model}` : ''}
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
  const blNoEnglish = bl.tibetan - bl.english;
  const sample = TQ.sample;
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Tibetan and Bhutanese Texts"
          subtitle="A briefing for reviewers: what we hold, how we read and translate it, what we have measured, pages that went right and wrong, and what we would like you to tell us."
          image={EX['two-leaves'].image}
          imageAlt="Two leaves of the Neyphug Kanjur, a Bhutanese manuscript copy of the canon, photographed together by the British Library's Endangered Archives Programme"
          backHref="/research"
          backLabel="Research"
        />
      }
    >
      <div className="max-w-4xl mx-auto font-body text-stone-700 text-lg leading-relaxed">
        <p className="text-sm text-stone-500 mt-8">
          Prepared October 2026. The counts were read from our database on {fmtDate(data.measured)}. Every other
          figure is copied from a dated write-up of a measurement and links to it. About fifteen minutes to read.
        </p>

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
            serve {n0(bl.books + tg.books + other.books)} volumes, most of them manuscripts from the temples of Bhutan
            and the Derge Tengyur.
          </p>
          <p>
            Both the Tibetan text and the English are made by machine. We have measured them against texts typed and
            translated by people, and had AI reviewers read thousands of pages against the images. No one who reads
            Tibetan has yet checked our pages. That is what we are asking for. This page sets out what we know, shows
            real pages where the work holds up and where it fails, and ends with specific questions.
          </p>
          <p>
            We would rather hear that something is wrong than find out later. A short reply to one question is
            useful.
          </p>
        </Section>

        <Section id="holdings" title="What we hold">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5 my-6">
            <Stat value={n0(bl.books)} label="Bhutanese manuscripts" />
            <Stat value={n0(bl.pages)} label="pages photographed" />
            <Stat value={n0(tg.books)} label="Derge Tengyur volumes" />
            <Stat value={n0(tg.pages)} label="Tengyur pages" />
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
          <H3>Other</H3>
          <p>
            {n0(other.books)} further Tibetan volumes, from BDRC and the Internet Archive, mostly modern prints.
          </p>
        </Section>

        <Section id="pipeline" title="How a page is made">
          <ol className="list-decimal pl-6 space-y-3">
            <li>
              <strong>The scan</strong> is shown as photographed by the holding library, and stays the authority.
            </li>
            <li>
              <strong>The Tibetan text.</strong> On the Tengyur, the Esukhia e-text. On the manuscripts, a reading by
              Yigdzin, BDRC&rsquo;s open Tibetan OCR model (Apache 2.0), run by us one leaf at a time. It has read{' '}
              {n0(bl.yigdzin)} of the {n0(bl.pages)} manuscript pages. Where we could not confirm a reading, the page
              is marked <em>not reliably legible</em> and the reader shows only the scan. That applies to{' '}
              {n0(bl.not_legible)} pages ({pct(bl.not_legible, bl.pages)}).
            </li>
            <li>
              <strong>The English.</strong> A general-purpose model, Google&rsquo;s Gemini Flash, translates one page at
              a time from the stored Tibetan. It keeps technical terms with a
              short gloss and can add notes. {n0(bl.english)} manuscript pages and {n0(tg.english)} Tengyur pages
              have English. On {n0(blNoEnglish)} manuscript pages the Tibetan is ready but the English has not been
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
            instead of Tibetan. We replaced every one of those readings with Yigdzin. On 23 Kangyur pages checked
            against Derge, Yigdzin matched at 0.962 and the earlier model at 0.149. <S href={SRC.liteVsYigdzin} />{' '}
            Pages where neither reading could be confirmed were marked not legible. <S href={SRC.reocr} label="#4523" />
          </p>
          <H3>Kanjur volumes, checked against Derge</H3>
          <p>
            A Bhutanese Kanjur is another witness of the canon, so a true reading of a folio should match the
            corresponding Derge passage closely, and an invented one should not. We score this as syllable identity
            against the Derge Kangyur e-text (OpenPecha). One interior page from each of 100 randomly drawn Kanjur
            volumes gave a median of <strong>0.947</strong>, with 76 of the 100 pages at 0.9 or above. The figure
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
            match no open e-text. <S href={SRC.terma} /> We had AI reviewers (Claude
            Opus) read 112 pages from 28 randomly drawn books, four from each collection, against the photographs.
            Every page&rsquo;s text was a reading of the leaf in the image. None was invented or from another leaf.{' '}
            <S href={SRC.blOther} /> Their recurring reading problems were dbu med letters confused with one another,
            mantra syllables confused (ĀḤ / OM), and scribal abbreviations kept as written rather than expanded.
          </p>

          <ExampleCard id="two-leaves" kind="works" heading="Two leaves in one photograph, read leaf by leaf">
            <p>
              A Neyphug Kanjur volume, the rGyud section. The photograph holds two folios, and the reading marks the
              break between them, which the English carries as a seam (‖). In this volume, 64 pages that earlier
              checks had marked unreadable all scored at least 0.7 against Derge once read by Yigdzin, with a mean of
              0.95. <S href={`${ISSUE}4722`} label="#4722" />
            </p>
          </ExampleCard>

          <ExampleCard id="cursive" kind="works" heading="Cursive dbu med, with the terma marks kept">
            <p>
              A dbu med history of Padmasambhava. The reading keeps the ༔ terma punctuation and all seven lines. The
              earlier model wrote one sentence four times on this page. Checked line by line against the image on
              three leaves of this book (pp. 57, 233 and 412), by Claude, not by a reader of Tibetan. Contractions such as ཁཾས for ཁམས are kept as the scribe
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
            {sample.n} randomly drawn pages were read against the Tibetan by two Claude Opus reviewers, blind to each
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
            on 10 October 2026 by Gemini 3.8 Flash. In a blind read of 40 replaced pages against the image, Opus
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

        <Section id="unknown" title="What we have not measured">
          <ul className="list-disc pl-6 space-y-3">
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

        <Section id="ask" title="What we would ask of you">
          <p>Any one of these helps, and each is meant to take under an hour.</p>

          <ExampleCard id="pramana" kind="judge" heading="1. Is “under the sway of desire” right here?">
            <p>
              Pramāṇa, Derge Tengyur vol. 174, in a passage on whether conceptual cognition is an external object.
              Our English renders འདོད་པའི་དབང་གིས as &ldquo;under the sway of desire&rdquo;. An AI reviewer read it
              as &ldquo;at will&rdquo;, as one pleases, and judged that the structure of the surrounding verse is
              misbuilt. Which reading would you accept, and would you start from this draft?{' '}
              <S href={`${ISSUE}6121`} label="#6121" />
            </p>
          </ExampleCard>

          <ExampleCard id="vinaya" kind="judge" heading="2. Is འགལ་ཚབས་ཅན a sthūlātyaya?">
            <p>
              Vinaya, Derge Tengyur vol. 152. Our English gives འགལ་ཚབས་ཅན as &ldquo;a grave offence
              (sthūlātyaya)&rdquo;. An AI reviewer questioned the equivalence. The Vinaya has the highest rate of term errors in our sample, and on{' '}
              {n0(TQ.defects.vinaya_pali_pages)} Vinaya pages ({TQ.defects.vinaya_pali_pct}%) the English uses Pāli
              names for offence classes. How should these be rendered?
            </p>
          </ExampleCard>

          <H3>3. Read five pages in your field</H3>
          <p>
            We send you five pages by email, each as the image, the Tibetan and our English. For each: what would you
            correct (quote the line)? Is any statement reversed, left out or added? Would you start from this draft:
            yes, with work, or no? The first round is planned for the Derge Tengyur, weighted toward Pramāṇa, verse
            and the Vinaya, where the AI review found the most problems. We would gladly add the Bhutanese
            manuscripts, including the collections with no printed counterpart.{' '}
            <S href={SRC.scholar} label="the plan, #5800" />
          </p>

          <H3>4. Tell us what matters</H3>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Which errors matter most for how you would use these texts, and are any of ours not errors at all?
            </li>
            <li>
              Should scribal abbreviations (ཁཾས, ཌ for སོགས) be expanded in the transcription, marked, or left as
              written?
            </li>
            <li>
              Terminology: Sanskrit equivalents with a gloss, or English? Names: translated, transliterated, or
              both?
            </li>
            <li>
              Which of these collections would be most useful to you, and is there anything we serve that we
              should not?
            </li>
          </ul>

          <div className="mt-8 rounded-sm border border-amber-200 bg-amber-50 px-5 py-5">
            <p className="font-serif text-xl text-stone-900 mb-2">How to reply</p>
            <p className="text-base">
              Write to <A href={MAILTO}>{CONTACT}</A>. Answer one question or all of them, in English or Tibetan.
              Each correction you send is applied as a recorded revision of the page, never as a silent overwrite,
              and your verdicts are set beside the AI reviewers&rsquo; on the same pages. That tells us how far to
              trust the AI review of everything else. We name contributors unless you ask us not to, and we will not
              quote your answers as a measured rate without your permission.
            </p>
          </div>

          <p className="text-base text-stone-600 mt-8">
            For every canon in the programme, including Sanskrit, Pāli and Chinese, see{' '}
            <A href="/research/canon-quality">How We Check Each Canon</A>.
          </p>
        </Section>
      </div>
    </ContentPageLayout>
  );
}
