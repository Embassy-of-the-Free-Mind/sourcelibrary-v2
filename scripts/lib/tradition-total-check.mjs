// PRIOR ART: scripts/lib/canon-holdings.mjs — builds the sets; nothing compared a tradition's total with a direct language count (#6528).
// A tradition row on /research/canon-gap must not be a "floor" mistaken for a total. Chinese classics showed
// 170 books while we hold ~13,500 Chinese books, because the row was a title-match set and no check compared it
// to a direct `language` count. Language-defined rows are compared with that count; subject/collection rows
// must say so in a non-empty `scope` string.

export const MIN_COVERAGE_OF_LANGUAGE = 0.5;

/**
 * @param {Array<{id:string,languages?:RegExp,scope?:string}>} traditions TRADITIONS definitions
 * @param {Record<string, {books:number, set_names?:string}>} counts books per tradition id (what the figure shows)
 * @param {Array<{language?:string}>} candidateBooks every book loaded by loadHoldingCandidates
 * @param {{allowPartial?: string[]}} [opts]
 * @returns {Record<string, object>} per-row fields to write into the output JSON
 */
export function checkTraditionTotals(traditions, counts, candidateBooks, opts = {}) {
  const allow = new Set(opts.allowPartial || []);
  const out = {};
  const problems = [];
  // A regex shared by several rows (the two Chinese rows) is compared once, on their summed counts.
  const groups = new Map();
  for (const t of traditions) {
    if (t.languages) {
      const key = String(t.languages);
      if (!groups.has(key)) groups.set(key, { re: t.languages, ts: [] });
      groups.get(key).ts.push(t);
    } else if (typeof t.scope !== 'string' || !t.scope.trim()) {
      problems.push(`${t.id}: neither \`languages\` (a whole-language row) nor a non-empty \`scope\` (a subject/collection row)`);
    } else out[t.id] = { scope: t.scope };
  }
  for (const { re, ts } of groups.values()) {
    const direct = candidateBooks.filter((b) => re.test(b.language || '')).length;
    const shown = ts.reduce((a, t) => a + (counts[t.id]?.books || 0), 0);
    const ratio = direct ? shown / direct : 1;
    for (const t of ts) out[t.id] = { direct_language_books: direct, coverage_of_language: Math.round(ratio * 1000) / 1000 };
    if (ratio < MIN_COVERAGE_OF_LANGUAGE && !ts.every((t) => allow.has(t.id))) {
      const built = ts.map((t) => `${t.id} from sets [${counts[t.id]?.set_names || '?'}]`).join('; ');
      problems.push(`${ts.map((t) => t.id).join(' + ')}: shows ${shown} books but a direct language count (${re}) is ${direct} (${(ratio * 100).toFixed(1)}%, under ${MIN_COVERAGE_OF_LANGUAGE * 100}%); built from ${built}. A floor is not a total. Fix the set, or pass --allow-partial=<id> deliberately.`);
    }
  }
  if (problems.length) throw new Error(`tradition total check failed:\n  ${problems.join('\n  ')}`);
  return out;
}
