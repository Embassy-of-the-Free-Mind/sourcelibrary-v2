/**
 * Study Rooms — UI contract (routes, test ids, data attributes).
 *
 * The feature does not exist yet. This file is the agreement between the spec
 * (docs/study-rooms/SPEC.md) and the code that will be built: build the UI to
 * match these ids, or change them here in the same PR as the UI.
 *
 * Conventions:
 *  - every id is a `data-testid`;
 *  - per-person ids are keyed by the person's public room id (never an email);
 *  - state is exposed as data attributes (listed in ATTR) so tests and
 *    screen-reader text can agree with what is drawn.
 */

export type GroupSlug =
  | 'hermetica-alchemy'
  | 'platonists-circle'
  | 'translators-room'
  | 'circulo-en-espanol'
  | 'ancient-worlds';

export interface Group {
  slug: GroupSlug;
  name: string;
  /** Anchor text path, or null for working groups. */
  anchorBook: string | null;
}

export const GROUPS: Record<GroupSlug, Group> = {
  'hermetica-alchemy': {
    slug: 'hermetica-alchemy',
    name: 'Hermetica & Alchemy',
    anchorBook: '/book/corpus-hermeticum-pimander-ficino-translation-translator',
  },
  'platonists-circle': {
    slug: 'platonists-circle',
    name: "Platonists' Circle",
    anchorBook: '/book/five-books-of-plotinus-taylor',
  },
  'translators-room': { slug: 'translators-room', name: "Translators' Room", anchorBook: null },
  'circulo-en-espanol': { slug: 'circulo-en-espanol', name: 'Círculo en español', anchorBook: null },
  'ancient-worlds': { slug: 'ancient-worlds', name: 'Ancient Worlds', anchorBook: null },
};

export const ROUTES = {
  lobby: '/study-rooms',
  lobbyEs: '/es/study-rooms',
  listView: '/study-rooms?view=list',
  room: (slug: GroupSlug) => `/study-rooms/${slug}`,
  roomEs: (slug: GroupSlug) => `/es/study-rooms/${slug}`,
} as const;

/** Data attributes the build exposes for state. */
export const ATTR = {
  /** On avatars: integer tile coordinates. */
  tileX: 'data-tile-x',
  tileY: 'data-tile-y',
  /** On the self avatar / page root: current room slug, or "hall". */
  room: 'data-room',
  /** On status elements: a small enum, see STATE. */
  state: 'data-state',
  /** On roster items / avatars: "away" while a person is reconnecting. */
  presence: 'data-presence',
  /** On the shared reader panel: which book and page it shows. */
  bookSlug: 'data-book-slug',
  page: 'data-page',
  /** On the root: the interface language. */
  lang: 'lang',
} as const;

export const STATE = {
  connection: { connected: 'connected', reconnecting: 'reconnecting', offline: 'offline' },
  call: { idle: 'idle', connecting: 'connecting', connected: 'connected' },
  visibility: { visible: 'visible', invisible: 'invisible' },
  toggle: { on: 'on', off: 'off' },
} as const;

/** Every `data-testid`. Functions take a public room id or slug. */
export const TID = {
  // Page shell
  root: 'sr-root',
  signinCta: 'sr-signin-cta',
  connectionStatus: 'sr-connection-status',
  liveRegion: 'sr-live-region',
  viewToggle: 'sr-view-toggle',
  leave: 'sr-leave',

  // Group info (visible logged out too)
  groupInfo: 'sr-group-info',
  nextMeeting: 'sr-next-meeting',
  meetLink: 'sr-meet-link',

  // First entry
  optIn: 'sr-optin',
  optInAccept: 'sr-optin-accept',
  optInDecline: 'sr-optin-decline',
  characterPicker: 'sr-character-picker',
  characterOption: 'sr-character-option',
  displayNameInput: 'sr-display-name',
  characterConfirm: 'sr-character-confirm',

  // Map
  map: 'sr-map',
  mapDescription: 'sr-map-description',
  selfAvatar: 'sr-avatar-self',
  avatar: (id: string) => `sr-avatar-${id}`,
  anyAvatar: 'sr-avatar',
  door: (slug: GroupSlug) => `sr-door-${slug}`,
  roomHeader: 'sr-room-header',
  emptyRoom: 'sr-empty-room',

  // Touch
  dpad: 'sr-dpad',
  dpadUp: 'sr-dpad-up',
  dpadDown: 'sr-dpad-down',
  dpadLeft: 'sr-dpad-left',
  dpadRight: 'sr-dpad-right',
  mobileSheet: 'sr-mobile-sheet',
  mobileSheetTab: (tab: 'chat' | 'people' | 'call') => `sr-sheet-tab-${tab}`,

  // People
  roster: 'sr-roster',
  rosterItem: (id: string) => `sr-roster-item-${id}`,
  anyRosterItem: 'sr-roster-item',
  personMenu: (id: string) => `sr-person-menu-${id}`,
  actionReport: 'sr-action-report',
  actionBlock: 'sr-action-block',
  actionRemove: 'sr-action-remove',
  reportDialog: 'sr-report-dialog',
  reportReason: 'sr-report-reason',
  reportDetails: 'sr-report-details',
  reportSubmit: 'sr-report-submit',
  reportConfirmation: 'sr-report-confirmation',
  hostReports: 'sr-host-reports',
  hostReportItem: 'sr-host-report-item',
  removedNotice: 'sr-removed-notice',

  // Privacy
  visibilityToggle: 'sr-visibility-toggle',
  invisibleNotice: 'sr-invisible-notice',

  // Chat
  chat: 'sr-chat',
  chatInput: 'sr-chat-input',
  chatSend: 'sr-chat-send',
  chatMessage: 'sr-chat-message',
  chatAuthor: 'sr-chat-author',

  // Call
  callJoin: 'sr-call-join',
  callLeave: 'sr-call-leave',
  callStatus: 'sr-call-status',
  callTile: (id: string) => `sr-call-tile-${id}`,
  anyCallTile: 'sr-call-tile',
  micToggle: 'sr-mic-toggle',
  camToggle: 'sr-cam-toggle',

  // Shared text
  openText: 'sr-open-text',
  sharedReader: 'sr-shared-reader',
  sharedReaderFullLink: 'sr-shared-reader-full',
  bringEveryone: 'sr-bring-everyone',
  followPrompt: 'sr-follow-prompt',
  followAccept: 'sr-follow-accept',
  pageNext: 'sr-page-next',

  // Notes
  noteBoard: 'sr-note-board',
  noteInput: 'sr-note-input',
  noteSubmit: 'sr-note-submit',
  note: 'sr-note',

  // List view
  roomList: 'sr-room-list',
  roomListItem: (slug: GroupSlug) => `sr-room-list-item-${slug}`,
  roomListCount: 'sr-room-list-count',
  roomListJoin: (slug: GroupSlug) => `sr-room-list-join-${slug}`,
} as const;

/**
 * Prefix-matching selectors for "any avatar / roster item / tile". The build
 * renders e.g. data-testid="sr-avatar-<id>"; these match all of them, excluding
 * the self avatar.
 */
export const ANY = {
  otherAvatars: `[data-testid^="sr-avatar-"]:not([data-testid="${TID.selfAvatar}"])`,
  rosterItems: `[data-testid^="sr-roster-item-"]`,
  callTiles: `[data-testid^="sr-call-tile-"]`,
} as const;

/**
 * Where a person's public room id is exposed: the self avatar carries
 * `data-person-id`, which is what other people's ids are keyed on.
 * It is an opaque id, never the email or account id.
 */
export const PERSON_ID_ATTR = 'data-person-id';

/** Timings from the spec (ms). */
export const TIMING = {
  /** Presence/position/chat should reach others within this. */
  realtime: 5_000,
  /** A dropped person stays (as "away") at least this long. */
  reconnectGrace: 30_000,
} as const;
