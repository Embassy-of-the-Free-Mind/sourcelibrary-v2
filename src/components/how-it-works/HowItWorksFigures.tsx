/**
 * The diagrams on /how-it-works (#5861), written for a library or a partner project
 * deciding whether to work with Source Library: how the whole line runs (and the checks
 * that loop over published pages), the two ways a page gets its text, how one page is
 * tied to the rest of the library, what is recorded with every page, where people come
 * in, and what a partner library gives and gets back.
 *
 * Server components, HTML + CSS only: they read at phone width, need no client JS,
 * and every value shown is passed in from a record or a results file by the page.
 */
import type { ReactNode } from 'react';
import type { JourneyConnect } from '@/lib/journey/types';

const fmt = (n: number) => n.toLocaleString('en-US');

export function Figure({ n, title, caption, children }: { n: number; title: string; caption?: ReactNode; children: ReactNode }) {
  return (
    <figure className="my-12">
      <figcaption className="mb-5">
        <span className="font-sans text-xs font-semibold uppercase tracking-[0.12em] text-accent-rust">Figure {n}</span>
        <span className="block font-serif text-2xl md:text-3xl text-primary leading-tight mt-1">{title}</span>
      </figcaption>
      {children}
      {caption && <p className="font-sans text-sm text-muted leading-relaxed mt-4">{caption}</p>}
    </figure>
  );
}

/* ── Figure 1: the line, then the loop ─────────────────────────────────────── */

type Stage = { name: string; does: string; out: string; theirs?: string; pending?: boolean };

const LINE: Stage[] = [
  {
    name: 'Find',
    does: 'We take each page image from the library that holds the book, through IIIF or the archive’s own download, and keep a copy on our storage.',
    out: 'Page images, credited to the holding library',
    theirs: 'Pre-processing',
  },
  {
    name: 'Read',
    does: 'Where people have already typed the text, we fit their typing to our scans. Where not, a model reads each page image.',
    out: 'A transcription beside every page',
    theirs: 'Semantic Alignment',
  },
  {
    name: 'Translate',
    does: 'A model translates each page into English from its transcription, in batches.',
    out: 'English beside every page, marked as not yet reviewed',
    theirs: 'Draft Translation',
  },
  {
    name: 'Connect',
    does: 'Each page is indexed by meaning; the people, places and ideas on it go into the book’s index; other editions of the same work are linked.',
    out: 'A page that can be found by what it says',
  },
  {
    name: 'Publish',
    does: 'Scan, text and English side by side; full-text search; a stable link to every page; DOIs for editions; an AI-assistant connector.',
    out: 'A page anyone can read, quote and cite',
    theirs: 'Publication',
  },
];

const CHECK: Stage = {
  name: 'Check and correct',
  does: 'Checks run over the published pages, again and again. Our text is scored against typed editions and our English against published translations; detectors sweep for known faults. Pages that fail are repaired, run again or taken down, and each correction is kept as a revision.',
  out: 'Measured error rates, per canon and language',
  theirs: 'Automated Critique',
};

const SCHOLARS: Stage = {
  name: 'Scholars',
  does: 'A person who reads the source language reads our pages. Each correction is saved as a revision of the page.',
  out: 'Not yet: no scholar has reviewed pages in the Eternity canons',
  theirs: 'Human Review',
  pending: true,
};

function StageBox({ s, n, fill }: { s: Stage; n?: number; fill?: boolean }) {
  return (
    <div
      className={`${fill ? 'h-full ' : ''}rounded-sm border px-4 py-4 md:px-3 ${
        s.pending ? 'border-dashed border-border-medium bg-transparent' : 'border-border-light bg-white'
      }`}
    >
      {n !== undefined && <div className="font-sans text-xs text-accent-rust tabular-nums">{n}</div>}
      <div className="font-serif text-xl text-primary leading-tight mb-2">{s.name}</div>
      <p className="font-sans text-[13px] text-secondary leading-snug mb-3">{s.does}</p>
      <p className={`font-sans text-[13px] leading-snug font-medium ${s.pending ? 'text-accent-rust' : 'text-primary'}`}>{s.out}</p>
      {s.theirs && <p className="font-sans text-[11px] uppercase tracking-[0.08em] text-muted mt-3">{s.theirs}</p>}
    </div>
  );
}

export function LineFigure({ books, readable, languages }: { books: number; readable: number; languages: number }) {
  return (
    <Figure
      n={1}
      title="The line every book goes through, and the loop after it"
      caption={
        <>
          A book is published as soon as it is through the line; the checks run on published pages. Before that, each
          translation is checked once as it is written: one that is far too short or too long, that copies the original, or
          that slips into a third script is refused and kept aside. A partner can hold its books until they are checked, as
          the Derge Tengyur is held now. The grey label under each step is the name the Eternity Foundation’s Nālandā
          Restored programme uses for the same step. Today the library holds {fmt(books)} books in {fmt(languages)}{' '}
          languages; {fmt(readable)} of them can be read in English.
        </>
      }
    >
      <ol className="grid gap-3 md:grid-cols-5 md:gap-2">
        {LINE.map((s, i) => (
          <li key={s.name} className="relative">
            <StageBox s={s} n={i + 1} fill />
            {i < LINE.length - 1 && (
              <span aria-hidden className="hidden md:block absolute -right-[7px] top-8 z-10 text-muted text-sm">›</span>
            )}
          </li>
        ))}
      </ol>
      <div className="mt-3 rounded-sm border border-accent-rust/40 px-3 pt-2 pb-3 md:px-2">
        <p className="font-sans text-xs font-semibold uppercase tracking-[0.1em] text-accent-rust mb-2 md:px-1">
          <span aria-hidden>↻ </span>Then, on every published page, again and again
        </p>
        <div className="grid gap-3 md:grid-cols-[3fr_1fr] md:gap-2 items-start">
          <StageBox s={CHECK} n={LINE.length + 1} />
          <StageBox s={SCHOLARS} />
        </div>
      </div>
    </Figure>
  );
}

/* ── Figure 2: two ways to the text ─────────────────────────────────────────── */

function Route({ when, steps, example }: { when: string; steps: string[]; example: ReactNode }) {
  return (
    <div className="rounded-sm border border-border-light bg-white px-5 py-5">
      <div className="font-sans text-xs font-semibold uppercase tracking-[0.1em] text-accent-rust mb-3">{when}</div>
      <ol className="space-y-2 mb-4">
        {steps.map((st, i) => (
          <li key={i} className="flex gap-3 font-sans text-sm text-secondary leading-snug">
            <span className="text-muted tabular-nums">{i + 1}</span>
            <span>{st}</span>
          </li>
        ))}
      </ol>
      <div className="border-t border-border-light pt-3 font-sans text-[13px] text-muted leading-snug">{example}</div>
    </div>
  );
}

export function TextRoutesFigure({
  tengyurPages,
  examplePage,
}: {
  tengyurPages: number;
  examplePage: { model: string; label: string };
}) {
  return (
    <Figure
      n={2}
      title="Two ways a page gets its text"
      caption="A typed edition is the better source wherever one exists, because people made it and no model has read the page. The model’s reading is used where no one has typed the book, which is most of the library."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Route
          when="Someone has typed the text"
          steps={[
            'Take the typed edition, with its licence and the exact version used.',
            'Pair each typed folio with its page image, and check the pairing by reading a sample of pages.',
            'The page shows the typed text. No model reads the image.',
          ]}
          example={
            <>
              Example: the Derge Tengyur, typed by Esukhia. {fmt(tengyurPages)} pages are paired with BDRC’s woodblock
              scans.
            </>
          }
        />
        <Route
          when="No one has typed it"
          steps={[
            'A model reads the page image and writes out the text, in the original script.',
            'Where a typed text of the same work exists anywhere, we score the model’s reading against it.',
            'Pages it cannot read are marked as such, not filled in.',
          ]}
          example={<>Example: {examplePage.label}, read by {examplePage.model}.</>}
        />
      </div>
    </Figure>
  );
}

/* ── Figure 4: the record behind one page ───────────────────────────────────── */

export type PageRecord = {
  pageLabel: string;
  readerUrl: string;
  image: { from: string; sourceUrl?: string; archivedAt?: string; width?: number; height?: number };
  text?: { model: string; prompt?: string; at?: string };
  english?: { model: string; modelVersion?: string; prompt?: string; api?: string; batch?: string; hash?: string; at?: string };
  alignment?: { pairs: number; model?: string };
  revisions: number;
};

function RecordRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 md:grid-cols-[9rem_1fr] md:gap-4 py-3 border-b border-border-light last:border-0">
      <dt className="font-sans text-xs font-semibold uppercase tracking-[0.1em] text-muted pt-0.5">{label}</dt>
      <dd className="font-sans text-sm text-secondary leading-relaxed">{children}</dd>
    </div>
  );
}

const Code = ({ children }: { children: ReactNode }) => (
  <code className="text-[13px] text-primary bg-cream px-1 rounded-sm">{children}</code>
);

export function RecordFigure({ r }: { r: PageRecord }) {
  return (
    <Figure
      n={4}
      title="What we keep with every page"
      caption={
        <>
          This is the stored record of {r.pageLabel}, the page in the film, as it is in our database today. Every page carries
          the same fields, so any line of English can be traced to the image, the model and the run that produced it.{' '}
          <a href={r.readerUrl} className="text-accent-rust hover:underline">Open the page</a>.
        </>
      }
    >
      <dl className="rounded-sm border border-border-light bg-white px-5 py-2">
        <RecordRow label="Image">
          Scan from {r.image.from}
          {r.image.sourceUrl && (
            <>
              {' '}(<a href={r.image.sourceUrl} className="text-accent-rust hover:underline">original</a>)
            </>
          )}
          {r.image.width && r.image.height && <>, {r.image.width} × {r.image.height} pixels</>}.
          {r.image.archivedAt && <> Our copy made {r.image.archivedAt}; the original address is kept.</>}
        </RecordRow>
        {r.text && (
          <RecordRow label="Transcription">
            Read by <Code>{r.text.model}</Code>
            {r.text.prompt && <>, with our prompt {r.text.prompt}</>}
            {r.text.at && <>, on {r.text.at}</>}.
          </RecordRow>
        )}
        {r.english && (
          <RecordRow label="English">
            Drafted by <Code>{r.english.model}</Code>
            {r.english.modelVersion && <> (version <Code>{r.english.modelVersion}</Code>)</>}
            {r.english.prompt && <>, prompt {r.english.prompt}</>}
            {r.english.api && <>, through the {r.english.api}</>}
            {r.english.at && <>, on {r.english.at}</>}.
            {r.english.batch && <> Run <Code>{r.english.batch}</Code>.</>}
            {r.english.hash && <> Fingerprint of the text: <Code>{r.english.hash}</Code>.</>}
          </RecordRow>
        )}
        {r.alignment && (
          <RecordRow label="Alignment">
            {r.alignment.pairs} phrase pairs link the original to the English, so a reader can select a word on one side and
            see it on the other. Each pairing stores fingerprints of both texts, so it is known to be stale if either changes.
          </RecordRow>
        )}
        <RecordRow label="Revisions">
          {r.revisions === 0
            ? 'None yet. When the text or English is corrected, the earlier version and the reason are kept as a revision, never overwritten.'
            : `${r.revisions} earlier version${r.revisions === 1 ? '' : 's'} kept. A correction is saved as a revision with its reason; nothing is overwritten.`}
        </RecordRow>
      </dl>
    </Figure>
  );
}

/* ── Figure 5: where people come in ─────────────────────────────────────────── */

export function PeopleFigure({ draftLabel }: { draftLabel: string }) {
  const box = 'rounded-sm border px-4 py-4';
  return (
    <Figure
      n={5}
      title="Where people come in"
      caption={
        <>
          The first layer is in place for every canon with a typed text or a published translation. The second has not
          started. Measurements, canon by canon, are on{' '}
          <a href="/research/canon-quality" className="text-accent-rust hover:underline">How we check each canon</a>.
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-3">
        <div className={`${box} border-border-light bg-white`}>
          <div className="font-sans text-xs font-semibold uppercase tracking-[0.1em] text-accent-rust mb-2">Now · people’s work as the yardstick</div>
          <p className="font-sans text-sm text-secondary leading-relaxed">
            Texts typed by people (Esukhia’s Derge, GRETIL, CBETA, Sefaria, Ganjoor) check our transcriptions. Translations
            published by people (84000, SuttaCentral) check our English, scored by two AI judges that do not know which
            version is ours.
          </p>
        </div>
        <div className={`${box} border-dashed border-border-medium`}>
          <div className="font-sans text-xs font-semibold uppercase tracking-[0.1em] text-accent-rust mb-2">Next · a scholar reads our pages</div>
          <p className="font-sans text-sm text-secondary leading-relaxed">
            Batches of pages, each with the image, the original and our English. The scholar marks what is wrong and whether
            they would start from this draft. Corrections become revisions; verdicts are set beside the AI judges’ on the
            same pages, which tells us how far to trust the AI judges on the rest.
          </p>
        </div>
        <div className={`${box} border-border-light bg-white`}>
          <div className="font-sans text-xs font-semibold uppercase tracking-[0.1em] text-accent-rust mb-2">Always · what the reader is told</div>
          <p className="font-sans text-sm text-secondary leading-relaxed">
            Until a page has been reviewed, its English carries the label:
          </p>
          <p className="mt-2 text-base italic text-primary">“{draftLabel}”</p>
          <p className="font-sans text-sm text-secondary leading-relaxed mt-2">Any reader can report a problem on any page.</p>
        </div>
      </div>
    </Figure>
  );
}

/* ── Figure 3: one page, tied to the rest of the library ────────────────────── */

const A = 'text-accent-rust hover:underline';

function Lane({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-sm border border-border-light bg-white px-4 py-4">
      <div className="font-sans text-xs font-semibold uppercase tracking-[0.1em] text-accent-rust mb-3">{label}</div>
      {children}
    </div>
  );
}

/**
 * The Connect step for the film's page, drawn from the same `JourneyConnect` the film's
 * Connect screens use: the search that finds it, the names its book's index ties to it,
 * and the other editions of the work. A lane with nothing in it is not drawn.
 */
export function ConnectFigure({ pageLabel, readerUrl, connect }: { pageLabel: string; readerUrl: string; connect: JourneyConnect }) {
  const { search, index, editions } = connect;
  if (!search && !index.length && !editions.length) return null;
  const link = <span aria-hidden className="hidden md:block h-px bg-border-medium" />;
  return (
    <Figure
      n={3}
      title="One page, tied to the rest of the library"
      caption="What the library holds for this page today. The search is re-run each day, and a connection that stops holding is dropped from the figure."
    >
      <div className="grid gap-3 md:gap-0 md:grid-cols-[1fr_1.5rem_13rem_1.5rem_1fr] md:items-center">
        <div>
          {search && (
            <Lane label="Found by meaning">
              <p className="font-sans text-sm text-secondary leading-snug mb-3">
                A search of the whole library for <span className="text-primary">“{search.query}”</span>:
              </p>
              <ol className="space-y-1.5">
                {search.results.slice(0, 5).map((r, i) => (
                  <li key={r.href} className={`flex gap-2 font-sans text-[13px] leading-snug ${r.here ? 'text-primary font-medium' : 'text-secondary'}`}>
                    <span className="text-muted tabular-nums">{i + 1}</span>
                    <a href={r.href} className={r.here ? A : 'hover:underline'}>
                      {r.title}, p. {r.page}
                      {r.here && <span className="text-accent-rust"> · this page</span>}
                    </a>
                  </li>
                ))}
              </ol>
            </Lane>
          )}
        </div>
        {search ? link : <span />}
        <a
          href={readerUrl}
          className="block rounded-sm border-2 border-accent-rust bg-white px-4 py-5 text-center hover:bg-cream transition-colors"
        >
          <span className="block font-sans text-xs font-semibold uppercase tracking-[0.1em] text-accent-rust mb-2">The page</span>
          <span className="block font-serif text-lg text-primary leading-snug">{pageLabel}</span>
          <span className="block font-sans text-[13px] text-muted mt-2">scan · transcription · English</span>
        </a>
        {index.length || editions.length ? link : <span />}
        <div className="space-y-3">
          {index.length > 0 && (
            <Lane label="Named in the book’s index">
              <ul className="flex flex-wrap gap-1.5">
                {index.slice(0, 10).map(x => (
                  <li key={x.href}>
                    <a
                      href={x.href}
                      className="inline-block rounded-sm border border-border-light px-2 py-0.5 font-sans text-[13px] text-secondary hover:border-accent-rust hover:text-accent-rust"
                    >
                      {x.name}
                    </a>
                  </li>
                ))}
              </ul>
              <p className="font-sans text-[12px] text-muted leading-snug mt-2">Each name leads to the other books in the library where it appears.</p>
            </Lane>
          )}
          {editions.length > 0 && (
            <Lane label="Other editions of the work">
              <ul className="space-y-1.5">
                {editions.slice(0, 5).map(e => (
                  <li key={e.href} className="font-sans text-[13px] text-secondary leading-snug">
                    <a href={e.href} className="hover:underline">{e.title}</a>
                    {(e.published || e.language) && (
                      <span className="text-muted"> · {[e.published, e.language].filter(Boolean).join(', ')}</span>
                    )}
                  </li>
                ))}
              </ul>
            </Lane>
          )}
        </div>
      </div>
    </Figure>
  );
}

/* ── Figure 6: what a library gives, and what comes back ────────────────────── */

function Column({ label, items, accent }: { label: string; items: ReactNode[]; accent?: boolean }) {
  return (
    <div className={`rounded-sm border px-4 py-4 h-full bg-white ${accent ? 'border-accent-rust/50' : 'border-border-light'}`}>
      <div className="font-sans text-xs font-semibold uppercase tracking-[0.1em] text-accent-rust mb-3">{label}</div>
      <ul className="space-y-2.5">
        {items.map((it, i) => (
          <li key={i} className="font-sans text-sm text-secondary leading-snug">{it}</li>
        ))}
      </ul>
    </div>
  );
}

const Flow = () => (
  <span aria-hidden className="flex items-center justify-center text-muted text-xl py-1 md:py-0">
    <span className="md:hidden">↓</span>
    <span className="hidden md:inline">→</span>
  </span>
);

export function ExchangeFigure() {
  return (
    <Figure n={6} title="What a library gives, and what comes back">
      <div className="grid md:grid-cols-[1fr_2rem_1fr_2rem_1.4fr] md:items-stretch">
        <Column
          label="The library gives"
          items={['Its page images, through IIIF or its own download.', 'A typed text of the book, where one has been made.']}
        />
        <Flow />
        <Column
          label="Source Library does"
          accent
          items={[
            'Find, read, translate, connect and publish (Figure 1).',
            'Checks on the published pages, again and again, with every correction kept as a revision.',
          ]}
        />
        <Flow />
        <Column
          label="What comes back"
          items={[
            <>
              <strong className="text-primary font-medium">Credit.</strong> The library is named on every book, and its pages
              link back to the original scan. <a href="/libraries" className={A}>Libraries</a>.
            </>,
            <>
              <strong className="text-primary font-medium">A reading room.</strong> The library’s books on their own site, as
              the Embassy of the Free Mind’s{' '}
              <a href="https://bph.sourcelibrary.org" className={A}>Bibliotheca Philosophica Hermetica</a> has.
            </>,
            <>
              <strong className="text-primary font-medium">Nothing locked in.</strong> A IIIF manifest and a full-text download
              for every book, a stable link to every page, DOIs for finished editions, and a{' '}
              <a href="/connect" className={A}>connector</a> for AI assistants.
            </>,
          ]}
        />
      </div>
    </Figure>
  );
}
