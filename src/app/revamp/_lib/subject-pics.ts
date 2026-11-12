import fs from 'node:fs';
import path from 'node:path';
import type { Pic } from '../_components/SubjectsBrowser';
import { collectionModel, snapshotSlugs } from './data';

/** Pictures per subject, saved from the public gallery by _tools/snapshot-subject-images.py. */
export function subjectPictures(): Record<string, Pic[]> {
  const read = (f: string) => { try { return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src/app/revamp/_data/snap', f), 'utf8')); } catch { return {}; } };
  const main = read('_subject-images.json');
  const extra = read('_subject-images-extra.json'); // broad subjects the gallery files under another name
  for (const [k, v] of Object.entries(extra)) if (!main[k]?.length) main[k] = v;
  return main;
}

/** Subject id to its prototype page slug, for the subjects that have saved data. */
export function subjectPages(all: { id: string; label: string }[]) {
  const pages = new Map<string, string>();
  for (const slug of snapshotSlugs()) {
    const m = collectionModel(slug);
    const hit = m && all.find((s) => s.label.toLowerCase() === m.name.toLowerCase());
    if (hit) pages.set(hit.id, slug);
  }
  return pages;
}
