// Subject-weighted ranking for collection imagery (hero collage + gallery
// masonry). Sorting purely by `gallery_quality` floats author PORTRAITS and
// title-page FRONTISPIECES to the top, so a botany hero ends up full of faces
// instead of plants. This keeps quality as the "beauty" base, then weights
// toward images that DEPICT the collection's subject (botanical plates,
// diagrams, specimens) over people and decorative title pages — while still
// letting some portraits/symbols through so the set keeps a range.
//
// Used by /api/collections/[id]/hero-collage and the redesigned collection
// pages. Topic terms are derived from the collection name; the image `type`
// weighting works for every collection even when no topic term matches.

const SUBJECT_TYPES = new Set([
  'illustration', 'diagram', 'plate', 'figure', 'map', 'botanical',
  'specimen', 'chart', 'scientific', 'scene', 'anatomical',
]);
const PERSON_TYPES = new Set(['portrait']);
const DECOR_TYPES = new Set([
  'frontispiece', 'emblem', 'title-page', 'titlepage', 'decoration',
  'border', 'initial', 'vignette', 'device', 'coat-of-arms', 'allegory',
]);

// Description cues that mark a person-portrait when the image `type` is absent.
const PERSON_WORDS = [
  'portrait', 'bust of', 'a man', 'a woman', 'seated figure', 'standing figure',
  'the author', 'headshot', 'face of', 'effigy', 'enthroned', 'nobleman',
  'gentleman', 'clergyman', 'depicts the renowned', 'depicts sir ',
];

const NAME_STOP = new Set(['and', 'the', 'of', 'a', 'an', 'in', 'to', 'for', 'its', 'from', 'on', 'with']);

// Light synonym expansion so the topic boost is robust to vocabulary. Keyed by a
// stem of the collection-name word; the type-weighting still applies without a
// match here, so this list only needs the common subjects.
const SUBJECT_SYNONYMS: Record<string, string[]> = {
  herb: ['plant', 'flower', 'leaf', 'leaves', 'root', 'flora', 'botanical', 'specimen', 'foliage', 'blossom', 'fruit', 'seed', 'tree'],
  botan: ['plant', 'flower', 'leaf', 'leaves', 'root', 'flora', 'botanical', 'specimen', 'foliage'],
  plant: ['flower', 'leaf', 'root', 'flora', 'botanical', 'herb', 'specimen'],
  fungi: ['mushroom', 'toadstool', 'agaric', 'fungal', 'spore', 'bolete', 'cap', 'gill', 'fungus'],
  fungus: ['mushroom', 'toadstool', 'agaric', 'fungal', 'spore', 'fungi'],
  mycolog: ['mushroom', 'toadstool', 'agaric', 'fungal', 'spore', 'fungus', 'fungi'],
  anatom: ['skeleton', 'muscle', 'dissection', 'organ', 'body'],
  astronom: ['star', 'planet', 'constellation', 'celestial', 'comet', 'orbit', 'moon'],
  alchem: ['furnace', 'vessel', 'flask', 'distillation', 'apparatus', 'retort'],
};

export function topicTermsFromName(name?: string | null): string[] {
  if (!name) return [];
  const words = name.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2 && !NAME_STOP.has(w));
  const terms = new Set<string>();
  for (const w of words) {
    terms.add(w);
    const stem = w.slice(0, Math.min(6, w.length));
    terms.add(stem);
    for (const [k, syns] of Object.entries(SUBJECT_SYNONYMS)) {
      if (w.startsWith(k) || stem.startsWith(k)) syns.forEach((s) => terms.add(s));
    }
  }
  return [...terms];
}

export interface RankableImage {
  type?: string | null;
  description?: string | null;
  museum_description?: string | null;
  gallery_quality?: number | null;
}

// Higher = show sooner. Base is the curated quality (beauty); the rest weights
// subject-matter up and people/decoration down.
export function scoreGalleryImage(img: RankableImage, topicTerms: string[] = []): number {
  const q = typeof img.gallery_quality === 'number' ? img.gallery_quality : 0.5;
  const type = (img.type || '').toLowerCase();
  const desc = (img.museum_description || img.description || '').toLowerCase();
  let s = q;
  if (SUBJECT_TYPES.has(type)) s += 0.6;
  else if (PERSON_TYPES.has(type)) s -= 0.6;
  else if (DECOR_TYPES.has(type)) s -= 0.3;
  const topicHit = topicTerms.some((t) => t && desc.includes(t));
  if (topicHit) s += 0.4;
  if (!topicHit && PERSON_WORDS.some((p) => desc.includes(p))) s -= 0.4;
  return s;
}

// Return a copy sorted by subject-weighted score (desc), quality as tie-break.
export function rankBySubject<T extends RankableImage>(imgs: T[], topicTerms: string[] = []): T[] {
  return [...imgs]
    .map((img, i) => ({ img, i, s: scoreGalleryImage(img, topicTerms) }))
    .sort((a, b) => (b.s - a.s) || ((b.img.gallery_quality ?? 0) - (a.img.gallery_quality ?? 0)) || (a.i - b.i))
    .map((x) => x.img);
}

// Remove exact duplicates (same image shown twice in a hero/gallery). keyFn
// returns a stable identity (image URL or gallery-image id); null/empty keys are
// always kept. Order is preserved.
export function dedupeImages<T>(imgs: T[], keyFn: (img: T) => string | undefined | null): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const img of imgs) {
    const k = keyFn(img);
    if (!k) { out.push(img); continue; }
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(img);
  }
  return out;
}

type Bucket = 'subject' | 'other' | 'people' | 'decor';

function categorize(img: RankableImage, topicTerms: string[]): Bucket {
  const type = (img.type || '').toLowerCase();
  const desc = (img.museum_description || img.description || '').toLowerCase();
  if (PERSON_TYPES.has(type)) return 'people';
  if (SUBJECT_TYPES.has(type)) return 'subject';
  if (topicTerms.some((t) => t && desc.includes(t))) return 'subject';
  if (DECOR_TYPES.has(type)) return 'decor';
  if (PERSON_WORDS.some((p) => desc.includes(p))) return 'people';
  return 'other';
}

// Subject-weighted ordering that still keeps a RANGE: instead of "all plants
// first, then everything else," it interleaves the categories on a fixed cycle
// that leans heavily on subject matter but guarantees some people, decoration,
// and other imagery appear in the visible set. Each bucket is internally sorted
// by subject score (best first). Use this for the hero/gallery instead of a pure
// sort when you want variety as well as weighting.
const WEAVE_CYCLE: Bucket[] = [
  'subject', 'subject', 'subject', 'other', 'subject', 'subject',
  'people', 'subject', 'other', 'subject', 'subject', 'decor',
];
const WEAVE_FALLBACK: Bucket[] = ['subject', 'other', 'people', 'decor'];

export function weaveBySubject<T extends RankableImage>(imgs: T[], topicTerms: string[] = []): T[] {
  const buckets: Record<Bucket, T[]> = { subject: [], other: [], people: [], decor: [] };
  for (const img of imgs) buckets[categorize(img, topicTerms)].push(img);
  for (const k of WEAVE_FALLBACK) {
    buckets[k].sort((a, b) => scoreGalleryImage(b, topicTerms) - scoreGalleryImage(a, topicTerms)
      || ((b.gallery_quality ?? 0) - (a.gallery_quality ?? 0)));
  }
  const out: T[] = [];
  const total = imgs.length;
  let ci = 0;
  while (out.length < total) {
    const want = WEAVE_CYCLE[ci % WEAVE_CYCLE.length];
    ci++;
    let pick = buckets[want].shift();
    if (!pick) for (const k of WEAVE_FALLBACK) { if (buckets[k].length) { pick = buckets[k].shift(); break; } }
    if (!pick) break;
    out.push(pick);
  }
  return out;
}
