CREATE TABLE IF NOT EXISTS plan_region_prices_audit (
  id BIGSERIAL PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  region_id INTEGER NOT NULL REFERENCES pricing_regions(id) ON DELETE CASCADE,
  old_base_price_usd NUMERIC(12,4),
  new_base_price_usd NUMERIC(12,4) NOT NULL,
  old_free_student_threshold INTEGER,
  new_free_student_threshold INTEGER NOT NULL,
  old_per_student_rate_usd NUMERIC(12,4),
  new_per_student_rate_usd NUMERIC(12,4) NOT NULL,
  changed_by_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plan_region_prices_audit_plan_region
  ON plan_region_prices_audit (plan_id, region_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_plan_region_prices_audit_changed_by
  ON plan_region_prices_audit (changed_by_user_id, changed_at DESC);
