-- bph_works_pending_changes: contributor-proposed edits awaiting editor review.
--
-- Workflow:
--   1. Contributor submits an edit/create through the catalog edit page.
--      Row is inserted here with status='pending', the live bph_works row
--      is untouched.
--   2. Editor reviews via /[tenant]/catalog/review. On approval, the
--      applyWorkRevision helper writes a bph_works_revisions row and
--      updates bph_works in the same call; this row is marked 'approved'
--      with applied_revision_id pointing at that revision.
--   3. On reject, the row is marked 'rejected' with the editor's note;
--      bph_works is unchanged.
--
-- Retained rejected rows are institutional memory — they record what was
-- considered and decided against. Do NOT delete rejected rows.
--
-- Run via Supabase SQL editor or psql:
--   psql "$DATABASE_URL" -f scripts/migration/add-bph-works-pending-changes.sql

CREATE TABLE IF NOT EXISTS bph_works_pending_changes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ubn is nullable: contributors can propose creating a new work without
  -- knowing the UBN. Editor confirms or assigns the UBN on approval.
  ubn                 TEXT REFERENCES bph_works(ubn),
  change_type         TEXT NOT NULL DEFAULT 'edit'
                      CHECK (change_type IN ('edit', 'create', 'delete')),
  proposer_email      TEXT NOT NULL,
  proposer_user_id    TEXT,
  -- Shape: { field_name: { from, to, source?, evidence? }, ... }
  -- `from` snapshots the pre-edit value so the review UI can render a real
  -- diff even after the live row has moved on. `to` is what the contributor
  -- is proposing. `source` / `evidence` are the citation the editor needs
  -- to evaluate the change.
  field_changes       JSONB NOT NULL,
  -- Contributor's UBN suggestion for change_type='create' — editor may
  -- confirm or override during approval (UBN minting policy is BPH's call).
  proposed_ubn        TEXT,
  note                TEXT,
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by         TEXT,
  reviewed_at         TIMESTAMPTZ,
  review_note         TEXT,
  -- Set when status='approved' — points at the resulting bph_works_revisions row.
  applied_revision_id UUID
);

-- Review inbox queries by status + recency.
CREATE INDEX IF NOT EXISTS bph_works_pending_changes_status_idx
  ON bph_works_pending_changes (status, created_at DESC);

-- "Pending edits on this work" + "your submission status" queries.
CREATE INDEX IF NOT EXISTS bph_works_pending_changes_ubn_status_idx
  ON bph_works_pending_changes (ubn, status);

-- Contributor's "my submissions" panel.
CREATE INDEX IF NOT EXISTS bph_works_pending_changes_proposer_idx
  ON bph_works_pending_changes (proposer_email, created_at DESC);
