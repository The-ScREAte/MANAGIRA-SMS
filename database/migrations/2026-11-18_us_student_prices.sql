-- The United States (default) price list: each extra student a month is $2.00 on Starter,
-- $2.40 on Pro and $2.80 on Premium. The month's price and the 20 students included stay.
UPDATE plan_region_prices x
   SET per_student_rate_usd = v.rate, updated_at = NOW()
  FROM pricing_regions r, plans p, (VALUES ('Starter', 2.00), ('Pro', 2.40), ('Premium', 2.80)) AS v(plan_name, rate)
 WHERE r.id = x.region_id AND r.is_default AND p.id = x.plan_id AND p.plan_name = v.plan_name
   AND x.per_student_rate_usd IS DISTINCT FROM v.rate;
