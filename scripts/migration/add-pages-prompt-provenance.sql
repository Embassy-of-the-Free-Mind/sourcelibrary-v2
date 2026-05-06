-- Add prompt provenance columns to the Supabase pages mirror.
-- MongoDB pages already carry these (PR #1627 + #1632); the Hetzner
-- supabase-page-writer dual-write was silently dropping them because
-- the columns didn't exist.
--
-- Each prompt has four fields, all stored together on every overwrite:
--   prompt_version  — version number/string from the DB prompts collection
--   prompt_id       — ObjectId of the prompts row, or 'hardcoded' / 'custom'
--   prompt_hash     — md5(prompt content); cryptographic verifier
--   prompt_name     — human-readable name (e.g. "Standard Translation")
--
-- ocr_prompt_version already exists from an earlier migration.
-- This adds the three missing fields for both ocr_* and translation_*.
--
-- Safe to run repeatedly; column adds are idempotent.

ALTER TABLE pages ADD COLUMN IF NOT EXISTS ocr_prompt_id   TEXT;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS ocr_prompt_hash TEXT;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS ocr_prompt_name TEXT;

ALTER TABLE pages ADD COLUMN IF NOT EXISTS translation_prompt_id   TEXT;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS translation_prompt_hash TEXT;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS translation_prompt_name TEXT;

COMMENT ON COLUMN pages.ocr_prompt_id   IS 'ObjectId-string of the prompts row used for this OCR write, or "hardcoded" / "custom"';
COMMENT ON COLUMN pages.ocr_prompt_hash IS 'md5 of the OCR prompt content at write time (cryptographic integrity check)';
COMMENT ON COLUMN pages.ocr_prompt_name IS 'Human-readable prompt name, e.g. "Standard OCR" or "Latin OCR (Neo-Latin)"';
COMMENT ON COLUMN pages.translation_prompt_id   IS 'ObjectId-string of the prompts row used for this translation write';
COMMENT ON COLUMN pages.translation_prompt_hash IS 'md5 of the translation prompt content at write time';
COMMENT ON COLUMN pages.translation_prompt_name IS 'Human-readable prompt name, e.g. "Standard Translation"';
