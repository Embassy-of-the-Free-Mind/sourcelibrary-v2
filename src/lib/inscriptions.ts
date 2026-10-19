import { getReadDb } from '@/lib/mongodb';

// Monument pages (#6985): one Classic Maya inscription, shown from the University of Bonn's two open
// sources. The object, its date and its photographs come from the ULB Bonn Maya archive (`maya_archive`,
// loaded by scripts/learn/maya-signs/ulb/). The signs in each glyph block come from the TWKM sign catalog
// (`maya_twkm` graphs list the artefact zones they occur in; `maya_signs` holds each graph's drawing and
// readings, #6980). TWKM states no licence for its tables, so they are read here, server-side, and never
// copied into the repo.
// PRIOR ART: none — git grep for maya_signs / maya_twkm / maya_archive / inscription in src/lib found no reader
// of these collections (the inscription hits are unrelated: cover scoring, image extraction, search grounding).

export interface InscriptionConfig {
  slug: string;
  /** Name and one-line description for the /inscriptions list. */
  title: string;
  subtitle: string;
  /** ULB archive record number of the artifact (its photographs hang off it). */
  ulb: string;
  /** TWKM artefact id, the `id` in `graphs[].artefacts`. */
  twkm: number;
  /** Panels of glyph columns, each read in pairs: A1 B1, A2 B2, … */
  panels: [string, string][];
  rows: number;
}

export const INSCRIPTIONS: Record<string, InscriptionConfig> = {
  'yaxchilan-lintel-21': {
    slug: 'yaxchilan-lintel-21',
    title: 'Yaxchilan, Lintel 21',
    subtitle: 'A carved limestone lintel from the Maya city of Yaxchilan, dated 10 May 752',
    ulb: '9605478', twkm: 48, panels: [['A', 'B'], ['C', 'D']], rows: 8 },
};

export interface ArchiveImage {
  id: string;
  kind: 'photograph' | 'drawing';
  title: string;
  creator: string | null;
  date: string | null;
  url: string;
  ulbUrl: string;
  licence: { label: string; url: string | null } | null;
}

export interface BlockSign {
  graphNo: string;
  value: string | null;
  translation: string | null;
  image: string | null;
}

export interface Inscription {
  config: InscriptionConfig;
  title: string;
  ulbUrl: string;
  type: string | null;
  provenance: string | null;
  currentLocation: string | null;
  longCount: string | null;
  calendarRound: string | null;
  material: string | null;
  technique: string | null;
  extent: string[];
  images: ArchiveImage[];
  /** zoneId → signs in that block, as TWKM lists them (not in reading order). */
  blocks: Record<string, BlockSign[]>;
}

interface ArchiveDoc {
  _id: string;
  kind: string;
  title: string;
  url: string;
  type?: string | null;
  provenance?: string | null;
  current_location?: string | null;
  long_count?: string | null;
  calendar_round?: string | null;
  material?: string | null;
  technique?: string | null;
  extent?: string[];
  images?: string[];
  creator?: string | null;
  date?: string | null;
  licence?: { label: string; url: string | null } | null;
  image?: { url?: string };
}

export async function getInscription(slug: string): Promise<Inscription | null> {
  const config = INSCRIPTIONS[slug];
  if (!config) return null;
  const db = await getReadDb();
  const archive = db.collection<ArchiveDoc>('maya_archive');
  const artifact = await archive.findOne({ _id: `ulb:${config.ulb}` });
  if (!artifact) throw new Error(`maya_archive is missing ulb:${config.ulb}`);
  const imageDocs = await archive.find({ _id: { $in: artifact.images ?? [] } }).toArray();
  const order = new Map((artifact.images ?? []).map((id, i) => [id, i]));
  const images: ArchiveImage[] = imageDocs
    .filter((d) => d.image?.url)
    .sort((a, b) => (order.get(a._id) ?? 0) - (order.get(b._id) ?? 0))
    .map((d) => ({
      id: d._id,
      kind: d.kind === 'drawing' ? 'drawing' : 'photograph',
      title: d.title,
      creator: d.creator ?? null,
      date: d.date ?? null,
      url: d.image!.url!,
      ulbUrl: d.url,
      licence: d.licence ?? null,
    }));

  const graphs = await db
    .collection<{ _id: string; data: { graphNo: string; artefacts?: { id: number; zoneId: string }[] } }>('maya_twkm')
    .find({ entity: 'graphs', 'data.artefacts.id': config.twkm }, { projection: { 'data.graphNo': 1, 'data.artefacts': 1 } })
    .sort({ _id: 1 })
    .toArray();
  const signs = await db
    .collection<{ _id: string; kind: string; value: string | null; translation: string | null; image?: { url?: string } | null }>('maya_signs')
    .find({ _id: { $in: graphs.map((g) => `twkm:${g.data.graphNo}`) } }, { projection: { kind: 1, value: 1, translation: 1, 'image.url': 1 } })
    .toArray();
  const byId = new Map(signs.map((s) => [s._id, s]));
  const blocks: Record<string, BlockSign[]> = {};
  for (const g of graphs) {
    const s = byId.get(`twkm:${g.data.graphNo}`);
    for (const occ of g.data.artefacts ?? []) {
      if (occ.id !== config.twkm) continue;
      (blocks[occ.zoneId] ??= []).push({
        graphNo: g.data.graphNo,
        value: s?.value ?? null,
        // TWKM's translation describes the graph, so on a syllable or a numeral it names what the sign
        // pictures ("hi" → "sihoom-flower", zero → "no"), not a meaning. Only a word sign has one.
        translation: s?.kind === 'logogram' ? (s.translation ?? null) : null,
        image: s?.image?.url ?? null,
      });
    }
  }

  return {
    config,
    title: artifact.title,
    ulbUrl: artifact.url,
    type: artifact.type ?? null,
    provenance: artifact.provenance ?? null,
    currentLocation: artifact.current_location ?? null,
    longCount: artifact.long_count ?? null,
    calendarRound: artifact.calendar_round ?? null,
    material: artifact.material ?? null,
    technique: artifact.technique ?? null,
    extent: artifact.extent ?? [],
    images,
    blocks,
  };
}
