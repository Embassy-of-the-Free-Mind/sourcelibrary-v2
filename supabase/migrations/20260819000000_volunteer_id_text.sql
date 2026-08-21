-- volunteer_id: uuid → text.
--
-- Ratings are attributed to the signed-in account since #3632: the client
-- sends session.user.id, which is the NextAuth MongoDBAdapter ObjectId as a
-- 24-hex STRING, not a uuid. The uuid column type rejected every such insert
-- (22P02), which — combined with the API's uuid-shaped regex, fixed in #4052 —
-- kept the review queues write-dead from 2026-08-05 to 2026-08-19.
-- The anonymous per-browser uuid remains a valid value; text admits both.
ALTER TABLE volunteer_ratings
  ALTER COLUMN volunteer_id TYPE text USING volunteer_id::text;
