-- Free students for a time: a price list can give a plan's free students (a number or a
-- share) for a school's first months only. Empty means always, as before. Safe to repeat.
ALTER TABLE plan_region_prices ADD COLUMN IF NOT EXISTS free_student_months SMALLINT;

-- A single school's own free students, in place of its price list's (Admin › Organizations ›
-- Pricing): {"count": 40, "percent": null, "months": 6}. Empty means as the price list.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS custom_free_students JSONB;
