-- Plans (utils/planCatalog.js): three plans with one name each, Starter, Pro and Premium, each
-- with everything of the one before it; PayGira and the parent and student portals in every plan;
-- and the United States (default) price list: $39 / $59 / $79 a month with 20 students included,
-- then $1.50 / $2.50 / $3.50 for each extra student a month.
--
-- It runs once: the "Priority Support" feature marks that it has, so running it again changes
-- nothing and never undoes a plan or a price edited afterwards in Admin › Pricing. Features are
-- only ever added to a plan here, so no school loses anything when it runs.
DO $$
DECLARE
  starter_id INTEGER;
  pro_id INTEGER;
  premium_id INTEGER;
  us_region INTEGER;
  wanted TEXT;
  plan_row RECORD;
BEGIN
  IF EXISTS (SELECT 1 FROM features WHERE LOWER(TRIM(feature_name)) = 'priority support') THEN
    RETURN;
  END IF;

  -- The features plans can now include that had no row of their own.
  FOREACH wanted IN ARRAY ARRAY['Report Builder', 'Student Portal', 'Transportation', 'Mira Basic', 'Mira Full', 'Custom Report Card Templates', 'Priority Support'] LOOP
    IF NOT EXISTS (SELECT 1 FROM features WHERE LOWER(TRIM(feature_name)) = LOWER(wanted)) THEN
      INSERT INTO features (feature_name, price_usd) VALUES (wanted, 0);
    END IF;
  END LOOP;

  SELECT id INTO starter_id FROM plans WHERE plan_name ILIKE '%starter%' OR plan_name ILIKE '%basic%' ORDER BY id LIMIT 1;
  SELECT id INTO pro_id FROM plans WHERE plan_name ILIKE 'pro%' ORDER BY id LIMIT 1;
  SELECT id INTO premium_id FROM plans WHERE plan_name ILIKE '%premium%' ORDER BY id LIMIT 1;

  -- One name per plan.
  UPDATE plans SET plan_name = 'Starter', description = 'The essentials to run a school.' WHERE id = starter_id;
  UPDATE plans SET plan_name = 'Pro', description = 'For schools that test online, issue transcripts and want Mira.' WHERE id = pro_id;
  UPDATE plans SET plan_name = 'Premium', description = 'The whole platform, with your website, buses and priority support.' WHERE id = premium_id;

  -- What each plan includes: every plan has what the plan before it has.
  FOR plan_row IN
    SELECT * FROM (VALUES
      (starter_id, ARRAY['Organization Dashboard', 'Student and Guardian Profile', 'Attendance Tracking', 'Assessment Tracking',
                         'Terminal Report', 'Progressive Student Report', 'Parent/Guardian Portal', 'Student Portal', 'PayGira',
                         'Organization Analytics & Insights']),
      (pro_id,     ARRAY['Organization Dashboard', 'Student and Guardian Profile', 'Attendance Tracking', 'Assessment Tracking',
                         'Terminal Report', 'Progressive Student Report', 'Parent/Guardian Portal', 'Student Portal', 'PayGira',
                         'Organization Analytics & Insights',
                         'Set Assessment Questions', 'Official School Transcript', 'Custom Report Card Templates', 'Class Base Merit Sheet',
                         'Class Base Analytics & Insights', 'Mira Basic']),
      (premium_id, ARRAY['Organization Dashboard', 'Student and Guardian Profile', 'Attendance Tracking', 'Assessment Tracking',
                         'Terminal Report', 'Progressive Student Report', 'Parent/Guardian Portal', 'Student Portal', 'PayGira',
                         'Organization Analytics & Insights',
                         'Set Assessment Questions', 'Official School Transcript', 'Custom Report Card Templates', 'Class Base Merit Sheet',
                         'Class Base Analytics & Insights', 'Mira Basic',
                         'Report Builder', 'School Website', 'Create Files', 'Transportation', 'Mira Full', 'Priority Support'])
    ) AS ladder(plan_id, names)
  LOOP
    CONTINUE WHEN plan_row.plan_id IS NULL;
    INSERT INTO plan_features (plan_id, feature_id)
    SELECT plan_row.plan_id, f.id
      FROM features f
     WHERE f.feature_name = ANY(plan_row.names)
       AND NOT EXISTS (SELECT 1 FROM plan_features pf WHERE pf.plan_id = plan_row.plan_id AND pf.feature_id = f.id);
  END LOOP;

  -- The United States (default) price list: a month's price with 20 students included, and a
  -- price for each extra student a month (its term is one month, so the rate is per month).
  SELECT id INTO us_region FROM pricing_regions WHERE is_default = TRUE ORDER BY id LIMIT 1;
  IF us_region IS NOT NULL THEN
    FOR plan_row IN
      SELECT * FROM (VALUES (starter_id, 39.00, 1.50), (pro_id, 59.00, 2.50), (premium_id, 79.00, 3.50)) AS price(plan_id, base, rate)
    LOOP
      CONTINUE WHEN plan_row.plan_id IS NULL;
      UPDATE plan_region_prices
         SET base_price_usd = plan_row.base, free_student_threshold = 20, free_student_percent = NULL,
             per_student_rate_usd = plan_row.rate, is_active = TRUE, updated_at = NOW()
       WHERE plan_id = plan_row.plan_id AND region_id = us_region;
      IF NOT FOUND THEN
        INSERT INTO plan_region_prices (plan_id, region_id, base_price_usd, free_student_threshold, per_student_rate_usd, is_active)
        VALUES (plan_row.plan_id, us_region, plan_row.base, 20, plan_row.rate, TRUE);
      END IF;
    END LOOP;
    UPDATE app_settings SET value = '1' WHERE key = 'dynamic_region_term_months_' || us_region;
    IF NOT FOUND THEN
      INSERT INTO app_settings (key, value) VALUES ('dynamic_region_term_months_' || us_region, '1');
    END IF;
  END IF;
END $$;

-- The parent portal's own switch (Settings › Integrations). Empty means the school hasn't
-- chosen: it follows its plan, as before (utils/guardianPortalAccess.js).
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS parent_portal_activated BOOLEAN;
