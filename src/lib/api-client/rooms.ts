import { apiClient } from './client';
import type { RoomSource, RoomTheme } from '@/lib/reading-rooms';

/**
 * Reading rooms API client (#5266). Signed-in only for everything but GET one.
 * Global routes only — a room is itself an embedded surface and has no
 * tenant twin.
 *
 * PRIOR ART: src/lib/api-client/lists.ts — same shape for user lists; a room
 * is a different resource (theme, origins, source reference), so it gets its
 * own thin client rather than growing the lists one.
 */

export interface RoomSummary {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  source: RoomSource;
  theme: RoomTheme;
  created_at: string;
  updated_at: string;
  is_owner: boolean;
  /** Owner only. */
  allowed_origins?: string[];
}

export interface RoomWrite {
  name?: string;
  slug?: string;
  tagline?: string;
  source?: RoomSource;
  theme?: Partial<RoomTheme>;
  allowed_origins?: string[];
}

export const rooms = {
  getMine: async (): Promise<{ rooms: RoomSummary[]; max: number }> =>
    await apiClient.get('/api/rooms'),
  get: async (slug: string): Promise<{ room: RoomSummary }> =>
    await apiClient.get(`/api/rooms/${encodeURIComponent(slug)}`),
  create: async (body: RoomWrite): Promise<{ room: RoomSummary }> =>
    await apiClient.post('/api/rooms', body),
  update: async (slug: string, body: RoomWrite): Promise<{ room: RoomSummary }> =>
    await apiClient.patch(`/api/rooms/${encodeURIComponent(slug)}`, body),
  remove: async (slug: string): Promise<{ ok: boolean }> =>
    await apiClient.delete(`/api/rooms/${encodeURIComponent(slug)}`),
};
