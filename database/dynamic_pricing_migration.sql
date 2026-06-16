-- ============================================================
--  Dynamic Pricing System — Phase 1 (admin tooling only)
--  These tables are PARALLEL to plan_student_tiers / billing_periods.
--  Nothing in this file modifies existing tables or live pricing.
-- ============================================================
--
--  HOW TO RUN
--  ----------
--  From the project root, against your database:
--
--      psql "$DATABASE_URL" -f database/dynamic_pricing_migration.sql
--
--  The script is idempotent (CREATE TABLE IF NOT EXISTS / ON CONFLICT DO NOTHING),
--  so it is safe to run on a fresh DB and on a DB that already has the legacy schema.
--
--  HOW TO ROLL BACK
--  ----------------
--  This removes ONLY the new dynamic-pricing tables. The legacy pricing
--  system (plans, plan_student_tiers, billing_periods, features) is untouched.
--
--      DROP TABLE IF EXISTS plan_region_prices,
--                           pricing_region_countries,
--                           pricing_regions,
--                           dynamic_billing_cycles CASCADE;
--
-- ============================================================

-- 1. Regions an admin can define
CREATE TABLE IF NOT EXISTS pricing_regions (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Exactly one region is the default (used when a country has no explicit mapping)
CREATE UNIQUE INDEX IF NOT EXISTS pricing_regions_single_default
  ON pricing_regions ((1)) WHERE is_default = TRUE;

-- 2. Country -> region mapping. A country belongs to AT MOST ONE region.
CREATE TABLE IF NOT EXISTS pricing_region_countries (
  id SERIAL PRIMARY KEY,
  region_id INT NOT NULL REFERENCES pricing_regions(id) ON DELETE CASCADE,
  country_code VARCHAR(2) NOT NULL UNIQUE,
  country_name VARCHAR(100),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_region_countries_country ON pricing_region_countries(country_code);
CREATE INDEX IF NOT EXISTS idx_region_countries_region  ON pricing_region_countries(region_id);

-- 3. Per-plan, per-region pricing rows
CREATE TABLE IF NOT EXISTS plan_region_prices (
  id SERIAL PRIMARY KEY,
  plan_id INT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  region_id INT NOT NULL REFERENCES pricing_regions(id) ON DELETE CASCADE,
  base_price_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
  free_student_threshold INT NOT NULL DEFAULT 50,
  per_student_rate_usd DECIMAL(10,4) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(plan_id, region_id)
);
CREATE INDEX IF NOT EXISTS idx_plan_region_prices_lookup ON plan_region_prices(plan_id, region_id);

-- 4. NEW billing cycles for the dynamic system, stored separately so we don't
--    pollute the live `billing_periods` table during testing.
CREATE TABLE IF NOT EXISTS dynamic_billing_cycles (
  id SERIAL PRIMARY KEY,
  cycle_key VARCHAR(30) NOT NULL UNIQUE,
  label VARCHAR(50) NOT NULL,
  months INT NOT NULL CHECK (months > 0),
  discount_percentage INT NOT NULL DEFAULT 0 CHECK (discount_percentage >= 0 AND discount_percentage <= 50),
  hint VARCHAR(100),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Seed a default region and a starter set of cycles so the admin UI has something to show on first load
INSERT INTO pricing_regions (name, is_default, sort_order)
VALUES ('Default (Rest of World)', TRUE, 999)
ON CONFLICT (name) DO NOTHING;

INSERT INTO dynamic_billing_cycles (cycle_key, label, months, discount_percentage, hint, sort_order)
VALUES
  ('monthly',  'Monthly',  1,  0,  NULL,            1),
  ('term',     'Per Term', 3,  0,  'Paid monthly',  2),
  ('6_months', '6 Months', 6,  5,  NULL,            3),
  ('yearly',   '1 Year',   12, 10, NULL,            4),
  ('2_years',  '2 Years',  24, 20, NULL,            5)
ON CONFLICT (cycle_key) DO NOTHING;
