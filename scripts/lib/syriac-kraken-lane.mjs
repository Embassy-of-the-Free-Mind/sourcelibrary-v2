/**
 * PRIOR ART: scripts/maintenance/apply-reocr-verdicts.mjs (#4523 — writes an external
 * engine's Tibetan reading over a model's, with page_revisions first and `ocr.pipeline`
 * for the stale-translation sweep; it consumes a verdict file from a GPU box and has
 * no routing, no provenance beyond a model name, and no re-enrolment for translation);
 * scripts/import/ia-ocr-ingest.mjs (records WHICH engine read a page under `ocr.ia`,
 * the shape `ocr.engine` copies here — but fills only EMPTY pages, and never a page a
 * model already read); scripts/lib/ia-ocr-gate.mjs (a per-language table in ONE place,
 * which is the shape the engine table below follows). None of them can pick an engine
 * per BOOK, or say on the page which model DOI produced the text.
 *
 * The Syriac Kraken lane — policy, routing and provenance (#4883).
 *
 * WHY THIS LANE EXISTS
 * --------------------
 * No Gemini version reads Syriac (measured 2026-09-16, #4746 → #4901, against published
 * transcriptions, not our own output): flash-lite loops on 16/40 manuscript pages and
 * current flash writes fluent text that is not on the page. Two open Kraken models do
 * read it — Sophro Mhiro (manuscripts, 18.8% order-free line CER, 40/0 wins over our
 * model) and omnisyr / Qoruyo (print, agreement 0.83–0.96 with each other and with the
 * page by eye). So the disposition Derek chose (2026-09-18) is RE-TRANSCRIPTION with the
 * specialist models, not suppression: "don't withhold individual pages". Nothing in this
 * lane hides a page or a book.
 *
 * ROUTING IS PER BOOK, POLICY IS PER PAGE
 * A book is a manuscript or a printed edition, and that decides the model (Sophro for
 * manuscripts, omnisyr for print — Qoruyo does NOT cover Serto, which is what Bedjan's
 * Paris editions use, so omnisyr is the print arm). Whether a PAGE is re-transcribed
 * depends on what the page holds now: a degeneration loop is certain damage and always
 * goes; a Syriac-majority reading goes; a page whose reading is Latin, Hebrew or Arabic
 * is NOT Syriac and keeps its text (the bilingual editions — Patrologia Syriaca, Ephraem's
 * Opera Omnia — print Latin facing or beside the Syriac, and a Syriac model over a Latin
 * column writes junk); a mixed page keeps its text for the same reason; a human-edited
 * page is never touched (#3749). The classifier is code-point share, script-agnostic and
 * free (`non-latin-text-operations.md`: never a word-token ratio on a spaceless script).
 *
 * PROVENANCE ON THE PAGE
 * `ocr.model` = `kraken/<engine>` (a distinctive label, never `batch_api`/`ai`),
 * `ocr.source` = `kraken`, `ocr.pipeline` = the lane id (arm 1 of the stale-translation
 * sweep keys on it), and `ocr.engine` = { name, version, model, model_doi, licence,
 * segmenter, direction, run } so a reader clicking (i) can see WHICH model read the page,
 * the way `ocr.ia` says which Archive engine did. Gemini-era fields (prompt_*, batch_job_id,
 * token counts, recitation/fail counters) are removed, because leaving them would describe
 * a reading this page no longer carries.
 *
 * SEGMENTATION: Sophro's segmonto segmenters are truncated on Zenodo itself
 * (17406717/754/766, all exactly 5,242,880 bytes; our md5 matches theirs), so every arm
 * runs Kraken's default baseline segmenter with `-d horizontal-rl` and `--base-dir R`.
 */

/** `ocr.pipeline` value and `sweep_log.sweep` name — one id for the whole lane. */
export const LANE = 'syriac-kraken-2026-09';
export const LANE_ISSUE = 4883;
/** `page_revisions.reason` for the reading this lane supersedes. */
export const REVISION_REASON = 'reocr_syriac_kraken_4883';
/** `book_events.type` — one row per book, updated as the lane advances through it. */
export const BOOK_EVENT = 'syriac_kraken_reocr';

export const KRAKEN = {
  name: 'kraken',
  version: '7.1',
  segmenter: 'blla default baseline (Sophro segmonto segmenters are truncated on Zenodo)',
  direction: 'horizontal-rl',
  base_dir: 'R',
};

/**
 * The engines, in ONE place. `route` says which class of book each is for; the two
 * Qoruyo arms are recorded because they were measured (#4901) but are not selected by
 * routing — omnisyr agrees with them on Estrangela/Eastern print and also covers Serto.
 */
export const ENGINES = {
  'sophro-mhiro': {
    key: 'sophro-mhiro', route: 'manuscript', file: 'sophro-mhiro.mlmodel',
    label: 'Sophro Mhiro (Beth Mardutho, HTR Winter School)',
    model_doi: '10.5281/zenodo.17406773', zenodo_file: 'syr_41transcribathon_docs_d_3.mlmodel',
    licence: 'CC BY 4.0', scripts: 'Serto, Estrangela, East Syriac (manuscript hands)',
    measured: '18.8% order-free line CER on 40 published-GT manuscript pages (#4901)',
  },
  omnisyr: {
    key: 'omnisyr', route: 'print', file: 'omnisyr.mlmodel',
    label: 'omnisyr (Kraken, printed Syriac)',
    model_doi: '10.5281/zenodo.8425684', zenodo_file: 'omnisyr_best.mlmodel',
    licence: 'Apache-2.0', scripts: 'Serto, Estrangela, East Syriac (print)',
    measured: 'agreement 0.83–0.96 with Qoruyo on printed pages; 0 loops on 36 pages (#4901)',
  },
  'qoruyo-estrangela': {
    key: 'qoruyo-estrangela', route: null, file: 'qoruyo-estrangela.mlmodel',
    label: 'Qoruyo Estrangela (Beth Mardutho)', model_doi: '10.5281/zenodo.17406703',
    zenodo_file: 'SyrEstr_02_34.mlmodel', licence: 'CC BY 4.0', scripts: 'Estrangela print',
  },
  'qoruyo-eastern': {
    key: 'qoruyo-eastern', route: null, file: 'qoruyo-eastern.mlmodel',
    label: 'Qoruyo East Syriac (Beth Mardutho)', model_doi: '10.5281/zenodo.17406690',
    zenodo_file: 'SyrEastSyr_01_18.mlmodel', licence: 'CC BY 4.0', scripts: 'East Syriac print',
  },
};

export const ENGINE_FOR_ROUTE = { manuscript: 'sophro-mhiro', print: 'omnisyr' };

/** Providers whose Syriac holdings are manuscripts (the Archive's are printed editions). */
const MANUSCRIPT_PROVIDERS = new Set(['vatican', 'cambridge', 'bodleian', 'manchester', 'chester_beatty', 'gallica', 'bl', 'british_library']);

/**
 * Manuscript or print, per book. Three signals, any one of which decides for
 * MANUSCRIPT: the holding library is a manuscript library; the imprint year is before
 * 1500 (nothing in Syriac was printed before Widmanstetter's 1555 New Testament); or the
 * model's own `<script>` tag on the pages we already read says handwritten more often
 * than printed. Otherwise print. `overrides` (book id → route) wins over everything, for
 * the cases a rule cannot see; keep it in the plan file, not here.
 *
 * @param {object} book — needs `image_source.provider`, `published`
 * @param {{ handwritten?: number, printed?: number }} [scriptTags] counts of the model's tags
 * @param {Record<string,'manuscript'|'print'>} [overrides]
 * @returns {{ route: 'manuscript'|'print', engine: string, why: string }}
 */
export function routeBook(book, scriptTags = {}, overrides = {}) {
  const bid = book?.id || String(book?._id || '');
  const done = (route, why) => ({ route, engine: ENGINE_FOR_ROUTE[route], why });
  if (overrides[bid]) return done(overrides[bid], 'override');
  const provider = String(book?.image_source?.provider || '').toLowerCase();
  if (MANUSCRIPT_PROVIDERS.has(provider)) return done('manuscript', `provider ${provider}`);
  const year = editionYear(book?.published);
  if (year !== null && year < 1500) return done('manuscript', `published ${book.published}`);
  const hw = scriptTags.handwritten || 0, pr = scriptTags.printed || 0;
  if (hw > pr && hw >= 5) return done('manuscript', `<script> handwritten ${hw} vs printed ${pr}`);
  return done('print', provider ? `provider ${provider}` : 'default');
}

/** First 3–4 digit year in a free-text `published` (`lesson_published_is_free_text`). */
export function editionYear(published) {
  const m = /\b(\d{3,4})\b/.exec(String(published || ''));
  if (!m) return null;
  const y = Number(m[1]);
  return y >= 100 && y <= 2100 ? y : null;
}

/** Counts of the model's `<script>` tag values over a set of transcriptions. */
export function scriptTagCounts(texts) {
  const out = {};
  for (const t of texts) {
    const m = /<script>\s*([^<]+?)\s*<\/script>/i.exec(String(t || ''));
    const k = m ? m[1].toLowerCase() : 'none';
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

/** Envelope tags whose CONTENT is metadata, not page text (`<language>Syriac</language>`
 *  would otherwise count six Latin letters on every page). Body tags like `<header>` keep
 *  their content. */
const META_TAGS = /<(language|script|page-type|page-num|columns|warning|lang)\b[^>]*>[\s\S]*?<\/\1>/gi;
const TAG = /<[^>]+>/g;
const body = (text) => String(text || '').replace(META_TAGS, ' ').replace(TAG, ' ');

/**
 * What script a stored transcription is written in, by code-point share of its letters.
 * Syriac is U+0700–074F. `klass`: `syriac` (≥ 60% Syriac), `other` (≤ 20%), `mixed`
 * (between — a bilingual page), `short` (under 40 letters: nothing to classify).
 */
export function classifyScript(text) {
  let syr = 0, lat = 0, heb = 0, ara = 0, grk = 0, oth = 0;
  for (const ch of body(text)) {
    const c = ch.codePointAt(0);
    if (c >= 0x0700 && c <= 0x074F) syr++;
    else if ((c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A) || (c >= 0xC0 && c <= 0x24F)) lat++;
    else if (c >= 0x0590 && c <= 0x05FF) heb++;
    else if (c >= 0x0600 && c <= 0x06FF) ara++;
    else if (c >= 0x0370 && c <= 0x03FF) grk++;
    else if (/\p{L}/u.test(ch)) oth++;
  }
  const n = syr + lat + heb + ara + grk + oth;
  const share = n ? syr / n : 0;
  const klass = n < 40 ? 'short' : share >= 0.6 ? 'syriac' : share <= 0.2 ? 'other' : 'mixed';
  return { n, syr, lat, heb, ara, grk, oth, share: +share.toFixed(3), klass };
}

/** A person wrote or corrected this reading — never overwrite it (#3749). */
export function isHumanEdited(ocr) {
  return !!(ocr?.edited_by || ocr?.source === 'manual' || ocr?.edited_at);
}

/**
 * Should this page be re-transcribed by the lane, and why? Returns `{ action, why }`
 * with `action` one of:
 *   `reocr`  — go: `why` ∈ loop | syriac | first_write | short
 *   `keep`   — leave the stored reading: `why` ∈ human_edited | other_script | mixed_script
 * `loopRefused` is the #4850 gate's verdict on the stored text (the caller has it already
 * from `loopVerdict`); a loop always goes, whatever script it is nominally in, because a
 * loop is not a reading of anything.
 */
export function pagePolicy(page, { loopRefused = false } = {}) {
  const ocr = page?.ocr;
  const text = ocr?.data;
  if (isHumanEdited(ocr)) return { action: 'keep', why: 'human_edited' };
  if (!text) return { action: 'reocr', why: 'first_write' };
  if (loopRefused) return { action: 'reocr', why: 'loop' };
  const s = classifyScript(text);
  if (s.klass === 'syriac') return { action: 'reocr', why: 'syriac' };
  if (s.klass === 'short') return { action: 'reocr', why: 'short' };
  if (s.klass === 'other') return { action: 'keep', why: 'other_script' };
  return { action: 'keep', why: 'mixed_script' };
}

/**
 * The stored form of a Kraken reading: the same envelope the model's readings carry
 * (`<language>`, `<script>`), so the in-text language tag — the field 94% of pages carry
 * and the one consumers trust over `pages.lang` — is present, followed by the lines.
 * No `<page-type>`: Kraken does not classify pages, and a claim it did not make is not
 * written. Lines are normalised to NFC; trailing whitespace stripped.
 */
export function envelope(rawText, route) {
  const lines = String(rawText || '').normalize('NFC').split(/\r?\n/).map((l) => l.replace(/\s+$/, ''));
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  const script = route === 'manuscript' ? 'handwritten' : 'printed';
  return `<language>Syriac</language>\n<script>${script}</script>\n\n${lines.join('\n')}`;
}

/** Letters (not tags, not whitespace) in a reading — the lane's "did it read anything" count. */
export function letterCount(text) {
  let n = 0;
  for (const ch of body(text)) if (/\p{L}/u.test(ch)) n++;
  return n;
}

/** Gemini-era fields that describe the reading this lane replaces; removed on write. */
export const STALE_OCR_FIELDS = [
  'ocr.prompt_version', 'ocr.prompt_id', 'ocr.prompt_hash', 'ocr.prompt_name', 'ocr.prompt',
  'ocr.batch_job_id', 'ocr.input_tokens', 'ocr.output_tokens', 'ocr.has_warning',
  'ocr.recitation_count', 'ocr.last_recitation_at', 'ocr.recitation_blocked',
  'ocr.fail_count', 'ocr.fail_reason', 'ocr.fail_blocked', 'ocr.fail_blocked_model', 'ocr.fail_blocked_at',
  'ocr.unreadable', 'ocr.unreadable_reason', 'ocr.ia', 'ocr.agreement_ref', 'ocr.source_url',
];

/**
 * The `$set` half of a page write. `text` is the ENVELOPED reading. `run` labels the
 * pass (a date + host) so two runs of the lane are distinguishable on the page.
 */
export function ocrSetFields(text, engineKey, route, { run, now = new Date(), secs = null } = {}) {
  const e = ENGINES[engineKey];
  if (!e) throw new Error(`unknown engine ${engineKey}`);
  return {
    'ocr.data': text,
    'ocr.language': 'Syriac',
    'ocr.model': `kraken/${e.key}`,
    'ocr.source': 'kraken',
    'ocr.pipeline': LANE,
    'ocr.updated_at': now,
    'ocr.engine': {
      name: KRAKEN.name, version: KRAKEN.version, model: e.key, model_label: e.label,
      model_doi: e.model_doi, licence: e.licence, route,
      segmenter: KRAKEN.segmenter, direction: KRAKEN.direction, base_dir: KRAKEN.base_dir,
      run: run || LANE, issue: LANE_ISSUE, secs,
    },
    updated_at: now,
  };
}

/** Statuses from which a fully-transcribed book may re-enter translation (`ocr_complete`). */
export const REENROL_FROM = new Set([
  'complete', 'translate_complete', 'translate_partial', 'loop_quarantine_hold', 'parked',
  'failed', 'needs_attention', 'archive_complete', 'ocr_complete', 'images_complete',
  'enrich_complete', 'summary_indexed', 'chapters_complete', 'quality_scored',
]);

/**
 * May this book be sent back to `ocr_complete` so translate-worker re-translates the
 * pages whose OCR is now newer than their English? Only when the status would be TRUE
 * (`pipeline-status-truth.md`: every page has a reading), the book is not held (a hold
 * is released deliberately, elsewhere), and it is not a takedown (reenroll-eligibility
 * rule 1: `hidden_reason` never re-enters a lane by sweep).
 */
export function reenrolDecision(book, counts) {
  const status = book?.pipeline_auto?.status || null;
  if (book?.pipeline_auto?.hold) return { ok: false, why: 'held' };
  if (book?.hidden_reason && !/^(unprocessed|launch_curation)$/.test(String(book.hidden_reason))) return { ok: false, why: `hidden_reason:${book.hidden_reason}` };
  if (!counts || !(counts.total > 0)) return { ok: false, why: 'no_pages' };
  if (counts.with_ocr < counts.total) return { ok: false, why: `ocr ${counts.with_ocr}/${counts.total}` };
  if (!REENROL_FROM.has(status)) return { ok: false, why: `status ${status}` };
  return { ok: true, why: `from ${status}` };
}
