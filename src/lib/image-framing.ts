import { getReadDb } from '@/lib/mongodb';

export interface Framing { x: number; y: number; scale: number }

/**
 * Read the admin-saved framing for a named image slot (object-position x/y in %
 * and a zoom scale). Returns null if none saved. Stored in
 * system_config._id='image_framing'.slots[slot]. Written by
 * /api/admin/image-framing and edited via <ImageFramingEditor>.
 */
export async function getImageFraming(slot: string): Promise<Framing | null> {
  try {
    const db = await getReadDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = await db.collection('system_config').findOne({ _id: 'image_framing' } as any);
    const f = (doc?.slots as Record<string, Framing> | undefined)?.[slot];
    if (!f) return null;
    return { x: f.x ?? 50, y: f.y ?? 50, scale: f.scale ?? 1 };
  } catch {
    return null;
  }
}
