-- Supabase table for donation intentions
-- Run this in the Supabase SQL editor

CREATE TABLE IF NOT EXISTS donation_intentions (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  route       TEXT NOT NULL CHECK (route IN ('naf', 'efm', 'undecided')),
  amount_range TEXT,          -- e.g. 'under-100', '100-500', '500-1000', '1000-5000', '5000-plus'
  message     TEXT,
  referrer    TEXT,           -- how they found us
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS: service role can read/write, anon can insert only
ALTER TABLE donation_intentions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON donation_intentions
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Anon can insert" ON donation_intentions
  FOR INSERT WITH CHECK (true);

-- Index for admin queries
CREATE INDEX idx_donation_intentions_created ON donation_intentions (created_at DESC);
CREATE INDEX idx_donation_intentions_email ON donation_intentions (email);
