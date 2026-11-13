import fs from 'node:fs';
import path from 'node:path';
import { SOURCE_LIBRARY, type Maker } from '../_components/MakerBadge';

/** Who made each collection. Everything not listed is Source Library. Agreed with Laura 2026-11-13. */
const FILE = path.join(process.cwd(), 'src/app/revamp/_data/makers.json');
type Makers = { people: Record<string, { name: string; avatar: string | null }>; collections: Record<string, string> };
export const readMakers = (): Makers => JSON.parse(fs.readFileSync(FILE, 'utf8'));
export const writeMakers = (m: Makers) => fs.writeFileSync(FILE, JSON.stringify(m, null, 1) + '\n');

export function makerOf(slug: string): Maker {
  const m = readMakers(); const id = m.collections[slug]; const p = id && m.people[id];
  return p ? { kind: 'reader', name: p.name, avatar: p.avatar ?? undefined } : SOURCE_LIBRARY;
}
export const makerKind = (slug: string): 'source-library' | 'reader' => (readMakers().collections[slug] ? 'reader' : 'source-library');
