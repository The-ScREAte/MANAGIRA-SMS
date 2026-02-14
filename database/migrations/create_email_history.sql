-- Email History Table for Report Card Emails
CREATE TABLE IF NOT EXISTS email_history (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
    class_id INTEGER NOT NULL,
    term_id INTEGER NOT NULL,
    user_id INTEGER,
    batch_id VARCHAR(100) NOT NULL,
    student_id INTEGER NOT NULL,
    student_name VARCHAR(255) NOT NULL,
    recipient_emails TEXT[] NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, sending, sent, failed
    error_message TEXT,
    pdf_generated BOOLEAN DEFAULT false,
    sent_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_email_history_org_batch ON email_history(organization_id, batch_id);
CREATE INDEX IF NOT EXISTS idx_email_history_status ON email_history(status);
CREATE INDEX IF NOT EXISTS idx_email_history_created ON email_history(created_at);

-- Cleanup old records (older than 10 days) function
CREATE OR REPLACE FUNCTION cleanup_old_email_history() RETURNS void AS $$
BEGIN
    DELETE FROM email_history WHERE created_at < NOW() - INTERVAL '10 days';
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE email_history IS 'Stores email sending history for report cards with 10-day retention';
