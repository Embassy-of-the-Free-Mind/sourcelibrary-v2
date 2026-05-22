-- bph_works_revisions: append-only history of every change applied to bph_works.
--
-- Source Library is becoming the BPH catalogue of record (replacing Memorix —
-- see issue #1878). Once that's true, the revisions table IS the catalogue's
-- history. There is no "previous database" to fall back on. So:
--
--   * APPEND-ONLY. No UPDATEs, no DELETEs — not even by superadmins.
--   * Mistakes are corrected by NEW revisions that undo the change. The
--     mistake itself becomes part of the permanent history.
--   * Every applied change writes a row here, regardless of source — editor
--     direct, contributor approval, or system jobs (USTC matcher, metadata
--     enrichment). System edits use editor_email='system:<job-name>'.
--
-- The single mutation path on the application side is applyWorkRevision
-- (src/lib/bph-catalog.ts). Direct UPDATEs on bph_works are forbidden by
-- code review + RLS (see policies at the bottom).
--
-- Run via Supabase SQL editor or psql:
--   psql "$DATABASE_URL" -f scripts/migration/add-bph-works-revisions.sql

CREATE TABLE IF NOT EXISTS bph_works_revisions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ubn is NOT NULL — every revision applies to a specific work. For
  -- change_type='create', the editor's UBN assignment lands in bph_works
  -- first; the revision row records the create against that UBN.
  ubn                 TEXT NOT NULL REFERENCES bph_works(ubn),
  change_type         TEXT NOT NULL DEFAULT 'edit'
                      CHECK (change_type IN ('edit', 'create', 'delete')),
  -- Shape mirrors pending_changes.field_changes:
  -- { field_name: { from, to, source?, evidence? }, ... }
  -- `from` is the value the field actually held when the revision was applied
  -- (not what the contributor saw at submit time — that's stored on the
  -- pending row). This is what a future reverter consults.
  field_changes       JSONB NOT NULL,
  -- Who applied this change. For editor-direct edits: editor's email. For
  -- contributor approvals: the editor who approved (not the proposer — see
  -- proposed_by). For cron / pipeline edits: 'system:<job-name>'.
  editor_email        TEXT NOT NULL,
  -- Contributor email when this revision came from an approved pending row.
  -- NULL for editor-direct edits and system edits.
  proposed_by         TEXT,
  -- Link back to the pending row this revision was applied from (if any).
  -- Same value as pending.applied_revision_id viewed the other way around.
  source_pending_id   UUID,
  applied_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note                TEXT
);

-- Revision history scrubs back from newest first.
CREATE INDEX IF NOT EXISTS bph_works_revisions_ubn_applied_idx
  ON bph_works_revisions (ubn, applied_at DESC);

-- Audit queries by editor — "everything Paul has changed this month".
CREATE INDEX IF NOT EXISTS bph_works_revisions_editor_idx
  ON bph_works_revisions (editor_email, applied_at DESC);

-- Append-only enforcement at the database level. The application helper
-- only INSERTs into this table, but RLS is the second line of defence
-- against accidental fixes-in-place by future contributors to the codebase.
--
-- Even superadmin clients must not UPDATE or DELETE here. To revert a bad
-- revision, INSERT a new revision row that restores the prior value (the
-- bad revision stays in the log).
ALTER TABLE bph_works_revisions ENABLE ROW LEVEL SECURITY;

-- Service role can INSERT + SELECT, nothing else.
DROP POLICY IF EXISTS bph_works_revisions_service_insert ON bph_works_revisions;
CREATE POLICY bph_works_revisions_service_insert
  ON bph_works_revisions
  FOR INSERT
  TO service_role
  WITH CHECK (true);

DROP POLICY IF EXISTS bph_works_revisions_service_select ON bph_works_revisions;
CREATE POLICY bph_works_revisions_service_select
  ON bph_works_revisions
  FOR SELECT
  TO service_role
  USING (true);

-- Authenticated reads — every signed-in user can read the revision history
-- of any work. (Contributors need this to view their own submissions; the UI
-- gates visibility per-tenant.)
DROP POLICY IF EXISTS bph_works_revisions_auth_select ON bph_works_revisions;
CREATE POLICY bph_works_revisions_auth_select
  ON bph_works_revisions
  FOR SELECT
  TO authenticated
  USING (true);

-- Belt-and-braces grant revoke: no role gets UPDATE or DELETE.
REVOKE UPDATE, DELETE ON bph_works_revisions FROM PUBLIC;
REVOKE UPDATE, DELETE ON bph_works_revisions FROM authenticated;
REVOKE UPDATE, DELETE ON bph_works_revisions FROM anon;
-- (service_role retains UPDATE/DELETE at the GRANT level by Supabase default,
-- but RLS above blocks it; if a future migration disables RLS, the application
-- helper must remain the only writer.)
