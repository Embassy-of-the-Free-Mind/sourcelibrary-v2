/**
 * Blind reader check (#7573): a volunteer who reads the language compares two
 * versions of one page against its scan, twenty pages per link.
 *
 * PRIOR ART: src/lib/review-invite-token.ts (one page per stateless HMAC link,
 * answers into Supabase `volunteer_ratings`). It does not fit: a batch of twenty
 * pages, two arm texts frozen from an eval packet, a randomised A/B order per
 * reader, and the reader's stated language, level and credit choice all have to
 * live somewhere, so the link here points at a row minted by
 * scripts/email/mint-reader-check-links.mjs rather than carrying everything
 * itself. The reader id is derived the same way (HMAC of the email), so a person
 * keeps one id across both flows.
 *
 * Two collections:
 *   reader_check_tokens     one row per link. `_id` is sha256(token): the token
 *                           itself is never stored, so a read of this collection
 *                           cannot be replayed as a reader.
 *   reader_check_judgements one row per (link, page). `_id` is
 *                           `<token_id>:<index>`, so answering a page again
 *                           corrects the answer instead of double-counting it.
 *
 * The arm names (`corrected`, `reread`, `lite`) never reach the browser. The
 * page gets "A" and "B" text only; the server maps the choice back to an arm
 * from the order stored at mint time. The judge's verdict is not in either
 * collection and is never shown.
 *
 * Server-only (node crypto): never import from a client component.
 */
import { createHash } from 'crypto';
import type { Db } from 'mongodb';

export const READER_CHECK_TOKENS = 'reader_check_tokens';
export const READER_CHECK_JUDGEMENTS = 'reader_check_judgements';

export const READER_CHECK_CHOICES = ['A', 'B', 'same', 'cannot_tell'] as const;
export type ReaderCheckChoice = (typeof READER_CHECK_CHOICES)[number];

export const READER_CHECK_NOTE_MAX = 2000;

/** Minted tokens are 32 base64url characters. The older invite tokens contain dots. */
const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;

export function isReaderCheckToken(token: string | null | undefined): token is string {
  return !!token && TOKEN_RE.test(token);
}

export function readerCheckTokenId(token: string): string {
  return createHash('sha256').update(`reader-check:${token}`).digest('hex');
}

export type ReaderCheckItem = {
  packet_id: string;
  page_id: string;
  book_id: string;
  title: string;
  page_number: number;
  image_url: string;
  /** Arm names in the order shown: arms[0] is A, arms[1] is B. */
  arms: [string, string];
  text_a: string;
  text_b: string;
  control: boolean;
};

export type ReaderCheckTokenDoc = {
  _id: string;
  reader_id: string;
  reader: {
    language: string;
    level: string;
    credit: 'anonymous' | 'name';
    credit_name: string | null;
    consent_publish: boolean;
  };
  packet: { file: string; language: string; pair: [string, string]; issue: number };
  items: ReaderCheckItem[];
  batch: number;
  test: boolean;
  revoked: boolean;
  created_at: Date;
};

/** What the browser is allowed to see of one item. No arm names. */
export type ReaderCheckClientItem = {
  title: string;
  page_number: number;
  image_url: string;
  text_a: string;
  text_b: string;
};

export type ReaderCheckAnswer = {
  choice: ReaderCheckChoice;
  invented: boolean;
  note: string;
};

export async function loadReaderCheck(db: Db, token: string): Promise<ReaderCheckTokenDoc | null> {
  if (!isReaderCheckToken(token)) return null;
  const doc = (await db
    .collection(READER_CHECK_TOKENS)
    .findOne({ _id: readerCheckTokenId(token) as unknown as never })) as ReaderCheckTokenDoc | null;
  if (!doc || doc.revoked || !Array.isArray(doc.items) || doc.items.length === 0) return null;
  return doc;
}

/** Answers already given on this link, by item index. */
export async function loadReaderCheckAnswers(
  db: Db,
  tokenId: string,
): Promise<Record<number, ReaderCheckAnswer>> {
  const rows = await db
    .collection(READER_CHECK_JUDGEMENTS)
    .find({ token_id: tokenId }, { projection: { _id: 0, item_index: 1, choice: 1, invented: 1, note: 1 } })
    .limit(500)
    .toArray();
  const out: Record<number, ReaderCheckAnswer> = {};
  for (const r of rows) {
    if (typeof r.item_index !== 'number') continue;
    out[r.item_index] = { choice: r.choice, invented: !!r.invented, note: r.note ?? '' };
  }
  return out;
}

export function toClientItems(doc: ReaderCheckTokenDoc): ReaderCheckClientItem[] {
  return doc.items.map(it => ({
    title: it.title,
    page_number: it.page_number,
    image_url: it.image_url,
    text_a: it.text_a,
    text_b: it.text_b,
  }));
}

export type JudgementInput = { index: unknown; choice: unknown; invented: unknown; note: unknown };

/** Validate a submitted answer against the link it came from. Returns an error string or the clean answer. */
export function parseJudgement(
  doc: ReaderCheckTokenDoc,
  body: JudgementInput,
): { error: string } | { index: number; choice: ReaderCheckChoice; invented: boolean; note: string | null } {
  const index = typeof body.index === 'number' ? body.index : Number.NaN;
  if (!Number.isInteger(index) || index < 0 || index >= doc.items.length) return { error: 'invalid page' };
  const choice = String(body.choice ?? '') as ReaderCheckChoice;
  if (!READER_CHECK_CHOICES.includes(choice)) return { error: 'invalid choice' };
  const raw = body.note == null ? '' : String(body.note).trim();
  return {
    index,
    choice,
    invented: body.invented === true,
    note: raw ? raw.slice(0, READER_CHECK_NOTE_MAX) : null,
  };
}

/** The arm the reader preferred, or null for "same" / "cannot tell". */
export function preferredArm(item: ReaderCheckItem, choice: ReaderCheckChoice): string | null {
  if (choice === 'A') return item.arms[0];
  if (choice === 'B') return item.arms[1];
  return null;
}

/** The row written for one answer. Everything the analysis needs, without a join. */
export function judgementRow(
  doc: ReaderCheckTokenDoc,
  index: number,
  answer: { choice: ReaderCheckChoice; invented: boolean; note: string | null },
  now: Date,
) {
  const item = doc.items[index];
  return {
    token_id: doc._id,
    reader_id: doc.reader_id,
    packet_file: doc.packet.file,
    packet_id: item.packet_id,
    page_id: item.page_id,
    book_id: item.book_id,
    item_index: index,
    arms_shown: { A: item.arms[0], B: item.arms[1] },
    choice: answer.choice,
    preferred_arm: preferredArm(item, answer.choice),
    invented: answer.invented,
    note: answer.note,
    control: !!item.control,
    reader_language: doc.reader.language,
    reader_level: doc.reader.level,
    reader_credit: doc.reader.credit,
    consent_publish: !!doc.reader.consent_publish,
    batch: doc.batch,
    test: !!doc.test,
    updated_at: now,
  };
}
