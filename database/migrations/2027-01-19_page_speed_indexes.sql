-- Indexes for the lookups the main pages repeat on every load (Settings, class dashboard, Management,
-- Reports, Admissions, PayGira). Each table below had no index starting with the school (organization_id),
-- so every such lookup read the whole table across ALL schools; found by listing pg_indexes and checking the
-- plans with EXPLAIN ANALYZE (Seq Scan on users / enrollments / assessments / payments / school_years).
-- Safe to repeat. Local copy only until released.
CREATE INDEX IF NOT EXISTS idx_users_organization ON users (organization_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_org_term ON enrollments (organization_id, term_id);
CREATE INDEX IF NOT EXISTS idx_assessments_org_term_class ON assessments (organization_id, term_id, class_id);
CREATE INDEX IF NOT EXISTS idx_payments_org_created ON payments (organization_id, created_at);
CREATE INDEX IF NOT EXISTS idx_school_years_organization ON school_years (organization_id);
CREATE INDEX IF NOT EXISTS idx_announcements_org_term ON announcements (organization_id, term_id);
