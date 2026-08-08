import { supabaseAdmin } from '@/lib/supabase';

/**
 * Two views of catalogue activity that used to live inside the workspace page
 * and are now needed in more than one place:
 *
 *   worklist  — "Needs your attention", the records where only a librarian can
 *               decide. Moved into Review, because it is a queue of decisions
 *               like the other Review tabs, not a report about you.
 *   revisions — the change log. Now its own page, because it is a record of
 *               the whole catalogue rather than of your work.
 *
 * Both read through supabaseAdmin (service role): `bph_works_revisions` is
 * RLS-locked, and every caller is already editor-gated.
 */

export interface WorklistRow {
  category: string;
  label: string;
  detail: string;
  n: number;
  samples: Array<{ ubn: string | null; id: string; shelf_mark: string | null; hint: string | null }>;
}

export interface RevisionRow {
  id: string;
  ubn: string;
  change_type: string;
  field_changes: Record<string, { from?: unknown; to?: unknown; source?: string }>;
  editor_email: string;
  applied_at: string;
  note: string | null;
}

const REVISION_COLUMNS =
  'id, ubn, change_type, field_changes, editor_email, applied_at, note';

/** Records needing a librarian's decision, highest-count categories first. */
export async function fetchWorklist(): Promise<WorklistRow[]> {
  if (!supabaseAdmin) return [];
  const { data, error } = await supabaseAdmin.rpc('bph_catalogue_worklist');
  if (error) return [];
  return ((data as WorklistRow[] | null) || []).filter((w) => w.n > 0);
}

/**
 * The catalogue's change log, newest first.
 *
 * `limit` is capped because this is a page, not an export — the per-record
 * History view is the place to follow one work all the way back.
 */
export async function fetchRecentRevisions(limit = 50): Promise<RevisionRow[]> {
  if (!supabaseAdmin) return [];
  const { data, error } = await supabaseAdmin
    .from('bph_works_revisions')
    .select(REVISION_COLUMNS)
    .order('applied_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200));
  if (error) return [];
  return (data as RevisionRow[] | null) || [];
}

/** The signed-in librarian's own edits, newest first. */
export async function fetchRevisionsByEditor(
  email: string,
  limit = 40
): Promise<RevisionRow[]> {
  if (!supabaseAdmin || !email) return [];
  const { data, error } = await supabaseAdmin
    .from('bph_works_revisions')
    .select(REVISION_COLUMNS)
    .eq('editor_email', email)
    .order('applied_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200));
  if (error) return [];
  return (data as RevisionRow[] | null) || [];
}

const FIELD_LABELS: Record<string, string> = {
  state_shelf_mark: 'State Collection shelf mark',
  shelf_mark: 'Shelf mark',
  present_location: 'Present location',
  internal_remarks: 'Internal remarks',
  exhibition_history: 'Exhibition history',
  impressum_original: 'Original impressum',
  bibliographic_format: 'Format',
  number_of_copies: 'Copies held',
  ustc_sn: 'USTC number',
  ia_identifier: 'Internet Archive id',
};

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] || field.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/** Automated edits are labelled as such rather than shown as an email. */
export function editorName(email: string): string {
  return email.startsWith('system:') ? 'Source Library (automatic)' : email;
}
