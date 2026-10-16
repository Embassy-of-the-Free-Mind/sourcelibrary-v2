import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import type { Book, SourceWorkDateLayer } from '@/lib/types/book';
import { cleanOriginalTitle, isNonLatinScript } from '@/lib/original-title';
import { resolveImprintPlace } from '@/lib/imprint';
import { resolveHoldingLibrary } from '@/lib/library-partners';

/**
 * Light-themed bibliographic panel for the book page's "Bibliographic
 * information" dropdown. Purpose-built for the cream card (the full
 * `BibliographicInfo` component is dark-themed and self-collapsing, and is
 * still used in dark contexts — the cite modal and the embedded hero).
 */

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4 py-1.5">
      <span className="w-24 md:w-28 flex-shrink-0 text-[13.5px]" style={{ color: '#948d80' }}>{label}</span>
      <span className="flex-1 min-w-0 text-[14.5px] [overflow-wrap:anywhere]" style={{ color: '#2b2620' }}>{children}</span>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="font-mono uppercase text-[11px] tracking-[0.14em] mt-5 mb-1.5" style={{ color: '#a5503d' }}>{children}</div>;
}

export default function BookBiblioPanel({
  book,
  pagesCount,
  showExternalLinks = true,
}: {
  book: Book;
  pagesCount: number;
  showExternalLinks?: boolean;
}) {
  const src = book.image_source;
  const holder = resolveHoldingLibrary(src);
  const layers = (book.source_work_dates ?? []) as SourceWorkDateLayer[];
  const place = resolveImprintPlace(book)?.display; // family resolver, #4043
  const publisher = book.publisher?.trim();
  const impressum = [place, publisher].filter(Boolean).join(', ');

  // #6721: say what each date rests on. A date the opening leaves print shows their words; a scholarly estimate
  // (every schema-1 layer, written by enrichment, is one) says so.
  const estimated = (l: SourceWorkDateLayer) =>
    l.basis ? l.basis === 'model_knowledge' : book.source_work_dates_meta?.source === 'ai_enrichment';
  const layerLine = (l: SourceWorkDateLayer) => (
    <>
      {l.author && <span>{l.author}</span>}
      {l.work_title && <span className="italic">{l.author ? ', ' : ''}{l.work_title}</span>}
      {(l.language || l.date_display) && (
        <span style={{ color: '#948d80' }}>
          {' '}({[l.language, l.date_display].filter(Boolean).join(', ')}{estimated(l) ? ', estimated' : ''})
        </span>
      )}
      {l.basis === 'title_page' && l.evidence && (
        <span className="block text-[13px]" style={{ color: '#948d80' }}>
          Printed on the opening leaves: <span className="italic">“{l.evidence}”</span>
        </span>
      )}
      {l.basis === 'catalogue' && (
        <span className="block text-[13px]" style={{ color: '#948d80' }}>From the catalogue record</span>
      )}
      {l.basis === 'colophon' && l.evidence && (
        <span className="block text-[13px]" style={{ color: '#948d80' }}>
          Stated in the colophon: <span className="italic">“{l.evidence}”</span>
        </span>
      )}
      {l.basis === 'wikidata' && (
        <span className="block text-[13px]" style={{ color: '#948d80' }}>From Wikidata</span>
      )}
      {l.basis === 'author_lifespan' && (
        <span className="block text-[13px]" style={{ color: '#948d80' }}>From the author’s recorded dates</span>
      )}
    </>
  );

  return (
    <div className="text-[14.5px]" style={{ color: '#2b2620' }}>
      <div className="divide-y" style={{ borderColor: '#ece6da' }}>
        {book.title && (() => {
          const original = cleanOriginalTitle(book.title);
          if (!original) return null;
          // Latin-alphabet titles italicise; titles in their own script stand upright.
          return <Row label="Title"><span className={isNonLatinScript(original) ? '' : 'italic'}>{original}</span></Row>;
        })()}
        {book.display_title && book.display_title !== book.title && <Row label="English">{book.display_title}</Row>}
        {book.author && <Row label="Author">{book.author}</Row>}
        {book.language && <Row label="Language">{book.language}</Row>}
        {impressum && <Row label="Publisher">{impressum}</Row>}
        {book.published && <Row label="Published">{String(book.published)}</Row>}
        {book.format && <Row label="Format">{book.format}</Row>}
        {pagesCount > 0 && <Row label="Pages">{pagesCount}</Row>}
        {book.doi && (
          <Row label="DOI">
            {showExternalLinks ? (
              <a href={`https://doi.org/${book.doi}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline" style={{ color: '#a5503d' }}>
                {book.doi}<ExternalLink className="w-3 h-3" />
              </a>
            ) : book.doi}
          </Row>
        )}
        {book.ustc_id && <Row label="USTC">{book.ustc_id}</Row>}
      </div>

      {layers.length > 0 && (
        <>
          <SectionLabel>Source Work</SectionLabel>
          <div className="divide-y" style={{ borderColor: '#ece6da' }}>
            {layers.map((l, i) => (
              <Row key={i} label={l.type.charAt(0).toUpperCase() + l.type.slice(1)}>{layerLine(l)}</Row>
            ))}
          </div>
        </>
      )}

      {src && (src.provider_name || src.source_url || holder) && (
        <>
          <SectionLabel>Provenance</SectionLabel>
          <div className="divide-y" style={{ borderColor: '#ece6da' }}>
            {holder && (
              <Row label="Held by">
                <span className="font-semibold" style={{ color: '#2b2620' }}>{holder}</span>
              </Row>
            )}
            {(src.provider_name || src.source_url) && (
              <Row label="Scans from">
                {showExternalLinks && src.source_url ? (
                  <Link href={src.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline" style={{ color: '#a5503d' }}>
                    {src.provider_name || 'Original record'}<ExternalLink className="w-3 h-3" />
                  </Link>
                ) : (src.provider_name || '–')}
              </Row>
            )}
            {src.digitized_by && <Row label="Digitized by">{src.digitized_by}</Row>}
            {src.shelfmark && <Row label="Shelfmark">{src.shelfmark}</Row>}
            {src.license && <Row label="License">{src.license}</Row>}
          </div>
        </>
      )}
    </div>
  );
}
