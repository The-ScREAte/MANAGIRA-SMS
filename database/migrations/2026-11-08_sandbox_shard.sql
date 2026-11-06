-- The sandbox shard shares the main shard's database, so moving a school onto it changes
-- only the directory and no rows are copied. New features reach its schools first; from
-- the Features page they can then go to other shards, hubs and schools.
ALTER TABLE shards ADD COLUMN IF NOT EXISTS same_database BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE shard_feature_access ADD COLUMN IF NOT EXISTS shard_ids INTEGER[] NOT NULL DEFAULT '{}';

-- It uses the main shard's ID numbers, so it needs no block of its own.
INSERT INTO shards (name, environment, region, status, accepts_new, is_control, id_block, hosting_location, same_database)
VALUES ('sandbox-shard', 'sandbox', 'us', 'active', FALSE, FALSE, -1, 'oregon', TRUE)
ON CONFLICT (name) DO NOTHING;
