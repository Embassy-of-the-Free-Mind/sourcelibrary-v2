/**
 * PRIOR ART: src/lib/image-subjects.ts is the vocabulary half of this pair and is
 * client-safe; this is the server half, split out so the raw-string map (~2K entries)
 * is never bundled into a client component. No other module maps free-text subjects
 * onto a vocabulary (see that file's note).
 *
 * Browse topics for book illustrations (#4856) — the raw-string side.
 *
 * `src/data/image-subject-map.json` maps the extractor's free-text `metadata.subjects`
 * strings onto term ids (proposed by scripts/maintenance/map-image-subjects.mjs,
 * reviewed in the PR diff). Filtering by a topic means `metadata.subjects ∈ <the raw
 * strings mapped to it>`, which the existing `metadata.subjects` index serves. No
 * field is written to any document: re-mapping a string is a JSON edit.
 */
import subjectMap from '@/data/image-subject-map.json';
import { SUBJECT_CATEGORIES } from '@/lib/image-subjects';

const RAW_BY_TERM = new Map<string, string[]>();
for (const [raw, ids] of Object.entries(subjectMap.map as Record<string, string[]>)) {
  for (const id of ids) {
    const list = RAW_BY_TERM.get(id);
    if (list) list.push(raw);
    else RAW_BY_TERM.set(id, [raw]);
  }
}

/**
 * The raw `metadata.subjects` strings a topic covers. A category covers every string
 * mapped to any of its terms. An unknown id returns [] — a filter on it matches
 * nothing, rather than silently falling back to unfiltered results.
 */
export function subjectStringsForTopic(topicId: string): string[] {
  const cat = SUBJECT_CATEGORIES.find((c) => c.id === topicId);
  const termIds = cat ? cat.terms.map((t) => t.id) : [topicId];
  const out = new Set<string>();
  for (const id of termIds) for (const raw of RAW_BY_TERM.get(id) ?? []) out.add(raw);
  return [...out];
}
