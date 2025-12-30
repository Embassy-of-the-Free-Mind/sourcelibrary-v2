import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

/**
 * Fix attribution and license data for IIIF imports
 * POST /api/admin/fix-attribution
 */
export async function POST() {
  try {
    const db = await getDb();

    // Update Vatican Library imports
    const vaticanResult = await db.collection('books').updateMany(
      { 'image_source.provider_name': 'Vatican Library' },
      {
        $set: {
          'image_source.license': 'CC-BY-NC-4.0',
          'image_source.license_url': 'https://creativecommons.org/licenses/by-nc/4.0/',
          'image_source.attribution': 'Images © Biblioteca Apostolica Vaticana'
        }
      }
    );

    // Update Bodleian Library imports
    const bodleianResult = await db.collection('books').updateMany(
      { 'image_source.provider_name': 'Bodleian Library' },
      {
        $set: {
          'image_source.license': 'CC-BY-NC-4.0',
          'image_source.license_url': 'https://creativecommons.org/licenses/by-nc/4.0/',
          'image_source.attribution': '© Bodleian Libraries, University of Oxford'
        }
      }
    );

    // Update Gallica imports
    const gallicaResult = await db.collection('books').updateMany(
      { 'image_source.provider_name': { $regex: /Gallica/i } },
      {
        $set: {
          'image_source.license': 'publicdomain',
          'image_source.license_url': null,
          'image_source.attribution': 'Source: Bibliothèque nationale de France'
        }
      }
    );

    // Update IRHT imports
    const irhtResult = await db.collection('books').updateMany(
      { 'image_source.provider_name': { $regex: /IRHT/i } },
      {
        $set: {
          'image_source.license': 'CC-BY-NC-4.0',
          'image_source.license_url': 'https://creativecommons.org/licenses/by-nc/4.0/',
          'image_source.attribution': '© IRHT-CNRS'
        }
      }
    );

    return NextResponse.json({
      success: true,
      updated: {
        vatican: vaticanResult.modifiedCount,
        bodleian: bodleianResult.modifiedCount,
        gallica: gallicaResult.modifiedCount,
        irht: irhtResult.modifiedCount
      }
    });

  } catch (error) {
    console.error('Fix attribution error:', error);
    return NextResponse.json(
      { error: 'Failed to fix attribution' },
      { status: 500 }
    );
  }
}
