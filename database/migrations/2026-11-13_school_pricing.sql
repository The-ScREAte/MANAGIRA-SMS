-- A single school's own prices, set by Managira in Admin › Organizations › Pricing
-- (utils/orgPricing.js): a monthly price in place of its plan's price, a discount, and its
-- own price for each add-on ({ "mira": 4.5, "transportation": 0 }; 0 is free for this school).
-- Empty means the standard prices. Safe to run more than once.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS custom_monthly_price NUMERIC(10, 2);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS custom_discount_percent NUMERIC(5, 2) NOT NULL DEFAULT 0;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS custom_addon_prices JSONB;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS pricing_notes TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS pricing_updated_at TIMESTAMPTZ;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS pricing_updated_by INTEGER;

-- A plan's free students in a price list can be a share of the school's students instead of a
-- number (Admin › Pricing › Prices by country): 10 means the first 10% of students are free.
-- Empty means free_student_threshold, a number, as before.
ALTER TABLE plan_region_prices ADD COLUMN IF NOT EXISTS free_student_percent NUMERIC(5, 2);
