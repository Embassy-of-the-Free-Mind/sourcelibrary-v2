/**
 * Decision queue, stage 2a (#6280): the pure half of two things that make the
 * queue shorter and each card quicker to answer.
 *
 *   1. GROUPS — cards that are one decision show as one group (PRs that name
 *      the same issue; ops rows under the same section), and PR cards Derek
 *      cannot act on yet (conflicts, `blocked`, a draft) leave the queue for a
 *      "back with the author" list. No model involved.
 *   2. BRIEFS — a Claude session's own reading of one card: a two-sentence
 *      summary, a recommendation, the reasons, the risk. Stored in Mongo
 *      `decision_briefs`, keyed to the card id. A card id already changes when
 *      the PR head or the ops row changes, so a brief written for an older
 *      version of a card can never be shown on the new one.
 *
 * A BRIEF IS A NOTE, NOT AN ACTION. Nothing reads `decision_briefs` except the
 * page. Only Derek's tap writes `decision_answers`, which is what the Hetzner
 * drainer acts on. There is no "accept every recommendation" path, here or on
 * the page: held PRs are never merged on classification alone.
 *
 * PRIOR ART: src/lib/decision-queue.ts — the card shape, ordering and answers
 * this builds on; it has no grouping and no second opinion. The `/decisions`
 * terminal command (private ops repo) prints the ops rows as a digest but does
 * not read PRs or store what it concluded.
 */
import { cardPriority, type DecisionCard } from './decision-queue';

export const BRIEFS_COLLECTION = 'decision_briefs';

export type BriefRecommendation = 'default' | 'other' | 'skip';

export interface DecisionBrief {
  card_id: string;
  /** Two plain sentences: what this is, and what changes for a reader or the bill. */
  summary: string;
  recommendation: BriefRecommendation;
  /** One line: what the recommendation amounts to ("Merge", "Close: superseded by #1234", "Wait for the eval"). */
  recommendation_label: string;
  /** Required when the recommendation is `other`: the exact text to send. Pre-fills the Other box. */
  other_text?: string;
  /** One to three reasons, each naming what was read. */
  rationale: string[];
  /** What goes wrong if the recommendation is wrong, and whether it can be undone. */
  risk: string;
  /** Other card ids this one duplicates, supersedes or must follow. */
  same_decision_as?: string[];
  /** What the writer actually opened: "diff", "PR body", "issue #1234", "preview by eye", "ops row", "handoff". */
  read: string[];
  model: string;
  written_by: string;
  written_at: Date;
}

const CARD_ID = /^(pr|ops|session):[0-9a-f]{16}$/;
const LIMITS = { summary: 500, label: 140, other: 2000, reason: 300, risk: 300 };

function str(v: unknown, name: string, max: number, required = true): string {
  if (v == null || v === '') {
    if (required) throw new Error(`${name} is required`);
    return '';
  }
  if (typeof v !== 'string') throw new Error(`${name} must be a string`);
  const s = v.trim();
  if (required && !s) throw new Error(`${name} is required`);
  if (s.length > max) throw new Error(`${name} is ${s.length} characters; the limit is ${max} (the card is read on a phone)`);
  return s;
}

function strList(v: unknown, name: string, min: number, max: number, each: number): string[] {
  if (!Array.isArray(v)) throw new Error(`${name} must be a list`);
  const out = v.map((x, i) => str(x, `${name}[${i}]`, each));
  if (out.length < min || out.length > max) throw new Error(`${name} needs ${min} to ${max} entries, got ${out.length}`);
  return out;
}

/**
 * Validate one brief as a session wrote it and build the document to store.
 * Throws with the reason; the ingest script reports it per file and writes
 * nothing for that card. `liveIds` is the current queue: a brief for a card
 * that no longer exists (the PR moved on while it was being read) is refused.
 */
export function validateBrief(raw: unknown, liveIds: Set<string>, now: Date): DecisionBrief {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('a brief is a JSON object');
  const r = raw as Record<string, unknown>;
  const cardId = str(r.card_id, 'card_id', 40);
  if (!CARD_ID.test(cardId)) throw new Error(`bad card_id ${cardId}`);
  if (!liveIds.has(cardId)) throw new Error(`card ${cardId} is not in the queue any more (changed or answered since the packet was written)`);
  const recommendation = r.recommendation;
  if (recommendation !== 'default' && recommendation !== 'other' && recommendation !== 'skip') {
    throw new Error('recommendation must be default, other or skip');
  }
  const otherText = str(r.other_text, 'other_text', LIMITS.other, recommendation === 'other');
  const same = r.same_decision_as == null ? [] : strList(r.same_decision_as, 'same_decision_as', 0, 20, 40);
  for (const id of same) {
    if (!CARD_ID.test(id)) throw new Error(`same_decision_as: bad card id ${id}`);
    if (id === cardId) throw new Error('same_decision_as names the card itself');
  }
  return {
    card_id: cardId,
    summary: str(r.summary, 'summary', LIMITS.summary),
    recommendation,
    recommendation_label: str(r.recommendation_label, 'recommendation_label', LIMITS.label),
    ...(otherText ? { other_text: otherText } : {}),
    rationale: strList(r.rationale, 'rationale', 1, 3, LIMITS.reason),
    risk: str(r.risk, 'risk', LIMITS.risk),
    ...(same.length ? { same_decision_as: same } : {}),
    read: strList(r.read, 'read', 1, 8, 80),
    model: str(r.model, 'model', 60),
    written_by: str(r.written_by, 'written_by', 80),
    written_at: now,
  };
}

/** What the page shows of a brief (dates as strings: it crosses to a client component). */
export type CardBrief = Omit<DecisionBrief, 'card_id' | 'written_at' | 'same_decision_as'> & {
  written_at: string;
  /** Questions of the other cards this one goes with, resolved from same_decision_as; gone cards are dropped. */
  goesWith: string[];
  /** True when Claude's recommendation is not the opener's default. */
  disagrees: boolean;
};

export type BriefedCard = DecisionCard & { brief?: CardBrief };

/** Attach each card's brief. The newest brief per card id wins. */
export function attachBriefs(cards: DecisionCard[], briefs: DecisionBrief[]): BriefedCard[] {
  const latest = new Map<string, DecisionBrief>();
  for (const b of briefs) {
    const prev = latest.get(b.card_id);
    if (!prev || new Date(b.written_at) > new Date(prev.written_at)) latest.set(b.card_id, b);
  }
  const questions = new Map(cards.map((c) => [c.id, c.question]));
  return cards.map((c) => {
    const b = latest.get(c.id);
    if (!b) return c;
    const { card_id: _id, written_at, same_decision_as, ...rest } = b;
    return {
      ...c,
      brief: {
        ...rest,
        written_at: new Date(written_at).toISOString(),
        goesWith: (same_decision_as ?? []).flatMap((id) => (questions.has(id) ? [questions.get(id)!] : [])),
        // "default" on a card whose Default cannot act (not mergeable) is still agreement with "not now".
        disagrees: b.recommendation !== 'default',
      },
    };
  });
}

// ── Groups ────────────────────────────────────────────────────────────────

export interface CardGroup {
  /** `issue:6215`, `ops:<section>`, or `one:<card id>` for a card on its own. */
  key: string;
  label: string;
  url?: string;
  cardIds: string[];
}

/** The issue a PR belongs to: the last `(#1234)` in its title, else the first `#1234`. */
export function issueOfPr(question: string): number | null {
  const title = question.replace(/^Merge #\d+: /, '');
  const paren = [...title.matchAll(/\(#(\d{3,5})\b[^)]*\)/g)].pop();
  const m = paren ?? title.match(/(?<![\w/])#(\d{3,5})\b/);
  return m ? Number(m[1]) : null;
}

/** A PR card Derek cannot act on: it goes back to whoever opened it. */
export function isWaitingOnAuthor(card: DecisionCard): boolean {
  return card.source === 'pr' && !card.defaultActionable;
}

/**
 * Split the queue into what Derek can decide (grouped) and what is back with
 * its author. A group forms when two or more cards share an issue (PRs) or a
 * section (ops rows); it sorts by its most urgent card, and its cards keep
 * queue order. `issueTitles` gives a group its name when the page fetched one.
 */
export function groupCards(
  cards: DecisionCard[], now: Date, issueTitles: Record<number, string> = {},
): { groups: CardGroup[]; waiting: string[] } {
  const waiting = cards.filter(isWaitingOnAuthor).map((c) => c.id);
  const ready = cards.filter((c) => !isWaitingOnAuthor(c));
  const keyOf = (c: DecisionCard): string => {
    if (c.source === 'pr') {
      const n = issueOfPr(c.question);
      return n ? `issue:${n}` : `one:${c.id}`;
    }
    return c.ref.section ? `ops:${c.ref.section}` : `one:${c.id}`;
  };
  const byKey = new Map<string, DecisionCard[]>();
  for (const c of ready) byKey.set(keyOf(c), [...(byKey.get(keyOf(c)) ?? []), c]);

  const built: { group: CardGroup; top: number }[] = [];
  for (const [key, members] of byKey) {
    const top = Math.max(...members.map((c) => cardPriority(c, now)));
    if (members.length === 1) {
      built.push({ group: { key: `one:${members[0].id}`, label: '', cardIds: [members[0].id] }, top });
      continue;
    }
    let label: string;
    let url: string | undefined;
    if (key.startsWith('issue:')) {
      const n = Number(key.slice(6));
      label = `${members.length} PRs on #${n}${issueTitles[n] ? `: ${issueTitles[n]}` : ''}`;
      url = members[0].evidence[0]?.url.replace(/\/pull\/\d+$/, `/issues/${n}`);
    } else {
      label = `${members.length} decisions: ${key.slice(4).replace(/\s*\(.*\)\s*$/, '')}`;
    }
    built.push({ group: { key, label, url, cardIds: members.map((c) => c.id) }, top });
  }
  built.sort((a, b) => b.top - a.top || a.group.key.localeCompare(b.group.key));
  return { groups: built.map((b) => b.group), waiting };
}
