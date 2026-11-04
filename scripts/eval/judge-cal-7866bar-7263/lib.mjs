// PRIOR ART: scripts/eval/judge-calibration-7263/lib.mjs (#7880: the order-free CER `cerLines` against a human
// transcription, kappa, Wilson; imported). It calibrated the judge on CHURRO-DS pages read fresh by two models, at a
// 1% CER bar; this file calibrates it on STORED reads of our own books, at #7866's bar ("bad" = not accepted or any
// wrong-text span). scripts/eval/typed-refs-6012/ (the DTA / EEBO-TCP / CAMENA typed texts on private R2, their
// tei-pages-v1 page split, and the same-edition page alignment: read, not rebuilt). scripts/eval/paddle-zh-qa-6388/
// prepare.mjs kanripoScore (the #5935 Kanripo leaf rule and body CER, page by page) — reused with one change: the leaf
// is taken from the page's two NEIGHBOURS only, never from the page's own read, so a page is not chosen by how well
// it was read. scripts/eval/confidence-7866/ (eligiblePage, imageUrl, judgeAbsolute, paceCheck, badPage: imported).
/**
 * Judge calibration at #7866's bar (#7263; paper "How far to trust the 43%"). Shared pieces: seeds, the truth rule.
 *
 * TRUTH (fixed here before any judge call; from the typed reference alone, never from a model):
 *   A page is BAD when it carries a wrong-text span, or it would not be accepted (its error rate is over TAU).
 *   Latin-script print (DTA, EEBO-TCP, CAMENA; reference = the same-edition typed page, tei-pages-v1):
 *     read  = bodyText(stored ocr.data)  (#5935: running heads, signatures, catchwords, marginalia, notes dropped;
 *             the typed page drops fw and notes the same way)
 *     miss  = order-free CER of the reference's lines inside the read (#7880 cerLines): misreads, dropped words/lines
 *     extra = the read's own lines located in the reference window (this page's typed text with its notes, and the
 *             typed pages either side): characters of the read that are not on the page
 *     wrong-text span = a read line with >= SPAN_MIN letters whose own CER in that window is > SPAN_CER: text that is
 *             not on this page (invented, or another leaf's)
 *     bad = span || miss > TAU || extra > TAU
 *   Chinese manuscript (Siku Quanshu; reference = Kanripo WYG, the leaf fixed by the page's two neighbours):
 *     cer   = #5935 bodyCer of the read's Han body fitted inside Kanripo leaves k-1..k+1 (every read character charged;
 *             omission beyond 10% of the leaf charged)
 *     wrong-text span = an edit run of >= HAN_SPAN characters the read has and the leaf does not (inserted or
 *             substituted)
 *     bad = span || cer > TAU
 *   TAU = 0.01 is #7880's measured point where the judge accepts half the time (1.0%, 0.7 to 1.4), the router's 1% bar.
 *   0.005, 0.02 and 0.05 are reported as sensitivities.
 */
import { cerLines } from '../judge-calibration-7263/lib.mjs';
import { normalizeForScript, windowedErrorRate } from '../lib/metrics.mjs';
import { bodyText, foldHan, bodyCer } from '../ground-truth-5935/lib.mjs';

export const SEED = Object.freeze({ books: 72631, pages: 72632, queue: 72633, wrongPage: 72634, repeats: 72635, sim: 72636 });
export const N = Object.freeze({ German: 20, English: 20, Latin: 20, Chinese: 40 });
export const CALL_CAP = 130;
export const TAU = 0.01, TAUS = [0.005, 0.01, 0.02, 0.05];
export const SPAN_MIN = 10, SPAN_CER = 0.5, HAN_SPAN = 4;
export const MIN_REF_LETTERS = 300, MIN_HAN = 120;

const preFold = (t) => String(t || '').replace(/ß/g, 'ss').replace(/ẞ/g, 'SS');
const letters = (s) => normalizeForScript(preFold(s), 'latin').replace(/ /g, '').length;

/** Latin-script truth at each TAU. ref: {text, notes[]}; win: [prev, ref, next] texts. */
export function truthLatin(readRaw, ref, win) {
  const read = bodyText(readRaw).split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
  const miss = cerLines(ref.text, read, 'latin');
  const W = normalizeForScript(preFold([...win, ...(ref.notes || [])].join('\n')), 'latin');
  let edits = 0, chars = 0; const spans = [];
  for (const l of read.split('\n')) {
    const L = normalizeForScript(preFold(l), 'latin'); const n = L.replace(/ /g, '').length;
    if (!n) continue;
    const c = Math.min(1, windowedErrorRate(L, W).windowedCer);
    edits += c * n; chars += n;
    if (n >= SPAN_MIN && c > SPAN_CER) spans.push({ letters: n, cer: +c.toFixed(3) });
  }
  const extra = chars ? edits / chars : 1;
  const out = { kind: 'latin', miss: +miss.toFixed(4), extra: +extra.toFixed(4), read_letters: chars, ref_letters: letters(ref.text), spans };
  for (const t of TAUS) out[`bad@${t}`] = spans.length > 0 || miss > t || extra > t;
  out.bad = out[`bad@${TAU}`];
  return out;
}

/** Chinese truth: the read's Han body inside Kanripo leaves k-1..k+1 (pbs: folded leaf texts), expected = leaf k. */
export function truthHan(readRaw, pbs, k) {
  const Q = foldHan(bodyText(readRaw));
  const W = pbs.slice(Math.max(0, k - 1), k + 2).map((x) => x.text).join('');
  const s = bodyCer(Q, W, { expected: pbs[k].text.length, ops: true });
  const spans = s.runs.filter((r) => [...r.ours].length >= HAN_SPAN).map((r) => ({ chars: [...r.ours].length, ref_chars: [...r.ref].length }));
  const out = { kind: 'han', cer: +s.cer.toFixed(4), q_chars: s.q_chars, expected: pbs[k].text.length, omitted: s.omitted, spans };
  for (const t of TAUS) out[`bad@${t}`] = spans.length > 0 || s.cer > t;
  out.bad = out[`bad@${TAU}`];
  return out;
}
