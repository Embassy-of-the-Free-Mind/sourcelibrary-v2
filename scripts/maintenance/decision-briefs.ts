#!/usr/bin/env npx tsx
/**
 * Briefs for /platform/admin/decisions (#6280): Claude's own summary,
 * recommendation and reasons for each card, written by a Claude SESSION and
 * stored in Mongo `decision_briefs`. This script is the two mechanical ends;
 * the reading in the middle is done by whichever session runs it.
 *
 * PRIOR ART: scripts/maintenance/decision-answers-drain.mjs — the other script
 * on this queue; it ACTS on Derek's answers and has no model in it. Nothing in
 * scripts/maintenance or scripts/audit gathers a PR's evidence into a file for
 * a reader. scripts/maintenance/pr-tier.mjs classifies a PR by its paths (why
 * it is held), which is a rule, not a reading of the diff.
 *
 * WHO RUNS IT, WHERE: a Claude Code session on the subscription (Claude is
 * never called through an API key here), on the laptop or a job box, from the
 * repo root with `gh` logged in. No model is called by this script, so it
 * spends nothing; `--packets` reads GitHub and Mongo, `--ingest` writes Mongo.
 *
 * A BRIEF IS A NOTE, NOT AN ACTION: no cron, worker or drainer reads
 * `decision_briefs`. The page shows it above the buttons and Derek taps.
 *
 * USAGE
 *   npx tsx --env-file=.env.production.local scripts/maintenance/decision-briefs.ts --packets <dir> [--all] [--limit N]
 *     One <card id>.md per card that has no current brief (--all: every card),
 *     plus INSTRUCTIONS.md (the shape of a brief) and index.json. The session
 *     reads each packet and writes <dir>/briefs/<card id>.json.
 *   npx tsx --env-file=.env.production.local scripts/maintenance/decision-briefs.ts --ingest <dir> [--dry-run]
 *     Validates every briefs/*.json against the LIVE queue and upserts by
 *     card_id. A bad file is reported and skipped; exit 1 if any was refused.
 *   npx tsx --env-file=.env.production.local scripts/maintenance/decision-briefs.ts --status
 *     How many open cards have a brief.
 *
 * HOW IT FAILS: missing MONGODB_URI or GITHUB_TOKEN → exit 2, nothing written.
 * A PR whose diff `gh` cannot fetch still gets a packet, which says so, so the
 * reader cannot mistake a missing diff for an empty one.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MongoClient } from 'mongodb';
import { CODE_REPO } from '../../src/lib/decision-queue';
import { BRIEFS_COLLECTION, isWaitingOnAuthor, issueOfPr, validateBrief, type BriefedCard } from '../../src/lib/decision-briefs';
import { fetchOpsMarkdown, loadQueue } from '../../src/lib/decision-queue-sources';

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const value = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };

const DIFF_CHARS = 40_000;
const BODY_CHARS = 6_000;

const uri = process.env.MONGODB_URI || process.env.MONGODB_URL;
const token = process.env.GITHUB_TOKEN;
if (!uri) { console.error('Missing MONGODB_URI.'); process.exit(2); }
if (!token) { console.error('Missing GITHUB_TOKEN: the queue cannot be read.'); process.exit(2); }

function gh(args: string[]): { ok: boolean; out: string } {
  const r = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: r.status === 0 ? r.stdout : (r.stderr || `gh exited ${r.status}`).trim() };
}

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n)}\n… [cut at ${n} of ${s.length} characters]`);

function cardHeader(card: BriefedCard): string {
  return [
    `# ${card.question}`,
    '',
    `card_id: ${card.id}`,
    `source: ${card.source}`,
    `raised: ${card.raisedAt ?? 'unknown'}`,
    `opener's default: ${card.defaultLabel}`,
    `what Default does: ${card.defaultDoes}`,
    ...(card.needsDesk ? [`needs a desk: ${card.needsDesk}`] : []),
    ...card.details.map((d) => `detail: ${d}`),
    ...card.evidence.map((e) => `link: ${e.label} ${e.url}`),
  ].join('\n');
}

function prPacket(card: BriefedCard): string {
  const n = String(card.ref.pr);
  const view = gh(['pr', 'view', n, '--repo', CODE_REPO, '--json',
    'title,body,files,labels,createdAt,updatedAt,mergeable,mergeStateStatus,baseRefName,headRefName,statusCheckRollup,comments']);
  const parts = [cardHeader(card), ''];
  if (!view.ok) {
    parts.push(`## PR\nCOULD NOT BE READ: ${view.out}`);
  } else {
    const pr = JSON.parse(view.out);
    const checks = (pr.statusCheckRollup ?? []).map((c: { name?: string; context?: string; conclusion?: string; state?: string }) =>
      `${c.name ?? c.context}=${c.conclusion ?? c.state ?? 'pending'}`).join(', ');
    parts.push(
      `## PR #${n}`,
      `branch ${pr.headRefName} → ${pr.baseRefName} · ${pr.mergeable} / ${pr.mergeStateStatus} · opened ${pr.createdAt} · updated ${pr.updatedAt}`,
      `labels: ${(pr.labels ?? []).map((l: { name: string }) => l.name).join(', ')}`,
      `checks: ${checks || 'NONE RAN (a short list is not a pass)'}`,
      '',
      '### Files',
      ...(pr.files ?? []).map((f: { path: string; additions: number; deletions: number }) => `- ${f.path} +${f.additions} −${f.deletions}`),
      '',
      '### Body',
      clip(pr.body ?? '(empty)', BODY_CHARS),
      '',
      '### Last comments',
      ...(pr.comments ?? []).slice(-4).map((c: { author?: { login?: string }; createdAt: string; body: string }) =>
        `- ${c.author?.login ?? '?'} ${c.createdAt.slice(0, 10)}: ${clip(c.body.replace(/\s+/g, ' '), 600)}`),
    );
  }
  const issue = issueOfPr(card.question);
  if (issue) {
    const iv = gh(['issue', 'view', String(issue), '--repo', CODE_REPO, '--json', 'title,state,body']);
    if (iv.ok) {
      const i = JSON.parse(iv.out);
      parts.push('', `## Issue #${issue} (${i.state}): ${i.title}`, clip(i.body ?? '', 3_000));
    } else {
      parts.push('', `## Issue #${issue}\nCOULD NOT BE READ: ${iv.out}`);
    }
  }
  const diff = gh(['pr', 'diff', n, '--repo', CODE_REPO]);
  parts.push('', '## Diff', diff.ok ? `\`\`\`diff\n${clip(diff.out, DIFF_CHARS)}\n\`\`\`` : `COULD NOT BE READ: ${diff.out}`);
  return parts.join('\n');
}

function opsPacket(card: BriefedCard, opsLines: string[]): string {
  const line = card.ref.line ?? 0;
  return [
    cardHeader(card),
    '',
    `## Section: ${card.ref.section}`,
    '',
    '## The row, in full (ops repo DECISIONS-PENDING.md, private: do not quote it outside the brief)',
    opsLines[line - 1] ?? 'ROW NOT FOUND at the recorded line: the file changed while this packet was being written.',
    '',
    'The linked issues and handoffs are the evidence. Handoff paths are relative to the ops repo (~/sourcelibrary-ops on the laptop).',
  ].join('\n');
}

const INSTRUCTIONS = `# Writing a brief

You are reading one decision on Derek's behalf. He reads the result on his phone, between other things, and taps Default, Other or Skip. Read the packet; when it is not enough to recommend, open what it links (the issue, the handoff, the preview) and say in \`read\` what you opened. Then write \`briefs/<card id>.json\`:

\`\`\`json
{
  "card_id": "pr:0123456789abcdef",
  "summary": "Two plain sentences: what this is, and what changes for a reader of the library or for the bill. No PR jargon.",
  "recommendation": "default | other | skip",
  "recommendation_label": "One line Derek could repeat: 'Merge', 'Close: superseded by #1234', 'Wait for the eval on #5678'.",
  "other_text": "Only when recommendation is other: the exact text to send, written as Derek. On a PR it becomes a PR comment and the PR gets the blocked label.",
  "rationale": ["One to three reasons.", "Each names what you read: 'the diff only touches docs', 'issue #1234 was closed on 2026-10-03'."],
  "risk": "What goes wrong if this recommendation is wrong, and whether it can be undone.",
  "same_decision_as": ["card ids from index.json that duplicate this card, supersede it, or must merge before it"],
  "read": ["diff", "PR body", "issue #1234"],
  "model": "the model you are",
  "written_by": "session or job name"
}
\`\`\`

Rules:
- **default** means the opener's default is right (for a PR: merge). **other** means a different answer, and you write it. **skip** means it cannot be decided yet or needs a desk, and \`recommendation_label\` says what would make it decidable.
- Recommend. "It depends" is not a brief. If the evidence in the packet does not support a recommendation, the recommendation is skip and the reason is the missing evidence, named.
- A green check list says the PR can merge, not that it should. Say what the change does to a reader, to spend, or to data.
- Say when a card is one of several on the same issue and in what order they merge (index.json lists every card with its issue).
- A diff cut short in the packet was not read to the end: either read the rest (\`gh pr diff <n>\`) or say "diff (first 40K)" in \`read\`.
- Limits: summary 500 characters, label 140, each reason 300, risk 300, each \`read\` entry 160 (up to 8 entries). The ingest refuses longer.
- Plain words. State what the source says. No praise, no hedging adverbs.
- The brief is stored and shown to Derek only. Writing it changes nothing else; do not merge, comment or label anything.
`;

async function main() {
  const client = new MongoClient(uri!, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  try {
    const db = client.db(process.env.DB_NAME || 'bookstore');
    const queue = await loadQueue(db);
    for (const e of queue.errors) console.error(`queue: ${e}`);

    if (flag('--status')) {
      const decidable = queue.cards.filter((c) => !isWaitingOnAuthor(c));
      console.log(`${queue.cards.length} open cards; ${decidable.length} decidable, ${decidable.filter((c) => c.brief).length} of those briefed; ${queue.waiting.length} back with their author.`);
      return 0;
    }

    const packetsDir = value('--packets');
    if (packetsDir) {
      // Cards back with their author get no brief: there is nothing for Derek to decide on them yet.
      let todo = queue.cards.filter((c) => !isWaitingOnAuthor(c) && (flag('--all') || !c.brief));
      const limit = Number(value('--limit'));
      if (Number.isInteger(limit) && limit > 0) todo = todo.slice(0, limit);
      mkdirSync(join(packetsDir, 'briefs'), { recursive: true });
      const opsLines = todo.some((c) => c.source === 'ops') ? (await fetchOpsMarkdown(token!)).split('\n') : [];
      for (const card of todo) {
        const text = card.source === 'pr' ? prPacket(card) : opsPacket(card, opsLines);
        writeFileSync(join(packetsDir, `${card.id.replace(':', '-')}.md`), text);
      }
      writeFileSync(join(packetsDir, 'INSTRUCTIONS.md'), INSTRUCTIONS);
      // Every open card, so a reader can name the others a card goes with.
      writeFileSync(join(packetsDir, 'index.json'), JSON.stringify(queue.cards.map((c) => ({
        card_id: c.id, question: c.question, issue: c.source === 'pr' ? issueOfPr(c.question) : null,
        section: c.ref.section ?? null, waiting_on_author: isWaitingOnAuthor(c), has_brief: Boolean(c.brief),
        packet: todo.includes(c) ? `${c.id.replace(':', '-')}.md` : null,
      })), null, 1));
      console.log(`${todo.length} packets in ${packetsDir} (of ${queue.cards.length} open cards; ${queue.waiting.length} back with their author get none).`);
      return 0;
    }

    const ingestDir = value('--ingest');
    if (ingestDir) {
      const live = new Set(queue.cards.map((c) => c.id));
      const dir = join(ingestDir, 'briefs');
      const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
      const now = new Date();
      let written = 0;
      let refused = 0;
      for (const f of files) {
        try {
          const brief = validateBrief(JSON.parse(readFileSync(join(dir, f), 'utf8')), live, now);
          if (!flag('--dry-run')) {
            const r = await db.collection(BRIEFS_COLLECTION).updateOne({ card_id: brief.card_id }, { $set: brief }, { upsert: true });
            if (!r.acknowledged || r.matchedCount + r.upsertedCount !== 1) throw new Error('Mongo did not confirm the write');
          }
          written++;
        } catch (e) {
          refused++;
          console.error(`REFUSED ${f}: ${(e as Error).message}`);
        }
      }
      console.log(`${files.length} brief files: ${written} ${flag('--dry-run') ? 'valid (dry run, nothing written)' : 'written'}, ${refused} refused.`);
      return refused ? 1 : 0;
    }

    console.error('Give one of --packets <dir>, --ingest <dir>, --status. See the header of this file.');
    return 2;
  } finally {
    await client.close();
  }
}

main().then((code) => process.exit(code), (e) => { console.error(e); process.exit(2); });
