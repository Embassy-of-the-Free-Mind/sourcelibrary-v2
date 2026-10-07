#!/usr/bin/env node
// PRIOR ART: scripts/eval/notes-layer/by-eye-sheet.mts (#5942, PR #5958) prints a sheet for a reader and stores the
// reading; nothing folds a reader's verdicts back into a detector's page counts. This does, for the #5982 draw and
// the typed-text pages, and writes results.json (the numbers the experiment file quotes).
/** #5982: the detector's counts with the by-eye verdicts applied (draw: 40 flags + 20 unflagged pages; typed pages: every flagged sentence, with the page image). */
/**   node scripts/eval/untagged-additions/fold-by-eye.mjs */
import fs from 'node:fs';
import path from 'node:path';
import { wilson } from './detector.mjs';

const DIR = new URL('../results/untagged-additions-2026-10/', import.meta.url).pathname;
const jl = (f) => fs.readFileSync(path.join(DIR, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const J = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const r = (k, n) => ({ k, n, pct: n ? +(100 * k / n).toFixed(1) : null, ci: wilson(k, n).map((x) => (x == null ? null : +(100 * x).toFixed(1))) });
const TRUE = ['ADDED_COMMENTARY', 'FROM_TRANSCRIBER_DESCRIPTION', 'INVENTED_TEXT'];

// ---- the draw
const eye = J('by-eye-sample.json');
const fv = [...jl('by-eye/flags-a1.jsonl'), ...jl('by-eye/flags-a2.jsonl')];
const flags = eye.flags.map((f, i) => { if (fv[i].id !== f.id) throw new Error(`verdict ${i} is for another page`); return { ...f, verdict: fv[i].verdict, note: fv[i].note, confidence: fv[i].confidence }; });
const flaggedPages = jl('draw.gemini-3-flash-preview.flags.jsonl').filter((p) => p.additions.length);
const res = J('draw.gemini-3-flash-preview.results.json');
const byPage = {};
for (const f of flags) (byPage[f.id] ||= []).push(f);
// the 15 flagged pages the 40-flag sample did not reach: every flag on them read in the job session, one page verdict each
const rest = Object.fromEntries(jl('by-eye/flagged-pages-rest.jsonl').map((x) => [x.id, x]));
const pageRows = flaggedPages.map((p) => { const s = byPage[p.id] || (rest[p.id] ? [{ verdict: rest[p.id].verdict }] : []); const confirmed = s.some((f) => TRUE.includes(f.verdict)); return { id: p.id, language: p.language, model: p.model, prompt_version: p.prompt_version, flags: p.additions.length, sampled: s.length, read_by: byPage[p.id] ? 'subagent sample' : rest[p.id] ? 'job session' : null, origin: s.some((f) => f.verdict === 'FROM_TRANSCRIBER_DESCRIPTION') ? 'ocr' : confirmed ? 'translation' : null, confirmed, verdicts: s.map((f) => f.verdict), unread_flags: p.additions.length - s.length, lite_flags_too: p.other_detector_flags_too }; });
const N = res.answered;
const verdictCount = {}; for (const f of flags) verdictCount[f.verdict] = (verdictCount[f.verdict] || 0) + 1;
const nTrue = flags.filter((f) => TRUE.includes(f.verdict)).length;
const confirmedPages = pageRows.filter((p) => p.confirmed);
const un = jl('by-eye/unflagged-a1.jsonl');
const missed = un.filter((u) => u.found.some((x) => x.kind !== 'NEIGHBOUR_PAGE')).length;
const draw = {
  pages: N, flagged_pages_raw: r(flaggedPages.length, N),
  by_eye_flags: { read: flags.length, pages_covered: Object.keys(byPage).length, verdicts: verdictCount, true_additions: r(nTrue, flags.length), commentary: flags.filter((f) => f.verdict === 'ADDED_COMMENTARY').length, invented_text: flags.filter((f) => f.verdict === 'INVENTED_TEXT').length },
  flagged_pages_confirmed: r(confirmedPages.length, flaggedPages.length),
  flagged_pages_not_confirmed_with_unread_flags: pageRows.filter((p) => !p.confirmed && p.unread_flags > 0).length,
  rate_confirmed_pages: r(confirmedPages.length, N), pages_read: pageRows.filter((p) => p.sampled).length, confirmed_from_the_ocr_description: confirmedPages.filter((p) => p.origin === 'ocr').length, page_verdicts: pageRows.reduce((a, p) => { const k = p.confirmed ? 'addition' : p.verdicts.includes('NEIGHBOUR_PAGE') ? 'neighbour page text' : 'false flag'; a[k] = (a[k] || 0) + 1; return a; }, {}),
  unflagged_pages_read: un.length, unflagged_with_an_addition_of_5_words_or_more: r(missed, un.length), unflagged_with_neighbour_page_text: un.filter((u) => u.found.some((x) => x.kind === 'NEIGHBOUR_PAGE')).length, unflagged_with_short_additions: un.filter((u) => (u.short_additions || []).length).length,
  confirmed_by_model_and_version: {}, confirmed_by_model: {}, confirmed_by_prompt_version: {}, confirmed_by_language: {}, confirmed_when_lite_also_flags: r(confirmedPages.filter((p) => p.lite_flags_too).length, pageRows.filter((p) => p.lite_flags_too).length), confirmed_when_flash_alone: r(confirmedPages.filter((p) => !p.lite_flags_too).length, pageRows.filter((p) => !p.lite_flags_too).length),
};
const fill = (into, key, denom) => { for (const [g, d] of Object.entries(denom)) into[g] = { raw_flagged: d.k, ...r(confirmedPages.filter((p) => key(p) === g).length, d.n) }; };
fill(draw.confirmed_by_model_and_version, (p) => `${p.model || 'none'} · v${p.prompt_version}`, res.by_model_and_version);
fill(draw.confirmed_by_model, (p) => p.model || 'none', res.by_model);
fill(draw.confirmed_by_prompt_version, (p) => p.prompt_version, res.by_prompt_version);
fill(draw.confirmed_by_language, (p) => p.language || 'none', res.by_language);

// ---- typed pages
const meta = jl('typed.jsonl'); const mById = Object.fromEntries(meta.map((m) => [m.id, m]));
const tv = [...jl('by-eye/typed-a1.jsonl'), ...jl('by-eye/typed-a2.jsonl'), ...jl('by-eye/typed-a3.jsonl')];
const pagesN = meta.filter((m) => !m.ocr_is_the_typed_text).length;
const pg = (f) => new Set(tv.filter(f).map((x) => x.id)).size, sn = (f) => tv.filter(f).length;
const sliver = (x) => x.verdict === 'NEIGHBOUR_PAGE' && /sliver|facing/i.test(`${x.where_on_page} ${x.note}`) && x.id.startsWith('69c8a3f26c');
const typed = {
  pages: pagesN, flagged_sentences_read: tv.length, seen_on_image: sn((x) => x.seen_on_image === 'yes'),
  verdicts: Object.fromEntries([...new Set(tv.map((x) => `${x.flagged_against} / ${x.verdict}`))].sort().map((k) => [k, { sentences: sn((x) => `${x.flagged_against} / ${x.verdict}` === k), pages: pg((x) => `${x.flagged_against} / ${x.verdict}` === k) }])),
  translation_introduced: { sentences: sn((x) => x.verdict === 'TRANSLATION_ADDED'), ...r(pg((x) => x.verdict === 'TRANSLATION_ADDED'), pagesN) },
  ocr_introduced_invented_text: { sentences: sn((x) => x.verdict === 'OCR_INVENTED'), ...r(pg((x) => x.verdict === 'OCR_INVENTED'), pagesN) },
  ocr_introduced_description_rendered_as_text: { sentences: sn((x) => x.verdict === 'OCR_DESCRIPTION'), ...r(pg((x) => x.verdict === 'OCR_DESCRIPTION'), pagesN) },
  ocr_read_the_facing_page_and_translation_completed_it: { sentences: sn(sliver), ...r(pg(sliver), pagesN) },
  ocr_introduced_any: r(pg((x) => x.verdict === 'OCR_INVENTED' || x.verdict === 'OCR_DESCRIPTION' || sliver(x)), pagesN),
  typed_text_leaves_it_out: { sentences: sn((x) => x.verdict === 'TYPED_OMITS'), ...r(pg((x) => x.verdict === 'TYPED_OMITS'), pagesN) },
  detector_wrong_against_ocr: { sentences: sn((x) => x.flagged_against !== 'typed_only' && /IN_BOTH|CHOICE/.test(x.verdict)), ...r(pg((x) => x.flagged_against !== 'typed_only' && /IN_BOTH|CHOICE/.test(x.verdict)), pagesN) },
  detector_wrong_against_typed: { sentences: sn((x) => x.flagged_against === 'typed_only' && /IN_BOTH|CHOICE/.test(x.verdict)), ...r(pg((x) => x.flagged_against === 'typed_only' && /IN_BOTH|CHOICE/.test(x.verdict)), pagesN) },
  by_translating_model: {}, stage_rows: tv.filter((x) => /TRANSLATION_ADDED|OCR_INVENTED|OCR_DESCRIPTION|NEIGHBOUR/.test(x.verdict)).map((x) => ({ id: x.id, language: mById[x.id].language, ref_kind: mById[x.id].ref_kind, translation_model: mById[x.id].model, prompt_version: mById[x.id].prompt_version, ocr_model: mById[x.id].ocr_model, n: x.sentence_number, verdict: x.verdict, seen_on_image: x.seen_on_image, confidence: x.confidence, note: x.note })),
};
for (const m of [...new Set(meta.filter((x) => !x.ocr_is_the_typed_text).map((x) => x.model))]) { const ids = new Set(meta.filter((x) => !x.ocr_is_the_typed_text && x.model === m).map((x) => x.id)); typed.by_translating_model[m] = { translation_introduced: r(new Set(tv.filter((x) => ids.has(x.id) && x.verdict === 'TRANSLATION_ADDED').map((x) => x.id)).size, ids.size) }; }
const tib = J('typed.gemini-3-flash-preview.flags.json').groups['Tibetan (typed text is the stored text)'];
typed.tibetan_engine_judgement_only = { pages: tib.pages, flagged_pages: r(tib.pages_flagged_vs_typed, tib.pages), note: 'the Esukhia e-text is the stored page text, so there is no OCR stage to compare; no Tibetan was translated; flags not read by a Tibetan reader' };
fs.writeFileSync(path.join(DIR, 'results.json'), JSON.stringify({ issue: 5982, detector: 'gemini-3-flash-preview, prompt additions-5982-v2 + keepFlag', draw, draw_pages: pageRows, draw_flags_by_eye: flags.map(({ id, n, kind, words, verdict, note, confidence, language, model, prompt_version }) => ({ id, n, language, model, prompt_version, detector_kind: kind, words, verdict, note, confidence })), typed }, null, 1));
const s = (x) => `${x.k}/${x.n} = ${x.pct}% [${x.ci.join(', ')}]`;
console.log('DRAW  raw flagged', s(draw.flagged_pages_raw), '| flags read', flags.length, 'on', draw.by_eye_flags.pages_covered, 'pages', JSON.stringify(verdictCount), '| true', s(draw.by_eye_flags.true_additions));
console.log('      flagged pages confirmed', s(draw.flagged_pages_confirmed), '| unconfirmed with unread flags', draw.flagged_pages_not_confirmed_with_unread_flags, '| RATE', s(draw.rate_confirmed_pages), JSON.stringify(draw.page_verdicts), 'from OCR description', draw.confirmed_from_the_ocr_description);
console.log('      unflagged with addition', s(draw.unflagged_with_an_addition_of_5_words_or_more), '| neighbour', draw.unflagged_with_neighbour_page_text, '| short adds', draw.unflagged_with_short_additions, '| Lite agrees:', s(draw.confirmed_when_lite_also_flags), 'Flash alone:', s(draw.confirmed_when_flash_alone));
for (const [t, o] of [['model', draw.confirmed_by_model], ['version', draw.confirmed_by_prompt_version], ['model·version', draw.confirmed_by_model_and_version], ['language', draw.confirmed_by_language]]) { console.log(' by', t); for (const [g, x] of Object.entries(o)) if (x.n >= 8) console.log(`   ${g.padEnd(40)} raw ${String(x.raw_flagged).padStart(2)}  confirmed ${s(x)}`); }
console.log('TYPED pages', typed.pages, '| translation-introduced', s(typed.translation_introduced), typed.translation_introduced.sentences, 'sent | OCR invented', s(typed.ocr_introduced_invented_text), '| OCR description', s(typed.ocr_introduced_description_rendered_as_text), '| facing page', s(typed.ocr_read_the_facing_page_and_translation_completed_it), '| OCR any', s(typed.ocr_introduced_any));
console.log('      typed omits', s(typed.typed_text_leaves_it_out), typed.typed_text_leaves_it_out.sentences, 'sent | detector wrong vs OCR', s(typed.detector_wrong_against_ocr), '| vs typed', s(typed.detector_wrong_against_typed), '| by model', JSON.stringify(typed.by_translating_model));
