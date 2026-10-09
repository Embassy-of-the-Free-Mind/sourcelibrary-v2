/**
 * One decision queue for Derek (#6258): tier:hold PRs + the ops
 * DECISIONS-PENDING.md rows + (stage 2) stuck background sessions, as one list
 * of cards, oldest and most expensive first. Built for a phone, in short bursts.
 *
 * Gated by the platform-protected layout (requireSuperAdmin). Answers go
 * through /api/admin/decisions into `decision_answers`; PR answers are acted on
 * by scripts/maintenance/decision-answers-drain.mjs on Hetzner.
 */
import type { Metadata } from 'next';
import { getDb } from '@/lib/mongodb';
import { loadQueue } from '@/lib/decision-queue-sources';
import { DecisionsClient } from './DecisionsClient';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;
export const metadata: Metadata = { title: 'Decisions', robots: { index: false, follow: false } };

export default async function DecisionsPage() {
  const db = await getDb();
  const queue = await loadQueue(db);
  return <DecisionsClient initial={queue} />;
}
