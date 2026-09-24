/**
 * Allmaps nightly sync (#5076): the matcher, the id derivation, and the twin resolver.
 *
 * Three things must hold or a volunteer's work never reaches the page:
 *   1. the script-side resolver (scripts/lib/allmaps.mjs) opens the SAME resource as the
 *      Georeference button (src/lib/allmaps.ts) — a twin, pinned here like gallery-doc's;
 *   2. Allmaps ids are sha1(url)[:16] — verified 2025-09-25 against the live API
 *      (manifest `…/map2002023007/manifest.json` → `ef8a028a5c8ea588`);
 *   3. an annotation is attached to OUR page only when its image service, its IA canvas
 *      leaf, or its manifest canvas index says so — never to a neighbour.
 *
 * The fixture is the live AnnotationPage the issue cites (one annotation, four GCPs).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { allmapsTargetUrl as allmapsTargetUrlTs } from '@/lib/allmaps';
import {
  allmapsId,
  allmapsLookups,
  allmapsTargetUrl,
  annotationMatchesPage,
  iaLeafFromAnnotation,
  indexManifestCanvases,
  pickAnnotation,
  summarizeAnnotation,
} from '../../scripts/lib/allmaps.mjs';

const page = JSON.parse(readFileSync(new URL('../fixtures/allmaps-annotation-page.json', import.meta.url), 'utf8'));
const annotation = page.items[0];

describe('allmapsId', () => {
  it('is the first 16 hex chars of sha1(url), matching the live API ids', () => {
    expect(allmapsId('https://iiif.archive.org/iiif/map2002023007/manifest.json')).toBe('ef8a028a5c8ea588');
    expect(allmapsId('https://iiif.archive.org/image/iiif/3/map2002023007%2F2002-023-007.TIF')).toBe('9b3bc0dc7543fd5d');
  });
});

describe('resolver twins agree', () => {
  const cases = [
    { pageImageUrls: ['https://images.uba.uva.nl/iiif/2/default!1!3!1!990011022850205131!otm-hb-kzl-1801-a-014-1_005.jpg/full/1000,/0/default.jpg'] },
    { pageImageUrls: ['https://api.digitale-sammlungen.de/iiif/image/v2/bsb10854419_00254/full/full/0/default.jpg', 'https://api.digitale-sammlungen.de/iiif/image/v2/bsb10854419_00254/full/1000,/0/default.jpg'] },
    { pageImageUrls: ['https://gallica.bnf.fr/iiif/ark:/12148/btv1b53095154p/f7/full/pct:50/0/native.jpg'], iiifManifest: 'https://gallica.bnf.fr/iiif/ark:/12148/btv1b53095154p/manifest.json' },
    { pageImageUrls: ['https://archive.org/download/gri_tychonisbrah00brah/page/n106/full/pct:50/0/default.jpg'], iaIdentifier: 'gri_tychonisbrah00brah', iiifManifest: 'https://iiif.archive.org/iiif/3/gri_tychonisbrah00brah/manifest.json' },
    { pageImageUrls: ['https://images.sourcelibrary.org/archived/6991bf67734f402cad489bb9/24.jpg', 'https://bl.digirati.io/images/ark:/81055/vdc_100056054473.0x000018/full/1000,/0/default.jpg'] },
    { pageImageUrls: ['https://images.sourcelibrary.org/archived/x/1.jpg', null], iiifManifest: 'https://uvaerfgoed.nl/viewer/api/v1/records/11245_3_19269/manifest/' },
    { pageImageUrls: ['https://images.sourcelibrary.org/archived/x/1.jpg'] },
    { pageImageUrls: ['https://tile.loc.gov/image-services/iiif/service:asian:lcnclscd:2014514408:1A001:00001a/full/1000,/0/default.jpg'] },
  ];
  it.each(cases)('%j', (src) => {
    expect(allmapsTargetUrl(src)).toBe(allmapsTargetUrlTs(src));
  });
  it('the sample cases exercise every branch (image, IA manifest, imported manifest, nothing)', () => {
    const targets = cases.map((c) => allmapsTargetUrl(c));
    expect(targets.filter((t) => t?.endsWith('/info.json')).length).toBeGreaterThanOrEqual(3);
    expect(targets).toContain('https://iiif.archive.org/iiif/3/gri_tychonisbrah00brah/manifest.json');
    expect(targets).toContain('https://uvaerfgoed.nl/viewer/api/v1/records/11245_3_19269/manifest/');
    expect(targets).toContain(null);
  });
});

describe('allmapsLookups', () => {
  it('an image target is one exact /images lookup keyed by the SERVICE id (no info.json)', () => {
    const [l, ...rest] = allmapsLookups({
      pageImageUrls: ['https://images.uba.uva.nl/iiif/2/default!1!3!1!990011022850205131!otm-hb-kzl-1801-a-014-1_005.jpg/full/1000,/0/default.jpg'],
    });
    expect(rest).toEqual([]);
    expect(l.kind).toBe('image');
    expect(l.serviceId).toBe('https://images.uba.uva.nl/iiif/2/default!1!3!1!990011022850205131!otm-hb-kzl-1801-a-014-1_005.jpg');
    expect(l.api).toBe(`https://annotations.allmaps.org/images/${allmapsId(l.serviceId!)}`);
  });
  it('an Internet Archive book asks for the v3 manifest the editor opens AND the v2 manifest', () => {
    const ls = allmapsLookups({ pageImageUrls: ['https://archive.org/download/x/page/n1/full/pct:50/0/default.jpg'], iaIdentifier: 'map2002023007' });
    expect(ls.map((l) => l.target)).toEqual([
      'https://iiif.archive.org/iiif/3/map2002023007/manifest.json',
      'https://iiif.archive.org/iiif/map2002023007/manifest.json',
    ]);
    expect(ls[1].api).toBe('https://annotations.allmaps.org/manifests/ef8a028a5c8ea588');
  });
  it('nothing tileable → no lookups', () => {
    expect(allmapsLookups({ pageImageUrls: ['https://images.sourcelibrary.org/archived/x/1.jpg'] })).toEqual([]);
  });
});

describe('matching an annotation to a page', () => {
  it('image-service id match (the row whose own image was georeferenced)', () => {
    const ctx = { pageNumber: 9, serviceId: 'https://iiif.archive.org/image/iiif/3/map2002023007%2F2002-023-007.TIF' };
    expect(annotationMatchesPage(annotation, ctx)).toBe(true);
    expect(annotationMatchesPage(annotation, { ...ctx, serviceId: 'https://iiif.archive.org/image/iiif/3/other%2Fx.TIF' })).toBe(false);
  });

  it('IA canvas match: a single-image item is leaf 0 → page 1, and only for that identifier', () => {
    expect(iaLeafFromAnnotation(annotation)).toEqual({ ia: 'map2002023007', leaf: 0 });
    expect(annotationMatchesPage(annotation, { pageNumber: 1, iaIdentifier: 'map2002023007' })).toBe(true);
    expect(annotationMatchesPage(annotation, { pageNumber: 2, iaIdentifier: 'map2002023007' })).toBe(false);
    expect(annotationMatchesPage(annotation, { pageNumber: 1, iaIdentifier: 'gri_tychonisbrah00brah' })).toBe(false);
  });

  it('IA book canvas `$N/canvas` (v2 and v3 shapes) → page N+1; the jp2 leaf is the fallback', () => {
    const onCanvas = (id: string) => ({ ...annotation, target: { ...annotation.target, source: { ...annotation.target.source, id: 'https://iiif.archive.org/image/iiif/3/x', partOf: [{ id, type: 'Canvas' }] } } });
    expect(iaLeafFromAnnotation(onCanvas('https://iiif.archive.org/iiif/gri_tychonisbrah00brah$106/canvas'))).toEqual({ ia: 'gri_tychonisbrah00brah', leaf: 106 });
    expect(iaLeafFromAnnotation(onCanvas('https://iiif.archive.org/iiif/3/gri_tychonisbrah00brah$106/canvas'))).toEqual({ ia: 'gri_tychonisbrah00brah', leaf: 106 });
    expect(annotationMatchesPage(onCanvas('https://iiif.archive.org/iiif/gri_tychonisbrah00brah$106/canvas'), { pageNumber: 107, iaIdentifier: 'gri_tychonisbrah00brah' })).toBe(true);
    expect(annotationMatchesPage(onCanvas('https://iiif.archive.org/iiif/gri_tychonisbrah00brah$106/canvas'), { pageNumber: 106, iaIdentifier: 'gri_tychonisbrah00brah' })).toBe(false);
    const noCanvas = { ...annotation, target: { ...annotation.target, source: { id: 'https://iiif.archive.org/image/iiif/3/gri_tychonisbrah00brah%2Fgri_tychonisbrah00brah_jp2.zip%2Fgri_tychonisbrah00brah_jp2%2Fgri_tychonisbrah00brah_0106.jp2', type: 'ImageService3' } } };
    expect(iaLeafFromAnnotation(noCanvas)).toEqual({ ia: 'gri_tychonisbrah00brah', leaf: 106 });
  });

  it('imported-manifest canvas match uses the manifest\'s canvas order (index + 1), v2 and v3', () => {
    const v3 = { items: [
      { id: 'https://ex.org/c/1', items: [{ items: [{ body: { id: 'https://ex.org/img/a/full/max/0/default.jpg', service: [{ id: 'https://ex.org/img/a' }] } }] }] },
      { id: 'https://ex.org/c/2', items: [{ items: [{ body: { id: 'https://ex.org/img/b/full/max/0/default.jpg', service: [{ id: 'https://ex.org/img/b' }] } }] }] },
    ] };
    const idx = indexManifestCanvases(v3);
    expect(idx.byCanvasId.get('https://ex.org/c/2')).toBe(1);
    expect(idx.byService.get('https://ex.org/img/b')).toBe(1);
    const onB = { ...annotation, target: { source: { id: 'https://ex.org/img/b', partOf: [{ id: 'https://ex.org/c/2', type: 'Canvas' }] } } };
    const ctx = { pageNumber: 2, canvasIndexById: idx.byCanvasId, canvasIndexByService: idx.byService };
    expect(annotationMatchesPage(onB, ctx)).toBe(true);
    expect(annotationMatchesPage(onB, { ...ctx, pageNumber: 1 })).toBe(false);

    const v2 = { sequences: [{ canvases: [
      { '@id': 'https://ex.org/v2/c/1', images: [{ resource: { '@id': 'https://ex.org/img/a/full/full/0/default.jpg', service: { '@id': 'https://ex.org/img/a' } } }] },
    ] }] };
    expect(indexManifestCanvases(v2).byService.get('https://ex.org/img/a')).toBe(0);
  });

  it('no match → null; several matches → the one with most GCPs', () => {
    expect(pickAnnotation([annotation], { pageNumber: 3, serviceId: 'https://nope' })).toBeNull();
    const richer = { ...annotation, id: 'https://annotations.allmaps.org/maps/richer', body: { ...annotation.body, features: [...annotation.body.features, annotation.body.features[0]] } };
    const ctx = { pageNumber: 1, iaIdentifier: 'map2002023007' };
    expect(pickAnnotation([annotation, richer], ctx)?.id).toBe('https://annotations.allmaps.org/maps/richer');
  });

  it('stores a compact summary with the viewer url and the GCP count, not the points', () => {
    const now = new Date('2026-09-25T02:00:00Z');
    expect(summarizeAnnotation(annotation, 'https://iiif.archive.org/iiif/map2002023007/manifest.json', now)).toEqual({
      annotation_id: 'https://annotations.allmaps.org/maps/964600a0f33a5cd4',
      viewer_url: 'https://viewer.allmaps.org/?url=' + encodeURIComponent('https://annotations.allmaps.org/maps/964600a0f33a5cd4'),
      gcps: 4,
      modified: '2025-07-19T22:34:43.462Z',
      target: 'https://iiif.archive.org/iiif/map2002023007/manifest.json',
      checked_at: now,
    });
  });
});
