// PRIOR ART: scripts/eval/build-model-roster.mjs (the rules lived there until #6776's cleanup round; moved here so the
// pareto builds can name only runnable engines in a verdict sentence, Derek 2026-10-16) — scripts/lib/agy-cli.mjs
// assertGeminiModel enforces one rule at call time and lists nothing. Searched scripts/eval/lib, scripts/lib for
// "available|roster|runnable" (#6776).
/**
 * Whether we can run an engine today, and by what route (#6776). One function, `availabilityOf(id)`, read by
 * scripts/eval/build-model-roster.mjs (src/data/model-roster.json, the page's "What we can run today") and by
 * scripts/eval/build-ocr-pareto.mjs / build-translation-pareto.mjs (a verdict sentence names only engines we can run).
 *
 * Availability is judged per MODEL by the route we CAN run it on, not the route it was measured on (Derek 2026-10-16):
 * Claude measured through the API runs on the Claude subscription (`claude -p`); a Gemini model measured on the paid
 * API runs on the Antigravity CLI when `agy models` lists it. Every rule quotes a passage of its source, and loading this
 * module fails if that passage is gone, so a rule cannot outlive its doctrine silently. Which Gemini models the CLI
 * offers is read from the newest recorded `agy models` run (scripts/eval/results/model-roster/agy-models-<date>.txt).
 *
 * The rules (first match wins):
 *   Tesseract                           banned (Derek)
 *   Claude                              available on the subscription only, `claude -p` (measured via API or CLI)
 *   Gemini through agy                  available if `agy models` lists the model (any of its -low/-medium/-high)
 *   Gemini 3.1 Flash-Lite, API          available: the one model for new work on the paid API
 *   another Gemini, measured on the API available through agy when `agy models` lists it; otherwise not available
 *   Gemini 3 Flash, API                 not available for new work, but in use on its production lanes (ocr-routing.mjs
 *                                       FLASH_OCR_FROM, translate-core.mjs MODEL_FLASH): the page shows it as in use there
 *   any other paid API                  not available: the paid API is Flash-Lite only since 2026-10-08
 *   Kraken family                       available: our own server (CPU)
 *   GPU engines                         available: a leased Scaleway GPU, under the lease watchdog
 *   production-*                        the stored production reads / each book's engine: what is in use
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.join(__dirname, '..', '..', '..');
const AGY_DIR = path.join(__dirname, '..', 'results', 'model-roster');

// ── the evidence: the newest recorded `agy models` run ───────────────────────────────────────
const agyFile = fs.readdirSync(AGY_DIR).filter(f => /^agy-models-\d{4}-\d{2}-\d{2}\.txt$/.test(f)).sort().at(-1);
if (!agyFile) throw new Error(`no agy-models-<date>.txt in ${path.relative(REPO, AGY_DIR)}`);
export const CHECKED = agyFile.match(/(\d{4}-\d{2}-\d{2})/)[1];
export const AGY_SOURCE = path.relative(REPO, path.join(AGY_DIR, agyFile));
export const AGY = fs.readFileSync(path.join(AGY_DIR, agyFile), 'utf8').split('\n')
  .filter(l => /^[a-z0-9.-]+\t/.test(l)).map(l => l.split('\t')[0]);
if (!AGY.length) throw new Error(`${AGY_SOURCE}: no models parsed`);
export const agyHas = model => AGY.some(m => m === model || m.replace(/-(low|medium|high)$/, '') === model);

// ── the rules' sources, each with a passage that must still be in it ─────────────────────────
const flat = s => s.replace(/\s+/g, ' ');
export const SRC = {
  tesseract: { source: '.claude/docs/ocr-lane-decision-tree.md', quote: '**No Tesseract**, as an engine or as a free reference (Derek)' },
  claude: { source: 'scripts/lib/agy-cli.mjs', quote: 'Claude runs through the Claude subscription (`claude -p`, subagents), and through agy only on an account whose Gemini weekly pool reads 0' },
  geminiApi: { source: 'scripts/batch/cli-ocr.mjs', quote: 'Since 2026-10-08 every Gemini model except flash-lite runs through the subscription CLI instead' },
  paidApi: { source: 'scripts/eval/experiments/2026-10-08-syriac-print-pareto-6295.md', quote: 'spend rule of 2026-10-08: only `gemini-3.1-flash-lite` on the paid API' },
  ocrLane: { source: 'scripts/lib/ocr-routing.mjs', quote: 'The first exception to OCR_LITE_ONLY: Greek reads on flash (#5575)' },
  translateLane: { source: 'scripts/lib/translate-core.mjs', quote: "export const MODEL_FLASH = 'gemini-3-flash-preview';" },
  kraken: { source: '.claude/docs/ocr-lane-decision-tree.md', quote: 'Kraken lane on Hetzner (`syriac-kraken-lane.mjs`)' },
  gpu: { source: 'CLAUDE.md', quote: 'lease it (`scripts/maintenance/gpu-lease-watchdog.mjs --lease' },
  production: { source: 'scripts/lib/ocr-routing.mjs', quote: null },
};
// a passage may run across comment lines: compare with the comment markers and line breaks removed
const plain = s => flat(s.replace(/^\s*(\/\/|\*)\s?/gm, ''));
for (const [k, s] of Object.entries(SRC)) {
  if (s.quote && !plain(fs.readFileSync(path.join(REPO, s.source), 'utf8')).includes(flat(s.quote))) throw new Error(`rule "${k}": the passage "${s.quote}" is no longer in ${s.source}`);
}
const AGY_RULE = { source: AGY_SOURCE, quote: null };

/** What the page says beside an engine measured on one route and run on another. */
export const MEASURED_VIA_API = {
  claude: 'measured via API; we run it on the subscription, $0 billed',
  gemini: 'measured via the paid API; we run it on the Antigravity CLI, $0 billed',
};
/** The footnote wherever a production lane keeps a route new work may not use (Derek 2026-10-16). */
export const PRODUCTION_LANE_NOTE = 'Production lanes keep their approved routes; new work runs Flash-Lite on the API and every other Gemini model on the CLI.';

const GPU = /^(deepseek-ocr|chandra-ocr|qwen3-vl|cllg-qwen3vl|surya|olmocr|paddleocr-vl|dots-mocr|ndlkotenocr|mineru)/;
const KRAKEN = /^(kraken|omnisyr|qoruyo|sophro)/;
const plainText = s => (s == null ? s : s.replace(/`/g, ''));   // shown as plain text on the page
const row = (group, route, how, available, why_not, src, extra = {}) => ({ group, route, how: plainText(how), available, why_not: plainText(why_not), source: src.source, ...(src.quote ? { rule: src.quote } : {}), ...extra });

/** The route groups, in the order "What we can run today" lists them. */
export const GROUPS = [
  { id: 'gemini-api', title: 'Gemini 3.1 Flash-Lite', route: 'api', how: 'the paid Gemini API, Batch', cost_basis: 'billed per page at the Batch rate' },
  { id: 'gemini-cli', title: 'Gemini through the Antigravity CLI', route: 'subscription', how: 'agy -p on the Google subscription', cost_basis: '$0 billed; costs time and subscription quota' },
  { id: 'claude-cli', title: 'Claude through the Claude CLI', route: 'subscription', how: 'claude -p on the Claude subscription', cost_basis: '$0 billed; costs time and subscription quota' },
  { id: 'gpu', title: 'Open models on a rented GPU', route: 'gpu', how: 'a leased Scaleway GPU under the lease watchdog', cost_basis: 'rental billed by the hour, shared over the pages read' },
  { id: 'kraken', title: 'Kraken models', route: 'own', how: 'our own server, CPU', cost_basis: 'no per-page bill' },
  { id: 'production-lane', title: 'Gemini 3 Flash on its production lanes', route: 'api', how: 'the paid Gemini API, Batch, on the lanes production already runs', cost_basis: 'billed per page at the Batch rate' },
  { id: 'production', title: 'What production already stored', route: 'api', how: 'the reads already in the library', cost_basis: 'already paid' },
  { id: 'other-api', title: 'Other paid APIs', route: 'api', how: 'billed per request', cost_basis: 'billed per request' },
  { id: 'banned', title: 'Banned', route: 'own', how: '—', cost_basis: '—' },
];

/** The roster row for one engine id ("<engine>|kraken" is the same engine on another input), or null: no rule. */
export function availabilityOf(engine) {
  const id = engine.split('|')[0];
  if (/^tesseract/.test(id)) return row('banned', 'own', 'Tesseract on our own server', false, 'banned: Tesseract is not used, as an engine or as a reference', SRC.tesseract);
  if (/^claude-/.test(id)) {
    // the translation rounds ran Claude as subagents ("claude-sonnet-5.5", "claude-opus"); "+claude-cli" is the CLI;
    // "claude-sonnet-5-5" / "claude-opus-5-5" were billed through the API in the OCR rounds
    const viaApi = /^claude-(sonnet|opus|haiku)-\d+-\d+$/.test(id);
    return row('claude-cli', 'subscription', '`claude -p` on the Claude subscription, $0 billed', true, null, SRC.claude,
      viaApi ? { measured_via: 'api', note: MEASURED_VIA_API.claude } : {});
  }
  const cli = id.match(/^(gemini-[a-z0-9.-]+)\+antigravity-cli$/);
  if (cli) {
    const ok = agyHas(cli[1]);
    return row('gemini-cli', 'subscription', `\`agy -p --model ${cli[1]}\` on the Google subscription, $0 billed`, ok,
      ok ? null : `no longer offered by the Antigravity CLI (\`agy models\`, ${CHECKED})`, AGY_RULE);
  }
  if (id === 'gemini-3.1-flash-lite') return row('gemini-api', 'api', 'the paid Gemini API (Batch)', true, null, SRC.geminiApi);
  if (/^gemini-/.test(id)) {
    const model = id.replace(/\+.*$/, '').replace(/-preview$/, '');
    if (agyHas(model)) {
      return row('gemini-cli', 'subscription', `\`agy -p --model ${model}\` on the Google subscription, $0 billed`, true, null, AGY_RULE,
        { measured_via: 'api', note: MEASURED_VIA_API.gemini });
    }
    if (id === 'gemini-3-flash-preview') {
      return row('production-lane', 'api', 'the paid Gemini API (Batch), on the lanes production runs it on', false,
        'new work: the paid Gemini API runs Flash-Lite only since 2026-10-08, and the Antigravity CLI does not offer this model', SRC.ocrLane,
        { in_use_route: 'paid API, production lane', lanes: 'OCR of Greek, Persian, Sanskrit, Pali, Arabic and Ge’ez; translation of the languages measured to gain from it', lane_sources: [SRC.ocrLane.source, SRC.translateLane.source] });
    }
    return row('other-api', 'api', 'the paid Gemini API', false, 'the paid Gemini API runs Flash-Lite only since 2026-10-08, and the Antigravity CLI does not offer this model', SRC.geminiApi);
  }
  if (KRAKEN.test(id)) return row('kraken', 'own', 'Kraken on our own server (CPU)', true, null, SRC.kraken);
  if (GPU.test(id)) return row('gpu', 'gpu', 'a leased Scaleway GPU, under the lease watchdog; billed by the hour', true, null, SRC.gpu);
  if (id === 'production-stored') return row('production', 'api', 'the production OCR already stored for each page', true, null, SRC.production);
  if (id === 'production-per-book') return row('production', 'api', 'each book’s production engine', true, null, SRC.production);
  if (/^mistral-/.test(id)) return row('other-api', 'api', 'the Mistral API, billed per page', false, 'the paid API is for Gemini 3.1 Flash-Lite only since 2026-10-08', SRC.paidApi);
  return null;
}

/** Whether a verdict may name an engine as one to run: we can run it today, or it is the engine in use. */
export const canRunToday = (engine) => !!availabilityOf(engine)?.available;
