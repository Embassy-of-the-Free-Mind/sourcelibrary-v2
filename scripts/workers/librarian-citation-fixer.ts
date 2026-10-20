/**
 * Librarian citation fixer — DRY-RUN worker (#6946, stage 1). Every 10 minutes on l7a (infrastructure/l7a-crontab):
 * takes new Librarian answers from `embassy_messages`, runs the offline fixer on each (Claude Sonnet via `claude -p`
 * on the subscription; never an API key, never Gemini), and writes what it WOULD change to its own collection,
 * `librarian_citation_fixes` — one document per answer: the proposed grounding edits, the per-link outcomes, the
 * model, the prompt version and the validation result.
 *
 * It WRITES NOTHING ELSE. It reads `embassy_messages`, `embassy_threads`, `books` and `pages`, and never writes
 * them, the threads, or the replay cache: applying the edits to what readers see is a separate, later decision.
 *
 * WHAT READS `librarian_citation_fixes`: nothing yet. It is evidence for that decision — how often the fixer
 * would change a live answer, and what it would change — and the input a later stage would apply (the `edits`
 * are in the `grounding_edits` shape the chat clients already apply with applyGroundingEdits).
 *
 * Contract and validation: src/lib/embassy/citation-fixer.ts (a link moves only to a page that holds the span
 * the model copied, string-matched by code; a claim no page states loses its link and gets the marker).
 * Measured in scripts/eval/experiments/2026-10-20-librarian-citation-fixer-6946.md.
 *
 * Which answers: AI messages newer than the newest one already recorded (by _id; at most 6 h back on a first run),
 * with at least one page link, not a short-circuit (greeting, ping, duplicate, replay) and not a replayed answer.
 * The question is the human message before it; the pages are the gauge's set (every page cited ±1 and every
 * source page of the turn), whole, from Mongo.
 *
 * Spend guards: at most MAX_PER_RUN calls a run and MAX_PER_DAY recorded answers a UTC day; no run when this box's
 * Claude account is at ≥ 80% of its 5-hour window or ≥ 90% of its week (the climits meter); a usage-limit reply
 * stops the run without recording the answer, so it is retried next run.
 *
 * PRIOR ART: scripts/audit/librarian-citation-gauge.ts (sampling turns from embassy_messages, the page set, the
 * `claude -p` call); scripts/maintenance/seam-repair-6742/lean.mjs (reading the climits meter for this box's
 * account). This one runs on every new answer, not a weekly sample, and records proposals instead of labels.
 *
 * Usage: npx tsx --env-file=/root/sourcelibrary/.env.production.local scripts/workers/librarian-citation-fixer.ts
 *          [--max=N] [--print]   (print: run the fixer and print the documents, write nothing)
 */
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { findPageLinks } from '@/lib/embassy/citation-pages';
import { FIXER_PROMPT, changesLink, fixerEdits, fixerPacket, parseFixerReply, readablePages, validateVerdicts } from '@/lib/embassy/citation-fixer';
import { loadSupportPages, resolveBookIds } from '@/lib/embassy/librarian';

const arg = (name: string, def?: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? def;
const PRINT = process.argv.includes('--print');
const MAX_PER_RUN = Number(arg('max', '8'));
const MAX_PER_DAY = 200;
const FIRST_RUN_LOOKBACK_MS = 6 * 3600e3;
const MODEL = 'sonnet';
const COLLECTION = 'librarian_citation_fixes';
const PROMPT_VERSION = crypto.createHash('sha256').update(FIXER_PROMPT).digest('hex').slice(0, 12);
const CLAUDE = process.env.CLAUDE_BIN || path.join(os.homedir(), '.local/bin/claude');
const LIMITS = '/root/.claude-limits/latest.json';

/** This box's Claude account usage, or null when unknown (then the run goes ahead: the caps still bound it). */
function accountUsage(): { session: number | null; weekly: number } | null {
  try {
    const latest = JSON.parse(fs.readFileSync(LIMITS, 'utf8'));
    if (Date.now() - Date.parse(latest.checked_at) > 45 * 60e3) return null;
    const email = (JSON.parse(fs.readFileSync('/root/.claude.json', 'utf8')).oauthAccount?.emailAddress || '').toLowerCase();
    const acct = (latest.accounts || []).find((a: { email: string; ok: boolean }) => a.email === email && a.ok);
    if (!acct) return null;
    const lim = Object.fromEntries(acct.limits.map((l: { key: string; percent: number }) => [l.key, l.percent]));
    return lim['weekly_all:all'] == null ? null : { session: lim['session:all'] ?? null, weekly: lim['weekly_all:all'] };
  } catch { return null; }
}

function callFixer(prompt: string): Promise<{ reply: string | null; limit: boolean; ms: number }> {
  return new Promise(resolve => {
    const t0 = Date.now();
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY; // the subscription, never the API
    const child = execFile(CLAUDE, ['-p', '--model', MODEL, '--allowedTools', ''], { cwd: os.tmpdir(), env, timeout: 10 * 60e3, maxBuffer: 16 << 20 }, (err, stdout, stderr) => {
      const out = String(stdout ?? '');
      const limit = /usage limit|hit your limit|limit reached/i.test(out + String(stderr ?? '') + String(err ?? ''));
      resolve({ reply: parseFixerReply(out) ? out : null, limit, ms: Date.now() - t0 });
    });
    child.stdin?.end(prompt);
  });
}

async function main() {
  const usage = accountUsage();
  if (usage && (usage.weekly >= 90 || (usage.session ?? 0) >= 80)) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), skipped: 'claude-account-near-limit', usage }));
    return;
  }
  const db = await getDb();
  const out = db.collection(COLLECTION);
  if (!PRINT) await out.createIndex({ messageId: 1 }, { unique: true });
  const dayStart = new Date(new Date().toISOString().slice(0, 10));
  const today = PRINT ? 0 : await out.countDocuments({ fixedAt: { $gte: dayStart } });
  if (today >= MAX_PER_DAY) { console.log(JSON.stringify({ ts: new Date().toISOString(), skipped: 'daily-cap', today })); return; }

  const last = PRINT ? null : await out.find({}).sort({ messageId: -1 }).limit(1).project({ messageId: 1 }).next();
  const floor = last?.messageId ?? ObjectId.createFromTime(Math.floor((Date.now() - FIRST_RUN_LOOKBACK_MS) / 1000));
  const candidates = await db.collection('embassy_messages')
    .find({ _id: { $gt: floor }, authorType: 'ai' }).sort({ _id: 1 }).limit(200)
    .project({ threadId: 1, content: 1, sources: 1, shortCircuit: 1, cachedFrom: 1, createdAt: 1 }).toArray();

  const counts: Record<string, number> = { candidates: candidates.length, recorded: 0, skipped: 0, calls: 0 };
  for (const m of candidates) {
    if (counts.calls >= MAX_PER_RUN || today + counts.recorded >= MAX_PER_DAY) break;
    const text = String(m.content ?? '');
    const base = { messageId: m._id, threadId: m.threadId, messageAt: m.createdAt ?? null, fixedAt: new Date(), dryRun: true, promptVersion: PROMPT_VERSION };
    const skip = m.shortCircuit ? `short_circuit:${m.shortCircuit}` : m.cachedFrom ? 'replayed' : findPageLinks(text).length === 0 ? 'no_page_link' : null;
    if (skip) {
      // Recorded so the checkpoint moves past it; no call made.
      if (!PRINT) await out.updateOne({ messageId: m._id }, { $setOnInsert: { ...base, status: 'skipped', reason: skip } }, { upsert: true });
      counts.skipped++;
      continue;
    }
    const [question, thread] = await Promise.all([
      db.collection('embassy_messages').find({ threadId: m.threadId, authorType: 'human', _id: { $lt: m._id } }).sort({ _id: -1 }).limit(1).project({ content: 1 }).next(),
      db.collection('embassy_threads').findOne({ _id: m.threadId }, { projection: { lang: 1 } }),
    ]);
    const lang = thread?.lang === 'es' ? 'es' : 'en';
    const sources = (m.sources ?? []) as Array<{ bookId?: string; pageNumber?: number; bookSlug?: string }>;
    const links = findPageLinks(text);
    const ids = await resolveBookIds([...new Set(links.map(l => l.slug))], sources.filter(s => s.bookId).map(s => ({ book_id: s.bookId!, bookSlug: s.bookSlug })) as never);
    const keys = new Set<string>();
    for (const l of links) {
      const id = ids.get(l.slug);
      if (id) for (const p of [l.page, l.page - 1, l.page + 1]) if (p >= 1) keys.add(`${id}:${p}`);
    }
    for (const s of sources) if (s.bookId && s.pageNumber) keys.add(`${s.bookId}:${s.pageNumber}`);
    const pages = readablePages(await loadSupportPages([...keys], lang));
    const packet = fixerPacket(String(question?.content ?? ''), text, pages);

    counts.calls++;
    const r = await callFixer(`${FIXER_PROMPT}\n---\n\n${packet.md}`);
    if (r.limit) { counts.limit = 1; break; } // not recorded: retried next run
    const verdicts = r.reply ? parseFixerReply(r.reply) : null;
    const outcomes = validateVerdicts(text, packet, verdicts);
    const edits = verdicts ? fixerEdits(text, outcomes, lang) : [];
    const tally: Record<string, number> = {};
    for (const o of outcomes) tally[o.outcome] = (tally[o.outcome] ?? 0) + 1;
    const doc = {
      ...base,
      status: verdicts ? (outcomes.some(changesLink) ? 'proposed' : 'no_change') : 'error',
      ...(verdicts ? {} : { reason: 'no parseable fixer reply' }),
      model: MODEL, ms: r.ms, lang,
      pages: pages.map(p => `${p.bookSlug}:${p.page}`),
      outcomes: outcomes.map(o => ({ id: o.id, url: o.link.url, action: o.action, outcome: o.outcome, ...(o.to ? { to: `${o.to.bookSlug}:${o.to.page}` } : {}), span: o.span ?? null, claim: o.claim ?? null })),
      tally,
      edits: edits.map(e => ({ find: e.find, replace: e.replace, at: e.at })),
    };
    if (PRINT) console.log(JSON.stringify(doc, null, 1));
    else await out.updateOne({ messageId: m._id }, { $setOnInsert: doc }, { upsert: true });
    counts.recorded++;
  }
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...counts, promptVersion: PROMPT_VERSION, print: PRINT }));
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
