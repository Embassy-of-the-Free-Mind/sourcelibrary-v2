import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Every Gemini writer of page TEXT stamps provenance through the one builder (#4613).
 *
 * A file that writes `pages.ocr.data` or `pages.translation.data` as model output must
 * import scripts/lib/write-provenance.mjs (or its src/ twin) and call `geminiEngine` /
 * `engineFromBatchJob`. Hand-assembled provenance is what this closes: seven writers each
 * decided independently what to record and disagreed on all of it (issue comment,
 * 2026-09-28). Same shape as the loop-guard test (#4850): a doc said the rule; a dozen writers
 * ignored it; only a check at the write boundary holds.
 *
 * ALLOWED lists writers whose text is not a Gemini reading (human, archive, corpus, moves of
 * stored text) with the reason. PENDING lists Gemini writers not yet wired, each with the PR
 * that wires it; it must shrink to nothing — a test asserts the set only ever loses entries
 * (see the snapshot below), so a new writer cannot be parked here.
 */

const REPO = path.resolve(__dirname, '../..');

const OCR_WRITE = /(?:'ocr\.data':\s*(?!null\b|undefined\b|''|\{|regexFilter)[A-Za-z(]|^\s*data:\s*(?:text|ocrText|result\.text|ocrResult\.text|v\.text|art\.atf|leaves\[k\])\b)/;
const TR_WRITE = /(?:'translation\.data':\s*(?!null\b|undefined\b|''|\{|regexFilter|r\b|\d)[A-Za-z(]|^\s*data:\s*(?:text|clean|translation|translatedText|result\.text|res\.text|english)\b)/;

/** Writers whose text is not a Gemini reading — reason required. */
const ALLOWED: Record<string, string> = {
  'scripts/import/sefaria-fit-5560.mjs': 'a published Sefaria e-text, not a Gemini reading — its own text_source / text_edition / alignment block + content_hash (#5560, #5571)',
  'scripts/lib/ocr-loop-guard.mjs': 'the guard; writes only page_revisions',
  'scripts/batch/greek-reocr-5813/restore-truncated.mjs': "a move of the page's own earlier text back from its page_revisions snapshot, with the engine block and content_hash that snapshot carries (#5813); nothing is read from a model",
  'scripts/batch/greek-reocr-5813/restore-pages.mjs': "a move of the page's own earlier transcription and translation back from their page_revisions snapshots, with the provenance those snapshots carry (#5813); nothing is read from a model",
  'scripts/lib/blank-page-guard.mjs': 'the sibling guard; writes only page_revisions',
  'scripts/lib/syriac-kraken-lane.mjs': 'Kraken (specialist, not Gemini) — its own engine block, checked by missingProvenance',
  'scripts/workers/syriac-kraken-lane.mjs': 'Kraken lane worker; the $set is built in scripts/lib/syriac-kraken-lane.mjs',
  'scripts/lib/ndl-koten-lane.mjs': 'NDL古典籍OCR (specialist, not Gemini) — its own engine block + content_hash per the #4613 specialist standard (#4925)',
  'scripts/lib/paddle-zh-lane.mjs': 'PaddleOCR-VL (specialist, not Gemini) — its own engine block + content_hash, `paddle` checked by missingProvenance (#5600)',
  'scripts/maintenance/apply-reocr-verdicts.mjs': 'BDRC Tibetan models (specialist, not Gemini) — the template engine block',
  'scripts/import/ia-ocr-ingest.mjs': "the Internet Archive's own OCR, recorded in the `ia` block, not a Gemini read",
  'scripts/import/cdli-atf-source.mjs': "CDLI's published ATF transliteration",
  'scripts/import/import-oraec.mjs': 'ORAEC corpus dump, a published edition',
  'scripts/import/oraec-paginate-translate.mjs': 'repaginates text already imported from ORAEC',
  'scripts/import/fetch-wikisource-javanese.mjs': 'Wikisource text, not a model read',
  'scripts/import/import-thirukkural.ts': 'seeds an empty ocr object at import',
  'scripts/maintenance/backfill-woodblock-provenance-4523.mjs': "matches 'ocr.data' only in the update FILTER (a race guard on the unchanged text); its $set stamps source/engine/content_hash and never writes text (#4523)",
  'scripts/maintenance/dehyphenate-ia-ocr.mjs': 'rewrites stored text, joining hyphenated line breaks',
  'scripts/lib/same-language.mjs': 'copies an English page\'s transcription through verbatim (#5154) — no model; its own engine block (same-language-copy/1)',
  'scripts/maintenance/backfill-leaf-break-markers.mjs': 'inserts the <leaf-break/> marker between the stored leaf reads (#5260); the text stays the BDRC read apply-reocr-verdicts.mjs stamped, and the seam is recorded inside that engine block (leaf_seams)',
  'scripts/maintenance/repair-ia-ocr-leaf-offset.mjs': 'moves stored text between pages; introduces no new text',
  'scripts/maintenance/fix-h13-stragglers.mjs': 'moves stored text; introduces no new text',
  'scripts/maintenance/move-hidden-meta-own-text.mjs': 'moves the translation\'s own text out of a <meta hidden> block (#5376 tq11); introduces no new text, keeps the engine block, recomputes content_hash, snapshots to page_revisions first',
  'scripts/maintenance/restore-refused-translations-5105.mjs': 'restores text from page_revisions; the original writer stamped it',
  'scripts/maintenance/withhold-stale-translations.mjs': 'removes text; writes none',
  'scripts/lib/stale-translation.mjs': 'withholdPin() builds the update FILTER that pins a withhold to the judged text; writes none',
  'scripts/split-book.mjs': 'splits stored text across new page docs',
  'scripts/migration/backfill-ocr-near-complete.mjs': 'backfills counters from stored text',
  'scripts/migration/add-page-translations-withheld.mjs': 'migration of stored text',
  'scripts/tmp-recitation-retry.mjs': "writes the marker '[RECITATION_BLOCKED]', not a transcription",
  'scripts/maintenance/fix-unclosed-note-tags.mjs': 'repairs tags in stored translation text; introduces no new text',
  'scripts/lib/translation-text-repair.mjs': 'hand repair of stored translation text (a wrong note, a broken tag); revision row with before/after content_hash, no model output (#5624, #5644)',
  'scripts/maintenance/withdraw-fabricated-translation-4584.mjs': 'replaces invented spans with <lacuna>; introduces no new text',
  'scripts/workers/mineru-ocr-worker.mjs': "MinerU (specialist, not Gemini) — its own engine block (specialist-engine/1: version, licence, backend, run, input), checked by missingProvenance under source 'mineru'",
  'src/app/api/books/[id]/import-batch/route.ts': 'text supplied by the importer with the request, not a model read here',
  'src/app/api/iiif/[id]/search/route.ts': 'reads; the probe matches its regex filters',
  'src/lib/chat-page-search.ts': 'reads (both chat routes); the probe matches its regex filters',
  'scripts/enrichment/dedup-entities.mjs': 'entity records, not page text (matches the probe on a `data:` line)',
  'src/lib/import-utils.ts': 'seeds an empty ocr object when a page doc is created',
  'src/app/api/pages/[id]/route.ts': 'manual edits by a signed-in person (source: manual)',
  'src/app/api/[tenant]/pages/[id]/route.ts': 'manual edits by a signed-in person (source: manual)',
  'src/app/api/contribute/process/route.ts': 'contributor-supplied text (source: contributor)',
  'src/app/api/cron/_archived/process-batches/route.ts': 'archived; not deployed',
};

/**
 * Every Gemini writer is wired (parts 2, 3 and 5 of #4613). There is deliberately no "pending"
 * list any more: a new writer either goes through the builder or names, in ALLOWED, why its text
 * is not a Gemini reading.
 */
const PENDING: Record<string, string> = {};

function candidateFiles(): string[] {
  try {
    return execFileSync('git', ['grep', '-lE', String.raw`ocr\.data|translation\.data|ocr: \{|translation: \{`, '--', 'scripts', 'src'], { cwd: REPO, encoding: 'utf8' })
      .split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function writesText(lines: string[], re: RegExp, parent: RegExp): boolean {
  return lines.some((l, i) => {
    if (!re.test(l)) return false;
    if (/'(ocr|translation)\.data'/.test(l)) return true;
    return lines.slice(Math.max(0, i - 8), i).some((prev) => parent.test(prev));
  });
}

/** Files that write OCR or translation text. */
function writerFiles(): string[] {
  return candidateFiles().filter((f) => {
    if (/(^|\/)(_archived|tests|eval)\//.test(f) || /\/audit\//.test(f) || /\.test\.[jt]sx?$/.test(f)) return false;
    const lines = readFileSync(path.join(REPO, f), 'utf8').split('\n');
    return writesText(lines, OCR_WRITE, /\bocr\b\s*[:=]|'ocr'/) || writesText(lines, TR_WRITE, /\btranslation\b\s*[:=]|'translation'/);
  });
}

const usesBuilder = (src: string) =>
  /write-provenance(\.mjs)?['"]/.test(src) && /\b(geminiEngine|engineFromBatchJob|ocrProvenance|translationProvenance)\b/.test(src);

describe('every Gemini writer of page text goes through the provenance builder (#4613)', () => {
  it('no writer assembles provenance by hand', () => {
    const offenders: string[] = [];
    for (const f of writerFiles()) {
      if (ALLOWED[f] || PENDING[f]) continue;
      const src = readFileSync(path.join(REPO, f), 'utf8');
      if (!usesBuilder(src)) offenders.push(f);
    }
    expect(offenders, [
      'These files write pages.ocr.data / pages.translation.data without the provenance builder (#4613).',
      'Import scripts/lib/write-provenance.mjs (or src/lib/write-provenance.ts) and stamp `engine` + `content_hash`',
      'through geminiEngine()/engineFromBatchJob(), or add the file to ALLOWED with the reason the text is not a Gemini reading.',
    ].join(' ')).toEqual([]);
  });

  it('PENDING only ever shrinks — a new writer cannot be parked there', () => {
    // Snapshot of the list as first written (2026-09-28). Remove entries as PRs wire them; never add.
    const ORIGINAL = new Set([
      'scripts/batch/realtime-ocr.mjs', 'scripts/batch/realtime-reocr-efm.mjs', 'scripts/workers/batch-collector.mjs',
      'scripts/batch/collect-batch-results.mjs', 'scripts/batch/collect-multipage-ocr.mjs', 'scripts/workers/ocr-correct-grounded.mjs',
      'src/workers/write-processor-logic.ts', 'src/app/api/process/route.ts', 'src/app/api/process/batch/route.ts',
      'src/app/api/batch-save/route.ts', 'src/app/api/books/[id]/batch-ocr-async/route.ts', 'src/app/api/[tenant]/books/[id]/batch-ocr-async/route.ts',
      'scripts/lib/translate-core.mjs', 'scripts/workers/translate-worker.mjs', 'scripts/lib/translate-batch-seam.mjs',
      'src/lib/translate-write.ts', 'src/workers/translation-processor-logic.ts', 'src/app/api/books/[id]/batch-translate-async/route.ts',
      'src/app/api/[tenant]/books/[id]/batch-translate-async/route.ts', 'src/app/api/books/[id]/index/route.ts', 'src/app/api/[tenant]/books/[id]/index/route.ts',
      'src/app/api/books/[id]/stitch-translations/route.ts',
    ]);
    for (const f of Object.keys(PENDING)) expect(ORIGINAL.has(f), `${f} was added to PENDING — wire it through the builder instead`).toBe(true);
  });

  it('a PENDING entry that already uses the builder must be removed (the list stays honest)', () => {
    const stale = Object.keys(PENDING).filter((f) => {
      try { return usesBuilder(readFileSync(path.join(REPO, f), 'utf8')); } catch { return false; }
    });
    expect(stale, 'these files now use the builder — remove them from PENDING').toEqual([]);
  });

  it('the probe still finds the known writers — a check that finds nothing proves nothing', () => {
    const files = new Set(writerFiles());
    expect(files.size).toBeGreaterThan(10);
    for (const f of ['scripts/workers/batch-collector.mjs', 'scripts/lib/translate-core.mjs', 'scripts/batch/realtime-ocr.mjs', 'scripts/workers/translate-worker.mjs']) {
      expect(files, `${f} should be detected as a writer`).toContain(f);
    }
  });
});
