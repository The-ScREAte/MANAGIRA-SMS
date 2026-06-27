CREATE TABLE IF NOT EXISTS admin_email_campaigns (
    id SERIAL PRIMARY KEY,
    subject TEXT NOT NULL,
    content TEXT NOT NULL,
    manual_emails TEXT[] NOT NULL DEFAULT '{}',
    target_user_ids INTEGER[] NOT NULL DEFAULT '{}',
    frequency VARCHAR(20) NOT NULL DEFAULT 'once',
    send_time VARCHAR(5) NOT NULL DEFAULT '09:00',
    day_of_week SMALLINT,
    day_of_month SMALLINT,
    start_date DATE NOT NULL DEFAULT CURRENT_DATE,
    end_date DATE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_sent_at TIMESTAMP,
    next_run_at TIMESTAMP,
    last_error TEXT,
    created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT admin_email_campaigns_frequency_check
        CHECK (frequency IN ('once', 'every_1_minute', 'every_3_minutes', 'every_5_minutes', 'every_10_minutes', 'daily', 'every_2_days', 'weekly', 'monthly')),
    CONSTRAINT admin_email_campaigns_send_time_check
        CHECK (send_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
    CONSTRAINT admin_email_campaigns_day_of_week_check
        CHECK (day_of_week IS NULL OR day_of_week BETWEEN 0 AND 6),
    CONSTRAINT admin_email_campaigns_day_of_month_check
        CHECK (day_of_month IS NULL OR day_of_month BETWEEN 1 AND 31)
);

CREATE INDEX IF NOT EXISTS idx_admin_email_campaigns_active_next_run
    ON admin_email_campaigns (is_active, next_run_at);

CREATE INDEX IF NOT EXISTS idx_admin_email_campaigns_created_by
    ON admin_email_campaigns (created_by);