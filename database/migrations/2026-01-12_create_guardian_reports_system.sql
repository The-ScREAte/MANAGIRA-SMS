-- Guardian Reports and Replies System
-- Creates a ticketing system for guardian-teacher communication with CC functionality

-- Reports table
CREATE TABLE IF NOT EXISTS guardian_reports (
    report_id SERIAL PRIMARY KEY,
    guardian_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
    subject VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    status VARCHAR(50) DEFAULT 'open', -- open, in_progress, resolved, closed
    priority VARCHAR(50) DEFAULT 'normal', -- low, normal, high, urgent
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP,
    deleted_at TIMESTAMP -- for soft delete after 3 months
);

-- Replies table
CREATE TABLE IF NOT EXISTS guardian_report_replies (
    reply_id SERIAL PRIMARY KEY,
    report_id INTEGER NOT NULL REFERENCES guardian_reports(report_id) ON DELETE CASCADE,
    sender_type VARCHAR(50) NOT NULL, -- 'guardian' or 'staff'
    sender_id INTEGER NOT NULL, -- guardian_id or user_id
    sender_name VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_read BOOLEAN DEFAULT FALSE
);

-- CC/Recipients table - who can view and reply to this report
CREATE TABLE IF NOT EXISTS guardian_report_recipients (
    recipient_id SERIAL PRIMARY KEY,
    report_id INTEGER NOT NULL REFERENCES guardian_reports(report_id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    user_name VARCHAR(255) NOT NULL,
    user_role VARCHAR(100), -- teacher, manager, supervisor, etc
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_read_at TIMESTAMP,
    UNIQUE(report_id, user_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_guardian_reports_guardian_id ON guardian_reports(guardian_id);
CREATE INDEX IF NOT EXISTS idx_guardian_reports_student_id ON guardian_reports(student_id);
CREATE INDEX IF NOT EXISTS idx_guardian_reports_organization_id ON guardian_reports(organization_id);
CREATE INDEX IF NOT EXISTS idx_guardian_reports_status ON guardian_reports(status);
CREATE INDEX IF NOT EXISTS idx_guardian_reports_created_at ON guardian_reports(created_at);
CREATE INDEX IF NOT EXISTS idx_guardian_report_replies_report_id ON guardian_report_replies(report_id);
CREATE INDEX IF NOT EXISTS idx_guardian_report_replies_sender_type ON guardian_report_replies(sender_type);
CREATE INDEX IF NOT EXISTS idx_guardian_report_recipients_report_id ON guardian_report_recipients(report_id);
CREATE INDEX IF NOT EXISTS idx_guardian_report_recipients_user_id ON guardian_report_recipients(user_id);

-- Function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_guardian_reports_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS trigger_update_guardian_reports_timestamp ON guardian_reports;
CREATE TRIGGER trigger_update_guardian_reports_timestamp
    BEFORE UPDATE ON guardian_reports
    FOR EACH ROW
    EXECUTE FUNCTION update_guardian_reports_timestamp();

-- Add comments for documentation
COMMENT ON TABLE guardian_reports IS 'Stores guardian reports/tickets for communication with school staff';
COMMENT ON TABLE guardian_report_replies IS 'Stores replies to guardian reports from both guardians and staff';
COMMENT ON TABLE guardian_report_recipients IS 'Stores CC list - teachers, managers, supervisors who can view and reply';
COMMENT ON COLUMN guardian_reports.status IS 'Status: open, in_progress, resolved, closed';
COMMENT ON COLUMN guardian_reports.priority IS 'Priority level: low, normal, high, urgent';
COMMENT ON COLUMN guardian_reports.deleted_at IS 'Soft delete timestamp - records deleted after 3 months';
