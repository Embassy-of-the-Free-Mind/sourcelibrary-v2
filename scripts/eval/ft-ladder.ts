/**
 * ft-ladder.ts — the FT verification escalation ladder (#3778).
 *
 * Runs each queued book up the cheapest rung that can settle it:
 *
 *   rung 0  history      — the attempt ledger already answers → skip (free)
 *   rung 1  registry     — deterministic tier-0 catalog match → log it (free)
 *   rung 2  skeptic      — grounded Gemini refutation attempt (~$0.005–0.03/book)
 *   rung 3  claude queue — hard classes + rung-2 residue, emitted as a queue
 *                          file for the ft-verify skill (NOT executed here)
 *   rung 4  human queue  — policy holds (practitioner PDFs etc.), emitted
 *
 * ACTUATION (#3776): with --apply this script writes to
 * `first_translation_attempts`, which the 05:30 nightly derive+reconcile reads.
 * Every row written here carries a method that resolves to tier1_catalog or
 * tier0_linked — resolvers the reconcile valve (--resolver=tier2_agent,human)
 * does NOT admit — so nothing this script writes can move a public badge.
 * The badge-moving tier is rung 3+ (ft-verify → ingest-ft-verify-results.mjs)
 * and stays behind Derek's sign-off. Pinned by tests/unit/ft-skeptic.test.ts.
 *
 * QUEUE CLAIM (#3778 non-negotiable): before launching a paid run over a shared
 * queue, claim it with a comment on the tracking issue — two sessions running
 * the same queue duplicate spend and collide in the ledger (the 08-08 lesson).
 *
 * SAFE/COST: free and read-only by default. --run performs the paid rung-2
 * searches (requires --budget-usd, hard cap). --apply persists ledger rows +
 * transcripts. Never flips a badge, never writes a verdict.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   npx tsx scripts/eval/ft-ladder.ts --limit=50                 # free: rungs 0-1 + routing report
 *   npx tsx scripts/eval/ft-ladder.ts --limit=50 --apply         # also log rung-1 registry hits
 *   npx tsx scripts/eval/ft-ladder.ts --limit=50 --run --apply --budget-usd=1
 *   npx tsx scripts/eval/ft-ladder.ts --queue=contradictions --run --apply --budget-usd=2
 *   npx tsx scripts/eval/ft-ladder.ts --ids=abc123,def456 --run --apply --budget-usd=0.50
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { getDb } from '@/lib/mongodb';
import { makeTier0Catalog, type CatalogPrior, type CatalogLookup } from '@/lib/first-translation/tier0-catalog';
import type { ResolvableBook } from '@/lib/first-translation/resolve';
import { appendAttempt, makeAttemptId, type FirstTranslationAttempt, type PriorTranslation } from '@/lib/first-translation/attempt-log';
import { renderRubric, routeBook, postSearchRoute } from '@/lib/first-translation/casebook';
import {
  SKEPTIC_PROMPT_VERSION, buildSkepticPrompt, parseSkepticResponse,
  normalizeSkepticAttempt, type SkepticBook, type SkepticDirection,
} from '@/lib/first-translation/skeptic';
// @ts-expect-error — plain .mjs modules without type declarations (tsx resolves them)
import { screenDemoteCandidate } from '../lib/ft-demote-screen.mjs';
// @ts-expect-error — plain .mjs module without type declarations
import { costOf } from '../lib/model-pricing.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'output');
const DATE = new Date().toISOString().slice(0, 10);
const RUN_DATE = new Date().toISOString();

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const RUN = process.argv.includes('--run');
const APPLY = process.argv.includes('--apply');
const QUEUE = arg('queue') ?? 'badged-weak';
/**
 * `--ids` takes a comma list; `--ids-file` takes a path with one id per line
 * (or a comma list). Prefer the file for anything sampler-sized — a thousand
 * ids on argv is near the shell's limit and gets mangled rather than rejected.
 */
const idsFile = arg('ids-file');
const idsRaw = idsFile ? fs.readFileSync(idsFile, 'utf8') : arg('ids');
const IDS = idsRaw?.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
const LIMIT = parseInt(arg('limit') ?? '0', 10);
const MODEL = arg('model') ?? 'gemini-3.1-flash-lite';
const BUDGET = parseFloat(arg('budget-usd') ?? '0');
/**
 * Explicit positive thinking cap (tokens). Unset → the API default (dynamic).
 * NEVER pass -1: `thinkingBudget: -1` silently SUPPRESSES grounding on
 * flash-preview (the §8 hazard in the FT paper). A positive cap bounds the
 * dominant cost driver — unbounded thinking ran ~$0.19/book on preview vs
 * ~$0.002 for lean calls (measured 2026-08-10).
 */
const THINKING = arg('thinking-budget');
const THINKING_BUDGET = THINKING !== undefined ? Math.max(0, parseInt(THINKING, 10) || 0) : undefined;
const CONC = parseInt(arg('concurrency') ?? '4', 10);
const TRANSCRIPTS = 'first_translation_transcripts'; // pure archive: no automated job reads it (#3778)

if (RUN && !(BUDGET > 0)) {
  console.error('--run is a paid operation and requires an explicit --budget-usd=<cap>.');
  process.exit(1);
}

const keys: string[] = [];
if (process.env.GEMINI_API_KEY) keys.push(process.env.GEMINI_API_KEY);
for (let i = 2; i <= 7; i++) { const k = process.env[`GEMINI_API_KEY_${i}`]; if (k) keys.push(k); }
let keyIdx = 0;
const nextKey = () => keys[(keyIdx++) % keys.length];

interface LadderRow {
  id: string;
  title?: string;
  author?: string;
  language?: string;
  rung: 0 | 1 | 2 | 3 | 4;
  outcome: string;
  reasons: string[];
  skeptic_result?: string;
  cost_usd?: number;
}

async function main() {
  if (RUN && keys.length === 0) { console.error('No GEMINI_API_KEY in env.'); process.exit(1); }
  const db = await getDb();
  const books = db.collection('books');
  const attemptsCol = db.collection('first_translation_attempts');

  /* ---------- queue selection ---------- */
  const NOT_ENGLISH = { $nin: [null, 'en', 'eng', 'English', 'english'] };
  let query: Record<string, unknown>;
  if (IDS?.length) {
    query = { id: { $in: IDS } };
  } else if (QUEUE === 'contradictions') {
    // The #3687 shape: publicly badged first while our own verdict says not_first.
    query = { is_first_translation: true, visible: true, 'first_translation.verdict': 'not_first' };
  } else if (QUEUE === 'badged-weak') {
    // The mass: badged books whose verdict rests on weak evidence (the shim) or none.
    query = {
      is_first_translation: true, visible: true, language: NOT_ENGLISH,
      $or: [
        { 'first_translation.evidence_strength': 'weak' },
        { first_translation: { $exists: false } },
      ],
    };
  } else {
    console.error(`Unknown --queue=${QUEUE} (badged-weak | contradictions)`); process.exit(1); return;
  }

  const cursor = books.find(query, {
    projection: {
      _id: 0, id: 1, title: 1, author: 1, language: 1, original_language: 1, work_id: 1,
      text_role: 1, first_translation: 1, 'translation_verification.translations_found': 1,
    },
  }).sort({ id: 1 });
  if (LIMIT) cursor.limit(LIMIT);
  const queue = await cursor.toArray();
  console.log(`queue=${IDS ? `ids(${IDS.length})` : QUEUE} → ${queue.length} book(s)  [run=${RUN} apply=${APPLY} model=${MODEL} budget=$${BUDGET || 0}]`);

  /* ---------- rung-1 registry index (loaded once) ---------- */
  const norm = (s?: string) =>
    (s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const surnameOf = (author?: string) => {
    const a = norm(author);
    if (!a) return '';
    return a.includes(',') ? a.split(',')[0].trim() : a.split(' ').slice(-1)[0];
  };
  const tokens = (s?: string) => new Set(norm(s).split(' ').filter((t) => t.length > 3));
  const overlap = (a: Set<string>, b: Set<string>) => {
    if (!a.size || !b.size) return 0;
    let n = 0; for (const t of a) if (b.has(t)) n++;
    return n / Math.min(a.size, b.size);
  };
  const completeRows = await db.collection('translation_catalogs')
    .find({ completeness: 'complete' }, {
      projection: {
        _id: 0, author_surname: 1, canonical_author_normalized: 1, canonical_work_normalized: 1,
        english_title: 1, english_title_normalized: 1, translator: 1, pub_year: 1,
        completeness: 1, source_language: 1, source_url: 1, source: 1,
      },
    }).toArray();
  const bySurname = new Map<string, typeof completeRows>();
  for (const r of completeRows) {
    const sn = (r.author_surname && norm(r.author_surname)) || surnameOf(r.canonical_author_normalized);
    if (!sn) continue;
    (bySurname.get(sn) ?? bySurname.set(sn, []).get(sn)!).push(r);
  }
  const lookup: CatalogLookup = async (book) => {
    const rows = bySurname.get(surnameOf(book.author));
    if (!rows) return [];
    const wt = tokens(book.title);
    const out: CatalogPrior[] = [];
    for (const r of rows) {
      const ov = Math.max(overlap(wt, tokens(r.canonical_work_normalized)), overlap(wt, tokens(r.english_title_normalized)));
      if (ov >= 0.6) {
        out.push({
          english_title: r.english_title, translator: r.translator, pub_year: r.pub_year,
          completeness: r.completeness, source_language: r.source_language, source_url: r.source_url,
          source: r.source, matched_by: 'author_title',
        });
      }
    }
    return out;
  };
  const tier0 = makeTier0Catalog(lookup);
  console.log(`registry: ${completeRows.length} complete catalog rows across ${bySurname.size} surnames`);

  /* ---------- the ladder ---------- */
  const rows: LadderRow[] = [];
  const rung3Queue: Array<Record<string, unknown>> = [];
  const rung4Queue: Array<Record<string, unknown>> = [];
  let spent = 0;
  let rung1Applied = 0, rung2Logged = 0;

  async function skepticCall(prompt: string): Promise<{ text: string; queries: string[]; sources: string[]; chunks: Array<{ uri?: string; title?: string }>; cost: number } | { error: string }> {
    for (let attempt = 0; attempt <= 2; attempt++) {
      try {
        const ai = new GoogleGenAI({ apiKey: nextKey() });
        const resp = await ai.models.generateContent({
          model: MODEL, contents: prompt,
          config: {
            tools: [{ googleSearch: {} }], temperature: 0.1,
            ...(THINKING_BUDGET !== undefined ? { thinkingConfig: { thinkingBudget: THINKING_BUDGET } } : {}),
          },
        });
        const gm = (resp.candidates?.[0] as { groundingMetadata?: { webSearchQueries?: string[]; groundingChunks?: Array<{ web?: { uri?: string; title?: string } }> } })?.groundingMetadata ?? {};
        const u = resp.usageMetadata ?? {};
        const cost = costOf(MODEL, u.promptTokenCount ?? 0, (u.candidatesTokenCount ?? 0) + ((u as { thoughtsTokenCount?: number }).thoughtsTokenCount ?? 0));
        return {
          text: resp.text ?? '',
          queries: Array.isArray(gm.webSearchQueries) ? gm.webSearchQueries : [],
          sources: [...new Set((gm.groundingChunks ?? []).map((c) => c?.web?.title || c?.web?.uri).filter((s): s is string => !!s))],
          chunks: (gm.groundingChunks ?? []).map((c) => ({ uri: c?.web?.uri, title: c?.web?.title })),
          cost,
        };
      } catch (err) {
        const msg = String((err as Error).message ?? err);
        if (attempt < 2 && /fetch failed|ECONNRESET|timeout|503|500|overloaded|RESOURCE_EXHAUSTED|429/i.test(msg)) {
          await new Promise((r) => setTimeout(r, (attempt + 1) * 2500)); continue;
        }
        return { error: msg.slice(0, 200) };
      }
    }
    return { error: 'retries_exhausted' };
  }

  const work = [...queue];
  async function worker() {
    while (work.length) {
      const b = work.shift()!;
      const row: LadderRow = { id: b.id, title: b.title, author: b.author, language: b.language, rung: 0, outcome: '', reasons: [] };
      rows.push(row);

      /* rung 0 — history */
      const stored = b.first_translation as { resolver?: string; verdict?: string } | undefined;
      if (stored?.resolver === 'tier2_agent' || stored?.resolver === 'human') {
        row.outcome = `resolved:${stored.verdict} (resolver=${stored.resolver})`; continue;
      }
      const attempts = await attemptsCol.find({ book_id: b.id }).sort({ date: -1 }).limit(20).toArray();
      // Model-aware: the instrument is (prompt_version, model), not the prompt
      // alone. gemini-3.1-flash-lite answers this prompt WITHOUT grounding
      // (empty groundingMetadata on all 189 rows of the 2026-08-10 batch), and
      // a prompt-only skip would let those ungrounded rows permanently block a
      // grounded re-run on a model that actually searches.
      if (attempts.some((a) => a.prompt_version === SKEPTIC_PROMPT_VERSION && a.model === MODEL)) {
        row.outcome = 'already_searched_this_prompt_version'; continue;
      }

      /* rung 1 — registry */
      const outcome = await tier0(b as unknown as ResolvableBook, { now: RUN_DATE });
      if (outcome.terminal && outcome.verdict) {
        row.rung = 1;
        const p = outcome.attempt.priors?.[0];
        row.outcome = `registry_prior:${p?.english_title ?? '?'} (${p?.translator ?? '?'}, ${p?.pub_year ?? '?'})`;
        if (APPLY) { await appendAttempt(db, outcome.attempt); rung1Applied++; }
        continue;
      }

      /* routing — hard classes skip the paid rung */
      const priors: PriorTranslation[] = [];
      for (const a of attempts) for (const p of (a.priors ?? [])) if (p.english_title) priors.push(p);
      for (const p of (b.translation_verification?.translations_found ?? [])) if (p.english_title) priors.push(p);
      const screen = screenDemoteCandidate(b, priors) as { signals: Array<{ code: string }> };
      const pre = routeBook(b, screen.signals.map((s) => s.code));
      if (pre.route === 'claude') {
        row.rung = 3; row.outcome = 'hard_class'; row.reasons = pre.reasons;
        rung3Queue.push({ book_id: b.id, work: b.title, author: b.author, lang: b.language, direction: QUEUE === 'contradictions' ? 'demote' : 'promote', reasons: pre.reasons });
        continue;
      }

      /* rung 2 — grounded skeptic */
      if (!RUN) { row.rung = 2; row.outcome = 'skeptic_pending (--run to execute)'; continue; }
      if (spent >= BUDGET) { row.rung = 2; row.outcome = 'skeptic_skipped:budget_exhausted'; continue; }

      const direction: SkepticDirection = QUEUE === 'contradictions' && priors.length
        ? { kind: 'verify_prior', claimedPriors: priors.slice(0, 6) }
        : { kind: 'refute_first' };
      const prompt = buildSkepticPrompt(b as SkepticBook, renderRubric(b), direction);
      const res = await skepticCall(prompt);
      if ('error' in res) {
        row.rung = 3; row.outcome = `skeptic_error:${res.error}`; row.reasons = ['rung2_error'];
        rung3Queue.push({ book_id: b.id, work: b.title, author: b.author, lang: b.language, direction: direction.kind, reasons: [`rung2_error:${res.error}`] });
        continue;
      }
      spent += res.cost;
      row.cost_usd = res.cost;

      const attemptId = makeAttemptId(b.id, 'gemini_grounded_search', RUN_DATE);
      // Only reference a transcript that was actually persisted.
      const transcriptRef = APPLY ? attemptId : undefined;
      if (APPLY) {
        // Transcript first (a pure archive — nothing automated reads it), so the
        // ledger row can reference it even if parsing below fails.
        await db.collection(TRANSCRIPTS).insertOne({
          attempt_id: attemptId, book_id: b.id, date: RUN_DATE, rung: 2,
          prompt_version: SKEPTIC_PROMPT_VERSION, model: MODEL, prompt,
          raw_response: res.text, grounding: { queries: res.queries, chunks: res.chunks },
          cost_usd: res.cost,
        });
        await db.collection('gemini_usage').insertOne({
          timestamp: new Date(), type: 'ft_ladder_skeptic', model: MODEL, book_id: b.id,
          cost_usd: res.cost, status: 'ok', endpoint: 'script/ft-ladder',
        });
      }

      const parsed = parseSkepticResponse(res.text);
      if (!parsed) {
        row.rung = 3; row.outcome = 'skeptic_unparseable'; row.reasons = ['rung2_parse_failed'];
        rung3Queue.push({ book_id: b.id, work: b.title, author: b.author, lang: b.language, direction: direction.kind, reasons: ["rung2_parse_failed"], transcript_ref: transcriptRef });
        continue;
      }
      const normed = normalizeSkepticAttempt(parsed, { queries: res.queries, sources: res.sources });
      row.rung = 2;
      row.skeptic_result = parsed.result;
      row.outcome = `skeptic:${parsed.result}`;
      row.reasons = normed.problems;

      if (APPLY) {
        const attempt: FirstTranslationAttempt = {
          attempt_id: attemptId, book_id: b.id, work_id: b.work_id ?? null, date: RUN_DATE,
          ...normed.attempt,
          sources_checked: res.sources, queries: res.queries,
          model: MODEL, cost_usd: res.cost,
          prompt_version: SKEPTIC_PROMPT_VERSION, transcript_ref: transcriptRef,
          notes: `[ft-ladder rung2 ${SKEPTIC_PROMPT_VERSION}] ${direction.kind}; ${parsed.reasoning ?? ''}`.slice(0, 480),
        };
        await appendAttempt(db, attempt);
        rung2Logged++;
      }

      /* post-search routing */
      const post = postSearchRoute(normed.attempt.priors ?? []);
      const badged = QUEUE !== 'unbadged';
      const escalate: string[] = [...normed.problems];
      if (post.route === 'human') {
        row.rung = 4; row.reasons = post.reasons;
        rung4Queue.push({ book_id: b.id, work: b.title, author: b.author, lang: b.language, reasons: post.reasons, transcript_ref: transcriptRef });
        continue;
      }
      if (parsed.result === 'uncertain') escalate.push('rung2_uncertain');
      if (parsed.scope_flags?.container || parsed.scope_flags?.witness) escalate.push('rung2_scope_flag');
      // A complete prior found against a live badge is a DEMOTE candidate — only
      // rung 3+ may earn the resolver tier that moves the badge.
      if (badged && parsed.result === 'complete_prior_found') escalate.push('demote_candidate_needs_tier2');
      if (escalate.length) {
        row.rung = 3; row.reasons = escalate;
        rung3Queue.push({
          book_id: b.id, work: b.title, author: b.author, lang: b.language,
          direction: parsed.result === 'complete_prior_found' ? 'demote' : direction.kind,
          claimed_priors: normed.attempt.priors, reasons: escalate, transcript_ref: transcriptRef,
        });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(CONC, work.length)) }, () => worker()));

  /* ---------- report ---------- */
  const byOutcome = new Map<string, number>();
  for (const r of rows) {
    const k = `rung${r.rung}:${r.outcome.split(':')[0]}`;
    byOutcome.set(k, (byOutcome.get(k) ?? 0) + 1);
  }
  console.log('\n── ladder summary ──');
  for (const [k, v] of [...byOutcome.entries()].sort()) console.log(`  ${k.padEnd(40)} ${String(v).padStart(4)}`);
  console.log(`  rung-3 (claude) queue: ${rung3Queue.length} | rung-4 (human) queue: ${rung4Queue.length}`);
  if (RUN) console.log(`  rung-2 spend: $${spent.toFixed(4)} of $${BUDGET} budget${spent >= BUDGET ? '  ← BUDGET EXHAUSTED, queue truncated' : ''}`);

  // RUN REPORTS, not queues (#3881 pass 2). Timestamped so same-day runs never
  // clobber each other. The canonical rung-3/-4 worklist is rebuilt from the
  // ledger at any moment by scripts/eval/ft-rung3-queue.ts — never feed these
  // files to ft-verify.
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const RUN_STAMP = RUN_DATE.replace(/[:.]/g, '-');
  const reportPath = path.join(OUT_DIR, `ft-ladder-report-${RUN_STAMP}.json`);
  fs.writeFileSync(reportPath, JSON.stringify({ date: RUN_DATE, queue: QUEUE, model: MODEL, prompt_version: SKEPTIC_PROMPT_VERSION, spent_usd: spent, rows, rung3: rung3Queue, rung4: rung4Queue }, null, 1));
  console.log(`\nWrote ${reportPath} (run report — the canonical queue is \`npx tsx scripts/eval/ft-rung3-queue.ts\`).`);

  if (APPLY && (rung1Applied || rung2Logged)) {
    console.log(`\n⚠ ACTUATION NOTICE: ingested ${rung1Applied + rung2Logged} row(s) into first_translation_attempts `
      + `(${rung1Applied} registry, ${rung2Logged} skeptic). The 05:30 derive will read them and may update `
      + `book.first_translation verdicts. The reconcile valve (--resolver=tier2_agent,human) excludes every `
      + `resolver these rows can produce, so NO public badge can move from this run.`);
  } else if (!APPLY) {
    console.log('\nDry evidence run — nothing persisted. Re-run with --apply to write ledger rows + transcripts.');
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
