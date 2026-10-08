/**
 * Corpus-edition provenance — issue #4350.
 *
 * A minority of books hold no page images at all: their text was imported
 * verbatim from a scholarly corpus (356 of 378 visible Sumerian books are
 * ETCSL editions). The rows mark this as `ocr.source: 'corpus'` and/or a
 * model id ending in `-corpus`. Every reader surface that describes how a
 * page was made must branch on this — the default wording ("photographed…",
 * "read from the scan by…", "AI translated") is FALSE for these pages, in
 * both directions: there is no scan, and (for ETCSL) the English is a human
 * scholarly translation, not machine output.
 *
 * Registry note: ETCSL translations are the corpus's own (human). ORAEC
 * transliterations are corpus, but their English is our AI translation —
 * which is why text and translation are inspected separately below.
 */
import type { Page } from '@/lib/types';

export interface CorpusInfo {
  /** Model-id key, e.g. 'etcsl-corpus'. */
  key: string;
  /** Short label for chips and captions, e.g. 'ETCSL'. */
  shortName: string;
  /** Full name for the provenance record. */
  name: string;
  /** Publishing institution, when one exists. */
  org?: string;
  url?: string;
}

const CORPUS_REGISTRY: Record<string, CorpusInfo> = {
  'etcsl-corpus': {
    key: 'etcsl-corpus',
    shortName: 'ETCSL',
    name: 'Electronic Text Corpus of Sumerian Literature',
    org: 'University of Oxford',
    url: 'https://etcsl.orinst.ox.ac.uk/',
  },
  'oraec-corpus': {
    key: 'oraec-corpus',
    shortName: 'ORAEC',
    name: 'Open Richly Annotated Egyptian Corpus',
    url: 'https://oraec.github.io/',
  },
};

/** Unrecognised `*-corpus` models still get honest, if generic, wording. */
const GENERIC_CORPUS: CorpusInfo = {
  key: 'corpus',
  shortName: 'corpus',
  name: 'scholarly text corpus',
};

function corpusFor(source?: string | null, model?: string | null): CorpusInfo | null {
  if (model && CORPUS_REGISTRY[model]) return CORPUS_REGISTRY[model];
  if (source === 'corpus' || (model && model.endsWith('-corpus'))) return GENERIC_CORPUS;
  return null;
}

/** The corpus this page's original-language text came from, or null. */
export function pageTextCorpus(page: Pick<Page, 'ocr'>): CorpusInfo | null {
  return corpusFor(page.ocr?.source, page.ocr?.model);
}

/**
 * The corpus this page's TRANSLATION came from, or null. Non-null means the
 * English is human scholarly work — never label it as AI output.
 */
export function translationCorpus(page: Pick<Page, 'translation'>): CorpusInfo | null {
  return corpusFor(page.translation?.source, page.translation?.model);
}

// ── Transcript provenance, one helper for every surface (#5186) ──────────────
//
// Who read this page used to be answered only in the ⓘ drawer, so nobody saw
// it — and the drawer and any header that tried to say the same thing could
// drift apart. Both now derive from `transcriptProvenance()`; the words come
// from `transcriptProvenanceLabel()` in short (chip) or full (drawer) form.

import type { ReaderStrings } from '@/lib/reader-strings';

// ── Open e-text sources and their licences (#5571) ───────────────────────────
//
// Three lanes write page text from an open e-text fitted to OUR scan: the
// Esukhia Derge Tengyur/Kangyur (#5497, public domain), Sefaria (#5560, licence
// per version) and CBETA (#5566, CC BY-NC-SA). The text's licence is not the
// scan's (`image_source.license`), and a reader quoting the page needs both.
// Tengyur and Sefaria store `ocr.text_source`; CBETA stores its licence only in
// `ocr.text_edition.licence`. This is the one place both shapes are read.

export interface TextSourceInfo {
  /** Short name for the pane-header chip, e.g. 'CBETA'. */
  shortName: string;
  /** Full name for the drawer, e.g. 'Esukhia digital Derge Tengyur'. */
  name: string;
  url: string | null;
  license: string;
  licenseUrl: string | null;
  /** Which version of the e-text, e.g. 'T51n2076@1a2b3c4d5e'. */
  version: string | null;
}

/** `ocr.source` → the name a reader knows the source by. */
const TEXT_SOURCE_SHORT: Record<string, string> = {
  'esukhia-derge-tengyur': 'Esukhia',
  'esukhia-derge-kangyur': 'Esukhia',
  'cbeta-xml-p5': 'CBETA',
  sefaria: 'Sefaria',
};

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * A licence as a reader reads it. Writers append glosses ("public domain — 'mechanical
 * reproduction…' (Esukhia README)", "CC BY-NC-SA 4.0 (CBETA)") that belong in the
 * record, not the label.
 */
function licenseLabel(raw: string): string {
  const s = raw.split(' — ')[0].replace(/\s*\([^)]*\)\s*$/, '').trim() || raw.trim();
  return /^public domain$/i.test(s) ? 'public domain' : s;
}

/** Where this page's text came from and its licence, or null when it was read from the scan. */
export function pageTextSource(page: Pick<Page, 'ocr'>): TextSourceInfo | null {
  const ocr = page.ocr;
  if (!ocr) return null;
  const ts = ocr.text_source;
  const te = ocr.text_edition;
  const name = str(ts?.name) ?? str(te?.name);
  const license = str(ts?.license) ?? str(te?.licence);
  // No licence, no label: an unlicensed claim is worse than none, and each lane's
  // publish step asserts the licence is there (#5571).
  if (!name || !license) return null;
  const shortName = (ocr.source && TEXT_SOURCE_SHORT[ocr.source]) || name.split(' — ')[0];
  const version = str(ts?.version)
    ?? (str(te?.work) ? `${te!.work}${str(te?.commit) ? `@${String(te!.commit).slice(0, 10)}` : ''}` : null);
  return {
    shortName,
    name,
    url: str(ts?.url) ?? str(te?.repo),
    license: licenseLabel(license),
    licenseUrl: str(ts?.license_url) ?? str(te?.licence_url),
    version,
  };
}

/**
 * True when this page's English is a machine translation that no person has
 * reviewed or edited — the reader says so beside it. Corpus translations,
 * Sefaria's own English (`source: 'manual'`), hand edits and any provenance we do
 * not recognise are never called machine drafts (see `ContentSource`).
 */
export function isUnreviewedMachineTranslation(page: Pick<Page, 'translation'>): boolean {
  const tr = page.translation;
  if (!tr?.data || !tr.model) return false;
  if (translationCorpus(page)) return false;
  if (tr.edited_by || tr.edited_at) return false;
  return tr.source == null || tr.source === 'ai' || tr.source === 'batch_api';
}

export type TranscriptProvenance =
  /** Open e-text fitted to this scan (#5571) — not read from it, and under its own licence. */
  | { kind: 'text_source'; source: TextSourceInfo }
  /** Text imported from a scholarly corpus (#4350) — no scan, no OCR. */
  | { kind: 'corpus'; corpus: CorpusInfo }
  /** The Internet Archive's own OCR of the leaf (`ocr.source === 'ia_djvu'`). */
  | { kind: 'ia'; engine: string | null; year: string | null; agreement: number | null }
  /** Written or corrected by a person; `model` is what they started from, if known. */
  | { kind: 'manual'; model: string | null }
  /** Syriac read by a specialist Kraken model (#4883): Sophro Mhiro for
   *  manuscripts, omnisyr for print. Named, with its measured accuracy. */
  | { kind: 'kraken'; route: 'manuscript' | 'print' }
  /** Read from the scan by a model in the ordinary pipeline. */
  | { kind: 'model'; model: string };

/**
 * How this page's transcript was made, or null when nothing says.
 *
 * `ia_djvu` rows come in two shapes and this must not crash on either: the
 * ingest (scripts/import/ia-ocr-ingest.mjs) writes an `ocr.ia` block with the
 * engine and the Archive's OCR date; the provisional test pages of 2026-09-12
 * carry only the engine string in `ocr.model` and no `ocr.ia` at all.
 */
export function transcriptProvenance(page: Pick<Page, 'ocr'>): TranscriptProvenance | null {
  const ocr = page.ocr;
  if (!ocr) return null;
  const textSource = pageTextSource(page);
  if (textSource) return { kind: 'text_source', source: textSource };
  const corpus = pageTextCorpus(page);
  if (corpus) return { kind: 'corpus', corpus };
  if (ocr.source === 'ia_djvu') {
    const engine = (ocr.ia?.engine || ocr.model || '').trim() || null;
    let year: string | null = null;
    if (ocr.ia?.ocr_date) {
      const y = new Date(ocr.ia.ocr_date).getFullYear();
      year = Number.isFinite(y) ? String(y) : null;
    }
    const median = ocr.agreement_ref?.median;
    return { kind: 'ia', engine, year, agreement: typeof median === 'number' ? median : null };
  }
  if (ocr.source === 'manual') return { kind: 'manual', model: ocr.model || null };
  const engine = ocr.engine;
  if (engine && engine.name === 'kraken') {
    return { kind: 'kraken', route: 'route' in engine && engine.route === 'print' ? 'print' : 'manuscript' };
  }
  if (ocr.model) return { kind: 'model', model: ocr.model };
  return null;
}

/**
 * A model id as a reader would say it: `gemini-3.1-flash-lite-preview` →
 * "Gemini 3.1 Flash-Lite". Unknown ids pass through untouched — the exact id is
 * the honest fallback, never a guess.
 */
export function modelDisplayName(model: string): string {
  const m = /^gemini-(\d+(?:\.\d+)?)-(flash-lite|flash|pro)(?:-preview)?(?:-\d{2}-\d{2})?$/i.exec(model.trim());
  if (!m) return model;
  const tier = m[2].toLowerCase() === 'flash-lite' ? 'Flash-Lite' : m[2][0].toUpperCase() + m[2].slice(1).toLowerCase();
  return `Gemini ${m[1]} ${tier}`;
}

/**
 * The words for a provenance, short (pane-header chip) or full (drawer
 * sentence). One function, two lengths — so the two surfaces cannot disagree.
 * `t` is the reader's `info` strings for the current locale.
 */
export function transcriptProvenanceLabel(
  prov: TranscriptProvenance,
  t: ReaderStrings['info'],
  form: 'short' | 'full',
): string {
  switch (prov.kind) {
    case 'text_source':
      return form === 'short'
        ? t.transcriptChipTextSource(prov.source.shortName, prov.source.license)
        : t.textSourceTranscript(prov.source.name, prov.source.license, prov.source.version);
    case 'corpus':
      return form === 'short'
        ? t.transcriptChipCorpus(prov.corpus.shortName)
        : t.corpusTranscript(prov.corpus.name, prov.corpus.org);
    case 'ia':
      return form === 'short'
        ? t.transcriptChipIa(prov.engine)
        : t.iaTranscript(prov.engine, prov.year, prov.agreement);
    case 'manual':
      return form === 'short'
        ? t.transcriptChipManual
        : t.manualTranscript(prov.model ? modelDisplayName(prov.model) : null);
    case 'kraken':
      return form === 'short'
        ? (prov.route === 'print' ? 'omnisyr (Kraken)' : 'Sophro Mhiro (Kraken)')
        : t.krakenTranscript(prov.route);
    case 'model':
      return form === 'short' ? modelDisplayName(prov.model) : t.transcribedBy(prov.model);
  }
}
