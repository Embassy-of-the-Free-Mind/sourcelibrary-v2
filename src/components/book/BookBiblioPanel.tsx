import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import type { Book, SourceWorkDateLayer } from '@/lib/types/book';
import { cleanOriginalTitle, isNonLatinScript } from '@/lib/original-title';
import { resolveImprintPlace } from '@/lib/imprint';
import { resolveHoldingLibrary } from '@/lib/library-partners';
import type { Locale } from '@/lib/locale-path';

// The panel's chrome, by the page's language: Spanish and Chinese since #7496 (every
// /es and /zh book page renders); Latin and Dutch read English labels until they get theirs.
const LABELS = {
  en: {
    title: 'Title', english: 'English', author: 'Author', language: 'Language', publisher: 'Publisher',
    published: 'Published', format: 'Format', pages: 'Pages', sourceWork: 'Source Work', provenance: 'Provenance',
    heldBy: 'Held by', scansFrom: 'Scans from', originalRecord: 'Original record', digitizedBy: 'Digitized by',
    shelfmark: 'Shelfmark', license: 'License', estimated: 'estimated', printedOnOpening: 'Printed on the opening leaves:',
    fromCatalogue: 'From the catalogue record', statedInColophon: 'Stated in the colophon:', fromWikidata: 'From Wikidata',
    whyThisDate: 'Why this date:', fromAuthorDates: 'From the author’s recorded dates',
    layer: {} as Record<string, string>,
  },
  es: {
    title: 'Título', english: 'En inglés', author: 'Autor', language: 'Lengua', publisher: 'Pie de imprenta',
    published: 'Publicado', format: 'Formato', pages: 'Páginas', sourceWork: 'Obra original', provenance: 'Procedencia',
    heldBy: 'Conservado en', scansFrom: 'Digitalización de', originalRecord: 'Registro original', digitizedBy: 'Digitalizado por',
    shelfmark: 'Signatura', license: 'Licencia', estimated: 'estimada', printedOnOpening: 'Impreso en las primeras hojas:',
    fromCatalogue: 'Del registro de catálogo', statedInColophon: 'Indicado en el colofón:', fromWikidata: 'De Wikidata',
    whyThisDate: 'Por qué esta fecha (en inglés):', fromAuthorDates: 'De las fechas registradas del autor',
    layer: { composition: 'Composición', compilation: 'Compilación', edition: 'Edición', translation: 'Traducción', commentary: 'Comentario', revision: 'Revisión' } as Record<string, string>,
  },
  zh: {
    title: '题名', english: '英文题名', author: '作者', language: '语言', publisher: '出版信息',
    published: '出版', format: '开本', pages: '页数', sourceWork: '原作', provenance: '来源',
    heldBy: '收藏机构', scansFrom: '扫描来源', originalRecord: '原始记录', digitizedBy: '数字化者',
    shelfmark: '索书号', license: '许可', estimated: '估计', printedOnOpening: '见于卷首：',
    fromCatalogue: '据馆藏目录', statedInColophon: '见于版记：', fromWikidata: '据 Wikidata',
    whyThisDate: '断代依据（英文）：', fromAuthorDates: '据作者生卒年',
    layer: { composition: '成书', compilation: '编纂', edition: '版本', translation: '翻译', commentary: '注释', revision: '修订' } as Record<string, string>,
  },
};

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
  lang = 'en',
}: {
  book: Book;
  pagesCount: number;
  showExternalLinks?: boolean;
  lang?: Locale;
}) {
  const t = lang === 'es' || lang === 'zh' ? LABELS[lang] : LABELS.en;
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
  // the reason for an estimated WORK date goes under the work's layer (the first composition/compilation one)
  const work = book.source_work_dates_meta?.work;
  // not where the reason itself argues for another date (why_disagrees, ~2,300 books): a reader would see a reason that
  // contradicts the date beside it; those wait until the conflict is resolved
  const whyLayer = work?.basis === 'model_knowledge' && work.why
    && !book.source_work_dates_meta?.checks?.includes('why_disagrees')
    ? layers.find((l) => l.type === 'composition' || l.type === 'compilation') : undefined;
  const layerLine = (l: SourceWorkDateLayer) => (
    <>
      {l.author && <span>{l.author}</span>}
      {l.work_title && <span className="italic">{l.author ? ', ' : ''}{l.work_title}</span>}
      {(l.language || l.date_display) && (
        <span style={{ color: '#948d80' }}>
          {' '}({[l.language, l.date_display].filter(Boolean).join(', ')}{estimated(l) ? `, ${t.estimated}` : ''})
        </span>
      )}
      {l.basis === 'title_page' && l.evidence && (
        <span className="block text-[13px]" style={{ color: '#948d80' }}>
          {t.printedOnOpening} <span className="italic">“{l.evidence}”</span>
        </span>
      )}
      {l.basis === 'catalogue' && (
        <span className="block text-[13px]" style={{ color: '#948d80' }}>{t.fromCatalogue}</span>
      )}
      {l.basis === 'colophon' && l.evidence && (
        <span className="block text-[13px]" style={{ color: '#948d80' }}>
          {t.statedInColophon} <span className="italic">“{l.evidence}”</span>
        </span>
      )}
      {l.basis === 'wikidata' && (
        <span className="block text-[13px]" style={{ color: '#948d80' }}>{t.fromWikidata}</span>
      )}
      {l === whyLayer && l.basis === 'model_knowledge' && (
        <span className="block text-[13px]" style={{ color: '#948d80' }}>{t.whyThisDate} {work?.why}</span>
      )}
      {l.basis === 'author_lifespan' && (
        <span className="block text-[13px]" style={{ color: '#948d80' }}>{t.fromAuthorDates}</span>
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
          return <Row label={t.title}><span className={isNonLatinScript(original) ? '' : 'italic'}>{original}</span></Row>;
        })()}
        {book.display_title && book.display_title !== book.title && <Row label={t.english}>{book.display_title}</Row>}
        {book.author && <Row label={t.author}>{book.author}</Row>}
        {book.language && <Row label={t.language}>{book.language}</Row>}
        {impressum && <Row label={t.publisher}>{impressum}</Row>}
        {book.published && <Row label={t.published}>{String(book.published)}</Row>}
        {book.format && <Row label={t.format}>{book.format}</Row>}
        {pagesCount > 0 && <Row label={t.pages}>{pagesCount}</Row>}
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
          <SectionLabel>{t.sourceWork}</SectionLabel>
          <div className="divide-y" style={{ borderColor: '#ece6da' }}>
            {layers.map((l, i) => (
              <Row key={i} label={t.layer[l.type] ?? l.type.charAt(0).toUpperCase() + l.type.slice(1)}>{layerLine(l)}</Row>
            ))}
          </div>
        </>
      )}

      {src && (src.provider_name || src.source_url || holder) && (
        <>
          <SectionLabel>{t.provenance}</SectionLabel>
          <div className="divide-y" style={{ borderColor: '#ece6da' }}>
            {holder && (
              <Row label={t.heldBy}>
                <span className="font-semibold" style={{ color: '#2b2620' }}>{holder}</span>
              </Row>
            )}
            {(src.provider_name || src.source_url) && (
              <Row label={t.scansFrom}>
                {showExternalLinks && src.source_url ? (
                  <Link href={src.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline" style={{ color: '#a5503d' }}>
                    {src.provider_name || t.originalRecord}<ExternalLink className="w-3 h-3" />
                  </Link>
                ) : (src.provider_name || '–')}
              </Row>
            )}
            {src.digitized_by && <Row label={t.digitizedBy}>{src.digitized_by}</Row>}
            {src.shelfmark && <Row label={t.shelfmark}>{src.shelfmark}</Row>}
            {src.license && <Row label={t.license}>{src.license}</Row>}
          </div>
        </>
      )}
    </div>
  );
}
