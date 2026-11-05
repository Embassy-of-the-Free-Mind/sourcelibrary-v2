// PRIOR ART: draw.mjs armOf() (two names: lite, flash; every later model fell into `other` and was EXCLUDED from the
// draw, so the monthly audit could not see agy Flash, Opus-direct or Argon pages at all — #5274 wave 2). This is that
// function, extended to every value of `translation.model` on served pages of live books (census.mjs, 2026-10-30),
// and shared by draw.mjs and draw-wave2.mjs so the two cannot drift.

/**
 * The translation-model arm of a page from `translation.model`.
 *   lite        gemini-3.1-flash-lite / -preview (Gemini API, batch or realtime)
 *   flash       gemini-3-flash-preview (Gemini API)
 *   agy-flash   gemini-3.8-flash* (the agy CLI on the subscription: cli-translate, stale-retranslate, Tengyur)
 *   argon       gemini-4-argon* (agy CLI, heavy)
 *   opus        claude-opus-* (Claude CLI: Opus-direct for hard scripts)
 *   claude-other  claude-sonnet / claude-haiku (a few seam repairs)
 *   gemini-legacy gemini-2.x, bare "gemini"
 *   reference   not machine output: a corpus import (etcsl-corpus, tla-manual), human, manual
 *   none        no model recorded
 *   other       anything not above: a new model the census has not seen. Extend this table, do not exclude it.
 */
export function armOf(model) {
  const m = String(model ?? '').trim();
  if (!m || m === 'null') return 'none';
  if (/^gemini-3\.1-flash-lite/.test(m)) return 'lite';
  if (/^gemini-3-flash/.test(m)) return 'flash';
  if (/^gemini-3\.8-flash/.test(m)) return 'agy-flash';
  if (/^gemini-4-argon/.test(m)) return 'argon';
  if (/^claude-opus/.test(m)) return 'opus';
  if (/^claude-/.test(m)) return 'claude-other';
  if (/^gemini(-2\.|$)/.test(m)) return 'gemini-legacy';
  if (/corpus|manual|^human$/.test(m)) return 'reference';
  return 'other';
}

/** The model family of an arm, for the judge self-preference check: 'gemini' | 'claude' | null (not machine). */
export function familyOf(arm) {
  if (['lite', 'flash', 'agy-flash', 'argon', 'gemini-legacy'].includes(arm)) return 'gemini';
  if (['opus', 'claude-other'].includes(arm)) return 'claude';
  return null;
}

/** Arms whose pages are machine translations a reader meets as served text (draws sample only these). */
export const MACHINE_ARMS = Object.freeze(['lite', 'flash', 'agy-flash', 'argon', 'opus', 'claude-other', 'gemini-legacy']);

/** Wave-2 period buckets (pre-1500, 1500–1700, 1700–1900, 1900+) from an edition year, or 'unknown'. */
export function period4(year) {
  if (!Number.isFinite(year)) return 'unknown';
  return year < 1500 ? 'pre-1500' : year < 1700 ? '1500-1700' : year < 1900 ? '1700-1900' : '1900+';
}
