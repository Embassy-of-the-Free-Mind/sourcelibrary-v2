// PRIOR ART: scripts/lib/translate-core.mjs getTranslateModelForBook and src/lib/types/ai-models.ts — the two routers,
// which held this policy as twin regexes until #7170; scripts/lib/ocr-routing.mjs flashFamiliesFromTable — the OCR
// side's reader of its table. Neither could be shared: translate-core loads the whole write path, and the TS file cannot
// import it. This module is pure (no JSON load, no node: imports) so both routers can call it with the table they load.
/**
 * Translation routing read from scripts/lib/translation-routing-table.json (#7170).
 *
 *   translateEngineFor(table, book)  the engine of the first row whose `match` fits the book, else table.default.engine
 *   tableRowFor(table, book)         that row (null for the default), for a caller that wants the evidence
 *
 * A `match` is { provider } (books.image_source.provider) or { language_prefix: [...] } (the FIRST language label,
 * case-insensitive, whole word, any run of spaces for a space). validateTranslationTable throws on a row the routers
 * cannot run, so a bad edit fails the tests and the import instead of routing somewhere nobody chose.
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

const compiled = new WeakMap();
function compile(table) {
  let rows = compiled.get(table);
  if (!rows) {
    rows = (table?.rows ?? []).map((row) => ({ row, re: row.match?.language_prefix ? prefixRegex(row.match.language_prefix, row.match.optional_lead ?? []) : null }));
    compiled.set(table, rows);
  }
  return rows;
}

export function tableRowFor(table, book) {
  const language = String(book?.language ?? '');
  for (const { row, re } of compile(table)) {
    if (row.match?.provider && book?.image_source?.provider === row.match.provider) return row;
    if (re && re.test(language)) return row;
  }
  return null;
}

export function translateEngineFor(table, book) {
  return tableRowFor(table, book)?.engine ?? table.default.engine;
}

/** Throws unless every row and the default name one of `engines`, and every row has exactly one kind of match. */
export function validateTranslationTable(table, engines) {
  const ok = new Set(engines);
  if (!ok.has(table?.default?.engine)) throw new Error(`translation-routing-table: default engine ${table?.default?.engine} is not one of ${engines.join(', ')}`);
  const ids = new Set();
  for (const row of table.rows ?? []) {
    if (ids.has(row.id)) throw new Error(`translation-routing-table: duplicate row ${row.id}`);
    ids.add(row.id);
    if (!ok.has(row.engine)) throw new Error(`translation-routing-table: row ${row.id} names ${row.engine}; the Batch routers run only ${engines.join(', ')}`);
    const kinds = ['provider', 'language_prefix'].filter((k) => row.match?.[k] != null);
    if (kinds.length !== 1) throw new Error(`translation-routing-table: row ${row.id} needs exactly one of match.provider / match.language_prefix`);
    if (row.match.language_prefix && (!Array.isArray(row.match.language_prefix) || !row.match.language_prefix.length)) throw new Error(`translation-routing-table: row ${row.id} has an empty language_prefix`);
    if (!row.evidence?.length) throw new Error(`translation-routing-table: row ${row.id} has no evidence`);
  }
  return table;
}
