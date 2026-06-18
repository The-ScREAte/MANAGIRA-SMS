-- Adds a standalone pricing feature that can be attached to plans.
-- This feature is intentionally not mapped to any protected route.

INSERT INTO features (feature_name, price_usd)
VALUES ('Lesson Notes', 0)
ON CONFLICT (feature_name) DO UPDATE
SET feature_name = EXCLUDED.feature_name;
