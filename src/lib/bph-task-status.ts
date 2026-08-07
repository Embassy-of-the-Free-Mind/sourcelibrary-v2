/**
 * Statuses for the BPH task board.
 *
 * Ported from the `/requests` board in the EFM report portal, which has been
 * in real use and whose column set has already survived contact with a client:
 * new → considering → planned → in_progress → shipped, with declined as the
 * off-ramp. Keeping the same vocabulary means the two boards read the same to
 * the people who use both.
 *
 * Client- and server-safe: no imports, no I/O. The board is a client component
 * and the API routes are server code, and both need this.
 */

export const TASK_STATUSES = [
  'new',
  'considering',
  'planned',
  'in_progress',
  'shipped',
  'declined',
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const STATUS_META: Record<TaskStatus, { label: string; blurb: string }> = {
  new: { label: 'New', blurb: 'Not looked at yet.' },
  considering: { label: 'Considering', blurb: 'Being weighed up.' },
  planned: { label: 'Planned', blurb: 'Agreed, waiting its turn.' },
  in_progress: { label: 'In progress', blurb: 'Being worked on now.' },
  shipped: { label: 'Done', blurb: 'Live on the site.' },
  declined: { label: 'Declined', blurb: 'Not going to happen, and why.' },
};

/** Columns shown on the board, in order. */
export const BOARD_COLUMNS: TaskStatus[] = [
  'new',
  'considering',
  'planned',
  'in_progress',
  'shipped',
];

export function isTaskStatus(v: unknown): v is TaskStatus {
  return typeof v === 'string' && (TASK_STATUSES as readonly string[]).includes(v);
}

export function statusLabel(s: string): string {
  return (STATUS_META as Record<string, { label: string }>)[s]?.label ?? s;
}

/**
 * Which to-do list a task belongs to.
 *
 * The report portal splits by audience (dev vs client staff) and that split is
 * the useful one here too: a librarian needs to see which items are waiting on
 * them versus waiting on us, or the board becomes a list of other people's
 * problems.
 */
export const TASK_LISTS = ['librarian', 'dev'] as const;
export type TaskList = (typeof TASK_LISTS)[number];

export const LIST_META: Record<TaskList, { label: string; blurb: string }> = {
  librarian: {
    label: 'For the library',
    blurb: 'Cataloguing and content decisions only the BPH can make.',
  },
  dev: {
    label: 'For the developers',
    blurb: 'Things to build, fix, or change on the site.',
  },
};

export function isTaskList(v: unknown): v is TaskList {
  return typeof v === 'string' && (TASK_LISTS as readonly string[]).includes(v);
}

/**
 * Fractional ordering, as on the `/requests` board: a card dropped between two
 * neighbours takes the midpoint of their positions, so a move is one row
 * written rather than a reindex of the column.
 */
export function positionBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) return 1000;
  if (before === null) return (after as number) - 1000;
  if (after === null) return (before as number) + 1000;
  return (before + after) / 2;
}
