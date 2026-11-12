/**
 * Persona fixtures for the Study Rooms sims.
 *
 * INVENTED COMPOSITES. Built from aggregate themes in /welcome introductions
 * (see docs/study-rooms/SPEC.md §4). Not real people: the names, emails and
 * ids below are made up and use the reserved `.invalid` domain so no mail can
 * ever be sent to them.
 */
import { devices, type BrowserContextOptions } from '@playwright/test';

export type PersonaKey = 'professor' | 'lectora' | 'translator' | 'newcomer' | 'host';

export interface Persona {
  key: PersonaKey;
  /** Account fields put in the minted test session. */
  userId: string;
  email: string;
  accountName: string;
  /** What they choose as their Study Rooms display name. */
  displayName: string;
  /** Site role in the session token. Only the host is elevated. */
  role: 'reader' | 'superadmin';
  /** Interface language the persona uses. */
  locale: 'en' | 'es';
  /** Index into the character picker (0-based). */
  character: number;
  /** Browser context settings: device, viewport, language. */
  context: BrowserContextOptions;
  /** One line, for test titles and reports. */
  summary: string;
}

const desktop = (width: number, height: number, locale: string): BrowserContextOptions => ({
  viewport: { width, height },
  locale,
  permissions: ['microphone', 'camera'],
});

export const PERSONAS: Record<PersonaKey, Persona> = {
  professor: {
    key: 'professor',
    userId: 'sim000000000000000000001',
    email: 'sim-professor@study-rooms.invalid',
    accountName: 'Sim Professor',
    displayName: 'Sim-Professor',
    role: 'reader',
    locale: 'en',
    character: 0,
    context: desktop(1440, 900, 'en-GB'),
    summary: 'retired Neoplatonism professor, desktop, keyboard',
  },
  lectora: {
    key: 'lectora',
    userId: 'sim000000000000000000002',
    email: 'sim-lectora@study-rooms.invalid',
    accountName: 'Sim Lectora',
    displayName: 'Sim-Lectora',
    role: 'reader',
    locale: 'es',
    character: 3,
    context: {
      ...devices['Pixel 7'],
      locale: 'es-ES',
      permissions: ['microphone', 'camera'],
    },
    summary: 'Spanish-language reader on a phone (touch)',
  },
  translator: {
    key: 'translator',
    userId: 'sim000000000000000000003',
    email: 'sim-translator@study-rooms.invalid',
    accountName: 'Sim Translator',
    displayName: 'Sim-Translator',
    role: 'reader',
    locale: 'en',
    character: 5,
    context: desktop(1280, 800, 'en-US'),
    summary: 'translation volunteer, laptop',
  },
  newcomer: {
    key: 'newcomer',
    userId: 'sim000000000000000000004',
    email: 'sim-newcomer@study-rooms.invalid',
    accountName: 'Sim Newcomer',
    displayName: 'Sim-Newcomer',
    role: 'reader',
    locale: 'en',
    character: 7,
    context: desktop(1366, 768, 'en-US'),
    summary: 'curious first-timer, desktop',
  },
  host: {
    key: 'host',
    userId: 'sim000000000000000000005',
    email: 'sim-host@study-rooms.invalid',
    accountName: 'Sim Host',
    displayName: 'Sim-Host',
    role: 'superadmin',
    locale: 'en',
    character: 1,
    context: desktop(1440, 900, 'en-US'),
    summary: 'group host and moderator (the owner role)',
  },
};
