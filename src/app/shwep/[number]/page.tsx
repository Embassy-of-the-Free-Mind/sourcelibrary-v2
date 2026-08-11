import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getEpisodeData, getAllEpisodeNumbers } from '../shwep-data';
import { getWorksCitedForEpisode } from '../works-cited';
import type { CitedWorkEntry, EditionRef } from '../works-cited';
import SiteHeader from '@/components/layout/SiteHeader';

// Must be a finite number — `false` would cache a bad-render fallback forever
// (e.g. the noindex metadata below) until the next deploy.
export const revalidate = 21600;

interface Props {
  params: Promise<{ number: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { number } = await params;
  // No try/catch: letting a fetch failure throw here keeps ISR serving the
  // last good page instead of permanently caching noindex fallback metadata.
  const ep = await getEpisodeData(parseInt(number));
  if (!ep) return { title: 'Episode Not Found - Source Library', robots: { index: false, follow: true } };
  return {
    title: `${ep.title} - sources in Source Library`,
    description: ep.description || `Primary sources discussed in SHWEP episode ${ep.number}.`,
    // See the note in ../page.tsx: an alias domain does not inherit the preview
    // deployment's noindex, and this branch is shown privately pending the SHWEP's
    // author's say-so.
    robots: { index: false, follow: false },
    alternates: { canonical: `/shwep/${ep.number}` },
    openGraph: {
      images: [{ url: 'https://sourcelibrary.org/og-image.jpg', alt: 'Source Library — Digitizing and translating ancient texts' }],
      title: `${ep.title} - sources in Source Library`,
      description: ep.description || `Primary sources discussed in SHWEP episode ${ep.number}.`,
      url: `https://sourcelibrary.org/shwep/${ep.number}`,
    },
  };
}

function formatDate(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });
}

export default async function EpisodePage({ params }: Props) {
  const { number } = await params;
  const epNum = parseInt(number);
  if (isNaN(epNum)) notFound();

  const [episode, citedWorks] = await Promise.all([
    getEpisodeData(epNum),
    getWorksCitedForEpisode(epNum),
  ]);
  if (!episode) notFound();

  const heldWorks = citedWorks.filter(w => w.held);
  const editionCount = heldWorks.reduce((n, w) => n + w.editions.length + w.moreEditions.length, 0);
  const absentWorks = citedWorks.filter(w => !w.held);

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6]">
      {/* Header */}
      <SiteHeader variant="light" breadcrumbs={[{ label: 'Sources discussed on SHWEP', href: '/shwep' }]} />

      {/* Caveat */}
      <div className="bg-stone-100 border-b border-stone-200">
        <div className="max-w-5xl mx-auto px-6 py-2.5 text-sm text-stone-500">
          Source Library provides the primary texts — we are not affiliated with{' '}
          <a href="https://shwep.net" target="_blank" rel="noopener noreferrer" className="text-accent-rust underline">SHWEP</a>.
        </div>
      </div>

      {/* Episode header */}
      <div className="bg-gradient-to-b from-stone-800 to-stone-900 text-white py-12 md:py-16">
        <div className="max-w-5xl mx-auto px-6">
          <div className="flex items-center gap-3 mb-4 text-sm text-stone-400">
            <span>Episode {episode.number}</span>
            {episode.publishDate && (
              <>
                <span>&middot;</span>
                <span>{formatDate(episode.publishDate)}</span>
              </>
            )}
            <span>&middot;</span>
            <span>{episode.period}</span>
          </div>

          <h1 className="text-3xl md:text-4xl lg:text-5xl font-serif leading-tight mb-4">
            {episode.title}
          </h1>

          {episode.description && (
            <p className="text-lg text-stone-300 max-w-3xl leading-relaxed">
              {episode.description}
            </p>
          )}

          <div className="mt-6 flex items-center gap-4">
            <a
              href={episode.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white text-sm font-medium transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              </svg>
              Listen on SHWEP
            </a>
            {heldWorks.length > 0 && (
              <span className="text-sm text-stone-400">
                {heldWorks.length} cited work{heldWorks.length !== 1 ? 's' : ''} held here
                {editionCount > 0 && ` · ${editionCount} edition${editionCount !== 1 ? 's' : ''}`}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* The bibliography proper: one entry per work the episode cites, carrying the
            editions of it we hold. This is the part that is ours — Earl's own prose sits
            below it, attributed, rather than being the substance of the page. */}
        {heldWorks.length > 0 && (
          <section className="mb-10">
            <h2 className="text-xl font-serif text-stone-800 mb-1">Works cited in this episode</h2>
            <p className="text-sm text-stone-500 mb-6">
              {heldWorks.length} work{heldWorks.length !== 1 ? 's' : ''} discussed in this episode {heldWorks.length !== 1 ? 'are' : 'is'} held here,
              in {editionCount} editions.
              Where several editions survive they are listed together, because a manuscript, an early printing and a later translation are different objects.
            </p>
            <ul className="space-y-5">
              {heldWorks.map(w => (
                <li key={`${w.author}-${w.work}`}>
                  <WorkEntry entry={w} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {absentWorks.length > 0 && (
          <section className="mb-10">
            {/* NOT "not in the library" — that claim is unsafe. Psellos' Epistle on
                Chrysopoeia shows here while we hold it, because it sits inside a volume
                titled "Catalogue des manuscrits alchimiques grecs, Vol. VI"; the matcher
                searches work titles and never sees the container. Until a gap audit runs
                against the full catalogue, say only what is true: we have not matched a
                copy to this citation. */}
            <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500 mb-1">
              Also cited, no copy matched here yet
            </h2>
            <p className="text-sm text-stone-500 mb-3">
              We may still hold one of these inside a larger volume — collected works and
              catalogues hide their contents from the matcher. Often the edition he cites
              cannot be here at all (still in copyright); where we hold something a reader
              of that work would want anyway — a commentary, the author&rsquo;s other
              works, excerpts — it is listed beneath the name.
            </p>
            <ul className="text-[15px] text-stone-600 leading-relaxed columns-1 sm:columns-2 gap-8">
              {absentWorks.map(w => (
                <li key={`${w.author}-${w.work}`} className="break-inside-avoid mb-1.5">
                  <span className="text-stone-800">{w.author}</span>
                  {w.author && w.work ? ', ' : ''}
                  <em>{w.work}</em>
                  {w.related && w.related.length > 0 && (
                    <ul className="mt-0.5 mb-2 ml-4 text-sm text-stone-500">
                      {w.related.map(r => (
                        <li key={r.url}>
                          <span className="text-stone-400">{r.relation}:</span>{' '}
                          <a href={r.url} className="text-accent-rust underline">
                            {r.title}
                          </a>
                          {r.year ? <span className="text-stone-400"> ({r.year})</span> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* His bibliography, reproduced as he published it. We used to splice our own
            /book/ links into these sentences, which made his citation of one edition look
            like a pointer to a different edition we happen to hold — his "frr. 153-4" is
            Des Places/Majercik and finds nothing in our Patrizi. Our holdings belong in
            our own section above, not inside his prose. */}
        {episode.bibliography && (
          <section className="mb-10">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-2">
              <h2 className="text-xl font-serif text-stone-800">Reading List</h2>
              <p className="text-xs text-stone-500">
                Compiled by{' '}
                <a href="https://shwep.net" target="_blank" rel="noopener noreferrer" className="text-accent-rust underline">Earl Fontainelle</a>
                {' '}for SHWEP ·{' '}
                <a href={episode.url} target="_blank" rel="noopener noreferrer" className="text-accent-rust underline">view on shwep.net</a>
              </p>
            </div>
            <p className="text-sm text-stone-500 mb-4">
              Reproduced as published, unedited. Any links in it are his own.
            </p>
            <div className="rounded-xl bg-white border border-stone-200 shadow-sm p-6 md:p-7">
              <ReadingList markdown={episode.bibliography} />
            </div>
          </section>
        )}

        {/* Provenance. A reader cannot otherwise tell whose voice is whose on a page
            headed with someone else's name, and several fields here are machine-derived.
            Saying so plainly is the difference between a citation and an assertion. */}
        <section className="mt-12 pt-8 border-t border-stone-200">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500 mb-2">
            What is on this page, and whose it is
          </h2>
          <div className="text-sm text-stone-500 space-y-1.5 max-w-3xl">
            <p>
              <strong className="text-stone-700 font-medium">Earl Fontainelle&rsquo;s, quoted:</strong>{' '}
              the reading list and every sentence in quotation marks, verbatim from{' '}
              <a href={episode.url} target="_blank" rel="noopener noreferrer" className="text-accent-rust underline">
                this episode&rsquo;s page on shwep.net
              </a>
              . We have not paraphrased his words, and we no longer place our own links
              inside his sentences.
            </p>
            <p>
              <strong className="text-stone-700 font-medium">Ours:</strong> which editions Source Library
              holds, and the links to read them.
            </p>
            <p>
              <strong className="text-stone-700 font-medium">Machine-derived, and therefore fallible:</strong>{' '}
              which works this episode cites, each work&rsquo;s date and composition language, how each
              edition is labelled, and which page a citation points to. A passage link says{' '}
              &ldquo;read the cited passage&rdquo; only where a mark printed on the page itself places it
              at his locus; otherwise it says only that the page treats the same matter.
            </p>
            <p className="pt-1">
              His citations index the editions <em>he</em> names, not ours &mdash; a fragment or page
              number will not carry across. Where he names an edition, it is shown beside ours.
            </p>
          </div>
        </section>

        {/* Back link */}
        <div className="mt-10 pt-8 border-t border-stone-200">
          <Link href="/shwep" className="text-sm text-stone-500 hover:text-stone-700 transition-colors">
            &larr; Back to all episodes
          </Link>
        </div>
      </div>
    </div>
  );
}

const ROLE_STYLE: Record<EditionRef['role'], string> = {
  critical: 'bg-amber-50 text-amber-800 border-amber-200',
  princeps: 'bg-amber-50 text-amber-800 border-amber-200',
  manuscript: 'bg-violet-50 text-violet-800 border-violet-200',
  edition: 'bg-stone-100 text-stone-600 border-stone-200',
  translation: 'bg-green-50 text-green-700 border-green-200',
};

function EditionRow({ edition }: { edition: EditionRef }) {
  return (
    <li>
      <Link
        href={edition.url}
        className="group flex flex-wrap items-baseline gap-x-2 gap-y-1 py-1.5 border-b border-stone-100 last:border-0"
      >
        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${ROLE_STYLE[edition.role]}`}>
          {edition.roleLabel}
        </span>
        <span className="text-[15px] text-stone-700 group-hover:text-accent-rust transition-colors">
          {edition.title}
        </span>
        {edition.year && <span className="text-sm text-stone-400 tabular-nums">{edition.year}</span>}
        {/* Only worth saying on a non-English edition — on an English translation it is
            the same fact twice. */}
        {edition.translated && edition.role !== 'translation' && (
          <span className="text-xs text-green-700">· translated here</span>
        )}
        {edition.alsoCopies > 0 && (
          <span className="text-xs text-stone-400">
            · {edition.alsoCopies} further cop{edition.alsoCopies === 1 ? 'y' : 'ies'}
          </span>
        )}
      </Link>
    </li>
  );
}

function WorkEntry({ entry }: { entry: CitedWorkEntry }) {
  const total = entry.editions.length + entry.moreEditions.length;
  return (
    <div className="rounded-xl bg-white border border-stone-200 shadow-sm p-5">
      <h3 className="font-serif text-lg text-stone-800 leading-snug">
        {entry.author && <span className="text-stone-600">{entry.author}, </span>}
        <em>{entry.work}</em>
      </h3>
      <p className="text-xs uppercase tracking-wide text-stone-400 mt-0.5">
        {entry.era}
        {entry.workLanguage && ` · written in ${entry.workLanguage}`}
      </p>

      {/* HIS words, quoted — never our summary of them. Without this an entry reads as an
          arbitrary match: a Jacobean comedy on a Byzantine alchemy episode looks like a
          mistake until you see the sentence that cites it. */}
      {entry.quote && (
        <blockquote className="mt-3 pl-3 border-l-2 border-stone-200">
          {/* His emphasis is markdown in the scrape, and work titles carry meaning in a
              bibliography — render it rather than printing literal asterisks. Formatting
              only; the words are untouched. */}
          <div className="text-[15px] text-stone-700 leading-relaxed">
            &ldquo;
            <ReactMarkdown
              components={{
                p: ({ children }) => <span>{children}</span>,
                em: ({ children }) => <em className="italic">{children}</em>,
                strong: ({ children }) => <em className="italic">{children}</em>,
                a: ({ children }) => <>{children}</>,
              }}
            >
              {entry.quote}
            </ReactMarkdown>
            &rdquo;
          </div>
          <cite className="block not-italic text-xs text-stone-400 mt-1">
            Earl Fontainelle, SHWEP
            {entry.quoteSharedWith?.length ? ` — cited here alongside ${entry.quoteSharedWith.join('; ')}` : ''}
          </cite>
        </blockquote>
      )}
      {entry.quoteEchoOf && (
        <p className="text-sm text-stone-400 mt-2">Cited in the same sentence as {entry.quoteEchoOf}, above.</p>
      )}

      {/* His locus indexes HIS edition. Saying so is the only honest way to offer ours:
          "frr. 153-4" is Des Places/Majercik and finds nothing in our Patrizi. */}
      {entry.citedEdition && (
        <p className="text-sm text-stone-500 mt-2">
          <span className="text-stone-400">He cites:</span> {entry.citedEdition}
          {entry.editions[0] && (
            <>
              {' '}<span className="text-stone-400">· we hold:</span> {entry.editions[0].title}
            </>
          )}
        </p>
      )}

      {/* Land on the passage, not the front of a folio — but claim only what was checked.
          "confirmed" means a mark on the page itself places it at his locus; otherwise the
          page merely discusses the matter and the wording must not imply more. */}
      {entry.passage && (
        <Link
          href={entry.passage.url}
          className="group inline-flex flex-wrap items-baseline gap-x-1.5 mt-2 text-[15px] text-accent-rust font-medium hover:underline underline-offset-2"
        >
          {entry.passage.locus === 'confirmed' ? 'Read the cited passage' : 'A page on this in our copy'}
          <span className="text-sm font-normal text-stone-500 group-hover:text-stone-600">
            p.{entry.passage.pageNumber} · {entry.passage.edition}
            {entry.passage.locus === 'confirmed' && entry.passage.mark ? ` · ${entry.passage.mark}` : ''}
          </span>
        </Link>
      )}

      <ul className="mt-3">
        {entry.editions.map(e => <EditionRow key={e.id} edition={e} />)}
      </ul>

      {entry.moreEditions.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm text-stone-500 hover:text-stone-700">
            All {total} editions held
          </summary>
          <ul className="mt-2">
            {entry.moreEditions.map(e => <EditionRow key={e.id} edition={e} />)}
          </ul>
        </details>
      )}
    </div>
  );
}

function ReadingList({ markdown }: { markdown: string }) {
  return (
    <div className="text-[15px] leading-relaxed text-stone-700">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500 mt-5 mb-2 first:mt-0">{children}</h3>,
          h2: ({ children }) => <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500 mt-5 mb-2 first:mt-0">{children}</h3>,
          h3: ({ children }) => <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500 mt-5 mb-2 first:mt-0">{children}</h3>,
          h4: ({ children }) => <h4 className="text-xs font-semibold uppercase tracking-wide text-stone-500 mt-4 mb-2">{children}</h4>,
          p: ({ children }) => <p className="my-2.5">{children}</p>,
          ul: ({ children }) => <ul className="my-2.5 space-y-1.5 list-disc pl-5 marker:text-stone-300">{children}</ul>,
          ol: ({ children }) => <ol className="my-2.5 space-y-1.5 list-decimal pl-5 marker:text-stone-300">{children}</ol>,
          li: ({ children }) => <li className="pl-1">{children}</li>,
          em: ({ children }) => <em className="italic">{children}</em>,
          strong: ({ children }) => <strong className="font-semibold text-stone-800">{children}</strong>,
          a: ({ href, children }) => {
            // Internal /book/ links are works we hold — render as a same-tab Source Library
            // link with a "read here" book affordance. External refs (Earl's own links,
            // JSTOR, Wikipedia, cross-episode) open in a new tab as before.
            if (href?.startsWith('/')) {
              return (
                <Link href={href} className="text-accent-rust underline decoration-accent-rust/40 underline-offset-2 hover:decoration-accent-rust font-medium whitespace-nowrap">
                  {children}
                  <svg className="inline-block w-3.5 h-3.5 ml-0.5 -mt-0.5 align-middle" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                </Link>
              );
            }
            return <a href={href} target="_blank" rel="noopener noreferrer" className="text-stone-500 underline decoration-stone-300 underline-offset-2 hover:text-stone-700">{children}</a>;
          },
          hr: () => <hr className="my-4 border-stone-200" />,
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
