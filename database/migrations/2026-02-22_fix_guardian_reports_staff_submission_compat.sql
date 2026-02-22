-- Ensure guardian reports schema supports staff-submitted reports and parent portal visibility
-- Safe to run multiple times

CREATE TABLE IF NOT EXISTS guardian_reports (
    report_id SERIAL PRIMARY KEY,
    guardian_id INTEGER NOT NULL,
    student_id INTEGER,
    organization_id INTEGER NOT NULL,
    report_type VARCHAR(50),
    subject VARCHAR(255),
    message TEXT,
    status VARCHAR(50) DEFAULT 'open',
    priority VARCHAR(50) DEFAULT 'normal',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    resolved_at TIMESTAMP,
    deleted_at TIMESTAMP
);

ALTER TABLE guardian_reports
    ADD COLUMN IF NOT EXISTS report_type VARCHAR(50),
    ADD COLUMN IF NOT EXISTS priority VARCHAR(50) DEFAULT 'normal',
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

UPDATE guardian_reports
SET status = 'open'
WHERE status IS NULL OR TRIM(status) = '';

CREATE INDEX IF NOT EXISTS idx_guardian_reports_guardian_id ON guardian_reports(guardian_id);
CREATE INDEX IF NOT EXISTS idx_guardian_reports_student_id ON guardian_reports(student_id);
CREATE INDEX IF NOT EXISTS idx_guardian_reports_organization_id ON guardian_reports(organization_id);
CREATE INDEX IF NOT EXISTS idx_guardian_reports_status ON guardian_reports(status);
CREATE INDEX IF NOT EXISTS idx_guardian_reports_created_at ON guardian_reports(created_at);
CREATE INDEX IF NOT EXISTS idx_guardian_reports_guardian_org ON guardian_reports(guardian_id, organization_id);
