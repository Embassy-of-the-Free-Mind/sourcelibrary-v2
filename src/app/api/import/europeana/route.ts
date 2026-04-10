import { NextRequest, NextResponse } from 'next/server';
import { importBookFromIIIF } from '@/lib/import-utils';
import { withCuratorAuth } from '@/lib/auth-helpers';

export const maxDuration = 300;

/**
 * Import a book from Europeana (aggregator)
 *
 * POST /api/import/europeana
 * Body: {
 *   record_id: string,        // Europeana record path, e.g. "/2022704/lmu_bsb00029099"
 *   title: string,
 *   display_title?: string,
 *   author: string,
 *   language?: string,
 *   published?: string,
 *   categories?: string[],
 *   manifest_url?: string     // Optional: provide IIIF manifest URL directly if known
 * }
 *
 * Europeana is an aggregator. This route fetches the record metadata,
 * extracts the IIIF manifest URL from the provider, and imports via IIIF.
 *
 * Browse: https://www.europeana.eu/
 * API docs: https://pro.europeana.eu/page/record
 */
export const POST = withCuratorAuth(async (request, session) => {
  try {
    const body = await request.json();
    const {
      record_id,
      title,
      display_title,
      author,
      language,
      published,
      categories,
      work_id,
      manifest_url: providedManifest,
    } = body;

    if (!record_id || !title || !author) {
      return NextResponse.json(
        { error: 'Missing required fields: record_id, title, author' },
        { status: 400 }
      );
    }

    // Normalize record_id: ensure leading slash
    const normalizedId = record_id.startsWith('/') ? record_id : `/${record_id}`;

    let manifestUrl = providedManifest;
    let providerName = 'Europeana';
    let sourceInstitution: string | null = null;

    if (!manifestUrl) {
      // Fetch Europeana record to find IIIF manifest
      const apiKey = process.env.EUROPEANA_API_KEY;
      const apiUrl = apiKey
        ? `https://api.europeana.eu/record/v2${normalizedId}.json?wskey=${apiKey}`
        : `https://api.europeana.eu/record/v2${normalizedId}.json`;

      const recordRes = await fetch(apiUrl);

      if (!recordRes.ok) {
        return NextResponse.json({
          error: `Failed to fetch Europeana record: ${recordRes.status}`,
          record_id: normalizedId,
          guidance: 'Check the record_id format (e.g. "/2022704/lmu_bsb00029099"). ' +
            'You can also provide manifest_url directly if you know the IIIF manifest URL.',
        }, { status: 400 });
      }

      const record = await recordRes.json();
      const obj = record.object;

      if (!obj) {
        return NextResponse.json({
          error: 'Europeana record not found',
          record_id: normalizedId,
        }, { status: 404 });
      }

      // Extract IIIF manifest from Europeana record
      // Check multiple locations where IIIF manifests appear
      const aggregations = obj.aggregations || [];
      const europeanaAgg = obj.europeanaAggregation || {};

      for (const agg of aggregations) {
        // Check webResources for IIIF services
        const webResources = agg.webResources || [];
        for (const wr of webResources) {
          // svcsHasService contains IIIF manifest URLs
          if (wr.svcsHasService) {
            const svc = Array.isArray(wr.svcsHasService) ? wr.svcsHasService[0] : wr.svcsHasService;
            if (typeof svc === 'string' && (svc.includes('iiif') || svc.includes('manifest'))) {
              manifestUrl = svc;
              break;
            }
          }
          // dctermsIsReferencedBy can also contain manifests
          if (!manifestUrl && wr.dctermsIsReferencedBy) {
            const ref = Array.isArray(wr.dctermsIsReferencedBy)
              ? wr.dctermsIsReferencedBy[0]
              : wr.dctermsIsReferencedBy;
            if (typeof ref === 'string' && (ref.includes('iiif') || ref.includes('manifest'))) {
              manifestUrl = ref;
              break;
            }
          }
        }
        if (manifestUrl) break;

        // Check edmIsShownBy — sometimes a IIIF manifest
        if (!manifestUrl && agg.edmIsShownBy) {
          const shown = agg.edmIsShownBy;
          if (typeof shown === 'string' && (shown.includes('iiif') || shown.includes('manifest'))) {
            manifestUrl = shown;
          }
        }

        // Capture source institution
        if (agg.edmDataProvider) {
          const dp = agg.edmDataProvider;
          sourceInstitution = typeof dp === 'object' ? (dp.def?.[0] || dp.en?.[0]) : dp;
        }
      }

      // Also check europeanaAggregation for edm:preview or IIIF links
      if (!manifestUrl && europeanaAgg.edmIsShownBy) {
        const shown = europeanaAgg.edmIsShownBy;
        if (typeof shown === 'string' && (shown.includes('iiif') || shown.includes('manifest'))) {
          manifestUrl = shown;
        }
      }

      if (!manifestUrl) {
        // Try to find manifest URL from services
        const services = obj.services || [];
        for (const svc of services) {
          if (svc.about && (svc.about.includes('iiif') || svc.about.includes('manifest'))) {
            manifestUrl = svc.about;
            break;
          }
          // Check doapImplements for IIIF presentation API
          if (svc.doapImplements?.includes('iiif.io/api/presentation')) {
            manifestUrl = svc.about;
            break;
          }
        }
      }

      if (sourceInstitution) {
        providerName = `${sourceInstitution} (via Europeana)`;
      }
    }

    if (!manifestUrl) {
      return NextResponse.json({
        error: 'No IIIF manifest found in Europeana record',
        record_id: normalizedId,
        guidance: 'This Europeana record does not link to a IIIF manifest. ' +
          'Try providing manifest_url directly, or import from the source institution instead.',
      }, { status: 400 });
    }

    return await importBookFromIIIF({
      provider: 'europeana',
      provider_name: providerName,
      manifest_url: manifestUrl,
      identifier: normalizedId,
      source_url: `https://www.europeana.eu/item${normalizedId}`,
      title,
      display_title,
      author,
      language,
      published,
      categories,
      work_id,
      license_default: 'unknown',
      attribution_default: sourceInstitution || undefined,
      duplicate_query: {
        $or: [
          { 'dublin_core.dc_identifier': `EUROPEANA:${normalizedId}` },
          { 'image_source.iiif_manifest': manifestUrl },
        ],
      },
      identifier_field: { europeana_id: normalizedId },
    }, request);
  } catch (error) {
    console.error('Europeana import error:', error);
    return NextResponse.json(
      { error: 'Import failed', details: String(error) },
      { status: 500 }
    );
  }
});
