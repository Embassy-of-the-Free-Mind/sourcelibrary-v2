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
