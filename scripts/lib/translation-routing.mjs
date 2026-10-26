// PRIOR ART: scripts/lib/translate-core.mjs getTranslateModelForBook and src/lib/types/ai-models.ts — the two routers,
// which held this policy as twin regexes until #7170; scripts/lib/ocr-routing.mjs flashFamiliesFromTable — the OCR
// side's reader of its table. Neither could be shared: translate-core loads the whole write path, and the TS file cannot
// import it. This module is pure (no JSON load, no node: imports) so both routers can call it with the table they load.
/**
 * Translation routing read from scripts/lib/translation-routing-table.json (#7170).
 *
 *   translateEngineFor(table, book)   the engine of the first BATCH row whose `match` fits the book, else table.default.engine
 *   tableRowFor(table, book)          that row (null for the default), for a caller that wants the evidence
 *   translateLaneForBook(table, book) which CHANNEL translates the book: a `channel: "cli"` row that fits wins (#7075)
 *
 * TWO CHANNELS (#7075). A row is `channel: "batch"` (the default when absent) or `channel: "cli"`. A batch row names
 * one of the two Batch models and is what every Batch submitter receives. A cli row names a subscription reader
 * (CLI_TRANSLATE_LANES: Opus through `claude -p`, Gemini 3.8 Flash through `agy -p`) and OVERLAYS the batch rows: the
 * Batch routers never see it, so no Batch job is ever built with a CLI engine name, and its languages keep the batch
 * engine underneath for the one path that cannot wait (a reader asking for a page on the site). The pipeline
 * orchestrator asks translateLaneForBook; a book whose lane is cli is HELD (CLI_TRANSLATE_HOLD) and waits for
 * scripts/batch/cli-translate-lane.mjs, and never falls to the API.
 *
 * A `match` is { provider } (books.image_source.provider) or { language_prefix: [...] } (the FIRST language label,
 * case-insensitive, whole word, any run of spaces for a space). A row may also carry `unless: { title_words: [...],
 * publisher_words: [...] }`: a book whose title or publisher holds one of those words (whole word, case-insensitive)
 * skips the row and falls to the next one. A caller must project `title` and `publisher` for it to see them.
 * The Greek cli row skips Loebs this way (#7075, 2026-10-26): the facing page is printed English, and on Plutarch
 * Loeb 99 p.94 the 3.8 Flash read reproduced that English word for word instead of translating the Greek.
 * validateTranslationTable throws on a row the routers cannot run, so a bad edit fails the tests and the import
 * instead of routing somewhere nobody chose.
 */

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const words = (list) => list.map((p) => escape(p.trim().toLowerCase()).replace(/\s+/g, '\\s+')).join('|');

/**
 * The regex a row's language_prefix list compiles to: /^\s*((ancient)\s+)?(greek|hebrew|…)\b/i. `optionalLead` is the
 * match's `optional_lead` (words that may stand before any prefix, as "Ancient" before "Greek" or "Hebrew").
 */
export function prefixRegex(prefixes, optionalLead = []) {
  const lead = optionalLead.length ? `((${words(optionalLead)})\\s+)?` : '';
  return new RegExp(`^\\s*${lead}(${words(prefixes)})\\b`, 'i');
}

/**
 * The subscription readers a `channel: "cli"` row may name, with the reader each one runs through. `apply` for both is
 * `scripts/batch/cli-translate.mjs apply`. Ids are the ones derive_routes.py proposes.
 */
export const CLI_TRANSLATE_LANES = Object.freeze({
  'claude-opus-5-5': Object.freeze({ reader: 'scripts/batch/claude-translate.mjs', model: 'opus' }),
  'gemini-3.8-flash+agy-cli': Object.freeze({ reader: 'scripts/batch/cli-translate.mjs', model: 'gemini-3.8-flash-low' }),
});

/**
 * The pipeline hold that queues a book for its CLI translation lane (#7075), as CLI_FLASH_OCR_HOLD does for OCR. A held
 * book is out of every status-selected lane (scripts/lib/pipeline-hold.mjs), so neither the chained Batch lane nor the
 * realtime worker can translate it while it waits; scripts/batch/cli-translate-lane.mjs finds its books by this reason.
 */
export const CLI_TRANSLATE_HOLD = Object.freeze({
  reason: 'translate-cli-7075',
  issue: 7075,
  release: 'scripts/batch/cli-translate-lane.mjs has translated every untranslated page through the reader the routing table names; it releases the book itself (or by hand: scripts/maintenance/hold-pipeline-books.mjs --release-held --reason translate-cli-7075 --book <id> --apply)',
});

const channelOf = (row) => row.channel ?? 'batch';

const compiled = new WeakMap();
function compile(table) {
  let rows = compiled.get(table);
  if (!rows) {
    rows = (table?.rows ?? []).map((row) => ({
      row,
      re: row.match?.language_prefix ? prefixRegex(row.match.language_prefix, row.match.optional_lead ?? []) : null,
      unlessTitle: row.unless?.title_words?.length ? new RegExp(`\\b(${words(row.unless.title_words)})\\b`, 'i') : null,
      unlessPublisher: row.unless?.publisher_words?.length ? new RegExp(`\\b(${words(row.unless.publisher_words)})\\b`, 'i') : null,
    }));
    compiled.set(table, rows);
  }
  return rows;
}

function firstFit(table, book, channel) {
  const language = String(book?.language ?? '');
  const title = String(book?.title ?? '');
  const publisher = String(book?.publisher ?? '');
  for (const { row, re, unlessTitle, unlessPublisher } of compile(table)) {
    if (channelOf(row) !== channel) continue;
    if (unlessTitle?.test(title) || unlessPublisher?.test(publisher)) continue;
    if (row.match?.provider && book?.image_source?.provider === row.match.provider) return row;
    if (re && re.test(language)) return row;
  }
  return null;
}

/** The first BATCH row that fits the book, or null for the default. A cli row is never returned here. */
export function tableRowFor(table, book) {
  return firstFit(table, book, 'batch');
}

/**
 * Which channel translates this book:
 *   { channel: 'cli', engine, reader, model, row }   a cli row fits; the pipeline holds the book for that lane
 *   { channel: 'batch', engine, row }                otherwise; row is null for the default
 */
export function translateLaneForBook(table, book) {
  const cli = firstFit(table, book, 'cli');
  if (cli) return { channel: 'cli', engine: cli.engine, ...CLI_TRANSLATE_LANES[cli.engine], row: cli };
  return { channel: 'batch', engine: translateEngineFor(table, book), row: tableRowFor(table, book) };
}

export function translateEngineFor(table, book) {
  return tableRowFor(table, book)?.engine ?? table.default.engine;
}

/**
 * Throws unless the default and every batch row name one of `engines`, every cli row names a CLI_TRANSLATE_LANES
 * reader and carries its adoption sample, and every row has exactly one kind of match.
 */
export function validateTranslationTable(table, engines) {
  const ok = new Set(engines);
  if (!ok.has(table?.default?.engine)) throw new Error(`translation-routing-table: default engine ${table?.default?.engine} is not one of ${engines.join(', ')}`);
  const ids = new Set();
  for (const row of table.rows ?? []) {
    if (ids.has(row.id)) throw new Error(`translation-routing-table: duplicate row ${row.id}`);
    ids.add(row.id);
    const channel = channelOf(row);
    if (channel !== 'batch' && channel !== 'cli') throw new Error(`translation-routing-table: row ${row.id} has channel ${channel}; a row is "batch" or "cli"`);
    if (channel === 'batch' && !ok.has(row.engine)) throw new Error(`translation-routing-table: row ${row.id} names ${row.engine}; the Batch routers run only ${engines.join(', ')} (a subscription reader needs channel "cli")`);
    if (channel === 'cli') {
      if (!CLI_TRANSLATE_LANES[row.engine]) throw new Error(`translation-routing-table: cli row ${row.id} names ${row.engine}; a cli lane runs only ${Object.keys(CLI_TRANSLATE_LANES).join(', ')}`);
      // #7075: a cli row goes live only after a blind sample against the reader it replaces.
      if (!row.adoption?.sample || !row.adoption?.replaces) throw new Error(`translation-routing-table: cli row ${row.id} needs adoption.sample and adoption.replaces (the blind sample against the old reader)`);
    }
    const kinds = ['provider', 'language_prefix'].filter((k) => row.match?.[k] != null);
    if (kinds.length !== 1) throw new Error(`translation-routing-table: row ${row.id} needs exactly one of match.provider / match.language_prefix`);
    if (row.match.language_prefix && (!Array.isArray(row.match.language_prefix) || !row.match.language_prefix.length)) throw new Error(`translation-routing-table: row ${row.id} has an empty language_prefix`);
    if (row.unless != null) {
      const lists = ['title_words', 'publisher_words'].filter((k) => row.unless[k] != null);
      const bad = (l) => !Array.isArray(l) || !l.length || l.some((w) => typeof w !== 'string' || !w.trim());
      if (!lists.length || lists.some((k) => bad(row.unless[k])) || Object.keys(row.unless).some((k) => !lists.includes(k))) throw new Error(`translation-routing-table: row ${row.id} has an unless that is not { title_words?, publisher_words? } with non-empty word lists`);
    }
    if (!row.evidence?.length) throw new Error(`translation-routing-table: row ${row.id} has no evidence`);
  }
  return table;
}
